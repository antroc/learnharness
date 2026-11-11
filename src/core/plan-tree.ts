import type { PlanEdge, PlanNode, PlanTree } from "./contracts.ts";

/**
 * Operaciones puras y validadas sobre el árbol del plan (vision §2 "the
 * formal plan tree").
 *
 * Cada función recibe un árbol y devuelve un árbol NUEVO — nunca muta su
 * entrada. Toda validación lanza PlanTreeError con un mensaje escrito para el
 * agente (vuelve directamente como error del resultado de la herramienta),
 * que indica exactamente qué está mal y qué id/arista tiene la culpa.
 *
 * Invariantes que se imponen en todas partes:
 * - Los ids de nodo son únicos y no vacíos; cada extremo de arista referencia
 *   un nodo existente.
 * - La estructura es un DAG: sin bucles sobre sí mismo, sin aristas
 *   duplicadas, sin ciclos.
 * - `version` se incrementa en cada operación correcta que CAMBIA EL ESTADO.
 *   Las operaciones que de verdad no hacen nada (setCurrent al nodo que ya es
 *   el actual, markDone de un nodo ya hecho) devuelven el árbol de entrada sin
 *   cambios — la versión gobierna la reanimación de la interfaz, así que algo
 *   que no cambia no debe incrementarla. createTree siempre empieza en la
 *   versión 1.
 */

/** Error que lanza cada operación ante una entrada no válida. El mensaje es legible por el agente. */
export class PlanTreeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanTreeError";
	}
}

/** Un árbol vacío, nunca guardado, que se usa como semilla antes de que se ejecute plan_init. */
export function emptyTree(): PlanTree {
	return { nodes: [], edges: [], version: 0 };
}

// ─── auxiliares de validación ────────────────────────────────────────────────

function assertValidNode(node: PlanNode): void {
	if (!node || typeof node.id !== "string" || node.id.trim() === "") {
		throw new PlanTreeError("Every node needs a non-empty `id` (a stable slug like 'chain-rule-intuition').");
	}
	if (typeof node.title !== "string" || node.title.trim() === "") {
		throw new PlanTreeError(`Node "${node.id}" needs a non-empty \`title\`.`);
	}
}

function nodeMap(nodes: PlanNode[]): Map<string, PlanNode> {
	const map = new Map<string, PlanNode>();
	for (const node of nodes) {
		assertValidNode(node);
		if (map.has(node.id)) {
			throw new PlanTreeError(`Duplicate node id "${node.id}" — node ids must be unique.`);
		}
		map.set(node.id, node);
	}
	return map;
}

function requireNode(map: Map<string, PlanNode>, id: string, what: string): void {
	if (!map.has(id)) {
		throw new PlanTreeError(`${what} references unknown node id "${id}" — it is not in the tree.`);
	}
}

function edgeKey(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

/**
 * ¿Crearía un ciclo añadir la arista from→to? Recorre hacia delante desde
 * `to` por las aristas existentes; si se puede llegar a `from`, la arista
 * nueva cierra un bucle.
 */
function createsCycle(edges: PlanEdge[], from: string, to: string): boolean {
	const adjacency = new Map<string, string[]>();
	for (const e of edges) {
		const list = adjacency.get(e.from);
		if (list) list.push(e.to);
		else adjacency.set(e.from, [e.to]);
	}
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === from) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const next of adjacency.get(current) ?? []) stack.push(next);
	}
	return false;
}

/** Validación completa de una arista contra los nodos/aristas existentes: los extremos existen, sin bucle sobre sí misma, sin duplicado, acíclica. */
function assertValidEdge(from: string, to: string, nodes: PlanNode[], existingEdges: PlanEdge[]): void {
	const map = nodeMap(nodes); // también vuelve a validar los nodos en createTree
	requireNode(map, from, "Edge `from`");
	requireNode(map, to, "Edge `to`");
	if (from === to) {
		throw new PlanTreeError(`Edge "${from}" → "${to}" is a self-loop — a node can't require itself.`);
	}
	if (existingEdges.some((e) => e.from === from && e.to === to)) {
		throw new PlanTreeError(`Edge "${from}" → "${to}" already exists — duplicate edges are not allowed.`);
	}
	if (createsCycle(existingEdges, from, to)) {
		throw new PlanTreeError(
			`Edge "${from}" → "${to}" would create a cycle: "${to}" already leads (directly or transitively) back to "${from}". ` +
				`"from" must be understood before "to" — the tree is a DAG.`,
		);
	}
}

// ─── operaciones ─────────────────────────────────────────────────────────────

/** Construye un árbol nuevo (versión 1) a partir de listas de nodos y aristas, validando todos los invariantes. */
export function createTree(nodes: PlanNode[], edges: PlanEdge[]): PlanTree {
	const map = nodeMap(nodes);
	for (const e of edges) {
		requireNode(map, e.from, "Edge `from`");
		requireNode(map, e.to, "Edge `to`");
	}
	const accepted: PlanEdge[] = [];
	for (const e of edges) {
		// Cada arista se comprueba contra las ya aceptadas, así que cualquier
		// infracción nombra la arista culpable.
		assertValidEdge(e.from, e.to, nodes, accepted);
		accepted.push({ from: e.from, to: e.to });
	}
	return { nodes: nodes.map((n) => ({ ...n })), edges: accepted, version: 1 };
}

// Las operaciones de mutación por nodo (addNode/updateNode/removeNode/addEdge/
// removeEdge/setCurrent/markDone) se eliminaron con el protocolo de redactar una vez
// (2026-09-03) y sus exports muertos se quitaron con el giro del 2026-09-11: el
// árbol SOLO lleva estructura — no existen campos de progreso que mutar
// (docs/archive/probe-teach-split.md §3). Reestructurar es reescribir con plan_init.
