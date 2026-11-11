import * as fs from "node:fs";
import { LEDGER_FILES, POSITIONS_FILE } from "../../config.ts";
import type { GraphSnapshot } from "../core/contracts.ts";
import type { GraphCostSummary } from "../core/cost-summary.ts";
import { graphCostSummary } from "../core/cost-summary.ts";
import { graphSnapshot } from "../core/graph.ts";
import { birthSessionPartition } from "../core/session-clusters.ts";
import {
	deleteNodeTraces,
	type NodeDeletionStats,
} from "../core/graph-deletion.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { stores } from "./stores.ts";
import { callCost } from "./pricing.ts";

/**
 * Entrada del grafo en el servidor para la vista de inicio (GET /api/graph).
 * Una LECTURA PURA: el proceso de extracción (el único que escribe en el
 * grafo) lo disparan las respuestas a los quizzes en las sesiones
 * (turn-service), nunca desde aquí; la vista de inicio refleja lo que el
 * proceso haya fusionado hasta el momento.
 */
export function graphView(): GraphSnapshot {
	const organization = stores.sourceOrganizationStore.read();
	const names = Object.fromEntries(Object.entries(organization.placements).flatMap(([id, p]) => p.name === undefined ? [] : [[id, p.name]]));
	return graphSnapshot(stores, names);
}

/** La superficie de costes de la vista del grafo (GET /api/graph/costs: la
 *  píldora de costes de 2026-09): pliega todos los canales de uso en totales
 *  por etapa + ejecuciones recientes. Una lectura pura sobre los registros de
 *  chat (ejecuciones por la puerta del chat), las fuentes de notas (ejecuciones
 *  por la puerta de notas) y el registro de nombres (ejecuciones globales del
 *  grafo); los dólares los infiere el plegado puro del núcleo
 *  (core/cost-summary.ts + prices.ts); aquí nada almacena ni cachea dinero. */
export function graphCosts(): GraphCostSummary {
	const chats = stores.chatStore
		.listChats()
		.flatMap((summary) => {
			const record = stores.chatStore.getChat(summary.id);
			return record?.extractions?.length
				? [{ title: record.title ?? summary.id, extractions: record.extractions }]
				: [];
		});
	const sources = stores.graphStore
		.readSources()
		.filter((s) => s.extractions?.length)
		.map((s) => ({ filePath: s.filePath, extractions: s.extractions! }));
	return graphCostSummary({ chats, sources }, callCost);
}

/** El sello de versión del grafo (oleada 6 de borrado de sesiones): el mtime
 * máximo entre todos los ficheros de datos del grafo (registros, posiciones).
 * Cambia con CUALQUIER escritura del grafo (añadido de fusión, asentamiento o
 * la reescritura atómica de un borrado), nunca con las lecturas, y no necesita
 * contabilidad propia: el sistema de ficheros ES el contador. Los consumidores
 * lo sondean (el feed de actividad lo lleva; la respuesta del DELETE lo
 * devuelve) para saber que deben volver a pedir los clústeres/la disposición:
 * la señal de «el grafo ha cambiado bajo mis pies». */
export function graphRevision(): number {
	let revision = 0;
	for (const file of [
		LEDGER_FILES.nodes,
		LEDGER_FILES.chains,
		LEDGER_FILES.sessions,
		LEDGER_FILES.coverage,
		POSITIONS_FILE,
	]) {
		try {
			revision = Math.max(revision, fs.statSync(file).mtimeMs);
		} catch {
			/* ausente: nada lo ha escrito nunca */
		}
	}
	return revision;
}

// ─── borrado de un solo nodo (interludio de nodos, muerte completa fijada por el responsable)

/** Lo que hizo deleteGraphNode; la ruta lo traduce directamente a HTTP. */
export type NodeDeleteOutcome =
	| { ok: false; status: 404; code: "not_found"; error: string }
	| { ok: false; status: 409; code: "extraction_running"; error: string }
	| { ok: true; stats: NodeDeletionStats; graphRevision: number };

/**
 * Borra un nodo por id: MUERTE COMPLETA (consulta core/graph-deletion.ts para
 * la semántica de los registros). La familia de protecciones NO es a propósito
 * la del chat, y vale la pena dejar escrito el razonamiento:
 *
 *   - Sin barreras de turno/tareas. Los turnos y las tareas en segundo plano
 *     nunca escriben en los registros del grafo; la extracción posterior de un
 *     turno se registra como ejecución, y aquí todas las rutas de código son
 *     síncronas: nada puede registrarse ni fusionarse entre la barrera y la
 *     reescritura del registro (el bucle de eventos nunca cede dentro de esta
 *     función).
 *   - LA BARRERA DE EXTRACCIÓN: 409 mientras haya CUALQUIER ejecución del
 *     proceso registrada, en cualquier sitio. Una ejecución en curso tiene
 *     hallazgos extraídos de transcripciones anteriores al borrado; sus
 *     fusiones podrían volver a añadir alias, procedencia o eventos al nodo
 *     que muere (el riesgo de re-referencia que señala el encargo). A
 *     diferencia del borrado de chats, NO se cancela la ejecución: pertenece a
 *     alguna sesión, y cortar el gasto de esa sesión queda fuera del radio de
 *     este borrado; la interfaz reintenta cuando el dock se vacía. Una
 *     ejecución que empieza DESPUÉS del borrado es un reaprendizaje legítimo:
 *     lee los registros posteriores al borrado, acuña un nodo nuevo para un
 *     tema que se vuelve a enseñar, y mergeFindings ignora los ids linkTo que
 *     ya no existen (la protección existingIds): sin aristas colgando, sin
 *     resurrecciones.
 */
export function deleteGraphNode(nodeId: string): NodeDeleteOutcome {
	if (extractionStatuses().length > 0) {
		return {
			ok: false,
			status: 409,
			code: "extraction_running",
			error: "An extraction is running — try again when it finishes",
		};
	}
	// EL BLOQUE SÍNCRONO: sin awaits a partir de aquí (ver la documentación de arriba):
	// la barrera y la reescritura son un tramo atómico del bucle de eventos.
	const stats = deleteNodeTraces(stores.graphStore, nodeId);
	if (stats === null) {
		return { ok: false, status: 404, code: "not_found", error: "No such node" };
	}
	return { ok: true, stats, graphRevision: graphRevision() };
}

