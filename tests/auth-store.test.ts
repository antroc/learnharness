/**
 * El adaptador fs de AuthStore (oleada de claves de autenticación,
 * 2026-09-19): mapa plano {VAR: valor} en config.AUTH_FILE. ESTE FICHERO es el
 * único dueño de su fichero de autenticación: LH_AUTH_FILE se redirige a un
 * directorio temporal nuevo ANTES del primer import de la configuración (la
 * frontera está ligada a la carga del módulo; precedente de data-dir-seam),
 * así que nunca se toca un auth.json de desarrollo/escritorio editado a mano.
 *
 * Se fija: ausente/corrupto = {} («aún no hay claves»); ida y vuelta de
 * set/delete conservando tal cual las variables desconocidas; el fichero
 * SIEMPRE tiene modo 0600 (secretos); las escrituras son atómicas
 * (temporal+rename: sin estado JSON parcial).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-auth-store-"));
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");

// Importa DESPUÉS de la redirección del entorno: frontera ligada a la carga del módulo.
const { authStore } = await import("../src/store/auth.ts");
const { AUTH_FILE } = await import("../config.ts");
const { isSensitivePath, resolveSourcePath } = await import("../src/agent/tools/fs-shared.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe("AuthStore adapter", () => {
	it("absent file = {} (the documented first-boot state), never throws", () => {
		assert.deepEqual(authStore.authVars(), {});
	});

	it("set → read round-trip; trim is the CALLER's (server's) job, verbatim here", () => {
		authStore.setAuthVar("OPENROUTER_API_KEY", "sk-or-v1-abc");
		assert.equal(authStore.authVars().OPENROUTER_API_KEY, "sk-or-v1-abc");
	});

	it("the file is mode 0600 (secrets), also after rewrites", () => {
		authStore.setAuthVar("DEEPGRAM_API_KEY", "d".repeat(40));
		const first = fs.statSync(AUTH_FILE).mode & 0o777;
		assert.equal(first, 0o600);
		authStore.setAuthVar("DEEPGRAM_API_KEY", "e".repeat(40));
		assert.equal(fs.statSync(AUTH_FILE).mode & 0o777, 0o600, "rewrite keeps 0600");
	});

	it("set preserves unknown vars verbatim (forward-compat)", () => {
		fs.writeFileSync(AUTH_FILE, JSON.stringify({ FUTURE_PLANS_TOKEN: "opaque-xyz", KEEP: "me" }));
		authStore.setAuthVar("OPENROUTER_API_KEY", "sk-or-v1-new");
		const vars = authStore.authVars();
		assert.equal(vars.FUTURE_PLANS_TOKEN, "opaque-xyz");
		assert.equal(vars.KEEP, "me");
		assert.equal(vars.OPENROUTER_API_KEY, "sk-or-v1-new");
	});

	it("corrupt/non-object file = {} — never throws, looks like first boot", () => {
		fs.writeFileSync(AUTH_FILE, "{not json");
		assert.deepEqual(authStore.authVars(), {});
		fs.writeFileSync(AUTH_FILE, JSON.stringify(["an", "array"]));
		assert.deepEqual(authStore.authVars(), {});
		fs.writeFileSync(AUTH_FILE, JSON.stringify({ OK: "fine", bad: 42 }));
		assert.deepEqual(authStore.authVars(), { OK: "fine" }, "non-string values drop");
	});

	it("delete removes just that var; absent delete = silent no-op", () => {
		fs.writeFileSync(AUTH_FILE, JSON.stringify({ A: "1", B: "2" }));
		authStore.deleteAuthVar("A");
		assert.deepEqual(authStore.authVars(), { B: "2" });
		authStore.deleteAuthVar("NOT_THERE");
		assert.deepEqual(authStore.authVars(), { B: "2" });
	});

	it("the actual auth writer's complete 0600 temp is denied before replacement", (t) => {
		const rename = fs.renameSync;
		let observed = false;
		t.mock.method(fs, "renameSync", (...[tmp, destination]: Parameters<typeof rename>) => {
			assert.equal(destination, AUTH_FILE);
			const name = String(tmp);
			assert.match(name, /auth\.json\.tmp-[0-9a-f-]{36}$/);
			assert.equal(JSON.parse(fs.readFileSync(tmp, "utf8")).TEMP_CONTRACT, "synthetic-key");
			if (process.platform !== "win32") assert.equal(fs.statSync(tmp).mode & 0o777, 0o600);
			assert.equal(isSensitivePath(name), true);
			assert.throws(() => resolveSourcePath(name), /Access denied/);
			observed = true;
			return rename(tmp, destination);
		});
		authStore.setAuthVar("TEMP_CONTRACT", "synthetic-key");
		assert.equal(observed, true);
	});

	it("auth replaces a symlink with a 0600 record without modifying its referent", (t) => {
		const referent = path.join(TMP, "referent.json");
		const original = JSON.stringify({ KEEP: "original" });
		fs.writeFileSync(referent, original);
		fs.unlinkSync(AUTH_FILE);
		try { fs.symlinkSync(referent, AUTH_FILE); }
		catch {
			fs.writeFileSync(AUTH_FILE, original, { mode: 0o600 });
			t.skip("symlinks need extra rights on this machine");
			return;
		}
		authStore.setAuthVar("NEW", "synthetic");
		assert.ok(fs.lstatSync(AUTH_FILE).isFile());
		assert.deepEqual(authStore.authVars(), { KEEP: "original", NEW: "synthetic" });
		assert.equal(fs.readFileSync(referent, "utf8"), original);
		if (process.platform !== "win32") assert.equal(fs.statSync(AUTH_FILE).mode & 0o777, 0o600);
	});

	it("atomic writes: no tmp leftovers, valid JSON on disk every time", () => {
		authStore.setAuthVar("OPENROUTER_API_KEY", "sk-or-v1-final");
		const files = fs.readdirSync(TMP).filter((f) => f.includes(".tmp-"));
		assert.deepEqual(files, [], "no tmp file survives the rename");
		JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")); // debe poder analizarse
	});
});
