/**
 * EL PROCESO DE DESPERTAR (contracts.ts, "THE ASYNC PROTOCOL" §4): entrega
 * en el servidor de las reorientaciones de las tareas de subagente
 * terminadas. Oleada C (2026-09-26): la entrega va por la PROPIA cola de
 * reorientación de pi cuando hay una ejecución viva y, si no, por el
 * despertar en reposo. Un registro, dos vehículos.
 *
 *   deliverJobResult(steer): el ejecutor lo llama al terminar una tarea. La
 *     reorientación entra en un registro serializado por chat y la bomba la
 *     lleva por UNA de dos rutas:
 *
 *       1. EJECUCIÓN VIVA → reorientación de pi: el marcador se pasa a la
 *          cola de reorientación del agente VIVO (agent.steer). pi consulta
 *          esa cola en las FRONTERAS DE TURNO (tras un mensaje del asistente
 *          completado Y sus resultados de herramientas, nunca entre un
 *          toolCall y su resultado, y de nuevo al inicio de la ejecución: una
 *          continuación vacía la cola ANTES de su primera llamada al LLM) y
 *          CONTINÚA LA MISMA EJECUCIÓN: el marcador entra en el contexto a
 *          mitad de lección, viaja por el flujo de eventos en vivo
 *          (message_start/message_end) y llega al registro cuando esa
 *          ejecución persiste. Es la corrección del responsable del
 *          2026-09-26: una lección real es un único bucle continuo
 *          enseñar→quiz→enseñar, así que la entrega debe ocurrir ENTRE
 *          mensajes dentro de la ejecución; esperar a que la ejecución se
 *          detenga (seguimientos) solo dispara en una salida por parada, que
 *          es justo cuando no debe. La parada por pregunta se ejecuta ANTES
 *          de la consulta posterior al turno y sale del bucle, así que una
 *          ejecución terminada en quiz nunca inyecta: el marcador pasado se
 *          queda varado (ver settleSteers) y espera; la ejecución de la
 *          RESPUESTA lo recoge después en su consulta inicial. Los
 *          marcadores probe-handoff NUNCA toman esta ruta (decisión del
 *          responsable: el traspaso debe iniciar la ejecución del PROFESOR,
 *          una bifurcación a nivel de registro que solo un despertar nuevo
 *          puede hacer).
 *       2. DESPERTAR EN REPOSO: no hay turno vivo. ESPERAR AL REPOSO
 *          (turn-liveness O una pregunta colgada: una llamada a herramienta
 *          del cliente sin responder rompe la conversión del proveedor) y
 *          después disparar UN turno de despertar en el servidor que lleva
 *          TODOS los marcadores en cola como añadidos de su entrada
 *          (persistencia anticipada, vida del turno, extracción: una sola
 *          ruta de código, la misma composición que una petición del
 *          cliente). Un 409 significa que se coló un turno del cliente: se
 *          vuelve a encolar y se reintenta con espera creciente. Idempotente
 *          por jobId (steerDelivered): un despertar caído o una entrega
 *          duplicada se omiten, no se duplican.
 *
 *   settleSteers(chatId, persisted): el handler lo llama al asentarse el
 *     turno (tras unregisterLiveAgent): las entradas que la ejecución
 *     ENTREGÓ se resuelven y acusan la entrega; las entradas pasadas a la
 *     ejecución moribunda pero nunca inyectadas (salida por parada,
 *     cancelación, una consulta final perdida) vuelven a pendientes y la
 *     bomba se reinicia: nada varado, nada perdido.
 *
 *   El estado del worker termina cuando acaba el cálculo; JobRecord.delivery
 *     gestiona de forma independiente los avisos pendientes. Las entradas
 *     del registro sobreviven a los despertares en curso, así que los
 *     duplicados comparten una promesa. Los inicios fallidos siguen
 *     pendientes sin errores de worker. La recuperación restaura las
 *     entregas pendientes conocidas y solo vuelve a lanzar los workers
 *     INTEGRADOS sin terminar. La recuperación de plugins lee los registros
 *     canónicos de tareas mediante una frontera inyectada, sin volver a
 *     ejecutar nunca código de plugins. Las tareas terminales heredadas sin
 *     metadatos de entrega no se vuelven a reproducir.
 *
 * Todo el estado mutable vive en globalThis (la lección de turn-liveness: en
 * desarrollo, Next da a cada entrada de ruta sus propias instancias de
 * módulo; un Map a nivel de módulo sería un objeto distinto en cada una).
 */

import {
	buildAbortSteer,
	buildJobFailureSteer,
	buildSubagentSteer,
	isSubagentFailure,
	steerDelivered,
	type JobRecord,
	type SteerMessage,
} from "../core/contracts.ts";
import type { TurnInput, UserSteerInput } from "../core/input-events.ts";
import { hasUnresolvedQuestion, endsInDismissal, endsInQuestionRecovery, newUserSteer, type LhMessage } from "../core/native-messages.ts";
import { prepareSubmissionImages, submissionImagePolicyKey } from "./submission-images.ts";
import { fireJobAbort, isJobLive } from "../agent/subagents/aborts.ts";
import { stores, effectiveSettings } from "./stores.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { connectionBackgroundAllowed, isSubscriptionProvider, onSubscriptionChange } from "../agent/subscription-connections.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import type { Agent } from "@earendil-works/pi-agent-core";

/** Dispara un turno del profesor en el servidor: (chatId, input) → estado
 *  tipo HTTP. Oleada C: la entrada es el DESPERTAR EN REPOSO, con todos los
 *  marcadores en cola como añadidos de la entrada del turno (el handler los
 *  añade de forma nativa bajo la propia reclamación del turno del despertar;
 *  una composición para todos los turnos). */
export type TurnRunner = (chatId: string, input: TurnInput) => Promise<number>;

/** Vuelve a ejecutar el bucle del subagente de una tarea (recuperación de tareas huérfanas tras una caída). */
export type JobRespawn = (jobId: string) => void;
export type PluginJobRecovery = (job: JobRecord) => Promise<void>;
export function setPluginJobRecovery(recover: PluginJobRecovery): void {
	state().recoverPlugin = recover;
}

interface QueuedSteer {
	steer: SteerMessage;
	promise: Promise<void>;
	/** La carga del despertar sigue siendo propiedad de aquí, pero no debe reorientarse hacia su propia ejecución. */
	waking?: boolean;
	/** El vehículo construido, una vez que el arranque reclama un turno. Hasta
	 * entonces solo la bomba controla el despertar: un asentamiento ajeno en
	 * primer plano no puede liberarlo. */
	wakeAgent?: Agent;
	/** Un inicio fallido espera a una ejecución del alumno o a un reinicio del proceso, no a un temporizador. */
	deferred?: boolean;
	resolve: () => void;
	reject: (reason: Error) => void;
	/** El agente vivo al que se reorientó este marcador (agent.steer); lo fija el
	 *  auxiliar de traspaso. Protege contra el doble traspaso (un bucle bombeado
	 *  de nuevo o una ejecución registrada de nuevo no deben volver a encolar lo
	 *  que ya tiene una ejecución) y se BORRA al asentarse en los marcadores que
	 *  la ejecución moribunda nunca inyectó. */
	handedTo?: Agent;
}

interface WakeState {
	turnRunner?: TurnRunner;
	respawn?: JobRespawn;
	recoverPlugin?: PluginJobRecovery;
	/** chatId → reorientaciones pendientes de entrega, en orden de llegada. El
	 *  único registro de entregas (oleada C: la propia cola de seguimiento del
	 *  agente es un VEHÍCULO por ejecución, no el registro; el asentamiento
	 *  concilia aquí). */
	queues: Map<string, QueuedSteer[]>;
	/** chatId → mensajes reorientados por el usuario pendientes de vaciar
	 *  (reorientación desde el compositor, 2026-10-03). El mismo ciclo de vida de
	 *  entregar o volver a encolar que los marcadores de tareas: la cola de
	 *  reorientación del agente vivo es el VEHÍCULO y esto es el registro; una
	 *  reorientación varada tras una pregunta o una cancelación se queda aparcada
	 *  aquí y viaja en la SIGUIENTE ejecución del chat (handOffEligible). */
	userSteers: Map<string, UserSteerEntry[]>;
	/** chatId → el agente del turno que se está emitiendo AHORA (se borra al
	 *  asentarse, antes de settleSteers). La ruta viva de la bomba pasa los
	 *  marcadores a la cola de seguimiento de este agente. */
	liveAgents: Map<string, Agent>;
	/** Chats cuyo bucle de bomba está activo ahora mismo (serialización por chat). */
	pumping: Set<string>;
	/** Contabilidad de la limitación del barrido de tareas obsoletas. */
	lastSweepAt: number;
	stopConnectionWatch?: () => void;
	automaticDeferred: WeakSet<Agent>;
}

interface LhWakeGlobal {
	__lhWakePipeline?: WakeState;
}

function state(): WakeState {
	const g = globalThis as typeof globalThis & LhWakeGlobal;
	return (g.__lhWakePipeline ??= { queues: new Map(), liveAgents: new Map(), userSteers: new Map(), pumping: new Set(), lastSweepAt: 0, automaticDeferred: new WeakSet() });
}

/** chat-handler lo conecta al iniciar el módulo: su adaptador alrededor de handleChatRequest. */
export function setTurnRunner(run: TurnRunner): void {
	state().turnRunner = run;
}

/** chat-handler lo conecta al iniciar el módulo: el runJob de su ejecutor de tareas. */
export function setJobRespawn(respawn: JobRespawn): void {
	state().respawn = respawn;
}

const POLL_MS = 400;
/** Cuando se abren las barreras, se espera un momento antes de disparar: un
 *  cliente que acaba de responder una pregunta está a punto de enviar su
 *  continuación; no hay que darle un 409.
 *
 *  Justificación de los 750: la ventana de carrera es exactamente el trayecto
 *  respuesta→POST del alumno: sendAutomaticallyWhen despacha de forma síncrona
 *  en addToolOutput, la respuesta solo llega al registro en la persistencia
 *  anticipada y beginTurn cambia el registro de turnos justo después, todo
 *  antes de que pueda vencer el margen (RTT medido en localhost ~10 ms; RTT
 *  típico en LAN/producción <300 ms). 750 ms son 2,5× el peor trayecto
 *  realista. Un fallo se autorrepara: la bomba vuelve a comprobar las
 *  barreras tras el margen Y el proceso de despertar reintenta los 409 con una
 *  rampa de espera creciente; y como el reintento por fusión del transporte
 *  (chat-transport.ts) hizo que los 409 del cliente no fueran fatales, incluso
 *  un RTT patológico se degrada con elegancia. (Eran 1500, una suposición sin
 *  más; 750 recupera 750 ms de latencia de entrega tras la respuesta sin
 *  debilitar la protección). */
const GRACE_MS = 750;
/** Espera ante un 409: rampa con tope para que un cliente ocupado no pueda hacer girar la bomba. */
const RETRY_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** La tarea a la que pertenece una reorientación, si es de tarea (result/abort);
 *  las reorientaciones probe-handoff no tienen tarea: null. */
function jobIdOf(steer: SteerMessage): string | null {
	const details = steer.details as { jobId?: string } | undefined;
	return typeof details?.jobId === "string" ? details.jobId : null;
}

/** Llámalo solo tras la persistencia canónica de la conversación. La visibilidad
 * en streaming no es una aceptación duradera. El marcador guardado gana a los
 * fallos de contabilidad de la entrega; acusar la entrega nunca cambia el
 * resultado del worker. */
export function noteSteersDurable(chatId: string, persisted: readonly LhMessage[]): void {
	for (const message of persisted) {
		if (message.role === "custom") finalizeSteer(message);
	}
	for (const entry of [...(state().queues.get(chatId) ?? [])]) {
		if (persisted.some((message) => message.id === entry.steer.id)) completeEntry(chatId, entry);
	}
}

function removeEntry(chatId: string, entry: QueuedSteer): void {
	const remaining = (state().queues.get(chatId) ?? []).filter((candidate) => candidate !== entry);
	if (remaining.length > 0) state().queues.set(chatId, remaining);
	else state().queues.delete(chatId);
}

function completeEntry(chatId: string, entry: QueuedSteer): void {
	finalizeSteer(entry.steer);
	removeEntry(chatId, entry);
	entry.resolve();
}

/** El borrado descarta las obligaciones de la sesión; nunca despierta un chat borrado. */
export function discardChatDeliveries(chatId: string): void {
	const s = state();
	const queue = s.queues.get(chatId) ?? [];
	s.queues.delete(chatId);
	s.userSteers.delete(chatId);
	for (const entry of queue) entry.resolve();
}

/** Cierra la contabilidad de la tarea de una reorientación entregada; solo reorientaciones de tarea. */
function finalizeSteer(steer: SteerMessage): void {
	const jobId = jobIdOf(steer);
	if (jobId) finalizeJob(jobId);
}

/** Encola una entrega lógica por ID, incluida la carga de un despertar en
 * curso. Las promesas de las tareas se resuelven con la aceptación duradera
 * del marcador (o con el borrado de la sesión); los inicios fallidos siguen
 * pendientes. Los traspasos de sondeo que no son de tarea mantienen su
 * semántica existente de aceptación/error del despertar. Los workers nunca
 * esperan esta promesa. */
export function deliverJobResult(steer: SteerMessage): Promise<void> {
	const chatId = chatIdOf(steer);
	const entry = queueSteer(chatId, steer);
	void pump(chatId);
	return entry.promise;
}

function queueSteer(chatId: string, steer: SteerMessage): QueuedSteer {
	const queue = state().queues.get(chatId) ?? [];
	const existing = queue.find((entry) => entry.steer.id === steer.id);
	if (existing) return existing;
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
	// La recuperación/el registro pueden tener una entrada sin ningún llamante esperando.
	void promise.catch(() => undefined);
	const entry: QueuedSteer = { steer, promise, resolve, reject };
	queue.push(entry);
	state().queues.set(chatId, queue);
	return entry;
}

/** Pasa todos los marcadores pendientes admisibles a la cola de reorientación
 *  de un agente vivo (idempotente por agente gracias a handedTo). Se llama
 *  TANTO desde la ruta viva de la bomba como desde registerLiveAgent: un
 *  marcador aparcado (varado tras un quiz) no debe esperar a que el bucle de
 *  la bomba se dé cuenta de la nueva ejecución: el handler registra el agente
 *  de la ejecución de la respuesta ANTES de runPiTurn, así que este traspaso
 *  se adelanta al vaciado síncrono de la consulta inicial del bucle y el
 *  marcador viaja en la PRIMERA llamada al LLM de la ejecución (el equivalente
 *  nativo de la antigua unión de continuaciones). */
export function automaticFollowUpAllowed(chatId: string, agent?: Agent): boolean {
	if (agent && state().automaticDeferred.has(agent)) return false;
	const provider = agent?.state?.model?.provider ?? resolveConversationSpec(stores.chatStore.getChat(chatId)?.settings, effectiveSettings().models.strong)?.provider;
	return connectionBackgroundAllowed(provider);
}

function handOffEligible(chatId: string, agent: Agent): void {
	const queue = state().queues.get(chatId);
	// Los resultados automáticos se quedan en su registro propietario. Nunca se mezclan en
	// un lote en primer plano sin consentimiento expreso de la cuenta. Las reorientaciones
	// del alumno de abajo siguen siendo entregables, incluida la primera consulta de una ejecución de respuesta.
	if (automaticFollowUpAllowed(chatId, agent) && queue && queue.length > 0) {
		for (const entry of queue) {
			if (!entry.waking && !entry.deferred && entry.handedTo !== agent && entry.steer.customType !== "probe-handoff") {
				agent.steer(entry.steer);
				entry.handedTo = agent;
			}
		}
	}
	// Reorientaciones del usuario (2026-10-03): el mismo traspaso, a cualquier ejecución
	// viva; una reorientación varada tras una pregunta o una cancelación viaja en la
	// primera frontera de la siguiente ejecución del chat. Sin exclusión de probe-handoff:
	// son palabras del alumno, que se deben a la ejecución que esté viva.
	const userQueue = state().userSteers.get(chatId);
	if (userQueue && userQueue.length > 0) {
		for (const entry of userQueue) {
			if (entry.handedTo !== agent) {
				agent.steer(entry.message);
				entry.handedTo = agent;
			}
		}
	}
}

/** chat-handler registra el agente del turno que se está emitiendo AHORA
 *  ANTES de runPiTurn (la consulta de reorientación al inicio del bucle se
 *  vacía de forma síncrona dentro de esa llamada; un registro posterior se la
 *  perdería). Los marcadores pendientes del registro se reorientan hacia la
 *  ejecución justo aquí. La frontera de asentamiento no puede adelantarse al
 *  registro: el asentamiento necesita una respuesta en streaming, que nunca
 *  ocurre dentro de la llamada al constructor. */
export function registerLiveAgent(chatId: string, agent: Agent, allowDeferred = true, wakeSteerIds?: ReadonlySet<string>): void {
	state().liveAgents.set(chatId, agent);
	restorePendingDeliveries(chatId);
	for (const entry of state().queues.get(chatId) ?? []) {
		if (allowDeferred) entry.deferred = false;
		if (entry.waking && wakeSteerIds?.has(entry.steer.id)) entry.wakeAgent = agent;
	}
	handOffEligible(chatId, agent);
}

/** Una reorientación del usuario aparcada: el mensaje más el agente al que se
 *  pasó por última vez (la protección contra el doble traspaso: una
 *  conciliación la conserva solo si su id nunca llegó al registro persistido). */
export interface UserSteerEntry {
	message: LhMessage;
	handedTo?: Agent;
}

/** La admisión asíncrona del compositor mantiene privado el agente vivo. Los ajustes
 * futuros del chat son irrelevantes a propósito: esta reorientación pertenece a la
 * ejecución viva capturada. Al asentarse se mantiene la alternativa de envío existente;
 * los sustitutos nunca deben redirigirla. */
export async function prepareAndSteerChat(chatId: string, input: UserSteerInput): Promise<"accepted" | "settled" | "stale"> {
	const agent = state().liveAgents.get(chatId);
	if (!agent) return "settled";
	const model = agent.state.model;
	const session = stores.chatStore.getChat(chatId);
	if (!model || !session) return "stale";
	const policy = submissionImagePolicyKey({ model });
	const { text, id } = input;
	const images = await prepareSubmissionImages(input.images, { model });
	const currentSession = stores.chatStore.getChat(chatId);
	if (!currentSession || currentSession.createdAt !== session.createdAt || currentSession.kind !== session.kind) return "stale";
	const current = state().liveAgents.get(chatId);
	if (!current) return "settled";
	if (current !== agent || current.state.model !== model || submissionImagePolicyKey({ model }) !== policy) return "stale";
	// Ningún await puede separar la comprobación de identidad/política de este traspaso al registro.
	return steerLiveChat(chatId, newUserSteer(text, id, images)) ? "accepted" : "settled";
}

/** Traspaso vivo síncrono. La copia del registro mantiene la red de seguridad
 * existente, solo en memoria, contra los varados: las reorientaciones no
 * entregadas viajan en la siguiente ejecución. Sin agente vivo, el llamante
 * puede recurrir a un envío normal. */
export function steerLiveChat(chatId: string, message: LhMessage): boolean {
	const agent = state().liveAgents.get(chatId);
	if (!agent) return false;
	const entry: UserSteerEntry = { message };
	const q = state().userSteers.get(chatId) ?? [];
	q.push(entry);
	state().userSteers.set(chatId, q);
	agent.steer(message);
	entry.handedTo = agent;
	return true;
}

/** CONCILIACIÓN AL ASENTARSE EL TURNO para las reorientaciones del usuario: los
 *  ids entregados se descartan (el registro los contiene); los no entregados
 *  se quedan aparcados para la siguiente ejecución. Solo en memoria por diseño
 *  (el mismo compromiso que con los marcadores de tareas): un reinicio del
 *  servidor pierde las reorientaciones aparcadas, y de todos modos todo el
 *  turno muere con él. */
export function reconcileUserSteers(chatId: string, persisted: readonly LhMessage[]): void {
	const q = state().userSteers.get(chatId);
	if (!q || q.length === 0) return;
	const ids = new Set(persisted.map((m) => (m as { id?: string }).id));
	const kept = q.filter((e) => !ids.has(e.message.id));
	if (kept.length === 0) state().userSteers.delete(chatId);
	else state().userSteers.set(chatId, kept);
}

/** Borra el agente vivo al asentarse; DEBE ejecutarse antes de settleSteers para
 *  que el nuevo bombeo de la conciliación nunca pase un marcador al agente moribundo. */
export function unregisterLiveAgent(chatId: string): void {
	const agent = state().liveAgents.get(chatId);
	if (agent) state().automaticDeferred.delete(agent);
	state().liveAgents.delete(chatId);
}

/** Restaura los objetos exactos del registro tras el vaciado nativo pero antes del despacho.
 * El vehículo es desechable; la propiedad de los resultados y sus promesas no. */
export function restoreUncommittedAutomatic(chatId: string, agent: Agent, automaticIds: ReadonlySet<string>, retainedIds: ReadonlySet<string>): void {
	const s = state();
	s.automaticDeferred.add(agent);
	for (const entry of s.queues.get(chatId) ?? []) {
		if (entry.handedTo === agent && automaticIds.has(entry.steer.id)) entry.handedTo = undefined;
	}
	agent.clearSteeringQueue();
	for (const entry of s.userSteers.get(chatId) ?? []) {
		if (!retainedIds.has(entry.message.id)) { agent.steer(entry.message); entry.handedTo = agent; }
	}
}

/** CONCILIACIÓN AL ASENTARSE EL TURNO (oleada C): el handler lo llama DESPUÉS
 * de unregisterLiveAgent, con los mensajes persistidos de la ejecución. Dos
 * cometidos:
 *
 *   - las entradas cuyo marcador ENTREGÓ la ejecución (inyección de
 *     seguimiento durante la ejecución: sus ids están en el tramo persistido)
 *     se resuelven y acusan la entrega;
 *   - las entradas pasadas a la ejecución moribunda pero nunca inyectadas (la
 *     parada por pregunta salió antes de la consulta de seguimiento; una
 *     cancelación; una entrega que compitió con la consulta final) vuelven a
 *     PENDIENTES (se borra handedTo) y la bomba se reinicia; el despertar en
 *     reposo las entrega cuando se abren las barreras.
 *
 * Esto es lo que hace seguro el traspaso en vivo: pi no reintenta un marcador
 * varado en la cola de un agente ya asentado, así que el registro sigue siendo
 * la verdad y la copia del agente muerto simplemente se abandona (el
 * recolector de basura se la lleva con el agente). */
export function settleSteers(chatId: string, persisted: { id?: string }[], failed = false, settledAgent?: Agent): void {
	const queue = state().queues.get(chatId);
	if (!queue || queue.length === 0) return;
	const deliveredIds = new Set(persisted.map((m) => m.id).filter(Boolean));
	const remaining: QueuedSteer[] = [];
	for (const entry of queue) {
		if (deliveredIds.has(entry.steer.id)) {
			finalizeSteer(entry.steer);
			entry.resolve();
		} else {
			const handedHere = entry.handedTo !== undefined && (!settledAgent || entry.handedTo === settledAgent);
			const wakeHere = settledAgent !== undefined && entry.wakeAgent === settledAgent;
			if (handedHere) entry.handedTo = undefined;
			if (wakeHere) { entry.waking = false; entry.wakeAgent = undefined; }
			if (failed && (handedHere || wakeHere) && jobIdOf(entry.steer)) entry.deferred = true;
			remaining.push(entry);
		}
	}
	if (remaining.length === 0) state().queues.delete(chatId);
	else {
		state().queues.set(chatId, remaining);
		void pump(chatId);
	}
}

/** Resultado de un intento de cancelación; el endpoint lo traduce a HTTP. */
export interface AbortOutcome {
	ok: boolean;
	reason?: "not_found" | "not_running";
}

/**
 * CANCELACIÓN (semántica del dock de 2026-09, decidida por el usuario):
 * terminación real, error con motivo, y el profesor sigue enterándose. El
 * botón END del dock llega aquí mediante POST /api/activity/abort (cuerpo
 * {kind: "job", id: jobId}); la ruta es la composición mínima de master; este
 * es el mecanismo del lado de las tareas. Un cálculo completado no se puede
 * cancelar: su resultado pendiente pertenece a la sesión. Para un cálculo sin
 * terminar, se guardan el error "Aborted by learner" y su aviso de
 * cancelación pendiente ANTES de disparar los callbacks síncronos del worker.
 * Después se mata el worker registrado y se encola el marcador de
 * cancelación determinista. El acuse de entrega nunca sobrescribe el
 * resultado del cálculo.
 *
 * El ejecutor escribe en su finally el uso acumulado hasta el momento (parche
 * de fusión), así que el registro de dinero de una tarea cancelada sobrevive a
 * la terminación.
 */
export function abortJob(jobId: string): AbortOutcome {
	const job = stores.jobStore.getJob(jobId);
	if (!job) return { ok: false, reason: "not_found" };
	if (job.status !== "running") return { ok: false, reason: "not_running" };
	if (job.result) {
		normalizeLegacyResult(job);
		return { ok: false, reason: "not_running" };
	}

	stores.jobStore.updateJob(jobId, {
		status: "error", error: "Aborted by learner", activity: "aborted",
		delivery: { kind: "abort", status: "pending" },
	});
	fireJobAbort(jobId);
	void deliverJobResult(buildAbortSteer(job)).catch(() => {
		/* El aviso de cancelación pendiente guardado sigue perteneciendo a la sesión. */
	});
	return { ok: true };
}

function chatIdOf(steer: SteerMessage): string {
	// El traspaso de sondeo lleva su chat directamente en los detalles del marcador (el
	// registro de la tarea también lo diría, pero los detalles son la ruta barata).
	if (steer.customType === "probe-handoff") {
		return (steer.details as { chatId: string }).chatId;
	}
	// El chat se puede resolver a partir del registro de la tarea; los detalles de la
	// reorientación llevan el jobId, que indexa el almacén.
	const jobId = jobIdOf(steer);
	const job = jobId ? stores.jobStore.getJob(jobId) : undefined;
	return job?.chatId ?? "";
}

/**
 * La bomba por chat: entrega el registro por las dos rutas nativas de pi. Solo
 * un bucle por chat a la vez; lo que llega después viaja en el registro.
 *
 * Cada iteración primero quita el peso muerto (chat desaparecido, marcadores
 * ya entregados) y luego elige el vehículo: un turno VIVO toma todos los
 * marcadores admisibles mediante agent.followUp (la ejecución continúa en su
 * propia parada; no hay nada más que hacer aquí hasta que el asentamiento
 * vuelva a bombear); si no, el DESPERTAR EN REPOSO dispara UN turno que lleva
 * todos los marcadores pendientes como añadidos de su entrada.
 */
async function pump(chatId: string): Promise<void> {
	if (!chatId) return;
	const s = state();
	if (s.pumping.has(chatId)) return;
	s.pumping.add(chatId);
	let parked = false;
	try {
		for (let attempt = 0; ; ) {
			const queue = s.queues.get(chatId);
			if (!queue || queue.length === 0) {
				s.queues.delete(chatId);
				return;
			}

			// Chat desaparecido: no hay dónde entregar.
			const record = stores.chatStore.getChat(chatId);
			if (!record) {
				s.queues.delete(chatId);
				for (const entry of queue) {
					entry.reject(new Error(`chat ${chatId} not found — cannot deliver steer ${entry.steer.id}`));
				}
				continue;
			}

			// Entrega idempotente: la transcripción ya contiene estas reorientaciones (se
			// persistió una inyección durante la ejecución, se completó un despertar o se coló
			// una entrega duplicada). Se resuelven y se marcan sin volver a disparar nada.
			noteSteersDurable(chatId, record.messages);
			const stillPending = (s.queues.get(chatId) ?? []).filter((entry) => !entry.waking && !entry.deferred);
			if (stillPending.length === 0) { parked = true; return; }
			if (!automaticFollowUpAllowed(chatId, s.liveAgents.get(chatId))) { parked = true; return; }

			// VEHÍCULO 1, LA EJECUCIÓN VIVA: la cola de reorientación de pi. El agente del turno
			// en emisión toma todos los marcadores admisibles; pi los inyecta en la siguiente
			// frontera de turno (message_start/message_end en el cable vivo, entre unidades
			// completas de asistente+toolResult) y continúa la ejecución. La entrega se resuelve
			// al asentarse (settleSteers). No hay nada más que hacer en esta iteración del bucle:
			// el turno se encarga de la entrega.
			const live = s.liveAgents.get(chatId);
			if (live && isTurnRunning(chatId)) {
				handOffEligible(chatId, live);
				const handable = stillPending.filter((e) => e.handedTo === live);
				// los probe-handoff nunca viajan en una ejecución viva (decisión del responsable:
				// el traspaso debe INICIAR la ejecución del profesor); si queda alguno
				// pendiente, se espera a que acabe la ejecución y se vuelve al despertar de abajo.
				const handoffWaits = stillPending.some(
					(e) => e.steer.customType === "probe-handoff",
				);
				if (handable.length > 0 && !handoffWaits) {
					return; // la ejecución entrega; settleSteers vuelve a bombear el resto
				}
				if (handable.length > 0) {
					await delay(POLL_MS);
					await waitForIdle(chatId);
					continue;
				}
			}

			// VEHÍCULO 2, EL DESPERTAR EN REPOSO: un turno en el servidor que lleva TODOS los
			// marcadores pendientes como añadidos de su entrada (el handler los persiste por
			// anticipado bajo la propia reclamación del turno del despertar).
			await waitForIdle(chatId);

			// Se vuelve a leer DESPUÉS de que se abran las barreras: waitForIdle puede esperar a
			// que se responda un quiz (minutos), y enviar la instantánea previa a la espera
			// machacaría la respuesta + continuación del cliente en la persistencia anticipada.
			const fresh = stores.chatStore.getChat(chatId);
			if (!fresh) {
				continue; // la rama de chat desaparecido lo rechaza en la siguiente iteración
			}

			// El ejecutor es obligatorio; chat-handler lo fija al iniciar. Si alguna instancia
			// de módulo se perdió el cableado, se falla con estruendo en vez de quedarse colgado.
			if (!s.turnRunner) {
				const err = new Error("wake pipeline: no turn runner wired (setTurnRunner)");
				for (const entry of stillPending) deferOrReject(chatId, entry, err);
				parked = true;
				return;
			}

			// Puede que una ejecución viva haya entregado algunos marcadores mientras las barreras
			// estaban cerradas; se vuelve a comprobar: solo viajan en el despertar los que aún faltan.
			noteSteersDurable(chatId, fresh.messages);
			const fire = (s.queues.get(chatId) ?? []).filter((entry) => !entry.waking && !entry.deferred && !entry.handedTo);
			if (fire.length === 0) return;

			// LA PAUSA POR DESCARTE (diseño del responsable 2026-10-03, "A2"): el registro termina
			// en un descarte del usuario; la sesión espera al USUARIO. Se retienen todos los
			// marcadores en la cola (no se dispara ningún despertar) y se vuelve; el siguiente envío
			// del usuario es el despertar que los lleva (el vehículo durante la ejecución de abajo
			// se los pasa a ese turno en cuanto llega la reclamación de texto; hasta entonces, el
			// asentamiento vuelve a bombear y los entrega justo después). La pausa se deriva de la
			// cola del registro, así que cualquier mensaje del usuario la levanta por construcción.
			// Una petición de recuperación de pregunta interrumpida también espera una entrada
			// explícita; una tarea en cola no debe reiniciar su turno sustituto.
			if (endsInDismissal(fresh.messages) || endsInQuestionRecovery(fresh.messages) || !automaticFollowUpAllowed(chatId)) {
				parked = true;
				return;
			}

			// Se mantiene la propiedad durante el despertar. El indicador excluye la carga de
			// su propio traspaso al agente vivo mientras los llamantes duplicados la comparten.
			for (const entry of fire) entry.waking = true;
			const steers = fire.map((e) => e.steer);

			// Se dispara el despertar con la carga aún registrada. Un 409 libera su indicador de
			// vehículo y reintenta tras la espera creciente existente, sin añadir otra entrada
			// al registro.
			const status = await s.turnRunner(chatId, { type: "steers", steers }).catch((err: unknown) => {
				console.error(`[steer ${steers.map((x) => x.id).join(",")}] wake turn crashed:`, err);
				return -1;
			});
			const saved = stores.chatStore.getChat(chatId);
			if (saved) noteSteersDurable(chatId, saved.messages);
			const owned = fire.filter((entry) => s.queues.get(chatId)?.includes(entry));
			if (status === 403 || status === 409) {
				for (const entry of owned) { entry.waking = false; entry.wakeAgent = undefined; }
				if (status === 403) { parked = true; return; }
				await delay(RETRY_BACKOFF_MS[Math.min(attempt++, RETRY_BACKOFF_MS.length - 1)]!);
				continue;
			}
			attempt = 0;
			for (const entry of owned) {
				if (status === 200 && !jobIdOf(entry.steer)) {
					// Se conserva la semántica de aceptación del traspaso de sondeo que no es de tarea.
					completeEntry(chatId, entry);
				} else if (status !== 200 || !isTurnRunning(chatId)) {
					deferOrReject(chatId, entry, new Error(`wake turn did not persist steer (status ${status})`));
				}
				// Un turno vivo aceptado sigue siendo dueño de su carga hasta el guardado canónico
				// o el asentamiento. Un HTTP 200 por sí solo no es un recibo duradero del marcador.
			}
		}
	} finally {
		s.pumping.delete(chatId);
		// Puede haber llegado una reorientación entre la última comprobación y el finally:
		// se reinicia la bomba en lugar de dejarla varada. Las entradas ya pasadas a una
		// ejecución viva NO son rezagadas (settleSteers se encarga de resucitarlas);
		// reiniciar por ellas solo dejaría la bomba aparcada en waitForIdle para siempre.
		const q = state().queues.get(chatId) ?? [];
		if (!parked && automaticFollowUpAllowed(chatId, state().liveAgents.get(chatId)) && q.some((e) => e.handedTo === undefined && !e.waking && !e.deferred)) void pump(chatId);
	}
}

// Los cambios de conexión son el único despertar del trabajo automático aplazado por consentimiento.
// Mientras el consentimiento esté desactivado no se inicia ningún temporizador de reintento, inferencia ni alternativa con clave API.
state().stopConnectionWatch?.();
state().stopConnectionWatch = onSubscriptionChange(() => {
	const s = state();
	for (const [chatId, agent] of s.liveAgents) {
		if (!isSubscriptionProvider(agent.state?.model?.provider) || automaticFollowUpAllowed(chatId, agent)) continue;
		const consumed = new Set(agent.state.messages.map((m) => (m as { id?: string }).id));
		const pending = (s.queues.get(chatId) ?? []).filter((entry) => entry.handedTo === agent && !consumed.has(entry.steer.id));
		if (pending.length === 0) continue;
		agent.clearSteeringQueue();
		for (const entry of pending) entry.handedTo = undefined;
		for (const entry of s.userSteers.get(chatId) ?? []) if (!consumed.has(entry.message.id)) entry.handedTo = undefined;
		handOffEligible(chatId, agent); // solo la entrada del alumno sin consumir; nunca se repiten reorientaciones consumidas
	}
	for (const chatId of s.queues.keys()) {
		if (automaticFollowUpAllowed(chatId, s.liveAgents.get(chatId))) void pump(chatId);
	}
});

function deferOrReject(chatId: string, entry: QueuedSteer, error: Error): void {
	entry.waking = false;
	entry.wakeAgent = undefined;
	if (jobIdOf(entry.steer)) {
		entry.deferred = true;
		console.error(`[steer ${entry.steer.id}] delivery remains pending:`, error.message);
	} else {
		removeEntry(chatId, entry);
		entry.reject(error);
	}
}

/** Acusa la entrega a la sesión sin cambiar el resultado del worker. */
function finalizeJob(jobId: string): void {
	try {
		let job = stores.jobStore.getJob(jobId);
		if (!job) return;
		if (!job.delivery) job = normalizeLegacyResult(job);
		if (job.delivery?.status !== "pending") return;
		stores.jobStore.updateJob(jobId, { delivery: { ...job.delivery, status: "delivered" } });
	} catch (error) {
		// La conversación ya es duradera. Un fallo de contabilidad nunca debe repetir
		// ese marcador ni convertir un worker con éxito en un fallo.
		console.error(`[job ${jobId}] delivery acknowledgement failed:`, error);
	}
}

function normalizeLegacyResult(job: JobRecord): JobRecord {
	if (job.delivery || job.status !== "running" || !job.result) return job;
	const failed = isSubagentFailure(job.kind, job.result as never);
	return stores.jobStore.updateJob(job.id, {
		status: failed ? "error" : "done", activity: failed ? "failed" : "finished",
		delivery: { kind: "result", status: "pending" },
	}) ?? job;
}

/** Restaura solo las obligaciones conocidas; los registros terminales antiguos nunca se reproducen. */
function restorePendingDeliveries(chatId: string): void {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return;
	noteSteersDurable(chatId, record.messages);
	for (const stored of stores.jobStore.listJobs(chatId)) {
		const live = isJobLive(stored.id);
		// La preparación del resultado de un plugin persiste una alternativa genérica honesta
		// antes de esperar al formateador del autor. No se entrega esa alternativa antes de
		// tiempo mientras el formateador vivo siga controlando la preparación; un reinicio no
		// tiene registro y puede restaurarla sin volver a ejecutar código del autor.
		if (stored.kind === "plugin" && live && !(state().queues.get(chatId) ?? []).some((entry) => jobIdOf(entry.steer) === stored.id)) continue;
		const job = live ? stored : normalizeLegacyResult(stored);
		if (job.delivery?.status !== "pending") continue;
		const steer = job.delivery.kind === "abort" ? buildAbortSteer(job)
			: job.delivery.kind === "failure" ? buildJobFailureSteer(job, job.error ?? "Background job recovery or delivery failed")
			: job.result ? buildSubagentSteer(job, job.result as never) : undefined;
		if (!steer) continue;
		if (steerDelivered(record.messages, steer.id)) finalizeSteer(steer);
		else queueSteer(chatId, steer);
	}
}

/**
 * Espera hasta que el chat pueda aceptar un turno de despertar: ningún turno
 * en curso Y ninguna llamada de pregunta sin responder (la pregunta colgada
 * del registro: la respuesta llega como su resultado de herramienta, y ningún
 * turno puede ejecutarse en esa ventana). Sondea; el alumno puede tardar lo
 * que quiera en responder, y eso es correcto: la reorientación se dispara
 * justo después de que termine su turno de respuesta.
 */
async function waitForIdle(chatId: string): Promise<void> {
	for (;;) {
		const record = stores.chatStore.getChat(chatId);
		if (!record || !(state().queues.get(chatId) ?? []).some((entry) => !entry.waking && !entry.deferred && !entry.handedTo)) return;
		const blocked = isTurnRunning(chatId) || hasUnresolvedQuestion(record.messages);
		if (!blocked) {
			await delay(GRACE_MS);
			const recheck = stores.chatStore.getChat(chatId);
			if (
				!isTurnRunning(chatId) &&
				recheck &&
				!hasUnresolvedQuestion(recheck.messages)
			) {
				return;
			}
		}
		await delay(POLL_MS);
	}
}

// ─── recuperación tras caídas ────────────────────────────────────────────────

const SWEEP_THROTTLE_MS = 30_000;

/**
 * Barrido perezoso (se llama desde el sondeo de /api/jobs, con limitación),
 * CON BARRERA DE VIDA (oleada de precisión, 2026-09-19): un registro
 * "running" sin registro de bucle vivo (subagents/aborts.ts) es un huérfano
 * de la muerte de un proceso: se vuelve a entregar su resultado guardado (de
 * forma idempotente) o se vuelve a lanzar el bucle, en el acto (la antigua
 * heurística de 15 minutos de antigüedad esperaba a fantasmas Y volvía a
 * ejecutar bucles colgados pero vivos junto a sí mismos: el incidente del
 * figure-maker, 2026-09-18). Un registro CON registro vivo se está ejecutando,
 * de forma demostrable, en ESTE proceso: nunca se toca, por antiguo que sea;
 * una primera llamada al modelo colgada sigue honestamente en ejecución hasta
 * que END la mata. Los workers terminales con entrega pendiente conocida se
 * restauran de forma independiente; nunca se deduce que los registros
 * terminales antiguos sin metadatos de entrega deban una entrega.
 */
/** Vuelve a ejecutar el bucle del subagente de una tarea; expuesto para las pruebas del barrido
 *  (el sondeo de /api/jobs es su único llamante en producción, desactivado con NODE_ENV=test). */
export function recoverStaleJobs(): void {
	const s = state();
	const now = Date.now();
	if (now - s.lastSweepAt < SWEEP_THROTTLE_MS) return;
	s.lastSweepAt = now;
	try {
		for (const chat of stores.chatStore.listChats()) {
			for (const job of stores.jobStore.listJobs(chat.id)) {
				if (isJobLive(job.id)) continue; // nunca se vuelve a ejecutar junto a un cálculo vivo
				if (!stores.chatStore.getChat(job.chatId)) continue;
				if (isTurnRunning(job.chatId)) continue;
				const recovered = normalizeLegacyResult(job);
				if (recovered.delivery?.status === "pending") {
					restorePendingDeliveries(job.chatId);
					void pump(job.chatId);
				} else if (job.status === "running" && !job.result) {
					if (job.kind === "plugin") {
						// Solo lecturas canónicas de tareas; nunca se relanzan herramientas/código de plugins.
						if (s.recoverPlugin) void s.recoverPlugin(job).catch((error: unknown) => {
							if (stores.jobStore.getJob(job.id)?.status !== "running") return;
							const failure = `Plugin job recovery failed: ${String(error)}`;
							stores.jobStore.updateJob(job.id, { status: "error", error: failure, activity: "recovery failed", delivery: { kind: "failure", status: "pending" } });
							void deliverJobResult(buildJobFailureSteer(job, failure));
						});
						continue;
					}
					// El propio bucle del subagente murió con el proceso: se vuelve a lanzar.
					if (!s.respawn) continue;
					stores.jobStore.updateJob(job.id, { activity: "recovering: re-running" });
					s.respawn(job.id);
				}
			}
		}
	} catch (err) {
		console.error("[jobs] stale-job recovery sweep failed:", err);
	}
}

/** La entrada de /api/jobs: lista de tareas para el sondeo del cliente (+ recuperación perezosa). */
export function listJobs(chatId: string): JobRecord[] {
	if (process.env.NODE_ENV !== "test") recoverStaleJobs();
	return stores.jobStore.listJobs(chatId);
}
