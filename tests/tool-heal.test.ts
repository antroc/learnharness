/**
 * LAS FIJACIONES DEL INCIDENTE WHITEHEAD (responsable, 2026-10-09): glm-5.3 (z-ai
 * mediante OpenRouter) emitió dos formas de titubeo de argumentos en una sesión
 * real: `type: "\"predict\""` en quiz (el literal con las comillas dentro; la
 * propia descripción del esquema mostraba los valores entre comillas y con dos
 * puntos) rechazado DIEZ veces con reintentos idénticos byte a byte mientras la
 * lección no llegaba a empezar, y `correctAnswer: [":parmenides"]` (el valor de
 * la opción con los dos puntos de clave-valor de JSON pegados) rechazado cuatro veces.
 *
 * Los arreglos que sostienen estas fijaciones:
 *  1. LA REPARACIÓN ESTÁNDAR EN TODAS PARTES: healToolRecord envuelve todos los
 *     registros de herramientas (bareQuestionTools no llevaba NINGÚN
 *     prepareArguments), y el literal codificado con comillas se repara antes
 *     de la validación TypeBox.
 *  2. LA LIMPIEZA DE RESTOS EN LAS FRONTERAS DE PERTENENCIA: stripModelValueDebris
 *     en coerceCorrectAnswer (comprobación de frontera + calificación),
 *     normalizeQuizType y resolveTargetId.
 *  3. EL ESPEJO DE LA VISTA: el registro conserva los argumentos EN BRUTO, así
 *     que parseQuizInput repara el mismo titubeo al leer (la ley de tool-parts:
 *     un quiz reparado en la frontera cuyo análisis para mostrar lo rechaza es
 *     un quiz pendiente invisible y deja bloqueado al alumno).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { healEncodedArguments } from "../src/core/argument-heal.ts";
import { stripModelValueDebris } from "../src/core/value-debris.ts";
import {
	coerceCorrectAnswer,
	normalizeQuizType,
	quizInputObject,
	quizInputProblems,
} from "../src/core/question-core.ts";
import { parseQuizInput } from "../src/core/tool-parts.ts";
import { resolveTargetId } from "../src/core/chains.ts";
import { bareQuestionTools } from "../src/agent/teacher-agent.ts";
import { probeQuizTool } from "../src/agent/tools.ts";

/** La codificación exacta del incidente: el valor envuelto en comillas literales. */
function QUOTED(value: string): string {
	return `"${value}"`;
}

// Una entrada completa y bien formada de quiz de enseñanza: la llamada del incidente
// con todos los campos válidos SALVO el del titubeo.
function whiteheadQuiz(type: unknown, correctAnswer: unknown) {
	return {
		question: "What was Parmenides' claim?",
		options: [
			{ label: "Being is changeless and complete", value: "parmenides" },
			{ label: "Becoming is fundamental", value: "heraclitus" },
			{ label: "Split world", value: "split" },
			{ label: "Both unreal", value: "both-illusion" },
		],
		explanation: "What truly *is* cannot come to be or pass away — the flux is appearance.",
		correctAnswer,
		type,
		nodeId: "experience-first",
	};
}

describe("the death-loop shape — quiz type with quotes baked in", () => {
	it("heals the quote-encoded literal (the ten-retry loop)", () => {
		const healed = healEncodedArguments({ type: QUOTED("predict") }, quizInputObject) as {
			type: unknown;
		};
		assert.equal(healed.type, "predict");
	});

	it("END-TO-END: the healed args pass pi-ai validation where the raw threw", () => {
		const raw = whiteheadQuiz(QUOTED("predict"), ["parmenides"]);
		assert.throws(() => {
			validateToolArguments({ name: "quiz", parameters: quizInputObject } as never, {
				id: "call_x",
				type: "toolCall",
				name: "quiz",
				arguments: raw,
			} as never);
		});
		const validated = validateToolArguments(
			{ name: "quiz", parameters: quizInputObject } as never,
			{
				id: "call_x",
				type: "toolCall",
				name: "quiz",
				arguments: healEncodedArguments(raw, quizInputObject),
			} as never,
		);
		assert.equal((validated as { type: unknown }).type, "predict");
	});

	it("WIRING: bareQuestionTools (the registry with NO prepareArguments) now heals", () => {
		const tools = bareQuestionTools();
		const quiz = tools.quiz;
		assert.ok(quiz, "the bare quiz must exist");
		assert.ok(quiz.prepareArguments, "the bare quiz must carry the standard heal");
		const healed = quiz.prepareArguments!(
			whiteheadQuiz(QUOTED("predict"), ["parmenides"]),
		) as { type: unknown };
		assert.equal(healed.type, "predict");
	});

	it("WIRING: the 2026-09-26 string-options shape heals through the bare quiz too", () => {
		// La reparación universal también cubre la forma del incidente ORIGINAL:
		// options serializado como cadena JSON (entonces solo se reparaba en el camino
		// del quiz de plan-tree; los registros a secas no tenían nada).
		const quiz = bareQuestionTools().quiz;
		assert.ok(quiz?.prepareArguments, "the bare quiz must carry the standard heal");
		const input = whiteheadQuiz("predict", ["parmenides"]);
		const stringified = { ...input, options: JSON.stringify(input.options) };
		const healed = quiz.prepareArguments!(stringified) as { options: unknown };
		assert.ok(Array.isArray(healed.options), "the JSON string heals to the array");
		assert.equal(
				(healed.options as Array<{ value?: string }>)[0]?.value,
			"parmenides",
		);
	});
});

describe("the colon shape — correctAnswer with copy-syntax debris", () => {
	it("stripModelValueDebris: the observed shapes heal, interiors stay", () => {
		assert.equal(stripModelValueDebris(":parmenides"), "parmenides");
		assert.equal(stripModelValueDebris(QUOTED("predict")), "predict");
		assert.equal(stripModelValueDebris(`: "primary-external" `), "primary-external");
		assert.equal(stripModelValueDebris("`value`"), "value");
		assert.equal(stripModelValueDebris("a:b"), "a:b"); // los dos puntos interiores son contenido
		assert.equal(stripModelValueDebris('["x"]'), '["x"]'); // las comillas interiores son contenido (cadenas de array JSON)
	});

	it("coerceCorrectAnswer cleans non-matching entries (boundary check + grading seam)", () => {
		assert.deepEqual(coerceCorrectAnswer([":parmenides"], ["parmenides"]), ["parmenides"]);
		assert.deepEqual(coerceCorrectAnswer(QUOTED("primary-external"), ["primary-external"]), ["primary-external"]);
	});

	it("the incident's exact call passes the semantic boundary (quizInputProblems)", () => {
		const input = whiteheadQuiz("predict", [":parmenides"]) as Parameters<
			typeof quizInputProblems
		>[0];
		assert.deepEqual(quizInputProblems(input), []);
	});

	it("normalizeQuizType heals a persisted wobbled record", () => {
		assert.equal(normalizeQuizType(QUOTED("predict")), "predict");
		assert.equal(normalizeQuizType('"check"'), "check");
		assert.equal(normalizeQuizType(undefined), undefined);
		assert.equal(normalizeQuizType("bogus"), undefined);
	});

	it("resolveTargetId heals copy-syntax on targets", () => {
		const nodes = [{ id: "experience-first", name: "Experience first" }];
		assert.equal(resolveTargetId(":experience-first", nodes), "experience-first");
		assert.equal(resolveTargetId('"Experience first"', nodes), "experience-first");
		assert.equal(resolveTargetId("nope", nodes), null);
	});
});

describe("the calculus retry loop — an exact answer was incorrectly stripped", () => {
	it("the real probe tool accepts a label with its sentence-final period", async () => {
		const input = {
			question: "Which claim?",
			options: [{ label: "The claim holds." }, { label: "The claim need not hold." }],
			explanation: "The premise does not imply the claim.",
			correctAnswer: "The claim need not hold.",
		};
		const validated = validateToolArguments(probeQuizTool, {
			type: "toolCall",
			id: "calculus-period",
			name: "probe",
			arguments: probeQuizTool.prepareArguments!(input),
		});
		assert.equal(validated.correctAnswer, input.correctAnswer);
		const result = await probeQuizTool.execute("calculus-period", validated);
		assert.notEqual(result.isError, true, "an already-exact answer must not trigger a retry");
		assert.equal(result.terminate, true, "the valid question is posed normally");
	});
});

describe("the display mirror — raw records heal on read", () => {
	it("parseQuizInput renders the incident's persisted raw record (no invisible quiz)", () => {
		const raw = whiteheadQuiz(QUOTED("predict"), [":parmenides"]);
		const parsed = parseQuizInput(raw);
		assert.ok(parsed, "the wobbled record must parse — else the quiz is invisible");
		// El type del esquema de vista es A PROPÓSITO una cadena permisiva (los registros
		// antiguos y los de sondeo no lo llevan); la frontera de lectura es normalizeQuizType,
		// que quita el titubeo registrado para dejar el rol pretendido.
		assert.equal(normalizeQuizType(parsed?.type), "predict");
		// La respuesta calificada se resuelve a la opción pese a los dos puntos registrados.
		assert.deepEqual(parsed ? coerceCorrectAnswer(parsed.correctAnswer, parsed.options.map((o) => o.value ?? o.label)) : [], ["parmenides"]);
	});
});
