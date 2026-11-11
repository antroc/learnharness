"use client";

import { useId, useMemo } from "react";
import { derivedNodeStatus, derivePlanStatuses } from "@/src/core";
import {
	PlanDiagram,
	GRAPH_PAD,
	latestTree,
	TEXT_CAP_SCALE,
	type PopupMessage,
} from "@/components/plan-block";

/**
 * LA NOTA AL MARGEN DEL PLAN: la presencia ambiental del plan en la vista de
 * la sesión — la sucesora de la antigua tarjeta fija de esquina (la ventana
 * del plan, retirada con la ronda de colocación en la franja del dock). SIN
 * contenedor: el diagrama desnudo, ajustado dentro del flanco derecho de la
 * franja del dock — el envoltorio (DockOverlay) lo posiciona y lo funde —
 * para que se lea como una nota al margen en la página de la lección, no
 * como un widget flotante. En vivo por construcción: los estados se derivan
 * de la transcripción en cada render (derivePlanStatuses — llamadas, no
 * resultados), así que el brillo se mueve en el instante en que llega por
 * streaming una comprobación etiquetada.
 *
 * Visible solo mientras una pregunta ocupa la franja del dock (la altura de
 * la cola reservada es el lienzo del diagrama — quiz abierto, franja alta,
 * plan completo); plegar el dock hace que todo se desvanezca y se difumine
 * hasta desaparecer. El chip de plan de la barra superior da acceso a
 * cualquier ancho; la ventana emergente es la vista de estudio. El relleno
 * del viewBox deja sitio al halo amarillo difuminado del nodo actual
 * (GLOW_REACH) en los bordes de la extensión.
 */

const MARGIN_PAD = GRAPH_PAD + 16;

/** True cuando la transcripción contiene un árbol de plan. Condiciona el
 *  flanco pulsable de la nota al margen (chat.tsx): PlanMarginalia renderiza
 *  null sin árbol, pero el BOTÓN envoltorio también debe desmontarse — un
 *  elemento JSX siempre es truthy, así que condicionar solo con él dejaba un
 *  destino de clic fantasma abajo a la derecha siempre que había una pregunta
 *  pendiente sin plan (informe del responsable, ronda de interfaz 2026-10-01). */
export function planExists(messages: readonly PopupMessage[]): boolean {
	const tree = latestTree(messages);
	return !!tree && tree.nodes.length > 0;
}

export function PlanMarginalia({ messages }: { messages: readonly PopupMessage[] }) {
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const tree = useMemo(() => latestTree(messages), [messages]);
	const statuses = useMemo(
		() => (tree ? derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]) : null),
		[tree, messages],
	);
	if (!tree || tree.nodes.length === 0) return null; // aún no hay plan: nada en el margen
	const statusOf = (id: string) => (statuses ? derivedNodeStatus(statuses, id) : "upcoming");
	return (
		<PlanDiagram
			nodes={tree.nodes}
			edges={tree.edges}
			statusOf={statusOf}
			glowId={statuses?.current ?? null}
			markerId={markerId}
			pad={MARGIN_PAD}
			textCapScale={TEXT_CAP_SCALE}
			fill
		/>
	);
}
