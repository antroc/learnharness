/**
 * El motor de disposición — d3-force en todas partes (DECIDIDO el 2026-09-13).
 *
 * Un solo motor es dueño del equilibrio: el asentamiento incremental al
 * fusionar Y la física de arrastre en vivo ejecutan el MISMO conjunto de
 * fuerzas (enlaces como muelles, repulsión de carga, gravedad débil), para
 * que el registro de posiciones y la simulación transitoria coincidan en qué
 * significa «en reposo». (FA2 se sustituyó tras una ronda de investigación:
 * no tiene modelo de recocido/fijación/asentamiento, y mezclarlo con otro
 * motor en vivo recoloca visiblemente el grafo en cada arrastre.)
 *
 * La disposición EVOLUCIONA en lugar de barajarse (opción A): cada
 * asentamiento arranca en caliente desde el registro de posiciones y ata con
 * un muelle cada nodo ya posicionado a su ancla (una fuerza de anclaje por
 * nodo). Los nodos nuevos se siembran cerca de sus vecinos posicionados; los
 * huérfanos se siembran en el borde, FUERA del núcleo, y se anclan allí, de
 * modo que se leen como «conocimiento aún sin conectar».
 *
 * Restricciones de diseño (mantenidas a propósito, por la física en vivo):
 *  - PURO: sin fs, sin tipos del servidor — este módulo se ejecuta en el
 *    servidor (el asentamiento al fusionar) y en el navegador (la simulación
 *    en vivo, a través del barrel del núcleo). Un nodo fijado es solo fx/fy;
 *    un nodo anclado es un muelle.
 *  - DETERMINISTA: las semillas se derivan del id del nodo; los ticks de
 *    d3-force son deterministas — mismas entradas, misma disposición.
 */

import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode, Position } from "./contracts.ts";
import { seededRandom } from "./question-core.ts";

/** Un nodo que muta la simulación de d3 (x/y/vx/vy; fx/fy = fijado). */
export interface LayoutNode extends SimulationNodeDatum {
	id: string;
}

/** Un enlace tal como lo ve d3 (las cadenas de id se resuelven a referencias de nodo al iniciar). */
type SimLink = SimulationLinkDatum<LayoutNode>;

/** Cómo se expresa espacialmente el rango de inferencia (playground,
 *  2026-09-13): las aristas `follows`/`supports` del grafo codifican la
 *  derivación (premisa → conclusión), así que los nodos de profundidad 0 (sin
 *  aristas entrantes — los fundamentos) pueden anclar una línea base común y
 *  cada nivel de derivación se eleva desde ella.
 *  `vertical`: los niveles son filas horizontales y las flechas apuntan arriba.
 *  `radial`: los niveles son anillos concéntricos, con los fundamentos en el
 *  centro; el límite exterior ES el borde del conocimiento del usuario.
 *  `off`: la disposición libre de hoy. */
export type DepthAnchorMode = "off" | "vertical" | "radial";

export interface DepthAnchor {
	mode: DepthAnchorMode;
	/** Atracción del ancla hacia el nivel (mismas unidades que clusterPull). */
	strength: number;
	/** Distancia entre niveles de inferencia consecutivos (unidades del mundo). */
	spacing: number;
	/** Punto base: el modo vertical usa .y como línea de profundidad 0; el
	 *  modo radial usa el punto completo como centro de los anillos. Por defecto (0,0). */
	center?: { x: number; y: number };
	/** Radio del anillo interior (solo radial; los nodos de profundidad 0 están en este anillo). */
	baseRadius?: number;
}

/** Profundidad de inferencia por nodo: la cadena más larga de aristas
 * dirigidas desde un nodo base. SEGURO ANTE CICLOS (2026-09-13, requisito del
 * usuario — la propiedad de DAG es lo típico, no algo garantizado): la
 * condensación de CFC de Tarjan colapsa cada componente fuertemente conexa en
 * un supernodo, ordena por rango la condensación (siempre acíclica), y cada
 * miembro de un ciclo comparte la profundidad de su componente — el apoyo
 * mutuo se lee como igualdad de condiciones. Tarjan iterativo (sin límites de
 * profundidad de recursión), O(V+E), determinista. */
export function inferenceDepths(
	nodes: ReadonlyArray<Pick<GraphNode, "id">>,
	edges: ReadonlyArray<LayoutEdge>,
): Map<string, number> {
	const valid = new Set(nodes.map((n) => n.id));
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		if (e.from === e.to || !valid.has(e.from) || !valid.has(e.to)) continue;
		let list = adj.get(e.from);
		if (!list) adj.set(e.from, (list = []));
		list.push(e.to);
	}

	// CFC de Tarjan iterativo.
	const num = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const comp = new Map<string, number>();
	let counter = 0;
	let compCount = 0;
	for (const start of valid) {
		if (num.has(start)) continue;
		num.set(start, counter);
		low.set(start, counter);
		counter++;
		stack.push(start);
		onStack.add(start);
		const work: [string, number][] = [[start, 0]];
		while (work.length > 0) {
			const frame = work[work.length - 1]!;
			const v = frame[0];
			const outs = adj.get(v) ?? [];
			if (frame[1] < outs.length) {
				const i = frame[1];
				frame[1] = i + 1;
				const w = outs[i]!;
				if (!num.has(w)) {
					num.set(w, counter);
					low.set(w, counter);
					counter++;
					stack.push(w);
					onStack.add(w);
					work.push([w, 0]);
				} else if (onStack.has(w)) {
					low.set(v, Math.min(low.get(v)!, num.get(w)!));
				}
			} else {
				work.pop();
				if (low.get(v) === num.get(v)) {
					let w: string;
					do {
						w = stack.pop()!;
						onStack.delete(w);
						comp.set(w, compCount);
					} while (w !== v);
					compCount++;
				}
				if (work.length > 0) {
					const parent = work[work.length - 1]![0];
					low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
				}
			}
		}
	}

	// Predecesores de la condensación y luego el camino más largo. Tarjan emite primero
	// los sumideros, así que el índice de componente descendente = orden topológico (fuentes primero).
	const preds: Set<number>[] = Array.from({ length: compCount }, () => new Set<number>());
	for (const e of edges) {
		const a = comp.get(e.from);
		const b = comp.get(e.to);
		if (a == null || b == null || a === b) continue;
		preds[b]!.add(a);
	}
	const depth = new Array<number>(compCount).fill(0);
	for (let c = compCount - 1; c >= 0; c--) {
		let d = 0;
		for (const p of preds[c]!) d = Math.max(d, depth[p]! + 1);
		depth[c] = d;
	}
	const out = new Map<string, number>();
	for (const n of nodes) out.set(n.id, depth[comp.get(n.id)!] ?? 0);
	return out;
}

export interface SimOptions {
	/** Longitud de reposo del muelle de enlace (unidades del mundo). */
	linkDistance?: number;
	/** MULTIPLICADOR de rigidez del muelle de enlace (1 = la rigidez por
	 *  defecto de d3, 1/min(grado)). */
	linkStrength?: number;
	/** Intensidad de la repulsión many-body (negativa). */
	chargeStrength?: number;
	/** Gravedad del centro de masas: atrae hacia dentro los componentes sueltos.
	 *  Débil — son las anclas, no la gravedad, las que sostienen el marco de la
	 *  disposición evolucionada. */
	gravity?: { x: number; y: number; strength: number };
	/** Decaimiento de alpha por tick — más alto = asentamiento más rápido. El
	 *  asentamiento al fusionar usa el 0.0228 por defecto de d3 (~300 ticks);
	 *  la simulación en vivo pasa ~0.05. */
	alphaDecay?: number;
	/** Amortiguación de la velocidad por tick (0.4 por defecto en d3). Más alto = más fricción. */
	velocityDecay?: number;
	/** Anclaje por profundidad de inferencia (consulta DepthAnchor). Desactivado por defecto. */
	depthAnchor?: DepthAnchor;
	/** La lista LÓGICA de aristas (proposición→conclusión, con los saltos imp
	 *  contraídos) para la maquinaria de profundidad — la detección de
	 *  huérfanos Y la pasada de rango (responsable, 2026-09-30). Ausente =
	 *  `edges` (comportamiento heredado). Los muelles SIEMPRE actúan sobre
	 *  `edges` — las flechas dibujadas. */
	logicalEdges?: ReadonlyArray<LayoutEdge>;
	/** La conexión de cadena de los nodos imp derivados (id + miembros),
	 *  directamente de deriveView. Gobierna el ANCLA DE PUNTO MEDIO IMP
	 *  (responsable, 2026-09-30): la profundidad de un nodo de implicación es
	 *  la media entre la fila de la premisa MÁS ALTA y la fila de la
	 *  conclusión — estrictamente por encima de cada premisa, estrictamente
	 *  por debajo de la conclusión, uniforme en los modos vertical (una fila) y
	 *  radial (un anillo). Ausente = los nodos imp mantienen la exención
	 *  heredada de huérfanos (nunca se anclan por profundidad). */
	impLinks?: ReadonlyArray<ImpLink>;
	/** Atracción al centroide del clúster (el «nodo virtual» sin el nodo): los
	 *  miembros de cada clúster aceleran hacia el centroide de su propio
	 *  clúster. Dos pasadas O(n) por tick — más barato que un nodo virtual
	 *  real (que necesitaría un muelle de enlace extra por miembro más una
	 *  posición mantenida). Intensidad 0 o ausente = fuerza desactivada.
	 *  Quien llama aporta la partición (forma de la salida de Louvain). */
	clusterPull?: {
		clusters: ReadonlyArray<{ members: ReadonlyArray<string> }>;
		strength: number;
	};
}

/** Entrada de enlaces: a efectos de disposición las aristas no tienen dirección. */
export interface LayoutEdge {
	from: string;
	to: string;
}

/** La conexión de cadena de un nodo de implicación derivado — lo que
 *  necesita la pasada de profundidad para anclar el cruce entre sus premisas
 *  y su conclusión. */
export interface ImpLink {
	/** El id del nodo imp (con prefijo arg_ — el id de la cadena guardada). */
	id: string;
	premises: ReadonlyArray<string>;
	conclusion: string;
}

export const LINK_DISTANCE = 40;
/** Prefijo de id de los nodos de implicación (la ley de acuñación vive en
 *  newGraphChainId de core/graph.ts). En la disposición: los enlaces que TOCAN
 *  un nodo imp reciben la MITAD de la longitud de reposo base — la geometría
 *  del argumento (un punto de convergencia) queda pegada a sus
 *  premisas/conclusión en lugar de dispersarse como un ciudadano proposición
 *  real (decisión del responsable, arco de renderizado 2026-09-30). */
const IMP_ID_PREFIX = "arg_";
const impLinkId = (v: string | number | { id: string }): string =>
	typeof v === "object" ? v.id : String(v);
export const CHARGE_STRENGTH = -240; // 2026-09-17: −120 → −240 (usuario: repulsión por defecto demasiado débil); el valor por defecto se comparte con render-settings (centrado gm en CHARGE_RANGE).
/** Remezcla del ancla por tick: fracción del desplazamiento de un nodo
 *  anclado respecto a su posición anterior que SOBREVIVE a cada tick. 0.85 =
 *  evolución suave donde las fuerzas son fuertes, quietud donde no lo son —
 *  la constante exacta de la época de FA2. En el espacio de posiciones
 *  (independiente de alpha), así que los muelles de enlace de largo alcance
 *  de d3 no pueden dominarla como sí ocurre con un ancla en el espacio de
 *  fuerzas (forceLink es un muelle de Hooke: strength*(d-L)*alpha). */
const ANCHOR_RETENTION = 0.85;
/** Intensidades de gravedad. La repulsión manyBody de d3 decae como 1/d, así
 *  que dos manchas de 20 nodos a distancia d se empujan con
 *  ~n1*n2*|charge|/d; la separación de los clústeres se asienta donde eso
 *  iguala g*d*n/2 — g=0.03 deja los clústeres a ~400 unidades del mundo (la
 *  densidad de la época de FA2), y la remezcla del ancla (en el espacio de
 *  posiciones, independiente de alpha) impide que el hundimiento transitorio
 *  de la gravedad mueva jamás un nodo anclado en reposo. */
const BOOTSTRAP_GRAVITY = 0.2;
/** Exportado: la simulación en vivo lo reutiliza para que su estado de
 *  reposo coincida con el equilibrio del asentamiento del servidor (un motor,
 *  un reposo). */
export const INCREMENTAL_GRAVITY = 0.12;
/** Exportado: intensidad por defecto de la atracción al centroide del
 *  clúster (ajustada por reproducción — lo bastante compacta para leerse
 *  como manchas y lo bastante débil para que la forma del clúster siga siendo
 *  la de la red de aristas). */
export const CLUSTER_PULL_STRENGTH = 0.15;

/**
 * El único conjunto de fuerzas. Devuelve una simulación PARADA — quien llama
 * la gobierna a mano (un tick por fotograma en vivo, o un bucle de ticks
 * acotado al asentar). Determinista; muta `nodes` in situ (semántica de d3:
 * impuro por diseño, cero reservas de memoria por tick).
 */
export function createGraphSimulation(
	nodes: LayoutNode[],
	edges: ReadonlyArray<LayoutEdge>,
	options: SimOptions = {},
): Simulation<LayoutNode, SimLink> {
	// Rigidez de enlace: la de d3 por defecto es 1/min(grado) (muelles escalados por grado).
	// linkStrength la multiplica, así que 1 = comportamiento por defecto sin cambios.
	const degree = new Map<string, number>();
	for (const e of edges) {
		degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
		degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
	}
	const linkStrength = options.linkStrength ?? 1;
	const linkDistance = options.linkDistance ?? LINK_DISTANCE;

	const sim = forceSimulation<LayoutNode, SimLink>(nodes)
		.force(
			"link",
			forceLink<LayoutNode, SimLink>(
				edges.map((e) => ({ source: e.from, target: e.to })),
			)
				.id((d) => d.id)
				// Longitud de reposo por enlace (arco de renderizado, responsable 2026-09-30): un
				// enlace que toca un nodo de implicación (id con prefijo arg_ — en forma de cadena
				// antes de iniciar y como referencia de nodo después) recibe la MITAD de la
				// distancia base, sea la de por defecto o la ajustada por el usuario.
				.distance(
					(l) =>
						impLinkId(l.source).startsWith(IMP_ID_PREFIX) || impLinkId(l.target).startsWith(IMP_ID_PREFIX)
							? linkDistance / 2
							: linkDistance,
				)
				.strength(
					(l) =>
						(linkStrength * 1) /
						Math.min(degree.get((l.source as LayoutNode).id) ?? 1, degree.get((l.target as LayoutNode).id) ?? 1),
				),
		)
		.force("charge", forceManyBody<LayoutNode>().strength(options.chargeStrength ?? CHARGE_STRENGTH))
		.alphaDecay(options.alphaDecay ?? 0.0228)
		.velocityDecay(options.velocityDecay ?? 0.4)
		.stop();

	// Gravedad proyectada según el modo: en modo vertical la fuerza de profundidad es
	// DUEÑA del eje y, así que la gravedad actúa solo en x (lucharía con las líneas de
	// nivel); en modo radial una atracción al centro es puramente radial y lucharía con
	// los anillos, así que se elimina del todo (los anillos ya acotan el radio).
	// Proyecciones del modo de profundidad (DECIDIDO el 2026-09-13), con la REGLA DE
	// HUÉRFANOS (decidida por el usuario el mismo día): un nodo sin ninguna arista no
	// tiene estructura de dependencias — la profundidad es propiedad de las cadenas de
	// inferencia, así que estampar proposiciones sin conexión en la línea base / anillo
	// base les asigna un significado que no tienen. Los huérfanos están exentos de la
	// fuerza de profundidad y conservan en su lugar las fuerzas de la vista NORMAL
	// (gravedad central completa + atracción completa al clúster, sin proyectar).
	// CORREGIDO (responsable, seguimiento de física del 2026-09-30): en modo VERTICAL
	// el polo central es una fuerza HORIZONTAL para todos — estructurados y huérfanos/imp
	// por igual — y pertenece a las filas de profundidad y a nada más; la atracción
	// normal completa solo sobrevive en modo radial (donde los anillos son dueños del radio).
	const mode = options.depthAnchor?.mode ?? "off";
	// La maquinaria de profundidad lee la lista LÓGICA de aristas si se aporta —
	// la estructura es inferencia entre proposiciones, no la geometría dibujada.
	const depthEdges = options.logicalEdges ?? edges;
	let orphan: Uint8Array | null = null;
	let depthsComputed: Map<string, number> | null = null;
	if (mode !== "off") {
		const connected = new Set<string>();
		const valid = new Set(nodes.map((n) => n.id));
		for (const e of depthEdges) {
			// Los bucles sobre sí mismos y los extremos colgantes no son estructura (las mismas
			// protecciones que inferenceDepths).
			if (e.from === e.to || !valid.has(e.from) || !valid.has(e.to)) continue;
			connected.add(e.from);
			connected.add(e.to);
		}
		// Primero los rangos de las proposiciones; luego el ANCLA DE PUNTO MEDIO IMP
		// (responsable, 2026-09-30): la profundidad de un nodo de implicación = (fila de la
		// premisa más alta + fila de la conclusión) / 2 — el cruce queda estrictamente por
		// encima de cada premisa y estrictamente por debajo de la conclusión (una conclusión
		// siempre es ≥ premisa más alta + 1), uniforme en ambos modos: una fila en
		// vertical, un anillo en radial. Los ids imp SIN un enlace aportado
		// mantienen la exención heredada.
		depthsComputed = inferenceDepths(
			nodes.filter((n) => !n.id.startsWith(IMP_ID_PREFIX)),
			depthEdges,
		);
		const anchored = new Set<string>();
		if (options.impLinks) {
			for (const link of options.impLinks) {
				const conclusionDepth = depthsComputed.get(link.conclusion);
				if (conclusionDepth === undefined || link.premises.length === 0) continue;
				let highest = -Infinity;
				let complete = true;
				for (const premise of link.premises) {
					const d = depthsComputed.get(premise);
					if (d === undefined) {
						complete = false;
						break;
					}
					if (d > highest) highest = d;
				}
				if (!complete) continue;
				depthsComputed.set(link.id, (highest + conclusionDepth) / 2);
				anchored.add(link.id);
			}
		}
		orphan = new Uint8Array(nodes.length);
		nodes.forEach((n, i) => {
			// Los nodos IMP con ancla de punto medio son ESTRUCTURADOS (se sitúan en su
			// media fila); los ids arg_ sin enlace mantienen la exención de huérfanos.
			if (!connected.has(n.id) && !(n.id.startsWith(IMP_ID_PREFIX) && anchored.has(n.id))) orphan![i] = 1;
		});
	}
	const g = options.gravity;
	if (g && mode === "off") {
		sim.force("x", forceX<LayoutNode>(g.x).strength(g.strength));
		sim.force("y", forceY<LayoutNode>(g.y).strength(g.strength));
	} else if (g) {
		// Gravedad proyectada según el modo, EXACTAMENTE la matemática de forceX/forceY de d3
		// (fuerza restauradora × intensidad × alpha). VERTICAL (responsable, seguimiento de
		// física del 2026-09-30): el polo central es SOLO horizontal para TODOS los nodos —
		// estructurados (la fuerza de profundidad es dueña de y) y huérfanos/imp por igual (un
		// nodo sin estructura no tiene fila en la que situarse ni polo hacia el que hundirse;
		// su y es libre). RADIAL: los huérfanos conservan la atracción normal completa; los
		// estructurados no reciben nada (los anillos son dueños del radio).
		const orphanMask = orphan!;
		sim.force("gravity", (alpha: number) => {
			for (let i = 0; i < nodes.length; i++) {
				const n = nodes[i]!;
				if (mode === "vertical") {
					n.vx = (n.vx ?? 0) + (g.x - (n.x ?? 0)) * g.strength * alpha;
				} else if (orphanMask[i]) {
					n.vx = (n.vx ?? 0) + (g.x - (n.x ?? 0)) * g.strength * alpha;
					n.vy = (n.vy ?? 0) + (g.y - (n.y ?? 0)) * g.strength * alpha;
				}
				// radial + estructurado: nada — los anillos son dueños del radio.
			}
		});
	}

	// Atracción al centroide del clúster: el índice de pertenencia se resuelve UNA vez (los
	// nodos no cambian de clúster a mitad de simulación); cada tick son dos pasadas O(n)
	// sin reservas de memoria (suma y luego atracción). Los aislados (<2 miembros) se omiten.
	const cp = options.clusterPull;
	if (cp && cp.strength > 0 && cp.clusters.length > 0) {
		const clusterIdx = new Map<string, number>();
		cp.clusters.forEach((c, i) => {
			for (const id of c.members) clusterIdx.set(id, i);
		});
		const nodeCluster = nodes.map((n) => clusterIdx.get(n.id) ?? -1);
		const k = cp.clusters.length;
		const sumX = new Float64Array(k);
		const sumY = new Float64Array(k);
		const cnt = new Float64Array(k);
		const strength = cp.strength;
		// La atracción al centroide del clúster también respeta el modo de profundidad:
		// vertical → solo x (la fuerza de profundidad es dueña de y); radial → solo
		// tangencial (la componente radial sacaría a los miembros de sus anillos; la
		// componente tangencial sigue estrechando la dispersión angular de cada clúster,
		// que es todo lo que el agrupamiento necesita hacer ahí).
		const ringCx = options.depthAnchor?.center?.x ?? 0;
		const ringCy = options.depthAnchor?.center?.y ?? 0;
		sim.force("clusterPull", (alpha: number) => {
			sumX.fill(0);
			sumY.fill(0);
			cnt.fill(0);
			for (let i = 0; i < nodes.length; i++) {
				const ci = nodeCluster[i]!;
				if (ci < 0) continue;
				const n = nodes[i]!;
				sumX[ci] = sumX[ci]! + (n.x ?? 0);
				sumY[ci] = sumY[ci]! + (n.y ?? 0);
				cnt[ci] = cnt[ci]! + 1;
			}
			for (let i = 0; i < nodes.length; i++) {
				const ci = nodeCluster[i]!;
				if (ci < 0 || (cnt[ci] ?? 0) < 2) continue;
				const n = nodes[i]!;
				const px = n.x ?? 0;
				const py = n.y ?? 0;
				const ux = sumX[ci]! / cnt[ci]! - px;
				const uy = sumY[ci]! / cnt[ci]! - py;
				if (orphan && orphan[i]) {
					// Huérfanos: atracción completa de la vista normal (consulta la REGLA DE HUÉRFANOS de arriba).
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
					n.vy = (n.vy ?? 0) + uy * strength * alpha;
				} else if (mode === "vertical") {
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
				} else if (mode === "radial") {
					const rx = px - ringCx;
					const ry = py - ringCy;
					const r = Math.hypot(rx, ry);
					if (r > 1e-9) {
						// Componente tangencial: u − (u·r̂)r̂
						const dot = (ux * rx + uy * ry) / (r * r);
						n.vx = (n.vx ?? 0) + (ux - dot * rx) * strength * alpha;
						n.vy = (n.vy ?? 0) + (uy - dot * ry) * strength * alpha;
					}
				} else {
					n.vx = (n.vx ?? 0) + ux * strength * alpha;
					n.vy = (n.vy ?? 0) + uy * strength * alpha;
				}
			}
		});
	}

	// ── Anclaje por profundidad de inferencia ────────────────────────────
	// El rango se CALCULA (no se simula): escalar objetivo por nodo derivado de
	// inferenceDepths, y luego una pasada de atracción O(n) por tick. Control suave —
	// una intensidad alta se acerca a filas/anillos fijados y una baja deja un
	// hundimiento orgánico.
	const da = options.depthAnchor;
	if (da && da.mode !== "off" && da.strength > 0) {
		// El mapa de rangos (proposiciones + anclas de punto medio imp) se calculó con la
		// máscara de huérfanos de arriba — una pasada, compartida.
		const depths = depthsComputed!;
		const strength = da.strength;
		const spacing = da.spacing;
		const c = da.center ?? { x: 0, y: 0 };
		const orphanMask = orphan; // REGLA DE HUÉRFANOS: la profundidad omite los nodos sin estructura
		if (da.mode === "vertical") {
			const baseY = c.y;
			sim.force("depth", (alpha: number) => {
				for (let i = 0; i < nodes.length; i++) {
					if (orphanMask?.[i]) continue;
					const n = nodes[i]!;
					const targetY = baseY - (depths.get(n.id) ?? 0) * spacing;
					n.vy = (n.vy ?? 0) + (targetY - (n.y ?? 0)) * strength * alpha;
				}
			});
		} else {
			const baseR = da.baseRadius ?? 0;
			const cx0 = c.x;
			const cy0 = c.y;
			sim.force("depth", (alpha: number) => {
				for (let i = 0; i < nodes.length; i++) {
					if (orphanMask?.[i]) continue;
					const n = nodes[i]!;
				const dx = (n.x ?? 0) - cx0;
					const dy = (n.y ?? 0) - cy0;
					// Dirección degenerada justo en el centro del anillo: se empuja
					// hacia fuera sobre un eje determinista.
					const r = Math.hypot(dx, dy);
					const ux = r > 1e-9 ? dx / r : 1;
					const uy = r > 1e-9 ? dy / r : 0;
					const target = baseR + (depths.get(n.id) ?? 0) * spacing;
					const mag = (target - r) * strength * alpha;
					n.vx = (n.vx ?? 0) + ux * mag;
					n.vy = (n.vy ?? 0) + uy * mag;
				}
			});
		}
	}
	return sim;
}

export interface IncrementalLayoutOptions {
	/** Ticks manuales del asentamiento (300 por defecto — el recocido de d3 hasta alphaMin). */
	ticks?: number;
	/** Remezcla del ancla por tick (0.85 por defecto; 1 = totalmente fijado). */
	anchorRetention?: number;
	/** Sustitución de la intensidad de la gravedad del centro de masas
	 *  (ajustes/experimentos A-B; por defecto, las constantes internas de
	 *  arranque/incrementales). */
	gravityStrength?: number;
	/** Partición en clústeres (forma de la salida de Louvain). La aportan los
	 *  llamadores para que este módulo no dependa de louvain (el bundle del
	 *  navegador no debe llevar registro de embeddings; ausente = sin atracción al clúster. */
	clusters?: ReadonlyArray<{ members: ReadonlyArray<string> }>;
	/** Intensidad de la atracción al centroide del clúster (por defecto CLUSTER_PULL_STRENGTH). */
	clusterPullStrength?: number;
	/** Anclaje por profundidad de inferencia (consulta DepthAnchor). `center`
	 *  es por defecto el centroide del núcleo anclado. */
	depthAnchor?: DepthAnchor;
	/** La lista LÓGICA de aristas para la pasada de profundidad (consulta SimOptions). */
	logicalEdges?: ReadonlyArray<LayoutEdge>;
	/** La conexión de cadena imp para el ancla de punto medio (consulta SimOptions). */
	impLinks?: ReadonlyArray<ImpLink>;
}

/**
 * Un asentamiento incremental. `nodes`/`edges` describen el grafo ACTUAL;
 * `previous` es el registro de posiciones (vacío en el primerísimo
 * asentamiento — entonces esto se degrada a un arranque de dispersión
 * sembrada). Devuelve posiciones para TODOS los nodos de `nodes`.
 */
export function incrementalLayout(
	nodes: ReadonlyArray<Pick<GraphNode, "id">>,
	edges: ReadonlyArray<LayoutEdge>,
	previous: ReadonlyMap<string, Position>,
	options: IncrementalLayoutOptions = {},
): Map<string, Position> {
	const ticks = options.ticks ?? 300;
	const retention = options.anchorRetention ?? ANCHOR_RETENTION;

	// Anclas: el conjunto del arranque en caliente (el estado de reposo anterior).
	const anchors = new Map<string, Position>();
	for (const node of nodes) {
		const prev = previous.get(node.id);
		if (prev) anchors.set(node.id, { x: prev.x, y: prev.y });
	}

	// La caja envolvente + el centroide del núcleo anclado, para las semillas del borde.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let cx = 0;
	let cy = 0;
	for (const a of anchors.values()) {
		minX = Math.min(minX, a.x);
		maxX = Math.max(maxX, a.x);
		minY = Math.min(minY, a.y);
		maxY = Math.max(maxY, a.y);
		cx += a.x;
		cy += a.y;
	}
	const hasCore = anchors.size > 0;
	if (hasCore) {
		cx /= anchors.size;
		cy /= anchors.size;
	}
	const coreRadius = hasCore ? Math.max(maxX - minX, maxY - minY) / 2 : 1;

	// Adyacencia para sembrar junto a los vecinos (sin dirección: las aristas incluyen afirmaciones).
	const adjacency = new Map<string, string[]>();
	const linkTo = (a: string, b: string): void => {
		if (a === b) return;
		let list = adjacency.get(a);
		if (!list) adjacency.set(a, (list = []));
		list.push(b);
	};
	for (const e of edges) {
		linkTo(e.from, e.to);
		linkTo(e.to, e.from);
	}

	// El radio del borde se deriva del radio medio del núcleo CONECTADO — los huérfanos
	// nunca lo inflan (un radio basado en la extensión máxima se retroalimenta: el borde
	// de cada lote empuja más lejos el del siguiente, y la disposición se dispara).
	// 1.7x reproduce la densidad que producía el asentamiento de la época de FA2
	// (r medio de huérfanos ~338 frente a ~194 de los conectados).
	let rimRadius = 0;
	let connectedAnchored = 0;
	for (const [id, a] of anchors) {
		if ((adjacency.get(id)?.length ?? 0) === 0) continue;
		connectedAnchored++;
		rimRadius += Math.hypot(a.x - cx, a.y - cy);
	}
	if (connectedAnchored > 0) rimRadius = (rimRadius / connectedAnchored) * 1.7;
	else if (hasCore) rimRadius = coreRadius * 1.15; // aún no hay anclas conectadas: se recurre a la caja envolvente
	rimRadius += 4;

	// Siembra cada nodo.
	const simNodes: LayoutNode[] = nodes.map((node) => {
		const rand = seededRandom(node.id);
		const anchor = anchors.get(node.id);
		let x: number;
		let y: number;
		if (anchor) {
			// Arranque en caliente: se reanuda desde la posición de reposo anterior.
			x = anchor.x;
			y = anchor.y;
		} else {
			// Nodo nuevo: se siembra cerca de sus vecinos posicionados (el clúster con el que
			// llegó); si no, en el borde fuera del núcleo; si no, disperso.
			let sx = 0;
			let sy = 0;
			let found = 0;
			for (const nbr of adjacency.get(node.id) ?? []) {
				const na = anchors.get(nbr);
				if (na) {
					sx += na.x;
					sy += na.y;
					found++;
				}
			}
			if (found > 0) {
				x = sx / found + (rand() - 0.5) * 8;
				y = sy / found + (rand() - 0.5) * 8;
			} else if (hasCore) {
				const angle = rand() * Math.PI * 2;
				const radius = rimRadius + rand() * 8;
				x = cx + Math.cos(angle) * radius;
				y = cy + Math.sin(angle) * radius;
				// El lugar de reposo previsto de un huérfano ES la semilla del borde: se ancla
				// ahí para que la gravedad no pueda hundirlo en el núcleo. (Un lote posterior que
				// lo enlace al grafo lo atrae hacia dentro de forma natural — pero entonces
				// también tiene una posición anterior, y su ancla pasa a ser esa posición
				// anterior, exactamente como cualquier nodo.)
				anchors.set(node.id, { x, y });
			} else {
				// Arranque: la dispersión sembrada clásica.
				x = (rand() - 0.5) * 100;
				y = (rand() - 0.5) * 100;
			}
		}
		// A d3 no le importan las semillas coincidentes (no hay división), pero aun así se
		// separan los solapamientos exactos de un nodo recién llegado con su único vecino.
		if (x === 0 && y === 0) x = 0.5;
		return { id: node.id, x, y };
	});

	const sim = createGraphSimulation(simNodes, edges, {
		gravity: {
			x: cx,
			y: cy,
			strength: options.gravityStrength ?? (hasCore ? INCREMENTAL_GRAVITY : BOOTSTRAP_GRAVITY),
		},
		clusterPull: options.clusters
			? { clusters: options.clusters, strength: options.clusterPullStrength ?? CLUSTER_PULL_STRENGTH }
			: undefined,
		depthAnchor:
			options.depthAnchor && options.depthAnchor.mode !== "off"
				? { ...options.depthAnchor, center: options.depthAnchor.center ?? { x: cx, y: cy } }
				: options.depthAnchor,
		logicalEdges: options.logicalEdges,
		impLinks: options.impLinks,
	});
	const dMode = options.depthAnchor?.mode ?? "off";
	const dCenter = options.depthAnchor?.center ?? { x: cx, y: cy };
	const byId = new Map(simNodes.map((n) => [n.id, n]));
	for (let i = 0; i < ticks; i++) {
		sim.tick();
		// Remezcla del ancla (espacio de posiciones, independiente de alpha — consulta la
		// nota de ANCHOR_RETENTION). Los nodos fijados (fx/fy) se dejan a d3.
		// PROYECCIÓN DEL MODO DE PROFUNDIDAD: la remezcla conserva la disposición del
		// usuario solo en la dimensión LIBRE — x en modo vertical, el ángulo en modo
		// radial — porque la fuerza de profundidad es dueña de la dimensión restringida
		// (el nivel/anillo de un nodo es significado, no memoria). Modo off: mezcla 2D
		// completa como antes.
		if (hasCore && retention < 1) {
			for (const [id, a] of anchors) {
				const n = byId.get(id);
				if (!n || n.fx != null || n.fy != null) continue;
				const x = n.x ?? 0;
				const y = n.y ?? 0;
				if (dMode === "vertical") {
					n.x = a.x + (x - a.x) * retention;
				} else if (dMode === "radial") {
					const rx = x - dCenter.x;
					const ry = y - dCenter.y;
					const r = Math.hypot(rx, ry);
					const ax = a.x - dCenter.x;
					const ay = a.y - dCenter.y;
					const ar = Math.hypot(ax, ay);
					if (r > 1e-9 && ar > 1e-9) {
						const theta = Math.atan2(ry, rx);
						const thetaA = Math.atan2(ay, ax);
						const blended = thetaA + Math.atan2(Math.sin(theta - thetaA), Math.cos(theta - thetaA)) * retention;
						n.x = dCenter.x + r * Math.cos(blended);
						n.y = dCenter.y + r * Math.sin(blended);
					}
				} else {
					n.x = a.x + (x - a.x) * retention;
					n.y = a.y + (y - a.y) * retention;
				}
			}
		}
	}

	const out = new Map<string, Position>();
	for (const n of simNodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
	return out;
}
