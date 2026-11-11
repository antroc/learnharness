"use client";

/**
 * ENTER ENVÍA — esté donde esté el foco (ronda 6 del responsable, 2026-10-05).
 * La realidad del dictado: el alumno dicta en el campo del dock sin enfocarlo
 * nunca, así que Enter debe enviar desde CUALQUIER SITIO — foco en el body, tras
 * un scroll, un enlace suelto. El propio manejador de Enter del campo se sigue
 * disparando primero cuando SÍ está enfocado (este oyente está a nivel de
 * window, la última parada del burbujeo) — una ley, dos puntos de entrada, sin
 * doble envío (el manejador del campo enfocado reclama el evento con su propio
 * keydown; este hook se salta por completo las superficies de escritura).
 *
 * Lo que el oyente de window se niega a tocar:
 * - las superficies de escritura (input/textarea/select/contenteditable) — la
 *   superficie enfocada es responsable de su Enter (el campo del dock, el
 *   compositor, los ajustes);
 * - Enter con modificadores (⇧↵ es un salto de línea, ⌘/Ctrl↵ pertenece a la superficie).
 *
 * BOTONES — la división puntero/teclado (responsable, ronda de teclado
 * 2026-10-10): un clic de ratón en un control de la transcripción (un conmutador
 * de razonamiento, un botón de copiar) deja el foco EN ese botón; el siguiente
 * Enter del alumno debe ENVIAR, no volver a activar el conmutador — el informe
 * del que nació esta regla. Pero dos poblaciones de botones conservan la
 * activación nativa con Enter:
 *   1. los botones enfocados CON TECLADO — :focus-visible significa que el foco
 *      llegó por teclado (los menús que se recorren con flechas; Tab está muerto
 *      en toda la app, así que esto solo ocurre dentro de overlays);
 *   2. los botones dentro de un OVERLAY ABIERTO — los menús recorren el foco con
 *      flechas y Enter activa de forma nativa el botón recorrido (el contrato de
 *      menu-shell); los diálogos son su propia capa expuesta (las capas de la
 *      LEY DE UN SOLO ESC).
 * El botón de la transcripción en el que se hizo clic con el puntero no supera
 * ninguna de las dos pruebas → el Enter es nuestro (preventDefault también
 * suprime la activación por defecto del navegador, así que el conmutador no se
 * dispara por debajo del envío).
 *
 * Los callbacks de envío se protegen solos (razonamiento vacío / canSubmit) —
 * este hook nunca comprueba la validez de la respuesta, solo la honestidad del foco.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { pluginQuestionKeySuppressed, composingQuestionKey } from "./plugin-question-keys";
import { isTypingSurface } from "@/src/core";

/** Raíces de overlay cuyos botones conservan el Enter nativo (los menús hechos a
 *  mano se marcan con data-lh-menu; los poppers/diálogos de Radix llevan sus propios atributos). */
const OVERLAY_ROOTS = '[data-lh-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"]';

/** Decisión pura, exportada para las fijaciones: ¿un BOTÓN enfocado conserva el
 *  Enter nativo (true) o el Enter corresponde al envío (false)? */
export function buttonKeepsNativeEnter(el: HTMLElement): boolean {
	// Foco recorrido con teclado: las flechas del menú llegaron aquí — Enter activa.
	// (Protegido: un motor de selectores sin la pseudoclase — linkedom en el
	// banco de pruebas — degrada a «no es foco de teclado», nunca lanza una excepción en
	// cada Enter.)
	try {
		if (el.matches(":focus-visible")) return true;
	} catch {
		// pseudoclase no soportada — se trata como foco de puntero
	}
	// Dentro de un overlay abierto: el overlay es responsable de sus teclas.
	return !!el.closest(OVERLAY_ROOTS);
}

/** Con ámbito de montaje: mientras el dock está montado (hay un problema/una
 *  pregunta activa), un Enter normal en cualquier sitio fuera de una superficie
 *  de escritura o de un botón lo envía. */
export function useEnterSubmits(submit: () => void, scopeRef?: RefObject<HTMLElement | null>): void {
	const controller = useOptionalInteractionLayers();
	const submitRef = useRef(submit);
	submitRef.current = submit;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.defaultPrevented || pluginQuestionKeySuppressed(e) || composingQuestionKey(e)) return;
			if (!isInteractionScopeEligible(scopeRef ? scopeRef.current : document.body, controller)) return;
			if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (isTypingSurface(e)) return;
			const target = e.target as HTMLElement | null;
			if (target?.tagName === "BUTTON" && buttonKeepsNativeEnter(target)) return;
			e.preventDefault();
			submitRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [controller, scopeRef]);
}
