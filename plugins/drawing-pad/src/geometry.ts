import { strokeWidth, visibleStrokes, type Stroke } from "./strokes.ts";

export interface Offset { x: number; y: number }
export interface Bounds extends Offset { width: number; height: number }
/** Acota solo el ráster de exportación, nunca la geometría del mundo ni la cámara de presentación. */
export function exportRaster(bounds: Bounds, pixelRatio: number, imageScale: number): { width: number; height: number } {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, pixelRatio, imageScale].every(Number.isFinite) ||
    bounds.width <= 0 || bounds.height <= 0 || pixelRatio <= 0 || imageScale <= 0 || imageScale > 100) throw new Error("The drawing bounds cannot be exported. Your drawing has been kept.");
  const scale = Math.min(pixelRatio * imageScale / 100, 2000 / bounds.width, 2000 / bounds.height);
  return { width: Math.max(1, Math.min(2000, Math.round(bounds.width * scale))),
    height: Math.max(1, Math.min(2000, Math.round(bounds.height * scale))) };
}
/** Una traslación de cámara, nunca una escala. Las referencias se quedan
 * centradas abajo con un hueco de 24px más el desplazamiento guardado; las
 * hojas en blanco conservan su origen centrado. */
export function viewOrigin(width: number, height: number, pan: Offset, referenceHeight = 0): Offset {
  return { x: width / 2 + pan.x,
    y: (referenceHeight > 0 ? height - 24 - referenceHeight / 2 : height / 2) + pan.y };
}
export function referenceBounds(width: number, height: number): Bounds {
  return { x: -width / 2, y: -height / 2, width, height };
}
/** Incluye los extremos redondeados y toda la extensión pintada de cada segmento dependiente de la presión. */
export function inkBounds(history: readonly Stroke[]): Bounds | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stroke of visibleStrokes(history)) {
    for (let i = 0; i < stroke.points.length; i++) {
      const a = stroke.points[Math.max(0, i - 1)]!, b = stroke.points[i]!;
      const radius = strokeWidth(a, b) / 2;
      left = Math.min(left, a.x - radius, b.x - radius); top = Math.min(top, a.y - radius, b.y - radius);
      right = Math.max(right, a.x + radius, b.x + radius); bottom = Math.max(bottom, a.y + radius, b.y + radius);
    }
  }
  return left === Infinity ? undefined : { x: left, y: top, width: right - left, height: bottom - top };
}
/** Independiente de la cámara, el viewport y el historial borrado. Reutiliza el margen existente de 24px. */
export function exportBounds(width: number, height: number, history: readonly Stroke[], padding = 24): Bounds | undefined {
  const ink = inkBounds(history);
  if (!ink) return undefined;
  const reference = referenceBounds(width, height);
  const hasReference = width > 0 && height > 0;
  const x = Math.floor(Math.min(ink.x, hasReference ? reference.x : ink.x) - padding);
  const y = Math.floor(Math.min(ink.y, hasReference ? reference.y : ink.y) - padding);
  const right = Math.ceil(Math.max(ink.x + ink.width, hasReference ? reference.x + width : ink.x + ink.width) + padding);
  const bottom = Math.ceil(Math.max(ink.y + ink.height, hasReference ? reference.y + height : ink.y + ink.height) + padding);
  return { x, y, width: right - x, height: bottom - y };
}
