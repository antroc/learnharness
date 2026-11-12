/**
 * Pruebas de src/core/cost-summary.ts: el plegado puro de la píldora de coste del grafo.
 * Las mismas leyes que el canal del dinero en todas partes: los dólares se INFIEREN al
 * leer (core/prices.ts), los modelos sin precio se excluyen pero se cuentan (se muestra
 * "—", nunca un cero silencioso) y los tokens siempre se suman.
 */

import assert from "node:assert/strict";
import { describe, it as test } from "node:test";
import {
	graphCostSummary as foldGraphCostSummary,
	type CostSummaryInput,
	type GraphCostSummary,
} from "../src/core/cost-summary.ts";
import type { CallUsage, ExtractionRunUsage } from "../src/core/contracts.ts";
import { callCost } from "../src/server/pricing.ts";
const graphCostSummary = (input: CostSummaryInput) => foldGraphCostSummary(input, callCost);

/** Un modelo con el precio publicado completo (del registro generado). */
const PRICED = "openrouter:z-ai/glm-5.3-flash";
assert.notEqual(callCost({ inputTokens: 1, outputTokens: 1 }, PRICED), null);

const step = (input: number, output: number): CallUsage => ({
	inputTokens: input,
	outputTokens: output,
	cacheReadTokens: 0,
	cacheWriteTokens: undefined,
	reasoningTokens: 0,
});

const extractionRun = (
	startedAt: number,
	extractorModel: string,
	auditorModel: string,
	stats?: ExtractionRunUsage["stats"],
): ExtractionRunUsage => ({
	startedAt,
	at: new Date(startedAt).toISOString(),
	durationMs: 10_000,
	stages: {
		extractor: { model: extractorModel, steps: [step(1000, 200)] },
		auditor: { model: auditorModel, steps: [step(2000, 100)] },
	},
	...(stats ? { stats } : {}),
});

describe("graphCostSummary (the cost pill's fold)", () => {
	test("folds both channels: stage totals, tokens, newest-first runs", () => {
		// (El canal de nombrado de clústeres murió con el cierre de la UX de extracción,
		// 2026-09-24: dos canales, las puertas de entrada del chat + las notas).
		const input: CostSummaryInput = {
			chats: [{ title: "Testing session", extractions: [extractionRun(100, PRICED, PRICED)] }],
			sources: [{ filePath: "/vault/modal.md", extractions: [extractionRun(200, PRICED, PRICED)] }],
		};
		const s = graphCostSummary(input);
		const extStep = callCost(step(1000, 200), PRICED)!;
		const audStep = callCost(step(2000, 100), PRICED)!;
		assert.equal(s.stages.extraction.dollars, extStep * 2);
		assert.equal(s.stages.audit.dollars, audStep * 2);
		assert.equal(s.stages.extraction.runs, 2);
		assert.equal(s.stages.extraction.tokens.inputTokens, 2000);
		assert.equal(s.stages.audit.tokens.outputTokens, 200);
		assert.equal(s.totalDollars, extStep * 2 + audStep * 2);
		// Ambas ejecuciones, la más reciente primero, con los títulos unidos por puerta de entrada; toda
		// ejecución es ahora de tipo "extraction".
		assert.deepEqual(
			s.runs.map((r) => r.title),
			["/vault/modal.md", "Testing session"],
		);
		assert.deepEqual(s.runs.map((r) => r.kind), ["extraction", "extraction"]);
		assert.equal(s.unpricedRuns, 0);
	});

	test("unpriced models: excluded dollars, counted honestly, run null only when BOTH stages unpriced", () => {
		const s: GraphCostSummary = graphCostSummary({
			chats: [{ title: "partial", extractions: [extractionRun(100, PRICED, "unknown-model")] }],
			sources: [{ filePath: "/vault/x.md", extractions: [extractionRun(200, "unknown-model", "unknown-model")] }],
		});
		assert.equal(s.stages.audit.unpricedRuns, 2);
		assert.equal(s.stages.audit.dollars, 0); // nunca un cero silencioso: unpricedRuns lo dice
		assert.equal(s.stages.extraction.unpricedRuns, 1);
		// La ejecución parcial sigue poniendo precio a su lado del extractor; la ejecución
		// totalmente sin precio muestra "—". La más reciente primero: 200 (ambas sin precio), 100.
		assert.equal(s.runs[0]!.dollars, null);
		assert.notEqual(s.runs[1]!.dollars, null);
		assert.equal(s.unpricedRuns, 1); // a nivel de ejecución: solo la ejecución con ambas etapas
	});

	test("recent runs cap: newest survive", () => {
		const extractions = [1, 2, 3, 4].map((n) => extractionRun(n * 100, PRICED, PRICED));
		const s = graphCostSummary({
			chats: [{ title: "chat", extractions }],
			sources: [],
			recentCap: 2,
		});
		assert.equal(s.runs.length, 2);
		assert.deepEqual(s.runs.map((r) => r.startedAt), [400, 300]);
		// los totales por etapa siguen contando TODAS las ejecuciones; el tope es de presentación.
		assert.equal(s.stages.extraction.runs, 4);
	});

	test("failed runs carry no merged stats; empty input folds to zero", () => {
		const s = graphCostSummary({
			chats: [{ title: "failed", extractions: [extractionRun(100, PRICED, PRICED)] }],
			sources: [],
		});
		assert.equal(s.runs[0]!.merged, undefined);
		const empty = graphCostSummary({ chats: [], sources: [] });
		assert.equal(empty.totalDollars, 0);
		assert.equal(empty.runs.length, 0);
		assert.equal(empty.stages.extraction.tokens.inputTokens, undefined);
	});
});
