import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, questionResult, serverExecute } from "./tool-execute.ts";
import {
	askInputSchema,
	askOptionProblems,
	explainInputBase,
	explainInputObject,
	explainInputProblems,
	parseOptionsIfString,
	probeQuizInputSchema,
	quizInputObject,
	quizInputProblems,
} from "../core/question-core.ts";
import { filterEnabledTools, type EnabledTools } from "../core/pending.ts";
import type { JobRecord } from "../core/contracts.ts";
import type { JobStore } from "../core/ports.ts";
import { jobTools, type DemoInput, type PdfInput, type ResearchInput, type VisualInput } from "./tools/jobs.ts";
import { planTools, type PlanToolContext } from "./tools/plan.ts";
import { probeDoneTool, type ProbeDoneContext } from "./tools/probe.ts";
import { proberGraphTools } from "./tools/graph.ts";
import { readTool } from "./tools/read.ts";
import { lsTool } from "./tools/ls.ts";
import { findTool } from "./tools/find.ts";
import { grepTool } from "./tools/grep.ts";
import { createShowImageTool } from "./tools/show-image.ts";
import { healToolRecord } from "./tools/heal.ts";
import type { GraphStore } from "../core/ports.ts";

export { jobTools };
export type { ProbeDoneContext } from "./tools/probe.ts";

/**
 * La composición de herramientas por agente (docs/archive/probe-teach-split.md §1): el
 * SONDEADOR y el PROFESOR son agentes distintos con conjuntos de herramientas distintos.
 * Las herramientas de preguntas comparten NOMBRE pero son herramientas realmente DISTINTAS:
 * el quiz del sondeador NO tiene campo nodeId en absoluto (su declaración se construye
 * a partir de quizInputBase; el esquema del modelo nunca menciona nodeId), y el del
 * profesor lleva el campo de posición validado.
 *
 * - Herramientas de preguntas (quiz / ask_user_question): RESPONDIDAS POR EL CLIENTE. Su
 *   execute valida los refinamientos de autoría (las reglas entre campos que ningún
 *   esquema expresa: quizInputProblems / askOptionProblems; un fallo
 *   lanza ToolInputError, que el bucle de pi convierte en un resultado de herramienta de error
 *   sobre el que el modelo reintenta) y después devuelve el marcador provisional sintético
 *   "question posed" (questionResult: terminate: true; el
 *   turno termina; la llamada llega por streaming al navegador en estado `input-available`;
 *   el alumno responde en el dock; el cliente corrige y envía
 *   el veredicto con addToolOutput). Los esquemas de entrada viven en
 *   core/question-core. Las herramientas de preguntas optan por la ejecución SECUENCIAL para que
 *   las llamadas paralelas se resuelvan en el orden de llamada del modelo (el sujeto del dock
 *   nunca puede cambiar a mitad de turno).
 * - probe_done (src/agent/tools/probe.ts): herramienta de frontera DEL LADO DEL SERVIDOR.
 * - planTools (src/agent/tools/plan.ts): DEL LADO DEL SERVIDOR; plan_init de autoría
 *   única. Solo el profesor.
 * - jobTools (src/agent/tools/jobs.ts): despacho EJECUTADO EN EL SERVIDOR. Solo el
 *   profesor.
 */

/** Guarda contra el titubeo de GLM (aprobada por el responsable, 2026-09-26): los modelos a veces emiten
 *  `options` como string codificado en JSON en lugar de un array; pi ejecuta esto
 *  ANTES de la validación del esquema, así que una llamada doblemente codificada llega en lugar de
 *  rebotar como error de validación + turno de reintento desperdiciado. NOTA: pi
 *  persiste la llamada a la herramienta con sus argumentos CRUDOS: el cliente vuelve a convertir
 *  en normalizeOptions (question-core), con el mismo parseOptionsIfString.
 *  Lo que no se pueda parsear pasa sin tocar: la validación informa entonces
 *  con honestidad y el agente reintenta con un error real del que aprender. */
function prepareQuestionArguments<T extends object>(args: unknown): T {
	if (args && typeof args === "object" && !Array.isArray(args)) {
		const o = args as { options?: unknown };
		if (typeof o.options === "string") {
			const parsed = parseOptionsIfString(o.options);
			if (parsed !== o.options) return { ...o, options: parsed } as T;
		}
		return o as T;
	}
	return args as T;
}

export const askUserQuestionTool: AgentTool<typeof askInputSchema> = {
	name: "ask_user_question",
	label: "ask_user_question",
	description:
		"Ask the learner a single question and pause until they answer. NOT graded — there is no correct answer. " +
		"Use when requirements are ambiguous, preferences are needed, a decision would materially affect the lesson, " +
		"or you need an open-ended response. ONE question per turn: call a single ask_user_question, then end your " +
		"turn — his answer determines the next.",
	parameters: askInputSchema,
	prepareArguments: prepareQuestionArguments,
	executionMode: "sequential",
	execute: async (_toolCallId, input) => {
		const problems = askOptionProblems(input.options ?? []);
		if (problems.length > 0) return invalidInputResult("ask_user_question", problems);
		return questionResult();
	},
};

// ─── las herramientas de preguntas ───────────────────────────────────────────────
//
// SOLO DESCRIPCIONES MECÁNICAS (responsable 2026-10-03): la descripción de una herramienta
// dice lo que la herramienta HACE y cómo funcionan sus campos, nada sobre cómo
// deben SER las preguntas. El oficio (construcción de opciones, corrección del
// recuerdo libre, roles de las preguntas) vive en el prompt de sistema: un fragmento
// de fuente única que componen ambos agentes (prompts/shared/20-question-tools.md y los
// fragmentos de preguntas del profesor), revirtiendo la ubicación del 2026-09-27 ahora
// que la familia de preguntas ha crecido (roles predict/check, futuras
// variantes de quiz): los duplicados se mantienen honestos compartiendo ÁTOMOS DE ESQUEMA
// (question-core) + FRAGMENTOS DE PROMPT, y cada herramienta declara solo su
// diferencia mecánica.
//
// UNA excepción autorizada (responsable, 2026-10-12): la descripción de cada herramienta de quiz
// termina con un ejemplo de llamada COMPLETO: compacto, correcto para la fase
// (probe no lleva metadatos de fase; quiz empieza con type+nodeId), que sirve también
// de ejemplo de escape en JSON (las barras invertidas de LaTeX se duplican dentro de los strings
// JSON). Decisión de ubicación: CON LA HERRAMIENTA, junto a su esquema exacto; un
// ejemplo en el prompt compartido es ambiguo respecto a la fase (los modelos fallaban justo en
// estos campos de metadatos) y las copias por agente divergirían. Serializado
// a partir de UN cuerpo canónico para que las variantes no puedan discrepar; la doctrina del oficio
// se queda en los prompts.

/** El cuerpo canónico del ejemplo (contenido aprobado por el responsable, 2026-10-12): una
 *  pregunta aplicada compacta cuyos campos ejercitan los riesgos de escape
 *  (comandos con llaves como \frac y \cos, matemáticas en línea y en bloque, saltos de línea)
 *  y que sirve también de ejemplo de buen oficio: opciones uniformes, valores
 *  estables, razonamiento (explanation) comprometido antes de correctAnswer.
 *  JSON.stringify genera el texto que viaja, así que el escape que ve el modelo
 *  es por construcción el correcto. Exportado para fijar las descripciones en las pruebas. */
export const quizExampleBody = {
	question: "A signal is $y=\\sin(2x)$ and $\\frac{dx}{dt}=3$. What is $\\frac{dy}{dt}$?",
	options: [
		{ label: "$6\\cos(2x)$", value: "a" },
		{ label: "$2\\cos(2x)$", value: "b" },
		{ label: "$3\\cos(2x)$", value: "c" },
	],
	explanation:
		"The phase changes twice as fast as $x$; multiply by the sine's slope:\n$$\n\\frac{dy}{dt}=\\cos(2x)\\cdot2\\cdot3=6\\cos(2x)\n$$",
	correctAnswer: "a",
};

/** La mecánica de quiz que comparten todas las variantes; `delta` añade los campos
 *  propios de la variante (entre ellos su NOMBRE: las herramientas de la fase de sondeo se
 *  refieren a sí mismas como probe/recall, responsable 2026-10-09). Toda mecánica, cero doctrina,
 *  más el único ejemplo autorizado (arriba). */
function quizDescription(delta: { name: "quiz" | "probe"; nodeId: boolean; types: boolean }): string {
	const base =
		"Ask the learner a GRADED question with a known correct answer, then instantly grade and give feedback. " +
		"Unlike ask_user_question (which collects preferences/decisions with no right answer), " +
		delta.name +
		" always has a " +
		"correct answer supplied by you, marks the learner's selection right/wrong, reveals the correct answer, and " +
		"can show an explanation. Options-only: single-select or multi-select, plus an automatic 'I don't know' " +
		"choice so the learner can signal a genuine gap instead of guessing. An always-present optional thinking " +
		"field lets the learner attach his reasoning to ANY answer; it reaches you only when non-empty. " +
		"No free-text answers — for non-graded questions use ask_user_question instead. " +
		(delta.types
			? "Every call declares `type` — the question's role in the teaching cycle; the field's own description says when each kind fires. "
			: "") +
		(delta.nodeId
			? "Set `nodeId` (required) to the plan node this question is about — validated at call time against the session's plan map. For off-map checks use ask_user_question. "
			: "") +
		"ONE question per turn: call a single " +
		delta.name +
		", then end your turn — his answer determines the next.";
	// Forma correcta para la fase: el ejemplo de enseñanza EMPIEZA con el par obligatorio
	// (type, nodeId: la decisión de orden de descarte del 2026-10-09); el ejemplo de sondeo
	// no lleva ningún metadato de fase, exactamente igual que el esquema de sondeo.
	const example = delta.nodeId ? { type: "check" as const, nodeId: "chain-rule", ...quizExampleBody } : quizExampleBody;
	return (
		base +
		"\nExample arguments — copy the escaping exactly: inside JSON strings a LaTeX backslash is \\\\ and a newline is \\n.\n```json\n" +
		JSON.stringify(example, null, 2) +
		"\n```" +
		(delta.nodeId ? " The example's nodeId is illustrative — copy an exact id from this session's plan_init." : "")
	);
}

/** La mecánica de explain (quiz de recuerdo libre): la regla de compromiso es
 *  el CONTRATO DE CORRECCIÓN: mecánica, no doctrina. La doctrina más blanda
 *  (lectura de casi aciertos, lagunas reales) vive en el fragmento de prompt compartido.
 *  `name`: la herramienta de enseñanza se refiere a sí misma como explain, y la variante de sondeo
 *  como recall (responsable 2026-10-09). */
function explainDescription(name: "explain" | "recall", nodeId: boolean): string {
	return (
		"Ask the learner to EXPLAIN something in his own words — a graded check with NO options: he types a free-text " +
		"answer. Unlike ask_user_question (no right answer), " +
		name +
		" always has one. THE COMMITMENT RULE: " +
		"correctAnswer is the FULL correct answer in your own words, reasoning included, COMMITTED before he ever " +
		"sees the question. When his answer returns, grade it strictly against the commitment — never revise it " +
		"after seeing his words. He sees the committed answer on submit. " +
		(nodeId
			? "Set `nodeId` (required) to the plan node this question is about — validated at call time against the session's plan map. "
			: "") +
		"ONE question per turn: call a single " + name + ", then end your turn — his answer determines the next."
	);
}

/** La herramienta de quiz de opción múltiple del sondeador: se llama `probe`, no
 *  `quiz` (responsable, 2026-10-09): los esquemas de sondeo y de enseñanza difieren
 *  (ni `type` ni `nodeId` existen durante el sondeo), y un nombre compartido
 *  invitaba al modelo a llevar la forma de llamada de la fase de sondeo a la enseñanza:
 *  el primer quiz de enseñanza tras plan_init omitió `nodeId` justo por
 *  esa costumbre (el incidente tools_fails_2). Los nombres distintos hacen visible el
 *  límite de fase en el propio transcript: el historial escrito por
 *  `probe` nunca miente sobre lo que exige `quiz`. */
export const probeQuizTool: AgentTool<typeof probeQuizInputSchema> = {
	name: "probe",
	label: "probe",
	description: quizDescription({ name: "probe", nodeId: false, types: false }),
	parameters: probeQuizInputSchema,
	prepareArguments: prepareQuestionArguments,
	executionMode: "sequential",
	execute: async (_toolCallId, input) => {
		const problems = quizInputProblems(input);
		if (problems.length > 0) return invalidInputResult("probe", problems);
		return questionResult();
	},
};

/** La variante de recuerdo libre del profesor (con nodeId validado, misma frontera que el
 *  quiz de enseñanza: phases/plan reconocen AMBOS nombres de herramienta). */
export function teachExplainToolFor(
	ctx: Pick<PlanToolContext, "chatId" | "chatStore">,
): AgentTool<typeof explainInputObject> {
	return {
		name: "explain",
		label: "explain",
		description: explainDescription("explain", true),
		parameters: explainInputObject,
		prepareArguments: prepareQuestionArguments,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = [...explainInputProblems(input)];
			const nodeIdProblemText = nodeIdProblem(ctx, input.nodeId);
			if (nodeIdProblemText) problems.push(nodeIdProblemText);
			if (problems.length > 0) return invalidInputResult("explain", problems);
			return questionResult();
		},
	};
}

/** La variante de recuerdo libre del sondeador (sin nodeId: el mismo patrón que el
 *  quiz de sondeo). */
/** La variante de recuerdo libre del sondeador: se llama `recall`, no `explain`
 *  (responsable, 2026-10-09), por el mismo motivo de límite de fase que `probe`:
 *  el explain de enseñanza añade `type` y `nodeId`; un nombre compartido llevaba la
 *  forma de llamada del sondeo a la enseñanza. Los registros antiguos de la fase de sondeo conservan el
 *  nombre `explain` y se parsean igual (la frontera de visualización acepta
 *  ambos). */
export const probeExplainTool: AgentTool<typeof explainInputBase> = {
	name: "recall",
	label: "recall",
	description: explainDescription("recall", false),
	parameters: explainInputBase,
	prepareArguments: prepareQuestionArguments,
	executionMode: "sequential",
	execute: async (_toolCallId, input) => {
		const problems = explainInputProblems(input);
		if (problems.length > 0) return invalidInputResult("recall", problems);
		return questionResult();
	},
};

/** El contexto del registro del sondeador: las necesidades propias del sondeo (probe_done:
 *  ProbeDoneContext) MÁS la conexión del despacho de tareas, ya que la decisión del responsable
 *  (2026-09-20) pone también research + pdf en el registro de la fase de sondeo. */
export interface ProberToolContext extends ProbeDoneContext {
	/** Crea el registro de la tarea (sin duplicados por toolCallId). */
	jobStore: JobStore;
	/** Lanza el ejecutor en segundo plano para una tarea recién creada. */
	spawn: (job: JobRecord, input: ResearchInput | DemoInput | VisualInput | PdfInput) => void;
	/** Frontera de estado de búsqueda que se conserva; el despacho de research está disponible sin clave. */
	searchAvailable?: () => boolean;
	/** El lector del mapa del grafo del sondeador (oleada 7): presente = las dos herramientas de mapa
	 *  (list_sessions / list_propositions) están registradas. La raíz de composición
	 *  lo pasa solo cuando graphToolsEnabled(effective): el interruptor general del grafo
	 *  Y el interruptor agent.graphTools (settings-resolution).
	 *  Ausente = la barrera está cerrada, sin herramientas de mapa (las pruebas conducen esta frontera). */
	graphStore?: GraphStore;
}

/** El conjunto de herramientas del sondeador: quiz de sondeo (sin nodeId) + ask + el conjunto
 *  learner-fs + probe_done + las dos herramientas de despacho de tareas presentes en todas las fases +
 *  (oleada 7, con barrera) el lector del mapa del grafo. `enabled` es la frontera de ajustes
 *  resuelta (core/pending.ts): toda herramienta explícitamente false se elimina
 *  del registro. probe_done sigue siempre activa pase lo que pase: es como
 *  TERMINA la fase; un sondeador que nunca puede concluir es un bloqueo. */
export function createProberTools(
	ctx: ProberToolContext,
	enabled?: EnabledTools,
): Record<string, AgentTool<any>> {
	// probe_done se vuelve a añadir DESPUÉS del filtro, siempre activa por construcción: es
	// como TERMINA la fase; un sondeador que nunca puede concluir es un bloqueo.
	const done = probeDoneTool(ctx);
	// Las herramientas de tareas se construyen sobre el MISMO contexto/barreras que las del profesor
	// (un constructor, una semántica de barreras); el sondeador lleva un SUBCONJUNTO:
	const jobs = jobTools({
		chatId: ctx.chatId,
		jobStore: ctx.jobStore,
		spawn: ctx.spawn,
		searchAvailable: ctx.searchAvailable,
	});
	// Mecánica de quiz (responsable 2026-09-27): el recuerdo libre cambia el quiz de sondeo
	// por el explain de sondeo: una herramienta de quiz cada vez, la que
	// activen los ajustes. ask sigue siempre activa. Las claves del registro son los nombres
	// de FASE (probe/recall, responsable 2026-10-09), distintos de las herramientas de
	// enseñanza para que el límite del esquema sea visible para el modelo.
	const mechanics = quizMechanics(enabled);
	// La herramienta de quiz activada, ensanchada al registro heterogéneo de
	// AgentTool ANTES del filtro (un spread condicional de dos literales con tipos
	// distintos convierte el tipo de todo el objeto en una unión,
	// inservible como Record<string, AgentTool<any>> más adelante).
	const quizzing: Record<string, AgentTool<any>> =
		mechanics === "free" ? { recall: probeExplainTool } : { probe: probeQuizTool };
	// healToolRecord (responsable, 2026-10-09: la generalización de whitehead):
	// la reparación estándar de argumentos sobre TODO el registro: cada herramienta,
	// no solo aquella en la que cayó el último incidente de titubeo.
	return healToolRecord({
		...filterEnabledTools(
			{
				...quizzing,
				ask_user_question: askUserQuestionTool,
				// El conjunto del sistema de ficheros del alumno está siempre activo (decidido por el usuario 2026-09,
				// sources v1): el sondeador inspecciona y LOCALIZA los ficheros que menciona el alumno
				// mientras evalúa el borde. Solo lectura por construcción.
				read: readTool,
				ls: lsTool,
				find: findTool,
				grep: grepTool,
				// Despacho de tareas en la fase de sondeo (decisión del responsable, 2026-09-20):
				// research + pdf están SIEMPRE disponibles en todas las fases: el
				// sondeador puede verificar hechos o leer PDF del alumno mientras evalúa.
				// demo/visual siguen siendo solo de la fase de enseñanza (necesitan el contexto
				// del plan de la lección). El mismo filtrado por interruptores del usuario que el profesor; research
				// sigue disponible sin clave de proveedor de búsqueda.
				...(jobs.research ? { research: jobs.research } : {}),
				pdf: jobs.pdf!,
				// El lector del mapa (oleada 7): presente solo cuando la barrera de ajustes
				// se abrió.
				...(ctx.graphStore
					? proberGraphTools({ chatStore: ctx.chatStore, graphStore: ctx.graphStore })
					: {}),
				...done,
			},
				withoutMechanics(enabled),
			),
			...done,
		});
}

// ─── las herramientas de preguntas del profesor (quiz lleva el campo de posición) ─

/** La comprobación de nodeId contra el árbol vivo que el quiz del profesor encadena tras el
 *  contrato de autoría compartido (el antiguo superRefine, literal). */
function nodeIdProblem(ctx: Pick<PlanToolContext, "chatId" | "chatStore">, nodeId: string): string | null {
	const record = ctx.chatStore.getChat(ctx.chatId);
	const known = record?.tree?.nodes.map((n) => n.id) ?? [];
	if (!known.includes(nodeId)) {
		return (
			`nodeId "${nodeId}" matches no node in this session's plan map. ` +
			(known.length > 0
				? `Copy one of your plan_init slugs exactly (${known.slice(0, 5).join(", ")}${known.length > 5 ? ", …" : ""}).`
				: "No plan map exists yet — call plan_init before posing quizzes.")
		);
	}
	return null;
}

/** Construye la herramienta quiz del lado de la enseñanza para una petición (exportada para las pruebas): el contrato de autoría
 *  + la validación del nodeId del plan por sesión (ambos se ejecutan en execute; el
 *  contrato de corrección queda intacto). Lee el registro VIVO del chat, así que las reescrituras
 *  a mitad de turno se respetan, y sin árbol todavía se rechaza cualquier nodeId.
 *  nodeId es OBLIGATORIO (decisión del responsable 2026-09-26): el quiz improvisado sin etiqueta ha
 *  desaparecido; las comprobaciones fuera del mapa van por ask_user_question, y la frontera
 *  de enseñanza (el primer quiz etiquetado) está garantizada estructuralmente. */
export function teachQuizToolFor(ctx: Pick<PlanToolContext, "chatId" | "chatStore">): AgentTool<typeof quizInputObject> {
	return {
		name: "quiz",
		label: "quiz",
		description: quizDescription({ name: "quiz", nodeId: true, types: true }),
		parameters: quizInputObject,
		prepareArguments: prepareQuestionArguments,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = [...quizInputProblems(input)];
			const nodeIdProblemText = nodeIdProblem(ctx, input.nodeId);
			if (nodeIdProblemText) problems.push(nodeIdProblemText);
			if (problems.length > 0) return invalidInputResult("quiz", problems);
			return questionResult();
		},
	};
}

export interface TeacherToolContext extends PlanToolContext {
	/** Conexión de las herramientas de tareas (despacho a subagentes): el almacén de tareas + la
	 *  frontera de lanzamiento del ejecutor. La raíz de composición inyecta ambos. */
	jobStore: JobStore;
	/** Lanza el ejecutor en segundo plano para una tarea recién creada. La entrada de la herramienta
	 *  va con ella: el lanzamiento se dispara a mitad de stream, antes de que la parte de herramienta se
	 *  persista en el transcript (un recorrido del transcript competiría con él). */
	spawn: (job: JobRecord, input: ResearchInput | DemoInput | VisualInput | PdfInput) => void;
	/** Frontera de estado de búsqueda que se conserva; el despacho de research está disponible sin clave. */
	searchAvailable?: () => boolean;
}

/**
 * Registro de herramientas del profesor por petición: preguntas de enseñanza (nodeId validado) +
 * herramientas de plan + herramientas de tareas, todas cerradas sobre el ctx.
 *
 * `enabled` es la frontera de ajustes resuelta (EnabledTools de core/pending.ts: la
 * conexión del chat-handler de Platform lo pasa desde los ajustes). Hoy
 * solo las herramientas de subagentes (research/demo/visual) son activables por el usuario, pero
 * el filtrado es GENÉRICO: todo nombre explícitamente false se elimina, así que
 * futuras herramientas activables (variantes de herramientas de preguntas, …) no necesitan cambios aquí.
 * Ausente/undefined = activada: las pruebas y los registros antiguos ven el conjunto actual.
 */
/** La mecánica de quiz (responsable 2026-09-27): `tools.explain === true` en
 *  los ajustes resueltos ⇒ comprobaciones de recuerdo libre (explain activado, quiz eliminado);
 *  cualquier otra cosa ⇒ opción múltiple, exactamente el conjunto actual. Gestionado por la
 *  mecánica, NO activable individualmente: quiz/explain nunca pasan por
 *  filterEnabledTools (la decisión del bloqueo del 2026-09-19 sigue en pie: un sondeador
 *  sin quiz hunde su flujo de evaluación). */
export function quizMechanics(enabled?: EnabledTools): "choice" | "free" {
	return enabled?.explain === true ? "free" : "choice";
}

/** Quita las claves de mecánica para que filterEnabledTools nunca pueda eliminar las
 *  herramientas de quiz (la derivación de arriba es su único interruptor). */
function withoutMechanics(enabled?: EnabledTools): EnabledTools | undefined {
	if (!enabled) return undefined;
	const { explain: _e, quiz: _q, ...rest } = enabled;
	return rest;
}

export function createTeacherTools(
	ctx: TeacherToolContext,
	enabled?: EnabledTools,
): Record<string, AgentTool<any>> {
	// Mecánica de quiz (responsable 2026-09-27): el recuerdo libre cambia el quiz
	// de enseñanza por el explain de enseñanza: una herramienta de quiz cada vez, la que
	// activen los ajustes. ask sigue siempre activa.
	const mechanics = quizMechanics(enabled);
	// El mismo ensanchamiento que en el del sondeador (ver arriba): el spread condicional de
	// dos literales con tipos distintos se colapsa en un tipo unión inservible.
	const quizzing: Record<string, AgentTool<any>> =
		mechanics === "free" ? { explain: teachExplainToolFor(ctx) } : { quiz: teachQuizToolFor(ctx) };
	// healToolRecord: el mismo estándar que el registro del sondeador (arriba).
	return healToolRecord(
		filterEnabledTools(
			{
			...quizzing,
			ask_user_question: askUserQuestionTool,
			// El conjunto del sistema de ficheros del alumno está siempre activo (decidido por el usuario 2026-09,
			// sources v1): el profesor localiza y lee los ficheros que menciona el alumno
			// en sus propios términos; nada se inyecta automáticamente. Solo lectura por
			// construcción (fs-shared.ts).
			read: readTool,
			ls: lsTool,
			find: findTool,
			grep: grepTool,
			// El gemelo de read para mostrar imágenes del alumno (issue #363): solo el profesor,
			// siempre activo; muestra al alumno su propio fichero.
			show_image: createShowImageTool(ctx),
			...planTools(ctx),
			...jobTools({ chatId: ctx.chatId, jobStore: ctx.jobStore, spawn: ctx.spawn, searchAvailable: ctx.searchAvailable }),
		},
		withoutMechanics(enabled),
		),
	);
}
