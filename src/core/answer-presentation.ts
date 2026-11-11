/** Procedencia de solo lectura para las tarjetas de preguntas históricas. Nunca se
 * persiste esta proyección: las identidades de las respuestas, el orden, la
 * calificación y el texto del alumno siguen siendo los hechos registrados; solo el
 * texto de presentación escrito por el modelo sale de la llamada. */
import { normalizeOptions, type QuestionAnswerData } from "./question-core.ts";
import { parseAskInput, parseExplainInput, parseQuizInput } from "./tool-parts.ts";
import { repairMathForDisplay } from "./math-delims.ts";

export function answerForPresentation(answer: QuestionAnswerData, input: unknown): QuestionAnswerData {
	if (answer.dismissed) return answer;
	const quiz = answer.kind === "quiz" ? parseQuizInput(input) : undefined;
	const explain = answer.kind === "explain" ? parseExplainInput(input) : undefined;
	const source = quiz ?? explain ?? (answer.kind === "ask" ? parseAskInput(input) : undefined);
	if (!source) return answer;
	const projected = { ...answer, questionText: source.question };
	if (quiz) projected.explanation = quiz.explanation;
	if (explain) projected.committed = explain.correctAnswer;
	if (!answer.options?.length || !("options" in source) || !source.options?.length) return projected;

	const original = normalizeOptions(source.options);
	const saved = answer.options;
	const bindings = new Map<number, number>(); // posición guardada -> posición original
	const used = new Set<number>();
	const bindUnique = (candidates: number[][]) => {
		for (let si = 0; si < saved.length; si++) {
			if (bindings.has(si)) continue;
			const possible = candidates[si]!.filter((oi) => !used.has(oi));
			if (possible.length !== 1) continue;
			const oi = possible[0]!;
			// Dos filas guardadas que reclaman la misma fuente son ambiguas, aunque
			// cada fila tenga por separado un único candidato.
			if (candidates.some((other, sj) => sj !== si && !bindings.has(sj) && other.includes(oi))) continue;
			bindings.set(si, oi);
			used.add(oi);
		}
	};
	// Los valores de las respuestas seleccionadas son identidades estables si el registro
	// los conservó. No se normalizan esos valores, ni se recalcula un barajado, ni se vuelve a calificar.
	bindUnique(saved.map((option) => {
		const values = answer.answers.filter((a) => a.index === option.index).map((a) => a.value);
		return original.flatMap((o, oi) => values.includes(o.value) ? [oi] : []);
	}));
	const recoveredLabels = original.map((o) => repairMathForDisplay(o.label));
	bindUnique(saved.map((option) => original.flatMap((o, oi) =>
		o.label === option.label || recoveredLabels[oi] === option.label ? [oi] : [])));
	// Una biyección con un único par restante no tiene ambigüedad de orden. Con varias
	// filas sin emparejar, se conservan sus instantáneas en lugar de adivinar.
	if (saved.length === original.length && bindings.size === saved.length - 1) {
		const si = saved.findIndex((_, i) => !bindings.has(i));
		const oi = original.findIndex((_, i) => !used.has(i));
		bindings.set(si, oi);
	}
	projected.options = saved.map((option, si) => {
		const oi = bindings.get(si);
		return oi === undefined ? option : { ...option, label: original[oi]!.label };
	});
	return projected;
}
