/**
 * EL MODELO DE VISTA (oleada D, aprobada por el responsable el 2026-09-26): la
 * vista de transcripción del cliente — los mensajes nativos del registro (+ los
 * mensajes de trabajo del turno en vivo) agrupados en la forma exacta de render de
 * hoy. La referencia maestra es la interfaz anterior a la oleada D (bifurcación 1
 * del responsable): todo lo que produce el agente es UN documento continuo por
 * ejecución — separadores de paso entre los pasos del bucle, tarjetas de artefactos
 * y de respuestas en línea, y la reacción del profesor continuando debajo de un
 * cuestionario respondido.
 *
 * Este es el canon de agrupación de la proyección del servidor ya eliminada
 * (core/projection.ts, oleada B), trasladado al cliente, propiedad de la app, sin
 * ningún tipo del AI-SDK — más la capa del TURNO EN VIVO que la proyección nunca
 * tuvo: los estados de ejecución de herramientas a mitad de turno (input-streaming
 * → input-available/output-error/output), para que el dock se monte solo cuando una
 * llamada supera la frontera de validación (tool_execution_end) y el brillo nombre
 * la actividad en curso.
 *
 * REGLA DE AGRUPACIÓN: un mensaje de vista del asistente por GRUPO — mensajes
 * consecutivos de assistant + toolResult, delimitados por mensajes de usuario o
 * marcadores; los toolResult se asocian a la parte de herramienta de su llamada
 * (buscando hacia atrás — el resultado de un cuestionario respondido cae en la
 * parte que lo preguntó, aunque sea turnos después); el id de un grupo es el id de
 * su PRIMER mensaje del asistente.
 *
 * Bloques de plan: un marcador de bloque de plan no tiene mensaje propio — su parte
 * de datos se inserta en el grupo del asistente anterior, EN EL FLUJO justo después
 * de la última llamada correcta a plan_init (el momento de presentación).
 *
 * Herramientas de pregunta en la red (bifurcación 2 del responsable): el
 * tool_execution_end de cierre del agente lleva el provisional en memoria
 * "Question posed" — projectView IGNORA las ejecuciones limpias de preguntas (la
 * parte se queda en input-available; la respuesta del alumno llega como un
 * toolResult real). El provisional nunca se persiste, así que los registros
 * asentados nunca lo ven.
 *
 * Puro y determinista: seguro para el cliente (sin dependencias de node), misma
 * entrada → misma vista.
 */

import type { AssistantMessage, ImageContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { LhMarkerMessage, LhMessage } from "./native-messages.ts";
import { modelSolutionForConclude, PRACTICE_CONCLUDE_TOOL, problemInputForConclude, SEND_TO_USER_TOOL, sendToUserText, pluginQuestionResultMatches } from "./native-messages.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionCancellation, type PluginQuestionAnnotationRead } from "./plugin-questions.ts";
import { pluginProblemForCall, type PluginProblemSnapshot } from "./plugin-problems.ts";
import { activeCompactionOf, type CompactionDetails } from "./compaction.ts";
import { QUESTION_TOOLS } from "./pending.ts";
import type { SubagentArtifactData, SubagentResultMeta } from "./contracts/jobs.ts";
import type { PlanBlockData } from "./contracts/chat.ts";

/** Una parte proyectada de la transcripción que consumen los renderizadores del host y los
 * analizadores de fase y de entrada. type selecciona el vocabulario de la parte; los campos
 * comunes son opcionales porque las partes de texto, de herramientas y de datos llevan
 * contenidos distintos. Los campos adicionales quedan como desconocidos a través de la
 * firma de índice y requieren estrechamiento. */
export interface LhViewPart extends Record<string, unknown> {
	type: string;
	id?: string;
	text?: string;
	state?: string;
	toolCallId?: string;
	/** Ubicación nativa, conservada a través de la agrupación de visualización (solo cliente). */
	sourceMessageId?: string;
	sourceContentIndex?: number;
	/** Debe seleccionarse antes que cualquier renderizador genérico de herramientas; nunca
	 * es una traza en bruto. */
	pluginQuestion?: Exclude<PluginQuestionAnnotationRead, { status: "absent" }>;
	pluginProblem?: PluginProblemSnapshot;
	input?: unknown;
	output?: unknown;
	rawInput?: unknown;
	errorText?: string;
	/** Resultado nativo conservado para los renderizadores públicos de plugins y las
	 * alternativas legibles. */
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
	data?: unknown;
}

/** Un mensaje de la vista: del usuario (burbuja) o del asistente (una única secuencia continua). */
export interface LhViewMessage {
	id: string;
	role: "user" | "assistant";
	parts: LhViewPart[];
	/** Los metadatos de subagentResult que leen las tarjetas de reorientación (details del
	 * marcador). */
	metadata?: unknown;
}

/** El resultado de la ejecución en vivo de una llamada a herramienta (de tool_execution_end). */
export interface LiveExecution {
	isError: boolean;
	/** El contenido de details del resultado limpio (la salida de la tarjeta). */
	output?: unknown;
	/** El texto del fallo (partes output-error). */
	errorText?: string;
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
}

/** La capa de ejecución del turno en vivo, mantenida por el hook de la sesión. */
export interface LiveTurnState {
	/** toolCallId → el resultado de su ejecución visto hasta ahora. */
	executions: ReadonlyMap<string, LiveExecution>;
	/** True mientras el turno se ejecuta — las llamadas aún sin ejecución se
	 * renderizan como input-streaming (el brillo); las llamadas colgantes asentadas
	 * se renderizan como input-available (el dock se monta desde el registro). */
	inFlight: boolean;
	/** Ids de los mensajes que ESTE consumo está transmitiendo (ronda optimista 3,
	 * 2026-10-02): un mensaje en streaming que ha llegado vacío proyecta una parte
	 * de razonamiento vacía — la fila de razonamiento — para que el traspaso desde
	 * el provisional no se note; los mensajes vacíos asentados siguen ocultos. */
	streamingIds: ReadonlySet<string>;
}

function textPart(text: string): LhViewPart {
	return { type: "text", text, state: "done" };
}

/** El resultado que debe mostrar una parte de herramienta, a partir de un toolResult nativo. */
function applyResult(part: LhViewPart, result: ToolResultMessage): void {
	if (part.pluginQuestion) {
		// La prosa de contenido o de error escrita por el autor nunca debe escaparse por la traza genérica.
		if (result.isError) { part.state = "output-error"; return; }
		part.state = "output-available";
		part.output = result.details;
		return;
	}
	part.result = { content: result.content, details: result.details, isError: result.isError };
	if (result.isError) {
		part.state = "output-error";
		part.rawInput = part.input;
		const text = result.content.find((c) => c.type === "text");
		part.errorText = text && text.type === "text" ? text.text : "The tool call failed.";
	} else {
		part.state = "output-available";
		part.output = result.details;
	}
}

/** ¿Lleva este grupo del asistente un plan_init correcto (el destino de la inserción)? */
function lastSuccessfulPlanInit(parts: LhViewPart[]): number {
	let idx = -1;
	parts.forEach((p, i) => {
		if (p.type !== "tool-plan_init") return;
		const ok = (p.output as { ok?: unknown } | undefined)?.ok;
		if (ok === true) idx = i;
	});
	return idx;
}

/** Proyecta el registro nativo (+ la lista de trabajo del turno en vivo) en los mensajes
 * de vista del cliente. Puro: la misma entrada proyecta siempre la misma lista. */
export function projectView(messages: readonly LhMessage[], live?: LiveTurnState): LhViewMessage[] {
	const out: LhViewMessage[] = [];
	// Las llamadas de salida se convierten en texto en lugar de partes de herramienta, así que
	// se leen de antemano los fallos asentados: una llamada fallida debe conservar la ruta de error normal.
	const outputErrors = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.toolName === SEND_TO_USER_TOOL && message.isError) {
			outputErrors.set(message.toolCallId, message);
		}
	}

	const lastAssistant = (): LhViewMessage | undefined => {
		const last = out[out.length - 1];
		return last && last.role === "assistant" ? last : undefined;
	};
	const findToolPart = (result: LhMessage & ToolResultMessage): LhViewPart | undefined => {
		for (let i = out.length - 1; i >= 0; i--) {
			// Recorrido de partes del MÁS NUEVO AL MÁS ANTIGUO dentro de un grupo (la reparación
			// Lacan, 2026-10-04): un resultado se empareja con la llamada MÁS RECIENTE que lleve su
			// id. Con ids únicos (el uniquificador los garantiza en los turnos nuevos) el orden de
		// recorrido da igual; en los registros antiguos con ids duplicados (el `call_0` por
		// respuesta de DeepSeek) esto lleva cada respuesta a su propia llamada en lugar de dejar
		// que un resultado posterior sobrescriba la tarjeta de una pregunta anterior.
			const parts = out[i]!.parts;
			for (let p = parts.length - 1; p >= 0; p--) {
				const part = parts[p]!;
				if (!part.type.startsWith("tool-") || part.toolCallId !== result.toolCallId) continue;
				if (part.pluginQuestion) {
					const occurrence = { messageId: part.sourceMessageId!, contentIndex: part.sourceContentIndex!, toolCallId: part.toolCallId!, toolName: part.type.slice(5) };
					if (pluginQuestionResultMatches(result, occurrence, part.pluginQuestion) || (result.isError && part.pluginQuestion.status !== "posed")) return part;
					continue;
				}
				if (!result.lhQuestionOccurrence && !readPluginQuestionCancellation(result.details)) return part;
			}
		}
		return undefined;
	};

	// La compactación activa (ronda 14 del responsable): el plegado emite el DIVISOR DE
	// CORTE — el marcador más largo, situado en la frontera — justo ANTES del primer
	// mensaje conservado, para que la transcripción muestre exactamente dónde se resumió
	// el historial. Todo lo anterior sigue visible para el usuario (el historial completo
	// nunca se oculta); solo salta el contexto del MODELO.
	const compaction = activeCompactionOf(messages);

	for (const m of messages) {
		const role = (m as { role?: string }).role;

		if (compaction && m.id === compaction.details.firstKeptMessageId) {
			out.push({
				id: `cut_${compaction.id}`,
				role: "user",
				parts: [
					{
						type: "data-compaction-cut",
						id: `cc_${compaction.id}`,
						data: { content: compaction.content, details: compaction.details },
					},
				],
			});
		}

		if (role === "user") {
			const content = m.content as string | Array<{ type: string; text?: string }>;
			const parts = typeof content === "string" ? [textPart(content)] : content.flatMap((block): LhViewPart[] => {
				if (block.type === "text") return [textPart(block.text as string)];
				if (block.type === "image") return [{ ...block as ImageContent }];
				return [];
			});
			out.push({ id: m.id, role: "user", parts });
			continue;
		}

		if (role === "custom") {
			projectMarker(m as LhMarkerMessage, out);
			continue;
		}

		if (role === "toolResult") {
			applyResultTo(findToolPart(m as LhMessage & ToolResultMessage), m as ToolResultMessage);
			continue;
		}

		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			// DECISIÓN DEL RESPONSABLE (2026-09-26): el razonamiento SIEMPRE se renderiza encima
			// del mensaje al que pertenece. Los proveedores emiten tokens de razonamiento al final
			// (GLM lanza una ráfaga final de razonamiento después de la respuesta), lo que deja el
			// bloque de razonamiento DESPUÉS del texto en el contenido persistido — presentar el
			// orden de llegada tal cual ponía el razonamiento DEBAJO del mensaje. El canon de la
			// vista manda en el orden de presentación: partición estable de cada mensaje del
			// asistente, primero las partes de razonamiento (en su propio orden) y luego todo
			// lo demás.
			const rest: LhViewPart[] = [];
			const reasoning: LhViewPart[] = [];
			let textN = 0;
			let reasoningN = 0;
			// LO EN VIVO ES EVIDENCIA POSITIVA (responsable, 2026-10-05): una llamada se renderiza
			// en vivo SOLO cuando su propio mensaje está en streaming ESTE turno — que la sesión
			// esté ocupada no basta nunca para resucitar una llamada asentada (el fallo de la
			// práctica: un envío de razonamiento devolvía la llamada al problema del turno de
			// PLANTEAMIENTO a un indicador de carga a mitad de transcripción; las tarjetas en vivo
			// van abajo, y esta barrera es la que las pone ahí por construcción).
			const streamingMessage = live?.streamingIds.has(m.id) === true;
			for (const [contentIndex, block] of assistant.content.entries()) {
				if (block.type === "text") {
					rest.push({ type: "text", id: `${m.id}-t${textN++}`, text: block.text, state: "done" });
				} else if (block.type === "thinking") {
					reasoning.push({ type: "reasoning", id: `${m.id}-r${reasoningN++}`, text: block.thinking, state: "done" });
				} else if (block.type === "toolCall") {
					const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
					if (annotation.status !== "absent") {
						// Posición en la fuente, no índice de la vista agrupada o con el razonamiento particionado.
						rest.push({ type: `tool-${block.name}`, toolCallId: block.id,
							sourceMessageId: m.id, sourceContentIndex: contentIndex, pluginQuestion: annotation,
							state: annotation.status === "posed" ? "input-available" : streamingMessage ? "input-streaming" : "output-error" });
						continue;
					}
					const part = toolPartOf(block, live, streamingMessage);
					const pluginProblem = pluginProblemForCall(messages, { messageId: m.id, contentIndex, toolCallId: block.id, toolName: block.name });
					if (pluginProblem) { part.pluginProblem = pluginProblem; part.input = pluginProblem.input; }
					if ((QUESTION_TOOLS as readonly string[]).includes(block.name)) {
						part.sourceMessageId = m.id;
						part.sourceContentIndex = contentIndex;
					}
					if (block.name === SEND_TO_USER_TOOL) {
						// Las generaciones fallidas o abortadas nunca ejecutan sus llamadas;
						// la interfaz de error o aborto del proveedor ya se encarga de ese resultado.
						if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
						const error = outputErrors.get(block.id);
						if (error) applyResult(part, error);
						if (part.state === "output-error") {
							rest.push(part);
						} else {
							const text = sendToUserText(block);
							if (text !== undefined) {
								rest.push({ type: "text", id: `${m.id}-t${textN++}`, text, state: "done" });
							}
						}
						// Ni tarjeta de herramienta en vivo ni acuse: este canal es
						// prosa normal, también mientras se transmiten sus argumentos.
						continue;
					}
					// La unión de la revelación de la conclusión (ronda del responsable, 2026-10-05): el
					// protagonista de una tarjeta de conclusión es el modelSolution fijado al PLANTEAR
					// — un plegado del registro, enriquecido aquí para que la tarjeta se renderice pura.
					if (block.name === PRACTICE_CONCLUDE_TOOL) {
						part.reveal = modelSolutionForConclude(messages, block.id);
						part.problemInput = problemInputForConclude(messages, block.id);
					}
					rest.push(part);
				}
			}
			const parts: LhViewPart[] = [...reasoning, ...rest];
			if (parts.length === 0) {
				// Un mensaje en STREAMING que ha llegado pero sin contenido (responsable, ronda
				// optimista 3, 2026-10-02): el primer evento aplicado del turno puede llevar
				// contenido vacío — se proyecta UNA parte de razonamiento vacía para que la
				// LLEGADA del mensaje renderice la fila de razonamiento (el Reasoning de chat.tsx
				// marca isStreaming en la última parte: el mismo indicador + brillo que el
				// provisional al que sustituye — el traspaso no se nota y nunca pueden salir
				// duplicados). Los mensajes vacíos asentados siguen ocultos
				// (solo presentación).
				if (live?.streamingIds.has(m.id)) {
					parts.push({ type: "reasoning", id: `${m.id}-r0`, text: "", state: "done" });
				} else {
					continue;
				}
			}
			const group = lastAssistant();
			if (group) {
				// Mismo grupo: el separador de paso se renderiza entre los pasos.
				group.parts.push({ type: "step-start", sourceMessageId: m.id }, ...parts);
			} else {
				out.push({ id: m.id, role: "assistant", parts: [{ type: "step-start", sourceMessageId: m.id }, ...parts] });
			}
			continue;
		}
	}

	return out;
}

/** Las herramientas que gestiona el dock: las de pregunta (resultados propiedad del
 * cliente — el dock se monta sobre la llamada colgante) y el planteamiento de práctica
 * (su acuse es DEFINITIVO — details: null, nunca se sustituye — y la tarjeta + el dock
 * leen la entrada de la llamada; el provisional nunca debe pasar la parte a
 * output-available). PRÁCTICA (2026-10-04): problem se une a la bifurcación del
 * provisional; conclude es una parte de herramienta NORMAL (su resultado se acusa sin
 * contenido, details null — pero ConcludeCard lee la entrada de la llamada, y
 * output-available con output undefined se renderiza bien). */
function isPlaceholderResultTool(name: string): boolean {
	return (QUESTION_TOOLS as readonly string[]).includes(name) || name === "problem";
}

/** Un bloque de llamada a herramienta → su parte de vista, con la capa de ejecución en
 * vivo. `streamingMessage` — EVIDENCIA POSITIVA (responsable, 2026-10-05): el propio
 * mensaje de esta llamada está en streaming ESTE turno. El brillo de input-streaming
 * depende de esto, nunca de que la sesión esté ocupada: una llamada de un mensaje
 * asentado nunca puede renderizarse en vivo, se esté ejecutando lo que se esté
 * ejecutando. */
function toolPartOf(
	block: { id: string; name: string; arguments?: unknown },
	live: LiveTurnState | undefined,
	streamingMessage: boolean,
): LhViewPart {
	const part: LhViewPart = {
		type: `tool-${block.name}`,
		toolCallId: block.id,
		input: block.arguments,
	};
	const exec = live?.executions.get(block.id);
	const isQuestion = isPlaceholderResultTool(block.name);
	if (exec) {
		if (exec.result) part.result = exec.result;
		if (exec.isError) {
			// Una llamada no válida NUNCA pasa a input-available — la barrera de montaje del
			// dock depende del final limpio de la ejecución (el fallo en vivo del realismo del
			// modal: un cuestionario mal formado nunca debe montarse).
			part.state = "output-error";
			part.rawInput = block.arguments;
			part.errorText = exec.errorText ?? "The tool call failed.";
		} else if (isQuestion) {
			// Bifurcación 2: el provisional limpio "Question posed" se IGNORA —
			// las herramientas de pregunta son propiedad del cliente; el dock se monta en el
			// final limpio y la respuesta llega como un toolResult real.
			part.state = "input-available";
		} else {
			part.state = "output-available";
			part.output = exec.output;
		}
	} else {
		// Aún sin ejecución: en vivo SOLO con evidencia positiva — el propio mensaje de la
		// llamada está en streaming este turno (puede que sus argumentos se estén escribiendo
		// literalmente). Cualquier otra cosa es una llamada colgante de un mensaje asentado —
		// el estado pendiente del dock, nunca un brillo.
		part.state = streamingMessage ? "input-streaming" : "input-available";
	}
	return part;
}

function applyResultTo(part: LhViewPart | undefined, result: ToolResultMessage): void {
	if (part) {
		// Bifurcación 2 (responsable, oleada D): el provisional limpio "Question posed"
		// (details: null — questionResult de tool-execute) es territorio de preguntas
		// propiedad del cliente. El dock se monta sobre la llamada colgante; AnsweredCard
		// renderiza solo la respuesta REAL del alumno (con details).
		// Pasar la parte a output-available con el provisional le daría a AnsweredCard
		// un null y haría caer el render (el fallo en vivo, 2026-09-26).
		const tool = part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.type;
		const isQuestion = isPlaceholderResultTool(tool);
		if (!result.isError && ((isQuestion && result.details == null) || part.pluginProblem)) {
			// La bifurcación del provisional (bifurcación 2) se mantiene: el acuse limpio del
			// planteamiento o la pregunta no lleva datos de tarjeta — NUNCA output-available. Pero la
			// llamada SÍ está asentada (el fallo de la práctica, 2026-10-05: este retorno temprano
			// dejaba la parte en lo que adivinase toolPartOf, lo que a mitad de turno resucitaba un
			// problema asentado como un indicador de carga en vivo). input-available es la verdad
			// asentada: ProblemCard lee la entrada de la llamada y el dock depende del plegado
			// nativo — ninguno de los dos quiere el contenido (null) del acuse.
			part.state = "input-available";
			return;
		}
		applyResult(part, result);
	}
	// Un resultado sin parte visible (p. ej. una llamada cuyo mensaje del asistente no
	// renderizó nada) se descarta de la vista — el registro lo conserva.
}

/** El mensaje proyectado de un marcador (traspaso/reorientaciones) o su inserción (bloque de plan). */
function projectMarker(marker: LhMarkerMessage, out: LhViewMessage[]): void {
	switch (marker.customType) {
		case "graph-context": {
			// El contexto del mapa de la sesión (responsable, 2026-10-04): del lado del usuario —
			// una tarjeta plegable mínima ENCIMA del primer mensaje del usuario;
			// nunca una burbuja de texto (andamiaje, como la tarjeta de razonamiento).
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-graph-context", id: `gc_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "probe-handoff": {
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-probe-handoff", id: `ph_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "subagent-steer": {
			const meta = marker.details as SubagentResultMeta;
			const artifact = marker.details as {
				kind: SubagentArtifactData["kind"];
				result: SubagentArtifactData["result"];
				ui?: SubagentArtifactData["ui"];
			};
			out.push({
				id: marker.id,
				role: "user",
				metadata: { subagentResult: meta },
				parts: [
					textPart(marker.content),
					{
						type: "data-subagent-artifact",
						id: `sa_${marker.id}`,
						data: { kind: artifact.kind, result: artifact.result, ui: artifact.ui },
					},
				],
			});
			return;
		}
		case "subagent-abort": {
			const meta = marker.details as SubagentResultMeta & { aborted: true };
			out.push({
				id: marker.id,
				role: "user",
				metadata: { subagentResult: meta },
				parts: [textPart(marker.content), { type: "data-subagent-aborted", id: `sa_${marker.id}`, data: meta }],
			});
			return;
		}
		case "plugin-problem-submission": {
			out.push({ id: marker.id, role: "user", parts: [{ type: "data-plugin-problem-submission", id: `ps_${marker.id}`, data: marker.details }] });
			return;
		}
		case "practice-thinking": {
			// La traza de trabajo / respuesta comprometida del alumno (sesiones de
			// práctica): una tarjeta del lado del usuario basada en los details estructurados
			// (problemCallId, commit, text) — el registro vive en la tarjeta, no se vuelve a
			// extraer del contenido.
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-practice-thinking", id: `pt_${marker.id}`, data: marker.details }],
			});
			return;
		}
		case "practice-next": {
			// La señal explícita del alumno de pasar a otra cosa (ronda 16 del responsable): una
			// línea de sistema compacta y centrada — el registro de envoltorio en versalitas
			// monoespaciadas, no prosa. El modelo lee el contenido del marcador; la transcripción
			// nunca lo muestra (la etiqueta es envoltorio, con una única fuente en el renderizador).
			out.push({
				id: marker.id,
				role: "user",
				parts: [{ type: "data-practice-next", id: `pn_${marker.id}`, data: null }],
			});
			return;
		}
		case "side-question":
		case "side-question-told":
			// Las entradas de contexto en bruto no dividen el segmento de enseñanza ni renderizan
			// pastillas llamativas en la transcripción. Su discreto bocadillo vuelve a abrir la
			// conversación guardada en el acompañante flotante o acoplado.
			return;
		case "problem-dismissed":
			// Solo interfaz (el descarte de estilo pregunta): el par de conclusión sintetizado
			// — que viaja con la SIGUIENTE entrada — lleva la cara del registro.
			return;
		case "compaction": {
			// EL DIVISOR DEL MOMENTO (ronda 14 del responsable): texto pequeño, mínimo y centrado
			// en el momento de la compactación — donde está ahora el usuario (el marcador se
			// añade al final del registro). Al hacer clic se abre el resumen completo. El divisor
			// de corte lo emite el bucle de plegado en la frontera de lo conservado (ver
			// projectView).
			out.push({
				id: marker.id,
				role: "user",
				parts: [
					{
					type: "data-compaction",
					id: `cm_${marker.id}`,
					data: { content: marker.content, details: marker.details as CompactionDetails },
				},
				],
			});
			return;
		}
		case "plan-block": {
			// Sin mensaje propio: se inserta en el grupo del asistente anterior,
			// EN EL FLUJO después de la última llamada correcta a plan_init.
			const group = out[out.length - 1];
			if (!group || group.role !== "assistant") return;
			const idx = lastSuccessfulPlanInit(group.parts);
			if (idx === -1) return;
			const { block } = marker.details as { planCallId: string; block: PlanBlockData };
			group.parts.splice(idx + 1, 0, { type: "data-plan-block", id: marker.id, data: block });
			return;
		}
	}
}
