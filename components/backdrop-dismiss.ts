"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/** Un clic sintetizado puede tener como destino el fondo aunque el arrastre empezara
 * dentro del diálogo. Se exigen ambos extremos del mismo gesto primario. La captura
 * observa las interacciones de dentro o en portales aunque dejen de propagarse; nunca
 * impide el comportamiento propio de sus botones, menús o selecciones. */
export function useBackdropDismiss(onDismiss: () => void) {
	const gesture = useRef<{
		pointerId: number;
		backdrop: HTMLDivElement;
		released: boolean;
	} | null>(null);

	return {
		onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
			gesture.current = event.isPrimary && event.button === 0 && event.target === event.currentTarget
				? { pointerId: event.pointerId, backdrop: event.currentTarget, released: false }
				: null;
			// El táctil puede capturar implícitamente el puntero al pulsar. Se deja que la
			// liberación vaya al elemento real alcanzado, no a un fondo que quedó detrás.
			if (gesture.current && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
			const press = gesture.current;
			gesture.current = press && press.pointerId === event.pointerId &&
				event.isPrimary && event.button === 0 && event.target === event.currentTarget &&
				press.backdrop === event.currentTarget
				? { ...press, released: true }
				: null;
		},
		onPointerCancelCapture() {
			gesture.current = null;
		},
		onClickCapture(event: MouseEvent<HTMLDivElement>) {
			const press = gesture.current;
			gesture.current = null;
			if (press?.released && press.backdrop === event.currentTarget &&
				event.button === 0 && event.target === event.currentTarget) {
				// El callback de este render conserva las protecciones de ocupado y las props actuales.
				onDismiss();
			}
		},
	};
}
