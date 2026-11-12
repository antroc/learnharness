"use strict";
/** La apariencia nativa debe estar lista antes de crear una ventana, con
 * independencia del primer informe del renderer. Mantén la pequeña
 * proyección de arranque de los predefinidos fijada al catálogo completo del
 * núcleo en appearance-chrome.test.ts. */
const fs = require("node:fs");
const path = require("node:path");

const PRESET_APPEARANCE = {
	default: { mode: "dark", background: "#141414" },
	"catppuccin-latte": { mode: "light", background: "#eff1f5" },
	"catppuccin-frappe": { mode: "dark", background: "#303446" },
	"catppuccin-macchiato": { mode: "dark", background: "#24273a" },
	"catppuccin-mocha": { mode: "dark", background: "#1e1e2e" },
	"rose-pine": { mode: "dark", background: "#191724" },
	"rose-pine-dawn": { mode: "light", background: "#faf4ed" },
	"gruvbox-dark": { mode: "dark", background: "#282828" },
	ivory: { mode: "light", background: "#faf9f5" },
	pastel: { mode: "light", background: "#f2f0e8" },
	"nvchad-onedark": { mode: "dark", background: "#1e222a" },
};
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const COLOR_KEYS = ["background", "surface", "border", "text", "textMuted", "accent", "bold", "italic", "code", "error", "success", "warning"];

function normalizeAppearance(a) {
	return {
		mode: a?.mode === "light" ? "light" : "dark",
		background: typeof a?.background === "string" && HEX.test(a.background) ? a.background : null,
	};
}

/** Conserva para el modo oscuro los menús/diálogos de Electron anteriores a
 * los temas, que siguen al SO. La paleta de la app/ventana en sí sigue fijada
 * al tema seleccionado. */
function themeSourceFor(mode) {
	return mode === "light" ? "light" : "system";
}

/** Refleja la ruta de datos del servidor en el modo de desarrollo externo,
 * no el userData -dev aparte del armazón. El empaquetado usa la ruta que se
 * pasa a su hijo. */
function serverDataDir({ devUrl, env, packagedDataDir, repoRoot }) {
	if (!devUrl) return packagedDataDir;
	return env.LH_DATA_DIR ? path.resolve(env.LH_DATA_DIR) : path.join(repoRoot, "data");
}

function readAppearance(dataDir) {
	let a;
	try { a = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"))?.appearance; }
	catch { /* registro ausente/corrupto = de fábrica */ }
	const id = typeof a?.theme === "string" ? a.theme : undefined;
	let theme = Object.hasOwn(PRESET_APPEARANCE, id) ? PRESET_APPEARANCE[id] : PRESET_APPEARANCE.default;
	if (typeof id === "string" && id.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && !Object.hasOwn(PRESET_APPEARANCE, id)) {
		try {
			const custom = JSON.parse(fs.readFileSync(path.join(dataDir, "themes", `${id}.json`), "utf8"));
			// Coincide con el analizador del núcleo solo de datos: los ficheros mal formados se renderizan como Default,
			// incluidos los que tienen un fondo válido pero otra tinta no válida.
			if (typeof custom?.name === "string" && custom.name.trim() && /[a-z0-9]/i.test(custom.name.normalize("NFD")) &&
				(custom.mode === "dark" || custom.mode === "light") && custom.colors && !Array.isArray(custom.colors) &&
				COLOR_KEYS.every(key => typeof custom.colors[key] === "string" && HEX.test(custom.colors[key]))) {
				theme = { mode: custom.mode, background: custom.colors.background };
			}
		} catch { /* fichero seleccionado ausente/no válido = Default */ }
	}
	return { mode: theme.mode, background: normalizeAppearance(a).background ?? theme.background };
}

function luminance(hex) {
	const full = hex.length === 4 ? hex.slice(1).split("").map(c => c + c).join("") : hex.slice(1);
	return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
		const c = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
		return sum + weight * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	}, 0);
}

/** El contraste de los glifos de la barra de título sigue al fondo final
 * real, incluidas las sustituciones que no coinciden con la etiqueta
 * oscuro/claro del tema seleccionado. */
function chromeColors(appearance) {
	const color = appearance.background ?? (appearance.mode === "light" ? "#f5f5f3" : "#141414");
	const bg = luminance(color);
	const contrast = ink => (Math.max(bg, luminance(ink)) + 0.05) / (Math.min(bg, luminance(ink)) + 0.05);
	return { color, symbolColor: contrast("#e5e5e5") > contrast("#1a1a1a") ? "#e5e5e5" : "#1a1a1a" };
}

module.exports = { PRESET_APPEARANCE, COLOR_KEYS, normalizeAppearance, themeSourceFor, serverDataDir, readAppearance, chromeColors };
