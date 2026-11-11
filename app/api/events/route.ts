/**
 * LA RUTA DEL CANAL DE NOTIFICACIONES (corte 1 de la arquitectura push,
 * 2026-10-02): una conexión SSE por ventana abierta sobre el bus de eventos
 * del núcleo — el endpoint al que se suscribe todo consumidor futuro (vista
 * del chat, barra lateral, dock de actividad) a medida que se retiran los
 * sondeos. La fontanería de la respuesta vive en la frontera del servidor
 * (events-stream.ts); la ruta del framework sigue siendo un envoltorio fino
 * (la ley de los imports; las pruebas manejan la frontera directamente).
 */
import { eventsResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
	return eventsResponse();
}
