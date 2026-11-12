/**
 * FIJACIONES DE LOS EVENTOS DEL ALMACÉN DE CHATS (arquitectura push S6,
 * 2026-10-02): murió el sondeo de 2,5 s de la barra lateral; ahora la verdad
 * de la lista viaja en chats-changed. La ley del almacén: las escrituras que
 * cambian la FORMA de la lista (crear/renombrar/borrar) se anuncian tras
 * escribir; las escrituras de contenido (mensajes/uso/ajustes/árbol) son
 * silenciosas A PROPÓSITO; aquí se fija la ley del silencio para que se lea
 * como ley y no como descuido. Se ejecuta con un LH_DATA_DIR aislado (la
 * disciplina de chat-birth-stamp: la frontera se fija antes de cualquier
 * import que cargue la configuración, así que todos los imports de módulos
 * de la app son dinámicos).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── la frontera, ANTES de cualquier import que cargue la configuración ──────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-store-events-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { subscribe } = await import("../src/core/events.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("chat store events (S6: the silence law)", () => {
	it("createChat, renameChat, deleteChat each announce chats-changed", () => {
		let announces = 0;
		const off = subscribe((e) => {
			if (e.type === "chats-changed") announces++;
		});

		const chat = chatStore.createChat("Store events fixture");
		assert.equal(announces, 1, "create announces post-write");

		chatStore.renameChat(chat.id, "Renamed");
		assert.equal(announces, 2, "rename announces (a list-shape write)");

		assert.equal(chatStore.deleteChat(chat.id), true);
		assert.equal(announces, 3, "a real delete announces");
		off();
	});

	it("deleteChat on a missing id stays silent", () => {
		let announces = 0;
		const off = subscribe((e) => {
			if (e.type === "chats-changed") announces++;
		});
		assert.equal(chatStore.deleteChat("chat_never_existed"), false);
		assert.equal(announces, 0, "nothing was written — nothing announced");
		off();
	});

	it("content writes are DELIBERATELY silent (the law)", () => {
		const chat = chatStore.createChat("Silent content fixture");
		let announces = 0;
		const off = subscribe((e) => {
			if (e.type === "chats-changed") announces++;
		});

		// saveMessages: se dispara en cada persistencia de turno; inundaría el bus durante
		// los turnos; sus efectos visibles en la lista llegan mediante turn-started/settled.
		chatStore.saveMessages(chat.id, [{ id: "m1", role: "user", content: "hello", timestamp: 1 } as never]);
		// los añadidos de uso + ajustes + árbol: CONTENIDO del registro, no forma de la lista.
		chatStore.appendTurnUsage(chat.id, { id: "t1", messageId: "m1", at: "2026-10-02T00:00:00.000Z", model: "x:y", steps: [] });
		chatStore.appendExtractionUsage(chat.id, { startedAt: 1, at: "2026-10-02T00:00:00.000Z", durationMs: 1, stages: { extractor: { model: "x:y", steps: [] }, auditor: { model: "x:y", steps: [] } } });
		chatStore.saveSettings(chat.id, {});
		chatStore.saveTree(chat.id, { nodes: [], edges: [], version: 1 });

		assert.equal(announces, 0, "the silence law: content writes never announce");
		off();
		chatStore.deleteChat(chat.id);
	});
});
