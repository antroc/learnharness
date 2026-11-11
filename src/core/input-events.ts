/**
 * EL CONTRATO DE INPUT-EVENTS (oleada B, decisión del responsable del
 * 2026-09-26: «eventos de entrada ya, en la misma pasada»): POST /api/chat
 * lleva `{chatId, input}` — UN evento explícito, nunca una transcripción del
 * cliente. El servidor es el dueño del registro; un envío le dice lo que HA
 * OCURRIDO, no cómo es la lista del cliente. El reintento de fusión con 409
 * murió con el cuerpo de lista completa (un evento de entrada se reintenta de
 * forma idempotente: no se añadió nada cuando se rechaza un POST).
 *
 * Los cuatro eventos (la taxonomía completa de entradas originadas en el cliente):
 *   text    — un mensaje de usuario escrito por el alumno (envío del
 *             compositor, tema inicial, el bucle de corrección de errores de
 *             la demo)
 *   answer  — el resultado calificado de la pregunta pendiente
 *             (QuestionAnswerData, construido en el cliente exactamente como
 *             hoy; un descarte es una respuesta que lleva su marca). En el
 *             servidor se convierte en el resultado de herramienta nativo de
 *             la llamada — el historial normal del agente de la bifurcación 1.
 *   continue — ejecuta el siguiente turno sobre el registro actual
 *             (continuaciones al montar, resincronizaciones al asentarse una
 *             tarea: el registro termina en una pregunta respondida aún sin
 *             reacción del profesor).
 *   retry   — reintenta una respuesta fallida del modelo (issue #110), sin
 *             entrada nueva. Los intentos fallidos se quedan en el registro;
 *             solo el historial temporal del agente del reintento omite los
 *             fallos finales.
 *
 * (La entrada del veredicto del plan murió el 2026-09-26 junto con el propio
 * veredicto — la respuesta del alumno tras el plan es un mensaje de texto
 * normal.)
 *
 * La entrega originada en el servidor (las reorientaciones del proceso de
 * despertar) NO es una entrada del cliente — el manejador la acepta por el
 * mismo camino (TurnInput) para que todos los turnos sigan una misma
 * composición.
 */

import type { QuestionAnswerData } from "./question-core.ts";
import type { ImageContent } from "@earendil-works/pi-ai";
import { validatePluginSubmissionImageArray, validatePluginSubmissionImages, type PluginSubmissionImages, type PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import type { LhMessage } from "./native-messages.ts";
import {
	activeProblemOf,
	activeProblemOccurrenceOf,
	concludedByDismissalPair,
	isSideQuestionMarker,
	danglingQuestionOf,
	newAnswerResult,
	newNextMessage,
	newProblemDismissedMarker,
	newThinkingMessage,
	newUserMessage,
	newMessageId,
	questionCallsOf,
	pluginQuestionCallsOf,
	pendingProblemDismissalOf,
} from "./native-messages.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "./pending.ts";
import { isPluginQuestionJson, type JsonValue, type PluginQuestionOccurrence } from "./plugin-questions.ts";
import { preparePluginProblemSubmissionImages, type PluginProblemSubmissionImages } from "./plugin-submissions.ts";

export type PluginQuestionAnswerInput = { type: "plugin-question-answer"; questionId: string; occurrence: PluginQuestionOccurrence; answer: JsonValue; thinking?: string; readingThinking?: string; images?: PluginSubmissionImages };
export type PluginProblemSubmissionInput = { type: "plugin-problem-submission"; problemId: string; occurrence: PluginSubmissionOccurrence; submission: JsonValue; thinking?: string; images?: PluginProblemSubmissionImages };
export type DismissPluginQuestionInput = { type: "dismiss-plugin-question"; questionId?: string; occurrence: PluginQuestionOccurrence };

/** Un evento de entrada originado en el cliente (el `input` del cuerpo del POST). */
export type ChatInput =
	| PluginQuestionAnswerInput
	| PluginProblemSubmissionInput
	| { type: "text"; text: string; images?: ImageContent[] }
	| { type: "answer"; toolCallId: string; answer: QuestionAnswerData; occurrence?: PluginSubmissionOccurrence }
	| { type: "continue" }
	/** El reintento del turno fallido (issue #110): el botón Reintentar del aviso. */
	| { type: "retry" }
	/** Sustitución explícita del lote de preguntas actual mal formado. */
	| { type: "retry-question"; messageId: string; contentIndex: number; toolCallId: string }
	/** Los dos botones del dock de práctica (responsable, 2026-10-04): el
	 *  razonamiento del alumno sobre el problema ACTIVO — un único carril
	 *  (responsable 2026-10-05): si afirma tener una respuesta se lee del texto.
	 *  Un problema puede llevar muchos envíos; cada uno es su propio turno. */
	| { type: "thinking"; problemCallId: string; text: string; images?: ImageContent[]; occurrence?: PluginSubmissionOccurrence }
	/** La señal de avanzar de la práctica (ronda 16 del responsable): la
	 *  aprobación explícita del alumno durante la pausa entre problemas — el
	 *  chip Next o Enter con el compositor vacío. Solo en sesiones de práctica,
	 *  y solo sin nada activo (la entrada a mitad de problema va por el dock). */
	| { type: "next" };

/** Una entrega de reorientación del proceso de despertar — misma composición
 *  de turno, origen en el servidor. Oleada C (2026-09-26): el despertar en
 *  reposo lleva TODOS los marcadores encolados como añadidos de su entrada —
 *  eliminado claimSteers, el despertar de la bomba es el único que queda que
 *  añade reorientaciones (el camino dentro de la ejecución entrega los
 *  marcadores a la propia cola de seguimiento de pi, así que nunca construye
 *  un evento de entrada). */
export type SteerInput = { type: "steers"; steers: LhMessage[] };

/** Todas las entradas que acepta la composición del turno. */
export type TurnInput = ChatInput | SteerInput;

/** El evento de descarte (diseño del responsable del 2026-10-03, «A2»):
 *  NUNCA compone un turno — la ruta silenciosa añade + persiste y no
 *  despierta nada. La respuesta viaja en el evento (como en el evento de
 *  respuesta) pero de verdad debe SER un descarte: el camino silencioso nunca
 *  debe inyectar una respuesta real sin despertar. Las llamadas de pregunta
 *  en paralelo reciben cada una su propio evento de descarte; los resultados
 *  referencian sus llamadas por id, así que los añadidos siguen siendo
 *  independientes. */
export type DismissInput =
	| DismissPluginQuestionInput
	| { type: "dismiss"; toolCallId: string; answer: QuestionAnswerData }
	/** El descarte de problemas (práctica, responsable 2026-10-04): al estilo de
	 *  ask — la ruta silenciosa añade el marcador solo de interfaz y no
	 *  despierta nada; el par de conclusión viaja con la SIGUIENTE entrada del
	 *  usuario (inputAppends). */
	| { type: "dismiss-problem"; problemCallId: string };

/** Analiza y valida un evento de descarte a partir del cuerpo de una petición. */
export function parseDismissInput(input: unknown): DismissInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type === "dismiss-plugin-question") {
		if (i.questionId !== undefined && (typeof i.questionId !== "string" || !i.questionId)) throw new ChatInputError("dismiss-plugin-question requires a valid questionId");
		return { type: "dismiss-plugin-question", ...(i.questionId !== undefined ? { questionId: i.questionId as string } : {}), occurrence: parsePluginQuestionOccurrence(i.occurrence) };
	}
	if (i.type === "dismiss-problem") {
		if (typeof i.problemCallId !== "string" || i.problemCallId.length === 0) {
			throw new ChatInputError("dismiss-problem input requires problemCallId");
		}
		return { type: "dismiss-problem", problemCallId: i.problemCallId };
	}
	if (i.type !== "dismiss") throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
		throw new ChatInputError("dismiss input requires toolCallId");
	}
	const answer = i.answer as QuestionAnswerData | undefined;
	if (typeof answer !== "object" || answer === null) {
		throw new ChatInputError("dismiss input requires the dismissal answer object");
	}
	if (answer.dismissed !== true) {
		throw new ChatInputError("dismiss input's answer must be a dismissal (dismissed: true)");
	}
	return { type: "dismiss", toolCallId: i.toolCallId, answer };
}

/** Una reorientación a mitad de turno (arco del responsable, 2026-10-03): el
 *  mensaje del compositor del alumno para un turno EN CURSO — encolado en el
 *  carril de reorientación de pi (agent.steer, que se vacía en el siguiente
 *  límite de respuesta DENTRO de la misma ejecución). NO es un seguimiento:
 *  nunca prolonga una ejecución terminada y nunca compone un turno propio (un
 *  envío sin turno vivo es un envío de texto normal, que ya existe). El id lo
 *  acuña el cliente (steer_<localid>): el indicador de encolado se identifica
 *  por él, y los eventos de mensaje del vaciado actualizan la tarjeta real
 *  con el mismo id. */
export type UserSteerInput = { type: "steer"; id: string; text: string; images?: ImageContent[] };

/** Analiza y valida un evento de reorientación a partir del cuerpo de una petición. */
export function parseUserSteerInput(input: unknown): UserSteerInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type !== "steer") throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	if (typeof i.id !== "string" || i.id.length === 0) {
		throw new ChatInputError("steer input requires a client-minted id");
	}
	const images = parseImages(i.images);
	if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
		throw new ChatInputError("steer input requires non-empty text or images");
	}
	return { type: "steer", id: i.id, text: i.text, ...(images ? { images } : {}) };
}

/** Los añadidos nativos que hace un descarte (puro — la misma disciplina
 *  contra huérfanos que las respuestas: la llamada debe ser una llamada de
 *  pregunta COLGANTE o — la variante de práctica — el problema ACTIVO). */
export function dismissAppends(record: { messages: LhMessage[] }, input: DismissInput): LhMessage[] {
	assertPluginQuestionInputAllowed(record.messages, input);
	if (input.type === "dismiss-plugin-question") throw new ChatInputError("Plugin question dismissal requires canonical server validation");
	if (input.type === "dismiss-problem") {
		const active = activeProblemOf(record.messages);
		if (!active || active.toolCallId !== input.problemCallId) {
			throw new ChatInputError("dismiss-problem input targets no active problem");
		}
		return [newProblemDismissedMarker(input.problemCallId)];
	}
	const pending = danglingQuestionOf(record.messages);
	if (!pending || pending.toolCallId !== input.toolCallId) {
		throw new ChatInputError("dismiss input targets no pending question call");
	}
	if (input.answer.kind !== toolQuestionKind(pending.tool)) {
		throw new ChatInputError("dismiss input's answer kind does not match the question");
	}
	return [newAnswerResult(input.toolCallId, pending.tool, input.answer)];
}

/** Un evento de entrada mal formado (el 400 honesto — la disciplina de la trampa de huérfanos). */
export class ChatInputError extends Error {}

/** Solo barrera de preguntas nuevas: la semántica/ajustes integrados no
 * cambian. Llámala antes de los efectos y otra vez contra la verdad guardada.
 * Las peticiones del protocolo nuevo siguen exigiendo la validación canónica
 * del servidor; esta protección no es validación de respuestas. */
export function assertPluginQuestionInputAllowed(messages: readonly LhMessage[], input: unknown): void {
	const type = input && typeof input === "object" ? (input as { type?: unknown }).type : undefined;
	if (type === "plugin-question-answer" || type === "dismiss-plugin-question") return;
	if (pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable")) {
		throw new ChatInputError("Answer or dismiss the pending plugin question first");
	}
}

function parsePluginQuestionOccurrence(value: unknown): PluginQuestionOccurrence {
	if (!value || typeof value !== "object") throw new ChatInputError("Plugin question input requires an exact occurrence");
	const o = value as Record<string, unknown>;
	if (typeof o.messageId !== "string" || !o.messageId || typeof o.toolCallId !== "string" || !o.toolCallId || typeof o.toolName !== "string" || !o.toolName || typeof o.contentIndex !== "number" || !Number.isSafeInteger(o.contentIndex) || o.contentIndex < 0) throw new ChatInputError("Plugin question input requires an exact occurrence");
	return { messageId: o.messageId, contentIndex: o.contentIndex, toolCallId: o.toolCallId, toolName: o.toolName };
}

function parseImages(value: unknown): ImageContent[] | undefined {
	if (value === undefined) return undefined;
	try {
		const images = validatePluginSubmissionImageArray(value);
		return images.length ? images : undefined;
	} catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submission images"); }
}
function parseImageChannels(value: unknown): PluginSubmissionImages | undefined {
	if (value === undefined) return undefined;
	try {
		const images = validatePluginSubmissionImages(value);
		return Object.keys(images).length ? images : undefined;
	} catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submission image channels"); }
}
function parseOptionalOccurrence(value: unknown, images: unknown): PluginSubmissionOccurrence | undefined {
	if (value !== undefined) return parsePluginQuestionOccurrence(value);
	if (images) throw new ChatInputError("Image-bearing submissions require an exact occurrence");
	return undefined;
}

/** Analiza y valida un evento de entrada a partir del cuerpo de una petición. */
export function parseChatInput(input: unknown): ChatInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	switch (i.type) {
		case "plugin-problem-submission": {
			if (typeof i.problemId !== "string" || !i.problemId) throw new ChatInputError("plugin-problem-submission requires problemId");
			if (!isPluginQuestionJson(i.submission)) throw new ChatInputError("plugin-problem-submission requires finite JSON submission");
			if (i.thinking !== undefined && typeof i.thinking !== "string") throw new ChatInputError("Problem thinking must be text");
			let images;
			try { images = i.images === undefined ? undefined : preparePluginProblemSubmissionImages(i.images); }
			catch { throw new ChatInputError("Invalid problem submission images"); }
			return { type: "plugin-problem-submission", problemId: i.problemId, occurrence: parsePluginQuestionOccurrence(i.occurrence), submission: i.submission, ...(i.thinking !== undefined ? { thinking: i.thinking as string } : {}), ...(images ? { images } : {}) };
		}
		case "plugin-question-answer": {
			if (typeof i.questionId !== "string" || !i.questionId) throw new ChatInputError("plugin-question-answer requires questionId");
			if (!isPluginQuestionJson(i.answer)) throw new ChatInputError("plugin-question-answer requires finite JSON answer");
			if ((i.thinking !== undefined && typeof i.thinking !== "string") || (i.readingThinking !== undefined && typeof i.readingThinking !== "string")) throw new ChatInputError("Plugin question thinking must be text");
			const images = parseImageChannels(i.images);
			return { type: "plugin-question-answer", questionId: i.questionId, occurrence: parsePluginQuestionOccurrence(i.occurrence), answer: i.answer, ...(i.thinking !== undefined ? { thinking: i.thinking as string } : {}), ...(i.readingThinking !== undefined ? { readingThinking: i.readingThinking as string } : {}), ...(images ? { images } : {}) };
		}
		case "text": {
			const images = parseImages(i.images);
			if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
				throw new ChatInputError("text input requires non-empty text or images");
			}
			return { type: "text", text: i.text, ...(images ? { images } : {}) };
		}
		case "answer": {
			if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
				throw new ChatInputError("answer input requires toolCallId");
			}
			if (typeof i.answer !== "object" || i.answer === null) {
				throw new ChatInputError("answer input requires the graded answer object");
			}
			const answer = i.answer as QuestionAnswerData;
			const images = parseImageChannels(answer.images);
			const occurrence = parseOptionalOccurrence(i.occurrence, images);
			const { images: _images, ...fields } = answer;
			return { type: "answer", toolCallId: i.toolCallId, answer: { ...fields, ...(images ? { images } : {}) }, ...(occurrence ? { occurrence } : {}) };
		}
		case "continue":
			return { type: "continue" };
		case "retry":
			return { type: "retry" };
		case "retry-question":
			if (typeof i.messageId !== "string" || !i.messageId || typeof i.toolCallId !== "string" || !i.toolCallId ||
				typeof i.contentIndex !== "number" || !Number.isSafeInteger(i.contentIndex) || i.contentIndex < 0) {
				throw new ChatInputError("retry-question input requires an exact question occurrence");
			}
			return { type: "retry-question", messageId: i.messageId, contentIndex: i.contentIndex, toolCallId: i.toolCallId };
		case "thinking": {
			if (typeof i.problemCallId !== "string" || i.problemCallId.length === 0) {
				throw new ChatInputError("thinking input requires problemCallId");
			}
			const images = parseImages(i.images);
			const occurrence = parseOptionalOccurrence(i.occurrence, images);
			if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
				throw new ChatInputError("thinking input requires non-empty text or images");
			}
			return { type: "thinking", problemCallId: i.problemCallId, text: i.text, ...(images ? { images } : {}), ...(occurrence ? { occurrence } : {}) };
		}
		case "next":
			return { type: "next" };
		default:
			throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	}
}

/**
 * Los añadidos nativos que hace un evento de entrada al registro (puro).
 * Quien llama los persiste por adelantado; el contexto del agente es el
 * registro más estos.
 *
 * La validación de respuestas es la disciplina del 400 por huérfano: la
 * llamada debe ser una llamada de PREGUNTA COLGANTE en el registro (planteada
 * y nunca respondida) — cualquier otra cosa da un 400 honesto en lugar de
 * interrumpir en silencio una pregunta o responderla dos veces.
 */
export function inputAppends(
	record: { messages: LhMessage[]; kind?: string },
	input: ChatInput,
): LhMessage[] {
	assertPluginQuestionInputAllowed(record.messages, input);
	assertNativeSubmissionTarget(record.messages, input);
	switch (input.type) {
		case "plugin-problem-submission":
			throw new ChatInputError("Plugin problem submissions require canonical server validation");
		case "plugin-question-answer":
			throw new ChatInputError("Plugin question answers require canonical server validation");
		case "text":
			return [...dismissalConclusion(record), newUserMessage(input.text, input.images)];
		case "answer": {
			const pending = danglingQuestionOf(record.messages);
			if (!pending || pending.toolCallId !== input.toolCallId) {
				throw new ChatInputError("answer input targets no pending question call");
			}
			return [newAnswerResult(input.toolCallId, pending.tool, input.answer)];
		}
		case "continue":
			return dismissalConclusion(record);
		case "retry":
			// La entrada ya se escribió por adelantado. retryDrops solo afecta al historial
			// temporal del agente — aquí no se añade nada nuevo.
			return [];
		case "retry-question":
			return questionRecoveryAppends(record.messages, input);
		case "thinking": {
			const active = activeProblemOf(record.messages);
			if (!active || active.toolCallId !== input.problemCallId) {
				throw new ChatInputError("thinking input targets no active problem");
			}
			if (active.pluginProblem) throw new ChatInputError("This problem requires its registered submission editor");
			return [...dismissalConclusion(record), newThinkingMessage(input.problemCallId, input.text, input.images)];
		}
		case "next": {
			// 400 honestos, la disciplina de la barrera de razonamiento: la señal es una
			// opción entre problemas — solo en sesiones de práctica, sin nada activo (la
			// entrada a mitad de problema va por el dock), y las barreras del cliente hacen
			// que, en la práctica, las infracciones sean inalcanzables de todos modos.
			if (record.kind !== "practice") {
				throw new ChatInputError("next input is a practice-session affordance");
			}
			if (activeProblemOf(record.messages)) {
				throw new ChatInputError("next input requires no active problem");
			}
			return [...dismissalConclusion(record), newNextMessage()];
		}
	}
}

/** Protección reutilizable tras un await contra la verdad canónica guardada.
 * Los llamadores heredados solo de texto conservan su contrato basado en ids;
 * las imágenes nuevas exigen vinculación. */
export function assertNativeSubmissionTarget(messages: readonly LhMessage[], input: ChatInput): void {
	if (input.type !== "answer" && input.type !== "thinking") return;
	const hasImages = input.type === "answer"
		? Object.values(input.answer.images ?? {}).some(images => images?.length)
		: !!input.images?.length;
	if (!input.occurrence) {
		if (hasImages) throw new ChatInputError("Image-bearing submissions require an exact occurrence");
		return;
	}
	let occurrence: PluginSubmissionOccurrence | undefined;
	if (input.type === "answer") {
		const pending = questionCallsOf(messages).find(call => call.status === "answerable");
		if (pending && pending.toolCallId === input.toolCallId) occurrence = {
			messageId: pending.messageId, contentIndex: pending.contentIndex, toolCallId: pending.toolCallId, toolName: pending.tool,
		};
	} else {
		const active = activeProblemOccurrenceOf(messages);
		if (active?.toolCallId === input.problemCallId) occurrence = active;
	}
	if (!occurrence || occurrence.messageId !== input.occurrence.messageId || occurrence.contentIndex !== input.occurrence.contentIndex || occurrence.toolCallId !== input.occurrence.toolCallId || occurrence.toolName !== input.occurrence.toolName) {
		throw new ChatInputError("Submission target is no longer active. Refresh the session.");
	}
}

/** Valida antes de cualquier efecto del turno y luego otra vez contra la
 * verdad guardada actual. Nunca acepta una generación fallida/abortada (de
 * esas se encargan los caminos de Reintentar/mensaje nuevo), una aparición
 * obsoleta ni un hermano que se pueda responder. */
export function questionRecoveryAppends(
	messages: readonly LhMessage[],
	input: Extract<ChatInput, { type: "retry-question" }>,
): LhMessage[] {
	assertPluginQuestionInputAllowed(messages, input);
	const calls = questionCallsOf(messages);
	const target = calls.find(call => call.messageId === input.messageId && call.contentIndex === input.contentIndex && call.toolCallId === input.toolCallId);
	if (!target || target.status !== "malformed") throw new ChatInputError("This malformed question is no longer available to retry. Refresh the session.");
	if (calls.some(call => call.status === "answerable")) throw new ChatInputError("Answer or discard the remaining question before retrying this one.");
	return calls.filter(call => call.status === "malformed").map(call => ({
		id: newMessageId(), role: "toolResult", toolCallId: call.toolCallId, toolName: call.tool,
		content: [{ type: "text", text: `Tool call "${call.tool}" could not be displayed as a complete question. The learner requested a replacement, not an answer. Re-issue the question with complete, valid arguments.` }],
		details: { questionRecovery: true }, isError: true, timestamp: Date.now(),
	}));
}

/** El fallo al que pertenece el aviso efímero. Ni la presentación del plan ni
 * la compactación resuelven un error; una entrada/salida posterior sustancial
 * sí. Esto es a propósito más amplio que la elegibilidad de Reintentar de
 * más abajo. */
export function failedResponseAtEnd(messages: readonly LhMessage[]): Extract<LhMessage, { role: "assistant" }> | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "custom" && (m.customType === "plan-block" || m.customType === "compaction" || isSideQuestionMarker(m))) continue;
		return m.role === "assistant" && m.stopReason === "error" ? m : undefined;
	}
	return undefined;
}

/** ¿Termina el registro en un fallo con una entrada que se pueda reintentar?
 * Los abortos son paradas deliberadas; una compactación tras un fallo exige
 * una entrada nueva del alumno en lugar de un reintento con un contexto
 * cambiado. */
export function endsInFailedTurn(messages: readonly LhMessage[]): boolean {
	const { ids, before } = failedTail(messages);
	return ids.size > 0 && before !== undefined && before.role !== "assistant";
}

/** Los ids que se omiten SOLO del historial temporal del agente del
 * reintento. Los intentos fallidos (incluidos el texto parcial y sus ids) se
 * quedan en disco. La conversión al proveedor de Pi ya omite las respuestas
 * con error/abortadas, pero continue() rechaza una cola del asistente ANTES
 * de la conversión. Omitir los fallos finales permite que esa continuación
 * arranque desde la entrada guardada o desde resultados de herramientas
 * completados sin reproducir herramientas ni reenviar la entrada. Los bloques
 * de plan pueden seguir al fallo y se quedan; una compactación posterior
 * bloquea Reintentar sin cambiar la propia compactación. */
export function retryDrops(messages: readonly LhMessage[]): Set<string> {
	const { ids, before } = failedTail(messages);
	if (ids.size === 0) {
		const failure = failedResponseAtEnd(messages);
		if (failure) {
			throw new ChatInputError(`${failure.errorMessage ?? "An error occurred."}\n\nThis response cannot be retried after compaction. Send a new message to continue.`);
		}
		throw new ChatInputError("retry input requires a failed turn to retry");
	}
	if (!before || before.role === "assistant") throw new ChatInputError("retry input leaves no input to continue from");
	return ids;
}

/** Recorre hacia atrás los asistentes fallidos y los bloques de plan solo de
 * interfaz. Una compactación es un límite, no un marcador que Reintentar
 * pueda cruzar. Un fallo DESPUÉS de una compactación sí puede reintentarse:
 * ese contexto compactado ya era su estado de partida. */
function failedTail(messages: readonly LhMessage[]): { ids: Set<string>; before: LhMessage | undefined } {
	const ids = new Set<string>();
	let i = messages.length - 1;
	for (; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "assistant" && m.stopReason === "error") ids.add(m.id);
		else if (!(m.role === "custom" && (m.customType === "plan-block" || isSideQuestionMarker(m)))) break;
	}
	return { ids, before: messages[i] };
}

/** La síntesis diferida de conclusión (decisión del responsable,
 *  2026-10-04): un marcador de descarte de problema espera a la siguiente
 *  entrada del usuario — el par (llamada de conclusión sintética + acuse) va
 *  delante de ella, de modo que el agente lee el descarte con su propio
 *  vocabulario y la ranura se libera. Puro; vacío cuando no hay descartes
 *  pendientes. */
function dismissalConclusion(record: { messages: LhMessage[] }): LhMessage[] {
	const problemCallId = pendingProblemDismissalOf(record.messages);
	return problemCallId ? concludedByDismissalPair(problemCallId) : [];
}

/** ¿Es este nombre de herramienta una herramienta de pregunta (propia del dock, bloqueada por respuesta)? */
export function isQuestionTool(name: string): boolean {
	return (QUESTION_TOOLS as readonly string[]).includes(name);
}
