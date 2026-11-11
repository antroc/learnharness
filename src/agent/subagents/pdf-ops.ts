import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { documentToMarkdown, type PdfPage } from "./pdf-markdown.ts";

/**
 * Fontanería de PDF para el subagente pdf-reader (sources v0, 2026-09):
 * versiones para Node de los cuatro scripts de la skill pdf-reader (pdf_info /
 * pdf_extract / pdf_search / pdf_render), sobre la pila híbrida que eligió el
 * usuario:
 *
 * - TEXTO (info / extract / search): pdfjs-dist, JS puro, sin dependencias
 *   nativas. extract y search leen el Markdown de pdf-markdown, así que las
 *   palabras y las líneas se conservan (los elementos de texto en bruto pegaban
 *   "lecture" + "Plants").
 * - RENDERIZADO: subagents/headless.ts usa el mismo motor pdfjs con
 *   @napi-rs/canvas (Skia), en el proceso; no hace falta navegador.
 *
 * Doctrina (la estrategia de lectura de la skill, reflejada en el prompt de
 * sistema del subagente): clasificar PRIMERO con pdf_info y después aplicar
 * una estrategia según el tamaño: los PDF cortos renderizan todas las
 * páginas, los medianos renderizan las páginas marcadas (con muchas
 * matemáticas o imágenes) y los largos hacen búsquedas concretas antes de
 * leer nada a fondo.
 *
 * Son funciones de biblioteca puras, sin modelo a la vista. El agente
 * pdf-reader (pdf-reader.ts) las dirige con su propio bucle de herramientas.
 */

export interface PdfPageInfo {
	page: number;
	text_length: number;
	image_count: number;
	/** Fracción de caracteres de tipo matemático: la señal de «renderiza esta
	 *  página» (versión de la heurística de densidad por rangos Unicode de la skill). */
	math_density: number;
}

export interface PdfInfo {
	path: string;
	page_count: number;
	/** Media de caracteres por página: la clase de tamaño según la que se ramifica la estrategia. */
	mean_text_length: number;
	pages: PdfPageInfo[];
}

/** Carga la compilación heredada de pdfjs (funciona headless en node a secas, sin worker). */
async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

/** Directorio de datos de fuentes estándar (hallazgo de la prueba en vivo del
 *  2026-09-19: sin él pdfjs avisa y usa sustitutas para las fuentes estándar no
 *  incrustadas: Helvetica, Times…). El lado de node recibe una ruta normal del
 *  sistema de ficheros, compartida por el texto y el renderizado. pdfjs
 *  comprueba endsWith("/") incluso en Windows: usa una barra final literal, NO
 *  path.sep ("\\" en Windows). El fs de Node acepta esta ruta en todos los SO. */
export function standardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

async function openDocument(filePath: string) {
	return openBytes(new Uint8Array(await fs.readFile(filePath)));
}

type PdfLoadingTask = Pick<import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask, "promise" | "destroy">;
type PdfTaskLoader = (data: Uint8Array, signal?: AbortSignal) => PdfLoadingTask | Promise<PdfLoadingTask>;

async function loadBytes(data: Uint8Array, signal?: AbortSignal): Promise<PdfLoadingTask> {
	signal?.throwIfAborted();
	const pdfjs = await loadPdfjs();
	signal?.throwIfAborted();
	// La compilación heredada en node a secas funciona con un worker simulado en el
	// hilo principal (no hace falta workerSrc); el desmontaje es el destroy() de la tarea de carga.
	// verbosity 0 = solo errores; si no, los PDF escaneados (XObjects JBIG2) inundan
	// el registro con avisos por página (hallazgo de la prueba en vivo del 2026-09-19).
	return pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
}

async function openBytes(data: Uint8Array, signal?: AbortSignal, loadTask: PdfTaskLoader = loadBytes) {
	signal?.throwIfAborted();
	const loadingTask = await loadTask(data, signal);
	let destruction: Promise<void> | undefined;
	const destroy = () => destruction ??= Promise.resolve().then(() => loadingTask.destroy()).finally(() => {
		signal?.removeEventListener("abort", onAbort);
	});
	const onAbort = () => { void destroy().catch(() => {}); };
	signal?.addEventListener("abort", onAbort, { once: true });
	// Cubre la cancelación mientras el propio cargador estaba pendiente.
	if (signal?.aborted) onAbort();
	try {
		// No se enfrenta esta promesa a la cancelación: la apertura y el desmontaje deben
		// completarse antes de que el llamante pueda liberar capacidad de conversión.
		const doc = await loadingTask.promise;
		signal?.throwIfAborted();
		return { doc, task: { destroy } };
	} catch (error) {
		// Las aperturas fallidas también tienen su tarea de carga. La limpieza es de mejor
		// esfuerzo, sin sustituir el error de análisis (ni el motivo de cancelación del llamante).
		await destroy().catch(() => {});
		signal?.throwIfAborted();
		throw error;
	}
}

/** Concatena los elementos de texto de una página en una cadena de cuerpo. */
function itemsToText(items: unknown[]): string {
	let out = "";
	for (const it of items) {
		if (it && typeof it === "object" && "str" in (it as Record<string, unknown>)) {
			const str = (it as { str?: unknown }).str;
			if (typeof str === "string") out += str;
		}
	}
	return out;
}

/** Fracción de caracteres de tipo matemático: la heurística de la skill, con los rangos tal cual. */
function mathDensity(text: string): number {
	let mathChars = 0;
	for (const c of text) {
		const code = c.codePointAt(0)!;
		if (
			(code >= 0x2200 && code <= 0x22ff) || // Operadores matemáticos
			(code >= 0x2100 && code <= 0x214f) || // Símbolos de tipo letra
			(code >= 0x2190 && code <= 0x21ff) || // Flechas
			(code >= 0x27c0 && code <= 0x27ef) || // Símbolos matemáticos diversos A
			(code >= 0x2980 && code <= 0x29ff) || // Símbolos matemáticos diversos B
			(code >= 0x2a00 && code <= 0x2aff) || // Operadores matemáticos suplementarios
			(code >= 0x0370 && code <= 0x03ff) || // Griego
			(code >= 0x1d400 && code <= 0x1d7ff) || // Símbolos alfanuméricos matemáticos
			"∫∑∏√∂∇∞≈≠≤≥±×÷∈∉⊂⊃∪∩∧∨¬∀∃∅".includes(c)
		) {
			mathChars++;
		}
	}
	return mathChars / Math.max(text.length, 1);
}

/** Sondeo barato de validez: getDocument solo se resuelve con PDF analizables;
 *  sin recorrer páginas ni extraer texto (a diferencia de pdfInfo). Es la
 *  barrera previa del lector para fuentes ilegibles; los ficheros basura lanzan
 *  el error preciso de pdfjs. */
export async function pdfProbe(filePath: string): Promise<void> {
	const { task } = await openDocument(filePath);
	await task.destroy();
}

/** pdf_info: número de páginas + señales de clasificación por página. Se ejecuta SIEMPRE primero. */
export async function pdfInfo(filePath: string): Promise<PdfInfo> {
	const pdfjs = await loadPdfjs(); // Constante OPS para recorrer la lista de operadores
	const { doc } = await openDocument(filePath);
	const pages: PdfPageInfo[] = [];
	let totalText = 0;
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = itemsToText(content.items as unknown[]);
		// cuenta las imágenes de la página: operaciones paintImageXObject de la lista de operadores
		const ops = await page.getOperatorList();
		let imageCount = 0;
		for (const fn of ops.fnArray) {
			if (fn === pdfjs.OPS.paintImageXObject) imageCount++;
		}
		totalText += text.length;
		pages.push({
			page: i,
			text_length: text.length,
			image_count: imageCount,
			math_density: Math.round(mathDensity(text) * 10000) / 10000,
		});
	}
	return {
		path: filePath,
		page_count: doc.numPages,
		mean_text_length: Math.round(totalText / Math.max(doc.numPages, 1)),
		pages,
	};
}

/** Analiza 'all' | '1-5' | '1,3,7' | '3' en una lista ordenada de páginas con índice desde 1. */
export function parsePageSpec(spec: string, total: number): number[] {
	const trimmed = spec.trim().toLowerCase();
	if (trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [startRaw, endRaw] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(startRaw, 10));
			const end = Math.min(total, parseInt(endRaw, 10));
			for (let pg = start; pg <= end; pg++) pages.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (pg >= 1 && pg <= total) pages.add(pg);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

export type PdfConversion =
	| { kind: "converted"; pages: PdfPage[] }
	| { kind: "too-long"; pageCount: number }
	/** Dañado, cifrado o ni siquiera un PDF: pdfjs no pudo leerlo. */
	| { kind: "unreadable" };

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/** Frontera interna del servidor para la tarea de carga en las pruebas del ciclo de vida; no es una
 * capacidad de plugin. Los cargadores inyectados y el predeterminado siguen la misma ruta de conversión
 * y limpieza. */
export function createPdfConverter(loadTask: PdfTaskLoader = loadBytes) {
	return async (data: Uint8Array, maxPages: number, options?: { signal?: AbortSignal }): Promise<PdfConversion> => {
		const signal = options?.signal;
		let opened: Awaited<ReturnType<typeof openBytes>> | undefined;
		let result: PdfConversion | undefined;
		let failure: unknown;
		try {
			opened = await openBytes(data, signal, loadTask);
			signal?.throwIfAborted();
			result = opened.doc.numPages > maxPages
				? { kind: "too-long", pageCount: opened.doc.numPages }
				: { kind: "converted", pages: await documentToMarkdown(opened.doc, undefined, signal) };
		} catch (error) {
			failure = error;
		} finally {
			try {
				await opened?.task.destroy();
			} catch (error) {
				if (!signal?.aborted && !isAbortError(failure)) throw error;
			}
		}
		// También se observan las cancelaciones que llegan durante el desmontaje final. Nunca se
		// disfraza una cancelación de PDF dañado, aunque destroy se rechace al cancelar.
		signal?.throwIfAborted();
		if (isAbortError(failure)) throw failure;
		return result ?? { kind: "unreadable" };
	};
}

const defaultPdfConverter = createPdfConverter();

/** Las páginas de un PDF subido como Markdown (la puerta de la importación de
 * notas). El límite de páginas se comprueba antes de leer ninguna. La cancelación
 * es cooperativa: el worker simulado de Node de pdfjs no puede interrumpir el
 * análisis o el formato síncronos. La promesa espera a la apertura/conversión y a
 * la destrucción de mejor esfuerzo, no a un plazo estricto. */
export async function convertPdf(data: Uint8Array, maxPages: number, options?: { signal?: AbortSignal }): Promise<PdfConversion> {
	return defaultPdfConverter(data, maxPages, options);
}

/** El Markdown de una página, o "" si la página no tiene texto (el agente renderiza esas). */
function pageMarkdown(page: PdfPage): string {
	return page.kind === "text" ? page.markdown : "";
}

/** pdf_extract: Markdown de las páginas pedidas, con encabezados `--- Page N ---`. */
export async function pdfExtract(filePath: string, pageSpec: string): Promise<string> {
	const { doc } = await openDocument(filePath);
	const pages = parsePageSpec(pageSpec, doc.numPages);
	if (pages.length === 0) return "No pages selected — page spec matched nothing.";
	const converted = await documentToMarkdown(doc, pages);
	return converted.map((page) => `--- Page ${page.number} ---\n${pageMarkdown(page)}`).join("\n");
}

export interface PdfSearchHit {
	page: number;
	line: number;
	/** contextLines alrededor de la coincidencia, con `>>>` marcando su línea. */
	context: string;
}

/** pdf_search: palabra clave/regex en todas las páginas, con líneas de contexto.
 *  pageTexts viaja con el resultado para que el agente pueda extraer la página
 *  completa de una coincidencia sin una segunda pasada (la skill encadena
 *  `search → extract` del mismo modo). */
export async function pdfSearch(
	filePath: string,
	query: string,
	opts?: { contextLines?: number; literal?: boolean },
): Promise<{ hits: PdfSearchHit[]; pageTexts: Map<number, string> }> {
	const contextLines = opts?.contextLines ?? 3;
	const { doc } = await openDocument(filePath);
	let pattern: RegExp;
	if (opts?.literal) {
		pattern = new RegExp(escapeRegex(query), "i");
	} else {
		try {
			pattern = new RegExp(query, "i");
		} catch (err) {
			throw new Error(`Invalid regex: ${(err as Error).message}`);
		}
	}
	const hits: PdfSearchHit[] = [];
	const pageTexts = new Map<number, string>();
	for (const page of await documentToMarkdown(doc)) {
		const i = page.number;
		const text = pageMarkdown(page);
		pageTexts.set(i, text);
		const lines = text.split("\n");
		for (let ln = 0; ln < lines.length; ln++) {
			if (!pattern.test(lines[ln]!)) continue;
			const start = Math.max(0, ln - contextLines);
			const end = Math.min(lines.length, ln + contextLines + 1);
			const context = lines
				.slice(start, end)
				.map((l, j) => `${start + j === ln ? ">>>" : "   "} ${l}`)
				.join("\n");
			hits.push({ page: i, line: ln + 1, context });
		}
	}
	return { hits, pageTexts };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Dónde acaban las páginas renderizadas (refleja la convención /tmp de la skill). */
export function renderDir(filePath: string): string {
	// Hash corto FNV-1a de la ruta absoluta: estable por fichero, sin dependencias.
	const abs = path.resolve(filePath);
	let h = 0x811c9dc5;
	for (let i = 0; i < abs.length; i++) {
		h ^= abs.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return path.join("/tmp", `lh-pdf-${h.toString(16).padStart(8, "0")}`);
}