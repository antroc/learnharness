/**
 * La composición de claves (oleada de claves de autenticación, 2026-09-19):
 * almacén que refleja el entorno + precedencia en la que gana el entorno + la
 * vista de estado enmascarada. Decisiones del responsable que se fijan:
 *  - el entorno real siempre gana; un PUT a una variable que pertenece al entorno
 *    persiste en el fichero pero nunca sobrescribe la copia del entorno (el
 *    estado informa de shadowedByEnv);
 *  - guardar/borrar surte efecto de inmediato (fichero + process.env a la vez);
 *  - las variables desconocidas del fichero se conservan y se muestran, nunca son editables.
 *
 * LH_AUTH_FILE se redirige a un directorio tmp nuevo ANTES de los imports (la
 * frontera depende de la carga del módulo); la variable del «entorno real» se
 * fija antes de que src/server/keys.ts se cargue por primera vez para que la
 * instantánea del arranque la trate como entorno real. Todos los valores de
 * aquí son cadenas de prueba desechables, nunca secretos reales.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { externalCliEnv } from "../src/core/auth-env.ts";

// EL ENTORNO DE ESTE PROCESO ES EL SUJETO DE LA PRUEBA: quita las variables del catálogo heredadas
// (una shell de desarrollo puede exportar claves REALES; las pruebas solo usan valores desechables,
// nunca secretos reales). La limpieza solo afecta a este proceso hijo desechable.
for (const varName of [
	"OPENROUTER_API_KEY",
	"DEEPGRAM_API_KEY",
	"TAVILY_API_KEY",
	"BRAVE_API_KEY",
	"EXA_API_KEY",
	"FIRECRAWL_API_KEY",
	"OLLAMA_API_KEY",
	"GOOGLE_SEARCH_API_KEY",
	"GOOGLE_CSE_ID",
	"OPENAI_API_KEY",
	"FUTURE_PLANS_TOKEN",
]) {
	delete process.env[varName];
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-server-keys-"));
const AUTH = path.join(TMP, "auth.json");
process.env.LH_AUTH_FILE = AUTH;

// El fichero ANTES del primer arranque: un OpenRouter tapado (el entorno será distinto) + una
// variable desconocida que debe sobrevivir a todas las escrituras y mostrarse como fila genérica.
fs.writeFileSync(
	AUTH,
	JSON.stringify({
		OPENROUTER_API_KEY: "sk-or-v1-filefilefile",
		FUTURE_PLANS_TOKEN: "opaque-plans-token",
	}),
);
// Entorno real (fijado ANTES del primer import del módulo → el arranque lo captura en la instantánea):
process.env.OPENROUTER_API_KEY = "sk-or-v1-envvalue99";

// Importa DESPUÉS de preparar el entorno: la inicialización del módulo ejecuta el relleno de huecos del arranque + la instantánea.
const { deleteKey, initAuthEnv, keyStatuses, keyValue, resolveKeyStatuses, saveKey, isWritableAuthKey } = await import(
	"../src/server/keys.ts"
);
const { authStore } = await import("../src/store/auth.ts");

const ENV_OWNED = "sk-or-v1-envvalue99";

after(() => {
	delete process.env.OPENROUTER_API_KEY;
	delete process.env.DEEPGRAM_API_KEY;
	delete process.env.OPENAI_API_KEY;
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("boot fill-gap + precedence", () => {
	it("env-owned var: env wins, shadow reported, file copy kept", () => {
		const row = keyStatuses().find((s) => s.id === "OPENROUTER_API_KEY")!;
		assert.equal(row.source, "env");
		assert.ok(row.shadowedByEnv, "file value differs from the env value");
		assert.equal(row.masked, `…${ENV_OWNED.slice(-4)} (${ENV_OWNED.length} chars)`);
		assert.equal(authStore.authVars().OPENROUTER_API_KEY, "sk-or-v1-filefilefile", "file copy untouched");
		assert.equal(externalCliEnv().OPENROUTER_API_KEY, ENV_OWNED, "external CLIs retain launch-env ownership");
	});

	it("unknown file var: fill-gapped into env, surfaced as a generic row", () => {
		assert.equal(process.env.FUTURE_PLANS_TOKEN, "opaque-plans-token", "reflected at boot");
		assert.equal(externalCliEnv().FUTURE_PLANS_TOKEN, undefined, "external CLIs exclude unknown file-only injections too");
		const row = keyStatuses().find((s) => s.id === "FUTURE_PLANS_TOKEN")!;
		assert.equal(row.info, null, "no curated form");
		assert.equal(row.source, "file");
		assert.ok(row.present);
	});

	it("absent curated keys: not present, source none", () => {
		const row = keyStatuses().find((s) => s.id === "DEEPGRAM_API_KEY")!;
		assert.ok(!row.present);
		assert.equal(row.source, "none");
		assert.equal(row.masked, null);
		assert.ok(row.info, "catalog metadata still present for the page form");
	});

	it("keyValue resolves env-first", () => {
		assert.equal(keyValue("OPENROUTER_API_KEY"), ENV_OWNED);
		assert.equal(keyValue("FUTURE_PLANS_TOKEN"), "opaque-plans-token");
		assert.equal(keyValue("DEEPGRAM_API_KEY"), undefined);
	});
});

describe("saveKey / deleteKey (immediate effect, no restart)", () => {
	it("save reflects into env + file (fill-gap set)", () => {
		const value = "d".repeat(40); // desechable, ≥ el mínimo de Deepgram
		const r = saveKey("DEEPGRAM_API_KEY", value);
		assert.ok(r.ok);
		assert.equal(process.env.DEEPGRAM_API_KEY, value, "env updated immediately");
		assert.equal(externalCliEnv().DEEPGRAM_API_KEY, undefined);
		assert.equal(authStore.authVars().DEEPGRAM_API_KEY, value, "file updated");
		assert.equal(r.status.source, "file", "the reflected copy is the store's — the file is its origin of truth");
		assert.ok(!r.status.shadowedByEnv);
	});

	it("save to an env-owned var: file updated, env NOT overwritten, shadow reported", () => {
		const r = saveKey("OPENROUTER_API_KEY", "sk-or-v1-newvalue12345");
		assert.ok(r.ok);
		assert.equal(process.env.OPENROUTER_API_KEY, ENV_OWNED, "real env untouched");
		assert.equal(externalCliEnv().OPENROUTER_API_KEY, ENV_OWNED, "saving a shadowed key cannot remove real env ownership");
		assert.equal(authStore.authVars().OPENROUTER_API_KEY, "sk-or-v1-newvalue12345", "file updated for later");
		assert.ok(r.status.shadowedByEnv);
	});

	it("bad shape: rejected, nothing stored or reflected", () => {
		const before = JSON.stringify(authStore.authVars());
		const r = saveKey("DEEPGRAM_API_KEY", "short");
		assert.ok(!r.ok);
		if (!r.ok) assert.match(r.error, /at least 20/);
		assert.equal(JSON.stringify(authStore.authVars()), before);
		assert.equal(process.env.DEEPGRAM_API_KEY, "d".repeat(40));
	});

	it("unknown id: rejected with the supported list", () => {
		const r = saveKey("FUTURE_PLANS_TOKEN", "anything-at-all-here");
		assert.ok(!r.ok);
		if (!r.ok) assert.match(r.error, /FUTURE_PLANS_TOKEN/);
	});

	it("delete removes env + file for fill-gap vars", () => {
		const row = deleteKey("DEEPGRAM_API_KEY");
		assert.ok(!row.present);
		assert.equal(process.env.DEEPGRAM_API_KEY, undefined, "env copy was ours — removed");
		assert.ok(!("DEEPGRAM_API_KEY" in authStore.authVars()));
	});

	it("delete of an env-owned var: file copy gone, env remains (env wins)", () => {
		const row = deleteKey("OPENROUTER_API_KEY");
		assert.equal(row.source, "env");
		assert.ok(row.present, "still live from the real env");
		assert.ok(!row.shadowedByEnv, "nothing left in the file to shadow");
		assert.equal(process.env.OPENROUTER_API_KEY, ENV_OWNED);
	});

	it("re-running initAuthEnv is idempotent — deleted vars never resurrect", () => {
		initAuthEnv();
		assert.equal(process.env.DEEPGRAM_API_KEY, undefined, "file entry gone → no re-fill");
	});

	describe("model-provider keys (provider-keys interlude)", () => {
		it("absent provider keys do NOT spam status rows — the dropdown is discovery", () => {
			const rows = keyStatuses().map((s) => s.id);
			assert.ok(!rows.includes("OPENAI_API_KEY"), "never saved → no row");
			assert.ok(!rows.includes("ZAI_API_KEY"));
		});

		it("save via provider env var: generic guard, reflected immediately", () => {
			const value = "sk-throwaway-openai-0123456789"; // nunca un secreto real
			const r = saveKey("OPENAI_API_KEY", value);
			assert.ok(r.ok);
			assert.equal(process.env.OPENAI_API_KEY, value, "env updated immediately");
			assert.equal(authStore.authVars().OPENAI_API_KEY, value, "file updated");
			const row = keyStatuses().find((s) => s.id === "OPENAI_API_KEY")!;
			assert.ok(row.present);
			assert.equal(row.source, "file", "fill-gap reflection — origin is the store");
		});

		it("provider truncations/whitespace are 400s (paste hygiene only)", () => {
			assert.ok(!saveKey("OPENAI_API_KEY", "short").ok);
			assert.ok(!saveKey("OPENAI_API_KEY", "has whitespace now").ok);
			// ya no hay comprobación de familia: pasa cualquier token de ≥12 caracteres
			assert.ok(saveKey("OPENROUTER_API_KEY", "not-sk-or-but-12chars").ok);
		});

		it("isWritableAuthKey: curated ∪ provider env vars; unknown stays unwritable", () => {
			assert.ok(isWritableAuthKey("DEEPGRAM_API_KEY"));
			assert.ok(isWritableAuthKey("OPENROUTER_API_KEY"));
			assert.ok(isWritableAuthKey("OPENAI_API_KEY"));
			assert.ok(!isWritableAuthKey("FUTURE_PLANS_TOKEN"));
			assert.ok(!isWritableAuthKey("ANTHROPIC_AUTH_TOKEN"), "anthropic alternates stay env-only");
		});

		it("delete of a provider key: env + file both cleared", () => {
			deleteKey("OPENAI_API_KEY");
			assert.equal(process.env.OPENAI_API_KEY, undefined);
			assert.ok(!("OPENAI_API_KEY" in authStore.authVars()));
			// limpia también lo guardado de openrouter en la prueba de la guarda
			deleteKey("OPENROUTER_API_KEY");
			assert.ok(!("OPENROUTER_API_KEY" in authStore.authVars()));
		});
	});
});

describe("resolveKeyStatuses (pure projection)", () => {
	it("same value in env and file is NOT shadowed (redundant, not misleading)", () => {
		const row = resolveKeyStatuses(
			{ BRAVE_API_KEY: "BSA-same-value-throwaway-01234" },
			{ BRAVE_API_KEY: "BSA-same-value-throwaway-01234" },
			new Set(["BRAVE_API_KEY"]),
		).find((s) => s.id === "BRAVE_API_KEY")!;
		assert.ok(row, "the curated id is always in the projection");
		assert.equal(row.source, "env");
		assert.ok(!row.shadowedByEnv, "same value both places: redundant, not shadowed");
	});
});
