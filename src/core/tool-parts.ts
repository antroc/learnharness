/**
 * La frontera de análisis de la interfaz — analiza, no fuerces el tipo (la regla
 * nacida de los fallos en vivo del 2026-09-12).
 *
 * POR QUÉ EXISTE. La validación SÍ va primero en la frontera de cara al modelo — pi
 * valida los argumentos contra el esquema TypeBox de la herramienta antes de
 * execute, y los refinamientos de autoría se ejecutan en la frontera de execute; un
 * fallo vuelve al modelo como un resultado de herramienta con error, en el mismo
 * turno. Pero los mismos bytes tienen otros dos consumidores, y en ellos existen SIN
 * VALIDAR POR DISEÑO:
 *
 *   - la red en vivo transmite los deltas en bruto de la entrada de la herramienta
 *     mientras el modelo aún está escribiendo la llamada (la validación no puede
 *     ejecutarse antes de que la llamada esté completa);
 *   - la transcripción conserva también la entrada en bruto de las llamadas
 *     RECHAZADAS (honestidad de la transcripción + el invariante de reproducción:
 *     todo toolCall va seguido de un resultado).
 *
 * Así que la entrada no válida siempre es observable, y los ESTADOS de las partes
 * llevan el veredicto (input-streaming = parcial, input-available = validada,
 * output-error = basura). El defecto que hizo posibles los fallos: los consumidores
 * se fiaban de esas formas mediante FORZADOS de tipo de TypeScript — `part.input as
 * X` es una mentira en tiempo de compilación que el comprobador se cree, sin ninguna
 * comprobación en tiempo de ejecución detrás.
 *
 * LA REGLA (mecánica, no de vigilancia): la ENTRADA escrita por el modelo solo se
 * consume a través de estos analizadores, cada uno con el MISMO esquema TypeBox al
 * que se enfrentó el modelo — válida en la frontera ⇔ analizable por el consumidor,
 * estructuralmente. La SALIDA escrita por el servidor y por el alumno sigue siendo de
 * confianza (la escribe nuestro propio código: los acuses de execute, el buildAnswer
 * del alumno). Un fallo de análisis renderiza la alternativa discreta, nunca un fallo.
 */

import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { quizDisplayInputSchema, askInputSchema, askOptionProblems, quizInputProblems, explainInputProblems, explainDisplayInputSchema, type AskToolInput, type QuizToolInput, type ExplainToolInput } from "./question-core.ts";
import { healEncodedArguments } from "./argument-heal.ts";
import { probeDoneInputSchema, type ProbeDoneInput } from "./contracts/probe.ts";
import { readPluginQuestionSnapshot, type PluginQuestionSnapshot } from "./plugin-questions.ts";

/** Los metadatos de la vista, no los argumentos del modelo, mandan sobre el rol y la posición de las preguntas de plugins. */
export function posedPluginQuestionOfPart(part: { pluginQuestion?: unknown }): PluginQuestionSnapshot | undefined {
	const annotation = part.pluginQuestion;
	if (!annotation || typeof annotation !== "object" || (annotation as { status?: unknown }).status !== "posed") return undefined;
	return readPluginQuestionSnapshot((annotation as { snapshot?: unknown }).snapshot) ?? undefined;
}

/** El paso de análisis de la frontera de pi, reflejado aquí (corrección de la prueba
 * de humo en vivo, 2026-09-26): validateToolArguments de pi-ai ejecuta Value.Convert de
 * TypeBox sobre los argumentos en bruto del modelo antes de Value.Check — un
 * correctAnswer enviado como el NÚMERO 17 (lo que emitió de verdad el modelo de la
 * prueba de humo) se convierte en "17" en la frontera, así que la herramienta plantea
 * el quiz sin problemas. Pero el registro persistido conserva los argumentos EN BRUTO,
 * así que una frontera de análisis que se saltara Convert rechazaría justo la entrada
 * que aceptó la frontera — un quiz pendiente invisible y un alumno bloqueado. Todo
 * análisis de visualización convierte primero, exactamente como la frontera; Convert
 * muta, así que la entrada se clona antes de tocarla. */
function boundaryParse<T>(schema: TSchema, input: unknown): T | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const converted = structuredClone(input);
	Value.Convert(schema, converted);
	if (!Value.Check(schema, converted)) return undefined;
	return Value.Clean(schema, converted) as T;
}

/**
 * Análisis del quiz para VISUALIZACIÓN: la base de autoría compartida, antes de los
 * refinamientos. Ambas fronteras (el quizInputBase del sondeador y el
 * quizInputObject del profesor sobre la base + nodeId opcional) comparten LOS MISMOS
 * campos de quizInputBase, así que todo lo que pasó cualquiera de las dos se analiza
 * aquí; el `nodeId` exclusivo del profesor es una clave desconocida que Value.Clean
 * elimina (el antiguo comportamiento de strip de zod, conservado para que la forma de
 * visualización siga siendo exactamente la que el dock vio siempre). Este es a
 * propósito el núcleo común INDULGENTE — las comprobaciones de autoría estrictas por
 * agente son trabajo de la frontera —, pero ejecuta el refinamiento de corrección
 * compartido (quizInputProblems) después de Convert, reflejando la cadena completa de
 * la frontera: pi acepta `correctAnswer: 17` estructuralmente (Convert → "17") y es el
 * refinamiento de execute el que la convierte en una llamada planteada o rechazada. El
 * análisis de visualización sigue el mismo orden para que una entrada que nunca podría
 * haberse planteado (p. ej. `correctAnswer: undefined`, que Convert amplía a "") se
 * renderice como una alternativa discreta, no como un quiz roto.
 */
/** El análisis de la forma nunca repara el texto escrito. El dock construye los datos
 * de su respuesta a partir de esta copia fuente; la recuperación pertenece en
 * exclusiva a la presentación (ToolContentResponse), nunca a las identidades de las
 * opciones, la corrección ni las instantáneas. */
export function parseQuizInput(input: unknown): QuizToolInput | undefined {
	// quizDisplayInputSchema (question-core, responsable 2026-10-03): base + el `type`
	// OPCIONAL — los registros nuevos de la fase de enseñanza llevan predict|check y el
	// dock renderiza y aplica la barrera según él (normalizeQuizType en la frontera de
	// lectura); los registros antiguos y los de sondeo no lo llevan. nodeId sigue siendo
	// una clave desconocida que Value.Clean elimina, exactamente como antes.
	// El reflejo en la visualización de la reparación de la frontera (whitehead,
	// 2026-10-09): el registro conserva los argumentos EN BRUTO, así que el titubeo
	// registrado `type: "\"predict\""` debe repararse TAMBIÉN aquí o un quiz planteado se
	// renderiza invisible (la ley de tool-parts). healEncodedArguments es la misma pasada
	// pura que ejecuta withArgumentHeal en la frontera.
	const healedInput = healEncodedArguments(input, quizDisplayInputSchema);
	const cleaned = boundaryParse<QuizToolInput>(quizDisplayInputSchema, healedInput);
	if (!cleaned) return undefined;
	if (quizInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

/**
 * Análisis de ask para VISUALIZACIÓN: el esquema completo de ask (opciones
 * opcionales — el modo de texto libre es la forma sin opciones), más el refinamiento
 * de comprobación de opciones que aplicaba la frontera (askOptionProblems — los
 * valores duplicados rompen la indexación del dock, así que se analizan como
 * undefined, exactamente como hacía la frontera de zod).
 */
export function parseAskInput(input: unknown): AskToolInput | undefined {
	const cleaned = boundaryParse<AskToolInput>(askInputSchema, healEncodedArguments(input, askInputSchema));
	if (!cleaned) return undefined;
	if (askOptionProblems(cleaned.options ?? []).length > 0) return undefined;
	return cleaned;
}

/** Análisis de explain para VISUALIZACIÓN: el esquema de visualización (base + `type`
 * OPCIONAL e indulgente, exactamente el patrón del quiz — las llamadas a explain de la
 * enseñanza llevan el rol desde el 2026-10-09; el refinamiento del compromiso
 * (explainInputProblems) refleja la cadena de la frontera). Las dos variantes de
 * explain comparten los mismos campos; el nodeId del profesor es una clave
 * desconocida que Value.Clean elimina, igual que en la frontera del quiz. */
export function parseExplainInput(input: unknown): ExplainToolInput | undefined {
	const cleaned = boundaryParse<ExplainToolInput>(explainDisplayInputSchema, healEncodedArguments(input, explainDisplayInputSchema));
	if (!cleaned) return undefined;
	if (explainInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

/** Una única decisión de validez de visualización para la autoridad del dock y la
 * recuperación. No muta la entrada registrada ni se inventa campos de autoría que faltan. */
export function parseQuestionInput(tool: string, input: unknown): QuizToolInput | AskToolInput | ExplainToolInput | undefined {
	switch (tool) {
		case "quiz": case "probe": return parseQuizInput(input);
		case "explain": case "recall": return parseExplainInput(input);
		case "ask_user_question": return parseAskInput(input);
		default: return undefined;
	}
}

/** Análisis de probe_done — el esquema propiedad del núcleo que declara la propia herramienta. */
export function parseProbeDoneInput(input: unknown): ProbeDoneInput | undefined {
	return boundaryParse<ProbeDoneInput>(probeDoneInputSchema, input);
}