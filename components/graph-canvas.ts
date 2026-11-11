"use client";

/**
 * El renderizador de grafos hecho a mano sobre un único canvas (decidido el
 * 2026-09-13 tras la pasada de investigación — docs/research/graph-rendering.md,
 * opción B).
 *
 * Sustituye a sigma.js. Por qué: sigma nos daba el renderizado WebGL de nodos y
 * aristas, la selección y una cámara, pero nuestras regiones de clústeres tenían
 * que vivir en canvas ajenos inyectados junto a su pila privada del DOM, dibujados
 * desde un bucle de eventos aparte — así que las envolventes iban por detrás de
 * los nodos al desplazar, competían con el dimensionado del canvas de sigma al
 * reconstruir el renderizador, y cada evento de cámara volvía a rasterizar el
 * canvas entero de envolventes (picos de GPU + pitido audible de las bobinas). A
 * nuestra escala (de 338 a unos pocos miles de nodos), un único Canvas 2D está
 * holgadamente dentro de los 60 fps, y un único bucle hace estructuralmente
 * imposible la clase de fallos por desincronización.
 *
 * Arquitectura (el patrón canónico — browser.engineering, «Optimizing canvas»
 * de MDN, rendimiento de canvas en web.dev):
 *   - El renderizador es una FUNCIÓN DE DIBUJO TONTA sobre datos planos: nodos
 *     con posiciones en el espacio del mundo, aristas, clústeres, colores,
 *     ajustes. El layout (forceAtlas2) y el filtrado ocurren FUERA, en el
 *     componente de React; este módulo nunca calcula una posición.
 *   - UN canvas, UN bucle de requestAnimationFrame con un indicador de sucio. La
 *     entrada y los eventos del DOM solo cambian el estado y marcan sucio; el
 *     bucle dibuja como mucho una vez por fotograma, con todas las capas bajo la
 *     misma cámara — rellenos de envolventes → trazos de envolventes → aristas →
 *     nodos → etiquetas de región → etiquetas de nodo → hover. Nada puede ir
 *     nunca por detrás de nada.
 *   - Cámara: d3-zoom aporta las matemáticas verificadas de desplazamiento /
 *     zoom hacia el cursor / pellizco (pantalla = mundo·k + [x,y]). La cámara vive
 *     en la instancia del renderizador, así que las relecturas de datos y los
 *     cambios de ajustes nunca la mueven.
 *   - Selección: comprobación de la distancia al nodo más cercano (µs a nuestra
 *     escala), con un PICKING_PAD para que todo el halo del hover se pueda probar.
 *
 * Etiquetas sujetas al zoom (la sensación del fundido del texto de Obsidian): se
 * conserva la convención de "ratio" de cámara de sigma por la semántica
 * persistida de los ajustes — ratio 1 = zoom de encaje, MENOR = más zoom (ratio =
 * kFit / k). Las etiquetas de nodo son totalmente visibles con ratio ≤ labelZoom
 * y se desvanecen a lo largo de un tramo de ratio proporcional a la barrera
 * (LABELS_FADE_RATIO); las etiquetas de clúster aparecen a lo largo exactamente
 * del mismo tramo (suman 1), así que las dos nunca coexisten. Todas las etiquetas
 * pasan la barrera juntas — nada de aparecer nodo a nodo.
 *
 * El brillo del hover no cambia de aspecto: un halo suave del propio color del
 * nodo con un radio constante, con la opacidad en fundido cruzado durante
 * ~180 ms y el nombre aclarándose con el MISMO factor. Solo se anima la opacidad;
 * el único trabajo por fotograma en reposo es comprobar el indicador de sucio
 * (no se programa ningún rAF hasta que algo cambia).
 *
 * Las pruebas unitarias cubren los auxiliares puros (tests/graph-canvas.test.ts);
 * la clase en sí depende del DOM y se ejercita en vivo. El ámbito del módulo se
 * mantiene libre de DOM para que el fichero se importe sin problemas en Node.
 */

import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { Simulation, SimulationLinkDatum } from "d3-force";
import { clusterHue, type Pt } from "./cluster-geometry.ts";
import type { RenderedMode } from "@/src/core";
import {
	CHARGE_STRENGTH,
	CLUSTER_PULL_STRENGTH,
	createGraphSimulation,
	DEFAULT_PHYSICS_TUNING,
	DEFAULT_REGION_TUNING,
	sanitizePhysicsTuning,
	sanitizeRegionTuning,
	type PhysicsTuning,
	type RegionTuning,
	INCREMENTAL_GRAVITY,
	LINK_DISTANCE,
	type DepthAnchorMode,
	type GraphRenderSettings,
	type LayoutNode,
	type Position,
} from "@/src/core";

export type { GraphRenderSettings };

// ─── Contrato público de datos ─────────────────────────────────────────────

/** Un nodo que dibujar: posición en el espacio del mundo + la etiqueta corta que se lee de un vistazo. */
export interface CanvasNode {
	id: string;
	x: number;
	y: number;
	label: string;
}

/** Una arista dirigida de la vista DERIVADA (primero las cadenas, 2026-09-30):
 *  premisa → nodo de implicación → conclusión, SIN TIPO, todas flechas
 *  SENCILLAS de un solo trazo — no hay glifo de doble trazo en ningún sitio
 *  (la decisión del 2026-09-14 murió con las aristas con tipo). Un argumento se
 *  renderiza como su geometría: las líneas de las premisas conjuntas convergen
 *  SIN PUNTA en el punto de implicación y sale de él una línea con flecha; un
 *  argumento de una sola premisa es una flecha normal (ver deriveView). */
export interface CanvasEdge {
	from: string;
	to: string;
}

/** Ids de los nodos de implicación (la ley de emisión: newGraphChainId en
 *  core/graph.ts). En el lienzo, un nodo imp es GEOMETRÍA PURA (responsable, arco
 *  de renderizado 2026-09-30): invisible — sin disco ni etiqueta — y NO
 *  SELECCIONABLE, excluido de todas las rutas de prueba de impacto. Exportado para
 *  la fijación de la prueba. */
export const isImpNodeId = (id: string): boolean => id.startsWith("arg_");

/** Una región de clúster: ids de los nodos miembros + la etiqueta acuñada por el LLM (o null). */
export interface CanvasCluster {
	id: string;
	label: string | null;
	members: string[];
}

/** Luminosidad de la región del clúster + de la etiqueta (HSL %), por modo
 *  renderizado — los tonos vienen de clusterHue; solo la luminosidad sigue a la página. */
export interface ClusterLightness {
	ring: number;
	label: number;
}

/** El oscuro conserva el 60 % original en las regiones / 78 % en las etiquetas; el
 *  claro oscurece ambos para que las regiones pastel y sus etiquetas se lean sobre el fondo de papel. */
export const CLUSTER_LIGHTNESS: Record<RenderedMode, ClusterLightness> = {
	dark: { ring: 60, label: 78 },
	light: { ring: 42, label: 30 },
};

/** Colores del tema, resueltos a #rrggbb por quien llama (el canvas quiere
 *  hexadecimal, y el renderizador no debe leer el CSS por sí mismo). */
export interface CanvasColors {
	node: string;
	edge: string;
	label: string;
	hoverText: string;
	clusterLightness: ClusterLightness;
}

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	/** Las flechas LÓGICAS (proposición→conclusión, imp contraído) que consume la
	 *  fuerza de profundidad — si faltan, la simulación deriva la profundidad de las
	 *  aristas dibujadas (comportamiento antiguo). Opcional para que quienes llaman al
	 *  renderizador sin ser el grafo sigan siendo sencillos. */
	logicalEdges?: CanvasEdge[];
	/** El enlace de las cadenas imp — la pasada de profundidad ancla cada unión en
	 *  el punto medio entre las premisas y la conclusión (responsable, 2026-09-30). */
	impLinks?: ReadonlyArray<{ id: string; premises: ReadonlyArray<string>; conclusion: string }>;
	clusters: CanvasCluster[];
	colors: CanvasColors;
	/** Familia tipográfica del cuerpo (las etiquetas deben coincidir con la tipografía de la app). */
	fontFamily: string;
}

export interface RendererCallbacks {
	/** Se hizo clic en un nodo (incluye la posición en pantalla para anclar la tarjeta). */
	onSelect: (nodeId: string, screenPos: Pt) => void;
	/** Clic derecho: el nodo seleccionado (posición en pantalla relativa al canvas)
	 *  o null cuando el puntero dio en el escenario vacío — quien llama abre/cierra
	 *  su menú contextual en consecuencia. (interludio de nodos, oleada 7) */
	onContext: (nodeId: string | null, screenPos: Pt) => void;
	/** Se hizo clic en el escenario vacío. */
	onStageClick: () => void;
	/** Cualquier movimiento de cámara (desplazar/zoom) — quien llama descarta la
	 *  interfaz anclada y persiste la cámara (estado de la vista). */
	onCameraMove: (transform: { k: number; x: number; y: number }) => void;
	/** La simulación viva se asentó tras un arrastre: confirma el nuevo estado de
	 *  reposo (quien llama lo envía con PUT al registro de posiciones). */
	onCommit: (positions: Record<string, Position>) => void;
}

// ─── Constantes (traídas tal cual de la vista de sigma) ─────────────────────

const LABEL_SIZE = 12; // el tamaño de etiqueta de referencia respecto al que se toma la proporción del ancho de ajuste
const LABEL_WEIGHT = "500";

/** Etiquetas de región (clúster) — los nombres de sesión de la oleada 7 hicieron
 *  LARGAS las etiquetas: rutas de ficheros importados y títulos de chat
 *  renombrados. Se ajustan a un ancho fijo en pantalla (las etiquetas son
 *  relativas al observador — este valor en px es exacto en pantalla con
 *  cualquier zoom), con un tope de líneas y puntos suspensivos en la última
 *  (responsable, 2026-09-23: ajustar, tope de 2–3 líneas, elipsis — una huella
 *  acotada que deja visible la mayor parte de la ruta). */
const REGION_LABEL_MAX_WIDTH = 220; // px de pantalla
const REGION_LABEL_MAX_LINES = 3;
const REGION_LABEL_LINE_HEIGHT = 1.3;

/** Ajusta una etiqueta de región: primero por palabras (nombres de sesión),
 *  luego por caracteres para las palabras que por sí solas superan el máximo
 *  (rutas de fichero largas — la disciplina de las etiquetas de nodo), con un
 *  tope de maxLines. Lo que sobra se pliega en la última línea, con elipsis para
 *  que quepa. measure es el measureText del canvas (o uno falso en las pruebas)
 *  — en lo demás es pura. */
export function wrapRegionLabel(
	text: string,
	maxWidth: number,
	maxLines: number,
	measure: (s: string) => number,
): string[] {
	if (maxLines < 1) return [text];
	if (measure(text) <= maxWidth) return [text];
	const lines: string[] = [];
	const pending: string[] = text.split(/\s+/).filter(Boolean);
	// Llena hasta maxLines-1 líneas; el resto pasa a ser la última línea.
	while (pending.length > 0 && lines.length < maxLines - 1) {
		let line = "";
		while (pending.length > 0) {
			let word = pending[0]!;
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= maxWidth) {
				line = candidate;
				pending.shift();
				continue;
			}
			if (!line) {
				// La palabra por sí sola se desborda: pártela por caracteres; el resto queda
				// pendiente para la línea siguiente (las rutas no tienen espacios que ayuden).
				let chunk = "";
				while (word.length > 0 && measure(chunk + word[0]) <= maxWidth) {
					chunk += word[0];
					word = word.slice(1);
				}
				if (chunk) {
					lines.push(chunk);
					pending[0] = word;
				} else {
					// Caso degenerado: un solo carácter supera el ancho — se deja entero para
					// que la etiqueta nunca pueda desaparecer del todo.
					lines.push(word);
					pending.shift();
				}
				line = "";
			}
			break;
		}
		if (line) lines.push(line);
		if (!line && lines.length > 0 && pending.length > 0) continue;
		if (!line && lines.length === 0) break;
	}
	// El resto va como última línea: tal cual si cabe, recortado con elipsis
	// hasta el ancho si no.
	let rest = pending.join(" ");
	if (!rest) return lines;
	if (measure(rest) <= maxWidth) {
		lines.push(rest);
		return lines;
	}
	let tail = rest;
	while (tail.length > 1 && measure(`${tail}…`) > maxWidth) tail = tail.slice(0, -1);
	lines.push(`${tail}…`);
	return lines;
}

/** Parche de clústeres solo de etiquetas (arreglo de la mezcla al renombrar,
 *  2026-09-23): aplica un conjunto de actualizaciones vivas de etiquetas a los
 *  registros de clúster del lado de los datos Y a los metadatos de región
 *  construidos (volviendo a ajustar las entradas cambiadas con el measure dado —
 *  el mismo ajuste que produciría una construcción de la geometría). La guarda
 *  del silencio de las envolventes viaja aquí: un clúster cuya etiqueta ACTUAL es
 *  null es un registro desaparecido — ningún renombrado puede alcanzarlo. Pura,
 *  modifica en su sitio los arrays dados; devuelve si algo cambió (quien llama
 *  solo vuelve a dibujar si así fue). Exportada para las pruebas. */
export function applyClusterLabels(
	clusters: { id: string; label: string | null }[],
	regionMeta: { id: string; label: string | null; lines: string[] | null }[],
	labels: ReadonlyMap<string, string | null>,
	maxWidth: number,
	maxLines: number,
	measure: (s: string) => number,
): boolean {
	let changed = false;
	for (const cluster of clusters) {
		if (!labels.has(cluster.id)) continue;
		if (cluster.label == null) continue; // silencio de las envolventes: los registros desaparecidos siguen en silencio
		const label = labels.get(cluster.id) ?? null;
		if (label === cluster.label) continue;
		cluster.label = label;
		changed = true;
	}
	if (!changed) return false;
	for (const rm of regionMeta) {
		if (!labels.has(rm.id)) continue;
		if (rm.label == null) continue;
		const label = labels.get(rm.id) ?? null;
		rm.label = label;
		rm.lines = label
			? wrapRegionLabel(label, maxWidth, maxLines, measure)
			: null;
	}
	return true;
}
const LABEL_MAX_WIDTH = 170; // ancho de ajuste con el tamaño de etiqueta de referencia, en unidades del mundo
const LABEL_GAP = 2.9; // unidades del mundo entre el borde del nodo y la primera línea de la etiqueta (los 2px de referencia con encaje ÷ 0,69)
const LABEL_LINE_HEIGHT = 1.3;
/** El fundido cruzado de etiqueta de nodo→clúster abarca barrera × esto
 *  (unidades de ratio de cámara) — PROPORCIONAL desde el 2026-09-17. El antiguo
 *  tramo absoluto (ratio 0,5) se percibía como un cambio relativo del 100 % con
 *  la antigua barrera de 0,5, pero como una mísera franja del 12 % con la barrera
 *  ajustada de 8x (ratio 4): «los niveles de zoom más bajos producen de forma
 *  natural un periodo de transición más largo, mientras que los más altos son
 *  más bruscos» — la observación exacta del usuario. Lo proporcional mantiene UNA
 *  sola sensación de transición con cualquier barrera; con el 8x por defecto, el
 *  relevo se funde a lo largo de un paso completo (de 8x a 12x). */
export const LABELS_FADE_RATIO = 0.5;

const GLOW_SCALE = 1.7; // radio exterior del halo = radio del nodo x esto (proporcional, como desenfocar una copia del disco)
const GLOW_ALPHA = 0.3; // opacidad del halo en el borde del disco, desvaneciéndose hacia fuera
const HOVER_FADE_MS = 180; // duración del fundido de la opacidad del halo del hover
const ZOOM_EASE_MS = 45; // deslizamiento del zoom con la rueda: constante de tiempo de la suavización exponencial (~250 ms por muesca)

/** Radio seleccionable extra (px) más allá del disco — todo el halo se puede
 *  probar (el antiguo arreglo del parpadeo, menos el shader de selección). */
const PICKING_PAD = 10;

/** Umbral entre clic y arrastre: un recorrido del puntero por debajo de estos px es un clic. */
const CLICK_SLOP = 4;
/** Ajuste de la simulación viva — ver el comentario de documentación de la clase. */
const LIVE_ALPHA_DECAY = 0.05; // recocido más ágil que el 0,0228 del asentamiento
const DRAG_ALPHA_TARGET = 0.3; // la propia constante de recalentamiento de d3-drag
const SIM_SETTLE_ALPHA = 0.005; // por debajo de esto, la simulación se considera asentada
const COMMIT_DEBOUNCE_MS = 250; // retardo entre asentamiento → PUT al registro (los arrastres nuevos lo cancelan)

/** Estilo de las regiones de clúster — un mapa de bits SALPICADO de baja
 *  resolución en el espacio del mundo (la técnica del campo de densidad, edición
 *  Canvas 2D): cada nodo miembro pinta un disco suave con degradado radial y cada
 *  arista interna del clúster un trazo de extremos redondeados; escalar el mapa
 *  de bits con suavizado bilineal ES el desenfoque. Sustituye a los rellenos +
 *  bordes de envolventes convexas: por fin las formas cóncavas de los clústeres
 *  son correctas (la envolvente tapaba cada hueco con líneas rectas — el aspecto
 *  dentado de cerca), no hay borde que vaya por detrás, y un fotograma con física
 *  viva paga un único volcado diminuto en vez de 32 clústeres × 4 polígonos
 *  desplazados rasterizados de nuevo con DPR 2 (el antiguo pitido de bobinas de la GPU). */
const REGION_EVERY = 3; // fotogramas de simulación viva: reconstruye cada N-ésimo y vuelca los demás



/** Una ronda de desenfoque de caja horizontal+vertical sobre RGBA
 *  PREMULTIPLICADO (Float32, paso 4, longitud w*h*4). Premultiplicar primero es
 *  lo que evita los halos del desenfoque: desenfocar RGB sin premultiplicar sobre
 *  un alfa variable derrama color sólido en el espacio transparente. Pura: sin
 *  DOM, probada. */
export function boxBlurRound(
	src: Float32Array,
	tmp: Float32Array,
	dst: Float32Array,
	w: number,
	h: number,
	radius: number,
): void {
	if (radius <= 0) {
		dst.set(src);
		return;
	}
	const div = radius * 2 + 1;
	// Horizontal: src → tmp (ventana acotada, suma acumulada).
	for (let y = 0; y < h; y++) {
		const row = y * w * 4;
		let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
		for (let x = -radius; x <= radius; x++) {
			const i = row + Math.min(Math.max(x, 0), w - 1) * 4;
			sum0 += src[i]!;
			sum1 += src[i + 1]!;
			sum2 += src[i + 2]!;
			sum3 += src[i + 3]!;
		}
		for (let x = 0; x < w; x++) {
			const o = row + x * 4;
			tmp[o] = sum0 / div;
			tmp[o + 1] = sum1 / div;
			tmp[o + 2] = sum2 / div;
			tmp[o + 3] = sum3 / div;
			const addI = row + Math.min(x + radius + 1, w - 1) * 4;
			const subI = row + Math.max(x - radius, 0) * 4;
			sum0 += src[addI]! - src[subI]!;
			sum1 += src[addI + 1]! - src[subI + 1]!;
			sum2 += src[addI + 2]! - src[subI + 2]!;
			sum3 += src[addI + 3]! - src[subI + 3]!;
		}
	}
	// Vertical: tmp → dst.
	for (let x = 0; x < w; x++) {
		const col = x * 4;
		let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
		for (let y = -radius; y <= radius; y++) {
			const i = col + Math.min(Math.max(y, 0), h - 1) * w * 4;
			sum0 += tmp[i]!;
			sum1 += tmp[i + 1]!;
			sum2 += tmp[i + 2]!;
			sum3 += tmp[i + 3]!;
		}
		for (let y = 0; y < h; y++) {
			const o = col + y * w * 4;
			dst[o] = sum0 / div;
			dst[o + 1] = sum1 / div;
			dst[o + 2] = sum2 / div;
			dst[o + 3] = sum3 / div;
			const addI = col + Math.min(y + radius + 1, h - 1) * w * 4;
			const subI = col + Math.max(y - radius, 0) * w * 4;
			sum0 += tmp[addI]! - tmp[subI]!;
			sum1 += tmp[addI + 1]! - tmp[subI + 1]!;
			sum2 += tmp[addI + 2]! - tmp[subI + 2]!;
			sum3 += tmp[addI + 3]! - tmp[subI + 3]!;
		}
	}
}

/** Las constantes de geometría son UNIDADES DEL MUNDO (el giro del
 *  2026-09-15): los tamaños de nodo/etiqueta/punta de flecha salen directamente
 *  de los ajustes — la misma ley que linkDistance —, así que la escala del mundo
 *  es canónica y nunca depende de la extensión del grafo ni del viewport. El zoom
 *  de la cámara los escala con el grafo (al estilo de Obsidian); los grosores de
 *  arista y los bordes de envolvente siguen siendo líneas finas relativas al
 *  observador (÷ k); las etiquetas de clúster siguen fijas en pantalla (px con
 *  cualquier zoom). kFit sobrevive SOLO como la referencia «1×» de la barrera de
 *  etiquetas (zoomRatioOf) — un umbral de nivel de detalle puro, ninguna geometría lo lee. */

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

// ─── Auxiliares puros (con pruebas unitarias) ──────────────────────────────

/**
 * El "ratio de cámara" compatible con sigma: 1 con el zoom de encaje, MENOR al
 * acercar (ratio = kFit / k). El ajuste persistido labelZoom se expresa en estas
 * unidades, así que la semántica de la barrera sobrevive sin cambios al cambio de
 * renderizador.
 */
export function zoomRatioOf(kFit: number, k: number): number {
	return kFit / k;
}

/**
 * Opacidad de las etiquetas de nodo con un ratio de cámara dado: 1 en el umbral
 * labelZoom o por debajo, desvaneciéndose hasta 0 a lo largo de un tramo de
 * labelZoom x LABELS_FADE_RATIO (ver allí). Las etiquetas de clúster usan
 * `1 - esto` a lo largo del mismo tramo — las dos hacen un fundido cruzado y
 * nunca coexisten con opacidad completa.
 */
export function labelAlpha(
	ratio: number,
	labelZoom: number,
	span = labelZoom * LABELS_FADE_RATIO,
): number {
	return clamp01(1 - (ratio - labelZoom) / span);
}

/** La transformación de cámara que encuadra `bbox` en un viewport de w×h con relleno. */
export function fitTransform(
	bbox: { minX: number; maxX: number; minY: number; maxY: number },
	w: number,
	h: number,
	padding: number,
): { x: number; y: number; k: number } {
	const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
	const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
	const k = Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh);
	const cx = (bbox.minX + bbox.maxX) / 2;
	const cy = (bbox.minY + bbox.maxY) / 2;
	return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
}

/** La geometría de la punta de flecha de una arista dirigida a→b: extremos del
 *  trazo (fuera de los dos discos de nodo) y el triángulo de la punta (vértice en
 *  el borde del disco destino, anchura = 0,8 × longitud de la punta — la forma de
 *  flecha de sigma). */
/** Un glifo de flecha completo: trazo + triángulo de la punta. */
export interface ArrowGeom {
	shaftFrom: Pt;
	shaftTo: Pt;
	tip: Pt;
	left: Pt;
	right: Pt;
}

export function arrowGeometry(
	a: Pt,
	b: Pt,
	fromRadius: number,
	toRadius: number,
	headLength: number,
): ArrowGeom | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return null; // caso degenerado (coincidentes) — se omite
	const ux = dx / len;
	const uy = dy / len;
	const tip = { x: b.x - ux * toRadius, y: b.y - uy * toRadius };
	const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
	const halfW = 0.4 * headLength;
	return {
		shaftFrom: { x: a.x + ux * fromRadius, y: a.y + uy * fromRadius },
		shaftTo: base,
		tip,
		left: { x: base.x - uy * halfW, y: base.y + ux * halfW },
		right: { x: base.x + uy * halfW, y: base.y - ux * halfW },
	};
}


/** El nodo más cercano a un punto de la pantalla dentro de maxDist (recorrido
 *  lineal — µs a nuestra escala; una rejilla espacial solo compensa a partir de ~10k nodos). */
export function pickNearest<T extends { id: string; x: number; y: number }>(
	nodes: T[],
	px: number,
	py: number,
	maxDist: number,
): T | null {
	let best: T | null = null;
	let bestD = maxDist * maxDist; // compara distancias al cuadrado
	for (const n of nodes) {
		const d = (n.x - px) ** 2 + (n.y - py) ** 2;
		if (d < bestD) {
			bestD = d;
			best = n;
		}
	}
	return best;
}

// ─── Auxiliares de texto del canvas (traídos tal cual) ─────────────────────

/** "#rrggbb" + alfa → "rgba(...)". */
function rgbaFromHex(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Ajuste de líneas por palabras para el texto del canvas. Nunca trunca: las
 *  palabras sueltas demasiado largas se parten por caracteres, así que ninguna
 *  línea supera nunca maxWidth. */
function wrapLabel(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.length > 0 ? lines[lines.length - 1]! : null;
		if (last !== null) {
			const joined = `${last} ${word}`;
			if (context.measureText(joined).width <= maxWidth) {
				lines[lines.length - 1] = joined;
				continue;
			}
		}
		let chunk = "";
		for (const char of word) {
			if (chunk && context.measureText(`${chunk}${char}`).width > maxWidth) {
				lines.push(chunk);
				chunk = char;
			} else {
				chunk += char;
			}
		}
		if (chunk) lines.push(chunk);
	}
	return lines;
}

/** Tamaños en unidades del mundo para la pasada de etiquetas, derivados una vez por construcción de la geometría. */
interface WorldSizes {
	nodeR: number; // radio del disco del nodo, unidades del mundo
	glowOuter: number; // radio exterior del halo del hover, unidades del mundo
	labelSize: number; // fuente de la etiqueta del nodo, unidades del mundo
	labelGap: number; // borde del nodo → primera línea de la etiqueta, unidades del mundo
}

/** El nombre del nodo ya ajustado, centrado bajo el nodo en unidades del MUNDO —
 *  geometría idéntica en reposo y con hover, así que el hover solo cambia el
 *  color y nada salta. Las líneas se ajustan una vez por construcción de la
 *  geometría, nunca por fotograma. */
function drawNameLines(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	lines: string[],
	world: WorldSizes,
	color: string,
): void {
	context.fillStyle = color;
	context.textAlign = "center";
	context.textBaseline = "top";
	const firstTop = y + world.nodeR + world.labelGap;
	for (let i = 0; i < lines.length; i++) {
		context.fillText(lines[i]!, x, firstTop + i * world.labelSize * LABEL_LINE_HEIGHT);
	}
}

// ─── El renderizador ───────────────────────────────────────────────────────

export class GraphCanvasRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private callbacks: RendererCallbacks;
	private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
	private transform: ZoomTransform = zoomIdentity;
	/** Se fija tras el primer encaje; a partir de ahí la cámara sobrevive a setData. */
	private hasFit = false;
	/** Último tamaño CSS sincronizado — el ancla del redimensionado calcula con esto
	 *  el punto del mundo bajo el centro del viewport ANTERIOR al redimensionado (los
	 *  callbacks de ResizeObserver ya ven el tamaño NUEVO en clientWidth/Height). */
	private viewW = 0;
	private viewH = 0;
	/** La k que encuadra todo el grafo — el «1×» de la barrera de etiquetas. */
	private kFit = 1;
	/** Límites en el espacio del mundo de los nodos actuales — los comparten fit() y
	 *  el refresco de kFit al redimensionar (se calculan una vez por setData, no por redimensionado). */
	private worldBBox: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

	private data: CanvasData | null = null;
	/** id -> nodo para los datos actuales (evita recorridos O(n^2)). */
	private nodeById = new Map<string, CanvasNode>();
	private settings: GraphRenderSettings | null = null;
	private visible: ReadonlySet<string> | null = null;

	// ── Física viva ──
	// Una simulación de d3-force compartida con el asentamiento del servidor (createGraphSimulation
	// en @/src/core): arrastrar fija fx/fy y recalienta (alphaTarget), soltar
	// libera y la simulación se recuece; en cuanto alpha baja de SIM_SETTLE_ALPHA,
	// el nuevo estado de reposo se confirma con debounce mediante onCommit. La simulación modifica
	// data.nodes EN SU SITIO (SON los nodos de la simulación — cero copias), así que cada
	// tick solo incrementa geoVersion y el bucle de dibujo reconstruye la geometría.
	private sim: Simulation<LayoutNode, SimulationLinkDatum<LayoutNode>> | null = null;
	private simById = new Map<string, LayoutNode>();
	private simActive = false;
	private dragId: string | null = null;
	private dragOrigin: Pt | null = null;
	private simMoved = false; // cualquier movimiento real desde la última confirmación
	private commitTimer: ReturnType<typeof setTimeout> | null = null;

	private frameId: number | null = null;
	private dirty = true;
	/** True mientras se ejecuta tick(): markDirty dentro del bucle (el evento de zoom
	 *  de d3 se dispara desde advanceZoom) NO debe programar — el bucle se programa a
	 *  sí mismo más abajo. Sin esta guarda, cada fotograma del deslizamiento dejaba
	 *  escapar un tick extra en cola y los dibujos se multiplicaban por fotograma
	 *  mostrado (el fallo del zoom a 20 fps). */
	private inTick = false;

	// Transición del hover: fundido 0 = en reposo, 1 = hover completo; el indicador de
	// animación mantiene programado el bucle hasta que el fundido se asienta (luego el rAF para).
	private hoverId: string | null = null;
	/** El nodo sobre el que se dibuja el brillo. SOBREVIVE a hoverId al salir del
	 *  hover para que el fundido tenga algo que dibujar (hoverId pasa a null al
	 *  instante; sin esto, el brillo desaparecía en un fotograma en vez de
	 *  desvanecerse). Se limpia cuando termina el fundido de salida. */
	private hoverNode: CanvasNode | null = null;
	private hoverFade = 0;
	private hoverFrom = 0;
	private hoverTarget = 0;
	private hoverStart = 0;
	// Zoom suave con la rueda: los eventos de rueda acumulan una escala objetivo (anclada al
	// cursor); cada tick acerca la cámara a ella con suavidad en vez de saltar.
	private zoomTarget: { k: number; x: number; y: number } | null = null;
	/** Reloj para una suavización independiente de la tasa de fotogramas (se actualiza en cada tick). */
	private lastTickAt = 0;
	private animating = false;

	private resizeObserver: ResizeObserver;
	private downPos: Pt | null = null;

	// ── Geometría del mundo en caché ───────────────────────────────────────
	// Todo lo de arriba se dibuja en cada fotograma; todo lo de abajo se deriva de
	// datos+visibilidad+ajustes+kFit y se reconstruye SOLO cuando cambia alguno de
	// ellos (geoVersion). Los movimientos de cámara solo vuelven a rasterizar los mismos trazados.
	private geoVersion = 0; // incremento = cambiaron las entradas de la geometría
	private builtVersion = -1; // versión con la que se construyó la caché
	private nodesPath: Path2D | null = null;
	private shaftsPath: Path2D = new Path2D();
	private headsPath: Path2D = new Path2D();
	private regionCanvas: HTMLCanvasElement | null = null;
	/** Rectángulo del mundo que cubre el mapa de bits (coordenadas de destino de drawImage). */
	private regionRect: { minX: number; minY: number; w: number; h: number } | null = null;
	/** Etiquetas de región: centroide + tono del clúster, calculados al construir el salpicado. */
	private regionMeta: { id: string; label: string | null; lines: string[] | null; cx: number; cy: number; hue: number }[] = [];
	private regionTuning: RegionTuning = DEFAULT_REGION_TUNING;
	private physicsTuning: PhysicsTuning = DEFAULT_PHYSICS_TUNING;
	/** Centro de gravedad para la simulación viva (centroide de la caja del grafo en setData). */
	private simCenter: Pt = { x: 0, y: 0 };
	private regionBuiltVersion = -1;
	private frameCount = 0; // contador de dibujos para limitar el salpicado durante la simulación viva
	private labelLines = new Map<string, string[]>();
	private worldLabelFont = "";
	private world: WorldSizes = { nodeR: 0, glowOuter: 0, labelSize: 0, labelGap: 0 };

	constructor(
		canvas: HTMLCanvasElement,
		callbacks: RendererCallbacks,
		/** La cámara persistida de quien llama (estado de la vista — localStorage):
		 *  cuando está presente SUSTITUYE al encaje de la primera apertura; el grafo se
		 *  abre exactamente donde lo dejó el usuario (2026-09-15: un zoom por defecto
		 *  solo existe en la primera apertura, de todas las que haya). Las formas no
		 *  válidas recurren al encaje. */
		initialCamera?: { k: number; x: number; y: number } | null,
	) {
		this.canvas = canvas;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2d context unavailable");
		this.ctx = ctx;
		this.callbacks = callbacks;

		// d3-zoom se ocupa del desplazamiento / zoom con rueda hacia el cursor / pellizco táctil; cada
		// cambio de transformación solo marca sucio (los dibujos ocurren en NUESTRO bucle).
		this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([0.02, 40])
			.on("zoom", ({ transform }) => {
				this.transform = transform;
				this.markDirty();
				// La transformación sirve también como carga de persistencia (estado de la vista).
				this.callbacks.onCameraMove(transform);
			});
		select(canvas)
			.call(this.zoomBehavior)
			// Nada de zoom inesperado con doble clic (sigma no lo tenía).
			.on("dblclick.zoom", null)
			// Ahora la rueda es NUESTRA: el salto instantáneo por muesca de d3 resultaba brusco; el
			// deslizamiento suavizado de más abajo lo sustituye (desplazar y pellizcar siguen siendo de d3).
			.on("wheel.zoom", null);

		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		canvas.addEventListener("pointermove", this.onPointerMove);
		canvas.addEventListener("pointerdown", this.onPointerDown);
		canvas.addEventListener("pointerup", this.onPointerUp);
		canvas.addEventListener("pointerleave", this.onPointerLeave);
		// Clic derecho → el menú contextual de quien llama (interludio de nodos). Siempre
		// preventDefault: el menú nativo sobre un canvas personalizado a sangre nunca
		// sirve; quien llama decide qué se abre (si se abre algo).
		canvas.addEventListener("contextmenu", this.onContextMenu);

		// La cámara persistida: sustituye la predeterminada por donde el usuario
		// dejó el grafo. Se aplica a través del comportamiento de zoom para que el estado
		// interno de d3 y el nuestro coincidan (la misma ruta que usa fit()); hasFit, para que ni
		// el ResizeObserver ni setData vuelvan a encajar por encima.
		if (
			initialCamera &&
			typeof initialCamera.k === "number" && Number.isFinite(initialCamera.k) && initialCamera.k > 0 &&
			typeof initialCamera.x === "number" && Number.isFinite(initialCamera.x) &&
			typeof initialCamera.y === "number" && Number.isFinite(initialCamera.y)
		) {
			this.hasFit = true;
			select(canvas).call(
				this.zoomBehavior.transform,
				zoomIdentity.translate(initialCamera.x, initialCamera.y).scale(initialCamera.k),
			);
		}

		this.resizeObserver = new ResizeObserver(() => {
			// El punto del mundo bajo el centro del viewport anterior al redimensionado — el
			// ancla visual que la nueva transformación debe conservar. Captúralo
			// ANTES de syncSize (que actualiza viewW/H al tamaño nuevo).
			const prevW = this.viewW;
			const prevH = this.viewH;
			const { x: tx, y: ty, k } = this.transform;
			const wx = (prevW / 2 - tx) / k;
			const wy = (prevH / 2 - ty) / k;
			this.syncSize();
			if (!this.hasFit) this.fit(); // primer tamaño real → encaja una vez
			else {
				this.refreshFitZoom(); // el «1×» de la barrera depende del viewport
				// Ancla en el centro (2026-09-17, responsable): el mismo punto del mundo bajo
				// el centro NUEVO. Se aplica a través del comportamiento de zoom como cualquier
				// movimiento de cámara (el estado de d3, la persistencia y el cierre de la tarjeta coinciden).
				if (prevW > 0 && prevH > 0 && this.viewW > 0 && this.viewH > 0) {
					select(canvas).call(
						this.zoomBehavior.transform,
						zoomIdentity.translate(this.viewW / 2 - wx * k, this.viewH / 2 - wy * k).scale(k),
					);
				}
			}
			// Vuelve a dibujar DE FORMA SÍNCRONA: syncSize puede haber reasignado el almacén
			// de respaldo (lo que borra el canvas), y durante los redimensionados vivos de la ventana
			// el rAF se queda sin turno por el relayout — un dibujo aplazado dejaría el
			// canvas en blanco durante todo el arrastre (el fallo del borrado al redimensionar).
			this.draw();
		});
		this.resizeObserver.observe(canvas);
		this.syncSize();
	}

	// ── API pública ──

	setData(data: CanvasData): void {
		this.data = data;
		this.nodeById = new Map(data.nodes.map((n) => [n.id, n]));
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const n of data.nodes) {
			if (n.x < minX) minX = n.x;
			if (n.y < minY) minY = n.y;
			if (n.x > maxX) maxX = n.x;
			if (n.y > maxY) maxY = n.y;
		}
		this.worldBBox = { minX, maxX, minY, maxY };
		if (!this.hasFit && data.nodes.length > 0) this.fit();
		// La cámara puede haberla restaurado el usuario (initialCamera del constructor) — la
		// referencia «1×» de la barrera sigue necesitando el zoom de encaje de la caja nueva.
		else this.refreshFitZoom();
		// Reconstruye la simulación viva en torno a los nodos nuevos. Datos nuevos significan que
		// el servidor habló (fusión o relectura); cualquier confirmación pendiente ya no tiene sentido y
		// el grafo está en reposo hasta el siguiente arrastre.
		if (this.commitTimer) {
			clearTimeout(this.commitTimer);
			this.commitTimer = null;
		}
		this.simActive = false;
		this.dragId = null;
		this.simMoved = false;
		this.simCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
		this.buildSim();
		this.geoVersion++; // datos nuevos → reconstruye la geometría del mundo
		this.markDirty();
	}

	setSettings(settings: GraphRenderSettings): void {
		this.settings = settings;
		this.geoVersion++; // cambiaron los tamaños/el ancho de ajuste → reconstruye la geometría
		this.markDirty();
	}

	/** Ajuste de desarrollo para el renderizado de regiones (solo para la sesión,
	 *  nunca se persiste): los números no válidos recurren a los valores por defecto
	 *  — los campos numéricos pueden vaciarse mientras se escribe. Fuerza la
	 *  reconstrucción del mapa de bits de las regiones. */
	setRegionTuning(input: Partial<RegionTuning>): void {
		this.regionTuning = sanitizeRegionTuning(input);
		this.regionBuiltVersion = -2; // nunca es igual a geoVersion → reconstruye
		// Al desactivar el interruptor: suelta el mapa de bits de inmediato para que el
		// volcado pare en el siguiente fotograma — la propia reconstrucción se salta todo
		// el cálculo (buildRegions).
		if (!this.regionTuning.enabled) {
			this.regionCanvas = null;
			this.regionRect = null;
		}
		this.markDirty();
	}

	/** Controles de la física de la simulación viva: reconstruye la simulación a
	 *  partir de las posiciones ACTUALES de los nodos (los mismos objetos de nodo — x/y
	 *  y cualquier fijación de arrastre fx/fy sobreviven; las velocidades vuelven a
	 *  empezar limpias, lo que se percibe como «volver a relajarse con la nueva
	 *  sensación»). Un cambio a mitad de asentamiento vuelve a recocer, que es la
	 *  respuesta honesta a una física nueva. */
	setPhysicsTuning(input: Partial<PhysicsTuning>): void {
		this.physicsTuning = sanitizePhysicsTuning(input);
		this.buildSim();
		// Recalentar: un cambio de ajuste vuelve a recocer el layout desde su estado
		// actual, así que los cambios de modo (off/vertical/radial) VUELVEN A FORMAR el
		// grafo de forma visible en vez de esperar al siguiente arrastre. A mitad de arrastre es seguro —
		// buildSim conservó el fx/fy del nodo fijado.
		if (this.sim) {
			this.sim.alpha(1);
			this.simActive = true;
		}
		this.markDirty();
	}

	/** Canal solo de etiquetas (arreglo de la mezcla al renombrar, 2026-09-23):
	 *  actualizaciones vivas de las etiquetas de clúster SIN setData. La ruta del
	 *  renombrado montaba un objeto de instantánea nuevo, que fluía por setData →
	 *  reconstrucción de la geometría — y la reconstrucción trata el último registro
	 *  leído como autoritativo y cancela cualquier confirmación de arrastre
	 *  pendiente, así que un renombrado rebobinaba visiblemente todo el grafo
	 *  siempre que lo mostrado se hubiera desviado (un arrastre reciente, a mitad de
	 *  recocido, un recocido de la física). Este canal toca SOLO el texto de las
	 *  etiquetas: los metadatos de región que lee la pasada de dibujo más el registro
	 *  de clúster del lado de los datos (para que la siguiente reconstrucción de la
	 *  geometría — visibilidad/ajustes/tamaño — conserve la etiqueta nueva). Los
	 *  nodos, la simulación, las posiciones y la confirmación pendiente nunca se tocan. */
	setClusterLabels(labels: ReadonlyMap<string, string | null>): void {
		const data = this.data;
		if (!data) return;
		const settings = this.settings;
		// Aún no hay ajustes → no se dibuja nada; parchea solo el lado de los datos y
		// deja que la siguiente construcción derive el ajuste de líneas (la misma guarda que usa la construcción).
		if (!settings) {
			applyClusterLabels(data.clusters, [], labels, REGION_LABEL_MAX_WIDTH, REGION_LABEL_MAX_LINES, () => 0);
			return;
		}
		const ctx = this.ctx;
		const prevFont = ctx.font;
		ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize}px ${data.fontFamily}`;
		const changed = applyClusterLabels(
			data.clusters,
			this.regionMeta,
			labels,
			REGION_LABEL_MAX_WIDTH,
			REGION_LABEL_MAX_LINES,
			(s) => ctx.measureText(s).width,
		);
		ctx.font = prevFont;
		if (changed) this.markDirty();
	}

	setVisible(visible: ReadonlySet<string> | null): void {
		this.visible = visible;
		this.geoVersion++; // la visibilidad de los miembros cambia envolventes + trazados
		this.markDirty();
	}

	/** Encuadra todo el grafo (con el relleno). Conserva la cámara en las llamadas
	 *  posteriores a setData — llama a fit() solo para un reencuadre explícito (la
	 *  primerísima apertura; después gana la cámara persistida por quien llama). */
	fit(): void {
		if (!this.data || this.data.nodes.length === 0 || !this.worldBBox) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w < 10 || h < 10) return; // el layout aún no está listo; el ResizeObserver lo reintenta
		const t = fitTransform(this.worldBBox, w, h, 40);
		this.kFit = t.k;
		this.hasFit = true;
		select(this.canvas).call(
			this.zoomBehavior.transform,
			zoomIdentity.translate(t.x, t.y).scale(t.k),
		);
	}

	/** Refresca la referencia «1×» de la barrera de etiquetas a partir de la caja
	 *  actual + el viewport. Ahora kFit SOLO alimenta zoomRatioOf (el giro del
	 *  2026-09-15 lo quitó de la geometría) — así que esto nunca toca geoVersion. */
	private refreshFitZoom(): void {
		if (!this.worldBBox) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w >= 10 && h >= 10) this.kFit = fitTransform(this.worldBBox, w, h, 40).k;
	}

	destroy(): void {
		if (this.frameId !== null) cancelAnimationFrame(this.frameId);
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.sim = null;
		this.simActive = false;
		this.dragId = null;
		this.resizeObserver.disconnect();
		select(this.canvas).on(".zoom", null);
		this.canvas.removeEventListener("wheel", this.onWheel);
		this.canvas.removeEventListener("pointermove", this.onPointerMove);
		this.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.canvas.removeEventListener("pointerup", this.onPointerUp);
		this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
		this.canvas.removeEventListener("contextmenu", this.onContextMenu);
		this.canvas.style.cursor = "";
	}

	// ── Manejadores de eventos (solo cambian el estado — nunca dibujan) ──

	/** Rueda: acumula el objetivo de zoom; la cámara SE DESLIZA hacia él en el bucle
	 *  de ticks (anclada al cursor). La fórmula de sensibilidad es la del propio d3-zoom. */
	private onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const delta = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002);
		const { x, y } = this.eventPos(e);
		const current = this.zoomTarget?.k ?? this.transform.k;
		// Debe quedarse dentro del scaleExtent [0.02, 40] del zoomBehavior.
		const k = Math.min(Math.max(current * Math.exp(delta), 0.02), 40);
		this.zoomTarget = { k, x, y };
		// Reloj de suavización nuevo para que el deslizamiento empiece suave, nunca a medias.
		this.lastTickAt = performance.now();
		this.markDirty();
	};

	private onPointerMove = (e: PointerEvent) => {
		const pos = this.eventPos(e);
		if (this.dragId) {
			const n = this.simById.get(this.dragId);
			if (n) {
				const moved =
					this.dragOrigin !== null &&
					Math.hypot(pos.x - this.dragOrigin.x, pos.y - this.dragOrigin.y) > CLICK_SLOP;
				if (moved) {
					// Primer movimiento real: recalienta y pega el nodo al cursor.
					if (this.commitTimer) {
						clearTimeout(this.commitTimer);
						this.commitTimer = null;
					}
					this.sim?.alphaTarget(DRAG_ALPHA_TARGET);
					this.simActive = true;
					this.markDirty();
				}
				const { x: tx, y: ty, k } = this.transform;
				n.fx = (pos.x - tx) / k;
				n.fy = (pos.y - ty) / k;
			}
			return;
		}
		const node = this.pickAt(pos.x, pos.y);
		if ((node?.id ?? null) !== this.hoverId) this.setHover(node?.id ?? null);
		this.canvas.style.cursor = node ? "pointer" : "";
	};

	private onPointerDown = (e: PointerEvent) => {
		// Solo el botón principal (responsable, ronda de pulido): una pulsación derecha no debe
		// fijar el nodo — el clic derecho pertenece solo al menú contextual, y
		// el pointerup derecho nunca debe leerse como un clic (la tarjeta de detalle
		// se abría debajo del menú).
		if (e.button !== 0) return;
		const pos = this.eventPos(e);
		const node = this.pickAt(pos.x, pos.y);
		if (node && this.sim) {
			// Pulsación sobre un nodo: fija el nodo (en SU PROPIA posición — el cursor
			// puede estar dentro del margen de selección, descentrado). preventDefault anula
			// el mousedown de compatibilidad, así que d3-zoom nunca empieza un desplazamiento.
			// La física solo se recalienta cuando el puntero supera CLICK_SLOP —
			// un clic normal se queda totalmente quieto.
			e.preventDefault();
			try {
				this.canvas.setPointerCapture(e.pointerId);
			} catch {
				/* la captura es en la medida de lo posible */
			}
			this.dragId = node.id;
			this.dragOrigin = pos;
			const n = this.simById.get(node.id);
			if (n) {
				n.fx = n.x;
				n.fy = n.y;
			}
			this.canvas.style.cursor = "grabbing";
			this.markDirty();
			return;
		}
		this.downPos = pos;
		this.zoomTarget = null; // un desplazamiento toma el relevo — cancela cualquier deslizamiento de zoom
	};

	private onPointerUp = (e: PointerEvent) => {
		if (e.button !== 0) return; // el clic derecho es territorio del menú contextual
		// Fin de la pulsación sobre un nodo: clic (sin holgura) → seleccionar; arrastre → soltar y relajar.
		if (this.dragId) {
			const id = this.dragId;
			this.dragId = null;
			this.dragOrigin = null;
			try {
				this.canvas.releasePointerCapture(e.pointerId);
			} catch {
				/* ya liberado */
			}
			this.canvas.style.cursor = "";
			const n = this.simById.get(id);
			if (n) {
				n.fx = null;
				n.fy = null;
			}
			if (this.simActive) {
				// Arrastre real: la simulación se recuece hasta el nuevo estado de reposo; advanceSim
				// detecta el asentamiento y programa la confirmación.
				this.sim?.alphaTarget(0);
				this.markDirty();
			} else {
				// Nunca se recalentó: un clic normal sobre el nodo.
				this.callbacks.onSelect(id, this.eventPos(e));
			}
			return;
		}
		if (!this.downPos) return;
		const pos = this.eventPos(e);
		const moved = Math.hypot(pos.x - this.downPos.x, pos.y - this.downPos.y);
		this.downPos = null;
		if (moved > CLICK_SLOP) return; // eso fue un arrastre (desplazamiento), no un clic
		const node = this.pickAt(pos.x, pos.y);
		if (node) this.callbacks.onSelect(node.id, pos);
		else this.callbacks.onStageClick();
	};

	/** Clic derecho: selecciona el nodo bajo el puntero y pasa la posición a quien
	 *  llama (escenario vacío = null — quien llama cierra cualquier menú abierto). */
	private onContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		const pos = this.eventPos(e);
		const node = this.pickAt(pos.x, pos.y);
		this.callbacks.onContext(node?.id ?? null, pos);
	};

	private onPointerLeave = () => {
		if (this.dragId) return; // la captura del puntero mantiene vivo el arrastre
		this.downPos = null;
		this.setHover(null);
	};

	// ── Interioridades ──

	private eventPos(e: { clientX: number; clientY: number }): Pt {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	private pickAt(px: number, py: number): CanvasNode | null {
		if (!this.data || !this.settings) return null;
		// Posiciones en pantalla, filtradas a los nodos visibles.
		const { x: tx, y: ty, k } = this.transform;
		// Ahora los discos escalan con la cámara: su radio en pantalla es
		// nodeSize × k/kFit; el margen del halo sigue siendo un margen constante en pantalla.
		// Ahora nodeSize está en unidades del mundo (2026-09-15): el radio de impacto en pantalla
		// es el radio del disco en el mundo × el zoom de la cámara, más el margen constante
		// en pantalla — todo el halo sigue pudiéndose probar.
		const maxDist = this.settings.nodeSize * k + PICKING_PAD;
		const projected: { id: string; x: number; y: number }[] = [];
		for (const n of this.data.nodes) {
			if (this.visible && !this.visible.has(n.id)) continue;
			if (isImpNodeId(n.id)) continue; // geometría pura — nunca se selecciona
			projected.push({ id: n.id, x: n.x * k + tx, y: n.y * k + ty });
		}
		const hit = pickNearest(projected, px, py, maxDist);
		if (!hit) return null;
		return this.nodeById.get(hit.id) ?? null;
	}

	private setHover(nodeId: string | null): void {
		if (nodeId === this.hoverId && this.hoverTarget === (nodeId ? 1 : 0)) return;
		this.hoverId = nodeId;
		// Al salir del hover se CONSERVA hoverNode a propósito: el brillo debe desvanecerse
		// desde el último nodo con hover, no desaparecer con el id.
		if (nodeId) this.hoverNode = this.nodeById.get(nodeId) ?? null;
		// Rebasa la animación desde el fundido ACTUAL: los cambios rápidos de hover
		// se deslizan en vez de saltar (traído del comportamiento de la época de sigma).
		this.hoverFrom = this.hoverFade;
		this.hoverTarget = nodeId ? 1 : 0;
		this.hoverStart = performance.now();
		this.animating = true;
		this.markDirty();
	}

	private markDirty(): void {
		this.dirty = true;
		if (this.frameId === null && !this.inTick) {
			this.frameId = requestAnimationFrame(() => {
				this.frameId = null;
				this.tick();
			});
		}
	}

	private tick(): void {
		this.inTick = true;
		try {
			const now = performance.now();
			// Acota el dt: un hueco largo de inactividad no debe teletransportar la suavización hacia delante.
			const dt = Math.min(Math.max(now - this.lastTickAt, 8), 100);
			this.lastTickAt = now;
			const hoverAnim = this.advanceHover();
			const zoomAnim = this.advanceZoom(dt);
			const simAnim = this.advanceSim();
			this.draw();
			// Sigue pidiendo fotogramas SOLO mientras haya una animación en marcha (fundido
			// del hover, deslizamiento del zoom o física viva); un grafo en reposo no programa
			// ningún rAF.
			this.animating = hoverAnim || zoomAnim || simAnim;
		} finally {
			this.inTick = false;
		}
		if (this.animating) {
			this.frameId = requestAnimationFrame(() => {
				this.frameId = null;
				this.tick();
			});
		}
	}

	/** Un paso de la simulación viva; devuelve true mientras la física sigue en
	 *  movimiento. Solo se ejecuta mientras simActive (recalentamiento por arrastre o
	 *  recocido tras soltar). */
	private advanceSim(): boolean {
		if (!this.sim || !this.simActive) return false;
		this.sim.tick();
		// Comprobación de movimiento: ¿se movió de verdad algún nodo (una fijación por clic que
		// nunca se recalentó deja todo exactamente en reposo)?
		for (const n of this.sim.nodes()) {
			if (n.vx || n.vy) {
				this.simMoved = true;
				break;
			}
		}
		this.geoVersion++; // cambiaron las posiciones → reconstrucción de la geometría en draw()
		// ¿Asentado (el arrastre se soltó hace rato y alpha se recoció del todo)?
		if (!this.dragId && this.sim.alpha() < SIM_SETTLE_ALPHA) {
			this.simActive = false;
			this.scheduleCommit();
			return false;
		}
		return true;
	}

	/** Confirmación del estado de reposo con debounce. Un arrastre nuevo o setData la cancelan. */
	private scheduleCommit(): void {
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.commitTimer = setTimeout(() => {
			this.commitTimer = null;
			if (!this.data || !this.simMoved) return;
			this.simMoved = false;
			const positions: Record<string, Position> = {};
			for (const n of this.data.nodes) positions[n.id] = { x: n.x, y: n.y };
			this.callbacks.onCommit(positions);
		}, COMMIT_DEBOUNCE_MS);
	}

	/** Paso del fundido del hover; devuelve true mientras sigue moviéndose. */
	private advanceHover(): boolean {
		if (this.hoverFade === this.hoverTarget) return false;
		const t = Math.min((performance.now() - this.hoverStart) / HOVER_FADE_MS, 1);
		this.hoverFade = this.hoverFrom + (this.hoverTarget - this.hoverFrom) * t;
		// Terminó el fundido de salida — libera el nodo del brillo.
		if (this.hoverTarget === 0 && this.hoverFade === 0) this.hoverNode = null;
		return t < 1;
	}

	/** Paso del deslizamiento del zoom: acerca k con suavidad al objetivo de la rueda,
	 *  manteniendo fijo el punto del mundo bajo el cursor. Independiente de la tasa de
	 *  fotogramas (aproximación exponencial, constante de tiempo ZOOM_EASE_MS).
	 *  Devuelve true mientras se desliza. */
	private advanceZoom(dt: number): boolean {
		const target = this.zoomTarget;
		if (!target) return false;
		const t = this.transform;
		const blend = 1 - Math.exp(-dt / ZOOM_EASE_MS);
		let k = t.k + (target.k - t.k) * blend;
		let done = false;
		if (Math.abs(target.k - k) / target.k < 0.002) {
			k = target.k;
			done = true;
		}
		const scale = k / t.k;
		const x = target.x - (target.x - t.x) * scale;
		const y = target.y - (target.y - t.y) * scale;
		if (done) this.zoomTarget = null;
		// Se aplica a través de d3-zoom para que las restricciones + el evento de zoom (markDirty,
		// onCameraMove) se disparen exactamente igual que con cualquier otro cambio de cámara.
		select(this.canvas).call(
			this.zoomBehavior.transform,
			zoomIdentity.translate(x, y).scale(k),
		);
		return !done;
	}

	/** Redimensiona el almacén de respaldo a la caja CSS × devicePixelRatio; a partir
	 *  de ahí todo el dibujo ocurre en píxeles CSS mediante la transformación del DPR. */
	private syncSize(): void {
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const bw = Math.max(1, Math.round(w * dpr));
		const bh = Math.max(1, Math.round(h * dpr));
		if (this.canvas.width !== bw || this.canvas.height !== bh) {
			this.canvas.width = bw;
			this.canvas.height = bh;
		}
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.viewW = w;
		this.viewH = h;
	}

	/** Deriva TODA la geometría del mundo a partir de datos + visibilidad + ajustes.
	 *  Solo se ejecuta cuando se mueve geoVersion — nunca por fotograma ni por cambio
	 *  de cámara. El zoom/desplazamiento no paga nada de matemáticas de geometría, solo
	 *  rasterización. Los tamaños son UNIDADES DEL MUNDO sacadas tal cual de los
	 *  ajustes (el giro del 2026-09-15 — sin ÷kFit: la escala del mundo es canónica,
	 *  independiente del viewport). */
	private buildGeometry(): void {
		this.builtVersion = this.geoVersion;
		const data = this.data;
		const settings = this.settings;
		if (!data || !settings) return;

		const nodeR = settings.nodeSize;
		this.worldLabelFont = `${LABEL_WEIGHT} ${settings.labelSize}px ${data.fontFamily}`;
		this.world = {
			nodeR,
			glowOuter: nodeR * GLOW_SCALE,
			labelSize: settings.labelSize,
			labelGap: LABEL_GAP,
		};
		const visible = this.visible;
		const isVisible = (id: string) => !visible || visible.has(id);

		// Discos de los nodos: un Path2D, un fill() por fotograma. Los nodos de implicación
		// son geometría pura — nunca un disco, nunca una etiqueta, nunca seleccionados.
		const nodesPath = new Path2D();
		for (const n of data.nodes) {
			if (!isVisible(n.id) || isImpNodeId(n.id)) continue;
			nodesPath.moveTo(n.x + nodeR, n.y);
			nodesPath.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
		}
		this.nodesPath = nodesPath;

		// Trazos de arista + puntas de flecha (arco de renderizado, responsable 2026-09-30): todas
		// las flechas son trazos SENCILLOS — el antiguo glifo de doble trazo ha
		// desaparecido por completo. La geometría de un argumento: las líneas QUE ENTRAN en un nodo
		// de implicación van SIN PUNTA y llegan hasta el CENTRO del nodo imp
		// (las líneas de las premisas conjuntas convergen en un punto); la línea QUE SALE empieza
		// en el centro y su punta de flecha cae en el borde del disco de la
		// conclusión. Los argumentos de una sola premisa llegan aquí como aristas normales
		// proposición→proposición y se dibujan exactamente como cualquier flecha.
		const arrowLen = settings.arrowLength;
		const shafts = new Path2D();
		const heads = new Path2D();
		for (const e of data.edges) {
			if (!isVisible(e.from) || !isVisible(e.to)) continue;
			const a = this.nodeById.get(e.from);
			const b = this.nodeById.get(e.to);
			if (!a || !b) continue;
			const intoImp = isImpNodeId(e.to);
			const outOfImp = isImpNodeId(e.from);
			const g = arrowGeometry(a, b, outOfImp ? 0 : nodeR, intoImp ? 0 : nodeR, arrowLen);
			if (!g) continue;
			shafts.moveTo(g.shaftFrom.x, g.shaftFrom.y);
			if (intoImp) {
				// toRadius 0 puso el vértice EN el centro del nodo imp: el
				// trazo sin punta termina ahí (sin triángulo de punta).
				shafts.lineTo(g.tip.x, g.tip.y);
			} else {
				shafts.lineTo(g.shaftTo.x, g.shaftTo.y);
				heads.moveTo(g.tip.x, g.tip.y);
				heads.lineTo(g.left.x, g.left.y);
				heads.lineTo(g.right.x, g.right.y);
				heads.closePath();
			}
		}
		this.shaftsPath = shafts;
		this.headsPath = heads;

		// Las regiones de clúster NO se construyen aquí: se rasterizan en su propio
		// mapa de bits de baja resolución (ver buildRegions), con su propio calendario de reconstrucción
		// (los fotogramas de la simulación viva se saltan 2 de cada 3 reconstrucciones y vuelcan el último mapa de bits).

		// Ajuste de las etiquetas: measureText una vez por nodo y por construcción de la geometría,
		// nunca por fotograma. El ancho de ajuste conserva el comportamiento de la época de sigma
		// de etiqueta más grande/ajuste más ancho.
		this.labelLines = new Map();
		const ctx = this.ctx;
		const prevFont = ctx.font;
		ctx.font = this.worldLabelFont;
		const maxW = LABEL_MAX_WIDTH * (settings.labelSize / LABEL_SIZE);
		for (const n of data.nodes) {
			if (isVisible(n.id) && !isImpNodeId(n.id)) this.labelLines.set(n.id, wrapLabel(ctx, n.label, maxW));
		}
		ctx.font = prevFont;
	}

	/** (Re)crea la simulación viva a partir de data.nodes en sus posiciones actuales
	 *  + el ajuste actual de la física. La llaman setData y setPhysicsTuning. */
	private buildSim(): void {
		const data = this.data;
		if (!data || data.nodes.length === 0) {
			this.sim = null;
			this.simById = new Map();
			return;
		}
		const t = this.physicsTuning;
		this.sim = createGraphSimulation(data.nodes, data.edges, {
			logicalEdges: data.logicalEdges,
			impLinks: data.impLinks,
			gravity: { x: this.simCenter.x, y: this.simCenter.y, strength: t.gravity },
			alphaDecay: LIVE_ALPHA_DECAY,
			velocityDecay: t.velocityDecay,
			chargeStrength: t.chargeStrength,
			linkStrength: t.linkStrength,
			linkDistance: t.linkDistance,
			clusterPull:
				data.clusters.length > 0 ? { clusters: data.clusters, strength: t.clusterPull } : undefined,
			depthAnchor:
				t.depthMode === "off"
					? undefined
					: {
							mode: t.depthMode,
							strength: t.depthStrength,
							spacing: t.depthSpacing,
							baseRadius: t.depthBaseRadius,
							center: this.simCenter,
						},
		});
		this.simById = new Map(data.nodes.map((n) => [n.id, n as LayoutNode]));
		// Higiene (oleada de arreglos del 2026-09-23): una simulación nueva empieza con alpha 1 y
		// nunca decae mientras está parada — así que el primer arrastre tras la reconstrucción
		// volvería a recocer todo el grafo a plena potencia (alphaTarget(0.3)
		// se desliza HACIA ABAJO desde 1 en vez de subir suavemente desde el reposo). Se inicializa en
		// el suelo de asentamiento para que el primer arrastre se comporte como los arrastres
		// en régimen estable. setPhysicsTuning sigue ensayando su alpha(1) explícito
		// cuando lo que se busca ES un recocido completo.
		this.sim.alpha(SIM_SETTLE_ALPHA);
	}

	/** Rasteriza las regiones de clúster en el mapa de bits de baja resolución del
	 *  espacio del mundo. Se ejecuta con los cambios de datos/visibilidad/ajustes en
	 *  reposo, y cada REGION_EVERY fotogramas mientras la simulación viva mueve nodos
	 *  (los fotogramas intermedios vuelcan el mapa de bits anterior — un paso de
	 *  simulación de retraso a 120 fps es invisible). Las posiciones salen
	 *  directamente de data.nodes. */
	private buildRegions(): void {
		const data = this.data;
		if (!data || data.clusters.length === 0) {
			this.regionCanvas = null;
			this.regionRect = null;
			this.regionMeta = [];
			return;
		}
		const visible = this.visible;
		const isVisible = (id: string): boolean => !visible || visible.has(id);

		const tuning = this.regionTuning;
		// La dilatación está en unidades del MUNDO (el giro del 2026-09-15) — el semiancho
		// del trazo de la región sale directamente del ajuste, sin kFit.

		// Rectángulo del mundo sobre los miembros VISIBLES de los clústeres (las regiones cubren a los miembros
		// y sus aristas internas del clúster — nada más).
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const c of data.clusters) {
			for (const id of c.members) {
				if (!isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				if (n.x < minX) minX = n.x;
				if (n.x > maxX) maxX = n.x;
				if (n.y < minY) minY = n.y;
				if (n.y > maxY) maxY = n.y;
			}
		}
		if (minX > maxX) {
			this.regionCanvas = null;
			this.regionRect = null;
			this.regionMeta = [];
			return;
		}

		// ¿En qué clúster está un nodo (para las aristas internas del clúster)?
		const clusterOf = new Map<string, number>();
		data.clusters.forEach((c, i) => {
			for (const id of c.members) clusterOf.set(id, i);
		});

		// Las anclas de las etiquetas se calculan SIEMPRE (barato — una pasada de centroides, sin canvas):
		// las etiquetas de clúster siguen su propio ajuste `clusterLabels` y deben
		// sobrevivir a que se desactive el pintado de regiones.
		this.regionMeta = [];
		data.clusters.forEach((cluster) => {
			let members = 0;
			let sumX = 0;
			let sumY = 0;
			for (const id of cluster.members) {
				if (!isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				members++;
				sumX += n.x;
				sumY += n.y;
			}
			if (members > 0) {
				this.regionMeta.push({
					id: cluster.id,
					label: cluster.label || null,
					cx: sumX / members,
					cy: sumY / members,
					hue: clusterHue(cluster.id),
					lines: null,
				});
			}
		});

		// Ajusta las etiquetas de región UNA vez por construcción de la geometría, a su
		// tamaño fijo en PANTALLA (etiquetas relativas al observador — este tamaño en px es lo que
		// llega a la pantalla con cualquier zoom, así que el ajuste nunca queda obsoleto a mitad de
		// un movimiento de cámara). Los nombres de sesión son cortos; las rutas de fichero no (oleada
		// 7) — el tope + la elipsis mantienen acotada la huella.
		const settings = this.settings;
		if (settings) {
			const ctx = this.ctx;
			const prevFont = ctx.font;
			ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize}px ${data.fontFamily}`;
			for (const rm of this.regionMeta) {
				rm.lines = rm.label
					? wrapRegionLabel(rm.label, REGION_LABEL_MAX_WIDTH, REGION_LABEL_MAX_LINES, (s) => ctx.measureText(s).width)
					: null;
			}
			ctx.font = prevFont;
		}

		// EL interruptor de apagado (usuario 2026-09-15): se salta el cálculo, no solo
		// se oculta el pintado — sin salpicado, sin desenfoque, sin relectura, sin mapa de bits, sin
		// volcado. Todo lo que hay debajo de este return es la ruta del mapa de bits.
		if (!tuning.enabled) {
			this.regionCanvas = null;
			this.regionRect = null;
			return;
		}

		// Tamaño del mapa de bits: el tramo más largo del mundo corresponde a `bitmap` px. El rectángulo
		// se amplía con el semiancho del trazo (dilatación) más el alcance del
		// desenfoque, para que nada se recorte en el borde del mapa de bits.
		//
		// El alcance del desenfoque está en unidades del MUNDO (el último paso del giro del 2026-09-15):
		// tuning.blur ES el alcance en el mundo, canónico como la dilatación — ya no
		// escala con el tramo del grafo (el antiguo blurW = blur ×
		// tramo/bitmap se veía 6× más suave en un grafo de 338 nodos que en uno de
		// 13). Esto también vuelve estructural el arreglo del colapso de la búsqueda del 2026-09-14:
		// un desenfoque en unidades del mundo no puede acoplarse a ninguna celda, así que
		// el antiguo ancla `cellRef` ha desaparecido.
		const dilationW = tuning.dilation;
		const blurW = tuning.blur;
		const padWorld = dilationW + blurW * 2;
		// Suelo de la celda: un único nodo visible (tramo 0) ponía a cero la celda y
		// disparaba las dimensiones del mapa de bits a Infinity (TypeError en getImageData). El
		// suelo es el propio alcance del rectángulo ampliado, así que las dimensiones siguen finitas (lado
		// largo ≤ bitmap · (1 + tramo/2·margen)) por ajustada que sea la búsqueda.
		const spanNow = Math.max(maxX - minX, maxY - minY);
		const cell = Math.max(spanNow, padWorld * 2) / tuning.bitmap;
		minX -= padWorld;
		minY -= padWorld;
		maxX += padWorld;
		maxY += padWorld;
		const spanX = maxX - minX;
		const spanY = maxY - minY;
		const bw = Math.max(1, Math.ceil(spanX / cell));
		const bh = Math.max(1, Math.ceil(spanY / cell));
		let rc = this.regionCanvas;
		if (!rc) {
			rc = document.createElement("canvas");
			this.regionCanvas = rc;
		}
		if (rc.width !== bw || rc.height !== bh) {
			rc.width = bw;
			rc.height = bh; // también borra
		}
		// willReadFrequently: el paso de desenfoque hace getImageData/putImageData en cada
		// reconstrucción — Chrome mantiene este canvas en la CPU en vez de trasladarlo
		// a la GPU y de vuelta.
		const rctx = rc.getContext("2d", { willReadFrequently: true });
		if (!rctx) return;
		rctx.clearRect(0, 0, bw, bh);
		rctx.lineCap = "round";
		rctx.lineWidth = (dilationW * 2) / cell;

		// La región ES el esqueleto dilatado: las aristas internas del clúster como
		// trazos de extremos redondeados (dilatación de Minkowski). NADA de discos por nodo para todos
		// — contaban dos veces donde los nodos están sobre aristas (puntos calientes
		// que identificó el usuario, cuando los clústeres se basaban en aristas).
		data.clusters.forEach((cluster, ci) => {
			const hue = clusterHue(cluster.id);
			// Trazos con opacidad completa: el alfa se aplica UNA vez al final del todo
			// (dilatar a 1 → desenfocar → escalar por edgeAlpha). Meter aquí el alfa
			// de cada trazo hacía que el apilado source-over lo ACUMULARA — un
			// disco huérfano que se solapaba con cualquier cosa se veía como un punto más oscuro
			// contado dos veces (informe del usuario 2026-09-14). Con alfa 1, el canal
			// alfa es un indicador puro de cobertura: los solapes de cualquier número
			// aportan exactamente 1,0.
			rctx.strokeStyle = `hsla(${hue}, 65%, ${data.colors.clusterLightness.ring}%, 1)`;
			rctx.beginPath();
			// Extremos cubiertos de verdad por los extremos redondeados de un trazo.
			const touched = new Set<string>();
			for (const e of data.edges) {
				if (clusterOf.get(e.from) !== ci) continue;
				if (clusterOf.get(e.to) !== ci) continue;
				// Filtro de búsqueda: traza solo las aristas totalmente visibles. Los segmentos de
				// nodos invisibles que se seguían trazando en el mapa de bits (solo de visibles) cortaban
				// franjas diagonales de color sobre las regiones de otros clústeres (informe del
				// usuario 2026-09-14) — el rectángulo, los discos y las anclas ya filtran.
				if (!isVisible(e.from) || !isVisible(e.to)) continue;
				const a = this.nodeById.get(e.from);
				const b = this.nodeById.get(e.to);
				if (!a || !b) continue;
				rctx.moveTo((a.x - minX) / cell, (a.y - minY) / cell);
				rctx.lineTo((b.x - minX) / cell, (b.y - minY) / cell);
				touched.add(e.from);
				touched.add(e.to);
			}
			rctx.stroke();

			// Discos de los miembros para la era SEMÁNTICA (DECIDIDO 2026-09-13): los clústeres
			// son ahora temas por significado, y muchos miembros (huérfanos, microtemas
			// aislados) NO comparten ninguna arista interna del clúster con nadie — solo con
			// los trazos de arista se quedaban totalmente sin color. Un disco (del mismo
			// radio que un extremo redondeado = dilatación) cubre exactamente a los miembros a los que
			// no llegó ningún trazo: cada miembro lo pintan los extremos de sus aristas O
			// un disco, nunca ambos — la regla de no contar dos veces sobrevive.
			rctx.fillStyle = `hsla(${hue}, 65%, ${data.colors.clusterLightness.ring}%, 1)`;
			const discR = dilationW / cell;
			for (const id of cluster.members) {
				if (touched.has(id) || !isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				rctx.beginPath();
				rctx.arc((n.x - minX) / cell, (n.y - minY) / cell, discR, 0, Math.PI * 2);
				rctx.fill();
			}
		});

		// EL desenfoque + el alfa (en ese orden, por diseño — decidido por el usuario
		// 2026-09-14): 3 rondas de desenfoque de caja sobre el mapa de bits premultiplicado,
		// LUEGO se escala todo el campo por edgeAlpha una vez. El escalado bilineal
		// por sí solo no desenfoca nada (rampas en tienda de campaña — el aspecto JPEG);
		// esto hace que el campo sea suave de verdad antes del volcado. El
		// radio es el alcance en el mundo ÷ la celda, redondeado a un entero
		// (boxBlurRound indexa con el contador del bucle) con un suelo de 1px —
		// un grafo cuya celda supera el alcance del desenfoque sigue recibiendo un píxel
		// de suavizado en vez de reducirse a cero. El radio 0 (desenfoque desactivado)
		// sigue pasando por esta ruta — boxBlurRound
		// copia —, así que el alfa final se aplica de manera uniforme con o sin
		// desenfoque.
		{
			const blurPx = tuning.blur > 0 ? Math.max(1, Math.round(blurW / cell)) : 0;
			const img = rctx.getImageData(0, 0, bw, bh);
			const n = bw * bh * 4;
			const a = new Float32Array(n);
			for (let i = 0; i < n; i += 4) {
				const alpha = img.data[i + 3]! / 255;
				a[i] = img.data[i]! * alpha;
				a[i + 1] = img.data[i + 1]! * alpha;
				a[i + 2] = img.data[i + 2]! * alpha;
				a[i + 3] = img.data[i + 3]!;
			}
			const b = new Float32Array(n);
			const tmp = new Float32Array(n); // temporal solo dentro de cada ronda
			boxBlurRound(a, tmp, b, bw, bh, blurPx); // a → b
			boxBlurRound(b, tmp, a, bw, bh, blurPx); // b → a
			boxBlurRound(a, tmp, b, bw, bh, blurPx); // a → b (resultado)
			// Deshaz la premultiplicación de vuelta a píxeles; escala el alfa por edgeAlpha
			// AQUÍ — la única aplicación, la final. Resultado: alfa interior constante
			// en todo lo cubierto, que solo se atenúa a lo largo de los bordes del desenfoque.
			for (let i = 0; i < n; i += 4) {
				const alpha = b[i + 3]!;
				if (alpha <= 0) {
					img.data[i] = 0;
					img.data[i + 1] = 0;
					img.data[i + 2] = 0;
					img.data[i + 3] = 0;
				} else {
					// Deshacer la premultiplicación: pm = c * a/255, así que c = pm / a * 255.
					img.data[i] = Math.round((b[i]! / alpha) * 255);
					img.data[i + 1] = Math.round((b[i + 1]! / alpha) * 255);
					img.data[i + 2] = Math.round((b[i + 2]! / alpha) * 255);
					img.data[i + 3] = Math.round(alpha * tuning.edgeAlpha);
				}
			}
			rctx.putImageData(img, 0, 0);
		}
		this.regionRect = { minX, minY, w: spanX, h: spanY };
	}

	/** LA función de dibujo: todas las capas, un fotograma, una cámara. Todo el
	 *  dibujo ocurre en coordenadas del MUNDO bajo la transformación de la cámara;
	 *  por fotograma no se recalcula nada salvo el estilo de las capas. */
	private draw(): void {
		this.dirty = false;
		const data = this.data;
		const settings = this.settings;
		if (!data || !settings) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const ctx = this.ctx;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		this.frameCount++;
		// Regiones: se reconstruyen si la geometría está obsoleta en reposo; durante la simulación viva,
		// cada REGION_EVERY fotogramas (los demás vuelcan el último mapa de bits).
		if (
			this.regionBuiltVersion !== this.geoVersion &&
			(!this.simActive || this.frameCount % REGION_EVERY === 0)
		) {
			this.buildRegions();
			this.regionBuiltVersion = this.geoVersion;
		}
		if (this.builtVersion !== this.geoVersion) this.buildGeometry();
		if (!this.nodesPath) return;

		const { x: tx, y: ty, k } = this.transform;
		// LA cámara: una transformación, y a partir de ahí todo son coordenadas del mundo.
		ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

		const ratio = zoomRatioOf(this.kFit, k);
		const nodeAlpha = labelAlpha(ratio, settings.labelZoom);
		const regionAlpha = 1 - nodeAlpha;
		const { nodeR, glowOuter } = this.world;

		// 1. Regiones de clúster: un único volcado de un diminuto mapa de bits del espacio del mundo. El
		//    desenfoque del escalado es la suavidad de la región; los tintes de clústeres adyacentes se mezclan
		//    con source-over donde se solapan (decidido: multiply es invisible
		//    sobre el fondo oscuro).
		if (this.regionCanvas && this.regionRect) {
			const { minX, minY, w, h } = this.regionRect;
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(this.regionCanvas, minX, minY, w, h);
		}

		// 3. Aristas: trazos + puntas de flecha a partir de trazados en caché; grosor constante en
		// pantalla (÷ k), geometría en unidades del mundo (escala con el grafo).
		// Trazos de apoyo: un segundo trazo, más fino (responsable, 2026-09-29) —
		// las puntas comparten el único relleno con la geometría completa (decisión solo para el trazo).
		// Un trazo de grosor 0 real no está definido en el canvas: el extremo 0 de la proporción
		// se queda en una línea finísima (0,5px en pantalla — ocultar es cosa del conmutador).
		if (settings.edgeWidth > 0) {
			ctx.strokeStyle = data.colors.edge;
			ctx.fillStyle = data.colors.edge;
			ctx.lineWidth = settings.edgeWidth / k;
			ctx.lineCap = "round";
			ctx.stroke(this.shaftsPath);
			ctx.fill(this.headsPath);
		}

		// 4. Nodos: un único Path2D en caché, un relleno.
		ctx.fillStyle = data.colors.node;
		ctx.fill(this.nodesPath);

		// 6. Etiquetas de nodo — una barrera global, con fundido conjunto. Escaladas en el mundo
		// con el grafo (crecen al acercar, al estilo de Obsidian).
		if (nodeAlpha > 0.01) {
			ctx.save();
			ctx.globalAlpha = nodeAlpha;
			ctx.font = this.worldLabelFont;
			for (const [id, lines] of this.labelLines) {
				const n = this.nodeById.get(id);
				if (!n) continue;
				drawNameLines(ctx, n.x, n.y, lines, this.world, data.colors.label);
			}
			ctx.restore();
		}

		// 7. Brillo del hover (lo más alto): halo del color del nodo + el nombre
		// aclarado, los dos con el MISMO factor de fundido. Unidades del mundo, como todo
		// lo demás. Se muestra aunque las etiquetas estén ocultas por el zoom (el hover es su propia
		// indicación, no una etiqueta).
		if (this.hoverNode && this.hoverFade > 0.02) {
			const n = this.visible && !this.visible.has(this.hoverNode.id)
				? null // filtrado por la búsqueda — sin brillo en los nodos ocultos
				: this.hoverNode;
			if (n) {
				const glow = ctx.createRadialGradient(n.x, n.y, nodeR, n.x, n.y, glowOuter);
				glow.addColorStop(0, rgbaFromHex(data.colors.node, GLOW_ALPHA * this.hoverFade));
				glow.addColorStop(1, rgbaFromHex(data.colors.node, 0));
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(n.x, n.y, glowOuter, 0, Math.PI * 2);
				ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2, true);
				ctx.fill("evenodd");
				ctx.save();
				ctx.globalAlpha = this.hoverFade;
				ctx.font = this.worldLabelFont;
				drawNameLines(ctx, n.x, n.y, this.labelLines.get(n.id) ?? [], this.world, data.colors.hoverText);
				ctx.restore();
			}
		}

		// 8. Etiquetas de región de los clústeres — LA capa más alta (usuario 2026-09-16:
		// antes las etiquetas de nodo y los nombres del hover se dibujaban encima; las etiquetas de región
		// nunca deben quedar tapadas por el contenido). Con barrera inversa sobre EL control
		// de zoom (visibles con el zoom alejado, se desvanecen a medida que aparecen las etiquetas de nodo).
		// Relativas al observador por diseño (interfaz, no contenido del grafo): se dibujan en el
		// centroide del mundo con una fuente de clusterLabelSize / k — un tamaño
		// constante en pantalla con cualquier zoom (ajustable por el usuario desde el 2026-09-16).
		// Oleada 7: las etiquetas son nombres de sesión / rutas de fichero — ya ajustadas en
		// la construcción de la geometría (tope + elipsis) y dibujadas centradas en el
		// centroide línea a línea.
		if (settings.clusterLabels && regionAlpha > 0.01) {
			ctx.save();
			ctx.globalAlpha = regionAlpha;
			ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize / k}px ${data.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			// Px de pantalla ÷ k = unidades del mundo — las líneas siguen igual de separadas
			// con un paso constante en pantalla con cualquier zoom.
			const lineH = (settings.clusterLabelSize * REGION_LABEL_LINE_HEIGHT) / k;
			for (const rm of this.regionMeta) {
				if (!rm.lines) continue;
				ctx.fillStyle = `hsla(${rm.hue}, 55%, ${data.colors.clusterLightness.label}%, 0.85)`;
				const firstOffset = (-(rm.lines.length - 1) / 2) * lineH;
				for (let i = 0; i < rm.lines.length; i++) {
					ctx.fillText(rm.lines[i]!, rm.cx, rm.cy + firstOffset + i * lineH);
				}
			}
			ctx.restore();
		}
	}
}
