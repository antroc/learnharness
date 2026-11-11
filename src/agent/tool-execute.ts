import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { CONCLUDE_ACK_TEXT } from "../core/contracts/chat.ts";

/**
 * tool-execute: la maquinaria de ejecución que comparten todas las herramientas lh del lado del servidor,
 * expresada de forma nativa (Oleada A de la migración nativa a pi, 2026-09-26): las herramientas
 * se escriben como AgentTools de pi-agent-core (parámetros TypeBox, execute
 * nativo), y este módulo es dueño de la semántica que el antiguo envoltorio LhTool
 * (lh-tool.ts, eliminado) añadía alrededor de cada execute:
 *
 * - el tiempo límite por llamada a nivel de sistema + la cascada de abortos (runWithAbortGuard),
 * - la forma del fallo de refinamiento de autoría (invalidInputResult:
 *   devuelto desde execute como resultado isError; la convención de pi 1.0, el
 *   modelo ve la misma lista de problemas reintentables de siempre y
 *   `details` conserva los problemas como datos),
 * - la correspondencia de resultados (string tal cual / objeto en JSON / resultados de imagen a
 *   partes de contenido nativas; details lleva el valor de cara al registro),
 * - el marcador provisional de las herramientas de preguntas (quiz / ask_user_question): un resultado
 *   sintético "question posed" que NUNCA se persiste: el registro mantiene la
 *   parte de herramienta sin salida hasta que el cliente responde; la respuesta del alumno
 *   vuelve a entrar en el siguiente turno como el resultado de esta llamada. terminate: true (opción A
 *   del responsable, 2026-09-25) termina de forma nativa los lotes de una sola pregunta; el ligero
 *   detenedor shouldStopAfterTurn (teacher-agent.ts) mantiene la regla de cinturón y
 *   tirantes para los lotes mixtos.
 *
 * La validación estructural NO está aquí: el bucle de pi valida los argumentos contra
 * los parámetros TypeBox de la herramienta antes de que se ejecute execute (el
 * validateToolArguments de pi-ai: el camino rápido de TypeBox). Los refinamientos que ningún
 * esquema puede expresar (quizInputProblems, la comprobación de nodeId contra el árbol vivo) se ejecutan al
 * principio del propio execute de la herramienta y lanzan ToolInputError.
 */

/**
 * Tiempo límite por llamada a nivel de sistema (2026-09-19, el arreglo de la cascada de abortos): pi
 * pasa la AbortSignal de cada ejecución al execute de la herramienta, pero la señal solo
 * llega en un límite de paso, así que una herramienta local de larga duración (el grep que
 * sobrevivió a su turno durante minutos) podía tener el turno como rehén hasta que el reinicio
 * por memoria del servidor de desarrollo mataba la ejecución a mitad de herramienta, congelando el
 * registro en su estado de escritura anticipada (la marcha atrás de «volvió atrás en el tiempo»). La
 * guarda enfrenta cada execute con (a) la señal de la ejecución y (b) este tiempo límite,
 * rechazando con la propia redacción de pi ("Operation aborted") al abortar y con un
 * mensaje claro de tiempo agotado en otro caso: pi convierte el throw en un resultado de herramienta
 * de error que el modelo puede ver.
 */
const TOOL_TIMEOUT_MS = 30_000;
/** Punto de inyección para pruebas (el patrón pdfModelOverride de runner.ts). */
export const toolTimeoutMs = { current: TOOL_TIMEOUT_MS };

/** Cuánto puede tardar una llamada abortada/sin tiempo en resolverse por sí sola antes
 *  de que llegue el rechazo forzoso: las herramientas cooperativas sondean la señal y devuelven
 *  resultados parciales en uno o dos ticks (las herramientas de fs comprueban por fichero). */
const TOOL_ABORT_GRACE_MS = 250;

function runWithAbortGuard<T>(
	toolName: string,
	run: (signal: AbortSignal) => T | Promise<T>,
	parent: AbortSignal | undefined,
): Promise<T> {
	const controller = new AbortController();
	const forwardAbort = () => controller.abort();
	if (parent) {
		if (parent.aborted) controller.abort();
		else parent.addEventListener("abort", forwardAbort, { once: true });
	}
	const timeoutMs = toolTimeoutMs.current;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const humanTimeout = timeoutMs >= 1_000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	const cleanup = () => {
		clearTimeout(timer);
		if (graceTimer) clearTimeout(graceTimer);
		parent?.removeEventListener("abort", forwardAbort);
	};
	return new Promise<T>((resolve, reject) => {
		const settle = (fn: () => void) => {
			controller.signal.removeEventListener("abort", onAbort);
			if (graceTimer) clearTimeout(graceTimer);
			fn();
		};
		const onAbort = () => {
			// Las herramientas cooperativas sondean la señal y se resuelven con resultados
			// parciales en uno o dos ticks (las herramientas de fs comprueban por fichero):
			// se les da un breve margen para entregarlos antes del rechazo
			// forzoso, de modo que el aborto MATA una herramienta atascada sin
			// adelantarse al resultado parcial de una que termina con elegancia.
			graceTimer = setTimeout(
				() =>
					reject(
						new Error(
							parent?.aborted
								? "Operation aborted"
								: `Tool "${toolName}" timed out after ${humanTimeout} — the result was discarded`,
						),
					),
				TOOL_ABORT_GRACE_MS,
			);
		};
		controller.signal.addEventListener("abort", onAbort, { once: true });
		if (controller.signal.aborted) onAbort(); // una señal ya abortada nunca dispara los listeners
		Promise.resolve()
			.then(() => run(controller.signal))
			.then(
				(v) => settle(() => resolve(v)),
				(e) => settle(() => reject(e)),
			);
	})
		.finally(cleanup);
}

/** El resultado de fallo de autoría nativo de 1.0 (convención de pi, agent-core
 *  1.0): devolver un resultado isError en lugar de lanzar; el modelo ve la
 *  misma lista de problemas reintentables de siempre (pi generaba exactamente esta forma
 *  a partir de un ToolInputError lanzado), pero `details` conserva ahora los problemas como
 *  DATOS para el registro y la interfaz en lugar del {} vacío del camino del throw.
 *  El texto del contenido es idéntico byte a byte al antiguo mensaje lanzado. */
export function invalidInputResult(
	toolName: string,
	problems: string[],
): AgentToolResult<{ tool: string; problems: string[] }> {
	return {
		content: [
			{
				type: "text",
				text: `Invalid tool input for tool "${toolName}":\n${problems.map((p) => `- ${p}`).join("\n")}`,
			},
		],
		isError: true,
		details: { tool: toolName, problems },
	};
}

/**
 * Vía de escape para resultados de herramienta ricos (sources v0, 2026-09): una herramienta cuyo resultado
 * incluye IMÁGENES (la herramienta read leyendo un fichero de imagen) devuelve esta forma
 * en lugar de un valor simple: toToolResult la convierte en las partes de contenido
 * nativas de resultado de herramienta de pi (TextContent | ImageContent)[] para que el
 * modelo con visión VEA de verdad la imagen. `images` lleva los datos en base64
 * + mimeType, exactamente como los quiere el ImageContent de pi. `details` pasa
 * al registro sin tocar.
 */
export interface ImageFileResult {
	text: string;
	images?: { data: string; mimeType: string }[];
	/** El resultado de cara al registro (renderizado en el cliente / persistencia). */
	details?: unknown;
}

function isImageResult(v: unknown): v is ImageFileResult {
	return (
		typeof v === "object" && v !== null && "text" in v && typeof (v as ImageFileResult).text === "string"
	);
}

/**
 * Convierte el valor devuelto por el cuerpo de una herramienta en el AgentToolResult nativo: la
 * paridad que tenía la antigua cola de toPiTool: los resultados string pasan tal cual al modelo,
 * los objetos como JSON; `details` lleva el valor CRUDO (la salida de la parte de herramienta del
 * registro lo lee, ui-stream), y los resultados de imagen se convierten en partes de contenido
 * nativas con details ?? null.
 */
export function toToolResult(result: unknown): AgentToolResult<unknown> {
	if (isImageResult(result)) {
		return {
			content: [
				{ type: "text", text: result.text },
				...(result.images ?? []).map((img) => ({
					type: "image" as const,
					data: img.data,
					mimeType: img.mimeType,
				})),
			],
			details: result.details ?? null,
		};
	}
	return {
		content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
		details: result,
	};
}

/** Lo que recibe el cuerpo de una herramienta ejecutada en el servidor: el id de llamada + la señal
 *  combinada de la guarda (aborto de la ejecución + tiempo límite por llamada) para el sondeo cooperativo. */
export interface ToolExecuteContext {
	toolCallId: string;
	signal?: AbortSignal;
}

/**
 * Construye un execute nativo de AgentTool a partir del cuerpo de una herramienta: la guarda (tiempo límite +
 * cascada de abortos) más la correspondencia de resultados compartida, idéntica byte a byte a la antigua
 * canalización toPiTool para toda herramienta del lado del servidor. Las herramientas de preguntas NO usan
 * esto: su marcador provisional es instantáneo (questionResult, más abajo) y sus
 * comprobaciones de refinamiento se ejecutan antes.
 */
export function serverExecute<P extends TSchema>(
	toolName: string,
	schema: P,
	run: (input: Static<P>, ctx: ToolExecuteContext) => unknown,
): AgentTool<any>["execute"] {
	// El execute devuelto se tipa laxo a propósito (params: unknown) para que
	// encaje en cualquier hueco de AgentTool: los registros heterogéneos tipan
	// AgentTool<any>, cuyo Static es unknown, y strictFunctionTypes
	// rechaza contra él una función con params más estrechos. El bucle ya ha
	// validado los argumentos contra `schema` (en tiempo de ejecución) y `run` conserva la
	// entrada Static<P> precisa; `schema` está en la firma precisamente para que
	// P se infiera desde el punto de llamada, no desde la superficie laxa.
	return async (toolCallId, input: unknown, signal) =>
		toToolResult(
			await runWithAbortGuard(toolName, (toolSignal) => run(input as Static<P>, { toolCallId, signal: toolSignal }), signal),
		);
}

/**
 * El resultado sintético de las herramientas de preguntas (solo en memoria; la parte de
 * herramienta del registro no guarda salida hasta que el alumno responde). terminate: true termina
 * el lote de forma nativa: pi detiene el bucle cuando todos los resultados finalizados del
 * lote terminan; el detenedor shouldStopAfterTurn cubre el lote
 * mixto (pregunta + otras llamadas en un mensaje) que la semántica de solo terminate
 * dejaría seguir (opción A del responsable, 2026-09-25).
 */
export function questionResult(): AgentToolResult<null> {
	return {
		content: [
			{
				type: "text",
				text: "Question posed — the turn ends here; the learner's graded answer arrives as this call's result.",
			},
		],
		details: null,
		terminate: true,
	};
}

/** El acuse del planteamiento de práctica (sesiones de práctica, responsable 2026-10-04): a diferencia
 *  de una pregunta, este resultado es FINAL: se persiste (persistTurn filtra
 *  solo los marcadores provisionales de QUESTION_TOOLS), porque los envíos del alumno
 *  llegan como MENSAJES, nunca como el resultado de esta llamada. terminate: true termina
 *  el turno en el planteamiento; el compromiso va en los argumentos de la llamada. */
export function problemResult(): AgentToolResult<null> {
	return {
		content: [
			{
				type: "text",
				text: "Problem posed — the turn ends here; the learner's thinking traces and answer commits arrive as labeled messages.",
			},
		],
		details: null,
		terminate: true,
	};
}

/** El acuse de conclude: NO terminate; el turno continúa para que la misma respuesta
 *  pueda revelar + plantear el siguiente problema. Texto de fuente única en contracts
 *  (CONCLUDE_ACK_TEXT, compartido con el par sintetizado al descartar). */
export function concludeResult(): AgentToolResult<null> {
	return {
		content: [{ type: "text", text: CONCLUDE_ACK_TEXT }],
		details: null,
	};
}
