/**
 * phases: la cadena de fases dirigida por eventos (docs/archive/probe-teach-split.md §4).
 *
 * El sondeo termina en el primer probe_done CONCLUIDO (output-available); la
 * enseñanza empieza en la PRIMERA LLAMADA de quiz etiquetada con nodeId (la
 * frontera inferida, decisión del responsable del 2026-09-26; la muerte del
 * veredicto: presentar el plan termina el turno del profesor, la respuesta
 * del alumno es texto natural y nada cambia la fase hasta que se plantea de
 * verdad una pregunta SOBRE un nodo del plan). Sin frontera en el árbol
 * guardado: la fase es un plegado puro sobre la transcripción, así que nunca
 * puede quedarse atascada (el antiguo phaseOfTree basado en currentNodeId leía
 * un campo que nada llegaba a asignar).
 */
import assert from "node:assert";
import test from "node:test";
import type { LhViewMessage } from "../src/core/view.ts";
import { phaseAt3, phaseTimeline, type Phase3 } from "../src/core/phases.ts";

/** Mensaje de usuario solo de texto. */
function user(text: string): LhViewMessage {
	return { id: `u_${text}`, role: "user", parts: [{ type: "text", text }] };
}

/** Un mensaje del asistente con una parte de herramienta en el estado indicado. */
function assistantTool(
	name: string,
	state: "input-available" | "output-available" | "output-error",
	output?: unknown,
): LhViewMessage {
	return {
		id: `a_${name}_${state}_${Math.random().toString(36).slice(2, 6)}`,
		role: "assistant",
		parts: [{ type: `tool-${name}`, state, ...(output !== undefined ? { output } : {}) } as never],
	};
}

/** Una llamada de quiz con su entrada analizada: `nodeId` presente sii está etiquetada. */
function assistantQuiz(input: Record<string, unknown> | undefined): LhViewMessage {
	return {
		id: `a_quiz_${Math.random().toString(36).slice(2, 6)}`,
		role: "assistant",
		parts: [{ type: "tool-quiz", ...(input !== undefined ? { input } : {}) } as never],
	};
}

const DONE_ASSESSMENT = { assessment: { strands: [{ strand: "s", assessment: "a" }] } };
const PLAN_OK = { ok: true, tree: { nodes: [{ id: "n1", title: "N" }], edges: [] } };

test("phaseAt3: probe until a concluded probe_done; plan until the first nodeId-tagged quiz; teach after", () => {
	const probe = phaseAt3([user("teach me calculus"), assistantQuiz({ question: "q", correctAnswer: "a" })]);
	assert.equal(probe, "probe", "an UNTAGGED quiz alone never ends the probe (probe quizzes carry no nodeId)");

	const concluded = phaseAt3([
		user("teach me"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
	]);
	assert.equal(concluded, "plan", "a concluded probe_done ends the probe (planning begins)");

	const presented = phaseAt3([
		user("teach me"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
		assistantTool("plan_init", "output-available", PLAN_OK),
		user("looks good, go"),
	]);
	assert.equal(presented, "plan", "plan_init + the learner's go-ahead TEXT present and sanction nothing");

	const teaching = phaseAt3([
		user("teach me"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
		assistantTool("plan_init", "output-available", PLAN_OK),
		user("looks good, go"),
		assistantQuiz({ question: "q", nodeId: "gravity-basics", correctAnswer: "a" }),
	]);
	assert.equal(teaching, "teach", "the first nodeId-tagged quiz CALL is where teaching begins");

	const failedPlan = phaseAt3([
		user("teach me"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
		assistantTool("plan_init", "output-error", { ok: false, error: "bad mermaid" }),
		assistantQuiz({ question: "q", nodeId: "n1", correctAnswer: "a" }),
	]);
	assert.equal(failedPlan, "teach", "a tagged quiz begins teaching even after a failed init attempt");
});

test("phaseAt3: the tag is the seam — natural text and untagged questions never start teaching", () => {
	const plainText = phaseAt3([
		user("teach me"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
		assistantTool("plan_init", "output-available", PLAN_OK),
		user("The plan is accepted — begin teaching."), // solo palabras
		assistantQuiz({ question: "ad-hoc check", correctAnswer: "a" }), // sin etiquetar
	]);
	assert.equal(plainText, "plan", "only a nodeId-tagged quiz flips the seam — text and ad-hoc checks never do");

	const taggedOutOfOrder = phaseAt3([
		user("teach me"),
		assistantQuiz({ question: "q", nodeId: "n1", correctAnswer: "a" }), // antes de probe_done
	]);
	assert.equal(taggedOutOfOrder, "probe", "the chain never skips");
});

test("phaseAt3: a mere probe_done CALL (input-available, not yet concluded) keeps the probe open", () => {
	const still = phaseAt3([user("teach me"), assistantTool("probe_done", "input-available")]);
	assert.equal(still, "probe");
});

test("phaseAt3 and phaseTimeline: explicit probe refusals never advance the UI phase", () => {
	const refused = assistantTool("probe_done", "output-available", { ok: false, error: "question open" });
	const errored = assistantTool("probe_done", "output-error", { ok: true });
	const tagged = assistantQuiz({ nodeId: "n1" });
	const clean = assistantTool("probe_done", "output-available", { ok: true });
	const messages = [refused, errored, tagged, clean, tagged];
	assert.equal(phaseAt3(messages, 2), "probe");
	assert.deepEqual(phaseTimeline(messages), ["probe", "probe", "probe", "plan", "teach"]);
});

test("phaseAt3: legacy transcripts without probe_done read as probe (no backwards compat — data wiped)", () => {
	const legacy = phaseAt3([user("teach me lacan"), assistantTool("plan_init", "output-available", PLAN_OK)]);
	assert.equal(legacy, "probe", "plan_init alone never flips a phase post-split");
});

test("phaseTimeline: folds messages into phase spans for the dividers", () => {
	const timeline = phaseTimeline([
		user("teach me"),
		assistantTool("quiz", "output-available"),
		assistantTool("probe_done", "output-available", DONE_ASSESSMENT),
		assistantTool("plan_init", "output-available", PLAN_OK),
		user("what does node 1 mean?"), // pregunta lateral: sigue planificando
		user("go on"),
		assistantQuiz({ question: "q", nodeId: "n1", correctAnswer: "a" }),
		assistantQuiz({ question: "q2", nodeId: "n2", correctAnswer: "a" }),
	]);
	assert.deepEqual(timeline satisfies Phase3[], ["probe", "probe", "plan", "plan", "plan", "plan", "teach", "teach"]);
	assert.equal(timeline.length, 8);
});

test("phaseAt3: empty transcript is probe", () => {
	assert.equal(phaseAt3([]), "probe");
});

// ─── el plegado nativo (phaseAt3Lh sobre LhMessage[]) ───────────────────────

import type { LhMessage } from "../src/core/native-messages.ts";
import { phaseAt3Lh } from "../src/core/phases.ts";

/** Un toolResult nativo (la conclusión de probe_done). */
function toolResult(toolName: string, isError = false): LhMessage {
	return {
		id: `tr_${toolName}_${Math.random().toString(36).slice(2, 6)}`,
		role: "toolResult",
		toolCallId: `call_${toolName}`,
		toolName,
		content: [{ type: "text", text: "ok" }],
		isError,
		timestamp: Date.now(),
	} as LhMessage;
}

/** Un mensaje nativo del asistente con un toolCall de quiz: los argumentos
 *  llevan `nodeId` sii está etiquetada (exactamente lo que persistiría el cable). */
function assistantQuizCall(arguments_: Record<string, unknown>): LhMessage {
	return {
		id: `a_${Math.random().toString(36).slice(2, 6)}`,
		role: "assistant",
		content: [{ type: "toolCall", id: "call_quiz", name: "quiz", arguments: arguments_ }],
		stopReason: "toolUse",
		usage: undefined,
		timestamp: Date.now(),
	} as unknown as LhMessage;
}

function assistantProbeCall(): LhMessage {
	return {
		...assistantQuizCall({}),
		content: [{ type: "toolCall", id: "call_probe_done", name: "probe_done", arguments: {} }],
	} as LhMessage;
}

test("phaseAt3Lh (native fold): probe→plan at the clean probe_done result; plan→teach at the first tagged quiz CALL", () => {
	const done = toolResult("probe_done");
	const call = assistantProbeCall();
	const tagged = assistantQuizCall({ question: "q", nodeId: "gravity-basics", correctAnswer: "a" });
	const untagged = assistantQuizCall({ question: "q", correctAnswer: "a" });

	assert.equal(phaseAt3Lh([call, done, untagged]), "plan", "an untagged quiz call never starts teaching");
	assert.equal(phaseAt3Lh([call, done, tagged]), "teach", "the tagged quiz CALL is the seam");
	assert.equal(phaseAt3Lh([tagged]), "probe", "the chain never skips (tag before probe_done)");
	assert.equal(
		phaseAt3Lh([call, toolResult("probe_done", true), tagged]),
		"probe",
		"an ERRORED probe_done concludes nothing",
	);
	// Los dos plegados coinciden sobre la misma transcripción asentada (la proyección
	// de vista de la llamada etiquetada lleva sus argumentos como entrada de la parte).
	assert.equal(
		phaseAt3Lh([call, done, tagged]),
		phaseAt3([
			{ parts: [{ type: "tool-probe_done", state: "output-available" } as never] },
			{ parts: [{ type: "tool-quiz", input: { nodeId: "gravity-basics" } } as never] },
		]),
	);
});

// ─── la mecánica explain en la frontera (responsable, 2026-09-27) ──────────
// Las dos herramientas de preguntas (quiz O explain, la que armen los ajustes)
// abren la enseñanza: la frontera es estructural, no ligada al nombre de la herramienta MC.

test("phaseAt3 + phaseAt3Lh: a tagged explain CALL is the plan→teach seam too", () => {
	const done = toolResult("probe_done");
	const call = assistantProbeCall();
	const explainCall = (args: Record<string, unknown>): LhMessage =>
		({
			id: "a_explain",
			role: "assistant",
			content: [{ type: "toolCall", id: "call_explain", name: "explain", arguments: args }],
			timestamp: Date.now(),
		}) as unknown as LhMessage;

	const tagged = explainCall({ question: "q", correctAnswer: "a", explanation: "e", nodeId: "gravity-basics" });
	const untagged = explainCall({ question: "q", correctAnswer: "a", explanation: "e" });

	assert.equal(phaseAt3Lh([call, done, untagged]), "plan", "an untagged explain never starts teaching");
	assert.equal(phaseAt3Lh([call, done, tagged]), "teach", "the tagged explain CALL is the seam");
	assert.equal(
		phaseAt3Lh([call, done, tagged]),
		phaseAt3([
			{ parts: [{ type: "tool-probe_done", state: "output-available" } as never] },
			{ parts: [{ type: "tool-explain", input: { nodeId: "gravity-basics" } } as never] },
		]),
		"the two folds agree on the explain mechanic",
	);
});
