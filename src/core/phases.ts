/**
 * Fases de la sesión de enseñanza derivadas secuencialmente de los eventos de
 * la transcripción, no de la ocupación del árbol del plan ni de una marca
 * explícita de aceptación del plan:
 *
 * - probe: hasta que probe_done tiene un resultado de herramienta correcto.
 * - plan: tras completar el sondeo, hasta una llamada de pregunta de
 *   enseñanza etiquetada con un nodo.
 * - teach: desde esa primera llamada en adelante, sin esperar a su respuesta.
 *
 * Las llamadas nativas quiz/explain y las anotaciones admitidas de preguntas
 * de enseñanza de plugins aportan el límite de la enseñanza. Los resúmenes
 * del registro nativo y los separadores de la vista proyectada usan los
 * mismos límites de eventos; presentar un plan por sí solo no hace avanzar a
 * teach la fase mostrada.
 */

import { posedPluginQuestionOfPart } from "./tool-parts.ts";
import { readPluginQuestionMessageAnnotation } from "./plugin-questions.ts";

/** Las tres fases de una sesión, tal como las ven el selector / la cabecera / los separadores. */
export type Phase3 = "probe" | "plan" | "teach";

/**
 * Porción estructural mínima de un mensaje de interfaz para el recorrido de
 * fases: partes con un estado, una entrada (los argumentos analizados de una
 * llamada a herramienta) y (en las llamadas concluidas) una salida.
 */
export interface PhaseMessage {
	parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; output?: unknown; pluginQuestion?: unknown }>;
}

/** La entrada de la parte de una llamada quiz lleva `nodeId` si y solo si
 *  está etiquetada (solo enseñanza — el esquema del cuestionario de sondeo no
 *  tiene campo nodeId). */
function taggedNodeId(input: unknown): boolean {
	return (
		typeof input === "object" &&
		input !== null &&
		typeof (input as { nodeId?: unknown }).nodeId === "string" &&
		(input as { nodeId: string }).nodeId.length > 0
	);
}

function isTeachQuestionPart(part: PhaseMessage["parts"][number]): boolean {
	if (part.pluginQuestion !== undefined) {
		const snapshot = posedPluginQuestionOfPart(part);
		return snapshot?.variant === "teach" && taggedNodeId(snapshot.input);
	}
	return (part.type === "tool-quiz" || part.type === "tool-explain") && taggedNodeId(part.input);
}

/** La fase en `upToIndex` (inclusive; por defecto, el último mensaje). */
export function phaseAt3(messages: readonly PhaseMessage[], upToIndex?: number): Phase3 {
	let phase: Phase3 = "probe";
	const last = Math.min(upToIndex ?? messages.length - 1, messages.length - 1);
	for (let i = 0; i <= last; i++) {
		phase = advance(phase, messages[i]?.parts);
	}
	return phase;
}

/** El avance de fase de un mensaje (paso de plegado puro). */
function advance(
	phase: Phase3,
	parts: PhaseMessage["parts"] | undefined,
): Phase3 {
	if (!parts) return phase;
	for (const part of parts) {
		// ESTRICTAMENTE SECUENCIAL: probe → plan solo mediante un probe_done concluido,
		// plan → teach solo mediante la primera LLAMADA quiz etiquetada con nodeId (la llamada,
		// no su respuesta — una llamada con error y reintentada demuestra igualmente que
		// empezó la enseñanza, y de todos modos el reintento cae en el mismo grupo).
		if (
			phase === "probe" && part.type === "tool-probe_done" && part.state === "output-available" &&
			(part.output as { ok?: unknown } | null | undefined)?.ok !== false
		) {
			phase = "plan";
		}
		// plan → teach mediante la primera LLAMADA de cuestionario etiquetada con nodeId —
		// quiz O explain, la mecánica que hayan activado los ajustes (ambas llevan nodeId).
		if (
			phase === "plan" && isTeachQuestionPart(part)
		) {
			phase = "teach";
		}
	}
	return phase;
}

/**
 * DÓNDE empieza la enseñanza dentro del mensaje que cambia la fase (ronda 8
 * del responsable, 2026-10-05 — el fallo de los separadores apilados):
 * plan→teach cambia en la primera LLAMADA quiz/explain etiquetada, pero la
 * PRESENTACIÓN del plan suele vivir en el mismo mensaje del asistente — un
 * PASO del proveedor anterior a la llamada quiz. Por eso una frontera a nivel
 * de mensaje dibujaba también el separador de Enseñanza antes de la
 * presentación del plan (Planificación y Enseñanza apilados uno tras otro).
 * Esto devuelve el índice de parte del LÍMITE DE PASO que gobierna la llamada
 * que cambia la fase: -1 cuando la llamada está en el PRIMER paso del mensaje
 * (el separador va antes de todo el mensaje); si no, el índice de la parte
 * step-start cuya generación contiene la llamada — el separador se muestra
 * ahí, entre la presentación del plan y el bloque de enseñanza.
 */
export function teachStepIndex(
	parts: PhaseMessage["parts"],
): number {
	let stepStarts = 0; // cuántas partes step-start se han visto hasta ahora
	let latest = -1; // índice del último step-start
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		if (part.type === "step-start") {
			stepStarts++;
			latest = i;
			continue;
		}
		if (isTeachQuestionPart(part)) {
			// El paso que gobierna la llamada: 0–1 step-starts vistos = el PRIMER paso del
			// mensaje → -1 (el separador va antes de todo el mensaje); un paso posterior → el
			// índice de ese step-start (el separador se muestra en el límite, sustituyendo
			// ahí la línea fina normal).
			return stepStarts <= 1 ? -1 : latest;
		}
	}
	return -1;
}

/**
 * La fase en CADA índice de mensaje, en un único plegado hacia delante — los
 * separadores de la transcripción se muestran uno por límite, así que llamar a
 * phaseAt3(m, i) por cada índice volvería a recorrer 0..i cada vez
 * (cuadrático); esta es la misma derivación, lineal.
 * out[i] === phaseAt3(messages, i) para todo i.
 */
export function phaseTimeline(messages: readonly PhaseMessage[]): Phase3[] {
	const out: Phase3[] = [];
	let phase: Phase3 = "probe";
	for (let i = 0; i < messages.length; i++) {
		phase = advance(phase, messages[i]?.parts);
		out.push(phase);
	}
	return out;
}

// ─── el plegado nativo (oleada D: fase del lado del registro sobre LhMessage[]) ─

import { probeDoneResultIds, type LhMessage } from "./native-messages.ts";

/** La fase en `upToIndex` (inclusive; por defecto, el último mensaje) de un
 *  registro NATIVO. probe→plan avanza con el toolResult limpio de la llamada
 *  probe_done; plan→teach en el mensaje del asistente que lleva la primera
 *  LLAMADA quiz etiquetada con nodeId (replica el plegado de la vista — misma
 *  frontera, forma nativa). */
export function phaseAt3Lh(messages: readonly LhMessage[], upToIndex?: number): Phase3 {
	let phase: Phase3 = "probe";
	const last = Math.min(upToIndex ?? messages.length - 1, messages.length - 1);
	const concluded = probeDoneResultIds(messages.slice(0, last + 1));
	for (let i = 0; i <= last; i++) {
		const m = messages[i]!;
		const role = (m as { role?: string }).role;
		if (role === "toolResult") {
			if (phase === "probe" && concluded.has(m.id)) phase = "plan";
		} else if (role === "assistant") {
			const content = (m as { content?: ReadonlyArray<{ type?: string; name?: string; arguments?: unknown }> }).content ?? [];
			if (phase === "plan") {
				for (const [contentIndex, block] of content.entries()) {
					const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
					if (annotation.status !== "absent") {
						if (annotation.status === "posed" && annotation.snapshot.variant === "teach" && taggedNodeId(annotation.snapshot.input)) { phase = "teach"; break; }
						continue;
					}
					if (
						block.type === "toolCall" &&
						(block.name === "quiz" || block.name === "explain") &&
						taggedNodeId(block.arguments)
					) {
						phase = "teach";
						break;
					}
				}
			}
		}
	}
	return phase;
}
