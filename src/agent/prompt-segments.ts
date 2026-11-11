/**
 * EL descubrimiento canónico de segmentos de prompt + resolución de sustituciones (conciliación
 * P2, 2026-09-19). Lo posee la capa de agente porque la composición vive aquí:
 * composeInstructions (teacher-agent.ts) compone a través de effectivePromptSegments, y el
 * descubrimiento lee el árbol propio de ESTA capa (src/agent/prompts: base, shared/,
 * fragmentos por agente): exactamente las reglas que usaba el cargador anterior a P2, ahora en
 * un solo sitio.
 *
 * La ley de la arquitectura fija la estructura: la capa de agente nunca importa los adaptadores
 * de almacenamiento, así que la LECTURA del fichero de sustitución también vive aquí (fichero
 * estático anclado en la configuración, la misma disciplina que leer los fragmentos de origen);
 * el CRUD del fichero de sustitución (escribir/borrar/listar: el almacén que modifica, detrás
 * del puerto del núcleo) se queda en src/store/prompt-overrides.ts. Ambos lados comparten la
 * gramática pura de rutas (src/core/prompt-segments.ts).
 *
 * SEGMENTOS: la base COMPARTIDA (src/agent/system-prompt.md), después cada fragmento *.md con
 * prefijo numérico del directorio propio del agente (ordenados por nombre de fichero) y
 * después el directorio de fragmentos shared/ (que componen LOS DOS agentes como apéndice
 * final: la reordenación del 2026-09-27). La lista de segmentos se adapta al código: una
 * sustitución asociada a un segmento que el código ya no incluye deja de componerse
 * automáticamente.
 *
 * SUSTITUCIONES: los ficheros de sustitución replican la estructura del código bajo
 * config.PROMPTS_OVERRIDE_DIR: "system-prompt.md" en la raíz, "shared/<file>",
 * "teacher/<file>" / "prober/<file>". La presencia del fichero NO es la sustitución: lo es el
 * INTERRUPTOR de los ajustes (decisión del propietario): el usuario conserva su fichero y
 * vuelve al valor por defecto del código para comparar.
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS, PROMPTS_OVERRIDE_DIR } from "../../config.ts";
import { FRAGMENT_RE, isValidSegmentPath, type PromptAgent, type PromptSegmentInfo } from "../core/prompt-segments.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");

/** Fragmentos compartidos que compone el agente de PRÁCTICA: los bloques de VOZ, PRECISIÓN
 *  y MODELO MENTAL se sumaron a la guía de formato (rondas 13 del propietario y la ronda de
 *  refinamiento de prompts del 2026-10-07): la personalidad, el contrato de veracidad y la
 *  doctrina de los campos de razonamiento son UNA ley para todos los agentes. La mecánica de
 *  preguntas, confianza y ficheros se queda fuera (la práctica no tiene esas herramientas). */
const PRACTICE_SHARED_FRAGMENTS = ["10-voice.md", "15-accuracy.md", "16-mental-model.md", "35-side-conversations.md", "40-formatting.md"];

/** Ruta absoluta de un fichero de sustitución (sin comprobar: valida antes). */
function overrideFileFor(segmentPath: string): string {
	return path.join(PROMPTS_OVERRIDE_DIR, ...segmentPath.split("/"));
}

/** Lee un fichero de sustitución, o null si no existe o no es válido: el lector del lado de
 *  la composición (el readOverride del almacén usa la misma estructura replicada, pero se
 *  mantiene aparte porque las capas no pueden importarse entre sí). */
export function readPromptOverride(segmentPath: string): string | null {
	if (!isValidSegmentPath(segmentPath)) return null;
	try {
		return fs.readFileSync(overrideFileFor(segmentPath), "utf-8");
	} catch {
		return null;
	}
}

/** Lista los segmentos de ORIGEN de un agente, en orden de composición: la base compartida,
 *  después los fragmentos propios del agente ordenados por nombre de fichero y después los
 *  fragmentos de shared/ (la reordenación del 2026-09-27: el trabajo y el método del agente van
 *  primero; la mecánica compartida de herramientas, ficheros y formato es un apéndice).
 *  Exactamente el orden en que los compone composeInstructions. */
export function listSourceSegments(agent: PromptAgent): Array<{ path: string; shared: boolean; file: string }> {
	// PRÁCTICA (propietario, 2026-10-04): su propio directorio más un apéndice compartido
	// SELECCIONADO: la base de enseñanza y la mecánica de preguntas, confianza y
	// ficheros se quedan fuera (la doctrina las contradice; 00-base.md
	// hace el papel de base), pero la guía de FORMATO se compone para todos los
	// agentes (propietario, 2026-10-04, más tarde): los delimitadores de LaTeX y el Markdown se
	// aplican en todos los contextos: la práctica comparte el contrato de escritura $...$/$$...$$.
	const segments: Array<{ path: string; shared: boolean; file: string }> = agent === "practice" ? [] : [
		{ path: "system-prompt.md", shared: true, file: PATHS.teacherPrompt },
	];
	const dir = path.join(PROMPTS_DIR, agent);
	if (fs.existsSync(dir)) {
		const fragments = fs.readdirSync(dir).filter((f) => FRAGMENT_RE.test(f)).sort();
		for (const f of fragments) {
			segments.push({ path: `${agent}/${f}`, shared: false, file: path.join(dir, f) });
		}
	}
	const sharedDir = path.join(PROMPTS_DIR, "shared");
	if (fs.existsSync(sharedDir)) {
		// La lista de permitidos de la práctica (propietario, 2026-10-04, más tarde): solo formato.
		const allow = agent === "practice" ? PRACTICE_SHARED_FRAGMENTS : null;
		const sharedFragments = fs
			.readdirSync(sharedDir)
			.filter((f) => FRAGMENT_RE.test(f) && (allow === null || allow.includes(f)))
			.sort();
		for (const f of sharedFragments) {
			segments.push({ path: `shared/${f}`, shared: true, file: path.join(sharedDir, f) });
		}
	}
	return segments;
}

/**
 * La vista efectiva de los segmentos de un agente: cada segmento con su texto de origen, su
 * texto de sustitución y el estado efectivo de su interruptor. `switches` es el mapa
 * agent.prompts del registro de ajustes (clave ausente = off); enabled = interruptor activado
 * Y el fichero de sustitución existe.
 */
export function effectivePromptSegments(
	agent: PromptAgent,
	switches: Record<string, boolean>,
): PromptSegmentInfo[] {
	return listSourceSegments(agent).map((segment) => {
		let sourceText: string;
		try {
			sourceText = fs.readFileSync(segment.file, "utf-8");
		} catch {
			sourceText = ""; // origen ilegible: el cargador del agente fallaría de todas formas
		}
		const overrideText = readPromptOverride(segment.path);
		return {
			path: segment.path,
			sourceText,
			overrideText,
			enabled: switches[segment.path] === true && overrideText !== null,
			shared: segment.shared,
		};
	});
}

/** Todas las rutas de segmentos conocidas de los dos agentes (validación de rutas). */
export function allSegmentPaths(): string[] {
	const paths = new Set<string>();
	for (const agent of ["prober", "teacher", "practice"] as const) {
		for (const segment of listSourceSegments(agent)) paths.add(segment.path);
	}
	return [...paths].sort();
}
