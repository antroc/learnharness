import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { ToolCallIdUniquifier } from "./call-ids.ts";
import type { ChatGPTRequestCycle } from "../../agent/chatgpt-request-cycle.ts";
import { pluginQuestionLedgerFor } from "../../agent/plugin-question-tools.ts";

/**
 * LA RED NATIVA (Oleada D, aprobada por el responsable el 2026-09-26): un turno del agente, transmitido
 * a cada vista como AgentEvents de pi: sin traducción, sin montaje de partes. La única
 * reescritura autorizada (el arreglo Lacan, 2026-10-04): los IDs de llamada a herramienta se hacen únicos en
 * este límite cuando el proveedor los reinicia en cada respuesta (el
 * `call_0` de DeepSeek en cada turno): ver call-ids.ts y PiTurnSpec.usedToolCallIds.
 * El cuerpo SSE es el propio stream de eventos del agente:
 *
 *   data: {"type":"agent_start"}\n\n
 *   data: {"type":"message_update","message":{…}}\n\n
 *   …
 *   data: {"type":"agent_end","messages":[…]}\n\n
 *   data: [DONE]\n\n
 *
 * Hechos estructurales del protocolo (verificados contra pi-agent-core):
 * - Cada `message_update` lleva el mensaje parcial COMPLETO del asistente (cada
 *   AssistantMessageEvent incluye `partial`): una vista SUSTITUYE su asistente en
 *   streaming por `event.message`; no existe montaje de deltas en ningún sitio.
 * - DIETA DE LA RED (responsable, 2026-10-09: el análisis posterior del congelamiento del streaming): nuestro
 *   límite emite el message_update ADELGAZADO (solo `message`). El evento de pi también
 *   lleva el mismo parcial completo una SEGUNDA vez como `assistantMessageEvent`:
 *   nada en esta app lo lee nunca, y reserializarlo en cada fragmento
 *   duplicaba cada trama del stream. El cliente lee `event.message`, siempre.
 * - Herramientas de preguntas builtin (quiz / ask_user_question): SIN supresión (decisión del responsable,
 *   bifurcación 2 de la Oleada D): el `tool_execution_end` de cierre con el marcador
 *   provisional en memoria "Question posed" llega al cliente, que lo ignora
 *   (las herramientas de preguntas son del cliente; la respuesta llega como evento de entrada).
 *   El marcador provisional sigue sin persistirse nunca y sin llegar nunca al modelo.
 *   Las preguntas de plugins, en cambio, suprimen solo los acuses de planteamiento atestiguados por el registro privado
 *   en todos los portadores, tras correlacionar los ID; las copias admitidas del asistente llevan
 *   intentos solo de visibilidad hasta que el asentamiento canónico crea autoridad.
 * - La barrera de validación de llamadas a herramienta sobrevive por construcción: `tool_execution_end`
 *   solo se dispara después de que la llamada haya pasado el límite (una llamada no válida llega
 *   como isError, nunca como un final limpio), así que la regla de montaje del dock se basa en él.
 * - Eventos a nivel de app más allá de la taxonomía de pi: el terminal de reconexión
 *   {"type":"turn-settled"} (lo sirve turn-runs cuando no hay turno en ejecución) y
 *   el {"type":"error","errorText"} a nivel de bucle (agent.continue() lanzó
 *   fuera del stream de eventos; pasa por la política de enmascarado del handler).
 * - Los errores de proveedor a nivel de stream van literalmente en su mensaje
 *   (message_end con stopReason "error" + errorMessage).
 *
 * EJECUTOR DE TURNOS EN SEGUNDO PLANO (decisión del responsable, 2026-09-25): un turno se ejecuta como un
 * objeto en segundo plano del lado del servidor desacoplado de cualquier respuesta HTTP concreta:
 * los clientes son VISTAS. runPiTurn devuelve el manejador (estado compactado +
 * conjunto de suscriptores); piTurnResponse envuelve un stream de suscriptor como la respuesta
 * SSE, y tanto la respuesta de POST /api/chat como GET /api/chats/[id]/stream
 * son exactamente eso. Cancelar una vista SOLO la desacopla: nunca aborta
 * el turno; el abort() del manejador es la única forma de matarlo en remoto.
 *
 * LA LEY DE COMPACTACIÓN (responsable, 2026-10-09: sustituye la decisión del registro sin límite
 * del 2026-09-25): el registro del turno guarda ESTADO, no fragmentos. Los eventos nativos de pi
 * son instantáneas completas, una por fragmento del proveedor, así que conservarlos todos hacía
 * que la memoria y el coste de reproducción fueran cuadráticos en la longitud del mensaje (un solo
 * mensaje con mucho razonamiento retenía cientos de MB y cada reconexión
 * reserializaba todo el historial de un tirón bloqueante: el congelamiento de la navegación
 * entre sesiones paralelas). El registro conserva ahora los eventos asentados literalmente más
 * el ÚLTIMO update por mensaje/llamada a herramienta en curso, sustituido en su sitio;
 * el reparto de updates en vivo se agrupa en como mucho una trama por ventana de vaciado
 * (gana el último: las vistas sustituyen por hueco, y message_end lleva el mensaje
 * final completo, así que descartar los intermedios no pierde nada). Por tanto la reproducción
 * cuesta el contenido una vez, nunca el número de fragmentos.
 */

/** El evento de la red: un AgentEvent de pi (con nuestro message_update adelgazado: ver la
 * nota DIETA DE LA RED de arriba), o uno de los dos eventos de la app. */
export type TurnWireEvent =
	| AgentEvent
	| { type: "message_update"; message: AgentMessage }
	| { type: "error"; errorText: string };

export interface PiTurnSpec {
	/** Carga de referencia nueva para una ejecución nativa ya seleccionada, incluida
	 * una ejecución de recuperación de admisión. Este hook nunca programa una ejecución por sí mismo. */
	beforeCycle?: () => void;
	requestCycle?: ChatGPTRequestCycle;
	/** El agente por turno (motor sin estado: construido a partir del registro). */
	agent: Agent;
	/** La política de enmascarado de errores del handler para los fallos a nivel de BUCLE (el
	 *  propio stream de eventos es literal: los errores de proveedor van sin tocar en el
	 *  stopReason/errorMessage de su mensaje). */
	onError?: (error: unknown) => string;
	/** Informa del fallo de asentamiento mientras las vistas siguen abiertas. */
	onSettleError?: (error: unknown) => string;
	/** Libera la vivacidad aunque la frontera de finalización normal lance. */
	onSettleFailure?: (error: unknown, reportedErrorText?: string) => void;
	/** La frontera canónica de fin de turno: persistencia + uso + extracción + endTurn.
	 *  Recibe el estado final COMPLETO del agente (mensajes nativos): el llamador
	 *  persiste la porción que va más allá de su propio recuento base. */
	onFinish: (messages: AgentMessage[], isAborted: boolean) => void;
	/** Ids de llamada a herramienta ya usados en el registro de este chat (EL ARREGLO LACAN,
	 *  aprobado por el responsable el 2026-10-04): si está presente, un ToolCallIdUniquifier
	 *  vive en este límite: los proveedores que reinician los ids en cada respuesta
	 *  (el `call_0` de DeepSeek × cada turno) reciben los ids en colisión reacuñados UNA vez
	 *  aquí, para que las vistas de la red, el registro persistido, el dock, el enrutado
	 *  de respuestas y el contexto de proveedor del siguiente turno coincidan. Ausente →
	 *  paso literal (la ley del protocolo de abajo se sigue cumpliendo). */
	usedToolCallIds?: ReadonlySet<string>;
	/** La ventana de agrupación para el reparto de updates (LEY DE COMPACTACIÓN, arriba).
	 *  Por defecto 100 ms; las pruebas la estrechan. */
	updateFlushMs?: number;
}

/** Una vista sobre un turno en ejecución: push() reproduce/transmite un evento, done()
 *  termina la vista ([DONE] + cierre). Barato de tener como miembro de un Set. */
export interface PiTurnSubscriber {
	push(event: TurnWireEvent): void;
	done(): void;
}

/** El objeto de turno del lado del servidor (oleada del ejecutor de turnos en segundo plano, 2026-09-25):
 *  ejecuta el agente desacoplado de cualquier respuesta HTTP concreta y es dueño del
 *  registro de eventos en memoria + el conjunto de suscriptores en vivo. La respuesta del POST y
 *  el stream de reconexión son ambos suscriptores suyos. */
export interface PiTurnHandle {
	/** Un stream de suscriptor nuevo: reproducción COMPLETA del registro y después eventos en vivo
	 *  hasta que el turno se asienta (terminando con [DONE]). Cancelarlo solo desacopla la
	 *  vista: el turno sigue. */
	subscribe(): ReadableStream<Uint8Array>;
	/** La forma de matarlo en remoto, la ÚNICA manera de que un turno en ejecución muera antes de tiempo: sawAbort +
	 *  agent.abort(); el agent_end del bucle hace el resto (la frontera de asentamiento
	 *  persiste el transcript parcial para todos los oyentes). */
	abort(): void;
}

export function runPiTurn(spec: PiTurnSpec): PiTurnHandle {
	const { agent, onError, onFinish, onSettleError, onSettleFailure, usedToolCallIds, updateFlushMs = 100, requestCycle } = spec;
	const uniquifier = usedToolCallIds ? new ToolCallIdUniquifier(usedToolCallIds) : undefined;
	const questions = pluginQuestionLedgerFor(agent);

	let settled = false;
	let sawAbort = false;
	let reportedErrorText: string | undefined;

	// EL REGISTRO DE ESTADO POR TURNO (solo en memoria; las escrituras en disco solo al asentar
	// no cambian). LEY DE COMPACTACIÓN (responsable, 2026-10-09, sustituye la
	// decisión del registro sin límite del 2026-09-25): los eventos asentados se anexan literalmente;
	// las rachas de `message_update` / `tool_execution_update` en curso se reducen
	// a su ÚLTIMO miembro, sustituido en su sitio. La retención está acotada por
	// el CONTENIDO (mensajes asentados + una instantánea por mensaje en streaming), no
	// por el número de fragmentos: la explosión cuadrática que congelaba las sesiones paralelas es
	// ahora estructuralmente imposible. El registro muere con el turno al asentarse.
	const log: TurnWireEvent[] = [];
	// Huecos de updates en vivo: clave de agrupación → índice en el registro del update retenido.
	// Solo se transmite un mensaje del asistente a la vez (el orden estricto por paso de pi
	// start → updates → end), así que los mensajes comparten un hueco; las ejecuciones de herramientas
	// en paralelo tienen cada una el suyo (toolCallId). Los eventos de final liberan el hueco:
	// un update posterior para la misma clave empieza una racha nueva.
	const updateSlots = new Map<string, number>();
	// La cola de agrupación para el reparto EN VIVO: clave → último evento, vaciada como
	// mucho una vez por ventana de vaciado (Map conserva el orden de primera inserción, así que el
	// orden relativo de las claves concurrentes sigue siendo cronológico).
	const pending = new Map<string, TurnWireEvent>();
	const subscribers = new Set<PiTurnSubscriber>();

	const coalesceKey = (event: TurnWireEvent): string | null => {
		if (event.type === "message_update") return "message";
		if (event.type === "tool_execution_update") return `tool:${event.toolCallId}`;
		return null;
	};

	// Enviar = compactar el registro + repartir a todas las vistas en vivo. El fallo de encolado
	// de una vista (un lector cancelado) se lo traga la propia vista: el
	// turno debe asentarse igualmente; onFinish persiste mire quien mire.
	const send = (event: TurnWireEvent) => {
		if (settled) return;
		const key = coalesceKey(event);
		if (key !== null) {
			// Retención: sustituir en su sitio la última instantánea de la racha.
			const idx = updateSlots.get(key);
			if (idx !== undefined) log[idx] = event;
			else {
				updateSlots.set(key, log.length);
				log.push(event);
			}
			// Reparto: agrupado; gana el último, vaciado a ≤1 por ventana.
			pending.set(key, event);
			armFlush();
			return;
		}
		// Un evento de límite termina su racha de updates (el final sustituye al parcial;
		// el hueco queda libre para cualquier racha futura de la misma clave).
		if (event.type === "message_end") updateSlots.delete("message");
		if (event.type === "tool_execution_end") updateSlots.delete(`tool:${event.toolCallId}`);
		// Orden estricto por suscriptor: todo lo que siga pendiente va antes de
		// este evento de límite en la red, nunca después.
		flushPending();
		log.push(event);
		for (const sub of subscribers) sub.push(event);
	};

	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	const flushPending = () => {
		if (flushTimer !== undefined) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		if (pending.size === 0) return;
		const batch = [...pending.values()];
		pending.clear();
		for (const sub of subscribers) for (const event of batch) sub.push(event);
	};
	const armFlush = () => {
		if (flushTimer !== undefined) return;
		flushTimer = setTimeout(() => {
			flushTimer = undefined;
			flushPending();
		}, updateFlushMs);
		// Nunca mantiene abierto el proceso (ni el ejecutor de pruebas) por un rezagado.
		(flushTimer as { unref?: () => void }).unref?.();
	};
	const closeAll = () => {
		if (settled) return;
		// Orden hasta el final: la última instantánea pendiente va antes de [DONE].
		flushPending();
		settled = true;
		for (const sub of subscribers) sub.done();
		subscribers.clear();
	};
	// La frontera de asentamiento: lo que se escribe en el registro es el estado final PROPIO del agente
	// (historial nativo: firmas, uso y sellos del proveedor, todo real).
	// Se copia el array: el agente puede sobrevivir a la lectura de esta llamada.
	// 0.87.1 (rehecho del transcript): el Agent siembra un SystemMessage inicial
	// a partir de initialState.systemPrompt (prompt + declaraciones de herramientas): se
	// sintetiza en cada turno y NUNCA debe persistirse (el registro se hincharía
	// con las declaraciones de herramientas Y la reproducción vería messages[0] === system,
	// suprimiendo la nueva siembra por turno). Nuestra app no acuña mensajes de sistema
	// propios (el prompt se compone en cada turno), así que descartar
	// todo el rol es exacto; revisar si alguna vez llegan las actualizaciones de prompt.
	const settleWith = () => {
		try {
			const settled_ = [...agent.state.messages].filter((m) => (m as { role?: string }).role !== "system");
			const mapped = (uniquifier?.remapSettled(settled_) as AgentMessage[]) ?? settled_;
			onFinish(questions?.settled(settled_, mapped) ?? mapped, sawAbort);
		} catch (err) {
			console.error("[turn] settlement failed:", err);
			try { onSettleFailure?.(err, reportedErrorText); }
			catch (cleanupError) { console.error("[turn] settlement cleanup failed:", cleanupError); }
			if (reportedErrorText === undefined) {
				reportedErrorText = onSettleError?.(err) ?? "An error occurred.";
				send({ type: "error", errorText: reportedErrorText });
			}
		}
	};

	const handle = (event: AgentEvent) => {
		if (settled) return;
		// EL ARREGLO LACAN: los ids se hacen únicos AQUÍ, antes de cualquier vista: la única frontera
		// que comparten todos los consumidores aguas abajo. Sin uniquifier → literal.
		const mapped = uniquifier ? uniquifier.event(event) : event;
		const uniqued = questions ? questions.wire(event, mapped) : mapped;
		// DIETA DE LA RED: adelgazar el único evento que pi rellena por partida doble: nuestras vistas leen
		// `message`, nunca `assistantMessageEvent` (el mismo parcial completo dos veces).
		if (uniqued) {
			const wire: TurnWireEvent = uniqued.type === "message_update"
				? { type: "message_update", message: uniqued.message } : uniqued;
			send(wire);
		}
		if (event.type === "message_end") {
			const m = event.message as { role?: string; stopReason?: string } | undefined;
			if (m?.role === "assistant" && m.stopReason === "aborted") sawAbort = true;
		}
		if (event.type === "agent_end") {
			// Persistir/informar antes de que el terminal cierre todas las vistas a tramas nuevas.
			settleWith();
			closeAll();
		}
	};
	requestCycle?.bindRelease(handle);
	agent.subscribe((event) => {
		if (!requestCycle?.hold(event)) handle(event);
	});

	void (async () => {
		try {
			do {
				spec.beforeCycle?.();
				await agent.continue();
				if (!requestCycle) break;
				const denied = requestCycle.deniedBeforeDispatch;
				const locallyRejected = requestCycle.locallyRejected;
				const outcome = requestCycle.finishNativeCycle(agent.state.messages);
				if (denied || locallyRejected) agent.state.messages = outcome.messages;
				if (outcome.action !== "resumeForeground") {
					handle({ type: "agent_end", messages: [...agent.state.messages] });
					break;
				}
			} while (!sawAbort);
		} catch (err) {
			// Un fallo a nivel de bucle (no un error del proveedor: esos van en el
			// stream como stopReason "error"): aflorar, cerrar, persistir. Si el
			// agente ya se asentó (agent_end llegó antes del throw),
			// la frontera ya se ejecutó: nunca asentar dos veces.
			if (settled) {
				console.error("[turn] error after settlement:", err);
				return;
			}
			console.error("[turn] agent loop failed:", err);
			reportedErrorText = onError?.(err) ?? "An error occurred.";
			send({ type: "error", errorText: reportedErrorText });
			settleWith();
			closeAll();
		}
	})();

	return {
		subscribe() {
			let sub: PiTurnSubscriber | undefined;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const encoder = new TextEncoder();
					let closed = false;
					sub = {
						push(event) {
							if (closed) return;
							try {
								controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
							} catch {
								/* lector cancelado: dejar de emitir, seguir ejecutando */
								closed = true;
							}
						},
						done() {
							if (closed) return;
							closed = true;
							try {
								controller.enqueue(encoder.encode("data: [DONE]\n\n"));
								controller.close();
							} catch {
								/* ya cancelado */
							}
						},
					};
					// Adjuntar Y LUEGO reproducir: síncrono, así que ningún evento puede caer
					// entre la reproducción y el vivo (un solo hilo: el handle() del
					// agente solo se ejecuta cuando vuelve esta pila). El registro
					// compactado reproduce los eventos asentados + la última instantánea por
					// mensaje en curso: el contenido completo, una vez, nunca el historial
					// de fragmentos (LEY DE COMPACTACIÓN).
					subscribers.add(sub);
					for (const event of log) sub.push(event);
					// Un suscriptor que se adjuntó después de asentarse (la carrera
					// del desregistro) sigue recibiendo todo el historial + [DONE].
					if (settled) sub.done();
				},
				cancel() {
					// LA DECISIÓN DEL RESPONSABLE (2026-09-25): que una vista se vaya NUNCA mata
					// el turno; solo lo hace el canal de aborto explícito. El turno
					// sigue; el registro compactado conserva el estado para la siguiente vista.
					if (sub) subscribers.delete(sub);
				},
			});
			return stream;
		},
		abort() {
			if (settled) return;
			sawAbort = true;
			requestCycle?.abort();
			agent.abort();
		},
	};
}

/** La respuesta SSE con forma de suscriptor: tanto la respuesta de POST /api/chat como
 * GET /api/chats/[id]/stream son ESTO: mismas cabeceras, mismo dialecto
 * de red, un único protocolo que consume el cliente. */
export function piTurnResponse(handle: PiTurnHandle): Response {
	return new Response(handle.subscribe(), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
