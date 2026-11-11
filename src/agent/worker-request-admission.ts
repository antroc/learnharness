import type { AssistantMessage, AssistantMessageEvent, StreamFunction } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { markUnadmittedUsage } from "./subscription-request-cycle.ts";

const POOL_KEY = Symbol.for("lh.worker-request-admission.pool.v1");
const WRAPPED_KEY = Symbol.for("lh.worker-request-admission.wrapped.v1");
const DEFAULT_LIMIT = 8;
type Waiter = { state: "queued" | "active" | "cancelled"; grant: (release: () => void) => void; release?: () => void };
type Pool = { getLimit: () => number; limit: number; active: number; queue: Waiter[] };
const shared = globalThis as typeof globalThis & { [POOL_KEY]?: Pool };
// Se resuelve en el momento de uso y también entre copias del módulo; las pruebas pueden sustituir esta frontera
// por un pool global nuevo y en reposo sin introducir un segundo carril en producción.
function pool(): Pool {
	return shared[POOL_KEY] ??= { getLimit: () => DEFAULT_LIMIT, limit: DEFAULT_LIMIT, active: 0, queue: [] };
}
function validLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Worker request concurrency must be a positive whole integer");
	return value;
}
function drain(state: Pool): void {
	// Nunca llamar a código/getters de la aplicación mientras se libera un permiso. Un refresco
	// explícito fallido no debe dejar tiradas las peticiones activas ni a esperadores no relacionados.
	while (state.active < state.limit && state.queue.length) {
		const waiter = state.queue.shift()!;
		if (waiter.state !== "queued") continue;
		waiter.state = "active";
		state.active++;
		let released = false;
		const release = waiter.release = () => {
			if (released) return;
			released = true;
			waiter.state = "cancelled";
			state.active--;
			drain(state);
		};
		// Instalar la propiedad de la cancelación antes de pasar a la preparación del transporte.
		queueMicrotask(() => waiter.grant(release));
	}
}
function acquire(state: Pool, grant: Waiter["grant"]): () => void {
	const waiter: Waiter = { state: "queued", grant };
	state.queue.push(waiter);
	drain(state);
	return () => {
		if (waiter.state === "active") waiter.release!();
		else if (waiter.state === "queued") {
			waiter.state = "cancelled";
			state.queue.splice(state.queue.indexOf(waiter), 1);
		}
	};
}

/** Inyecta los ajustes sin importar código de stores/servidor. Los getters no válidos dejan intacta la configuración anterior. */
export function configureWorkerRequestAdmission(getLimit: () => number): void {
	const limit = validLimit(getLimit());
	const state = pool();
	state.getLimit = getLimit;
	state.limit = limit;
	drain(state);
}
/** Aumentar vacía la cola de inmediato; reducir nunca cancela trabajo ya admitido. */
export function refreshWorkerRequestAdmission(): void {
	const state = pool();
	const limit = validLimit(state.getLimit());
	state.limit = limit;
	drain(state);
}

type StreamArgs = Parameters<StreamFunction>;
type Terminal = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

/** Un único consumidor que tira de la fuente, sin cola de eventos copiada. Los productores nativos conservan
 * su propio búfer; los llamadores que solo quieren el resultado vacían y descartan en lugar de retener.
 * La observación del resultado de la fuente es independiente de la iteración aguas abajo, así que un
 * consumidor en pausa no puede retener el permiso de una petición al modelo ya completada. */
class WorkerRequestStream extends AssistantMessageEventStream {
	private source?: AssistantMessageEventStream;
	private iterator?: AsyncIterator<AssistantMessageEvent>;
	private partial?: AssistantMessage;
	private final?: AssistantMessage;
	private syntheticTerminal?: Terminal;
	private invoked = false;
	private constructing = false;
	private claimed = false;
	private cancelAdmission?: () => void;
	private readonly controller = new AbortController();
	private readonly ready: Promise<void>;
	private resolveReady!: () => void;
	private readonly signal?: AbortSignal;
	private readonly onAbort = () => this.cancel();

	constructor(private readonly streamFn: StreamFunction, private readonly args: StreamArgs) {
		super();
		this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
		this.signal = args[2]?.signal;
		this.signal?.addEventListener("abort", this.onAbort, { once: true });
		if (this.signal?.aborted) this.cancel();
		else this.cancelAdmission = acquire(pool(), (release) => {
			if (this.final) { release(); return; }
			// la función de cancelación de acquire es dueña de esta misma liberación idempotente.
			void this.start();
		});
	}

	private failure(aborted: boolean, error?: unknown): AssistantMessage {
		const model = this.args[0];
		const message: AssistantMessage = {
			...(this.partial ?? { role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }),
			stopReason: aborted ? "aborted" : "error",
			errorMessage: aborted ? "Worker model request cancelled" : error instanceof Error ? error.message : "Worker model request failed or ended without a terminal response",
		};
		// La invocación no prueba la facturación, pero una invocación fallida tampoco
		// prueba que NO hubo envío. Conservar el uso/la identidad nativos siempre que estén disponibles.
		if (!this.invoked) markUnadmittedUsage(message.usage);
		return message;
	}
	private finish(message: AssistantMessage, synthetic = false): void {
		if (this.final) return;
		this.final = message;
		if (synthetic) this.syntheticTerminal = { type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message };
		this.signal?.removeEventListener("abort", this.onAbort);
		this.cancelAdmission?.();
		// Liberar ANTES de resolver el resultado o de ceder ningún terminal a Agent/herramientas.
		super.end(message);
	}
	private stopSource(): void {
		this.controller.abort();
		// Signal/end son el contrato nativo de cancelación: despiertan las esperas del SDK y
		// descartan los push posteriores. Nuestras propias esperas están acotadas por separado;
		// no se puede forzar el cierre de la red real de un proveedor personalizado que no coopere.
		try { this.source?.end(this.final); } catch { /* la cancelación es de mejor esfuerzo */ }
		try { void Promise.resolve(this.iterator?.return?.()).catch(() => {}); } catch { /* ídem */ }
	}
	private cancel(): void {
		if (this.constructing && !this.final) {
			// Una factoría síncrona puede abortar a su llamador antes de devolver la
			// fuente. Entregar ya el aborto, pero observar el resultado nativo de esa fuente
			// devuelta antes de programar la cancelación sintética de abajo.
			this.controller.abort();
			return;
		}
		const complete = () => {
			if (!this.final) this.finish(this.failure(true), true);
			this.stopSource();
			this.resolveReady();
		};
		if (this.source && !this.final) {
			// Dar al terminal/resultado que proporciona de forma síncrona un manejador de aborto nativo
			// la primera opción, conservando su uso real en lugar de sustituirlo.
			this.controller.abort();
			queueMicrotask(complete);
		} else complete();
	}
	private async start(): Promise<void> {
		try {
			if (this.final) return;
			this.invoked = true;
			const [model, context, options] = this.args;
			// Se toleran los thenables en tiempo de ejecución para preparaciones defectuosas/personalizadas, aunque
			// el propio contrato nativo de StreamFunction devuelve de forma síncrona.
			let source: AssistantMessageEventStream;
			this.constructing = true;
			try { source = this.streamFn(model, context, { ...options, signal: this.controller.signal }); }
			finally { this.constructing = false; }
			const pendingSetup = typeof (source as unknown as { then?: unknown })?.then === "function";
			// La preparación asíncrona en tiempo de ejecución no es el contrato nativo. Puede no resolverse nunca;
			// no aplazar la cancelación mientras se espera una fuente no disponible.
			if (pendingSetup && this.controller.signal.aborted) this.cancel();
			this.source = pendingSetup ? await source : source;
			if (this.final) { this.stopSource(); return; }
			// PluginStream.result() arranca un vaciado que compite salvo que su iterador
			// se reclame PRIMERO. El result() nativo del SDK es pasivo de por sí.
			this.iterator = this.source[Symbol.asyncIterator]();
			void Promise.resolve(this.source.result()).then(
				(message) => this.finish(message),
				(error: unknown) => { this.finish(this.failure(false, error), true); this.stopSource(); },
			).catch(() => {});
			if (this.controller.signal.aborted) this.cancel();
		} catch (error) {
			this.finish(this.failure(this.controller.signal.aborted, error), true);
			this.stopSource();
		} finally { this.resolveReady(); }
	}
	private async next(): Promise<IteratorResult<AssistantMessageEvent>> {
		const signal = this.controller.signal;
		const aborted = () => new DOMException("Worker model request cancelled", "AbortError");
		if (signal.aborted) throw aborted();
		let onAbort!: () => void;
		const cancelled = new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(aborted());
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			// La carrera adjunta manejadores de rechazo al next() de la fuente aunque
			// se resuelva después de la cancelación. Sin consumidor extra ni historial en búfer.
			return await Promise.race([this.iterator!.next(), cancelled]);
		} finally { signal.removeEventListener("abort", onAbort); }
	}
	private async *events(): AsyncGenerator<AssistantMessageEvent> {
		let terminal = false;
		try {
			await this.ready;
			if (!this.iterator) {
				terminal = true;
				if (this.syntheticTerminal) yield this.syntheticTerminal;
				return;
			}
			while (true) {
				const next = await this.next();
				if (next.done) break;
				const event = next.value;
				if ("partial" in event) this.partial = event.partial;
				if (event.type === "done" || event.type === "error") {
					this.finish(event.type === "done" ? event.message : event.error);
					terminal = true;
				}
				yield event;
				if (terminal) return;
			}
			// end(message) es una finalización nativa válida solo de resultado. end() sin
			// mensaje deja tirado el result() nativo, así que nunca se espera en esta frontera.
			if (!this.final) this.finish(this.failure(false), true);
			terminal = true;
			if (this.syntheticTerminal) yield this.syntheticTerminal;
		} catch (error) {
			if (!this.final) this.finish(this.failure(this.controller.signal.aborted, error), true);
			terminal = true;
			if (this.syntheticTerminal) yield this.syntheticTerminal;
			else if (this.final?.stopReason === "error" || this.final?.stopReason === "aborted") {
				// Un resultado de aborto nativo puede ganar antes de que el next() acotado termine.
				// Conservar ese mensaje/uso real en lugar de fabricar un fallo.
				yield { type: "error", reason: this.final.stopReason, error: this.final };
			}
		} finally {
			if (!terminal) this.cancel();
			else this.stopSource();
		}
	}
	override [Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
		if (this.claimed) throw new Error("Worker request streams support one consumer");
		this.claimed = true;
		const iterator = this.events();
		// El return() de un generador asíncrono no iniciado se salta su bloque finally. Además,
		// cancelar ANTES de un next() pendiente, en lugar de encolar return detrás de él.
		const originalReturn = iterator.return.bind(iterator);
		iterator.return = (value) => { this.cancel(); return originalReturn(value); };
		return iterator;
	}
	// La cancelación existente de PluginStream cierra su fuente mediante end(message).
	// Tratar esa frontera pública del SDK también como limpieza de propiedad, no solo como resolución.
	override end(message?: AssistantMessage): void {
		if (!this.final) this.finish(message ?? this.failure(true), message === undefined);
		this.stopSource();
		this.resolveReady();
	}
	override result(): Promise<AssistantMessage> {
		if (!this.claimed) void (async () => {
			for await (const _event of this) { /* acotado: descartar, nunca retener */ }
		})().catch(() => {});
		return super.result();
	}
}

/** Idempotente entre módulos de Next duplicados, con metadatos compartidos explícitos. */
export function workerRequestStream(streamFn: StreamFunction): StreamFunction {
	if ((streamFn as StreamFunction & { [WRAPPED_KEY]?: boolean })[WRAPPED_KEY]) return streamFn;
	const wrapped: StreamFunction = (...args) => new WorkerRequestStream(streamFn, args);
	Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
	return wrapped;
}
