/**
 * La gramática pura de los segmentos de prompt (reconciliación P2, 2026-09-19):
 * validación de rutas de segmento + los tipos de segmento compartidos, CERO fs.
 * El descubrimiento (leer el árbol de prompts del agente) vive en la capa del
 * agente (src/agent/prompt-segments.ts — el cargador canónico a través del que
 * compone composeInstructions); el CRUD de ficheros de sustitución vive en el
 * adaptador del almacén (src/store/prompt-overrides.ts). Ambos importan ESTA
 * gramática, así las reglas de estructura en espejo se definen una sola vez.
 *
 * Gramática de rutas: "system-prompt.md" (la base compartida), "shared/<fragmento>"
 * (fuentes v1: fragmentos que componen AMBOS agentes), "prober/<fragmento>" /
 * "teacher/<fragmento>" — donde <fragmento> lleva prefijo numérico + .md
 * (p. ej. 20-teaching.md). Relativa en formato POSIX, sin recorridos, sin anidamiento.
 */

/** Un fragmento de prompt: clave numérica de orden + .md (p. ej. 20-teaching.md). No se carga nada más. */
export const FRAGMENT_RE = /^\d+-[\w.-]+\.md$/;

/** Qué directorio de prompts de agente componer. */
/** Práctica (2026-10-04): compone SOLO su propio directorio — sin la base de
 * enseñanza compartida ni fragmentos compartidos (la doctrina contradice la
 * filosofía de enseñanza; su 00-base.md hace el papel de base). */
export type PromptAgent = "prober" | "teacher" | "practice";

/** Un segmento del prompt compuesto de un agente. */
export interface PromptSegmentInfo {
	/** La clave de sustitución/almacén — refleja la estructura del código fuente
	 * ("system-prompt.md", "shared/05-learner-files.md", "teacher/20-teaching.md").
	 * Estable entre agentes: la base y los fragmentos de shared/ usan la MISMA ruta
	 * en las listas de ambos agentes. */
	path: string;
	/** El texto fuente (con lo que funciona el segmento sin sustitución). */
	sourceText: string;
	/** El texto de sustitución del usuario, o null si no hay fichero en disco. */
	overrideText: string | null;
	/** Estado efectivo: el interruptor de ajustes Y el fichero, ambos presentes. */
	enabled: boolean;
	/** True para los segmentos que componen AMBOS agentes — la base y los fragmentos de shared/. */
	shared: boolean;
}

/** Valida una ruta de segmento contra las reglas de estructura en espejo (ver
 * la documentación del módulo). Se exporta para las rutas, que además comprueban
 * que pertenezca a la lista ACTUAL de segmentos del código fuente. */
export function isValidSegmentPath(segmentPath: string): boolean {
	if (segmentPath === "system-prompt.md") return true;
	const m = /^(prober|teacher|practice|shared)\/([\w.-]+\.md)$/.exec(segmentPath);
	if (!m || m[2] === undefined) return false;
	return FRAGMENT_RE.test(m[2]);
}
