import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { compactionInFlight, createChat, isTurnRunning, listChats, readSettingsRecord, stores, titleFromPrompt } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** La lista del selector de sesiones: resúmenes derivados del registro
 *  (fase, pregunta pendiente) + vida del turno en vivo — un turno en marcha
 *  marca la sesión como ocupada (ChatListItem de contracts.ts; el store no
 *  ve la vida del turno, la ruta es el punto de fusión). Responsable, ronda
 *  de color mínimo: las tareas en segundo plano YA NO cuentan — la sección
 *  Background agents de la barra lateral es ahora su canal (un spinner en
 *  marcha por fila las señalaría dos veces), así que busy significa
 *  exactamente "hay un turno de enseñanza en curso". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Sesiones de práctica (responsable, 2026-10-04): kind "practice" marca el
	// registro — el agente de práctica + sus herramientas desde el turno 1, sin extracción.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind);
	// MODELOS POR SESIÓN (responsable, 2026-09-28): una sesión es dueña de su modelo +
	// nivel de thinking desde el nacimiento — sellados tal cual a partir de la ranura FUERTE,
	// el valor por defecto de las sesiones nuevas. A partir de aquí la ranura fuerte nunca
	// vuelve a alcanzar esta sesión: las elecciones dentro de la sesión escriben su propio registro
	// (PUT /api/chats/:id/settings). Sin ranura fuerte configurada (arranque BYOK nuevo)
	// → sin sello; el sobre 503 models_not_configured de la barrera de turnos
	// rechaza con honestidad hasta que el flujo de configuración rellene la ranura.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	// El contexto de mapa de la sesión (responsable, 2026-10-04): las proposiciones
	// elegidas viajan con la CREACIÓN — message[0] es un marcador de contexto del
	// grafo (un mensaje custom aparte ANTES del primer mensaje de usuario del alumno),
	// que lleva las elecciones más las cadenas de razonamiento entre ellas.
	// Las elecciones llevan su propio nombre/enunciado (lo que vio el alumno al
	// elegir); las cadenas se derivan de la instantánea ACTUAL del grafo.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	return Response.json({ id: chat.id, title: chat.title });
}
