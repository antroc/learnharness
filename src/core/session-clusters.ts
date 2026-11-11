/**
 * AGRUPACIÓN POR SESIÓN DE NACIMIENTO (oleada 7, fijada por el responsable el
 * 2026-09-23): los embeddings han muerto — el clúster de una proposición es la
 * SESIÓN QUE LA CREÓ, derivada de forma determinista de su procedencia. Las
 * etiquetas de los clústeres son nombres de sesión (el título del chat o la ruta
 * del fichero importado): sin llamada al modelo, sin clave, sin configuración. Lo
 * que la pasada aglomerativa agrupaba por cercanía de SIGNIFICADO, esto lo agrupa
 * por DÓNDE NACIÓ EL CONOCIMIENTO — la decisión del responsable de que la sesión
 * que acuñó un conjunto de proposiciones es la honesta "región del modelo del
 * mundo" a la que pertenecen.
 *
 * Sesión de nacimiento (decisión del responsable, 2026-09-23): el chatId del PRIMER
 * punto de procedencia superviviente de un nodo — el primer punto de la línea de
 * creación en tiempo de lectura (getGraph fusiona las líneas por id, la primera
 * línea define y la procedencia se une en orden de línea — así que provenance[0]
 * es el punto de nacimiento de las líneas supervivientes). Esto hace que el borrado
 * se autorrepare con CERO tratamiento especial: delete-nodes quita las líneas de
 * creación de una sesión y sus puntos de procedencia; un nodo compartido que
 * SOBREVIVE se reatribuye a su contribuyente restante más antiguo (provenance[0]
 * avanza), y un nodo que se queda SIN procedencia alguna simplemente queda fuera
 * de todo clúster. La partición se deriva en cada lectura — no hay ninguna
 * partición persistida que invalidar.
 *
 * Las importaciones de apuntes también son sesiones de nacimiento (decisión del
 * responsable, 2026-09-23): sus nodos llevan un id de fuente "src_…" en lugar de un
 * id de chat; el llamador los etiqueta con la ruta del fichero (kind: file en las
 * vistas de sesión). La antigua alternativa de las líneas de correspondencia para
 * nodos de apuntes sin procedencia YA NO EXISTE (responsable, 2026-09-29): toda
 * fusión escribe puntos de procedencia, y el propio registro de correspondencias
 * murió con la resolución en memoria por tarea — la procedencia es el único
 * registro de nacimiento.
 *
 * Lógica pura segura para el navegador (sin módulos integrados de node, sin fs):
 * el mismo estilo de contrato que el resto de la derivación del grafo del núcleo.
 * No se reexporta desde el barril del núcleo — el shell lee los clústeres de la
 * instantánea; solo las derivaciones del servidor (instantánea, asentamiento) y
 * las pruebas lo importan.
 */
import type { GraphChain, GraphNode } from "./contracts.ts";

/** Un clúster de sesión de nacimiento: el id de la sesión + los ids ORDENADOS de los
 * nodos miembro nacidos en ella. La forma es a propósito el contrato { members } que
 * recibe el consumidor de la disposición; `id` va incluido para los consumidores que
 * necesitan la identidad de la sesión (la unión de id + etiqueta de clúster de la
 * instantánea). */
export interface BirthSessionCluster {
	/** El id de la sesión de nacimiento — un chatId o un id de fuente de apuntes ("src_…"). */
	id: string;
	/** Ids de los nodos nacidos en esta sesión, ordenados. */
	members: string[];
}

/** La sesión de nacimiento de un nodo: el chatId de su primer punto de procedencia
 * superviviente. null si el nodo no lleva procedencia alguna (datos antiguos). */
export function birthSessionOf(node: Pick<GraphNode, "provenance">): string | null {
	return node.provenance[0]?.chatId ?? null;
}

/**
 * La partición por sesión de nacimiento sobre las LÍNEAS de nodo dadas: deduplica
 * por id (la primera línea define — la regla de getGraph), agrupa por sesión de
 * nacimiento y devuelve los grupos por tamaño descendente con los miembros ordenados
 * (salida determinista: los empates se deshacen por id de sesión ascendente). Un nodo
 * sin procedencia queda fuera de todo clúster — no pertenece a ninguna sesión que el
 * grafo pueda nombrar.
 */
export function birthSessionPartition(nodes: readonly GraphNode[]): BirthSessionCluster[] {
	const members = new Map<string, string[]>();
	const seen = new Set<string>();
	for (const node of nodes) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		const birth = birthSessionOf(node);
		if (birth === null) continue;
		const bucket = members.get(birth);
		if (bucket) bucket.push(node.id);
		else members.set(birth, [node.id]);
	}
	return [...members.entries()]
		.map(([id, list]) => ({ id, members: [...list].sort() }))
		.sort((a, b) => b.members.length - a.members.length || (a.id < b.id ? -1 : 1));
}

/** La clave de clúster que toma un nodo de implicación derivado: la MAYORÍA entre las
 * sesiones de nacimiento de sus PREMISAS (responsable, 2026-09-30 — las premisas, NO la
 * conclusión), y en caso de empate, el nacimiento PROPIO de la cadena (el primer punto
 * de su procedencia, la sesión que la afirma — determinista, y coincide de todos modos
 * con el caso común unánime). Los nodos imp siempre se vuelven a derivar, nunca nacen,
 * así que su clúster debe ser función de la derivación — y esta es esa función. */
export function impClusterKey(
	chain: Pick<GraphChain, "premises" | "provenance">,
	birthOf: (nodeId: string) => string | null,
): string | null {
	const counts = new Map<string, number>();
	for (const premise of chain.premises) {
		const birth = birthOf(premise);
		if (birth !== null) counts.set(birth, (counts.get(birth) ?? 0) + 1);
	}
	const own = chain.provenance[0]?.chatId ?? null;
	if (counts.size === 0) return own;
	let max = 0;
	for (const n of counts.values()) if (n > max) max = n;
	const winners: string[] = [];
	for (const [key, n] of counts) if (n === max) winners.push(key);
	if (winners.length === 1) return winners[0]!;
	// Empate → el nacimiento propio de la cadena; si incluso eso falta, el
	// ganador primero por orden alfabético (determinismo de último recurso).
	return own ?? winners.sort()[0]!;
}

/** Asocia los nodos imp derivados a las comunidades EN EL SITIO (la frontera
 * compartida por ambos consumidores de la pertenencia a clústeres — la atracción al
 * centroide de la simulación y la rasterización de regiones del lienzo leen listas
 * de miembros que han pasado por aquí). Solo las cadenas de VARIAS premisas
 * totalmente vivas acuñan nodos imp (las cadenas de una sola premisa se reducen a
 * flechas directas, arco de renderizado 2026-09-30); las cadenas colgantes no acuñan
 * nada. Una cadena cuya comunidad de origen falta en la lista queda fuera de todo
 * clúster — igual que sus premisas cuando el filtro de envolventes las descarta. */
export function attachImpToCommunities(
	communities: Array<{ id: string; members: string[] }>,
	propositions: ReadonlyArray<Pick<GraphNode, "id" | "provenance">>,
	chains: ReadonlyArray<Pick<GraphChain, "id" | "premises" | "conclusion" | "provenance">>,
): void {
	const birthById = new Map(propositions.map((node) => [node.id, birthSessionOf(node)]));
	const live = new Set(propositions.map((node) => node.id));
	for (const chain of chains) {
		if (chain.premises.length < 2) continue;
		if (!live.has(chain.conclusion) || !chain.premises.every((p) => live.has(p))) continue;
		const key = impClusterKey(chain, (id) => birthById.get(id) ?? null);
		const community = key === null ? undefined : communities.find((c) => c.id === key);
		if (!community) continue;
		community.members.push(chain.id);
	}
	for (const community of communities) community.members.sort();
}
