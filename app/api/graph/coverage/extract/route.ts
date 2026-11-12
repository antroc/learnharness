/**
 * POST /api/graph/coverage/extract — la indicación de extracción manual
 * (vision-extraction-coverage.md): ejecuta el proceso sobre el contenido
 * no cubierto de UNA sesión, sea cual sea su tamaño; es la respuesta del
 * usuario a una ejecución abortada, a un error del proceso o a una sesión
 * que quedó inactiva por debajo del presupuesto de fragmento. El propio
 * proceso agrupa por lotes según el ajuste graph.extractionChunkTokens
 * (rediseño de la UX de extracción, 2026-09-24) y registra la cobertura
 * por cada lote fusionado, así que es la misma ejecución que lanza el
 * disparador, solo que iniciada por el usuario. Devuelve 409 mientras ya
 * haya una ejecución en curso (el dock es la fuente de verdad para eso);
 * los fallos los registra el proceso y no tocan la cobertura: el botón
 * sigue siendo honesto.
 */
import { extraction, extractionStatuses } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const chatId = (body as { chatId?: unknown }).chatId;
	if (typeof chatId !== "string" || chatId === "") {
		return Response.json({ error: 'Body must be {chatId: string}' }, { status: 400 });
	}
	if (extractionStatuses().some((run) => run.kind === "chat" && run.chatId === chatId)) {
		return Response.json({ error: "An extraction run is already in flight for this session" }, { status: 409 });
	}
	// Lanzar y olvidar, como el disparador: el dock y los indicadores de
	// ejecución del panel de cobertura siguen el progreso; la promesa nunca bloquea la respuesta.
	void extraction.runExtraction(chatId).catch((err: unknown) => {
		console.error(`[chat ${chatId}] manual extraction failed:`, err);
	});
	return Response.json({ started: true }, { status: 202 });
}