"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
// El motor de colocación — literalmente el de mermaid: dagre-d3-es, el fork
// con el que se distribuye mermaid 11 (responsable, ronda 8 del grafo del
// plan: el mismo motor que los grafos de mermaid, nuestra piel SVG se queda).
// La subruta profunda es como lo importa el propio mermaid.
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
// La curva de arista por defecto de los diagramas de flujo de mermaid: los puntos
// de paso de dagre trazados con curveBasis de d3 (la receta exacta del renderizador de dagre-d3).
import { curveBasis, line } from "d3-shape";
import { fitGraphView, fitZoomFor, zoomedGraphView, type Viewport } from "@/components/pan-zoom";
import type { PlanBlockData, PlanNodeStatus, PlanTree } from "@/src/core";
import { derivedNodeStatus, derivePlanStatuses } from "@/src/core";
import { Hint } from "@/components/ui/hint";
import { InteractionLayerOwner, useInteractionLayer } from "./interaction-layers";

/**
 * BLOQUES DE PLAN — el plan vive en el chat (oleada 4): las partes
 * `data-plan-block` persistidas se renderizan como bloques DAG en el flujo de
 * la transcripción, y la barra lateral derecha queda retirada.
 *
 * - kind "full": el DAG entero, SIN BORDE — sin cromo envolvente, el SVG
 *   se escala al ancho completo de la columna (viewBox = extensión del
 *   layout + GRAPH_PAD, para que los trazos/el brillo nunca se recorten),
 *   altura natural, con tope en el tamaño de fuente de la prosa del chat
 *   (TEXT_CAP_SCALE — llena la columna, nunca agranda el texto de más).
 * - Al hacer clic se abre el plan completo en un overlay de foco con ámbito
 *   de sesión (absoluto dentro del área de la sesión, bajo la barra de
 *   arrastre — oleada de fundido del cromo, 2026-09-19; antes era una
 *   ventana emergente fija inset-0 a pantalla completa) — el plan EN VIVO:
 *   el último árbol de la transcripción con los estados derivados en el
 *   momento del clic (derivePlanStatuses de contracts/plan.ts). Los bloques
 *   son instantáneas congeladas que se renderizan tal como llegan (nunca se
 *   vuelven a derivar); la ventana emergente es la vista en vivo (decisión
 *   del usuario, 2026-09).
 *
 * SVG hecho a mano en todas partes (decisión del usuario): la colocación
 * corre sobre dagre (el motor de mermaid — determinista, síncrono, sin DOM,
 * así que SSR y las pruebas de render siguen siendo exactas); la piel es
 * nuestra — sin acoplamiento a los internos del flujo del grafo. El
 * desplazamiento/zoom de la ventana emergente se recogió del grafo del panel
 * de árbol retirado (semántica de suelo de ajuste: el zoom mínimo ES el
 * ajuste; el desplazamiento se bloquea en el suelo).
 */

// ─── Constantes de layout + auxiliares puros (exportados para las pruebas) ───

/** Tamaño de nodo guiado por el texto (responsable, ronda de ajuste del plan
 * 2026-10-07): la caja se ciñe a su texto ajustado en lugar de a una losa
 * fija de 160px. El ancho sale de las líneas ajustadas — una estimación de
 * ancho por CLASE de carácter (la tasa plana px/carácter del primer intento
 * se pasaba del ancho real renderizado, y la holgura invisible se leía como
 * "mucho espacio vacío" junto al texto; seguimiento del responsable
 * 2026-10-07) más un relleno simétrico, con un mínimo para que los títulos
 * cortos no se reduzcan a píldoras. Estimación, NO medición en canvas: la
 * ruta del layout sigue siendo determinista, síncrona y sin DOM (SSR y las
 * fijaciones exactas de render siguen funcionando). */

/** Relleno horizontal simétrico — IGUAL al relleno vertical que recibe el
 * texto de una sola línea en NODE_H (responsable: "el relleno horizontal
 * debe ser igual que el vertical"): (44 − 11) / 2 ≈ 16 (la fuente de prosa
 * renderiza text-xs a 11px). */
export const PAD_X = 16;
export const NODE_W_MIN = 96;
export const NODE_H = 44;

// Clases de ancho para la fuente de PROSA (Source Sans 3 tal como se
// distribuye, text-xs renderizado a 11px): trazos estrechos y puntuación,
// m/w anchas, mayúsculas + dígitos, y todo lo demás. Tasas ajustadas por
// mínimos cuadrados contra mediciones de getComputedTextLength() de los
// títulos de planes reales (prueba de humo del 2026-10-07) — los residuos
// quedan dentro de ±4px por LÍNEA, así que el relleno por lado se lee como
// PAD_X ±2. Otra fuente de lectura (sustitución en Appearance) desvía un poco la estimación; aceptado.
const NARROW_CHARS = new Set(" ijltfr.,:;'!|()[]-\\");
const WIDE_CHARS = new Set("mwMW@");
const CAP_DIGIT = /[A-Z0-9]/;

/** Ancho renderizado estimado (px) de una línea en text-xs. Pura. */
export function estimateLineWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (NARROW_CHARS.has(ch)) w += 3.1;
		else if (WIDE_CHARS.has(ch)) w += 9.2;
		else if (CAP_DIGIT.test(ch)) w += 6.0;
		else w += 5.4;
	}
	return w;
}
/** Distancia entre líneas base de los títulos de los nodos. */
export const LINE_H = 13;
export const GAP_X = 24;
export const GAP_Y = 48;

/** Un nodo a efectos de layout — la forma de la carga y la del árbol coinciden. */
export interface LayoutNode {
	id: string;
	title: string;
}

/** Orden topológico + profundidad del camino más largo (Kahn, desempate por
 *  orden de autoría) — la semántica de orden y profundidad se mantiene para
 *  las pruebas; la colocación en sí corre ahora sobre dagre (responsable,
 *  ronda 8). */
export function topoFor(nodes: readonly LayoutNode[], edges: ReadonlyArray<{ from: string; to: string }>) {
	const index = new Map(nodes.map((n, i) => [n.id, i] as const));
	const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0] as const));
	const dependents = new Map<string, string[]>();
	for (const e of edges) {
		if (!index.has(e.from) || !index.has(e.to)) continue; // defensivo: ids colgantes
		indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
		const list = dependents.get(e.from);
		if (list) list.push(e.to);
		else dependents.set(e.from, [e.to]);
	}
	const ready = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
	const order: LayoutNode[] = [];
	const depth = new Map<string, number>();
	const byId = new Map(nodes.map((n) => [n.id, n] as const));
	while (ready.length > 0) {
		ready.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
		const id = ready.shift()!;
		const node = byId.get(id);
		if (node) order.push(node);
		const d = depth.get(id) ?? 0;
		depth.set(id, d);
		for (const t of dependents.get(id) ?? []) {
			if ((depth.get(t) ?? -1) < d + 1) depth.set(t, d + 1);
			const left = (indegree.get(t) ?? 0) - 1;
			indegree.set(t, left);
			if (left === 0) ready.push(t);
		}
	}
	for (const n of nodes) {
		if (!depth.has(n.id)) {
			order.push(n);
			depth.set(n.id, 0);
		}
	}
	return { order, depth };
}

/** Colocación — dagre (el motor de mermaid, ronda 8 del responsable): layout
 *  por capas al estilo Sugiyama, TB, con nuestra geometría (cajas
 *  dimensionadas por el texto, separaciones GAP_X/GAP_Y, margen cero — quien
 *  llama añade GRAPH_PAD/POPUP_PAD). Se le pasan los tamaños de los nodos
 *  (las cajas crecen con su contenido ajustado, ronda 7); dagre devuelve los
 *  CENTROS de los nodos y nosotros devolvemos las esquinas superiores
 *  izquierdas como antes, así que ningún consumidor (diagrama, ajuste de la
 *  ventana emergente, ventana del plan) cambia. Determinista + síncrona + sin
 *  DOM: SSR y las pruebas de render siguen siendo exactas. Las aristas
 *  colgantes se ignoran por defensa — un extremo fantasma generaría un nodo
 *  sin medir y rompería el medidor. */
export function blockLayout(nodes: readonly LayoutNode[], edges: ReadonlyArray<{ from: string; to: string }>) {
	const x = new Map<string, number>();
	const y = new Map<string, number>();
	const nodeH = new Map<string, number>();
	const nodeW = new Map<string, number>();
	/** Las rutas de puntos de paso por arista de dagre — cada una empieza/acaba
	 *  en la intersección con el borde del nodo en el LADO por el que la arista
	 *  sale/entra (ronda 11: el trazado de líneas de mermaid, ya no un centro
	 *  inferior → centro superior fijo). Con clave `${from}->${to}`. */
	const edgePts = new Map<string, Array<{ x: number; y: number }>>();
	if (nodes.length === 0) return { x, y, nodeH, nodeW, edgePts, width: 0, height: 0 };
	const ids = new Set(nodes.map((n) => n.id));
	const routed: Array<{ from: string; to: string }> = [];
	const g = new graphlib.Graph({ compound: false, multigraph: true });
	g.setGraph({ rankdir: "TB", nodesep: GAP_X, ranksep: GAP_Y, marginx: 0, marginy: 0 });
	for (const n of nodes) {
		const lines = wrapTitle(n.title);
		const h = NODE_H + Math.max(0, lines.length - 2) * LINE_H;
		nodeH.set(n.id, h);
		nodeW.set(n.id, nodeWidth(lines));
		g.setNode(n.id, { width: nodeW.get(n.id)!, height: h });
	}
	for (const e of edges) {
		if (ids.has(e.from) && ids.has(e.to)) {
			g.setEdge(e.from, e.to, { label: "", width: 0, height: 0 });
			routed.push(e);
		}
	}
	// (el d.ts marca opts como obligatorio; el runtime lo ignora)
	dagreLayout(g, undefined);
	for (const n of nodes) {
		const pos = g.node(n.id);
		const h = nodeH.get(n.id) ?? NODE_H;
		const w = nodeW.get(n.id) ?? NODE_W_MIN;
		if (pos) {
			x.set(n.id, pos.x - w / 2);
			y.set(n.id, pos.y - h / 2);
		}
	}
	for (const e of routed) {
		const pts: Array<{ x: number; y: number }> | undefined = g.edge(e.from, e.to)?.points;
		if (pts) edgePts.set(`${e.from}->${e.to}`, pts.map((pt) => ({ x: pt.x, y: pt.y })));
	}
	// EL LIENZO DEBE CUBRIR LAS FLECHAS (responsable, 2026-10-10): la extensión
	// del grafo de dagre es la caja envolvente de los NODOS — las curvas de las
	// aristas dibujadas encima pueden curvarse más allá (los puntos de control
	// bezier de las aristas entre columnas; se midieron recortes de 14–20px a la
	// derecha en los planes del responsable) y el viewBox las recortaba. La
	// extensión de la tinta une las cajas de los nodos con la envolvente de los
	// puntos de control de cada trazado de arista: una bezier nunca sale de la
	// envolvente de sus puntos de control, y analizar la cadena d que construye
	// edgePathD (la MISMA llamada que hace el renderizador, con las mismas
	// entradas) acota cada segmento — los pares M, L y C se alternan
	// estrictamente, así que las coincidencias pares/impares son x/y. La extensión de dagre sigue siendo el SUELO: los planes
	// cuyas flechas quedan dentro conservan viewBox idénticos byte a byte (sin rehacer cada render fijado), y el origen solo se mueve cuando la tinta sobresale de cero.
	let inkMinX = Infinity;
	let inkMinY = Infinity;
	let inkMaxX = -Infinity;
	let inkMaxY = -Infinity;
	const stretch = (px: number, py: number) => {
		if (px < inkMinX) inkMinX = px;
		if (py < inkMinY) inkMinY = py;
		if (px > inkMaxX) inkMaxX = px;
		if (py > inkMaxY) inkMaxY = py;
	};
	for (const n of nodes) {
		const nx = x.get(n.id);
		const ny = y.get(n.id);
		if (nx === undefined || ny === undefined) continue;
		stretch(nx, ny);
		stretch(nx + (nodeW.get(n.id) ?? NODE_W_MIN), ny + (nodeH.get(n.id) ?? NODE_H));
	}
	for (const e of routed) {
		const pts = edgePts.get(`${e.from}->${e.to}`);
		if (!pts) continue;
		const tx = x.get(e.to);
		const ty = y.get(e.to);
		const target =
			tx !== undefined && ty !== undefined
				? {
						x: tx,
					y: ty,
					w: nodeW.get(e.to) ?? NODE_W_MIN,
						h: nodeH.get(e.to) ?? NODE_H,
					}
				: undefined;
		const nums = edgePathD(pts, target).match(/-?\d+(?:\.\d+)?/g);
		if (!nums) continue;
		for (let i = 0; i + 1 < nums.length; i += 2) {
			stretch(parseFloat(nums[i]!), parseFloat(nums[i + 1]!));
		}
	}
	// Las coordenadas de dagre empiezan en 0; solo la tinta que pasa de cero por
	// el lado negativo mueve el origen (el x/y del viewBox se desplaza con él).
	const originX = Math.min(0, inkMinX === Infinity ? 0 : inkMinX);
	const originY = Math.min(0, inkMinY === Infinity ? 0 : inkMinY);
	return {
		x,
		y,
		nodeH,
		nodeW,
		edgePts,
		originX,
		originY,
		width: Math.max((g.graph().width ?? 0) - originX, inkMaxX === -Infinity ? 0 : inkMaxX - originX, 1),
		height: Math.max((g.graph().height ?? 0) - originY, inkMaxY === -Infinity ? 0 : inkMaxY - originY, 1),
	};
}

/** Ajuste de líneas voraz a líneas de ≤ maxChars — NO se descarta nada: la
 *  caja del nodo crece para que quepa cada línea (responsable: mostrar el
 *  contenido completo de cada nodo). Una única palabra demasiado larga se
 *  trocea a la fuerza en varias líneas de maxChars. Pura. */
export function wrapTitle(title: string, maxChars = 28): string[] {
	const words = title.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [""];
	// Las palabras demasiado largas nunca caben en una línea — se trocean para no perder contenido.
	const atoms: string[] = [];
	for (const w of words) {
		for (let i = 0; i < w.length; i += maxChars) atoms.push(w.slice(i, i + maxChars));
	}
	const lines: string[] = [];
	for (const a of atoms) {
		const last = lines[lines.length - 1];
		if (last !== undefined && last.length + 1 + a.length <= maxChars) {
			lines[lines.length - 1] = `${last} ${a}`;
		} else {
			lines.push(a);
		}
	}
	return lines;
}

// ─── Topes de geometría (responsable, ronda 1 de refinamiento del grafo del plan) ───

/** El ancho de la caja de un nodo para sus líneas ajustadas — el ceñido en sí. Pura. */
export function nodeWidth(lines: readonly string[]): number {
	const widest = Math.max(1, ...lines.map(estimateLineWidth));
	return Math.max(NODE_W_MIN, Math.ceil(widest) + 2 * PAD_X);
}

/** Relleno en unidades SVG alrededor de la extensión del layout: los trazos
 *  van centrados en la geometría (la mitad sobresale de la extensión) y el
 *  halo del brillo llega a −4 — sin este relleno, los bordes de los nodos
 *  más exteriores se recortan en el borde del svg. */
export const GRAPH_PAD = 8;
/** El brillo amarillo del nodo actual: un relleno difuminado para que se
 *  derrame sobre los bordes del nodo (responsable). La dispersión visible de
 *  una gaussiana es ≈3σ, así que el brillo llega GLOW_MARGIN + 3·GLOW_BLUR
 *  más allá del nodo — toda superficie que muestre el brillo debe ampliar su
 *  viewBox en GLOW_REACH o el difuminado se recorta en el borde del marco
 *  (responsable: ampliar el relleno del contenedor para que quepa). */
export const GLOW_MARGIN = 8;
export const GLOW_BLUR = 5;
export const GLOW_REACH = GLOW_MARGIN + 3 * GLOW_BLUR;
/** Los títulos de los nodos se renderizan a text-xs (12.5px) en unidades
 *  svg. El bloque del chat se escala para llenar la columna pero NUNCA más
 *  allá del tamaño de la prosa del chat (--lh-prose-size, 16px — el peldaño
 *  de lectura de la escalera) — el tope de ancho que lo garantiza. */
export const TEXT_CAP_SCALE = 16 / 12.5;

// ─── La punta de flecha del responsable (ronda 5 del grafo del plan) ─────────

/** Consolidada a partir de arrowhead_1.svg (la punta de flecha larga de
 *  CM/MJX), con la cadena de transformaciones colapsada: viewBox 0 0 50.2
 *  104, punta en (50.2, 52), boca de la muesca en x 27.2 con una abertura de
 *  9.6 de alto — a la altura completa de 104 la abertura de la cola es ≈10,
 *  según la especificación del responsable. Relleno sólido de tinta fuerte,
 *  sin relleno de margen. */
export const ARROW_HEAD = "M48,55.2C49.4,54.6 50.2,53.4 50.2,52C50.2,50.6 49.4,49.4 48,48.8C38.2,45.6 29.2,38.8 21,28.4C15.2,21.4 11.4,13.2 9.6,3.8C9,1.2 7.4,0 4.8,0C1.6,0 0,1.6 0,5L0.2,5.6C3.6,23 12.6,36.8 27.2,47.2L27.2,56.8C12.6,67.2 3.6,81 0.2,98.4L0,99C0,102.4 1.6,104 4.8,104C7.4,104 9,102.8 9.6,100.2C11.4,90.8 15.2,82.6 21,75.6C29.2,65.2 38.2,58.4 48,55.2Z";
/** Las líneas y los contornos usan el grosor de borde estándar de la app
 *  (responsable, 2026-09-26 — el mismo 1px de los bordes de la interfaz; antes 1.5). */
export const STROKE_W = 1;
/** Las puntas se escalan por el MISMO factor en que se adelgazaron las
 *  líneas (responsable, 2026-09-26): 16 era la altura ajustada para líneas de
 *  1.5 de ancho, así que ambos lados de la proporción punta:asta encogen a la
 *  vez — la relación de LaTeX (la abertura de la cola encajando la línea a
 *  ras) se conserva exactamente, solo que más pequeña. */
const HEAD_H = 16 * (STROKE_W / 1.5);
const HEAD_SCALE = HEAD_H / 104;
const HEAD_W = 50.2 * HEAD_SCALE;
/** La línea dibujada termina en la boca de la muesca (refX 27.2) — nunca
 *  llega a la punta estrecha, donde se transparentaría (responsable). La
 *  punta sobresale del final de la línea en esta medida, así que las aristas
 *  se acortan en ella para que la punta caiga justo en el borde del nodo de
 *  destino. */
const HEAD_TIP_OVERHANG = (50.2 - 27.2) * HEAD_SCALE;
/** La punta flota a esta distancia de la cara de destino — la punta no toca
 *  nada (responsable, ronda 12). ~media longitud de punta: claramente
 *  despegada, pero visualmente unida. Escalada con la punta (2026-09-26) para
 *  que "media punta" siga siendo cierto con las líneas más finas. */
const DOCK_GAP = 4 * (STROKE_W / 1.5);
/** El tramo de asta — el recorrido recto antes de la punta (responsable,
 *  ronda 12): los puntos de control a partir de Q están exactamente sobre la
 *  línea de aproximación, así que el spline de base dibuja ese tramo
 *  perfectamente recto y la punta cae sobre un asta recta; la esquina donde
 *  la ruta se endereza hacia la línea la redondea la curva. ~1,5 longitudes
 *  de punta de asta. */
const STRAIGHT_RUN = 12;
/** El límite de inclinación en el punto de terminación, medido respecto a
 *  la perpendicular de la cara de entrada: más allá de ±40°, una de las
 *  lengüetas de la punta cruza el nivel de la punta y la silueta se rompe (el
 *  responsable lo midió en Photoshop, ronda 14). El último tramo gira entonces
 *  hasta el borde del cono. */
const ENTRY_ANGLE_LIMIT = (40 * Math.PI) / 180;
const edgeLine = line<{ x: number; y: number }>()
	.x((p) => p.x)
	.y((p) => p.y)
	.curve(curveBasis);

/** El vector normal unitario hacia fuera de la cara de entrada — la cara de
 *  la caja de destino sobre la que esté el punto de borde de dagre. Pura. */
function faceNormal(
	border: { x: number; y: number },
	box: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
	const d = { top: border.y - box.y, bottom: box.y + box.h - border.y, left: border.x - box.x, right: box.x + box.w - border.x };
	const face = (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[a] <= d[b] ? a : b));
	switch (face) {
		case "top":
			return { x: 0, y: -1 };
		case "bottom":
			return { x: 0, y: 1 };
		case "left":
			return { x: -1, y: 0 };
		default:
			return { x: 1, y: 0 };
	}
}

/** El trazado de la arista — el propio trazado de líneas de mermaid: los
 *  puntos de paso de dagre intersecados con el borde, pasados por curveBasis
 *  de d3 (la curva por defecto de los diagramas de flujo de mermaid — la misma
 *  receta que usa el renderizador de dagre-d3). La punta se despega del
 *  destino: su PUNTA flota DOCK_GAP más allá del borde a lo largo de la
 *  NORMAL DE LA CARA (separación constante con cualquier inclinación), su
 *  boca queda al final del trazado sobre un tramo recto (el tramo de asta) y
 *  — cuando se da la caja de destino — la dirección de entrada se acota a
 *  ±ENTRY_ANGLE_LIMIT de la perpendicular de la cara (responsable, ronda 14):
 *  una aproximación natural más empinada gira hasta el borde del cono de 40°
 *  en lugar de romper la silueta de la punta. Sin caja de destino se aplica
 *  la geometría sin acotar. Las rutas rectas colineales se renderizan igual.
 *  Pura, exportada para las pruebas. */
export function edgePathD(
	points: Array<{ x: number; y: number }>,
	target?: { x: number; y: number; w: number; h: number },
): string {
	const pts = points.map((p) => ({ ...p }));
	if (pts.length >= 2) {
		const last = pts[pts.length - 1]!;
		const prev = pts[pts.length - 2]!;
		const dx = last.x - prev.x;
		const dy = last.y - prev.y;
		const len = Math.hypot(dx, dy) || 1;
		let ux = dx / len;
		let uy = dy / len;
		// La punta: DOCK_GAP fuera de la cara a lo largo de su normal (o a lo
		// largo de la aproximación cuando no se conoce la caja).
		let tipx: number;
		let tipy: number;
		if (target) {
			const n = faceNormal(last, target);
			tipx = last.x + n.x * DOCK_GAP;
			tipy = last.y + n.y * DOCK_GAP;
			// Acota la aproximación al cono de ±LIMIT alrededor de la normal: si
			// la dirección de salida -u se inclina más allá de ENTRY_ANGLE_LIMIT, se
			// gira hasta el borde del cono (en el mismo sentido de giro que la ruta).
			const v = { x: -ux, y: -uy };
			const vn = v.x * n.x + v.y * n.y;
			if (vn < Math.cos(ENTRY_ANGLE_LIMIT)) {
				const t = { x: v.x - vn * n.x, y: v.y - vn * n.y };
				const tl = Math.hypot(t.x, t.y);
				const that = tl > 0 ? { x: t.x / tl, y: t.y / tl } : { x: -n.y, y: n.x };
				const c = Math.cos(ENTRY_ANGLE_LIMIT);
				const s = Math.sin(ENTRY_ANGLE_LIMIT);
				v.x = c * n.x + s * that.x;
				v.y = c * n.y + s * that.y;
				ux = -v.x;
				uy = -v.y;
			}
		} else {
			tipx = last.x - ux * DOCK_GAP;
			tipy = last.y - uy * DOCK_GAP;
		}
		// La boca: retrocede el saliente desde la punta a lo largo de la aproximación (acotada).
		const M = { x: tipx - ux * HEAD_TIP_OVERHANG, y: tipy - uy * HEAD_TIP_OVERHANG };
		// A partir de Q los puntos de control están sobre la línea de
		// aproximación — el spline de base dibuja Q→M perfectamente recto (un
		// tramo de B-spline con puntos de control colineales ES la línea), y la
		// repetición interna de extremos de curveBasis hace que la tangente final
		// sea exactamente la dirección de aproximación. OJO: NO repitas M a mano
		// — un punto de control final duplicado genera un último segmento de
		// longitud cero, y orient="auto" en un segmento de longitud cero recurre a
		// 0° (todas las puntas apuntando a la derecha — la regresión de la ronda 12, arreglada en la ronda 13).
		const Q = { x: M.x - ux * STRAIGHT_RUN, y: M.y - uy * STRAIGHT_RUN };
		pts.splice(pts.length - 1, 1, Q, M);
	}
	return edgeLine(pts) ?? "";
}

// ─── Estilo por estado (el lenguaje de color del panel retirado, sin cambios) ───

// El aspecto sencillo (responsable, ronda 4 del grafo del plan): cajas
// rectangulares, contornos/flechas/texto en la tinta de línea fuerte (blanca
// en oscuro, el primer plano en claro); sin relleno en los visitados, el
// aspecto gris actual en los próximos, y el nodo actual lleva un leve brillo
// amarillo (un relleno amarillo difuminado que se derrama sobre los bordes).
// El bloque DEL CHAT es en cambio monocromo — sin lenguaje de estados; la ventana emergente/ventana muestran la progresión.
const BOX: Record<PlanNodeStatus, string> = {
	// Fondo de la app al 50% de opacidad en vez de transparencia real: una
	// arista que pasa por detrás de la caja se compone BAJO el relleno —
	// atenuada a la mitad, no vista directamente (responsable, ronda 9).
	visited: "fill-background/50 stroke-line-strong",
	current: "fill-background/50 stroke-line-strong",
	// El aspecto gris de aún-no-visitado se queda como está (responsable).
	upcoming: "fill-card stroke-border",
};
const TEXT: Record<PlanNodeStatus, string> = {
	visited: "fill-line-strong text-xs",
	current: "fill-line-strong text-xs font-medium",
	upcoming: "fill-muted-foreground/80 text-xs",
};
// El bloque del chat habla ahora el lenguaje del dock (responsable, ronda de
// ajuste del plan 2026-10-07): cajas en la variante de fondo más clara, como
// los armazones del composer/dock — pero los contornos SIGUEN en la tinta de
// línea fuerte, blancos en oscuro (seguimiento del responsable: el relleno gris está bien, bordes de caja blancos).
const MONO_BOX = "fill-card stroke-line-strong";
const MONO_TEXT = "fill-foreground text-xs";

/** El diagrama en sí: nodos posicionados + aristas bezier. Render casi puro
 *  — toda entrada son datos, así que las pruebas de render de SSR fijan el
 *  conjunto entero. La raíz fija font-family var(--font-prose): los títulos
 *  de los nodos se renderizan en la fuente de LECTURA, no en la fuente
 *  monoespaciada de la interfaz (responsable, 2026-09-26) — y la variable de
 *  runtime sigue la sustitución de fuente de lectura de Appearance (la
 *  utilidad no puede: @theme inline consolida literales — la trampa de
 *  --font-title). */
export function PlanDiagram({
	nodes,
	edges,
	statusOf,
	glowId,
	markerId,
	viewBoxOverride,
	pad: padUnits,
	textCapScale,
	naturalSize,
	monochrome,
	fill,
}: {
	nodes: readonly LayoutNode[];
	edges: ReadonlyArray<{ from: string; to: string }>;
	statusOf: (id: string) => PlanNodeStatus;
	glowId?: string | null;
	markerId: string;
	/** Un viewBox en ventana (la ventana del plan) en lugar de la extensión completa. */
	viewBoxOverride?: string;
	/** Amplía el viewBox en estas unidades svg para que los trazos centrados y
	 *  el halo del brillo nunca se recorten en los bordes de la extensión (solo
	 *  en renders de extensión completa). */
	pad?: number;
	/** Limita el ancho renderizado a extensión × escala — el techo de zoom al
	 *  tamaño de fuente del chat para el bloque del chat (llena la columna,
	 *  nunca más allá de la prosa). */
	textCapScale?: number;
	/** Renderiza al ancho del viewBox en px (1 unidad svg = 1 px con zoom 1) —
	 *  la matemática de transformación de la ventana emergente depende de ello;
	 *  w-full dentro del envoltorio que encoge para ajustar de la ventana
	 *  emergente se resolvía al ancho de esta y rompía el ajuste. */
	naturalSize?: boolean;
	/** El modo del bloque del chat: todos los nodos en la tinta de línea fuerte
	 *  (trazo y texto, sin brillo) — los estados nunca se muestran en la
	 *  transcripción (responsable). */
	monochrome?: boolean;
	/** Ajusta el diagrama dentro de una caja fija (h-full w-full — el
	 *  preserveAspectRatio por defecto del svg centra y contiene el viewBox): el
	 *  modo de nota al margen de la franja del dock, donde el diagrama debe caber
	 *  TANTO en el ancho del flanco como en la altura de la franja en lugar de ir
	 *  primero por el ancho. */
	fill?: boolean;
}) {
	const layout = useMemo(() => blockLayout(nodes, edges), [nodes, edges]);
	// Solo se amplía el render de extensión completa — el viewBox sustituto de la ventana
	// del plan es un recorte deliberado del viewport, y la ventana emergente mantiene sus propios márgenes de ajuste.
	const pad = viewBoxOverride ? 0 : (padUnits ?? 0);
	const w = Math.max(layout.width, 1);
	const h = Math.max(layout.height, 1);
	const vbW = w + 2 * pad;
	const vbH = h + 2 * pad;
	// El origen sigue la extensión de la tinta (responsable, 2026-10-10): una
	// flecha que sobresale de cero desplaza el viewBox con ella en vez de recortarse.
	// Los planes con origen cero (el caso normal) se renderizan exactamente igual que antes.
	const ox = viewBoxOverride ? 0 : (layout.originX ?? 0);
	const oy = viewBoxOverride ? 0 : (layout.originY ?? 0);
	return (
		<svg
			viewBox={viewBoxOverride ?? `${ox - pad} ${oy - pad} ${vbW} ${vbH}`}
			className={`block ${fill ? "h-full w-full" : `h-auto${naturalSize ? "" : " w-full"}`}${textCapScale ? " mx-auto" : ""}`}
			style={{
				// La fuente de LECTURA (responsable, 2026-09-26) — el mismo token de runtime
				// que consume font-prose, para que los cambios de Appearance lleguen al texto SVG.
				fontFamily: "var(--font-prose)",
				...(textCapScale
					? { maxWidth: `${Math.round(vbW * textCapScale * 100) / 100}px` }
					: naturalSize
						? { width: `${vbW}px` }
						: {}),
			}}
			role="img"
			aria-label="Plan diagram"
		>
			<defs>
				<marker
					id={markerId}
					viewBox="0 0 50.2 104"
					refX={27.2}
					refY={52}
					markerWidth={HEAD_W}
					markerHeight={HEAD_H}
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					{/* La punta de flecha del responsable. La boca (x 27.2) está en refX para
					que la línea acabe EN la muesca — la punta que queda más allá es relleno sólido. */}
					<path d={ARROW_HEAD} className="fill-line-strong" />
				</marker>
				{/* La misma punta, en gris — las flechas hacia nodos aún no visitados
				van en gris como los propios nodos (responsable, ronda 6). */}
				<marker
					id={`${markerId}-dim`}
					viewBox="0 0 50.2 104"
					refX={27.2}
					refY={52}
					markerWidth={HEAD_W}
					markerHeight={HEAD_H}
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d={ARROW_HEAD} className="fill-border" />
				</marker>
				{/* El resaltado del nodo actual: un leve relleno amarillo DIFUMINADO para
				que se derrame sobre los bordes del nodo (responsable). Región de filtro
				generosa para que el difuminado nunca se recorte en sus propios límites. */}
				<filter id={`${markerId}-glow`} x="-60%" y="-60%" width="220%" height="220%">
					<feGaussianBlur stdDeviation={GLOW_BLUR} />
				</filter>
			</defs>
			{edges.map((e) => {
				// La ruta de dagre para esta arista: puntos de paso intersecados con el
				// borde — la línea sale/entra de los nodos por el lado que elija dagre
				// (el trazado de mermaid, ronda 11 del responsable). Las aristas sin ruta
				// (extremos colgantes) no dibujan nada.
				const pts = layout.edgePts.get(`${e.from}->${e.to}`);
				if (!pts) return null;
				// La caja del destino — gobierna la separación del despegue + la acotación del ángulo de entrada.
				const tx = layout.x.get(e.to);
				const ty = layout.y.get(e.to);
				const target =
					tx !== undefined && ty !== undefined
						? { x: tx, y: ty, w: layout.nodeW.get(e.to) ?? NODE_W_MIN, h: layout.nodeH.get(e.to) ?? NODE_H }
						: undefined;
				// Una flecha es blanca solo cuando SUS DOS extremos son blancos
				// (responsable, 2026-09-26): origen Y final cubiertos — las flechas de salida
				// de una caja gris siguen en gris aunque apunten a territorio cubierto
				// (sustituye la regla de la ronda 6, que solo miraba el destino); el bloque
				// del chat sigue todo en blanco.
				const dim =
					!monochrome &&
					(statusOf(e.from) === "upcoming" || statusOf(e.to) === "upcoming");
				return (
					<path
						key={`${e.from}->${e.to}`}
						d={edgePathD(pts, target)}
						className={dim ? "fill-none stroke-border" : "fill-none stroke-line-strong"}
						strokeWidth={STROKE_W}
						markerEnd={`url(#${markerId}${dim ? "-dim" : ""})`}
					/>
				);
			})}
			{nodes.map((n) => {
				const status = statusOf(n.id);
				const glow = n.id === glowId && !monochrome;
				const lines = wrapTitle(n.title);
				// La caja se ciñe a su contenido ajustado; el texto se centra en ella —
				// ahora también en horizontal (ronda de tamaño guiado por el texto, 2026-10-07).
				const h = layout.nodeH.get(n.id) ?? NODE_H;
				const w = layout.nodeW.get(n.id) ?? NODE_W_MIN;
				const y0 = (h - lines.length * LINE_H) / 2 + 10;
				return (
					<g
						key={n.id}
						transform={`translate(${layout.x.get(n.id) ?? 0}, ${layout.y.get(n.id) ?? 0})`}
						data-testid={`plan-node-${n.id}`}
						data-status={status}
					>
						{/* Rectangular — sin redondeo de esquinas (responsable). */}
						<rect
							width={w}
							height={h}
							className={monochrome ? MONO_BOX : BOX[status]}
							strokeWidth={STROKE_W}
						/>
						{glow && (
							// El resaltado del nodo actual: amarillo leve, difuminado para que
							// se derrame sobre los bordes — estático, sin pulso (responsable, ronda 6).
							// Se pinta ENCIMA del relleno de la caja (responsable, ronda 10): el relleno
							// de fondo de la ronda 9 ya no atenúa el brillo dentro de la caja,
							// mientras que las aristas detrás de la caja siguen atenuadas bajo ese relleno.
							<rect
								x={-GLOW_MARGIN}
								y={-GLOW_MARGIN}
								width={w + 2 * GLOW_MARGIN}
								height={h + 2 * GLOW_MARGIN}
								className="fill-yellow-400/25"
								filter={`url(#${markerId}-glow)`}
							/>
						)}
						{lines.map((line, i) => (
							<text
								key={i}
								x={w / 2}
								y={y0 + i * LINE_H}
								textAnchor="middle"
								className={monochrome ? MONO_TEXT : TEXT[status]}
							>
								{line}
							</text>
						))}
					</g>
				);
			})}
		</svg>
	);
}

// ─── El bloque de la transcripción ────────────────────────────────────────────

/**
 * Una parte plan-block persistida, renderizada tal como llega (estados de la
 * instantánea, nunca vueltos a derivar): sin borde y llenando la columna,
 * abre la ventana emergente del plan en vivo. Solo completo por diseño desde
 * el giro del 2026-09-11 (los fragmentos de vecindario están retirados — la
 * posición se deriva en vivo en la ventana emergente y en la futura ventana
 * del DAG).
 */
export function PlanBlock({ data, onOpen }: { data: PlanBlockData; onOpen: () => void }) {
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const statusMap = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.status] as const)), [data]);
	const statusOf = (id: string): PlanNodeStatus => statusMap.get(id) ?? "upcoming";
	return (
		<Hint label="Open the full plan" side="bottom">
<button
			type="button"
			data-testid="plan-block-full"
			aria-label="Open the full plan"
			onClick={onOpen}
			className="block w-full text-left"
		>
			{/* el relleno mantiene los trazos centrados + el halo del brillo dentro del
		marco; el tope mantiene el texto de los nodos en el tamaño de la prosa del
		chat o por debajo, llenando aun así la columna cuando puede (responsable,
		ronda 1 de refinamiento del grafo del plan). */}
		<PlanDiagram
			nodes={data.nodes}
			edges={data.edges}
			statusOf={statusOf}
			markerId={markerId}
			pad={GRAPH_PAD}
			textCapScale={TEXT_CAP_SCALE}
			monochrome
		/>
		</button>
</Hint>
	);
}

// ─── La ventana emergente del plan en vivo ────────────────────────────────────

/** Corte estructural mínimo de un mensaje (el mismo truco que phases.ts). */
export interface PopupMessage {
	parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; output?: unknown }>;
}

/** El último árbol del plan en la transcripción (la última salida tool-plan_). */
export function latestTree(messages: readonly PopupMessage[]): PlanTree | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts;
		if (!parts) continue;
		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p]!;
			if (!part.type.startsWith("tool-plan_") || part.state !== "output-available") continue;
			const output = part.output as { tree?: PlanTree } | undefined;
			if (output?.tree && Array.isArray(output.tree.nodes)) return output.tree;
		}
	}
	return null;
}

/** La ventana emergente muestra el brillo, así que su marco se amplía en el
 *  alcance del brillo — el bloque del chat (monocromo, sin brillo) se queda
 *  ajustado a GRAPH_PAD. */
const POPUP_PAD = GLOW_REACH;

// La matemática de desplazamiento/zoom vive ahora en components/pan-zoom.ts
// (compartida con el overlay de foco de mermaid desde la oleada del overlay de
// sesión, 2026-09-19) — la misma semántica de suelo de ajuste: el zoom mínimo
// ES el ajuste, el desplazamiento se bloquea en el suelo, techo de zoom 4× para leer de cerca los títulos.

/**
 * El plan completo, en vivo: último árbol + estados derivados en el momento
 * del clic. Esc, un clic en el fondo o la X lo cierran; arrastrar desplaza,
 * la rueda hace zoom hacia el cursor, el suelo del zoom es el ajuste (el
 * desplazamiento se bloquea en él — no hay nada que mover).
 *
 * CON ÁMBITO DE SESIÓN desde la oleada de fundido del cromo (2026-09-19): se
 * monta en ABSOLUTO dentro del div del área de la sesión de la página del
 * chat (chat.tsx) — bajo la barra de arrastre de 60px, a la derecha de la
 * barra lateral — en lugar de como un overlay fijo inset-0. La barra superior
 * sigue nítida y arrastrable, y la X nunca puede caer en territorio de
 * arrastre. Superficie al 80% + difuminado (decisión del responsable): la
 * transcripción se transparenta mientras el foco ocupa el área de la sesión.
 */
export function PlanPopup({ messages, onClose }: { messages: readonly PopupMessage[]; onClose: () => void }) {
	const tree = useMemo(() => latestTree(messages), [messages]);
	const statuses = useMemo(
		() => (tree ? derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]) : null),
		[tree, messages],
	);
	const statusOf = (id: string): PlanNodeStatus => (statuses ? derivedNodeStatus(statuses, id) : "upcoming");

	const rootRef = useRef<HTMLDivElement>(null);
	const layer = useInteractionLayer({
		kind: "view", enabled: true, rootRef,
		onClose: () => { onClose(); return "closed"; },
	});

	// ── viewport de desplazamiento/zoom (semántica recogida: suelo de ajuste = el valor por defecto) ──
	const viewportRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const layout = useMemo(() => (tree ? blockLayout(tree.nodes, tree.edges) : null), [tree]);
	// La caja de ajuste es la caja de tinta AMPLIADA — el diagrama se renderiza con
	// POPUP_PAD (= el alcance del brillo) para que el brillo difuminado nunca se
	// recorte en el marco, y el ajuste debe tener en cuenta ese relleno.
	const box = useMemo(
		() => (layout ? { w: layout.width + 2 * POPUP_PAD, h: layout.height + 2 * POPUP_PAD } : { w: 0, h: 0 }),
		[layout],
	);
	const fitZoom = useMemo(() => fitZoomFor(box, size), [box, size]);

	const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
	const userAdjustedRef = useRef(false);
	const atFloor = view.zoom <= fitZoom + 1e-9;
	// La transición se mantiene desactivada hasta que se ha aplicado el PRIMER
	// ajuste — la ventana emergente se pinta directamente en el ajuste en vez de
	// entrar volando desde el estado inicial arriba a la izquierda con zoom:1 (responsable, ronda 4 del grafo del plan).
	const [settled, setSettled] = useState(false);

	useEffect(() => {
		if (atFloor) userAdjustedRef.current = false;
	}, [atFloor]);
	useEffect(() => {
		if (userAdjustedRef.current || !size.w || !size.h) return;
		setView(fitGraphView(box, size, fitZoom));
		// Activa la transición solo DESPUÉS de que se haya pintado el ajuste:
		// cambiar settled en el MISMO commit deja que el navegador anime desde
		// el estado inicial arriba a la izquierda con zoom:1 — la entrada volando
		// que el responsable seguía viendo (la barrera de la ronda 4 no bastó; arreglo de la ronda 7).
		const raf = requestAnimationFrame(() => setSettled(true));
		return () => cancelAnimationFrame(raf);
	}, [fitZoom, size, box]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			const factor = Math.exp(-dy * 0.0015);
			const rect = el.getBoundingClientRect();
			setView((v) =>
				zoomedGraphView(v, factor, fitZoom, { x: e.clientX - rect.left, y: e.clientY - rect.top }, box, size),
			);
			userAdjustedRef.current = true;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [fitZoom, box, size]);

	// Zoom suave: la transformación se suaviza entre estados (CSS recalcula el
	// destino desde el valor computado actual, así que los pasos encadenados de
	// la rueda siguen fluidos). El desplazamiento es por fotograma — la transición se desactiva al arrastrar o daría efecto goma.
	const [panning, setPanning] = useState(false);
	const dragRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
	const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest("button")) return;
		if (atFloor) return;
		dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
		setPanning(true);
		e.currentTarget.classList.add("cursor-grabbing");
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		d.moved = true;
		setView((v) =>
			v.zoom <= fitZoom + 1e-9 ? v : { ...v, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) },
		);
	};
	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (d) {
			dragRef.current = null;
			if (d.moved) userAdjustedRef.current = true;
		}
		setPanning(false);
		e.currentTarget.classList.remove("cursor-grabbing");
	};
	const stepZoom = (factor: number) => {
		userAdjustedRef.current = true;
		setView((v) => zoomedGraphView(v, factor, fitZoom, { x: size.w / 2, y: size.h / 2 }, box, size));
	};
	const fitView = () => {
		userAdjustedRef.current = false;
		if (!size.w || !size.h) return;
		setView(fitGraphView(box, size, fitZoom));
	};

	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");

	return (
		<InteractionLayerOwner.Provider value={layer.id}>
		<div
			ref={rootRef}
			data-testid="plan-popup"
			// CON ÁMBITO DE SESIÓN (absoluto, no fijo): la página del chat monta esto
			// DENTRO del div del área de la sesión — bajo la barra de arrastre, a la
			// derecha de la barra lateral. 80% + difuminado: la transcripción se transparenta.
			className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-background/80 p-4 backdrop-blur-sm"
			// Ordenado dentro de la pila de vistas acotada de la sesión, por debajo de los modales de la app.
			style={{ zIndex: 100 + layer.order }}
			role="region"
			aria-label="The full plan"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="text-sm font-medium">The plan</span>
				<span className="text-xs text-muted-foreground">live — statuses derive from your check outcomes</span>
				<Hint label="Close" binding="escape" side="left">
<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					data-testid="plan-popup-close"
					className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
</Hint>
			</div>
			<div
				ref={viewportRef}
				className={cn(
					"relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl border select-none",
					atFloor ? "cursor-default" : "cursor-grab",
				)}
				onPointerDown={startDrag}
				onPointerMove={moveDrag}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				{tree ? (
					<>
						<div
							className="absolute top-0 left-0 origin-top-left"
							style={{
								transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
								// Oculto hasta que se ha APLICADO el primer ajuste — el ajuste corre en un
								// efecto (tras el pintado), así que un diagrama con opacidad condicionada
								// nunca puede parpadear en el estado inicial arriba a la izquierda con zoom:1
								// (el mismo arreglo que el overlay de mermaid; condicionar solo la transición
								// no ocultaba la entrada volando que el responsable seguía viendo en las rondas 4–7).
								opacity: settled ? 1 : 0,
								transition:
									panning || !settled
										? "none"
										: "transform 180ms ease-out, opacity 160ms ease-out",
							}}
						>
							<PlanDiagram
								nodes={tree.nodes}
								edges={tree.edges}
								statusOf={statusOf}
								glowId={statuses?.current ?? null}
								markerId={markerId}
								pad={POPUP_PAD}
								naturalSize
							/>
						</div>
						<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
							<span className="text-xs text-muted-foreground/60">Drag to pan · scroll to zoom</span>
							<div className="flex gap-1">
								<Hint label="Zoom out" side="bottom">
<button
									type="button"
									aria-label="Zoom out"
									onClick={() => stepZoom(1 / 1.25)}
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<MinusIcon className="size-3.5" />
								</button>
</Hint>
								<Hint label="Fit plan to screen" side="bottom">
<button
									type="button"
									aria-label="Fit plan to screen"
									onClick={fitView}
									data-testid="plan-popup-fit"
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<MaximizeIcon className="size-3.5" />
								</button>
</Hint>
								<Hint label="Zoom in" side="bottom">
<button
									type="button"
									aria-label="Zoom in"
									onClick={() => stepZoom(1.25)}
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<PlusIcon className="size-3.5" />
								</button>
</Hint>
							</div>
						</div>
					</>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						No plan in this session yet.
					</div>
				)}
			</div>
		</div>
		</InteractionLayerOwner.Provider>
	);
}