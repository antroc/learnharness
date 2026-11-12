/**
 * EL SELLO DE NACIMIENTO (modelos por sesión, decisión del responsable
 * 2026-09-28): cada sesión es dueña de su modelo + nivel de razonamiento
 * desde su nacimiento: POST /api/chats sella el chat recién nacido tal cual a
 * partir de la ranura STRONG del registro de ajustes, el valor por defecto de
 * las sesiones nuevas. A partir de ahí la ranura strong nunca vuelve a llegar
 * a la sesión (las elecciones dentro de la sesión escriben en el registro
 * propio de la sesión; resolveConversationSpec prefiere chat.settings.model).
 *
 * Esta fijación maneja el manejador de ruta real (Request/Response sin
 * framework) con un LH_DATA_DIR aislado: la frontera debe fijarse antes del
 * primer import que cargue de forma transitiva config.ts, así que todos los
 * imports de módulos de la app son dinámicos (la disciplina de
 * prompt-overrides).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── la frontera, ANTES de cualquier import que cargue la configuración ──────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-birth-stamp-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { POST } = await import("../app/api/chats/route.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { chatStore } = await import("../src/store/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

function post(): Promise<Response> {
	return POST(new Request("http://test/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "teach me the chain rule" }),
	}));
}

describe("POST /api/chats — the birth stamp", () => {
	it("stamps the newborn verbatim from the strong slot (model + thinking level)", async () => {
		writeSettings({
			version: 1,
			models: {
				strong: {
					model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
					thinkingLevel: "low",
				},
			},
		});
		const res = await post();
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id);
		assert.ok(record);
		assert.deepEqual(record.settings, {
			model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
			thinkingLevel: "low",
		});
	});

	it("no strong slot configured (fresh BYOK boot) → NO stamp; the turn gate refuses downstream", async () => {
		fs.rmSync(path.join(TMP_DATA, "settings.json"), { force: true });
		assert.equal(readSettings(), null);
		const res = await post();
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id);
		assert.ok(record);
		assert.equal(record.settings, undefined, "nothing stamped — nothing to lie about");
	});

	it("an unset thinking level rides as-is — the session's level resolves (strong's, then the model's ladder)", async () => {
		writeSettings({
			version: 1,
			models: { strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } } },
		});
		const res = await post();
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id);
		assert.ok(record);
		assert.equal(record.settings?.thinkingLevel, undefined);
		assert.deepEqual(record.settings, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	});

	it("changing the strong slot afterward NEVER touches existing sessions — the stamp is a copy, not a live view", async () => {
		writeSettings({
			version: 1,
			models: { strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "low" } },
		});
		const first = (await (await post()).json()) as { id: string };
		writeSettings({
			version: 1,
			models: { strong: { model: { provider: "openai", id: "gpt-6-luna" }, thinkingLevel: "low" } },
		});
		const second = (await (await post()).json()) as { id: string };
		// La sesión anterior al cambio conserva su sello; la sesión posterior al cambio
		// lleva el nuevo valor por defecto. Es la fijación de regresión del
		// fallo comunicado (2026-09-28): ambas UI mostraban la ranura strong mientras
		// todos los chats se ejecutaban con un sello fosilizado.
		const firstRecord = chatStore.getChat(first.id);
		const secondRecord = chatStore.getChat(second.id);
		assert.ok(firstRecord && secondRecord);
		assert.equal(firstRecord.settings?.model?.id, "z-ai/glm-5.3-flash");
		assert.equal(secondRecord.settings?.model?.id, "gpt-6-luna");
	});
});
