/**
 * EL AGENTE DE PRÁCTICA (sesiones de práctica, diseño del responsable
 * 2026-10-04): la ley de barreras de herramientas (un agente no puede plantear
 * mientras hay un problema activo ni concluir sin nada activo), la forma del
 * registro de herramientas (problem + conclude SOLO: ni question, ni plan, ni
 * herramientas de tareas) y la composición del prompt (la práctica compone solo
 * su propio directorio: sin base de enseñanza ni fragmentos compartidos).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

import {
	activeProblemOf,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	type LhMessage,
} from "../src/core/native-messages.ts";
import { CONCLUDE_ACK_TEXT } from "../src/core/contracts/chat.ts";
import { concludeInputObject, concludeTool, createPracticeGate, problemTool, practiceTools } from "../src/agent/tools/practice.ts";
import { composeInstructions, createPracticeAgent } from "../src/agent/teacher-agent.ts";
import { allSegmentPaths } from "../src/agent/prompt-segments.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const STAMPS = {
	api: "faux",
	provider: "test",
	model: "test-model",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
} as const;

/** Un registro cuya última llamada a problem está ACTIVA (planteamiento + acuse, nada después). */
function activeProblemRecord(): LhMessage[] {
	const pose: LhMessage & AssistantMessage = {
		id: "msg_a1",
		role: "assistant",
		content: [
			{ type: "toolCall", id: "call_p1", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "Show…" } },
		],
		timestamp: 1,
		...STAMPS,
	};
	const ack: LhMessage & ToolResultMessage = {
		id: "msg_r1",
		role: "toolResult",
		toolCallId: "call_p1",
		toolName: PRACTICE_PROBLEM_TOOL,
		content: [{ type: "text", text: "Problem posed — the turn ends here…" }],
		details: null,
		isError: false,
		timestamp: 2,
	};
	return [pose, ack];
}

function recordStore(messages: LhMessage[]) {
	return {
		store: {
			getChat: (_id: string) => ({ messages, kind: "practice" }),
		},
	};
}

const ctxOf = (messages: LhMessage[]) => ({ chatId: "c1", chatStore: recordStore(messages).store });
const PROBLEM_INPUT = {
	statement: "Prove the sum is even.",
	mode: "recall",
	target: ["parity-sum"],
	modelSolution: "Pair them; each pair is even.",
} as const;

const CONCLUDE_INPUT = {
	outcome: "solved",
	verdict: "Clean — the pairing came unaided.",
	rung: null,
	missClass: null,
	retest: false,
} as const;

// ── la ley de barreras ───────────────────────────────────────────────────────

describe("the practice tool gating law", () => {
	it("problem acks on a quiet record and ends the turn (terminate)", async () => {
		const result = await problemTool(createPracticeGate(ctxOf([]))).execute("call_x", PROBLEM_INPUT as never);
		assert.equal(result.isError, undefined);
		assert.equal(result.terminate, true);
		assert.match((result.content[0] as { text: string }).text, /Problem posed/);
	});

	it("problem is REJECTED while a problem is active (conclude first)", async () => {
		const result = await problemTool(createPracticeGate(ctxOf(activeProblemRecord()))).execute("call_x", PROBLEM_INPUT as never);
		assert.equal(result.isError, true);
		assert.deepEqual((result.details as { problems: string[] }).problems, [
			"a problem is already active — call conclude on it before posing the next one",
		]);
	});

	it("conclude is REJECTED with nothing active", async () => {
		const result = await concludeTool(createPracticeGate(ctxOf([]))).execute("call_x", CONCLUDE_INPUT as never);
		assert.equal(result.isError, true);
		assert.deepEqual((result.details as { problems: string[] }).problems, [
			"no active problem to conclude — pose one first",
		]);
	});

	it("conclude acks on the active problem and the turn CONTINUES (no terminate)", async () => {
		const result = await concludeTool(createPracticeGate(ctxOf(activeProblemRecord()))).execute("call_x", CONCLUDE_INPUT as never);
		assert.equal(result.isError, undefined);
		assert.equal(result.terminate, undefined);
	});

	it("THE BKT INCIDENT — a mid-turn conclude → pose pair works (the gate is turn-scoped, not record-frozen)", async () => {
		// Un turno, un conjunto de herramientas: el registro se congeló en la persistencia
		// anticipada con el problema antiguo activo. Las barreras volvían a leer ese registro
		// congelado en cada execute, así que el planteamiento tras un conclude correcto
		// moría siempre con "a problem is already active" hasta que el modelo
		// se rendía ("the problem slot is stuck").
		const gate = createPracticeGate(ctxOf(activeProblemRecord()));
		const tools = { problem: problemTool(gate), conclude: concludeTool(gate) };
		const conclude = await tools.conclude.execute("call_c1", CONCLUDE_INPUT as never);
		assert.equal(conclude.isError, undefined, "the conclude acks against the seeded record");
		const pose = await tools.problem.execute("call_p2", PROBLEM_INPUT as never);
		assert.equal(pose.isError, undefined, "the freed gate lets the next problem through — SAME turn");
		const greedy = await tools.problem.execute("call_p3", PROBLEM_INPUT as never);
		assert.equal(greedy.isError, true, "the gate re-arms on the successful pose");
	});
});

// ── validación de target (el contrato del rastro de dominio, ronda 9 del responsable) ─

describe("target validation — names normalize to ids, unknowns reject", () => {
	const NODES = [
		{ id: "n_parity", name: "Parity of a sum", statement: "The sum of two odds is even." },
		{ id: "n_pairing", name: "Pairing", statement: "Pair elements to count parity." },
	] as const;
	const graphNodes = () => NODES;

	it("a NAME target silently normalizes to the canonical id (the record carries ids)", async () => {
		const healed = problemTool(createPracticeGate(ctxOf([])), graphNodes).prepareArguments!({
			...PROBLEM_INPUT,
			target: ["Parity of a sum", "pairing"],
		}) as { target: string[] };
		assert.deepEqual(healed.target, ["n_parity", "n_pairing"], "case-insensitive name → id, whole-graph set");
	});

	it("an id target passes through untouched (already canonical)", async () => {
		const healed = problemTool(createPracticeGate(ctxOf([])), graphNodes).prepareArguments!({
			...PROBLEM_INPUT,
			target: ["n_parity"],
		}) as { target: string[] };
		assert.deepEqual(healed.target, ["n_parity"]);
	});

	it("an UNKNOWN target rejects with a one-line error and does NOT arm the gate", async () => {
		const gate = createPracticeGate(ctxOf([]));
		const tool = problemTool(gate, graphNodes);
		const rejected = await tool.execute("call_x", { ...PROBLEM_INPUT, target: ["ghost-prop"] } as never);
		assert.equal(rejected.isError, true);
		assert.match((rejected.details as { problems: string[] }).problems[0]!, /ghost-prop/);
		assert.match((rejected.details as { problems: string[] }).problems[0]!, /proposition ids from the session context/);
		// el mensaje enseña la salida (ronda 12): omitirlo siempre funciona
		assert.match((rejected.details as { problems: string[] }).problems[0]!, /omit target entirely/);
		// activación honesta (la ley BKT): un planteamiento rechazado libera la ranura;
		// el siguiente planteamiento, válido, pasa.
		const valid = await tool.execute("call_y", { ...PROBLEM_INPUT, target: ["n_parity"] } as never);
		assert.equal(valid.isError, undefined);
	});

	it("UNTAGGED PROBLEMS (owner round 12): absent target poses freely; [] heals away to absent", async () => {
		const tool = problemTool(createPracticeGate(ctxOf([])), graphNodes);
		const absent = await tool.execute("call_a", { statement: "S", mode: "recall", modelSolution: "M" } as never);
		assert.equal(absent.isError, undefined, "no targets = an untagged problem, never a rejection");
		const healed = tool.prepareArguments!({ statement: "S", mode: "recall", target: [], modelSolution: "M" }) as {
			target?: string[];
		};
		assert.ok(!healed.target || healed.target.length === 0, "an explicit [] is the model saying no-targets — healed away");
	});

	it("NO node source (the legacy/test wiring) = no validation, free strings ack", async () => {
		const result = await problemTool(createPracticeGate(ctxOf([]))).execute("call_x", PROBLEM_INPUT as never);
		assert.equal(result.isError, undefined);
	});
});

// ── el registro de herramientas + el agente ─────────────────────────────────

describe("the practice agent", () => {
	it("bare registry: the session pair + the learner-filesystem set — no question, plan, or lesson tools", () => {
		const tools = practiceTools(ctxOf([]));
		assert.deepEqual(
			Object.keys(tools).sort(),
			["conclude", "find", "grep", "ls", "problem", "read"],
		);
	});

	it("THE RARELY-NEEDED SET (owner round 10): jobs + map readers compose in when their roots are passed", () => {
		const jobs = { chatId: "c1", jobStore: null as never, spawn: (() => {}) as never, searchAvailable: () => false };
		const graph = { chatStore: null as never, graphStore: null as never };
		const tools = practiceTools({ ...ctxOf([]), jobs, graph });
		// Las dos tareas siguen disponibles sin clave; los dos lectores del mapa del
		// sondeador siguen detrás de su barrera de ajustes existente. La práctica no
		// aplica el filtro de activación de herramientas del usuario del profesor/sondeador.
		assert.deepEqual(
			Object.keys(tools).sort(),
			["conclude", "find", "grep", "list_propositions", "list_sessions", "ls", "pdf", "problem", "read", "research"],
		);
		const withSearch = practiceTools({ ...ctxOf([]), jobs: { ...jobs, searchAvailable: () => true }, graph });
		assert.ok(withSearch.research, "a live engine also keeps research");
	});

	it("constructs with exactly the two practice tools", () => {
		// baseAgentOptions necesita un motor (el que lanza error de BYOK es la única
		// alternativa): inyecta un motor simulado que nunca emite, para la prueba de humo.
		const agent = createPracticeAgent(ctxOf([]), {
			engine: {
				model: { api: "faux", provider: "faux", id: "faux-model", contextWindow: 8192 } as never,
				streamFn: (async () => {
					throw new Error("not streamed in this test");
				}) as never,
			},
		});
		// El agente construido con la API de turnos en vivo (el registro de herramientas
		// ya se fija arriba; el Agent de pi no expone ningún getter de estado).
		assert.equal(typeof agent.prompt, "function");
		assert.equal(typeof agent.steer, "function");
		assert.equal(typeof agent.waitForIdle, "function");
	});
});

// ── empujones persistentes (valores por defecto incluidos, sin llamadas al modelo) ──

describe("persistent practice nudges", () => {
	const doctrine = readFileSync(new URL("../src/agent/prompts/practice/10-doctrine.md", import.meta.url), "utf8");
	const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();
	const approvedParagraphs = [
		"- Cuando un empujón no funciona, vuelve a evaluar dónde está atascado el alumno y ofrece solo la siguiente información necesaria. No saltes a la solución completa. Las respuestas tentativas, las preguntas y el pensar en voz alta siguen siendo trabajo en curso.",
		"**Ante una respuesta incorrecta**, di el veredicto sin rodeos y localiza la primera ruptura sin dar la corrección. Da el empujón más pequeño que permita al alumno hacer el siguiente movimiento y espera. Si ese empujón no funciona, da otro empujón mínimo basado en el nuevo razonamiento. Un intento fallido nunca es motivo para revelar la corrección ni para concluir el problema. Continúa hasta que el alumno encuentre y complete la solución correcta.",
		"Concluye cuando el alumno haya resuelto el problema correctamente o pida explícitamente terminarlo. No deduzcas permiso para terminarlo a partir de errores, del tiempo transcurrido, del número de intentos, de la frustración ni de una aparente incapacidad para avanzar.",
	];

	it("preserves the approved paragraphs in source and the effective default prompt", () => {
		// Fija la redacción aprobada y el Markdown, pero permite saltos de línea incidentales.
		for (const text of [doctrine, composeInstructions("practice")]) {
			const paragraphs = text.split(/\n\s*\n|\n(?=- )/).map(normalizeWhitespace);
			for (const approved of approvedParagraphs) {
				assert.ok(paragraphs.includes(approved), `missing approved paragraph: ${approved}`);
			}
		}
	});

	it("does not compose the retired attempt cutoff, failed-repair reveal, or automatic-abort instructions", () => {
		for (const text of [doctrine, composeInstructions("practice")]) {
			const normalized = normalizeWhitespace(text);
			assert.doesNotMatch(normalized, /\b(?:un|un único|1) intento acotado\b/i);
			assert.doesNotMatch(normalized, /Si el intento de reparación falla, revela y sigue/i);
			assert.doesNotMatch(normalized, /Una corrección que encuentra el alumno tras un error seguro consolida más/i);
			assert.doesNotMatch(normalized, /cuando la traza muestra una incapacidad real, baja directamente a R5 y revela/i);
			assert.doesNotMatch(normalized, /cuando el alumno se rinde o no puede avanzar/i);
			assert.doesNotMatch(normalized, /cuando se agota el rendimiento marginal de quedarse/i);
			assert.doesNotMatch(normalized, /no las retengas más allá del punto de agotamiento/i);
		}
	});

	it("preserves the approved concluded-problem switch and unbounded structural repair in source and the effective default prompt", () => {
		const approvedDifficulty = "3. **Dificultad**: según los últimos resultados en este objetivo: éxito limpio, un punto más; éxito que necesitó pistas, se mantiene; un fallo, un punto menos y plantéate bajar un modo. Dos problemas concluidos seguidos fallados en este objetivo: cambia de objetivo en la siguiente exigencia. No abandones nunca un problema activo por el número de intentos.";
		const approvedClassification = "Clasifica cada fallo: fallo de pista (no vino nada), error de discriminación (ganó el candidato equivocado), despiste de ejecución (proposición correcta, ejecución equivocada), descuido o estructural (la propia proposición recuperada es errónea: una idea equivocada). Los cuatro primeros son información de práctica. Los fallos estructurales piden empujones mínimos hacia la reparación de la idea equivocada, no una corrección inmediata ni volver a enseñar. Mantén cada empujón quirúrgico; no impongas un límite de una línea o de un intento a la reparación en su conjunto.";
		for (const text of [doctrine, composeInstructions("practice")]) {
			const normalized = normalizeWhitespace(text);
			assert.ok(normalized.includes(approvedDifficulty), "preserve the difficulty readout and exact approved switching rule");
			assert.ok(normalized.includes(approvedClassification), "preserve the miss taxonomy and exact approved structural-repair rule");
			assert.doesNotMatch(normalized, /dos fallos seguidos, cambia de objetivo/i);
			assert.doesNotMatch(normalized, /Lo estructural recibe una línea quirúrgica/i);
			assert.doesNotMatch(normalized, /la corrección, dicha una vez/i);
			assert.doesNotMatch(normalized, /si una reparación necesita más de una línea/i);
		}
	});

	it("preserves the approved misconception introduction without an affirmative one-line repair cap", () => {
		const approvedIntroduction = "- **No es una sesión de enseñanza.** Encontrarás ideas equivocadas. Abórdalas con empujones mínimos y quirúrgicos, durante tantos intercambios como haga falta. Una sesión de práctica que deriva en volver a enseñar ha dejado de practicar.";
		for (const text of [doctrine, composeInstructions("practice")]) {
			const normalized = normalizeWhitespace(text);
			assert.ok(normalized.includes(approvedIntroduction), "preserve the exact approved introduction and the rest of the not-teaching bullet");
			assert.doesNotMatch(normalized, /Repáralas en una línea, de forma quirúrgica, y vuelve a la práctica\./i);
		}
	});

	it("keeps the many-claims default, hint ladder, dismissal, and explicit-go-ahead pause", () => {
		const prompt = normalizeWhitespace(composeInstructions("practice"));
		assert.match(prompt, /Un problema puede llevar muchas respuestas declaradas; quedarse es lo normal/);
		for (const rung of ["R0", "R1", "R2", "R3", "R4", "R5"]) {
			assert.ok(prompt.includes(`**${rung}:`));
		}
		assert.match(prompt, /Concluir termina tu turno; el siguiente problema solo se plantea cuando el alumno pasa explícitamente al siguiente/);
		assert.match(prompt, /Después del resultado de conclude.*TERMINAS TU TURNO: ninguna llamada a herramientas más en esa respuesta, nunca otro problema/);
		assert.match(prompt, /Una pregunta de aclaración nunca es el visto bueno; en caso de duda, responde y espera/);
		assert.match(prompt, /El alumno puede descartar un problema sin concluirlo/);
	});

	it("aligns the conclude description with the canonical ack without changing outcomes or the runtime pause mechanism", async () => {
		const tool = concludeTool(createPracticeGate(ctxOf(activeProblemRecord())));
		const description = normalizeWhitespace(tool.description);
		assert.match(description, /records the outcome \+ verdict, reveals the committed solution, and frees the learner's composer/);
		assert.match(description, /After the result, say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls/);
		assert.ok(description.includes(CONCLUDE_ACK_TEXT.slice(CONCLUDE_ACK_TEXT.indexOf("The next problem"))));
		assert.match(description, /Nothing may conclude unless a problem is active/);
		assert.doesNotMatch(description, /turn CONTINUES|reveal, then pose the next problem/);
		assert.deepEqual(concludeInputObject.properties.outcome.anyOf.map((outcome) => outcome.const), [
			"solved", "solvedWithHints", "movedOn", "surrendered", "dismissed",
		]);
		const result = await tool.execute("call_persistent_nudges", CONCLUDE_INPUT as never);
		assert.equal((result.content[0] as { text: string }).text, CONCLUDE_ACK_TEXT);
		assert.equal(result.terminate, undefined, "closing prose stays possible; the pause remains an instruction, not a new runtime gate");
	});
});

// ── la composición del prompt ───────────────────────────────────────────────

describe("practice prompt composition (own directory + the formatting appendix)", () => {
	it("composes base + doctrine — never the teaching base or question/confidence mechanics", () => {
		const prompt = composeInstructions("practice");
		// La sección de voz de la base y la columna vertebral de la doctrina están presentes…
		assert.match(prompt, /Todo lo que hay en esta sección elimina un comportamiento por defecto/);
		assert.match(prompt, /Diriges sesiones de práctica\./);
		assert.match(prompt, /## Prohibiciones permanentes/);
		// …y nada del system prompt de enseñanza ni de los fragmentos compartidos.
		assert.doesNotMatch(prompt, /instalar comprensión/);
		// La doctrina compartida 20-question-tools (predict/check) no debe
		// componerse: la práctica tiene su propia teoría de la demanda.
		assert.doesNotMatch(prompt, /predic/i);
	});

	it("the SHARED voice + accuracy compose (owner round 13): ONE law across every agent, and the stale line is dead", () => {
		const prompt = composeInstructions("practice");
		// precisión (ronda de refinamiento de prompts, 2026-10-07): el listón de la duda
		// sentida, una ley para todos los agentes; el antiguo puntero de la ronda 10 vivía
		// en el fragmento de precisión; la mecánica vive ahora en las secciones de cada agente
		assert.match(prompt, /una sola alucinación dicha con seguridad lo envenena/);
		assert.match(prompt, /El listón es la propia duda/);
		// la ley propia de verificación de hechos de la práctica (el enfoque de «rara vez hace falta» está muerto)
		assert.match(prompt, /evalúa al alumno frente a una mentira/);
		assert.ok(!prompt.includes("excepciones, no hábitos"), "the rarely-needed framing is gone");
		assert.ok(!prompt.includes("ninguna herramienta de investigación aquí"), "the stale line is gone");
		// la doctrina de los campos de razonamiento también se compone en la práctica (una ley)
		assert.match(prompt, /datos principales/);
		// el profesor compone los mismos fragmentos compartidos (una ley)
		const teacher = composeInstructions("teacher");
		assert.match(teacher, /una sola alucinación dicha con seguridad lo envenena/);
		assert.match(teacher, /Todo lo que hay en esta sección elimina un comportamiento por defecto/);
		assert.match(teacher, /El listón es la propia duda/);
		assert.match(teacher, /datos principales/);
		// la regla de no duplicar el plan (informado por el responsable: plan dibujado dos veces)
		assert.match(teacher, /No vuelvas a dibujar nunca el plan en tu prosa/);
		// reescribir el plan es normal, no excepcional (adaptación continua)
		assert.match(teacher, /Reescribir es algo normal y frecuente/);
		// planificar es el momento natural de verificación
		assert.match(teacher, /la planificación es el momento natural para verificar/);
		// sin techos de tamaño, y el desvío mantiene el ritmo (ronda del responsable, 2026-10-07)
		assert.ok(!teacher.includes("Normalmente 5–15 nodos"), "the node-count cap is dead");
		assert.match(teacher, /Sin límite de tamaño/);
		assert.match(teacher, /no apresures nunca la reparación/);
		assert.match(teacher, /al único ritmo de la sesión/);
		assert.match(teacher, /ni nada que apresurar/, "the goal reiteration composes");
	});

	it("the prober doctrine steers difficulty by evidence (owner round, 2026-10-07)", () => {
		const prober = composeInstructions("prober");
		assert.match(prober, /Entra cerca de arriba, no de abajo/);
		assert.match(prober, /Las líneas se informan entre sí/);
		assert.match(prober, /nunca bajar a un terreno ya acotado/);
		// las señales de confianza + razonamiento están cableadas a la selección de preguntas
		assert.match(prober, /el veredicto, su confianza y su campo de razonamiento determinan juntos dónde debe situarse la siguiente pregunta/);
	});

	it("the SHARED formatting guide composes (owner, 2026-10-04 late): LaTeX delimiters in every setting", () => {
		const prompt = composeInstructions("practice");
		// La ley estándar de delimitadores la comparten los tres agentes de autoría.
		for (const agent of ["practice", "prober", "teacher"] as const) {
			const instructions = composeInstructions(agent);
			assert.ok(instructions.includes("En línea `$f(x)$`, destacadas con `$$` en sus propias líneas."));
			assert.ok(!instructions.includes("NUNCA `$` ni `$$`"));
		}
		assert.ok(prompt.indexOf("# La sesión de práctica") < prompt.indexOf("## Formato"), "formatting rides as the appendix");
	});

	it("base precedes doctrine (00- sorts before 10-)", () => {
		const prompt = composeInstructions("practice");
		assert.ok(prompt.indexOf("# El agente") < prompt.indexOf("# La sesión de práctica"));
	});

	it("the segment registry knows practice (override paths resolve)", () => {
		assert.ok(allSegmentPaths().includes("practice/00-base.md"));
		assert.ok(allSegmentPaths().includes("practice/10-doctrine.md"));
	});
});
