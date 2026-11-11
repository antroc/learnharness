import type { GraphChain, GraphNode, Position } from "./contracts.ts";
import { incrementalLayout } from "./layout.ts";
import { attachImpToCommunities, birthSessionPartition } from "./session-clusters.ts";
import { deriveView, getGraph } from "./graph.ts";

/**
 * El asentamiento al fusionar: recalcula la disposición de reposo a partir
 * del grafo ACTUAL + el registro de posiciones, y sustituye el registro. Lo
 * llama el proceso de extracción tras cada fusión (el único escritor) y el
 * endpoint de confirmación de posiciones cuando el grafo creció durante una
 * confirmación con física en vivo (las posiciones del cliente pasan a ser el
 * conjunto de anclas). Síncrono — debe terminar antes de que la siguiente
 * petición a /api/graph refleje el cambio.
 *
 * CADENAS PRIMERO (responsable, 2026-09-30): el asentamiento dispone la vista
 * DERIVADA — las proposiciones Y los nodos de implicación derivados (uno por
 * cadena, ids arg_) sobre las flechas derivadas sin tipo — para que existan
 * posiciones para cada nodo que dibuja el lienzo. Los nodos de implicación
 * participan en la física como nodos normales (la especialización del
 * renderizado llega después).
 *
 * SEPARADO DE layout.ts a propósito (2026-09-13): layout.ts está en el barrel
 * del navegador, y el asentamiento necesita la partición en clústeres para la
 * atracción hacia el centroide del clúster — este módulo no debe acabar en el
 * bundle del cliente. El código del servidor lo importa DIRECTAMENTE; nunca
 * se reexporta a través de src/core/index.ts.
 */
export function settleGraphLayout(graphStore: {
	readNodes(): GraphNode[];
	readChains(): GraphChain[];
	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;
}): void {
	const graph = getGraph(graphStore);
	if (graph.nodes.length === 0) return;
	const view = deriveView(graph);
	const previous = new Map(Object.entries(graphStore.readPositions()));
	// La partición en clústeres para la atracción al centroide: la MISMA partición por
	// sesión de nacimiento que muestra la instantánea (derivada de la procedencia al leer —
	// core/session-clusters.ts, oleada 7) — un único concepto de clúster en todas partes.
	// SOLO PROPOSICIONES (responsable, 2026-09-30): los nodos de implicación nunca
	// se reparten; el mundo guardado se agrupa y su imagen lo sigue.
	const communities = birthSessionPartition(graph.nodes);
	// La MISMA asignación de nodos imp que muestra la instantánea (mayoría entre los
	// nacimientos de las premisas — core/session-clusters.ts): el registro de reposo y la
	// simulación en vivo deben coincidir en dónde van los haces, o el primer tick en vivo
	// lucharía contra el asentamiento. Aquí sin filtrar (el asentamiento atrae a todas
	// las comunidades; las envolventes son cosa solo del lienzo).
	attachImpToCommunities(communities, graph.nodes, graph.chains);
	const next = incrementalLayout(view.nodes, view.edges, previous, {
		clusters: communities,
		logicalEdges: view.logicalEdges,
		impLinks: view.impLinks,
	});
	graphStore.writePositions(Object.fromEntries(next));
}
