/**
 * El STORE de sustituciones de prompts (oleada de almacenamiento de ajustes, 2026-09-19; reconciliación
 * P2 el mismo día): el CRUD de ficheros de sustitución tras el puerto de core:
 * listar/leer/escribir/borrar bajo config.PROMPTS_OVERRIDE_DIR.
 *
 * El descubrimiento + la resolución CANÓNICOS de segmentos (listSourceSegments,
 * effectivePromptSegments, allSegmentPaths) viven en la capa del agente
 * (src/agent/prompt-segments.ts): la composición es asunto del agente, y
 * la ley de la arquitectura mantiene separadas las capas (store no puede importar agent;
 * agent no puede importar store). Ambos lados comparten la gramática pura de rutas
 * (src/core/prompt-segments.ts); el readOverride del store y el
 * readPromptOverride del agente leen la MISMA disposición en espejo.
 *
 * SEGMENTOS: un prompt se compone a partir de la base COMPARTIDA
 * (src/agent/system-prompt.md), los fragmentos de shared/ (que componen ambos
 * agentes), más cada fragmento *.md con prefijo numérico del directorio propio
 * del agente: ver el módulo del agente para las reglas completas.
 *
 * SUSTITUCIONES: los ficheros de sustitución reflejan la disposición de las fuentes bajo
 * config.PROMPTS_OVERRIDE_DIR: "system-prompt.md" en la raíz,
 * "shared/<file>", "teacher/<file>" / "prober/<file>" (rutas relativas
 * POSIX, las mismas claves que los interruptores agent.prompts del registro de ajustes).
 * La presencia del fichero NO es la sustitución: lo es el interruptor (decisión del responsable): el
 * usuario conserva su fichero y vuelve al valor por defecto de la fuente para comparar.
 *
 * Disciplina de rutas: solo .md bajo el directorio de sustituciones, sin recorrido (sin "..",
 * rutas absolutas ni segmentos vacíos): una ruta fabricada a mano fuera de la disposición
 * en espejo se rechaza (null / no hace nada), nunca se escribe.
 */

import fs from "node:fs";
import path from "node:path";
import { PROMPTS_OVERRIDE_DIR } from "../../config.ts";
import { isValidSegmentPath } from "../core/prompt-segments.ts";
import type { PromptOverrideStore } from "../core/ports.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

/** Ruta absoluta de un fichero de sustitución (sin comprobar: valida antes). */
function overrideFileFor(segmentPath: string): string {
	return path.join(PROMPTS_OVERRIDE_DIR, ...segmentPath.split("/"));
}

/** El adaptador del store (core/ports.ts). */
export const promptOverrides: PromptOverrideStore = {
	listOverrides(): string[] {
		const out: string[] = [];
		const walk = (dir: string, prefix: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return; // aún no hay directorio = no hay sustituciones
			}
			for (const entry of entries) {
				const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
				else if (entry.isFile() && entry.name.endsWith(".md") && isValidSegmentPath(rel)) out.push(rel);
			}
		};
		walk(PROMPTS_OVERRIDE_DIR, "");
		return out.sort();
	},

	readOverride(segmentPath: string): string | null {
		if (!isValidSegmentPath(segmentPath)) return null;
		try {
			return fs.readFileSync(overrideFileFor(segmentPath), "utf-8");
		} catch {
			return null;
		}
	},

	writeOverride(segmentPath: string, text: string): void {
		if (!isValidSegmentPath(segmentPath)) return;
		const file = overrideFileFor(segmentPath);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		writeFileAtomicSync(file, text, { allowInPlaceFallback: true });
	},

	deleteOverride(segmentPath: string): void {
		if (!isValidSegmentPath(segmentPath)) return;
		try {
			fs.unlinkSync(overrideFileFor(segmentPath));
		} catch {
			// ya ausente = hecho
		}
		removeLeftoverTemps(overrideFileFor(segmentPath));
	},
};
