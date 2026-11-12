/**
 * enter-submits + focus-hygiene: la separación de Enter entre puntero y teclado y el
 * blur de los controles transitorios (responsable, ronda de teclado 2026-10-10).
 *
 * La regresión que esto fija: hacer clic en un control de la transcripción (un conmutador
 * de razonamiento) dejaba el foco en su <button>; el siguiente Enter del alumno volvía a activar
 * el conmutador en vez de enviar. La ley ahora: Enter desde un botón de la transcripción
 * con foco por PUNTERO envía (el listener de window además hace
 * preventDefault, suprimiendo la activación por defecto que hay debajo);
 * los botones con foco por teclado y los botones dentro de overlays abiertos (los menús recorren
 * el foco con las flechas, los diálogos son su propia capa) conservan el Enter nativo.
 */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import { buttonKeepsNativeEnter } from "../components/enter-submits.ts";
import { blurAfterPointerClick } from "../components/focus-hygiene.ts";

const { document } = parseHTML("<html><body></body></html>");

function buttonIn(attrs: Record<string, string>): HTMLElement {
	const host = document.createElement("div");
	for (const [k, v] of Object.entries(attrs)) host.setAttribute(k, v);
	const b = document.createElement("button");
	b.type = "button";
	host.appendChild(b);
	document.body.appendChild(host);
	return b;
}

describe("buttonKeepsNativeEnter (the pointer/keyboard Enter split)", () => {
	it("a transcript button (pointer-focused) does NOT keep native Enter — Enter submits", () => {
		const b = buttonIn({});
		assert.equal(buttonKeepsNativeEnter(b), false);
	});

	it("a keyboard-focused button keeps native Enter (:focus-visible)", () => {
		const b = buttonIn({});
		// linkedom no tiene el pseudoelemento: sustituye la única llamada que hace el auxiliar.
		(b as unknown as { matches: (sel: string) => boolean }).matches = (sel: string) =>
			sel === ":focus-visible";
		assert.equal(buttonKeepsNativeEnter(b), true);
	});

	it("buttons inside overlays keep native Enter: hand-rolled menu, Radix popper, dialog, menu role", () => {
		assert.equal(buttonKeepsNativeEnter(buttonIn({ "data-lh-menu": "" })), true);
		assert.equal(
			buttonKeepsNativeEnter(buttonIn({ "data-radix-popper-content-wrapper": "" })),
			true,
		);
		assert.equal(buttonKeepsNativeEnter(buttonIn({ role: "dialog" })), true);
		assert.equal(buttonKeepsNativeEnter(buttonIn({ role: "menu" })), true);
	});

	it("a selector engine without :focus-visible degrades to pointer-focus, never throws", () => {
		const b = buttonIn({});
		assert.doesNotThrow(() => buttonKeepsNativeEnter(b));
		assert.equal(buttonKeepsNativeEnter(b), false);
	});
});

describe("blurAfterPointerClick (focus hygiene)", () => {
	it("a POINTER click (detail > 0) blurs the transient control", () => {
		const b = buttonIn({});
		let blurred = false;
		b.blur = () => {
			blurred = true;
		};
		blurAfterPointerClick({ detail: 1, currentTarget: b });
		assert.equal(blurred, true);
	});

	it("a KEYBOARD-activated click (detail 0) keeps focus", () => {
		const b = buttonIn({});
		let blurred = false;
		b.blur = () => {
			blurred = true;
		};
		blurAfterPointerClick({ detail: 0, currentTarget: b });
		assert.equal(blurred, false);
	});
});
