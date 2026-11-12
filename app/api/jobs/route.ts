import { isTurnRunning, listJobs } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Endpoint de estado de las tareas (contracts.ts "THE ASYNC PROTOCOL" §4):
 * aquí llega la petición de tareas de la vista de chat, una vez al montar,
 * con cada anuncio de jobs-changed (el almacén emite tras escribir, con
 * antirrebote en el cliente) y al resincronizar el canal (arquitectura push
 * S4, 2026-10-02; el antiguo sondeo por intervalo está retirado). Alimenta
 * las tarjetas de despacho, el panel de subagentes y la resincronización
 * cuando una tarea se asienta. `turnInFlight` viaja junto para la
 * comprobación de reposo de la lógica de asentamiento.
 */
export async function GET(req: Request) {
	const chatId = new URL(req.url).searchParams.get("chatId");
	if (!chatId) {
		return Response.json({ error: "chatId query parameter is required" }, { status: 400 });
	}
	if (!/^[A-Za-z0-9_-]+$/.test(chatId)) {
		return Response.json({ error: "Invalid chatId" }, { status: 400 });
	}
	return Response.json({ jobs: listJobs(chatId), turnInFlight: isTurnRunning(chatId) });
}
