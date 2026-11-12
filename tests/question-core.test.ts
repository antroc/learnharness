/**
 * Pruebas unitarias: question-core (lógica pura, sin servidor ni LLM).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import {
	askInputSchema,
	quizInputBase,
	askOptionProblems,
	buildAnswer,
	compactAnswerForModel,
	dismissedAnswer,
	coerceCorrectAnswer,
	CONFIDENCE_STOPS,
	DEFAULT_CONFIDENCE_INDEX,
	isCorrect,
	normalizeOptions,
	quizInputProblems,
	explainInputBase,
	explainInputObject,
	explainInputProblems,
	quizInputSchema,
	probeQuizInputSchema,
	quizDisplayInputSchema,
	normalizeQuizType,
	questionNeedsReveal,
	resolveCorrect,
	toggleOption,
	toggleOther,
	emptyDockSelection,
	shuffleOptions,
	type QuestionData,
	toClientQuestion,
} from "../src/core/question-core.ts";
import { toolQuestionKind } from "../src/core/pending.ts";
import { parseQuizInput } from "../src/core/tool-parts.ts";

// ─── el contrato de autoría (esquemas TypeBox + refinamientos al ejecutar) ──
// Válido según el esquema ⇔ calificable: un quiz cuyo correctAnswer no se puede
// resolver muere en la frontera de la llamada a herramienta (comprobación estructural
// TypeBox en el bucle de pi + los problemas de refinamiento del execute de la herramienta:
// un ToolInputError con el que el modelo reintenta) y nunca llega al dock del alumno.
// El predicado de frontera son AMBAS cosas: comprobación estructural Y cero problemas de autoría.
const boundaryOk = (schema: TSchema, input: unknown, problems: string[]): boolean =>
	Value.Check(schema, input) && problems.length === 0;

describe("the schema's argument order (reasoning before the pick)", () => {
	// Decisión sobre el orden de los argumentos (responsable, 2026-09-25): la explicación
	// es razonamiento, y el razonamiento ocurre ANTES de elegir la respuesta: los modelos
	// emiten los argumentos en el orden del esquema, así que explanation va justo antes de
	// correctAnswer. El orden de autoría de TypeBox ES el orden de propiedades del JSON
	// Schema que ve el modelo, así que esta fijación protege la emisión de extremo a extremo.
	// Todos los consumidores leen por clave: el orden es una guía de autoría.
	it("emits explanation immediately before correctAnswer (both agents' schemas)", () => {
		// La decisión del 2026-09-25 se mantiene para los campos de CONTENIDO (razonar
		// antes de elegir); la reordenación del 2026-10-09 añade su reflejo para el
		// esquema de enseñanza: el par obligatorio (`type`, `nodeId`) VA DELANTE en el
		// objeto, porque glm-5.3 omitía justo esos campos cuando iban detrás de todos
		// los campos largos de contenido (las omisiones de tools_fails_2).
		// Los modelos emiten los argumentos en el orden del esquema: primero se comprometen
		// con el rol y el destino, razonan y luego eligen.
		for (const schema of [quizInputSchema, probeQuizInputSchema]) {
			const keys = Object.keys((schema as { properties: Record<string, unknown> }).properties);
			assert.ok(
				keys.indexOf("explanation") < keys.indexOf("correctAnswer"),
				`explanation must precede correctAnswer in the emitted schema (got: ${keys.join(", ")})`,
			);
			assert.deepEqual(keys, schema === quizInputSchema
				? ["type", "nodeId", "question", "options", "multiSelect", "explanation", "correctAnswer", "details"]
				: ["question", "options", "multiSelect", "explanation", "correctAnswer", "details"]);
		}
	});
});

describe("quizInputSchema / quizInputProblems (the authoring contract)", () => {
	const valid = {
		question: "Which planet is closest to the Sun?",
		options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
		correctAnswer: "Mercury",
		explanation: "Mercury is the innermost planet.",
		type: "check",
		nodeId: "planet-order",
	};

	it("accepts a valid single-select quiz (label as correctAnswer)", () => {
		assert.equal(boundaryOk(quizInputSchema, valid, quizInputProblems(valid)), true);
		assert.deepEqual(quizInputProblems(valid), []);
	});

	it("accepts explicit values and multi-select arrays (incl. JSON-stringified)", () => {
		const multi = {
			...valid,
			options: [
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
				{ label: "C", value: "c" },
			],
			correctAnswer: ["a", "b"],
			multiSelect: true,
		};
		assert.equal(boundaryOk(quizInputSchema, multi, quizInputProblems(multi)), true);
		// La unión lista primero String, así que a veces los proveedores convierten los arrays en cadenas.
		const stringified = { ...multi, correctAnswer: JSON.stringify(multi.correctAnswer) };
		assert.equal(boundaryOk(quizInputSchema, stringified, quizInputProblems(stringified)), true);
		assert.deepEqual(quizInputProblems(stringified), []);
	});

	it("rejects the observed failure: a correctAnswer slug matching no option value, listing the valid values", () => {
		// La clase exacta que produjo GLM en vivo (Gate 3 + verificación en vivo).
		const bad = {
			question: "What is Nietzsche's genealogical claim about religion?",
			options: [
				{ label: "A cultural diagnosis" },
			{ label: "Atheism as a conclusion" },
			{ label: "A call to convert people" },
		],
			correctAnswer: "cultural-diagnosis",
			explanation: "...",
		};
		assert.equal(boundaryOk(quizInputSchema, bad, quizInputProblems(bad)), false);
		const problems = quizInputProblems(bad);
		assert.equal(problems.length, 1);
		assert.match(problems[0]!, /does not match any option value/);
		assert.match(problems[0]!, /"A cultural diagnosis"/); // los valores válidos se listan para el reintento
	});

	it("rejects multiple correct answers without multiSelect (ungradeable single-select)", () => {
		const bad = { ...valid, correctAnswer: ["Venus", "Mercury"] };
		assert.equal(boundaryOk(quizInputSchema, bad, quizInputProblems(bad)), false);
		assert.match(quizInputProblems(bad).join(" "), /multiSelect/);
	});

	it("rejects duplicate option values", () => {
		const bad = {
			...valid,
			options: [
				{ label: "Mercury", value: "same" },
				{ label: "Venus", value: "same" },
			],
		};
		assert.equal(boundaryOk(quizInputSchema, bad, quizInputProblems(bad)), false);
		assert.match(quizInputProblems(bad).join(" "), /same value/);
	});

	it("rejects an empty option label", () => {
		const bad = { ...valid, options: [{ label: "  " }, { label: "Mercury" }, { label: "Mars" }] };
		assert.equal(boundaryOk(quizInputSchema, bad, quizInputProblems(bad)), false);
		assert.match(quizInputProblems(bad).join(" "), /label is empty/);
	});

	it("requires a resolvable correctAnswer", () => {
		assert.equal(boundaryOk(quizInputSchema, { ...valid, correctAnswer: "" }, quizInputProblems({ ...valid, correctAnswer: "" })), false);
		assert.equal(boundaryOk(quizInputSchema, { ...valid, correctAnswer: "[]" }, quizInputProblems({ ...valid, correctAnswer: "[]" })), false);
		assert.match(quizInputProblems({ ...valid, correctAnswer: "" }).join(" "), /required/);
	});
});

describe("askInputSchema / askOptionProblems", () => {
	it("accepts a valid ask", () => {
		const ask = {
			question: "Which topic first?",
			options: [{ label: "Limits" }, { label: "Chain rule" }],
		};
		assert.equal(boundaryOk(askInputSchema, ask, askOptionProblems(ask.options ?? [])), true);
	});

	it("rejects duplicate option values and empty labels (they break the dock's keying)", () => {
		const bad = { question: "?", options: [{ label: "A", value: "x" }, { label: "B", value: "x" }] };
		assert.equal(boundaryOk(askInputSchema, bad, askOptionProblems(bad.options ?? [])), false);
		assert.match(askOptionProblems(bad.options).join(" "), /same value/);
		const emptyLabel = { question: "?", options: [{ label: "" }, { label: "B" }] };
		assert.equal(boundaryOk(askInputSchema, emptyLabel, askOptionProblems(emptyLabel.options ?? [])), false);
		assert.match(askOptionProblems(emptyLabel.options).join(" "), /label is empty/);
	});
});

// ─── normalizeOptions ───────────────────────────────────────────────────────

describe("normalizeOptions", () => {
	it("trims labels and defaults value to label", () => {
		const opts = normalizeOptions([{ label: "  Mercury  " }, { label: "Venus", value: " v " }]);
		assert.deepEqual(opts, [
			{ label: "Mercury", value: "Mercury", description: undefined },
			{ label: "Venus", value: "v", description: undefined },
		]);
	});

	it("drops empty labels", () => {
		const opts = normalizeOptions([{ label: "" }, { label: "ok" }]);
		assert.equal(opts.length, 1);
	});

	it("throws on duplicate option values", () => {
		assert.throws(() => normalizeOptions([{ label: "a", value: "x" }, { label: "b", value: "x" }]), /duplicate/);

		// Guarda contra el titubeo de GLM (sesión de descenso de gradiente del 2026-09-26): el
		// modelo a veces emite `options` como cadena codificada en JSON: 6 de los 7 fallos de
		// validación de quiz de esa sesión. El dock (y la calificación) lo convierten
		// con el mismo parseOptionsIfString que el prepareArguments del servidor
		// ejecuta antes de validar.
		const asString = JSON.stringify([{ label: "Slope", value: "slope" }, { label: "Value", value: "value" }]);
		const coerced = normalizeOptions(asString);
		assert.deepEqual(coerced, [
			{ label: "Slope", value: "slope", description: undefined },
			{ label: "Value", value: "value", description: undefined },
		], "a JSON-encoded string coerces to the same normalized options");
		// Las cadenas que no son JSON pasan tal cual y se comportan como si no hubiera opciones
		// (la validación del esquema del servidor informa en su lugar del error honesto).
		assert.deepEqual(normalizeOptions("not json"), []);
	});

it("quiz options carry NO description field; ask keeps it (owner nuke, 2026-09-26)", () => {
	// El modelo usaba las descripciones de las opciones del quiz para delatar la respuesta
	// ("that's not the gradient") en todos los quiz de la sesión de descenso de
	// gradiente: el campo ha desaparecido de LOS DOS esquemas de quiz; ask (sin calificar,
	// no hay nada que filtrar) lo conserva.
	const quizOption = (quizInputBase.properties.options as { items?: { properties?: Record<string, unknown> } })
		.items!.properties!;
	assert.ok(!("description" in quizOption), "quiz option schema has no description");
	const askOption = (askInputSchema.properties.options as { items?: { properties?: Record<string, unknown> } })
		.items!.properties!;
	assert.ok("description" in askOption, "ask option schema keeps description");
	});

	it("handles undefined input", () => {
		assert.deepEqual(normalizeOptions(undefined), []);
	});
});

// ─── shuffleOptions ─────────────────────────────────────────────────────────

describe("shuffleOptions", () => {
	it("permutes without adding, removing, or mutating options", () => {
		const input = Array.from({ length: 20 }, (_, i) => ({ label: `o${i}`, value: `o${i}` }));
		const shuffled = shuffleOptions(input);
		assert.equal(shuffled.length, input.length);
		assert.deepEqual([...shuffled].sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))), input);
		assert.notEqual(input, shuffled); // una copia
	});

	it("is stable for single/empty inputs", () => {
		assert.deepEqual(shuffleOptions([]), []);
		assert.deepEqual(shuffleOptions([{ label: "only", value: "only" }]), [{ label: "only", value: "only" }]);
	});
});

// ─── coerceCorrectAnswer ────────────────────────────────────────────────────

describe("coerceCorrectAnswer", () => {
	const values = ["mercury", "a", "b"];

	it("wraps a single string", () => {
		assert.deepEqual(coerceCorrectAnswer("mercury", values), ["mercury"]);
	});

	it("passes arrays through", () => {
		assert.deepEqual(coerceCorrectAnswer(["a", "b"], values), ["a", "b"]);
	});

	it("parses a JSON-stringified multi-select array", () => {
		assert.deepEqual(coerceCorrectAnswer('["a", "b"]', values), ["a", "b"]);
	});

	it("leaves a non-JSON bracketed string alone", () => {
		assert.deepEqual(coerceCorrectAnswer("[not json", values), ["[not json"]);
	});

	it("preserves an exact key even when it looks like a JSON array", () => {
		const key = '["a", "b"]';
		assert.deepEqual(coerceCorrectAnswer(key, [...values, key]), [key]);
		assert.deepEqual(coerceCorrectAnswer("[]", ["[]"]), ["[]"]);
	});
});

// ─── resolveCorrect ─────────────────────────────────────────────────────────

describe("resolveCorrect", () => {
	const options = normalizeOptions([
		{ label: "Mercury", value: "mercury" },
		{ label: "Venus", value: "venus" },
		{ label: "Earth", value: "earth" },
	]);

	it("resolves a single value to its 1-based display index", () => {
		assert.deepEqual(resolveCorrect("venus", options), { indices: [2] });
	});

	it("resolves multi-select values, deduped and sorted", () => {
		assert.deepEqual(resolveCorrect(["earth", "mercury", "mercury"], options), { indices: [1, 3] });
	});

	it("errors when the value matches no option", () => {
		const r = resolveCorrect("mars", options);
		assert.ok(r.error);
		assert.match(r.error, /does not match any option value/);
	});

	it("errors on missing correctAnswer", () => {
		assert.ok(resolveCorrect(undefined, options).error);
	});

	it("resolves against POST-shuffle order (indices track display)", () => {
		const shuffled = shuffleOptions(options);
		const value = "earth";
		const r = resolveCorrect(value, shuffled);
		const displayedIndex = shuffled.findIndex((o) => o.value === value) + 1;
		assert.deepEqual(r.indices, [displayedIndex]);
	});
});

describe("exact answer membership precedes debris cleanup", () => {
	it("the calculus label's final period survives boundary, display, shuffle, and grading", () => {
		const correct = "$f$ need not be differentiable at $a$.";
		const input = {
			question: "All partial derivatives of $f$ exist at $a$. Must $f$ be differentiable there?",
			options: [{ label: "$f$ is differentiable at $a$." }, { label: correct }],
			explanation: "Existing partial derivatives need not give a linear approximation.",
			correctAnswer: correct,
		};
		const before = JSON.stringify(input);
		assert.ok(boundaryOk(probeQuizInputSchema, input, quizInputProblems(input)));
		const parsed = parseQuizInput(input);
		assert.ok(parsed, "the accepted raw call must also render");
		assert.equal(parsed.correctAnswer, correct);
		const options = normalizeOptions(parsed.options).reverse();
		const resolved = resolveCorrect(parsed.correctAnswer, options);
		assert.deepEqual(resolved, { indices: [1] });
		const qd: QuestionData = {
			id: "calculus-period",
			kind: "quiz",
			question: parsed.question,
			mode: "single-select",
			options,
			correctIndices: resolved.indices,
			explanation: parsed.explanation,
			createdAt: "2026-10-12T00:00:00Z",
		};
		assert.equal(buildAnswer(qd, { values: [correct] }).correct, true);
		assert.equal(buildAnswer(qd, { values: [input.options[0]!.label] }).correct, false);
		assert.equal(JSON.stringify(input), before, "raw arguments are never rewritten");
	});

	it("retains punctuation, quotes, colons, and backticks in exact labels and explicit keys", () => {
		for (const key of ["value.", "value:", '"value"', "'value'", "`value`", ":value"]) {
			for (const option of [{ label: key }, { label: "A claim", value: key }]) {
				const input = {
					question: "Which claim?",
					options: [option, { label: "Other", value: "other" }],
					explanation: "The first claim follows.",
					correctAnswer: key,
				};
				assert.deepEqual(quizInputProblems(input), [], key);
				assert.ok(parseQuizInput(input), key);
				assert.deepEqual(resolveCorrect(key, normalizeOptions(input.options)), { indices: [1] }, key);
			}
		}
	});

	it("never redirects an exact punctuated key to a different debris-free option", () => {
		const keys = ["value", "value.", '"value"', "`value`", ":value"];
		const options = normalizeOptions(keys.map((value, i) => ({ label: `Claim ${i}`, value })));
		for (const [i, key] of keys.entries()) {
			assert.deepEqual(resolveCorrect(key, options), { indices: [i + 1] }, key);
		}
		assert.deepEqual(options.map((o) => o.value), keys, "canonical keys stay distinct and untouched");
	});

	it("preserves exact multi-select entries while still healing non-matching copy debris", () => {
		const input = {
			question: "Which claims?",
			options: [{ label: "First." }, { label: "Second", value: "second" }],
			explanation: "Both claims follow.",
			multiSelect: true,
		};
		for (const correctAnswer of [["First.", ': "second"'], JSON.stringify(["First.", ': "second"'])]) {
			assert.deepEqual(quizInputProblems({ ...input, correctAnswer }), []);
			assert.ok(parseQuizInput({ ...input, correctAnswer }));
			assert.deepEqual(resolveCorrect(correctAnswer, normalizeOptions(input.options)), { indices: [1, 2] });
		}
	});

	it("retains an exact JSON-looking option key across validation and grading", () => {
		const key = '["a", "b"]';
		const input = {
			question: "Which literal?",
			options: [{ label: key }, { label: "Other" }],
			explanation: "The first literal is intended.",
			correctAnswer: key,
		};
		assert.deepEqual(quizInputProblems(input), []);
		assert.ok(parseQuizInput(input));
		assert.deepEqual(resolveCorrect(key, normalizeOptions(input.options)), { indices: [1] });
	});
});

// ─── isCorrect (coincidencia exacta de conjuntos) ───────────────────────────

describe("isCorrect", () => {
	it("matches identical sets regardless of order", () => {
		assert.ok(isCorrect([3, 1], [1, 3]));
	});

	it("rejects partial matches", () => {
		assert.ok(!isCorrect([1], [1, 3]));
		assert.ok(!isCorrect([1, 2, 3], [1, 3]));
	});

	it("rejects wrong selections of the same size", () => {
		assert.ok(!isCorrect([1, 2], [1, 3]));
	});

	it("rejects empty selection against a non-empty answer", () => {
		assert.ok(!isCorrect([], [1]));
	});
});

// ─── buildAnswer + formatAnswerMessage ──────────────────────────────────────

function quizData(overrides?: Partial<QuestionData>): QuestionData {
	return {
		id: "q_test",
		kind: "quiz",
		question: "Which planet is closest to the Sun?",
		mode: "single-select",
		options: normalizeOptions([
			{ label: "Mercury", value: "mercury" },
			{ label: "Venus", value: "venus" },
		]),
		correctIndices: [1],
		explanation: "Mercury orbits closest.",
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("confidence stops", () => {
	it("the owner-decided grid (2026-10-01): resolution concentrates at the top", () => {
		assert.deepEqual(CONFIDENCE_STOPS, [0, 30, 50, 70, 90, 100]);
		assert.equal(CONFIDENCE_STOPS[DEFAULT_CONFIDENCE_INDEX], 50, "rests at a real coin flip");
	});
});

describe("buildAnswer", () => {
	it("grades a correct selection", () => {
		const ad = buildAnswer(quizData(), { values: ["mercury"] });
		assert.equal(ad.correct, true);
		assert.equal(ad.answers[0]?.label, "Mercury");
		assert.equal(ad.answers[0]?.index, 1);
		assert.equal(ad.dontKnow, false);
	});

	it("grades a wrong selection", () => {
		const ad = buildAnswer(quizData(), { values: ["venus"] });
		assert.equal(ad.correct, false);
	});

	it("dontKnow is never correct and records no answers", () => {
		const ad = buildAnswer(quizData(), { dontKnow: true });
		assert.equal(ad.correct, false);
		assert.equal(ad.dontKnow, true);
		assert.deepEqual(ad.answers, []);
	});

	it("keeps the note only when non-empty", () => {
		assert.equal(buildAnswer(quizData(), { values: ["mercury"], thinking: "  " }).thinking, undefined);
		assert.equal(buildAnswer(quizData(), { values: ["mercury"], thinking: " x " }).thinking, "x");
	});

	it("ignores unknown option values", () => {
		const ad = buildAnswer(quizData(), { values: ["mars", "mercury"] });
		assert.deepEqual(ad.answers.map((a) => a.value), ["mercury"]);
	});

	// Confianza (responsable, 2026-10-01): la probabilidad en bruto del deslizador viaja
	// solo con las respuestas reales a un quiz: nunca con "I don't know" (sin respuesta, sin
	// probabilidad), nunca con ask/explain. Se acota por precaución.
	it("carries confidence on quiz answers and clamps out-of-range values", () => {
		assert.equal(buildAnswer(quizData(), { values: ["mercury"], confidence: 90 }).confidence, 90);
		assert.equal(buildAnswer(quizData(), { values: ["mercury"], confidence: 150 }).confidence, 100);
		assert.equal(buildAnswer(quizData(), { values: ["mercury"], confidence: -5 }).confidence, 0);
		assert.equal(buildAnswer(quizData(), { values: ["mercury"] }).confidence, undefined);
	});

	it("drops confidence on dontKnow and on non-quiz kinds", () => {
		assert.equal(buildAnswer(quizData(), { dontKnow: true, confidence: 70 }).confidence, undefined);
		const ask = quizData({ kind: "ask", correctIndices: undefined, explanation: undefined });
		assert.equal(buildAnswer(ask, { other: "x", confidence: 70 }).confidence, undefined);
	});

	it("multi-select grades as exact-set", () => {
		const multi = quizData({
			mode: "multi-select",
			options: normalizeOptions([
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
				{ label: "C", value: "c" },
			]),
			correctIndices: [1, 2],
		});
		assert.equal(buildAnswer(multi, { values: ["a", "b"] }).correct, true);
		assert.equal(buildAnswer(multi, { values: ["a"] }).correct, false);
		assert.equal(buildAnswer(multi, { values: ["a", "b", "c"] }).correct, false);
	});

	it("ask questions are not graded", () => {
		const ask = quizData({ kind: "ask", correctIndices: undefined, explanation: undefined });
		const ad = buildAnswer(ask, { values: ["mercury"] });
		assert.equal(ad.correct, undefined);
	});
});


// ─── compactAnswerForModel (la dieta visible para el modelo, responsable 2026-10-02) ─

describe("compactAnswerForModel", () => {
	it("quiz: the learner's selection, verdict, confidence, note — NOTHING the model authored", () => {
		const ad = buildAnswer(quizData(), { values: ["mercury"], confidence: 70, thinking: "guessed" });
		const compact = compactAnswerForModel(ad);
		assert.deepEqual(compact, {
			kind: "quiz",
			answers: [{ index: 1, label: "Mercury" }],
			correct: true,
			confidence: 70,
			thinking: "guessed",
		});
		const raw = JSON.stringify(compact);
		// todos estos ya están en los argumentos de la LLAMADA a la herramienta
		assert.ok(!raw.includes("Which planet"), "no questionText");
		assert.ok(!raw.includes("Venus"), "no option-list restatement");
		assert.ok(!raw.includes("Mercury orbits closest"), "no explanation");
		assert.ok(!("correctIndices" in compact), "correct is the verdict; indices are the call's");
		assert.ok(!("questionId" in compact), "questionId was the toolCallId restated");
	});

	it("dontKnow: the gap flag stands alone — no verdict, no confidence", () => {
		const compact = compactAnswerForModel(buildAnswer(quizData(), { dontKnow: true }));
		assert.deepEqual(compact, { kind: "quiz", dontKnow: true });
	});

	it("ask: selection or text; never graded", () => {
		const askQD: QuestionData = {
			...quizData(),
			kind: "ask",
			mode: "text",
			correctIndices: undefined,
			explanation: undefined,
		};
		const compact = compactAnswerForModel(buildAnswer(askQD, { text: "lateral thinking" }));
		assert.deepEqual(compact, { kind: "ask", text: "lateral thinking" });
	});

	it("dismissed: a one-field record", () => {
		const ad = { ...buildAnswer(quizData(), { dontKnow: true }), dismissed: true };
		const compact = compactAnswerForModel(ad);
		assert.deepEqual(compact, { kind: "quiz", dismissed: true });
	});
});

// ─── dismissedAnswer / toolQuestionKind (descarte por aborto con ESC, 2026-10-02) ─

describe("dismissedAnswer (the ESC-abort record)", () => {
	it("the minimum honest answer: kind, questionText, dismissed — nothing else claimed", () => {
		const ad = dismissedAnswer("ask", "What drives you?");
		assert.equal(ad.kind, "ask");
		assert.equal(ad.questionText, "What drives you?");
		assert.equal(ad.dismissed, true);
		assert.equal(ad.dontKnow, false); // saltar no es declarar una laguna
		assert.deepEqual(ad.answers, []);
		assert.ok(ad.answeredAt);
	});

	it("compacts to the one-field model diet", () => {
		assert.deepEqual(compactAnswerForModel(dismissedAnswer("quiz", "Pick one")), {
			kind: "quiz",
			dismissed: true,
		});
	});
});

describe("toolQuestionKind (tool→kind parity with the dock)", () => {
	it("the three question tools map; unknown tools fall to ask", () => {
		assert.equal(toolQuestionKind("quiz"), "quiz");
		assert.equal(toolQuestionKind("explain"), "explain");
		assert.equal(toolQuestionKind("ask_user_question"), "ask");
		assert.equal(toolQuestionKind("anything-else"), "ask");
	});
});

// ─── toClientQuestion (seguridad frente a filtraciones) ─────────────────────

describe("toClientQuestion", () => {
	it("NEVER exposes correctIndices or explanation", () => {
		const cq = toClientQuestion(quizData());
		const raw = JSON.stringify(cq);
		assert.ok(!raw.includes("correctIndices"));
		assert.ok(!raw.includes("Mercury orbits closest"));
		assert.equal(cq.id, "q_test");
		assert.equal(cq.kind, "quiz");
		assert.equal(cq.options.length, 2);
	});
});


// ─── la máquina de estados de selección del dock (coexistencia con Other en multiselección) ─
// El fallo real: en un ask de selección múltiple, elegir la fila personalizada "Other…"
// borraba todas las opciones ya elegidas (la lógica de desplazamiento de selección única
// se aplicaba a los dos modos). La máquina vive aquí, pura y fijada.
describe("dock selection (toggleOption / toggleOther)", () => {
	it("multi-select: options and Other coexist — neither clears the other", () => {
		let sel = emptyDockSelection();
		sel = toggleOption("multi-select", sel, 0);
		sel = toggleOption("multi-select", sel, 1);
		assert.deepEqual([...sel.selected], [0, 1]);
		// Elegir Other conserva las selecciones hermanas.
		sel = toggleOther("multi-select", sel);
		assert.deepEqual([...sel.selected], [0, 1], "Other never clears picked options");
		assert.equal(sel.otherSelected, true);
		// Elegir otra opción mantiene Other seleccionada.
		sel = toggleOption("multi-select", sel, 2);
		assert.equal(sel.otherSelected, true, "options never clear a typed custom answer");
		assert.deepEqual([...sel.selected], [0, 1, 2]);
		// Deseleccionar una opción solo cambia esa opción.
		sel = toggleOption("multi-select", sel, 0);
		assert.deepEqual([...sel.selected], [1, 2]);
		// Other se desactiva sola; las hermanas sobreviven.
		sel = toggleOther("multi-select", sel);
		assert.equal(sel.otherSelected, false);
		assert.deepEqual([...sel.selected], [1, 2]);
	});

	it("multi-select: any selection clears dont-know", () => {
		let sel = { selected: new Set<number>(), otherSelected: false, dontKnow: true };
		sel = toggleOption("multi-select", sel, 0);
		assert.equal(sel.dontKnow, false);
		sel = toggleOther("multi-select", sel);
		assert.equal(sel.dontKnow, false);
	});

	it("single-select: displacement semantics are unchanged", () => {
		let sel = emptyDockSelection();
		sel = toggleOption("single-select", sel, 0);
		sel = toggleOther("single-select", sel);
		assert.deepEqual([...sel.selected], [], "Other displaces the picked option");
		assert.equal(sel.otherSelected, true);
		sel = toggleOption("single-select", sel, 1);
		assert.equal(sel.otherSelected, false, "an option displaces Other");
		assert.deepEqual([...sel.selected], [1]);
	});
});

// ─── la herramienta explain: preguntas de recuerdo libre (responsable 2026-09-27) ─

describe("explainInputBase / explainInputProblems (the commitment contract)", () => {
	it("has ONE authoring field — no explanation remnant (owner ruling 2026-09-27)", () => {
		// La separación explicación/respuesta del quiz MC era equipaje del quiz: el
		// recuerdo libre se compromete con un único correctAnswer, razonamiento incluido.
		const keys = Object.keys(explainInputBase.properties);
		assert.deepEqual(keys, ["question", "correctAnswer", "details"]);
	});

	it("the teach object LEADS with the required pair (type, nodeId) — base fields follow", () => {
		// Responsable, 2026-10-09: glm-5.3 omitía `type`/`nodeId` cuando iban detrás de
		// los campos de contenido: los campos obligatorios que se generan PRIMERO son los
		// que menos se omiten, y el orden sirve también de orden de autoría (rol, destino
		// y luego la pregunta). Replica la reordenación del quiz (ver arriba).
		const keys = Object.keys(explainInputObject.properties);
		assert.deepEqual(keys, ["type", "nodeId", ...Object.keys(explainInputBase.properties)]);
	});

	it("an empty commitment is the one authoring problem", () => {
		assert.deepEqual(explainInputProblems({ correctAnswer: "Full speed is c." }), []);
		assert.deepEqual(explainInputProblems({ correctAnswer: "   " }), [
			"correctAnswer is required — commit to the full correct answer BEFORE posing the question.",
		]);
	});
});

describe("buildAnswer / formatAnswerMessage: explain", () => {
	const explainQD = (overrides?: Partial<QuestionData>): QuestionData => ({
		id: "e1",
		kind: "explain",
		question: "Why does the Michelson-Morley null result matter?",
		mode: "text",
		options: [],
		committedAnswer: "It ruled out the luminiferous aether — a stationary aether would produce a fringe shift, none was observed — and set up special relativity.",
		createdAt: new Date().toISOString(),
		...overrides,
	});

	it("snapshots the commitment + explanation; the client NEVER grades free text", () => {
		const ad = buildAnswer(explainQD(), { text: "Something about light speed being constant?" });
		assert.equal(ad.correct, undefined, "no client verdict — the model grades in its reply");
		assert.equal(ad.correctIndices, undefined);
		assert.equal(ad.committed, "It ruled out the luminiferous aether — a stationary aether would produce a fringe shift, none was observed — and set up special relativity.");
		assert.equal(ad.text, "Something about light speed being constant?");
	});

	it("dontKnow records the gap with no attempted text", () => {
		// El DOCK nunca envía texto junto con dontKnow (su envío lo condiciona);
		// buildAnswer sigue siendo una correspondencia pura de la petición que recibe.
		const ad = buildAnswer(explainQD(), { dontKnow: true });
		assert.equal(ad.dontKnow, true);
		assert.equal(ad.text, undefined);
	});

	it("compactAnswerForModel (explain): his words ONLY — never the model's own commitment", () => {
		const compact = compactAnswerForModel(buildAnswer(explainQD(), { text: "No idea about aether." }));
		const raw = JSON.stringify(compact);
		assert.equal(compact.text, "No idea about aether.");
		assert.equal(compact.kind, "explain");
		// el compromiso es el propio argumento de llamada del modelo: NUNCA se repite
		assert.ok(!raw.includes("luminiferous"), "the commitment must not ride the result");
		assert.ok(!("committed" in compact));
		assert.ok(!("questionText" in compact));
	});

});

// ─── el rol de la pregunta: predecir frente a comprobar (responsable 2026-10-03) ─
// Las unidades de enseñanza son un ciclo predecir → enseñar → comprobar. El esquema de
// quiz de enseñanza lleva un `type` OBLIGATORIO que declara el rol; el quiz del sondeador
// nunca lo lleva (las preguntas de sondeo no tienen rol). La ley de revelación depende
// de él: solo las COMPROBACIONES se pliegan tras "Check your understanding"; las predicciones llegan abiertas.
describe("the quiz role field (predict | check)", () => {
	const valid = {
		question: "Which planet is closest to the Sun?",
		options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
		correctAnswer: "Mercury",
		explanation: "Mercury is the innermost planet.",
		type: "check",
		nodeId: "planet-order",
	};
	it("the teach schema REQUIRES type; the probe schema has no such field", () => {
		assert.equal(Value.Check(quizInputSchema, valid), true, "fixture (type: check) is boundary-valid");
		assert.equal(
			Value.Check(quizInputSchema, { ...valid, type: undefined }),
			false,
			"a teach quiz without a role is rejected at the boundary",
		);
		assert.equal(
			"nodeId" in (probeQuizInputSchema as { properties: Record<string, unknown> }).properties === false,
			true,
		);
		assert.equal(
			"type" in (probeQuizInputSchema as { properties: Record<string, unknown> }).properties,
			false,
			"the probe quiz stays role-less",
		);
	});

	it("normalizeQuizType: exact literals only — old records and wobble degrade to check-style", () => {
		assert.equal(normalizeQuizType("predict"), "predict");
		assert.equal(normalizeQuizType("check"), "check");
		assert.equal(normalizeQuizType(undefined), undefined);
		assert.equal(normalizeQuizType("prediction"), undefined);
		assert.equal(normalizeQuizType(42), undefined);
	});

	it("questionNeedsReveal: checks collapse, predictions never do — both teach tools", () => {
		assert.equal(questionNeedsReveal("quiz", { type: "check" }, "teach"), true);
		assert.equal(questionNeedsReveal("quiz", { type: "predict" }, "teach"), false, "predictions arrive OPEN");
		assert.equal(
			questionNeedsReveal("quiz", undefined, "teach"),
			true,
			"old records (no type) render check-style",
		);
		assert.equal(questionNeedsReveal("quiz", { type: "predict" }, "probe"), false);
		assert.equal(questionNeedsReveal("quiz", { type: "check" }, "probe"), false);
		assert.equal(questionNeedsReveal("ask_user_question", {}, "teach"), false);
		// Explain se sumó a la ley el 2026-10-09: las comprobaciones de enseñanza se pliegan, las
		// predicciones no, y los registros antiguos sin type se renderizan como comprobación, igual que quiz.
		assert.equal(questionNeedsReveal("explain", { type: "check" }, "teach"), true);
		assert.equal(questionNeedsReveal("explain", { type: "predict" }, "teach"), false);
		assert.equal(questionNeedsReveal("explain", undefined, "teach"), true, "pre-type explain records render check-style");
		assert.equal(questionNeedsReveal("explain", { type: "check" }, "probe"), false);
	});

	function quizQd(): QuestionData {
		const options = normalizeOptions(valid.options);
		return {
			id: "q1",
			kind: "quiz",
			question: valid.question,
			mode: "single-select",
			options,
			correctIndices: resolveCorrect(valid.correctAnswer, options).indices,
			explanation: valid.explanation,
			createdAt: new Date().toISOString(),
		};
	}

	it("buildAnswer snapshots the question's role and carries both thinking channels", () => {
		const predictQd: QuestionData = { ...quizQd(), questionType: "predict" };
		const a = buildAnswer(predictQd, { values: ["Mercury"], thinking: "  guessed  ", readingThinking: "  reading note  " });
		assert.equal(a.questionType, "predict");
		assert.equal(a.thinking, "guessed", "thinking is trimmed");
		assert.equal(a.readingThinking, "reading note");
		const b = buildAnswer(quizQd(), { values: ["Mercury"] });
		assert.equal(b.thinking, undefined, "empty channels stay absent, never empty strings");
		assert.equal(b.readingThinking, undefined);
		assert.equal(b.questionType, undefined, "a role-less QuestionData (probe / old record) answers role-less");
	});

	it("compactAnswerForModel: distinct keys for the two channels; legacy `note` folds into thinking", () => {
		const a = buildAnswer(quizQd(), { values: ["Mercury"], thinking: "h", readingThinking: "r" });
		const compact = compactAnswerForModel(a) as Record<string, unknown>;
		assert.equal(compact.thinking, "h");
		assert.equal(compact.thinkingWhileReading, "r");
		const legacy = compactAnswerForModel({ ...a, thinking: undefined, note: "old note" }) as Record<string, unknown>;
		assert.equal(legacy.thinking, "old note", "records written before the rename still reach the model");
		assert.equal("note" in legacy, false, "the legacy key never re-crosses the wire");
	});

	it("the display parse KEEPS the role: quizDisplayInputSchema retains type where the base strips it", () => {
		const cleaned = Value.Clean(quizDisplayInputSchema, { ...valid }) as Record<string, unknown>;
		assert.equal(cleaned.type, "check", "role survives the display parse (the dock gates collapse + labels on it)");
	});
});
