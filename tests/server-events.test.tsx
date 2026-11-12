/**
 * LA MITAD CLIENTE DEL CANAL DE NOTIFICACIONES (arquitectura push S3,
 * 2026-10-02): un EventSource por ventana, repartido por difusión a través del
 * hub. TODO el cuerpo del efecto del proveedor es wireSource(source, hub) (una
 * función simple), así que estas fijaciones usan el cableado real con una
 * fuente falsa, sin React ni servidor: despacho tipado, resincronización al
 * abrir, aislamiento de errores y que cerrar detenga el despacho. El pegamento
 * de React alrededor (hooks/contexto) es una frontera de adaptador como
 * lh:turn-state (sin pruebas, por precedente).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNotifyHub, wireSource, type NotifySource } from "../components/server-events.tsx";

/** Una fuente que la prueba maneja a mano: grabable, cerrable, honesta. */
function fakeSource() {
	const events = new Map<string, Set<(data: string) => void>>();
	const opens = new Set<() => void>();
	const src: NotifySource & {
		push(name: string, payload: unknown): void;
		open(): void;
		closed: boolean;
	} = {
		closed: false,
		close() {
			this.closed = true;
		},
		onOpen(cb) {
			opens.add(cb);
		},
		onEvent(name, cb) {
			const set = events.get(name) ?? new Set();
			events.set(name, set);
			set.add(cb);
		},
		push(name, payload) {
			for (const cb of events.get(name) ?? []) cb(JSON.stringify(payload));
		},
		open() {
			for (const cb of opens) cb();
		},
	};
	return src;
}

describe("notify hub + wireSource (the client channel wiring)", () => {
	it("a named frame dispatches to the right subscriber with the parsed payload", () => {
		const hub = createNotifyHub();
		const src = fakeSource();
		wireSource(src, hub);
		const got: string[] = [];
		hub.subscribe("turn-started", (p) => got.push(p.chatId));
		hub.subscribe("turn-settled", (p) => got.push(`settled:${p.chatId}`));
		src.push("turn-started", { chatId: "chat_wire" });
		src.push("turn-settled", { chatId: "chat_wire" });
		src.push("jobs-changed", { chatId: "chat_wire" }); // sin suscriptor: operación nula
		assert.deepEqual(got, ["chat_wire", "settled:chat_wire"]);
	});

	it("open fires resync (initial AND reconnect — EventSource's own retry exploited)", () => {
		const hub = createNotifyHub();
		const src = fakeSource();
		wireSource(src, hub);
		let resyncs = 0;
		hub.onResync(() => resyncs++);
		src.open();
		src.open(); // el caso de reconexión: el mismo callback, disparado de nuevo
		assert.equal(resyncs, 2);
	});

	it("a throwing handler never breaks its neighbors (the bus's isolation law)", () => {
		const hub = createNotifyHub();
		const src = fakeSource();
		wireSource(src, hub);
		hub.subscribe("chats-changed", () => {
			throw new Error("handler bug");
		});
		const got: number[] = [];
		hub.subscribe("chats-changed", () => got.push(1));
		src.push("chats-changed", {});
		assert.deepEqual(got, [1]);
	});

	it("an unparseable frame is dropped loudly, never half-fired", () => {
		const hub = createNotifyHub();
		const src = fakeSource();
		wireSource(src, hub);
		let calls = 0;
		hub.subscribe("activity-changed", () => calls++);
		// dispatch es el propio analizador de la frontera: dale basura directamente
		hub.dispatch("activity-changed", "{not json");
		assert.equal(calls, 0);
	});

	it("unsubscribe stops delivery; close() (the disconnect) is wired through", () => {
		const hub = createNotifyHub();
		const src = fakeSource();
		const disconnect = wireSource(src, hub);
		let calls = 0;
		const off = hub.subscribe("chats-changed", () => calls++);
		src.push("chats-changed", {});
		off();
		src.push("chats-changed", {});
		assert.equal(calls, 1);
		assert.equal(src.closed, false, "connected until the provider unmounts");
		disconnect();
		assert.equal(src.closed, true, "the effect's cleanup closes the source");
	});
});
