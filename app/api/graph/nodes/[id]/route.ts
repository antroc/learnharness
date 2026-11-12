import { deleteGraphNode } from "@/src/server";

/**
 * DELETE /api/graph/nodes/[id] — borrado de un solo nodo, MUERTE TOTAL
 * (decisión del responsable 2026-09-23: que el usuario señale el nodo es
 * la intención; las referencias desde otras sesiones no lo conservan).
 * Todas las líneas del nodo, todas las aristas que lo tocan, todos los
 * eventos de quiz/observación que lo nombran, sus líneas de mapeo y su
 * posición mueren en una única reescritura atómica del registro
 * (deleteNodeTraces de core/graph-deletion.ts); los datos derivados
 * (partición de nacimiento, clústeres) se reparan solos en lectura.
 *
 * Barreras (deleteGraphNode de server/graph.ts): 409 mientras haya
 * CUALQUIER ejecución de extracción registrada; una ejecución a medias
 * conserva hallazgos previos al borrado y podría volver a referenciar el
 * nodo que muere. La ejecución nunca se aborta (su gasto pertenece a otra
 * sesión); la UI reintenta cuando el dock se vacía. No hay barreras de
 * turno/tareas: nunca escriben los registros del grafo, y esta orquestación
 * es síncrona de principio a fin; nada se intercala. La respuesta lleva lo
 * eliminado y el nuevo graphRevision (la señal de volver a pedir).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const outcome = deleteGraphNode(id);
	if (!outcome.ok) {
		return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	}
	return Response.json({ stats: outcome.stats, graphRevision: outcome.graphRevision });
}