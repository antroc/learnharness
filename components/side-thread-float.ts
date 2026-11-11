/** Geometría del compañero flotante anclado, arrastrado y redimensionado. Solo se excluye
 * la esquina de los controles nativos de macOS; la colocación normal en el navegador
 * y el resto del borde superior del escritorio siguen disponibles. */
import { computeMenuPlacement } from "./menu-shell";

type Rect = { left: number; right: number; top: number; bottom: number };
export type SideThreadViewport = {
	width: number; height: number;
	/** Dimensiones en coordenadas CSS, ya divididas por el zoom de Electron. */
	trafficLights?: { width: number; height: number };
};

/** 26rem, el ancho del popover junto a un pasaje. */
export const SIDE_THREAD_WIDTH = 416;
const EDGE = 8;
const GAP = 8;
const CAP_VH = 0.6;

export interface SideThreadPlacement {
	style: { left: number; width: number; top?: number; bottom?: number };
	maxHeight: number;
}

/** Un panel a todo el ancho no puede ir junto a los controles nativos, así que deja
 * sitio vertical suficiente para caber debajo de ellos, incluso tras encoger la ventana. */
function fitHeight(height: number, width: number, viewport: SideThreadViewport): number {
	const corner = viewport.trafficLights;
	const top = corner && width > viewport.width - corner.width - EDGE ? Math.max(EDGE, corner.height) : EDGE;
	return Math.max(0, Math.min(height, viewport.height - top - EDGE));
}

export function clampDragged(at: { x: number; y: number }, size: { width: number; height: number }, viewport: SideThreadViewport): { x: number; y: number } {
	const maxX = Math.max(EDGE, viewport.width - size.width - EDGE);
	const maxY = Math.max(EDGE, viewport.height - size.height - EDGE);
	let x = Math.max(EDGE, Math.min(at.x, maxX));
	let y = Math.max(EDGE, Math.min(at.y, maxY));
	const corner = viewport.trafficLights;
	if (corner && x < corner.width && y < corner.height) {
		// Gana el borde válido más cercano; nunca reserves una franja superior entera.
		const canRight = corner.width <= maxX;
		const canBelow = corner.height <= maxY;
		if (canRight && (!canBelow || corner.width - x < corner.height - y)) x = corner.width;
		else if (canBelow) y = corner.height;
	}
	return { x, y };
}

export function fitSideThreadFrame(frame: { x: number; y: number; height: number }, width: number, viewport: SideThreadViewport): { x: number; y: number; height: number } {
	const height = fitHeight(frame.height, width, viewport);
	return { ...clampDragged(frame, { width, height }, viewport), height };
}

function clearTrafficLights(placement: SideThreadPlacement, contentHeight: number, viewport: SideThreadViewport): SideThreadPlacement {
	if (!viewport.trafficLights) return placement;
	const { style } = placement;
	const maxHeight = fitHeight(placement.maxHeight, style.width, viewport);
	const height = Math.min(Math.max(0, contentHeight), maxHeight);
	const top = style.top ?? viewport.height - (style.bottom ?? 0) - height;
	const at = clampDragged({ x: style.left, y: top }, { width: style.width, height }, viewport);
	if (at.x === style.left && at.y === top) return { style, maxHeight };
	return { style: { left: at.x, top: at.y, width: style.width }, maxHeight: Math.min(maxHeight, viewport.height - at.y - EDGE) };
}

export function placeSideThread({ kind, rect, viewport, contentHeight }: {
	kind: "composer" | "rect";
	rect: Rect;
	viewport: SideThreadViewport;
	contentHeight: number;
}): SideThreadPlacement {
	if (kind === "composer") {
		return clearTrafficLights({
			style: { left: rect.left, width: rect.right - rect.left, bottom: viewport.height - rect.top + GAP },
			maxHeight: Math.min(CAP_VH * viewport.height, rect.top - GAP - EDGE),
		}, contentHeight, viewport);
	}
	const width = Math.min(SIDE_THREAD_WIDTH, viewport.width - 2 * EDGE);
	const placed = computeMenuPlacement(rect, viewport, contentHeight, "down", "right");
	const right = (placed.style.right as number | undefined) ?? 0;
	const left = Math.max(EDGE, Math.min(viewport.width - right - width, viewport.width - width - EDGE));
	return clearTrafficLights({
		style: {
			left,
			width,
			...(placed.side === "down" ? { top: placed.style.top as number } : { bottom: placed.style.bottom as number }),
		},
		maxHeight: placed.maxHeight,
	}, contentHeight, viewport);
}

/** La altura mínima que permite el redimensionado vertical cuando cabe. */
export const SIDE_THREAD_MIN_HEIGHT = 160;

export type SideThreadFrame = { x: number; y: number; width: number; height: number };
export type SideThreadResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** En ventanas pequeñas, los límites del viewport ganan al mínimo preferido. */
export function fitResizableSideThreadFrame(frame: SideThreadFrame, viewport: SideThreadViewport): SideThreadFrame {
	const width = Math.min(Math.max(0, viewport.width - 2 * EDGE), Math.max(SIDE_THREAD_WIDTH, frame.width));
	return { ...fitSideThreadFrame(frame, width, viewport), width };
}

/** Cada asa mantiene fijo su borde opuesto, salvo cuando el margen de la ventana/los
 * controles nativos lo impide. El redimensionado puramente horizontal no toca la
 * altura actual; el vertical conserva el mínimo de 160px. */
export function resizeSideThread(frame: SideThreadFrame, edge: SideThreadResizeEdge, travel: { x: number; y: number }, viewport: SideThreadViewport): SideThreadFrame {
	const start = fitResizableSideThreadFrame(frame, viewport);
	const minWidth = Math.min(SIDE_THREAD_WIDTH, Math.max(0, viewport.width - 2 * EDGE));
	const minHeight = Math.min(SIDE_THREAD_MIN_HEIGHT, Math.max(0, viewport.height - 2 * EDGE));
	let left = start.x, right = start.x + start.width, top = start.y, bottom = start.y + start.height;
	if (edge.includes("w")) left = Math.max(EDGE, Math.min(right - minWidth, left + travel.x));
	if (edge.includes("e")) right = Math.min(viewport.width - EDGE, Math.max(left + minWidth, right + travel.x));
	if (edge.includes("n")) top = Math.max(EDGE, Math.min(bottom - minHeight, top + travel.y));
	if (edge.includes("s")) bottom = Math.min(viewport.height - EDGE, Math.max(top + minHeight, bottom + travel.y));
	return fitResizableSideThreadFrame({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }, viewport);
}
