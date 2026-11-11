/**
 * Los servicios del turno de chat: una frontera con nombre por cada
 * responsabilidad del turno, extraídas de chat-handler para que componga en
 * lugar de implementar. Cada uno recibe sus dependencias de forma explícita
 * (puertos de almacenamiento, el ejecutor de tareas); ningún módulo de aquí
 * importa un adaptador.
 *
 *   persistTurn        — la escritura canónica del estado (oleada B:
 *                        historial nativo; sellado de ids, filtrado de
 *                        marcadores provisionales, emisión de bloques de plan,
 *                        persistencia parcial al cancelar)
 *   triggerExtraction  — el canal de escritura del grafo: dispara el proceso
 *                        de extracción (el único que escribe en el grafo) en
 *                        cuanto un chat cruza el umbral de presupuesto de tokens.
 *
 * Los registros son la base mínima de observabilidad: una línea por fallo,
 * etiquetada [chat <id>]; el registro estructurado llegará más adelante tras
 * estas fronteras.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { LhMessage } from "../core/native-messages.ts";
import { newMessageId } from "../core/native-messages.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";
import { planBlocksFor } from "../core/plan-blocks.ts";
import { coverageOf } from "../core/coverage.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import type { ExtractionPipeline } from "../agent/subagents/extraction.ts";
import { ModelsNotConfiguredError, ProviderKeyMissingError } from "../core/settings.ts";

/** Distingue un guardado canónico fallido de los fallos posteriores de contabilidad. */
export class TurnPersistenceError extends Error {
	constructor(cause: unknown) {
		super("The reply could not be saved.", { cause });
		this.name = "TurnPersistenceError";
	}
}

/**
 * La escritura canónica del estado (oleada B, aprobada por el responsable
 * 2026-09-26): añade los propios mensajes del turno, el historial nativo del
 * bucle del agente, con proveedor/modelo/uso/thinkingSignature sellados por el
 * propio pi. Persiste incluso si se cancela: la transcripción parcial
 * (incluida la llamada sin responder de una pregunta pendiente) es lo que hace
 * que funcione la reanudación.
 *
 * - Sellado de ids: los mensajes de pi no llevan id; la identidad del registro
 *   necesita uno por mensaje (claves del cliente, adopción de solo añadido, la
 *   frontera de continuación). Se acuñan aquí, en la única escritura canónica.
 * - Filtrado de marcadores provisionales: el resultado sintético
 *   "question posed" de una pregunta planteada sin errores es un mecanismo del
 *   bucle en memoria (el terminate de la oleada A); NUNCA se persiste
 *   (bifurcación 1: el registro termina en la llamada sin responder; la
 *   respuesta del alumno llega como el resultado real de la herramienta). Las
 *   llamadas de pregunta con error SÍ se persisten: son el contexto de
 *   reintento del modelo.
 * - Bloques de plan: una instantánea congelada por cada llamada plan_init con
 *   éxito, idempotente (repetir la persistencia es seguro).
 *
 * Devuelve los mensajes nuevos sellados (la procedencia del uso los lee).
 * Lanza TurnPersistenceError si falla, para que el ejecutor pueda informar de
 * ello antes de DONE.
 */
export function persistTurn(
	chatStore: ChatStore,
	chatId: string,
	baseCount: number,
	turnMessages: readonly AgentMessage[],
	isAborted: boolean,
): LhMessage[] {
	try {
		const record = chatStore.getChat(chatId);
		if (!record) throw new Error(`Chat not found: ${chatId}`);
		const stamped: LhMessage[] = [];
		for (const m of turnMessages.slice(baseCount)) {
			const message = m as LhMessage;
			// El resultado provisional de la pregunta: un mecanismo del bucle, nunca un hecho del registro.
			if (
				(message as { role?: string }).role === "toolResult" &&
				(QUESTION_TOOLS as readonly string[]).includes((message as ToolResultMessage).toolName) &&
				!(message as ToolResultMessage).isError
			) {
				continue;
			}
			stamped.push(message.id ? message : ({ ...message, id: newMessageId() } as LhMessage));
		}
		const tree = record.tree;
		const blocks = planBlocksFor(record.messages, stamped, tree, [
			...record.messages,
			...stamped,
		]);
		chatStore.saveMessages(chatId, [...record.messages, ...stamped, ...blocks]);
		return stamped;
	} catch (err) {
		console.error(`[chat ${chatId}] persist failed:`, err, { isAborted });
		throw new TurnPersistenceError(err);
	}
}

/**
 * El canal de escritura del grafo (construcción de la visión §1): el proceso
 * de extracción (extractor → auditor → fusionador, el único que escribe en el
 * grafo) se ejecuta de forma ASÍNCRONA en cuanto los tokens NO CUBIERTOS de la
 * transcripción de un chat alcanzan el presupuesto de fragmentos
 * (vision-extraction-coverage.md, 2026-09-15). La cobertura se lee a través de
 * la proyección (el registro es historial nativo; la vista de extracción
 * mantiene la forma del cliente hasta la oleada D). Disparar y olvidar: nunca
 * bloquea el turno; el proceso registra los fallos y deja la cobertura
 * intacta, así que el siguiente disparo (o el botón manual de extraer) vuelve
 * a ejecutar lo que falte.
 *
 * Aislado a propósito en esta única frontera: el proceso no depende del
 * disparador. Se omite en las pruebas: los chats con guion son fixtures, no
 * conocimiento (el proceso en sí se prueba directamente con modelos simulados).
 */
export function triggerExtraction(
	deps: { chatStore: ChatStore; graphStore: GraphStore },
	extraction: ExtractionPipeline,
	chatId: string,
	chunkTokens: number,
): void {
	if (process.env.NODE_ENV === "test") return;
	try {
		const record = deps.chatStore.getChat(chatId);
		if (!record) return;
		const covered = coverageOf(record.messages, deps.graphStore.readCoverage(), chatId);
		if (covered.uncoveredTokens < chunkTokens) return;
		void extraction.runExtraction(chatId).catch((err) => {
			// BYOK (responsable, 2026-09-22) + presencia de clave (interludio de claves de proveedor,
			// 2026-09-25): un canal de escritura sin configurar O sin clave SE OMITE (el registro de
			// cobertura mantiene los mensajes sin cubrir; el siguiente disparo reintenta cuando haya
			// ranuras/claves); solo se registran los fallos reales.
			if (err instanceof ModelsNotConfiguredError) {
				console.info(`[chat ${chatId}] extraction skipped — ${err.envelope.error} (missing: ${err.envelope.missing.join(", ")})`);
				return;
			}
			if (err instanceof ProviderKeyMissingError) {
				console.info(`[chat ${chatId}] extraction skipped — ${err.envelope.error} (provider: ${err.envelope.provider})`);
				return;
			}
			console.error(`[chat ${chatId}] extraction pipeline failed:`, err);
		});
	} catch (err) {
		console.error(`[chat ${chatId}] extraction trigger failed:`, err);
	}
}
