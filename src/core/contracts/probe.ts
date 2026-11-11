/**
 * Contratos de la fase de sondeo (la división sondeo→enseñanza, docs/archive/probe-teach-split.md).
 *
 * El sondeador concluye su fase con `probe_done`: una herramienta del lado del servidor
 * cuya ENTRADA es la evaluación del alumno (redactada por el modelo, transmitida en streaming al
 * alumno en vivo, duradera en el transcript gracias al propio resultado de la herramienta).
 * El primer `probe_done` del transcript es la frontera sondeo→planificación: el
 * agente profesor se construye a partir de ese punto, y el execute de la herramienta
 * pone en cola la reorientación de traspaso por la canalización de despertares para que el profesor empiece
 * justo después de que termine el turno del sondeador (despertar automático, decidido por el usuario).
 *
 * Forma de la evaluación (v1, a refinar más adelante): el sondeo era una búsqueda binaria por
 * hebra de dependencias; la evaluación formaliza exactamente eso. Una lista de las
 * hebras de las que dependerá la lección, cada una con una lectura libre de dónde
 * está el borde del alumno.
 */

import { Type, type Static } from "typebox";

/** Una hebra de dependencias en la que se apoyará la lección planificada. */
export interface ProbeStrand {
	/** Nombre/descripción de la hebra (p. ej. "la derivada como límite"). */
	strand: string;
	/** Libre: dónde está el borde del alumno en esta hebra: suelo,
	 *  techo, errores conceptuales encontrados, desde dónde construir. */
	assessment: string;
}

/** La lectura que hace el sondeador del alumno, transportada por probe_done. */
export interface ProbeAssessment {
	strands: ProbeStrand[];
	/** Síntesis general opcional: el objetivo aparente y el borde del alumno. */
	summary?: string;
}

/** Entrada de la herramienta probe_done (la evaluación que redacta el sondeador). */
export interface ProbeDoneInput {
	assessment: ProbeAssessment;
}

// El esquema TypeBox de esa entrada: FUENTE ÚNICA DE VERDAD, usada por la
// herramienta (src/agent/tools/probe.ts) y por la frontera de parseo de la interfaz (src/core/tool-parts.ts):
// la validación en el límite y el parseo del consumidor ejecutan literalmente el mismo
// esquema, así que «válido según el esquema en el límite» ⇔ «parseable por un consumidor» es
// estructural, no una convención. (Fallo en vivo del 2026-09-12: el modelo envió
// `assessment` como STRING; la tarjeta lo forzó de tipo y murió en `.strands.map`).
export const probeDoneInputSchema = Type.Object({
	assessment: Type.Object(
		{
			strands: Type.Array(
				Type.Object({
					strand: Type.String({
						description:
							"The dependency strand (e.g. 'the derivative as a limit') — a name the plan can hang a node on.",
					}),
					assessment: Type.String({
						description:
							"Where his edge sits on this strand: the floor (what he reliably gets right), the ceiling (where it runs out), " +
							"misconceptions found, and what the lesson should build from.",
					}),
				}),
				{ minItems: 1, description: "Every strand the planned lesson will depend on, each with your read of his edge on it." },
			),
			summary: Type.Optional(
				Type.String({
					description: "Optional overall synthesis: his apparent goal and where the teaching should enter.",
				}),
			),
		},
		{ description: "The learner assessment — the probe's distilled output." },
	),
});

/** Cerrojo esquema ↔ interfaz (la antigua garantía de `satisfies z.ZodType`): la
 *  declaración y ProbeDoneInput nunca pueden divergir: esto solo compila
 *  cuando la forma estática del esquema ES la interfaz. */
export const probeDoneSchemaLock = (v: Static<typeof probeDoneInputSchema>): ProbeDoneInput => v;

/** Salida de la herramienta probe_done. */
export interface ProbeDoneResult {
	ok: boolean;
	/** Motivo del rechazo cuando ok === false (pregunta abierta, ya concluido). */
	error?: string;
}

/** El texto de cara al modelo del acuse de probe_done (responsable, dieta de contexto
 *  2026-10-09): la evaluación son los argumentos de la LLAMADA, duraderos en el
 *  transcript y transmitidos al alumno, así que repetirla en el
 *  resultado duplicaría la mayor carga útil de la fase de sondeo en todo
 *  contexto futuro. El agente ve en su lugar esta línea fija; `details`
 *  solo lleva {ok:true} para el registro/la interfaz. La misma doctrina que
 *  CONCLUDE_ACK_TEXT. */
export const PROBE_DONE_ACK_TEXT =
	"Assessment recorded — it is shown to the learner now and the teacher plans from it. Say your closing sentence and end your turn; the teaching phase takes over from here.";
