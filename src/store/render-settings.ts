/**
 * Persistencia del lado del servidor de los ajustes de renderizado del grafo (los controles del
 * panel de ajustes): data/render-settings.json, de lectura-modificación-escritura, NO un registro de solo anexado.
 *
 * La forma, los valores por defecto y el saneador viven en src/core/render-settings.ts
 * (puro, compartido con el cliente); este módulo solo mueve bytes. Lo que
 * sale del disco lo sanea el llamador al cargar, y nosotros también saneamos al
 * escribir, para que el fichero nunca pueda contener un valor fuera de rango que
 * desplace en silencio un deslizador.
 */

import fs from "node:fs";
import path from "node:path";
import { RENDER_SETTINGS_FILE } from "../../config.ts";
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings, type GraphRenderSettings } from "../core/render-settings.ts";
import { assertGraphFormat, ensureGraphFormat } from "./graph-format.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

/** Los ajustes persistidos, o null cuando aún no existe el fichero (primer arranque). */
export function readRenderSettings(): GraphRenderSettings | null {
	assertGraphFormat(); // rechazo honesto ante un directorio de datos sellado con una versión más nueva
	let raw: string;
	try {
		raw = fs.readFileSync(RENDER_SETTINGS_FILE, "utf-8");
	} catch {
		return null; // nunca arrancado / ilegible → el llamador usa los valores por defecto
	}
	try {
		return sanitizeRenderSettings(JSON.parse(raw));
	} catch {
		return null; // corrupto → valores por defecto, nunca romper la vista
	}
}

/** Persiste los ajustes (saneados). Devuelve lo que se escribió. */
export function writeRenderSettings(raw: unknown): GraphRenderSettings {
	const settings = sanitizeRenderSettings(raw);
	fs.mkdirSync(path.dirname(RENDER_SETTINGS_FILE), { recursive: true });
	ensureGraphFormat(); // el sello de formato perezoso (graph-format.ts)
	writeFileAtomicSync(RENDER_SETTINGS_FILE, JSON.stringify(settings, null, "\t"), { allowInPlaceFallback: true });
	return settings;
}

export { DEFAULT_RENDER_SETTINGS };
