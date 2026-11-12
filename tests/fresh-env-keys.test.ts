/**
 * LH_IGNORE_ENV_KEYS=1: el interruptor de usuario nuevo (responsable, interludio,
 * 2026-09-22): las claves del entorno son invisibles en toda la aplicación; solo cuenta auth.json.
 *
 * Este fichero es deliberadamente su PROPIO PROCESO bajo node:test: el interruptor
 * actúa AL ARRANCAR (initAuthEnv borra las variables de entorno gestionadas una vez por
 * proceso), así que el arranque con el interruptor solo puede fijarse en un proceso que
 * empiece con el interruptor activado. El comportamiento SIN activar (gana el entorno, relleno de huecos,
 * semántica de tapado) lo fija byte a byte tests/server-keys.test.ts:
 * ese fichero ES el caso visible; este es el oculto.
 *
 * La ruta del motor es la sutileza crítica que fija este fichero: pi-ai lee
 * las claves del proveedor de process.env DE FORMA NATIVA en cada petición
 * (defaultProviderAuthContext de auth/context.js lee el entorno vivo), así que el
 * interruptor funciona BORRANDO las variables del proceso: comprueba el
 * borrado directamente, porque eso es lo que ven los motores de un usuario nuevo.
 *
 * LH_AUTH_FILE redirige a un directorio temporal nuevo ANTES de las importaciones (la
 * frontera está ligada a la carga del módulo). Todos los valores son cadenas de prueba desechables,
 * nunca secretos reales.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// EL ENTORNO DE ESTE PROCESO ES EL SUJETO DE LA PRUEBA: quita cualquier variable del catálogo
// heredada (una shell de desarrollador puede exportar claves REALES; las pruebas solo usan
// valores desechables, nunca secretos reales).
for (const varName of [
	"OPENROUTER_API_KEY",
	"DEEPGRAM_API_KEY",
	"TAVILY_API_KEY",
	"BRAVE_API_KEY",
	"EXA_API_KEY",
	"FIRECRAWL_API_KEY",
	"OLLAMA_API_KEY",
	"OPENAI_API_KEY",
	"ZAI_API_KEY",
]) {
	delete process.env[varName];
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fresh-env-keys-"));
const AUTH = path.join(TMP, "auth.json");
process.env.LH_AUTH_FILE = AUTH;

// El fichero ANTES del primer arranque: una clave que solo está en el fichero.
fs.writeFileSync(AUTH, JSON.stringify({ OPENAI_API_KEY: "sk-file-fresh-file-fresh" }));

// El entorno que el interruptor debe ocultar, fijado ANTES de la primera importación del módulo:
//  - una clave de proveedor SOLO en el entorno (el espécimen de la ruta del motor)
//  - la MISMA variable que contiene el fichero (el espécimen de colisión: con el
//    interruptor debe ganar el valor del FICHERO y debe borrarse la copia del entorno)
process.env.OPENROUTER_API_KEY = "sk-or-env-env-env";
process.env.OPENAI_API_KEY = "sk-openai-env-env-env";

// EL INTERRUPTOR: fijado antes de la primera importación (exactamente como arranca el lanzador).
process.env.LH_IGNORE_ENV_KEYS = "1";

// Importa DESPUÉS de preparar el entorno: la inicialización del módulo ejecuta el borrado de arranque + el relleno de huecos.
const { deleteKey, envKeysIgnored, initAuthEnv, keyStatuses, keyValue, saveKey } = await import(
	"../src/server/keys.ts"
);
const { authStore } = await import("../src/store/auth.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("the fresh-user switch (boot under LH_IGNORE_ENV_KEYS=1)", () => {
	it("the switch reads live (the launcher exports it before boot)", () => {
		assert.equal(envKeysIgnored(), true);
	});

	it("THE ENGINE PATH: env-only keys are DELETED from the process — pi-ai's native per-request env resolution finds nothing", () => {
		assert.equal(process.env.OPENROUTER_API_KEY, undefined, "deleted from process.env at boot");
	});

	it("the env copy of a file-backed var is deleted; the FILE value is what fills the env (only auth.json counts)", () => {
		assert.equal(process.env.OPENAI_API_KEY, "sk-file-fresh-file-fresh", "the env copy died; the fill-gap reflected the file value");
		assert.equal(authStore.authVars().OPENAI_API_KEY, "sk-file-fresh-file-fresh");
	});

	it("keyValue: env keys invisible, file keys visible — and a post-boot env reintroduction stays invisible (belt-and-suspenders)", () => {
		assert.equal(keyValue("OPENROUTER_API_KEY"), undefined, "env key invisible under the switch");
		assert.equal(keyValue("OPENAI_API_KEY"), "sk-file-fresh-file-fresh", "file key visible");
		// Un consumidor descarriado vuelve a fijar una clave del entorno DESPUÉS del arranque: la frontera
		// sigue ignorándola (el borrado es al arrancar; la guarda de lectura está viva).
		process.env.OPENROUTER_API_KEY = "sk-or-reintroduced-late";
		try {
			assert.equal(keyValue("OPENROUTER_API_KEY"), undefined, "reintroduced env key stays invisible to the seam");
		} finally {
			delete process.env.OPENROUTER_API_KEY;
		}
	});

	it("unset switch = today's env-wins behavior (the read seam, live-checked)", () => {
		// La mitad dinámica de la frontera: SIN el interruptor, keyValue lee
		// primero el entorno: el comportamiento actual, byte a byte (la mitad de la
		// instantánea de arranque se fija en tests/server-keys.test.ts, el caso visible).
		process.env.LH_IGNORE_ENV_KEYS = undefined;
		process.env.OPENROUTER_API_KEY = "sk-or-env-wins";
		try {
			assert.equal(keyValue("OPENROUTER_API_KEY"), "sk-or-env-wins", "env wins without the switch");
			assert.equal(keyValue("OPENAI_API_KEY"), "sk-file-fresh-file-fresh", "file is the fallback without the switch");
		} finally {
			delete process.env.OPENROUTER_API_KEY;
			process.env.LH_IGNORE_ENV_KEYS = "1";
		}
	});

	it("the status view is the fresh machine's: file sources only, no env rows, no shadowing", () => {
		const rows = keyStatuses();
		const openai = rows.find((r) => r.id === "OPENAI_API_KEY");
		assert.ok(openai, "the file-backed provider key has a row");
		assert.equal(openai!.present, true);
		assert.equal(openai!.source, "file", "realEnv is empty under the switch — nothing reports as env");
		assert.equal(openai!.shadowedByEnv, false);
		assert.equal(rows.some((r) => r.id === "OPENROUTER_API_KEY"), false, "the env-only key is gone everywhere — no row");
		assert.equal(rows.some((r) => r.source === "env"), false, "no env-owned key under the switch");
	});

	it("a fresh user CAN add keys mid-session: save reflects file → env (engines see it, no restart)", () => {
		const result = saveKey("ZAI_API_KEY", "zai-fresh-sim-key-1234567890");
		assert.equal(result.ok, true);
		assert.equal(authStore.authVars().ZAI_API_KEY, "zai-fresh-sim-key-1234567890", "persisted to the file");
		assert.equal(process.env.ZAI_API_KEY, "zai-fresh-sim-key-1234567890", "reflected into env for pi-ai");
		const row = keyStatuses().find((r) => r.id === "ZAI_API_KEY");
		assert.equal(row!.source, "file", "the status honestly reports the file as the source");
		// y DELETE elimina ambas (la semántica de relleno de huecos se mantiene con el interruptor)
		deleteKey("ZAI_API_KEY");
		assert.equal(process.env.ZAI_API_KEY, undefined);
		assert.equal(authStore.authVars().ZAI_API_KEY, undefined);
	});

	it("re-running initAuthEnv is idempotent — deleted env keys never resurrect", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-zombie";
		initAuthEnv();
		assert.equal(process.env.OPENROUTER_API_KEY, undefined, "a reintroduced env key is re-deleted");
		assert.equal(process.env.OPENAI_API_KEY, "sk-file-fresh-file-fresh", "the file reflection survives re-init");
	});
});
