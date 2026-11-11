/**
 * Superficie de observabilidad del servidor: las exportaciones aprobadas por
 * el barrel que lee la capa de transporte (app/api/*) para el estado de los
 * procesos en segundo plano.
 *
 * EL FEED DE ACTIVIDAD (diseño de observabilidad de 2026-09): el dock de abajo
 * a la derecha es visible en todas las vistas, así que necesita la imagen
 * completa de los procesos en marcha (las tareas de subagente de TODOS los
 * chats, no solo del abierto, más las ejecuciones globales de extracción) en
 * un solo sondeo. El dock es SOLO PARA PROCESOS EN SEGUNDO PLANO (decisión del
 * usuario, 2026-09-11): las sesiones de enseñanza ya tienen su propia
 * observabilidad, así que los turnos del profesor en curso NO están en el feed
 * a propósito. /api/jobs sigue limitado al chat y sin tocar: es el sondeo de
 * la maquinaria de la transcripción y lleva turnInFlight para la frontera de
 * reenganche (chat-transport); el dock es otro consumidor con otra forma, que
 * se sirve aquí. Las fuentes únicas de verdad no cambian: el almacén de tareas
 * y el registro del proceso; este fichero solo las compone.
 *
 * La parte de extracción de los controles del dock también aflora aquí:
 * abortExtraction (cancelación real a mitad de ejecución, decidida por el
 * usuario) se exporta desde el módulo del proceso para que la llame la ruta de
 * cancelación.
 */

import { extractionStatuses, type ExtractionPhase } from "../agent/subagents/extraction.ts";
import { chatStore } from "../store/chats.ts";
import { graphRevision } from "./graph.ts";
import { catalogContextLimits } from "./model-catalog.ts";
import { listJobs } from "./jobs.ts";
import { jobCost } from "./pricing.ts";
import { pluginWorkerActivities, type PluginWorkerActivity } from "./plugin-worker-activity.ts";
import type { JobRecord } from "../core/contracts.ts";

export { abortExtraction, extractionStatuses, type ExtractionPhase, type RunningExtraction } from "../agent/subagents/extraction.ts";
export { chatStore } from "../store/chats.ts";

/** Una tarea de subagente en marcha, unida al título de su chat para el dock.
 *  contextLimit (enmienda del medidor de contexto, responsable 2026-09-23): el
 *  límite vivo del modelo en el catálogo, resuelto EN EL SERVIDOR a partir del
 *  catálogo de pi; el dock lo lee del feed en lugar de una tabla en el
 *  cliente. Null si el modelo no está en el catálogo (entonces el bloque no
 *  muestra línea de contexto; nunca una ventana falsa). */
export interface ActivityJob extends JobRecord {
	costUsd: number | null;
	title: string;
	contextLimit: number | null;
}

/** Tarea de plugin independiente; a propósito no tiene identidad de sesión ni carga de resultado. */
export interface ActivityPluginWorker extends PluginWorkerActivity {
	costUsd: number | null;
	contextLimit: number | null;
}

/** Una TAREA del proceso de extracción (con su título), de la más antigua a
 *  la más reciente. Tareas por fragmento (responsable, 2026-09-28): una
 *  fuente de varios fragmentos tiene VARIAS filas; id es la clave única de la
 *  tarea (id de la fuente o "src#i"), chatId sigue siendo el id de la FUENTE
 *  (la cancelación y los enlaces al chat se limitan a la fuente) y el título
 *  lleva el sufijo de parte "· i/N". */
export interface ActivityExtraction {
	id: string;
	chatId: string;
	part?: { i: number; n: number };
	title: string;
	phase: ExtractionPhase;
	startedAt: number;
}

/** Todo el mundo del dock en una sola carga: cada proceso en marcha, cada
 *  vista. Las tareas son SOLO LAS QUE ESTÁN EN MARCHA: las terminadas
 *  pertenecen a la transcripción de su chat; el bloque desaparece cuando
 *  termina el proceso. Los costes se unen aquí mediante el adaptador de
 *  precios de Pi del servidor; los clientes nunca reconstruyen tarifas. */
/** Todo el mundo del dock + el sello de versión del grafo (oleada 6 de borrado
 *  de sesiones): la carga lleva graphRevision (el mtime máximo entre los
 *  ficheros de datos del grafo; ver server/graph.ts) para que cualquier vista
 *  pueda detectar que «el grafo ha cambiado bajo mis pies» (llegó una fusión,
 *  un borrado purgó) y vuelva a pedir los clústeres/la disposición. Las
 *  lecturas nunca lo cambian; la respuesta del DELETE devuelve el mismo sello. */
export function activityFeed(): {
	jobs: ActivityJob[];
	pluginWorkers: ActivityPluginWorker[];
	extractions: ActivityExtraction[];
	graphRevision: number;
} {
	const chats = chatStore.listChats();
	const limits = catalogContextLimits();
	const jobs: ActivityJob[] = [];
	for (const chat of chats) {
		for (const job of listJobs(chat.id)) {
			if (job.status === "running") {
				jobs.push({
					...job,
					costUsd: jobCost(job),
					title: chat.title ?? chat.id,
					contextLimit: job.usage ? (limits.get(job.usage.model) ?? null) : null,
				});
			}
		}
	}
	const extractions: ActivityExtraction[] = extractionStatuses().map((run) => ({
		id: run.part ? `${run.chatId}#${run.part.i}` : run.chatId,
		chatId: run.chatId,
		part: run.part,
		// La etiqueta propia de la ejecución nunca llega a este feed (a diferencia de la
		// ruta de estado del grafo): el título del almacén de chats, o el id a secas para las
		// fuentes de notas, más el sufijo de fragmento si la fuente se dividió.
		title:
			(run.label ?? chatStore.getChat(run.chatId)?.title ?? run.chatId) +
			(run.part ? ` · ${run.part.i}/${run.part.n}` : ""),
		phase: run.phase,
		startedAt: run.startedAt,
	}));
	// Una tarea nativa de createBackgroundTool ya tiene su fila de worker y su END duradero.
	// La aceptación y la vinculación con la tarea son síncronas, así que el paso de
	// en cola→en marcha no puede mostrar brevemente ambas representaciones.
	const linked = new Set(jobs.flatMap(job => job.kind === "plugin" && job.plugin?.taskId
		? [`${job.plugin.pluginId}:${job.plugin.taskId}`] : []));
	const pluginWorkers: ActivityPluginWorker[] = pluginWorkerActivities()
		.filter(task => !linked.has(task.id))
		.map(task => ({ ...task, costUsd: jobCost(task),
			contextLimit: task.usage ? (limits.get(task.usage.model) ?? null) : null }))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	// de la más antigua a la más reciente según la última actividad: el orden estable de los bloques (las cadenas ISO se ordenan cronológicamente)
	jobs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
	return {
		jobs,
		pluginWorkers,
		extractions: extractions.sort((a, b) => a.startedAt - b.startedAt),
		graphRevision: graphRevision(),
	};
}
