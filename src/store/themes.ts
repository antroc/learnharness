/**
 * El STORE de temas personalizados (oleada de temas, 2026-11-04): ficheros `<id>.json` bajo
 * config.THEMES_DIR tras el puerto ThemeStore de core. Los ficheros se vuelven a validar
 * al leer (un fichero editado a mano o truncado se salta, nunca lanza), y los
 * ids siguen la gramática de slugs para que un id fabricado no pueda salir del directorio.
 */

import fs from "node:fs";
import path from "node:path";
import { THEMES_DIR } from "../../config.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";
import type { ThemeStore } from "../core/ports.ts";
import { isBuiltinThemeId, isThemeId, sanitizeThemeFile, type Theme, type ThemeFile } from "../core/themes.ts";

function fileFor(id: string): string {
	return path.join(/* turbopackIgnore: true */ THEMES_DIR, `${id}.json`);
}

function read(id: string): Theme | null {
	if (!isThemeId(id) || isBuiltinThemeId(id)) return null;
	try {
		const theme = sanitizeThemeFile(JSON.parse(fs.readFileSync(fileFor(id), "utf-8")));
		return theme ? { ...theme, id, builtin: false } : null;
	} catch {
		return null;
	}
}

/** El ThemeStore en disco: un `<id>.json` por tema importado bajo THEMES_DIR;
 *  los ficheros ilegibles o no válidos se saltan, nunca lanzan. */
export const themeStore: ThemeStore = {
	listThemes(): Theme[] {
		let names: string[];
		try {
			names = fs.readdirSync(THEMES_DIR);
		} catch {
			return []; // aún no hay directorio = no hay temas personalizados
		}
		return names
			.filter((n) => n.endsWith(".json"))
			.map((n) => read(n.slice(0, -".json".length)))
			.filter((t): t is Theme => t !== null)
			.sort((a, b) => a.id.localeCompare(b.id));
	},

	readTheme: read,

	writeTheme(id: string, theme: ThemeFile): void {
		if (!isThemeId(id) || isBuiltinThemeId(id)) throw new Error(`Invalid custom theme id "${id}"`);
		fs.mkdirSync(THEMES_DIR, { recursive: true });
		const file: ThemeFile = { name: theme.name, mode: theme.mode, colors: theme.colors };
		writeFileAtomicSync(fileFor(id), `${JSON.stringify(file, null, "\t")}\n`);
	},

	deleteTheme(id: string): void {
		if (!isThemeId(id) || isBuiltinThemeId(id)) return;
		fs.rmSync(fileFor(id), { force: true });
		removeLeftoverTemps(fileFor(id));
	},
};
