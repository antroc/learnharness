import {
	clampChatLevel,
	effectiveSettings,
	getChat,
	parseSettingsBody,
	stores,
	validateChatSettings,
} from "@/src/server";
import type { ChatSettings } from "@/src/core";

/**
 * El control de modelo por chat (oleada del control de modelo): settings de
 * sustitución completa — el selector envía el objeto deseado completo ({}
 * borra todas las sustituciones). MODELOS POR SESIÓN (responsable,
 * 2026-09-28): esta ruta es EL escritor dentro de la sesión — el control del
 * composer se vincula al registro propio de la sesión; la ranura fuerte es
 * solo el valor por defecto al nacer y ya nunca vuelve a alcanzar una sesión
 * existente.
 * La validación es la barrera del catálogo (src/server/model-catalog.ts): un
 * proveedor/modelo desconocido es un 400. Los niveles de thinking nunca se
 * rechazan (responsable, interludio 2026-09-22): un nivel fijado se acota al
 * más cercano que admita el modelo indicado y se guarda el valor acotado.
 * Efectivo en el siguiente turno por construcción (los agentes no tienen
 * estado entre turnos).
 *
 * El análisis del cuerpo en sí se comparte con la ruta de borrador
 * (src/server/settings-body.ts, oleada de ajustes por defecto 2026-09-18).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });

	const body = await req.json().catch(() => null);
	const parsed = parseSettingsBody(body);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const verdict = validateChatSettings(parsed.settings);
	if (!verdict.ok) {
		return Response.json({ error: verdict.error, supported: verdict.supported }, { status: 400 });
	}

	// La sustitución completa persiste el objeto validado y con el nivel acotado — sin
	// fusiones, para que un cliente obsoleto nunca pueda resucitar una sustitución borrada.
	// Acotar al escribir (responsable, interludio 2026-09-22): un nivel de thinking
	// fijado nunca se rechaza — se acota al más cercano que admita el modelo
	// indicado (el modelo del cuerpo o, si no, la ranura fuerte del registro).
	const settings = clampChatLevel(parsed.settings, effectiveSettings().models.strong);
	stores.chatStore.saveSettings(id, settings);
	return Response.json({ settings });
}
