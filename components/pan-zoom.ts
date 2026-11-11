/**
 * Matemática compartida del viewport de desplazamiento/zoom — la semántica
 * del "suelo de ajuste" recogida de la ventana emergente del plan (rondas 2–4
 * del grafo del plan) para que los overlays de la sesión (el foco del plan,
 * el foco de mermaid) usen la MISMA geometría: el zoom mínimo ES el ajuste
 * (mande el eje que mande), el desplazamiento se bloquea en el suelo (no hay
 * nada que mover) y la rueda hace zoom hacia el cursor. Pura a propósito: los
 * overlays se prueban renderizados en marcado estático (sin eventos de
 * puntero en vivo), así que la matemática vive aquí, donde las pruebas
 * pueden fijarla (tests/pan-zoom.test.ts).
 */

/** Techo de zoom para toda superficie que usa esta matemática (subido de 2× a
 *  4× para leer de cerca los títulos de los nodos, responsable, ronda 3 del
 *  grafo del plan). */
export const ZOOM_MAX = 4;
/** Margen del viewport que resta el ajuste. */
export const FIT_PAD = 16;
/** El ajuste nunca acerca el zoom más allá de esto — un diagrama diminuto no debe agrandarse desmesuradamente. */
export const FIT_ZOOM_MAX = 1.5;

/** Un estado de viewport de desplazamiento/zoom (traslación + escala; origen arriba a la izquierda). */
export interface Viewport {
	zoom: number;
	x: number;
	y: number;
}

/** El zoom de ajuste para una caja en un viewport: nunca por debajo de un
 *  ajuste real (el viejo suelo de 0.15 podía quedar POR ENCIMA del ajuste en
 *  grafos anchos — el épsilon solo protege viewports degenerados), nunca por
 *  encima de FIT_ZOOM_MAX. Pura. */
export function fitZoomFor(box: { w: number; h: number }, viewport: { w: number; h: number }): number {
	if (!viewport.w || !viewport.h || box.w === 0) return 1;
	return Math.max(0.02, Math.min((viewport.w - FIT_PAD) / box.w, (viewport.h - FIT_PAD) / box.h, FIT_ZOOM_MAX));
}

/** Centra una caja (al zoom dado) en el viewport. Pura. */
export function fitGraphView(box: { w: number; h: number }, viewport: { w: number; h: number }, zoom: number): Viewport {
	return { zoom, x: (viewport.w - box.w * zoom) / 2, y: (viewport.h - box.h * zoom) / 2 };
}

/** Zoom por `factor` manteniendo `focus` (coordenadas del viewport)
 *  visualmente fijo, acotado a [suelo, ZOOM_MAX]. En el suelo la vista se
 *  reajusta y SE VUELVE A CENTRAR (el ajuste ES el suelo — una vista bloqueada
 *  ahí no tiene nada que mover). Pura. */
export function zoomedGraphView(
	view: Viewport,
	factor: number,
	floor: number,
	focus: { x: number; y: number },
	box: { w: number; h: number },
	viewport: { w: number; h: number },
): Viewport {
	const zoom = Math.min(Math.max(view.zoom * factor, floor), ZOOM_MAX);
	if (zoom === view.zoom) return view;
	if (zoom <= floor) return fitGraphView(box, viewport, floor);
	const k = zoom / view.zoom;
	return { zoom, x: focus.x - (focus.x - view.x) * k, y: focus.y - (focus.y - view.y) * k };
}
