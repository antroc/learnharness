import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
const testData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-cli-catalog-data-"));
process.env.LH_DATA_DIR = testData;
after(() => fs.rmSync(testData, { recursive: true, force: true }));
const {
	catalogContextLimits,
	catalogDefaultsFor,
	catalogProviders,
	catalogRolePins,
	catalogSlots,
	clampChatLevel,
	clampModelsLevels,
	modelCatalog,
	rolePinsFor,
	toModelDto,
	validateChatSettings,
	validateModelsSettings,
} = await import("../src/server/model-catalog.ts");
import type { EffectiveSlot } from "../src/core/settings-resolution.ts";
import type { SettingsValidation } from "../src/server/model-catalog.ts";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { DEFAULT_THINKING_ORDER } from "../src/core/settings.ts";
const { piEngineForSpec, piModels } = await import("../src/agent/models.ts");
import { BACKGROUND_MODEL_ROLES } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { SETTINGS_FILE } = await import("../config.ts");
const { effectiveSettings } = await import("../src/server/stores.ts");
const { providerKeyPresent } = await import("../src/server/keys.ts");

// La oleada de control de modelos (2026-09-12): pi-ai es responsable del registro; estas fijaciones
// mantienen honestas nuestra proyección + validación frente al catálogo distribuido, y
// fijan la verdad de razonamiento por modelo de pi para que una actualización de pi-ai no pueda cambiar en silencio
// lo que enviamos. Oleada BYOK (2026-09-22): sin fijaciones de fábrica; las superficies sin definir
// son NULL/undefined, nunca valores por defecto fantasma.

// El selector solo federa proveedores con una clave PRESENTE (oleada de ranuras
// de modelo, 2026-09-20): fija la clave de entorno de openrouter para que su catálogo completo
// se federe en las pruebas sean cuales sean las exportaciones de la shell del desarrollador.
process.env.OPENROUTER_API_KEY ??= "test-key-openrouter-catalog";

/** La entrada glm del catálogo: el modelo de la antigua fijación de fábrica, todavía el
 *  espécimen más conocido de verdad de razonamiento (low|high|max). */
function glmModel() {
	const glm = piModels().getModel("openrouter", "z-ai/glm-5.3-flash");
	assert.ok(glm, "glm-5.3-flash in catalog");
	return glm!;
}

/** Otro espécimen de razonamiento con un conjunto soportado distinto. */
function qwenModel() {
	const qwen = piModels().getModel("openrouter", "qwen/qwen3.8-max-0902");
	assert.ok(qwen, "qwen3.8-max in catalog");
	return qwen!;
}

describe("the model catalog projection", () => {
	it("serves the keyed providers' catalogs with the picker's DTO shape", () => {
		const { models, defaults, providers, slots } = modelCatalog();
		// 0.85.1 incluye 366 modelos de OpenRouter: el número exacto es cosa de pi, pero
		// la forma y la presencia de los modelos de la configuración nos toca fijarlas a nosotros.
		assert.ok(models.length > 300, `expected a full catalog, got ${models.length}`);
		for (const m of models.slice(0, 25)) {
			assert.equal(typeof m.id, "string");
			assert.equal(typeof m.name, "string");
			assert.ok(Array.isArray(m.supportedLevels));
			if (m.provider === "claude-code") assert.equal(m.cost, null);
			else assert.ok(m.cost && typeof m.cost.input === "number" && typeof m.cost.output === "number");
			if (m.provider === "claude-code") assert.equal(m.contextWindow, null);
			else assert.ok(m.contextWindow !== null && m.contextWindow > 0);
		}
		const glm = models.find((m) => m.id === "z-ai/glm-5.3-flash");
		assert.ok(glm, "glm-5.3-flash in catalog");
		assert.deepEqual(glm!.supportedLevels, ["low", "high", "max"]);
		assert.deepEqual(glm!.input, ["text", "image"]);
		// el precio actual de glm según pi (actualización del catálogo de pi 1.0.2: cacheRead
		// corregido de 0.05 → 0.03; input/output sin cambios desde 0.87.1)
		assert.deepEqual(glm!.cost, { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 });
		// oleada de ranuras de modelo: la superficie de proveedores + las fijaciones de ranura resueltas
		const openrouter = providers.find((p) => p.id === "openrouter");
		assert.ok(openrouter && openrouter.keyPresent, "openrouter federated (key pinned above)");
		assert.ok(providers.some((p) => !p.keyPresent), "keyless providers listed for discovery");
		assert.deepEqual(Object.keys(slots), ["strong", "cheap", "vision"]);
		// los modelos de un proveedor sin clave nunca llegan al selector
		const keyless = providers.filter((p) => !p.keyPresent).map((p) => p.id);
		for (const id of keyless) {
			assert.ok(!models.some((m) => m.provider === id), `keyless ${id} must not federate`);
		}
		// BYOK: la carga lleva SOLO lo que dice realmente el registro de la
		// máquina, nunca un id fantasma. data/settings.json pertenece a
		// settings-store.test.ts (la disciplina de un único responsable del sistema de ficheros), así que LEE aquí la
		// verdad resuelta en vez de fijarla: en un worktree temporal
		// el registro está vacío (defaults/slots NULL); en la máquina del responsable
		// las ranuras configuradas deben aparecer exactamente como están configuradas.
		const record = readSettings();
		const strong = effectiveSettings().models.strong;
		if (strong) {
			assert.ok(defaults, "a configured strong slot yields a default");
			assert.deepEqual(defaults!.model, { provider: strong.provider, id: strong.id });
		} else {
			assert.equal(defaults, null);
		}
		for (const name of ["strong", "cheap", "vision"] as const) {
			const stored = record?.models?.[name];
			if (stored?.model) {
				assert.ok(slots[name], name);
				assert.deepEqual(slots[name]!.model, stored.model);
			} else {
				assert.equal(slots[name], null, name);
			}
		}
	});

	it("defaults: the strong slot verbatim; null when unset (BYOK, per-session models 2026-09-28)", () => {
		assert.equal(catalogDefaultsFor(null), null);
		const strong = { provider: "openrouter", id: "z-ai/glm-5.3-flash", thinkingLevel: "low" as const };
		const d = catalogDefaultsFor(strong);
		assert.deepEqual(d, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "low" });
		// Sin nivel guardado → el modelo informa solo (el nivel se resuelve al
		// construir el motor a partir de DEFAULT_THINKING_ORDER).
		const bare = catalogDefaultsFor({ provider: "openrouter", id: "qwen/qwen3.8-flash" });
		assert.deepEqual(bare, { model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } });
	});

	it("toModelDto projects the raw catalog model verbatim", () => {
		const raw = glmModel();
		const dto = toModelDto(raw);
		assert.equal(dto.id, raw.id);
		assert.equal(dto.name, raw.name);
		assert.deepEqual(dto.supportedLevels, getSupportedThinkingLevels(raw));
		assert.ok(dto.cost);
		assert.equal(dto.cost.input, raw.cost.input);
		assert.equal(dto.contextWindow, raw.contextWindow);
	});
});

describe("the background roles' resolved pins (rolePins)", () => {
	it("no record → every role is NULL (BYOK: no phantom defaults)", () => {
		const pins = rolePinsFor(resolveSettings(null).agent.models);
		assert.deepEqual(Object.keys(pins), [...BACKGROUND_MODEL_ROLES]);
		for (const role of BACKGROUND_MODEL_ROLES) {
			assert.equal(pins[role], null, role);
		}
	});

	it("a slot re-tiers its roles; overrides win for that role only", () => {
		const record = {
			version: 1,
			models: { cheap: { model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } } },
			agent: { models: { researcher: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "high" as const } } },
		};
		const pins = rolePinsFor(resolveSettings(record).agent.models);
		assert.deepEqual(pins.researcher, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "high" });
		assert.deepEqual(pins.auditor, { model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } }); // nivel sin definir
		assert.equal(pins.visualMaker, null, "vision tier untouched");
	});

	it("catalogRolePins matches the same resolution the engine wiring uses", () => {
		const pins = catalogRolePins();
		for (const role of BACKGROUND_MODEL_ROLES) {
			assert.ok(pins[role] === null || typeof pins[role]!.model.id === "string");
		}
	});
});

describe("the model slots surface (model slots wave, 2026-09-20)", () => {
	it("catalogSlots projects the record's tiers — NULL only where a tier holds no model", () => {
		// consciente de la máquina (un único responsable del sistema de ficheros: LEE el registro, nunca lo fijes)
		const record = readSettings();
		const slots = catalogSlots();
		for (const name of ["strong", "cheap", "vision"] as const) {
			const stored = record?.models?.[name];
			if (stored?.model) {
				assert.ok(slots[name], name);
				assert.deepEqual(slots[name]!.model, stored.model);
			} else {
				assert.equal(slots[name], null, name);
			}
		}
	});

	it("catalogProviders reads keys env-wins, fresh per call", () => {
		const before = catalogProviders().find((p) => p.id === "zai");
		assert.equal(before?.keyPresent, false);
		const saved = process.env.ZAI_API_KEY;
		process.env.ZAI_API_KEY = "test-zai-key-1234567890";
		try {
			assert.equal(catalogProviders().find((p) => p.id === "zai")?.keyPresent, true);
		} finally {
			if (saved === undefined) delete process.env.ZAI_API_KEY;
			else process.env.ZAI_API_KEY = saved;
		}
	});
});

describe("the models-section validation gate", () => {
	it("accepts a valid slot and rejects unknown provider/model", () => {
		assert.equal(
			validateModelsSettings({ strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } } }).ok,
			true,
		);
		assert.equal(
			validateModelsSettings({ cheap: { model: { provider: "nope", id: "x" } } }).ok,
			false,
		);
		assert.equal(
			validateModelsSettings({ vision: { model: { provider: "openrouter", id: "nope/nope" } } }).ok,
			false,
		);
	});

	it("thinking levels never reject a slot write (owner, interlude 2026-09-22)", () => {
		// acotar, nunca rechazar: el cambio de modelo con un nivel fijado SIMPLEMENTE
		// FUNCIONA; la validación acepta CUALQUIER nivel; la ESCRITURA lo acota al
		// nivel soportado más cercano del nuevo modelo y guarda el resultado acotado.
		assert.deepEqual(
			validateModelsSettings({ strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "minimal" } }),
			{ ok: true },
		);
		assert.deepEqual(
			validateModelsSettings({ strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "xhigh" } }),
			{ ok: true },
		);
	});

	it("clampModelsLevels: the slot's own model translates the pin (the owner's exact case)", () => {
		// Claude Fable 5.1 xhigh → GLM 5.3 flash: la fijación se acota al nivel soportado
		// más cercano de glm (low|high|max) y se guarda el valor ACOTADO.
		const glm = { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "xhigh" as const };
		assert.deepEqual(clampModelsLevels({ strong: glm }), {
			strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "max" },
		});
		assert.deepEqual(clampModelsLevels({ strong: { ...glm, thinkingLevel: "minimal" as const } }).strong, {
			model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
			thinkingLevel: "low",
		});
		// glm no puede desactivar el razonamiento: off se acota HACIA ARRIBA a low
		assert.equal(
			clampModelsLevels({ strong: { ...glm, thinkingLevel: "off" as const } }).strong?.thinkingLevel,
			"low",
		);
		// un nivel soportado pasa intacto
		assert.deepEqual(clampModelsLevels({ strong: { ...glm, thinkingLevel: "high" as const } }).strong, {
			model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
			thinkingLevel: "high",
		});
		// una ranura sin nivel viaja tal cual (el cliente lo rellena en las elecciones
		// nuevas según DEFAULT_THINKING_ORDER; el servidor nunca se inventa uno)
		assert.deepEqual(clampModelsLevels({ strong: { model: glm.model } }), {
			strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } },
		});
	});

	it("accepts empty settings (the clear-slots write)", () => {
		assert.deepEqual(validateModelsSettings({}), { ok: true });
	});
});

describe("the settings validation gate", () => {
	it("thinking levels never reject a chat write (owner, interlude 2026-09-22)", () => {
		assert.deepEqual(
			validateChatSettings({ model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "minimal" }),
			{ ok: true },
		);
		assert.deepEqual(validateChatSettings({ thinkingLevel: "xhigh" }), { ok: true });
	});

	it("clampChatLevel: the body's model, else the strong slot, translates the pin", () => {
		const glm = { provider: "openrouter", id: "z-ai/glm-5.3-flash" };
		const strong: EffectiveSlot = { provider: "openrouter", id: "z-ai/glm-5.3-flash" };
		// gana el modelo del propio cuerpo
		assert.deepEqual(
			clampChatLevel({ model: { provider: "openrouter", id: "qwen/qwen3.8-max-0902" }, thinkingLevel: "xhigh" as const }, strong),
			{ model: { provider: "openrouter", id: "qwen/qwen3.8-max-0902" }, thinkingLevel: clampThinkingLevel(qwenModel(), "xhigh") },
		);
		// sin modelo en el cuerpo → la ranura fuerte del registro es la alternativa
		assert.equal(clampChatLevel({ thinkingLevel: "xhigh" as const }, strong).thinkingLevel, "max");
		// sin modelo en ninguna parte → viaja sin comprobar (el runtime acota; la barrera
		// de turno rechaza de todos modos el chat sin modelo)
		assert.deepEqual(clampChatLevel({ thinkingLevel: "minimal" as const }, null), { thinkingLevel: "minimal" });
		// sin nivel fijado → intacto
		assert.deepEqual(clampChatLevel({ model: { ...glm } }, strong), { model: { ...glm } });
	});

	it("rejects unknown providers and models", () => {
		assert.equal(validateChatSettings({ model: { provider: "nope", id: "x/y" } }).ok, false);
		assert.equal(validateChatSettings({ model: { provider: "openrouter", id: "nope/nope" } }).ok, false);
	});

	it("accepts empty settings (the clear-overrides write)", () => {
		assert.deepEqual(validateChatSettings({}), { ok: true });
	});
});

describe("pi thinking truth (pinned against pi-ai upgrades)", () => {
	it("glm-5.3-flash: low|high|max; anything else clamps to the nearest", () => {
		const glm = glmModel();
		assert.deepEqual(getSupportedThinkingLevels(glm), ["low", "high", "max"]);
		assert.equal(clampThinkingLevel(glm, "minimal"), "low");
		assert.equal(clampThinkingLevel(glm, "off"), "low", "GLM cannot disable thinking (map: off → null)");
		assert.equal(clampThinkingLevel(glm, "xhigh"), "max");
		assert.equal(clampThinkingLevel(glm, "high"), "high");
	});

	it("the engine factory clamps explicit levels; unknown models throw honestly", () => {
		const over = piEngineForSpec({ provider: "openrouter", id: "qwen/qwen3.8-flash", thinkingLevel: "high" });
		assert.equal(over.model.id, "qwen/qwen3.8-flash");
		assert.equal(over.level, "high");
		const clamped = piEngineForSpec({ provider: "openrouter", id: "z-ai/glm-5.3-flash", thinkingLevel: "minimal" });
		assert.equal(clamped.level, "low");
		assert.throws(() => piEngineForSpec({ provider: "openrouter", id: "nope/nope", thinkingLevel: "low" }), /catalog has no model/);
	});

	it("UNSET levels resolve from the baked DEFAULT_THINKING_ORDER (owner, 2026-09-22)", () => {
		assert.deepEqual([...DEFAULT_THINKING_ORDER], ["medium", "low", "high", "minimal", "xhigh", "max"]);
		// glm soporta low|high|max → el primero soportado en el orden es "low"
		const glm = piEngineForSpec({ provider: "openrouter", id: "z-ai/glm-5.3-flash" });
		assert.equal(glm.level, "low");
		// los niveles explícitos nunca consultan el orden: pi acota al más cercano
		assert.equal(piEngineForSpec({ provider: "openrouter", id: "z-ai/glm-5.3-flash", thinkingLevel: "max" }).level, "max");
		// un modelo sin razonamiento informa exactamente ["off"] → el orden cae ahí
		const flat = piModels()
			.getProviders()
			.flatMap((p) => piModels().getModels(p.id))
			.find((m) => !m.reasoning);
		if (flat) {
			const engine = piEngineForSpec({ provider: flat.provider, id: flat.id });
			assert.deepEqual(getSupportedThinkingLevels(flat), ["off"]);
			assert.equal(engine.level, "off");
		}
	});

	it("the legacy piEngineFor role entry point throws honestly (BYOK: no pins)", async () => {
		const { piEngineFor } = await import("../src/agent/models.ts");
		assert.throws(() => piEngineFor("prober"), /no configured model for role "prober"/);
	});
});
/** Ejecuta fn con PATH y HOME apuntando a un directorio temporal, para que la búsqueda de la CLI solo
 *  encuentre un binario claude cuando installed es true. */
function withClaudeInstalled(installed: boolean, fn: () => void, enabled = true): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-catalog-"));
	const saved = { PATH: process.env.PATH, HOME: process.env.HOME, npm_config_prefix: process.env.npm_config_prefix };
	const settings = readSettings();
	writeSettings({ ...(settings ?? { version: 1 }), claudeCode: { enabled } });

	if (installed) fs.writeFileSync(path.join(dir, "claude"), "#!/bin/sh\n", { mode: 0o755 });
	process.env.PATH = dir;
	process.env.HOME = dir;
	delete process.env.npm_config_prefix;

	try {
		fn();
	} finally {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		if (settings) writeSettings(settings);
		else fs.rmSync(SETTINGS_FILE, { force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("the claude-code provider (native CLI authentication, no LearnHarness key)", () => {
	it("modelCatalog() lists claude-code opus/sonnet/haiku when the CLI is installed", () => {
		withClaudeInstalled(true, () => {
			const ids = modelCatalog()
				.models.filter((m) => m.provider === "claude-code")
				.map((m) => m.id);
			assert.deepEqual(ids, ["haiku", "opus", "sonnet"]);
		});
	});

	it("catalogProviders() marks claude-code present when the CLI is installed", () => {
		withClaudeInstalled(true, () => {
			const row = catalogProviders().find((p) => p.id === "claude-code");
			assert.deepEqual(row, { id: "claude-code", envVar: "", keyPresent: true });
		});
	});

	it("catalogProviders() marks claude-code absent and modelCatalog() hides it when the CLI is missing", () => {
		withClaudeInstalled(false, () => {
			const row = catalogProviders().find((p) => p.id === "claude-code");
			assert.equal(row?.keyPresent, false);
			assert.equal(
				modelCatalog().models.some((m) => m.provider === "claude-code"),
				false,
			);
		});
	});

	it("catalogContextLimits() never advertises placeholder CLI limits, even when installed", () => {
		withClaudeInstalled(true, () => {
			assert.equal(catalogContextLimits().has("claude-code:opus"), false);
		});
	});

	it('piEngineForSpec({ provider: "claude-code", id: "sonnet" }) resolves', () => {
		const engine = piEngineForSpec({ provider: "claude-code", id: "sonnet" });
		assert.equal(engine.model.provider, "claude-code");
		assert.equal(engine.model.id, "sonnet");
	});

	it('providerKeyPresent("claude-code") requires both explicit opt-in and executable presence', () => {
		withClaudeInstalled(true, () => assert.equal(providerKeyPresent("claude-code"), true));
		withClaudeInstalled(false, () => assert.equal(providerKeyPresent("claude-code"), false));
		withClaudeInstalled(true, () => {
			assert.equal(providerKeyPresent("claude-code"), false);
			assert.equal(catalogProviders().find((p) => p.id === "claude-code")?.keyPresent, false);
			assert(!modelCatalog().models.some((m) => m.provider === "claude-code"));
			assert.equal(validateChatSettings({ model: { provider: "claude-code", id: "sonnet" } }).ok, false);
		}, false);
	});
});
