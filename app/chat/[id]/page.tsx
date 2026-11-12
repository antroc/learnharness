import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { slotsConfigured } from "@/src/core";
import { compactionInFlight, getChat, isTurnRunning, readSettingsRecord, turnFailure } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ prompt?: string }>;
}) {
	const [{ id }, { prompt }] = await Promise.all([params, searchParams]);
	const chat = getChat(id);
	if (!chat) notFound();
	// La semilla de la llamada a la acción persistente de configuración (BYOK, responsable
	// 2026-09-22): slotsConfigured sobre el registro de ajustes, leído en el servidor; la misma barrera
	// que leen home/new. El 503 del servidor sigue siendo la verdad; esto solo decide si la píldora aparece.
	const record = readSettingsRecord();
	return (
		<Chat
			key={chat.id}
			chatId={chat.id}
			title={chat.title}
			kind={chat.kind ?? "teach"}
			// Oleada D: el registro ES el historial nativo del agente; la vista del cliente se
				// deriva en la app (projectView de core/view.ts; GET sirve los mismos
				// mensajes nativos).
				initialMessages={chat.messages}
			initialError={turnFailure(chat.id)}
			initialConfigured={slotsConfigured(record?.models)}
			initialPrompt={prompt}
			// Un turno del profesor que sobrevivió a su cliente: la vista remontada debe
			// engancharse (brillo de ocupado + sondeo), nunca resucitar el registro obsoleto.
			initiallyInFlight={isTurnRunning(chat.id)}
			initiallyCompacting={compactionInFlight(chat.id)}
		/>
	);
}
