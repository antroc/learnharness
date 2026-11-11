import { compactionInFlight, deleteChatSession, getChat, isTurnRunning, sessionCoverage, sessionCost, stores, turnFailure, type ChatDeleteMode, pluginQuestionAvailabilityOf, reconcilePluginQuestionCompatibility, type QuestionTypeResolver, getPluginQuestionTypeResolver, getPluginHost, pluginProblemAvailabilityOf, type ProblemTypeResolver } from "@/src/server";
import { pendingPluginQuestionOf, activeProblemOf } from "@/src/core";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	await reconcilePluginQuestionCompatibility(stores.chatStore, id);
	let chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	let questionResolver: QuestionTypeResolver | undefined;
	if (pendingPluginQuestionOf(chat.messages)) {
		try { questionResolver = await getPluginQuestionTypeResolver(); } catch { /* alternativa no disponible */ }
		// Ningún arranque de plugin esperado puede separar esta lectura de la proyección de la respuesta.
		chat = getChat(id);
		if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	}
	let problemResolver: ProblemTypeResolver | undefined;
	if (activeProblemOf(chat.messages)?.pluginProblem) {
		try { problemResolver = (await getPluginHost()).resolveProblemType; } catch { /* alternativa no disponible */ }
		chat = getChat(id);
		if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	}
	// turnInFlight permite que un cliente que vuelve se reenganche a un turno en marcha
	// (persistencia anticipada de chat-handler + registro — ver src/server/turn-liveness.ts).
	// coverage (rediseño de la UX de extracción, 2026-09-24): el medidor de anillo de la
	// vista del chat + el bloque de la barra lateral — LA superficie de cobertura (la ruta GET
	// de todas las sesiones murió con el rediseño; el POST de Extract se queda). getChat
	// ya dio 404, así que el bloque existe.
	// Oleada D (aprobada por el responsable 2026-09-26): los mensajes del registro son
	// historial nativo del agente, servidos TAL CUAL — el cliente deriva su vista
	// (projectView de core/view.ts). turnInFlight permite que un cliente que vuelve
	// se reenganche a un turno en marcha; coverage es el medidor de anillo de la vista del chat.
	// Los bytes de las instantáneas tienen un endpoint con ámbito de sesión; no reenvíes todo el conjunto de imágenes en cada sondeo.
	const { imageSnapshots: _imageSnapshots, ...record } = chat;
	return Response.json({
		...record,
		messages: chat.messages,
		pluginQuestionAvailability: pluginQuestionAvailabilityOf(chat, questionResolver),
		pluginProblemAvailability: pluginProblemAvailabilityOf(chat, problemResolver),
		pricing: sessionCost(chat),
		turnInFlight: isTurnRunning(id),
		// También llega a las vistas inactivas que se perdieron el stream del turno fallido.
		turnError: turnFailure(id),
		compacting: compactionInFlight(id),
		coverage: sessionCoverage(id),
	});
}

/**
 * Renombrar (2026-09-17): el título de la cabecera que se edita con un clic
 * se confirma aquí. La validación es una sola regla — una cadena no vacía
 * tras recortar (el suelo "Untitled session" del store nunca se alcanza
 * desde esta ruta). updatedAt NO se actualiza a propósito: un renombrado no
 * debe reordenar la barra lateral (la misma regla que el PUT de settings).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
	if (typeof body?.title !== "string" || body.title.trim() === "") {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	const title = body.title.trim();
	const record = stores.chatStore.renameChat(id, title);
	return Response.json({ title: record.title });
}

/**
 * DELETE /api/chats/[id]?mode=preserve-graph|delete-nodes — borrado de
 * sesiones (oleada 6, decisiones del responsable 2026-09-22/23). El modo es
 * OBLIGATORIO y explícito: sin valor por defecto, porque los dos difieren en
 * lo destructivos que son —
 *
 *   preserve-graph  mueren el registro de la sesión, sus tareas y su
 *                   contabilidad de extracción (filas de cobertura/punto de
 *                   control); el grafo conserva todas las contribuciones que
 *                   fusionó la sesión.
 *   delete-nodes    "esta sesión nunca existió": desaparece también todo
 *                   rastro de la sesión en el registro — procedencia,
 *                   líneas de enlace, eventos, correspondencias — y los
 *                   nodos huérfanos mueren por completo (los nodos
 *                   compartidos sobreviven automáticamente, con el
 *                   contenido de sus otras sesiones intacto).
 *
 * Las barreras son las de la orquestación del servidor (deleteChatSession de
 * server/chats.ts): 409 mientras hay un turno o una tarea en segundo plano en
 * marcha, 503 mientras la extracción de la sesión se está cerrando tras su
 * abort — ambos reintentables. La respuesta lleva lo que se eliminó más el
 * nuevo graphRevision (el sello de versión que sondea la interfaz para volver
 * a pedir los clústeres/el layout).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const mode = new URL(req.url).searchParams.get("mode");
	if (mode !== "preserve-graph" && mode !== "delete-nodes") {
		return Response.json(
			{
				error: 'mode is required and must be "preserve-graph" or "delete-nodes"',
				code: "bad_mode",
			},
			{ status: 400 },
		);
	}
	const outcome = await deleteChatSession(id, mode as ChatDeleteMode);
	if (!outcome.ok) {
		return Response.json(
			{
				error: outcome.error,
				code: outcome.code,
				...("jobIds" in outcome ? { jobIds: outcome.jobIds } : {}),
		},
			{ status: outcome.status },
		);
	}
	return Response.json({
		ok: true,
		mode: outcome.mode,
		stats: outcome.stats,
		jobsRemoved: outcome.jobsRemoved,
		graphRevision: outcome.graphRevision,
	});
}

