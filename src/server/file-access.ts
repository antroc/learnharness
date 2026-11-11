/** Preferencias opcionales actuales sobre las fuentes del alumno, conectadas por la raíz
 * de composición del servidor a la frontera de políticas de #157. La protección obligatoria
 * de #421 se queda en fs-shared; NO añadas aquí una denegación de todo data/userData. */
import os from "node:os";
import path from "node:path";
import type { FileAccessPolicy } from "../agent/tools/file-access.ts";
import { readFileAccessSettings } from "../store/settings.ts";

export function expandFolder(folder: string, home: string = os.homedir()): string {
	if (folder === "~") return home;
	if (folder.startsWith("~/")) return path.join(home, folder.slice(2));
	if (!path.isAbsolute(folder)) throw new Error("Invalid file-access folder for this server filesystem");
	return path.resolve(folder);
}

export function fileAccessPolicy(): FileAccessPolicy {
	const result = readFileAccessSettings();
	if (!result.ok) return { restricted: true, folders: [], error: result.error };
	return { restricted: result.settings.restricted, folders: result.settings.folders.map((folder) => expandFolder(folder)) };
}

/** Diagnóstico seguro para la interfaz, sin JSON en bruto ni contenido de ficheros. Un registro
 * dañado no debe hacer que el conmutador de restricción aparezca como desactivado sin peligro
 * mientras las lecturas están bloqueadas. */
export function fileAccessConfigurationError(): string | null {
	const result = readFileAccessSettings();
	return result.ok ? null : result.error;
}
