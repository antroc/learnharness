/**
 * EL REGISTRO DE MENSAJES NATIVO (oleada B, aprobado por el responsable el
 * 2026-09-26): los registros de chat guardan las formas de mensaje propias de
 * pi — el historial exacto que construye el bucle del agente — en lugar de
 * UIMessages del AI-SDK. El proveedor, el modelo, el uso, stopReason y las
 * firmas del razonamiento los sella el propio pi; la reproducción es
 * `state.messages = record.messages` + `continue()` — el registro ES el
 * estado del agente.
 *
 * POR QUÉ LOS MENSAJES DE pi NO TIENEN NUESTRO `id`: el formato de sesión de
 * pi da un id a cada ENTRADA, nunca al mensaje. Esta app necesita un id por
 * mensaje para la identidad en el cliente (claves de React, adopción de solo
 * añadido, la frontera de continuación), así que cada mensaje del registro
 * lleva UN campo extra — `id` — junto a la forma nativa. `toLlmMessages` lo
 * quita al enviarlo: el proveedor nunca lo ve (punto único verificado, más
 * abajo).
 *
 * CONTENIDO SOLO DE INTERFAZ (decisión del responsable, bifurcación 1 + la
 * taxonomía de mensajes personalizados del plan): el traspaso de sondeo a
 * enseñanza, las reorientaciones de subagentes y los bloques de plan son
 * LhMarkerMessage — el miembro de esta app, fusionado por declaración, del
 * punto de extensión CustomAgentMessages de pi-agent-core, con exactamente la
 * forma del propio CustomMessage de pi ({role:"custom", customType, content,
 * display, details}). UNA frontera — toLlmMessages, conectada como
 * convertToLlm del agente — es dueña de toda decisión de cara al modelo: los
 * marcadores se aplanan a su texto de usuario canónico (de una sola fuente en
 * core/contracts), los bloques de plan son solo de interfaz y se filtran, y
 * las llamadas a herramientas colgantes (un turno abortado) reciben la
 * síntesis de resultado interrumpido que exige el protocolo del proveedor.
 *
 * Respuestas (bifurcación 1, responsable 2026-09-26): la respuesta del alumno
 * ES el ToolResultMessage de la llamada a la herramienta — se añade de forma
 * nativa al responder. El resultado provisional sintético de «pregunta
 * planteada» es un recurso del bucle en memoria (el terminate de la oleada A)
 * y nunca se persiste: el registro termina en la llamada sin responder dentro
 * de la ventana planteamiento→respuesta, donde no puede ejecutarse ningún
 * turno (la barrera de preguntas retiene las reorientaciones; un POST daría
 * 409).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { PluginSubmissionImages, PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import { ImmutableReadCache } from "./immutable-data.ts";
import { QUESTION_TOOLS, type PendingQuestion } from "./pending.ts";
import { pluginProblemForCall, readPluginProblemSubmission, type PluginProblemSnapshot } from "./plugin-problems.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import {
	CONCLUDE_ACK_TEXT,
	HANDOFF_TEXT,
	NEXT_PROBLEM_TEXT,
	THINKING_LABEL,
} from "./contracts/chat.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { parseQuestionInput } from "./tool-parts.ts";
import { expandCitationsForModel } from "./citations.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionAnswer, readPluginQuestionCancellation, samePluginQuestionOccurrence, type PluginQuestionAnnotationRead, type PluginQuestionOccurrence, type PluginQuestionOccurrenceMap, type PluginQuestionSnapshot } from "./plugin-questions.ts";

/** La redacción de invariante estricta para las llamadas sin responder de un
 *  turno abortado — conservada literal de la época anterior a lo nativo para
 *  que la vista del modelo nunca cambiara. */
export const INTERRUPTED_TEXT =
	"The question was interrupted — the learner never answered; continue without holding a result for it.";

// ─── El tipo de mensaje del registro ─────────────────────────────────────────

/**
 * El mensaje personalizado de la app (fusionado por declaración en
 * CustomAgentMessages de pi-agent-core, más abajo). Con la forma del propio
 * CustomMessage de pi — `content` es el texto DE CARA AL MODELO (de una sola
 * fuente en core/contracts, nunca habla humana falsa), `details` es la carga
 * para la interfaz (nunca visible para el modelo), `display` marca los
 * mensajes que muestra la interfaz (nuestra proyección decide qué mostrar por
 * customType; la marca documenta la intención).
 */
export interface LhMarkerMessage {
	/** Identidad en el registro (los mensajes de pi no llevan id — consulta la cabecera del fichero). */
	id: string;
	role: "custom";
	customType:
		| "graph-context"
		| "probe-handoff"
		| "subagent-steer"
		| "subagent-abort"
		| "plan-block"
		| "practice-thinking"
		| "plugin-problem-submission"
		| "practice-next"
		| "problem-dismissed"
		| "compaction"
		| "side-question"
		| "side-question-told";
	/** El texto de cara al modelo ("" en los bloques de plan — solo interfaz). */
	content: string;
	display: boolean;
	/** Carga para la interfaz según customType. Las imágenes del razonamiento de
	 * práctica también se proyectan a bloques nativos del modelo; su cadena de
	 * contenido sigue siendo la autoridad textual. */
	details: unknown;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		lhMarker: LhMarkerMessage;
	}
}

/** Un mensaje del registro: un mensaje nativo de pi (o nuestro marcador) más el id de registro. */
export type LhMessage = (UserMessage | AssistantMessage | ToolResultMessage | LhMarkerMessage) & {
	id: string;
	/** Presupuesto de contexto efectivo informado por la CLI, no un máximo de
	 * modelo del catálogo. Metadatos solo de la app: nunca se transmiten como
	 * contenido de mensaje al proveedor/modelo. */
	cliContextWindow?: number;
	/** Anotaciones de aparición propiedad del host, nunca entrada del modelo. */
	lhQuestions?: PluginQuestionOccurrenceMap;
	/** Vinculación exacta para resultados genuinos de preguntas de plugins (details sigue siendo el sobre público). */
	lhQuestionOccurrence?: PluginQuestionOccurrence;
};

/** Solo la última respuesta: nunca toma prestada la ventana de un proceso o
 * modelo anterior cuando una respuesta nueva no trae metadatos. La
 * compactación invalida el informe antiguo. */
export function cliContextWindowOf(messages: readonly LhMessage[]): { model: string; tokens: number } | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!;
		if (message.role === "custom" && message.customType === "compaction") return null;
		if (message.role !== "assistant") continue;
		const tokens = message.cliContextWindow;
		return message.provider === CLAUDE_CODE_PROVIDER && typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens > 0
			? { model: `${message.provider}:${message.model}`, tokens } : null;
	}
	return null;
}

/** Una lista de mensajes del registro se puede asignar al contexto del
 *  agente — eso ES la reproducción (ui-stream/chat-handler la asignan a
 *  initialState.messages). */
export function asAgentMessages(messages: readonly LhMessage[]): AgentMessage[] {
	return messages as unknown as AgentMessage[];
}

/** Los marcadores de preguntas laterales (#16) nunca cambian el significado
 *  de la cola del registro: un hilo lateral cerrado deja una pausa de
 *  descarte, un Reintentar, una recuperación o una continuación pendiente
 *  exactamente como los encontró. */
export function isSideQuestionMarker(m: LhMessage | AgentMessage | undefined): boolean {
	if ((m as { role?: string } | undefined)?.role !== "custom") return false;
	const type = (m as LhMarkerMessage).customType;
	return type === "side-question" || type === "side-question-told";
}

function tailIgnoringSideQuestions<T>(messages: readonly T[]): readonly T[] {
	let end = messages.length;
	while (end > 0 && isSideQuestionMarker(messages[end - 1] as never)) end--;
	return end === messages.length ? messages : messages.slice(0, end);
}

// ─── salida explícita de cara al alumno ─────────────────────────────────────

export const SEND_TO_USER_TOOL = "send_to_user";

/** Lee el mensaje de la herramienta de salida sin cambiar la llamada nativa.
 * También acepta argumentos parciales durante el streaming; las entradas mal
 * formadas o vacías no llevan prosa. Esta proyección no depende del modelo
 * seleccionado en ese momento. */
export function sendToUserText(block: unknown): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const call = block as { type?: unknown; name?: unknown; arguments?: unknown };
	if (call.type !== "toolCall" || call.name !== SEND_TO_USER_TOOL) return undefined;
	if (!call.arguments || typeof call.arguments !== "object") return undefined;
	const message = (call.arguments as { message?: unknown }).message;
	return typeof message === "string" && message.trim() ? message : undefined;
}

/** Prosa de cara al alumno, en el orden del contenido. Solo la herramienta de
 * salida explícita se suma aquí al texto ordinario — el razonamiento y todas
 * las demás entradas de herramientas quedan fuera. La comparten la
 * cobertura/extracción y el Markdown; el historial nativo queda intacto. */
export function userFacingTextOf(content: unknown, failedOutputCalls?: ReadonlySet<string>): string[] {
	if (typeof content === "string") return content.trim() ? [content] : [];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "toolCall" && failedOutputCalls?.has(block.id)) continue;
		const text = block.type === "text" ? block.text : sendToUserText(block);
		if (typeof text === "string" && text.trim()) out.push(text);
	}
	return out;
}

/** Las llamadas de salida fallidas siguen siendo contexto para reintentar,
 * no enseñanza entregada. Las llamadas truncadas pueden tener argumentos
 * parciales de aspecto válido. Las generaciones fallidas/abortadas no
 * ejecutan sus llamadas en absoluto, así que pueden no tener resultado. */
export function failedOutputCallIds(messages: readonly LhMessage[]): ReadonlySet<string> {
	const failed = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.toolName === SEND_TO_USER_TOOL && message.isError) {
			failed.add(message.toolCallId);
		} else if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
			for (const block of message.content) {
				if (block.type === "toolCall" && block.name === SEND_TO_USER_TOOL) failed.add(block.id);
			}
		}
	}
	return failed;
}

// ─── acuñación de ids ────────────────────────────────────────────────────────

/** La forma de id de mensaje de toda la app (la misma que se acuñaba en la época de UIMessage). */
export function newMessageId(): string {
	return `msg_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

// ─── constructores (la correspondencia evento de entrada → añadido nativo vive en
//     core/input-events.ts; las reorientaciones, en core/contracts/jobs.ts) ───

/** Un mensaje de usuario escrito por el alumno (entrada de texto, nota del veredicto). */
/** Mantiene sin cambios el almacenamiento heredado solo de texto; las imágenes explícitas pasan a bloques nativos. */
export function nativeInlineImageContent(text: string, images?: readonly ImageContent[]): string | (TextContent | ImageContent)[] {
	return images?.length ? [...(text ? [{ type: "text" as const, text }] : []), ...images.map(image => ({ ...image }))] : text;
}

/** El texto compacto de la respuesta es la única autoridad textual; las etiquetas identifican los canales de imagen. */
export function nativeAnswerContent(answerText: string, images?: PluginSubmissionImages): ToolResultMessage["content"] {
	const content: ToolResultMessage["content"] = [{ type: "text", text: answerText }];
	for (const [channel, label] of [["answer", "Answer images"], ["thinking", "Question thinking images"], ["readingThinking", "Reading thinking images"]] as const) {
		if (!images?.[channel]?.length) continue;
		content.push({ type: "text", text: `${label}:` }, ...images[channel]!.map(image => ({ ...image })));
	}
	return content;
}

export function newUserMessage(text: string, images?: readonly ImageContent[]): LhMessage & UserMessage {
	return {
		id: newMessageId(),
		role: "user",
		content: nativeInlineImageContent(text, images),
		timestamp: Date.now(),
	};
}

/** Un mensaje de usuario de reorientación (reorientación desde el
 *  compositor a mitad de turno, responsable 2026-10-03): un mensaje de usuario
 *  normal con el id de reorientación acuñado por el CLIENTE — el mismo objeto
 *  pasa por agent.steer(), por los eventos de mensaje del stream vivo y por el
 *  registro asentado, para que el indicador optimista de encolado y la
 *  tarjeta de la transcripción se actualicen con una misma identidad. */
export function newUserSteer(text: string, id: string, images?: readonly ImageContent[]): LhMessage & UserMessage {
	return { id, role: "user", content: nativeInlineImageContent(text, images), timestamp: Date.now() };
}

/** La respuesta del alumno — el resultado de herramienta de la llamada de
 *  pregunta (bifurcación 1). DOS PÚBLICOS (responsable, dieta de resultados
 *  de herramientas 2026-10-02): el MODELO ve el registro compacto solo del
 *  alumno (compactAnswerForModel — los propios argumentos de la llamada ya
 *  llevan la pregunta/opciones/explicación/compromiso; repetirlos duplicaba
 *  los tokens de cada respuesta), mientras que `details` conserva el
 *  QuestionAnswerData COMPLETO calificado para el registro y la interfaz. */
export function newAnswerResult(
	toolCallId: string,
	toolName: string,
	answer: unknown,
): LhMessage & ToolResultMessage {
	return {
		id: newMessageId(),
		role: "toolResult",
		toolCallId,
		toolName,
		content: nativeAnswerContent(JSON.stringify(compactAnswerForModel(answer as QuestionAnswerData)), (answer as QuestionAnswerData).images),
		// 0.87.1 estrechó ToolResultMessage.details a JsonRepresentation — nuestras
		// cargas son estructuras de respuesta seguras para JSON, así que la conversión es honesta.
		details: answer as ToolResultMessage["details"],
		isError: false,
		timestamp: Date.now(),
	};
}

/** El despertar del traspaso de sondeo a enseñanza: andamiaje, no habla — el
 *  modelo lee HANDOFF_TEXT y la interfaz muestra la discreta línea de
 *  sistema. */
export function newHandoffMessage(chatId: string): LhMarkerMessage {
	return {
		id: `steer_probe_${chatId}`,
		role: "custom",
		customType: "probe-handoff",
		content: HANDOFF_TEXT,
		display: true,
		details: { chatId },
		timestamp: Date.now(),
	};
}

/** El bloque de presentación del plan: historial puro de interfaz (una
 *  instantánea congelada), sin cara para el modelo — toLlmMessages lo
 *  filtra. `planCallId` identifica la emisión idempotente (un bloque por cada
 *  llamada correcta a plan_init). */
export function newPlanBlockMessage(
	planCallId: string,
	block: unknown,
): LhMarkerMessage {
	return {
		id: `pb_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		role: "custom",
		customType: "plan-block",
		content: "",
		display: true,
		details: { planCallId, block },
		timestamp: Date.now(),
	};
}

// ─── sesiones de práctica (responsable, 2026-10-04) ──────────────────────────

/** Las dos herramientas del agente de práctica (el vocabulario de la barrera
 *  de concluir antes del siguiente problema — la capa de ejecución de
 *  herramientas es dueña de las herramientas en sí). */
export const PRACTICE_PROBLEM_TOOL = "problem";
export const PRACTICE_CONCLUDE_TOOL = "conclude";

/** Una proposición elegida del marcador de contexto del grafo (la elección
 *  del alumno en el mapa — nombre + enunciado tal como los VIO el alumno al
 *  elegirlos). */
export interface GraphContextPick {
	id: string;
	name: string;
	statement: string;
}

/** El contexto del mapa de la sesión (responsable, 2026-10-04): un mensaje
 *  personalizado APARTE ANTES del primer mensaje de usuario del alumno — las
 *  proposiciones elegidas más las cadenas de razonamiento entre ellas (líneas
 *  preformateadas, con la forma de formatChainLine). El modelo lee `content`
 *  (aplanado a mensaje de usuario por toLlmMessages, como todo marcador);
 *  `details` alimenta la GraphContextCard plegable de la transcripción. Se
 *  acabó el texto semilla pegado al primer prompt. */
export function newGraphContextMessage(picks: readonly GraphContextPick[], chains: readonly string[]): LhMarkerMessage {
	// PRIMERO LOS IDS (ronda 9 del responsable, 2026-10-05 — el contrato de la traza de
	// dominio): cada proposición se presenta UNA vez con su id, nombre y enunciado;
	// el campo `target` de la herramienta de problema recibe estos ids (los nombres se
	// normalizan a ids en la frontera). Las cadenas de abajo siguen siendo NOMBRES — son
	// contexto de comprensión, no etiquetas; los nombres se leen, los ids referencian.
	const lines = [
		// LEY DEL PREÁMBULO (responsable, 2026-10-10): los marcadores personalizados se
		// aplanan a mensajes con rol USER al enviarse (toLlmMessages) — este texto llega por
		// el canal de voz del alumno, así que no debe sonar a un comunicado del sistema. La
		// convención de corchetes (pariente de NEXT_PROBLEM_TEXT) lo marca con honestidad
		// como contexto de sesión inyectado, no como habla del alumno.
		"[Session context] — picked from the learner's knowledge map when starting this session:",
		"",
		"Propositions (id — name: statement; the problem tool's target field uses these ids):",
		...picks.map((p) => `- [${p.id}] ${p.name}: ${p.statement}`),
	];
	if (chains.length > 0) {
		lines.push("", "Reasoning chains among them (premises → conclusion):", ...chains.map((c) => `- ${c}`));
	}
	return {
		id: newMessageId(),
		role: "custom",
		customType: "graph-context",
		content: lines.join("\n"),
		display: true,
		details: { propositions: picks, chains },
		timestamp: Date.now(),
	};
}

/** El envío del razonamiento del alumno (UN carril de envío, ronda del
 *  responsable del 2026-10-05): el registro ya no lo declara un botón — el
 *  modelo LEE el texto para distinguir las trazas de trabajo de las
 *  respuestas afirmadas. La etiqueta del contenido es la única "Your
 *  thinking"; `details` conserva la carga en bruto para la tarjeta de la
 *  transcripción. Un problema puede llevar muchos envíos. */
export function newThinkingMessage(problemCallId: string, text: string, images?: readonly ImageContent[]): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-thinking",
		content: `${THINKING_LABEL}:\n${text}`,
		display: true,
		details: { problemCallId, text, ...(images?.length ? { images: images.map(image => ({ ...image })) } : {}) },
		timestamp: Date.now(),
	};
}

/** La señal explícita del alumno para avanzar (ronda 16 del responsable):
 *  la añade la siguiente entrada (el chip de la banda del compositor, o Enter
 *  con el compositor vacío durante la pausa entre problemas). El contenido es
 *  NEXT_PROBLEM_TEXT, de una sola fuente — la aprobación inequívoca para el
 *  modelo; la transcripción muestra su propia línea compacta a partir del
 *  marcador (nunca del contenido). */
export function newNextMessage(): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-next",
		content: NEXT_PROBLEM_TEXT,
		display: true,
		details: {},
		timestamp: Date.now(),
	};
}

/** El marcador de descarte de problema (descarte al estilo de ask,
 *  responsable 2026-10-04): SOLO DE INTERFAZ — toLlmMessages lo filtra. Su
 *  cara para el modelo llega después, con la siguiente entrada del usuario,
 *  como el par de conclusión sintetizado (concludedByDismissalPair, más
 *  abajo) — el agente ve el descarte como una llamada de conclusión que
 *  «hizo» con resultado "dismissed", de modo que el estado de ranura liberada
 *  y el descarte se leen con el único vocabulario que conoce. */
export function newProblemDismissedMarker(problemCallId: string): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "problem-dismissed",
		content: "",
		display: true,
		details: { problemCallId },
		timestamp: Date.now(),
	};
}

/** La conclusión diferida del descarte (decisión del responsable del
 *  2026-10-04): el par que se antepone a la SIGUIENTE entrada del usuario —
 *  un mensaje sintético del asistente con una llamada de conclusión
 *  (resultado "dismissed") más su resultado de acuse, de modo que tanto el
 *  registro como el contexto del modelo leen el problema como concluido por
 *  descarte, con la ranura liberada. Puro; los ids son deterministas a partir
 *  del id de la llamada del problema (forma idempotente — la barrera de
 *  descartes pendientes garantiza que el par se añade como mucho una vez por
 *  marcador). */
export function concludedByDismissalPair(
	problemCallId: string,
): [LhMessage & AssistantMessage, LhMessage & ToolResultMessage] {
	const callId = `call_conc_${problemCallId}`;
	const now = Date.now();
	// Los sellos son provisionales por diseño: la serialización del historial lee
	// SOLO los bloques de contenido (verificado en los conversores de pi-ai), y el
	// canal del dinero de la app es el registro paralelo de turnos, nunca los objetos
	// de mensaje — así que "synthetic" nunca corrompe una vista enviada ni un plegado de costes.
	const syntheticStamps = {
		api: "faux",
		provider: "synthetic",
		model: "synthetic-conclude",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
	} as const;
	return [
		{
			id: newMessageId(),
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name: PRACTICE_CONCLUDE_TOOL, arguments: { outcome: "dismissed" } }],
			timestamp: now,
			...syntheticStamps,
		},
		{
			id: newMessageId(),
			role: "toolResult",
			toolCallId: callId,
			toolName: PRACTICE_CONCLUDE_TOOL,
			content: [{ type: "text", text: CONCLUDE_ACK_TEXT }],
			details: { outcome: "dismissed", problemCallId },
			isError: false,
			timestamp: now,
		},
	];
}

/** El plegado del problema activo (la barrera de concluir antes del siguiente
 *  problema): la llamada de herramienta de problema MÁS RECIENTE sin nada que
 *  la concluya después — una llamada de conclusión o un marcador de descarte
 *  la desactivan. El resultado de acuse al plantearla NO (el problema sigue
 *  en pantalla durante los empujoncitos; el sujeto del dock es la llamada, no
 *  un resultado colgante). */
/** Los ids de las llamadas a herramientas cuyos resultados están LIMPIOS (sin
 *  error) — las únicas llamadas que llegaron a ocurrir, según la decisión de
 *  activación honesta. */
function cleanToolCallIds(messages: readonly LhMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage;
		if (!result.isError) ids.add(result.toolCallId);
	}
	return ids;
}

/** Reconocimiento común del planteamiento de práctica, independiente de los plugins activados en ese momento. */
export function practiceProblemForCall(messages: readonly LhMessage[], occurrence: PluginSubmissionOccurrence): { input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	const owner = messages.find(message => message.id === occurrence.messageId && message.role === "assistant") as (AssistantMessage & { id: string }) | undefined;
	const call = owner?.content[occurrence.contentIndex];
	if (call?.type !== "toolCall" || call.id !== occurrence.toolCallId || call.name !== occurrence.toolName) return null;
	if (call.name === PRACTICE_PROBLEM_TOOL) return { input: call.arguments };
	const pluginProblem = pluginProblemForCall(messages, occurrence);
	return pluginProblem ? { input: pluginProblem.input, pluginProblem } : null;
}

/** La conclusión revela la solución comprometida por el planteamiento limpio
 * más reciente ANTES de esta llamada física de conclusión, nunca un
 * planteamiento posterior del mismo lote. La alternativa heredada de
 * solutionReveal solo en la conclusión sigue siendo cosa de la tarjeta. */
export function modelSolutionForConclude(
	messages: readonly LhMessage[],
	concludeCallId: string,
): string | undefined {
	const input = problemInputForConclude(messages, concludeCallId);
	return typeof input?.modelSolution === "string" ? input.modelSolution : undefined;
}

/** El plegado completo del lado del planteamiento (ronda 17 del responsable,
 * 2026-10-06 — observabilidad): TODO lo que el agente rellenó en la llamada
 * del problema — modo, ids objetivo, enunciado, la solución comprometida —
 * unido a la parte de conclusión para que el cajón plegable «datos del
 * agente» de la tarjeta se muestre de forma pura. El mismo recorrido y la
 * misma ley de rechazo que la revelación: un planteamiento que el registro
 * nunca acusó (una llamada rechazada) no pliega nada. */
export function problemInputForConclude(
	messages: readonly LhMessage[],
	concludeCallId: string,
): { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown } | undefined {
	let mi = messages.findIndex(
		(m) =>
			(m as { role?: string }).role === "assistant" &&
			(m as AssistantMessage).content.some(
				(b) => b.type === "toolCall" && b.id === concludeCallId,
			),
	);
	if (mi < 0) return undefined;
	const concludeMessageIndex = mi;
	const clean = cleanToolCallIds(messages);
	for (; mi >= 0; mi--) {
		const m = messages[mi]!;
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		const lastIndex = mi === concludeMessageIndex
			? assistant.content.findIndex(block => block.type === "toolCall" && block.id === concludeCallId) - 1
			: assistant.content.length - 1;
		for (let bi = lastIndex; bi >= 0; bi--) {
			const block = assistant.content[bi]!;
			if (block.type !== "toolCall" || !clean.has(block.id)) continue;
			const problem = practiceProblemForCall(messages, { messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name });
			if (!problem) continue;
			return (problem.input ?? undefined) as
				| { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown }
				| undefined;
		}
	}
	return undefined;
}

export function activeProblemOf(
	messages: readonly LhMessage[],
): { toolCallId: string; input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	const active = activeProblemCallOf(messages);
	return active ? { toolCallId: active.occurrence.toolCallId, input: active.input, ...(active.pluginProblem ? { pluginProblem: active.pluginProblem } : {}) } : null;
}

/** Fuente exacta de la misma activación limpia que selecciona activeProblemOf. */
export function activeProblemOccurrenceOf(messages: readonly LhMessage[]): PluginSubmissionOccurrence | null {
	return activeProblemCallOf(messages)?.occurrence ?? null;
}

function activeProblemCallOf(messages: readonly LhMessage[]): { occurrence: PluginSubmissionOccurrence; input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	// ACTIVACIÓN HONESTA (decisión del responsable, 2026-10-05 — el incidente de BKT):
	// las llamadas solo cuentan a través de sus RESULTADOS — un problema se activa con su
	// acuse limpio, una conclusión libera con su acuse limpio; las llamadas con error y
	// las colgantes se omiten («o sale adelante o no»).
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "problem-dismissed") return null;
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage & { id: string };
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall") continue;
				if (block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // una conclusión LIMPIA libera
					continue; // conclusión con error/colgante: la liberación nunca ocurrió
				}
				const occurrence = { messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name };
				const problem = practiceProblemForCall(messages, occurrence);
				if (problem && cleanCallIds.has(block.id)) return { occurrence, ...problem };
				// planteamiento con error/colgante — no salió adelante; se sigue buscando
			}
			continue;
		}
	}
	return null;
}

/** ¿Hay un marcador de descarte de problema esperando su síntesis de
 *  conclusión? Los añadidos de text/continue leen esto: el par viaja con la
 *  siguiente entrada del usuario (input-events). Recorrido en el que gana el
 *  marcador más reciente: decide el primer marcador de descarte o la primera
 *  llamada de conclusión desde el final. */
export function pendingProblemDismissalOf(messages: readonly LhMessage[]): string | null {
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "problem-dismissed") {
				return (marker.details as { problemCallId?: unknown }).problemCallId as string;
			}
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall" && block.type !== "text") continue;
				if (block.type === "toolCall" && block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // una conclusión LIMPIA lo zanja
					continue; // con error/colgante: nunca ocurrió
				}
				if (block.type === "toolCall" && cleanCallIds.has(block.id) && practiceProblemForCall(messages, {
					messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name,
				})) return null; // cualquier planteamiento LIMPIO nativo/de plugin lo sustituye
			}
			continue;
		}
	}
	return null;
}

// ─── la única frontera de cara al modelo (el convertToLlm del agente) ────────

/** Los ids de cada toolResult de la cola (para el recorrido de llamadas colgantes). */
function resultIdsFrom(messages: readonly AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role === "toolResult") {
			ids.add((m as ToolResultMessage).toolCallId);
		}
	}
	return ids;
}

function expandUserCitations(message: UserMessage): UserMessage {
	if (typeof message.content === "string") return { ...message, content: expandCitationsForModel(message.content) };
	return { ...message, content: message.content.map((block) => (block.type === "text" ? { ...block, text: expandCitationsForModel(block.text) } : block)) };
}

/**
 * AgentMessage[] → lo que se envía al proveedor (el convertToLlm del agente —
 * exigido por la configuración del bucle de pi-agent-core, el ÚNICO lugar
 * donde viven las decisiones de cara al modelo):
 *
 * - user / assistant / toolResult pasan LITERALES — firmas, uso, sellos del
 *   proveedor, todo nativo — salvo nuestro campo `id` de registro.
 * - los marcadores se aplanan a un mensaje de usuario con su contenido (el
 *   texto canónico de una sola fuente en core/contracts); los bloques de plan
 *   son solo de interfaz y se filtran.
 * - las llamadas colgantes de mensajes del asistente generados con éxito (por
 *   ejemplo, una pregunta sin responder) reciben un resultado interrumpido
 *   sintetizado. Las generaciones con error/abortadas no: Pi descarta esos
 *   mensajes del asistente, así que fabricar sus resultados dejaría
 *   resultados huérfanos en lo enviado.
 *
 * Contrato (pi-agent-core): nunca lanza — una forma desconocida pasa intacta
 * en lugar de matar el bucle.
 */
export function toLlmMessages(messages: readonly AgentMessage[]): Message[] {
	// EL CORTE DE COMPACTACIÓN (ronda 14 del responsable, 2026-10-05): el marcador ACTIVO
	// (el más reciente — en compactaciones encadenadas manda la última) nombra el primer
	// mensaje conservado; todo lo anterior se sustituye por el contenido del marcador
	// (cabecera + resumen) mostrado UNA vez, arriba. Después se omiten todos los marcadores
	// de compactación de la cola conservada, incluidos los resúmenes antiguos cuyas
	// posiciones guardadas aún quedan tras el corte. Un corte que nombra un id que no
	// existe se degrada con honestidad (se muestra todo — nunca lanza).
	const lhMessages = messages as readonly LhMessage[];
	const active = activeCompactionOf(lhMessages);
	let start = 0;
	let head: Message | null = null;
	if (active) {
		const kept = keptIndexFor(lhMessages, active);
		if (kept > 0) {
			start = kept;
			head = {
				role: "user",
				content: [{ type: "text", text: active.content }],
				timestamp: active.timestamp,
			};
		}
	}
	// EL MENSAJE DE SISTEMA INICIAL ES ENVOLTORIO DE LA PETICIÓN, NUNCA CARGA
	// COMPACTABLE (el incidente de OpenRouter sin herramientas, responsable 2026-10-05):
	// el Agent de pi-agent-core siembra un SystemMessage con el prompt de sistema Y las
	// declaraciones de herramientas en state.messages[0]
	// (createInitialSystemMessage — "messages declare the provider-visible
	// loadout"). El registro nunca lo persiste (settleWith de ui-stream filtra ese
	// rol), así que los llamadores del camino del REGISTRO nunca lo ven — pero el
	// convertToLlm del Agent SÍ. El corte recorta el historial del REGISTRO;
	// cuando [0] es el envoltorio debe pasar POR DELANTE de la cabecera de
	// compactación, exactamente igual que el propio prepareRequest de pi vuelve a
	// aplicar context.systemPrompt + context.tools alrededor de su proyección.
	const leading =
		(messages[0] as { role?: string } | undefined)?.role === "system" ? (messages[0] as Message) : null;
	const out: Message[] = [];
	if (leading) out.push(leading);
	if (head) out.push(head);
	for (let i = leading ? Math.max(start, 1) : start; i < messages.length; i++) {
		const m = messages[i]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			// Marcadores solo de interfaz: bloques de plan y descartes de problemas (el par de
			// conclusión sintetizado lleva su cara para el modelo).
			// Los marcadores laterales vacíos no llevan ningún intercambio de cara al modelo.
			if (marker.customType === "plan-block" || marker.customType === "problem-dismissed") continue;
			if (marker.customType === "side-question" && !marker.content) continue;
			// La cabecera sustituye a todos los marcadores de compactación, no solo a su propia
			// posición guardada. Sin una cabecera resuelta, se conserva la alternativa existente
			// del historial completo, incluido el texto del resumen.
			if (marker.customType === "compaction" && head !== null) continue;
			const problemSubmission = marker.customType === "plugin-problem-submission" ? readPluginProblemSubmission(marker.details) : null;
			out.push({
				role: "user",
				content: problemSubmission ? nativeAnswerContent(marker.content, { answer: problemSubmission.images?.submission, thinking: problemSubmission.images?.thinking })
					: [{ type: "text", text: marker.customType === "practice-thinking" || marker.customType === "side-question" ? expandCitationsForModel(marker.content) : marker.content }, ...(marker.customType === "practice-thinking"
						? (marker.details as { images?: ImageContent[] } | null)?.images ?? [] : [])],
				timestamp: marker.timestamp,
			});
			continue;
		}
		// Quita los metadatos solo de la app de id/contexto de la CLI: lo enviado solo lleva la forma nativa.
		const { id: _id, cliContextWindow: _cliContextWindow, lhQuestions: _lhQuestions, lhQuestionOccurrence: _lhQuestionOccurrence, ...native } = m as LhMessage;
		// Las citas del alumno son enlaces en el registro; lo enviado las lleva expandidas
		// (core/citations.ts) — la única reescritura de cara al modelo.
		out.push(role === "user" ? expandUserCitations(native as UserMessage) : (native as Message));
		// Repara las llamadas sin responder de generaciones completadas, no las de
		// generaciones fallidas. Pi filtra él mismo los asistentes con error/abortados;
		// añadir resultados para sus llamadas no ejecutadas dejaría huérfanos.
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
			const calls = assistant.content.filter((b) => b.type === "toolCall");
			if (calls.length === 0) continue;
			const answered = resultIdsFrom(messages.slice(i + 1));
			for (const call of calls) {
				const contentIndex = assistant.content.indexOf(call);
				const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
				const occurrence = { messageId: (m as LhMessage).id, contentIndex, toolCallId: call.id, toolName: call.name };
				if (annotation.status === "absent" || annotation.status === "attempt" ? answered.has(call.id) : messages.slice(i + 1).some(result => pluginQuestionResultMatches(result as LhMessage, occurrence, annotation))) continue;
				out.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: INTERRUPTED_TEXT }],
					isError: false,
					timestamp: assistant.timestamp,
				});
			}
		}
	}
	return out;
}

// ─── recorridos nativos (las fronteras pending/phase de la época de UIMessage) ─

/** Empareja los resultados del host con la aparición exacta. Ni un id nativo
 * reutilizado, ni un acuse temporal, ni un resultado arbitrario otorgan
 * autoridad de respuesta. */
export function pluginQuestionResultMatches(
	message: LhMessage,
	occurrence: PluginQuestionOccurrence,
	annotation: PluginQuestionAnnotationRead,
): boolean {
	if (message.role !== "toolResult" || message.isError || message.toolCallId !== occurrence.toolCallId || message.toolName !== occurrence.toolName) return false;
	const cancellation = readPluginQuestionCancellation(message.details, annotation.status === "posed" ? annotation.snapshot : undefined);
	if (cancellation && samePluginQuestionOccurrence(cancellation.occurrence, occurrence)) {
		return annotation.status !== "unreadable" || !annotation.identity || cancellation.questionId === annotation.identity.questionId;
	}
	if (annotation.status !== "posed" || !message.lhQuestionOccurrence || !samePluginQuestionOccurrence(message.lhQuestionOccurrence, occurrence)) return false;
	return readPluginQuestionAnswer(message.details, annotation.snapshot) !== null;
}

export interface PluginQuestionCall {
	occurrence: PluginQuestionOccurrence;
	annotation: Exclude<PluginQuestionAnnotationRead, { status: "absent" }>;
	status: "answerable" | "unreadable" | "attempt" | "failed" | "streaming";
	/** Presente solo cuando la autoridad canónica guardada se analizó correctamente. */
	snapshot?: PluginQuestionSnapshot;
}

/** Preguntas guardadas sin resolver e intentos solo de visibilidad, primero
 * el mensaje más reciente y los hermanos en el orden del código fuente. Se
 * omiten las apariciones respondidas/canceladas. Los intentos (incluidos los
 * fallidos) NUNCA otorgan autoridad de pendiente. A diferencia del historial
 * integrado, la autoridad guardada de los plugins sobrevive a asistentes
 * posteriores. */
const pluginQuestionHistory = new ImmutableReadCache<PluginQuestionCall[]>();
export function pluginQuestionCallsOf(messages: readonly LhMessage[]): PluginQuestionCall[] {
	return pluginQuestionHistory.read(messages, undefined, () => scanPluginQuestionCalls(messages));
}
function scanPluginQuestionCalls(messages: readonly LhMessage[]): PluginQuestionCall[] {
	const calls: PluginQuestionCall[] = [];
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const message = messages[mi]!;
		if (message.role !== "assistant") continue;
		for (const [contentIndex, block] of message.content.entries()) {
			if (block.type !== "toolCall") continue;
			const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
			if (annotation.status === "absent") continue;
			const occurrence = { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name };
			if (messages.slice(mi + 1).some(result => pluginQuestionResultMatches(result, occurrence, annotation))) continue;
			const status = annotation.status === "posed" ? "answerable" : annotation.status === "unreadable" ? "unreadable"
				: message.stopReason === "error" || message.stopReason === "aborted" ? "failed"
				: message.stopReason === "pending" ? "streaming" : "attempt";
			calls.push({ occurrence, annotation, status, ...(annotation.status === "posed" ? { snapshot: annotation.snapshot } : {}) });
		}
	}
	return calls;
}

/** Solo autoridad guardada; sin consultar el registro actual ni nombres de herramientas, ni acuses en vivo. */
export function pendingPluginQuestionOf(messages: readonly LhMessage[]): PluginQuestionSnapshot | undefined {
	return pluginQuestionCallsOf(messages).find(call => call.status === "answerable")?.snapshot;
}
export const danglingPluginQuestionOf = pendingPluginQuestionOf;

/** La barrera de preguntas pendientes (el gemelo nativo de
 *  findPendingToolCall): la PRIMERA llamada de herramienta de pregunta
 *  respondible del mensaje del asistente MÁS RECIENTE sin resultado en la
 *  cola — nunca una generación fallida ni un fragmento mal formado. */
export function danglingQuestionOf(
	messages: readonly LhMessage[],
): { toolCallId: string; tool: string; input: unknown } | null {
	const question = questionCallsOf(messages).find(call => call.status === "answerable");
	return question ? { toolCallId: question.toolCallId, tool: question.tool, input: question.input } : null;
}

/** La misma autoridad, conservando los límites nativos para el dock del
 * cliente. Los ids de llamada únicos son estables aunque el id local de un
 * mensaje vivo se sustituya por su sello persistido. Solo los ids que chocan
 * necesitan una clave de borrador/restablecimiento cualificada por aparición;
 * esto nunca cambia los ids guardados ni lo que se envía en la respuesta. */
export function pendingQuestionOf(messages: readonly LhMessage[]): PendingQuestion | null {
	// turn_end incluye el acuse temporal de questionResult. La vista también lo
	// ignora: NO es la respuesta del alumno. Se excluye solo de la autoridad del
	// cliente, dejando intacta la política de resultados persistidos/del servidor.
	const question = questionCallsOf(messages.filter(message => !isLiveQuestionPlaceholder(message))).find(call => call.status === "answerable");
	if (!question) return null;
	let occurrences = 0;
	for (const message of messages) {
		// Un asistente c_ en streaming puede coexistir temporalmente con su copia guardada
		// durante la adopción de solo añadido. Las llamadas vivas nuevas ya se hacen únicas;
		// solo el historial asentado establece la reutilización.
		if (message.role !== "assistant" || message.id.startsWith("c_")) continue;
		for (const call of message.content) {
			if (call.type === "toolCall" && call.id === question.toolCallId) occurrences++;
		}
	}
	return {
		toolCallId: question.toolCallId, tool: question.tool, input: question.input,
		messageId: question.messageId, contentIndex: question.contentIndex,
		key: occurrences > 1 ? JSON.stringify([question.messageId, question.contentIndex, question.toolCallId]) : question.toolCallId,
	};
}

/** Solo cuenta el resultado c_ transitorio con el contrato de
 * questionResult. Las respuestas reales tienen details; los errores/abortos
 * siguen siendo resultados que resuelven. Esta frontera de compatibilidad
 * solo del cliente no reinterpreta un resultado null guardado. */
function isLiveQuestionPlaceholder(message: LhMessage): boolean {
	return message.role === "toolResult" && message.id.startsWith("c_") &&
		!message.isError && message.details === null &&
		(QUESTION_TOOLS as readonly string[]).includes(message.toolName);
}

export interface QuestionCall extends Omit<PendingQuestion, "key"> {
	status: "streaming" | "answerable" | "malformed" | "failed";
}

/** Solo el asistente nativo más reciente; los hermanos siguen en el orden de
 * las llamadas. Que no haya resultado NO prueba por sí solo que se planteara
 * una pregunta: las generaciones fallidas nunca ejecutan sus llamadas, y los
 * registros antiguos pueden contener entradas truncadas o sin validar. */
export function questionCallsOf(messages: readonly LhMessage[]): QuestionCall[] {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const assistant = messages[mi]!;
		if (assistant.role !== "assistant") continue;
		const answered = resultIdsFrom(messages.slice(mi + 1));
		const calls: QuestionCall[] = [];
		for (const [contentIndex, block] of assistant.content.entries()) {
			if (block.type !== "toolCall" || !(QUESTION_TOOLS as readonly string[]).includes(block.name) || answered.has(block.id)) continue;
			if (readPluginQuestionMessageAnnotation(assistant, contentIndex).status !== "absent") continue;
			const status = assistant.stopReason === "error" || assistant.stopReason === "aborted" ? "failed"
				: assistant.stopReason === "pending" ? "streaming"
				: assistant.stopReason === "length" || block.argumentsError || !parseQuestionInput(block.name, block.arguments) ? "malformed"
				: "answerable";
			calls.push({ toolCallId: block.id, tool: block.name, input: block.arguments,
				messageId: assistant.id, contentIndex, status });
		}
		return calls; // nunca revive llamadas antiguas, aunque este mensaje no tenga ninguna
	}
	return [];
}

/** Los despertares en segundo plano deben seguir esperando una acción
 * explícita del alumno cuando una pregunta no se puede usar. Liberar el
 * compositor no es permiso para reintentar. */
export function hasUnresolvedQuestion(messages: readonly LhMessage[]): boolean {
	return questionCallsOf(messages).length > 0 || pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable");
}

/** Los provisionales del cliente son acuses del bucle, no respuestas del alumno. */
export function malformedQuestionsOf(messages: readonly LhMessage[]): QuestionCall[] {
	return questionCallsOf(messages.filter(message => !isLiveQuestionPlaceholder(message))).filter(call => call.status === "malformed");
}

/** Ids de MENSAJE de los resultados correctos de probe_done, en el orden de
 *  la transcripción. Una llamada de una generación fallida/abortada no otorga
 *  autoridad de finalización. Su resultado posterior debe coincidir tanto en
 *  id de llamada como en nombre de herramienta, no debe ser un error y no
 *  debe rechazar explícitamente con details.ok:false. Los acuses limpios más
 *  antiguos sin ok:true siguen contando. Sin cambios en el historial. */
export function probeDoneResultIds(messages: readonly LhMessage[]): Set<string> {
	const calls = new Set<string>();
	const results = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant") {
			if (m.stopReason === "error" || m.stopReason === "aborted") continue;
			for (const block of m.content) {
				if (block.type === "toolCall" && block.name === "probe_done") calls.add(block.id);
			}
		} else if (
			m.role === "toolResult" && m.toolName === "probe_done" &&
			calls.has(m.toolCallId) && !m.isError &&
			(m.details as { ok?: unknown } | null | undefined)?.ok !== false
		) {
			results.add(m.id);
		}
	}
	return results;
}

/** La frontera de construcción de sondeo a enseñanza (chat-handler y la
 *  protección de la herramienta): solo una llamada concluida más un resultado
 *  correcto que coincida significa enseñar. */
export function hasProbeDone(messages: readonly LhMessage[]): boolean {
	return probeDoneResultIds(messages).size > 0;
}

/** Todos los ids de toolResult del registro — validación de eventos de
 *  respuesta (la llamada debe ser una llamada de pregunta COLGANTE, no una ya
 *  respondida). */
export function answeredCallIds(messages: readonly LhMessage[]): Set<string> {
	return resultIdsFrom(messages);
}

// ─── el plegado de continuación (oleada D: el
//     lastAssistantMessageIsCompleteWithToolCalls del SDK, en nativo) ─────────

/**
 * ¿TERMINA el registro en resultados de herramientas sin consumir — un turno
 * que se detuvo tras ejecutarse sus herramientas (el acuse del envío de una
 * tarea, un turno de respuesta abortado), dejando al agente con una
 * continuación pendiente? Es la barrera de la frontera de continuación al
 * montar/sincronizar (chat.tsx): cuando es true y no hay nada en ejecución,
 * el cliente envía {type:"continue"} y el profesor retoma desde el registro.
 *
 * El cliente anterior a la oleada D preguntaba al
 * lastAssistantMessageIsCompleteWithToolCalls del SDK (el último mensaje de
 * vista es del asistente; las llamadas a herramientas de su último paso
 * están todas en output-available u output-error; al menos una). El plegado
 * nativo sobre el registro: el último mensaje es un toolResult, y el mensaje
 * del asistente DUEÑO de los resultados tiene al menos una llamada, TODAS
 * respondidas (una pregunta colgante — terreno del dock — no cumple la regla
 * de todas respondidas y nunca dispara un turno, exactamente como hacía el
 * every(output-available) del SDK).
 */
/** ¿Es este mensaje del registro un resultado de pregunta descartada por el
 *  usuario? La respuesta completa viaja en los `details` del toolResult
 *  (newAnswerResult) — la leen tanto la pausa de descarte como el plegado de
 *  continuación. */
function isDismissedResult(m: LhMessage): boolean {
	if ((m as { role?: string }).role !== "toolResult") return false;
	const details = (m as { details?: unknown }).details as { dismissed?: unknown } | undefined;
	return details?.dismissed === true || readPluginQuestionCancellation((m as ToolResultMessage).details) !== null;
}

/** La pausa de descarte (diseño del responsable del 2026-10-03, «A2»): el
 *  registro termina en un descarte del usuario — la sesión espera al
 *  USUARIO. Mientras está en pausa, nada se despierta solo: el plegado de
 *  continuación no exige nada (abajo) y el proceso de despertar retiene las
 *  entregas de tareas en la cola de reorientación hasta el siguiente envío.
 *  Derivado de la cola — no hay cerrojo que persistir ni borrar; cualquier
 *  mensaje del usuario lo desactiva al cambiar el registro. */
export function endsInDismissal(record: readonly LhMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	const last = messages[messages.length - 1];
	return last !== undefined && isDismissedResult(last);
}

/** El clic de recuperación autoriza su turno de sustitución inmediato, no un
 * reinicio automático si solo sobrevivieron los resultados de error escritos
 * por adelantado. Sin cerrojo guardado nuevo: una entrada explícita o una
 * salida de sustitución cambian esta cola. */
export function endsInQuestionRecovery(record: readonly LhMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	const last = messages[messages.length - 1];
	return last?.role === "toolResult" && last.isError &&
		(last.details as { questionRecovery?: unknown } | null)?.questionRecovery === true;
}

export type RequestCause = "foreground" | "background";
export type ReconstructedCause = RequestCause | "ambiguous";
export type NativeInputCause = "learner" | "automatic" | "neutral" | "unrecognizable";
/** Solo causas nativas: los roles de usuario aplanados, los prefijos de los ids y la prosa no confieren permiso. */
export function nativeInputCause(message: AgentMessage, history: readonly AgentMessage[]): NativeInputCause {
	if (message.role === "user") return "learner";
	if (message.role === "system" || message.role === "assistant") return "neutral";
	if (message.role === "custom") {
		if (["probe-handoff", "subagent-steer", "subagent-abort"].includes(message.customType)) return "automatic";
		if (["practice-thinking", "plugin-problem-submission", "practice-next"].includes(message.customType)) return "learner";
		return ["graph-context", "plan-block", "problem-dismissed", "compaction", "side-question", "side-question-told"].includes(message.customType) ? "neutral" : "unrecognizable";
	}
	if (message.role === "toolResult") {
		const pluginAnswer = readPluginQuestionAnswer(message.details);
		if (pluginAnswer) {
			return pluginQuestionCallsOf(history as readonly LhMessage[]).some(call => call.annotation.status === "posed" && pluginQuestionResultMatches(message as LhMessage, call.occurrence, call.annotation)) ? "learner" : "unrecognizable";
		}
		if (readPluginQuestionCancellation(message.details)) return "neutral";
		if (message.isError && (message.details as { questionRecovery?: unknown } | null)?.questionRecovery === true) {
			return questionCallsOf(history as readonly LhMessage[]).some(call => call.status === "malformed" && call.toolCallId === message.toolCallId && call.tool === message.toolName) ? "learner" : "unrecognizable";
		}
		if (!(QUESTION_TOOLS as readonly string[]).includes(message.toolName) || message.isError || message.details == null || (message.details as { dismissed?: boolean }).dismissed) return "neutral";
		const details = message.details as Partial<QuestionAnswerData>;
		if (!["quiz", "ask", "explain"].includes(details.kind ?? "") || typeof details.questionText !== "string" || typeof details.dontKnow !== "boolean" || !Array.isArray(details.answers) || typeof details.answeredAt !== "string") return "unrecognizable";
		const calls = history.flatMap((m) => m.role === "assistant" ? m.content.filter((b) => b.type === "toolCall" && b.id === message.toolCallId) : []);
		return calls.length === 1 && calls[0]?.type === "toolCall" && calls[0].name === message.toolName ? "learner" : "unrecognizable";
	}
	return "unrecognizable";
}
/** El registro nativo persistido completo, incluidas las causas anteriores a la compactación. Nunca se supone primer plano. */
export function reconstructRequestCause(messages: readonly LhMessage[]): ReconstructedCause {
	let inherited: ReconstructedCause = "ambiguous";
	let triggers: NativeInputCause[] = [];
	const seen = new Map<string, string>();
	const history: AgentMessage[] = [];
	const resolve = (): ReconstructedCause => {
		if (triggers.includes("unrecognizable")) return "ambiguous";
		const lastLearner = triggers.lastIndexOf("learner"), lastAutomatic = triggers.lastIndexOf("automatic");
		if (lastLearner < 0 && lastAutomatic < 0) return inherited;
		if (lastAutomatic < 0) return "foreground";
		if (lastLearner < lastAutomatic) return "background";
		return "ambiguous";
	};
	for (const message of messages) {
		const cause = nativeInputCause(message, history);
		const id = (message as { id?: string }).id;
		if (id) {
			const value = JSON.stringify(message);
			if (seen.has(id)) { if (seen.get(id) !== value) triggers.push("unrecognizable"); continue; }
			seen.set(id, value);
		} else if (cause !== "neutral") triggers.push("unrecognizable");
		if (message.role === "assistant" && !(message.provider === "synthetic" && message.api === "faux" && message.model === "synthetic-conclude" && message.content.some((b) => b.type === "toolCall" && b.name === "conclude" && b.arguments?.outcome === "dismissed"))) {
			inherited = resolve(); triggers = [];
		} else if (cause !== "neutral") triggers.push(cause);
		history.push(message);
	}
	return resolve();
}

export function needsContinuation(record: readonly LhMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	if (pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable")) return false;
	const last = messages[messages.length - 1];
	if (!last || (last as { role?: string }).role !== "toolResult") return false;
	// El lote de resultados final (contiguo por construcción — el agente añade su lote;
	// la barrera de preguntas mantiene juntas una llamada de cuestionario y la
	// respuesta del alumno).
	let start = messages.length - 1;
	while (
		start > 0 &&
		(messages[start - 1] as { role?: string } | undefined)?.role === "toolResult"
	) {
		start--;
	}
	// La regla del descarte (A2 + decisión del responsable del 2026-10-03, incidente de
	// la ronda 1): decide la ÚLTIMA resolución del lote. Terminar en un descarte = el
	// usuario indicó PARAR — sin despertar, sin reacción pendiente ahora; las reacciones
	// a las respuestas viajan con el siguiente mensaje normal del usuario. Terminar en
	// una respuesta real = la reacción está pendiente. Una sola ley con la pausa de la
	// bomba (endsInDismissal lee el mismo último resultado), así que la continuación,
	// la retención de entregas y la pausa nunca pueden discrepar.
	if (isDismissedResult(messages[messages.length - 1]!) || endsInQuestionRecovery(messages)) {
		return false;
	}
	const owner = messages[start - 1];
	if (!owner || (owner as { role?: string }).role !== "assistant") return false;
	const content = (owner as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	const results = messages.slice(start) as ToolResultMessage[];
	// PRÁCTICA (diseño del responsable, 2026-10-04): un lote que acusa el PLANTEAMIENTO de
	// un problema no debe nada — terminate:true terminó ese turno A PROPÓSITO (el siguiente
	// envío de razonamiento del alumno es el siguiente turno), y a diferencia del
	// provisional de una pregunta, este acuse PERSISTE (el modelo lee después su propio
	// resultado "Problem posed"). Sin este plegado, recargar tras un planteamiento
	// despertaría un turno de continuación fantasma.
	const posedProblem = results.some(
		(m) => !m.isError && ((m.toolName === PRACTICE_PROBLEM_TOOL && m.details == null) ||
			(content as AssistantMessage["content"]).some((call, contentIndex) => call.type === "toolCall" && call.id === m.toolCallId && call.name === m.toolName &&
				!!pluginProblemForCall(messages, { messageId: owner.id, contentIndex, toolCallId: call.id, toolName: call.name }))),
	);
	if (posedProblem) return false;
	const answered = new Set(results.map((m) => m.toolCallId));
	const calls = (content as Array<{ type?: string; id?: string; name?: string }>).filter(
		(b) => b.type === "toolCall" && typeof b.id === "string",
	);
	return calls.length > 0 && calls.every((b) => {
		const contentIndex = content.indexOf(b);
		const annotation = readPluginQuestionMessageAnnotation(owner, contentIndex);
		return annotation.status === "absent" || annotation.status === "attempt" ? answered.has(b.id!) : results.some(result => pluginQuestionResultMatches(result as LhMessage, {
			messageId: owner.id, contentIndex, toolCallId: b.id!, toolName: b.name!,
		}, annotation));
	});
}
