/**
 * TEMAS (oleada de temas, 2026-11-04): el vocabulario de colores que el usuario
 * elige, importa y exporta, y su traducción a los tokens de shadcn que ya consumen
 * los componentes. Puro y seguro para el navegador: lo comparten el layout (primer
 * pintado), el proveedor, la sección de Ajustes y la API de temas.
 *
 * Un tema son 12 colores hexadecimales más la variante con la que se renderiza
 * (oscura/clara). Los preajustes integrados viven aquí; los personalizados son
 * ficheros JSON en config.THEMES_DIR (el puerto ThemeStore). El registro de ajustes
 * nombra el tema activo por id y lleva SUSTITUCIONES por color que sobreviven a cada
 * cambio de tema (decisión del responsable: perder la configuración del usuario es
 * peor que una combinación rara).
 */

import type { AppearanceSettings } from "./settings.ts";

/** La variante en pantalla: la clase `dark`/`light` en <html>. */
export type ThemeMode = "dark" | "light";
/** Se mantiene para los renderizadores que dependen del modo (lienzo del grafo, mermaid). */
export type RenderedMode = ThemeMode;

/** Los 12 colores del tema, en el orden en que los muestra la cuadrícula de Ajustes. */
export const THEME_COLOR_KEYS = [
	"background",
	"accent",
	"surface",
	"bold",
	"border",
	"italic",
	"text",
	"code",
	"textMuted",
	"error",
	"success",
	"warning",
] as const;

/** Uno de los doce colores del tema. */
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
/** Una paleta completa: todas las claves, cada una un #hex. */
export type ThemeColors = Record<ThemeColorKey, string>;

/** Las claves cuya sustitución vive en `appearance.colors` — las otras tres conservan
 * su sitio anterior a los temas (`background`, `mdRendering.boldColor` y
 * `mdRendering.italicColor`). */
export const COLOR_OVERRIDE_KEYS = [
	"surface",
	"border",
	"text",
	"textMuted",
	"accent",
	"code",
	"error",
	"success",
	"warning",
] as const;

/** Una clave cuya sustitución vive en `appearance.colors`. */
export type ColorOverrideKey = (typeof COLOR_OVERRIDE_KEYS)[number];
/** `appearance.colors`: el hexadecimal gana al tema; null/ausente = el color del tema. */
export type AppearanceColorOverrides = Partial<Record<ColorOverrideKey, string | null>>;

/** La forma del fichero / JSON (importación y exportación). */
export interface ThemeFile {
	name: string;
	mode: ThemeMode;
	colors: ThemeColors;
}

/** Un tema del catálogo: un preajuste (`builtin`) o un fichero importado,
 * identificado por su id en forma de slug. */
export interface Theme extends ThemeFile {
	id: string;
	builtin: boolean;
}

/** El tema que renderiza un registro sin `appearance.theme`. */
export const DEFAULT_THEME_ID = "default";

/** #rgb / #rrggbb (sin distinguir mayúsculas). Igual que settings.isHexColor sin
 * importarlo (settings.ts importa los tipos de este módulo). */
function isHex(value: unknown): value is string {
	return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Valida un tema importado: `{ ok: false, error }` nombra el primer campo
 * incorrecto para que la tarjeta de importación pueda decir qué falla. Las claves
 * desconocidas se descartan. */
export function parseThemeFile(raw: unknown): { ok: true; theme: ThemeFile } | { ok: false, error: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "theme must be a JSON object" };
	const r = raw as Record<string, unknown>;
	if (typeof r.name !== "string" || !r.name.trim()) return { ok: false, error: "name must be a non-empty string" };
	if (!themeIdFromName(r.name)) return { ok: false, error: "name must contain a letter or digit" };
	if (r.mode !== "dark" && r.mode !== "light") return { ok: false, error: 'mode must be "dark" or "light"' };
	if (!r.colors || typeof r.colors !== "object" || Array.isArray(r.colors)) {
		return { ok: false, error: "colors must be an object" };
	}
	const c = r.colors as Record<string, unknown>;
	const colors = {} as ThemeColors;
	for (const key of THEME_COLOR_KEYS) {
		if (!isHex(c[key])) return { ok: false, error: `colors.${key} must be a #hex color` };
		colors[key] = c[key];
	}
	return { ok: true, theme: { name: r.name.trim(), mode: r.mode, colors } };
}

/** La forma del saneador: el tema, o null si algo no cuadra. */
export function sanitizeThemeFile(raw: unknown): ThemeFile | null {
	const parsed = parseThemeFile(raw);
	return parsed.ok ? parsed.theme : null;
}

/** "Rosé Pine Moon" → "rose-pine-moon". Vacío si no sobrevive nada. */
export function themeIdFromName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 64)
		.replace(/^-+|-+$/g, "");
}

/** Ids de tema válidos: la gramática de slugs que produce themeIdFromName. */
export function isThemeId(value: unknown): value is string {
	return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

function builtin(name: string, mode: ThemeMode, c: ThemeColors): Theme {
	return { id: themeIdFromName(name), name, mode, colors: c, builtin: true };
}

/** Los preajustes, en el orden de la cuadrícula. Default = la paleta oscura original
 * de la app (app/globals.css la lleva como literales; las pruebas fijan que ambas sean
 * iguales). Catppuccin: base/surface0/surface1, acento mauve, énfasis
 * lavender/pink/peach; Latte usa en su lugar mantle/surface0, porque surface0 sobre
 * una página clara se ve como un bloque gris pesado, y la negrita de Frappé es
 * flamingo (responsable, 2026-11-04).
 * Rosé Pine: base/surface/highlight-med, acento iris, énfasis iris/rose/gold.
 * Gruvbox Dark: medium (bg0/bg0_s/bg2) con los acentos brillantes; acento naranja,
 * énfasis azul/morado/aguamarina. Ivory: página marfil cálida, acento terracota,
 * énfasis azul/verde/arcilla. Pastel: una página gris crema con tintas suaves verde,
 * morada y naranja. NvChad Onedark: el onedark de base46. */
export const BUILTIN_THEMES: readonly Theme[] = [
	{
		id: DEFAULT_THEME_ID,
		name: "Default",
		mode: "dark",
		builtin: true,
		colors: {
			background: "#141414", surface: "#1c1c1c", border: "#434343", text: "#e6e6e6", textMuted: "#8d8d8d",
			accent: "#8d8d8d", bold: "#e6e6e6", italic: "#e6e6e6", code: "#e6e6e6",
			error: "#ef4444", success: "#22c55e", warning: "#f59e0b",
		},
	},
	builtin("Catppuccin Latte", "light", {
		background: "#eff1f5", surface: "#e6e9ef", border: "#ccd0da", text: "#4c4f69", textMuted: "#6c6f85",
		accent: "#8839ef", bold: "#7287fd", italic: "#ea76cb", code: "#fe640b",
		error: "#d20f39", success: "#40a02b", warning: "#df8e1d",
	}),
	builtin("Catppuccin Frappé", "dark", {
		background: "#303446", surface: "#414559", border: "#51576d", text: "#c6d0f5", textMuted: "#a5adce",
		accent: "#ca9ee6", bold: "#eebebe", italic: "#f4b8e4", code: "#ef9f76",
		error: "#e78284", success: "#a6d189", warning: "#e5c890",
	}),
	builtin("Catppuccin Macchiato", "dark", {
		background: "#24273a", surface: "#363a4f", border: "#494d64", text: "#cad3f5", textMuted: "#a5adcb",
		accent: "#c6a0f6", bold: "#b7bdf8", italic: "#f5bde6", code: "#f5a97f",
		error: "#ed8796", success: "#a6da95", warning: "#eed49f",
	}),
	builtin("Catppuccin Mocha", "dark", {
		background: "#1e1e2e", surface: "#313244", border: "#45475a", text: "#cdd6f4", textMuted: "#a6adc8",
		accent: "#cba6f7", bold: "#b4befe", italic: "#f5c2e7", code: "#fab387",
		error: "#f38ba8", success: "#a6e3a1", warning: "#f9e2af",
	}),
	builtin("Rosé Pine", "dark", {
		background: "#191724", surface: "#1f1d2e", border: "#403d52", text: "#e0def4", textMuted: "#908caa",
		accent: "#c4a7e7", bold: "#c4a7e7", italic: "#ebbcba", code: "#f6c177",
		error: "#eb6f92", success: "#9ccfd8", warning: "#f6c177",
	}),
	builtin("Rosé Pine Dawn", "light", {
		background: "#faf4ed", surface: "#fffaf3", border: "#dfdad9", text: "#575279", textMuted: "#797593",
		accent: "#907aa9", bold: "#907aa9", italic: "#d7827e", code: "#ea9d34",
		error: "#b4637a", success: "#56949f", warning: "#ea9d34",
	}),
	builtin("Gruvbox Dark", "dark", {
		background: "#282828", surface: "#32302f", border: "#504945", text: "#ebdbb2", textMuted: "#a89984",
		accent: "#fe8019", bold: "#83a598", italic: "#d3869b", code: "#8ec07c",
		error: "#fb4934", success: "#b8bb26", warning: "#fabd2f",
	}),
	builtin("Ivory", "light", {
		background: "#faf9f5", surface: "#f0eee6", border: "#e0ddd2", text: "#3d3d3a", textMuted: "#83827d",
		accent: "#d97757", bold: "#3266c9", italic: "#3f8f6b", code: "#c4613f",
		error: "#c43d3d", success: "#3f8f6b", warning: "#b8822a",
	}),
	builtin("Pastel", "light", {
		background: "#f2f0e8", surface: "#e8e6dc", border: "#d6d3c6", text: "#4a4842", textMuted: "#8f8b80",
		accent: "#4f8a46", bold: "#4f8a46", italic: "#8a5cb5", code: "#b8623b",
		error: "#c0533f", success: "#4f8a46", warning: "#b8862c",
	}),
	builtin("NvChad Onedark", "dark", {
		background: "#1e222a", surface: "#282c34", border: "#42464e", text: "#abb2bf", textMuted: "#565c64",
		accent: "#61afef", bold: "#c882e7", italic: "#a3b8ef", code: "#e7c787",
		error: "#e06c75", success: "#98c379", warning: "#e7c787",
	}),
];

/** La paleta oscura original de la app, y la alternativa cuando falta un id. */
export const DEFAULT_THEME: Theme = BUILTIN_THEMES[0]!;

/** Los ids de los preajustes están reservados: las importaciones nunca los toman y DELETE los rechaza. */
export function isBuiltinThemeId(id: string): boolean {
	return BUILTIN_THEMES.some((t) => t.id === id);
}

/** El tema activo: el id del registro entre los integrados y los personalizados, o
 * Default si el id falta o su fichero ha desaparecido. */
export function resolveTheme(id: string | null | undefined, customs: readonly Theme[] = []): Theme {
	if (!id) return DEFAULT_THEME;
	return BUILTIN_THEMES.find((t) => t.id === id) ?? customs.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** El único sitio donde los dos lugares de sustitución se fusionan sobre el tema: las
 * claves antiguas (`background`, `mdRendering.boldColor/italicColor`) y `colors`. Una
 * sustitución null/ausente = el color del tema. */
export function effectiveColors(theme: ThemeFile, appearance: AppearanceSettings | undefined): ThemeColors {
	const out: ThemeColors = { ...theme.colors };
	if (!appearance) return out;
	if (isHex(appearance.background)) out.background = appearance.background;
	if (isHex(appearance.mdRendering?.boldColor)) out.bold = appearance.mdRendering.boldColor;
	if (isHex(appearance.mdRendering?.italicColor)) out.italic = appearance.mdRendering.italicColor;
	for (const key of COLOR_OVERRIDE_KEYS) {
		const v = appearance.colors?.[key];
		if (isHex(v)) out[key] = v;
	}
	return out;
}

/** Desplaza cada canal en `add`, acotado a 0–255 (siempre sale #rrggbb). */
export function shiftHex(hex: string, add: number): string {
	const n = hex.length === 4
		? hex.slice(1).split("").map((c) => parseInt(c + c, 16))
		: [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
	return `#${n.map((c) => Math.min(255, Math.max(0, c + add)).toString(16).padStart(2, "0")).join("")}`;
}

/** La superficie de hover queda un paso por encima o por debajo de `surface`: más
 * clara en oscuro, más oscura en claro (#1c1c1c → #2a2a2a, el hover original elegido a mano). */
const HOVER_STEP = 14;

/** EL adaptador: 12 colores del tema → las variables CSS que se fijan en <html>.
 * `--accent` sigue siendo la superficie de HOVER de shadcn (derivada de `surface`, así
 * los hovers nunca adoptan el color de resaltado); el acento del tema es `--lh-accent`
 * (anillo, interruptores, la tarjeta del tema seleccionado). */
export function themeVars(c: ThemeColors, mode: ThemeMode): Record<string, string> {
	return {
		"--background": c.background,
		"--foreground": c.text,
		"--card": c.surface,
		"--card-foreground": c.text,
		"--popover": c.surface,
		"--popover-foreground": c.text,
		"--primary": c.text,
		"--primary-foreground": c.background,
		"--secondary": c.surface,
		"--secondary-foreground": c.text,
		"--muted": c.surface,
		"--muted-foreground": c.textMuted,
		"--accent": shiftHex(c.surface, mode === "dark" ? HOVER_STEP : -HOVER_STEP),
		"--accent-foreground": c.text,
		"--destructive": c.error,
		"--border": c.border,
		"--input": c.border,
		"--ring": c.accent,
		"--lh-accent": c.accent,
		"--lh-line-strong": c.text,
		"--lh-ink-strong": c.bold,
		"--lh-ink-italic": c.italic,
		"--lh-ink-code": c.code,
		"--lh-error": c.error,
		"--lh-success": c.success,
		"--lh-warning": c.warning,
	};
}

/** Exportación: el tema activo con todas las sustituciones aplicadas — volver a
 * importar el fichero reproduce exactamente lo que hay en pantalla. */
export function exportThemeFile(theme: ThemeFile, appearance: AppearanceSettings | undefined): ThemeFile {
	return { name: theme.name, mode: theme.mode, colors: effectiveColors(theme, appearance) };
}
