/**
 * El SELLO DE FORMATO de la familia del grafo (oleada de versionado de esquemas, responsable 2026-10-10):
 * data/graph/format.json: un fichero auxiliar que versiona toda la familia del directorio
 * del grafo (los cuatro registros JSONL, sources.json, render-settings.json).
 * Los registros JSONL no pueden llevar sellos en línea sin hincharse línea a línea, y los
 * ficheros JSON corren la misma suerte que la familia, así que el sello vive a su lado.
 * positions.json se puede reconstruir (decisión del responsable) y no necesita protección.
 *
 * El contrato:
 *  - v1 PEREZOSA: SIN fichero auxiliar = v1 (el mundo anterior al sello sigue siendo válido para siempre);
 *    la primera ESCRITURA de la familia del grafo lo crea. Las lecturas nunca escriben.
 *  - Rechazo honesto (responsable: decisión de rechazar con honestidad): un fichero auxiliar sellado
 *    con una versión MÁS NUEVA que este build (el escenario de volver a una versión anterior: el usuario revirtió la
 *    app) hace que las lecturas de la familia del grafo LANCEN. Los stores de lectura-modificación-escritura
 *    nunca deben reescribir lo que no entienden; un store de registros nunca debe
 *    saltarse en silencio líneas que no puede interpretar como datos del formato actual.
 *
 * Constantes de versión: CURRENT_GRAPH_FORMAT_VERSION de contracts/graph.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { GRAPH_FORMAT_FILE } from "../../config.ts";
import { CURRENT_GRAPH_FORMAT_VERSION } from "../core/contracts/graph.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function stampedVersion(): number | null {
	let raw: string;
	try {
		raw = fs.readFileSync(GRAPH_FORMAT_FILE, "utf-8");
	} catch {
		return null; // sin fichero auxiliar: el mundo v1 perezoso anterior al sello
	}
	try {
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "number" && Number.isInteger(parsed.version) ? parsed.version : null;
	} catch {
		return null; // un fichero auxiliar corrupto se lee como sin sellar (v1), no es fatal
	}
}

/** GUARDA DEL LADO DE LECTURA: lanza cuando el directorio de datos lo escribió un build MÁS NUEVO.
 *  La llama cada lectura de la familia del grafo; nunca escribe (los fixtures de referencia
 *  fijan las lecturas como idénticas byte a byte). */
export function assertGraphFormat(): void {
	const v = stampedVersion();
	if (v !== null && v > CURRENT_GRAPH_FORMAT_VERSION) {
		throw new Error(
			`Graph data is stamped with format version ${v}, but this build understands only ${CURRENT_GRAPH_FORMAT_VERSION}. ` +
				"The app is older than its data — upgrade the app before touching the knowledge map.",
		);
	}
}

/** SELLO DEL LADO DE ESCRITURA: crea el fichero auxiliar en la primera escritura de la familia del grafo
 *  (perezoso); después no hace nada en cuanto a existencia. Los llamadores siguen haciendo su propio mkdir. */
export function ensureGraphFormat(): void {
	if (stampedVersion() !== null) return;
	fs.mkdirSync(path.dirname(GRAPH_FORMAT_FILE), { recursive: true });
	writeFileAtomicSync(GRAPH_FORMAT_FILE, JSON.stringify({ version: CURRENT_GRAPH_FORMAT_VERSION }, null, "\t") + "\n", { allowInPlaceFallback: true });
}
