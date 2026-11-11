import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { standardFontsDir } from "./pdf-ops";
import { svgImageSource } from "../../../lib/svg-image-source";

/**
 * Motores de verificación para los subagentes: las demos usan el propio
 * servicio de navegador Electron de la app mediante puppeteer-core, con el
 * Chrome del sistema como alternativa. Los SVG usan solo resvg; los PDF usan
 * pdfjs + Skia (sin navegador). No se distribuye ni se descarga ningún
 * Chromium adicional.
 *
 * Resolución del Chrome alternativo: primero CHROME_PATH y después las rutas
 * de instalación habituales de macOS, Windows y Linux. `available()` es una
 * comprobación barata del ejecutable; el auxiliar aún tiene que demostrar que
 * puede arrancar/conectarse cuando se ejecuta la tarea.
 *
 * Frontera de pruebas: `headlessOverride.current` sustituye toda la API (las
 * pruebas inyectan una falsa; nada de aquí toca un navegador real). Los
 * constructores llaman a `getHeadless()`.
 */

export interface DemoRunResult {
	/** console.error / mensajes de consola de tipo "error". */
	consoleErrors: string[];
	/** Excepciones no capturadas (window.onerror / promesas rechazadas sin gestionar). */
	pageErrors: string[];
	/** Peticiones de red que fallaron (scripts de CDN que no cargaron, …). */
	failedRequests: string[];
	/** Valor de la expresión de sondeo opcional, si se pidió y tuvo éxito. */
	probeResult?: unknown;
	/** True cuando nada de lo anterior registró nada. */
	ok: boolean;
}

export interface RunDemoOptions {
	/** Cuánto se deja asentar la página (animaciones, cargas asíncronas de CDN); 2 s por defecto. */
	settleMs?: number;
	/** Expresión JS opcional que se evalúa en la página tras asentarse; su valor
	 * se devuelve al constructor para que pueda comprobar el estado interno. */
	probe?: string;
}

export interface RenderSvgOptions {
	/** Las imágenes de anotación conservan la entrada nativa estricta: se omiten las reparaciones de visualización de las figuras normales. */
	nativeOnly?: boolean;
	/** Tamaño del viewport; por defecto, los atributos width/height del SVG, o si no, 900×700. */
	width?: number;
	height?: number;
}

export interface RenderPdfOptions {
	/** DPI de renderizado: 72 es el 100 % de zoom; la skill recomienda 100/150/200. */
	dpi?: number;
}

export interface RenderedPdfPage {
	page: number;
	png: Buffer;
}

export interface HeadlessApi {
	/** True cuando se puede resolver un auxiliar de navegador o Chrome (barato, sin arrancar). */
	available(): boolean;
	/** Por qué no, para los mensajes de error. */
	unavailableReason(): string | null;
	/** Ejecuta HTML en un navegador, captura los errores y, opcionalmente, sondea. */
	runDemo(html: string, opts?: RunDemoOptions): Promise<DemoRunResult>;
	/** Rasteriza un SVG a un búfer PNG (para verificar mirando). */
	renderSvg(svg: string, opts?: RenderSvgOptions): Promise<Buffer>;
	/** Renderiza páginas PDF a PNG de forma nativa (pdfjs + Skia) para el pdf-reader. */
	renderPdfPages(pdfPath: string, pages: number[], opts?: RenderPdfOptions): Promise<RenderedPdfPage[]>;
}

/** Frontera de pruebas: undefined en producción. */
export const headlessOverride: { current?: HeadlessApi } = {};

export function getHeadless(): HeadlessApi {
	return headlessOverride.current ?? realHeadless;
}

// ─── Resolución de Chrome ────────────────────────────────────────────────────

const CHROME_CANDIDATES = [
	...(process.platform === "win32" ? [
		path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
		path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
		...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")] : []),
	] : []),
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

export function resolveChromeExecutablePath(): string | null {
	const candidates = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(
		(p): p is string => typeof p === "string" && p.length > 0,
	);
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			/* no se puede leer: probar el siguiente */
		}
	}
	return null;
}

const NO_CHROME_MESSAGE =
	"No render engine available: the app's own browser helper failed to start and no system Chrome/Chromium was found. " +
	"Install Google Chrome or set CHROME_PATH to a Chrome executable. " +
	"(Verification is mandatory — demos are never delivered untested.)";

// ─── El propio Chromium de la app como servicio de navegador (oleada E, fase 3)
// Las demos ejecutan JS y necesitan un navegador. PRINCIPAL: el binario de esta
// misma app lanzado con --browser-service (main.cjs arranca una ventana oculta
// con un puerto CDP e imprime "BROWSER_SERVICE_CDP <port>"). ALTERNATIVA: el
// Chrome del sistema. Un canal IPC de Node controla su ciclo de vida: la muerte o
// desconexión del padre cierra el auxiliar en todos los SO (en Windows el stdin de
// Electron es un EOF sintético). Sin huérfanos. Los PDF y SVG nunca pasan por aquí (ahora son nativos).

/** Analizador de la línea de negociación (puro; exportado para las pruebas). */
export function parseBrowserServiceLine(line: string): number | null {
	const m = line.match(/^BROWSER_SERVICE_CDP (\d+)$/);
	if (!m) return null;
	const port = Number(m[1]);
	return port >= 1 && port <= 65535 ? port : null;
}

/** Saneador del entorno de lanzamiento (puro; exportado para las pruebas): el
 *  auxiliar debe ejecutarse como una app Electron COMPLETA (ELECTRON_RUN_AS_NODE
 *  no debe filtrarse) y no debe heredar la redirección de userData del shell de desarrollo. */
export function browserServiceSpawnEnv(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = { ...env };
	delete out.ELECTRON_RUN_AS_NODE;
	delete out.LH_DEV_URL;
	// El renderizador de artefactos no es un cliente autorizado de la API de la app.
	delete out.LH_DESKTOP_API_SECRET;
	delete out.LH_DESKTOP_SERVER;
	return out;
}

/** El binario auxiliar: dentro de la app empaquetada el servidor se ejecuta con
 *  ELECTRON_RUN_AS_NODE, así que process.execPath ES el binario de la app; en
 *  desarrollo (node a secas) el paquete electron resuelve la ruta del binario de desarrollo. */
export function browserServiceBinary(): string | null {
	if (process.versions.electron) return process.execPath;
	try {
		const req = createRequire(import.meta.url);
		const p = req("electron") as unknown as string;
		return typeof p === "string" && p.length > 0 ? p : null;
	} catch {
		return null;
	}
}

const BROWSER_SERVICE_TIMEOUT_MS = 15_000;
let browserServiceProc: import("node:child_process").ChildProcess | null = null;

type ConnectedBrowserService = {
	browser: import("puppeteer-core").Browser;
	proc: import("node:child_process").ChildProcess;
};

async function connectBrowserService(): Promise<ConnectedBrowserService | null> {
	const puppeteer = (await import("puppeteer-core")).default;
	const { spawn } = await import("node:child_process");
	let port: number | null = null;
	let proc = browserServiceProc;

	if (proc && proc.exitCode === null) {
		// Auxiliar vivo de una ejecución anterior: se reutiliza su endpoint.
		port = (proc as { __cdpPort?: number }).__cdpPort ?? null;
	}
	if (port === null) {
		const binary = browserServiceBinary();
		if (!binary) return null;
		// Empaquetada: execPath ejecuta la app incluida (el flag llega a main.cjs).
		// En desarrollo: el binario electron a secas necesita la raíz del repo como argumento;
		// sin él abriría la app por defecto de Electron en lugar de nuestro shell.
		const appArgs = process.versions.electron ? ["--browser-service"] : [
			// src/agent/subagents → raíz del repo
			path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
			"--browser-service",
		];
		proc = spawn(binary, appArgs, {
			// Conversión de tipo: el saneador es puro sobre un registro laxo; NODE_ENV
			// siempre está presente en un process.env real.
			env: browserServiceSpawnEnv(process.env) as NodeJS.ProcessEnv,
			stdio: ["ignore", "pipe", "pipe", "ipc"] as const,
		});
		browserServiceProc = proc;
		const startingProc = proc;
		port = await new Promise<number | null>((resolve) => {
			let buf = "";
			const timer = setTimeout(() => {
				startingProc.kill();
				resolve(null);
			}, BROWSER_SERVICE_TIMEOUT_MS);
			const onData = (chunk: Buffer) => {
				buf += chunk.toString("utf8");
				const line = buf.split("\n").find((l) => parseBrowserServiceLine(l) !== null);
				if (line !== undefined) {
					clearTimeout(timer);
					resolve(parseBrowserServiceLine(line));
				}
			};
			startingProc.stdout!.on("data", onData);
			startingProc.once("exit", () => {
				clearTimeout(timer);
				resolve(null);
			});
		});
		if (port === null) {
			browserServiceProc = null;
			return null;
		}
		(proc as { __cdpPort?: number }).__cdpPort = port;
	}

	if (!proc) return null;
	try {
		const version = await fetch(`http://127.0.0.1:${port}/json/version`);
		const info = (await version.json()) as { webSocketDebuggerUrl?: string };
		if (!info.webSocketDebuggerUrl) return null;
		// conectar ≠ arrancar: browser.close() más abajo solo desconecta; el auxiliar
		// sigue residente para la siguiente tarea (ciclo de vida controlado por IPC).
		const browser = await puppeteer.connect({
			browserWSEndpoint: info.webSocketDebuggerUrl,
			defaultViewport: null,
		});
		return { browser, proc };
	} catch {
		return null;
	}
}

/** Serializa juntas la adquisición, el uso de la página y la invalidación: el
 * auxiliar posee UN solo destino de página. Las tareas en cola deben adquirir
 * después de que la anterior retire o descarte su auxiliar, nunca capturar un
 * Browser mientras haya una negociación pendiente. */
let helperPageChain: Promise<unknown> = Promise.resolve();

async function withBrowserPage<T>(fn: (page: import("puppeteer-core").Page) => Promise<T>): Promise<T> {
	// Primero el auxiliar (decisión del responsable 2026-10-10: el propio Chromium de
	// la app como principal y el Chrome del sistema como alternativa): determinista entre usuarios, sin instalar nada.
	const run = async (): Promise<{ value: T } | null> => {
		const helper = await connectBrowserService();
		if (!helper) return null;
		const pages = await helper.browser.pages();
		const page = pages.find((p) => p.target().type() === "page");
		if (!page) throw new Error("browser service: no page target");
		try {
			return { value: await fn(page) };
		} catch (error) {
			if (error instanceof IsolatedPageCleanupError) {
				// Una retirada fallida nunca debe dejar un documento no fiable vivo en el
				// destino compartido. La siguiente tarea arranca un auxiliar propio nuevo.
				helper.proc.kill();
				if (browserServiceProc === helper.proc) browserServiceProc = null;
			}
			throw error;
		} finally {
			// Descarta todo el estado de la página (heap de JS, listeners) entre tareas.
			await page.goto("about:blank").catch(() => {});
		}
	};
	const next = helperPageChain.then(run, run);
	helperPageChain = next.catch(() => {});
	const result = await next;
	if (result) return result.value;

	// Chrome alternativo: se arranca por tarea y se cierra al salir (semántica antigua).
	const puppeteer = (await import("puppeteer-core")).default;
	const executablePath = resolveChromeExecutablePath();
	const browser = await puppeteer.launch({
		headless: true,
		// Ruta explícita si encontramos una; si no, puppeteer resuelve por sí mismo
		// la instalación de Chrome del sistema mediante el canal "chrome".
		...(executablePath ? { executablePath } : { channel: "chrome" as const }),
		args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
	});
	try {
		const page = await browser.newPage();
		return await fn(page);
	} finally {
		await browser.close().catch(() => {});
	}
}

// ─── Carga aislada de páginas ────────────────────────────────────────────────
// El HTML de las demos lo genera el modelo, así que no es fiable.
// Se carga en memoria sobre about:blank, lo que da al documento un origen opaco,
// como el iframe aislado del alumno. Un documento file:// podría leer cualquier
// fichero local. Como segunda capa, las peticiones de cualquier otro esquema
// (file: incluido) se abortan mientras la página está cargada.

const ISOLATED_PAGE_SCHEMES = new Set(["http:", "https:", "data:", "blob:", "about:"]);

/** Filtro de peticiones para páginas aisladas (puro; exportado para las pruebas). */
export function isIsolatedPageRequestAllowed(url: string): boolean {
	try {
		return ISOLATED_PAGE_SCHEMES.has(new URL(url).protocol);
	} catch {
		return false;
	}
}

type IsolatedPage = Pick<
	import("puppeteer-core").Page,
	"url" | "goto" | "setContent" | "setRequestInterception" | "on" | "off"
>;

class IsolatedPageCleanupError extends Error {}

/** Carga marcado no fiable en memoria con el filtro de peticiones activo. La
 * limpieza primero retira el documento bajo esa misma protección y luego
 * desactiva la intercepción. Si la retirada falla, se deja la protección
 * instalada y se descarta el auxiliar. */
export async function loadIsolatedPage(page: IsolatedPage, html: string): Promise<() => Promise<void>> {
	const onRequest = (request: import("puppeteer-core").HTTPRequest) => {
		const decision = isIsolatedPageRequestAllowed(request.url()) ? request.continue() : request.abort("accessdenied");
		void decision.catch(() => {});
	};
	let retirement: Promise<void> | undefined;
	const cleanup = () => retirement ??= (async () => {
		try {
			await page.goto("about:blank", { timeout: 5_000 });
			await page.setRequestInterception(false);
			page.off("request", onRequest);
		} catch (error) {
			throw new IsolatedPageCleanupError("Could not retire the untrusted browser document", { cause: error });
		}
	})();
	try {
		page.on("request", onRequest);
		await page.setRequestInterception(true);
		// setContent conserva el origen actual; primero se restablece bajo la protección.
		if (page.url() !== "about:blank") await page.goto("about:blank", { timeout: 5_000 });
		await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
		return cleanup;
	} catch (err) {
		await cleanup();
		throw err;
	}
}

// ─── Ejecución de demos ──────────────────────────────────────────────────────

async function runDemo(html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
	return withBrowserPage(page => runDemoOnPage(page, html, opts));
}

/** Ejecución de producción en una página propia; la barrera del paquete usa
 * esta misma función con su destino auxiliar de perfil temporal explícito. */
export async function runDemoOnPage(page: import("puppeteer-core").Page, html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
	const settleMs = opts.settleMs ?? 2000;
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const failedRequests: string[] = [];
	let probeResult: unknown;
	let probed = false;

	const onConsole = (msg: import("puppeteer-core").ConsoleMessage) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	};
	const onError = (err: unknown) => pageErrors.push(err instanceof Error ? err.message : String(err));
	const onFailed = (req: import("puppeteer-core").HTTPRequest) => failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
	page.on("console", onConsole);
	page.on("pageerror", onError);
	page.on("requestfailed", onFailed);
	try {
		let cleanup: (() => Promise<void>) | undefined;
		try {
			cleanup = await loadIsolatedPage(page, html);
			await new Promise((resolve) => setTimeout(resolve, settleMs));
			if (opts.probe) {
				try {
					probeResult = await page.evaluate(opts.probe);
				} catch (err) {
					pageErrors.push(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				probed = true;
			}
		} catch (err) {
			if (err instanceof IsolatedPageCleanupError) throw err;
			pageErrors.push(err instanceof Error ? err.message : String(err));
		} finally {
			await cleanup?.();
		}
	} finally {
		page.off("console", onConsole);
		page.off("pageerror", onError);
		page.off("requestfailed", onFailed);
	}

	return {
		consoleErrors,
		pageErrors,
		failedRequests,
		...(probed ? { probeResult } : {}),
		ok: consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
	};
}

// ─── Rasterización de SVG ────────────────────────────────────────────────────

function svgViewport(svg: string, opts: RenderSvgOptions): { width: number; height: number } {
	if (opts.width && opts.height) return { width: opts.width, height: opts.height };
	const width = Number(svg.match(/\bwidth\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	const height = Number(svg.match(/\bheight\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	return {
		width: Math.ceil(Number.isFinite(width) && width > 0 ? width : 900),
		height: Math.ceil(Number.isFinite(height) && height > 0 ? height : 700),
	};
}

/** Normaliza una captura de pantalla de Chrome en bruto para los ojos del
 *  modelo (corrección del 2026-09-19).
 *
 *  POR QUÉ: Chrome escribe los PNG con un flujo IDAT PARTIDO (fragmentos de
 *  4 KB), y el decodificador de visión de Alibaba (detrás de qwen3.8-flash de
 *  OpenRouter, el modelo de visión del visual-maker) los rechazaba de plano
 *  durante el periodo 2026-09-18/19: "The image format is illegal and cannot
 *  be opened", de forma determinista y en todos los tamaños (50–800 px),
 *  mientras que todas las formas con un único IDAT pasaban (un 1×1 hecho a
 *  mano y recodificaciones con sharp). En una prueba posterior los PNG de
 *  Chrome en bruto también pasaron (el decodificador remoto se corrigió o es
 *  inestable según el backend), pero la forma canónica se queda: la
 *  especificación PNG dice que los fragmentos IDAT son una PARTICIÓN
 *  arbitraria de un único flujo zlib, así que unirlos es la forma más
 *  estándar, con un flujo idéntico byte a byte y sin recodificar.
 *
 *  Node puro a propósito (sin sharp): históricamente el proceso ya cargaba una
 *  biblioteca de imagen nativa a través del sharp + libvips anidado de
 *  @huggingface/transformers, e importar el sharp de la raíz (dependencia
 *  opcional de Next) metía una SEGUNDA libvips en el proceso; el runtime ObjC
 *  de macOS avisa (GNotificationCenterDelegate duplicado, "mysterious
 *  crashes"). El embedder de transformers desapareció con la oleada 6
 *  (2026-09-23), pero la regla se mantiene: una biblioteca de imagen nativa
 *  por proceso; el código de la app no lleva ninguna. */
export function providerSafePng(png: Buffer): Buffer {
	const SIG_LEN = 8;
	if (png.length < SIG_LEN + 12 || png.subarray(0, SIG_LEN).toString("hex") !== "89504e470d0a1a0a") return png;
	// Recorre los fragmentos una vez y une la partición IDAT en su forma canónica
	// de un solo fragmento (posición del primer IDAT, contenido concatenado).
	const parts: Array<{ type: string; data: Buffer }> = [];
	let off = SIG_LEN;
	while (off + 12 <= png.length) {
		const len = png.readUInt32BE(off);
		if (off + 12 + len > png.length) break; // cola truncada: se deja tal cual
		parts.push({ type: png.subarray(off + 4, off + 8).toString("ascii"), data: png.subarray(off + 8, off + 8 + len) });
		off += 12 + len;
	}
	const idats = parts.filter((p) => p.type === "IDAT");
	if (idats.length < 2) return png; // ya es canónico
	const merged = Buffer.concat(idats.map((p) => p.data));
	let emittedIdat = false;
	const out: Buffer[] = [png.subarray(0, SIG_LEN)];
	for (const p of parts) {
		if (p.type !== "IDAT") out.push(chunk(p.type, p.data));
		else if (!emittedIdat) {
			out.push(chunk("IDAT", merged));
			emittedIdat = true;
		}
	}
	return Buffer.concat(out);
}

/** Un fragmento PNG (longitud + tipo + datos + CRC32): la disposición exacta de la especificación. */
function chunk(type: string, data: Buffer): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/** CRC-32 (el polinomio de PNG, sin tabla) para las sumas de comprobación de los fragmentos. */
function crc32(buf: Buffer): number {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

async function renderSvg(svg: string, opts: RenderSvgOptions = {}): Promise<Buffer> {
	// Solo rasterización nativa estática. Las figuras normales reciben las mismas dos
	// reparaciones de solo renderizado que en su visualización; las de anotación siguen estrictas.
	// Los errores nativos se propagan a la gestión de revisión/fallo existente del
	// visual-maker, nunca a marcado ejecutable en navegador ni al Chrome del sistema.
	const { width } = svgViewport(svg, opts);
	const { Resvg } = await import("@resvg/resvg-js");
	const resvg = new Resvg(opts.nativeOnly ? svg : svgImageSource(svg), {
		fitTo: { mode: "width", value: width },
		font: { loadSystemFonts: true },
		background: "#ffffff",
	});
	return providerSafePng(resvg.render().asPng());
}

// ─── Rasterización de páginas PDF (pdfjs pinta, Skia aloja) ─────────────

/** Megapíxeles decimales: a cuatro bytes por píxel son unos 61 MiB por lienzo
 *  de página, sin contar el resto de memoria de trabajo de pdfjs/Skia. */
export const MAX_PDF_CANVAS_PIXELS = 16_000_000;
export const MAX_PDF_CANVAS_SIDE = 8192;

/** Planifica la reserva a partir del viewport a escala 1 (incluida la rotación
 *  del PDF). La aritmética normal de DPI/ceil no cambia; las páginas demasiado
 *  grandes pierden escala, nunca la ganan. Se exporta como frontera pura para
 *  que la geometría extrema no necesite un lienzo. */
export function pdfCanvasGeometry(baseWidth: number, baseHeight: number, dpi: number): {
	scale: number;
	width: number;
	height: number;
} {
	if (![baseWidth, baseHeight].every((n) => Number.isFinite(n) && n > 0)) {
		throw new Error("PDF page dimensions must be finite and positive");
	}
	if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 72 === 0) {
		throw new Error("PDF render DPI must be finite and positive");
	}
	// Primero se limitan los lados, para que el cálculo del área no pueda desbordarse
	// aunque las dimensiones sin escalar o los DPI pedidos sean enormes.
	let scale = Math.min(dpi / 72, MAX_PDF_CANVAS_SIDE / baseWidth, MAX_PDF_CANVAS_SIDE / baseHeight);
	const area = (baseWidth * scale) * (baseHeight * scale);
	if (area > MAX_PDF_CANVAS_PIXELS) scale *= Math.sqrt(MAX_PDF_CANVAS_PIXELS / area);
	const dimensions = (s: number) => ({
		width: Math.max(1, Math.ceil(baseWidth * s)),
		height: Math.max(1, Math.ceil(baseHeight * s)),
	});
	const fits = ({ width, height }: { width: number; height: number }) =>
		width <= MAX_PDF_CANVAS_SIDE && height <= MAX_PDF_CANVAS_SIDE && width * height <= MAX_PDF_CANVAS_PIXELS;
	// Ceil puede dejar por encima del presupuesto un viewport en coma flotante que estaba acotado.
	// Se busca una escala segura en lugar de recortar el viewport o reservar primero.
	if (!fits(dimensions(scale))) {
		let low = 0;
		let high = scale;
		for (let i = 0; i < 64; i++) {
			const mid = low + (high - low) / 2;
			if (fits(dimensions(mid))) low = mid;
			else high = mid;
		}
		scale = low;
	}
	if (scale <= 0 || baseWidth * scale === 0 || baseHeight * scale === 0) {
		throw new Error("PDF page dimensions cannot be rendered at a positive scale");
	}
	return { scale, ...dimensions(scale) };
}

/** Renderiza páginas PDF a PNG: los ojos del pdf-reader de sources-v0.
 *
 *  Historia: pdfjs SIEMPRE pintó las páginas (escala = dpi/72, la aritmética
 *  de zoom de la skill); primero dentro de una pestaña de Chrome headless
 *  (lienzo simulado, toDataURL, 2026-09-19) y ahora en @napi-rs/canvas en este
 *  proceso (oleada E, 2026-10-10). El motor de pintado no cambió nunca; solo el
 *  anfitrión del lienzo: Skia en el proceso mediante la integración con Node
 *  de pdfjs-dist v6. Sin navegador, sin ficheros temporales, sin pasar por base64. */
async function renderPdfPages(
	pdfPath: string,
	pages: number[],
	opts: RenderPdfOptions = {},
): Promise<RenderedPdfPage[]> {
	const dpi = opts.dpi ?? 150;
	if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 72 === 0) {
		throw new Error("PDF render DPI must be finite and positive");
	}
	// LIENZO NATIVO (oleada E, responsable 2026-10-10): pdfjs pinta en
	// @napi-rs/canvas en este proceso, sin navegador. La integración con Node de
	// pdfjs-dist v6 ES @napi-rs/canvas (su optionalDependency: la NodeCanvasFactory
	// lo requiere), así que el motor de pintado es exactamente el código que antes
	// se ejecutaba en la pestaña simulada de Chrome; solo cambió el anfitrión del
	// lienzo (Skia en el proceso en lugar de un lienzo DOM). Las herramientas de texto
	// de PDF nunca necesitaron navegador; ahora el renderizado tampoco.
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const { createCanvas } = await import("@napi-rs/canvas");
	const data = new Uint8Array(fs.readFileSync(path.resolve(pdfPath)));
	// Datos de fuentes estándar como ruta de directorio (hallazgo de la prueba en vivo
	// del 2026-09-19: sin ellos pdfjs renderiza con sustitutas las fuentes estándar no
	// incrustadas); verbosity 0 = solo errores (ruido de JBIG2 en los PDF escaneados).
	const loadingTask = pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	const doc = await loadingTask.promise;
	try {
		const out: RenderedPdfPage[] = [];
		for (const pageNo of pages) {
			if (pageNo < 1 || pageNo > doc.numPages) continue;
			const pg = await doc.getPage(pageNo);
			const base = pg.getViewport({ scale: 1 });
			const geometry = pdfCanvasGeometry(base.width, base.height, dpi);
			const vp = pg.getViewport({ scale: geometry.scale });
			const canvas = createCanvas(geometry.width, geometry.height);
			const ctx = canvas.getContext("2d");
			// Los tipos de renderizado de pdfjs hablan del contexto DOM; el contexto de
			// @napi-rs/canvas es la misma API 2D implementada sobre Skia.
			await pg.render({
				canvasContext: ctx as unknown as CanvasRenderingContext2D,
				canvas: canvas as unknown as HTMLCanvasElement,
				viewport: vp,
			}).promise;
			out.push({
				page: pageNo,
				// PNG codificado por Skia → providerSafePng, para la misma forma canónica de un
				// solo IDAT que recibe cualquier otra imagen para el modelo de visión.
				png: providerSafePng(canvas.toBuffer("image/png")),
			});
		}
		return out;
	} finally {
		await loadingTask.destroy().catch(() => {});
	}
}

// ─── la API real ─────────────────────────────────────────────────────────────

export const realHeadless: HeadlessApi = {
	available() {
		// El binario auxiliar existe por construcción en la app empaquetada; en desarrollo
		// se resuelve mediante el paquete electron. El Chrome del sistema amplía la cobertura.
		return browserServiceBinary() !== null || resolveChromeExecutablePath() !== null;
	},
	unavailableReason() {
		return browserServiceBinary() === null && resolveChromeExecutablePath() === null ? NO_CHROME_MESSAGE : null;
	},
	runDemo,
	renderSvg,
	renderPdfPages,
};
