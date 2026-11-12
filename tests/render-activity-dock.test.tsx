import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActivitySection, formatElapsed, toBlobs, type ActivityFeed, type FeedExtraction } from "../components/activity-dock.tsx";
import { formatTokens, formatUsd } from "../components/usage-format.ts";
import { jobCost } from "../src/server/pricing.ts";

// La capa pura de la sección: plegados, formato y orden de burbujas; luego el render
// SSR (burbujas, la doctrina del "—", la indicación de aborto, la cabecera siempre
// presente: la tira de agentes en segundo plano de la barra lateral).

const NOW = Date.parse("2026-09-09T12:00:00Z");

/** Un CallUsage completo (sus campos pueden valer undefined, pero no son opcionales). */
function step(inputTokens: number, outputTokens: number) {
	return { inputTokens, outputTokens, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined };
}

function job(over: Partial<ActivityFeed["jobs"][number]> = {}): ActivityFeed["jobs"][number] {
	return {
		id: "job-1",
		kind: "research",
		chatId: "c1",
		toolCallId: "t1",
		status: "running",
		activity: 'web_search: "sigma.js v3"',
		createdAt: new Date(NOW - 45_000).toISOString(),
		updatedAt: new Date(NOW - 1000).toISOString(),
		title: "Limits lesson",
		contextLimit: null,
		costUsd: jobCost({ usage: over.usage }),
		...over,
	};
}

describe("activity dock pure layer", () => {
	it("merges jobs + extractions oldest-first (the stable blob order)", () => {
		const feed: ActivityFeed = {
			jobs: [job({ id: "new", createdAt: new Date(NOW - 10_000).toISOString() })],
			extractions: [{ id: "cx", chatId: "cx", title: "Old lesson", phase: "auditing", startedAt: NOW - 100_000 }],
		};
		const blobs = toBlobs(feed);
		assert.equal(blobs.length, 2);
		const first = blobs[0]!;
		assert.equal(first.id, "cx"); // la extracción empezó primero
		assert.equal(first.process, "extraction");
		assert.equal(first.phase, "auditing");
		assert.equal(blobs[1]!.id, "new");
	});

	it("standalone plugin workers share native row accounting without inventing a session identity", () => {
		const feed: ActivityFeed = { jobs: [], extractions: [], pluginWorkers: [{
			id: "my-plugin:task-1", taskId: "task-1", pluginId: "my-plugin", definitionId: "analyzer",
			status: "running", title: "My plugin · analyzer", model: { provider: "offline", id: "fixture" },
			createdAt: new Date(NOW - 10_000).toISOString(), updatedAt: new Date(NOW).toISOString(),
			activity: "tool: inspect", costUsd: 0.004, contextLimit: 10_000,
			usage: { model: "offline:fixture", inputTokens: 8000, outputTokens: 500, cacheReadTokens: 4000,
				cacheWriteTokens: 0, reasoningTokens: undefined, steps: 3,
				lastStep: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 200, cacheWriteTokens: 20, reasoningTokens: undefined } },
		}] };
		const blob = toBlobs(feed)[0]!;
		assert.equal(blob.process, "plugin-worker");
		assert.equal(blob.chatId, undefined);
		assert.equal(blob.cost, 0.004);
		assert.equal(blob.model, "offline:fixture");
		assert.equal(blob.steps, 3);
		assert.deepEqual(blob.context, { used: 330, limit: 10_000 }, "last step, including cache buckets, not cumulative usage");
		const html = renderToStaticMarkup(<ActivitySection feed={feed} />);
		assert.match(html, /data-testid="activity-blob-plugin-worker"/);
		assert.match(html, /data-activity-id="my-plugin:task-1"/);
		assert.match(html, /My plugin · analyzer/);
		assert.match(html, /tool: inspect/);
		assert.match(html, /data-testid="activity-abort"/);
	});

	it("per-chunk jobs (owner, 2026-09-28): one source, N rows — unique ids (React keys), one chatId, part-suffixed titles", () => {
		const rows = [
			{ id: "src_a#1", chatId: "src_a", part: { i: 1, n: 2 }, title: "notes.md · 1/2", phase: "extracting", startedAt: NOW - 1000 },
			{ id: "src_a#2", chatId: "src_a", part: { i: 2, n: 2 }, title: "notes.md · 2/2", phase: "queued", startedAt: NOW - 500 },
		] as FeedExtraction[];
		const blobs = toBlobs({ jobs: [], extractions: rows });
		assert.equal(blobs.length, 2, "one blob per chunk job");
		assert.deepEqual(blobs.map((b) => b.id), ["src_a#1", "src_a#2"], "unique row ids — no duplicate React keys");
		assert.ok(blobs.every((b) => b.chatId === "src_a"), "abort/link identity stays source-scoped");
	});

	it("uses the server's Pi price projection; absent pricing is null, never zero", () => {
		const priced = job({
			usage: {
				model: "openrouter:z-ai/glm-5.3-flash",
				inputTokens: 10_000,
				outputTokens: 1000,
				cacheReadTokens: 5000,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				steps: 2,
			},
		});
		const blob = toBlobs({ jobs: [priced], extractions: [] })[0]!;
		// La entrada nueva normalizada por Pi se tarifica directamente; las lecturas nunca la reducen.
		assert.equal(blob.cost, 0.00215);
		const missingProjection = toBlobs({ jobs: [{ ...priced, costUsd: undefined }], extractions: [] })[0]!;
		assert.equal(missingProjection.cost, null, "the browser must not invent a fallback price");
		const absent = toBlobs({ jobs: [job()], extractions: [] })[0]!;
		assert.equal(absent.cost, null);
	});

	it("a key-refused job reads as info — 'needs a provider key' (zero-keys wave, 66dbea9)", () => {
		const refused = job({
			status: "error",
			activity: "failed",
			// el runner compone tal cual el error del sobre (cola invariante)
			error: "No OpenRouter key is set — add one in Settings → Keys",
		});
		const blob = toBlobs({ jobs: [refused], extractions: [] })[0]!;
		assert.equal(blob.activity, "needs a provider key");
	});

	it("a models-refused job reads as info — 'needs model setup', not 'failed' (BYOK, 2026-09-22)", () => {
		const refused = job({
			status: "error",
			activity: "failed",
			error: "No model configured — set up your models first (missing: vision)",
		});
		const blob = toBlobs({ jobs: [refused], extractions: [] })[0]!;
		assert.equal(blob.activity, "needs model setup");
		// Un fallo real conserva la redacción honesta del runner.
		const crashed = job({ status: "error", activity: "failed", error: "FAILED: headless crashed" });
		const real = toBlobs({ jobs: [crashed], extractions: [] })[0]!;
		assert.equal(real.activity, "failed");
	});

	it("context line = LAST step's tokens vs the model limit, never a cumulative sum", () => {
		const base = {
			model: "openrouter:z-ai/glm-5.3-flash",
			inputTokens: 400_000, // total acumulado (mucho mayor: NO debe alimentar la línea)
			outputTokens: 8_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			steps: 5,
		};
		const withLast = job({
			usage: { ...base, lastStep: step(90_000, 2_000) },
			// La enmienda (responsable 2026-09-23): el límite es la unión con el catálogo en vivo
			// del servidor que viaja en la fuente: el dock nunca lo resuelve.
			contextLimit: 131_072,
		});
		const blob = toBlobs({ jobs: [withLast], extractions: [] })[0]!;
		assert.equal(blob.context?.used, 92_000);
		assert.equal(blob.context?.limit, 131_072);
		// Aún sin lastStep (captura pendiente) → "—", aunque exista uso.
		const stripped = toBlobs({ jobs: [job({ usage: { ...base } })], extractions: [] })[0]!;
		assert.equal(stripped.context, null);
		// Modelo ausente del catálogo en vivo (sesión histórica,
		// actualización de paquete) → la fuente lleva null → sin línea de contexto.
		const uncatalogued = toBlobs({
			jobs: [job({ usage: { ...base, model: "nope/unknown", lastStep: step(5, 5), } })],
			extractions: [],
		})[0]!;
		assert.equal(uncatalogued.context, null);
		// El numerador es el mismo plegado con caché incluida que usa el medidor de la
		// sesión (auditoría del medidor de contexto, responsable 2026-09-23): el "input" del
		// proveedor EXCLUYE cacheRead/cacheWrite, así que input+output a secas se queda muy
		// corto en tareas con mucha caché: 10k+0.5k+120k+30k = 160.5k, no 10.5k.
		const cached = toBlobs({
			jobs: [
				job({
					usage: {
						...base,
						lastStep: {
							inputTokens: 10_000,
							outputTokens: 500,
							cacheReadTokens: 120_000,
							cacheWriteTokens: 30_000,
							reasoningTokens: undefined,
						},
					},
					contextLimit: 200_000,
				}),
			],
			extractions: [],
		})[0]!;
		assert.equal(cached.context?.used, 160_500);
		assert.equal(cached.context?.limit, 200_000);
	});

	it("extraction blobs carry no money/context (—, the doctrine)", () => {
		const blob = toBlobs({
			jobs: [],
			extractions: [{ id: "cx", chatId: "cx", title: "T", phase: "extracting", startedAt: NOW }],
		})[0]!;
		assert.equal(blob.cost, null);
		assert.equal(blob.context, null);
	});

	it("formatElapsed ticks compactly", () => {
		assert.equal(formatElapsed(45_000), "45s");
		assert.equal(formatElapsed(184_000), "3m 04s");
		assert.equal(formatElapsed(4_320_000), "1h 12m");
	});

	it("formatUsd keeps four decimals under $1, two above", () => {
		assert.equal(formatUsd(0.0014), "$0.0014");
		assert.equal(formatUsd(1.5), "$1.50");
	});

	it("formatTokens trims (never 38.0k)", () => {
		assert.equal(formatTokens(38_000), "38k");
		assert.equal(formatTokens(1_234_567), "1.2M");
		assert.equal(formatTokens(950), "950");
	});
});

describe("activity section render", () => {
	it("renders the ALWAYS-PRESENT header when idle — empty means empty, nothing hides", () => {
		const html = renderToStaticMarkup(<ActivitySection feed={{ jobs: [], extractions: [] }} />);
		assert.match(html, /data-testid="activity-section"/);
		assert.match(html, /Background agents/);
		assert.doesNotMatch(html, /activity-blob-(job|extraction)/, "no rows while idle");
		assert.doesNotMatch(html, /activity-total-cost/, "the cost span is population, not decoration");
	});

	it("renders one blob per running process with cost, elapsed, and the abort affordance", () => {
		const html = renderToStaticMarkup(
			<ActivitySection
				feed={{
					jobs: [job({ id: "j1", kind: "demo", activity: "building sandbox…", title: "Chain-rule demo" })],
					extractions: [{ id: "cx", chatId: "cx", title: "Old lesson", phase: "merging", startedAt: NOW - 60_000 }],
				}}
			/>,
		);
		assert.match(html, /data-testid="activity-section"/);
		assert.match(html, /data-testid="activity-blob-job"/);
		assert.match(html, /data-testid="activity-blob-extraction"/);
		assert.match(html, /Chain-rule demo/);
		assert.match(html, /building sandbox…/);
		assert.match(html, /Extraction — merging/);
		// Tarea sin precio → "—", nunca $0.0000 (doctrina); las dos burbujas lo muestran.
		assert.match(html, /activity-blob-cost[^>]*>—</);
		assert.match(html, /data-testid="activity-abort"/, "END on the blob face, popover-independent");
		assert.match(html, /\bEnd\b/, "the explicit END button");
		assert.match(html, /Background agents/);
		// Coste total: nada con precio → "—" en la cabecera.
		assert.match(html, /activity-total-cost[^>]*>—</);
		// Las revelaciones de texto truncado CONSERVAN el title nativo (regla del mecanismo de la
		// oleada de tooltips): los span de actividad truncada + título llevan title=; un tooltip
		// con estilo no aporta nada frente a revelar unos puntos suspensivos.
		assert.match(html, /title="building sandbox…"/);
	});


	it("shows total running cost when jobs are priced", () => {
		const usage = {
			model: "openrouter:z-ai/glm-5.3-flash",
			inputTokens: 10_000,
			outputTokens: 1000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			steps: 1,
		};
		const html = renderToStaticMarkup(
			<ActivitySection
				feed={{
					jobs: [
						job({ id: "a", usage }),
						job({ id: "b", usage, createdAt: new Date(NOW - 20_000).toISOString() }),
					],
					extractions: [],
				}}
			/>,
		);
		// dos tareas idénticas con precio → 2 × $0.002 = $0.0040 en total (precios de pi;
		// glm-5.3-flash cambió en pi-ai 0.87.1)
		assert.match(html, /activity-total-cost[^>]*>\$0\.0040</);
	});
});