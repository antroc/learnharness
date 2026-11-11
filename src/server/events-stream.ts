/**
 * EL CANAL DE NOTIFICACIONES (arquitectura push, fase 1): GET /api/events es
 * una respuesta SSE sobre el bus de eventos del núcleo: una conexión por
 * ventana abierta, mantenida hasta que la vista desaparece y alimentada por
 * todos los emisores (ciclo de vida del turno, almacenes de tareas/chats,
 * registro de extracción).
 *
 * NOTIFICAR → LEER (todo el truco de la arquitectura): los frames solo llevan
 * el tipo de evento + una carga mínima; los consumidores responden leyendo la
 * verdad (/api/chats/:id, /api/jobs, /api/activity). Sin versionado de cargas
 * ni protocolo de reproducción: una reconexión se resincroniza con una lectura
 * normal por consumidor. Es una app de ESCRITORIO que habla con localhost:
 * mantener N≈1-3 conexiones cuesta un par de sockets cada una y cero tráfico
 * en reposo (decisión del responsable 2026-10-02: la economía del sondeo en la
 * nube no existe en loopback; esto sustituye a la red de sondeos que dejó).
 *
 * El dialecto de red refleja el del flujo del turno (pi/ui-stream.ts):
 * text/event-stream, no-cache/no-transform, X-Accel-Buffering desactivado,
 * más un comentario `: ping` cada 25 s para que ningún intermediario cierre el
 * socket por inactividad (innecesario en local, inofensivo, y abarata detectar
 * conexiones muertas).
 *
 * La DIFERENCIA con el flujo del turno es la duración: el flujo de un turno
 * termina al asentarse ([DONE]); este canal termina cuando el CLIENTE se va:
 * cancel() es el único final y debe dejar el bus intacto para las demás
 * ventanas. La forma del cierre (teardown asignado en start, llamado en
 * cancel) es el patrón de subscribe() de ui-stream.
 */
import { subscribe, type ServerEvent } from "../core/events.ts";

/** La suscripción de una ventana como Response SSE. */
export function eventsResponse(): Response {
	const encoder = new TextEncoder();
	let teardown: (() => void) | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let heartbeat: ReturnType<typeof setInterval> | undefined;
			let unsubscribe: (() => void) | undefined;

			const stop = () => {
				if (closed) return;
				closed = true;
				unsubscribe?.();
				if (heartbeat) clearInterval(heartbeat);
			};
			// Enqueue es el ÚNICO sitio donde el socket puede rechazarnos (el lector murió);
			// cualquier fallo pasa por stop() para que el listener y el latido nunca
			// sobrevivan a la conexión.
			const frame = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					stop();
				}
			};

			// Se engancha PRIMERO, de forma síncrona: ningún evento puede caer entre la
			// construcción y la suscripción (un solo hilo; la misma ley de enganchar y luego
			// reproducir que en el subscribe() de ui-stream).
			unsubscribe = subscribe((event: ServerEvent) => {
				const { type, ...payload } = event;
				frame(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
			});
			heartbeat = setInterval(() => frame(": ping\n\n"), 25_000);

			teardown = stop;
		},
		cancel() {
			// La vista se fue: se quitan el listener y el temporizador. El bus sigue
			// sirviendo a todas las demás ventanas sin cambios.
			teardown?.();
		},
	});
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
