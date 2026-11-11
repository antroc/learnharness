/**
 * ChatStore: el adaptador JSON de fs (un fichero por chat en data/chats/).
 *
 * Implementa el ChatStore de core/ports.ts; las formas de los registros viven en
 * core/contracts.ts (ChatRecord/ChatSummary). Patrones: fs síncrono, registros
 * diminutos, nombres de fichero protegidos por id, JSON con sangría de tabuladores. Se conecta en la
 * raíz de composición (src/server/stores.ts); nada más lo construye.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { ChatStore } from "../core/ports.ts";
import type { ChatRecord, ChatSettings, ChatSummary, ExtractionRunUsage, ImageSnapshot, PlanTree, SideChatThread, TurnUsage } from "../core/contracts.ts";
import { CURRENT_CHAT_VERSION } from "../core/contracts.ts";
import type { LhMessage } from "../core/native-messages.ts";
import { activeProblemOf, danglingQuestionOf } from "../core/native-messages.ts";
import { phaseAt3Lh } from "../core/phases.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

function chatFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
	return path.join(/* turbopackIgnore: true */ PATHS.chats, `${id}.json`);
}

/** LA LEY DEL SILENCIO (push S6, 2026-10-02): chats-changed anuncia SOLO las
 *  mutaciones de la FORMA de la lista: createChat, renameChat, deleteChat (más abajo,
 *  cada una emite después de escribir). Los escritores de contenido (saveMessages,
 *  appendTurnUsage, appendExtractionUsage, saveSettings, saveTree) son
 *  DELIBERADAMENTE SILENCIOSOS: saveMessages se dispara en cada persistencia de turno y
 *  saturaría el bus, y todo cambio visible en la lista que causa (título, orden,
 *  fase, busy, pendingQuestion) ya lo anuncian turn-started /
 *  turn-settled, con los que la barra lateral vuelve a pedir datos. Aquí el silencio es ley,
 *  no descuido. */
function createChat(title: string, kind?: "practice"): ChatRecord {
	const now = new Date().toISOString();
	const record: ChatRecord = {
		id: `chat_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: title.trim() || "Untitled session",
		createdAt: now,
		updatedAt: now,
		messages: [],
		// Las sesiones de práctica llevan el marcador; teach se queda AUSENTE (la ausencia
		// se interpreta como teach: los registros anteriores a la práctica nunca se migran).
		...(kind === "practice" ? { kind: "practice" as const } : {}),
	};
	fs.mkdirSync(PATHS.chats, { recursive: true });
	writeChat(record);
	emit("chats-changed", {});
	return { ...record, version: CURRENT_CHAT_VERSION }; // el gemelo en memoria de lo que llegó al disco
}

/** EL PUNTO DE PASO OBLIGADO DE LAS ESCRITURAS (oleada de versionado de esquemas, responsable 2026-10-10): toda
 *  persistencia de registro pasa por aquí y lleva el sello de versión ACTUAL:
 *  la migración perezosa implica que los ficheros existentes solo se sellan en su siguiente escritura.
 *  Una guarda frente a versiones futuras vive en el lado de lectura (getChat). */
function writeChat(record: ChatRecord): void {
	writeFileAtomicSync(chatFile(record.id), JSON.stringify({ ...record, version: CURRENT_CHAT_VERSION }, null, "\t"), { allowInPlaceFallback: true });
}

function getChat(id: string): ChatRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ chatFile(id), "utf-8"));
	} catch {
		return null;
	}
	// Rechazo honesto (decisión del responsable 2026-10-10): un registro sellado con una versión MÁS NUEVA que
	// este build (el escenario de volver a una versión anterior) se lee como ausente, nunca mal parseado:
	// la siguiente lectura-modificación-escritura no debe reescribir lo que no entiende.
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_CHAT_VERSION) {
		console.error(`[chat ${id}] record stamped with schema version ${v} > ${CURRENT_CHAT_VERSION} — this app build is older; refusing to read it`);
		return null;
	}
	return parsed as ChatRecord;
}

function listChats(): ChatSummary[] {
	try {
		fs.mkdirSync(PATHS.chats, { recursive: true });
		return fs
			.readdirSync(/* turbopackIgnore: true */ PATHS.chats)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getChat(f.slice(0, -5)))
			.filter((r): r is ChatRecord => r !== null)
			.map(({ messages, tree, turns, extractions, imageSnapshots: _imageSnapshots, sideChats: _sideChats, ...summary }) => {
				// Aislamiento por registro (Oleada B): un registro cuyos mensajes no pasan la
				// proyección (p. ej. borradores en formato UIMessage anteriores a la Oleada B: el
				// borrado sin compatibilidad hacia atrás los vuelve «corruptos») no debe dejar en blanco
				// toda la barra lateral: el mismo aislamiento que da el catch por fichero de getChat.
				try {
					return {
						// turns y extractions quedan fuera de la carga útil de la lista (lista =
						// resúmenes; los agregados de uso van en el registro completo, el selector
						// nunca los necesita).
						...summary,
						// Tipo normalizado: un campo ausente en el registro se interpreta como teach.
						kind: summary.kind ?? "teach",
						messageCount: messages.length,
						// Estado derivado del registro para el selector de sesiones: la fase sale de los
						// eventos explícitos del transcript (probe_done concluido / veredicto
						// aceptado: docs/archive/probe-teach-split.md §4), la pregunta pendiente
						// del recorrido nativo de llamadas colgadas. Oleada D: ambos pliegues leen
						// el registro NATIVO (phaseAt3Lh de core/phases.ts +
						// danglingQuestionOf de native-messages.ts). La vivacidad (busy) NO
						// se deriva del registro: la fusiona la ruta de la API (ChatListItem).
						phase: phaseAt3Lh(messages),
						pendingQuestion: danglingQuestionOf(messages) !== null,
						// Práctica: un problema planteado sin conclude (el "Problem waiting"
						// de la barra lateral); false en las sesiones de enseñanza, que
						// no tienen herramienta de problemas.
						pendingProblem: activeProblemOf(messages) !== null,
					};
				} catch (err) {
					console.error(`[chat ${summary.id}] summary projection failed:`, err);
					return null;
				}
			})
			.filter((s) => s !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** Persiste la lista completa de mensajes nativos (el registro ES el estado del agente:
 *  Oleada B: reproducir es state.messages = record.messages). SILENCIOSO según la
 *  ley de eventos: ver el comentario de LA LEY DEL SILENCIO en createChat. */
function saveMessages(id: string, messages: LhMessage[]): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	// Las marcas de agua de entrega lateral forman parte de las entradas nativas anexadas,
	// así que la entrada + las actualizaciones se confirman juntas sin mutar el historial del hilo.
	record.messages = messages;
	record.updatedAt = new Date().toISOString();
	writeChat(record);
}

/** Una lectura/fusión/escritura síncrona evita que las escrituras concurrentes del worker y del turno pierdan instantáneas. */
function saveImageSnapshot(id: string, snapshotId: string, image: ImageSnapshot): void {
	if (!/^[a-f0-9]{64}$/.test(snapshotId) || createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex") !== snapshotId) {
		throw new Error("Invalid image snapshot identity");
	}
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	if (record.imageSnapshots?.[snapshotId]) return;
	record.imageSnapshots = { ...record.imageSnapshots, [snapshotId]: {
		mimeType: image.mimeType, data: image.data, width: image.width, height: image.height,
	} };
	writeChat(record);
}

/** Anexa una entrada de uso al registro de turnos del registro, idempotente por
 * id de turno: cada PETICIÓN lleva su propio id, así que reproducir la persistencia del mismo turno
 * anexa una vez, mientras que los turnos de continuación (que comparten el id del mensaje
 *  de respuesta) conservan cada uno su uso. */
function appendTurnUsage(id: string, entry: TurnUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.turns = record.turns?.some((t) => t.id === entry.id)
		? record.turns
		: [...(record.turns ?? []), entry];
	writeChat(record);
}

/** Anexa una entrada de uso de ejecución de extracción al registro de extracciones del
 * registro, idempotente por startedAt: un reintento que llega dos veces al anexado
 * (reproducciones de aborto) no cuenta el gasto por duplicado. */
function appendExtractionUsage(id: string, entry: ExtractionRunUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.extractions = record.extractions?.some((r) => r.startedAt === entry.startedAt)
		? record.extractions
		: [...(record.extractions ?? []), entry];
	writeChat(record);
}

/** Persiste los ajustes de modelo/razonamiento por chat, sustituyéndolos enteros (el
 * selector envía el objeto completo; ausente = valores por defecto de la configuración). */
function saveSettings(id: string, settings: ChatSettings): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	// Como saveTree: un retoque de ajustes no es actividad de conversación, así que
	// deliberadamente NO actualiza updatedAt (el orden de la barra lateral no debe moverse).
	record.settings = settings;
	writeChat(record);
}

/** Renombra una sesión (el título editable con clic de la cabecera, 2026-09-17). Como
 * saveSettings, renombrar NO es actividad de conversación: updatedAt no cambia
 * para que el orden de la barra lateral nunca se mueva. El mismo respaldo que createChat: el string
 * vacío pasa a ser "Untitled session" (la barrera de la API lo rechaza antes; este
 * es el suelo honesto para cualquier otro llamador). */
function renameChat(id: string, title: string): ChatRecord {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.title = title.trim() || "Untitled session";
	writeChat(record);
	emit("chats-changed", {});
	return record;
}

/** Borra por completo el fichero de registro de la sesión (oleada 6 de borrado de sesiones,
 *  responsable 2026-09-22). False cuando el id es desconocido: la ruta lo convierte
 *  en un 404. Los rastros del registro en el grafo y sus tareas son la
 *  coreografía de la ruta (core/graph-deletion.ts), no del store. */
function deleteChat(id: string): boolean {
	try {
		fs.unlinkSync(chatFile(id));
		removeLeftoverTemps(chatFile(id));
		emit("chats-changed", {}); // solo una eliminación real: la ley de la entrada presente
		return true;
	} catch {
		return false; // nunca existió, ya borrado o ilegible: la misma respuesta
	}
}

/** Persiste el árbol del plan de la sesión (las herramientas de plan lo llaman en execute). */
function saveTree(id: string, tree: PlanTree): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.tree = tree;
	// Deliberadamente NO actualiza updatedAt: las mutaciones del árbol van a cuestas del
	// saveMessages del turno, y el orden de la barra lateral no debería moverse por ediciones del árbol.
	writeChat(record);
}

/** Hilos de preguntas laterales (2026-11-02): una única lectura-modificación-escritura síncrona,
 *  para que el saveMessages de un turno concurrente (que vuelve a leer el registro) nunca
 *  pierda un hilo y la escritura de un hilo nunca pierda mensajes. Null cuando el
 *  chat ya no existe (una respuesta lateral que termina tras borrar la sesión). Silencioso
 *  y no es actividad de conversación, como saveSettings. */
function updateSideChats(id: string, update: (threads: SideChatThread[]) => SideChatThread[]): SideChatThread[] | null {
	const record = getChat(id);
	if (!record) return null;
	const next = update(record.sideChats ?? []);
	if (next.length > 0) record.sideChats = next;
	else delete record.sideChats;
	writeChat(record);
	return next;
}

export const chatStore: ChatStore = {
	createChat,
	getChat,
	listChats,
	saveMessages,
	saveImageSnapshot,
	saveTree,
	saveSettings,
	renameChat,
	deleteChat,
	appendTurnUsage,
	appendExtractionUsage,
	updateSideChats,
};
