/**
 * question-core — el contrato de las preguntas + la lógica pura de corrección.
 * Sin importaciones de frameworks ni interfaz: todo aquí es determinista y se
 * puede probar con pruebas unitarias.
 *
 * Los esquemas TypeBox de abajo son los contratos de ENTRADA de las herramientas
 * (agent/tools declara las herramientas contra ellos); el navegador valida,
 * baraja y corrige con estas funciones, y luego devuelve el veredicto como
 * salida de la herramienta mediante addToolOutput:
 *   1. El modelo profesor llama a la herramienta `quiz` (pregunta + opciones +
 *      correctAnswer + explicación). Sin execute en el servidor → la llamada
 *      llega a la interfaz como una parte de herramienta tipada en estado
 *      `input-available`.
 *   2. El alumno responde en la tarjeta; el cliente corrige con este módulo.
 *   3. addToolOutput devuelve al modelo el veredicto (selección + acierto +
 *      nota — nunca la explicación, que la escribió el propio modelo).
 *
 * Como la pregunta pendiente ES una parte de mensaje persistida, una sesión se
 * puede abandonar y reanudar a mitad de pregunta sin coste alguno.
 */

import { Type, type Static } from "typebox";
import { stripModelValueDebris } from "./value-debris.ts";
import { expandCitationsForModel } from "./citations.ts";
import type { PluginSubmissionImages } from "./plugin-submissions.ts";

// ─── tipos compartidos ──────────────────────────────────────────────────────

export interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

// ─── esquemas de entrada de las herramientas (el contrato de las preguntas) ──
// Los nombres de los parámetros reflejan exactamente los docs del prompt — mantenlos sincronizados.

/** Una opción de respuesta de un quiz. Decisión del responsable (2026-09-26): SIN
 * campo `description` — el modelo lo usaba sistemáticamente para filtrar si era
 * correcta ("eso no es el gradiente", "casi, pero…"), lo que hacía que los quizzes
 * se pudieran responder por eliminación. Las aclaraciones neutras van en el texto
 * de la pregunta o en la explicación posterior a la respuesta; la opción es una
 * afirmación escueta. */
const quizOptionProps = {
	label: Type.String({ description: "Display label for the answer option — a bare claim, no reasoning" }),
	value: Type.Optional(
		Type.String({
			description: "Optional machine-readable value returned for the option. Defaults to the label.",
		}),
	),
};

/** Una opción de respuesta de ask — conserva `description`: ask es una recogida de
 * preferencias sin corrección, no hay acierto que filtrar. */
const askOptionProps = {
	...quizOptionProps,
	description: Type.Optional(
		Type.String({ description: "Optional extra detail shown below the option" }),
	),
};

/** Protección contra el titubeo de GLM (aprobada por el responsable, 2026-09-26): a
 * veces los modelos emiten `options` como una CADENA CODIFICADA EN JSON en lugar de
 * un array. Se analiza antes de usarla. La comparten prepareArguments de las
 * herramientas (servidor, antes de validar) y normalizeOptions (cliente — la
 * llamada persistida conserva la cadena en bruto, así que el dock debe volver a
 * convertirla). Devuelve la entrada sin tocar cuando no es un array analizable —
 * y entonces la validación informa con honestidad. */
export function parseOptionsIfString<T>(options: string | T[] | undefined): unknown {
	if (typeof options !== "string") return options;
	try {
		const parsed: unknown = JSON.parse(options);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		/* no es JSON — se deja pasar sin tocar */
	}
	return options;
}

// ─── validación de autoría entre campos (refinamientos del esquema de la herramienta) ──
// Se aplica en la frontera de la llamada a la herramienta (ver los superRefine de abajo): una
// pregunta no válida NUNCA llega al alumno — el SDK devuelve el error de validación al
// profesor como resultado de la herramienta y el profesor lo reintenta. Las reglas reflejan
// exactamente la ruta de corrección (normalizeOptions / coerceCorrectAnswer /
// resolveCorrect), así que válido según el esquema ⇔ corregible.

/** Comprobación de las opciones común a quiz + ask: etiquetas no vacías y valores
 * resueltos (el `value` recortado o, si no, la etiqueta recortada — exactamente como
 * los indexa normalizeOptions) distintos. Devuelve los problemas más las claves
 * resueltas para la comprobación de correctAnswer. */
function optionProblems(
	options: Array<{ label: string; value?: string }>,
): { problems: string[]; keys: string[] } {
	const problems: string[] = [];
	const keys: string[] = [];
	options.forEach((option, i) => {
		const label = option.label.trim();
		if (label.length === 0) {
			problems.push(`options[${i}].label is empty — every option needs a label.`);
			return;
		}
		const key = option.value?.trim() || label;
		if (keys.includes(key)) {
			problems.push(`Two options resolve to the same value "${key}" — options must be distinct.`);
		}
		keys.push(key);
	});
	return { problems, keys };
}

/** Opciones de ask: la comprobación común, nada más (ask no se corrige). */
export function askOptionProblems(options: Array<{ label: string; value?: string }>): string[] {
	return optionProblems(options).problems;
}

/** El contrato de autoría completo del quiz: comprobación de opciones + correctAnswer
 * debe ser corregible. Resultado vacío = un quiz que el dock puede armar y corregir
 * fielmente. */
export function quizInputProblems(input: {
	options: Array<{ label: string; value?: string }>;
	correctAnswer: string | string[];
	multiSelect?: boolean;
}): string[] {
	const { problems, keys } = optionProblems(input.options);

	// Se conservan las claves exactas de las opciones antes de intentar limpiar la sintaxis copiada —
	// la misma conversión consciente de las opciones se ejecuta en las fronteras de visualización y corrección.
	const entries = coerceCorrectAnswer(input.correctAnswer, keys);
	const unique = [...new Set(entries)];
	if (unique.length === 0 || unique.some((v) => v.length === 0)) {
		problems.push("correctAnswer is required — provide the value (or label) of the correct option(s).");
		return problems;
	}
	for (const v of unique) {
		if (!keys.includes(v)) {
			problems.push(
				`correctAnswer "${v}" does not match any option value. Valid values: ${keys.map((k) => `"${k}"`).join(", ")}. ` +
					"Copy the exact value (or label) of the intended option — never a paraphrase or slug.",
			);
		}
	}
	if (unique.length > 1 && input.multiSelect !== true) {
		problems.push(
				`correctAnswer lists ${unique.length} values but multiSelect is not true — a single-select question with several ` +
					"correct answers can never be answered correctly. Set multiSelect: true, or make exactly one option correct.",
		);
	}
	return problems;
}

// Los campos de autoría COMPARTIDOS del quiz — todo salvo `nodeId`. Los agentes de sondeo
// y de enseñanza usan herramientas DISTINTAS con el mismo nombre (docs/probe-teach-
// split.md §1): el quiz del sondeador NO tiene campo nodeId (no hay mapa en el que
// situarse) y el del profesor lo añade (la señal de posición — la validación del árbol
// por sesión se ejecuta en el execute de la herramienta, tools.ts).
// Las reglas de corrección son idénticas y tienen aquí su única fuente. El contrato de
// autoría entre campos (quizInputProblems, arriba) se aplica en la frontera de la
// llamada, en execute — TypeBox lleva la estructura al modelo y la función de
// problemas lleva los refinamientos.
//
// Decisión sobre el orden de los argumentos (responsable, 2026-09-25): la explicación es
// RAZONAMIENTO, y el razonamiento ocurre ANTES de elegir la respuesta — los modelos emiten
// los argumentos en el orden del esquema, así que la explicación va justo ANTES de correctAnswer.
// (Todos los consumidores leen por clave; el orden es una guía de autoría, nada más.)
export const quizInputBase = Type.Object({
	question: Type.String({
		description:
			"The single quiz question to ask. ONE question per turn: ask, then end your turn — the answer determines the next question.",
	}),
	options: Type.Array(Type.Object(quizOptionProps), {
		minItems: 2,
		description:
			"REQUIRED. The answer options (2 or more) as a JSON ARRAY of option objects — never a " +
			"JSON-encoded string. Options only — there is no free-text mode. " +
			"Give each option a stable `value`; you reference the correct one by that value in correctAnswer. " +
			"Never add your own 'I don't know' option — that choice is added for you.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			description: "Set to true when more than one option is correct and the learner must select all of them.",
		}),
	),
	explanation: Type.String({
		description:
			"REQUIRED. Explanation revealed AFTER the learner answers (shown whether they got it right or wrong). " +
			"Use it to reinforce why the correct answer is correct. It is written BEFORE correctAnswer by design: " +
			"reason it out first, then commit the answer the reasoning supports.",
	}),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			"REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. " +
			'Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); ' +
			"the learner is only correct if their selection matches this set exactly. " +
			"Always pass the value, not a position number — this is self-checking and prevents miscounting. " +
			"A value that matches no option fails validation and the call is returned to you to fix.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
});

// El objeto quiz del lado de ENSEÑANZA: la base compartida + el campo de posición en
// el plan + el campo de ROL (diseño del responsable, 2026-10-03, "dos preguntas por
// unidad de enseñanza"): `type` declara el papel de la pregunta en el ciclo. La DOCTRINA
// DE ROLES vive en el prompt del sistema (responsable: las descripciones de las
// herramientas siguen siendo puramente MECÁNICAS — sin instrucciones sobre cómo deben
// ser las preguntas); las frases del enum de abajo solo dicen CUÁNDO se usa cada tipo.
// nodeId significa "esta pregunta trata SOBRE este nodo" — una señal de posición,
// nunca de finalización (docs/archive/probe-teach-split.md §3). AMBOS tipos de
// enseñanza lo llevan. El contrato de autoría entre campos (el endurecimiento de la
// barrera 3: un quiz cuyo correctAnswer no se puede corregir NUNCA llega al alumno —
// válido según el esquema ⇔ corregible, con las reglas exactas que acepta la ruta de
// corrección) se ejecuta en la FRONTERA DE LA LLAMADA, en el execute de la herramienta:
// quizInputProblems aquí y la validación del nodeId del plan por sesión en tools.ts
// (que lee el registro del chat en vivo, algo que este núcleo nunca toca).
export const QUIZ_QUESTION_TYPES = ["predict", "check"] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/** Normaliza el `type` de un quiz persistido (frontera de visualización): los
 * registros antiguos no lo llevan y el titubeo irreparable se degrada a undefined —
 * los llamadores renderizan "Quiz" y la tarjeta de estilo comprobación. La limpieza
 * de restos (whitehead, 2026-10-09) repara el titubeo registrado `"\"predict\""` —
 * un registro persistido en bruto muestra el rol que pretendía. */
export function normalizeQuizType(raw: unknown): QuizQuestionType | undefined {
	if (typeof raw !== "string") return undefined;
	const v = stripModelValueDebris(raw);
	return v === "predict" ? "predict" : v === "check" ? "check" : undefined;
}

/** La ley de la revelación como predicado puro (responsable 2026-10-03; explain se
 * sumó el 2026-10-09): una COMPROBACIÓN de la fase de enseñanza se pliega tras la
 * revelación "Check your understanding" — una predicción NUNCA (precede a la
 * enseñanza y le sirve de barrera; plegarla invertiría el ciclo), ni tampoco las
 * preguntas de sondeo, de plan ni ask. Las dos herramientas de preguntas de la
 * enseñanza (quiz y explain) obedecen la misma ley. chat.tsx lo llama para su pregunta
 * pendiente; el campo de razonamiento durante la lectura se monta sobre la misma
 * verdad. Los registros anteriores al campo `type` no lo llevan — se renderizan como
 * comprobaciones, el valor por defecto vigente. */
export function questionNeedsReveal(tool: string, rawInput: unknown, phase: string): boolean {
	if ((tool !== "quiz" && tool !== "explain") || phase !== "teach") return false;
	return normalizeQuizType((rawInput as { type?: unknown } | null)?.type) !== "predict";
}

/** El campo de rol del ciclo de enseñanza, compartido TAL CUAL por las dos
 * herramientas de preguntas de la enseñanza (responsable, 2026-10-09: explain gana
 * los tipos del ciclo — una comprobación de recuerdo libre se pliega tras la
 * revelación igual que la comprobación de un quiz; una predicción nunca). Palabras
 * sueltas, nunca entre comillas (el titubeo de copiar las comillas — ver las
 * fijaciones de whitehead, tests/tool-heal.test.ts). */
const predictCheckType = Type.Union([Type.Literal("predict"), Type.Literal("check")], {
	description:
		"REQUIRED — the question's role in the teaching cycle, as a bare word (no quotes): predict = posed BEFORE " +
		"you teach the step (its own turn; the learner answers, then your teaching resolves it — arrives open, never " +
		"collapsed); check = posed AFTER the step's teaching is complete (arrives collapsed behind the Check your " +
		"understanding reveal). ONE question per turn either way.",
});


/** El objeto quiz del lado de ENSEÑANZA. El par obligatorio encabeza el orden de
 * las propiedades (responsable, 2026-10-09): glm-5.3 omitía `type`/`nodeId` en las
 * llamadas largas PORQUE iban detrás de todos los campos de contenido — los campos
 * que se generan primero son los que menos se pierden. El orden es también el de
 * autoría: comprometerse con el nodo y el rol de la pregunta, y luego escribirla. */
export const quizInputObject = Type.Object({
	type: predictCheckType,
	nodeId: Type.String({
		description:
			"REQUIRED plan-tree node id this question is about — must EXACTLY match one of this session's " +
			"plan_init node slugs (validated at call time; a mismatched id is rejected back to you). " +
			"The lesson's position on the map derives from these tags (the node the latest tagged question is about is " +
			"where the map stands; earlier ones count as visited). A node takes as many questions as it deserves: stay on " +
			"one node for as many turns as the understanding needs — one reasoning step at a time, never rush forward. " +
			"For off-map checks use ask_user_question.",
	}),
	...quizInputBase.properties,
});

/** La declaración del quiz del lado de SONDEO: el contrato de autoría compartido,
 * sin nodeId ni campo `type` — el mapa de la sesión aún no existe, y el sondeo tiene
 * exactamente UN rol de pregunta (responsable 2026-10-03: el sondeador conserva su
 * propia herramienta; los tipos del ciclo de enseñanza se quedan con el profesor,
 * así nada invita a un mal uso). Estructuralmente idéntica a quizInputBase (el
 * antiguo superRefine nunca llegaba a la red — se ejecutaba en la frontera de la
 * llamada, donde ahora se ejecuta quizInputProblems). */
export const probeQuizInputSchema = quizInputBase;

/** El análisis de VISUALIZACIÓN de las llamadas a quiz persistidas (tool-parts.ts):
 * la base + `type` como cadena simple OPCIONAL (los registros antiguos no lo llevan,
 * y Value.Clean solo conserva una clave cuando el esquema la conoce — si no, el dock
 * perdería el rol con el que renderiza y aplica la barrera). La normalización es
 * normalizeQuizType en la frontera de lectura; nodeId se sigue eliminando (clave
 * desconocida). El quiz de SONDEO se analiza contra la base desnuda — las llamadas
 * de sondeo no llevan tipo. */
export const quizDisplayInputSchema = Type.Object({
	...quizInputBase.properties,
	type: Type.Optional(Type.String()),
});

// ─── la herramienta explain (preguntas de recuerdo libre, responsable 2026-09-27) ──
//
// Mecánica de quiz SIN opciones: el alumno responde con sus propias palabras.
// La MITIGACIÓN DE LA COMPLACENCIA es estructural — el modelo se compromete con la
// respuesta correcta completa ANTES de plantearla (el compromiso viaja en los argumentos
// persistidos de la llamada, se revela al alumno al enviar y se repite en el resultado
// de la respuesta contra el que corrige el modelo; el cliente nunca corrige texto libre).
// UNA respuesta comprometida, razonamiento incluido (decisión del responsable 2026-09-27:
// el campo de explicación aparte era un resto del quiz — se eliminó al fusionarlo).
// La doctrina de la mecánica vive en las DESCRIPCIONES DE LAS HERRAMIENTAS (decisión
// nativa de pi), no en el prompt del sistema.

export const explainInputBase = Type.Object({
	question: Type.String({
		description:
			"The single question to ask. ONE question per turn: ask, then end your turn — the answer determines the next.",
	}),
	correctAnswer: Type.String({
		description:
			"REQUIRED. The full correct answer in your own words, reasoning included — COMMITTED before the learner " +
			"ever sees the question. The commitment is immutable: when his answer returns, grade it strictly against this " +
			"text — never revise the commitment after seeing his words, and never mark a wrong answer right to be kind. " +
			"It is shown to him on submit; your next reply grades the nuance of what he wrote.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
});

/** El objeto explain del lado de ENSEÑANZA: base + el campo de posición en el plan
 * (misma semántica que el nodeId del quiz — la frontera reconoce AMBAS herramientas). */
/** El objeto explain del lado de ENSEÑANZA: base + el campo de rol del ciclo de
 * enseñanza y el campo de posición en el plan (misma semántica que los del quiz — la
 * frontera reconoce AMBAS herramientas). El par obligatorio encabeza el orden de las
 * propiedades, exactamente como en el quiz de enseñanza (responsable, 2026-10-09). */
export const explainInputObject = Type.Object({
	type: predictCheckType,
	nodeId: Type.String({
		description:
			"REQUIRED plan-tree node id this question is about — must EXACTLY match one of this session's " +
			"plan_init node slugs (validated at call time; a mismatched id is rejected back to you). " +
			"The lesson's position on the map derives from these tags (the node the latest tagged question is about is " +
			"where the map stands; earlier ones count as visited). A node takes as many questions as it deserves: stay on " +
			"one node for as many turns as the understanding needs — one reasoning step at a time, never rush forward. " +
			"For off-map checks use ask_user_question.",
	}),
	...explainInputBase.properties,
});

/** El análisis de VISUALIZACIÓN de las llamadas a explain persistidas (tool-parts.ts):
 * la base + `type` como cadena simple OPCIONAL — exactamente el patrón de
 * visualización del quiz. Los registros antiguos no lo llevan; questionNeedsReveal
 * los trata como comprobaciones (el valor por defecto vigente). nodeId se sigue
 * eliminando (clave desconocida). El recall de SONDEO se analiza contra la base
 * desnuda. */
export const explainDisplayInputSchema = Type.Object({
	...explainInputBase.properties,
	type: Type.Optional(Type.String()),
});

/** El contrato de autoría de explain: el compromiso debe existir. Resultado vacío =
 * un explain que el dock puede armar y contra el que el modelo puede corregir. */
export function explainInputProblems(input: { correctAnswer: string }): string[] {
	if (input.correctAnswer.trim().length === 0) {
		return ["correctAnswer is required — commit to the full correct answer BEFORE posing the question."];
	}
	return [];
}

/** Los nombres de las herramientas que llevan la mecánica de preguntas — la frontera
 * de enseñanza (fases), el plegado de posición en el plan y la barrera de pendientes
 * reconocen la que esté armada. */
export const QUIZ_TOOL_NAMES = ["quiz", "explain"] as const;

/** La declaración del quiz del PROFESOR (base + el campo de posición). */
export const quizInputSchema = quizInputObject;

export const askInputSchema = Type.Object({
	// Sin parámetro `mode` — el original de pi no lo tiene: el modo se deduce de si
	// hay opciones (el dock hace exactamente eso). Un mando menos que el modelo
	// pueda usar mal.
	question: Type.String({
		description:
			"The single question to ask the learner. ONE question per turn: ask, then end your turn — the answer determines the next question.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
	options: Type.Optional(
		Type.Array(Type.Object(askOptionProps), {
			minItems: 2,
			description:
				"Optional multiple-choice options. Omit for free-form text input. " +
				"The learner can always choose 'Other' and type a custom answer when options are provided.",
		}),
	),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Set to true to allow multiple answers to the same question." }),
	),
});
// La comprobación de opciones de ask (etiquetas no vacías y valores distintos — ask no se
// corrige, pero los valores duplicados rompen la indexación por valor del dock) se ejecuta
// en la frontera de la llamada, en execute (askOptionProblems, arriba).

export type QuizToolInput = Static<typeof quizInputObject>;
export type AskToolInput = Static<typeof askInputSchema>;
export type ExplainToolInput = Static<typeof explainInputObject>;
export type ProbeExplainToolInput = Static<typeof explainInputBase>;


/** Una respuesta seleccionada real, en el orden en que se mostraron las opciones. */
export interface OptionAnswer {
	label: string;
	value: string;
	index: number; // índice de visualización empezando en 1
}

export type QuestionKind = "quiz" | "ask" | "explain";
export type SelectMode = "single-select" | "multi-select";
export type QuestionMode = SelectMode | "text";

/** Datos completos de la pregunta — guardados en la entrada personalizada `lh_question`. */
export interface QuestionData {
	id: string;
	kind: QuestionKind;
	/** Solo quiz (fase de enseñanza, responsable 2026-10-03): el papel de la pregunta en
	 * el ciclo — predict (antes de la enseñanza, nunca plegada) o check (después,
	 * tras la revelación). Ausente en los quizzes de sondeo y en los registros
	 * antiguos — todo con forma de comprobación. */
	questionType?: QuizQuestionType;
	question: string;
	context?: string;
	mode: QuestionMode;
	options: QuizOption[]; // orden de visualización (después de barajar)
	// solo quiz. NUNCA se envía al cliente antes de responder:
	correctIndices?: number[];
	// solo explain. NUNCA se envía al cliente antes de responder:
	committedAnswer?: string;
	// solo quiz (el "porqué" de la opción múltiple). NUNCA se envía al cliente antes de responder:
	explanation?: string;
	createdAt: string;
}

/** La respuesta del alumno — registro estructurado completo, guardado en
 * `lh_question_answered`. SIN questionId (responsable, dieta de resultados de
 * herramientas 2026-10-02): era el toolCallId repetido — el mensaje toolResult ya
 * lo lleva. */
export interface QuestionAnswerData {
	kind: QuestionKind;
	/** El NOMBRE de la herramienta de la llamada persistida (responsable, 2026-10-09):
	 * las llamadas de la fase de sondeo son `probe`/`recall` y las de enseñanza
	 * `quiz`/`explain` — las tarjetas se rotulan con él ("Probe"/"Recall"), así el
	 * límite entre fases se ve en la transcripción. Ausente en los registros anteriores
	 * al cambio de nombre: esos conservan las etiquetas basadas en el tipo. */
	tool?: string;
	/** Solo quiz (fase de enseñanza): la instantánea del rol para el renderizado (una
	 * predicción recoge su explicación) y para desgloses posteriores de calibración.
	 * Ausente en los registros antiguos y en las respuestas de sondeo. */
	questionType?: QuizQuestionType;
	questionText: string;
	options?: { index: number; label: string }[]; // instantánea para el renderizado
	dontKnow: boolean;
	answers: OptionAnswer[];
	other?: string; // ask: texto libre de "Other"
	text?: string; // ask/explain: respuesta en modo texto
	/** El razonamiento del alumno sobre la PREGUNTA (antes `note`, responsable
	 * 2026-10-03 — "eso es lo que es"). */
	thinking?: string;
	/** @deprecated la clave anterior al cambio de nombre — ya no se escribe; los
	 * registros antiguos se reproducen con los mismos tipos, así que sigue declarada.
	 * Se lee con `thinking ?? note`. */
	note?: string;
	/** El razonamiento del alumno MIENTRAS LEE la prosa de enseñanza (responsable
	 * 2026-10-03) — un canal distinto de `thinking`, capturado por el campo de lectura
	 * y que viaja con la respuesta de comprobación. Ausente cuando está vacío. */
	readingThinking?: string;
	/** Canales de imagen explícitos propiedad del host; nunca se deducen del texto ni de rutas. */
	images?: PluginSubmissionImages;
	confidence?: number; // solo quiz: la probabilidad declarada por el alumno (0-100, en bruto) de que su respuesta seleccionada sea correcta — nunca se envía con "I don't know" (responsable, 2026-10-01)
	correct?: boolean; // solo quiz
	correctIndices?: number[]; // solo quiz (renderizado)
	committed?: string; // solo explain (renderizado): la respuesta comprometida del modelo
	explanation?: string; // solo quiz (renderizado)
	dismissed?: boolean;
	answeredAt: string;
}

/** Contenido de la pregunta de cara al cliente; omite deliberadamente la respuesta. */
export interface ClientQuestion {
	id: string;
	kind: QuestionKind;
	question: string;
	context?: string;
	mode: QuestionMode;
	options: QuizOption[];
}

/** Lo que el servidor pasa al puente cuando el alumno responde. */
export interface AnswerRequest {
	dontKnow?: boolean;
	values?: string[]; // valores de las opciones
	other?: string; // "Other" de ask
	text?: string; // ask en modo texto
	thinking?: string; // el canal de razonamiento sobre la pregunta (antes `note`)
	readingThinking?: string; // el canal de razonamiento durante la lectura (respuestas de comprobación)
	confidence?: number; // solo quiz: probabilidad en bruto 0-100 — 50 es un auténtico cara o cruz, siempre se envía (responsable, 2026-10-01)
}

/** Los puntos de anclaje del deslizador de confianza (responsable, 2026-10-01):
 * probabilidad en bruto de que la respuesta seleccionada sea correcta, desiguales a
 * propósito — la resolución se concentra arriba, donde vive la señal de calibración
 * (90 frente a 100 separa saber de dominar). 50 es un auténtico cara o cruz y el
 * valor por defecto en reposo — un 50 sin tocar y uno deliberado son el mismo número. */
export const CONFIDENCE_STOPS: readonly number[] = [0, 30, 50, 70, 90, 100];
export const DEFAULT_CONFIDENCE_INDEX = 2;

// ─── selección del dock (la máquina de estados del cliente, pura para las pruebas) ──

/** El estado de selección del dock de preguntas (índices desde 0 en orden de visualización). */
export interface DockSelection {
	selected: Set<number>;
	otherSelected: boolean;
	dontKnow: boolean;
}

export const emptyDockSelection = (): DockSelection => ({ selected: new Set(), otherSelected: false, dontKnow: false });

/** Instantánea del envío en memoria: sobrevive al desmontaje optimista del formulario
 * de la pregunta y nunca se escribe en el almacenamiento. Los índices usan el barajado
 * estable de la llamada. */
export interface QuestionFormDraft {
	selection: DockSelection;
	thinking: string;
	other: string;
	text: string;
	confidenceIndex: number;
}

export interface QuestionDraft {
	form?: QuestionFormDraft;
	readingThinking?: string;
}

/**
 * Alternar una opción de la lista. Selección única: la opción pasa a ser LA
 * respuesta y desplaza a "Other". Selección múltiple: la opción se alterna junto a
 * sus hermanas Y a "Other" — las selecciones son independientes (elegir opciones
 * nunca debe borrar una respuesta personalizada, y elegir la fila personalizada
 * nunca debe borrarlas a ellas).
 */
export function toggleOption(mode: SelectMode, sel: DockSelection, idx: number): DockSelection {
	if (mode === "multi-select") {
		const selected = new Set(sel.selected);
		if (selected.has(idx)) selected.delete(idx);
		else selected.add(idx);
		return { selected, otherSelected: sel.otherSelected, dontKnow: false };
	}
	return { selected: new Set([idx]), otherSelected: false, dontKnow: false };
}

/**
 * Alternar la fila "Other…" de ask. Selección única: elegirla la convierte en LA
 * respuesta y desplaza a las opciones de la lista (el texto escrito siempre se
 * conserva). Selección múltiple: se alterna junto a las selecciones de la lista y
 * no borra nada.
 */
export function toggleOther(mode: SelectMode, sel: DockSelection): DockSelection {
	if (mode === "multi-select") return { ...sel, otherSelected: !sel.otherSelected, dontKnow: false };
	return { selected: new Set(), otherSelected: true, dontKnow: false };
}

// ─── opciones ───────────────────────────────────────────────────────────────

export function normalizeOptions(
	options: string | Array<{ label: string; value?: string; description?: string }> | undefined,
): QuizOption[] {
	const seen = new Set<string>();
	// La llamada a herramienta persistida puede llevar las opciones codificadas como
	// cadena de GLM — parseOptionsIfString es la misma conversión que ejecuta
	// prepareArguments del servidor antes de validar (ver parseOptionsIfString).
	const coerced = parseOptionsIfString(options);
	const list = Array.isArray(coerced)
		? (coerced as Array<{ label: string; value?: string; description?: string }>)
		: [];
	return list
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => {
			if (option.label.length === 0) return false;
			if (seen.has(option.value)) throw new Error(`duplicate option value "${option.value}"`);
			seen.add(option.value);
			return true;
		});
}

/** Fisher-Yates sobre una copia. correctAnswer se indexa por valor, así que el orden
 * de visualización se puede barajar sin riesgo antes de resolver los índices. */
// ─── opciones ───────────────────────────────────────────────────────────────

/** mulberry32 con semilla de cadena — barajado determinista para un renderizado seguro en la hidratación. */
export function seededRandom(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Fisher–Yates con un RNG inyectable. Pasa `seededRandom(toolCallId)` en los
 * componentes renderizados: Math.random() baraja distinto en el servidor y en el
 * cliente y rompe la hidratación (React #418). Una semilla por toolCallId mantiene
 * el orden estable entre recargas y aun así lo varía en cada pregunta.
 */
export function shuffleOptions(options: QuizOption[], rand: () => number = Math.random): QuizOption[] {
	const out = [...options];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const a = out[i]!;
		const b = out[j]!;
		out[i] = b;
		out[j] = a;
	}
	return out;
}

// ─── corrección del quiz ────────────────────────────────────────────────────

/** Conserva una clave de opción exacta antes de intentar limpiar la sintaxis
 * copiada: el punto final, las comillas o las comillas invertidas de una etiqueta
 * pueden ser CONTENIDO (incidente de cálculo, 2026-10-12), no restos del modelo. Se
 * exigen los valores reales de las opciones para que ningún llamador pueda quitar
 * una respuesta válida antes de comprobar la pertenencia. Lo que no coincide sigue
 * con la reparación whitehead existente (`[":parmenides"]`) y la conversión de
 * selección múltiple serializada como JSON. La comparten la frontera, la
 * visualización y la corrección; las claves canónicas de las opciones nunca se
 * reescriben. */
export function coerceCorrectAnswer(
	correctAnswer: string | string[],
	optionValues: readonly string[],
): string[] {
	const clean = (value: string): string => {
		const trimmed = value.trim();
		return optionValues.includes(trimmed) ? trimmed : stripModelValueDebris(value);
	};
	if (Array.isArray(correctAnswer)) return correctAnswer.map(clean);
	const trimmed = correctAnswer.trim();
	// Una clave de cadena exacta puede parecer a su vez un array JSON.
	if (optionValues.includes(trimmed)) return [trimmed];
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((v) => clean(String(v)));
		} catch {
			// no es JSON válido — se trata como un único valor literal
		}
	}
	return [clean(correctAnswer)];
}

/** Resuelve los valores indicados por el autor a índices de visualización desde 1.
 * Indexar por valor (no por posición) convierte una errata en un error tajante en
 * lugar de una corrección errónea silenciosa. Debe ejecutarse DESPUÉS de barajar. */
export function resolveCorrect(
	correctAnswer: string | string[] | undefined,
	options: QuizOption[],
): { indices: number[]; error?: string } {
	if (correctAnswer === undefined) return { indices: [], error: "correctAnswer is required" };
	const arr = coerceCorrectAnswer(correctAnswer, options.map((o) => o.value));
	if (arr.length === 0) return { indices: [], error: "correctAnswer is required" };
	const byValue = new Map(options.map((o, i) => [o.value, i + 1]));
	const indices: number[] = [];
	for (const raw of arr) {
		const v = typeof raw === "string" ? raw.trim() : raw;
		const idx = byValue.get(v);
		if (idx === undefined) {
			const known = options.map((o) => `"${o.value}"`).join(", ");
			return { indices: [], error: `correctAnswer "${v}" does not match any option value (${known})` };
		}
		indices.push(idx);
	}
	return { indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
}

/** Coincidencia exacta de conjuntos: el mismo número de selecciones, los mismos índices. */
export function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean {
	if (selectedIndices.length !== correctIndices.length) return false;
	const a = [...selectedIndices].sort((x, y) => x - y);
	const b = [...correctIndices].sort((x, y) => x - y);
	return a.every((v, i) => v === b[i]);
}

// ─── armado + respuesta ─────────────────────────────────────────────────────

export function toClientQuestion(qd: QuestionData): ClientQuestion {
	return {
		id: qd.id,
		kind: qd.kind,
		question: qd.question,
		context: qd.context,
		mode: qd.mode,
		options: qd.options,
	};
}

function formatOptionRef(options: QuizOption[], index: number): string {
	const opt = options.find((o, i) => i + 1 === index);
	return `${index}. ${opt ? opt.label : "(unknown)"}`;
}

/**
 * Convierte un AnswerRequest en el registro completo de la respuesta + el mensaje
 * del usuario que verá el agente. Las respuestas de quiz se corrigen aquí; las de
 * ask no.
 */
export function buildAnswer(qd: QuestionData, req: AnswerRequest, tool?: string): QuestionAnswerData {
	const base: QuestionAnswerData = {
		kind: qd.kind,
		...(tool ? { tool } : {}),
		questionType: qd.questionType,
		questionText: qd.question,
		options: qd.options.map((o, i) => ({ index: i + 1, label: o.label })),
		dontKnow: req.dontKnow === true,
		answers: [],
		thinking: req.thinking?.trim() || undefined,
		readingThinking: req.readingThinking?.trim() || undefined,
		answeredAt: new Date().toISOString(),
	};
	// resuelve los valores de opción seleccionados → OptionAnswer (en orden de visualización)
	if (req.values && req.values.length > 0) {
		const byValue = new Map(qd.options.map((o, i) => [o.value, { ...o, index: i + 1 }]));
		for (const v of req.values) {
			const opt = byValue.get(v);
			if (!opt) continue; // valor desconocido — se ignora
			base.answers.push({ label: opt.label, value: opt.value, index: opt.index });
		}
		base.answers.sort((a, b) => a.index - b.index);
	}
	if (req.other?.trim()) base.other = req.other.trim();
	if (req.text?.trim()) base.text = req.text.trim();

	if (qd.kind === "quiz") {
		base.correctIndices = qd.correctIndices ?? [];
		base.explanation = qd.explanation;
		base.correct = base.dontKnow ? false : isCorrect(base.answers.map((a) => a.index), qd.correctIndices ?? []);
		// El deslizador de confianza solo acompaña a respuestas reales de quiz — nunca a
		// "I don't know" (sin respuesta, sin probabilidad). Se acota por precaución;
		// el dock se ajusta a la cuadrícula y el registro acepta cualquier entero.
		if (!base.dontKnow && req.confidence !== undefined) {
			base.confidence = Math.max(0, Math.min(100, Math.round(req.confidence)));
		}
	}
	if (qd.kind === "explain") {
		// Sin corrección en el cliente — el modelo corrige en su respuesta, contra el
		// compromiso. El compromiso se guarda como instantánea para la revelación + el renderizado.
		base.committed = qd.committedAnswer;
	}
	return base;
}

/**
 * El registro de respuesta VISIBLE PARA EL MODELO (responsable, dieta de resultados
 * de herramientas 2026-10-02): la llamada a la herramienta ya lleva todo lo que
 * escribió el propio modelo — la pregunta, cada opción, la respuesta correcta, la
 * explicación, el compromiso de explain —, así que el resultado devuelve SOLO lo que
 * añadió el alumno: su selección o sus palabras, el veredicto de la corrección, su
 * confianza declarada y su nota. El QuestionAnswerData corregido completo viaja en
 * `details` para el registro y la interfaz; este es el JSON que lee de verdad el
 * agente.
 */
/** El registro de descarte (abortar con ESC una pregunta pendiente, responsable
 * 2026-10-02): la respuesta honesta mínima. El modelo ve {kind, dismissed:true} a
 * través de compactAnswerForModel; la tarjeta de respuesta renderiza el texto de la
 * pregunta + "skipped". Usa la misma ruta que las respuestas — el profesor reconoce
 * el salto en su siguiente turno, exactamente igual que cualquier respuesta. */
export function dismissedAnswer(kind: QuestionKind, questionText: string): QuestionAnswerData {
	return {
		kind,
		questionText,
		dontKnow: false,
		answers: [],
		dismissed: true,
		answeredAt: new Date().toISOString(),
	};
}

export function compactAnswerForModel(ad: QuestionAnswerData): Record<string, unknown> {
	if (ad.dismissed) return { kind: ad.kind, dismissed: true };
	const out: Record<string, unknown> = { kind: ad.kind };
	if (ad.dontKnow) out.dontKnow = true;
	// Array.isArray: a la frontera se la llama con respuestas `unknown` (fixtures de
	// pruebas, registros ajenos) — se degrada a omisión, nunca falla.
	if (Array.isArray(ad.answers) && ad.answers.length > 0)
		out.answers = ad.answers.map((a) => ({ index: a.index, label: a.label }));
	if (ad.text) out.text = expandCitationsForModel(ad.text);
	if (ad.other) out.other = expandCitationsForModel(ad.other);
	// El veredicto + la confianza declarada son el RENDIMIENTO del alumno — información
	// nueva que el modelo necesita para su siguiente paso. (dontKnow implica
	// incorrecto y no lleva confianza: ambas cosas quedan implícitas.)
	if (ad.correct !== undefined && !ad.dontKnow) out.correct = ad.correct;
	if (ad.confidence !== undefined) out.confidence = ad.confidence;
	// Dos canales de razonamiento DISTINTOS, con claves claras para que el modelo nunca
	// los confunda (responsable 2026-10-03): el razonamiento sobre la pregunta frente al
	// razonamiento durante la lectura de la enseñanza. `note` es la clave anterior al
	// cambio de nombre — los registros antiguos también pasan por aquí, así que ambas alimentan `thinking`.
	const thinking = ad.thinking ?? ad.note;
	if (thinking) out.thinking = expandCitationsForModel(thinking);
	if (ad.readingThinking) out.thinkingWhileReading = expandCitationsForModel(ad.readingThinking);
	return out;
}
