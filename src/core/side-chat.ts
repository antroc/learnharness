/**
 * PREGUNTAS LATERALES: los hilos duraderos de #487 y el contexto de modelo con la
 * lección visible citada, combinados con el acompañante flotante compartido y la
 * selección de #451.
 *
 * Una explicación y su pregunta asociada comparten una conversación auxiliar sin
 * herramientas. El historial de la interfaz vive en `ChatRecord.sideChats`; las
 * peticiones principales añaden al historial nativo los intercambios de cada hilo
 * observados desde la última vez. El texto publicado nunca cambia; las respuestas y
 * continuaciones posteriores llegan como entradas nuevas.
 *
 * Este módulo es la mitad pura: validación de la entrada, búsqueda de hilos y la
 * vista de la lección que tiene el modelo lateral. La lección se entrega como un
 * DOCUMENTO CITADO dentro del primer turno del usuario, nunca como historial propio
 * del modelo — una transcripción bifurcada lee las palabras del profesor como
 * propias y se confunde de rol (el hallazgo de la ideación del hilo lateral del
 * 2026-09-27).
 *
 * REGLA DE LOS SPOILERS (responsable, 2026-11-02): la comprobación abierta (una
 * llamada a pregunta respondible sin resultado) y el problema de práctica activo
 * aparecen SIN su mitad oculta — sin clave de respuestas, explicación, respuesta
 * comprometida ni solución del modelo. Las comprobaciones respondidas y los
 * problemas concluidos aparecen completos.
 *
 * Seguro para el navegador: lógica pura + tipos, sin módulos integrados de node.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ChatRecord, SideChatAnchor, SideChatMessage, SideChatThread } from "./contracts/chat.ts";
import type { LhMarkerMessage, LhMessage } from "./native-messages.ts";
import type { LhViewMessage, LhViewPart } from "./view.ts";
import {
	activeProblemOf,
	failedOutputCallIds,
	newMessageId,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	questionCallsOf,
	pluginQuestionResultMatches,
	SEND_TO_USER_TOOL,
	sendToUserText,
	userFacingTextOf,
} from "./native-messages.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { citationsToReadableText, collectCitations } from "./citations.ts";
import { messageMarkdown } from "./session-markdown.ts";
import { normalizeOptions, seededRandom, shuffleOptions, type QuestionAnswerData } from "./question-core.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "./pending.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionAnswer, readPluginQuestionCancellation } from "./plugin-questions.ts";
import { pluginProblemForCall, readPluginProblemSubmission } from "./plugin-problems.ts";

// ─── identidad de segmento compartida e historial del agente principal ────────────

/** Una explicación y su comprobación comparten un hilo. Los pasos nativos del
 * asistente y el tráfico de herramientas no crean segmentos nuevos; una entrada real
 * del alumno sí. Los marcadores de la conversación lateral son neutros y nunca
 * dividen su propio segmento de origen. */
/** Autoridad de la aparición guardada, nunca una suposición basada en el nombre
 * actual del plugin o de la herramienta. Esto también impide que IDs nativos
 * reutilizados y resultados no autenticados dividan la conversación auxiliar o
 * aporten el «Thinking» de otra pregunta. */
function sidePluginQuestions(messages: readonly LhMessage[]) {
	return messages.flatMap((message, messageIndex) => message.role !== "assistant" ? [] : message.content.flatMap((block, contentIndex) => {
		if (block.type !== "toolCall") return [];
		const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
		if (annotation.status === "absent") return [];
		const occurrence = { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name };
		const result = messages.slice(messageIndex + 1).find(result => pluginQuestionResultMatches(result, occurrence, annotation));
		return [{ annotation, occurrence, result }];
	}));
}

/** Solo un envío del problema de plugin guardado que estaba activo en ese momento
 * aporta el «Thinking» común. Los datos opacos de contenido, envío o procesamiento
 * nunca se renderizan. */
function sidePluginSubmission(messages: readonly LhMessage[], index: number) {
	const message = messages[index]!;
	if (message.role !== "custom" || message.customType !== "plugin-problem-submission") return null;
	const submission = readPluginProblemSubmission(message.details);
	if (!submission) return null;
	const problem = activeProblemOf(messages.slice(0, index))?.pluginProblem;
	return problem && submission.problemId === problem.problemId && submission.pluginId === problem.pluginId &&
		submission.typeId === problem.typeId && submission.contractVersion === problem.contractVersion ? submission : null;
}

function scanSideSegments(messages: readonly LhMessage[]) {
	const pluginResults = new Set(sidePluginQuestions(messages).flatMap(question => question.result ? [question.result] : []));
	let segment: string | null = null;
	const byMessage = new Map<string, string | null>();
	for (const [index, message] of messages.entries()) {
		if (message.role === "user" || pluginResults.has(message) || sidePluginSubmission(messages, index) || (message.role === "toolResult" &&
			(QUESTION_TOOLS as readonly string[]).includes(message.toolName) && !message.isError) ||
			(message.role === "custom" && ["practice-thinking", "practice-next"].includes(message.customType))) {
			segment = null;
		} else if (message.role === "assistant") {
			segment ??= message.id;
		}
		byMessage.set(message.id, segment);
	}
	return { byMessage, current: segment };
}
export function sideSegmentId(messages: readonly LhMessage[], sourceMessageId?: string): string | null {
	const segments = scanSideSegments(messages);
	return sourceMessageId ? segments.byMessage.get(sourceMessageId) ?? null : segments.current;
}

/** Los resultados nativos de respuesta no rompen el grupo continuo de la vista del
 * asistente. Pon una entrada discreta en cada límite de segmento dentro de ese
 * grupo, no solo una al final del grupo. La entrada final se indexa por parts.length. */
export function sideEntryPoints(messages: readonly LhMessage[], view: readonly LhViewMessage[]): ReadonlyMap<string, ReadonlyMap<number, string>> {
	const { byMessage } = scanSideSegments(messages);
	const forParts = (parts: readonly LhViewPart[]) => {
		const entries = new Map<number, string>();
		let source: string | null = null;
		let visible = false;
		for (const [index, part] of parts.entries()) {
			if (part.type === "step-start") {
				const next = byMessage.get(part.sourceMessageId ?? "") ?? null;
				if (next !== source) {
					if (source && visible && !source.startsWith("c_")) entries.set(index, source);
					source = next; visible = false;
				}
			}
			visible ||= (part.type === "text" && !!part.text?.trim()) || !!part.pluginQuestion || !!part.pluginProblem || part.type === "tool-problem" ||
				(part.type.startsWith("tool-") && (QUESTION_TOOLS as readonly string[]).includes(part.type.slice(5)));
		}
		if (source && visible && !source.startsWith("c_")) entries.set(parts.length, source);
		return entries;
	};
	return new Map(view.filter((message) => message.role === "assistant").map((message) => [message.id, forParts(message.parts)]));
}

function replyState(message: SideChatMessage): string {
	return message.pending ? "pending" : message.stopped ? "stopped" : message.error !== undefined ? "failed" : "complete";
}

/** Las marcas de agua de entrega viven DENTRO de entradas nativas inmutables, no en
 * un corte mutable del hilo de la interfaz. Por eso registrar el texto y su marca de
 * agua es una sola escritura atómica. El historial nativo completo sobrevive a la
 * compactación, así que siguen siendo recuperables. Los antiguos marcadores de un
 * solo uso siembran el mismo registro sin reescribirlos. */
function sideDeliveryLedger(messages: readonly LhMessage[]) {
	const delivered = new Map<string, Map<string, SideChatMessage>>();
	const revisions = new Map<string, number>();
	for (const message of messages) {
		if (message.role !== "custom" || message.customType !== "side-question" || !message.details || typeof message.details !== "object") continue;
		const details = message.details as { threadId?: unknown; updates?: unknown; snapshot?: unknown };
		if (typeof details.threadId !== "string") continue;
		const updates = details.updates ?? details.snapshot;
		if (!Array.isArray(updates)) continue;
		const thread = delivered.get(details.threadId) ?? new Map<string, SideChatMessage>();
		for (const update of updates) {
			if (!update || typeof update.id !== "string" || typeof update.text !== "string" || !["user", "assistant"].includes(update.role)) continue;
			const { append, ...entry } = update as SideChatMessage & { append?: boolean };
			thread.set(entry.id, { ...entry, text: append ? (thread.get(entry.id)?.text ?? "") + entry.text : entry.text });
		}
		delivered.set(details.threadId, thread);
		revisions.set(details.threadId, (revisions.get(details.threadId) ?? 0) + 1);
	}
	return { delivered, revisions };
}

/** Captura solo el texto/estado en bruto nuevo de TODAS las conversaciones laterales.
 * El llamador aporta las instantáneas auxiliares actuales, incluido el texto en curso,
 * en un límite de petición al modelo principal o de descarte. Sin esperar a que
 * terminen los auxiliares y sin cambios en las entradas anteriores. `after` incluye
 * los resultados de herramientas recién añadidos, conservando su adyacencia. */
export function sideConversationEntries(record: Pick<ChatRecord, "messages" | "sideChats">, after: readonly LhMessage[] = record.messages): LhMarkerMessage[] {
	const { delivered, revisions } = sideDeliveryLedger(after);
	const present = new Set(after.map((message) => message.id));
	const changes: { threadId: string; message: SideChatMessage; previous?: SideChatMessage }[] = [];
	for (const thread of record.sideChats ?? []) {
		const previous = delivered.get(thread.id);
		const current = new Set(thread.messages.map((message) => message.id));
		for (const message of thread.messages) {
			const old = previous?.get(message.id);
			if (!old || old.text !== message.text || replyState(old) !== replyState(message)) changes.push({ threadId: thread.id, message, previous: old });
		}
		// Un parcial ya publicado puede sobrevivir a su ejecución efímera tras un reinicio o
		// un fallo al guardar. Se marca como incompleto una vez; nunca se descarta en silencio.
		for (const old of previous?.values() ?? []) {
			if (old.pending && !current.has(old.id)) changes.push({ threadId: thread.id, previous: old,
				message: { ...old, pending: false, error: "Reply interrupted before completion", at: new Date().toISOString() } });
		}
	}
	changes.sort((a, b) => (Date.parse(a.message.at) || 0) - (Date.parse(b.message.at) || 0));
	return changes.map(({ threadId, message, previous }) => {
		let revision = (revisions.get(threadId) ?? 0) + 1;
		let id = `exchange_${threadId}_update_${revision}`;
		while (present.has(id)) id = `exchange_${threadId}_update_${++revision}`;
		present.add(id); revisions.set(threadId, revision);
		const extendsPrevious = previous && message.text.startsWith(previous.text);
		const text = !previous ? message.text : extendsPrevious ? message.text.slice(previous.text.length) : message.text;
		const label = message.role === "user" ? "Learner" : "Helper";
		const kind = !previous ? "" : previous.text === message.text ? " (reply status update)" : extendsPrevious ? " (continued reply)" : " (updated wording of the earlier reply)";
		const quoted = !previous ? (message.quotes ?? []).map((quote) => `Quoted tutor passage:\n${quote}`).join("\n\n") : "";
		const status = message.pending ? "\n[This helper reply is still generating; later text will arrive in a subsequent update.]" :
			message.stopped ? "\n[The learner stopped this helper reply; it is incomplete.]" :
			message.error !== undefined ? "\n[This helper reply failed or was interrupted; any recorded text is incomplete.]" :
			previous?.pending ? "\n[This helper reply is now complete.]" : "";
		return {
			id, role: "custom", customType: "side-question",
			content: `Recorded learner–helper conversation update\nConversation: ${threadId}\n\n${quoted ? `${quoted}\n\n` : ""}${label}${kind}:\n${text}${status}\n\nEnd of recorded learner–helper conversation update.`,
			// En el registro se guarda también solo el sufijo nuevo, no una copia creciente de la
			// respuesta completa en cada petición. Las entradas de instantánea antiguas se siguen decodificando.
			details: { threadId, updates: [{ ...message, text, append: extendsPrevious === true }] }, display: false, timestamp: Date.parse(message.at) || 0,
		};
	});
}

// ─── límites ──────────────────────────────────────────────────────────────────

/** La pregunta más larga que acepta la ruta (caracteres). */
export const SIDE_QUESTION_MAX_CHARS = 8_000;
/** Como mucho, este número de citas adjuntas por pregunta. */
export const SIDE_QUOTES_MAX = 5;
/** Cada cita adjunta o bloque de ancla se recorta a este número de caracteres. */
export const SIDE_QUOTE_MAX_CHARS = 4_000;

// ─── entrada ──────────────────────────────────────────────────────────────────

export class SideChatInputError extends Error {}

/** Una consulta: una continuación en un hilo existente (threadId) O la primera
 * pregunta de un hilo nuevo (anchor) — o un REINTENTO de la última respuesta fallida
 * de un hilo (threadId + retry, sin texto). */
export interface SideAskInput {
	threadId?: string;
	anchor?: SideChatAnchor;
	text: string;
	quotes: string[];
	quoteCitations?: string[];
	retry?: boolean;
	/** Estable ante un reintento incierto del POST: nunca se genera dos veces para una misma consulta. */
	requestId?: string;
	/** El trabajo actual sin enviar; contexto de referencia, no una respuesta enviada. */
	working?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Valida la forma del ancla; el servidor comprueba aparte que apunte a prosa real
 * del profesor en el registro. */
export function parseSideAnchor(raw: unknown): SideChatAnchor {
	if (!raw || typeof raw !== "object") throw new SideChatInputError("anchor must be an object");
	const a = raw as Record<string, unknown>;
	if (typeof a.messageId !== "string" || !ID_RE.test(a.messageId)) throw new SideChatInputError("anchor.messageId is invalid");
	if (typeof a.partId !== "string" || !a.partId.startsWith(`${a.messageId}-t`)) throw new SideChatInputError("anchor.partId must belong to anchor.messageId");
	if (typeof a.blockIndex !== "number" || !Number.isSafeInteger(a.blockIndex) || a.blockIndex < 0) {
		throw new SideChatInputError("anchor.blockIndex must be a non-negative integer");
	}
	if (typeof a.blockText !== "string" || !a.blockText.trim()) throw new SideChatInputError("anchor.blockText must be non-empty");
	return {
		messageId: a.messageId,
		partId: a.partId,
		blockIndex: a.blockIndex,
		blockText: clip(a.blockText, SIDE_QUOTE_MAX_CHARS),
	};
}

/** Analiza el cuerpo de la ruta de consulta. Lanza SideChatInputError si la forma es incorrecta. */
export function parseSideAskInput(raw: unknown): SideAskInput {
	if (!raw || typeof raw !== "object") throw new SideChatInputError("body must be an object");
	const body = raw as Record<string, unknown>;
	if (body.requestId !== undefined && (typeof body.requestId !== "string" || !ID_RE.test(body.requestId))) throw new SideChatInputError("requestId is invalid");
	if (body.working !== undefined && (typeof body.working !== "string" || body.working.length > SIDE_QUESTION_MAX_CHARS)) throw new SideChatInputError("working is invalid or too long");
	const extra = { ...(typeof body.requestId === "string" ? { requestId: body.requestId } : {}), ...(typeof body.working === "string" ? { working: body.working } : {}) };
	if (body.retry === true) {
		if (typeof body.threadId !== "string" || !ID_RE.test(body.threadId)) throw new SideChatInputError("retry needs a valid threadId");
		return { threadId: body.threadId, text: "", quotes: [], retry: true, ...extra };
	}
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text) throw new SideChatInputError("text must be a non-empty string");
	if (text.length > SIDE_QUESTION_MAX_CHARS) throw new SideChatInputError(`text exceeds ${SIDE_QUESTION_MAX_CHARS} characters`);
	const quotesRaw = body.quotes ?? [];
	if (!Array.isArray(quotesRaw) || quotesRaw.some((q) => typeof q !== "string")) {
		throw new SideChatInputError("quotes must be an array of strings");
	}
	const quotes = (quotesRaw as string[]).map((q) => q.trim()).filter(Boolean);
	if (quotes.length > SIDE_QUOTES_MAX) throw new SideChatInputError(`at most ${SIDE_QUOTES_MAX} quotes per question`);
	const quoteCitations = body.quoteCitations;
	if (quoteCitations !== undefined) {
		if (!Array.isArray(quoteCitations) || quoteCitations.length !== quotes.length || quotes.length !== quotesRaw.length) throw new SideChatInputError("quoteCitations must match the quotes");
		for (const [index, value] of quoteCitations.entries()) {
			const citation = typeof value === "string" && value.length <= 128_000 ? collectCitations(value) : [];
			if (citation.length !== 1 || citation[0]!.source !== value || citation[0]!.citation.text.trim() !== clip(quotes[index]!, SIDE_QUOTE_MAX_CHARS)) throw new SideChatInputError("quote citation is invalid or does not match its passage");
		}
	}
	const references = quoteCitations === undefined ? {} : { quoteCitations: quoteCitations as string[] };
	const threadId = body.threadId;
	if (threadId !== undefined) {
		if (typeof threadId !== "string" || !ID_RE.test(threadId)) throw new SideChatInputError("threadId is invalid");
		return { threadId, text, quotes: quotes.map((q) => clip(q, SIDE_QUOTE_MAX_CHARS)), ...extra, ...references };
	}
	if (body.anchor === undefined) throw new SideChatInputError("either threadId or anchor is required");
	return { anchor: parseSideAnchor(body.anchor), text, quotes: quotes.map((q) => clip(q, SIDE_QUOTE_MAX_CHARS)), ...extra, ...references };
}

/** Analiza el cuerpo del estado de la ventana ({open: boolean}). */
export function parseSideOpenInput(raw: unknown): boolean {
	const open = (raw as { open?: unknown } | null)?.open;
	if (typeof open !== "boolean") throw new SideChatInputError("open must be a boolean");
	return open;
}

// ─── hilos ────────────────────────────────────────────────────────────────────

export function newSideThreadId(): string {
	return `side_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function newSideThread(anchor: SideChatAnchor, at = new Date().toISOString()): SideChatThread {
	return { id: `side_${anchor.messageId}`, anchor, open: true, createdAt: at, messages: [] };
}

export function newSideQuestion(text: string, quotes: readonly string[], at = new Date().toISOString()): SideChatMessage {
	return { id: newMessageId(), role: "user", text, ...(quotes.length > 0 ? { quotes: [...quotes] } : {}), at };
}

/** ¿Es `partId` prosa real y asentada del profesor en este registro? El mensaje del
 * ancla debe ser un mensaje del asistente no fallido con esa parte de texto. */
export function anchorPointsAtProse(messages: readonly LhMessage[], anchor: SideChatAnchor): boolean {
	const message = messages.find((m) => m.id === anchor.messageId);
	if (!message || message.role !== "assistant") return false;
	const assistant = message as AssistantMessage;
	if (assistant.stopReason === "pending") return false;
	const suffix = anchor.partId.slice(`${anchor.messageId}-t`.length);
	if (!/^\d+$/.test(suffix)) return false;
	return Number(suffix) < textPartCount(assistant, failedOutputCallIds(messages));
}

/** Cuántas partes de texto `-t<n>` acuña projectView para este mensaje: cada bloque
 * de texto (también los vacíos), más la prosa entregada con send_to_user — la regla
 * de numeración exacta de view.ts, para que las anclas coincidan con el renderizado. */
function textPartCount(assistant: AssistantMessage, failedOutputs: ReadonlySet<string>): number {
	const failedGeneration = assistant.stopReason === "error" || assistant.stopReason === "aborted";
	let n = 0;
	for (const block of assistant.content) {
		if (block.type === "text") n++;
		else if (block.type === "toolCall" && block.name === SEND_TO_USER_TOOL) {
			if (failedGeneration || failedOutputs.has(block.id)) continue;
			if (sendToUserText(block) !== undefined) n++;
		}
	}
	return n;
}

// ─── el documento de la lección (la vista de la sesión que tiene el modelo lateral) ──

function quizHeading(answer: QuestionAnswerData, tool: string): string {
	if (tool === "probe") return "Probe";
	if (tool === "recall") return "Recall question";
	if (tool === "explain") return "Explain question";
	if (tool === "ask_user_question") return "Question to the learner";
	return answer.questionType === "predict" ? "Prediction question" : "Check question";
}

/** Una pregunta RESPONDIDA, completa: opciones con la clave, la respuesta del alumno,
 * el veredicto y la explicación o la respuesta comprometida. */
function answeredQuestionMarkdown(result: ToolResultMessage, input: Record<string, unknown> | undefined): string | null {
	const answer = result.details as QuestionAnswerData | undefined;
	if (!answer || typeof answer !== "object" || typeof answer.questionText !== "string") return null;
	const lines: string[] = [`### ${quizHeading(answer, result.toolName)} (answered)`];
	if (typeof answer.readingThinking === "string" && answer.readingThinking.trim()) {
		lines.push(`*The learner's notes while reading, before this question:* ${answer.readingThinking.trim()}`);
	}
	lines.push(`**Q:** ${answer.questionText}`);
	const details = typeof input?.details === "string" ? input.details.trim() : "";
	if (details) lines.push(details);
	if (answer.dismissed) {
		lines.push("The learner skipped this question.");
		return lines.join("\n\n");
	}
	const chosen = new Set((answer.answers ?? []).map((a) => a.index));
	const correct = new Set(answer.correctIndices ?? []);
	const isQuiz = answer.kind === "quiz";
	if (answer.options && answer.options.length > 0) {
		lines.push(
			answer.options
				.map((o) => {
					const marks = [isQuiz && correct.has(o.index) ? "correct" : "", chosen.has(o.index) ? "chosen by the learner" : ""].filter(Boolean);
					return `- ${o.label}${marks.length > 0 ? ` *(${marks.join(", ")})*` : ""}`;
				})
				.join("\n"),
		);
	}
	if (answer.other) lines.push(`The learner wrote their own option: "${answer.other}"`);
	if (answer.text) lines.push(`The learner answered: "${answer.text}"`);
	if (answer.dontKnow) lines.push("The learner answered \"I don't know\".");
	if (isQuiz && !answer.dontKnow && typeof answer.correct === "boolean") {
		lines.push(`Verdict: ${answer.correct ? "correct" : "incorrect"}.`);
	}
	if (typeof answer.confidence === "number") lines.push(`The learner's stated confidence: ${answer.confidence}%.`);
	const thinking = answer.thinking ?? answer.note;
	if (typeof thinking === "string" && thinking.trim()) lines.push(`*The learner's thinking:* ${thinking.trim()}`);
	if (answer.explanation) lines.push(`**Explanation shown to the learner:** ${answer.explanation}`);
	if (answer.committed) lines.push(`**The teacher's committed answer, shown to the learner:** ${answer.committed}`);
	return lines.join("\n\n");
}

/** Una pregunta ABIERTA: solo la mitad visible para el alumno — nunca la clave. */
function openQuestionMarkdown(tool: string, input: unknown, toolCallId: string): string | null {
	if (!input || typeof input !== "object") return null;
	const args = input as Record<string, unknown>;
	const question = typeof args.question === "string" ? args.question.trim() : "";
	if (!question) return null;
	const lines = ["### OPEN question — the learner has not answered it yet (its answer key is hidden from you)", `**Q:** ${question}`];
	const details = typeof args.details === "string" ? args.details.trim() : "";
	if (details) lines.push(details);
	if (tool !== "explain" && tool !== "recall") {
		const rawOptions = normalizeOptions(args.options as Parameters<typeof normalizeOptions>[0]);
		const options = toolQuestionKind(tool) === "quiz" ? shuffleOptions(rawOptions, seededRandom(toolCallId)) : rawOptions;
		if (options.length > 0) lines.push(options.map((o, index) => `${index + 1}. ${o.label}`).join("\n"));
	}
	return lines.join("\n\n");
}

/** La respuesta y la corrección del renderizador del plugin son opacas, incluso
 * después del envío. El auxiliar solo recibe el enunciado común del host y el
 * «Thinking» en texto plano. */
function sidePluginQuestionMarkdown(question: ReturnType<typeof sidePluginQuestions>[number]): string | null {
	if (question.annotation.status !== "posed") return null;
	const snapshot = question.annotation.snapshot;
	if (!question.result) return openQuestionMarkdown("recall", { question: snapshot.input.question }, question.occurrence.toolCallId);
	const lines = ["### Question (answered)", `**Q:** ${snapshot.input.question}`];
	if (readPluginQuestionCancellation(question.result.role === "toolResult" ? question.result.details : undefined, snapshot)) {
		lines.push("The learner skipped this question.");
	} else {
		const answer = readPluginQuestionAnswer(question.result.role === "toolResult" ? question.result.details : undefined, snapshot);
		if (answer?.readingThinking?.trim()) lines.push(`*The learner's notes while reading, before this question:* ${answer.readingThinking.trim()}`);
		if (answer?.thinking?.trim()) lines.push(`*The learner's thinking:* ${answer.thinking.trim()}`);
	}
	return lines.join("\n\n");
}

/** El planteamiento de práctica: solo el enunciado. Abierto ⇔ es el problema activo. */
function problemMarkdown(args: { statement?: unknown } | undefined, open: boolean): string | null {
	const statement = typeof args?.statement === "string" ? args.statement.trim() : "";
	if (!statement) return null;
	return open
		? `### OPEN problem — the learner is working on it now (its solution is hidden from you)\n\n${statement}`
		: `### Problem\n\n${statement}`;
}

/**
 * La lección como un único documento markdown para el modelo lateral. Respeta el
 * corte de compactación activo (la cola conservada, nunca su resumen privado). Una
 * evaluación abierta se conserva aunque esté antes del corte. Se renderizan la
 * prosa del profesor, el texto del alumno, el razonamiento de la práctica, las
 * preguntas respondidas o abiertas y los problemas de práctica; el resto del
 * tráfico de herramientas y los marcadores de andamiaje, no.
 */
export function sideChatLessonDocument(messages: readonly LhMessage[]): string {
	const blocks: string[] = [];
	let start = 0;
	const marker = activeCompactionOf(messages);
	if (marker) {
		const kept = keptIndexFor(messages, marker);
		if (kept >= 0) {
			start = kept;
			// Un resumen privado del modelo puede contener la clave de la evaluación abierta.
			blocks.push("### Earlier session history\n\nEarlier history is omitted after compaction; its private summary is not supplied to the helper.");
		}
	}
	const calls = new Map<string, { name: string; args: Record<string, unknown> | undefined }>();
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const block of (m as AssistantMessage).content) {
			if (block.type === "toolCall") calls.set(block.id, { name: block.name, args: block.arguments as Record<string, unknown> | undefined });
		}
	}
	const pluginQuestions = sidePluginQuestions(messages);
	const pluginResults = new Map(pluginQuestions.flatMap(question => question.result ? [[question.result, question] as const] : []));
	const pluginProblems = new Map(messages.flatMap((message, messageIndex) => message.role !== "assistant" ? [] : message.content.flatMap((block, contentIndex) => {
		if (block.type !== "toolCall") return [];
		const snapshot = pluginProblemForCall(messages, { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name });
		if (!snapshot) return [];
		const tail = messages.slice(messageIndex + 1);
		const nextAssistant = tail.findIndex(result => result.role === "assistant");
		const result = (nextAssistant < 0 ? tail : tail.slice(0, nextAssistant)).find(result => result.role === "toolResult" && !result.isError && result.toolCallId === block.id && result.toolName === block.name);
		return result ? [[result, snapshot] as const] : [];
	})));
	const openQuestions = new Set(questionCallsOf(messages).filter((c) => c.status === "answerable").map((c) => c.toolCallId));
	const activeProblem = activeProblemOf(messages)?.toolCallId ?? null;
	const failedOutputs = failedOutputCallIds(messages);
	// Una evaluación puede sobrevivir a la cola conservada: se conserva su pregunta o
	// enunciado visible sin recuperar el resumen privado ni la clave de respuestas.
	for (const question of pluginQuestions) {
		if (!question.result && messages.slice(0, start).some(message => message.id === question.occurrence.messageId)) {
			const md = sidePluginQuestionMarkdown(question);
			if (md) blocks.push(md);
		}
	}
	for (const m of messages.slice(0, start)) {
		if (m.role === "assistant") for (const block of m.content) {
			if (block.type === "toolCall" && openQuestions.has(block.id)) {
				const open = openQuestionMarkdown(block.name, block.arguments, block.id);
				if (open) blocks.push(open);
			}
		}
		if (m.role === "toolResult" && m.toolCallId === activeProblem && !m.isError) {
			const problem = problemMarkdown(pluginProblems.get(m)?.input ?? calls.get(m.toolCallId)?.args, true);
			if (problem) blocks.push(problem);
		}
	}

	for (const [offset, m] of messages.slice(start).entries()) {
		if (m.role === "user") {
			for (const text of userFacingTextOf(m.content)) blocks.push(`### Learner\n\n${text.trim()}`);
		} else if (m.role === "assistant") {
			const assistant = m as AssistantMessage;
			for (const text of userFacingTextOf(assistant.content, failedOutputs)) blocks.push(`### Teacher\n\n${text.trim()}`);
			for (const question of pluginQuestions.filter(question => question.occurrence.messageId === m.id && !question.result)) {
				const md = sidePluginQuestionMarkdown(question);
				if (md) blocks.push(md);
			}
			for (const block of assistant.content) {
				if (block.type === "toolCall" && openQuestions.has(block.id)) {
					const open = openQuestionMarkdown(block.name, block.arguments, block.id);
					if (open) blocks.push(open);
				}
			}
		} else if (m.role === "toolResult") {
			const result = m as ToolResultMessage;
			if (result.isError) continue;
			const pluginQuestion = pluginResults.get(m);
			const pluginProblem = pluginProblems.get(m);
			if (pluginQuestion) {
				const md = sidePluginQuestionMarkdown(pluginQuestion);
				if (md) blocks.push(md);
			} else if (pluginProblem) {
				const md = problemMarkdown(pluginProblem.input, result.toolCallId === activeProblem);
				if (md) blocks.push(md);
			} else if ((QUESTION_TOOLS as readonly string[]).includes(result.toolName)) {
				const md = answeredQuestionMarkdown(result, calls.get(result.toolCallId)?.args);
				if (md) blocks.push(md);
			} else if (result.toolName === PRACTICE_PROBLEM_TOOL) {
				const md = problemMarkdown(calls.get(result.toolCallId)?.args, result.toolCallId === activeProblem);
				if (md) blocks.push(md);
			} else if (result.toolName === PRACTICE_CONCLUDE_TOOL) {
				// Concluido: el motor compartido revela la solución comprometida.
				const md = messageMarkdown(m, m.id, false, { messages, calls, failedOutputCalls: failedOutputs });
				if (md) blocks.push(md);
			}
		} else if (m.role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "plugin-problem-submission") {
				const submission = sidePluginSubmission(messages, start + offset);
				if (submission?.thinking.trim()) blocks.push(`### Learner (thinking on the problem)\n\n${submission.thinking.trim()}`);
			} else if (marker.customType === "practice-thinking") {
				const text = (marker.details as { text?: unknown } | null)?.text;
				if (typeof text === "string" && text.trim()) blocks.push(`### Learner (thinking on the problem)\n\n${text.trim()}`);
			}
		}
	}
	return citationsToReadableText(blocks.join("\n\n"));
}

// ─── los turnos del modelo ────────────────────────────────────────────────────

/** Un turno de texto para el modelo lateral (la capa del agente los traduce a
 * mensajes nativos de usuario/asistente). */
export interface SideModelTurn {
	role: "user" | "assistant";
	text: string;
}

function quoteBlocks(quotes: readonly string[] | undefined): string {
	return (quotes ?? []).map((q) => `<quote>\n${q}\n</quote>`).join("\n\n");
}

/**
 * La lista completa de turnos para responder al ÚLTIMO mensaje del usuario (sin
 * responder) del hilo. El documento de la lección y el pasaje del ancla van en el
 * primer turno del usuario; las respuestas anteriores se reproducen como turnos del
 * asistente (una respuesta fallida o detenida conserva su texto parcial más una
 * nota, para que los roles se alternen).
 */
export function sideChatModelTurns(thread: SideChatThread, lessonDocument: string): SideModelTurn[] {
	const turns: SideModelTurn[] = [];
	thread.messages.forEach((message, i) => {
		if (message.role === "user") {
			const parts: string[] = [];
			if (i === 0) {
				parts.push(
					`<lesson>\n${lessonDocument || "(The session has no teaching content yet.)"}\n</lesson>`,
					`The learner opened this side question on the following passage of the lesson:\n\n<passage>\n${thread.anchor.blockText}\n</passage>`,
				);
			}
			const quotes = quoteBlocks(message.quotes);
			if (quotes) parts.push(`The learner highlighted:\n\n${quotes}`);
			parts.push(`Side question: ${message.text}`);
			turns.push({ role: "user", text: parts.join("\n\n") });
		} else {
			const notes: string[] = [];
			if (message.stopped) notes.push("(The learner stopped this answer here.)");
			if (message.error) notes.push("(This answer failed before it finished.)");
			const text = [message.text.trim(), ...notes].filter(Boolean).join("\n\n");
			turns.push({ role: "assistant", text: text || "(No answer was produced.)" });
		}
	});
	return turns;
}

/** ¿Termina el hilo en una pregunta que aún espera respuesta? */
export function sideThreadAwaitsAnswer(thread: SideChatThread): boolean {
	return thread.messages.at(-1)?.role === "user";
}
