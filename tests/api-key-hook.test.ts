/**
 * El arreglo del hook getApiKey (responsable, 2026-09-26): las dos
 * construcciones de Agent (baseAgentOptions en teacher-agent.ts y el bucle de
 * runSubagent en subagents/pi-run.ts) pasaban
 * `getApiKey: () => openRouterApiKey()`, y pi-agent-core resuelve
 * `(config.getApiKey ? await config.getApiKey(provider) : undefined) || config.apiKey`
 * (agent-loop.js:191), así que un hook aportado SUSTITUYE la resolución
 * nativa por proveedor desde el entorno de pi-ai. El hook ignoraba su
 * argumento de proveedor, así que a todos los proveedores que no eran
 * OpenRouter se les enviaba la clave de OpenRouter y respondían 401
 * (reproducción del responsable: openai:gpt-5.6-luna,
 * anthropic:claude-haiku-4-5 directo).
 *
 * El arreglo es BORRARLO: sin hook, pi-ai resuelve las claves de forma
 * nativa desde el entorno en cada petición, que es la intención declarada de
 * la arquitectura (models.ts: "the keys seam reflects file-saved keys into
 * env"). Este fichero fija que el borrado se mantiene: los agentes construidos
 * NO deben exponer ningún hook getApiKey, para que la resolución nativa se
 * ejecute con todos los proveedores.
 *
 * El Agent de runSubagent es interno a su promesa (no expone frontera); su
 * hook se borró en el mismo commit y su comportamiento lo cubren los motores
 * falsos de la batería de subagentes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProberAgent, createTeacherAgent, type TeachingAgent } from "../src/agent/teacher-agent.ts";
import type { ProberToolContext } from "../src/agent/tools.ts";
import { jobStore } from "../src/store/jobs.ts";
import { chatStore } from "../src/store/chats.ts";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

/** Un motor pi guionizado: las construcciones de agentes necesitan un motor
 * inyectado desde que BYOK eliminó las fijaciones de fábrica (responsable,
 * 2026-09-22). */
function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

describe("the getApiKey-hook fix (native per-provider key resolution)", () => {
	it("teacher and prober builds expose NO getApiKey hook — pi-ai resolves keys natively", () => {
		const chatId = chatStore.createChat("getApiKey pin").id;
		const ctx: ProberToolContext = { chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} };
		const builds: TeachingAgent[] = [
			createTeacherAgent(undefined, { engine: fauxEngine() }),
			createProberAgent(ctx, { engine: fauxEngine() }),
		];
		for (const agent of builds) {
			assert.equal(
				(agent as unknown as { getApiKey?: unknown }).getApiKey,
				undefined,
				"the OpenRouter-pinning hook must stay deleted — a set hook overrides pi-ai's native per-provider env resolution for EVERY provider",
			);
		}
	});
});