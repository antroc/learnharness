/** Preferencias no secretas, de todo el usuario, sobre las fuentes del
 * alumno. La ausencia significa DESACTIVADO; una lista vacía explícitamente
 * restringida significa ningún acceso a las fuentes del alumno. */
export interface FileAccessSettings {
	restricted: boolean;
	folders: string[];
}

/** Sintaxis portable para el editor/analizador. El servidor comprueba además
 * si una ruta es absoluta en SU sistema de ficheros antes de aplicarla. */
export function isFileAccessFolder(folder: string): boolean {
	return !folder.includes("\0") && (folder === "~" || folder.startsWith("~/") || folder.startsWith("/") || /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith("\\\\"));
}

export type FileAccessSettingsResult =
	| { ok: true; settings: FileAccessSettings }
	| { ok: false; error: string };

/** Las preferencias sensibles para la seguridad usan el MISMO analizador
 * estricto de lectura/escritura: una política mal formada no debe
 * desaparecer convertida en un valor por defecto sin restricciones. */
export function parseFileAccessSettings(raw: unknown): FileAccessSettingsResult {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "fileAccess must be an object" };
	const value = raw as Record<string, unknown>;
	if (Object.keys(value).some((key) => key !== "restricted" && key !== "folders")) {
		return { ok: false, error: "fileAccess contains unsupported fields" };
	}
	if (value.restricted !== undefined && typeof value.restricted !== "boolean") {
		return { ok: false, error: "fileAccess.restricted must be a boolean" };
	}
	if (value.folders !== undefined && !Array.isArray(value.folders)) {
		return { ok: false, error: "fileAccess.folders must be an array" };
	}
	const folders: string[] = [];
	for (const entry of (value.folders ?? []) as unknown[]) {
		if (typeof entry !== "string" || !isFileAccessFolder(entry.trim())) {
			return { ok: false, error: "fileAccess.folders entries must be absolute paths (or start with ~/), without NUL characters" };
		}
		const folder = entry.trim();
		if (!folders.includes(folder)) folders.push(folder);
	}
	return { ok: true, settings: { restricted: value.restricted === true, folders } };
}
