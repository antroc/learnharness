/**
 * LA REPARACIÓN UNIVERSAL DE ARGUMENTOS: la conexión en la frontera del agente (responsable,
 * 2026-10-09: generalizar la reparación de práctica del 2026-10-04).
 *
 * Cada incidente de titubeo de argumentos de un modelo débil produjo una reparación conectada SOLO
 * a la herramienta en la que cayó (parseOptionsIfString (preguntas,
 * 2026-09-26), healStringifiedArrays (extracción),
 * healEncodedArguments (práctica, 2026-10-04)), y el bucle mortal de
 * whitehead (2026-10-09: quiz `type: "\"predict\""` rechazado diez veces,
 * idéntico byte a byte, en una sesión que nunca llegó a la lección) ocurrió
 * precisamente porque la reparación de práctica nunca llegó a las herramientas de quiz. La
 * decisión del responsable: es UN patrón estándar, aplicado en TODAS las herramientas:
 * reparar lo que es mecánicamente reconocible (un sustituto codificado en JSON de
 * la forma que espera el esquema; la limpieza de restos de valores de pertenencia vive en
 * core/value-debris) y dejar que la validación rechace el resto con honestidad.
 *
 * La función pura vive en core/argument-heal (la frontera de visualización también la
 * necesita: la ley de las tool-parts); este módulo es la conexión por herramienta/registro
 * en la frontera prepareArguments de pi, ANTES de la validación TypeBox.
 * Los argumentos bien formados pasan SIN TOCAR (la misma referencia); las reparaciones son
 * idempotentes, así que una reparación por herramienta compuesta bajo el envoltorio
 * a nivel de registro es una segunda pasada inofensiva.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { healEncodedArguments } from "../../core/argument-heal.ts";

export { healEncodedArguments };

/** Envuelve UNA herramienta con la reparación estándar: primero se ejecuta el prepareArguments
 *  propio de la herramienta (desempaquetado de options, normalización de target, …) y después la reparación
 *  contra el esquema declarado de la herramienta. Segura frente a spread (son literales de objeto
 *  simples) e idempotente. */
export function withArgumentHeal(tool: AgentTool<any>): AgentTool<any> {
	const inner = tool.prepareArguments;
	return {
		...tool,
		prepareArguments: (args: unknown) => healEncodedArguments(inner ? inner(args) : args, tool.parameters),
	};
}

/** La forma para todo el registro (el «patrón estándar en todas partes» del responsable):
 *  envuelve cada herramienta de un registro de herramientas. Se aplica en los puntos de montaje
 *  del registro (createProberTools, createTeacherTools, practiceTools,
 *  bareQuestionTools, los conjuntos de subagentes) para que ninguna herramienta salga sin envolver. */
export function healToolRecord(tools: Record<string, AgentTool<any>>): Record<string, AgentTool<any>> {
	return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, withArgumentHeal(tool)]));
}
