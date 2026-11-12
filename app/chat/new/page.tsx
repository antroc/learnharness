import { NewSession } from "@/components/new-session";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

export const dynamic = "force-dynamic";

/**
 * La vista de borrador tras "+ New session" (responsable, 2026-09-13): NO se
 * crea ninguna sesión hasta enviar el primer mensaje; la vista es un chat
 * vacío sin sesión. Al enviar, crea el chat (título = ese mensaje) y
 * redirige a la página real, cuya vía initialPrompt entrega el mensaje como
 * turno 1. El segmento estático gana a la ruta dinámica [id]: "new" nunca es
 * un id de chat.
 *
 * El control de modelo del borrador se vincula a la RANURA FUERTE (el valor
 * por defecto de las sesiones nuevas); la sesión que crea el primer envío
 * se sella con ella en el servidor (modelos por sesión, responsable 2026-09-28).
 */
export default async function NewSessionPage({
	searchParams,
}: {
	searchParams: Promise<{ mode?: string }>;
}) {
	const { mode } = await searchParams;
	return (
		<NewSession
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			mode={mode === "practice" ? "practice" : "teach"}
		/>
	);
}
