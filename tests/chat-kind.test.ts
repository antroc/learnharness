/**
 * FIJACIONES DEL TIPO DE SESIÓN (sesiones de práctica, responsable
 * 2026-10-04): ChatRecord.kind está AUSENTE POR DEFECTO; la ausencia se lee
 * como enseñanza, así que los registros anteriores a la práctica nunca
 * migran; "practice" marca una sesión de práctica adaptativa (el agente de
 * práctica + sus dos herramientas desde el turno 1, sin extracción ni
 * escrituras en el grafo). El almacén normaliza en la proyección del resumen;
 * createChat sella el marcador solo para la práctica. Se ejecuta con un
 * LH_DATA_DIR aislado (la disciplina de chat-birth-stamp: la frontera se fija
 * antes de cualquier import que cargue la configuración, así que todos los
 * imports de módulos de la app son dinámicos).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── la frontera, ANTES de cualquier import que cargue la configuración ──────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-kind-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { PRACTICE_PROBLEM_TOOL, PRACTICE_CONCLUDE_TOOL, newProblemDismissedMarker, newThinkingMessage, newUserMessage } = await import("../src/core/native-messages.ts");

type LhMessage = import("../src/core/native-messages.ts").LhMessage;

function practicePair(name: typeof PRACTICE_PROBLEM_TOOL | typeof PRACTICE_CONCLUDE_TOOL, callId: string, isError = false): LhMessage[] {
	return [
		{
			id: `msg_a_${callId}`,
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name, arguments: name === PRACTICE_PROBLEM_TOOL
				? { statement: "Show that…", mode: "recall", modelSolution: "Show that…" }
				: { outcome: "solved" } }],
			api: "faux",
			provider: "test",
			model: "test-model",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: 1,
		},
		{
			id: `msg_r_${callId}`,
			role: "toolResult",
			toolCallId: callId,
			toolName: name,
			content: [{ type: "text", text: isError ? "Tool refused" : "Tool completed" }],
			details: null,
			isError,
			timestamp: 2,
		},
	];
}

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("session kind (practice sessions, 2026-10-04)", () => {
	it("createChat default carries NO kind field — absence reads as teach", () => {
		const chat = chatStore.createChat("plain session");
		assert.equal("kind" in chat, false, "teach records carry no kind marker");
	});

	it("createChat(kind: 'practice') stamps the marker on record + list", () => {
		const chat = chatStore.createChat("practice session", "practice");
		assert.equal(chat.kind, "practice");
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "practice");
	});

	it("the summary projection NORMALIZES: absent record field reads as teach", () => {
		const chat = chatStore.createChat("another plain one");
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "teach");
	});

	it("the summary projection marks a practice session with a posed problem as pendingProblem", async () => {
		const { PRACTICE_PROBLEM_TOOL } = await import("../src/core/native-messages.ts");
		const waiting = chatStore.createChat("problem waiting", "practice");
		chatStore.saveMessages(waiting.id, [
			{
				id: "msg_a_call_p1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call_p1", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "Show that…", mode: "recall", modelSolution: "Show that…" } }],
				api: "faux",
				provider: "test",
				model: "test-model",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: 1,
			},
			{
				id: "msg_r_call_p1",
				role: "toolResult",
				toolCallId: "call_p1",
				toolName: PRACTICE_PROBLEM_TOOL,
				content: [{ type: "text", text: "Problem posed — the turn ends here." }],
				details: null,
				isError: false,
				timestamp: 2,
			},
		]);
		const idle = chatStore.createChat("no problem yet", "practice");
		const listed = chatStore.listChats();
		assert.equal(listed.find((c) => c.id === waiting.id)?.pendingProblem, true);
		assert.equal(listed.find((c) => c.id === idle.id)?.pendingProblem, false);
	});

	it("teaching summaries carry false without persisting the derived field", () => {
		const chat = chatStore.createChat("teaching conversation");
		chatStore.saveMessages(chat.id, [newUserMessage("Explain the material")]);
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "teach");
		assert.equal(listed?.pendingProblem, false);
		assert.equal("pendingProblem" in chatStore.getChat(chat.id)!, false);
	});

	const pose = () => practicePair(PRACTICE_PROBLEM_TOOL, "p1");
	const conclude = () => practicePair(PRACTICE_CONCLUDE_TOOL, "c1");
	const cases: Array<{ name: string; messages: LhMessage[]; pending: boolean }> = [
		{ name: "thinking keeps the posed problem waiting", messages: [...pose(), newThinkingMessage("p1", "My attempt")], pending: true },
		{ name: "a clean conclusion clears the waiting status", messages: [...pose(), ...conclude()], pending: false },
		{ name: "dismissal clears the stored waiting status before conclusion synthesis", messages: [...pose(), newProblemDismissedMarker("p1")], pending: false },
		{ name: "a failed pose never waits for input", messages: practicePair(PRACTICE_PROBLEM_TOOL, "p1", true), pending: false },
		{ name: "a dangling pose never waits for input", messages: pose().slice(0, 1), pending: false },
		{ name: "a failed conclusion keeps the problem waiting", messages: [...pose(), ...practicePair(PRACTICE_CONCLUDE_TOOL, "c1", true)], pending: true },
		{ name: "a dangling conclusion keeps the problem waiting", messages: [...pose(), ...conclude().slice(0, 1)], pending: true },
		{ name: "a rejected newer pose leaves the prior problem waiting", messages: [...pose(), ...practicePair(PRACTICE_PROBLEM_TOOL, "p2", true)], pending: true },
		{ name: "a new problem after a conclusion waits again", messages: [...pose(), ...conclude(), ...practicePair(PRACTICE_PROBLEM_TOOL, "p2")], pending: true },
	];

	for (const { name, messages, pending } of cases) {
		it(`the list projection: ${name}`, () => {
			const chat = chatStore.createChat(name, "practice");
			chatStore.saveMessages(chat.id, messages);
			const listed = chatStore.listChats().find((c) => c.id === chat.id);
			assert.equal(listed?.pendingProblem, pending);
			assert.equal(listed?.pendingQuestion, false, "practice status does not manufacture a teaching question");
		});
	}

	for (const stopReason of ["aborted", "error"] as const) {
		it(`an ${stopReason} generation with no pose acknowledgement never waits for input`, () => {
			const chat = chatStore.createChat(stopReason, "practice");
			const [call] = pose();
			assert.ok(call?.role === "assistant");
			chatStore.saveMessages(chat.id, [{ ...call, stopReason }]);
			assert.equal(chatStore.listChats().find((c) => c.id === chat.id)?.pendingProblem, false);
		});
	}
});
