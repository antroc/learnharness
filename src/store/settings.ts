/**
 * Persistencia del lado del servidor del registro de ajustes del usuario (oleada de almacenamiento
 * de ajustes, 2026-09-19): data/settings.json (config.SETTINGS_FILE), bajo la frontera
 * LH_DATA_DIR, de lectura-modificación-escritura, NO un registro de solo anexado. Solo preferencias
 * de producto no secretas; los secretos se quedan en auth.json / .env.local.
 *
 * Este adaptador es DUEÑO de las migraciones perezosas:
 *  1. los saltos de versión de esquema (CURRENT_SETTINGS_VERSION) se encajan aquí: la
 *     cadena está vacía hoy (v1 es la primera forma); las simples adiciones nunca
 *     suben la versión, así que un fichero al día siempre pasa sin cambios.
 *    (El pliegue del default-settings.json heredado murió con la sección de chat:
 *     modelos por sesión, responsable 2026-09-28).
 *
 * Todo lo que sale del disco se sanea (core/settings.ts) antes de llegar a un
 * llamador; todo lo que se escribe ya lo validaron las rutas
 * (settings-body.ts) y aquí se vuelve a sanear: el fichero nunca puede contener
 * un valor que desplace en silencio un mando.
 */

import fs from "node:fs";
import path from "node:path";
import { SETTINGS_FILE } from "../../config.ts";
import {
	sanitizeUserSettings,
	type UserSettings,
} from "../core/settings.ts";
import type { SettingsStore } from "../core/ports.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";
import { parseFileAccessSettings, type FileAccessSettingsResult } from "../core/file-access.ts";

const FILE_ACCESS_ERROR = "File-access configuration cannot be read reliably. Learner-file access is blocked. Repair File access in Settings → Agent → Tools.";

/** Vista estricta aparte: la API de ajustes normal mantiene su comportamiento histórico
 * de null/valores por defecto, pero el acceso a fuentes debe distinguir las preferencias ausentes
 * de unos ajustes existentes corruptos/ilegibles. Nunca expone JSON crudo ni errores. */
function fileAccessFromRecord(raw: unknown): FileAccessSettingsResult {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: FILE_ACCESS_ERROR };
	const agent = (raw as Record<string, unknown>).agent;
	if (agent === undefined) return { ok: true, settings: { restricted: false, folders: [] } };
	if (!agent || typeof agent !== "object" || Array.isArray(agent)) return { ok: false, error: FILE_ACCESS_ERROR };
	const value = (agent as Record<string, unknown>).fileAccess;
	if (value === undefined) return { ok: true, settings: { restricted: false, folders: [] } };
	const parsed = parseFileAccessSettings(value);
	if (!parsed.ok || parsed.settings.folders.some((folder) => folder !== "~" && !folder.startsWith("~/") && !path.isAbsolute(folder))) {
		return { ok: false, error: FILE_ACCESS_ERROR };
	}
	return parsed;
}

/** Un ENOENT por un enlace simbólico colgado de settings/de un ancestro NO es un primer arranque.
 * Busca la entrada existente más cercana y verifica que su directorio es utilizable. */
function settingsAreAbsent(): boolean {
	let candidate = SETTINGS_FILE;
	for (;;) {
		try { fs.lstatSync(/* turbopackIgnore: true */ candidate); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
			const parent = path.dirname(candidate);
			if (parent === candidate) return false;
			candidate = parent;
			continue;
		}
		if (candidate === SETTINGS_FILE) return false;
		try {
			if (!fs.statSync(/* turbopackIgnore: true */ candidate).isDirectory()) return false;
			fs.accessSync(/* turbopackIgnore: true */ candidate, fs.constants.R_OK | fs.constants.X_OK);
			return true;
		} catch { return false; }
	}
}

export function readFileAccessSettings(): FileAccessSettingsResult {
	let raw: string;
	try { raw = fs.readFileSync(SETTINGS_FILE, "utf-8"); }
	catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" && settingsAreAbsent()
			? { ok: true, settings: { restricted: false, folders: [] } }
			: { ok: false, error: FILE_ACCESS_ERROR };
	}
	try { return fileAccessFromRecord(JSON.parse(raw)); }
	catch { return { ok: false, error: FILE_ACCESS_ERROR }; }
}

/** El registro persistido, o null cuando no existe ninguno (primer arranque). Ejecuta la
 *  cadena de migración en cada lectura: barato: una comprobación de fichero que no hace nada si está al día. */
export function readSettings(): UserSettings | null {
	let raw: string;
	try {
		raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
	} catch {
		return null; // aún no hay settings.json: primer arranque, todo con valores de fábrica
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null; // corrupto → semántica de primer arranque (todo con valores de fábrica)
	}
	const record = sanitizeUserSettings(parsed);
	if (!record) return null;
	if (!fileAccessFromRecord(parsed).ok) {
		// Las escrituras de secciones no relacionadas llevan este marcador seguro, no una política
		// malformada descartada que restauraría en silencio las lecturas sin restricciones.
		record.agent = { ...record.agent, fileAccess: { restricted: true, folders: [] } };
	}
	// Cadena de versiones (vacía hoy): una futura migración a v2 se encaja aquí:
	// `if (record.version > CURRENT_SETTINGS_VERSION) …`. Las versiones MÁS NUEVAS desconocidas
	// pasan sin tocar (el saneador conservó lo desconocido).
	return record;
}

/** Persiste el registro (saneado). Devuelve lo que se escribió. */
export function writeSettings(raw: unknown): UserSettings {
	const settings = sanitizeUserSettings(raw);
	if (!settings) throw new Error("settings record must be a JSON object");
	if (!readFileAccessSettings().ok && settings.agent?.fileAccess === undefined) {
		// Una corrupción del fichero entero no la puede transportar readSettings (null).
		// Guardar otra preferencia lo repara convirtiéndolo en una política BLOQUEADA salvo que
		// la escritura aporte explícitamente una preferencia de acceso a ficheros válida.
		settings.agent = { ...settings.agent, fileAccess: { restricted: true, folders: [] } };
	}
	fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
	writeFileAtomicSync(SETTINGS_FILE, JSON.stringify(settings, null, "\t"), { allowInPlaceFallback: true });
	return settings;
}

/** El adaptador tipado (SettingsStore de core/ports.ts), para la raíz de composición. */
export const settingsStore: SettingsStore = {
	readSettings,
	writeSettings,
};
