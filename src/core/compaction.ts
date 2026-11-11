/**
 * COMPACTACIÓN (ronda 14 del responsable, 2026-10-05): la mecánica para
 * ajustar el contexto, con un port local acotado de la selección del punto
 * de corte de Pi coding-agent 1.4.0. Sin dependencia de coding-agent. Consulta
 * docs/compaction-accounting.md para el límite de comportamiento, los
 * fixtures dorados nativos y el aviso MIT del proyecto original.
 *
 * EL CONTRATO: el historial completo sigue persistido en el registro — la
 * extracción y la transcripción del usuario siguen leyéndolo todo. Un
 * marcador de compactación (LhMarkerMessage, customType "compaction") lleva
 * un resumen más el corte (firstKeptMessageId); toLlmMessages — la ÚNICA
 * frontera de cara al modelo — proyecta [resumen] + [mensajes desde el corte]
 * en cada petición. El agente vivo nunca retiene mensajes descartados porque
 * cada ejecución se construye desde cero a partir del registro: plantear una
 * pregunta o un problema termina su ejecución, así que la pausa en la que «el
 * usuario está pensando» es siempre una ventana ENTRE EJECUCIONES — la
 * compactación se dispara al asentarse el turno (se ejecuta durante la pausa)
 * y cada inicio de turno espera a la barrera. No existe cirugía a mitad de
 * ejecución.
 *
 * Umbral de disparo (decisión del responsable): efectivo = min(umbral de
 * ajustes, contextWindow del modelo − reserva de 16k). Valores por defecto:
 * umbral 150k, cola conservada de ~20k tokens recientes (los valores por
 * defecto de pi, aprobados por el responsable). La estimación de tokens sigue
 * la ley de pi (corrección del incidente del 2026-10-05): se ancla en el uso
 * informado por el proveedor del último mensaje del asistente, y chars/4 solo
 * para los mensajes añadidos después de ese ancla; la heurística sola se
 * ejecuta únicamente cuando aún no existe ningún uso.
 *
 * Contenido del resumen (los tres requisitos del responsable + continuidad):
 * la comprensión del alumno y su EVOLUCIÓN (resultados de los cuestionarios,
 * confianza, ideas erróneas — una imagen detallada de lo que sabe el
 * usuario), el arco de enseñanza / la progresión de la sesión, y el árbol de
 * dependencias del plan LITERAL (de record.tree — el resultado de la
 * herramienta plan_init puede quedar antes del corte, así que el marcador lo
 * vuelve a inyectar). Más el momento actual (cualquier pregunta o problema
 * pendiente y el siguiente paso inmediato) para que el modelo posterior al
 * corte pueda continuar a mitad de razonamiento.
 */

import { citationsToReadableText } from "./citations.ts";
import type { PlanTree } from "./contracts/plan.ts";
import { derivePlanStatusesLh, derivedNodeStatus } from "./contracts/plan.ts";
import { COMPACTED_HISTORY_HEADER } from "./contracts/chat.ts";
import type { LhMessage, LhMarkerMessage } from "./native-messages.ts";
import { newMessageId } from "./native-messages.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage, SystemMessage } from "@earendil-works/pi-ai";

// ─── constantes (los parámetros ajustables, aprobados por el responsable) ────

/** Presupuesto de la cola reciente conservada (valor por defecto de pi,
 * aprobado por el responsable el 2026-10-05): ~20k tokens de transcripción
 * reciente literal van siempre tras el resumen — lo reciente es un seguro
 * barato contra lo que se pierda en el resumen. */
export const KEEP_RECENT_TOKENS = 20_000;

/** La reserva que se resta del contextWindow del modelo cuando la ventana
 * (y no el umbral del usuario) es la restricción que manda (valor por
 * defecto de pi). */
export const COMPACTION_RESERVE_TOKENS = 16_384;

/** Valor de fábrica del umbral de ajustes (decisión del responsable: 150k). */
export const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 150_000;

/** Truncado de resultados de herramientas al serializar el tramo para el
 * resumidor (réplica de pi: los resultados largos de tareas/investigación no
 * necesitan incluirse literalmente en la ENTRADA DEL RESUMEN — la cola
 * conservada los lleva enteros). */
const SUMMARY_TOOL_RESULT_TRUNCATE = 2_000;

// ─── estimación de tokens (ley de pi: anclada en el uso, chars/4 solo cola) ─

/** Tokens de contexto a partir de un bloque de uso informado por el
 * proveedor — la medida más honesta de «lo que la última petición llevó de
 * verdad». Replica calculateContextTokens de pi. */
export function calculateContextTokens(usage: {
	totalTokens?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}): number {
	return (
		usage.totalTokens ||
		(usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
	);
}

/** La heurística de Pi 1.4.0: texto + thinking + nombre/argumentos de
 * toolCall para los asistentes, y texto del contenido más una asignación fija
 * por imagen para los demás roles. NUNCA JSON.stringify del mensaje entero —
 * el andamiaje del registro (ids, usage, responseId, detalles del lado de la
 * app, comillas y barras escapadas) infla ~3x (medido en el incidente de
 * bases de datos relacionales del 2026-10-05: 84k estimados frente a ~30k
 * reales). Pasar un modelo activa el suelo de uso de salida de Responses del
 * mismo modelo; omitirlo conserva la heurística original. */
export function estimateMessageTokens(message: LhMessage | AgentMessage, model?: Model<Api>): number {
	const content: unknown = (message as { content?: unknown }).content;
	let chars = 0;
	if ((message as { role?: string }).role === "assistant") {
		let hasSignedThinking = false;
		for (const block of (Array.isArray(content) ? content : []) as Array<{
			type: string;
			text?: string;
			thinking?: string;
			thinkingSignature?: string;
			name?: string;
			arguments?: unknown;
		}>) {
			if (block.type === "text") chars += block.text?.length ?? 0;
			else if (block.type === "thinking") {
				chars += block.thinking?.length ?? 0;
				hasSignedThinking ||= typeof block.thinkingSignature === "string" && block.thinkingSignature.length > 0;
			} else if (block.type === "toolCall") chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? {}).length;
		}
		const assistant = message as AssistantMessage;
		const output = assistant.usage?.output;
		// La reproducción de Responses del mismo modelo incluye razonamiento opaco. Se cobra
		// la salida de la respuesta una vez, no la longitud de su texto cifrado ni su uso total.
		// ponytail: el uso de salida aproxima el tamaño reproducido; el exacto exige recuentos.
		if (model?.api === "openai-responses" && assistant.api === model.api &&
			assistant.provider === model.provider && assistant.model === model.id && hasSignedThinking &&
			assistant.stopReason !== "error" && assistant.stopReason !== "aborted" &&
			typeof output === "number" && Number.isSafeInteger(output) && output > 0) {
			return Math.max(Math.ceil(chars / 4), output);
		}
	} else {
		chars += textCharsOfContent(content);
		if (message.role === "system") {
			const system = message as SystemMessage;
			for (const section of Object.values(system.sections ?? {})) chars += section?.length ?? 0;
			if (system.toolsAdded) chars += JSON.stringify(system.toolsAdded).length;
		}
	}
	return Math.ceil(chars / 4);
}

// estimateTokens de Pi coding-agent 1.4.0: asignación fija por imagen, NO una
// medida del razonamiento cifrado ni de los tokens de visión reales del proveedor.
const ESTIMATED_IMAGE_CHARS = 4_800;
function textCharsOfContent(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content as Array<string | { type?: string; text?: string }>) {
		if (typeof block === "string") chars += block.length;
		else if (block?.type === "image") chars += ESTIMATED_IMAGE_CHARS;
		else if (block?.type === "text") chars += block.text?.length ?? 0;
	}
	return chars;
}

/** El mensaje del asistente más reciente que lleva un uso VÁLIDO informado
 * por el proveedor (regla de pi: se saltan los mensajes abortados o con error
 * y los usos todo a cero — no dicen nada cierto sobre lo enviado). El recorrido
 * SE DETIENE en el marcador de compactación más reciente: el uso capturado
 * antes de una compactación describía el contexto previo al corte — la
 * siguiente petición lleva en su lugar el resumen + la cola conservada, así
 * que el uso anterior al marcador no es un ancla válida (la ley de pi de «no
 * fiarse del uso capturado antes de una compactación posterior»). Índice en
 * messages, o null. */
export function lastAssistantUsageIndex(
	messages: readonly (LhMessage | AgentMessage)[],
): number | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if ((m as { role?: string }).role === "custom" && (m as LhMarkerMessage).customType === "compaction") return null;
		if ((m as { role?: string }).role !== "assistant") continue;
		const a = m as AssistantMessage & { stopReason?: string };
		if (a.stopReason === "aborted" || a.stopReason === "error") continue;
		if (calculateContextTokens((a.usage ?? {}) as Parameters<typeof calculateContextTokens>[0]) === 0) continue;
		return i;
	}
	return null;
}

export interface ContextTokenEstimate {
	/** La estimación que el disparador debe comparar con el umbral. */
	tokens: number;
	/** Tokens informados por el proveedor desde el ancla de uso (0 sin ancla). */
	usageTokens: number;
	/** Tokens estimados con chars/4 tras el ancla (o todo, sin ancla), con un
	 *  suelo de razonamiento opcional cuando se pasa un modelo. */
	trailingTokens: number;
	/** Índice del ancla de uso, o null (diagnóstico). */
	lastUsageIndex: number | null;
}

/** EL estimador del disparador (estimateContextTokens de pi): se ancla en el
 * último uso del asistente que informó el proveedor — prompt, herramientas,
 * densidad del tokenizador y todo — y estima con chars/4 SOLO lo añadido
 * después (con un suelo de razonamiento opcional). Nunca vuelve a estimar el
 * historial que el proveedor ya contó (el fallo de bases de datos
 * relacionales: JSON.stringify/4 del registro completo triplicaba el contexto
 * real y disparaba una sesión de 30k con un umbral de 80k). */
export function estimateContextTokens(
	messages: readonly (LhMessage | AgentMessage)[],
	model?: Model<Api>,
): ContextTokenEstimate {
	const anchor = lastAssistantUsageIndex(messages);
	if (anchor === null) {
		let trailing = 0;
		for (const m of messages) trailing += estimateMessageTokens(m, model);
		return { tokens: trailing, usageTokens: 0, trailingTokens: trailing, lastUsageIndex: null };
	}
	const anchored = messages[anchor]! as AssistantMessage;
	const usageTokens = calculateContextTokens(anchored.usage as Parameters<typeof calculateContextTokens>[0]);
	let trailing = 0;
	for (let i = anchor + 1; i < messages.length; i++) trailing += estimateMessageTokens(messages[i]!, model);
	return { tokens: usageTokens + trailing, usageTokens, trailingTokens: trailing, lastUsageIndex: anchor };
}

/** Estima una lista completa de mensajes, incluido el razonamiento reproducible cuando se pasa un modelo. */
export function estimateTokens(messages: readonly (LhMessage | AgentMessage)[], model?: Model<Api>): number {
	let total = 0;
	for (const m of messages) total += estimateMessageTokens(m, model);
	return total;
}

// ─── el recorrido del corte ──────────────────────────────────────────────────

/** Adaptador de entradas visibles para el modelo del port local del punto de
 * corte de Pi 1.4.0. Las entradas de compactación son límites, no candidatas
 * ordinarias al corte; los marcadores solo de interfaz no tienen contexto,
 * igual que las entradas de metadatos nativas. */
function cutMessage(message: LhMessage): LhMessage | null {
	if (message.role !== "custom") return message;
	if (["compaction", "plan-block", "problem-dismissed"].includes(message.customType)) return null;
	if (message.customType === "side-question" && !message.content) return null; // un marcador vacío no tiene texto visible para el modelo
	return message;
}

/** Port local de findCutPoint de pi-coding-agent 1.4.0 (MIT).
 * Recorre hacia atrás hasta >= presupuesto y luego elige el corte válido más
 * cercano EN esa entrada O DESPUÉS. Si unos resultados finales demasiado
 * grandes agotan el presupuesto, conserva la llamada del asistente que los
 * precede, no la sesión entera. Sin dimensionado de firmas cifradas ni
 * garantía exacta de tokens conservados. Devuelve el índice del primer
 * registro conservado; un corte cero o sin avance no descarta nada.
 * Mantén esto y estimateMessageTokens alineados a propósito al actualizar Pi.
 */
export function compactionCutIndex(messages: readonly LhMessage[], keepRecentTokens = KEEP_RECENT_TOKENS, model?: Model<Api>): number {
	const previous = activeCompactionOf(messages);
	const previousKept = previous ? keptIndexFor(messages, previous) : -1;
	const start = Math.max(0, previousKept);
	const points: number[] = [];
	for (let i = start; i < messages.length; i++) {
		const message = cutMessage(messages[i]!);
		if (message && (message.role === "user" || message.role === "assistant" || message.role === "custom")) points.push(i);
	}
	if (!points.length) return start;
	let cut = points[0]!;
	let accumulated = 0;
	for (let i = messages.length - 1; i >= start; i--) {
		const message = cutMessage(messages[i]!);
		const tokens = message ? estimateMessageTokens(message, model) : 0;
		if (tokens === 0) continue;
		accumulated += tokens;
		if (accumulated >= keepRecentTokens) {
			cut = points.find((candidate) => candidate >= i) ?? points.at(-1)!;
			break;
		}
	}
	// Las entradas nativas conservan los metadatos adyacentes sin contexto, pero
	// nunca se recorre hacia atrás cruzando una entrada de compactación anterior.
	while (cut > start) {
		const before = messages[cut - 1]!;
		if ((before.role === "custom" && before.customType === "compaction") || cutMessage(before)) break;
		cut--;
	}
	return cut;
}

// ─── el marcador ─────────────────────────────────────────────────────────────

/** Los detalles del marcador de compactación (carga para la interfaz — nunca
 * visibles para el modelo; el modelo ve el contenido, la cabecera + el resumen). */
export interface CompactionDetails {
	/** Id de registro del primer mensaje CONSERVADO: la proyección muestra el
	 * resumen y luego todo desde este mensaje en adelante. */
	firstKeptMessageId: string;
	/** Los tokens de contexto estimados que dispararon esta compactación
	 * (procedencia para el tooltip/diálogo del separador). */
	tokensBefore: number;
	/** provider:id del modelo que escribió el resumen (el propio modelo de la
	 * sesión — decisión del responsable; procedencia, nunca dato de enrutado). */
	model?: string;
	/** Marca de tiempo ISO del momento de la compactación. */
	at: string;
}

/** Construye el marcador de compactación. El contenido es el texto COMPLETO de
 * cara al modelo (cabecera + resumen — cabecera de una sola fuente); el
 * marcador va en el registro en el MOMENTO de la compactación (cerca del final
 * de la transcripción), mientras que el corte que nombra está muy atrás en el
 * historial: la interfaz muestra ambos sitios. */
export function newCompactionMarker(summary: string, details: CompactionDetails): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "compaction",
		content: `${COMPACTED_HISTORY_HEADER}\n\n${summary.trim()}`,
		display: true,
		details,
		timestamp: Date.now(),
	};
}

/** El marcador de compactación ACTIVO: el más reciente con un id de mensaje
 * conservado. Su resumen sustituye a los marcadores anteriores aunque sus
 * posiciones guardadas sigan dentro de su cola conservada. */
export function activeCompactionOf(messages: readonly LhMessage[]): (LhMarkerMessage & { details: CompactionDetails }) | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as LhMarkerMessage;
		if (marker.customType === "compaction") {
			const details = marker.details as Partial<CompactionDetails>;
			if (typeof details.firstKeptMessageId === "string") {
				return marker as LhMarkerMessage & { details: CompactionDetails };
			}
		}
	}
	return null;
}

/** El índice del primer mensaje CONSERVADO, o -1 cuando el marcador activo
 * del registro nombra un id que ya no existe (corrupto/ajeno) — quien llama
 * recurre a mostrarlo todo (degradación honesta, nunca lanza). */
export function keptIndexFor(messages: readonly LhMessage[], marker: LhMarkerMessage & { details: CompactionDetails }): number {
	const id = marker.details.firstKeptMessageId;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]!.id === id) return i;
	}
	return -1;
}

// ─── la entrada del resumidor (réplica de pi: texto etiquetado, truncado) ────

/** Serializa un tramo de mensajes como texto etiquetado para el resumidor.
 * Los resultados de herramientas se truncan en ~2k caracteres (la cola
 * conservada los lleva literales para el modelo; el RESUMEN solo necesita
 * su esencia). */
export function serializeForSummary(messages: readonly LhMessage[]): string {
	const lines: string[] = [];
	for (const m of messages) {
		const role = (m as { role?: string }).role;
		if (role === "user") {
			lines.push(`[LEARNER] ${citationsToReadableText((m as { content: string }).content)}`);
		} else if (role === "assistant") {
			const assistant = m as AssistantMessage;
			const blocks: string[] = [];
			for (const b of assistant.content) {
				if (b.type === "text") blocks.push(b.text);
				else if (b.type === "toolCall") blocks.push(`(tool call ${b.name}: ${JSON.stringify(b.arguments)})`);
				// bloques thinking: el borrador privado del modelo — sus
				// conclusiones acaban en el texto; se omite el ruido
			}
			if (blocks.length > 0) lines.push(`[TUTOR] ${blocks.join("\n")}`);
		} else if (role === "toolResult") {
			const result = m as ToolResultMessage;
			const text = result.content
				.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
				.join("\n");
			lines.push(
				`[RESULT for ${result.toolName}${result.isError ? " (error)" : ""}] ${
					text.length > SUMMARY_TOOL_RESULT_TRUNCATE ? `${text.slice(0, SUMMARY_TOOL_RESULT_TRUNCATE)}…[truncated]` : text
				}`,
			);
		} else if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "plan-block") continue; // solo interfaz
			if (marker.customType === "side-question" && !marker.content) continue;
			if (marker.customType === "side-question") lines.push(`[LEARNER–HELPER CONVERSATION] ${citationsToReadableText(marker.content)}`);
			else lines.push(`[SYSTEM NOTE] ${marker.customType === "practice-thinking" ? citationsToReadableText(marker.content) : marker.content}`);
		}
	}
	return lines.join("\n\n");
}

/** Muestra literalmente el árbol de dependencias del plan (requisito del
 * responsable: el árbol persiste a través de la compactación). Estructura de
 * record.tree, estados derivados de la transcripción (la ley propia del
 * registro: el árbol solo lleva estructura). Árbol vacío → sección ausente
 * (no se persistió nada). */
export function planTreeToText(tree: PlanTree | undefined, messages: readonly LhMessage[]): string | null {
	if (!tree || tree.nodes.length === 0) return null;
	const statuses = derivePlanStatusesLh(tree, messages);
	const byId = new Map(tree.nodes.map((n) => [n.id, n]));
	const lines: string[] = [];
	for (const node of tree.nodes) {
		const status = derivedNodeStatus(statuses, node.id);
		const summary = node.summary ? ` — ${node.summary}` : "";
		lines.push(`- [${status}] ${node.title} (${node.id})${summary}`);
	}
	for (const edge of tree.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (from && to) lines.push(`- ${from.title} → ${to.title} (${from.id} → ${to.id})`);
	}
	return lines.join("\n");
}

/**
 * El prompt del resumidor. La FORMA OBLIGATORIA del resumen (decisiones del
 * responsable): la comprensión del alumno Y su evolución, el arco de
 * enseñanza, el árbol del plan literal y el momento actual — por ese orden de
 * énfasis. El resumidor es el propio modelo de la sesión (decisión del
 * responsable), que escribe para su yo futuro: el resumen sustituye todo lo
 * anterior al corte.
 */
export function buildCompactionPrompt(input: {
	/** El tramo que se va a resumir, ya serializado (serializeForSummary). */
	spanText: string;
	/** El árbol del plan ya mostrado (planTreeToText) o null. */
	planTreeText: string | null;
	/** El tipo de sesión (redacción: tutor frente a agente de práctica). */
	kind: "teach" | "practice" | "probe";
}): string {
	const planSection =
		input.planTreeText ?? "No plan tree exists in this session (nothing was persisted).";
	return `You are compacting the earlier part of a tutoring session — writing the summary your future self will read INSTEAD of that transcript. Everything before the cut is replaced by what you write; everything after stays verbatim. The learner's transcript below labels the learner as [LEARNER], the tutoring agent as [TUTOR], tool traffic as [RESULT …]/[SYSTEM NOTE].

Write the summary with EXACTLY these sections, in this order:

## The learner's understanding
The most detailed picture you can give of what this learner knows and how that EVOLVED across the session: what they answered and how well (quiz outcomes, correct reasoning, mistakes), their stated or displayed confidence, misconceptions that surfaced, which were corrected and which still stand. This section carries the most weight — future teaching decisions hang on it.

## The teaching arc
How the session progressed: what was covered and in what order, which explanations landed and which didn't, how the learner responded, where the momentum went. Include probe-phase findings if present.

## The plan dependency tree
Reproduce the session's current plan tree verbatim from the structure below — do not drop nodes, edges, or statuses.

${planSection}

## The current moment
What is happening RIGHT NOW at the cut: any question or problem awaiting the learner's answer, any commitment the agent has made that a later turn must honor, and the immediate next step.

Rules: no praise, no filler, no speculation beyond the transcript. Every claim about the learner must be traceable to what they actually said or answered. Keep every identifier (proposition ids, node ids, file paths) exact.

TRANSCRIPT TO SUMMARIZE:

${input.spanText}`;
}
