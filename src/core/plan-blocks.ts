/**
 * Emisión de bloques de plan (docs/archive/probe-teach-split.md §6): la
 * frontera PROVISIONAL de presentación del plan. El plan se muestra EN EL
 * FLUJO una vez, al redactarse — una instantánea congelada adjunta justo
 * después del grupo del asistente que lleva la llamada correcta a plan_init.
 * Es el momento de presentación del plan (y el punto de entrada de la
 * ventana emergente) — los estados que muestra son exactos en ese instante
 * (actual = null, todo pendiente — salvo que la redacción sea una reescritura
 * a mitad de lección, en cuyo caso la instantánea muestra lo que era cierto
 * entonces).
 *
 * Oleada B (aprobada por el responsable el 2026-09-26): el bloque es un
 * MARCADOR nativo de bloque de plan que se añade al persistir el turno
 * (idempotente por llamada a plan_init); la proyección empalma su parte de
 * datos en el grupo del asistente EN EL FLUJO, exactamente donde lo ponía el
 * adjunto de la época de UIMessage. La maquinaria de bloques de vecindario
 * sigue retirada: la posición se deriva en vivo de la transcripción.
 */

import type { PlanBlockData, PlanTree } from "./contracts.ts";
import { derivePlanStatusesLh } from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";
import { newPlanBlockMessage } from "./native-messages.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

/** La parte de mensaje que consume el renderizador del chat (clave de
 *  TeacherUIDataParts "plan-block" — el SDK quita el prefijo `data-`). Se
 *  mantiene para los renderizadores del cliente; la proyección emite esta
 *  forma. */
export interface PlanBlockPart {
	type: "data-plan-block";
	id: string;
	data: PlanBlockData;
}

/** La carga de la instantánea (sin cambios desde la oleada 4): estados
 *  derivados de la transcripción EN EL MOMENTO de la emisión — el bloque
 *  nunca vuelve a derivarlos. Oleada D: la derivación lee la transcripción
 *  NATIVA (solo LLAMADAS quiz — los resultados no alimentan nada,
 *  derivePlanStatusesLh de contracts/plan.ts). */
function snapshot(tree: PlanTree, messages: readonly LhMessage[]): PlanBlockData {
	const statuses = derivePlanStatusesLh(tree, messages);
	return {
		kind: "full",
		at: new Date().toISOString(),
		current: statuses.current,
		nodes: tree.nodes.map((n) => ({
			id: n.id,
			title: n.title,
			status: statuses.current === n.id ? "current" : statuses.visited.has(n.id) ? "visited" : "upcoming",
		})),
		edges: tree.edges.map((e) => ({ from: e.from, to: e.to })),
	};
}

/** Los marcadores de bloque de plan del registro, indexados por la llamada a
 *  plan_init que presentan — el conjunto de idempotencia de la emisión. */
export function emittedPlanBlockCalls(messages: readonly LhMessage[]): Set<string> {
	const out = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as { customType?: string; details?: { planCallId?: unknown } };
		if (marker.customType === "plan-block" && typeof marker.details?.planCallId === "string") {
			out.add(marker.details.planCallId);
		}
	}
	return out;
}

/**
 * La frontera de emisión nativa (pura): UN marcador de bloque de plan por
 *  TURNO — para la ÚLTIMA llamada correcta a plan_init del turno (una
 *  reescritura en el mismo turno se presenta una vez; la reescritura de un
 *  turno posterior recibe su propio bloque — la regla del máster dorado que
 *  tenía el adjunto de la época de UIMessage) que el registro aún no haya
 *  emitido. `tree` es el árbol actual del registro (la herramienta del plan
 *  lo guardó durante el turno); `transcript` es la transcripción NATIVA
 *  completa que lee la derivación de estados.
 */
export function planBlocksFor(
	record: readonly LhMessage[],
	newMessages: readonly LhMessage[],
	tree: PlanTree | null | undefined,
	transcript: readonly LhMessage[],
): LhMessage[] {
	if (!tree || tree.nodes.length === 0) return [];
	const emitted = emittedPlanBlockCalls(record);
	let last: { toolCallId: string } | null = null;
	for (const m of newMessages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage & { id: string };
		if (result.toolName !== "plan_init") continue;
		const ok = (result.details as { ok?: unknown } | undefined)?.ok;
		if (ok !== true) continue;
		if (emitted.has(result.toolCallId)) continue;
		last = { toolCallId: result.toolCallId };
	}
	if (!last) return [];
	return [newPlanBlockMessage(last.toolCallId, snapshot(tree, transcript))];
}
