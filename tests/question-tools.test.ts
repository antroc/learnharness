/**
 * Las herramientas de preguntas separadas por agente (docs/archive/probe-teach-split.md §1):
 *
 *  - teachQuizToolFor: el quiz del PROFESOR: el contrato de autoría compartido +
 *    la validación del nodeId del plan por sesión (señal de posición; un id que no
 *    encaja se rechaza en la frontera de la llamada y vuelve al agente para que lo arregle).
 *  - createProberTools: el quiz del SONDEADOR NO tiene ningún campo nodeId (el
 *    esquema se construye a partir de quizInputBase; la clave se elimina si el
 *    modelo lo intenta de todos modos), más ask + probe_done.
 *
 * El contrato de calificación (question-core) es compartido y ninguno de los dos lo toca.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { Value } from "typebox/value";
import {
	askUserQuestionTool,
	createProberTools,
	createTeacherTools,
	probeQuizTool,
	probeExplainTool,
	quizExampleBody,
	teachExplainToolFor,
	teachQuizToolFor,
	type TeacherToolContext,
} from "../src/agent/tools.ts";
import { TOGGLEABLE_TOOLS } from "../src/core/pending.ts";
import { jobStore } from "../src/store/jobs.ts";
import { probeQuizInputSchema, quizInputObject, quizInputProblems } from "../src/core/question-core.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";

const dataDir = path.join(PATHS.root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* limpieza del espacio temporal, con el mejor esfuerzo */
		}
	}
});

function newChat(title: string): string {
	const chat = chatStore.createChat(title);
	createdChats.push(chat.id);
	return chat.id;
}

const validQuiz = {
	question: "What is 2 + 2?",
	options: [
		{ label: "3", value: "3" },
		{ label: "4", value: "4" },
	],
	correctAnswer: "4",
	explanation: "Arithmetic.",
	type: "check",
	nodeId: "arith",
};

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** El predicado de frontera de la oleada A (2026-09-26): el bucle de pi valida la
 *  estructura contra los parámetros TypeBox, luego execute vuelve a ejecutar los
 *  refinamientos de autoría (el antiguo superRefine) y devuelve un resultado
 *  isError si hay problemas (convención de pi 1.0: invalidInputResult; el modelo
 *  ve ambos como errores de entrada reintentables). Este auxiliar replica de
 *  extremo a extremo la antigua frontera safeParse. */
async function boundaryParse(
	// parámetro `input: never`: la contravarianza permite encajar el execute de cualquier AgentTool.
	tool: { parameters: any; execute: (id: string, input: never) => Promise<unknown> },
	input: unknown,
): Promise<{ success: boolean; error?: AgentToolResult<{ tool: string; problems: string[] }> }> {
	if (!Value.Check(tool.parameters, input)) return { success: false };
	const result = (await tool.execute("tc", input as never)) as AgentToolResult<{
		tool: string;
		problems: string[];
	}>;
	if (result.isError) return { success: false, error: result };
	return { success: true };
}
const problemLines = (r?: AgentToolResult<{ tool: string; problems: string[] }>): string[] =>
	r?.details.problems ?? [];

describe("teachQuizToolFor: the dynamic plan-nodeId validation (position signal)", () => {
	it("accepts a nodeId that matches a node of the session's tree", async () => {
		const chatId = newChat("NodeId: valid");
		chatStore.saveTree(chatId, {
			nodes: [
				{ id: "arith", title: "Arithmetic" },
				{ id: "expressions", title: "Expressions" },
			],
			edges: [{ from: "arith", to: "expressions" }],
			version: 1,
		});
		const res = await boundaryParse(teachQuizToolFor({ chatId, chatStore }), {
			...validQuiz,
			nodeId: "expressions",
		});
		assert.equal(res.success, true);
	});

	it("rejects a nodeId that matches no node — with a message listing the slugs", async () => {
		const chatId = newChat("NodeId: typo");
		chatStore.saveTree(chatId, {
			nodes: [{ id: "arith", title: "Arithmetic" }],
			edges: [],
			version: 1,
		});
		const res = await boundaryParse(teachQuizToolFor({ chatId, chatStore }), {
			...validQuiz,
			nodeId: "arithmetic", // la errata: el slug es 'arith'
		});
		assert.equal(res.success, false);
		const msg = problemLines(res.error).join("\n");
		assert.match(msg, /matches no node/);
		assert.match(msg, /arith/);
	});

	it("no tree yet: ANY nodeId is rejected — quizzes wait for plan_init", async () => {
		const chatId = newChat("NodeId: no tree");
		const tool = teachQuizToolFor({ chatId, chatStore });
		const res = await boundaryParse(tool, { ...validQuiz, nodeId: "anything" });
		assert.equal(res.success, false);
		assert.match(problemLines(res.error).at(-1)!, /No plan map exists yet — call plan_init/);
	});

	it("missing nodeId is rejected at the boundary (owner ruling 2026-09-26: no untagged quizzes)", async () => {
		const chatId = newChat("NodeId: required");
		chatStore.saveTree(chatId, {
			nodes: [{ id: "arith", title: "Arithmetic" }],
			edges: [],
			version: 1,
		});
		const tool = teachQuizToolFor({ chatId, chatStore });
		const { nodeId: _dropped, ...untagged } = validQuiz;
		const res = await boundaryParse(tool, untagged);
		assert.equal(res.success, false, "an untagged quiz must be rejected back to the model");
		// La fijación estructural: el propio ESQUEMA nombra el campo que falta (la frontera
		// de pi formatea Value.Errors como el tool-input-error que ve el modelo).
		const schemaErrors = [...Value.Errors(quizInputObject, untagged)].map((e) => e.message);
		assert.match(
			schemaErrors.join("\n"),
			/nodeId/,
			"the schema rejection names nodeId so the model can retry tagged",
		);
	});

	it("reads the LIVE record — a plan_init mutation mid-turn is honored immediately", async () => {
		const chatId = newChat("NodeId: live record");
		const tool = teachQuizToolFor({ chatId, chatStore });

		const before = await boundaryParse(tool, { ...validQuiz, nodeId: "fresh-node" });
		assert.equal(before.success, false, "no tree yet → rejected");

		chatStore.saveTree(chatId, {
			nodes: [{ id: "fresh-node", title: "Just initialized" }],
			edges: [],
			version: 1,
		});
		const after = await boundaryParse(tool, { ...validQuiz, nodeId: "fresh-node" });
		assert.equal(after.success, true, "the same id validates once the tree exists — same turn");
	});

	it("the shared grading rules still chain FIRST (schema-valid ⇔ gradeable)", async () => {
		const chatId = newChat("NodeId: grading rules intact");
		const res = await boundaryParse(teachQuizToolFor({ chatId, chatStore }), {
			...validQuiz,
			correctAnswer: "42", // no encaja con ninguna opción: la regla de question-core
			nodeId: "ghost", // también incorrecto: aparecen LOS DOS problemas
		});
		assert.equal(res.success, false);
		const msgs = problemLines(res.error).join("\n");
		assert.match(msgs, /correctAnswer/);
		assert.match(msgs, /matches no node/);
	});
});

describe("the prober's quiz: no nodeId field at all", () => {
	it("the probe schema accepts a plain quiz; a smuggled nodeId is NOT in the wire schema", () => {
		assert.ok(Value.Check(probeQuizInputSchema, validQuiz));
		// Diferencia de la oleada A (2026-09-26): la validación TypeBox de pi tolera las
		// claves desconocidas en vez de eliminarlas, pero las propiedades de cable del
		// esquema de sondeo no llevan nodeId, y la frontera de análisis para mostrar
		// (parseQuizInput de tool-parts, Value.Clean) lo elimina antes de llegar al dock.
		const smuggled = { ...validQuiz, nodeId: "anything" };
		assert.ok(Value.Check(probeQuizInputSchema, smuggled));
		const wireKeys = Object.keys((probeQuizInputSchema as { properties: Record<string, unknown> }).properties);
		assert.ok(!wireKeys.includes("nodeId"), "no session check to fail — the field isn't the prober's to set");
		assert.equal("nodeId" in (Value.Clean(probeQuizInputSchema, smuggled) as object), false, "the dock parse strips it");
	});

	it("the prober's tool registry carries the nodeId-less quiz, probe_done, and the learner-filesystem set", () => {
		const chatId = newChat("Prober: registry");
		const tools = createProberTools({ chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} });
		// Oleada de arreglos (2026-09-20): la decisión del responsable añade el envío de research +
		// pdf al registro de herramientas de la fase de sondeo (demo/visual siguen siendo solo de enseñanza).
		assert.deepEqual(Object.keys(tools).sort(), [
			"ask_user_question", "find", "grep", "ls", "pdf", "probe", "probe_done", "read", "research",
		]);
		const probe = tools.probe as AgentTool<any>;
		assert.equal(Value.Check(probe.parameters, { ...validQuiz, nodeId: "anything" }), true, "no session check to fail");
	});
});
// ─── el ejemplo de la descripción (responsable, 2026-10-12) ──────────────

describe("quiz tool descriptions carry the complete, phase-correct example", () => {
	it("the canonical body is schema-valid and authoring-clean (never ship a broken exemplar)", () => {
		assert.deepEqual(quizInputProblems(quizExampleBody), []);
		assert.equal(Value.Check(probeQuizInputSchema, quizExampleBody), true);
		const teachExample = { type: "check", nodeId: "chain-rule", ...quizExampleBody };
		assert.equal(Value.Check(quizInputObject, teachExample), true);
	});

	it("probe: the serialized body rides the description with correct JSON escaping, no phase metadata", () => {
		const desc = probeQuizTool.description;
		assert.ok(
			desc.includes("```json\n" + JSON.stringify(quizExampleBody, null, 2) + "\n```"),
			"the example is the exact JSON.stringify of the canonical body",
		);
		// El ejemplo de escape debe VERSE como texto de cable: la cadena en tiempo
		// de ejecución lleva barras invertidas dobles literales, exactamente lo que
		// el modelo debe escribir dentro del JSON.
		assert.ok(desc.includes("A signal is $y=\\\\sin(2x)$"), "LaTeX command backslash shows doubled");
		assert.ok(desc.includes("a LaTeX backslash is \\\\ and a newline is \\n"), "the one-line escaping hint");
		assert.ok(!desc.includes("nodeId"), "probe example carries no phase metadata");
	});

	it("quiz: the required pair leads the example, with the plan-id caveat", () => {
		const chatId = newChat("Teacher: description example");
		const desc = teachQuizToolFor({ chatId, chatStore }).description;
		const teachExample = { type: "check", nodeId: "chain-rule", ...quizExampleBody };
		assert.ok(desc.includes("```json\n" + JSON.stringify(teachExample, null, 2) + "\n```"));
		// La decisión del orden de omisión del 2026-10-09: type+nodeId VAN DELANTE en el
		// objeto: los campos que se generan primero son los que menos se omiten.
		assert.ok(
			/```json\n\{\n {2}"type": "check",\n {2}"nodeId": "chain-rule",/.test(desc),
			"type and nodeId lead the serialized example",
		);
		assert.ok(
			desc.includes("illustrative — copy an exact id from this session's plan_init"),
			"the illustrative-nodeId caveat",
		);
	});
});
// ─── disponibilidad de herramientas (frontera de ajustes de 2026-09) ─────────

describe("tool toggles (core/pending.ts + factories)", () => {
	it("TOGGLEABLE_TOOLS: the sub-agent dispatch tools; quiz/ask/read stay off the list", () => {
		// EL vocabulario DEFINITIVO (decidido con el usuario el 2026-09-19, conciliación
		// P2): solo las herramientas de tareas. quiz/ask_user_question están
		// siempre activas de forma permanente (la evaluación del sondeador + la doctrina de
		// enseñanza se basan en preguntas calificadas: el peligro de bloqueo), igual que el
		// conjunto learner-fs, las herramientas de plan y probe_done. La parte de ESCRITURA
		// de los ajustes valida contra esta lista (settings-body).
		assert.deepEqual(TOGGLEABLE_TOOLS, ["research", "demo", "visual", "pdf"]);
	});

	it("createProberTools: absent record = full set; explicit false drops exactly that tool; probe_done survives everything", () => {
		const chatId = newChat("Prober: toggles");
		const ctx = { chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} };
		assert.deepEqual(Object.keys(createProberTools(ctx)).sort(), [
			"ask_user_question", "find", "grep", "ls", "pdf", "probe", "probe_done", "read", "research",
		]);

		const noAsk = createProberTools(ctx, { ask_user_question: false });
		assert.deepEqual(Object.keys(noAsk).sort(), ["find", "grep", "ls", "pdf", "probe", "probe_done", "read", "research"]);

		// Las preguntas ya las gestiona la mecánica (responsable 2026-09-27): quiz/explain
		// NUNCA pasan por el filtro genérico: escribir a mano quiz:false no hace
		// nada (el peligro de bloqueo sigue: un sondeador sin quiz hunde su
		// flujo de evaluación). probe_done nunca se puede quitar: es lo que termina la fase.
		const noQuiz = createProberTools(ctx, { quiz: false });
		assert.deepEqual(Object.keys(noQuiz).sort(), ["ask_user_question", "find", "grep", "ls", "pdf", "probe", "probe_done", "read", "research"]);
		// El interruptor de mecánica (responsable 2026-09-27): tools.explain === true arma el
		// recuerdo libre: entra explain, sale quiz, exactamente una herramienta de preguntas.
		const free = createProberTools(ctx, { explain: true });
		assert.deepEqual(Object.keys(free).sort(), ["ask_user_question", "find", "grep", "ls", "pdf", "probe_done", "read", "recall", "research"]);
		assert.ok(createProberTools(ctx, { probe_done: false }).probe_done, "probe_done always-on");
	});

	it("createTeacherTools: {research: false} removes exactly research; unknown keys are no-ops", () => {
		const chatId = newChat("Teacher: toggles");
		const ctx: TeacherToolContext = {
			chatId,
			chatStore,
			jobStore,
			spawn: () => {},
		};
		const full = Object.keys(createTeacherTools(ctx)).sort();
		assert.deepEqual(full, ["ask_user_question", "demo", "find", "grep", "ls", "pdf", "plan_init", "quiz", "read", "research", "show_image", "visual"]);

		const noResearch = Object.keys(createTeacherTools(ctx, { research: false })).sort();
		assert.deepEqual(noResearch, ["ask_user_question", "demo", "find", "grep", "ls", "pdf", "plan_init", "quiz", "read", "show_image", "visual"]);

		// ausente = activado: un registro vacío y undefined se comportan igual
		assert.deepEqual(
			Object.keys(createTeacherTools(ctx, {})).sort(),
			full,
			"absent keys mean enabled — old records behave exactly as today",
		);

		// El interruptor de mecánica (responsable 2026-09-27): el recuerdo libre cambia el quiz
		// de enseñanza por el explain de enseñanza: una herramienta de preguntas, la que esté armada.
		const freeFull = ["ask_user_question", "demo", "explain", "find", "grep", "ls", "pdf", "plan_init", "read", "research", "show_image", "visual"];
		assert.deepEqual(Object.keys(createTeacherTools(ctx, { explain: true })).sort(), freeFull);
		assert.deepEqual(
			Object.keys(createTeacherTools(ctx, { explain: true, research: false })).sort(),
			freeFull.filter((t) => t !== "research"),
			"mechanics and plain toggles compose",
		);
	});
});


// ─── prepareArguments: la guarda de opciones codificadas como cadena de GLM (2026-09-26) ─

describe("prepareQuestionArguments (the string-encoded options wobble)", () => {
	// La sesión de descenso de gradiente (chat_muhskq6p): 6 de los 7 fallos de validación
	// de quiz eran `options` que llegaban como CADENA codificada en JSON. pi ejecuta
	// prepareArguments ANTES de validar el esquema: la llamada convertida se acepta
	// en lugar de rebotar como un turno de reintento desperdiciado.
	const goodOptions = [
		{ label: "The slope of the tangent line", value: "slope" },
		{ label: "The value of the curve", value: "value" },
	];
	const asString = JSON.stringify(goodOptions);

	it("coerces string-encoded options on ALL THREE question tools", () => {
		for (const tool of [askUserQuestionTool, probeQuizTool, teachQuizToolFor({ chatId: "chat_x", chatStore: undefined as never })]) {
			const prepare = (tool as unknown as { prepareArguments?: (a: unknown) => unknown }).prepareArguments;
			assert.ok(prepare, `${tool.name} has the hook`);
			const out = prepare({ question: "q", options: asString, correctAnswer: "slope", explanation: "e" });
			assert.deepEqual(
				(out as { options: unknown }).options,
				goodOptions,
				`${tool.name} coerces the string to an array`,
			);
		}
	});

	it("passes everything else through UNTOUCHED (identity — pi's fast path)", () => {
		const prepare = (probeQuizTool as unknown as { prepareArguments: (a: unknown) => unknown }).prepareArguments;
		const arrayArgs = { question: "q", options: goodOptions, correctAnswer: "slope", explanation: "e" };
		assert.equal(prepare(arrayArgs), arrayArgs, "array args return the SAME object (no defensive copies)");
		const unparseable = { question: "q", options: "not json", correctAnswer: "slope", explanation: "e" };
		assert.equal(prepare(unparseable), unparseable, "unparseable strings pass through — validation reports honestly");
	});
});

// ─── la frontera de la herramienta explain (recuerdo libre, responsable 2026-09-27) ─

describe("teachExplainToolFor: the explain variant validates nodeId like the quiz", () => {
	const validExplain = {
		question: "Explain why the null result matters.",
		correctAnswer: "It ruled out the aether — a stationary aether predicts a fringe shift, and none was seen.",
		nodeId: "arith",
		type: "check",
	};

	it("accepts a nodeId matching a tree node", async () => {
		const chatId = newChat("Explain nodeId: valid");
		chatStore.saveTree(chatId, {
			nodes: [
				{ id: "arith", title: "Arithmetic" },
				{ id: "expressions", title: "Expressions" },
			],
			edges: [{ from: "arith", to: "expressions" }],
			version: 1,
		});
		const res = await boundaryParse(teachExplainToolFor({ chatId, chatStore }), {
			...validExplain,
			nodeId: "expressions",
		});
		assert.equal(res.success, true);
	});

	it("rejects an off-map nodeId with the slugs listed", async () => {
		const chatId = newChat("Explain nodeId: typo");
		chatStore.saveTree(chatId, { nodes: [{ id: "arith", title: "A" }], edges: [], version: 1 });
		const res = await boundaryParse(teachExplainToolFor({ chatId, chatStore }), {
			...validExplain,
			nodeId: "arithmetic",
		});
		assert.equal(res.success, false);
		assert.match(problemLines(res.error).join("\n"), /matches no node/);
	});

	it("no tree yet: rejected — checks wait for plan_init", async () => {
		const chatId = newChat("Explain nodeId: no tree");
		const res = await boundaryParse(teachExplainToolFor({ chatId, chatStore }), validExplain);
		assert.equal(res.success, false);
		assert.match(problemLines(res.error).at(-1)!, /No plan map exists yet — call plan_init/);
	});

	it("an empty commitment is rejected at the boundary", async () => {
		const chatId = newChat("Explain: empty commitment");
		chatStore.saveTree(chatId, { nodes: [{ id: "arith", title: "A" }], edges: [], version: 1 });
		const res = await boundaryParse(teachExplainToolFor({ chatId, chatStore }), {
			...validExplain,
			correctAnswer: "   ",
		});
		assert.equal(res.success, false);
		assert.match(problemLines(res.error).join("\n"), /correctAnswer is required/);
	});
});

describe("the prober's explain: no nodeId field at all", () => {
	it("the probe schema carries no nodeId; the commitment contract still binds", async () => {
		assert.ok(!("nodeId" in probeExplainTool.parameters.properties));
		const res = await boundaryParse(probeExplainTool, {
			question: "Explain what a derivative measures.",
			correctAnswer: "The instantaneous rate of change at a point — the limit the slopes converge to.",
		});
		assert.equal(res.success, true);
		const empty = await boundaryParse(probeExplainTool, {
			question: "q",
			correctAnswer: " ",
		});
		assert.equal(empty.success, false);
	});
});

// ─── las descripciones son MECÁNICA (responsable 2026-10-03) ──────────────
// La doctrina de diseño de preguntas vive en el system prompt (fragmento compartido de
// oficio + fragmentos del profesor), NO en las descripciones de las herramientas. Una
// descripción que enseña al modelo a escribir preguntas se desvía en cuanto una variante
// nueva (el sondeador, una futura práctica adaptativa) reutiliza la herramienta con otra doctrina.
describe("tool descriptions carry mechanics only, no question-craft", () => {
	const teachQuiz = teachQuizToolFor({ chatId: "chat_x", chatStore: undefined as never });
	for (const [name, tool] of [
		["teach quiz", teachQuiz],
		["probe quiz", probeQuizTool],
	] as const) {
		it(`${name}: no craft doctrine, mechanics intact`, () => {
			const d = tool.description;
			for (const banned of ["asymmetry", "distractor", "believable", "misconception"]) {
				assert.ok(!d.toLowerCase().includes(banned), `${name} description leaks craft: "${banned}"`);
			}
			for (const mechanical of ["GRADED", "ONE question per turn", "ask_user_question"]) {
				assert.ok(d.includes(mechanical), `${name} description lost mechanics: "${mechanical}"`);
			}
		});
	}
	it("the teach quiz declares the `type` field and `nodeId`; the probe quiz declares neither", () => {
		assert.ok(teachQuiz.description.includes("`type`"), "teach quiz points at the role field");
		assert.ok(teachQuiz.description.includes("`nodeId`"), "teach quiz points at the plan-map validation");
		assert.ok(!probeQuizTool.description.includes("`type`"), "the probe quiz has no roles");
		assert.ok(!probeQuizTool.description.includes("`nodeId`"), "the probe quiz has no plan map");
	});
	it("the explain tools keep the COMMITMENT rule (the grading contract) and drop the softer doctrine", () => {
		for (const [name, tool] of [
			["teach explain", teachExplainToolFor({ chatId: "chat_x", chatStore: undefined as never })],
			["probe explain", probeExplainTool],
		] as const) {
			assert.ok(tool.description.includes("COMMITTED"), `${name} keeps the commitment rule`);
			assert.ok(!tool.description.includes("near-miss"), `${name} drops the doctrine (now in the shared prompt)`);
		}
	});
	it("the craft now lives in the shared prompt chunk (both agents compose it)", async () => {
		const shared = await fs.promises.readFile(
			path.join(PATHS.root, "src/agent/prompts/shared/20-question-tools.md"),
			"utf-8",
		);
		assert.ok(shared.includes("asymmetry"), "the option craft moved here, not deleted");
		assert.ok(shared.includes("TRANSCRIBED SPEECH"), "the dictation-leniency note lives here");
	});
});
