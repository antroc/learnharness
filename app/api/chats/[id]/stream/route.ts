/**
 * EL STREAM DE REENGANCHE (oleada del ejecutor de turnos en segundo plano,
 * decisión del responsable 2026-09-25) — y, desde la DIETA DE CONEXIONES B
 * (responsable, 2026-10-10), EL cable de los turnos, sin más: POST /api/chat
 * acusa recibo y cierra, así que quien envía también se engancha aquí. Un
 * stream SSE por chat: con un turno en marcha → suscripción al objeto del
 * turno vivo: repetición COMPLETA del registro de eventos y luego fragmentos
 * en vivo hasta el asentamiento ([DONE]). Sin turno en marcha → el terminal
 * barato ({"type":"turn-settled"} + [DONE]): el cliente vuelve a pedir el
 * registro. Un aviso conservado de fallo de asentamiento precede a ese
 * terminal cuando una respuesta no se pudo guardar antes de que se
 * enganchara quien la envió.
 *
 * El 404 refleja el de chat desconocido del manejador POST. La ruta del
 * framework es un envoltorio fino sobre el barril del servidor (la ley de
 * los imports); las pruebas manejan las fronteras (turn-runs + ui-stream)
 * directamente.
 */
import { getChat, runningTurn, piTurnResponse, settledTurnResponse } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const handle = runningTurn(id);
	if (!handle) return settledTurnResponse(id);
	return piTurnResponse(handle);
}
