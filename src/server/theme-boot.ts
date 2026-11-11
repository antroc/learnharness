/**
 * EL TEMA DEL PRIMER PINTADO (oleada de temas, 2026-11-04): lo que
 * app/layout.tsx pone en <html> antes de que se ejecute ningún código del
 * cliente: la apariencia del registro, el tema activo (un preajuste o un
 * fichero importado; Default si el id ya no existe) y sus variables de color
 * con todas las sustituciones aplicadas. Lee el registro y solo el fichero
 * personalizado seleccionado (el layout llama antes a connection(), así que
 * esto nunca queda fijado en un prerenderizado).
 */

import { effectiveColors, isBuiltinThemeId, resolveTheme, themeVars, type AppearanceSettings, type Theme } from "../core";
import { themeStore } from "../store/themes.ts";
import { readSettings } from "../store/settings.ts";

/** Todo lo que necesita el layout para un primer pintado sin parpadeo. */
export interface ThemeBoot {
	appearance: AppearanceSettings | undefined;
	theme: Theme;
	/** Las variables CSS para <html style>. */
	vars: Record<string, string>;
}

/** Lee el registro y el fichero personalizado seleccionado; resuelve el tema activo y sus variables. */
export function readThemeBoot(): ThemeBoot {
	const appearance = readSettings()?.appearance;
	const id = appearance?.theme;
	const custom = id && !isBuiltinThemeId(id) ? themeStore.readTheme(id) : null;
	const theme = resolveTheme(id, custom ? [custom] : []);
	return { appearance, theme, vars: themeVars(effectiveColors(theme, appearance), theme.mode) };
}
