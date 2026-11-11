/**
 * LA RUTA DE DESCARTE SILENCIOSO (diseño del responsable 2026-10-03, "A2"):
 * el abort con ESC desde una pregunta pendiente escribe en el registro el
 * toolResult descartado y NO despierta NADA — sin beginTurn, sin agente, sin
 * tokens. La sesión entra en la pausa de descarte derivada
 * (endsInDismissal): las entregas de tareas esperan en la cola de
 * reorientaciones del proceso de despertar, el plegado de continuación no
 * exige nada, y el siguiente mensaje normal del usuario es el despertar que
 * lleva el descarte (más las entregas retenidas) al contexto del agente.
 *
 * Llamadas de pregunta en paralelo: cada descarte completa exactamente su
 * propia llamada (los resultados se vinculan por toolCallId, no por
 * posición), así que el dock avanza llamada a llamada y el composer solo
 * vuelve cuando no queda nada colgando.
 *
 * Las guardas reflejan la honestidad de la ruta de turnos: 404 si el chat no
 * existe, 400 para una entrada que no apunte a ninguna llamada de pregunta
 * colgante (o que no sea un descarte real). Un turno EN MARCHA ya no lo
 * rechaza (responsable, 2026-10-04 — el incidente del bucle de práctica de
 * GLM): el descarte se APARCA en el servidor y la ruta de asentamiento del
 * turno lo aplica sobre el registro persistido, así que descartar con ESC
 * hace ahora también de contable del abort del turno. Los descartes
 * integrados conservan el contrato de abort en el cliente; los descartes de
 * plugins validan la aparición guardada actual y luego aparcan y abortan
 * aquí al responsable.
 */
import { assertPluginQuestionInputAllowed, ChatInputError, dismissAppends, emit, parseDismissInput } from "@/src/core";
import { abortTurn, getChat, isTurnRunning, parkDismissal, stores, preparePluginQuestionDismissal, reconcilePluginQuestionCompatibility } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	await reconcilePluginQuestionCompatibility(stores.chatStore, id);
	let chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });

	let input;
	try {
		// La convención de la familia POST: el cuerpo es { input } (aquí chatId va
		// en la URL).
		const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
		input = parseDismissInput(body?.input ?? null);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	// El análisis del cuerpo cede el paso: valida contra la verdad actual para cada destino,
	// y nunca sobrescribas entradas añadidas mientras llegaba este cuerpo. Los destinos
	// de plugins exigen además, más abajo, la autoridad exacta de la aparición guardada.
	chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });

	let appends;
	try {
		assertPluginQuestionInputAllowed(chat.messages, input);
		if (input.type === "dismiss-plugin-question") appends = preparePluginQuestionDismissal(chat, input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	// Un turno en marcha es dueño de la persistencia. Los destinos nativos aún pueden
	// materializarse al asentarse, así que conservan su comportamiento de solo aparcar.
	// Los destinos de plugins se validaron arriba: ningún await separa esa comprobación,
	// el aparcamiento y el abort. La preparación conserva la propiedad hasta la limpieza
	// real de su callback; la ruta settle/finally existente aplica la cancelación aparcada.
	if (isTurnRunning(id)) {
		parkDismissal(id, input);
		if (input.type === "dismiss-plugin-question") abortTurn(id);
		return Response.json({ ok: true, parked: true }, { status: 202 });
	}

	try {
		appends ??= dismissAppends(chat, input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	// Persistencia anticipada, sin turno: el registro es el único estado que se mueve.
	// Aquí no se ejecuta ninguna petición del profesor. Los intercambios laterales siguen pendientes
	// para la siguiente llamada con presupuesto comprobado, nunca se publican antes en el historial de compactación.
	stores.chatStore.saveMessages(id, [...chat.messages, ...appends]);
	emit("record-changed", { chatId: id });
	return Response.json({ ok: true });
}
