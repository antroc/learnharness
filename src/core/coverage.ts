/**
 * Cobertura de la extracción — el núcleo puro. LA PROSA DEL PROFESOR ES LA
 * UNIDAD (decisión del responsable, 2026-09-28): el extractor SOLO ve la prosa
 * del agente profesor — bloques de texto ordinarios y mensajes explícitos de
 * send_to_user. Ni mensajes del alumno, ni thinking, ni otras llamadas o
 * resultados de herramientas, ni bloques de cuestionario. Todo lo demás es
 * INVISIBLE para la cobertura: ni abre ni se une a una ejecución, así que
 * responder un cuestionario o editar un mensaje del alumno no dispara nada.
 * «Cubierto» es, por construcción, exactamente «lo que vio el extractor»: la
 * huella (sha256 de las líneas de vista de un mensaje) y el prompt del
 * extractor comparten UNA selección — la prosa del profesor.
 *
 * Un registro por chat de solo añadido anota qué mensajes se han extraído por
 * HUELLA DE CONTENIDO; lo «no cubierto» se DERIVA al leer (huella de la
 * transcripción actual, diferencia contra el registro) — nunca se lleva por
 * duplicado. Las ejecuciones son lotes con presupuesto de tokens de los
 * mensajes de prosa del profesor no cubiertos más antiguos: llenado voraz
 * consecutivo, un mensaje nunca se parte y un mensaje que solo supera el
 * presupuesto va solo. (El antiguo vínculo de inseparabilidad — llamada +
 * resultados en un fragmento — murió con la decisión: los resultados de
 * herramientas ahora son invisibles, así que no hace falta mantener nada
 * junto.)
 */

import { createHash } from "node:crypto";

import type { CoverageEntry } from "./contracts/graph.ts";
import { failedOutputCallIds, userFacingTextOf, type LhMessage } from "./native-messages.ts";

export type { CoverageEntry };

/**
 * Las líneas relevantes para la extracción de UN mensaje nativo — la frontera
 * compartida entre el prompt del extractor y messageFingerprint (cobertura).
 * SOLO PROSA DEL PROFESOR (responsable, 2026-09-28): un mensaje del asistente
 * produce una línea por bloque de prosa dirigido al alumno; todo lo demás
 * (mensajes del usuario, resultados de herramientas, marcadores) no produce
 * NADA y es invisible para la cobertura. `mid` es el id del mensaje — forma
 * parte de la entrada del hash, así que la misma prosa en dos mensajes son
 * dos ranuras (cobertura por mensaje).
 */
export function messageViewLines(
	message: LhMessage,
	mid: string,
	failedOutputCalls: ReadonlySet<string> = failedOutputCallIds([message]),
): string[] {
	const lines: string[] = [];
	if ((message as { role?: string }).role !== "assistant") return lines;
	for (const text of userFacingTextOf((message as { content: unknown }).content, failedOutputCalls)) {
		lines.push(`TEACHER [${mid}] ${text.trim()}`);
	}
	return lines;
}

/**
 * Los bloques de prosa del profesor de una transcripción, en orden — el
 * material del prompt del extractor. La MISMA selección que messageViewLines
 * (la doctrina de paridad sobrevive a la decisión en este par de funciones),
 * mostrada sin el prefijo de procedencia: párrafos sin más.
 */
export function teacherProseBlocks(messages: ReadonlyArray<LhMessage>): string[] {
	const out: string[] = [];
	const failedOutputCalls = failedOutputCallIds(messages);
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		for (const text of userFacingTextOf((message as { content: unknown }).content, failedOutputCalls)) out.push(text.trim());
	}
	return out;
}

/** Tokens de la vista de un mensaje — chars/4, redondeo hacia arriba, la estimación de toda la app. */
export function viewTokens(lines: string[]): number {
	return Math.ceil(lines.join("\n").length / 4);
}

/**
 * La huella de cobertura de un mensaje: sha256 del rol + sus líneas de vista
 * (la prosa del profesor, con el id del mensaje como etiqueta). Cambia
 * exactamente cuando cambia la prosa del profesor del mensaje — nada más
 * puede reabrirlo.
 */
export function messageFingerprint(message: LhMessage, failedOutputCalls?: ReadonlySet<string>): string {
	const h = createHash("sha256");
	h.update(JSON.stringify([(message as { role?: string }).role, messageViewLines(message, message.id, failedOutputCalls)]));
	return h.digest("hex");
}

/** La proyección relevante para la cobertura de un mensaje. */
export interface CoverageSlot {
	message: LhMessage;
	fp: string;
	tokens: number;
}

/** Calcula la huella de una transcripción entera, en orden (la usan el
 *  disparador, la ejecución y la vista de cobertura — una sola derivación en
 *  todas partes). */
export function coverageSlots(messages: ReadonlyArray<LhMessage>): CoverageSlot[] {
	const failedOutputCalls = failedOutputCallIds(messages);
	return messages.map((message) => ({
		message,
		fp: messageFingerprint(message, failedOutputCalls),
		tokens: viewTokens(messageViewLines(message, message.id, failedOutputCalls)),
	}));
}

/** El conjunto de huellas cubiertas de un chat, a partir del registro. */
export function coveredSet(entries: ReadonlyArray<CoverageEntry>, chatId: string): Set<string> {
	const out = new Set<string>();
	for (const e of entries) if (e.chatId === chatId) out.add(e.fp);
	return out;
}

/** El estado derivado: qué ranuras no están cubiertas, más los totales de
 *  tokens. Lo «no cubierto» no necesita registro propio — esta diferencia ES
 *  la vista de cobertura. `uncovered` son ÍNDICES en `slots` (el agrupador hace
 *  lotes por posición). Los mensajes SIN líneas de vista — todos los mensajes
 *  del alumno, todos los resultados de herramientas, los marcadores, los
 *  turnos del asistente sin prosa — son totalmente invisibles para la
 *  cobertura: el extractor nunca puede verlos, así que no están ni cubiertos
 *  ni sin cubrir. */
export function coverageOf(
	messages: ReadonlyArray<LhMessage>,
	entries: ReadonlyArray<CoverageEntry>,
	chatId: string,
): {
	slots: CoverageSlot[];
	uncovered: number[];
	coveredTokens: number;
	uncoveredTokens: number;
	coveredCount: number;
	uncoveredCount: number;
} {
	const covered = coveredSet(entries, chatId);
	const slots = coverageSlots(messages);
	const uncovered: number[] = [];
	let coveredTokens = 0;
	let uncoveredTokens = 0;
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]!;
		if (slot.tokens === 0) continue; // invisible (incluidas las llamadas de salida fallidas)
		if (covered.has(slot.fp)) coveredTokens += slot.tokens;
		else {
			uncovered.push(i);
			uncoveredTokens += slot.tokens;
		}
	}
	const visibleCount = slots.filter((s) => s.tokens > 0).length;
	return {
		slots,
		uncovered,
		coveredTokens,
		uncoveredTokens,
		coveredCount: visibleCount - uncovered.length,
		uncoveredCount: uncovered.length,
	};
}

/**
 * Agrupa los mensajes de prosa del profesor no cubiertos en EJECUCIONES con
 * presupuesto de tokens: ranuras consecutivas, las más antiguas primero,
 * llenado voraz — un mensaje nunca se parte. Un único mensaje mayor que el
 * presupuesto pasa a ser su propia ejecución (por encima del presupuesto) en
 * lugar de descartarse. Las ejecuciones son efímeras — el registro duradero
 * es la cobertura por mensaje, con un punto de control tras fusionar cada
 * ejecución.
 */
export function batchRuns(slots: ReadonlyArray<CoverageSlot>, uncovered: ReadonlyArray<number>, budget: number): CoverageSlot[][] {
	if (budget <= 0 || uncovered.length === 0) return [];
	const runs: CoverageSlot[][] = [];
	let current: CoverageSlot[] = [];
	let currentTokens = 0;
	const flush = () => {
		if (current.length > 0) runs.push(current);
		current = [];
		currentTokens = 0;
	};
	for (const i of uncovered) {
		const slot = slots[i]!;
		if (current.length > 0 && currentTokens + slot.tokens > budget) flush();
		current.push(slot);
		currentTokens += slot.tokens;
	}
	flush();
	return runs;
}

/**
 * La etiqueta determinista de un lote: hash de las huellas de sus miembros.
 * Es el prefijo de las referencias de observación de la ejecución
 * (obs:<tag>:<sourceId> en el fusionador): volver a ejecutar el MISMO lote
 * (recuperación tras un fallo) produce las mismas referencias y se
 * deduplica; un mensaje reabierto (mutado) cambia la etiqueta, así que sus
 * observaciones de comprensión nuevas llegan como eventos nuevos — el plegado
 * por el más reciente ve la actualización. Los ids de fuente locales de la
 * ejecución ("p1"…) por sí solos nunca podrían lograrlo: sus posiciones
 * cambian de una ejecución a otra.
 */
export function batchTag(batch: ReadonlyArray<CoverageSlot>): string {
	const h = createHash("sha256");
	for (const slot of batch) h.update(slot.fp);
	return h.digest("hex").slice(0, 12);
}
