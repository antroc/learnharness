/**
 * EL MODELO DE SESIÓN (oleada D): la máquina de estados de la sesión del
 * chat, extraída PURA — sin React, con un fetch inyectable — para que las
 * rutas de enganche/repetición/asentamiento/error/abort se puedan probar en
 * el mundo node:test del repo. El hook de React (components/session.ts) es
 * un adaptador fino: re-renderiza al cambiar y proyecta la vista
 * (core/view.ts).
 *
 * UN SOLO PROTOCOLO DE VISTA: cada turno es un proceso en segundo plano en
 * el servidor (decisión del responsable 2026-09-25); este modelo es una
 * vista. Los envíos hacen POST de un evento de entrada explícito
 * ({chatId, input}); la respuesta y el stream de reenganche
 * (GET /api/chats/[id]/stream) son el MISMO SSE literal de AgentEvent,
 * aplicado por la misma función. Vocabulario de estado (paridad previa a la
 * oleada D): ready | submitted | streaming | error.
 */

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
	needsContinuation,
	activeProblemOf,
	activeProblemOccurrenceOf,
	pendingQuestionOf,
	failedResponseAtEnd,
	measuredContextTokens,
	newAnswerResult,
	newNextMessage,
	newProblemDismissedMarker,
	newThinkingMessage,
	newUserMessage,
	projectView,
	type ChatInput,
	type LhMarkerMessage,
	type LhMessage,
	type LhViewMessage,
	type LiveExecution,
	type QuestionAnswerData,
	type QuestionDraft,
	type TurnUsage,
	type SessionPricing,
} from "../src/core";

import { copyImmutableData, pendingPluginQuestionOf, pluginQuestionCallsOf } from "../src/core/index.ts";
import { pluginQuestionOccurrenceKey, samePluginQuestionOccurrence, type PluginQuestionAnswerState, type PluginQuestionSnapshot, type PluginQuestionOccurrence } from "../src/core/index.ts";

import type { PluginProblemSnapshot, PluginProblemSubmissionState } from "../src/core/index.ts";

export interface PluginProblemAvailability { problemId: string; status: "available" | "unavailable" }
export interface PluginProblemDraft { submission: PluginProblemSubmissionState; thinking: string }
export interface PluginQuestionAvailability { questionId: string; status: "available" | "unavailable" }
export interface SessionRecordSnapshot {
	pluginProblemAvailability?: PluginProblemAvailability;
	messages: LhMessage[];
	turnError?: string;
	pluginQuestionAvailability?: PluginQuestionAvailability;
	turnInFlight?: boolean;
	turns?: TurnUsage[];
	pricing?: SessionPricing;
}
export interface SessionRecordReadOptions {
	adoption?: "replace" | "append" | "none";
	signal?: AbortSignal;
	/** La cancelación local de React debe comprobarse tras leer el cuerpo completo. */
	isCurrent?: () => boolean;
	/** Las lecturas internas previas a la repetición/terminales pueden sustituir mientras el estado está ocupado. */
	allowInFlight?: boolean;
	recoveringDrop?: boolean;
	/** Conserva la alternativa de repetición del reenganche existente ante registros no OK. */
	tolerateHttpFailure?: boolean;
}
export interface PluginQuestionDraft { answer: PluginQuestionAnswerState; thinking: string; readingThinking: string }
export type SessionStatus = "ready" | "submitted" | "streaming" | "error";

/** Cada cuánto sondear turnInFlight mientras corre un turno en carrera (reintento de 409). */
export const TURN_POLL_MS = 500;
/** Deja de esperar (un turno de despertar puede durar mucho) y muestra el 409. */
export const TURN_WAIT_MAX_MS = 30_000;

export interface SessionModelDeps {
	/** Fetch inyectable (pruebas); por defecto, el global. */
	fetch?: typeof globalThis.fetch;
	/** Tiempos de reintento inyectables (pruebas). */
	pollMs?: number;
	waitMaxMs?: number;
}

/** Un id optimista local (nunca un sello del servidor — la absorción y el
 *  intercambio al asentarse se basan ambos en este prefijo). */
let localSeq = 0;
function localId(): string {
	return `c_${Date.now().toString(36)}_${(localSeq++).toString(36)}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

async function turnInFlight(model: SessionModel): Promise<boolean | null> {
	try {
		const res = await model.fetch(`/api/jobs?chatId=${encodeURIComponent(model.chatId)}`);
		if (!res.ok) return null;
		return ((await res.json()) as { turnInFlight?: boolean }).turnInFlight === true;
	} catch {
		return null; // fallo pasajero de red: sigue esperando, el plazo nos acota
	}
}

const STREAM_DROPPED = "The connection dropped before the turn completed.";

/** Marca los fallos de transporte sin confundir errores de JSON/de la aplicación con cortes. */
class StreamReadError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

/** Eventos del cable; devuelve true SOLO para el marcador explícito de finalización. */
export async function* sseEvents(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Record<string, unknown>, boolean> {
	const decoder = new TextDecoder();
	let buf = "";
	for (;;) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try { chunk = await reader.read(); }
		catch (err) { throw new StreamReadError(err); }
		const { done, value } = chunk;
		if (done) return false;
		buf += decoder.decode(value, { stream: true });
		for (;;) {
			const end = buf.indexOf("\n\n");
			if (end === -1) break;
			const event = buf.slice(0, end);
			buf = buf.slice(end + 2);
			const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
			if (!dataLine) continue;
			const data = dataLine.slice("data: ".length);
			if (data === "[DONE]") return true;
			yield JSON.parse(data) as Record<string, unknown>;
		}
	}
}

/** El nombre de herramienta de la llamada de pregunta colgante (el toolName del
 *  resultado optimista de la respuesta — el servidor sella el mismo a partir de su propio recorrido del registro). */
export function pendingCallTool(messages: readonly LhMessage[], toolCallId: string): string | null {
	// Iguala el emparejamiento por aparición más reciente de la proyección para los registros anteriores al desambiguador.
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		if (m.role !== "assistant") continue;
		for (let bi = m.content.length - 1; bi >= 0; bi--) {
			const block = m.content[bi]!;
			if (block.type === "toolCall" && block.id === toolCallId) return block.name;
		}
	}
	return null;
}

/**
 * ¿Ha ABSORBIDO el registro esta entrada optimista de la cola? La
 * persistencia anticipada normalmente guarda copias de contenido idéntico con
 * ids sellados por el servidor — compara el contenido, no el id (local). La
 * normalización de imágenes usa la barrera aparte de adopción temporal del
 * POST, nunca una comparación de bytes más débil. Solo se absorben entradas
 * `c_` (el contenido del turno en vivo nunca se descarta).
 */
export function absorbed(m: LhMessage, record: readonly LhMessage[]): boolean {
	if (typeof m.id !== "string" || !m.id.startsWith("c_")) return false;
	const role = (m as { role?: string }).role;
	if (role === "user") {
		const content = (m as { content?: unknown }).content;
		return record.some(
			(r) => (r as { role?: string }).role === "user" && (Array.isArray(content) ? sameDetails((r as { content?: unknown }).content, content) : (r as { content?: unknown }).content === content),
		);
	}
	if (role === "toolResult") {
		const toolCallId = (m as ToolResultMessage).toolCallId;
		return record.some(
			(r) =>
				(r as { role?: string }).role === "toolResult" &&
				(r as ToolResultMessage).toolCallId === toolCallId,
		);
	}
	if (role === "custom") {
		// Marcadores (el envío de thinking, 2026-10-05 — el fallo de la tarjeta
		// duplicada: la tarjeta optimista de practice-thinking nunca se absorbía, así
		// que la ventana de adopción la renderizaba junto a la copia del servidor de la
		// persistencia anticipada durante todo el turno). TOTAL sobre los roles por clave de identidad — un
		// marcador es él mismo cuando coinciden su customType Y sus details estructurados;
		// los tipos que nunca aparecen de forma optimista simplemente nunca llegan aquí.
		const marker = m as LhMarkerMessage;
		return record.some(
			(r) =>
				(r as { role?: string }).role === "custom" &&
				(r as LhMarkerMessage).customType === marker.customType &&
				sameDetails((r as LhMarkerMessage).details, marker.details),
		);
	}
	return false;
}

/** Igualdad estructural profunda para los details de los marcadores (cargas
 *  JSON estables — los constructores generan datos simples). */
function sameDetails(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export interface SessionState {
	pluginProblemAvailability?: PluginProblemAvailability;
	messages: LhViewMessage[];
	nativeMessages: LhMessage[];
	canonicalMessages: LhMessage[];
	/** Solo el historial leído del servidor; las burbujas optimistas no prueban la entrega. */
	hasConfirmedConversation: boolean;
	/** Uso de la conversación completada; null tras la compactación o antes del primer uso. */
	contextTokens: number | null;
	status: SessionStatus;
	/** Envío local con corrección/procesamiento opcionales, a la espera de la respuesta de su POST. */
	evaluating: boolean;
	reconciliation: "ready" | "syncing" | "failed";
	pluginQuestionAvailability?: PluginQuestionAvailability;
	error: { message: string } | null;
	/** Reorientaciones enviadas pero aún no vaciadas (reorientación desde el
	 *  composer, 2026-10-03): la verdad del indicador de cola. Una entrada muere
	 *  cuando su id llega a los mensajes (los eventos literales del vaciado
	 *  insertan o actualizan la tarjeta real) — visibleQueuedSteers es el plegado puro. */
	steerQueue: SteerQueueItem[];
}

/** Una reorientación del composer en cola: el id generado en el cliente (la clave del upsert) + el texto. */
export interface SteerQueueItem {
	id: string;
	text: string;
}

/** El plegado del indicador (puro): una reorientación en cola sigue visible
 *  hasta que su id llega a la lista de mensajes — por el upsert del stream en
 *  vivo, la sincronización al asentarse o una recarga. Una reorientación
 *  aparcada en el servidor (varada tras una pregunta) conserva su línea: un
 *  "esperando" honesto hasta que la siguiente ejecución la vacíe. */
export function visibleQueuedSteers(
	queue: readonly SteerQueueItem[],
	messages: readonly LhMessage[],
): SteerQueueItem[] {
	const ids = new Set(messages.map((m) => (m as { id?: string }).id));
	return queue.filter((s) => !ids.has(s.id));
}

export interface SessionModelOptions extends SessionModelDeps {
	chatId: string;
	initialMessages: LhMessage[];
	/** Fallo del servidor conservado, solo en memoria, al reabrir una sesión. */
	initialError?: string;
	/** Se dispara en cada cambio de estado (el hook re-renderiza). */
	onChange?: () => void;
	/** El terminal de asentamiento del reenganche (turn-settled): no hay ningún
	 *  turno en marcha, el registro está al día — quien llama lo vuelve a pedir. */
	onReattachSettled?: () => void;
}

export class SessionModel {
	readonly chatId: string;
	/** Fetch inyectable (pruebas); por defecto, el global. */
	fetch: typeof globalThis.fetch;
	/** Reorientaciones enviadas pero aún no vaciadas (la verdad del indicador de cola). */
	private steerQueueValue: SteerQueueItem[] = [];
	private readonly pollMs: number;
	private readonly waitMaxMs: number;
	private onReattachSettled?: () => void;
	/** El disparador de re-render del hook (lo fija el adaptador). */
	onChange?: () => void;

	// EL ESTADO: el registro (canon del servidor) + la cola viva (los añadidos
	// optimistas de este cliente y los mensajes del turno en streaming). La cola
	// muere en cada sincronización completa; la persistencia anticipada absorbe las entradas optimistas.
	private base: LhMessage[];
	private tail: LhMessage[] = [];
	private questionDrafts = new Map<string, QuestionDraft>();
	private pluginQuestionDrafts = new Map<string, PluginQuestionDraft>();
	private pluginProblemDrafts = new Map<string, PluginProblemDraft>();
	private pluginProblemAvailability?: PluginProblemAvailability;
	private reconciliationValue: SessionState["reconciliation"] = "ready";
	private pluginQuestionAvailability?: PluginQuestionAvailability;
	private reconciliationTask: Promise<boolean> | null = null;
	private reconciliationOwner: AbortController | null = null;
	// Las reconexiones del efecto pueden no tener responsable del stream a ningún lado de stop().
	// Sus tareas de lectura siguen perteneciendo a conexiones distintas, a diferencia de las épocas
	// de datos, cuya invalidación sí puede exigir legítimamente un reintento terminal actual.
	private connectionGeneration = 0;
	private reconciliationConnectionGeneration = 0;
	// Autoridad compartida para TODO escritor GET canónico, incluidos los refrescos
	// independientes de Chat. Emitir una lectura no invalida otra respuesta:
	// solo lo hace una adopción canónica aceptada o una época de acción/stream.
	private canonicalIssued = 0;
	private canonicalAcknowledged = 0;
	private canonicalEpoch = 0;
	/** Los bytes normalizados no pueden identificar una entrada de imagen optimista antes de
	 * que se resuelva su POST. Difiere la adopción de la transcripción solo para este responsable HTTP vivo. */
	private imagePostOwner: AbortController | null = null;
	private imagePreview: { owner: AbortController; ids: ReadonlySet<string> } | null = null;
	/** Solo las respuestas del alumno enviadas con send(), nunca los descartes silenciosos. */
	private unconfirmedAnswers = new Map<string, string>();
	// La capa de ejecución del turno en vivo (estados a mitad de turno del modelo de vista):
	private executions = new Map<string, LiveExecution>();
	private streamingIds = new Set<string>();
	private incompleteUsageIds = new Set<string>();
	/** El id de cliente del mensaje del asistente en curso (ver applyWireEvent). */
	private streamingMessageId: string | null = null;
	private statusValue: SessionStatus = "ready";
	/** Solo de presentación; nunca cambia la admisión, la persistencia ni la propiedad del turno. */
	private evaluationOwner: AbortController | null = null;
	/** Los fallos de la petición/del bucle son transitorios; los del proveedor se derivan de los mensajes. */
	private errorValue: { message: string } | null = null;
	/** Descartar un banner no debe autorizar un turno sustituto automático. */
	private automaticContinuationBlocked = false;
	/** Un fallo completado de ESTE consumo, no el registro del intento anterior. */
	private liveFailureId: string | null = null;
	// El único consumo vivo (respuesta del POST o stream de reenganche): un consumo
	// más reciente cancela el anterior — un lector cada vez.
	private consumeAbort: AbortController | null = null;
	/** Conserva la última petición a través de stop(): un POST de apertura sigue siendo dueño
	 * de su rechazo tras desenganchar la vista, pero nunca después de una petición más reciente. */
	private latestRequest: AbortController | null = null;
	/** Comprobación síncrona de ready para la barrera (lógica de montaje de send/read). */
	readyRef = true;

	private history?: { base: LhMessage[]; tail: LhMessage[]; messages: LhMessage[] };

	constructor(opts: SessionModelOptions) {
		this.chatId = opts.chatId;
		this.base = copyImmutableData(opts.initialMessages);
		this.tail = copyImmutableData(this.tail);
		if (pluginQuestionCallsOf(this.base).some(call => call.status === "answerable" || call.status === "unreadable")) { this.reconciliationValue = "syncing"; this.readyRef = false; }
		this.errorValue = opts.initialError === undefined ? null : { message: opts.initialError };
		this.automaticContinuationBlocked = opts.initialError !== undefined;
		// VINCULADO: el fetch nativo del navegador es un método de Window — guardarlo
		// sin vincular hace que cada llamada lance "Illegal invocation" en el navegador
		// (a undici de Node le da igual, así que las pruebas nunca lo vieron). Pasa
		// siempre por un envoltorio que conserve el receptor.
		this.fetch = opts.fetch ?? ((...args) => globalThis.fetch(...args));
		this.pollMs = opts.pollMs ?? TURN_POLL_MS;
		this.waitMaxMs = opts.waitMaxMs ?? TURN_WAIT_MAX_MS;
		this.onChange = opts.onChange;
		this.onReattachSettled = opts.onReattachSettled;
	}

	/** Hook de asentamiento inyectable (el adaptador conecta su ref). */
	setReattachSettled(fn: () => void): void {
		this.onReattachSettled = fn;
	}

	/** Las actualizaciones de estado/dock no cambian el historial nativo. Las identidades inmutables
	 * de los mensajes permiten que todos los lectores de preguntas históricas compartan el mismo análisis. */
	private nativeHistory(): LhMessage[] {
		if (this.history?.base === this.base && this.history.tail === this.tail) return this.history.messages;
		const messages = copyImmutableData([...this.base, ...this.tail]);
		this.history = { base: this.base, tail: this.tail, messages };
		return messages;
	}

	getState(): SessionState {
		const live =
			this.statusValue === "submitted" || this.statusValue === "streaming"
				? { executions: this.executions, inFlight: true, streamingIds: this.streamingIds }
				: undefined;
		const messages = this.nativeHistory();
		const latest = failedResponseAtEnd(messages);
		// Los marcadores de presentación/compactación no resuelven un fallo. Al
		// reintentar, oculta el banner antiguo desde el primer fotograma de Thinking,
		// pero muestra de inmediato un fallo completado nuevo de este consumo.
		const providerError =
			latest !== undefined &&
			!this.incompleteUsageIds.has(latest.id) && (!live || latest.id === this.liveFailureId)
				? { message: latest.errorMessage ?? "An error occurred." }
				: null;
		return {
			messages: projectView(messages, live),
			nativeMessages: messages,
			canonicalMessages: this.base,
			hasConfirmedConversation: this.base.some(m => m.role === "user" || m.role === "assistant"),
			contextTokens: measuredContextTokens(messages, this.incompleteUsageIds),
			status: this.statusValue,
			evaluating: this.statusValue === "submitted" && this.evaluationOwner !== null && this.evaluationOwner === this.consumeAbort,
			reconciliation: this.reconciliationValue,
			pluginQuestionAvailability: this.pluginQuestionAvailability,
			pluginProblemAvailability: this.pluginProblemAvailability,
			error: this.errorValue ?? providerError,
			steerQueue: this.steerQueueValue,
		};
	}

	get status(): SessionStatus {
		return this.statusValue;
	}

	/** Modifica el estado del modelo + avisa (el hook re-renderiza). */
	private mutate(fn: () => void): void {
		fn();
		// Los parciales del SDK en streaming y las entradas del POST siguen siendo de quien llama. Desengancha
		// solo los datos nuevos, conservando los mensajes y contratos asentados que ya son inmutables.
		this.base = copyImmutableData(this.base);
		this.tail = copyImmutableData(this.tail);
		this.onChange?.();
	}

	private setStatus(status: SessionStatus): void {
		if (status === "submitted") { this.liveFailureId = null; this.invalidateCanonicalReads(); }
		this.statusValue = status;
		this.readyRef = status === "ready" && this.reconciliationValue === "ready";
		this.onChange?.();
	}

	private setError(message: string | null): void {
		this.errorValue = message === null ? null : { message };
		if (message !== null) this.automaticContinuationBlocked = true;
		this.onChange?.();
	}

	private invalidateCanonicalReads(): void { this.canonicalEpoch++; }

	private releaseImagePost(owner: AbortController | null): void {
		if (owner && this.imagePostOwner === owner) {
			this.imagePostOwner = null;
			// Un GET emitido durante el intervalo diferido no debe aterrizar más tarde.
			this.invalidateCanonicalReads();
		}
	}
	private retireImagePreview(owner: AbortController | null): void {
		if (!owner || this.imagePreview?.owner !== owner) return;
		const ids = this.imagePreview.ids;
		this.imagePreview = null;
		this.mutate(() => {
			this.tail = this.tail.filter(message => !ids.has(message.id));
			for (const id of ids) this.unconfirmedAnswers.delete(id);
		});
	}
	private imagePostPending(owner: AbortController, pending: boolean): void {
		if (!pending) { this.releaseImagePost(owner); return; }
		if (this.consumeAbort !== owner || this.latestRequest !== owner) return;
		this.imagePostOwner = owner;
		this.invalidateCanonicalReads();
	}

	/** Frontera compartida de lectura/adopción canónica. Una lectura obsoleta o cancelada
	 * localmente devuelve undefined, nunca una instantánea que quien llama pueda adoptar por su cuenta. */
	async readRecord(options: SessionRecordReadOptions = {}): Promise<SessionRecordSnapshot | undefined> {
		const ticket = ++this.canonicalIssued;
		const epoch = this.canonicalEpoch;
		const response = await this.fetchView(`/api/chats/${encodeURIComponent(this.chatId)}`, options.signal, options.recoveringDrop === true);
		if (!response.ok) {
			const detail = await response.text();
			if (options.tolerateHttpFailure) return undefined;
			throw new Error(detail || "Could not sync the saved session.");
		}
		let text: string;
		try { text = await response.text(); }
		catch (error) { if (options.recoveringDrop && !options.signal?.aborted) throw new StreamReadError(error); throw error; }
		const record = JSON.parse(text) as SessionRecordSnapshot;
		if (!Array.isArray(record.messages)) throw new Error("Could not sync the saved session.");
		if (epoch !== this.canonicalEpoch || ticket < this.canonicalAcknowledged || options.signal?.aborted || options.isCurrent?.() === false) return undefined;
		const mode = options.adoption ?? "replace";
		// Devolver undefined también impide que quien llama certifique un append/replace
		// diferido como autoridad canónica aplicada. No se encola ninguna instantánea obsoleta.
		if (mode !== "none" && this.imagePostOwner) return undefined;
		if (mode === "replace" && !options.allowInFlight && (this.statusValue === "submitted" || this.statusValue === "streaming")) return undefined;
		if (mode === "append") {
			if (!this.appendMessages(record.messages, record.pluginQuestionAvailability, true, record.pluginProblemAvailability)) return undefined;
			this.canonicalAcknowledged = Math.max(this.canonicalAcknowledged, ticket);
		} else if (mode === "replace") {
			this.canonicalAcknowledged = Math.max(this.canonicalAcknowledged, ticket);
			this.replaceMessages(record.messages, record.turnError, record.pluginQuestionAvailability, record.pluginProblemAvailability);
		}
		return record;
	}

	/** Adopción canónica de solo lectura: nunca envía un turno sustituto del profesor. */
	async reconcile(): Promise<boolean> {
		if (this.reconciliationTask && this.reconciliationOwner === this.consumeAbort && this.reconciliationConnectionGeneration === this.connectionGeneration) return this.reconciliationTask;
		this.reconciliationValue = "syncing";
		this.readyRef = false;
		this.onChange?.();
		const owner = this.consumeAbort;
		const connection = this.connectionGeneration;
		const isCurrent = () => this.consumeAbort === owner && this.connectionGeneration === connection;
		const epoch = this.canonicalEpoch;
		const requiredTicket = this.canonicalIssued + 1;
		this.reconciliationOwner = owner;
		this.reconciliationConnectionGeneration = connection;
		let task!: Promise<boolean>;
		task = (async () => {
			try {
				const record = await this.readRecord({ allowInFlight: true, isCurrent });
				if (!isCurrent()) return false;
				if (this.canonicalEpoch !== epoch) throw new Error("Canonical read was invalidated.");
				// Un GET más reciente adoptado con éxito también es autoridad; una lectura
				// solo emitida/pendiente no puede suprimir esta respuesta terminal.
				if (!record && this.canonicalAcknowledged < requiredTicket) return false;
				this.reconciliationValue = "ready";
				this.readyRef = this.statusValue === "ready";
				return true;
			} catch {
				if (!isCurrent()) return false;
				if (this.canonicalEpoch === epoch && this.canonicalAcknowledged >= requiredTicket) {
					this.reconciliationValue = "ready";
					this.readyRef = this.statusValue === "ready";
					return true;
				}
				this.reconciliationValue = "failed";
				this.readyRef = false;
				return false;
			} finally {
				if (this.reconciliationTask === task) this.reconciliationTask = null;
				if (isCurrent()) this.onChange?.();
			}
		})();
		this.reconciliationTask = task;
		return task;
	}

	pluginProblemDraft(snapshot: PluginProblemSnapshot): PluginProblemDraft {
		let draft = this.pluginProblemDrafts.get(snapshot.problemId);
		if (!draft) { draft = { submission: { status: "empty" }, thinking: "" }; this.pluginProblemDrafts.set(snapshot.problemId, draft); }
		return draft;
	}

	pluginQuestionDraft(snapshot: PluginQuestionSnapshot): PluginQuestionDraft {
		const key = pluginQuestionOccurrenceKey(snapshot.occurrence);
		let draft = this.pluginQuestionDrafts.get(key);
		if (!draft) { draft = { answer: { status: "empty" }, thinking: "", readingThinking: "" }; this.pluginQuestionDrafts.set(key, draft); }
		return draft;
	}

	async dismissPluginQuestion(occurrence: PluginQuestionOccurrence, questionId?: string): Promise<void> {
		if (!this.readyRef) return;
		const current = pluginQuestionCallsOf(this.base).find(call => (call.status === "answerable" || call.status === "unreadable") && samePluginQuestionOccurrence(call.occurrence, occurrence));
		if (!current || (current.snapshot ? current.snapshot.questionId !== questionId : current.annotation.status !== "unreadable" || (questionId !== undefined && (current.annotation.binding?.questionId ?? current.annotation.identity?.questionId) !== questionId))) return;
		this.setStatus("submitted");
		try {
			const response = await this.fetch(`/api/chats/${encodeURIComponent(this.chatId)}/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { type: "dismiss-plugin-question", occurrence, ...(questionId ? { questionId } : {}) } }) });
			if (!response.ok) throw new Error("The dismissal failed.");
			await response.text();
			this.invalidateCanonicalReads();
			await this.reconcile();
		} catch (error) { this.setError((error as Error).message); }
		finally { this.setStatus("ready"); }
	}

	/** El fetch de reintento por identidad ante 409 (el contrato de la oleada
	 *  B): el evento nunca se persistió (la persistencia anticipada solo ocurre
	 *  al aceptarse), así que el reintento espera a que acabe el turno en marcha
	 *  y vuelve a hacer POST del MISMO cuerpo. Las respuestas a preguntas de
	 *  plugins quedan excluidas: un rechazo por ocupado necesita un reintento
	 *  explícito, nunca un segundo intento automático de corrección. */
	async postInputEvent(input: ChatInput, signal?: AbortSignal, onPostPending?: (pending: boolean) => void): Promise<Response> {
		const body = JSON.stringify({ chatId: this.chatId, input });
		const init: RequestInit = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			signal,
		};
		const post = async () => {
			onPostPending?.(true);
			try { return await this.fetch("/api/chat", init); }
			finally { onPostPending?.(false); }
		};
		let response = await post();
		if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") return response;
		let waited = 0;
		while (response.status === 409) {
			await response.body?.cancel().catch(() => {});
			if (signal?.aborted || waited >= this.waitMaxMs) return response;
			await delay(this.pollMs, signal);
			waited += this.pollMs;
			if (signal?.aborted) return response;
			if ((await turnInFlight(this)) !== false) continue;
			response = await post(); // puede dar 409 otra vez → bucle
		}
		return response;
	}

	/**
	 * UNA aplicación de eventos para el stream del POST y para la repetición
	 * del reenganche (los eventos de pi llevan el mensaje parcial COMPLETO —
	 * una vista SUSTITUYE, nunca ensambla deltas). Devuelve si el evento hizo
	 * TRABAJO DE VISTA: el consumo pasa de submitted a streaming en el primer
	 * evento que ACTÚA, no en el primer byte del cable — agent_start/turn_start
	 * no liberan nada, así que el provisional Thinking… (condicionado a
	 * submitted) cubre todo el hueco de conexión con el proveedor (responsable,
	 * ronda optimista 3, 2026-10-02).
	 */
	applyWireEvent(event: Record<string, unknown>): boolean {
		if (event.type === "error") {
			// Fallo a nivel de bucle (agent.continue lanzó fuera del stream) —
			// texto en bruto (decisión del responsable, oleada D): el banner muestra exactamente esto.
			this.setError(String(event.errorText ?? "An error occurred."));
			return false;
		}
		const agent = event as unknown as AgentEvent;
		switch (agent.type) {
			case "agent_start":
				// Prueba positiva de un turno nuevo/repetido propiedad del servidor. Cualquier
				// fallo posterior en esa repetición vuelve a bloquear la continuación.
				this.automaticContinuationBlocked = false;
				if (this.errorValue !== null) this.setError(null);
				return false;
			case "message_start":
			case "message_update":
			case "message_end": {
				const message = agent.message as LhMessage & {
					role?: string;
					id?: string;
				};
				if ((message as { role?: string }).role !== "assistant") {
					// Oleada C: los marcadores inyectados a mitad de ejecución (la entrega de
					// seguimiento de pi) llegan como eventos message_start/message_end de rol custom -
					// UPSERT por id (los marcadores siempre llevan ids steer_<id>; nunca hay eventos
					// sin id que no sean del asistente - los mensajes inyectados emiten solo
					// start+end, sin parciales de streaming). Sin esto el stream en vivo
					// perdía el marcador hasta la sincronización al asentarse.
					const mid = message.id;
					if (mid === undefined) return false;
					// La adopción/nueva petición puede traer ya este mensaje duradero antes de
					// que se repitan su start/end. El registro es dueño de esa identidad;
					// añadirlo a la cola lo duplicaría hasta la siguiente sincronización.
					if (this.base.some((m) => m.id === mid)) return false;
					this.mutate(() => {
						const idx = this.tail.findIndex((m) => m.id === mid);
						this.tail =
							idx === -1 ? [...this.tail, message as LhMessage] : this.tail.with(idx, message as LhMessage);
					});
					return true;
				}
				// pi emite los AssistantMessage en streaming SIN id — el id solo existe
				// cuando persistTurn del servidor sella el registro (el fallo del streaming
				// en vivo, 2026-09-26: generar un id nuevo por evento hacía que cada
				// message_update AÑADIERA una copia completa — un divisor + bloque de thinking
				// por fragmento, que solo limpiaba la sincronización al asentarse). El
				// mensaje en curso se sigue en cambio por RANURA: message_start
				// genera y recuerda el id; las actualizaciones y el end SUSTITUYEN esa
				// misma entrada de la cola. Exactamente un mensaje del asistente se emite a
				// la vez (el orden estricto start → updates → end de pi en cada paso; la
				// repetición del reenganche reproduce la misma secuencia), así que la ranura
				// no es ambigua. Un message.id explícito (si alguna vez aparece en
				// el cable) sigue ganando.
				const id = message.id ?? this.streamingMessageId ?? localId();
				const withId = { ...message, id } as LhMessage;
				if (agent.type === "message_end") {
					this.incompleteUsageIds.delete(id);
					if (message.role === "assistant" && message.stopReason === "error") {
						this.liveFailureId = id;
						// Un fallo más reciente del proveedor sustituye a un error anterior de
						// conexión/bucle, igual que hacía el message_end en vivo antes de la restauración.
						this.errorValue = null;
					}
				} else this.incompleteUsageIds.add(id);
				if (agent.type === "message_start") {
					this.streamingMessageId = id;
					this.streamingIds.add(id);
					this.mutate(() => {
						this.tail = [...this.tail, withId];
					});
				} else {
					this.mutate(() => {
						const idx = this.tail.findIndex((m) => m.id === id);
						this.tail = idx === -1 ? [...this.tail, withId] : this.tail.with(idx, withId);
					});
				}
				if (agent.type === "message_end") {
					this.streamingMessageId = null; // ranura terminada — el siguiente start genera uno nuevo
				}
				return true; // un evento de mensaje es trabajo de vista, aunque el contenido esté vacío
			}
			case "tool_execution_end": {
				// La capa de ejecución: los provisionales limpios de pregunta se IGNORAN
				// más adelante (view.ts, bifurcación 2); los errores conservan su texto de validación.
				const result = agent.result as
					| Pick<ToolResultMessage, "content" | "details">
					| null;
				const text = result?.content?.find((c) => c.type === "text")?.text ?? "The tool call failed.";
				this.mutate(() => {
					this.executions = new Map(this.executions).set(agent.toolCallId, {
						isError: agent.isError,
						output: result?.details,
						errorText: text,
						...(result ? { result: { content: result.content, details: result.details, isError: agent.isError } } : {}),
					});
				});
				return true; // la capa de ejecución actualizó la tarjeta de la parte de herramienta
			}
			case "turn_end": {
				// El lote de resultados: se añade como mensajes nativos (ids sellados en el
				// cliente — la sincronización al asentarse trae el canon del servidor).
				this.mutate(() => {
					this.tail = [
						...this.tail,
						...(agent.toolResults as ToolResultMessage[]).map(
							(r) => ({ ...r, id: localId() }) as unknown as LhMessage,
						),
					];
				});
				return true;
			}
			default:
				return false; // agent_start/turn_start/tool_execution_start|update: sin trabajo de vista
		}
	}

	/** Consume un cuerpo SSE hasta su terminal [DONE]. El terminal turn-settled
	 *  (solo en la ruta de stream) dispara el hook de asentamiento y termina. */
	async consumeStream(res: Response, controller = this.consumeAbort, allowRecovery = true): Promise<void> {
		if (!res.body) throw new Error("The turn stream body is empty.");
		const reader = res.body.getReader();
		let sawEvent = false;
		let sawDone = false;
		try {
			const events = sseEvents(reader);
			for (;;) {
				let next: IteratorResult<Record<string, unknown>, boolean>;
				try { next = await events.next(); }
				catch (err) {
					if (err instanceof StreamReadError) break;
					throw err;
				}
				if (this.consumeAbort !== controller) return;
				if (next.done) { sawDone = next.value; break; }
				const event = next.value;
				if (event.type === "turn-settled") {
					// El terminal de asentamiento en carrera: no hay turno al que engancharse — el
					// registro está al día; el hook de asentamiento lo vuelve a pedir.
					sawDone = true;
					return;
				}
				const acted = this.applyWireEvent(event);
				if (!sawEvent && acted) {
					sawEvent = true;
					if (this.statusValue !== "error") this.setStatus("streaming");
				}
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
			// Un consumo cancelado puede terminar después de que su sustituto haya entrado
			// en Thinking. Solo el responsable actual puede asentar el estado compartido.
			if (this.consumeAbort === controller) {
				this.streamingIds = new Set();
				this.executions = new Map();
				if (sawDone) {
					// No expongas las anotaciones en vivo como autoridad canónica del editor.
					await this.reconcile();
					if (this.consumeAbort === controller && this.statusValue !== "error") this.setStatus("ready");
					if (this.consumeAbort === controller && this.reconciliationValue === "ready") this.onReattachSettled?.();
				}
			}
		}
		if (this.consumeAbort !== controller || sawDone) return;
		if (!allowRecovery) throw new StreamReadError(new Error(STREAM_DROPPED));
		// Una recuperación de solo lectura: refresca la base canónica y luego repite el
		// MISMO turno propiedad del servidor. Nunca vuelvas a enviar la entrada del alumno.
		await this.resumeStream(true, false);
	}

	private async fetchView(url: string, signal: AbortSignal | undefined, recoveringDrop: boolean): Promise<Response> {
		try {
			const res = await this.fetch(url, { signal });
			if (recoveringDrop && !res.ok) throw new Error((await res.text()) || STREAM_DROPPED);
			return res;
		} catch (err) {
			if (recoveringDrop && !signal?.aborted) throw new StreamReadError(err);
			throw err;
		}
	}

	/**
	 * Reenganche (la ruta de despertar/traspaso/montaje): un turno en el
	 * servidor sin ninguna vista nuestra en vivo. PRIMERO ENGANCHAR (responsable,
	 * ronda de reenganche 2026-10-02): un reenganche en un montaje nuevo pasa
	 * refetchRecordFirst=false — el render de la página acaba de leer el
	 * registro, así que el viaje de ida y vuelta bloqueante para pedirlo solo
	 * añadía latencia de negociación antes de la repetición instantánea; el
	 * parcial del turno en marcha vive únicamente en el registro de eventos del
	 * servidor, y la repetición lo reconstruye se vuelva a pedir o no. Los
	 * llamadores a mitad de sesión (la vigilancia del traspaso) mantienen el
	 * valor por defecto: su base puede ir por detrás del registro, y la nueva
	 * petición la absorbe (adopción de la persistencia anticipada) antes de que
	 * la repetición caiga encima. El stream repite entonces el turno desde su
	 * primer evento por la MISMA ruta de consumo.
	 */
	async resumeStream(refetchRecordFirst = true, allowRecovery = true): Promise<void> {
		// Un reenganche externo deja sin efecto la propiedad de la vista previa de un POST sin resolver.
		// El reenganche normal tras el acuse conserva su vista previa hasta el intercambio atómico del registro.
		this.retireImagePreview(this.imagePostOwner);
		this.releaseImagePost(this.imagePostOwner);
		this.consumeAbort?.abort();
		const controller = new AbortController();
		this.consumeAbort = controller;
		this.latestRequest = controller;
		// REPETIR SOBRE UNA PIZARRA LIMPIA (responsable, ronda optimista 3, 2026-10-02):
		// el stream de reenganche repite el turno desde su PRIMER evento — un
		// intento anterior abortado (el remontaje simulado de StrictMode de React)
		// no debe dejar parciales que la repetición DUPLICARÍA. La antigua
		// nueva petición del registro daba este reinicio por casualidad; primero
		// enganchar lo hizo explícito.
		//
		// EL ARREGLO DEL PARPADEO (responsable, 2026-10-10 — seguimiento de la dieta de conexiones B):
		// en la ruta de NUEVA PETICIÓN el borrado NO debe preceder al fetch — send()
		// acaba de colocar en la cola las tarjetas optimistas de respuesta/nota, y
		// cualquier latencia de la nueva petición (se midieron parones de compilación
		// en desarrollo de 1,7s) volvía a mostrar la pregunta ya respondida durante
		// toda la ventana: la tarjeta desaparecía, el dock volvía y ambos solo se
		// recolocaban al llegar el registro. El bloque de nueva petición de abajo
		// intercambia base+cola de forma ATÓMICA cuando llega el registro (y borra si
		// falla — la guarda de pizarra limpia se mantiene en toda ruta que de verdad repite sobre una cola obsoleta).
		if (!refetchRecordFirst) {
			this.mutate(() => {
				this.incompleteUsageIds.clear();
				this.tail = [];
				this.streamingMessageId = null;
			});
		}
		this.setStatus("submitted");
		try {
			if (refetchRecordFirst) {
				const record = await this.readRecord({ signal: controller.signal, allowInFlight: true, recoveringDrop: !allowRecovery, tolerateHttpFailure: true, isCurrent: () => this.consumeAbort === controller });
				if (this.consumeAbort !== controller) return;
				if (!record) {
					// El registro no ha llegado — restaura la guarda de pizarra limpia
					// antes de la repetición (no va a haber intercambio atómico).
					this.mutate(() => {
						this.incompleteUsageIds.clear();
						this.tail = [];
						this.streamingMessageId = null;
					});
				}
			}
			const res = await this.fetchView(`/api/chats/${encodeURIComponent(this.chatId)}/stream`, controller.signal, !allowRecovery);
			if (this.consumeAbort !== controller) return;
			if (!res.ok) throw new Error((await res.text()) || "Failed to attach to the running turn.");
			await this.consumeStream(res, controller, allowRecovery);
		} catch (err) {
			if (this.consumeAbort !== controller || controller.signal.aborted) return; // cancelado a propósito
			this.retireImagePreview(this.imagePreview?.owner ?? null);
			// Una lectura fallida del registro puede dejar la respuesta optimista en la cola.
			// Restaura su indicación de Submit; el siguiente intento reconcilia primero.
			this.mutate(() => {
				this.tail = this.tail.filter(m => !this.unconfirmedAnswers.has(m.id));
				this.unconfirmedAnswers.clear();
			});
			this.setError(!allowRecovery && err instanceof StreamReadError ? STREAM_DROPPED : (err as Error).message);
			this.setStatus("error");
		}
	}

	/**
	 * SEND: un evento de entrada explícito. Primero los añadidos optimistas (la
	 * experiencia instantánea de respuesta/nota — la persistencia anticipada del
	 * servidor guarda el canon), luego POST + consumo. Condicionado a ready: un
	 * turno por cliente a la vez (el 409 del servidor + el reintento por
	 * identidad cubren la ventana de carrera del despertar).
	 */
	async send(input: ChatInput, onAccepted?: () => void, questionKey?: string, onDeliverySettled?: () => void): Promise<boolean> {
		let deliverySettled = false;
		const settleDelivery = () => { if (!deliverySettled) { deliverySettled = true; onDeliverySettled?.(); } };
		const refused = () => { settleDelivery(); return false; };
		const recovering = this.statusValue === "error";
		if (this.reconciliationValue !== "ready" || (!this.readyRef && !recovering)) return refused();
		const pluginPending = pendingPluginQuestionOf(this.base);
		if (!pluginPending && pluginQuestionCallsOf(this.base).some(call => call.status === "unreadable")) return refused();
		if (pluginPending) {
			if (this.pluginQuestionAvailability?.questionId !== pluginPending.questionId || this.pluginQuestionAvailability.status !== "available") return refused();
			if (input.type !== "plugin-question-answer" || input.questionId !== pluginPending.questionId || !samePluginQuestionOccurrence(input.occurrence, pluginPending.occurrence)) return refused();
		} else if (input.type === "plugin-question-answer") return refused();
		if (input.type === "plugin-problem-submission") {
			const active = activeProblemOf(this.base)?.pluginProblem, occurrence = activeProblemOccurrenceOf(this.base);
			if (!active || active.problemId !== input.problemId || !occurrence || !samePluginQuestionOccurrence(occurrence, input.occurrence) ||
				this.pluginProblemAvailability?.problemId !== active.problemId || this.pluginProblemAvailability.status !== "available") return refused();
		}
		if (input.type === "thinking" && activeProblemOf(this.base)?.pluginProblem) return refused();
		const subject = input.type === "answer" ? pendingQuestionOf(this.nativeHistory()) : null;
		// Una respuesta con ámbito de render no debe pasar a otra aparición que comparta
		// su id. Esta identidad es solo local; el cable del servidor no cambia.
		if (input.type === "answer" && questionKey !== undefined &&
			(subject?.key !== questionKey || subject.toolCallId !== input.toolCallId)) return refused();
		const expectedKey = questionKey ?? (input.type === "answer" && subject?.toolCallId === input.toolCallId ? subject.key : undefined);
		const imageBearing = input.type === "text" || input.type === "thinking" ? !!input.images?.length
			: input.type === "answer" ? Object.values(input.answer.images ?? {}).some(images => images?.length)
				: (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") && Object.values(input.images ?? {}).some(images => images?.length);
		this.retireImagePreview(this.imagePreview?.owner ?? null);
		this.releaseImagePost(this.imagePostOwner);
		this.consumeAbort?.abort();
		const controller = new AbortController();
		this.consumeAbort = controller;
		this.latestRequest = controller;
		this.evaluationOwner = (input.type === "plugin-question-answer" && pluginPending?.requiresGrading) ||
			(input.type === "plugin-problem-submission" && activeProblemOf(this.base)?.pluginProblem?.requiresProcessing) ? controller : null;
		this.setError(null);
		this.setStatus("submitted");
		if (recovering && input.type === "answer") {
			try {
				const record = await this.readRecord({ signal: controller.signal, allowInFlight: true, isCurrent: () => this.consumeAbort === controller });
				if (this.consumeAbort !== controller || !record) return refused();
				// Sin registro/vida del turno verificados: conserva el borrador y nunca supongas
				// si un acuse perdido significaba que la entrada se aceptó.
				if (!Array.isArray(record.messages) || typeof record.turnInFlight !== "boolean") throw new Error("An error occurred.");
				if (record.turnInFlight) {
					settleDelivery();
					await this.resumeStream(false);
					return false;
				}
				const current = pendingQuestionOf(record.messages);
				if (current?.toolCallId !== input.toolCallId || (expectedKey !== undefined && current.key !== expectedKey)) {
					// La llamada ya se resolvió, o ya no es dueña del dock. Adopta
					// la verdad, nunca hagas POST de esa respuesta una segunda vez.
					this.setStatus("ready");
					return refused();
				}
			} catch (err) {
				if (this.consumeAbort !== controller || controller.signal.aborted) return refused();
				this.setError((err as Error).message);
				this.setStatus("error");
				return refused();
			}
		}
		if (input.type !== "continue") this.automaticContinuationBlocked = false;
		// Los añadidos optimistas — exactamente los mensajes que la persistencia
		// anticipada del servidor guardará (inputAppends), con ids LOCALES para que
		// la adopción pueda distinguirlos de las copias absorbidas del registro.
		const optimistic: LhMessage[] = [];
		if (input.type === "text") optimistic.push({ ...newUserMessage(input.text, input.images), id: localId() });
		else if (input.type === "thinking") {
			// Los envíos de práctica (2026-10-04): el marcador llega
			// de forma optimista — la tarjeta se renderiza a partir de sus details en
			// el instante en que se pulsa el botón.
			optimistic.push({ ...newThinkingMessage(input.problemCallId, input.text, input.images), id: localId() });
		} else if (input.type === "next") {
			// La señal de pasar a otro (ronda 16 del responsable): la línea NEXT PROBLEM
			// se renderiza en el instante en que se pulsa el chip/Enter.
			optimistic.push({ ...newNextMessage(), id: localId() });
		} else if (input.type === "answer") {
			const tool = pendingCallTool(this.nativeHistory(), input.toolCallId) ?? "quiz";
			const result = { ...newAnswerResult(input.toolCallId, tool, input.answer), id: localId() };
			optimistic.push(result);
			this.unconfirmedAnswers.set(result.id, expectedKey ?? input.toolCallId);
		}
		if (optimistic.length > 0) this.mutate(() => {
			this.tail = [...this.tail, ...optimistic];
		});
		if (imageBearing) this.imagePreview = { owner: controller, ids: new Set(optimistic.map(message => message.id)) };
		let accepted = false;
		try {
			// LOS ENVÍOS NO SE PUEDEN ABORTAR AL DESMONTAR LA VISTA (responsable, 2026-10-10 —
			// el análisis post mortem del inicio de sesión muerto): el POST NO debe ir con
			// consumeAbort. El abort al desmontar de la dieta A (el stop() de session.ts)
			// se dispara con el remontaje simulado de StrictMode de React en desarrollo — mataba
			// el primer envío de ?prompt a los ~8ms (POST abortado, nunca reintentado:
			// la guarda sentInitial de la página ya se había activado), dejando la
			// sesión muerta hasta un segundo mensaje, que entonces se persistía
			// SIN el primero — la cola optimista iba sobre un registro que nunca lo
			// contuvo. Normalmente el POST es un acuse corto de la dieta B. Una respuesta de
			// plugin con corrección espera en cambio la corrección y el guardado (contención de
			// conexiones aceptada), pero aun así no debe heredar el desmontaje de la vista. El
			// consumo del STREAM sigue en el controlador — liberar esa conexión
			// retenida es todo el trabajo de la dieta A.
			let res: Response;
			try {
				res = await this.postInputEvent(input, undefined, imageBearing ? pending => this.imagePostPending(controller, pending) : undefined);
			} finally {
				// La respuesta llega tras el procesamiento y el guardado opcionales. Una petición
				// desenganchada o superada nunca debe borrar la etiqueta de su sucesora.
				if (this.evaluationOwner === controller) this.mutate(() => { this.evaluationOwner = null; });
			}
			if (res.status === 409) {
				settleDelivery();
				throw new Error("A turn is already running — try again in a moment.");
			}
			if (!res.ok) {
				settleDelivery();
				// Conserva literales los sobres de rechazo de modelo/clave: el flujo de rechazo
				// de la página los analiza. Los 400 de Retry son indicaciones normales
				// para el usuario, así que muestra su texto de error sin sintaxis JSON.
				let message = (await res.text()) || `The send failed (${res.status}).`;
				if ((input.type === "retry" || input.type === "retry-question") && res.status === 400) {
					try {
						const refusal = JSON.parse(message) as { error?: unknown } | null;
						if (typeof refusal?.error === "string" && refusal.error.length > 0) message = refusal.error;
					} catch { /* Los fallos sin sobre conservan su texto original. */ }
				}
				throw new Error(message);
			}
			accepted = true;
			// La aceptación acota las lecturas que pertenecen a ESTA acción, pero un POST
			// desenganchado y retrasado no puede invalidar el GET terminal de un stream sustituto.
			if (this.latestRequest === controller) this.invalidateCanonicalReads();
			// El traspaso del mensaje de apertura termina en la aceptación, no al completarse el stream.
			onAccepted?.();
			settleDelivery();
			// DIETA DE CONEXIONES B (responsable, 2026-10-10 — análisis post mortem del
			// bloqueo con sesiones en paralelo): el POST acusa recibo y cierra; no hay stream
			// que consumir en esta respuesta. Engánchate por el MISMO cable de reenganche
			// que usa quien vuelve a la sesión (primero la nueva petición: la nueva petición del registro absorbe
			// la copia de la persistencia anticipada del servidor de nuestros mensajes optimistas, y luego la
			// repetición cae encima). Una conexión de vista viva por página, siempre —
			// el grupo de 6 por origen del navegador es el recurso escaso.
			await res.text().catch(() => {}); // vacía el acuse diminuto; libera el socket
			// Un stop() o un send/consumo más reciente ganó mientras el acuse estaba en
			// vuelo: el turno sigue vivo en el servidor de todos modos — no enganches
			// un stream desde una vista que ya no está o ha sido superada.
			if (this.consumeAbort !== controller) return true;
			await this.resumeStream(true);
			return true;
		} catch (err) {
			settleDelivery();
			if (imageBearing && !accepted) this.retireImagePreview(controller);
			const failedOpening = input.type === "text" && onAccepted !== undefined && !accepted;
			if (failedOpening) {
				// El POST sobrevive a stop(), incluida la limpieza de StrictMode. Quita
				// solo su propia burbuja optimista fallida aunque haya ganado una petición
				// más reciente; nunca toques los mensajes canónicos ni la cola de otro intento.
				const ids = new Set(optimistic.map(m => m.id));
				this.mutate(() => { this.tail = this.tail.filter(m => !ids.has(m.id)); });
			}
			const detachedOpening = failedOpening && this.consumeAbort === null && this.latestRequest === controller;
			if ((this.consumeAbort !== controller || controller.signal.aborted) && !detachedOpening) return accepted;
			// Un rechazo de apertura desenganchado aún debe llegar a la recuperación de
			// configuración existente del montaje repetido. Un send/reenganche más reciente SIEMPRE es
			// dueño de los errores y del estado, aunque esa petición se haya detenido desde entonces.
			// El comportamiento normal de desmontaje con texto y respuestas no cambia.
			if (input.type === "answer") {
				const ids = new Set(optimistic.map(m => m.id));
				this.mutate(() => {
					this.tail = this.tail.filter(m => !ids.has(m.id));
					for (const id of ids) this.unconfirmedAnswers.delete(id);
				});
			}
			this.setError((err as Error).message);
			this.setStatus("error");
			if (imageBearing && !accepted && this.latestRequest === controller) {
				// Tanto el rechazo como el acuse perdido se reconcilian en solo lectura. La verdad
				// canónica no es una notificación de aceptación y nunca borra borradores.
				await this.readRecord({ allowInFlight: true, isCurrent: () => this.latestRequest === controller && (this.consumeAbort === controller || detachedOpening) }).catch(() => {});
			}
			// true significa que observamos el acuse de este POST. false NO
			// prueba que no se entregara: un fallo de red puede ocultar la aceptación.
			// Quien envía el mensaje de apertura restaura un borrador, nunca reintenta automáticamente.
			return accepted;
		}
	}

	/**
	 *  STEER (reorientación desde el composer, arco del responsable 2026-10-03):
	 *  el mensaje del alumno a mitad de turno para el turno EN MARCHA. NO es un
	 *  turno — sin tarjeta optimista en la transcripción, sin cambio de estado:
	 *  el mensaje se suma al indicador de cola (la línea discreta encima del
	 *  composer) y hace POST a la ruta de reorientación, que lo entrega a la cola
	 *  de reorientaciones del agente vivo. Cuando pi la vacía en el siguiente
	 *  límite de respuesta, los eventos de mensaje literales insertan o
	 *  actualizan la tarjeta real (la clave es el id generado en el cliente) y el
	 *  plegado del indicador quita la línea. Un 409 significa que el turno se
	 *  asentó a mitad del envío (la carrera): se recurre al envío de texto normal
	 *  — la entrada se descarta y send() pone su propia tarjeta optimista.
	 */
	async steer(text: string, images?: import("../src/core/plugin-submissions.ts").PluginSubmissionContent["images"], onAccepted?: () => void, onDeliverySettled?: () => void): Promise<boolean> {
		let deliverySettled = false;
		const settleDelivery = () => { if (!deliverySettled) { deliverySettled = true; onDeliverySettled?.(); } };
		const t = text.trim();
		if (!t && !images?.length) { settleDelivery(); return false; }
		this.invalidateCanonicalReads();
		const id = `steer_${localId()}`;
		this.steerQueueValue = [...this.steerQueueValue, { id, text: t }];
		this.onChange?.();
		const dropSteer = () => {
			this.steerQueueValue = this.steerQueueValue.filter((s) => s.id !== id);
			this.onChange?.();
		};
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/steer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "steer", id, text: t, ...(images?.length ? { images } : {}) } }),
			});
			if (res.ok) { this.invalidateCanonicalReads(); onAccepted?.(); settleDelivery(); await res.text().catch(() => {}); return true; } // aparcada o entregada — el stream trae la tarjeta
			if (res.status === 409) {
				dropSteer();
				return await this.send({ type: "text", text: t, ...(images?.length ? { images: images.map(image => ({ ...image })) } : {}) }, onAccepted, undefined, settleDelivery); // reutiliza la carga ya preparada
			}
			dropSteer();
			settleDelivery();
			this.setError((await res.text()) || `The steer failed (${res.status}).`);
		} catch (err) {
			dropSteer(); settleDelivery();
			this.setError((err as Error).message);
		}
		return false;
	}

	/** La ruta de la respuesta (el dock): la respuesta ES el resultado de
	 *  herramienta de la llamada de la pregunta (bifurcación 1), viajando como su evento de entrada. */
	submitAnswer(tool: string, toolCallId: string, output: QuestionAnswerData, questionKey?: string): Promise<void> {
		void tool;
		return this.send({ type: "answer", toolCallId, answer: output }, undefined, questionKey).then(() => undefined);
	}

	/** La ruta del descarte (diseño del responsable 2026-10-03, "A2"): el
	 * toolResult omitido llega de forma optimista y luego la ruta SILENCIOSA lo
	 * persiste — sin turno, sin stream, no despierta nada. La sesión se pausa a
	 * elección del usuario; el siguiente envío normal es el despertar. Si falla,
	 * gana el registro duradero: el error aparece y la sincronización por cambio
	 * del registro (o cualquier nueva petición posterior) sustituye el añadido
	 * optimista por la verdad. */
	async dismissQuestion(toolCallId: string, answer: QuestionAnswerData, questionKey?: string): Promise<void> {
		if (!this.readyRef || pluginQuestionCallsOf(this.base).some(call => call.status === "answerable" || call.status === "unreadable")) return;
		const subject = pendingQuestionOf(this.nativeHistory());
		if (questionKey !== undefined && (subject?.key !== questionKey || subject.toolCallId !== toolCallId)) return;
		const tool = pendingCallTool(this.nativeHistory(), toolCallId) ?? "quiz";
		this.invalidateCanonicalReads();
		this.mutate(() => {
			this.tail = [...this.tail, { ...newAnswerResult(toolCallId, tool, answer), id: localId() }];
		});
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/dismiss`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "dismiss", toolCallId, answer } }),
			});
			if (!res.ok) throw new Error(`The dismissal failed (${res.status}).`);
			this.invalidateCanonicalReads();
		} catch (err) {
			this.setError((err as Error).message);
		}
	}

	/** El descarte del problema (sesiones de práctica, responsable 2026-10-04):
	 *  el descarte al estilo ask — el marcador solo de interfaz llega de forma
	 *  optimista y luego la ruta SILENCIOSA lo persiste (sin turno, sin
	 *  despertar). El composer vuelve; la síntesis de conclusión viaja con la
	 *  siguiente entrada del usuario. */
	async dismissProblem(problemCallId: string): Promise<void> {
		if (!this.readyRef) return;
		this.invalidateCanonicalReads();
		this.mutate(() => {
			this.tail = [...this.tail, { ...newProblemDismissedMarker(problemCallId), id: localId() }];
		});
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/dismiss`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "dismiss-problem", problemCallId } }),
			});
			if (!res.ok) throw new Error(`The dismissal failed (${res.status}).`);
			this.invalidateCanonicalReads();
		} catch (err) {
			this.setError((err as Error).message);
		}
	}

	/** Desenganche local: cancela el consumo y conserva la cola parcial. La
	 *  vigilancia de asentamiento de la página adopta el registro cuando termina el turno del servidor. */
	stop(): void {
		this.connectionGeneration++;
		this.retireImagePreview(this.imagePreview?.owner ?? null);
		this.releaseImagePost(this.imagePostOwner);
		this.invalidateCanonicalReads();
		this.consumeAbort?.abort();
		this.consumeAbort = null;
		this.streamingIds = new Set();
		this.streamingMessageId = null;
		this.executions = new Map();
		this.setStatus("ready");
	}

	/** Las instantáneas de los envíos sobreviven al dock, no al montaje de la sesión. */
	questionDraft(questionKey: string): QuestionDraft | undefined {
		return this.questionDrafts.get(questionKey);
	}

	saveQuestionDraft(questionKey: string, draft: Partial<QuestionDraft>): void {
		this.questionDrafts.set(questionKey, { ...this.questionDrafts.get(questionKey), ...draft });
	}

	private forgetResolvedDrafts(record: readonly LhMessage[]): void {
		const pendingKey = pendingQuestionOf(record)?.key;
		for (const key of this.questionDrafts.keys()) {
			if (key !== pendingKey) this.questionDrafts.delete(key);
		}
		for (const [id, key] of this.unconfirmedAnswers) {
			if (key !== pendingKey) this.unconfirmedAnswers.delete(id);
		}
	}

	/** Intercambio completo de instantánea (la sincronización al asentarse en reposo — canon del servidor). */
	setMessages(record: LhMessage[], turnError?: string, availability?: PluginQuestionAvailability, problemAvailability?: PluginProblemAvailability): void {
		this.invalidateCanonicalReads();
		this.replaceMessages(record, turnError, availability, problemAvailability);
	}

	private replaceMessages(record: LhMessage[], turnError?: string, availability?: PluginQuestionAvailability, problemAvailability?: PluginProblemAvailability): void {
		if (this.imagePostOwner) return;
		record = copyImmutableData(record);
		this.mutate(() => {
			this.base = record;
			this.pluginQuestionAvailability = availability;
			this.pluginProblemAvailability = problemAvailability;
			const problemId = activeProblemOf(record)?.pluginProblem?.problemId;
			for (const key of this.pluginProblemDrafts.keys()) if (key !== problemId) this.pluginProblemDrafts.delete(key);
			if (turnError !== undefined) {
				this.errorValue = { message: turnError };
				this.automaticContinuationBlocked = true;
			}
			this.forgetResolvedDrafts(record);
			const pluginKeys = new Set(pluginQuestionCallsOf(record).map(call => pluginQuestionOccurrenceKey(call.occurrence)));
			for (const key of this.pluginQuestionDrafts.keys()) if (!pluginKeys.has(key)) this.pluginQuestionDrafts.delete(key);
			this.incompleteUsageIds.clear();
			this.tail = [];
			this.imagePreview = null;
			this.streamingMessageId = null; // la cola (y su ranura) ya no existen
		});
	}

	/**
	 * Adopción solo por añadido (la regla básica de reorientaciones/artefactos a
	 * mitad de turno): mete el registro — todo mensaje actual de la base debe
	 * seguir presente (el servidor solo añade) — conservando la cola viva, menos
	 * las entradas que el registro ya lleva por id y las entradas optimistas que
	 * ha absorbido (sus copias selladas por el servidor acaban de llegar; sin
	 * esto los mensajes se duplican).
	 */
	adoptRecord(record: LhMessage[]): void {
		this.invalidateCanonicalReads();
		this.appendMessages(record);
	}

	private appendMessages(record: LhMessage[], availability?: PluginQuestionAvailability, updateAvailability = false, problemAvailability?: PluginProblemAvailability): boolean {
		if (this.imagePostOwner) return false;
		record = copyImmutableData(record);
		const recordIds = new Set(record.map((m) => (m as { id?: string }).id));
		const baseAbsorbed = this.base.some((m) => !recordIds.has((m as { id?: string }).id));
		if (baseAbsorbed) return false; // no es un añadido puro — la sincronización completa en reposo es la red
		this.mutate(() => {
			this.base = record;
			if (updateAvailability) { this.pluginQuestionAvailability = availability; this.pluginProblemAvailability = problemAvailability; }
			this.forgetResolvedDrafts(record);
			this.tail = this.tail.filter((m) => !(typeof m.id === "string" && recordIds.has(m.id)) && !absorbed(m, record));
		});
		return true;
	}

	/** La continuación automática al montar/sincronizar nunca da permiso para reintentar un
	 * turno fallido. Lee la verdad actual del modelo, no un cierre obsoleto de React. */
	async continueIfOwed(record: readonly LhMessage[]): Promise<void> {
		if (this.readyRef && !this.automaticContinuationBlocked && this.getState().error === null && needsContinuation(record)) {
			await this.send({ type: "continue" });
		}
	}

	/** El plegado de continuación al montar/sincronizar (native-messages.ts). */
	static needsContinuation = needsContinuation;

	clearError(): void {
		this.setError(null);
	}
}
