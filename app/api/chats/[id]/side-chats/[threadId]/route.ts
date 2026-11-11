/**
 * Una conversación lateral duradera. GET se engancha a su respuesta actual
 * (también tras recargar); PATCH cambia la visibilidad de la ventana.
 * Cerrarla nunca la borra.
 */
import { parseSideOpenInput, SideChatInputError } from "@/src/core";
import { sideChats } from "@/src/server";

type Ctx = { params: Promise<{ id: string; threadId: string }> };

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
	const { id, threadId } = await ctx.params;
	let open: boolean;
	try {
		open = parseSideOpenInput(await request.json().catch(() => null));
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const result = sideChats.setOpen(id, threadId, open);
	if (result === "unknown-chat") return Response.json({ error: "Unknown chat" }, { status: 404 });
	if (result === "unknown-thread") return Response.json({ error: "Unknown side thread" }, { status: 404 });
	return Response.json({ thread: result });
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
	const { id, threadId } = await ctx.params;
	return sideChats.watch(id, threadId);
}
