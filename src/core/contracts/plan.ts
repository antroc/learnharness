/**
 * Contratos del árbol del plan: el árbol de dependencias con ámbito de sesión
 *
 * Parte de los contratos divididos por dominio (src/core/contracts/): cada fichero de dominio
 * pertenece por completo a su línea de trabajo; los cambios de esquema entre dominios pasan por
 * master. Tipos puros + documentación del protocolo + pequeños helpers puros; importaciones solo de tipos
 * de "ai" (seguras en todas partes: servidor, cliente, pruebas). Ver docs/archive/vision.md.
 */
// ─── Árbol del plan (visión §2, «árbol formal del plan») ─────────────────────────
// Un árbol de dependencias con ámbito de sesión redactado por el profesor con las herramientas de plan.
// Un mismo sustrato con el grafo global: los nodos del árbol se pliegan en nodos del grafo.

export interface PlanNode {
	/** Slug opaco elegido por el agente, estable entre ediciones: "chain-rule-intuition". */
	id: string;
	/** Etiqueta corta para el panel del árbol. */
	title: string;
	/** 1-2 frases: qué cubre este nodo. */
	summary?: string;
}

export interface PlanEdge {
	/** Id del nodo prerrequisito. */
	from: string;
	/** Nodo que depende de `from`. */
	to: string;
}

export interface PlanTree {
	nodes: PlanNode[];
	edges: PlanEdge[];
	/** Se incrementa en cada mutación: permite a la interfaz animar/reaccionar a los cambios. */
	version: number;
}

// NOTA (giro del 2026-09-11, docs/archive/probe-teach-split.md): el árbol llevaba antes
// `currentNodeId` / `doneNodeIds`, campos de progreso. HAN DESAPARECIDO por
// diseño: el árbol SOLO lleva estructura; la posición y el haber sido visitado se derivan
// del transcript al renderizar (derivePlanStatuses, más abajo). No hay
// registro de «hecho» de ningún tipo. Sin compatibilidad hacia atrás con registros antiguos.

/** Derivado, nunca guardado: estado de un nodo para el panel (visión §2). */
export type PlanNodeStatus = "current" | "visited" | "upcoming";

// ─── estados derivados: la posición sale de las LLAMADAS, nunca de los resultados ──
//
// (Giro del 2026-09-11, docs/archive/probe-teach-split.md §3). El profesor REDACTA el
// mapa (plan_init, mermaid; reescritura que se puede volver a llamar) y nunca sigue el progreso.
// El `nodeId` del quiz significa «esta pregunta TRATA DE este nodo»: una señal
// de posición, nunca de finalización. La derivación solo lee LLAMADAS:
//   current: el nodo de la llamada de quiz etiquetada más RECIENTE (en cualquier estado)
//   visited: todo nodo referenciado por una llamada etiquetada ANTERIOR
// Consecuencias: un nodo abarca de forma natural varios turnos/comprobaciones (varias
// preguntas pueden etiquetar el mismo nodo: el mapa se queda quieto); pasar a un nodo
// nuevo es el juicio del profesor de que el anterior está terminado, sean cuales sean
// los resultados de las comprobaciones (una comprobación fallida seguida de un avance sigue contando como visitado); los resultados
// no alimentan nada; NO hay current de respaldo (antes de la primera comprobación etiquetada
// nada es current). Las comprobaciones sin etiqueta ya no existen (nodeId es obligatorio
// en el quiz de enseñanza, decisión del responsable 2026-09-26). Los NodeIds que faltan en el
// árbol actual se ignoran (una reescritura puede haber eliminado el nodo).

/** Porción estructural mínima de un mensaje: cualquier cosa con partes tipadas (igual que
 * phases.ts: puro, sin dependencias en tiempo de ejecución, seguro en servidor, cliente y pruebas). */
interface PartsCarrier {
	parts: Array<{ type: string; state?: string; input?: unknown; output?: unknown; pluginQuestion?: unknown }>;
}

export interface DerivedPlanStatuses {
	/** El nodo del que trata la llamada de quiz etiquetada más reciente; null antes de ninguna. */
	current: string | null;
	/** Nodos referenciados por llamadas etiquetadas anteriores: ya se pasó por ellos, monótono. */
	visited: ReadonlySet<string>;
}

/** Estados de un nodo: la vista derivada que debe renderizar el panel del plan. */
export function derivedNodeStatus(statuses: DerivedPlanStatuses, nodeId: string): PlanNodeStatus {
	if (statuses.current === nodeId) return "current";
	if (statuses.visited.has(nodeId)) return "visited";
	return "upcoming";
}

export function derivePlanStatuses(tree: PlanTree, messages: readonly PartsCarrier[]): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = []; // nodos etiquetados distintos en orden de llamada, con los duplicados CONSECUTIVOS
	// colapsados (varias comprobaciones sobre un nodo = una sola estancia en él)
	for (const m of messages) {
		for (const part of m.parts) {
			// Cualquiera de las dos herramientas de quiz (quiz/explain) marca la posición: la mecánica
			// es un interruptor de ajustes; el pliegue reconoce ambas (responsable 2026-09-27).
			const snapshot = posedPluginQuestionOfPart(part);
			if (part.pluginQuestion !== undefined ? snapshot?.variant !== "teach" : part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			const nodeId = ((snapshot?.input ?? part.input) as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string" || !ids.has(nodeId)) continue; // sin etiqueta/desconocido: no mueve nada
			if (runs.at(-1) !== nodeId) runs.push(nodeId);
		}
	}
	const current = runs.at(-1) ?? null;
	// Visited = se estuvo allí en una estancia ANTERIOR: todo lo anterior a la racha
	// actual. Una revisita (a→b→a) pone a en visited Y en current: current gana al
	// renderizar (derivedNodeStatus), visited registra que ya se abandonó antes.
	const visited = new Set(runs.slice(0, -1));
	return { current, visited };
}

/**
 * El resultado de la herramienta de plan (protocolo de autoría única, 2026-09-03): UNA herramienta
 * del lado del servidor, plan_init (tools/plan.ts): un bloque mermaid `graph TD` canonizado
 * en el árbol estructurado, llamado una vez en la frontera sondeo→enseñanza y
 * que se puede volver a llamar para reescribir. Las antiguas herramientas de mutación/seguimiento han desaparecido:
 * los estados se derivan de los resultados de las comprobaciones (derivePlanStatuses, arriba), así que el
 * árbol lleva estructura, nunca progreso. El panel del árbol sigue derivando lo que
 * muestra de la ÚLTIMA salida de la herramienta de plan en el transcript, más los
 * estados derivados, sin un canal de estado aparte.
 */
export interface PlanToolResult {
	ok: boolean;
	error?: string;
	/** El árbol guardado: SOLO en los resultados correctos (responsable, dieta de contexto
	 *  2026-10-09): este es el valor `details` de cara al registro/la interfaz. El
	 *  contenido de cara al agente nunca lo lleva: el contenido son los nodeIds
	 *  validados + el recordatorio; los fallos solo llevan el error. La frontera
	 *  latestTree del popup del plan lee este campo. */
	tree?: PlanTree;
}


// ─── el pliegue nativo (Oleada D: derivePlanStatuses sobre LhMessage[]) ─────────

import type { LhMessage } from "../native-messages.ts";
import { posedPluginQuestionOfPart } from "../tool-parts.ts";
import { readPluginQuestionMessageAnnotation } from "../plugin-questions.ts";

/** La misma derivación sobre el registro NATIVO: solo LLAMADAS de quiz (en cualquier estado:
 *  una llamada colgada también mueve la posición; los resultados no alimentan nada). */
export function derivePlanStatusesLh(tree: PlanTree, messages: readonly LhMessage[]): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = [];
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const [contentIndex, block] of (content as Array<{ type?: string; name?: string; arguments?: unknown }>).entries()) {
			const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
			if (block.type !== "toolCall") continue;
			if (annotation.status !== "absent" ? annotation.status !== "posed" || annotation.snapshot.variant !== "teach" : block.name !== "quiz" && block.name !== "explain") continue;
			const input = annotation.status === "posed" ? annotation.snapshot.input : block.arguments;
			const nodeId = (input as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string" || !ids.has(nodeId)) continue;
			if (runs.at(-1) !== nodeId) runs.push(nodeId);
		}
	}
	const current = runs.at(-1) ?? null;
	const visited = new Set(runs.slice(0, -1));
	return { current, visited };
}
