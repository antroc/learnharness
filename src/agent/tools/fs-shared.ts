import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AUTH_FILE } from "../../../config.ts";
import { comparisonPath, guardSourcePath, isWithin, realSourcePath as realOrMissing, resolvePolicy, type ResolvedFileAccessPolicy } from "./file-access.ts";

/**
 * Fontanería compartida de las herramientas del sistema de ficheros del alumno (ls / find / grep):
 * sources v1 (2026-09-19): el agente localiza y lee él mismo los ficheros del alumno,
 * así que las rutas no necesitan ningún recurso de interfaz (decisión del usuario: sin adjuntos;
 * el alumno menciona los ficheros en los mensajes y el agente los encuentra).
 *
 * Postura de seguridad (fijada por el usuario): SOLO LECTURA por construcción: sin llamadas a shell,
 * sin argumentos de proceso controlados por el usuario, sin API de mutación en ningún sitio. La única
 * ampliación deliberada de alcance respecto a pi: las rutas relativas y las raíces por defecto se resuelven
 * contra el HOME DEL ALUMNO, no contra un cwd de proyecto: el harness no tiene un
 * directorio de trabajo con sentido, y «encuentra mis apuntes» debería funcionar sin más.
 * La excepción: las ubicaciones sensibles de home, los ficheros dotenv y los almacenes de
 * credenciales configurados de la app los rechaza el resolvedor y los saltan los
 * recorridos: todo lo que lee una herramienta se envía al proveedor del modelo. Es
 * defensa en profundidad basada en rutas, no un sandbox ni un sistema de censura de contenido.
 *
 * Comportamientos portados (reflejo de dist/core/tools/{ls,find,grep}.js de pi): los
 * esquemas, descripciones, formatos de salida y avisos de truncado se copian
 * literalmente salvo donde la semántica difiere (home por defecto, sin .gitignore,
 * sustituido por exclusiones fijas de ruido).
 */

/** 50 KB: el DEFAULT_MAX_BYTES de pi, el techo de salida de toda herramienta de fs. */
export const MAX_OUTPUT_BYTES = 50 * 1024;
/** La longitud de truncado de línea del grep de pi (GREP_MAX_LINE_LENGTH). */
export const GREP_MAX_LINE_LENGTH = 500;
/** Presupuesto de tiempo real para los recorridos de árbol (find/grep sobre todo un directorio home). */
export const WALK_TIMEOUT_MS = 10_000;

/**
 * Nombres de directorio en los que nunca se entra durante los recorridos. node_modules/.git reflejan
 * los valores por defecto de fd/rg de pi; Library/.Trash son el ruido de la raíz de home que aprobó el usuario
 * (2026-09-19): bajo ellos viven cachés, datos de aplicaciones y la papelera.
 * Las rutas explícitas (ls/read de ~/Library/…) NO se filtran: solo los recorridos.
 */
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "Library", ".Trash"]);

/**
 * Ubicaciones relativas a home que las herramientas nunca leen ni recorren: almacenes de
 * credenciales, claves, transcripts de sesiones y ajustes de otros agentes, perfiles de
 * navegador. A diferencia de EXCLUDED_DIR_NAMES, estas se rechazan también para rutas explícitas
 * (resolveSourcePath), no solo se saltan en los recorridos. Se comparan
 * sin distinguir mayúsculas, también en sistemas de ficheros que las distinguen.
 */
const SENSITIVE_HOME_PATHS = [
	".claude",
	".codex",
	".cursor",
	".gemini",
	".ssh",
	".gnupg",
	".aws",
	".azure",
	".config/gcloud",
	".kube",
	".docker",
	".netrc",
	".npmrc",
	".pypirc",
	".git-credentials",
	"Library/Keychains",
	"Library/Cookies",
	"Library/Safari",
	"Library/Application Support/Google/Chrome",
	"Library/Application Support/BraveSoftware",
	"Library/Application Support/Microsoft Edge",
	"Library/Application Support/Firefox",
	".mozilla",
	".config/google-chrome",
	".config/chromium",
	".config/BraveSoftware",
	".config/microsoft-edge",
	"AppData/Local/Google/Chrome",
	"AppData/Local/BraveSoftware",
	"AppData/Local/Microsoft/Edge",
	"AppData/Roaming/Mozilla",
];

/** Las plantillas se incluyen a propósito: sus nombres no garantizan que su contenido sea seguro. */
const ENV_FILE = /^\.env(\..*)?$/i;
const SUBSCRIPTION_FILES = ["chatgpt-credentials.json", "github-copilot-credentials.json", "xai-credentials.json"];
// Coincide con los escritores reales de store/auth.ts y electron/{chatgpt,subscription-store}.cjs.
const CREDENTIAL_TEMP = /^(?:\.auth\.json\.tmp-\d+|(?:chatgpt|github-copilot|xai)-credentials\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp)$/i;
const ATOMIC_TEMP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function credentialFiles(authFile: string): string[] {
	return [authFile, ...SUBSCRIPTION_FILES.map((name) => path.join(/* turbopackIgnore: true */ path.dirname(authFile), name))];
}

function isCredentialTemp(absolute: string, directory: string, authBasename: string): boolean {
	const file = comparisonPath(absolute);
	if (path.relative(comparisonPath(directory), path.dirname(file)) !== "") return false;
	const name = path.basename(file);
	const prefix = `${authBasename}.tmp-`;
	return CREDENTIAL_TEMP.test(name) ||
		(name.toLowerCase().startsWith(prefix.toLowerCase()) && ATOMIC_TEMP_UUID.test(name.slice(prefix.length)));
}

/** Comprobación solo de strings, utilizable también con ubicaciones sintéticas de home/credenciales.
 *  La guarda en tiempo de ejecución de abajo resuelve además las fuentes y las raíces protegidas.
 *  Solo las credenciales son denegaciones privadas de la app: los datos de aprendizaje siguen siendo legibles. */
export function isSensitivePath(absolute: string, home: string = os.homedir(), authFile: string = AUTH_FILE): boolean {
	const file = comparisonPath(absolute);
	return ENV_FILE.test(path.basename(file)) ||
		SENSITIVE_HOME_PATHS.some((p) => isWithin(file, path.join(home, p), true)) ||
		credentialFiles(authFile).some((p) => isWithin(file, p)) ||
		isCredentialTemp(file, path.dirname(authFile), path.basename(comparisonPath(authFile)));
}

/** Una raíz protegida ajena inaccesible/rota no debe romper los apuntes
 *  normales. Su ubicación por nombre sigue denegada; los errores de realpath PROPIOS de una fuente
 *  siguen fallando en cerrado en checkedSourcePath, sin abrir nunca su alias sin comprobar. */
function protectedRealPath(absolute: string): string {
	try { return realOrMissing(absolute); } catch { return absolute; }
}

/** Expande las grafías reales de cada ubicación protegida de home, segmento a
 *  segmento. En un sistema de ficheros que distingue mayúsculas, .ssh y .SSH pueden existir AMBOS
 *  y llevar a destinos distintos; las denegaciones por nombre y canónicas deben coincidir.
 *  Solo lista los directorios padre de las ubicaciones fijas, nunca el contenido de ficheros.
 *  El argumento lector de directorios permite a las pruebas simular listados que distinguen mayúsculas
 *  en cualquier máquina, sin montar un volumen ni tocar rutas privadas reales. */
export function sensitiveHomeLocations(
	home: string,
	readDirectory: (directory: string) => readonly string[] = (directory) => fsSync.readdirSync(/* turbopackIgnore: true */ directory),
): string[] {
	const listings = new Map<string, readonly string[]>();
	const entries = (directory: string): readonly string[] => {
		if (!listings.has(directory)) {
			try { listings.set(directory, readDirectory(directory)); }
			catch { listings.set(directory, []); }
		}
		return listings.get(directory)!;
	};
	return SENSITIVE_HOME_PATHS.flatMap((location) => {
		let candidates = [home];
		for (const segment of location.split("/")) {
			candidates = candidates.flatMap((parent) => {
				const variants = entries(parent).filter((entry) => entry.toLowerCase() === segment.toLowerCase());
				return (variants.length ? variants : [segment]).map((name) => path.join(/* turbopackIgnore: true */ parent, name));
			});
		}
		return candidates;
	});
}

/** Una instantánea por resolución/recorrido, no por entrada visitada. Resuelve también las
 *  raíces protegidas: un directorio sensible o AUTH_FILE puede ser a su vez un enlace simbólico a
 *  una ubicación fuera de home. Nunca lee el contenido de credenciales ni los registros de la app. */
function sourcePathCheck(home = os.homedir()): (absolute: string) => boolean {
	const homeRoots = sensitiveHomeLocations(home).map(protectedRealPath);
	const files = credentialFiles(AUTH_FILE).map(protectedRealPath);
	const credentialDir = protectedRealPath(path.dirname(AUTH_FILE));
	return (absolute) => isSensitivePath(absolute, home) ||
		homeRoots.some((p) => isWithin(absolute, p, true)) ||
		files.some((p) => isWithin(absolute, p)) || isCredentialTemp(absolute, credentialDir, path.basename(comparisonPath(AUTH_FILE)));
}

function checkedSourcePath(absolute: string, denied: (absolute: string) => boolean): string {
	const refuse = () => {
		throw new Error(
			`Access denied: ${absolute} is a protected location. Learner file tools cannot open it. ` +
			"Do not paste credentials or private transcripts into chat. Use another source or a manually reviewed, non-sensitive excerpt.",
		);
	};
	if (denied(absolute)) refuse();
	const real = realOrMissing(absolute);
	if (denied(real)) refuse();
	return real;
}

/** Relativa/ausente → home; una ~ inicial se expande, ~usuario se queda literal. Devuelve
 *  la ubicación canónica COMPROBADA para la E/S, no un alias simbólico sin comprobar.
 *  Estas comprobaciones de rutas no protegen frente a un usuario hostil concurrente del SO. */
export function resolveSourcePath(p?: string, policy?: ResolvedFileAccessPolicy): string {
	const home = os.homedir();
	const resolved = !p ? home : p === "~" || p.startsWith("~/") || p.startsWith(`~${path.sep}`)
		? path.join(home, p.slice(1))
		: path.resolve(home, p);
	return guardSourcePath(checkedSourcePath(resolved, sourcePathCheck(home)), policy);
}

/** Las rutas explícitas conservan su significado de HOME. Solo un directorio omitido en
 * modo restringido selecciona la unión de las raíces disponibles, nunca home. */
export function sourceSearchRoots(p?: string, policy: ResolvedFileAccessPolicy = resolvePolicy()): { roots: string[]; notices: string[]; multiRoot: boolean } {
	if (p || !policy.restricted) return { roots: [resolveSourcePath(p, policy)], notices: [], multiRoot: false };
	const notices = policy.unavailable.length ? [`Skipped ${policy.unavailable.length} unavailable allowed folder(s). Check File access settings`] : [];
	const roots: string[] = [];
	let protectedRoots = 0;
	for (const folder of policy.folders) {
		try { roots.push(resolveSourcePath(folder, policy)); }
		catch { protectedRoots++; }
	}
	if (protectedRoots) notices.push(`Skipped ${protectedRoots} protected allowed folder(s); sensitive-location denials cannot be overridden`);
	if (!roots.length) throw new Error("Access denied: no accessible allowed folders. Add or repair folders in Settings → Agent → Tools → File access.");
	return { roots, notices, multiRoot: true };
}

/** El patrón formatSize de pi (50 KB se imprime como "50.0KB"). */
export function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** Limita la salida a MAX_OUTPUT_BYTES en líneas completas, el patrón truncateHead de pi. */
export function capOutput(lines: string[]): { content: string; truncated: boolean } {
	const out: string[] = [];
	for (const line of lines) {
		const candidate = [...out, line].join("\n");
		if (Buffer.byteLength(candidate, "utf-8") > MAX_OUTPUT_BYTES) {
			return { content: out.join("\n"), truncated: true };
		}
		out.push(line);
	}
	return { content: out.join("\n"), truncated: false };
}

/** Expande las alternativas entre llaves de primer nivel: '*.{ts,tsx}' → ['*.ts', '*.tsx'].
 *  Las llaves anidadas quedan fuera del alcance (el fd de pi las maneja; los modelos rara vez
 *  las emiten: una coincidencia literal sin expandir es el respaldo elegante). */
export function expandBraces(pattern: string): string[] {
	const open = pattern.indexOf("{");
	if (open === -1) return [pattern];
	const close = pattern.indexOf("}", open);
	if (close === -1) return [pattern];
	const before = pattern.slice(0, open);
	const after = pattern.slice(close + 1);
	const alts: string[] = [];
	for (const alt of pattern.slice(open + 1, close).split(",")) {
		alts.push(...expandBraces(before + alt + after));
	}
	return alts;
}

/** Glob → RegExp anclada. '*' se queda dentro de un segmento, '**' cruza '/',
 *  '?' es un carácter, todo lo demás es literal. */
export function globToRegex(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += "[\\s\\S]*";
				i++;
				if (glob[i + 1] === "/") i++; // '**/' también se come la barra
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else {
			re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re}$`);
}

/**
 * La regla de coincidencia de pi/fd: un patrón sin barra se compara con el
 * NOMBRE BASE a cualquier profundidad; uno con barra se compara con la ruta relativa, con
 * un prefijo implícito «doble asterisco-barra» salvo que esté anclado él mismo (ver
 * el código de abajo: la secuencia literal no puede aparecer en este comentario
 * porque cierra los comentarios de bloque).
 */
export function matchGlob(relativePath: string, pattern: string): boolean {
	const posix = relativePath.split(path.sep).join("/");
	const basename = posix.split("/").pop() ?? posix;
	for (const alt of expandBraces(pattern)) {
		if (!alt.includes("/")) {
			if (globToRegex(alt).test(basename)) return true;
		} else {
			let effective = alt;
			if (!effective.startsWith("/") && !effective.startsWith("**/") && effective !== "**") {
				effective = `**/${effective}`;
			}
			if (effective.startsWith("/")) effective = effective.slice(1);
			if (globToRegex(effective).test(posix)) return true;
		}
	}
	return false;
}

/**
 * Recorrido en profundidad bajo `root`, sin entrar nunca en EXCLUDED_DIR_NAMES ni en
 * ubicaciones sensibles (isSensitivePath).
 * `visit` recibe rutas absolutas de ficheros; devolver true DETIENE el recorrido
 * (el límite de resultados de find). El plazo acota un recorrido del directorio home a
 * WALK_TIMEOUT_MS: los resultados parciales son la degradación elegante.
 */
export async function walkFiles(
	root: string,
	visit: (filePath: string) => boolean | Promise<boolean>,
	signal?: AbortSignal,
	options: { policy?: ResolvedFileAccessPolicy; deadline?: number } = {},
): Promise<{ timedOut: boolean; aborted: boolean }> {
	const deadline = options.deadline ?? Date.now() + WALK_TIMEOUT_MS;
	let timedOut = false;
	let aborted = false;
	if (signal?.aborted) return { timedOut: false, aborted: true };
	const denied = sourcePathCheck();
	// Un llamador puede pasar un alias de home como raíz. Se parte de la raíz
	// real y se comparan los descendientes con las mismas raíces protegidas canónicas.
	const realRoot = guardSourcePath(checkedSourcePath(path.resolve(root), denied), options.policy);

	const walkDir = async (dir: string): Promise<boolean> => {
		if (Date.now() > deadline) {
			timedOut = true;
			return true; // detener
		}
		if (signal?.aborted) {
			aborted = true;
			return true; // detener: abortar da resultados parciales, no un throw
		}
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return false; // directorio ilegible (permisos): saltarlo y seguir recorriendo
		}
		for (const entry of entries) {
			if (Date.now() > deadline) {
				timedOut = true;
				return true;
			}
			if (signal?.aborted) {
				aborted = true;
				return true;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (EXCLUDED_DIR_NAMES.has(entry.name) || denied(full)) continue;
				if (await walkDir(full)) return true;
			} else if (entry.isFile()) {
				if (denied(full)) continue;
				if (await visit(full)) return true;
			}
			// enlaces simbólicos/otros: no se siguen (el fd de pi tampoco los sigue)
		}
		return false;
	};

	await walkDir(realRoot);
	return { timedOut, aborted };
}

/** True si el primer bloque de 8 KB contiene un byte NUL: el salto de binarios de pi/rg. */
export async function isBinaryFile(filePath: string): Promise<boolean> {
	const handle = await fs.open(filePath, "r");
	try {
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await handle.read(buf, 0, 8192, 0);
		return buf.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

/** El truncado de línea GREP_MAX_LINE_LENGTH de pi (sin cuidar las palabras, límite duro). */
export function truncateGrepLine(line: string): { text: string; wasTruncated: boolean } {
	if (line.length <= GREP_MAX_LINE_LENGTH) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}… [truncated]`, wasTruncated: true };
}
