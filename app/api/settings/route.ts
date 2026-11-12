/**
 * GET /api/settings — EL registro de ajustes del usuario (oleada de
 * almacenamiento de ajustes, 2026-09-19): el registro delta completo en
 * data/settings.json (config.SETTINGS_FILE, a través del puerto
 * SettingsStore). No secreto por construcción: los secretos viven en
 * auth.json / .env.local y nunca entran en este registro.
 *
 *   GET → 200 {settings} (el registro delta saneado; las claves ausentes
 *         significan «valor de fábrica» y nunca se adivinan en el servidor)
 *         o 200 {settings: null} en el primer arranque.
 *
 * Las escrituras de sección van por PUT /api/settings/[section]; los
 * valores por defecto del chat siguen siendo escribibles también mediante el
 * alias heredado /api/settings/defaults. La resolución a valores concretos es
 * cosa del cliente/núcleo (resolveSettings de core/settings-resolution.ts,
 * seguro para el navegador).
 */

import { settingsStore, fileAccessConfigurationError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const fileAccessError = fileAccessConfigurationError();
	return Response.json({ settings: settingsStore.readSettings(), ...(fileAccessError ? { fileAccessError } : {}) });
}
