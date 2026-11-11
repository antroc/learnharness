import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { PlanToolResult, PlanTree } from "../../core/contracts.ts";
import type { ChatStore } from "../../core/ports.ts";
import { createTree, PlanTreeError } from "../../core/plan-tree.ts";
import { parseMermaidPlan } from "./mermaid-plan.ts";

/** El recordatorio de id vinculante que va en el contenido reducido de plan_init (responsable,
 *  2026-10-09): plan_init es el momento exacto en que los ids de nodo pasan a ser
 *  estructurales: toda llamada posterior a quiz/explain debe hacer referencia a uno. Los
 *  incidentes de campos omitidos (tools_fails_2) mostraron que la cola del turno es donde
 *  se relaja la disciplina; el recordatorio cae justo ahí. */
const PLAN_NODE_IDS_REMINDER =
	"These are the plan's node ids — the only valid nodeId values for every quiz and explain call from here on. Reference them exactly.";

/** Sobre qué se cierran las herramientas de plan (la mitad del árbol del plan del contexto de herramientas). */
export interface PlanToolContext {
	chatId: string;
	/** El puerto de almacenamiento a través del que persisten las herramientas de plan. */
	chatStore: ChatStore;
}

/**
 * La herramienta de plan: protocolo de AUTORÍA ÚNICA (pasada de diseño del 2026-09-03): el profesor
 * ESCRIBE el mapa y nunca sigue el progreso. Una herramienta, plan_init, recibe
 * todo el mapa de dependencias como un bloque mermaid `graph TD`:
 *
 *   - se llama UNA vez justo después de que concluya el sondeo, para presentar el mapa (la
 *     ACEPTACIÓN DEL ALUMNO del plan presentado, no esta llamada, termina la
 *     planificación: docs/archive/probe-teach-split.md §4)
 *   - los estados (current / visited / upcoming) se DERIVAN de las etiquetas nodeId
 *     de los quiz que lanza el profesor (derivePlanStatuses de contracts.ts): el
 *     profesor nunca los declara, y no hay contabilidad de «hecho»
 *   - se vuelve a llamar en cualquier momento en que el mapa esté mal: el bloque nuevo sustituye el árbol
 *     entero. Los slugs de nodo son permanentes: el mapa no sigue nada entre
 *     reescrituras
 *   - las comprobaciones nombran el nodo que evalúan (nodeId del quiz, validado contra el
 *     árbol vivo en el límite de la llamada): esa etiqueta es lo único de lo que se
 *     derivan los estados
 *
 * Las antiguas herramientas de mutación (add/update/remove de nodo/arista, set_current,
 * mark_done) han desaparecido por diseño: reestructurar es reescribir, el seguimiento se
 * deriva. DEL LADO DEL SERVIDOR con execute: parsear → validar → persistir. El
 * resultado es REDUCIDO EN CONTEXTO (responsable, dieta de contexto 2026-10-09): el modelo
 * ESCRIBIÓ el mermaid hace un mensaje, así que el contenido nunca repite el árbol:
 * lleva los nodeIds validados + el recordatorio de nodeId vinculante (el
 * momento exacto en que los ids pasan a ser estructurales); `details` conserva el árbol
 * completo para el registro y el popup del plan (latestTree lo lee: el
 * canal invisible para el agente, verificado por el serializador).
 */
const planInitInput = Type.Object({
	mermaid: Type.String({
		minLength: 1,
		description:
			"A mermaid graph block (any direction), e.g.:\ngraph TD\n  primitives[Number primitives] --> operators[Arithmetic operators] --> expressions[Evaluating expressions]\n" +
			"The only strict rule: ids are permanent lowercase slugs (a-z, 0-9, hyphens/underscores) — checks reference them via nodeId. " +
			"Titles are free single-line text; `-->` means 'from = prerequisite' (chains fine); no subgraphs, styles, or classes.",
	}),
});

export function planTools(ctx: PlanToolContext): Record<string, AgentTool<any>> {
	return {
		plan_init: {
			name: "plan_init",
			label: "plan_init",
			description:
				"Write or REWRITE this session's plan map — the dependency graph the learner follows live in the plan window. " +
				"Call once right after the probe concludes, to present the map; re-call whenever the map is wrong (the new block replaces the old tree). " +
				"A mermaid graph block (any direction): one node per line (`slug[Short Title]` — slugs are permanent lowercase ids: a-z, 0-9, hyphens/underscores), " +
				"`-->` edges meaning 'from must be understood before to' (chains fine). 5–15 nodes: a map, not a syllabus — one reasoning step per node, compress. " +
				"Every check you fire names the node it assesses via `nodeId`; where the lesson stands derives from those tags.",
			parameters: planInitInput,
			execute: serverExecute("plan_init", planInitInput, async ({ mermaid }) => {
				const { chatId, chatStore } = ctx;
				const record = chatStore.getChat(chatId);
				if (!record) return { ok: false, error: `Chat not found: ${chatId}` };

				const parsed = parseMermaidPlan(mermaid);
				if (!parsed.ok || !parsed.plan) {
					// El parser recoge todos los problemas; el profesor corrige y reintenta.
					// Sin repetir el árbol: el modelo necesita los problemas, no una reformulación del
					// mapa que está reescribiendo (responsable, dieta de contexto 2026-10-09).
					return { ok: false, error: parsed.problems.join("\n") };
				}
				try {
					// createTree valida la estructura (ids duplicados, extremos de arista
					// que faltan, bucles sobre sí mismos, ciclos → PlanTreeError).
					const next = createTree(parsed.plan.nodes, parsed.plan.edges);
					chatStore.saveTree(chatId, next);
					// Dieta de contexto: content = los nodeIds validados + el recordatorio (los
				// ids acaban de volverse vinculantes para toda llamada a quiz/explain); details =
					// el árbol completo para el registro/la interfaz: la frontera latestTree del popup del plan,
					// invisible para el agente (el serializador solo envía content).
					return {
						text: JSON.stringify({
							ok: true,
							nodeIds: next.nodes.map((n) => n.id),
							reminder: PLAN_NODE_IDS_REMINDER,
						}),
						details: { ok: true, tree: next },
					};
				} catch (err) {
					if (err instanceof PlanTreeError) return { ok: false, error: err.message };
					throw err;
				}
			}),
		},
	};
}