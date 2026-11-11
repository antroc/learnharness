/** Responsable WAAPI privado, solo de la altura, para DockOverlay. Los fundidos del contenido
 * y las animaciones de los plugins quedan a propósito fuera de la responsabilidad de este controlador. */
const DURATION = 120;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EPSILON = 1;

/** Una altura en línea con !important prevalece sobre WAAPI sin cancelarlo. Medir
 * el envoltorio real conserva los topes max-height del CSS, los bordes y todos los hijos.
 * Restaura aunque el layout lance una excepción; ningún estilo de medición sobrevive a esta llamada. */
export function naturalDockHeight(shell: HTMLElement) {
	const value = shell.style.getPropertyValue("height");
	const priority = shell.style.getPropertyPriority("height");
	try {
		shell.style.setProperty("height", "auto", "important");
		return shell.getBoundingClientRect().height;
	} finally {
		if (value) shell.style.setProperty("height", value, priority);
		else shell.style.removeProperty("height");
	}
}

export function createDockMorph() {
	let previous: { shell: HTMLElement; key: string; height: number } | null = null;
	let owned: {
		shell: HTMLElement; key: string; animation: Animation; opening: boolean;
		target: number; duration: number;
	} | null = null;
	const live = (animation: Animation) => animation.playState !== "finished" && animation.playState !== "idle";
	const cancel = () => {
		owned?.animation.cancel();
		owned = null;
	};
	return {
		/** Ofrece la geometría natural del bloque antes de empezar una transición. La
		 * aparición inicial es instantánea; escribir con la misma clave nunca anima. */
		layout(shell: HTMLElement, key: string, opening: boolean, onNaturalLayout: () => void) {
			if (previous?.shell === shell && previous.key === key) {
				if (owned && live(owned.animation)) return;
				previous.height = shell.getBoundingClientRect().height;
				onNaturalLayout();
				return;
			}
			cancel();
			const height = shell.getBoundingClientRect().height;
			onNaturalLayout();
			if (previous?.shell === shell && Math.abs(previous.height - height) > EPSILON) {
				const animation = shell.animate([
					{ height: `${previous.height}px` }, { height: `${height}px` },
				], { duration: DURATION, easing: EASING });
				owned = { shell, key, animation, opening, target: height, duration: DURATION };
			}
			previous = { shell, key, height };
		},
		/** Se llama después de las restricciones de altura, incluidas las entregas de ResizeObserver
		 * que solo afectan a los hijos. Solo una apertura que ya esté en marcha puede cambiar su destino. */
		retarget(key: string) {
			const active = owned;
			if (!active || active.key !== key || !active.opening || !live(active.animation)) return;
			const effect = active.animation.effect as KeyframeEffect | null;
			if (!effect) return;
			// Lee el punto de partida visible ANTES de saltarse temporalmente WAAPI.
			const visible = active.shell.getBoundingClientRect().height;
			// Conserva el final original de la LÍNEA DE TIEMPO DEL DOCUMENTO, no el tiempo de reloj.
			// Los inicios pendientes pueden tener currentTime null; aún no ha transcurrido
			// tiempo de animación. Una línea de tiempo del documento suspendida tampoco consume ninguno.
			const currentTime = active.animation.currentTime;
			const remaining = active.duration - (typeof currentTime === "number" ? currentTime : 0);
			if (remaining <= 0) return;
			const target = naturalDockHeight(active.shell);
			if (Math.abs(target - active.target) <= EPSILON || !live(active.animation)) return;
			// Reinicia ANTES de acortar la duración: si no, un redireccionamiento tardío podría
			// terminar momentáneamente el efecto en su currentTime antiguo. Todas las escrituras son
			// síncronas, con la altura visible capturada como nuevo primer fotograma.
			active.animation.currentTime = 0;
			effect.setKeyframes([{ height: `${visible}px` }, { height: `${target}px` }]);
			effect.updateTiming({ duration: remaining });
			active.duration = remaining;
			active.target = target;
			if (previous?.key === key) previous.height = target;
		},
		/** La limpieza del efecto de layout también se ejecuta al ocultar con Activity. La
		 * reconexión parte del DOM conservado sin repetir una transición obsoleta. */
		dispose() {
			cancel();
			previous = null;
		},
	};
}
