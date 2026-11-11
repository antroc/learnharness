"use client";

/**
 * HIGIENE DEL FOCO — los controles transitorios de la transcripción no
 * conservan el foco (responsable, ronda de teclado 2026-10-10). Un clic de
 * puntero en un conmutador de razonamiento, un botón de copiar o un chip de plan
 * solía DEJAR el foco en ese botón; el siguiente Enter del alumno volvía entonces
 * a activar el conmutador en vez de enviar (ver enter-submits.ts para la otra
 * mitad del arreglo). Aquí restauramos, tras la activación con puntero,
 * exactamente el estado que produce hacer clic en un espacio vacío de la
 * transcripción: el foco vuelve al body — Enter envía, las flechas recorren las
 * filas de la pregunta, nada se vuelve a conmutar. A propósito NO se enfoca un
 * campo de texto: un campo enfocado se quedaría con las flechas como movimientos
 * del cursor, en contra de la ley de las flechas siempre (responsable, 2026-10-10).
 *
 * Los clics activados con teclado no se tocan: e.detail === 0 marca el clic
 * sintetizado de Enter/Espacio sobre un botón enfocado con teclado — quien usa el
 * teclado conserva su foco.
 */

/** Se engancha como onClick de un control transitorio (o se compone en él): quita
 *  el foco al control después de los clics de PUNTERO (los clics de teclado
 *  conservan el foco). Tipado pato seguro en Node — no hace falta el global
 *  HTMLElement (el banco de pruebas ejecuta Node pelado con linkedom). */
export function blurAfterPointerClick(e: {
	detail: number;
	currentTarget: EventTarget | null;
}): void {
	if (e.detail === 0) return;
	const el = e.currentTarget as { blur?: unknown } | null;
	if (el && typeof el.blur === "function") (el.blur as () => void).call(el);
}
