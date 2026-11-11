import { useEffect, type RefObject } from "react";
import { useInteractionLayer, useInteractionLayers } from "./interaction-layers";

/**
 * Cierre al descartar para los paneles flotantes (cromo del grafo,
 * 2026-09-17): cualquier pointerdown que caiga FUERA de la raíz del control
 * lo cierra; Escape también. La raíz contiene tanto el botón de alternar
 * como el panel, así que los clics en el propio botón del control se quedan
 * "dentro" — su alternancia sigue funcionando —, mientras que un clic en un
 * botón hermano del cromo cuenta como externo: pointerdown cierra primero el
 * panel abierto y luego el clic del hermano abre el suyo. Por tanto, nunca
 * puede haber dos desplegables abiertos a la vez.
 */
export function usePopoverDismiss(
	rootRef: RefObject<HTMLElement | null>,
	open: boolean,
	close: () => void,
	options?: { layerRootRef?: RefObject<HTMLElement | null>; ownerId?: string },
) {
	const controller = useInteractionLayers();
	const panel = options?.layerRootRef ?? rootRef;
	const layer = useInteractionLayer({ kind: "popup", enabled: open, rootRef: panel, anchorRef: rootRef, ownerId: options?.ownerId,
		onClose: () => { close(); return "closed"; } });
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!controller.isElementEligible(panel.current)) return;
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open, close, rootRef, panel, controller]);
	return layer;
}
