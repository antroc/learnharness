import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { probeDoneInputSchema, PROBE_DONE_ACK_TEXT } from "../../core/contracts.ts";
import { hasUnresolvedQuestion, hasProbeDone, type LhMessage } from "../../core/native-messages.ts";
import type { ChatStore } from "../../core/ports.ts";
import { buildProbeHandoffSteer, type SteerMessage } from "../../core/contracts.ts";

/** Sobre qué se cierra la herramienta probe_done. */
export interface ProbeDoneContext {
	chatId: string;
	/** El puerto de almacenamiento (comprobaciones de pregunta abierta + ya concluido). */
	chatStore: ChatStore;
	/** Pone en cola la reorientación de traspaso (la canalización de despertares: src/server/jobs.ts).
	 *  Se inyecta para que este módulo nunca importe la frontera del servidor. */
	deliver: (steer: SteerMessage) => void;
}

/** ¿Lleva ya el transcript un sondeo concluido (en cualquier estado)?
 *  Oleada B: el recorrido nativo (cualquier llamada a probe_done, en cualquier estado): la misma
 *  semántica que tenía el recorrido de partes de UIMessage. */
function probeConcluded(messages: readonly LhMessage[]): boolean {
	return hasProbeDone(messages);
}

/**
 * probe_done: la frontera sondeo→planificación (docs/archive/probe-teach-split.md §2).
 *
 * DEL LADO DEL SERVIDOR. El sondeador concluye el sondeo redactando la evaluación
 * del alumno (la ENTRADA de la herramienta: llega en streaming al alumno en vivo y es
 * duradera en el transcript como la propia parte de herramienta). Tres resultados:
 *
 *   ok:false + error: todavía hay una pregunta abierta ("resolve it first"), o
 *     el sondeo ya ha concluido. El rechazo vuelve al sondeador como
 *     resultado de herramienta; corrige el rumbo y reintenta (la doctrina de
 *     devolver al agente, igual que la validación de nodeId).
 *   ok:true: la evaluación queda registrada y se pone en cola el TRASPASO: una
 *     reorientación por la canalización de despertares que lanza el primer turno del profesor
 *     (redacción del plan) en cuanto termina el turno del sondeador. El despertar automático es el
 *     disparador decidido por el usuario: el alumno vive evaluación → plan como
 *     un único flujo continuo. REDUCIDO EN CONTEXTO (responsable, dieta de contexto 2026-10-09):
 *     los argumentos de la llamada ya llevan la evaluación (duradera, transmitida
 *     en vivo), así que el agente ve el PROBE_DONE_ACK_TEXT fijo, nunca una
 *     repetición. details = solo {ok:true}.
 *
 * El primer probe_done concluido (llamada no fallida más un resultado correcto
 * correspondiente) es también la frontera de construcción: a partir de ese resultado, cada petición
 * construye el agente PROFESOR. Las llamadas sueltas y los resultados rechazados siguen sondeando.
 */
export function probeDoneTool(ctx: ProbeDoneContext): Record<string, AgentTool<any>> {
	return {
		probe_done: {
			name: "probe_done",
			label: "probe_done",
			description:
				"Conclude the probing phase and hand off to the teaching phase. Call this ONCE, when the probe is " +
				"complete: every strand the lesson depends on is bracketed (a floor he reliably gets right AND a " +
				"ceiling where it runs out), and his learning goal is concrete. The input IS the learner assessment — " +
				"one strand per dependency the lesson will rest on, with your read of where his edge sits on it " +
				"(floor, ceiling, misconceptions, what to build from). It streams to the learner live and becomes " +
				"the handoff artifact the teacher plans from. Refused while a question is still open, and after " +
				"the probe is already concluded. After it succeeds, say your closing sentence and end your turn.",
			// El esquema propiedad de core (contracts/probe.ts): el MISMO esquema que ejecuta la frontera
			// de parseo de la interfaz (tool-parts.ts), así que válido en el límite ⇔ parseable por el consumidor.
			parameters: probeDoneInputSchema,
			execute: serverExecute("probe_done", probeDoneInputSchema, async (input) => {
				const record = ctx.chatStore.getChat(ctx.chatId);
				if (!record) return { ok: false, error: `Chat not found: ${ctx.chatId}` };

				if (hasUnresolvedQuestion(record.messages)) {
					return {
						ok: false,
						error:
							"A question is still open — resolve it (or let him answer) before concluding the probe. " +
							"probe_done only fires with no question outstanding.",
					};
				}
				if (probeConcluded(record.messages)) {
					return { ok: false, error: "The probe is already concluded — probe_done fires exactly once." };
				}
				try {
					ctx.deliver(buildProbeHandoffSteer(ctx.chatId));
				} catch (err) {
					console.error(`[chat ${ctx.chatId}] probe handoff queueing failed:`, err);
					// El traspaso es recuperable por diseño (el siguiente mensaje del cliente
					// construye el profesor a partir de la frontera del transcript): se registra la
					// evaluación de todos modos; el despertar es una optimización, no una barrera.
				}
				// Dieta de contexto (responsable, 2026-10-09): la evaluación vive UNA vez, como
				// los argumentos de esta llamada. content es el acuse fijo (el agente nunca
				// ve una repetición); details = {ok:true} para el registro/la interfaz: la
				// tarjeta de probe-done lee la entrada de la llamada, que es lo que siempre prefirió.
				return {
					text: PROBE_DONE_ACK_TEXT,
					details: { ok: true },
				};
			}),
		},
	};
}
