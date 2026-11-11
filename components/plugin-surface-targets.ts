import type { PluginSurfaceTarget } from "@/src/core";
import type { InteractionLayersController } from "./interaction-layers";

/** Registro privado y vivo de instancias de vista. Los tokens no llevan datos de enrutado serializables. */
export interface SurfaceBoundary {
	target: PluginSurfaceTarget;
	body: HTMLElement;
	stack: HTMLElement | null;
	signal: AbortSignal;
	controller: InteractionLayersController;
	remembered: WeakMap<HTMLElement, HTMLElement>;
}
const boundaries = new WeakMap<PluginSurfaceTarget, SurfaceBoundary>();
const currentPages = new WeakMap<Document, SurfaceBoundary>();

export function registerSurfaceBoundary(body: HTMLElement, signal: AbortSignal, controller: InteractionLayersController): SurfaceBoundary {
	const target = Object.freeze({}) as PluginSurfaceTarget;
	// El DOM hijo se confirma antes de los efectos de layout de la página, mientras que el
	// callback de montaje de una vista puede ejecutarse antes del efecto de seguimiento de SurfaceRegion guiado por el destino.
	// Vincula solo la región directa ya montada de este cuerpo y su ranura de montaje.
	const HtmlElement = body.ownerDocument.defaultView?.HTMLElement;
	const stack = Array.from(body.children).find((child): child is HTMLElement =>
		!!HtmlElement && child instanceof HtmlElement && child.isConnected && child.hasAttribute("data-session-surface-region") &&
		Array.from(child.children).some(mount => mount instanceof HtmlElement && mount.hasAttribute("data-session-surface-mounts")));
	const boundary: SurfaceBoundary = { target, body, stack: stack ?? null, signal, controller, remembered: new WeakMap() };
	if (signal.aborted) return boundary;
	boundaries.set(target, boundary);
	currentPages.set(body.ownerDocument, boundary);
	signal.addEventListener("abort", () => {
		boundaries.delete(target);
		if (currentPages.get(body.ownerDocument) === boundary) currentPages.delete(body.ownerDocument);
	}, { once: true });
	return boundary;
}

export function findSurfaceBoundary(target: PluginSurfaceTarget | undefined): SurfaceBoundary | undefined {
	if (!target) return;
	const boundary = boundaries.get(target);
	return boundary && !boundary.signal.aborted && boundary.body.isConnected ? boundary : undefined;
}

/** Captura la página activa una vez; nunca recurras a una página retenida más antigua. */
export function findCurrentSurfaceBoundary(document: Document): SurfaceBoundary | undefined {
	return findSurfaceBoundary(currentPages.get(document)?.target);
}

export function requireSurfaceBoundary(target: PluginSurfaceTarget | undefined): SurfaceBoundary {
	const boundary = findSurfaceBoundary(target);
	if (!boundary?.stack?.isConnected) throw new Error("Surface target is no longer active");
	return boundary;
}
