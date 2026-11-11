"use client";

/**
 * La vista del grafo de conocimiento de Inicio (W4; visión §1 «Rendering
 * (DECIDED)»).
 *
 * ARQUITECTURA (2026-09-13, decidida tras la pasada de investigación —
 * docs/research/graph-rendering.md, opción B): sigma.js HA DESAPARECIDO. El
 * renderizador es ahora un único Canvas 2D hecho a mano (./graph-canvas.ts) —
 * una FUNCIÓN DE DIBUJO TONTA sobre datos planos con UN bucle de
 * requestAnimationFrame y un indicador de sucio. Todo lo que hacía frágil la
 * época de sigma es ahora estructuralmente imposible: las envolventes no pueden
 * ir por detrás de los nodos (un bucle, una cámara, un fotograma), los cambios
 * de ajustes no pueden desplazar nada (la cámara vive en el renderizador y
 * nunca hay una reconstrucción), y han desaparecido los repintados del canvas
 * entero por cada evento de cámara (picos de GPU + pitido de bobinas) (como
 * mucho un dibujo por fotograma, y NINGÚN fotograma en reposo).
 *
 * Alternativa de layout (sin registro): UNA pasada síncrona de
 * incrementalLayout (d3-force, core/layout.ts) dentro de un useEffect escribe
 * x/y en el espacio del mundo, y luego las posiciones se pasan al renderizador
 * como datos. Nunca empieza ninguna animación de layout; la única animación es
 * el breve fundido del hover, estrictamente acotado en el tiempo — la CPU en
 * reposo es cero (el bucle no programa ningún rAF hasta que algo cambia de verdad).
 *
 * El trabajo del componente es todo lo que RODEA al dibujo: leer + volver a
 * leer la instantánea, ejecutar el layout, resolver los colores del tema a
 * hexadecimal, filtrar con el cuadro de búsqueda, ser responsable del panel de
 * ajustes / la tarjeta de detalle / el botón de importar / los chips del
 * proceso, y ALIMENTAR al renderizador (datos, ajustes, visibilidad). El
 * contrato del renderizador sigue siendo solo de presentación — que es
 * exactamente lo que necesita el trabajo que viene del playground y del layout
 * por clústeres primero: un renderizador que dibuja los datos que se le den,
 * sin cuestionarlos nunca.
 *
 * Semántica visual, toda conservada tal cual de la época de sigma:
 *   - Las etiquetas de nodo (los nombres cortos acuñados por el extractor) se
 *     ajustan bajo el nodo; una única barrera GLOBAL de zoom las desvanece
 *     juntas (nada de aparecer nodo a nodo).
 *   - Hover: un halo suave y brillante del propio color del nodo con un radio
 *     constante, con la opacidad en fundido cruzado ~180 ms y el nombre
 *     aclarándose con el mismo factor; todo el halo se puede probar (margen de
 *     selección).
 *   - Envolventes de los clústeres (visión §1): rellenos translúcidos suaves en
 *     capas + un borde discontinuo por clúster, con un tono estable a partir del
 *     id del clúster; la etiqueta de región en el centroide aparece a lo largo
 *     exactamente del mismo tramo de zoom en que se desvanecen las etiquetas de
 *     nodo (EL único control de zoom) — y se puede conmutar en el panel de
 *     ajustes (las envolventes se dibujan siempre).
 *   - El ajuste persistido labelZoom conserva la convención de ratio de cámara
 *     de sigma (1 = zoom de encaje, MENOR = más zoom): etiquetas hasta zoom 0.5x
 *     significa que las etiquetas aparecen al acercar más allá de 2x el encaje.
 *   - Clic en un nodo -> la tarjeta de detalle anclada justo debajo (se da la
 *     vuelta hacia arriba cerca del borde inferior); cualquier movimiento de
 *     cámara la cierra. Hacer clic en el escenario vacío la cierra. El filtrado
 *     de la búsqueda oculta los nodos (y sus aristas) del renderizado, la
 *     selección, el hover Y las etiquetas; una tarjeta abierta se cierra si su
 *     nodo queda filtrado.
 *
 * Ajustes de renderizado (2026-09-13): el engranaje del panel de búsqueda
 * muestra cinco deslizadores (tamaño de nodo, grosor de arista, longitud de la
 * punta de flecha, tamaño de etiqueta, el umbral de zoom) y la casilla de las
 * etiquetas de clúster. (El conmutador de dibujo de las aristas de apoyo + el
 * deslizador de grosor murieron con las propias aristas de apoyo — primero las
 * cadenas, 2026-09-30.) Persistidos en el SERVIDOR
 * (data/render-settings.json mediante /api/graph/render-settings): se cargan una
 * vez tras el montaje y se guardan con debounce en cada cambio del usuario — una
 * única fuente de verdad compartida por todos los navegadores. El deslizador del
 * zoom de etiquetas es logarítmico (su banda útil 0,25–0,5 queda en el centro,
 * no apretujada a la izquierda) y muestra unidades normalizadas en las que el
 * 0,5 por defecto se lee como «1×». Los ajustes se aplican con solo volver a
 * dibujar — sin reconstrucción ni nuevo layout, y la cámara nunca se mueve.
 */

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotesImportControl, NotesImportErrors, NotesImportNotices, useNotesImport } from "@/components/notes-import.tsx";
import { PluginGraphActions } from "@/components/plugin-chrome";
import { SettingsSlider as SettingSlider } from "@/components/settings/controls";
import Link from "next/link";
import { FileTextIcon, ListTreeIcon, Loader2Icon, SearchIcon, SettingsIcon, WaypointsIcon } from "lucide-react";
import { incrementalLayout, propositionSessionHref, type GraphCostSummary, type GraphNode, type GraphSnapshot } from "@/src/core";
import { planCostLabel } from "@/components/usage-format";
import { CLUSTER_LIGHTNESS, GraphCanvasRenderer, type GraphRenderSettings } from "./graph-canvas.ts";
import { useAppearance } from "@/components/settings/appearance";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import { useActivity } from "@/components/activity-dock";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { MenuShell } from "@/components/menu-shell.tsx";
import { useInteractionLayers } from "@/components/interaction-layers";
import { isInteractionScopeEligible } from "@/components/plugin-input-focus";
import { DeleteNodeDialog } from "@/components/delete-node-dialog.tsx";
import { ChainTableOverlay } from "@/components/chain-table.tsx";
import { Hint } from "@/components/ui/hint";
import {
	ARROW_LENGTH_LADDER,
	CHARGE_RANGE,
	CLUSTER_LABEL_SIZE_LADDER,
	CLUSTER_PULL_RANGE,
	DEPTH_BASE_RADIUS_RANGE,
	DEPTH_SPACING_RANGE,
	DEPTH_STRENGTH_RANGE,
	DEFAULT_RENDER_SETTINGS,
	EDGE_WIDTH_LADDER,
	GRAVITY_RANGE,
	LABEL_SIZE_LADDER,
	LABEL_ZOOM_LADDER,
	LINK_DISTANCE_RANGE,
	LINK_STRENGTH_RANGE,
	NODE_SIZE_LADDER,
	REGION_BITMAP_OPTIONS,
	REGION_BLUR_LADDER,
	fromLadderPosition,
	snapToLadder,
	toLadderPosition,
	REGION_DILATION_LADDER,
	REGION_EDGE_ALPHA_LADDER,
	VELOCITY_DECAY_RANGE,
	fromOffSliderPosition,
	fromSliderPosition,
	labelZoomDisplay,
	sanitizeRenderSettings,
	toOffSliderPosition,
	toSliderPosition,
} from "@/src/core";

/** El aspecto uniforme de los nodos (sin clases de estado — el canvas quiere
 *  hexadecimal, no oklch): el color de acento, hasta que llegue el modelo de estados. */
const NODE_COLOR_TOKEN = "--primary";

/** Persistencia por dispositivo de la cámara del grafo (estado de la vista
 *  zoom+desplazamiento). v1 en la clave: la forma guardada es la transformación de d3 del renderizador {k, x, y}. */
const CAMERA_STORAGE_KEY = "lh.graph.camera.v1";

// ---- Ajustes de renderizado (los controles del panel de ajustes) ----------
//
// La forma, los valores por defecto, el saneador y las correspondencias de los deslizadores viven en
// src/core/render-settings.ts (compartido con el almacén del servidor + las pruebas).

type RenderSettings = GraphRenderSettings;

/**
 * Predicado de filtro puro para el panel de búsqueda: un nodo es visible cuando
 * la consulta está vacía o coincide con su nombre o su enunciado (sin distinguir
 * mayúsculas). Exportado para las pruebas; el feed de visibilidad solo consume su veredicto.
 */
export function isNodeVisible(node: Pick<GraphNode, "name" | "statement">, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return node.name.toLowerCase().includes(q) || node.statement.toLowerCase().includes(q);
}

/** Parche en su sitio de las sesiones para un renombrado en vivo (arreglo de la
 *  mezcla al renombrar, 2026-09-23). La ruta ANTIGUA montaba un objeto de
 *  instantánea nuevo, que pasaba por el efecto setData con clave [snapshot] →
 *  reconstrucción de la geometría → el último registro leído pasaba a ser
 *  autoritativo + se cancelaba la confirmación de arrastre pendiente → el grafo
 *  se rebobinaba visiblemente siempre que lo mostrado se hubiera desviado. Esta
 *  frontera NUNCA cambia la identidad de los objetos: la misma referencia de
 *  instantánea, el mismo array de clústeres — así que el feed de datos no puede
 *  volver a dispararse. El refresco de lo mostrado va en un estado de tick
 *  aparte, y la propia etiqueta del clúster pasa por el canal solo de etiquetas
 *  del renderizador (setClusterLabels). Exportada para las pruebas; solo estado
 *  de presentación puro — el servidor deriva la misma unión en su siguiente lectura. */
export function renameSessionsPatch(snapshot: Pick<GraphSnapshot, "sessions">, id: string, title: string): void {
	snapshot.sessions[id] = title;
}

/** Posiciones semilla para los nodos que el registro aún no conoce (higiene,
 *  oleada de arreglos del 2026-09-23): antes caían en un ?? 0 y se amontonaban en
 *  el origen. Se colocan en un anillo determinista alrededor del centroide de las
 *  posiciones conocidas — ángulo a partir del hash del id (FNV-1a), desplazamiento
 *  en espiral de ángulo áureo para que incluso las colisiones de hash se
 *  repartan. Estables entre remontajes, lo bastante lejos de la masa para verse,
 *  y se relajan con el conjunto en el siguiente arrastre. Modifica en su sitio el
 *  mapa dado; en lo demás es pura. */
export function seedMissingNodePositions(
	nodes: readonly { id: string }[],
	positions: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
	if (positions.size === 0 || nodes.every((n) => positions.has(n.id))) return positions;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of positions.values()) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const radius = Math.max(maxX - minX, maxY - minY, 40) * 0.7 + 20;
	const missing = nodes.filter((n) => !positions.has(n.id));
	missing.forEach((n, i) => {
		// Hash FNV-1a → [0,1) → ángulo; el desplazamiento en espiral de ángulo áureo
		// reparte las colisiones y escalona de forma determinista las rutas largas.
		let h = 0x811c9dc5;
		for (let c = 0; c < n.id.length; c++) {
			h ^= n.id.charCodeAt(c);
			h = (h * 0x01000193) >>> 0;
		}
		const angle = ((h / 0xffffffff) * 2 * Math.PI + i * 2.39996323) % (2 * Math.PI);
		positions.set(n.id, {
			x: cx + Math.cos(angle) * radius,
			y: cy + Math.sin(angle) * radius,
		});
	});
	return positions;
}

// ---- Auxiliares de color (el canvas quiere hexadecimal, no oklch) ----------

/** Resuelve una variable CSS (oklch en esta app) a #rrggbb a través del canvas. */
function cssColorToHex(css: string): string {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d");
	if (!ctx) return "#888888";
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	const { data } = ctx.getImageData(0, 0, 1, 1);
	return `#${[data[0]!, data[1]!, data[2]!]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("")}`;
}

function tokenHex(cssVar: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
	return value ? cssColorToHex(value) : "#888888";
}

// ---- Componente -----------------------------------------------------------

interface Selection {
	node: GraphNode;
	/** Los orígenes que tocaron este nodo: ids de chat (sesiones enlazables) e ids
	 *  de orígenes de notas ("src_…" — ficheros importados, entradas estáticas). */
	sourceIds: string[];
	/** Posición del nodo en píxeles del contenedor (en el momento del clic; los
	 *  movimientos de cámara cierran la tarjeta, así que nunca hay que reanclarla). */
	anchor: { x: number; y: number };
}

/** Una fila de rango con etiqueta para el panel de ajustes de renderizado. */
/** Visualización compacta del tamaño para los deslizadores logarítmicos: "2", "1.6", "0.75". */
function sizeDisplay(v: number): string {
	return `${v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100}`;
}

/** Visualización compacta de tokens: 45231 → "45.2k"; ausente → "—". */
function fmtTokens(n: number | undefined): string {
	if (n === undefined) return "—";
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Tiempo relativo para las filas de ejecuciones: "now", "12m", "3h", "2d". */
function timeAgo(startedAt: number): string {
	const mins = Math.round((Date.now() - startedAt) / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** Coste de la ejecución/fase con 3 decimales (los céntimos del proceso son
 *  dinero real a esta escala); los totales de cabecera usan 2. Null (modelo sin precio) muestra "—". */
function fmtRunCost(dollars: number | null, providers: readonly string[] = []): string {
	return planCostLabel(dollars, providers, (value) => `$${value.toFixed(3)}`);
}
function graphProviders(value: { subscriptionRuns?: number; subscriptionProviders?: string[] }): string[] {
	return value.subscriptionProviders ?? ((value.subscriptionRuns ?? 0) > 0 ? ["ChatGPT"] : []);
}
function graphUsageLabel(costs: Pick<GraphCostSummary, "stages">): string {
	const stages = [costs.stages.extraction, costs.stages.audit];
	const providers = [...new Set(stages.flatMap(graphProviders))];
	const priced = stages.some((stage) => stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) > 0);
	const dollars = displayCostTotals(costs).totalDollars;
	return planCostLabel(priced ? dollars : null, providers, (value) => `$${value.toFixed(2)}`);
}

/**
 * Las cifras de coste que MUESTRA la interfaz (ronda de ajustes del responsable,
 * 2026-09-24): solo extracción + auditoría. El nombrado de clústeres está muerto
 * — las etiquetas son títulos de sesión / nombres de fichero —, así que el
 * plegado de nombrado del núcleo (y su gasto histórico) a propósito no se
 * muestra en ningún sitio: la píldora y el panel deben coincidir, y los dos leen
 * ESTO, nunca GraphCostSummary.totalDollars. (Después, la fase de nombrado del
 * plegado del núcleo se eliminó del todo — 2026-09-24 —, así que la lista de
 * ejecuciones recientes solo lleva ejecuciones de extracción.)
 */
export function displayCostTotals(costs: Pick<GraphCostSummary, "stages">): {
	totalDollars: number;
	unpricedRuns: number;
} {
	// Las dos fases vivas (la columna vertebral vino y se fue en un solo día,
	// 2026-09-30 — la extracción consciente de los resúmenes la sustituyó).
	return {
		totalDollars: costs.stages.extraction.dollars + costs.stages.audit.dollars,
		unpricedRuns: costs.stages.extraction.unpricedRuns + costs.stages.audit.unpricedRuns,
	};
}

/**
 * El control de coste del proceso del grafo (oleada de colocación del
 * 2026-09-20): un número desnudo de dólares acumulados — sin cromo de píldora
 * (responsable: «solo un número»), resaltado al pasar el ratón; el clic abre o
 * cierra el panel de desglose. El mismo patrón de cierre que el engranaje de
 * ajustes: un clic fuera o Escape lo cierran. El panel tiene tope de viewport y
 * se puede desplazar, como el desplegable de cobertura.
 */
/** Exportado para el Inicio de cadenas (renderizado del grafo desactivado,
 * responsable 2026-10-06): la misma píldora desnuda de dólares acumulados + el panel. */
export function GraphCostControl({ costs }: { costs: GraphCostSummary }) {
	const [open, setOpen] = useState(false);
	// Un clic en cualquier sitio fuera (o Escape) cierra el panel — la raíz
	// envuelve botón + panel, así que el propio conmutador sigue funcionando.
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const popupLayer = usePopoverDismiss(rootRef, open, () => setOpen(false), { layerRootRef: panelRef });
	return (
		<div ref={rootRef} className="relative">
			<Hint
				// Recortado (responsable, ronda de sutileza 2026-09-25).
				label="Graph costs — click for details"
				side="bottom"
			>
				<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={`rounded-lg px-2 py-1 text-xs tabular-nums transition-colors hover:bg-accent ${
					open ? "text-foreground" : "text-muted-foreground hover:text-foreground"
				}`}
			>
				{graphUsageLabel(costs)}
			</button>
			</Hint>
			{open && (
				<div ref={panelRef} style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }} className="absolute right-0 top-full mt-2 max-h-[60vh] overflow-y-auto">
					<GraphCostPanel costs={costs} />
				</div>
			)}
		</div>
	);
}

/**
 * El panel desplegado del control de coste: totales por fase (extracción /
 * auditoría — dólares como cabecera, tokens como dato secundario) + la lista de
 * ejecuciones recientes. De presentación: el plegado ocurre en el servidor
 * (core/cost-summary.ts); los dólares se infieren al leer, nunca se guardan. El
 * nombrado de clústeres HA DESAPARECIDO del panel (ronda de ajustes del
 * responsable, 2026-09-24): las etiquetas son ahora títulos de sesión / nombres
 * de fichero, el nombrador está muerto y su gasto histórico ya no se sigue — la
 * cabecera suma solo las fases mostradas y las ejecuciones de tipo nombrado
 * nunca llegan a la lista.
 */
function GraphCostPanel({ costs }: { costs: GraphCostSummary }) {
	const stageRows: [string, GraphCostSummary["stages"]["extraction"]][] = [
		["Extraction", costs.stages.extraction],
		["Audit", costs.stages.audit],
	];
	// Las cifras mostradas salen de displayCostTotals (sin el nombrado —
	// la píldora y este panel deben coincidir).
	const { unpricedRuns } = displayCostTotals(costs);
	return (
		<div className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
			<div className="mb-2 flex items-baseline justify-between">
				<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					Graph pipeline costs
				</span>
				<span className="text-foreground tabular-nums">
					{graphUsageLabel(costs)}
					{unpricedRuns > 0 && (
						<span className="text-muted-foreground"> · {unpricedRuns} unpriced</span>
					)}
				</span>
			</div>
			<div className="flex flex-col gap-1">
				{stageRows.map(([label, stage]) => (
					<div key={label} className="flex items-baseline justify-between gap-2 text-[11px]">
						<span className="shrink-0 text-muted-foreground">{label}</span>
						<span className="min-w-0 text-right tabular-nums">
							{fmtRunCost(stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) <= 0 ? null : stage.dollars, graphProviders(stage))}
							{stage.unpricedRuns > 0 && (stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) > 0 || (stage.subscriptionRuns ?? 0) > 0) && (
								<span className="text-muted-foreground"> +{stage.unpricedRuns} unpriced</span>
							)}
							<span className="text-muted-foreground">
								{" "}
								· {fmtTokens(stage.tokens.inputTokens)} in / {fmtTokens(stage.tokens.outputTokens)} out
							</span>
						</span>
					</div>
				))}
			</div>
			<div className="mt-2 flex flex-col gap-0.5 border-t pt-2">
				{costs.runs.map((run) => (
						<div key={run.startedAt} className="flex items-baseline justify-between gap-2 text-[11px]">
							<span className="min-w-0 flex-1 truncate text-muted-foreground">
								<span className="text-foreground/70">{timeAgo(run.startedAt)}</span>{" "}
								{run.title}
								{run.merged && (
									<span className="text-muted-foreground">
										{" "}
										+{run.merged.nodes}n
									</span>
								)}
							</span>
							<span className="shrink-0 tabular-nums">{fmtRunCost(run.dollars, graphProviders(run))}{run.dollars === null && run.subscriptionRuns === 1 ? " +1 unpriced" : ""}</span>
						</div>
					))}
			</div>
		</div>
	);
}

/**
 * El engranaje de ajustes de renderizado + su panel plegable (responsable,
 * ronda 2 de la vista de grafo): su propio contenedor arriba a la derecha,
 * separado del cuadro de búsqueda y del botón de importar — hacer clic en el
 * engranaje despliega/pliega el panel, que cae bajo el botón, alineado a la
 * derecha con él.
 */
function GraphSettingsControl({
	settings,
	changeSettings,
}: {
	settings: GraphRenderSettings;
	changeSettings: (update: (cur: RenderSettings) => RenderSettings) => void;
}) {
	const [open, setOpen] = useState(false);
	// Un clic en cualquier sitio fuera (o Escape) cierra el panel (2026-09-17) —
	// la raíz envuelve botón + panel, así que el propio conmutador sigue funcionando.
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const popupLayer = usePopoverDismiss(rootRef, open, () => setOpen(false), { layerRootRef: panelRef });
	const regionTuning = settings.regions;
	const physicsTuning = settings.physics;
	return (
		<div ref={rootRef} className="relative">
			<Hint
				// Lenguaje del usuario (oleada de tooltips) — "rendering" es interno.
				label="Graph display settings"
				side="bottom"
			>
				<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={`flex size-9 items-center justify-center rounded-xl border bg-card/85 shadow-lg backdrop-blur transition-colors hover:bg-accent ${
					open ? "text-foreground" : "text-muted-foreground hover:text-foreground"
				}`}
			>
				<SettingsIcon className="size-4" />
			</button>
			</Hint>
			{open && (
				// Con tope de viewport + desplazable por dentro — el patrón exacto del
				// desplegable de cobertura (responsable, 2026-09-17): max-h mantiene un
				// suelo de espacio libre por encima del borde inferior de la ventana a cualquier altura,
				// y la columna overflow-y-auto (que además pone a cero el min-height del elemento
				// flex) se desplaza en vez de estirar la página.
				// w-72 + pr interior (responsable, 2026-09-20): la barra de scroll se
				// pegaba al contenido — el panel se ensancha para que el margen del scroll
				// tenga aire de verdad. Espaciado concéntrico: contenido -> 10px
				// (pr-2.5) -> barra de scroll -> 10px (p-2.5) -> borde del panel. La
				// barra de scroll en sí NO se mueve: sigue fija a la misma
				// distancia del borde derecho del panel.
				<div ref={panelRef} style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }} className="absolute right-0 top-full mt-2 flex max-h-[60vh] w-72 flex-col rounded-xl border bg-card/85 p-2.5 shadow-lg backdrop-blur">
					<div className="flex flex-col gap-2 overflow-y-auto pr-2.5">
							{/* Deslizadores de tamaño/zoom/región: con correspondencia de ESCALERA 0-100, paso 10 (11
							posiciones, cada valor POR DEFECTO justo en el centro, en 50, cada valor un número
							redondo — src/core/render-settings.ts). La física conserva los
							deslizadores logarítmicos de grano fino (paso 5). */}
							<SettingSlider
								label="Node size"
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.nodeSize, NODE_SIZE_LADDER)}
								display={sizeDisplay(settings.nodeSize)}
								onChange={(p) =>
									changeSettings((cur) => ({ ...cur, nodeSize: fromLadderPosition(p, NODE_SIZE_LADDER) }))}
							/>
							<SettingSlider
								label="Edge width"
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.edgeWidth, EDGE_WIDTH_LADDER)}
								display={sizeDisplay(settings.edgeWidth)}
								onChange={(p) =>
									changeSettings((cur) => ({ ...cur, edgeWidth: fromLadderPosition(p, EDGE_WIDTH_LADDER) }))}
							/>
							<SettingSlider
								label="Arrowhead size"
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.arrowLength, ARROW_LENGTH_LADDER)}
								display={sizeDisplay(settings.arrowLength)}
								onChange={(p) =>
									changeSettings((cur) => ({ ...cur, arrowLength: fromLadderPosition(p, ARROW_LENGTH_LADDER) }))}
							/>
							<SettingSlider
								label="Label size"
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.labelSize, LABEL_SIZE_LADDER)}
								display={sizeDisplay(settings.labelSize)}
								onChange={(p) =>
									changeSettings((cur) => ({ ...cur, labelSize: fromLadderPosition(p, LABEL_SIZE_LADDER) }))}
							/>
							{/* La visualización es absoluta (ratio / 0,5): «1×» es el valor por defecto, justo en el centro (responsable, 2026-10-07). */}
							<SettingSlider
								label="Labels until zoom"
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.labelZoom, LABEL_ZOOM_LADDER)}
								display={labelZoomDisplay(settings.labelZoom)}
								onChange={(p) =>
									changeSettings((cur) => ({ ...cur, labelZoom: fromLadderPosition(p, LABEL_ZOOM_LADDER) }))}
							/>
							{/* Regiones: los tintes desenfocados de los clústeres. Deslizadores + un
						desplegable de valores fijos para la resolución del mapa de bits (es una
						elección discreta, no un número libre). Persistidos en el servidor como los
						tamaños; cada extremo de rango se validó con un barrido sobre el grafo
						real. El interruptor de activación es un interruptor de CÁLCULO: desactivado se salta
						toda la construcción (salpicado/desenfoque/relectura/volcado), no solo
						el pintado. */}
						<div className="mt-1.5 flex flex-col gap-1.5 border-t pt-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
								Regions
							</span>
							<label className="flex cursor-pointer items-center justify-between text-[11px] text-muted-foreground">
								<span>Background colors</span>
								<input
									type="checkbox"
									checked={settings.regions.enabled}
									onChange={(e) =>
										changeSettings((cur) => ({
											...cur,
											regions: { ...cur.regions, enabled: e.target.checked },
										}))}
										className="accent-primary"
								/>
							</label>
							<SettingSlider
								label="Dilation"
								disabled={!regionTuning.enabled}
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(regionTuning.dilation, REGION_DILATION_LADDER)}
								display={sizeDisplay(regionTuning.dilation)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										regions: { ...cur.regions, dilation: fromLadderPosition(p, REGION_DILATION_LADDER) },
									}))}
							/>
							<SettingSlider
								label="Blur"
								disabled={!regionTuning.enabled}
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(regionTuning.blur, REGION_BLUR_LADDER)}
								display={sizeDisplay(regionTuning.blur)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										regions: { ...cur.regions, blur: fromLadderPosition(p, REGION_BLUR_LADDER) },
									}))
								}
							/>
							<SettingSlider
								label="Edge alpha"
								disabled={!regionTuning.enabled}
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(regionTuning.edgeAlpha, REGION_EDGE_ALPHA_LADDER)}
								display={sizeDisplay(regionTuning.edgeAlpha)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										regions: { ...cur.regions, edgeAlpha: fromLadderPosition(p, REGION_EDGE_ALPHA_LADDER) },
									}))}
							/>
							<label
								className={`flex items-center justify-between gap-2 text-[11px] text-muted-foreground${!regionTuning.enabled ? " opacity-40" : ""}`}
							>
								<span>Bitmap resolution</span>
								<select
									disabled={!regionTuning.enabled}
									className="rounded-md border bg-background px-1.5 py-0.5 text-xs tabular-nums text-foreground"
									value={regionTuning.bitmap}
									onChange={(e) =>
										changeSettings((cur) => ({
											...cur,
											regions: { ...cur.regions, bitmap: Number(e.target.value) },
										}))
									}
								>
									{REGION_BITMAP_OPTIONS.map((o) => (
										<option key={o} value={o}>
											{o}
										</option>
									))}
								</select>
							</label>
							{/* Las etiquetas de clúster se trajeron aquí el 2026-09-16 (usuario: lo de
							los clústeres vive en la sección de regiones). Desacopladas del
							interruptor Background colors de arriba — las etiquetas siguen
							su propio conmutador clusterLabels. El tamaño es en px de pantalla
							(constante con cualquier zoom, a diferencia de las etiquetas de nodo). */}
							<label className="flex cursor-pointer items-center justify-between text-[11px] text-muted-foreground">
								<span>Cluster labels</span>
								<input
									type="checkbox"
									checked={settings.clusterLabels}
									onChange={(e) => changeSettings((cur) => ({ ...cur, clusterLabels: e.target.checked }))}
									className="accent-primary"
								/>
							</label>
							<SettingSlider
								label="Cluster label size"
								disabled={!settings.clusterLabels}
								min={0}
								max={100}
								step={10}
								value={toLadderPosition(settings.clusterLabelSize, CLUSTER_LABEL_SIZE_LADDER)}
								display={sizeDisplay(settings.clusterLabelSize)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										clusterLabelSize: fromLadderPosition(p, CLUSTER_LABEL_SIZE_LADDER),
									}))}
							/>
						</div>
						{/* Física: las fuerzas de la simulación viva. Cada valor alimenta el MISMO
						motor que ejecuta el asentamiento del servidor (createGraphSimulation);
						cambiar uno reconstruye la simulación desde las posiciones actuales —
						arrastrar a mitad de asentamiento vuelve a recocer, las fijaciones sobreviven. Deslizadores sobre
						rangos validados con barridos (src/core/render-settings.ts):
						los extremos de rango y las cuatro esquinas se asientan limpiamente — sin NaN,
						sin explosiones, sin quedarse sin asentar. La repulsión se muestra como
						el negativo que es; el extremo izquierdo de la atracción del clúster = desactivada.
						Orden (usuario 2026-09-17): primero las fuerzas generales; el ancla
						de profundidad + sus controles que pueden quedar en gris, al final. */}
						<div className="mt-1.5 flex flex-col gap-1.5 border-t pt-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
								Physics
							</span>
							<SettingSlider
								label="Node repulsion"
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(-physicsTuning.chargeStrength, -CHARGE_RANGE.max, -CHARGE_RANGE.min)}
								display={`-${Math.round(-physicsTuning.chargeStrength)}`}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, chargeStrength: -fromSliderPosition(p, -CHARGE_RANGE.max, -CHARGE_RANGE.min) },
									}))}
							/>
							<SettingSlider
								label="Edge attraction"
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.linkStrength, LINK_STRENGTH_RANGE.min, LINK_STRENGTH_RANGE.max)}
								display={sizeDisplay(physicsTuning.linkStrength)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, linkStrength: fromSliderPosition(p, LINK_STRENGTH_RANGE.min, LINK_STRENGTH_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Edge length"
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.linkDistance, LINK_DISTANCE_RANGE.min, LINK_DISTANCE_RANGE.max)}
								display={sizeDisplay(physicsTuning.linkDistance)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, linkDistance: fromSliderPosition(p, LINK_DISTANCE_RANGE.min, LINK_DISTANCE_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Central pull"
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.gravity, GRAVITY_RANGE.min, GRAVITY_RANGE.max)}
								display={sizeDisplay(physicsTuning.gravity)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, gravity: fromSliderPosition(p, GRAVITY_RANGE.min, GRAVITY_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Cluster pull"
								min={0}
								max={100}
								step={5}
								value={toOffSliderPosition(physicsTuning.clusterPull, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max)}
								display={physicsTuning.clusterPull <= 0 ? "off" : sizeDisplay(physicsTuning.clusterPull)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, clusterPull: fromOffSliderPosition(p, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Friction"
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.velocityDecay, VELOCITY_DECAY_RANGE.min, VELOCITY_DECAY_RANGE.max)}
								display={sizeDisplay(physicsTuning.velocityDecay)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, velocityDecay: fromSliderPosition(p, VELOCITY_DECAY_RANGE.min, VELOCITY_DECAY_RANGE.max) },
									}))}
							/>
							{/* El ancla de profundidad AL FINAL (usuario 2026-09-17): primero las
							fuerzas generales y después el modo + sus controles
							condicionales abajo del todo — el grupo en gris se lee
							como una subsección autónoma. */}
							<label className="flex items-center justify-between gap-2 text-xs">
								Depth anchor
								<select
									className="rounded border bg-background px-1 py-0.5 text-xs"
									value={physicsTuning.depthMode}
									onChange={(e) =>
										changeSettings((cur) => ({
											...cur,
											physics: { ...cur.physics, depthMode: e.target.value as GraphRenderSettings["physics"]["depthMode"] },
										}))
									}
								>
									<option value="off">Off</option>
									<option value="vertical">Vertical (up)</option>
									<option value="radial">Radial (outward)</option>
								</select>
							</label>
							<SettingSlider
								label="Depth strength"
								disabled={physicsTuning.depthMode === "off"}
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.depthStrength, DEPTH_STRENGTH_RANGE.min, DEPTH_STRENGTH_RANGE.max)}
								display={sizeDisplay(physicsTuning.depthStrength)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, depthStrength: fromSliderPosition(p, DEPTH_STRENGTH_RANGE.min, DEPTH_STRENGTH_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Depth spacing"
								disabled={physicsTuning.depthMode === "off"}
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.depthSpacing, DEPTH_SPACING_RANGE.min, DEPTH_SPACING_RANGE.max)}
								display={sizeDisplay(physicsTuning.depthSpacing)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, depthSpacing: fromSliderPosition(p, DEPTH_SPACING_RANGE.min, DEPTH_SPACING_RANGE.max) },
									}))}
							/>
							<SettingSlider
								label="Base ring radius"
								disabled={physicsTuning.depthMode !== "radial"}
								min={0}
								max={100}
								step={5}
								value={toSliderPosition(physicsTuning.depthBaseRadius, DEPTH_BASE_RADIUS_RANGE.min, DEPTH_BASE_RADIUS_RANGE.max)}
								display={sizeDisplay(physicsTuning.depthBaseRadius)}
								onChange={(p) =>
									changeSettings((cur) => ({
										...cur,
										physics: { ...cur.physics, depthBaseRadius: fromSliderPosition(p, DEPTH_BASE_RADIUS_RANGE.min, DEPTH_BASE_RADIUS_RANGE.max) },
									}))}
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/** El cuerpo de la fila de acciones del cromo superior (oleada del cromo del
 *  grafo vacío, responsable 2026-09-25): Import Notes se renderiza SIEMPRE (con
 *  el grafo activado) — es la única acción que funciona con un grafo vacío, el
 *  propio punto de entrada; la búsqueda + los ajustes solo se renderizan cuando
 *  la instantánea tiene nodos (los controles muertos son mentiras — el principio
 *  de honestidad). Los dos controles con barrera aparecen con un fundido al
 *  montarse (graph-chrome-fade-in, globals.css — la transición de aparecer una
 *  vez cuando llegan los primeros nodos). Exportado como función pura para las
 *  fijaciones SSR de vacío/poblado (el patrón de DeleteNodeBody). */
export function GraphChromeRow({
	isEmpty,
	query,
	onQuery,
	noMatch,
	importing,
	searchInputRef,
	onImportFiles,
	settings,
	changeSettings,
	onOpenChains,
}: {
	isEmpty: boolean;
	query: string;
	onQuery: (v: string) => void;
	/** La nota "No matching nodes." del panel de búsqueda (la calcula el
	 *  envoltorio — es responsable de visibleIds + la instantánea). */
	noMatch: boolean;
	importing: boolean;
	searchInputRef: React.RefObject<HTMLInputElement | null>;
	onImportFiles: (files: FileList | null) => void;
	settings: GraphRenderSettings;
	changeSettings: (update: (cur: RenderSettings) => RenderSettings) => void;
	/** Abre el overlay de la tabla de cadenas (el plan del overlay de cadenas,
	 *  2026-09-29). */
	onOpenChains: () => void;
}) {
	return (
		<>
			{!isEmpty && (
				<div className="graph-chrome-fade-in w-56 min-w-0 shrink rounded-xl border bg-card/85 px-1 py-[3px] shadow-lg backdrop-blur">
					<Hint
						// ⌘F enfoca la búsqueda de nodos (acción del registro con ámbito de superficie).
						label="Search nodes"
						action="find"
						side="bottom"
					>
					<div className="relative">
						<SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<input
							ref={searchInputRef}
							value={query}
							onChange={(e) => onQuery(e.target.value)}
							placeholder="Search nodes…"
							aria-label="Search nodes"
							spellCheck={false}
							className="h-7 w-full rounded-lg border bg-background pl-8 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
						/>
					</div>
					</Hint>
					{noMatch && (
						<div className="px-1.5 pt-1 text-[11px] text-muted-foreground">No matching nodes.</div>
					)}
				</div>
			)}
			{/* La tabla de cadenas (overlay de cadenas, plan del responsable 2026-09-29). Su
			propio contenedor (franja de 36px), entre la búsqueda e Import. */}
			<div className="graph-chrome-fade-in shrink-0 rounded-xl border bg-card/85 px-1 py-[3px] shadow-lg backdrop-blur">
					<Hint label="Every reasoning chain" side="bottom">
						<button
							type="button"
							onClick={onOpenChains}
							data-testid="open-chain-table"
							className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
						>
							<ListTreeIcon className="size-3" />
							Chains
						</button>
					</Hint>
				</div>
			{/* Importar notas — su propio contenedor (36px, franja de cabecera); SIEMPRE
			renderizado (la decisión del grafo vacío de arriba — el punto de entrada). */}
			<NotesImportControl importing={importing} onImportFiles={onImportFiles} />
			{!isEmpty && (
				// Ajustes de renderizado — componente propio; el engranaje lo conmuta. El
				// engranaje está en el extremo derecho (responsable, ronda 3) para que su panel caiga
				// en el borde derecho del todo, tapando menos grafo. El envoltorio del fundido
				// es un hijo flex shrink-0 normal — el propio panel se posiciona
				// dentro de la raíz relativa de GraphSettingsControl, sin verse afectado.
				<div className="graph-chrome-fade-in shrink-0">
					<GraphSettingsControl settings={settings} changeSettings={changeSettings} />
				</div>
			)}
		</>
	);
}

export function GraphView({
	chainSelectOpen = false,
	practiceSelection,
	onPracticeSelectionChange,
	onChainSelectClose,
}: {
	/** SELECCIÓN PARA PRÁCTICA (visión del responsable, 2026-10-04): el conjunto
	 *  elegido ELEVADO y persistente — cada marcar/limpiar en la tabla de cadenas (se
	 *  abra como se abra) comunica hacia arriba la lista completa de nodos de
	 *  inmediato; el chip del lado del compositor lo refleja en vivo. chainSelectOpen
	 *  sigue dirigiendo el modo selector (Done en lugar de Delete). */
	chainSelectOpen?: boolean;
	practiceSelection?: ReadonlySet<string>;
	onPracticeSelectionChange?: (nodes: { id: string; name: string; statement: string }[]) => void;
	onChainSelectClose?: () => void;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const interactions = useInteractionLayers();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);
	const { resolvedMode, colors } = useAppearance();
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
	const [selected, setSelected] = useState<Selection | null>(null);
	// La última instantánea para los callbacks de clic del renderizador (se
	// construyen una vez, así que leen a través de esta ref, nunca de un closure).
	const snapshotRef = useRef<GraphSnapshot | null>(null);
	snapshotRef.current = snapshot;

	// Estado del panel de búsqueda: el texto de la consulta + el conmutador de la sección de ajustes.
	const [query, setQuery] = useState("");
	// Find con ámbito de superficie: el overlay de cadenas lo tiene mientras está abierto.
	const searchInputRef = useRef<HTMLInputElement>(null);
	// Ajustes de renderizado: persistidos en el SERVIDOR (data/render-settings.json mediante
	// /api/graph/render-settings) — los tamaños Y las secciones de región/física
	// (de cara al usuario desde el 2026-09-13; la época de la sesión de desarrollo terminó). Se cargan
	// una vez tras el montaje; cada cambio del usuario se guarda de vuelta, con debounce. Los valores
	// por defecto se renderizan hasta que se resuelve la carga — una fracción de segundo como mucho.
	const [settings, setSettings] = useState<GraphRenderSettings>(DEFAULT_RENDER_SETTINGS);
	// Las dos secciones anidadas, desempaquetadas para los efectos de alimentación del
	// renderizador de más abajo (los mismos nombres que tenía el antiguo estado de sesión).
	const regionTuning = settings.regions;
	const physicsTuning = settings.physics;
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	// True en cuanto el usuario ha movido un control en este montaje: la copia del servidor
	// nunca debe machacar un cambio local (posiblemente más nuevo).
	const userTouched = useRef(false);
	// True en cuanto se asentó el GET inicial — hasta entonces se retienen los guardados,
	// para que montar sin más nunca envíe con PUT los valores por defecto encima de la copia del servidor.
	const serverLoaded = useRef(false);
	const savePending = useRef(false);
	const changeSettings = (update: (cur: RenderSettings) => RenderSettings) => {
		userTouched.current = true;
		setSettings(update);
	};
	const saveToServer = (s: RenderSettings) => {
		fetch("/api/graph/render-settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(s),
		}).catch((err) => console.error("[graph] settings save failed:", err));
	};
	useEffect(() => {
		fetch("/api/graph/render-settings")
			.then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
			.then((raw) => {
				// Aplica solo si el usuario no ha movido ya un deslizador —
				// si se adelantó a la red, gana su cambio.
				if (raw !== null && !userTouched.current) setSettings(sanitizeRenderSettings(raw));
			})
			.catch(() => {
				// servidor inalcanzable → los valores por defecto en memoria siguen funcionando
			})
			.finally(() => {
				serverLoaded.current = true;
				// Se retuvo un cambio hecho durante la lectura — envíalo ahora.
				if (savePending.current) {
					savePending.current = false;
					saveToServer(settingsRef.current);
				}
			});
	}, []);
	useEffect(() => {
		if (!userTouched.current) return; // ejecución al montar / aplicación del servidor: no se guarda
		if (!serverLoaded.current) {
			savePending.current = true; // espera a que se asiente el GET
			return;
		}
		const id = setTimeout(() => saveToServer(settings), 400);
		return () => clearTimeout(id);
	}, [settings]);

	// La instancia del renderizador sobrevive a las relecturas de la instantánea y a los cambios
	// de ajustes (ninguno de los dos reinicia su cámara); `posRef` saca el
	// layout congelado del efecto de layout.
	const rendererRef = useRef<GraphCanvasRenderer | null>(null);
	const posRef = useRef<Map<string, { x: number; y: number }> | null>(null);

	// El conjunto de ids que sobrevive a la búsqueda actual — lo consumen el
	// feed de visibilidad y la pista de "no matches".
	const visibleIds = useMemo(() => {
		const set = new Set<string>();
		if (snapshot)
			for (const node of snapshot.nodes) {
				if (isNodeVisible(node, query)) set.add(node.id);
			}
		return set;
	}, [snapshot, query]);

	// Lee el grafo derivado. Se vuelve a ejecutar cuando termina una ejecución del proceso en
	// segundo plano (refreshTick) — sus fusiones acaban de llegar al registro.
	const [refreshTick, setRefreshTick] = useState(0);
	// El overlay de la tabla de cadenas (plan del overlay de cadenas, 2026-09-29) —
	// local al componente: una superficie para explorar, no estado del grafo.
	const [chainsOpen, setChainsOpen] = useState(false);
	useEffect(() => {
		if (chainsOpen) return;
		const onFind = () => { if (isInteractionScopeEligible(searchInputRef.current, interactions)) searchInputRef.current?.focus(); };
		window.addEventListener("lh:kbd-find", onFind);
		return () => window.removeEventListener("lh:kbd-find", onFind);
	}, [chainsOpen, interactions]);
	// SELECCIÓN PARA PRÁCTICA (2026-10-04): el chip del padre dirige el modo de
	// selección; al cerrar (con la confirmación del selector o con su X) se comunica de vuelta para que
	// el estado abierto del chip y el de la tabla nunca discrepen.
	useEffect(() => {
		if (chainSelectOpen) setChainsOpen(true);
	}, [chainSelectOpen]);
	useEffect(() => {
		let cancelled = false;
		fetch("/api/graph")
			.then((res) => res.json() as Promise<GraphSnapshot>)
			.then((data) => {
				if (!cancelled) setSnapshot(data);
			})
			.catch((err) => console.error("[graph] fetch failed:", err));
		return () => {
			cancelled = true;
		};
	}, [refreshTick]);

	// Importación de notas (la puerta de entrada independiente del formato): selector de ficheros → POST
	// /api/graph/import; las ejecuciones aparecen en los chips de estado de más abajo, y el
	// grafo se vuelve a leer cuando terminan (la transición a ejecuciones vacías).
	// El empujón del sitio de inicio del dock (oleada de precisión, 2026-09-19): el POST de
	// importación espera a TODO el proceso en el servidor, así que la ejecución se registra mucho
	// antes de la respuesta — empuja al hacer clic y otra vez a los +600 ms para atrapar el
	// inicio; desde su primer setPhase la ejecución se anuncia a sí misma en el canal
	// de eventos (S5), y a partir de ahí el dock va con esos anuncios.
	const refreshActivity = useActivity().refresh;
	const notesImport = useNotesImport({
		onStart: () => {
			refreshActivity();
			setTimeout(() => refreshActivity(), 600);
		},
	});
	const { importing, onImportFiles } = notesImport;

	// Estado del proceso en segundo plano: lee /api/graph/status; siempre que una ejecución
	// SALE del feed (terminada / abortada / fallida), vuelve a leer el grafo.
	// Una ejecución solo sale del registro después de que terminen su fusión + asentamiento + persistencia
	// del uso, así que su desaparición ⇒ el cambio del grafo ya está en
	// disco. La antigua transición de alguna→ninguna agrupaba las ejecuciones PARALELAS en una sola
	// revelación (responsable 2026-09-28): con las auditorías serializadas, la fusión de la primera ejecución
	// es su propio cambio del grafo y debe aparecer de inmediato, no esperar
	// a que se vacíe todo el feed. Una lectura redundante con las ejecuciones abortadas sale
	// gratis — la misma doctrina que la ruta de refresco por borrado de más abajo.
	// Se sigue por id de FILA (la clave de TAREA del registro — id de origen, o "src#i" para
	// las tareas por fragmento), NO por chatId: el ámbito por chatId volvía a agrupar las tareas por fragmento
	// en una única revelación al final de la importación (el fallo exacto que esta regla existe para
	// evitar — que la fila de un fragmento salga ES que llega su fusión).
	const [pipelineRuns, setPipelineRuns] = useState<{ id: string; chatId: string; title: string; phase: string; startedAt: number }[]>([]);
	const rowIdsRef = useRef<Set<string>>(new Set());
	const readPipelineStatus = useCallback(() => {
		fetch("/api/graph/status")
			.then((res) => res.json() as Promise<{ runs: typeof pipelineRuns }>)
			.then(({ runs }) => {
				setPipelineRuns(runs);
				const ids = new Set(runs.map((r) => r.id));
				if ([...rowIdsRef.current].some((id) => !ids.has(id))) setRefreshTick((t) => t + 1);
				rowIdsRef.current = ids;
			})
			.catch(() => {}); // el estado es cosmético — nunca muestres los errores de lectura
	}, []);
	// PUSH (S7, 2026-10-02): el sondeo permanente de 2 s está RETIRADO — el
	// registro de extracción anuncia cada transición de fase y cada
	// final (activity-changed), así que cada lectura llega justo cuando se movió
	// la verdad. La semántica de revelación por fragmento se CONSERVA evento a evento:
	// setPhase + finishExtraction se disparan por parte, así que la salida de la fila de un fragmento
	// sigue siendo su propia fusión, visible de inmediato. Con debounce (la
	// ley de S4); la resincronización repara una reconexión que se comió eventos.
	const statusDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useServerEvent("activity-changed", () => {
		if (statusDebounceRef.current) clearTimeout(statusDebounceRef.current);
		statusDebounceRef.current = setTimeout(() => {
			statusDebounceRef.current = undefined;
			readPipelineStatus();
		}, 250);
	});
	useServerResync(() => readPipelineStatus());
	useEffect(() => {
		readPipelineStatus();
		return () => {
			if (statusDebounceRef.current) clearTimeout(statusDebounceRef.current);
		};
	}, [readPipelineStatus]);

	// Costes del proceso del grafo (oleada de métricas de coste de 2026-09): el plegado acumulado
	// de los canales de uso (ejecuciones de extracción de chat + notas; el canal del nombrador
	// muerto ya no se muestra, responsable 2026-09-24)
	// detrás de la píldora de coste de abajo a la izquierda. Se lee una vez al montar y se vuelve a leer
	// cuando termina una ejecución del proceso (en ejecución -> ninguna) para que el gasto nuevo llegue
	// sin recargar a mano. En la medida de lo posible: un fallo de lectura nunca bloquea
	// la vista — la píldora simplemente se queda con sus últimas cifras.
	const [costs, setCosts] = useState<GraphCostSummary | null>(null);
	const refreshCosts = useCallback(() => {
		fetch("/api/graph/costs")
			.then((res) => res.json() as Promise<GraphCostSummary>)
			.then(setCosts)
			.catch(() => {});
	}, []);
	useEffect(() => {
		refreshCosts();
	}, [refreshCosts]);
	// La misma regla de desaparición que el refresco de la instantánea (responsable
	// 2026-09-28): el uso se persiste por TAREA (tareas por fragmento), así que los costes se refrescan
	// por fila de tarea — no solo cuando se vacía todo el feed.
	const prevRunIds = useRef(new Set<string>());
	useEffect(() => {
		const gone = [...prevRunIds.current].some((id) => !pipelineRuns.some((r) => r.id === id));
		if (gone && prevRunIds.current.size > 0) refreshCosts();
		prevRunIds.current = new Set(pipelineRuns.map((r) => r.id));
	}, [pipelineRuns, refreshCosts]);

	/* Refresco por borrado (oleada 6, fragmento A): la respuesta de DELETE /api/chats/:id
	lleva la nueva graphRevision, y la barra lateral (responsable del flujo de
	borrado) la anuncia como lh:graph-revision. El sondeo de estado de arriba no puede
	ver un borrado — ninguna ejecución del proceso desaparece nunca del feed por
	ello —, así que este evento es la única frontera. Vuelve a leer la instantánea y los
	costes con cada anuncio: los borrados son raros, una lectura redundante
	sale gratis. */
	useEffect(() => {
		const onRevision = () => {
			setRefreshTick((t) => t + 1);
			refreshCosts();
		};
		window.addEventListener("lh:graph-revision", onRevision);
		return () => window.removeEventListener("lh:graph-revision", onRevision);
	}, [refreshCosts]);

	/* Etiquetas vivas al renombrar (arreglo de la mezcla al renombrar, 2026-09-23): el
	renombrado de una sesión en cualquier sitio (fila en línea de la barra lateral, cabecera del chat) se anuncia
	como lh:chat-renamed {id, title} — y la partición por sesión de nacimiento
	significa que ese título ES la etiqueta del clúster. La actualización de la etiqueta pasa
	por el canal solo de etiquetas del renderizador (setClusterLabels): NADA de
	objeto de instantánea nuevo, NADA de setData, NADA de reconstrucción de la geometría — así que el
	registro de posiciones no puede imponerse y una confirmación de arrastre pendiente
	sobrevive. El mapa de sesiones (la línea de procedencia de la tarjeta de detalle)
	se parchea en su sitio; un incremento del tick vuelve a renderizar la vista para que una tarjeta de
	detalle abierta lea el título nuevo. Los clústeres sin etiqueta conservan su
	silencio de solo envolvente — la guarda de la etiqueta null vive en el canal
	(applyClusterLabels): un renombrado no puede alcanzar un registro desaparecido. */
	const [, setLabelTick] = useState(0);
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id?: string; title?: string }>).detail ?? {};
			if (typeof id !== "string" || typeof title !== "string" || id === "" || title === "") return;
			const snap = snapshotRef.current;
			if (snap != null) renameSessionsPatch(snap, id, title);
			rendererRef.current?.setClusterLabels(new Map([[id, title]]));
			setLabelTick((t) => t + 1);
		};
		const onSourceRenamed = (event: Event) => {
			const { id, title } = (event as CustomEvent<{ id?: string; title?: string }>).detail ?? {};
			if (typeof id !== "string" || typeof title !== "string") return;
			// Canal solo de etiquetas: nunca reconstruyas la geometría ni reescribas fileSources.
			rendererRef.current?.setClusterLabels(new Map([[id, title]]));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		window.addEventListener("lh:source-renamed", onSourceRenamed);
		return () => { window.removeEventListener("lh:chat-renamed", onRenamed); window.removeEventListener("lh:source-renamed", onSourceRenamed); };
	}, []);

	// El menú contextual de los nodos (interludio de nodos): clic derecho en un nodo → Delete.
	// El ancla es un div de tamaño cero colocado en el puntero dentro del
	// contenedor del canvas — la máquina de colocación de MenuShell lo mide como
	// cualquier elemento. Los movimientos de cámara cierran el menú (quedaría flotando obsoleto);
	// el contrato de cierre es el de la barra lateral (oleada 6).
	const [ctxNode, setCtxNode] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
	const ctxAnchorRef = useRef<HTMLDivElement | null>(null);
	const [deletingNode, setDeletingNode] = useState<{ id: string; name: string } | null>(null);
	useEffect(() => {
		if (ctxNode === null) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>('[data-testid="node-context-menu"]'))) return;
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (ctxAnchorRef.current?.contains(target)) return;
			setCtxNode(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [ctxNode, interactions]);

	// Layout (opción A): el registro de posiciones (que escribe el asentamiento
	// incremental del servidor tras cada fusión) ES el layout — el renderizador
	// lo recibe como datos congelados. La pasada local única de forceAtlas2 se ejecuta
	// SOLO como alternativa cuando falta el registro (un grafo nunca fusionado
	// a través del proceso, p. ej. pruebas o una instalación nueva).
	useEffect(() => {
		if (!snapshot || snapshot.nodes.length === 0) return;
		// La ruta del registro: cada nodo con posición usa su posición de reposo;
		// los nodos que el registro aún no conoce (en carrera a mitad de asentamiento) pasan
		// a la dispersión con semilla de más abajo.
		const ledger = snapshot.positions;
		if (ledger) {
			const positions = new Map<string, { x: number; y: number }>();
			for (const node of snapshot.nodes) {
				const p = ledger[node.id];
				if (p) positions.set(node.id, { x: p.x, y: p.y });
			}
			if (positions.size > 0) {
				// Higiene (oleada de arreglos del 2026-09-23): los nodos que el registro aún no
				// conoce (en carrera a mitad de asentamiento) reciben posiciones de anillo con semilla en vez de
				// amontonarse en el origen con el antiguo ?? 0.
				posRef.current = seedMissingNodePositions(snapshot.nodes, positions);
				return () => {
					posRef.current = null;
				};
			}
		}
		// Alternativa de arranque: falta el registro (grafo nuevo) — ejecuta
		// el MISMO motor que usa el asentamiento del servidor (d3-force mediante
		// incrementalLayout, determinista con semilla) y congela el resultado.
		// Determinista para un conjunto de nodos dado entre remontajes.
		posRef.current = incrementalLayout(snapshot.nodes, snapshot.edges, new Map());
		return () => {
			posRef.current = null;
		};
	}, [snapshot]);

	// Construye el renderizador en cuanto existe el canvas; destrúyelo cuando
	// desaparezca (el provisional del grafo vacío lo sustituye). Los callbacks se
	// crean una vez y leen a través de refs, así que nunca quedan obsoletos.
	const isEmpty = snapshot === null || snapshot.nodes.length === 0;
	useEffect(() => {
		if (isEmpty) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		// Cámara persistida (2026-09-15): el grafo se reabre exactamente donde lo
		// dejó el usuario — zoom Y desplazamiento, en localStorage (estado de la vista por dispositivo,
		// a propósito NO en el registro de ajustes del servidor). Ausente o
		// corrupta → undefined → el renderizador encaja en la primera apertura, de todas las que haya.
		let initialCamera: { k: number; x: number; y: number } | null = null;
		try {
			const stored = localStorage.getItem(CAMERA_STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored) as { k?: unknown; x?: unknown; y?: unknown };
				if (
					typeof parsed.k === "number" && Number.isFinite(parsed.k) && parsed.k > 0 &&
					typeof parsed.x === "number" && Number.isFinite(parsed.x) &&
					typeof parsed.y === "number" && Number.isFinite(parsed.y)
				)
					initialCamera = { k: parsed.k, x: parsed.x, y: parsed.y };
			}
		} catch {
			// Entrada corrupta → se trata como ausente; el renderizador encaja.
		}
		// Escrituras de la cámara con debounce: un desplazamiento emite cientos de transformaciones por
		// segundo; con una escritura final por cada momento de calma basta y sobra.
		let cameraTimer: ReturnType<typeof setTimeout> | null = null;
		let lastCamera: { k: number; x: number; y: number } | null = null;
		const persistCamera = (t: { k: number; x: number; y: number }) => {
			lastCamera = t;
			if (cameraTimer) clearTimeout(cameraTimer);
			cameraTimer = setTimeout(() => {
				cameraTimer = null;
				try {
					localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(t));
				} catch {
					// Almacenamiento lleno/bloqueado: la persistencia de la cámara es en la medida de lo posible.
				}
			}, 250);
		};
		const renderer = new GraphCanvasRenderer(
			canvas,
			{
				onSelect: (nodeId, pos) => {
					const snap = snapshotRef.current;
					const node = snap?.nodes.find((n) => n.id === nodeId);
					if (!snap || !node) return;
					setSelected({
						node,
						sourceIds: snap.nodeSessions[node.id] ?? [],
						anchor: pos,
					});
				},
				onStageClick: () => setSelected(null),
				// Clic derecho → el menú contextual del nodo (interludio de nodos). Null
				// (escenario vacío) cierra un menú obsoleto; una selección abre uno anclado
				// en el puntero. El nombre sale de la instantánea — lo que muestra el
				// canvas es lo que dicen el menú y el diálogo.
				onContext: (nodeId, pos) => {
					if (nodeId === null) {
						setCtxNode(null);
						return;
					}
					const node = snapshotRef.current?.nodes.find((n) => n.id === nodeId);
					if (!node) return;
					setCtxNode({ id: node.id, name: node.name, x: pos.x, y: pos.y });
				},
				// Cualquier movimiento de cámara despega la tarjeta de su nodo — ciérrala
				// y (con debounce) recuerda dónde está la cámara. El
				// menú contextual se cierra con ella: un menú flotando sobre un grafo
				// movido no está anclado a nada.
				onCameraMove: (t) => {
					setSelected(null);
					setCtxNode(null);
					persistCamera(t);
				},
				// La física viva se asentó: persiste el nuevo estado de reposo. Disparar y
				// olvidar — la siguiente lectura de la instantánea trae el registro de todos modos.
				onCommit: (positions) => {
					void fetch("/api/graph/positions", {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(positions),
					}).catch((err) => console.error("[graph] positions commit failed", err));
				},
			},
			initialCamera,
		);
		rendererRef.current = renderer;
		return () => {
			rendererRef.current = null;
			// Vuelca una escritura de cámara pendiente para que un desmontaje <250 ms después de un
			// movimiento siga persistiendo la última posición del usuario.
			if (cameraTimer && lastCamera) {
				clearTimeout(cameraTimer);
				cameraTimer = null;
				try {
					localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(lastCamera));
				} catch {
					// en la medida de lo posible
				}
			}
			renderer.destroy();
		};
	}, [isEmpty]);

	// Feed n.º 1 — datos: posiciones + aristas + clústeres + colores resueltos. Se ejecuta
	// después del efecto de layout (el mismo commit, orden de declaración) y después
	// del efecto de construcción, así que el renderizador existe y las posiciones están frescas.
	// Los cambios de paleta (incluidos los cambios de tema en el mismo modo y las sustituciones)
	// deben refrescar el pintado capturado del canvas, no solo el CSS del DOM. El
	// proveedor aplica los tokens en un efecto de layout antes de este feed pasivo.
	useEffect(() => {
		const renderer = rendererRef.current;
		const positions = posRef.current;
		if (!renderer || !snapshot || snapshot.nodes.length === 0 || !positions) return;
		renderer.setData({
			nodes: snapshot.nodes.map((n) => ({
				id: n.id,
				x: positions.get(n.id)?.x ?? 0,
				y: positions.get(n.id)?.y ?? 0,
				label: n.name,
			})),
			edges: snapshot.edges.map((e) => ({ from: e.from, to: e.to })),
			logicalEdges: snapshot.logicalEdges.map((e) => ({ from: e.from, to: e.to })),
			impLinks: snapshot.impLinks,
			clusters: snapshot.clusters.map((c) => ({ id: c.id, label: c.label, members: c.members })),
			colors: {
				node: tokenHex(NODE_COLOR_TOKEN),
				edge: tokenHex("--muted-foreground"),
				label: tokenHex("--muted-foreground"),
				hoverText: tokenHex("--foreground"),
				clusterLightness: CLUSTER_LIGHTNESS[resolvedMode],
			},
			// Coincide con la tipografía de la app (Geist mediante la pila del body).
			fontFamily: getComputedStyle(document.body).fontFamily,
		});
	}, [snapshot, isEmpty, resolvedMode, colors]);

	// Feed n.º 2 — ajustes: solo marca el fotograma como sucio. Sin reconstrucción,
	// sin nuevo layout, sin tocar la cámara (todo el sentido del nuevo renderizador).
	const deferredSettings = useDeferredValue(settings);
	useEffect(() => {
		rendererRef.current?.setSettings(deferredSettings);
	}, [deferredSettings, isEmpty]);

	// Feed n.º 3 — visibilidad: los nodos ocultos salen del renderizado, la selección,
	// el hover Y las etiquetas; las aristas salen cuando cualquiera de sus extremos está oculto.
	useEffect(() => {
		rendererRef.current?.setVisible(query.trim() ? visibleIds : null);
		// La tarjeta de detalle abierta no puede sobrevivir a la visibilidad de su nodo.
		setSelected((sel) => (sel && visibleIds.has(sel.node.id) ? sel : null));
	}, [visibleIds, query]);

	// Feed n.º 4 — ajuste de las regiones. `isEmpty` en las dependencias (igual que el feed n.º 2):
	// la lectura de los ajustes se resuelve ANTES de que la instantánea cree el renderizador,
	// así que la ejecución en la carga da con un renderizador null y nunca volvería a dispararse —
	// el renderizador se quedaría en silencio con el ajuste por defecto para siempre.
	useEffect(() => {
		rendererRef.current?.setRegionTuning(regionTuning);
	}, [regionTuning, isEmpty]);

	// Feed n.º 5 — ajuste de la física: reconstruye la simulación viva en su sitio (las fijaciones de arrastre
	// sobreviven; un cambio a mitad de asentamiento vuelve a recocer, la respuesta honesta). La misma
	// dependencia isEmpty que el feed n.º 4 — ver allí.
	useEffect(() => {
		rendererRef.current?.setPhysicsTuning(physicsTuning);
	}, [physicsTuning, isEmpty]);

	// Coloca la tarjeta de detalle: bajo el nodo en el que se hizo clic, dada la vuelta hacia arriba cerca
	// del borde inferior, acotada en horizontal. Imperativo (ref + efecto de layout,
	// antes de pintar) porque darle la vuelta necesita la altura medida de la tarjeta.
	useLayoutEffect(() => {
		const card = cardRef.current;
		const container = containerRef.current;
		if (!selected || !card || !container) return;
		const width = card.offsetWidth;
		const height = card.offsetHeight;
		const margin = 8;
		const gap = 12;
		const left = Math.min(
			Math.max(selected.anchor.x - width / 2, margin),
			Math.max(container.clientWidth - width - margin, margin),
		);
		let top = selected.anchor.y + gap;
		if (top + height > container.clientHeight - margin) {
			top = Math.max(selected.anchor.y - gap - height, margin);
		}
		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
		card.style.visibility = "visible";
	}, [selected]);

	return (
		<div className="relative h-full w-full">
			{isEmpty ? (
				// El grafo vacío deja clara la primera acción sin estadísticas a cero.
				<div className="flex h-full w-full items-center justify-center px-4">
					<div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
						<WaypointsIcon className="size-10 opacity-40" strokeWidth={1.25} />
						<div className="text-lg font-medium text-foreground">Knowledge graph</div>
						<div className="max-w-sm text-sm">
							<p>Start a session to begin learning.</p>
							<p className="mt-1 text-xs">Attach your material with the paperclip or drag and drop.</p>
						</div>
					</div>
				</div>
			) : (
				<div ref={containerRef} className="relative h-full w-full">
					{/* EL único canvas: todas las capas (envolventes, aristas, nodos, los dos
					sistemas de etiquetas, hover) se dibujan en él, una vez por fotograma. */}
					<canvas ref={canvasRef} className="block h-full w-full touch-none" />
					{/* El ancla del menú contextual: un punto de tamaño cero en la
					posición del clic derecho (relativa al canvas == relativa al contenedor;
					el canvas llena este div). */}
					{ctxNode !== null && (
						<div
							ref={ctxAnchorRef}
							style={{ position: "absolute", left: ctxNode.x, top: ctxNode.y, width: 0, height: 0 }}
						/>
					)}
				</div>
			)}

			{/* El menú contextual de los nodos (interludio de nodos): Delete es su única acción
			(la misma disciplina de MenuShell que el menú de sesión de la barra lateral —
			colocación, foco, recorrido con flechas; el efecto de cierre de arriba es responsable
			del contrato). */}
			{ctxNode !== null && (
				<MenuShell
					anchorRef={ctxAnchorRef}
					onClose={() => { setCtxNode(null); return "closed"; }}
					testid="node-context-menu"
					preferredSide="down"
					menuClass="flex w-fit flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<button
						type="button"
						data-testid="ctx-node-delete"
						onClick={() => {
							setDeletingNode({ id: ctxNode.id, name: ctxNode.name });
							setCtxNode(null);
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
					>
						Delete
					</button>
				</MenuShell>
			)}

			{/* El diálogo de confirmación de muerte completa (interludio de nodos) — el propio
			componente lo lleva a un portal en el body; vive aquí por localidad del estado. */}
			<DeleteNodeDialog
				nodes={deletingNode ? [deletingNode] : null}
				onClose={() => setDeletingNode(null)}
				onDeleted={(nodeIds, graphRevision) => {
					// Cierra el diálogo; cierra la tarjeta de detalle si apuntaba aquí
					// (la relectura la cerraría de todos modos, pero en el mismo fotograma
					// no debería verse una tarjeta de un nodo que el usuario acaba de eliminar).
					setDeletingNode(null);
					if (selected && nodeIds.includes(selected.node.id)) setSelected(null);
					// La cadena de la oleada 6: todos los oyentes vuelven a leer con esto. Los clústeres
					// encogen / dejan de renderizarse por debajo del mínimo en la lectura del servidor.
					window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { graphRevision } }));
				}}
			/>



			<PluginGraphActions />

			{/* Leyenda + filtros: cuadro de búsqueda y filas de conmutadores por estado. */}
			{/* Controles de arriba a la derecha — contenedores flotantes separados (responsable,
			ronda 2 de la vista de grafo). Orden de la fila (2026-09-17): búsqueda,
			cobertura, importar, engranaje — la cobertura va entre la búsqueda y
			importar; el engranaje se queda con la esquina. items-start (no center),
			para que la nota de sin coincidencias del contenedor de búsqueda pueda crecer hacia abajo
			sin desplazar a sus hermanos — todos los controles miden 36px de alto
			(franja de cabecera, 2026-09-20), y la alineación superior fija la fila.
			La cobertura se renderiza incluso cuando el grafo está VACÍO — un grafo
			vacío con sesiones sin extraer es justo cuando importa
			(extraer → el grafo gana nodos).
			lh-no-drag (2026-09-17): la franja flotante de arrastre de home.tsx queda
			por debajo de esta fila — la máscara de arrastre de Electron ignora z-index,
			así que sin un recorte explícito no se podía hacer clic en los controles
			en la app de escritorio (informe del responsable). El antiguo
			flex-wrap (oleada de ventanas estrechas, 2026-09-17) partía la fila
			en dos líneas por debajo del umbral de la barra lateral — el responsable lo rechazó
			(2026-09-20): siempre una fila, la búsqueda encoge (ver
			el comentario de la franja de cabecera en la columna de más abajo). */}
			{/* Franja de cabecera (responsable, 2026-09-20): los controles van EN la
			fila visual de la cabecera — top-2 se alinea con la franja del conmutador de la barra lateral
			(cabecera py-2, conmutador h-9), con todos los controles adelgazados a 36px.
			El tope de ancho vive AQUÍ, en el elemento absoluto (el 100 % se resuelve
			respecto al padre a sangre) — la fila NUNCA se parte (el responsable
			rechazó el plegado en dos filas); en ventanas estrechas la búsqueda es
			el elemento flexible y encoge en su lugar. */}
			<div className="lh-no-drag lh-wco-floating absolute right-2 top-2 z-10 flex max-w-[calc(100%-5.5rem)] flex-col items-end gap-2">
			{/* z-20 (2026-09-20): la fila se pinta encima del número de coste de debajo
			— sin esto, el control de coste, que va más tarde en el DOM, quedaba encima
			de los desplegables de ajustes/cobertura (informe del responsable), y aún se podía pasar el ratón
			y hacer clic sobre ellos. La fila es un contexto de apilado, así que
			sus desplegables abiertos tapan el número; los clics caen en el panel. */}
			<div className="relative z-20 flex min-w-0 items-start gap-2">
				{/* La fila de acciones (oleada del cromo del grafo vacío, responsable 2026-09-25):
				Import Notes siempre — el punto de entrada del grafo vacío; la búsqueda +
				los ajustes solo cuando hay nodos, con un fundido al montarse. */}
				<GraphChromeRow
					isEmpty={isEmpty}
					query={query}
					onQuery={setQuery}
					noMatch={snapshot !== null && visibleIds.size === 0 && query.trim() !== ""}
					importing={importing}
					searchInputRef={searchInputRef}
					onImportFiles={onImportFiles}
					settings={settings}
					changeSettings={changeSettings}
					onOpenChains={() => setChainsOpen(true)}
				/>
			</div>

			<NotesImportErrors errors={notesImport.errors} />
			<NotesImportNotices notices={notesImport.notices} />
			{/* Cola de arriba a la derecha (responsable, 2026-09-20): el número de coste del proceso —
			solo un número, resaltado al pasar el ratón, con desglose desplegable — y luego
			las píldoras de los procesos en ejecución debajo. Vive DEBAJO de la fila de
			acciones para que las ventanas estrechas nunca puedan empujarlo encima del compositor,
			como hacía la antigua pila de abajo a la izquierda; todo el grupo de arriba a la
			derecha es una columna, alineada a la derecha. */}
			{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
			{pipelineRuns.map((run) => (
				<div
					key={run.id}
					className="flex items-center gap-2 rounded-full border bg-card/85 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur"
				>
					<Loader2Icon className="size-3.5 shrink-0 animate-spin" />
					<span className="capitalize">{run.phase}</span>
					<span className="max-w-48 truncate text-foreground">{run.title}</span>
					<span className="tabular-nums">{Math.max(0, Math.round((Date.now() - run.startedAt) / 1000))}s</span>
				</div>
			))}
			</div>

			{selected && !isEmpty && (
				<div
					ref={cardRef}
					// Se coloca de forma imperativa en el efecto de layout de arriba; oculta
					// hasta que se coloca, para que darle la vuelta nunca destelle en el sitio equivocado.
					style={{ visibility: "hidden", left: 0, top: 0 }}
					// lh-no-drag: la tarjeta se coloca en cualquier punto del canvas —
					// cuando cae en la franja superior debe seguir siendo interactiva
					// sobre la superficie de arrastre de home.tsx (2026-09-17).
					className="lh-no-drag absolute z-10 w-80 max-w-[calc(100%-1rem)] rounded-xl border bg-card p-4 text-left shadow-lg"
				>
					<div className="text-sm font-medium leading-snug">{selected.node.name}</div>
					<div className="mt-1 text-xs leading-relaxed text-muted-foreground">{selected.node.statement}</div>
					{selected.sourceIds.length > 0 ? (
						<div className="mt-3 flex flex-col gap-1">
							<div className="text-xs text-muted-foreground">Sessions</div>
							{selected.sourceIds.map((sourceId) => {
								// Un fichero de notas importado: una entrada ESTÁTICA — la ruta,
								// texto plano, nunca un enlace (no hay sesión que abrir).
								if (snapshot?.fileSources?.[sourceId] !== undefined) {
									return (
										<div key={sourceId} className="flex items-center gap-1.5">
											<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm text-muted-foreground">
												{snapshot.fileSources[sourceId]}
											</span>
										</div>
									);
								}
								// Una sesión real: procedencia enlazable.
								return (
									<div key={sourceId} className="flex items-center gap-1.5">
										<Link
											href={propositionSessionHref(selected.node, sourceId)}
											scroll={false}
											className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
										>
											{snapshot?.sessions[sourceId] ?? sourceId}
										</Link>
									</div>
								);
							})}
						</div>
					) : (
						<div className="mt-3 text-xs text-muted-foreground">No sessions recorded.</div>
					)}
				</div>
			)}
			{/* El overlay de la tabla de cadenas (plan del overlay de cadenas, 2026-09-29):
			ABSOLUTO DENTRO del área del grafo (el modismo de los overlays de sesión —
			nunca un portal en el body) para que el cromo de la app siga nítido y
			accesible; el propio overlay es de solo lectura respecto al grafo
			y es responsable de su selección.
			ÚLTIMO HIJO DE LA RAÍZ, A PROPÓSITO (responsable, noche del 2026-09-29):
			la resta de app-region se resuelve por orden en el DOM, no por
			z-index — montada antes, la columna lh-no-drag del cromo
			abría zonas muertas en la franja de arrastre de la TopBar del overlay
			(sobre los recuentos, alrededor del campo de búsqueda). Una superficie a sangre
			que tapa una franja de arrastre debe pintarse DESPUÉS de todo lo que
			tapa. (DeleteNodeDialog va en un portal en el body — el DOM no importa
			aquí.) */}
			<ChainTableOverlay
				open={chainsOpen}
				nodes={snapshot?.propositions ?? []}
				chains={snapshot?.chains ?? []}
				sessions={snapshot?.sessions ?? {}}
				fileSources={snapshot?.fileSources ?? {}}
				onClose={() => {
					setChainsOpen(false);
					onChainSelectClose?.();
				}}
				selectMode={chainSelectOpen}
				controlledSelection={practiceSelection}
				onSelectionChange={(ids) => {
					// Resuelve ids → nodos contra la instantánea viva; quien
					// llama tiene el conjunto elegido (recuento + semilla).
					const props = snapshot?.propositions ?? [];
					const picked: { id: string; name: string; statement: string }[] = [];
					for (const id of ids) {
						const n = props.find((node) => node.id === id);
						if (n) picked.push({ id: n.id, name: n.name, statement: n.statement });
					}
					onPracticeSelectionChange?.(picked);
				}}
			/>		</div>
	);
}
