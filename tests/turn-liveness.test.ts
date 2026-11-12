/**
 * Pruebas unitarias del registro de vida del turno (src/server/turn-liveness.ts):
 * un turno por chat, siempre: ida y vuelta de begin/end, rechazo del doble
 * begin, reinicio tras end. El TTL de expulsión de obsoletos de 30 minutos no se
 * prueba (es una guarda contra fugas, no un comportamiento). Las fijaciones del
 * emisor del ciclo de vida usan las mismas fronteras: turn-started solo en el
 * begin aceptado, turn-settled solo en el end vivo, y el registro ya coherente
 * cuando se ejecuta el listener.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beginTurn, endTurn, isTurnRunning } from "../src/server/turn-liveness.ts";
import { subscribe, type ServerEvent } from "../src/core/events.ts";
import { rememberTurnFailure, settledTurnResponse } from "../src/server/turn-runs.ts";

describe("turn liveness registry", () => {
	it("retains a late-attach failure notice until the next accepted begin", async () => {
		const id = "chat_failure_notice_unit";
		rememberTurnFailure(id, "The reply could not be saved.");
		assert.match(await settledTurnResponse(id).text(), /The reply could not be saved\./);
		assert.match(await settledTurnResponse(id).text(), /The reply could not be saved\./, "reading does not consume the notice");
		assert.equal(beginTurn(id), true);
		assert.doesNotMatch(await settledTurnResponse(id).text(), /"type":"error"/);
		endTurn(id);
	});

	it("begin/end round trip; a second begin is rejected until the turn ends", () => {
		const id = "chat_liveness_unit";
		assert.equal(isTurnRunning(id), false, "initially idle");
		assert.equal(beginTurn(id), true, "first turn accepted");
		assert.equal(isTurnRunning(id), true, "in flight");
		assert.equal(beginTurn(id), false, "no two turns for one chat");
		endTurn(id);
		assert.equal(isTurnRunning(id), false, "cleared at finish");
		assert.equal(beginTurn(id), true, "a new turn may start after the last ended");
		endTurn(id);
	});
});

describe("turn lifecycle events", () => {
	it("beginTurn emits turn-started on success only — the 409 double-begin stays silent", () => {
		const id = "chat_events_begin";
		const got: ServerEvent[] = [];
		const off = subscribe((e) => got.push(e));
		assert.equal(beginTurn(id), true, "fresh chat accepts the turn");
		assert.equal(beginTurn(id), false, "the rejected double-begin");
		assert.deepEqual(got, [{ type: "turn-started", chatId: id }], "exactly one event");
		endTurn(id); // limpieza (su asentamiento se comprueba en los términos del caso siguiente)
		off();
	});

	it("endTurn emits turn-settled only when a live entry was present", () => {
		const id = "chat_events_end";
		const got: ServerEvent[] = [];
		let runningAtSettle: boolean | undefined;
		const off = subscribe((e) => {
			got.push(e);
			// El asentamiento debe observarse como ya en reposo: la escritura en el registro
			// ocurre ANTES de la emisión, así que un listener que pide la verdad
			// (todo el sentido de notificar → pedir) lee un estado coherente.
			if (e.type === "turn-settled") runningAtSettle = isTurnRunning(id);
		});
		beginTurn(id);
		got.length = 0; // céntrate en el camino del asentamiento
		endTurn(id); // entrada viva → asentamiento
		endTurn(id); // entrada ausente → operación nula defensiva, debe quedarse callada
		assert.deepEqual(got, [{ type: "turn-settled", chatId: id }]);
		assert.equal(runningAtSettle, false, "listener sees the registry already cleared");
		off();
	});
});
