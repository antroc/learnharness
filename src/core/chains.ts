import type { GraphNode } from "./contracts/graph.ts";
import { stripModelValueDebris } from "./value-debris.ts";

/**
 * Vistas de cadenas orientadas a la selección: puras y seguras en el navegador
 * (las consume la tabla de cadenas del shell; las exporta el barrel). Nacieron
 * en los contratos de prácticas (2026-09-29) y quedaron huérfanas en su propio
 * módulo cuando las sesiones de práctica sustituyeron al módulo de práctica
 * por lotes (2026-10-04).
 */

/** Una cadena de razonamiento: una VISTA orientada a la selección de las
 *  aristas follows almacenadas: todas las aristas que llegan a una conclusión,
 *  como premisas → esa conclusión. Las cadenas unitarias (premises: []) llevan
 *  nodos sin aristas. */
export interface ReasoningChain {
	/** La identidad de la cadena: el id del nodo CONCLUSIÓN (las cadenas se
	 *  agrupan por conclusión, así que ambos son lo mismo). */
	id: string;
	/** Ids de los nodos premisa: el origen de cada arista follows que llega a la
	 *  conclusión, ordenados. Vacío = una cadena unitaria (un nodo sin aristas). */
	premises: string[];
	/** El id del nodo conclusión (=== id; se repite para que las representaciones
	 *  lean "premisas → conclusión" sin indirección). */
	conclusion: string;
}

/** Las cadenas almacenadas filtradas a una selección (primero las cadenas,
 *  responsable 2026-09-30): una cadena entra si y solo si su conclusión Y todas
 *  sus premisas están seleccionadas; un nodo que no está en ninguna cadena
 *  superviviente es una cadena unitaria (premises: []). Los nodos que solo son
 *  premisa y cuya cadena quedó excluida son unitarios: la misma ley de
 *  inclusión que la agrupación por aristas anterior a las cadenas. Cada cadena
 *  almacenada conserva su PROPIO id (arg_…): dos argumentos independientes
 *  para una conclusión siguen siendo distintos. Determinista: cadenas
 *  ordenadas por id, premisas ordenadas. */
export function chainsForSelection(
	nodes: ReadonlyArray<Pick<{ id: string }, "id">>,
	chains: ReadonlyArray<Pick<{ id: string; premises: string[]; conclusion: string }, "id" | "premises" | "conclusion">>,
): ReasoningChain[] {
	const selected = new Set(nodes.map((n) => n.id));
	const chained = new Set<string>();
	const included: ReasoningChain[] = [];
	for (const chain of chains) {
		if (!selected.has(chain.conclusion)) continue;
		if (!chain.premises.every((premise) => selected.has(premise))) continue;
		included.push({ id: chain.id, premises: [...chain.premises].sort(), conclusion: chain.conclusion });
		chained.add(chain.conclusion);
		for (const premise of chain.premises) chained.add(premise);
	}
	for (const node of nodes) {
		if (!chained.has(node.id)) {
			included.push({ id: node.id, premises: [], conclusion: node.id });
		}
	}
	return included.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Una cadena como una sola línea de cara al mundo: los NOMBRES de las
 *  proposiciones unidos por la flecha de derivación: "Premisa uno, Premisa dos
 *  → Conclusión"; una unitaria muestra su marcador "(no premises)". Puro y
 *  seguro en el navegador. Los ids desconocidos recurren al id en bruto
 *  (honesto, nunca adivinado). Las premisas se ordenan por id: la misma ley de
 *  determinismo que chainsForSelection. */
/** Resuelve UNA cadena objetivo a un id de proposición canónico (ronda 9 del
 *  responsable, 2026-10-05: el contrato del rastro de dominio): primero el id
 *  (exacto) y luego el nombre (sin distinguir mayúsculas, recortado; los
 *  nombres son asas de presentación, no únicas; un nombre ambiguo se resuelve
 *  al PRIMER nodo en el orden del almacén). Devuelve null si nada coincide; el
 *  llamante rechaza. El conjunto de validación es TODO el grafo, no lo elegido
 *  en la sesión: las sesiones sin elección y los futuros planteamientos con
 *  herramientas de grafo siguen siendo válidos. La limpieza de restos
 *  (whitehead, 2026-10-09) repara la sintaxis copiada (`:node-id`, ids entre
 *  comillas) antes de comparar: los objetivos son valores de pertenencia, como
 *  correctAnswer. */
export function resolveTargetId(
	target: string,
	nodes: ReadonlyArray<Pick<GraphNode, "id" | "name">>,
): string | null {
	const t = stripModelValueDebris(target);
	if (t.length === 0) return null;
	if (nodes.some((n) => n.id === t)) return t;
	const lower = t.toLowerCase();
	for (const n of nodes) {
		if (stripModelValueDebris(n.name).toLowerCase() === lower) return n.id;
	}
	return null;
}

export function formatChainLine(
	chain: Pick<ReasoningChain, "premises" | "conclusion">,
	propositions: Readonly<Record<string, { name: string }>>,
): string {
	const nameOf = (id: string) => propositions[id]?.name ?? id;
	const premises = [...chain.premises].sort().map(nameOf).join(", ");
	return premises !== ""
		? `${premises} → ${nameOf(chain.conclusion)}`
		: `${nameOf(chain.conclusion)} (no premises)`;
}
