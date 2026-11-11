/**
 * Contratos de las tareas de subagentes: el protocolo asíncrono de acuse y reorientación
 *
 * Parte de los contratos divididos por dominio (src/core/contracts/): cada fichero de dominio
 * pertenece por completo a su línea de trabajo; los cambios de esquema entre dominios pasan por
 * master. Tipos puros + documentación del protocolo + pequeños helpers puros; importaciones solo de tipos
 * de "ai" (seguras en todas partes: servidor, cliente, pruebas). Ver docs/archive/vision.md.
 */
import type { CallUsage } from "./chat.ts";
import type { PluginBackgroundResult } from "../plugin-workers.ts";
import type { LhMessage, LhMarkerMessage } from "../native-messages.ts";
import { newHandoffMessage } from "../native-messages.ts";

// ─── Tareas asíncronas de subagentes (docs/archive/vision.md §2.5; protocolo de la Oleada 0 de docs/archive/plan.md) ─

export type BuiltinJobKind = "research" | "demo" | "visual" | "pdf";
export type JobKind = BuiltinJobKind | "plugin";
export function isBuiltinJobKind(kind: JobKind): kind is BuiltinJobKind {
	return kind !== "plugin";
}
/** Vínculo duradero propiedad del host. Nunca contiene rutas del sistema de ficheros. */
export interface PluginJobMetadata {
	pluginId: string;
	toolName: string;
	workerId: string;
	requestId: string;
	taskId?: string;
	input?: unknown;
	label?: string;
}
export type JobResult = ResearchResult | DemoResult | VisualResult | PdfResult | PluginBackgroundResult;
export type JobStatus = "running" | "done" | "error";

export interface JobRecord {
	id: string;
	kind: JobKind;
	chatId: string;
	/** La parte de herramienta que cumple esta tarea. */
	toolCallId: string;
	/** Argumentos del momento del despacho, guardados antes del lanzamiento. Las tareas antiguas se resuelven a partir del historial. */
	input?: unknown;
	/** Entrega propiedad de la sesión, independiente del resultado final del worker.
	 * Un aviso de fallo usa texto de error, nunca un resultado inventado ni un aborto del alumno.
	 * Ausente en los registros heredados: las tareas terminadas antiguas nunca deben reproducirse. */
	delivery?: { kind: "result" | "abort" | "failure"; status: "pending" | "delivered" };
	/** Solo el cálculo del worker; una entrega pendiente no lo mantiene en ejecución. */
	status: JobStatus;
	/** La última línea de actividad legible, p. ej. `web_search: "sigma.js v3"`. */
	activity: string;
	createdAt: string;
	updatedAt: string;
	/** El resultado del subagente (carga útil del artefacto de reorientación). */
	result?: unknown;
	error?: string;
	/** Canal del dinero (observabilidad, 2026-09): uso de tokens acumulado de
	 * la ejecución del subagente, escrito por el ejecutor a medida que se completan los pasos. El coste se
	 * infiere al leer (core/prices.ts). Ausente en las tareas anteriores a 2026-09 y
	 * hasta que llegue la captura del ejecutor: los renderizadores muestran "—", nunca cero. */
	usage?: JobUsage;
	plugin?: PluginJobMetadata;
}

/** Uso de modelo acumulado de una ejecución de worker: totales de tokens más un recuento
 * de llamadas, con contabilidad opcional por llamada. Como en CallUsage, un campo de tokens
 * del que no informó ninguna llamada sigue siendo undefined; la falta de uso no debe implicar coste cero. */
export interface JobUsage {
	/** Identidad de modelo calificada por proveedor (provider:id) para buscar en el catálogo. */
	model: string;
	/** Totales acumulados sumados sobre las llamadas al modelo de la ejecución hasta ahora. */
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	cacheReadTokens: number | undefined;
	cacheWriteTokens: number | undefined;
	reasoningTokens: number | undefined;
	cacheWrite1hTokens?: number;
	/** Llamadas individuales para la tarificación por tramos por llamada del catálogo actual. Ausente en
	 * las tareas antiguas; nunca se rellenan a partir de los totales acumulados. */
	calls?: CallUsage[];
	/** Cuántas llamadas al modelo ha hecho la ejecución (cada una se factura por separado). */
	steps: number;
	/** Contabilidad de la llamada al modelo completada más reciente, usada para el uso de
	 * contexto actual en lugar de los totales acumulados. Ausente hasta que se completa una llamada;
	 * los campos de los que no informa el proveedor siguen siendo undefined. */
	lastStep?: CallUsage;
}

/** La forma de uso por llamada al modelo que plegamos en JobUsage: el LanguageModelUsage
 * del SDK estrechado estructuralmente (sin importar "ai" en tiempo de ejecución: cualquier
 * objeto con estos campos se pliega, incluidos el real y los falsos de las pruebas). */
export interface UsageStepLike {
	inputTokens?: number | undefined;
	inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number; cacheWrite1hTokens?: number } | undefined;
	outputTokens?: number | undefined;
	outputTokenDetails?: { reasoningTokens?: number } | undefined;
}

/** La forma Usage de pi-ai (input/output/cacheRead/cacheWrite/reasoning?) →
 * UsageStepLike. Estructural: sin importar pi aquí; la banda del motor hace la conversión en
 * sus límites. */
export function piUsageToStep(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	reasoning?: number;
}): UsageStepLike {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		inputTokenDetails: { cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, cacheWrite1hTokens: usage.cacheWrite1h ?? 0 },
		outputTokenDetails: usage.reasoning !== undefined ? { reasoningTokens: usage.reasoning } : undefined,
	};
}

/** Pliega el uso de una llamada al modelo en el total acumulado de la ejecución (puro). Un
 * campo del que no informaron ni el total ni el paso se queda undefined; una vez
 * informado, las llamadas posteriores sin dato aportan 0. El contador `steps` es
 * el recuento de facturación: uno por llamada al modelo, informe o no. */
export function accumulateJobUsage(
	total: JobUsage | undefined,
	model: string,
	step: UsageStepLike,
): JobUsage {
	const add = (a: number | undefined, b: number | undefined): number | undefined =>
		a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const call: CallUsage = {
		inputTokens: step.inputTokens,
		outputTokens: step.outputTokens,
		cacheReadTokens: step.inputTokenDetails?.cacheReadTokens,
		cacheWriteTokens: step.inputTokenDetails?.cacheWriteTokens,
		cacheWrite1hTokens: step.inputTokenDetails?.cacheWrite1hTokens,
		reasoningTokens: step.outputTokenDetails?.reasoningTokens,
	};
	return {
		model,
		inputTokens: add(total?.inputTokens, step.inputTokens),
		outputTokens: add(total?.outputTokens, step.outputTokens),
		cacheReadTokens: add(total?.cacheReadTokens, step.inputTokenDetails?.cacheReadTokens),
		cacheWriteTokens: add(total?.cacheWriteTokens, step.inputTokenDetails?.cacheWriteTokens),
		reasoningTokens: add(total?.reasoningTokens, step.outputTokenDetails?.reasoningTokens),
		cacheWrite1hTokens: ((total?.cacheWriteTokens ?? 0) > 0 && total?.cacheWrite1hTokens === undefined) ||
			((call.cacheWriteTokens ?? 0) > 0 && call.cacheWrite1hTokens === undefined)
			? undefined : add(total?.cacheWrite1hTokens, call.cacheWrite1hTokens),
		steps: (total?.steps ?? 0) + 1,
		...(!total || total.calls ? { calls: [...(total?.calls ?? []), call] } : {}),
		lastStep: call,
	};
}

/**
 * EL PROTOCOLO ASÍNCRONO: «acusar ahora, reorientar después» (el modelo de subagentes de pi,
 * visión §2.5):
 *
 *  1. Las herramientas de tareas (research / demo / visual / pdf) se EJECUTAN EN EL SERVIDOR. El modelo
 *     llama a una A MITAD DE TURNO; execute crea el registro de la tarea, lanza el
 *     ejecutor en segundo plano y se resuelve INMEDIATAMENTE con un acuse
 *     ("dispatched — continue your turn"). El turno del profesor NO termina
 *     en la llamada: sigue enseñando, puede despachar otras tareas independientes
 *     (paralelismo completo) y termina cuando termine. La salida de la parte de herramienta
 *     es el acuse, para siempre.
 *
 *  2. El ejecutor en segundo plano (src/agent/subagents/runner.ts) ejecuta el bucle de subagente
 *     del tipo: contexto aislado, modelFor(role), la
 *     doctrina de verificar y nunca hacerlo a la primera (demos probadas sin interfaz, SVG mirados,
 *     informes con fuentes), siguiendo una línea de actividad en vivo en el registro de la tarea.
 *     UN sondeo central del cliente a GET /api/jobs?chatId=… (en Chat) alimenta todas las
 *     superficies de tareas: las tarjetas de despacho del transcript (actividad en vivo por
 *     toolCallId, una línea discreta tras completarse el worker), el panel lateral de
 *     subagentes y la única resincronización cuando una tarea se asienta.
 *
 *  3. El despacho guarda la entrada en la tarea antes del lanzamiento. Al completarse, el
 *     ejecutor guarda el resultado + el estado final del worker + la entrega pendiente en
 *     una sola actualización de la tarea, y después pone en cola buildSubagentSteer SIN esperar a la
 *     entrega. El contenido del marcador personalizado nativo es texto de cara al modelo;
 *     details lleva la carga útil completa del artefacto para la interfaz. Los recursos del worker
 *     se liberan aunque una pregunta mantenga el resultado pendiente indefinidamente.
 *     Solo los workers en cálculo aparecen en Agentes en segundo plano o aceptan el aborto.
 *
 *  4. La entrega de la sesión mantiene una entrada de registro por ID de reorientación determinista,
 *     también mientras un despertar está en curso o un 409/403 devuelve su carga.
 *     Un agente vivo la recoge mediante la reorientación de pi; el registro restaura las tareas
 *     pendientes guardadas antes del primer sondeo de la ejecución de respuesta. Si no, el
 *     despertar en reposo usa la composición de turno normal y respeta las preguntas pendientes,
 *     el descarte y el consentimiento en segundo plano. Un marcador guardado en el transcript completa
 *     la entrega; un HTTP 200 o la visibilidad en streaming por sí solos no.
 *
 *     Los arranques fallidos siguen pendientes en silencio hasta una ejecución del alumno o una
 *     recuperación tras reinicio, sin temporizadores nuevos, errores de entrega visibles ni cambios
 *     de estado del worker. Se mantienen la espera progresiva existente ante 409 y el aplazamiento por consentimiento. Los turnos
 *     aceptados nunca se reproducen automáticamente. Los registros heredados en ejecución con
 *     resultado pasan a finished/pending; los registros heredados terminados sin
 *     metadatos de entrega quedan intactos. Borrar la sesión descarta las entregas
 *     pendientes en lugar de tratarlas como trabajo en ejecución.
 *
 *  5. Nunca existen partes de tarea pendientes, así que el compositor nunca se bloquea por tareas
 *     (el alumno puede intervenir a mitad de una tarea; la reorientación se encola tras su
 *     turno) y las salidas de las herramientas de tareas nunca disparan la continuación
 *     sendAutomatically del lado del cliente: ese mecanismo sigue siendo solo de quiz/ask.
 */

export interface ResearchToolInput {
	question: string;
	/** Para qué lo necesita el profesor: centra el informe de investigación. */
	context?: string;
}

export interface ResearchResult {
	brief: string;
	/** Se renderizan como enlaces, así que aquí solo caben URL http(s) (isWebSourceUrl).
	 *  Los registros guardados antes de esa regla pueden contener aún otros esquemas. */
	sources: { title: string; url: string }[];
}

/** True para URL http(s): las únicas fuentes de investigación que se convierten en enlaces. */
export function isWebSourceUrl(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

export interface DemoToolInput {
	title: string;
	/** Encargo preciso: concepto, parámetros/interacciones, estilo visual. */
	brief: string;
}

export interface DemoResult {
	title: string;
	/** Documento HTML/JS autocontenido de un solo fichero (listo para un iframe aislado). */
	html: string;
	/** El subagente constructor ejecutó la demo sin interfaz antes de entregarla. */
	tested: true;
	notes?: string;
}

export interface VisualToolInput {
	/** Encargo preciso para UN visual (lo que debe mostrar, exactamente). */
	brief: string;
	/** Un fichero de imagen del alumno que anotar (issue #363): el creador dibuja sus
	 *  marcas encima en lugar de crear una figura desde cero. */
	image?: string;
}

export interface VisualResult {
	/** Marcado SVG completo (verificado por el creador mirando el render).
	 *  Los SVG de anotación conservan un marcador de posición de la imagen del alumno; image identifica la instantánea de la sesión. */
	svg: string;
	notes?: string;
	/** Presente cuando la figura anota una imagen del alumno: su ruta
	 *  absoluta. Las fotos nunca se invierten, así que la tarjeta oculta el interruptor. */
	image?: { path: string; snapshotId: string };
}

/** El pdf-reader (sources v0, 2026-09): lee un PDF aportado por el alumno en
 *  nombre del profesor (triaje, extracción dirigida, renders para mirar la página
 *  dentro de su propio bucle) y devuelve un informe de texto con citas
 *  de página (decidido por el usuario: las imágenes renderizadas nunca salen del contexto
 *  del subagente; el profesor recibe texto). */
export interface PdfToolInput {
	/** Ruta al PDF del alumno (relativa o absoluta). */
	path: string;
	/** Qué necesita el profesor del documento: centra el informe. */
	question: string;
}

export interface PdfResult {
	path: string;
	question: string;
	/** El informe destilado. Las citas de página dentro del texto apuntan a
	 *  pagesConsulted. Forma del fallo: /^PDF failed:/i (igual que research). */
	brief: string;
	/** Páginas que el lector LEYÓ de verdad: la salida de extracción o de render entró en el
	 *  bucle (el recuento honesto para la insignia de la interfaz; los fragmentos de resultados de búsqueda no
	 *  cuentan: división de sources v1, 2026-09-19, tras la exageración de «78 páginas consultadas»
	 *  en una lectura de un libro largo empezando por la búsqueda). */
	pagesRead: number[];
	/** Cada página cuyo contenido entró en el bucle, incluidas las líneas de contexto de los resultados
	 *  de búsqueda: el conjunto completo de auditoría (las citas del informe pueden apuntar aquí). */
	pagesConsulted: number[];
}

// ─── Mensajes de reorientación de subagentes (EL PROTOCOLO ASÍNCRONO §3–4) ─────────
//
// Oleada B (aprobada por el responsable el 2026-09-26): las reorientaciones son mensajes NATIVOS del registro:
// customs LhMarkerMessage (rol "custom"), los miembros de despertar de la taxonomía
// de mensajes personalizados. El texto de cara al modelo va en `content` (de fuente única
// más abajo); la carga útil de la interfaz (el artefacto, la insignia de aborto) va en `details`
// y nunca llega al modelo (toLlmMessages convierte el marcador en un mensaje de usuario
// que solo lleva `content`). El id determinista (`steer_<jobId>`)
// ES la clave de idempotencia: steerDelivered compara con él.

/** Metadatos de mensaje que marcan una reorientación de subagente (contracts.ts §3). */
export interface SubagentResultMeta {
	jobId: string;
	kind: JobKind;
	toolCallId: string;
	/** Presente solo en una reorientación de aborto (semántica de aborto de 2026-09): el
	 * alumno abortó la tarea (llega como error "Aborted by learner");
	 * se le dice al profesor para que su promesa de un resultado no quede colgada
	 * en silencio en la lección. */
	aborted?: true;
	/** Fallo de entrega/recuperación, no un aborto del alumno ni un resultado de tarea fabricado. */
	failure?: string;
}

/** La carga útil de la parte data-subagent-artifact: lo que renderiza la interfaz. */
export interface SubagentArtifactData {
	kind: JobKind;
	result: JobResult;
	/** El estado de interfaz fijado por el alumno (interruptor de inversión) que va en el registro. */
	ui?: { inverted?: boolean };
}

/** Los details del marcador de una reorientación de resultado: los metadatos de la interfaz + el artefacto en una
 *  sola carga útil (la proyección lo divide en metadatos + parte de datos). */
export interface SteerDetails extends SubagentResultMeta {
	result: JobResult;
	/** Estado de interfaz del ALUMNO fijado sobre el artefacto (responsable, 2026-10-07): la
	 *  posición del interruptor de inversión, persistida para que al salir y volver (o
	 *  reiniciar) se mantenga. Una preferencia de VISTA: nunca entra en el contexto del
	 *  profesor ni se exporta (el motor de markdown solo lee `result`). */
	ui?: { inverted?: boolean };
}

/** Fija ui.inverted de un mensaje de reorientación (puro): devuelve un array de mensajes NUEVO
 *  con los details del destino actualizados; no hace nada (el mismo array) cuando el mensaje
 *  no existe o no es una reorientación de artefacto invertible. Todo el cuerpo
 *  de la ruta silenciosa. */
export function setSteerUiInverted(
	messages: readonly LhMessage[],
	messageId: string,
	inverted: boolean,
): LhMessage[] {
	return messages.map((m) => {
		if (m.id !== messageId) return m;
		const d = (m as LhMarkerMessage).details as Partial<SteerDetails> | undefined;
		if (!d || (d.kind !== "demo" && d.kind !== "visual")) return m;
		return { ...m, details: { ...d, ui: { ...d.ui, inverted } } } as LhMessage;
	});
}

/** Cualquier cosa que la canalización de despertares pueda encolar y entregar: un marcador nativo. */
export type SteerMessage = LhMarkerMessage;

/** Si un resultado tiene la forma de fallo (html/svg vacío, informe de fallo). */
export function isSubagentFailure(
	kind: JobKind,
	result: JobResult,
): boolean {
	if (kind === "plugin") return (result as PluginBackgroundResult).outcome.status !== "succeeded";
	if (kind === "research") {
		const r = result as ResearchResult;
		return r.sources.length === 0 && /^Research failed:/i.test(r.brief);
	}
	if (kind === "demo") {
		const r = result as DemoResult;
		return typeof r.html !== "string" || r.html.length === 0;
	}
	if (kind === "pdf") {
		const r = result as PdfResult;
		return /^PDF failed:/i.test(r.brief);
	}
	const r = result as VisualResult;
	return typeof r.svg !== "string" || r.svg.length === 0;
}

/** El texto de cara al modelo de una reorientación: qué ES el resultado y qué hacer con él. */
function steerText(kind: JobKind, result: JobResult): string {
	if (kind === "plugin") return (result as PluginBackgroundResult).text;
	if (isSubagentFailure(kind, result)) {
		if (kind === "research")
			return `${(result as ResearchResult).brief}\n\nContinue with what you can establish and flag the uncertainty to the learner.`;
		if (kind === "demo")
			return `The demo "${(result as DemoResult).title}" could not be built: ${
				(result as DemoResult).notes ?? "unknown reason"
			}. Fall back to explaining in prose; if the brief was the problem, re-call demo with a tighter one.`;
		if (kind === "pdf")
			return `${(result as PdfResult).brief}\n\nContinue with what you can establish from the session and flag the gap to the learner.`;
		return `The figure could not be made: ${(result as VisualResult).notes ?? "unknown reason"}. Fall back to prose or mermaid, or re-call visual with a tighter brief.`;
	}
	if (kind === "research")
		return `Research complete — the researcher's full brief follows. Weave it into the lesson and cite its sources when you use its findings:\n\n${(result as ResearchResult).brief}`;
	if (kind === "pdf")
		return `PDF reading complete — the reader's brief on "${(result as PdfResult).path}" follows, with page citations. Weave it into the lesson and cite pages when you use it:\n\n${(result as PdfResult).brief}`;
	if (kind === "demo")
		return `The demo "${(result as DemoResult).title}" is built, headlessly tested, and rendered in the lesson. Builder notes: ${
			(result as DemoResult).notes ?? "(none)"
		}.\nTeach with it — reference its controls by name and point the learner at what to try.`;
	if ((result as VisualResult).image)
		return `The annotated image is drawn, verified by inspection, and rendered in the lesson. Maker notes: ${
			(result as VisualResult).notes ?? "(none)"
		}.\nReference its marks as you teach.`;
	return `The figure is drawn, verified by inspection, and rendered in the lesson. Maker notes: ${
		(result as VisualResult).notes ?? "(none)"
	}.\nReference its elements as you teach.`;
}

/**
 * Construye el mensaje de reorientación de una tarea terminada (puro: lo comparten el ejecutor,
 * la canalización de despertares y las pruebas). El id determinista por tarea hace que la reentrega
 * sea idempotente.
 */
export function buildSubagentSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
	result: JobResult,
): SteerMessage {
	return {
		id: `steer_${job.id}`,
		role: "custom",
		customType: "subagent-steer",
		content: steerText(job.kind, result),
		display: true,
		details: {
			jobId: job.id,
			kind: job.kind,
			toolCallId: job.toolCallId,
			result,
		},
		timestamp: Date.now(),
	};
}

/** Construye la reorientación de aborto de una tarea abortada (puro: la comparten el
 * camino de aborto de src/server/jobs.ts y las pruebas). Mismo espacio de ids que la reorientación
 * de resultado (mismo espacio de ids: solo se entrega exactamente una). */
export function buildAbortSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
): SteerMessage {
	const meta = { jobId: job.id, kind: job.kind, toolCallId: job.toolCallId, aborted: true } as const;
	return {
		id: `steer_${job.id}`,
		role: "custom",
		customType: "subagent-abort",
		content: abortText(job.kind),
		display: true,
		details: meta,
		timestamp: Date.now(),
	};
}

/** Fallo honesto de la canalización: el mismo id de marcador determinista, sin resultado de tarea inventado. */
export function buildJobFailureSteer(
	job: Pick<JobRecord, "id" | "kind" | "toolCallId">,
	failure: string,
): SteerMessage {
	return {
		id: `steer_${job.id}`, role: "custom", customType: "subagent-abort", display: true,
		content: `Background job recovery or delivery failed: ${failure}. No worker outcome can be asserted. Acknowledge the failure and continue without waiting for this result.`,
		details: { jobId: job.id, kind: job.kind, toolCallId: job.toolCallId, failure },
		timestamp: Date.now(),
	};
}

/** Lo que lee el profesor: una línea que le dice que el resultado no va a llegar,
 * cómo darse por enterado y que se permite volver a despachar. */
function abortText(kind: JobKind): string {
	if (kind === "plugin") return "The learner aborted the background job before computation completed. Acknowledge it briefly and continue without waiting for a result.";
	if (kind === "research")
		return "Research aborted — the learner aborted the research job, so no brief is coming. Acknowledge it in one line and continue teaching without it (or offer to re-dispatch it).";
	if (kind === "demo")
		return "The demo job was aborted by the learner — no demo is coming. Acknowledge it in one line and teach the topic in prose instead (a re-dispatch is fine if the learner wants it).";
	if (kind === "pdf")
		return "The PDF reading job was aborted by the learner — no brief is coming. Acknowledge it in one line and continue without it (a re-dispatch is fine if the learner wants it).";
	return "The figure job was aborted by the learner — no figure is coming. Acknowledge it in one line and teach without it (a re-dispatch is fine if the learner wants it).";
}

// ─── la reorientación de traspaso del sondeo (la división sondeo→enseñanza, docs/archive/probe-teach-split.md §2) ─
//
// El execute de probe_done la encola por la misma canalización de despertares; la
// bomba la dispara cuando termina el turno del sondeador (barreras + margen). No lleva
// artefacto: la evaluación a la que hace referencia es duradera en el transcript como
// el resultado de la herramienta probe_done. Id determinista por chat: exactamente un
// traspaso, reentrega idempotente. El contenido del marcador es HANDOFF_TEXT
// (core/contracts/chat.ts, fuente única); la interfaz renderiza la línea discreta
// del sistema a partir del customType. Nunca se persiste nada que parezca humano.

export function buildProbeHandoffSteer(chatId: string): SteerMessage {
	return newHandoffMessage(chatId);
}

/** True cuando el transcript ya lleva esta reorientación: entrega idempotente
 *  para CUALQUIER tipo de reorientación: cada id de reorientación es determinista según su
 *  evento (steer_<jobId> para las tareas, steer_probe_<chatId> para el traspaso). */
export function steerDelivered(messages: LhMessage[], steerId: string): boolean {
	return messages.some((m) => m.id === steerId);
}

