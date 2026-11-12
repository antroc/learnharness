/**
 * Pruebas de render de las filas de sesión: el lenguaje de estado del selector
 * (responsable, ronda de color mínimo): UN indicador, el spinner braille,
 * presente SOLO mientras hay un turno de enseñanza en curso; cualquier otro
 * estado (en reposo, pregunta pendiente) no renderiza nada: las fases solo
 * avanzan, así que la fase como señal era decoración, y la pregunta pendiente
 * es el estado DE REPOSO dominante (lo lleva el texto de la línea de
 * metadatos). Función pura del elemento de la lista, así que el SSR de
 * <SessionRow> fija todos los estados visibles. El mismo parche de JSX clásico
 * de tsx que render-cards.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionRow, timeAgo } from "../components/sidebar.tsx";
import type { ChatListItem } from "../src/core/index.ts";

function item(overrides: Partial<ChatListItem>): ChatListItem {
	return {
		id: "c1",
		title: "Test session",
		kind: "teach",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4,
		phase: "probe",
		pendingQuestion: false,
		pendingProblem: false,
		busy: false,
		compacting: false,
		...overrides,
	};
}

function render(chat: ChatListItem, active = false) {
	return renderToStaticMarkup(<SessionRow chat={chat} active={active} onOpen={() => {}} />);
}

describe("SessionRow", () => {
	it("no phase strips, no phase colors — the retired decoration", () => {
		const html = render(item({ phase: "teach" }));
		assert.ok(!html.includes("phase-strip"), "strip removed by design (too busy)");
		assert.ok(!html.includes("bg-phase-"), "phase fills are retired app-wide");
		assert.ok(!html.includes("border-phase-"), "phase rings are retired app-wide");
	});

	it("idle session: NO indicator — absence is the state", () => {
		for (const phase of ["probe", "plan", "teach"] as const) {
			const html = render(item({ phase }));
			assert.ok(!html.includes("session-dot"), "no dots — the status language is spinner-only");
			assert.ok(!html.includes("braille-spinner"), "idle never shows the spinner");
		}
	});

	it("a pending question renders NO indicator — resting state, carried by the meta text", () => {
		const html = render(item({ phase: "teach", pendingQuestion: true }));
		assert.ok(!html.includes("session-dot"), "no dots");
		assert.ok(!html.includes("braille-spinner"), "motion is reserved for working");
		assert.ok(html.includes("Waiting for input"), "the meta line's text");
		assert.ok(!html.includes("Waiting for your answer"), "old wording is gone");
	});

	it("a working session (turn in flight) renders the braille spinner — the ONLY indicator", () => {
		const html = render(item({ phase: "plan", busy: true }));
		assert.ok(html.includes('data-testid="braille-spinner"'), "the spinner");
		assert.ok(html.includes("braille-frame"), "CSS-animated frames");
		assert.ok((html.match(/class="braille-frame"/g) ?? []).length === 10, "all ten frames");
		assert.ok(html.includes('data-frame="0"'), "frame 0 leads (static fallback)");
		assert.ok(html.includes("Working"), "accessible label");
		assert.ok(!html.includes("bg-attention"), "no colored state fill — monochrome by design");
	});

	it("busy does not double-signal background agents (that is the sidebar section's channel)", () => {
		// El estrechamiento vive en la ruta de la API (busy = solo isTurnRunning);
		// la fila en sí se limita a renderizar busy con fidelidad. Se fija aquí para que
		// el contrato no pueda volver a ampliarse en silencio: una fila «trabajando» solo
		// por la extracción sería una señal doble.
		const html = render(item({ busy: true, pendingQuestion: false }));
		assert.ok(html.includes("Working"), "the spinner's label names the turn, not agents");
	});

	it("the meta line: state replaces the count when the state is the useful fact", () => {
		// Mediodía local: timeAgo renderiza la fecha local, así que un instante UTC fijo
		// cae en 2026-01-01 al oeste de UTC.
		const awaiting = render(item({ pendingQuestion: true, updatedAt: new Date(2026, 0, 2, 12).toISOString() }));
		assert.ok(awaiting.includes("Waiting for input · 2026-01-02"), "awaiting meta keeps the existing date");
		assert.ok(!awaiting.includes("messages"), "count yields to the state");
		assert.ok(!awaiting.includes("braille-spinner"), "…and the spinner stays off");

		const working = render(item({ busy: true }));
		assert.ok(working.includes("Working…"), "working meta");

		// Responsable, ronda 5 de tipografía: se quita el recuento de mensajes: no
		// ayudaba a decidir nada. Los metadatos en reposo son solo hace cuánto.
		const idle = render(item({ title: "Partial derivatives", messageCount: 7 }));
		assert.ok(idle.includes("Partial derivatives"));
		assert.ok(!idle.includes("messages"), "the count is gone (flip-flop: one line in sessionMeta)");
		assert.match(idle, /\d{4}-\d{2}-\d{2}/, "idle shows the ISO date");
	});

	it("pending questions use the same wording for teach and practice with recent and old dates", () => {
		for (const kind of ["teach", "practice"] as const) {
			for (const updatedAt of [new Date().toISOString(), "2025-06-02T12:00:00.000Z"]) {
				const html = render(item({ kind, pendingQuestion: true, updatedAt }));
				assert.ok(html.includes(`Waiting for input · ${timeAgo(updatedAt)}`));
				assert.ok(!html.includes("Waiting for your answer"));
			}
		}
	});

	it("compacting retains priority over pending input", () => {
		const html = render(item({ compacting: true, pendingQuestion: true }));
		assert.match(html, /Compacting context ·/);
		assert.doesNotMatch(html, /Waiting for input/);
	});

	it("active row is visually marked by the background alone (owner, round 5: no weight change)", () => {
		const html = render(item({}), true);
		assert.ok(html.includes("bg-accent"), "active background");
		assert.ok(!html.includes("font-medium"), "weight is not a second channel doing the same job");
	});
});

describe("timeAgo", () => {
	const now = new Date("2026-01-02T12:00:00.000Z");

	it("just now / minutes / hours / days, then the ISO date (owner, round 5)", () => {
		assert.equal(timeAgo("2026-01-02T11:59:30.000Z", now), "just now");
		assert.equal(timeAgo("2026-01-02T11:55:00.000Z", now), "5m ago");
		assert.equal(timeAgo("2026-01-02T09:00:00.000Z", now), "3h ago");
		assert.equal(timeAgo("2025-12-31T12:00:00.000Z", now), "2d ago");
		// Mediodía local, para que la fecha local sea 2025-06-02 en cualquier zona horaria.
		const old = new Date(2025, 5, 2, 12).toISOString();
		assert.equal(timeAgo(old, now), "2025-06-02", "beyond a week: ISO — unambiguous, sortable");
	});

	it("negative drift (clock skew) reads as just now, never a future date", () => {
		assert.equal(timeAgo("2026-01-02T12:01:00.000Z", now), "just now");
	});
});

describe("SessionRow practice badge (practice sessions, 2026-10-04)", () => {
	it("a practice row carries the dumbbell badge and the unified Working meta while busy (owner, 2026-10-10)", () => {
		const html = render(item({ kind: "practice", busy: true }));
		assert.match(html, /Working…/);
		assert.doesNotMatch(html, /Practicing…/);
		assert.match(html, /aria-label="Practice session"/);
	});

	it("a teaching row carries neither", () => {
		const html = render(item({}));
		assert.doesNotMatch(html, /Practice session/);
		assert.doesNotMatch(html, /Practicing…/);
	});

	it("busy teaching rows say the same unified Working", () => {
		const html = render(item({ busy: true }));
		assert.match(html, /Working…/);
	});

	it("a practice row with a posed problem says the problem is waiting", () => {
		const html = render(item({ kind: "practice", pendingProblem: true }));
		assert.match(html, /Problem waiting ·/);
	});
});
