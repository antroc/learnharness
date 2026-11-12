import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	CoverageMenuBody,
	CoverageRingDetail,
	CoverageRingGlyph,
	fetchGraphRead,
	ringFill,
	type SessionCoverage,
} from "../components/extraction-coverage.tsx";

/**
 * Las superficies de cobertura de extracción (rediseño de la UX de extracción,
 * encargo cerrado por el responsable el 2026-09-24): el bloque del menú
 * contextual de la barra lateral (cifras + la indicación manual Extract) y el
 * medidor de anillo de la barra superior del chat. Aquí se fijan los plegados
 * puros y los cuerpos de presentación; las cadenas de peticiones en vivo (la
 * lectura al abrir el menú, el sondeo de 2s en ejecución, el empujón al
 * asentarse el turno, la señal de ajustes) son terreno de Playwright.
 */

function coverage(over: Partial<SessionCoverage> = {}): SessionCoverage {
	return {
		totalMessages: 12,
		coveredCount: 7,
		uncoveredCount: 5,
		coveredTokens: 30_000,
		uncoveredTokens: 2_048,
		running: false,
		lastFoldedAt: null,
		...over,
	};
}

describe("fetchGraphRead — one truth with the extraction trigger (2026-10-02)", () => {
	// El denominador del medidor DEBE ser la cifra que espera la barrera de
	// effectiveSettings del servidor. La antigua alternativa hecha a mano
	// leía el delta en bruto y suponía `?? 4096` (una constante obsoleta de antes de
	// los ajustes), así que un presupuesto sin fijar llenaba el anillo a la mitad de lo real
	// (reproducción del responsable: 6k mostrado lleno, la extracción callada con razón con
	// el valor de fábrica de entonces, 8192). La decisión del 2026-10-13 devolvió el valor de fábrica a 4096 (más
	// actualizaciones del grafo); la LEY no cambia: el denominador es el valor de
	// fábrica que sirve el mismo resolvedor del núcleo, nunca una constante hecha a mano.
	const stub = (payload: unknown, ok = true) => {
		const real = globalThis.fetch;
		globalThis.fetch = (async () =>
				new Response(JSON.stringify(payload), { status: ok ? 200 : 500 })) as typeof fetch;
		return () => {
			globalThis.fetch = real;
		};
	};

	it("an absent graph section denominates at the factory 4096 — never a hand-rolled constant, never a missing ring", async () => {
		const restore = stub({ settings: { version: 1 } });
		const read = await fetchGraphRead();
		restore();
		assert.deepEqual(read, { enabled: true, chunkTokens: 4096 });
	});

	it("the owner repro shape — graph section present, budget never written — is the factory", async () => {
		const restore = stub({ settings: { version: 1, graph: { enabled: true } } });
		const read = await fetchGraphRead();
		restore();
		assert.equal(read?.chunkTokens, 4096, "the record lacks the key: factory, not a stale constant");
	});

	it("first boot (settings null) resolves factory — the ring shows, at the true budget", async () => {
		const restore = stub({ settings: null });
		const read = await fetchGraphRead();
		restore();
		assert.deepEqual(read, { enabled: true, chunkTokens: 4096 });
	});

	it("a custom budget rides through verbatim", async () => {
		const restore = stub({ settings: { version: 1, graph: { enabled: true, extractionChunkTokens: 2000 } } });
		const read = await fetchGraphRead();
		restore();
		assert.equal(read?.chunkTokens, 2000);
	});

	it("fetch failure → null → no ring", async () => {
		const restore = stub({}, false);
		const read = await fetchGraphRead();
		restore();
		assert.equal(read, null);
	});
});

describe("ringFill (the donut's fold, pure)", () => {
	it("fills uncovered/chunk, clamped to [0,1]", () => {
		assert.equal(ringFill(0, 4096), 0);
		assert.equal(ringFill(2048, 4096), 0.5);
		assert.equal(ringFill(4096, 4096), 1);
		assert.equal(ringFill(999_999, 4096), 1, "past the threshold reads full, never >1");
	});

	it("a non-positive threshold reads zero (never NaN, never a fake full)", () => {
		assert.equal(ringFill(2048, 0), 0);
		assert.equal(ringFill(2048, -5), 0);
	});
});

describe("CoverageMenuBody — the context-menu block", () => {
	it("renders the uncovered numbers + the Extract affordance", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage"'), "the block carries its testid");
		assert.match(html, /2k tok uncovered/, "the unit is typed out — tok (owner refinement round)");
		assert.match(html, /5 messages unextracted/);
		assert.ok(html.includes('data-testid="ctx-extract"'), "the Extract affordance");
		assert.ok(!html.includes('disabled=""'), "an uncovered session can extract (the disabled: utilities alone don't count)");
	});

	it("fully extracted: the quiet line, Extract disabled (never a fake run)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody
				coverage={coverage({ uncoveredTokens: 0, uncoveredCount: 0 })}
				extracting={false}
				onExtract={() => {}}
			/>,
		);
		assert.match(html, /fully extracted/);
		assert.ok(html.includes("disabled"), "nothing to run — the button rests");
	});

	it("running: the pulse line + 'Running', not the numbers (motion is the state)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage({ running: true })} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'));
		assert.match(html, /extracting…/);
		assert.ok(html.includes(">Running</button>"), "the affordance reads Running while in flight");
		assert.ok(html.includes("disabled"), "no double-fire");
	});

	it("optimistic (click-pending, server not yet saying running): same running shape", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'), "the optimistic state shows at once");
		assert.match(html, />Running</);
	});
});

describe("CoverageRingGlyph — the donut", () => {
	it("half fill: the arc covers half the circumference", () => {
		const html = renderToStaticMarkup(<CoverageRingGlyph fill={0.5} running={false} />);
		const C = 2 * Math.PI * 6;
		assert.ok(html.includes(`stroke-dasharray="${0.5 * C} ${C}"`), "fill = uncovered share of the ring");
		assert.ok(html.includes("rotate(-90"), "the arc starts at 12 o'clock");
		assert.ok(!html.includes("animate-pulse"), "steady state is still");
	});

	it("empty fill renders the bare track (no arc beyond a hairline)", () => {
		const html = renderToStaticMarkup(<CoverageRingGlyph fill={0} running={false} />);
		const C = 2 * Math.PI * 6;
		assert.ok(html.includes(`stroke-dasharray="0 ${C}"`));
	});

	it("running: the whole ring pulses (motion = the working-state signal)", () => {
		const html = renderToStaticMarkup(<CoverageRingGlyph fill={0.3} running />);
		assert.ok(html.includes("animate-pulse"), "the implementer's visual call: pulse, not a spinner");
	});
});

describe("CoverageRingDetail — the popover's exact numbers", () => {
	it("carries covered/uncovered tokens, messages, the threshold, the last fold", () => {
		const html = renderToStaticMarkup(
			<CoverageRingDetail
				coverage={coverage({ lastFoldedAt: "2026-09-24T10:00:00Z" })}
				chunkTokens={4096}
			/>,
		);
		assert.match(html, /Uncovered.*2k tokens/s);
		assert.match(html, /Covered.*30k tokens/s);
		assert.match(html, /7 \/ 12/);
		assert.match(html, /Chunk threshold.*4\.1k tokens/s);
		assert.match(html, /Last extraction/);
		assert.ok(!html.includes('data-testid="coverage-ring-running"'), "idle: no status line");
	});

	it("no fold yet renders '—' (never a fake timestamp)", () => {
		const html = renderToStaticMarkup(<CoverageRingDetail coverage={coverage()} chunkTokens={4096} />);
		assert.match(html, /Last extraction.*—/s);
	});

	it("running: the extracting… status line", () => {
		const html = renderToStaticMarkup(
			<CoverageRingDetail coverage={coverage({ running: true })} chunkTokens={4096} />,
		);
		assert.ok(html.includes('data-testid="coverage-ring-running"'));
		assert.match(html, /extracting…/);
	});
});