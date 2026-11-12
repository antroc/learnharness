/**
 * LA FIJACIÓN ANTI-DERIVA (interludio de claves de proveedor, 2026-09-19):
 * AUTH_PROVIDER_KEYS de core/auth-keys.ts dice ser exactamente la tabla
 * proveedor→variable de entorno de pi-ai (menos las exclusiones de la
 * especificación del responsable). Esta prueba vuelve a derivar la VERDAD a
 * partir del propio pi-ai y afirma la igualdad exacta, así que una
 * actualización de pi-ai que añade, renombra o reetiqueta una clave de
 * proveedor HACE FALLAR la barrera de forma ruidosa en vez de que la tabla se
 * desvíe en silencio de lo que pi lee de verdad.
 *
 * Derivación (el mismo mecanismo que generó la tabla): el mapa de exports de
 * pi-ai no expone env-api-keys.js como subruta, así que esta prueba lo
 * importa en profundidad por ruta RELATIVA (las pruebas pueden; el código de
 * tiempo de ejecución nunca). findEnvKeys con un env Proxy que resuelve como
 * verdadero cualquier nombre de variable devuelve TODAS las variables de
 * entorno que un proveedor lee como claves de API.
 *
 * Exclusiones de la especificación del responsable (se afirma que FALTAN):
 * github-copilot (OAuth), amazon-bedrock (credenciales de AWS), google-vertex
 * (ADC), azure (necesita URL base), la pareja de cloudflare acotada a la
 * cuenta; anthropic conserva solo ANTHROPIC_API_KEY (AUTH_TOKEN/OAUTH_TOKEN
 * se quedan solo en el entorno).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_PROVIDER_KEYS, isProviderEnvVar } from "../src/core/auth-keys.ts";
import { builtinProviders } from "../node_modules/@earendil-works/pi-ai/dist/providers/all.js";
import { findEnvKeys } from "../node_modules/@earendil-works/pi-ai/dist/env-api-keys.js";

/** pi-ai lee anthropic también mediante las alternativas AUTH_TOKEN/
 * OAUTH_TOKEN; por especificación del responsable se quedan solo en el
 * entorno; más abajo se afirma que faltan. */
const ANTHROPIC_ALTERNATES = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"];

const EXCLUDED_PROVIDERS = new Set([
	"github-copilot",
	"amazon-bedrock",
	"google-vertex",
	"azure",
	"cloudflare-workers-ai",
	"cloudflare-ai-gateway",
]);

/** Un env proxy en el que TODO nombre de variable resuelve como verdadero:
 * findEnvKeys devuelve entonces todas las variables de entorno que el
 * proveedor lee como fuente de clave de API. */
const truthyEnv = new Proxy({} as Record<string, string>, {
	get: (_t, key) => (typeof key === "string" ? "x" : undefined),
	has: () => true,
});

/** La verdad, derivada de pi-ai al ejecutar la prueba. */
function deriveProviders() {
	const rows: Array<{ id: string; envVar: string; label: string }> = [];
	for (const p of builtinProviders()) {
		const keys = findEnvKeys(p.id, truthyEnv);
		if (!keys || EXCLUDED_PROVIDERS.has(p.id)) continue;
		const first = keys[0];
		if (!first) continue; // inalcanzable con el proxy verdadero; satisface al comprobador
		const envVar = p.id === "anthropic" ? "ANTHROPIC_API_KEY" : first;
		rows.push({ id: p.id, envVar, label: p.name });
	}
	rows.sort((a, b) => a.id.localeCompare(b.id));
	return rows;
}

describe("AUTH_PROVIDER_KEYS — the no-drift pin against pi-ai", () => {
	it("is EXACTLY pi-ai's plain-key provider table (id, envVar, label), exclusions applied", () => {
		const truth = deriveProviders();
		const mine = [...AUTH_PROVIDER_KEYS].sort((a, b) => a.id.localeCompare(b.id));
		assert.deepEqual(
			mine.map((p) => [p.id, p.envVar, p.label]),
			truth.map((p) => [p.id, p.envVar, p.label]),
			"pi-ai's provider env-key table changed — regenerate AUTH_PROVIDER_KEYS (src/core/auth-keys.ts) from the derivation in this test",
		);
	});

	it("the owner-spec exclusions are absent", () => {
		const ids = new Set(AUTH_PROVIDER_KEYS.map((p) => p.id));
		for (const excluded of EXCLUDED_PROVIDERS) assert.ok(!ids.has(excluded), `${excluded} must not be listed`);
		for (const p of AUTH_PROVIDER_KEYS) {
			assert.ok(!ANTHROPIC_ALTERNATES.includes(p.envVar), `${p.envVar} must not appear`);
		}
	});

	it("openrouter IS in the table (it graduated from the curated catalog)", () => {
		const row = AUTH_PROVIDER_KEYS.find((p) => p.id === "openrouter");
		assert.ok(row);
		assert.equal(row.envVar, "OPENROUTER_API_KEY");
	});

	it("isProviderEnvVar: exactly the table's distinct env vars", () => {
		for (const p of AUTH_PROVIDER_KEYS) assert.ok(isProviderEnvVar(p.envVar), `${p.envVar} is a provider var`);
		assert.ok(!isProviderEnvVar("OPENROUTER_API_KEYS"), "typo'd name is not one");
		assert.ok(!isProviderEnvVar("DEEPGRAM_API_KEY"), "curated ≠ provider — separate surfaces");
	});
});
