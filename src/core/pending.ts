/**
 * Oleada D: estos recorridos leen mensajes de VISTA (LhViewMessage de
 * core/view.ts — la transcripción agrupada del cliente). Las formas de las
 * partes son el mismo vocabulario que usaba el dialecto del cliente anterior
 * a la oleada D; una parte de herramienta es estructural: prefijo `tool-` +
 * toolCallId. Los recorridos del registro del lado del servidor
 * (danglingQuestionOf sobre LhMessage[] nativos) viven en native-messages.ts.
 */
interface UIMessage {
	role?: string;
	parts: Array<Record<string, unknown> & { type: string }>;
}

function isToolUIPart(part: UIMessage["parts"][number]): boolean {
	return part.type.startsWith("tool-") && typeof part.toolCallId === "string";
}

/**
 * La barrera de preguntas pendientes: una parte de herramienta de PREGUNTA
 * sin responder (quiz/ask) bloquea el compositor — una pregunta cada vez,
 * igual que el contrato del prompt del profesor. Estado derivado del
 * cliente; el servidor no impone nada.
 *
 * Orden del recorrido: los MENSAJES del más reciente al más antiguo (la
 * pregunta viva de un turno posterior sustituye a una colgante más antigua),
 * pero las PARTES hacia delante dentro de un mensaje — la PRIMERA pregunta
 * sin responder del modelo es el sujeto del dock. Las llamadas de pregunta en
 * paralelo (pi las ejecuta en un solo lote) se responden así en el mismo
 * orden en que se plantearon, se guardaron y se mostraron como tarjetas; un
 * recorrido de partes hacia atrás invertía ese orden (la observación en vivo
 * del realismo modal).
 *
 * Las partes de herramientas de tareas (research/demo/visual) nunca quedan
 * pendientes en el cliente — el protocolo asíncrono las resuelve en el
 * servidor con un acuse inmediato (consulta "THE ASYNC PROTOCOL" en
 * contracts/jobs.ts), así que las herramientas de tareas NO se devuelven
 * aquí. Este fichero solo lleva la barrera de preguntas y el auxiliar de
 * recorrido compartido.
 */
export interface PendingToolCall {
	toolCallId: string;
	tool: string;
	/** Entrada de la herramienta (argumentos de quiz/ask) — permite al compositor elegir el modo nota o respuesta. */
	input: unknown;
}

/** Identidad solo del cliente: la proyección puede agrupar varios asistentes
 * nativos. Nunca se persiste ni se envía como parte de un evento de
 * respuesta. */
export interface PendingQuestion extends PendingToolCall {
	messageId: string;
	contentIndex: number;
	/** Los ids de llamada únicos se mantienen estables entre los sellos de
	 * mensaje vivos → persistidos. Los ids reutilizados incluyen en su lugar su
	 * aparición nativa. */
	key: string;
}

/** Herramientas que se muestran en el dock de preguntas y bloquean el
 * compositor. Los nombres de la fase de sondeo se suman a sus gemelos de
 * enseñanza; los registros antiguos conservan los nombres de enseñanza. */
export const QUESTION_TOOLS = [
	"quiz",
	"probe",
	"ask_user_question",
	"explain",
	"recall",
] as const;

/** El mapa herramienta→tipo (el plegado propio del dock, nombrado una vez —
 *  el camino de descarte y el dock nunca deben discrepar sobre qué es una
 *  herramienta). Los nombres de sondeo se pliegan en sus tipos de enseñanza —
 *  el dock se guía por el tipo. */
export function toolQuestionKind(tool: string): "quiz" | "ask" | "explain" {
	return tool === "quiz" || tool === "probe" ? "quiz" : tool === "explain" || tool === "recall" ? "explain" : "ask";
}

/** Herramientas que cumplen las tareas de subagentes en segundo plano (W2/W6). */
export const JOB_TOOLS = ["research", "demo", "visual"] as const;

// ─── Disponibilidad de herramientas (frontera de ajustes, 2026-09) ─────────

/** Las herramientas que un usuario puede desactivar en ajustes — LA LISTA
 *  DEFINITIVA (resuelto el 2026-09-19, conciliación P2: solo las herramientas
 *  de TAREAS de subagentes — research/demo/visual/pdf). A propósito NUNCA se
 *  pueden desactivar: quiz + ask_user_question (el flujo del sondeador son
 *  tandas de cuestionarios calificados → probe_done; quitar quiz hundiría la
 *  evaluación, y la doctrina de enseñanza se basa en la verificación
 *  calificada — el peligro de la cuña), el conjunto del sistema de ficheros
 *  del alumno (decidido por el usuario en 2026-09, fuentes v1: siempre
 *  activo), las herramientas del plan y probe_done (es la forma de TERMINAR
 *  la fase — un sondeador que nunca puede concluir es un bloqueo).
 *  El lado de escritura valida contra esta lista (settings-body.ts: clave
 *  desconocida = 400 con la lista admitida); el saneador del lado de lectura
 *  sigue siendo tolerante por compatibilidad futura. Los nombres son los
 *  nombres de herramienta DE CARA AL MODELO (research, no researcher; pdf es
 *  el envío al lector de PDF, fuentes v0 2026-09). */
export const TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

/** Las claves que acepta el lado de ESCRITURA de ajustes en agent.tools: las
 *  desactivables normales MÁS el interruptor de la mecánica de cuestionarios
 *  (`explain: true` activa los cuestionarios de recuerdo libre y quita el
 *  cuestionario de opción múltiple — consulta quizMechanics en
 *  agent/tools.ts; responsable 2026-09-27). `quiz` en sí sigue sin poder
 *  escribirse: lo gestiona la mecánica y nunca se desactiva por separado. */
export const WRITABLE_TOOL_KEYS = [...TOGGLEABLE_TOOLS, "explain"] as const;

/** La forma de la frontera ajustes resueltos → fábrica (Platform conecta
 *  chat-handler para que la pase desde el registro de ajustes; el
 *  almacenamiento y los valores por defecto son el carril de Platform).
 *  Nativa de JSON: un registro parcial indexado por nombre de herramienta.
 *  Clave ausente / undefined = activada — los registros antiguos se comportan
 *  exactamente como hoy. Cualquier `false` explícito quita esa herramienta del
 *  registro, sea cual sea su nombre — la maquinaria sigue siendo genérica para
 *  futuras desactivables. */
export type EnabledTools = Partial<Record<string, boolean>>;

/** Quita todas las herramientas que los ajustes resueltos marcan como
 *  desactivadas. El único punto de filtrado que comparten todas las fábricas
 *  (sondeador/profesor). */
export function filterEnabledTools<T>(tools: Record<string, T>, enabled?: EnabledTools): Record<string, T> {
	if (!enabled) return tools;
	const out: Record<string, T> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (enabled[name] === false) continue;
		out[name] = tool;
	}
	return out;
}

function findPending(messages: UIMessage[], names: readonly string[], authority?: string | PendingQuestion): PendingToolCall | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		const msg = messages[m]!;
		for (let p = 0; p < msg.parts.length; p++) {
			const part = msg.parts[p]!;
			if (isToolUIPart(part) && !part.pluginQuestion && part.state === "input-available") {
				const tool = part.type.slice("tool-".length);
				if (!names.includes(tool)) continue;
				if (typeof authority === "object") {
					if (part.toolCallId !== authority.toolCallId || tool !== authority.tool ||
						part.sourceMessageId !== authority.messageId || part.sourceContentIndex !== authority.contentIndex) continue;
					return authority;
				}
				if (authority === undefined || part.toolCallId === authority) {
					return { toolCallId: part.toolCallId as string, tool, input: part.input };
				}
			}
		}
	}
	return null;
}

/** Los mensajes de vista agrupados pierden los límites nativos del
 * asistente. Los llamadores nativos aportan la aparición exacta, no solo un
 * id: su PROPIA parte debe haber pasado la validación. Nunca recurre a una
 * pregunta disponible más antigua. null significa que no hay pregunta nativa
 * pendiente; undefined mantiene a los llamadores solo de vista. La sobrecarga
 * con cadena se conserva para los consumidores solo de vista o con filtro
 * por id. */
export function findPendingToolCall(messages: UIMessage[], authority: PendingQuestion | null): PendingQuestion | null;
export function findPendingToolCall(messages: UIMessage[], authority?: string | null): PendingToolCall | null;
export function findPendingToolCall(messages: UIMessage[], authority?: string | PendingQuestion | null): PendingToolCall | null {
	if (authority === null) return null;
	return findPending(messages, QUESTION_TOOLS, authority);
}

// ─── Etiqueta de actividad del turno (2026-09-19, la corrección de “Writing a question…”) ─

/**
 * El texto con brillo de actividad del turno en la transcripción: lo que
 * está haciendo el profesor AHORA MISMO. Una parte de herramienta permanece
 * en `input-streaming` durante toda su ejecución (el puente difiere
 * `tool-input-available` hasta tool_execution_end — la barrera de entradas
 * no válidas del dock de preguntas), así que asociar el antiguo brillo
 * “Writing a question…” a CUALQUIER parte de herramienta en streaming
 * etiquetaba como redacción de preguntas greps locales de varios minutos. La
 * etiqueta nombra ahora la actividad real; chat.tsx la condiciona a
 * `!pending` y la muestra como el discreto brillo de la transcripción.
 */
const ACTIVITY_LABELS: Record<string, string> = {
	read: "Reading a file…",
	ls: "Listing a directory…",
	find: "Finding files…",
	grep: "Searching file contents…",
	research: "Dispatching research…",
	demo: "Building a demo…",
	visual: "Making a visual…",
	pdf: "Reading a PDF…",
	plan_init: "Drawing up the plan…",
	probe_done: "Concluding the assessment…",
};

/** La etiqueta de actividad de UNA herramienta en ejecución (responsable,
 *  ronda de streaming del 2026-10-01): la tarjeta viva de entrada de la
 *  herramienta la lleva en línea — spinner + etiqueta con brillo en la propia
 *  tarjeta, sustituyendo la línea inferior retirada de la transcripción. Las
 *  herramientas de pregunta se excluyen aquí: su parte input-streaming se
 *  muestra en el dock, nunca en una tarjeta viva. */
export function toolActivityLabel(tool: string): string {
	if ((QUESTION_TOOLS as readonly string[]).includes(tool)) return "Writing a question…";
	return ACTIVITY_LABELS[tool] ?? "Working…";
}

export function streamingToolActivity(messages: UIMessage[]): string | null {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return null;
	for (const part of last.parts) {
		if (isToolUIPart(part) && part.state === "input-streaming") {
			return toolActivityLabel(part.type.slice("tool-".length));
		}
	}
	return null;
}


