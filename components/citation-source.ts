import { messageAnchorId, type TutorCitation } from "@/src/core";
import { scrollSessionTarget, type SessionScrollContext } from "./session-navigation";
import { resolveCitationRange, sourceElements } from "./selection-text";

/**
 * Dónde viven en la transcripción las palabras de una cita, mostradas con la CSS
 * Custom Highlight API (el mismo mecanismo que usa la búsqueda en la sesión) para que
 * nunca se toque el marcado de la transcripción, que es propiedad de React.
 */

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): boolean };

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}

/** Las reglas ::highlight() van en un <style> inyectado, nunca en globals.css — la
 * cadena de PostCSS/Tailwind rechaza el pseudoelemento (el precedente de la búsqueda
 * en la sesión). */
const STYLE_ID = "lh-citation-style";
function injectStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
::highlight(lh-citation-comment) { background-color: color-mix(in oklab, var(--primary) 30%, transparent); }
::highlight(lh-citation) { background-color: color-mix(in oklab, var(--primary) 45%, transparent); }`;
	document.head.appendChild(style);
}

/** Pinta un resaltado con nombre sobre un rango; devuelve la limpieza. No hace nada
 * donde falta la Highlight API. */
export function highlightRange(name: "lh-citation" | "lh-citation-comment", range: Range): () => void {
	const highlights = registry();
	if (!highlights) return () => {};
	injectStyles();
	const HighlightCtor = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
	highlights.set(name, new HighlightCtor(range));
	return () => { highlights.delete(name); };
}

// ─── Ir a la fuente ───────────────────────────────────────────────────────────


export type RevealPlan = "navigate" | "highlight" | "message" | "missing";

export function revealPlan({ citationChatId, currentChatId, rangeFound, messageFound }: {
	citationChatId: string; currentChatId: string; rangeFound: boolean; messageFound: boolean;
}): RevealPlan {
	if (citationChatId !== currentChatId) return "navigate";
	if (rangeFound) return "highlight";
	return messageFound ? "message" : "missing";
}

/** La ruta de llegada de los enlaces del grafo: el chat, desplazado hasta el mensaje. */
export function citationSourceHref({ chatId, messageId }: Pick<TutorCitation, "chatId" | "messageId">): string {
	return `/chat/${encodeURIComponent(chatId)}#${encodeURIComponent(messageAnchorId(messageId))}`;
}

let stopPulse: (() => void) | null = null;

/** Exactamente dos pulsos rápidos y se acabó (una breve pausa fija con movimiento reducido). */
export function citationPulseSteps(reducedMotion: boolean): ReadonlyArray<readonly [on: boolean, at: number]> {
	return reducedMotion ? [[true, 0], [false, 750]] : [[true, 0], [false, 250], [true, 500], [false, 750]];
}
function pulse(range: Range, reducedMotion: boolean): void {
	stopPulse?.();
	const steps = citationPulseSteps(reducedMotion);
	let clear: () => void = () => {};
	const timers = steps.map(([on, at]) => window.setTimeout(() => {
		clear();
		clear = on ? highlightRange("lh-citation", range) : () => {};
	}, at));
	stopPulse = () => { timers.forEach((timer) => window.clearTimeout(timer)); clear(); stopPulse = null; };
}

/** Muestra las palabras de una cita: resalta la cita o, si no, hace parpadear su
 * mensaje, o abre el otro chat en ese mensaje. */
export function revealCitationSource({ transcript, scroll, citation, currentChatId, navigate }: {
	transcript: HTMLElement | null;
	scroll: SessionScrollContext | null;
	citation: TutorCitation;
	currentChatId: string;
	navigate: (href: string) => void;
}): RevealPlan {
	const range = transcript && citation.chatId === currentChatId ? resolveCitationRange(transcript, citation.messageId, citation) : null;
	const message = transcript
		? (transcript.ownerDocument.getElementById(messageAnchorId(citation.messageId)) ?? sourceElements(transcript, citation.messageId)[0] ?? null)
		: null;
	const plan = revealPlan({ citationChatId: citation.chatId, currentChatId, rangeFound: range !== null, messageFound: message !== null });
	if (plan === "navigate") navigate(citationSourceHref(citation));
	else if (plan === "highlight" && transcript) {
		scrollSessionTarget(range!, transcript, scroll);
		pulse(range!, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
	} else if (plan === "message" && transcript && message instanceof HTMLElement) {
		scrollSessionTarget(message, transcript, scroll);
		message.classList.add("lh-source-highlight");
		window.setTimeout(() => message.classList.remove("lh-source-highlight"), 2_000);
	}
	return plan;
}
