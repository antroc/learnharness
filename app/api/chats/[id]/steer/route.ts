// POST /api/chats/[id]/steer — el raíl de reorientación a mitad de turno del composer
// (arco del responsable 2026-10-03). El mensaje del alumno para un turno EN MARCHA viaja
// por la cola de reorientaciones de pi: se vacía en el siguiente límite de respuesta DENTRO
// de la misma ejecución (agent.steer + steeringMode "all"), se reenvía tal cual por el
// stream en vivo (el cliente inserta o actualiza la tarjeta por el id generado en el cliente) y
// lo persiste el propio asentamiento del turno.
//
// Esto es reorientación, NO seguimientos: la ruta nunca inicia un turno y
// nunca prolonga uno terminado. Sin turno vivo → 409 y el cliente recurre
// a un envío de texto normal (la carrera del asentamiento). Seguridad ante varamientos: la
// copia del registro sobrevive a una terminación por pregunta o a un abort y viaja con
// la siguiente ejecución del chat.
import { ChatInputError, parseUserSteerInput } from "@/src/core";
import { getChat, prepareAndSteerChat } from "@/src/server";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "unknown chat" }, { status: 404 });
	let input;
	try {
		const body = (await request.json()) as { input?: unknown };
		input = parseUserSteerInput(body?.input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	try {
		const result = await prepareAndSteerChat(id, input);
		if (result === "stale") return Response.json({ code: "submission-stale", error: "The live submission target changed. Your input has been kept." }, { status: 412 });
		if (result === "settled") return Response.json({ error: "no live turn to steer" }, { status: 409 });
		return Response.json({ ok: true });
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
}
