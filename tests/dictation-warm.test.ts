/**
 * Pruebas unitarias: la caché de tokens precalentados del dictado (mitigación D, responsable
 * 2026-09-27: createWarmMinter de components/dictation.tsx).
 *
 * La ruta del clic toma la promesa en caché en vez de una acuñación remota, así que
 * el comportamiento de la caché ES la latencia de arranque percibida: una acuñación por ventana
 * de precalentamiento, nueva acuñación honesta ante un fallo, TTL para que nunca se sirva un token
 * caducado, y refresh() precalienta la siguiente ejecución en segundo plano.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWarmMinter } from "../components/dictation.tsx";

describe("warm-token cache (mitigation D, owner 2026-09-27)", () => {
	it("caches: concurrent and repeat mints share ONE promise and mint once", async () => {
		let mints = 0;
		const m = createWarmMinter(
			async () => {
				mints++;
				return "t1";
			},
			() => 1000,
			60_000,
		);
		const a = m.mint();
		const b = m.mint(); // concurrente: NO debe volver a acuñar
		assert.equal(a, b); // la misma instancia de promesa
		assert.equal(await a, "t1");
		assert.equal(await m.mint(), "t1"); // repetición: sigue sin segunda acuñación
		assert.equal(mints, 1);
	});

	it("a failed mint resets the cache — the next call re-mints (honest error path)", async () => {
		let keyless = true;
		let mints = 0;
		const m = createWarmMinter(
			async () => {
				mints++;
				if (keyless) throw new Error("Dictation needs a Deepgram key");
				return "t2";
			},
			() => 1000,
			60_000,
		);
		await assert.rejects(m.mint(), /Deepgram key/);
		keyless = false; // llega la clave
		assert.equal(await m.mint(), "t2");
		assert.equal(mints, 2);
	});

	it("TTL expiry re-mints — a stale token is never served", async () => {
		let t = 0;
		let mints = 0;
		const m = createWarmMinter(
			async () => {
				mints++;
				return `t${mints}`;
			},
			() => t,
			1000,
		);
		assert.equal(await m.mint(), "t1");
		t = 1500; // pasado el TTL
		assert.equal(await m.mint(), "t2");
		assert.equal(mints, 2);
		t = 1600; // aún dentro de la ventana de t2
		assert.equal(await m.mint(), "t2");
		assert.equal(mints, 2);
	});

	it("refresh() re-mints in the background and caches the result for the next run", async () => {
		let mints = 0;
		const m = createWarmMinter(
			async () => {
				mints++;
				return `t${mints}`;
			},
			() => 1000,
			60_000,
		);
		assert.equal(await m.mint(), "t1");
		m.refresh(); // el precalentamiento en segundo plano al final de la ejecución
		assert.equal(mints, 2);
		assert.equal(await m.mint(), "t2"); // servido desde la caché de refresh
		assert.equal(mints, 2); // sin tercera acuñación
	});

	it("refresh() swallows failure — a keyless page just doesn't warm", async () => {
		let mints = 0;
		const m = createWarmMinter(
			async () => {
				mints++;
				throw new Error("Dictation needs a Deepgram key");
			},
			() => 1000,
			60_000,
		);
		m.refresh(); // no debe rechazar (un rechazo no gestionado sería un fallo)
		await new Promise((r) => setTimeout(r, 0)); // deja que la acuñación en segundo plano se asiente
		assert.equal(mints, 1);
	});
});
