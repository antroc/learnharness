import { renderWithInteractionLayers as renderToStaticMarkup } from "./interaction-layer-render.tsx";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StatsBar, formatContextMeasurement } from "../components/stats-bar.tsx";
import { sessionCost } from "../src/server/pricing.ts";
import { catalogLimits } from "../components/model-picker.tsx";
import type { ModelCatalogEntry, ModelCatalogResponse } from "../src/core/contracts.ts";
import { prettyModel } from "../components/usage-format.ts";
import type { ChatSettings, TurnUsage } from "../src/core/contracts.ts";

// La barra de estadísticas: solo plegados (sin cálculo de costes en el componente), la
// doctrina del "—" para los datos ausentes, coste honesto (nunca un $0 falso) y el control
// de modelo + razonamiento (components/model-picker.tsx, respaldado por el catálogo de pi-ai).

function step(inputTokens: number, outputTokens: number, over: Record<string, number | undefined> = {}) {
	return { inputTokens, outputTokens, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined, ...over };
}

function turn(over: Partial<TurnUsage> = {}): TurnUsage {
	return {
		id: "t1",
		messageId: "m1",
		at: "2026-09-09T12:00:00Z",
		model: "openrouter:z-ai/glm-5.3-flash",
		steps: [step(10_000, 1_000)],
		...over,
	};
}

describe("stats bar", () => {
	it("renders NOTHING on the left when there are no turns yet (owner, wave 7 sweep)", () => {
		const html = renderToStaticMarkup(
			<StatsBar turns={[]} />,
		);
		assert.match(html, /data-testid="stats-bar"/);
		// antes del chat: sin botón de resumen ni teatro de "—" (el deslizador de contexto de
		// conocimiento murió con la inyección: el lado izquierdo simplemente está vacío)
		assert.ok(!html.includes('data-testid="stats-summary"'), "no summary button pre-chat");
		assert.ok(!html.includes('data-testid="stats-context"'), "no context figure pre-chat");
		assert.ok(!html.includes('data-testid="stats-cost"'), "no cost figure pre-chat");
		// sin turnos, sin ajustes, catálogo sin cargar → las dos etiquetas de control
		// "—" (el botón de razonamiento muestra solo el nivel, igual que el botón del modelo
		// muestra solo el nombre del modelo: sin prefijo ni separador de punto)
		assert.match(html, /data-testid="stats-model"[^>]*>\s*<span[^>]*>—<\/span>/);
		assert.match(html, /data-testid="stats-thinking"[^>]*>\s*<span[^>]*>—<\/span>/);
		assert.ok(!html.includes("aria-hidden>·"), "no dot between the controls");
		// el control se lee como un botón: borde de píldora + chevron de desplegable
		assert.match(html, /data-testid="stats-model"[^>]*rounded-full[^>]*>/);
		assert.match(html, /▾/);
	});

	it("folds context + cost from the turns log (core/prices, no local math)", () => {
		const html = renderToStaticMarkup(
			<StatsBar turns={[turn(), turn()]} contextTokens={11_000} pricing={sessionCost({ turns: [turn(), turn()] })} />,
		);
		// última llamada del último turno: 10k de entrada + 1k de salida = 11k. El LÍMITE es el
		// del catálogo en vivo, y la barra aún no tiene el índice (la unión con el
		// catálogo llega con el fragmento de UI), así que el medidor renderiza
		// SOLO EL USO (enmienda del responsable: nunca una ventana alternativa).
		assert.match(html, /data-testid="stats-context">11k</);
		// precio del catálogo de pi 0.15/0.5 por 1M (cambió en pi-ai 0.87.1):
		// cada turno 10k×0.15 + 1k×0.5 = $0.002 → dos = $0.0040
		assert.match(html, /data-testid="stats-cost">\$0\.0040</);
		// etiqueta del botón del modelo: en SSR (aún sin pedir el registro) muestra "—":
		// la ranura fuerte llega en el cliente con GET /api/settings; el
		// registro de turnos de abajo sigue plegando los modelos REALES facturados
		assert.match(html, /data-testid="stats-model"[^>]*>\s*<span[^>]*>—<\/span>/);
	});

	it("shows — for cost when every turn is unpriceable, never a fake $0", () => {
		const html = renderToStaticMarkup(
			<StatsBar turns={[turn({ model: "nope/unknown" })]} contextTokens={11_000} pricing={sessionCost({ turns: [turn({ model: "nope/unknown" })] })} />,
		);
		assert.match(html, /data-testid="stats-cost">—</);
		// modelo desconocido: no existe límite del catálogo, pero la huella sigue
		// siendo una lectura honesta: solo el uso (nunca teatro de "—" sobre
		// datos reales, nunca una ventana falsa)
		assert.match(html, /data-testid="stats-context">11k</);
	});

	it("unknown context is explicit; changing the selected limit preserves the measurement", () => {
		assert.equal(formatContextMeasurement(null, 100_000), "? / 100k");
		assert.equal(formatContextMeasurement(83_000, 100_000), "83k / 100k");
		assert.equal(formatContextMeasurement(83_000, 200_000), "83k / 200k");
		assert.equal(formatContextMeasurement(83_000, null), "83k");
		const html = renderToStaticMarkup(<StatsBar chatId="fixture" turns={[turn()]} contextTokens={null} />);
		assert.match(html, /data-testid="stats-context">\?</);
		const empty = renderToStaticMarkup(<StatsBar chatId="fixture" turns={[]} />);
		assert.match(empty, /data-testid="stats-context">\?</);
	});

	it("prettyModel strips only the vendor path, preserving versions, dates and variants", () => {
		assert.equal(prettyModel("z-ai/glm-5.3-flash"), "glm-5.3-flash"); // se conservan los guiones (ronda 5 del responsable)
		assert.equal(prettyModel("qwen/qwen3.8-max-0902"), "qwen3.8-max-0902");
		assert.equal(prettyModel("google/gemma-4-27b-it:free"), "gemma-4-27b-it:free");
		assert.equal(prettyModel("anthropic/claude-opus-5:batch"), "claude-opus-5:batch");
		assert.equal(prettyModel("claude-opus-5"), "claude-opus-5");
		assert.equal(prettyModel("claude-opus-5-5"), "claude-opus-5-5");
		assert.equal(prettyModel("model:free"), "model:free");
		assert.equal(prettyModel("model:variant:free"), "model:variant:free");
	});

	it("provider-qualified stamps (usage contract, model-slots wave)", () => {
		// cualificado: el proveedor va como sufijo discreto: con la federación, el
		// mismo modelo mediante dos proveedores es contabilidad distinta
		assert.equal(prettyModel("openrouter:z-ai/glm-5.3-flash", true), "glm-5.3-flash · openrouter");
		assert.equal(prettyModel("openai:gpt-5.2", true), "gpt-5.2 · openai");
		assert.equal(prettyModel("openrouter:google/gemma-4-27b-it:free", true), "gemma-4-27b-it:free · openrouter");
		assert.equal(prettyModel("opencode:claude-opus-5-5", true), "claude-opus-5-5 · opencode");
		// Los ids a secas nunca se analizan como sellos de uso, ni siquiera con dos puntos.
		assert.equal(prettyModel("model:free"), "model:free");
		// cualificado sobre un id a secas: no se inventa ningún sufijo
		assert.equal(prettyModel("z-ai/glm-5.3-flash", true), "glm-5.3-flash");
	});
});

describe("catalogLimits (the stats-bar live-limits join, pure)", () => {
	// El gemelo en el cliente de la unión catalogContextLimits del servidor:
	// provider:id → contextWindow directamente de la carga en caché de /api/models.
	// Un render estático no tiene catálogo (la petición es una cuestión en vivo:
	// Playwright verifica el cableado), así que aquí se fija la forma del índice
	// puro: una entrada por modelo, la clave exacta que busca contextWindow(),
	// los modelos que faltan ausentes (→ límite null → solo el uso).
	const entry = (over: Pick<ModelCatalogEntry, "id" | "provider" | "contextWindow">): ModelCatalogEntry => ({
		name: over.id,
		reasoning: false,
		input: ["text"],
		supportedLevels: [],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		maxTokens: 32_768,
		...over,
	});
	const catalog: Pick<ModelCatalogResponse, "models"> = {
		models: [
			entry({ id: "z-ai/glm-5.3-flash", provider: "openrouter", contextWindow: 1_048_576 }),
			entry({ id: "gpt-x", provider: "openai", contextWindow: 400_000 }),
		],
	};

	it("builds provider:id → contextWindow over every catalog model", () => {
		const limits = catalogLimits(catalog);
		assert.equal(limits.get("openrouter:z-ai/glm-5.3-flash"), 1_048_576);
		assert.equal(limits.get("openai:gpt-x"), 400_000);
		assert.equal(limits.size, 2);
	});

	it("a model missing from the index is absent — limit null, usage-only (never a fallback)", () => {
		const limits = catalogLimits(catalog);
		assert.equal(limits.has("nope/unknown"), false);
	});

	it("same provider+model on different providers keys apart", () => {
		const twin: Pick<ModelCatalogResponse, "models"> = {
			models: [...catalog.models, entry({ id: "z-ai/glm-5.3-flash", provider: "zai", contextWindow: 200_000 })],
		};
		const limits = catalogLimits(twin);
		assert.equal(limits.get("openrouter:z-ai/glm-5.3-flash"), 1_048_576);
		assert.equal(limits.get("zai:z-ai/glm-5.3-flash"), 200_000);
	});
});
