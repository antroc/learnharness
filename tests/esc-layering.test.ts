import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escAbortTarget } from "../components/chat.tsx";

/**
 * EL ESC POR CAPAS (informe del responsable, 2026-10-04): Esc sobre un overlay abierto
 * (un foco de mermaid, la ventana emergente del plan, el diálogo de configuración) debe CERRAR EL
 * OVERLAY, nunca descartar una pregunta pendiente (ni abortar un turno) que haya debajo.
 * KeyboardShortcuts despacha lh:kbd-abort-turn en cada Esc no reclamado
 * y su listener de window se registra PRIMERO, así que los listeners propios de los overlays
 * nunca pueden adelantarlo: la barrera de estado de ChatView (esta decisión, exportada
 * como función pura) es la defensa. Prioridad = orden de apilamiento.
 */
describe("escAbortTarget (the layered-Esc ruling)", () => {
	const none = { abortAsk: false, mermaidFocus: false, planOpen: false, setupOpen: false, pending: false, problem: false, busy: false };

	it("no overlays: the 2026-10-02 chain stands (question before turn)", () => {
		assert.equal(escAbortTarget({ ...none, pending: true }), "question");
		assert.equal(escAbortTarget({ ...none, busy: true }), "turn");
		assert.equal(escAbortTarget(none), null);
		assert.equal(escAbortTarget({ ...none, pending: true, busy: true }), "question", "a pending question outranks the turn");
	});

	it("an active practice problem sits between question and turn (2026-10-04)", () => {
		assert.equal(escAbortTarget({ ...none, problem: true }), "problem");
		assert.equal(escAbortTarget({ ...none, problem: true, busy: true }), "problem", "the problem card outranks the turn abort");
		assert.equal(escAbortTarget({ ...none, planOpen: true, problem: true }), "plan", "an open popup still outranks the problem");
	});

	it("an open overlay claims Esc over a pending question — the owner's report", () => {
		for (const overlay of ["mermaidFocus", "planOpen", "setupOpen"] as const) {
			const target = escAbortTarget({ ...none, [overlay]: true, pending: true });
			assert.notEqual(target, "question", `${overlay} open must not dismiss the question`);
			assert.notEqual(target, "turn", `${overlay} open must not abort the turn`);
		}
		assert.equal(escAbortTarget({ ...none, mermaidFocus: true, pending: true }), "mermaid");
		assert.equal(escAbortTarget({ ...none, planOpen: true, pending: true }), "plan");
		assert.equal(escAbortTarget({ ...none, setupOpen: true, pending: true }), "setup");
	});

	it("the abort confirm is topmost — its own Esc is claimed by the dialog", () => {
		assert.equal(
			escAbortTarget({ ...none, abortAsk: true, mermaidFocus: true, pending: true }),
			null,
			"never chain: the dialog owns that Esc",
		);
	});

	it("stacking order among overlays: mermaid paints above plan (later in DOM)", () => {
		assert.equal(escAbortTarget({ ...none, mermaidFocus: true, planOpen: true, pending: true }), "mermaid");
	});
});

describe("the side thread's Esc rung (#16, F11)", () => {
	const none = { abortAsk: false, mermaidFocus: false, planOpen: false, setupOpen: false, pending: false, problem: false, busy: false };
	it("an open side thread closes before anything else on the ladder", () => {
		assert.equal(escAbortTarget({ ...none, sideThread: true, busy: true }), "side-thread");
		assert.equal(escAbortTarget({ ...none, sideThread: true, pending: true, planOpen: true, mermaidFocus: true }), "side-thread");
		assert.equal(escAbortTarget({ ...none, sideThread: true, abortAsk: true }), null, "the abort dialog still claims its own Esc");
		assert.equal(escAbortTarget({ ...none, sideThread: false, busy: true }), "turn");
	});
});
