/**
 * Resumen de costes del proceso del grafo (oleada de métricas de coste del
 * grafo, 2026-09) — el plegado puro que hay detrás de la píldora de coste de
 * la vista del grafo. Entran dos canales de uso: las ejecuciones de extracción
 * del chat (ChatRecord.extractions) y las de fuentes de notas
 * (NotesSource.extractions). Sale: totales por etapa (extracción / auditoría)
 * + una lista acotada de ejecuciones recientes. (El canal de nombrado de
 * clústeres murió con el cierre de la UX de extracción, 2026-09-24 —
 * displayCostTotals de la interfaz ya lo había quitado; el gasto histórico de
 * naming-runs.jsonl simplemente no se muestra, la misma decisión que con
 * stages.embedding en la oleada 7.)
 *
 * LEY DEL CANAL DEL DINERO: los dólares se INFIEREN aquí al leer mediante un
 * tarificador de Pi del lado del servidor inyectado — nunca se guardan en
 * ningún sitio. Un modelo sin precio aporta CERO dólares pero se cuenta en
 * `unpricedRuns` para que la interfaz pueda mostrar «— sin precio» con
 * honestidad, nunca un cero silencioso. Los tokens siempre se suman.
 *
 * Seguro para el cliente: tipos puros + cálculo, sin imports de node; se
 * expone mediante el barrel del núcleo para que los componentes de la
 * píldora/panel no contengan cálculos de coste.
 */

import type { CallUsage, EmissionStats, ExtractionRunUsage } from "./contracts.ts";
import { sumSteps, isSubscriptionModel, subscriptionLabels, type CallPricer } from "./prices.ts";

/** El coste acumulado de una etapa del proceso en todas las ejecuciones. */
export interface StageCost {
	/** Ejecuciones de etapa por suscripción, excluidas de los dólares de API y de los recuentos sin precio. */
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	/** USD inferidos sumados sobre las ejecuciones CON precio (parcial cuando unpricedRuns > 0). */
	dollars: number;
	/** Ejecuciones de etapa cuyo modelo falta en el catálogo de Pi (muestra «—», nunca cero). */
	unpricedRuns: number;
	/** Ejecuciones que facturaron esta etapa. */
	runs: number;
	/** Totales de tokens de todas las ejecuciones. */
	tokens: CallUsage;
}

/** Una ejecución de la lista de recientes (extracción o nombrado). */
export interface RecentRun {
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	startedAt: number;
	/** Hora real en ISO. */
	at: string;
	durationMs: number;
	/** "extraction" cubre ambas puertas de entrada (chat + notas). */
	kind: "extraction";
	/** Título del chat / ruta del fichero fuente / etiqueta fija para las ejecuciones de nombrado. */
	title: string;
	/** USD inferidos de la ejecución entera; null solo cuando TODAS las etapas carecen de precio. */
	dollars: number | null;
	tokens: CallUsage;
	/** Lo que la ejecución fusionó en el grafo; ausente en las ejecuciones fallidas. */
	merged?: EmissionStats;
}

/** Toda la carga de la píldora de coste: totales por etapa + ejecuciones recientes. */
export interface GraphCostSummary {
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	/** USD inferidos de todas las etapas con precio de todas las ejecuciones. */
	totalDollars: number;
	/** Ejecuciones sin ninguna etapa de API con precio y con al menos una etapa desconocida. */
	unpricedRuns: number;
	/** Las etapas facturables del proceso. (Oleada 7, decisión del responsable
	 *  del 2026-09-23: la etapa de embedding desapareció con el embedder del
	 *  proveedor; el cierre del 2026-09-24 eliminó del mismo modo el nombrado de
	 *  clústeres — el gasto histórico en cualquiera de ellos no se muestra.) */
	stages: {
		extraction: StageCost;
		audit: StageCost;
	};
	/** Las más recientes primero, con un tope de `recentCap` (por defecto 10). */
	runs: RecentRun[];
}

/** Lo que lee el plegado: registros de ejecución ya recogidos, etiquetados por puerta de entrada. */
export interface CostSummaryInput {
	/** Ejecuciones de la puerta del chat: título del chat + el registro de uso del registro. */
	chats: { title: string; extractions: ExtractionRunUsage[] }[];
	/** Ejecuciones de la puerta de notas: ruta del fichero importado + el registro de uso de la fuente. */
	sources: { filePath: string; extractions: ExtractionRunUsage[] }[];
	recentCap?: number;
}

const ZERO_TOKENS: CallUsage = {
	inputTokens: undefined,
	outputTokens: undefined,
	cacheReadTokens: undefined,
	cacheWriteTokens: undefined,
	reasoningTokens: undefined,
};

const emptyStage = (): StageCost => ({ dollars: 0, unpricedRuns: 0, runs: 0, tokens: { ...ZERO_TOKENS } });

/** Los dólares de una etapa sobre sus pasos; null cuando el modelo no tiene
 *  precio (todo o nada: una etapa ejecuta un solo modelo). */
function stageDollars(model: string, steps: readonly CallUsage[], price: CallPricer): number | null {
	if (isSubscriptionModel(model) || steps.length === 0) return null;
	let total = 0;
	for (const step of steps) {
		const c = price(step, model);
		if (c === null) return null;
		total += c;
	}
	return total;
}

/** Fusiona los tokens de un conjunto de pasos en un CallUsage acumulado. */
function mergeTokens(into: CallUsage, steps: readonly CallUsage[]): void {
	const summed = sumSteps(steps);
	// Pliega esto antes de actualizar el total de escrituras, para que un agregado antiguo
	// con escrituras y sin desglose siga desconocido aun después de llegar datos nuevos.
	into.cacheWrite1hTokens = sumSteps([into, summed]).cacheWrite1hTokens;
	into.inputTokens = (into.inputTokens ?? 0) + (summed.inputTokens ?? 0);
	into.outputTokens = (into.outputTokens ?? 0) + (summed.outputTokens ?? 0);
	into.cacheReadTokens = (into.cacheReadTokens ?? 0) + (summed.cacheReadTokens ?? 0);
	into.cacheWriteTokens = (into.cacheWriteTokens ?? 0) + (summed.cacheWriteTokens ?? 0);
	into.reasoningTokens = (into.reasoningTokens ?? 0) + (summed.reasoningTokens ?? 0);
}

/** Pliega todos los canales de uso en la carga de la píldora. Puro: misma
 *  entrada, misma salida — sin reloj, sin fs, sin lecturas del store. */
export function graphCostSummary(input: CostSummaryInput, price: CallPricer): GraphCostSummary {
	const extraction = emptyStage();
	const audit = emptyStage();
	const runs: RecentRun[] = [];

	const foldExtractionRun = (run: ExtractionRunUsage, title: string) => {
		const stages = run.stages ?? { extractor: { model: "unknown", steps: [] }, auditor: { model: "unknown", steps: [] } };
		// Por etapa: los tokens siempre cuentan; los dólares solo con precio.
		extraction.runs++;
		mergeTokens(extraction.tokens, stages.extractor.steps);
		const extDollars = stageDollars(stages.extractor.model, stages.extractor.steps, price);
		if (isSubscriptionModel(stages.extractor.model)) {
			extraction.subscriptionRuns = (extraction.subscriptionRuns ?? 0) + 1;
			extraction.subscriptionProviders = [...new Set([...(extraction.subscriptionProviders ?? []), ...subscriptionLabels([stages.extractor.model])])];
		}
		else if (extDollars === null) extraction.unpricedRuns++;
		else extraction.dollars += extDollars;

		audit.runs++;
		mergeTokens(audit.tokens, stages.auditor.steps);
		const audDollars = stageDollars(stages.auditor.model, stages.auditor.steps, price);
		if (isSubscriptionModel(stages.auditor.model)) {
			audit.subscriptionRuns = (audit.subscriptionRuns ?? 0) + 1;
			audit.subscriptionProviders = [...new Set([...(audit.subscriptionProviders ?? []), ...subscriptionLabels([stages.auditor.model])])];
		}
		else if (audDollars === null) audit.unpricedRuns++;
		else audit.dollars += audDollars;

		// Por ejecución: null solo cuando TODAS las etapas carecen de precio.
		const allStages: Array<number | null> = [extDollars, audDollars];
		const runDollars = allStages.every((d) => d === null)
			? null
			: allStages.reduce<number>((a, d) => a + (d ?? 0), 0);
		const subscriptionRuns = [stages.extractor, stages.auditor].filter((stage) => isSubscriptionModel(stage.model)).length;
		const allSteps = [...stages.extractor.steps, ...stages.auditor.steps];
		runs.push({
			...(subscriptionRuns ? { subscriptionRuns, subscriptionProviders: subscriptionLabels([stages.extractor.model, stages.auditor.model]) } : {}),
			startedAt: run.startedAt,
			at: run.at,
			durationMs: run.durationMs,
			kind: "extraction",
			title,
			dollars: runDollars,
			tokens: sumSteps(allSteps),
			...(run.stats ? { merged: run.stats } : {}),
		});
	};

	for (const chat of input.chats) {
		for (const run of chat.extractions) foldExtractionRun(run, chat.title);
	}
	for (const source of input.sources) {
		for (const run of source.extractions) foldExtractionRun(run, source.filePath);
	}

	runs.sort((a, b) => b.startedAt - a.startedAt);
	const capped = runs.slice(0, input.recentCap ?? 10);

	// Una ejecución está «sin precio» cuando no facturó nada contable en absoluto.
	const unpricedRuns = runs.filter((r) => r.dollars === null && (r.subscriptionRuns ?? 0) < 2).length;
	const subscriptionRuns = (extraction.subscriptionRuns ?? 0) + (audit.subscriptionRuns ?? 0);
	return {
		...(subscriptionRuns ? { subscriptionRuns, subscriptionProviders: [...new Set([...(extraction.subscriptionProviders ?? []), ...(audit.subscriptionProviders ?? [])])] } : {}),
		totalDollars: extraction.dollars + audit.dollars,
		unpricedRuns,
		stages: { extraction, audit },
		runs: capped,
	};
}
