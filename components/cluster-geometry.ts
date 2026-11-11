/**
 * Identidad de color de los clústeres — matemáticas puras de presentación para las
 * regiones del grafo de conocimiento. (La geometría de envolventes que vivía aquí —
 * convexHull, outwardNormal, offsetPolygon, traceRoundedPath — se RETIRÓ con el
 * renderizador de envolventes convexas: las regiones son ahora un mapa de bits
 * salpicado de baja resolución en el espacio del mundo, en graph-canvas.ts, que
 * renderiza bien las formas cóncavas de los clústeres y cuesta un volcado por
 * fotograma en lugar de 32 clústeres × 4 polígonos desplazados. El fichero conserva el
 * nombre por las importaciones del barril.)
 */

export type Pt = { x: number; y: number };

/** Tono estable por id de clúster (hash del contenido): la región conserva su color
 * entre reorganizaciones porque el id solo cambia cuando cambian los miembros. */
export function clusterHue(id: string): number {
	let h = 0;
	for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}
