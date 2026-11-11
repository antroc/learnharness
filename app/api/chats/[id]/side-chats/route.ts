/**
 * Preguntas laterales (hilos de aclaración en línea, diseño del responsable
 * 2026-11-02).
 *
 * GET  → { threads, answering }: los hilos laterales de la sesión más, para
 *        cada hilo cuya respuesta aún está en marcha, el texto emitido hasta
 *        ahora.
 * POST → preguntar: { threadId, text, quotes? } (seguimiento), { anchor, text,
 *        quotes? } (primera pregunta en un bloque de prosa del profesor) o
 *        { threadId, retry: true } (volver a responder una última respuesta
 *        fallida). Emite NDJSON (src/server/side-chat.ts documenta el cable);
 *        los rechazos son errores JSON normales (400/404/409/503).
 *
 * Envoltorio fino sobre el barril del servidor (la ley de los imports); las
 * pruebas manejan createSideChatService directamente.
 */
import { parseSideAskInput, SideChatInputError } from "@/src/core";
import { sideChats } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const listed = sideChats.list(id);
	if (!listed) return Response.json({ error: "Unknown chat" }, { status: 404 });
	return Response.json(listed);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	let input;
	try {
		input = parseSideAskInput(await request.json().catch(() => null));
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	return sideChats.ask(id, input);
}
