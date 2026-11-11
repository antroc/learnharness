/**
 * Ajustes de renderizado del grafo: la forma, los valores por defecto, el saneador
 * y la correspondencia de los deslizadores (escala logarítmica, centrada en el valor
 * por defecto) — compartidos por el cliente (components/graph-canvas.ts,
 * graph-view.tsx), el almacén del servidor (src/store/render-settings.ts, que los
 * persiste en data/render-settings.json) y la ruta de la API.
 *
 * Este módulo es puro: sin DOM, sin d3, sin API de node — seguro en cualquier sitio.
 *
 * Los ajustes se persisten en el servidor (render-settings.json); la era de
 * localStorage se acabó. Todo lo que llega del disco o de la red pasa por
 * sanitizeRenderSettings antes de usarse — nunca se confía en ello en bruto.
 *
 * SEMÁNTICA DE TAMAÑOS (giro del 2026-09-15): nodeSize, labelSize, arrowLength y
 * regions.dilation son UNIDADES DEL MUNDO — la misma ley que los espaciados de la
 * física. La escala del mundo es la canónica: unos ajustes idénticos se renderizan
 * igual con cualquier tamaño de grafo y cualquier zoom. (Antes eran "px de pantalla
 * con el zoom de encaje", lo que hacía que el tamaño de los nodos dependiera de la
 * extensión del grafo — el fallo de los grafos pequeños.)
 *
 * La semántica de labelZoom: el umbral de "proporción de cámara" compatible con
 * sigma (1 = zoom de encaje, MÁS PEQUEÑO = más acercado). Las etiquetas de los nodos
 * se muestran con proporción <= labelZoom y se funden con las etiquetas de los
 * clústeres a lo largo de un tramo proporcional a la barrera (ver LABELS_FADE_RATIO
 * en el renderizador). Los valores persistidos conservan estas unidades tras el
 * cambio de renderizador.
 *
 * ESCALERAS DE LOS DESLIZADORES (2026-09-17, a petición del usuario): todos los
 * mandos que NO son de física se mueven por una escalera de 11 peldaños escrita a
 * mano — la clásica serie de números redondos de dos por octava (alternando x1,5 /
 * x1,33: ...1, 1.5, 2, 3, 4, 6, 8, 12...) — con el valor POR DEFECTO justo en el
 * centro, en la posición 50 (paso del deslizador 10, un peldaño por muesca). Se
 * acabaron los artefactos de los deslizadores logarítmicos como 2.18137...977: los
 * valores posibles de un mando SON la escalera, el saneador ajusta cualquier valor
 * entrante a la entrada más cercana y lo que se sale del rango se ajusta al extremo.
 * La física conserva los deslizadores logarítmicos de ajuste fino (el usuario: "se
 * ajustan muy finamente... están bien como están").
 */

import {
	CHARGE_STRENGTH,
	CLUSTER_PULL_STRENGTH,
	INCREMENTAL_GRAVITY,
	LINK_DISTANCE,
	type DepthAnchorMode,
} from "./layout.ts";

export interface GraphRenderSettings {
	/** Sello semántico del giro de unidades de tamaño (2026-09-15): "world" =
	 * nodeSize/labelSize/arrowLength/regions.dilation son unidades del MUNDO;
	 * ausente = la antigua semántica de "px de pantalla con el zoom de encaje" — el
	 * saneador restablece esos cuatro campos (cambió su significado, no su
	 * magnitud) y conserva todo lo demás. */
	sizeUnits: "world";
	nodeSize: number;
	edgeWidth: number;
	arrowLength: number;
	/** Umbral de proporción de cámara para las etiquetas de los nodos (ver la documentación del módulo). */
	labelZoom: number;
	/** Tamaño de letra de las etiquetas de nodo y de hover, en unidades del MUNDO (escala con la cámara). */
	labelSize: number;
	/** Interruptor de las etiquetas de las regiones de los clústeres (las envolventes se dibujan siempre). */
	clusterLabels: boolean;
	/** Tamaño de letra de las etiquetas de los clústeres, en px de pantalla (compensado
	 * con la cámara — constante con cualquier zoom, a diferencia de labelSize, que escala
	 * con el grafo). Por defecto, la antigua constante REGION_LABEL_SIZE (14). */
	clusterLabelSize: number;
	/** Renderizado de las regiones (los tintes difuminados de los clústeres). Persistido en
	 * el servidor desde el 2026-09-13 (petición del usuario) — antes era estado de desarrollo solo de la sesión. */
	regions: RegionTuning;
	/** Física de la simulación en vivo + anclaje por profundidad de inferencia. Persistido en
	 * el servidor desde el 2026-09-13 (petición del usuario) — antes era estado de desarrollo solo de la sesión. */
	physics: PhysicsTuning;
}


const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/**
 * Convierte JSON arbitrario (fichero del servidor, cuerpo de red, restos de
 * localStorage) en ajustes válidos: las claves que faltan toman los valores por
 * defecto, los valores fuera de rango se acotan y los tipos erróneos se
 * restablecen. Nunca lanza.
 */
export function sanitizeRenderSettings(raw: unknown): GraphRenderSettings {
	const r = (raw ?? {}) as Partial<GraphRenderSettings>;
	// Mando de escalera: cualquier valor finito se ajusta a la entrada más cercana (los empates
	// van hacia abajo); lo que no es un número toma el valor por defecto (de todos modos, el centro).
	const ladd = (v: unknown, ladder: readonly number[], dflt: number) =>
		typeof v === "number" && Number.isFinite(v) ? snapToLadder(v, ladder) : dflt;
	// El giro de unidades de tamaño (2026-09-15): los ficheros anteriores a "world" guardaban
	// los tamaños en "px de pantalla con el zoom de encaje" — una unidad cuyo significado
	// dependía de la extensión del propio grafo (EL fallo de los grafos pequeños). Esos
	// valores no se pueden trasladar con honestidad a unidades del mundo, así que vuelven a los
	// valores por defecto; el valor de referencia ES el antiguo aspecto ajustado, en unidades del mundo.
	const legacySizes = r.sizeUnits !== "world";
	return {
		sizeUnits: "world",
		nodeSize: legacySizes ? DEFAULT_RENDER_SETTINGS.nodeSize : ladd(r.nodeSize, NODE_SIZE_LADDER, DEFAULT_RENDER_SETTINGS.nodeSize),
		edgeWidth: ladd(r.edgeWidth, EDGE_WIDTH_LADDER, DEFAULT_RENDER_SETTINGS.edgeWidth),
		arrowLength: legacySizes ? DEFAULT_RENDER_SETTINGS.arrowLength : ladd(r.arrowLength, ARROW_LENGTH_LADDER, DEFAULT_RENDER_SETTINGS.arrowLength),
		labelZoom: ladd(r.labelZoom, LABEL_ZOOM_LADDER, DEFAULT_RENDER_SETTINGS.labelZoom),
		labelSize: legacySizes ? DEFAULT_RENDER_SETTINGS.labelSize : ladd(r.labelSize, LABEL_SIZE_LADDER, DEFAULT_RENDER_SETTINGS.labelSize),
		clusterLabels:
			typeof r.clusterLabels === "boolean" ? r.clusterLabels : DEFAULT_RENDER_SETTINGS.clusterLabels,
		clusterLabelSize: ladd(
			r.clusterLabelSize,
			CLUSTER_LABEL_SIZE_LADDER,
			DEFAULT_RENDER_SETTINGS.clusterLabelSize,
		),
		// Secciones anidadas (2026-09-13): los ficheros antiguos no las tienen → valores por defecto.
		// Los ficheros antiguos también restablecen regions.dilation (sus unidades cambiaron con
		// el giro); el resto de la semántica de la sección no se toca.
		regions: legacySizes
			? { ...sanitizeRegionTuning(r.regions), dilation: DEFAULT_REGION_TUNING.dilation }
			: sanitizeRegionTuning(r.regions),
		physics: sanitizePhysicsTuning(r.physics),
	};
}

// ─── Ajuste de regiones + física (trasladado desde el renderizador, 2026-09-13) ──
//
// Los controles de regiones/física del renderizador pasaron a ser ajustes persistidos
// DE CARA AL USUARIO: una forma + un saneador en el núcleo, que consumen el almacén de
// ajustes (el esquema de este fichero), el panel y setRegionTuning/setPhysicsTuning del
// renderizador. Cada acotación de abajo es un rango seguro VALIDADO CON BARRIDOS
// (2026-09-13, grafo real, la simulación exacta del renderizador): cada campo en ambos
// extremos del rango Y en las cuatro esquinas del rango se asienta limpiamente — sin NaN,
// sin explosión (linkStrength ≥ 8 hace explotar la disposición, 5 tambalea; tope 4),
// sin falta de asentamiento (velocityDecay 0 nunca amortigua; suelo 0,1), sin dispersión
// x3 (se excluyen gravity 0 / charge -1000). 2026-09-17: CHARGE_RANGE se estrechó a
// [120, 480] en torno al nuevo valor por defecto −240 — estrictamente dentro del
// [30, 480] validado, así que todas las esquinas siguen siendo seguras según el barrido.

/** Mandos del renderizado de regiones (los tintes difuminados de los clústeres). */
export interface RegionTuning {
	/** Semiancho de dilatación de los trazos de arista con extremos redondeados, en
	 * unidades del MUNDO (la expansión del esqueleto del clúster). */
	dilation: number;
	/** Suavidad de la región: el alcance del difuminado, en unidades del MUNDO (3 pasadas
	 * de difuminado de caja ≈ gaussiano). El giro a unidades del mundo del 2026-09-15
	 * acabó con la era de los px del mapa de bits — el antiguo alcance escalaba con la
	 * extensión del grafo (blur × extensión / mapa de bits), así que el mismo valor se
	 * veía 6 veces más suave en un grafo de 338 nodos que en uno de 13. Ahora el alcance
	 * es canónico, como la dilatación; el renderizador lo rasteriza (redondeo a px del
	 * mapa de bits, suelo de 1 px cuando el grafo tiene más resolución que el difuminado). */
	blur: number;
	/** Dimensión máxima del mapa de bits (celda = worldSpan / esto). Conjunto fijo:
	 * ver REGION_BITMAP_OPTIONS (desplegable en el panel). */
	bitmap: number;
	/** Alfa de la región, aplicado UNA vez después del difuminado (dilatar con opacidad
	 * completa → difuminar → escalar). Interior constante, bordes suaves; los
	 * solapamientos, sean cuantos sean, nunca se apilan (DECIDIDO 2026-09-14 — el alfa
	 * por trazo se acumulaba con source-over y contaba dos veces los huérfanos). */
	edgeAlpha: number;
	/** EL interruptor de apagado (usuario, 2026-09-15): false = el renderizador nunca
	 * ejecuta la construcción de regiones — sin salpicado, sin difuminado, sin
	 * relectura, sin reservar el mapa de bits, sin volcado. Se omite el cálculo, no solo
	 * se oculta el pintado. Las etiquetas de los clústeres van aparte y siguen a `clusterLabels`. */
	enabled: boolean;
}

export const REGION_BITMAP_OPTIONS = [128, 192, 256, 384, 512] as const;
export const DEFAULT_REGION_TUNING: RegionTuning = {
	dilation: 20,
	// Nuevo valor por defecto 40 (responsable, 2026-10-07): tintes de región más suaves y amplios.
	blur: 40,
	bitmap: 256,
	edgeAlpha: 0.2,
	enabled: true,
};

/** El miembro más cercano de un conjunto fijo de opciones (los desplegables no tienen valores libres). */
function snapToOption(value: number, options: readonly number[]): number {
	return options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), options[0] as number);
}

/** Acota y valida un ajuste de regiones. `bitmap` se ajusta a la opción permitida
 * más cercana (un conjunto fijo — desplegable, no un número libre). */
export function sanitizeRegionTuning(input: Partial<RegionTuning> | null | undefined): RegionTuning {
	const d = DEFAULT_REGION_TUNING;
	const num = (v: unknown, fallback: number): number =>
		typeof v === "number" && Number.isFinite(v) ? v : fallback;
	const bitmap = num(input?.bitmap, d.bitmap);
	const ladd = (v: unknown, ladder: readonly number[], dflt: number) =>
		typeof v === "number" && Number.isFinite(v) ? snapToLadder(v, ladder) : dflt;
	return {
		dilation: ladd(input?.dilation, REGION_DILATION_LADDER, d.dilation),
		blur: ladd(input?.blur, REGION_BLUR_LADDER, d.blur),
		bitmap: snapToOption(bitmap, REGION_BITMAP_OPTIONS),
		edgeAlpha: ladd(input?.edgeAlpha, REGION_EDGE_ALPHA_LADDER, d.edgeAlpha),
		// Los ficheros persistidos antiguos son anteriores al interruptor: ausente → activado (el
		// aspecto que ajustaron los usuarios); solo un false explícito apaga las regiones.
		enabled: typeof input?.enabled === "boolean" ? input.enabled : true,
	};
}

/** Controles de física de la simulación en vivo (de cara al usuario desde el
 * 2026-09-13): cada valor alimenta createGraphSimulation — el MISMO motor que ejecuta
 * el asentamiento del servidor —, así que ajustar la sensación cambia exactamente
 * aquello hacia lo que se relaja un arrastre. */
export interface PhysicsTuning {
	/** Repulsión entre nodos (carga de d3, negativa = se separan). */
	chargeStrength: number;
	/** Atracción de las aristas: multiplicador de rigidez del muelle de enlace (1 = valor por defecto de d3). */
	linkStrength: number;
	/** Longitud de reposo del muelle de enlace (unidades del mundo). */
	linkDistance: number;
	/** Atracción central hacia el centroide del grafo. */
	gravity: number;
	/** Atracción por clúster hacia el centroide del clúster. 0 = desactivada. */
	clusterPull: number;
	/** Amortiguación de la velocidad por tick (valor por defecto de d3: 0,4). */
	velocityDecay: number;
	/** Modo de anclaje por profundidad de inferencia (ver DepthAnchor en el núcleo). */
	depthMode: DepthAnchorMode;
	/** Fuerza de atracción del ancla de profundidad. */
	depthStrength: number;
	/** Separación entre niveles de inferencia (unidades del mundo). */
	depthSpacing: number;
	/** Radio del anillo interior, modo radial (unidades del mundo). */
	depthBaseRadius: number;
}

export const DEFAULT_PHYSICS_TUNING: PhysicsTuning = {
	chargeStrength: CHARGE_STRENGTH,
	linkStrength: 1,
	linkDistance: LINK_DISTANCE,
	gravity: INCREMENTAL_GRAVITY,
	clusterPull: CLUSTER_PULL_STRENGTH,
	velocityDecay: 0.4,
	depthMode: "off",
	// 0,8 por barrido sobre el grafo real: 215/216 flechas se leen hacia arriba con una
	// caída orgánica (|desv.| media respecto al nivel ~34u con separación 60); 1,5 da
	// filas nítidas (desv. ~18) si el valor por defecto promocionado las quiere.
	depthStrength: 0.8,
	depthSpacing: 60,
	depthBaseRadius: 220,
};

/** Acota cualquier cosa a un ajuste utilizable (los deslizadores/JSON pueden venir vacíos o NaN). */
export function sanitizePhysicsTuning(input: Partial<PhysicsTuning> | null | undefined): PhysicsTuning {
	const d = DEFAULT_PHYSICS_TUNING;
	const num = (v: unknown, fallback: number): number =>
		typeof v === "number" && Number.isFinite(v) ? v : fallback;
	return {
		chargeStrength: Math.min(Math.max(num(input?.chargeStrength, d.chargeStrength), CHARGE_RANGE.min), CHARGE_RANGE.max),
		linkStrength: Math.min(Math.max(num(input?.linkStrength, d.linkStrength), LINK_STRENGTH_RANGE.min), LINK_STRENGTH_RANGE.max),
		linkDistance: Math.min(Math.max(num(input?.linkDistance, d.linkDistance), LINK_DISTANCE_RANGE.min), LINK_DISTANCE_RANGE.max),
		gravity: Math.min(Math.max(num(input?.gravity, d.gravity), GRAVITY_RANGE.min), GRAVITY_RANGE.max),
		clusterPull: Math.min(Math.max(num(input?.clusterPull, d.clusterPull), 0), CLUSTER_PULL_RANGE.max),
		velocityDecay: Math.min(Math.max(num(input?.velocityDecay, d.velocityDecay), VELOCITY_DECAY_RANGE.min), VELOCITY_DECAY_RANGE.max),
		depthMode: input?.depthMode === "vertical" || input?.depthMode === "radial" ? input.depthMode : "off",
		depthStrength: Math.min(Math.max(num(input?.depthStrength, d.depthStrength), DEPTH_STRENGTH_RANGE.min), DEPTH_STRENGTH_RANGE.max),
		depthSpacing: Math.min(Math.max(num(input?.depthSpacing, d.depthSpacing), DEPTH_SPACING_RANGE.min), DEPTH_SPACING_RANGE.max),
		depthBaseRadius: Math.min(Math.max(num(input?.depthBaseRadius, d.depthBaseRadius), DEPTH_BASE_RADIUS_RANGE.min), DEPTH_BASE_RADIUS_RANGE.max),
	};
}

// Los tamaños son UNIDADES DEL MUNDO (el giro del 2026-09-15 — ver el bloque de rangos
// de abajo para la historia completa): la escala del mundo es la canónica, y unos ajustes
// idénticos se renderizan igual con cualquier tamaño de grafo. Los valores son el
// reajuste del 2026-09-13 (2 px con el encaje en el grafo de referencia) ÷ su kFit 0,69.
// La consolidación del 2026-09-17: los valores ajustados en vivo por el usuario (sobre el
// grafo real tras el giro a unidades del mundo), cada uno justo en el centro de su escalera.
export const DEFAULT_RENDER_SETTINGS: GraphRenderSettings = {
	sizeUnits: "world",
	nodeSize: 2,
	edgeWidth: 1,
	arrowLength: 2,
	// Nuevo valor por defecto 0,5 — se muestra como 1× en el deslizador (responsable, 2026-10-07:
	// "etiquetas hasta el zoom por defecto uno" — el responsable habla en valores de
	// visualización, y la visualización es proporción/0,5). Etiquetas en cuanto se acerca más allá del encaje.
	labelZoom: 0.5,
	labelSize: 3,
	clusterLabels: true,
	clusterLabelSize: 14,
	regions: DEFAULT_REGION_TUNING,
	physics: DEFAULT_PHYSICS_TUNING,
};

// ─── Las escaleras de los deslizadores (2026-09-17) ──────────────────────────
//
// Los mandos que no son de física se mueven por escaleras de 11 peldaños escritas a mano —
// la clásica serie de números redondos de dos por octava (alternando x1,5 / x1,33: pasos
// de cuarto y de medio en el extremo bajo, enteros por encima) — con el valor POR DEFECTO
// en el centro, en el índice 5 / posición 50 del deslizador. El deslizador avanza de 10 en
// 10: un peldaño por muesca, 21 posiciones → 11 valores, todos enteros o fracciones limpias.
// El saneador ajusta CUALQUIER valor entrante a la entrada más cercana, así que los ficheros
// guardados nunca pueden contener (ni renderizar) artefactos del estilo 2.18137...977.

// Cada escalera se escribe alrededor de su valor POR DEFECTO en el índice 5: cinco peldaños
// hacia abajo y cinco hacia arriba, siguiendo la alternancia x1,5 / x4/3 donde sale limpia
// (potencias de dos en los suelos donde la serie se volvería fraccionaria).
export const NODE_SIZE_LADDER = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12] as const;
export const EDGE_WIDTH_LADDER = [0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 4, 6] as const;
export const ARROW_LENGTH_LADDER = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12] as const;
export const LABEL_SIZE_LADDER = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const;
// Px de pantalla con cualquier zoom (se dibuja con tamaño / k). 14 = el antiguo REGION_LABEL_SIZE.
export const CLUSTER_LABEL_SIZE_LADDER = [7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28] as const;
// Barreras de proporción de cámara; la escalera de VISUALIZACIÓN marca 1.5×, 2×, 3×, 4×, 6×,
// 8×, 12×, 16×, 24×, 32×, 48× (labelZoomDisplay), con el 8× ajustado por el usuario
// (proporción 4) en el centro — antes quedaba en el extremo mismo del eje.
// Recentrada en el nuevo valor por defecto (responsable, 2026-10-07): la visualización 1×
// (proporción 0,5) queda en el centro; los peldaños superiores conservan la antigua serie
// conocida y los inferiores se afinan donde ahora vive el valor por defecto. Los valores
// guardados antiguos se ajustan al peldaño más cercano (4 → 3, 24 → 3, 0.75 → 0.75).
export const LABEL_ZOOM_LADDER = [0.125, 0.175, 0.25, 0.35, 0.45, 0.5, 0.75, 1, 1.5, 2, 3] as const;

// ─── Rangos de los deslizadores de regiones + física ──────────────────────────
//
// Las mismas leyes que los deslizadores de tamaño: escala logarítmica, VALOR POR DEFECTO EN 50
// (cada valor por defecto es la media geométrica de sus extremos), pistas gruesas de 5 pasos.
// Los campos con signo o con cero tienen un tratamiento especial:
//   chargeStrength es NEGATIVO — el deslizador representa |charge| y muestra "-x";
//   clusterPull tiene una zona de APAGADO — la posición 0 es exactamente 0 (ver
//   toOffSliderPosition) y el rango logarítmico empieza un paso más allá. Blur también
//   tenía una; es un desplegable desde el 2026-09-13 (los no enteros fallaban).

export const REGION_DILATION_LADDER = [4, 5, 7.5, 10, 15, 20, 30, 40, 60, 80, 120] as const; // unidades del mundo
// Recentrado en el nuevo valor por defecto 40 (responsable, 2026-10-07): mínimo 10 a
// sugerencia del responsable, se conserva el antiguo techo de 120 y sobreviven todos los
// peldaños antiguos desde 15 hacia arriba (4/5/7.5 se ajustan a 10).
export const REGION_BLUR_LADDER = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120] as const; // unidades del mundo
export const REGION_EDGE_ALPHA_LADDER = [0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1] as const;

export const CHARGE_RANGE = { min: -480, max: -120 } as const; // |gm| = 240 (2026-09-17: valor por defecto −240, en el centro; un subrango del [30, 480] validado con barridos)
export const LINK_STRENGTH_RANGE = { min: 0.25, max: 4 } as const; // gm = 1
export const LINK_DISTANCE_RANGE = { min: 10, max: 160 } as const; // gm = 40
export const GRAVITY_RANGE = { min: 0.03, max: 0.48 } as const; // gm = 0.12
export const CLUSTER_PULL_RANGE = { min: 0.0225, max: 1 } as const; // gm = 0.15; 0 = desactivado
export const VELOCITY_DECAY_RANGE = { min: 0.18, max: 0.9 } as const; // gm ≈ 0.40
export const DEPTH_STRENGTH_RANGE = { min: 0.2, max: 3.2 } as const; // gm = 0.8
export const DEPTH_SPACING_RANGE = { min: 15, max: 240 } as const; // gm = 60
export const DEPTH_BASE_RADIUS_RANGE = { min: 55, max: 880 } as const; // gm = 220

/** Entrada de la escalera más cercana (los empates van hacia ABAJO — determinista). */
export function snapToLadder(value: number, ladder: readonly number[]): number {
	return ladder.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), ladder[0] as number);
}

/** Índice en la escalera de un valor (el más cercano; los empates van hacia abajo) — la
 * posición del deslizador es índice × 10 (pista de paso 10, 11 peldaños, valor por defecto en 50). */
export function ladderIndex(value: number, ladder: readonly number[]): number {
	let best = 0;
	for (let i = 1; i < ladder.length; i++)
		if (Math.abs(ladder[i] as number - value) < Math.abs(ladder[best] as number - value)) best = i;
	return best;
}

/** Valor del ajuste → posición del deslizador de escalera [0, 100]. */
export function toLadderPosition(value: number, ladder: readonly number[]): number {
	return ladderIndex(clampToLadder(value, ladder), ladder) * 10;
}

/** Posición del deslizador de escalera [0, 100] → valor del ajuste (la entrada de la escalera). */
export function fromLadderPosition(position: number, ladder: readonly number[]): number {
	const i = Math.min(Math.max(Math.round(position / 10), 0), ladder.length - 1);
	return ladder[i] as number;
}

/** Acota un valor al intervalo de la escalera (sin ajustar a peldaños — solo límites). */
function clampToLadder(value: number, ladder: readonly number[]): number {
	return clamp(value, ladder[0] as number, ladder[ladder.length - 1] as number);
}

/** Correspondencia del deslizador con zona de apagado (posición 0 → valor 0 = APAGADO;
 * el rango logarítmico empieza un paso más allá). Inversa de fromOffSliderPosition. */
export function toOffSliderPosition(value: number, min: number, max: number): number {
	if (value <= 0) return 0;
	return toSliderPosition(value, min, max);
}

/** Correspondencia del deslizador con zona de apagado: posición 0 → 0 (apagado); si no, escala logarítmica. */
export function fromOffSliderPosition(position: number, min: number, max: number): number {
	if (position <= 0) return 0;
	return fromSliderPosition(position, min, max);
}

/** Valor del ajuste → posición del deslizador [0, 100] (escala logarítmica, valor por defecto en 50). */
export function toSliderPosition(value: number, min: number, max: number): number {
	const v = clamp(value, min, max);
	const logSpan = Math.log(max / min);
	return (100 * Math.log(v / min)) / logSpan;
}

/** Posición del deslizador [0, 100] → valor del ajuste (inversa de toSliderPosition). */
export function fromSliderPosition(position: number, min: number, max: number): number {
	const p = clamp(position, 0, 100) / 100;
	const logSpan = Math.log(max / min);
	return min * Math.exp(p * logSpan);
}

/** Unidades de visualización de labelZoom: ABSOLUTAS desde el 2026-09-17 (proporción /
 * 0,5 — ancladas al valor por defecto histórico anterior a la consolidación, así "8×"
 * conserva su significado ahora que 4 ES el valor por defecto; la antigua forma
 * relativa al valor por defecto habría vuelto a rotular el 8× ajustado por el usuario
 * como "1×"). */
export function labelZoomDisplay(labelZoom: number): string {
	const v = Math.round((labelZoom / 0.5) * 100) / 100;
	return `${v}×`;
}
