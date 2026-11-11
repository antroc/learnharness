import { abortExtraction, extractionStatuses } from "../agent/subagents/extraction.ts";
import { isJobLive } from "../agent/subagents/aborts.ts";
import { coverageOf } from "../core/coverage.ts";
import { deleteChatTraces, type ChatDeleteMode, type ChatDeletionStats } from "../core/graph-deletion.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { graphRevision } from "./graph.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { clearTurnFailure } from "./turn-runs.ts";
import { discardChatDeliveries } from "./jobs.ts";
import { sideChats } from "./side-chat.ts";

/**
 * Entradas de chat del servidor para la capa de transporte (app/api/chats*,
 * app/chat/[id]). Hoy delegan directamente en el puerto ChatStore; la fase de
 * servicios irá tallando la orquestación real detrás de esta misma superficie.
 *
 * deleteChatSession (oleada 6, borrado de sesiones: la PRIMERA operación
 * destructiva sobre los registros del grafo) es la única orquestación real de
 * aquí: barreras → cierre de la extracción → un único bloque síncrono de
 * borrado. Consulta core/graph-deletion.ts para la semántica de los registros
 * y el argumento de atomicidad.
 */

export const { createChat, getChat, listChats } = stores.chatStore;
export { titleFromPrompt };
export type { ChatDeleteMode, ChatDeletionStats } from "../core/graph-deletion.ts";

/** Cuánto puede durar la espera del cierre antes de que el llamante reciba un
 *  503 reintentable (una extracción cancelada termina en su siguiente frontera
 *  de llamada al modelo; la cancelación en el proveedor suele tardar menos de
 *  un segundo, pero un proveedor atascado nunca debe atascar el borrado). */
const WIND_DOWN_TIMEOUT_MS = 10_000;
const WIND_DOWN_POLL_MS = 50;

/** Lo que hizo deleteChatSession; la ruta lo traduce directamente a HTTP. */
export type ChatDeleteOutcome =
	| { ok: false; status: 404; code: "not_found"; error: string }
	| { ok: false; status: 409; code: "turn_in_flight" | "jobs_running"; error: string; jobIds: string[] }
	| { ok: false; status: 503; code: "extraction_winding_down"; error: string }
	| {
			ok: true;
			mode: ChatDeleteMode;
			stats: ChatDeletionStats;
			jobsRemoved: number;
			graphRevision: number;
	  };

/**
 * Borra una sesión (decisiones del responsable 2026-09-22/23): primero las
 * barreras y después la purga. La coreografía fijada por el responsable:
 *
 *   1. BARRERAS: un turno en curso o una tarea en segundo plano en ejecución
 *      se rechazan con 409 (escriben el registro del chat y lo reorientan;
 *      borrar a mitad corrompería el flujo de escritura anticipada). La
 *      interfaz reintenta cuando el trabajo termina.
 *   2. CIERRE DE LA EXTRACCIÓN: la ejecución del proceso del propio chat se
 *      CANCELA DE VERDAD (abortExtraction: el gasto se detiene, no se fusiona
 *      nada) y después se espera a que salga del registro. Un tiempo agotado
 *      es un 503 reintentable, nunca una carrera forzada.
 *   3. EL BLOQUE SÍNCRONO: todo lo de abajo se ejecuta sin un solo await:
 *      ningún añadido de extracción puede intercalarse (el bucle de eventos
 *      nunca cede a mitad del bloque), así que la lectura-filtrado-escritura
 *      de las reescrituras de los registros es atómica frente al proceso.
 *      Primero los registros del grafo, después las tareas y el registro del
 *      chat AL FINAL (una caída a mitad del bloque deja un chat borrable con
 *      el grafo purgado, que se arregla repitiendo el DELETE, nunca un chat
 *      borrado con rastros vivos). La protección de vida por lote del proceso
 *      (extraction.ts) cierra la última ventana: una ejecución que se coló
 *      tras el cierre encuentra el chat borrado al fusionar y se cancela sin
 *      fusionar nada.
 */
export function runningWorkBlocker(chatId: string): Extract<ChatDeleteOutcome, { status: 409 }> | null {
	if (isTurnRunning(chatId)) {
		return {
			ok: false,
			status: 409,
			code: "turn_in_flight",
			error: "A turn is running in this session — try again when it finishes",
			jobIds: [],
		};
	}
	// Los registros heredados mantenían en marcha los workers terminados hasta la entrega.
	// Un resultado guardado sin bucle vivo son datos de sesión pendientes, no trabajo en curso;
	// el borrado no debe depender de un sondeo de recuperación previo para reconocerlo.
	const runningJobs = stores.jobStore.listJobs(chatId).filter((job) =>
		job.status === "running" && (!job.result || isJobLive(job.id)));
	if (runningJobs.length > 0) {
		return {
			ok: false,
			status: 409,
			code: "jobs_running",
			error: "Background jobs are still running in this session — try again when they finish",
			jobIds: runningJobs.map((job) => job.id),
		};
	}
	return null;
}

export async function deleteChatSession(chatId: string, mode: ChatDeleteMode): Promise<ChatDeleteOutcome> {
	if (!stores.chatStore.getChat(chatId)) {
		return { ok: false, status: 404, code: "not_found", error: "No such session" };
	}
	const blocker = runningWorkBlocker(chatId);
	if (blocker) return blocker;
	if (extractionStatuses().some((run) => run.chatId === chatId)) {
		abortExtraction(chatId); // cancelación real: el gasto se detiene, no se fusiona nada
		const deadline = Date.now() + WIND_DOWN_TIMEOUT_MS;
		while (extractionStatuses().some((run) => run.chatId === chatId)) {
			if (Date.now() > deadline) {
				return {
					ok: false,
					status: 503,
					code: "extraction_winding_down",
					error: "The session's extraction is still winding down — try again in a moment",
				};
			}
			await new Promise((resolve) => setTimeout(resolve, WIND_DOWN_POLL_MS));
		}
	}

	// Puede haber arrancado un despertar de resultado o un worker durante el cierre de la
	// extracción. Se vuelve a comprobar justo antes de la purga síncrona, sin hueco de await.
	const lateBlocker = runningWorkBlocker(chatId);
	if (lateBlocker) return lateBlocker;

	return finishChatDeletion(chatId, mode);
}

/** El borrado de fuentes ya ha purgado los rastros del lote seleccionado en el grafo.
 * Se eliminan los datos restantes de la sesión con las mismas barreras/limpieza y sin await. */
export function deleteIdleChatRecord(chatId: string): Extract<ChatDeleteOutcome, { ok: false }> | { ok: true } {
	if (!stores.chatStore.getChat(chatId)) return { ok: false, status: 404, code: "not_found", error: "No such session" };
	const blocker = runningWorkBlocker(chatId);
	if (blocker) return blocker;
	if (extractionStatuses().some((run) => run.chatId === chatId)) return { ok: false, status: 503, code: "extraction_winding_down", error: "The session's extraction is still winding down — try again in a moment" };
	finishChatRecordDeletion(chatId);
	// ChatStore puede tragarse fallos de unlink. No se le dice al borrado de fuentes que
	// descarte la ubicación/carpetas mientras la conversación siga existiendo.
	if (stores.chatStore.getChat(chatId)) throw new Error("Could not remove the selected session record.");
	return { ok: true };
}

function finishChatDeletion(chatId: string, mode: ChatDeleteMode): Extract<ChatDeleteOutcome, { ok: true }> {
	// EL BLOQUE SÍNCRONO: sin awaits a partir de aquí (ver el comentario de documentación).
	// Orden: registros del grafo → tareas → registro del chat.
	const stats = deleteChatTraces(stores.graphStore, chatId, mode);
	const jobsRemoved = finishChatRecordDeletion(chatId);
	return { ok: true, mode, stats, jobsRemoved, graphRevision: graphRevision() };
}

function finishChatRecordDeletion(chatId: string): number {
	const jobsRemoved = stores.jobStore.deleteJobsForChat(chatId);
	if (stores.chatStore.deleteChat(chatId)) {
		discardChatDeliveries(chatId);
		clearTurnFailure(chatId);
		sideChats.stopAll(chatId); // una respuesta lateral en curso ya no tiene dónde aterrizar
	}
	return jobsRemoved;
}

/** Lectura de la cobertura de una sesión (rediseño de la UX de extracción,
 *  encargo del responsable 2026-09-24): los datos del medidor en anillo y del
 *  popover de la vista del chat, limitados a un chat (el GET de todas las
 *  sesiones desapareció con este rediseño: nada lo consumía una vez que la
 *  barra lateral y el anillo leen de aquí; el POST de Extract se queda). Lo
 *  no cubierto sigue siendo DERIVADO en cada petición (huella de la
 *  transcripción, diferencia con el registro de cobertura; nunca un doble
 *  seguimiento).
 *
 *  lastFoldedAt: la marca de tiempo de plegado de la fila de cobertura más
 *  reciente; una sola pasada barata por las filas del registro del chat (la
 *  línea «última extracción» del popover del anillo); null antes del primer
 *  plegado de la sesión. */
export interface SessionCoverage {
	totalMessages: number;
	coveredCount: number;
	uncoveredCount: number;
	coveredTokens: number;
	uncoveredTokens: number;
	/** True mientras haya una ejecución de extracción de tipo chat registrada para esta sesión. */
	running: boolean;
	/** ISO del plegado más reciente en las filas de cobertura de esta sesión; null antes de ninguno. */
	lastFoldedAt: string | null;
}

/** El bloque de cobertura por sesión (ver SessionCoverage). Null si el chat no
 *  existe; el 404 es cosa de los llamantes. */
export function sessionCoverage(chatId: string): SessionCoverage | null {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const entries = stores.graphStore.readCoverage();
	// Oleada B: el registro es historial nativo; la cobertura se lee a través de la
	// proyección (la misma vista que pliega el proceso de extracción).
	const cov = coverageOf(record.messages, entries, chatId);
	let lastFoldedAt: string | null = null;
	for (const entry of entries) {
		if (entry.chatId !== chatId) continue;
		if (lastFoldedAt === null || entry.foldedAt > lastFoldedAt) lastFoldedAt = entry.foldedAt;
	}
	return {
		totalMessages: cov.slots.length,
		coveredCount: cov.coveredCount,
		uncoveredCount: cov.uncoveredCount,
		coveredTokens: cov.coveredTokens,
		uncoveredTokens: cov.uncoveredTokens,
		running: extractionStatuses().some((run) => run.kind === "chat" && run.chatId === chatId),
		lastFoldedAt,
	};
}
