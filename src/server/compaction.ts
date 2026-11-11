/**
 * EL SERVICIO DE COMPACTACIÓN (ronda 14 del responsable, 2026-10-05): la
 * fontanería de disparo alrededor de los cortes y marcadores puros de
 * core/compaction.
 *
 * TOPOLOGÍA (por qué es sencillo): los planteamientos de preguntas y problemas
 * TERMINAN sus ejecuciones, así que la pausa en la que «el usuario está
 * pensando» es siempre una ventana ENTRE EJECUCIONES. Por eso la compactación
 * nunca toca una ejecución viva:
 *
 *   - IMPULSO AL ASENTARSE: un turno se asienta (onFinish, tras persistir) y
 *     el contexto proyectado supera el umbral: el resumen arranca YA, en
 *     segundo plano, mientras el alumno lee/responde; suele terminar mucho
 *     antes de que llegue la siguiente entrada.
 *   - BARRERA AL INICIO DEL TURNO: todo turno (POST del cliente o despertar)
 *     espera a cualquier compactación en curso de su chat ANTES de los
 *     añadidos o de beginTurn; si el registro SIGUE por encima del umbral
 *     (sesiones en frío, impulsos que perdieron su motor), la compactación se
 *     ejecuta de forma síncrona dentro de la petición. Con barrera
 *     estructural: nada de cara al modelo para el chat se intercala con una
 *     compactación en curso (decisión del responsable: superficie mínima
 *     para que algo salga mal).
 *   - RECUPERACIÓN DE DESBORDAMIENTOS: una ejecución que muere por longitud
 *     de contexto no necesita ninguna ruta especial: la barrera del turno
 *     siguiente compacta y la ejecución nueva empieza pequeña.
 *
 * El resumen lo escribe el PROPIO modelo de conversación de la sesión
 * (decisión del responsable) mediante la frontera de subagente de una sola
 * pasada sin herramientas; su uso llega al registro de turnos de solo añadido
 * del chat (el canal del dinero), con el id del marcador como clave.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import {
	activeCompactionOf,
	buildCompactionPrompt,
	compactionCutIndex,
	COMPACTION_RESERVE_TOKENS,
	estimateContextTokens,
	estimateTokens,
	newCompactionMarker,
	planTreeToText,
	serializeForSummary,
	toLlmMessages,
	type CompactionDetails,
	type ChatRecord,
	type LhMessage,
	type LhMarkerMessage,
} from "../core/index.ts";
import { emit } from "../core/events.ts";
import type { ChatStore } from "../core/ports.ts";
import type { PiEngine } from "../agent/models.ts";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/** El prompt de sistema del resumidor: un encuadre operativo propio del
 *  servidor, no doctrina de cara al modelo (buildCompactionPrompt lleva la forma). */
const SUMMARIZER_SYSTEM_PROMPT =
	"You are the session-compaction summarizer for a tutoring agent. You receive the transcript span to summarize and write exactly the summary the instructions demand — nothing else, no preamble, no meta-commentary.";

/** La llamada de resumen de una sola pasada: cero herramientas, un turno,
 *  texto de salida. El motor es el propio motor de conversación del chat
 *  (decisión del responsable: el modelo de la sesión escribe su propio
 *  resumen). Inyectable para las pruebas. */
export type Summarizer = (prompt: string, engine: PiEngine) => Promise<{ summary: string; usage: Usage }>;

/** El resumidor de producción sobre la frontera de subagente. */
async function subagentSummarizer(prompt: string, engine: PiEngine): Promise<{ summary: string; usage: Usage }> {
	let usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const { text, newMessages } = await runSubagent([], {
		// La sustitución del motor siempre está presente (el propio motor de conversación
		// del chat, por decisión del responsable), así que la etiqueta de rol nunca resuelve
		// un motor; "researcher" es la etiqueta de ModelRole existente menos errónea para
		// una tarea de texto de una pasada (la conversión de tipo documenta la ruta muerta).
		role: "researcher" as never,
		prompt,
		engine,
		systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
		maxTurns: 1,
		// Trabajo operativo para la conversación en primer plano, no una tarea de worker.
		bypassWorkerRequestAdmission: true,
		onUsage: (u) => {
			usage = u;
		},
	});
	// Una respuesta que el proveedor declara incompleta no es un punto de control
	// utilizable, aunque contenga texto no vacío. Igual que la semántica de fallo de la
	// compactación de Pi: se dejan intactos el historial existente y el resumen anterior.
	if (newMessages.some((message) => message.role === "assistant" && message.stopReason === "length")) {
		throw new Error("Compaction summary hit the output limit and is incomplete");
	}
	return { summary: text, usage };
}

/** Todo lo que el servicio necesita de su anfitrión (chat-handler conecta las
 *  versiones de producción; las pruebas inyectan). */
export interface CompactionDeps {
	/** Admisibilidad solo para ejecuciones NUEVAS; las esperas estructurales se siguen aplicando. */
	canStart?: () => boolean;
	chatStore: ChatStore;
	/** El motor de conversación del chat, que también es el del resumidor. */
	engine: PiEngine;
	/** proveedor:id del motor (uso + procedencia del marcador). */
	modelId: string;
	/** El tipo de sesión (redacción del resumidor: tutor frente a práctica). */
	kind: "teach" | "practice" | "probe";
	/** El umbral de disparo efectivo, RESUELTO por el llamante:
	 *  min(umbral de los ajustes, contextWindow − reserva), la decisión del
	 *  responsable sobre el disparo efectivo. La consulta de la ventana en el
	 *  catálogo es cosa del llamante (chat-handler tiene a mano el id del modelo). */
	thresholdTokens: number;
	/** Contabilidad de razonamiento opcional; ausente/false usa la heurística original. */
	includeReasoning?: boolean;
	/** La estimación de tokens del prompt de sistema compuesto (caracteres/4): la
	 *  proyección que recibe de verdad el proveedor empieza por él. */
	systemPromptTokens: number;
	/** Dispara frente a una petición prevista sin registrar/resumir su carga nueva.
	 * El corte y el resumen siguen usando solo el historial guardado. */
	projectMessages?: (record: ChatRecord) => readonly LhMessage[];
	/** Resumidor inyectable (pruebas); por defecto, la pasada única de subagente. */
	summarize?: Summarizer;
}

// ─── el registro (global del módulo en globalThis, como en jobs.ts) ─────────

interface CompactionState {
	inFlight: Map<string, Promise<void>>;
}
const g = globalThis as typeof globalThis & { __lhCompaction?: CompactionState };
function state(): CompactionState {
	return (g.__lhCompaction ??= { inFlight: new Map() });
}

/** ¿Hay una compactación en curso para este chat? (El gemelo en el servidor del
 *  evento de estado del cliente; lo leen las pruebas y el emisor SSE). */
export function compactionInFlight(chatId: string): boolean {
	return state().inFlight.has(chatId);
}

/** Espera a cualquier compactación en curso del chat: la barrera estructural
 *  por la que pasa toda interacción con el modelo para ese chat. */
export async function awaitCompaction(chatId: string): Promise<void> {
	const running = state().inFlight.get(chatId);
	if (running) await running;
}

// ─── el umbral efectivo (decisión del responsable: min(ajuste, ventana − reserva)) ─

/** Resuelve el disparo efectivo. Ventana desconocida → solo el ajuste
 *  (honesto: ninguna ventana falsa; el precedente del índice del catálogo). */
export function effectiveThresholdTokens(settingTokens: number | undefined, contextWindowTokens: number | undefined): number {
	const setting = settingTokens ?? 150_000;
	if (contextWindowTokens === undefined) return setting;
	return Math.min(setting, Math.max(contextWindowTokens - COMPACTION_RESERVE_TOKENS, 1));
}

// ─── la estimación sobre la proyección ACTIVA ───────────────────────────────

/** La estimación del contexto proyectado: lo que llevaría la siguiente llamada
 *  al LLM. LA LEY DEL DISPARO (la de pi, verificada el 2026-10-05): se ancla en
 *  el uso que informó el proveedor para el último mensaje del asistente (que ya
 *  contó el prompt de sistema, las declaraciones de herramientas y el propio
 *  tokenizador del proveedor) y se estima con caracteres/4 SOLO lo añadido
 *  después. estimateContextTokens rechaza las anclas anteriores a un marcador
 *  de compactación (ese uso describía un contexto que la siguiente petición NO
 *  llevará), así que la ruta alternativa aplica la heurística simple sobre la
 *  proyección QUE RESPETA EL CORTE (nunca el tramo descartado) más el término
 *  aditivo del prompt que habría cubierto el ancla. Aportar un modelo activa
 *  las estimaciones que tienen en cuenta el razonamiento; el servicio solo lo
 *  aporta si está activado. */
export function projectedContextTokens(messages: readonly LhMessage[], systemPromptTokens: number, model?: PiEngine["model"]): number {
	const est = estimateContextTokens(messages, model);
	if (est.lastUsageIndex !== null) return est.tokens;
	return estimateTokens(toLlmMessages(messages as readonly AgentMessage[]) as unknown as readonly LhMessage[], model) + systemPromptTokens;
}

// ─── la ejecución de la compactación ────────────────────────────────────────

/** Ejecuta una compactación para el chat (el llamante, ensureCompacted,
 *  TIENE el mutex del registro). Lee el registro de nuevo, corta, resume,
 *  añade el marcador, registra el uso y notifica. Nunca lanza hacia arriba
 *  más allá de la limpieza del registro. */
async function compact(deps: CompactionDeps, chatId: string): Promise<void> {
	// La frontera real de inicio, compartida por los llamantes de comprobación previa, de
	// segundo plano y manuales. No basta con una comprobación anterior de la petición: una
	// respuesta concurrente puede tomar el control mientras ensureCompacted espera la barrera
	// estructural. No hay ningún await entre esta comprobación y el inicio del resumen; toda
	// comprobación previa sigue esperando a una compactación que ya esté en marcha.
	if (isTurnRunning(chatId)) return;
	const record = deps.chatStore.getChat(chatId);
	if (!record) return;
	const messages = record.messages;
	const model = deps.includeReasoning ? deps.engine.model : undefined;
	const tokensBefore = projectedContextTokens(deps.projectMessages?.(record) ?? messages, deps.systemPromptTokens, model);
	if (tokensBefore <= deps.thresholdTokens) return; // quedó por debajo mientras esperábamos

	const cut = compactionCutIndex(messages, undefined, model);
	if (cut <= 0 || cut >= messages.length) return; // no se puede descartar historial

	// El límite conservado de la compactación anterior (las compactaciones encadenadas
	// resumen el resumen antiguo + lo que vino después).
	const previous = activeCompactionOf(messages);
	const prevKept = previous ? messages.findIndex((m) => m.id === previous.details.firstKeptMessageId) : -1;
	// PROTECCIÓN CONTRA EL BUCLE INÚTIL: cuando el corte no puede avanzar más allá del
	// límite conservado anterior, el tramo está vacío (o lo repite); la cola conservada
	// lleva por sí sola la proyección y volver a resumir el mismo tramo no puede
	// reducirla. Solo es alcanzable si el umbral queda por debajo de cola conservada +
	// resumen (un registro editado a mano por debajo del mínimo de los ajustes); omitirlo
	// mantiene el bucle honesto en lugar de dar vueltas en vano.
	if (previous && prevKept !== -1 && cut <= prevKept) {
		console.info(
			`[chat ${chatId}] compaction skipped — the kept tail alone exceeds the threshold (raise it or shrink the tail)`,
		);
		return;
	}

	// El tramo: desde el límite conservado ANTERIOR hasta el corte.
	let spanStart = 0;
	let priorSummary: string | null = null;
	if (previous && prevKept > 0) {
		spanStart = prevKept;
		priorSummary = previous.content;
	}
	const span = messages.slice(spanStart, cut);
	// El resumen anterior aportado por separado sustituye a todos los marcadores de
	// resumen de este tramo. Sin un límite anterior resuelto, se conserva la alternativa
	// heredada existente en lugar de descartar en silencio contexto que solo está en resúmenes.
	const summaryMessages = priorSummary
		? span.filter((m) => m.role !== "custom" || m.customType !== "compaction")
		: span;
	const spanText = serializeForSummary(summaryMessages);
	const fullSpan = priorSummary ? `[SYSTEM NOTE — prior compaction summary, still authoritative where not superseded]\n${priorSummary}\n\n${spanText}` : spanText;

	const prompt = buildCompactionPrompt({
		spanText: fullSpan,
		planTreeText: planTreeToText(record.tree, messages),
		kind: deps.kind,
	});

	emit("compaction-changed", { chatId, running: true });
	try {
		const summarize = deps.summarize ?? subagentSummarizer;
		const { summary, usage } = await summarize(prompt, deps.engine);
		const trimmed = summary.trim();
		if (!trimmed) return; // un resumen vacío es un artefacto de rechazo: se deja el registro honesto

		const firstKept = messages[cut]!;
		const details: CompactionDetails = {
			firstKeptMessageId: firstKept.id,
			tokensBefore,
			model: deps.modelId,
			at: new Date().toISOString(),
		};
		const marker = newCompactionMarker(trimmed, details);
		deps.chatStore.saveMessages(chatId, [...messages, marker]);
		// El canal del dinero: el resumen es una llamada real al modelo con el propio motor
		// de la sesión; su uso se asocia al marcador (procedencia: la transcripción
		// muestra el separador de compactación en el marcador).
		deps.chatStore.appendTurnUsage(chatId, {
			id: crypto.randomUUID(),
			messageId: marker.id,
			at: details.at,
			model: deps.modelId,
			steps: [
				{
					inputTokens: usage.input,
					outputTokens: usage.output,
					cacheReadTokens: usage.cacheRead,
					cacheWriteTokens: usage.cacheWrite,
					cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
					reasoningTokens: usage.reasoning ?? 0,
				},
			],
		});
		// Notificar y luego leer: el registro ganó el marcador (aparecen los separadores
		// del cliente) y el evento de estado cierra la barrera de envío.
		emit("record-changed", { chatId });
	} catch (err) {
		// Una compactación fallida deja el registro intacto; la barrera al inicio del
		// siguiente turno reintenta (la misma ley de autorreparación que el disparador
		// de la extracción).
		console.error(`[chat ${chatId}] compaction failed:`, err);
	} finally {
		emit("compaction-changed", { chatId, running: false });
	}
}

/**
 * La barrera y el disparador en uno: espera a cualquier compactación en curso
 * y después, si el registro SIGUE por encima del umbral, ejecuta una de forma
 * síncrona (la petición del llamante espera; la decisión del responsable sobre
 * la barrera estructural). Idempotente con concurrencia gracias al mutex del
 * registro.
 */
export async function ensureCompacted(deps: CompactionDeps, chatId: string): Promise<void> {
	// Se omite en las pruebas, como precedente del disparador de la extracción: los chats
	// con guion son fixtures; el propio servicio se prueba directamente con un
	// resumidor inyectado.
	if (process.env.NODE_ENV === "test" && !deps.summarize) return;
	await awaitCompaction(chatId);
	// Otra comprobación previa nueva puede haber iniciado un resumen tras nuestra
	// comprobación estructural inicial. Se une a él ANTES de cualquier salida temprana por
	// admisibilidad/umbral: esas comprobaciones rigen las ejecuciones nuevas, nunca dan permiso para saltarse una viva.
	const concurrent = state().inFlight.get(chatId);
	if (concurrent) {
		await concurrent;
		return;
	}
	if (deps.canStart?.() === false) return;
	const record = deps.chatStore.getChat(chatId);
	if (!record) return;
	const model = deps.includeReasoning ? deps.engine.model : undefined;
	if (projectedContextTokens(deps.projectMessages?.(record) ?? record.messages, deps.systemPromptTokens, model) <= deps.thresholdTokens) return;
	const admitted = state().inFlight.get(chatId);
	if (admitted) {
		await admitted;
		return;
	}
	const run = compact(deps, chatId);
	state().inFlight.set(chatId, run);
	try {
		await run;
	} finally {
		if (state().inFlight.get(chatId) === run) state().inFlight.delete(chatId);
	}
}

/**
 * El impulso al asentarse (disparar y olvidar): el turno se ha asentado y el
 * alumno está a punto de leer/responder; si la proyección supera el umbral, el
 * resumen arranca YA y termina dentro de la pausa. Se conecta al final del
 * onFinish de chat-handler; sin motor o sin nada que hacer por umbral, no hace
 * nada, en silencio. La barrera ensureCompacted del turno siguiente recoge lo
 * que esto deje en marcha.
 */
export function kickCompaction(buildDeps: () => CompactionDeps | null, chatId: string): void {
	if (state().inFlight.has(chatId)) return;
	const deps = buildDeps();
	if (!deps || deps.canStart?.() === false) return;
	const record = deps.chatStore.getChat(chatId);
	if (!record) return;
	if (projectedContextTokens(record.messages, deps.systemPromptTokens, deps.includeReasoning ? deps.engine.model : undefined) <= deps.thresholdTokens) return;
	const run = compact(deps, chatId);
	state().inFlight.set(chatId, run);
	void run.finally(() => {
		if (state().inFlight.get(chatId) === run) state().inFlight.delete(chatId);
	});
}
