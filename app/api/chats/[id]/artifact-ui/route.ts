/**
 * LA RUTA ARTIFACT-UI (responsable, 2026-10-07): persiste el interruptor de
 * inversión del alumno en un mensaje de reorientación de demo/figura
 * (details.ui.inverted) para que sobreviva a la navegación entre sesiones y
 * a los reinicios. Inspirada en el SILENCIO de la ruta de descarte: sin
 * despertar, sin agente, sin tokens, sin SSE — el registro es el único
 * estado que se mueve, y el cliente ya tiene el estado alternado de forma
 * optimista (sin vaivén de nuevas peticiones).
 *
 * Guardas: 404 si el chat no existe, 400 para un cuerpo que no sea
 * { input: { messageId, inverted } } o que no apunte a ninguna reorientación
 * de demo/visual.
 */
import { setSteerUiInverted, type SteerDetails } from "@/src/core";
import { getChat, stores } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });

	const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
	const input = body?.input as { messageId?: unknown; inverted?: unknown } | null | undefined;
	if (
		!input ||
		typeof input !== "object" ||
		typeof input.messageId !== "string" ||
		typeof input.inverted !== "boolean"
	) {
		return Response.json({ error: "input must be { messageId: string, inverted: boolean }" }, { status: 400 });
	}

	// Honestidad: el destino debe ser de verdad una reorientación de demo/figura.
	const target = chat.messages.find((m) => m.id === input.messageId);
	const details = target ? ((target as { details?: unknown }).details as Partial<SteerDetails> | undefined) : undefined;
	if (!details || (details.kind !== "demo" && details.kind !== "visual")) {
		return Response.json({ error: "No demo/figure steer with that message id" }, { status: 400 });
	}

	const messages = setSteerUiInverted(chat.messages, input.messageId, input.inverted);
	stores.chatStore.saveMessages(id, messages);
	return Response.json({ ok: true });
}
