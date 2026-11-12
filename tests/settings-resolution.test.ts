/**
 * Pruebas de la capa de resolución (oleada de almacenamiento de ajustes,
 * 2026-09-19; oleada de ranuras de modelo 2026-09-20; oleada de BYOK hasta el
 * fondo 2026-09-22): core/settings-resolution.ts: la proyección delta→concreto.
 * YA NO hay fijaciones de fábrica: una cadena de modelos que termina vacía se
 * resuelve a null/undefined, y las barreras de rechazo por necesidad (turno,
 * lanzar tarea, extracción) saltan exactamente con eso.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	extractionEnabled,
	graphToolsEnabled,
	renderingEnabled,
	resolveConversationSpec,
	resolveModelSpec,
	resolveRoleSpec,
	resolveSettings,
	resolveSideQuestionSpec,
	resolveSlot,
} from "../src/core/settings-resolution.ts";
import { BACKGROUND_MODEL_ROLES, sanitizeUserSettings, type UserSettings } from "../src/core/settings.ts";

describe("resolveSettings", () => {
	it("worker concurrency defaults to 8, honors overrides, and returns to 8 after invalid disk values drop", () => {
		for (const record of [null, { version: 1 }, { version: 1, agent: {} }]) {
			assert.equal(resolveSettings(record).agent.workerRequestConcurrency, 8);
		}
		for (const value of [1, 17, Number.MAX_SAFE_INTEGER]) {
			assert.equal(resolveSettings({ version: 1, agent: { workerRequestConcurrency: value } }).agent.workerRequestConcurrency, value);
		}
		for (const value of [0, 1.5, "8", null, Number.MAX_SAFE_INTEGER + 1]) {
			const record = sanitizeUserSettings({ version: 1, agent: { workerRequestConcurrency: value } });
			assert.equal(resolveSettings(record).agent.workerRequestConcurrency, 8);
		}
	});

	it("null record (first boot): non-model knobs land on factory defaults; every model view is EMPTY", () => {
		const eff = resolveSettings(null);
		assert.deepEqual(eff.general, { autoUpdate: true });
		assert.deepEqual(eff.agent.tools, {});
		assert.deepEqual(eff.agent.prompts, {});
		assert.deepEqual(eff.agent.search, {});
		// BYOK (responsable, 2026-09-22): sin suelo de fábrica: todos los roles undefined,
		// todas las ranuras null. Ningún id fantasma en ninguna parte.
		for (const role of BACKGROUND_MODEL_ROLES) {
			assert.equal(eff.agent.models[role], undefined, role);
		}
		assert.equal(eff.models.strong, null);
		assert.equal(eff.models.cheap, null);
		assert.equal(eff.models.vision, null);
		assert.equal(eff.appearance.theme, "default");
		assert.equal(eff.appearance.background, null);
		assert.deepEqual(eff.appearance.colors, {});
		assert.equal(eff.appearance.fontFamily, null);
		assert.equal(eff.appearance.proseFontSize, 16);
		assert.equal(eff.appearance.sessionNameSerif, true);
		assert.equal(eff.appearance.mdRendering.headingWeight, 900);
		// reducción de la oleada 7: SOLO el interruptor general + el presupuesto de fragmentos
		// del rediseño: un registro ausente resuelve el 4096 de fábrica (reducido a la mitad
		// desde el 8192 de la época de los resúmenes, responsable, 2026-10-13)
		assert.deepEqual(eff.graph, { enabled: true, rendering: true, extractionChunkTokens: 4096 });
	});

	it("explicit record values win over every factory default", () => {
		const record: UserSettings = {
			version: 1,
			general: { autoUpdate: false },
			agent: {
				models: { researcher: { model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } } },
				tools: { research: false },
				prompts: { "system-prompt.md": true },
				search: { engine: "tavily" },
			},
			appearance: { theme: "rose-pine-dawn", colors: { warning: "#eeeeee" }, proseFontSize: 20, mdRendering: { headingWeight: 600 } },
			graph: { enabled: false },
		};
		const eff = resolveSettings(record);
		assert.equal(eff.general.autoUpdate, false);
		assert.deepEqual(eff.agent.models.researcher, {
			provider: "openrouter",
			id: "qwen/qwen3.8-flash",
			// razonamiento NO sustituido y sin ranura barata → SIN FIJAR (la construcción
			// del motor lo resuelve con DEFAULT_THINKING_ORDER, no con una fijación).
			thinkingLevel: undefined,
		});
		assert.deepEqual(eff.agent.search, { engine: "tavily" });
		assert.deepEqual(eff.agent.tools, { research: false });
		assert.deepEqual(eff.agent.prompts, { "system-prompt.md": true });
		assert.equal(eff.appearance.theme, "rose-pine-dawn");
		assert.deepEqual(eff.appearance.colors, { warning: "#eeeeee" });
		assert.equal(eff.appearance.proseFontSize, 20);
		assert.equal(eff.appearance.mdRendering.headingWeight, 600);
		// reducción de la oleada 7: la sección ES el interruptor general (campo de presupuesto
		// ausente = 4096 de fábrica: un registro anterior al rediseño se resuelve limpiamente).
		assert.deepEqual(eff.graph, { enabled: false, rendering: true, extractionChunkTokens: 4096 });
		// La separación de la VISTA (responsable, 2026-10-06): la extracción desactivada deja el
		// interruptor de render en ON: el canal de datos y la vista van por separado.
		assert.equal(renderingEnabled(eff.graph), true);
		// El presupuesto de fragmentos sigue la misma resolución: gana el valor guardado.
		const budgeted = resolveSettings({ version: 1, graph: { extractionChunkTokens: 2000 } });
		assert.deepEqual(budgeted.graph, { enabled: true, rendering: true, extractionChunkTokens: 2000 });
	});

	it("graph rendering (2026-10-06): display-only — off resolves off, extraction untouched", () => {
		const eff = resolveSettings({ version: 1, graph: { rendering: false } });
		assert.equal(eff.graph.rendering, false, "stored off wins");
		assert.equal(eff.graph.enabled, true, "the data channel is untouched");
		assert.equal(renderingEnabled(eff.graph), false);
		assert.equal(extractionEnabled(eff.graph), true);
		// ausente = ON de fábrica (el inicio muestra por defecto el lienzo)
		assert.equal(resolveSettings({ version: 1, graph: {} }).graph.rendering, true);
	});

	it("partial role override: thinkingLevel alone borrows the SLOT's model (or nothing, without one)", () => {
		const eff = resolveSettings({
			version: 1,
			models: { cheap: { model: { provider: "zai", id: "glm-5.3-flash" } } },
			agent: { models: { extractor: { thinkingLevel: "medium" } } },
		});
		assert.deepEqual(eff.agent.models.extractor, {
			provider: "zai",
			id: "glm-5.3-flash",
			thinkingLevel: "medium",
		});
		const bare = resolveSettings({ version: 1, agent: { models: { extractor: { thinkingLevel: "medium" } } } });
		assert.equal(bare.agent.models.extractor, undefined); // ningún modelo en ninguna parte → cadena vacía
	});

	it("resolveModelSpec is field-independent per override aspect", () => {
		const slots = { cheap: { model: { provider: "zai", id: "slot-model" }, thinkingLevel: "high" as const } };
		assert.deepEqual(
			resolveModelSpec("auditor", { model: { provider: "other", id: "x" } }, slots),
			{ provider: "other", id: "x", thinkingLevel: "high" }, // modelo de la sustitución + nivel de la ranura
		);
		assert.deepEqual(resolveModelSpec("auditor", { thinkingLevel: "max" }, slots), {
			provider: "zai",
			id: "slot-model",
			thinkingLevel: "max", // nivel de la sustitución + modelo de la ranura
		});
		assert.equal(resolveModelSpec("auditor", undefined, {}), undefined);
	});
});

describe("the slot tier (BYOK, owner 2026-09-22)", () => {
	it("slot alone re-tiers every role of its tier (no role overrides present)", () => {
		const eff = resolveSettings({ version: 1, models: { cheap: { model: { provider: "zai", id: "glm-5.3-flash" } } } });
		for (const role of ["researcher", "demoBuilder", "extractor", "auditor"] as const) {
			assert.deepEqual(
				eff.agent.models[role],
				{ provider: "zai", id: "glm-5.3-flash", thinkingLevel: undefined }, // nivel sin fijar → orden por defecto
				role,
			);
		}
		// los demás niveles, intactos (vacíos)
		assert.equal(eff.agent.models.visualMaker, undefined);
	});

	it("role override still beats the slot; each field independent", () => {
		const eff = resolveSettings({
			version: 1,
			agent: { models: { researcher: { model: { provider: "groq", id: "r-override" } } } },
			models: { cheap: { model: { provider: "zai", id: "r-slot" }, thinkingLevel: "high" } },
		});
		assert.deepEqual(eff.agent.models.researcher, {
			provider: "groq",
			id: "r-override",
			thinkingLevel: "high", // el nivel de la ranura va con el modelo de la sustitución
		});
		assert.deepEqual(eff.agent.models.auditor, { provider: "zai", id: "r-slot", thinkingLevel: "high" });
	});

	it("vision slot covers visualMaker AND pdfReader; level-only slots resolve as NULL", () => {
		const eff = resolveSettings({ version: 1, models: { vision: { model: { provider: "zai", id: "v-model" }, thinkingLevel: "max" } } });
		assert.deepEqual(eff.agent.models.visualMaker, { provider: "zai", id: "v-model", thinkingLevel: "max" });
		assert.deepEqual(eff.models.vision, { provider: "zai", id: "v-model", thinkingLevel: "max" });
		// un nivel guardado SIN modelo es inerte (se conserva en disco, sin valor por defecto fantasma)
		const inert = resolveSettings({ version: 1, models: { strong: { thinkingLevel: "medium" } } });
		assert.equal(inert.models.strong, null);
		assert.equal(inert.agent.models.researcher, undefined); // el vacío de strong no debe filtrarse a los demás niveles
	});

	it("resolveSlot: configured iff the model is present", () => {
		assert.deepEqual(resolveSlot({ model: { provider: "zai", id: "m" }, thinkingLevel: "medium" }), {
			provider: "zai",
			id: "m",
			thinkingLevel: "medium",
		});
		assert.deepEqual(resolveSlot({ model: { provider: "zai", id: "m" } }), {
			provider: "zai",
			id: "m",
			thinkingLevel: undefined, // sin fijar → se resuelve con el orden por defecto al construir
		});
		assert.equal(resolveSlot({ thinkingLevel: "medium" }), null);
		assert.equal(resolveSlot(undefined), null);
	});

	it("resolveRoleSpec: background roles and the conversation pair share the chain", () => {
		const record: UserSettings = {
			version: 1,
			models: { strong: { model: { provider: "zai", id: "strong-model" } } },
		};
		// par de conversación: solo la ranura (su sustitución la controla el chat)
		assert.deepEqual(resolveRoleSpec("prober", record), {
			provider: "zai",
			id: "strong-model",
			thinkingLevel: undefined, // nivel sin fijar → orden por defecto al construir
		});
		// la sustitución del rol en segundo plano gana a la ranura
		const withOverride: UserSettings = {
			...record,
			agent: { models: { researcher: { model: { provider: "groq", id: "r" } } } },
		};
		assert.deepEqual(resolveRoleSpec("researcher", withOverride), { provider: "groq", id: "r", thinkingLevel: undefined });
		// pdfReader va con la ranura de visión (nunca una sustitución de segundo plano)
		const visionRecord: UserSettings = {
			version: 1,
			models: { vision: { model: { provider: "zai", id: "v" }, thinkingLevel: "low" } },
		};
		assert.deepEqual(resolveRoleSpec("pdfReader", visionRecord), { provider: "zai", id: "v", thinkingLevel: "low" });
		assert.equal(resolveRoleSpec("teacher", null), undefined);
	});
});

describe("resolveConversationSpec (the turn gate's chain)", () => {
	it("chat.model over the strong slot; null when both empty", () => {
		assert.equal(resolveConversationSpec(undefined, null), null);
		assert.deepEqual(
			resolveConversationSpec(undefined, { provider: "zai", id: "s" }),
			{ provider: "zai", id: "s", thinkingLevel: undefined },
		);
		assert.deepEqual(
			resolveConversationSpec({ model: { provider: "groq", id: "c" } }, null),
			{ provider: "groq", id: "c", thinkingLevel: undefined },
		);
	});

	it("bare chat thinking level rides the strong slot's model", () => {
		assert.deepEqual(
			resolveConversationSpec({ thinkingLevel: "high" }, { provider: "zai", id: "s", thinkingLevel: "low" }),
			{ provider: "zai", id: "s", thinkingLevel: "high" },
		);
		// chat.model presente, strong sin fijar: el nivel aún puede ir solo con el chat
		assert.deepEqual(
			resolveConversationSpec({ model: { provider: "groq", id: "c" }, thinkingLevel: "max" }, null),
			{ provider: "groq", id: "c", thinkingLevel: "max" },
		);
		// nada fijado en ninguna parte: nivel sin fijar, no uno fantasma
		assert.deepEqual(resolveConversationSpec({ model: { provider: "groq", id: "c" } }, null), {
			provider: "groq",
			id: "c",
			thinkingLevel: undefined,
		});
	});
});

describe("resolveSideQuestionSpec", () => {
	const strong = { model: { provider: "openrouter", id: "strong-1" }, thinkingLevel: "high" as const };
	it("defaults to the chat's own model, then the strong slot", () => {
		assert.deepEqual(resolveSideQuestionSpec({ model: { provider: "anthropic", id: "chat-m" } }, { version: 1, models: { strong } } as UserSettings),
			{ provider: "anthropic", id: "chat-m", thinkingLevel: "high" });
		assert.deepEqual(resolveSideQuestionSpec(undefined, { version: 1, models: { strong } } as UserSettings),
			{ provider: "openrouter", id: "strong-1", thinkingLevel: "high" });
	});
	it("lets the agent.models.sideQuestion override win field by field", () => {
		const record = { version: 1, models: { strong }, agent: { models: { sideQuestion: { thinkingLevel: "low" } } } } as UserSettings;
		assert.deepEqual(resolveSideQuestionSpec(undefined, record), { provider: "openrouter", id: "strong-1", thinkingLevel: "low" });
	});
	it("is null with no model anywhere", () => { assert.equal(resolveSideQuestionSpec(undefined, null), null); });
});

describe("the graph channel gates (the wave's seam honoring)", () => {
	it("WRITE channel (extraction): dies with the master switch — the ONLY graph setting since wave 7", () => {
		assert.equal(extractionEnabled({ enabled: true }), true);
		assert.equal(extractionEnabled({ enabled: false }), false);
	});

	it("the write gate rides resolveSettings' factory defaults (all on → open)", () => {
		const eff = resolveSettings(null);
		assert.equal(extractionEnabled(eff.graph), true);
		const off = resolveSettings({ version: 1, graph: { enabled: false } });
		assert.equal(extractionEnabled(off.graph), false);
	});

	it("PROBER GRAPH TOOLS gate (wave 7, owner ruling 2026-09-23): the agent toggle AND the graph master switch compose", () => {
		const graph = { enabled: true };
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: {} } }), true, "absent subsection = ON");
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: { enabled: true } } }), true);
		assert.equal(graphToolsEnabled({ graph, agent: { graphTools: { enabled: false } } }), false);
		const dead = { ...graph, enabled: false };
		assert.equal(graphToolsEnabled({ graph: dead, agent: { graphTools: { enabled: true } } }), false, "graph off kills the tools regardless of the toggle");
	});

	it("graphTools rides resolveSettings: absent record → the empty subsection (ON); a record's delta passes through", () => {
		const eff = resolveSettings(null);
		assert.deepEqual(eff.agent.graphTools, {});
		const off = resolveSettings({ version: 1, agent: { graphTools: { enabled: false } } });
		assert.deepEqual(off.agent.graphTools, { enabled: false });
	});
});