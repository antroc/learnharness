/**
 * PUT /api/settings/[section] — escrituras del registro acotadas a una
 * sección (oleada de almacenamiento de ajustes, 2026-09-19). Un PUT
 * sustituye UNA sección entera (campos ausentes = sustituciones ausentes; la
 * disciplina de ajustes de la casa, igual que las rutas por chat y de
 * valores por defecto); las secciones son independientes, así que las
 * escrituras parciales nunca pueden pisarse entre sí.
 *
 *   section ∈ general | chat | agent | appearance | graph | compaction | models | dictation
 *   Cuerpo: el objeto completo de la sección deseada. Se analiza y valida de
 *   forma estricta (server/settings-body.ts): una forma/tipo incorrecto es
 *   un 400 que lleva la lista admitida cuando existe. Las secciones chat y
 *   models pasan además la barrera del catálogo (validateChatSettings /
 *   validateModelsSettings — proveedor/modelo desconocido = 400, salvo que
 *   las selecciones de ranura de modelo sin cambios pueden seguir guardadas
 *   aunque no estén disponibles). Los niveles de razonamiento nunca rechazan
 *   una escritura (responsable, interludio 2026-09-22): un nivel fijado se
 *   ACOTA al nivel admitido más cercano del modelo nombrado y se guarda el
 *   valor acotado; los cambios de modelo simplemente funcionan, igual que en
 *   la ruta de valores por defecto. La sección agent valida además los
 *   interruptores de prompts, según el contrato de reparación de huérfanos
 *   (interludio 2026-09-26): un interruptor ON con su fichero de sustitución
 *   presente es válido tal cual; un ON cuyo fichero ha desaparecido (borrado
 *   fuera de la app, un borrado del disco o un registro anterior al arreglo
 *   de «borrar desactiva el interruptor») es un HUÉRFANO y se repara a OFF
 *   (la clave se elimina) dentro de la misma escritura, nunca con un 400.
 *   Invariante: un usuario nunca puede quedarse atascado sin poder escribir
 *   ajustes, y el estado del interruptor nunca contradice durante mucho
 *   tiempo la realidad de los ficheros (la ruta de borrado desactiva el
 *   interruptor por construcción; esta es la red de seguridad).
 *
 * Los hermanos estáticos (defaults, prompts) tienen prioridad sobre este
 * segmento dinámico: Next resuelve primero las rutas estáticas, así que
 * "prompts" nunca llega aquí.
 */

import { isBuiltinThemeId, type AgentSettings, type AppearanceSettings, type ChatSettings, type ModelsSettings } from "@/src/core";
import {
	SETTINGS_SECTIONS,
	allSegmentPaths,
	clampChatLevel,
	clampModelsLevels,
	effectiveSettings,
	fileAccessConfigurationError,
	promptOverrides,
	readSettingsRecord,
	refreshWorkerRequestAdmission,
	themeStore,
	validateChatSettings,
	validateModelsSettings,
	writeSettingsRecord,
	type SettingsBodyResult,
} from "@/src/server";

export const dynamic = "force-dynamic";

/** Un único analizador, con el tipo de resultado borrado al sobre común. */
type AnySectionParser = (body: unknown) => SettingsBodyResult<unknown>;

export async function PUT(request: Request, ctx: { params: Promise<{ section: string }> }) {
	const { section } = await ctx.params;
	const parser = (SETTINGS_SECTIONS as Record<string, AnySectionParser>)[section];
	if (!parser) {
		return Response.json(
			{ error: `unknown settings section "${section}"`, supported: Object.keys(SETTINGS_SECTIONS) },
			{ status: 404 },
		);
	}
	const body = await request.json().catch(() => null);
	const parsed = parser(body);
	if (!parsed.ok) {
		return Response.json({ error: parsed.error }, { status: 400 });
	}
	// Compara con el mismo registro que sustituye esta escritura de sección completa.
	const record = readSettingsRecord() ?? { version: 1 };
	let agentHealed: AgentSettings | undefined;

	// Validación cruzada específica de cada sección (contra el catálogo / el
	// almacén de prompts); los analizadores solo ven formas.
	if (section === "chat") {
		const verdict = validateChatSettings(parsed.settings as ChatSettings);
		if (!verdict.ok) {
			return Response.json({ error: verdict.error, supported: verdict.supported }, { status: 400 });
		}
	}
	// Los modelos de ranura nuevos/sustituidos pasan la barrera del catálogo. Las referencias
	// de modelo guardadas sin cambios pueden sobrevivir a una desconexión, incluidas las
	// ediciones de preferencia de razonamiento, así que cada ranura no disponible se puede reparar por separado.
	if (section === "models") {
		const verdict = validateModelsSettings(parsed.settings as ModelsSettings, record.models);
		if (!verdict.ok) {
			return Response.json({ error: verdict.error, supported: verdict.supported }, { status: 400 });
		}
	}
	// Un tema recién seleccionado debe existir. Un tema guardado cuyo fichero desapareció
	// ya se renderiza como Default: esa referencia sin cambios se repara al escribir, en
	// vez de bloquear tras un 400 ediciones ajenas de fuente/tamaño/ligaduras.
	if (section === "appearance") {
		const appearance = parsed.settings as AppearanceSettings;
		const theme = appearance.theme;
		if (theme !== undefined && !isBuiltinThemeId(theme) && themeStore.readTheme(theme) === null) {
			if (theme !== record.appearance?.theme) {
				return Response.json({ error: `unknown theme "${theme}"` }, { status: 400 });
			}
			appearance.theme = "default";
		}
	}
	if (section === "agent") {
		// Reparación de huérfanos (arreglo del contrato, interludio 2026-09-26): un
		// interruptor ON cuyo fichero de sustitución ha desaparecido (o cuyo segmento
		// salió del árbol fuente) se repara a OFF (clave eliminada) dentro de esta
		// escritura, nunca con un 400. El antiguo 400 atrapaba a los usuarios: cada
		// escritura devolvía el propio ON huérfano del registro mientras el interruptor
		// desactivado no llegaba a la salida de emergencia de OFF. Un ON con fichero real sigue siendo válido.
		const agent = parsed.settings as AgentSettings;
		const segments = new Set(allSegmentPaths());
		const orphans: string[] = [];
		for (const [path, on] of Object.entries(agent.prompts ?? {})) {
			if (on && (!segments.has(path) || promptOverrides.readOverride(path) === null)) orphans.push(path);
		}
		if (orphans.length > 0) {
			const prompts = { ...(agent.prompts ?? {}) };
			for (const path of orphans) delete prompts[path];
			agentHealed = { ...agent, prompts };
			console.info(`[settings] healed orphaned prompt switch(es) to off: ${orphans.join(", ")}`);
		}
	}

	// Acotar al escribir (decisión del responsable, interludio 2026-09-22): un cambio
	// de modelo con un nivel de razonamiento fijado NUNCA da error; la fijación se acota
	// al nivel admitido más cercano del nuevo modelo (el acotado al más cercano de pi,
	// la misma traducción que aplica piEngineForSpec en tiempo de ejecución) y el valor
	// acotado es lo que llega al registro. Los niveles sueltos de la sección chat se
	// acotan contra la ranura fuerte resuelta del registro (la alternativa de la
	// cadena); las ranuras de la sección models llevan cada una su propio modelo.
	// La sección agent llega REPARADA cuando arriba se encontraron interruptores de
	// prompt huérfanos (la copia reparada); tras cada escritura, el registro y la
	// realidad de los ficheros coinciden.
	const sectionOut =
		section === "chat"
			? clampChatLevel(parsed.settings as ChatSettings, effectiveSettings().models.strong)
			: section === "models"
				? clampModelsLevels(parsed.settings as ModelsSettings)
				: section === "agent" && agentHealed
					? agentHealed
					: parsed.settings;

	// Leer-modificar-escribir UNA sección del registro; todo lo demás viaja
	// intacto (otras secciones, claves desconocidas: el saneado las conserva).
	const next = { ...record, [section]: sectionOut };
	const stored = writeSettingsRecord(next);
	// Solo una escritura duradera con éxito cambia la admisión. Subir el límite
	// vacía de inmediato las peticiones en cola; bajarlo nunca cancela el trabajo activo.
	refreshWorkerRequestAdmission();
	const fileAccessError = fileAccessConfigurationError();
	return Response.json({ settings: stored, ...(fileAccessError ? { fileAccessError } : {}) });
}
