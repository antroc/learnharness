/**
 * GraphStore: el adaptador JSONL de fs: los registros de solo anexado en
 * config.LEDGER_FILES ("v1 emission" de contracts.ts).
 *   nodes.jsonl     GraphNode        — una línea por escritura de nodo: la PRIMERA
 *                                      línea de un id lo define; una línea
 *                                      posterior con un id REPETIDO es un
 *                                      anexado de enlace (las formulaciones de la sesión se suman a
 *                                      los alias, las procedencias se unen); las lecturas
 *                                      fusionan por id (getGraph de core/graph.ts)
 *   chains.jsonl    GraphChain       — una línea por AFIRMACIÓN de cadena (una segunda
 *                                      sesión que afirma las mismas
 *                                      (premisas, conclusión) anexa
 *                                      otra línea; los lectores fusionan)
 *   sessions.jsonl  SessionCheckpoint— puntos de control de emisión (foldedAt)
 *   coverage.jsonl  CoverageEntry    — cobertura de extracción por mensaje
 *
 * LAS CADENAS COMO FUENTE PRIMARIA (responsable, 2026-09-30): NO hay registro de aristas: la
 * vista de aristas (nodos de implicación + flechas sin tipo) se deriva en core/graph.ts en
 * cada lectura y nunca se persiste. Un edges.jsonl obsoleto dejado por un build anterior a las cadenas
 * se borra una vez, aquí, al cargar el adaptador (la misma doctrina que la
 * purga del registro de eventos de más abajo).
 *
 * Además config.SOURCES_FILE (sources.json): la contabilidad de las notas importadas
 * (NO un registro de solo anexado): un mapa JSON, src-id → NotesSource, de lectura-modificación-escritura
 * como un fichero de chat. La puerta de entrada agnóstica al formato (2026-09-13).
 *
 * Implementa el GraphStore de core/ports.ts. data/graph/* pertenece en exclusiva a este
 * adaptador. Las lecturas son estrictas con las formas de contracts.ts (el rediseño del grafo
 * del 2026-09-02): las líneas corruptas se saltan, nunca se adivinan: los registros
 * son la fuente de verdad y todo lo demás se deriva (core/graph.ts,
 * que recibe este puerto como parámetro). Los mismos patrones que src/store/chats.ts:
 * fs síncrono, sin framework.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { LEDGER_FILES, POSITIONS_FILE, SOURCES_FILE } from "../../config.ts";
import { assertGraphFormat, ensureGraphFormat } from "./graph-format.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";
import type {
	GraphChain,
	GraphNode,
	ExtractionRunUsage,
	NotesSource,
	Position,
	ProvenancePoint,
	CoverageEntry,
	SessionCheckpoint,
} from "../core/contracts.ts";
import type { GraphStore } from "../core/ports.ts";

// ─── Primitivas JSONL ─────────────────────────────────────────────────────────────

function appendLine<T>(file: string, record: T): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	ensureGraphFormat(); // el sello de formato perezoso (graph-format.ts)
	fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
}

function readRawLines(file: string): unknown[] {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return []; // aún no hay registro: nunca se ha emitido nada
	}
	const out: unknown[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(trimmed));
		} catch {
			// Línea corrupta: saltarla en lugar de hacer fallar toda la lectura: un anexado
			// a medias nunca debe tumbar con él el grafo de inicio.
		}
	}
	return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

const isString = (v: unknown): v is string => typeof v === "string";

/** Guardas de forma estrictas: todo lo que no encaje con una forma de registro W4 se salta. */
function readValid<T>(file: string, isValid: (v: unknown) => v is T): T[] {
	assertGraphFormat(); // rechazo honesto ante un directorio de datos sellado con una versión más nueva
	return readRawLines(file).filter(isValid);
}

/** Los puntos de procedencia son pares (chatId, messageId): granularidad de mensaje. */
const isProvenancePoint = (v: unknown): v is ProvenancePoint =>
	isRecord(v) && isString(v.chatId) && isString(v.messageId);


const isGraphNode = (v: unknown): v is GraphNode =>
	isRecord(v) &&
	isString(v.id) &&
	isString(v.name) &&
	isString(v.statement) &&
	Array.isArray(v.aliases) &&
	v.aliases.every(isString) &&
	isString(v.createdAt) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint);

/** Una línea de cadena: premisas ≥ 1 (una cadena ES un argumento: las proposiciones sueltas
 *  van solo en el registro de nodos), cada miembro un string, la conclusión un string.
 *  La EXISTENCIA de los extremos es asunto de la derivación (descarta las cadenas
 *  colgadas); el store solo da forma. */
const isGraphChain = (v: unknown): v is GraphChain =>
	isRecord(v) &&
	isString(v.id) &&
	Array.isArray(v.premises) &&
	v.premises.length > 0 &&
	v.premises.every(isString) &&
	isString(v.conclusion) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint) &&
	isString(v.createdAt);

const isCheckpoint = (v: unknown): v is SessionCheckpoint =>
	isRecord(v) && isString(v.chatId) && isString(v.foldedAt);

const isCoverageEntry = (v: unknown): v is CoverageEntry =>
	isRecord(v) && isString(v.chatId) && isString(v.fp) && typeof v.tokens === "number" && isString(v.foldedAt);

// ─── la implementación del puerto ─────────────────────────────────────────────────

export const graphStore: GraphStore = {
	appendNode(node: GraphNode): void {
		appendLine(LEDGER_FILES.nodes, node);
	},
	/** Líneas crudas de nodos en orden de anexado. Un id de nodo puede aparecer en más de
	 *  una línea (el anexado de ENLACE de una sesión posterior: formulaciones + procedencia); la
	 *  derivación (getGraph de core/graph.ts) fusiona las líneas por id. */
	readNodes(): GraphNode[] {
		return readValid(LEDGER_FILES.nodes, isGraphNode);
	},

	/** Anexa una AFIRMACIÓN de cadena; los lectores fusionan las líneas por (premisas,
	 *  conclusión). */
	appendChain(assertion: GraphChain): void {
		appendLine(LEDGER_FILES.chains, assertion);
	},
	readChains(): GraphChain[] {
		return readValid(LEDGER_FILES.chains, isGraphChain);
	},

	appendCheckpoint(checkpoint: SessionCheckpoint): void {
		appendLine(LEDGER_FILES.sessions, checkpoint);
	},
	readCheckpoints(): SessionCheckpoint[] {
		return readValid(LEDGER_FILES.sessions, isCheckpoint);
	},

	appendCoverage(entry: CoverageEntry): void {
		appendLine(LEDGER_FILES.coverage, entry);
	},
	readCoverage(): CoverageEntry[] {
		return readValid(LEDGER_FILES.coverage, isCoverageEntry);
	},

	// ── contabilidad de las notas importadas (config.SOURCES_FILE: un mapa JSON) ──

	/** Inserta o actualiza: conserva el registro de uso del registro existente al reimportar. */
	upsertSource(source: NotesSource): void {
		const all = readSourceMap();
		const prev = all[source.id];
		all[source.id] = prev ? { ...source, extractions: prev.extractions } : source;
		writeSourceMap(all);
	},
	readSources(): NotesSource[] {
		return Object.values(readSourceMap());
	},
	deleteSources(ids: ReadonlySet<string>): number {
		if (ids.size === 0) return 0;
		const all = readSourceMap();
		let removed = 0;
		for (const id of ids) if (Object.hasOwn(all, id)) { delete all[id]; removed++; }
		if (removed === 0) return 0;
		writeFileAtomicSync(SOURCES_FILE, JSON.stringify(all, null, "\t"));
		removeLeftoverTemps(SOURCES_FILE); // los restos de cierres inesperados seguirían conteniendo las fuentes borradas
		return removed;
	},
	/** Idempotente por startedAt: la misma disciplina que chats.appendExtractionUsage. */
	appendSourceUsage(id: string, entry: ExtractionRunUsage): void {
		const all = readSourceMap();
		const source = all[id];
		if (!source) return; // no existe esa fuente: no hay contra qué facturar
		source.extractions = source.extractions?.some((r) => r.startedAt === entry.startedAt)
			? source.extractions
			: [...(source.extractions ?? []), entry];
		writeSourceMap(all);
	},

	// ── el registro de la disposición (config.POSITIONS_FILE: un mapa JSON) ──
	readPositions(): Record<string, Position> {
		return readPositionMap();
	},
	writePositions(positions: Record<string, Position>): void {
		writePositionMap(positions);
	},

	/** LA FRONTERA DESTRUCTIVA (oleada 6, borrado de sesiones): sustitución atómica del contenido
	 *  completo de cada registro proporcionado (atomic-write.ts: un cierre inesperado a mitad de escritura
	 *  deja el registro original y ficheros .tmp-* huérfanos, nunca un registro
	 *  a medias). Los arrays vacíos escriben un fichero vacío: un registro purgado se lee
	 *  como «aún nada», igual que uno nunca emitido. */
	rewriteLedgers(next: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void {
		const files = {
			nodes: LEDGER_FILES.nodes,
			chains: LEDGER_FILES.chains,
			coverage: LEDGER_FILES.coverage,
			checkpoints: LEDGER_FILES.sessions,
		} as const;
		for (const [key, records] of Object.entries(next) as [keyof typeof files, unknown[]][]) {
			const file = files[key];
			fs.mkdirSync(path.dirname(file), { recursive: true });
			// JSONL: un registro por línea, con salto de línea final: el lector
			// debe ver exactamente lo que habría escrito appendLine.
			const body = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
			writeFileAtomicSync(file, body);
			removeLeftoverTemps(file); // los restos de cierres inesperados seguirían conteniendo los registros purgados
		}
	},
};

/** positions.json: { positions, updatedAt }. De lectura-modificación-escritura, NO
 *  de solo anexado: el settle es un cálculo sobre todo el grafo, así que sustituye
 *  el mapa entero. El sello updatedAt existe para la futura gestión de conflictos de física
 *  en vivo (una confirmación del navegador debe poder detectar que «el grafo cambió
 *  por debajo de mí»); las lecturas solo devuelven el mapa. */
function readPositionMap(): Record<string, Position> {
	let raw: string;
	try {
		raw = fs.readFileSync(POSITIONS_FILE, "utf-8");
	} catch {
		return {}; // aún no hay registro: nunca se ha asentado nada
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed) || !isRecord(parsed.positions)) return {};
		const out: Record<string, Position> = {};
		for (const [id, value] of Object.entries(parsed.positions)) {
			if (isPosition(value)) out[id] = { x: value.x, y: value.y };
		}
		return out;
	} catch {
		return {};
	}
}

function writePositionMap(positions: Record<string, Position>): void {
	fs.mkdirSync(path.dirname(POSITIONS_FILE), { recursive: true });
	writeFileAtomicSync(POSITIONS_FILE, JSON.stringify({ positions, updatedAt: new Date().toISOString() }, null, "\t"));
}

const isPosition = (v: unknown): v is Position =>
	isRecord(v) && typeof v.x === "number" && Number.isFinite(v.x) && typeof v.y === "number" && Number.isFinite(v.y);

/** sources.json: { id: NotesSource }. De lectura-modificación-escritura, NO de solo anexado:
 *  el registro de uso vive dentro del registro (como el fichero JSON de un chat). */
function readSourceMap(): Record<string, NotesSource> {
	assertGraphFormat(); // rechazo honesto ante un directorio de datos sellado con una versión más nueva
	let raw: string;
	try {
		raw = fs.readFileSync(SOURCES_FILE, "utf-8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const out: Record<string, NotesSource> = {};
		for (const [id, value] of Object.entries(parsed)) {
			if (isNotesSource(value)) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

function writeSourceMap(map: Record<string, NotesSource>): void {
	fs.mkdirSync(path.dirname(SOURCES_FILE), { recursive: true });
	ensureGraphFormat(); // el sello de formato perezoso (graph-format.ts)
	writeFileAtomicSync(SOURCES_FILE, JSON.stringify(map, null, "\t"), { allowInPlaceFallback: true });
}

// ─── purgas de un solo sentido al cargar el adaptador: los registros muertos son justo la confusión
// que elimina la limpieza (doctrina del responsable: nada los lee, nada los escribe,
// un fichero obsoleto por ahí es una mentira). ─────────────────────────────────────
{
	const graphDir = path.dirname(LEDGER_FILES.nodes);
	for (const legacy of ["edges.jsonl", "events.jsonl"]) {
		// Los registros de usuario en tiempo de ejecución no son recursos para la traza de build de la instrumentación.
		const file = path.join(/* turbopackIgnore: true */ graphDir, legacy);
		try {
			if (fs.existsSync(/* turbopackIgnore: true */ file)) {
				fs.rmSync(file);
				console.info(`[graph-store] purged legacy ledger: ${file}`);
			}
		} catch (err) {
			console.warn(`[graph-store] could not purge legacy ledger ${file}:`, err);
		}
	}
}

const isNotesSource = (v: unknown): v is NotesSource =>
	isRecord(v) && isString(v.id) && isString(v.filePath) && isString(v.importedAt);
