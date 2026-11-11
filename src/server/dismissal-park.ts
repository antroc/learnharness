/**
 * DESCARTES APARCADOS (responsable, 2026-10-04): descarte con ESC mientras el
 * turno sigue trabajando. A mitad de turno el registro ALMACENADO no contiene
 * ninguna pregunta o problema pendiente (el turno no ha persistido: sus
 * mensajes llegan al asentarse), así que un descarte que llega ahora NO PUEDE
 * validarse; el comportamiento antiguo era un 409 rotundo, que dejaba al
 * alumno atrapado con una pregunta fantasma hasta que el turno moría (el
 * incidente del bucle de práctica de GLM: la única salida era matar el
 * servidor de desarrollo).
 *
 * El aparcamiento (decisión del responsable: "server-side park"): la ruta de
 * descarte, al encontrar un turno vivo, aparca la intención y responde 202; la
 * ruta de asentamiento del turno (onFinish de chat-handler, DESPUÉS de
 * persistTurn y ANTES de endTurn: la misma ley de orden por la que
 * turn-settled implica verdad duradera) la aplica contra el registro recién
 * persistido. La validación se hace al APLICAR, contra el estado real: si la
 * pregunta/problema descartado está de verdad pendiente ahí, el descarte se
 * aplica exactamente como lo habría escrito la ruta; si nunca llegó a existir
 * (la llamada dio error, el modelo volvió a plantearla y la respondió), el
 * aparcamiento se descarta en silencio: lo que descartó el usuario ya no existe.
 *
 * Vive en globalThis, NO en un Map a nivel de módulo: la misma disciplina de
 * instancias de módulo de Next.js que turn-liveness: la ruta de descarte y la
 * entrada de chat-handler deben ver el MISMO registro o el aparcamiento se
 * escribe en un mundo y se lee en otro. Efímero por diseño; un descarte
 * aparcado por chat (gana la última escritura: hay un dock y un descarte).
 */

import { ChatInputError, dismissAppends, emit } from "../core";
import { assertPluginQuestionInputAllowed } from "../core/input-events.ts";
import { preparePluginQuestionDismissal, type PluginQuestionDismissInput } from "./plugin-questions.ts";
import type { ChatStore } from "../core/ports.ts";

/** El cuerpo del descarte aparcado: exactamente la entrada analizada que
 *  aceptó la ruta de descarte ({type:"dismiss", toolCallId, answer} o
 *  {type:"dismiss-problem", problemCallId}). */
export type ParkedDismissal = unknown;

interface LhGlobal {
	__lhParkedDismissals?: Map<string, ParkedDismissal>;
}

function registry(): Map<string, ParkedDismissal> {
	const g = globalThis as typeof globalThis & LhGlobal;
	return (g.__lhParkedDismissals ??= new Map<string, ParkedDismissal>());
}

/** Aparca (o sobrescribe) la intención de descarte del chat. La llama la ruta
 *  de descarte cuando un turno controla el chat. */
export function parkDismissal(chatId: string, input: ParkedDismissal): void {
	registry().set(chatId, input);
}

/** Toma el descarte aparcado del chat (lo quita). Devuelve null si no hay
 *  nada aparcado. */
export function takeParkedDismissal(chatId: string): ParkedDismissal | null {
	const parked = registry().get(chatId);
	if (parked === undefined) return null;
	registry().delete(chatId);
	return parked;
}

/** Aplica el descarte aparcado del chat, si lo hay, contra el registro actual.
 *  Se ejecuta en el onFinish del turno, entre persistTurn y endTurn, para que
 *  un cliente que reacciona a "turn-settled" lea el descarte ya en el
 *  registro. La ruta de añadido es la propia de la ruta (dismissAppends); un
 *  ChatInputError significa que lo descartado nunca llegó a existir: el
 *  aparcamiento se descarta y el silencio es el resultado correcto. Emite
 *  "record-changed" exactamente cuando se escribió algo. */
export function applyParkedDismissal(chatStore: ChatStore, chatId: string): void {
	const input = takeParkedDismissal(chatId);
	if (input === null) return;
	const record = chatStore.getChat(chatId);
	if (!record) return;
	try {
		assertPluginQuestionInputAllowed(record.messages, input as { type: string });
		const appends = (input as { type?: string }).type === "dismiss-plugin-question"
			? preparePluginQuestionDismissal(record, input as PluginQuestionDismissInput)
			: dismissAppends(record, input as Parameters<typeof dismissAppends>[1]);
		// El asentamiento/descarte no ejecuta otra llamada al modelo. Los intercambios
		// laterales nuevos siguen pendientes hasta la barrera de presupuesto de contexto de esa llamada.
		chatStore.saveMessages(chatId, [...record.messages, ...appends]);
		emit("record-changed", { chatId });
	} catch (err) {
		if (err instanceof ChatInputError) return; // nunca llegó a existir: se descarta
		throw err;
	}
}
