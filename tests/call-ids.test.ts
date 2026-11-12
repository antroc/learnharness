import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { ToolCallIdUniquifier, collectToolCallIds } from "../src/server/pi/call-ids.ts";

/**
 * EL INCIDENTE LACAN (arreglo aprobado por el responsable, 2026-10-04):
 * DeepSeek (a través de OpenRouter) devuelve ids de llamada a herramienta que
 * se reinician en cada respuesta: una sesión de una llamada por turno llama
 * `call_0` a TODAS las llamadas. El unificador está en el límite del cable
 * (runPiTurn): los ids que chocan se vuelven a acuñar una vez, y el mismo
 * acuñado se aplica en el asentamiento, así que cable + registro + contexto
 * del turno siguiente coinciden. Estas fijaciones lo manejan como unidad
 * pura: entran secuencias de eventos y salen eventos remapeados y mensajes
 * asentados.
 *
 * CONTRATO DE IDENTIDAD POR REFERENCIA: los mensajes en streaming no llevan
 * ids (se sellan al persistir), así que las tablas usan como clave la
 * identidad del objeto: el objeto de message_end es el objeto que guarda
 * agent.state.messages (verificado con pi-agent-core). Las fijaciones
 * guardan las referencias de la misma forma.
 */

const assistantMsg = (id: string, callIds: string[]): any => ({
	id,
	role: "assistant",
	content: callIds.map((cid) => ({ type: "toolCall", id: cid, name: "quiz", arguments: {} })),
});
const toolResultMsg = (callId: string): any => ({
	id: `r_${callId}`,
	role: "toolResult",
	toolCallId: callId,
	content: [],
	details: { kind: "quiz" },
});
const asEvent = (e: unknown): AgentEvent => e as AgentEvent;
const firstCallId = (e: AgentEvent): string => (e as any).message.content[0].id;

describe("ToolCallIdUniquifier", () => {
	it("unique ids pass through verbatim — the wire stays honest when the provider is", () => {
		const u = new ToolCallIdUniquifier(["call_9"]);
		const e = u.event(asEvent({ type: "message_end", message: assistantMsg("m1", ["toolu_abc"]) }));
		assert.equal(firstCallId(e), "toolu_abc");
	});

	it("a colliding id mints `orig~2` — on the message, the execution events, and the settle, identically", () => {
		const u = new ToolCallIdUniquifier(["call_0"]);
		const m1 = assistantMsg("m1", ["call_0"]);
		// la forma del streaming: start/update/end, el mismo mensaje lógico
		for (const t of ["message_start", "message_update", "message_end"]) {
			const e = u.event(asEvent({ type: t, message: m1 }));
			assert.equal(firstCallId(e), "call_0~2", `${t} shows the mint`);
		}
		const exec = u.event(asEvent({ type: "tool_execution_end", toolCallId: "call_0", toolName: "quiz", result: null, isError: false })) as { toolCallId: string };
		assert.equal(exec.toolCallId, "call_0~2");
		// asentamiento: el MISMO acuñado, llamada + resultado emparejados (m1 es el objeto del estado)
		const settled = u.remapSettled([m1, toolResultMsg("call_0")]) as Array<{
			role: string;
			content?: Array<{ id: string }>;
			toolCallId?: string;
		}>;
		assert.equal(settled[0]!.content![0]!.id, "call_0~2");
		assert.equal(settled[1]!.toolCallId, "call_0~2");
	});

	it("the same id in a SECOND message of the turn (a retry step) gets its own mint", () => {
		const u = new ToolCallIdUniquifier(["call_0"]);
		const m1 = assistantMsg("m1", ["call_0"]);
		const m2 = assistantMsg("m2", ["call_0"]);
		u.event(asEvent({ type: "message_end", message: m1 }));
		// message_start abre la época del segundo mensaje (la forma del bucle)
		u.event(asEvent({ type: "message_start", message: assistantMsg("m2", []) }));
		assert.equal(firstCallId(u.event(asEvent({ type: "message_end", message: m2 }))), "call_0~3");
		// cada resultado se empareja con la llamada de SU mensaje (el recorrido del ámbito)
		const settled = u.remapSettled([m1, toolResultMsg("call_0"), m2, toolResultMsg("call_0")]) as Array<{
			role: string;
			content?: Array<{ id: string }>;
			toolCallId?: string;
		}>;
		assert.equal(settled[0]!.content![0]!.id, "call_0~2");
		assert.equal(settled[1]!.toolCallId, "call_0~2");
		assert.equal(settled[2]!.content![0]!.id, "call_0~3");
		assert.equal(settled[3]!.toolCallId, "call_0~3");
	});

	it("mint candidates skip ids already used (a provider that counts globally can't be ambushed)", () => {
		const u = new ToolCallIdUniquifier(["call_0", "call_0~2"]);
		assert.equal(firstCallId(u.event(asEvent({ type: "message_end", message: assistantMsg("m1", ["call_0"]) }))), "call_0~3");
	});

	it("parallel calls in one message keep their distinct provider ids unless they collide", () => {
		const u = new ToolCallIdUniquifier(["call_1"]);
		const e = u.event(asEvent({ type: "message_end", message: assistantMsg("m1", ["call_0", "call_1"]) })) as unknown as {
			message: { content: Array<{ id: string }> };
		};
		assert.equal(e.message.content[0]!.id, "call_0", "non-colliding sibling untouched");
		assert.equal(e.message.content[1]!.id, "call_1~2", "colliding sibling minted");
	});

	it("agent_end carries the full state: prior-turn history verbatim, this turn remapped", () => {
		const priorTurn = [assistantMsg("m0", ["call_0"]), toolResultMsg("call_0")]; // duplicados heredados en el registro
		// sembrado exactamente como lo siembra chat-handler: los ids del registro
		const u = new ToolCallIdUniquifier(collectToolCallIds(priorTurn));
		const m1 = assistantMsg("m1", ["call_0"]);
		u.event(asEvent({ type: "message_end", message: m1 }));
		const e = u.event(asEvent({ type: "agent_end", messages: [...priorTurn, m1, toolResultMsg("call_0")] })) as unknown as {
			messages: Array<{ id?: string; role: string; content?: Array<{ id: string }>; toolCallId?: string }>;
		};
		// el historial NUNCA se reescribe (sus duplicados se reparan en el pliegue, view.ts)
		assert.equal(e.messages[0]!.content![0]!.id, "call_0");
		assert.equal(e.messages[1]!.toolCallId, "call_0");
		// la pareja de este turno es el acuñado
		assert.equal(e.messages[2]!.content![0]!.id, "call_0~2");
		assert.equal(e.messages[3]!.toolCallId, "call_0~2");
	});

	it("turn_end remaps its message and toolResults together", () => {
		const u = new ToolCallIdUniquifier(["call_0"]);
		const m1 = assistantMsg("m1", ["call_0"]);
		u.event(asEvent({ type: "message_end", message: m1 }));
		const e = u.event(asEvent({ type: "turn_end", message: m1, toolResults: [toolResultMsg("call_0")] })) as unknown as {
			message: { content: Array<{ id: string }> };
			toolResults: Array<{ toolCallId: string }>;
		};
		assert.equal(e.message.content[0]!.id, "call_0~2");
		assert.equal(e.toolResults[0]!.toolCallId, "call_0~2");
	});

	it("non-message events pass through untouched", () => {
		const u = new ToolCallIdUniquifier([]);
		assert.deepEqual(u.event({ type: "agent_start" }), { type: "agent_start" });
	});
});

describe("collectToolCallIds (the seen-set seed)", () => {
	it("gathers call ids and result ids from a record", () => {
		const ids = collectToolCallIds([
			{ id: "a", role: "user", content: "hi" },
			assistantMsg("m1", ["call_0", "toolu_x"]),
			toolResultMsg("call_0"),
			{ id: "m2", role: "assistant", content: [{ type: "text", text: "no calls" }] },
		]);
		assert.deepEqual(ids, ["call_0", "toolu_x", "call_0"]);
	});
});
