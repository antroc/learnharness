/**
 * Sesión → markdown — el ÚNICO motor de formato (decisión del responsable, 2026-09-27).
 *
 * La vista del extractor de una sesión de enseñanza y la futura exportación de
 * sesiones para el usuario comparten este motor: una sesión se renderiza como
 * markdown limpio y legible — cabeceras de interlocutor, bloques de cuestionario y
 * de comprobación, notas de herramientas — con anclas opcionales por id de mensaje.
 * Desde el adelgazamiento del esquema de envío (2026-09-28) las proposiciones ya no
 * informan de ids de mensaje — el extractor renderiza sin anclas y la procedencia
 * es a nivel de chat —, así que hoy las anclas solo sirven a la futura exportación
 * para el usuario; `anchors: false` acuña el mismo documento sin ellas.
 *
 * Núcleo puro: entran mensajes nativos (LhMessage), sale una cadena. La paridad de
 * contenido con el constructor de líneas de cobertura (messageViewLines de
 * core/coverage.ts) es deliberada — todo mensaje que produce líneas de vista
 * produce un bloque markdown, en el mismo orden —, pero los formatos están
 * SEPARADOS por diseño (2026-09-27): las huellas de cobertura hacen hash del formato
 * de línea y se mantienen estables (sin reextracción masiva cuando cambia la
 * presentación); el markdown es presentación. Una llamada a herramienta fallida no
 * renderiza nada (contexto de reintento, no evidencia de aprendizaje); los
 * marcadores personalizados son invisibles, igual que en la vista.
 */

import { citationsToReadableText } from "./citations.ts";
import type { LhMessage } from "./native-messages.ts";
import {
	failedOutputCallIds,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	problemInputForConclude,
	SEND_TO_USER_TOOL,
	userFacingTextOf,
	pluginQuestionResultMatches,
} from "./native-messages.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionAnswer, readPluginQuestionCancellation } from "./plugin-questions.ts";
import { readPluginProblemSnapshot, readPluginProblemSubmission, pluginProblemById } from "./plugin-problems.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

/** El contexto de unión de la práctica (aprobado por el responsable, ronda de
 * exportación del 2026-10-06): los RESULTADOS de las herramientas de práctica son
 * acuses — el enunciado, el resultado y el veredicto viven todos en los argumentos
 * de la llamada del asistente, y la solución del modelo se fija en el momento del
 * PLANTEAMIENTO. Los bloques markdown los unen igual que la frontera de la vista
 * pliega las tarjetas (solo limpios: el resultado de un planteamiento rechazado es
 * erróneo y no renderiza nada antes de llegar siquiera a esta unión). */
export interface MarkdownContext {
	messages: ReadonlyArray<LhMessage>;
	/** toolCallId → el nombre + los argumentos de la parte de llamada. */
	calls: Map<string, { name: string; args: Record<string, unknown> | undefined }>;
	failedOutputCalls?: ReadonlySet<string>;
}

function markdownContext(messages: ReadonlyArray<LhMessage>): MarkdownContext {
	const calls: MarkdownContext["calls"] = new Map();
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const block = part as { type?: string; id?: string; name?: string; arguments?: unknown };
			if (block.type === "toolCall" && typeof block.id === "string") {
				calls.set(block.id, {
					name: typeof block.name === "string" ? block.name : "",
					args: (block.arguments ?? undefined) as Record<string, unknown> | undefined,
				});
			}
		}
	}
	return { messages, calls, failedOutputCalls: failedOutputCallIds(messages) };
}

/** solvedWithHints → "Solved with hints" — el enum del resultado se lee como prosa. */
function outcomeLabel(outcome: string): string {
	const spaced = outcome.replace(/([a-z])([A-Z])/g, (_, lo: string, hi: string) => `${lo} ${hi.toLowerCase()}`);
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** El resultado visible para el alumno de un resultado de herramienta, renderizado como líneas de cuerpo. */
function toolResultBody(result: ToolResultMessage, ctx?: MarkdownContext): { heading: string; body: string[] } {
	const pluginAnswer = readPluginQuestionAnswer(result.details);
	const cancellation = readPluginQuestionCancellation(result.details);
	if (pluginAnswer || cancellation) {
		const bound = ctx?.messages.some(message => message.role === "assistant" && Array.isArray(message.content) && message.content.some((block, contentIndex) => {
			if (block.type !== "toolCall") return false;
			const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
			return annotation.status !== "absent" && pluginQuestionResultMatches(result as LhMessage, { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name }, annotation);
		}));
		if (!bound) return { heading: "Question", body: ["Question unavailable"] };
		if (cancellation) return { heading: "Question", body: ["The question was cancelled without a learner answer."] };
		const body = [`**Answer:** ${typeof pluginAnswer!.answer === "string" ? pluginAnswer!.answer : JSON.stringify(pluginAnswer!.answer)}`];
		if (pluginAnswer!.thinking !== undefined) body.push(`**Thinking:** ${pluginAnswer!.thinking}`);
		if (pluginAnswer!.readingThinking !== undefined) body.push(`**Reading thinking:** ${pluginAnswer!.readingThinking}`);
		return { heading: "Learner answer", body };
	}
	const out = result.details as
		| Partial<{
				questionText: string;
				correct: boolean;
				dontKnow: boolean;
				note: string;
				text: string;
				answers: string[];
				other: string;
				dismissed: boolean;
		  }>
		| undefined;

	if (
		result.toolName === "quiz" ||
		result.toolName === "probe" ||
		result.toolName === "explain" ||
		result.toolName === "recall"
	) {
		const heading =
			result.toolName === "quiz"
				? "Quiz"
				: result.toolName === "probe"
					? "Probe"
					: result.toolName === "recall"
						? "Recall"
						: "Recall check"; // explain — el nombre del recuerdo libre de la enseñanza
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : "(no question text)";
		const body = [`**Q:** ${question}`];
		if (out?.dismissed === true) body.push("The learner skipped this check.");
		else if (out?.dontKnow === true) body.push("The learner did not know.");
		else if (out?.correct === true) body.push("The learner answered correctly.");
		else if (out?.correct === false) body.push("The learner answered incorrectly.");
		else if (typeof out?.text === "string" && out.text.trim()) body.push(`The learner answered in his own words: ${out.text.trim()}`);
		if (typeof out?.note === "string" && out.note) body.push(`*(his thinking: ${out.note})*`);
		return { heading, body };
	}

	const pluginProblem = readPluginProblemSnapshot((result.details as { pluginProblem?: unknown } | undefined)?.pluginProblem);
	if (pluginProblem && ctx && pluginProblemById(ctx.messages, pluginProblem.problemId)) {
		return { heading: "Problem", body: [pluginProblem.input.statement] };
	}
	if (ctx !== undefined && result.toolName === PRACTICE_PROBLEM_TOOL) {
		const statement = ctx.calls.get(result.toolCallId)?.args?.statement;
		return {
			heading: "Problem",
			body: [typeof statement === "string" && statement.trim() ? statement.trim() : "(no statement)"],
		};
	}

	if (ctx !== undefined && result.toolName === PRACTICE_CONCLUDE_TOOL) {
		const args = ctx.calls.get(result.toolCallId)?.args;
		const outcome = typeof args?.outcome === "string" && args.outcome.trim() ? args.outcome.trim() : "";
		const verdict = typeof args?.verdict === "string" && args.verdict.trim() ? args.verdict.trim() : undefined;
		if (outcome === "dismissed") return { heading: "Concluded", body: ["The learner skipped this problem."] };
		const label = outcome !== "" ? `**${outcomeLabel(outcome)}.**` : "**Concluded.**";
		const body = [verdict !== undefined ? `${label} ${verdict}` : label];
		// La revelación (ronda del responsable, 2026-10-05): la solución fijada al
		// plantear — el problema planteado limpiamente más reciente antes de esta conclusión.
		const input = problemInputForConclude(ctx.messages, result.toolCallId);
		const solution = typeof input?.modelSolution === "string" && input.modelSolution.trim() ? input.modelSolution.trim() : undefined;
		if (solution !== undefined) body.push(`> **Model solution**\n>\n> ${solution.replace(/\n/g, "\n> ")}`);
		return { heading: "Concluded", body };
	}

	if (result.toolName === "ask_user_question") {
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : "(no question text)";
		const body = [`**Q:** ${question}`];
		const chosen = [
			...(Array.isArray(out?.answers) ? out!.answers! : []),
			...(typeof out?.other === "string" && out.other.trim() ? [out.other.trim()] : []),
		];
		if (typeof out?.text === "string" && out.text.trim()) body.push(`The learner answered: ${out.text.trim()}`);
		else if (chosen.length > 0) body.push(`The learner chose: ${chosen.join(", ")}`);
		else if (out?.dismissed === true) body.push("The learner skipped this question.");
		if (typeof out?.note === "string" && out.note) body.push(`*(his thinking: ${out.note})*`);
		return { heading: "Question", body };
	}

	// Paridad con el constructor de líneas: los demás resultados limpios de herramienta son una línea.
	return { heading: "Tool", body: [`*${result.toolName} result delivered*`] };
}

/**
 * UN mensaje como bloque markdown — `null` cuando el mensaje no renderiza
 * nada (una llamada a herramienta fallida, un marcador suelto, un conjunto vacío
 * de partes de texto). `mid` es el ancla de procedencia que se muestra cuando
 * `anchors` está activado.
 */
export function messageMarkdown(
	message: LhMessage,
	mid: string,
	anchors = true,
	ctx?: MarkdownContext,
): string | null {
	const role = (message as { role?: string }).role;
	const anchor = anchors ? ` · ${mid}` : "";
	const parts: string[] = [];

	if (message.role === "custom" && message.customType === "plugin-problem-submission") {
		const submitted = readPluginProblemSubmission(message.details);
		if (submitted) parts.push(`### Learner${anchor}\n\n\`\`\`json\n${JSON.stringify({ submission: submitted.submission, thinking: submitted.thinking, ...(submitted.processing ? { processing: submitted.processing } : {}) }, null, 2)}\n\`\`\``);
	} else if (role === "user") {
		for (const text of userFacingTextOf((message as { content: unknown }).content)) {
			parts.push(`### Learner${anchor}\n\n${citationsToReadableText(text).trim()}`);
		}
	} else if (role === "assistant") {
		for (const text of userFacingTextOf((message as { content: unknown }).content, ctx?.failedOutputCalls ?? failedOutputCallIds([message]))) {
			parts.push(`### Teacher${anchor}\n\n${text.trim()}`);
		}
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const [contentIndex, block] of message.content.entries()) {
				if (block.type !== "toolCall") continue;
				const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
				if (annotation.status === "posed") parts.push(`### Question${anchor}\n\n${annotation.snapshot.input.question}`);
			}
		}
	} else if (role === "toolResult") {
		const result = message as ToolResultMessage;
		if (result.isError || result.toolName === SEND_TO_USER_TOOL) return null; // contexto de reintento o acuse de salida, no evidencia de aprendizaje
		const { heading, body } = toolResultBody(result, ctx);
		parts.push(`### ${heading}${anchor}\n\n${citationsToReadableText(body.join("\n\n"))}`);
	}

	// los marcadores personalizados son invisibles, igual que en la vista de extracción.
	return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Una sesión entera (o un LOTE de extracción — el mismo motor, un subconjunto de
 * mensajes) como un documento markdown. Los bloques se renderizan en orden de
 * mensaje; los mensajes que no renderizan nada se omiten en silencio. El título
 * opcional acuña la cabecera del documento (`# <title>`).
 */
export function sessionMarkdown(
	messages: ReadonlyArray<LhMessage>,
	opts: { title?: string; anchors?: boolean } = {},
): string {
	const blocks: string[] = [];
	if (opts.title !== undefined && opts.title.length > 0) blocks.push(`# ${opts.title}`);
	const ctx = markdownContext(messages);
	for (const message of messages) {
		const block = messageMarkdown(message, (message as { id?: string }).id ?? "", opts.anchors ?? true, ctx);
		if (block !== null) blocks.push(block);
	}
	return blocks.join("\n\n");
}
