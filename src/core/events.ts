/**
 * Notificaciones en vivo de la app para cambios de turnos, tareas, registros
 * y disponibilidad. Los consumidores obtienen el estado autoritativo tras una
 * notificación y lo vuelven a obtener al reconectar; las notificaciones no son
 * un registro duradero que se pueda reproducir. El canal de mensajes de
 * plugins lleva además datos JSON con ámbito de plugin, con la misma
 * limitación de entrega solo en vivo.
 */

/** El vocabulario de eventos del núcleo más el canal de extensión de plugins con espacio de nombres. */
export interface ServerEvents {
	/** Empezó un turno nativo de conversación en el servidor, incluidos los
	 * envíos, los turnos de despertar y los turnos iniciados desde otra ventana. */
	"turn-started": { chatId: string };
	/** Un turno se asentó tras persistirse. Vuelve a obtener el registro
	 * guardado; esto no significa que la extracción asíncrona o el trabajo en
	 * segundo plano hayan terminado. */
	"turn-settled": { chatId: string };
	/** Cambió el registro de una tarea (envío, progreso, asentamiento, aborto,
	 *  recuperación). chatId cuando se conoce — los consumidores que poseen un
	 *  chat filtran por él. */
	"jobs-changed": { chatId?: string };
	/** Una ejecución de extracción cambió de fase (dock de actividad). */
	"activity-changed": Record<string, never>;
	/** Cambió la lista de sesiones (crear, borrar, título). */
	"chats-changed": Record<string, never>;
	/** Cambiaron el inventario de fuentes, los nombres mostrados o las carpetas organizativas. */
	"sources-changed": Record<string, never>;
	/** Cambió el estado de una suscripción web. Ni datos de cuenta ni credenciales en el bus. */
	"subscriptions-changed": Record<string, never>;
	/** El registro de un chat cambió SIN un turno (la escritura silenciosa del
	 *  descarte). El mismo contrato de notificar y luego obtener que los eventos
	 *  de turno: las vistas abiertas del chat vuelven a obtenerlo y adoptan el
	 *  registro duradero. */
	"record-changed": { chatId: string };
	/** Empezó o terminó la compactación del contexto de este chat. Mientras
	 * running es true, el servidor bloquea la interacción con el modelo y el
	 * cliente desactiva el envío relacionado del compositor/dock. Es estado en
	 * vivo, no un marcador persistido. */
	"compaction-changed": { chatId: string; running: boolean };
	/** Cambió una conversación lateral. Notificar y luego obtener: las vistas
	 *  abiertas vuelven a pedir GET /api/chats/:id/side-chats. Cerrarla nunca la
	 *  borra. */
	"side-chats-changed": { chatId: string };
	/** Cambió la disponibilidad o el ciclo de vida de los plugins; vuelve a obtener los paquetes instalados. */
	"plugins-changed": Record<string, never>;
	/** Notificaciones solo en vivo con ámbito de plugin. Al reconectar hay que resincronizar con una instantánea. */
	"plugin-message": { pluginId: string; topic: string; data?: unknown };
}

export type ServerEventType = keyof ServerEvents;

/** Los nombres en tiempo de ejecución del vocabulario — el cliente conecta un
 *  listener por nombre (los tipos se borran; esta lista es la única fuente de
 *  verdad de lo que puede llevar el canal SSE). */
export const SERVER_EVENT_TYPES = [
	"turn-started",
	"turn-settled",
	"jobs-changed",
	"activity-changed",
	"chats-changed",
	"sources-changed",
	"subscriptions-changed",
	"record-changed",
	"compaction-changed",
	"side-chats-changed",
	"plugins-changed",
	"plugin-message",
] as const satisfies readonly ServerEventType[];

/** Una notificación: se distribuye sobre el vocabulario para que estrechar
 * `type` estreche de verdad su carga (incluidos los mensajes con ámbito de
 * plugin). */
export type ServerEvent<K extends ServerEventType = ServerEventType> = {
	[T in K]: { type: T } & ServerEvents[T];
}[K];

export type ServerEventListener = (event: ServerEvent) => void;

interface LhEventsGlobal {
	__lhEventBus?: Set<ServerEventListener>;
}

/** El conjunto compartido de listeners — respaldado en globalThis para que
 *  cada entrada de módulo de Next (y cada capa) vea UN solo bus. Efímero por
 *  diseño: un reinicio del proceso descarta los listeners junto con sus
 *  conexiones; los emisores nunca encolan. */
function listeners(): Set<ServerEventListener> {
	const g = globalThis as typeof globalThis & LhEventsGlobal;
	return (g.__lhEventBus ??= new Set());
}

/** Escucha. Devuelve la función para darse de baja — la llaman la
 *  cancelación de la ruta SSE y cualquier limpieza de pruebas; un listener
 *  descartado no deja fugas. */
export function subscribe(listener: ServerEventListener): () => void {
	const set = listeners();
	set.add(listener);
	return () => set.delete(listener);
}

/** Notifica a todos los listeners. Cero suscriptores no hace nada (no hay
 *  ventana abierta — la emisión era de todos modos para la contabilidad de
 *  los propios stores). Que un listener lance nunca debe romper a los demás
 *  ni al emisor: cada llamada está aislada, el fallo se registra y el bucle
 *  sigue. */
export function emit<K extends ServerEventType>(type: K, payload: ServerEvents[K]): void {
	// Instantánea: un listener que se da de baja (o de alta) a mitad de la emisión no
	// debe mutar el conjunto mientras se itera.
	for (const listener of [...listeners()]) {
		try {
			listener({ type, ...payload } as ServerEvent);
		} catch (err) {
			console.error(`[events] listener failed on ${type}:`, err);
		}
	}
}
