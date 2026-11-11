/**
 * POST → detiene una respuesta lateral en marcha (preguntas laterales en
 * línea, 2026-11-02). La respuesta parcial se guarda con `stopped: true`.
 * 409 cuando no hay nada en marcha.
 */
import { sideChats } from "@/src/server";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; threadId: string }> }): Promise<Response> {
	const { id, threadId } = await ctx.params;
	if (!sideChats.stop(id, threadId)) return Response.json({ error: "No side answer is running" }, { status: 409 });
	return Response.json({ ok: true });
}
