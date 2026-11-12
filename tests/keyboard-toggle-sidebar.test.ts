import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	actionForBinding,
	bindingForAction,
	formatBinding,
	IS_MAC,
	kbdEventForAction,
	KEYBOARD_ACTIONS,
} from "../src/core/keyboard.ts";
import { kbdEventForAction as kbdEventForActionFromUi } from "../components/keyboard-shortcuts.tsx";

/**
 * El interludio del fallo de ⌘B en la barra lateral (responsable, 2026-09-25): ⌘B no hacía nada porque
 * la barra lateral escuchaba el "lh:toggle-sidebar" anterior a la convención mientras el
 * despachador enviaba "lh:kbd-toggle-sidebar". El arreglo es estructural (ambos
 * lados componen el nombre del evento con el ÚNICO auxiliar) y estas fijaciones
 * mantienen unida la cadena: el registro asocia la pulsación a la acción,
 * el auxiliar escribe el evento y el despachador de la interfaz importa el mismo
 * auxiliar (no su propia copia).
 */

describe("kbdEventForAction — the one spelling for action events", () => {
	it("dispatch and listen names are the helper's output", () => {
		assert.equal(kbdEventForAction("toggle-sidebar"), "lh:kbd-toggle-sidebar");
		assert.equal(kbdEventForAction("sessions-search"), "lh:kbd-sessions-search");
	});

	it("the dispatcher imports the same helper (no second spelling exists)", () => {
		assert.equal(kbdEventForActionFromUi, kbdEventForAction);
	});
});

describe("the ⌘B chain — keypress → binding → action → event", () => {
	it("mod+t is the toggle-user-thinking action (owner round, 2026-10-07)", () => {
		assert.equal(actionForBinding("mod+t"), "toggle-user-thinking");
		assert.equal(bindingForAction("toggle-user-thinking"), "mod+t");
		assert.equal(kbdEventForAction("toggle-user-thinking"), "lh:kbd-toggle-user-thinking");
	});

	it("mod+b is the toggle-sidebar action", () => {
		assert.equal(actionForBinding("mod+b"), "toggle-sidebar");
		assert.equal(bindingForAction("toggle-sidebar"), "mod+b");
		assert.equal(formatBinding("mod+b"), IS_MAC ? "⌘B" : "Ctrl+B");
	});

	it("the event the chain ends in is the one the sidebar answers on", () => {
		const action = actionForBinding("mod+b");
		assert.equal(action, "toggle-sidebar");
		assert.equal(kbdEventForAction(action), "lh:kbd-toggle-sidebar");
	});
});

describe("the thinking pill suffix — ⇧⇥ via the registry", () => {
	it("shift+tab uses the platform's modifier label and maps to cycle-thinking", () => {
		assert.equal(actionForBinding("shift+tab"), "cycle-thinking");
		assert.equal(formatBinding("shift+tab"), IS_MAC ? "⇧⇥" : "Shift+⇥");
	});
});

describe("the Alt session cycle is RETIRED (owner, 2026-10-10)", () => {
	// Apenas se usaba y parecía lento: la navegación entre sesiones vive ahora DENTRO de la búsqueda
	// (↑/↓ recorren la lista filtrada, Enter abre; sidebar.tsx).
	it("⌥↑ / ⌥↓ / ⌥↵ bind to NOTHING — no stray action fires", () => {
		assert.equal(actionForBinding("alt+arrowup") ?? null, null);
		assert.equal(actionForBinding("alt+arrowdown") ?? null, null);
		assert.equal(actionForBinding("alt+enter") ?? null, null);
	});

	it("the actions are gone from the table (cheat sheet + settings render the registry)", () => {
		const ids = KEYBOARD_ACTIONS.map((a) => a.id as string);
		assert.ok(!ids.includes("cycle-session-prev"));
		assert.ok(!ids.includes("cycle-session-next"));
		assert.ok(!ids.includes("open-session"));
	});
});