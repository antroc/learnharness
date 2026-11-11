import type { PiEngine } from "../models.ts";
import type { SearchProvider } from "../../core/search.ts";
import {
	accumulateJobUsage,
	buildSubagentSteer,
	isSubagentFailure,
	isWebSourceUrl,
	piUsageToStep,
	isBuiltinJobKind,
	type DemoResult,
	type DemoToolInput,
	type BuiltinJobKind,
	type JobRecord,
	type JobUsage,
	type PdfResult,
	type PdfToolInput,
	type ResearchResult,
	type ResearchToolInput,
	type SteerMessage,
	type UsageStepLike,
	type VisualResult,
	type VisualToolInput,
} from "../../core/contracts.ts";
import { registerJobAbort, unregisterJobAbort } from "./aborts.ts";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelRole } from "../../../config.ts";
import { ROLE_SLOT, modelsNotConfigured, type ModelSlotName, type ProviderKeyMissing } from "../../core/settings.ts";
import type { ChatStore, JobStore } from "../../core/ports.ts";
import { runDemoBuilder } from "./demo-builder.ts";
import { runPdfReaderAgent } from "./pdf-reader.ts";
import { runResearcherAgent } from "./researcher.ts";
import { runVisualMaker } from "./visual-maker.ts";
import { loadLearnerImage, type LearnerImage } from "../tools/learner-image.ts";

/**
 * El ejecutor de tareas en segundo plano (contracts.ts, "THE ASYNC PROTOCOL"
 * §2–3), creado con createJobRunner({ chatStore, jobStore, deliver }): la raíz
 * de composición (chat-handler) inyecta los puertos de almacenamiento y la
 * FRONTERA DE DESPERTAR (la entrega de la reorientación en el servidor,
 * src/server/jobs.ts); este módulo nunca importa un adaptador.
 *
 *   runJob(jobId): ejecuta en segundo plano el bucle del subagente del tipo
 *     (el execute de las herramientas de tareas lo dispara mediante la
 *     frontera de lanzamiento, sin esperar), actualizando la línea de
 *     actividad de la tarea en cada iteración. Al terminar, el ejecutor
 *     construye el MENSAJE DE REORIENTACIÓN (buildSubagentSteer) y se lo pasa a
 *     `deliver` sin esperar. El resultado final del worker y la entrega
 *     pendiente se guardan juntos; a partir de ahí, la entrega es
 *     responsabilidad de la sesión.
 *
 *   Si falla, el resultado tiene la forma de fallo (html/svg vacío + notas
 *   "FAILED: …"; en research, un informe de fallo) y AUN ASÍ reorienta, porque
 *   el profesor debe conocer el resultado. Los inicios de entrega fallidos se
 *   quedan pendientes en silencio y nunca reescriben el resultado del cálculo
 *   del worker.
 */

/**
 * Frontera de pruebas: el cableado de lanzamiento no tiene punto de inyección
 * en la capa de herramientas, así que las pruebas sustituyen aquí un motor pi
 * con guion para mantener las pruebas de tareas fuera de la red. Undefined en
 * producción. (Las tareas se lanzan mediante los ejecutores por TIPO a nivel
 * de módulo, que leen esto en el momento de la llamada).
 */
export const researchModelOverride: { current?: PiEngine } = {};
export const demoModelOverride: { current?: PiEngine } = {};
export const visualModelOverride: { current?: PiEngine } = {};
export const pdfModelOverride: { current?: PiEngine } = {};

/** La entrada de la herramienta en el momento del despacho (de los esquemas de src/agent/tools/jobs.ts). */
type JobToolInput = ResearchToolInput | DemoToolInput | VisualToolInput | PdfToolInput;

export interface JobRunnerDeps {
	chatStore: ChatStore;
	jobStore: JobStore;
	/**
	 * Pasa la reorientación de una tarea terminada al registro de entregas de la
	 * sesión. La promesa sigue la aceptación duradera del marcador, pero el
	 * worker nunca la espera. Su obligación pendiente persistida sobrevive a un
	 * reinicio del proceso.
	 */
	deliver: (steer: SteerMessage) => Promise<void>;
	/** Motor resuelto desde los ajustes por rol (oleada de ranuras de modelo,
	 *  2026-09-20): la cadena sustitución del rol → ranura, leída DE NUEVO en cada
	 *  tarea (el cableado del servidor pasa una resolución basada en
	 *  effectiveSettings). Las sustituciones de prueba (más abajo) siguen
	 *  ganando. BYOK (responsable, 2026-09-22): la cadena puede acabar VACÍA →
	 *  undefined; entonces runJob rechaza el lanzamiento con honestidad en lugar
	 *  de adivinar un modelo. */
	engineFor?: (role: ModelRole) => PiEngine | undefined;
	/** La frontera de búsqueda (oleada del puerto de búsqueda, 2026-09-20):
	 *  resuelve el proveedor ACTUAL de nuevo en cada tarea (composición de
	 *  server/search.ts inyectada por el cableado); null = no disponible, dicho
	 *  con honestidad (la web_search del researcher lo indica como texto
	 *  recuperable). Sin frontera (pruebas) se lee igual; el despacho de research
	 *  y web_fetch no requieren credenciales de búsqueda. */
	searchProvider?: () => SearchProvider | null;
	/** Barrera de presencia de clave (interludio de claves de proveedor,
	 *  2026-09-25): dados el proveedor del motor resuelto y el nivel de ranura del
	 *  tipo, devuelve el sobre de rechazo cuando falta la clave del proveedor
	 *  (null = ejecutar). Se inyecta porque la capa del agente no puede leer el
	 *  almacén de claves; ausente en las pruebas que inyectan motores directamente
	 *  (los motores de prueba nunca deben clave). */
	providerKeyMissing?: (provider: string, tier: ModelSlotName) => ProviderKeyMissing | null;
}

export interface JobRunner {
	/** Ejecuta el bucle del subagente de una tarea hasta el final (en segundo
	 *  plano; nunca lanza). La entrada de la herramienta viaja desde el despacho
	 *  (el lanzamiento ocurre en mitad del flujo, antes de persistir la parte de
	 *  la herramienta). La recuperación lee la entrada guardada de la tarea, con
	 *  la transcripción como alternativa para tareas heredadas. No se espera a la
	 *  entrega. */
	runJob(jobId: string, input?: JobToolInput): Promise<void>;
}

/** La maquinaria inyectada del bucle de una tarea: el interruptor de parada
 * (cancelación real, semántica de 2026-09) y la toma de uso (canal del dinero:
 * cada llamada al modelo se suma a JobRecord.usage al completarse). */
interface LoopContext {
	/** Se dispara cuando abortJob mata la ejecución; abortSignal se pasa a cada
	 * llamada al modelo para que el gasto se detenga en mitad de la llamada, no
	 * en la siguiente comprobación del bucle. */
	abortSignal: AbortSignal;
	/** El chat de la tarea (depuración: grabación de eventos en bruto del proveedor
	 * con LH_PROVIDER_EVENTS=1, reenviado a cada ejecución de subagente). */
	chatId?: string;
	/** Suma el uso de una llamada al modelo al registro de la tarea (escritura de progreso). */
	onUsage: (step: UsageStepLike) => void;
}

/** La tabla tipo→rol (oleada de ranuras de modelo, 2026-09-20): con el motor de
 * qué ModelRole se ejecuta cada tipo de subagente; la clave de inyección de engineFor. */
const KIND_ROLE: Record<BuiltinJobKind, ModelRole> = {
	research: "researcher",
	demo: "demoBuilder",
	visual: "visualMaker",
	pdf: "pdfReader",
};

export function createJobRunner(deps: JobRunnerDeps): JobRunner {
	const { chatStore, jobStore, deliver } = deps;

	/** Totales de uso acumulados por tarea viva (el onUsage del bucle suma aquí y
	 * después escribe en el almacén de tareas para que el sondeo vea el progreso). */
	const usageTotals = new Map<string, JobUsage>();

	function makeLoopContext(jobId: string, engine: PiEngine): LoopContext {
		const chatId = jobStore.getJob(jobId)?.chatId;
		// Sello con proveedor: el modelo real del motor, lo único que se ejecutó
		// (BYOK: no existen sellos alternativos de una fijación en la configuración).
		const model = `${engine.model.provider}:${engine.model.id}`;
		// Cableado de terminación real (semántica de cancelación de 2026-09): el controlador
		// es lo que dispara el endpoint de cancelación (registro de agent/subagents/aborts.ts);
		// la señal viaja a cada llamada al modelo del bucle.
		const controller = new AbortController();
		registerJobAbort(jobId, controller);
		return {
			abortSignal: controller.signal,
			chatId,
			onUsage: (step) => {
				const next = accumulateJobUsage(usageTotals.get(jobId), model, step);
				usageTotals.set(jobId, next);
				jobStore.updateJob(jobId, { usage: next }); // parche de fusión: el estado no se toca
			},
		};
	}

	/** True mientras la tarea pueda escribir aún su estado terminal (resultado,
	 * error, reorientación). False en cuanto abortJob la ha pasado a error
	 * ("Aborted by learner"); entonces el ejecutor se deshace en silencio; la ruta
	 * de cancelación se encarga del registro y de la reorientación de cancelación. */
	function stillRunning(jobId: string): boolean {
		return jobStore.getJob(jobId)?.status === "running";
	}

	/** El mapa tipo→ejecutor: un bucle de subagente por tipo. El ejecutor de cada
	 *  tipo acota él mismo la entrada de la unión (las entradas del despacho son
	 *  del tipo correcto por construcción; las alternativas de la transcripción se
	 *  convierten después). */
	/** El motor sobre el que se ejecuta una tarea: primero la sustitución de prueba
	 *  (la frontera antigua: las pruebas cambian motores con guion sin tocar las
	 *  dependencias) y después el engineFor inyectado, resuelto desde los ajustes.
	 *  undefined = la cadena BYOK salió vacía (responsable, 2026-09-22); runJob la
	 *  rechaza más abajo, con honestidad. */
	function pickEngine(kind: BuiltinJobKind): PiEngine | undefined {
		const testOverride: Record<string, { current?: PiEngine } | undefined> = {
			researcher: researchModelOverride,
			demoBuilder: demoModelOverride,
			visualMaker: visualModelOverride,
			pdfReader: pdfModelOverride,
		};
		return testOverride[KIND_ROLE[kind]]?.current ?? deps.engineFor?.(KIND_ROLE[kind]);
	}

	const KIND_RUNNERS: Record<
		BuiltinJobKind,
		(jobId: string, engine: PiEngine, input: JobToolInput | undefined, loop: LoopContext) => Promise<void>
	> = {
		research: (jobId, engine, input, loop) => runResearchJob(jobId, engine, input, loop),
		demo: (jobId, engine, input, loop) => runDemoJob(jobId, engine, input, loop),
		visual: (jobId, engine, input, loop) => runVisualJob(jobId, engine, input, loop),
		pdf: (jobId, engine, input, loop) => runPdfJob(jobId, engine, input, loop),
	};

	async function runJob(jobId: string, input?: JobToolInput): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) {
			console.error(`[job ${jobId}] not found — nothing to run`);
			return;
		}
		if (job.status !== "running" || !isBuiltinJobKind(job.kind)) return; // las tareas de plugins nunca entran en el ejecutor del núcleo
		const run = KIND_RUNNERS[job.kind];
		if (!run) {
			console.error(`[job ${jobId}] unknown kind: ${job.kind}`);
			jobStore.updateJob(jobId, { status: "error", error: `unknown kind ${job.kind}`, activity: "failed" });
			return;
		}
		const engine = pickEngine(job.kind);
		// Las protecciones de rechazo por necesidad (BYOK 2026-09-22 / interludio de claves
		// de proveedor 2026-09-25): no hay motor para el nivel del tipo, o ha desaparecido la
		// clave del proveedor del motor resuelto; ambos rechazan con la MISMA convención
		// que cualquier otra tarea fallida: se registra el error honesto (sin cambiar el
		// estado: finalizeJob se encarga del cambio terminal tras la entrega) y luego se
		// reorienta con la forma de fallo del tipo mediante finishJob, para que el proceso
		// de despertar reanude la lección y el profesor lea el rechazo en lugar de esperar
		// para siempre a una tarea que ya despachó.
		const refuse = async (reason: string): Promise<void> => {
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			const resolved = resolveInput(job, input) as
				| ResearchToolInput
				| DemoToolInput
				| VisualToolInput
				| PdfToolInput
				| undefined;
			const pdf = resolved as PdfToolInput | undefined;
			const failure: ResearchResult | DemoResult | VisualResult | PdfResult =
				job.kind === "research"
					? { brief: `Research failed: ${reason}`, sources: [] }
					: job.kind === "demo"
						? {
								title: typeof (resolved as DemoToolInput | undefined)?.title === "string" && (resolved as DemoToolInput).title.trim() ? (resolved as DemoToolInput).title : "Interactive demo",
								html: "",
								tested: true,
								notes: `FAILED: ${reason}`,
							}
						: job.kind === "visual"
							? { svg: "", notes: `FAILED: ${reason}` }
							: {
									path: typeof pdf?.path === "string" ? pdf.path : "",
									question: typeof pdf?.question === "string" ? pdf.question : "",
									brief: `PDF failed: ${reason}`,
									pagesRead: [],
									pagesConsulted: [],
								};
			await finishJob(jobId, failure);
		};
		if (!engine) {
			const tier = ROLE_SLOT[KIND_ROLE[job.kind]];
			const envelope = modelsNotConfigured([tier]);
			console.info(`[job ${jobId}] refused — ${JSON.stringify(envelope)}`);
			await refuse(`${envelope.error} (missing: ${tier})`);
			return;
		}
		// Presencia de clave (2026-09-25): el motor existe, pero puede haber desaparecido
		// la clave de su proveedor; se rechaza el lanzamiento ANTES del bucle, con la misma
		// convención (la comprobación inyectada lee el almacén de claves; ausente en las
		// pruebas que inyectan motores).
		const keyRefusal =
			deps.providerKeyMissing?.(engine.model.provider, ROLE_SLOT[KIND_ROLE[job.kind]]) ?? null;
		if (keyRefusal) {
			console.info(`[job ${jobId}] refused — ${JSON.stringify(keyRefusal)}`);
			await refuse(keyRefusal.error);
			return;
		}
		try {
			await run(jobId, engine, input, makeLoopContext(jobId, engine));
		} finally {
			unregisterJobAbort(jobId);
			// Puede que la última escritura de uso estuviera en curso cuando murió el bucle;
			// se persiste lo acumulado (la ruta de cancelación solo parchea el estado, así que
			// esto nunca resucita una tarea cancelada: parche de fusión).
			const usage = usageTotals.get(jobId);
			if (usage) jobStore.updateJob(jobId, { usage });
			usageTotals.delete(jobId);
		}
	}

	/** Gana la entrada del despacho y, después, los argumentos guardados de la
	 * tarea. Las tareas heredadas sin entrada guardada recurren a la transcripción
	 * duradera, a la que puede faltarle una llamada si el turno que despachó murió
	 * antes de asentarse. */
	function resolveInput(
		job: JobRecord,
		input: JobToolInput | undefined,
	): JobToolInput | undefined {
		if (input) return input;
		if (job.input !== undefined) return job.input as JobToolInput;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) return undefined;
		// Oleada D: el registro es historial nativo; el recorrido lee directamente los
		// bloques nativos del asistente (los argumentos de un toolCall son la entrada).
		for (const m of chat.messages) {
			if ((m as { role?: string }).role !== "assistant") continue;
			const content = (m as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const block of content as Array<{ type?: string; id?: string; arguments?: unknown }>) {
				if (block.type !== "toolCall" || block.id !== job.toolCallId) continue;
				return block.arguments as JobToolInput | undefined;
			}
		}
		return undefined;
	}

	/**
	 * Guarda juntos el resultado del cálculo y la obligación de entrega de la
	 * sesión. La vida del worker termina tras la limpieza, no cuando una lección
	 * consume el resultado.
	 */
	async function finishJob(jobId: string, result: ResearchResult | DemoResult | VisualResult | PdfResult): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) return;
		// Cancelada en mitad de la ejecución (abortJob cambia el registro antes de que
		// el bucle se deshaga): sin escritura de resultado ni reorientación; la ruta de
		// cancelación se encarga del registro y encola ella misma la reorientación de cancelación.
		if (job.status !== "running") return;
		const failed = isSubagentFailure(job.kind, result);
		jobStore.updateJob(jobId, {
			result,
			status: failed ? "error" : "done",
			activity: failed ? "failed" : "finished",
			delivery: { kind: "result", status: "pending" },
		});
		// El resultado guardado pertenece ya a la sesión. No se mantienen vivos el worker,
		// el registro de cancelación ni los recursos temporales a la espera de una pregunta.
		void deliver(buildSubagentSteer(job, result)).catch((err: unknown) => {
			console.error(`[job ${jobId}] pending delivery:`, err);
		});
	}

	/** Resolución del registro del chat + la entrada, compartida por los tres ejecutores. */
	function jobContext(jobId: string): { job: JobRecord; chatId: string } | null {
		const job = jobStore.getJob(jobId);
		if (!job || job.status !== "running") return null;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) {
			jobStore.updateJob(jobId, { status: "error", error: `Chat not found: ${job.chatId}`, activity: "failed" });
			return null;
		}
		return { job, chatId: job.chatId };
	}

	// ─── research ───────────────────────────────────────────────────────────

	async function runResearchJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as ResearchToolInput | undefined;
		if (!(typeof input?.question === "string" && input.question.trim())) {
			jobStore.updateJob(jobId, { error: "research question unavailable" });
			await finishJob(jobId, { brief: "Research failed: the research question is unavailable.", sources: [] });
			return;
		}
		const question = input.question;
		const context = typeof input?.context === "string" && input.context.trim() ? input.context : undefined;

		const prompt = [
			`Research question: ${question}`,
			context ? `Context (what this is needed for): ${context}` : null,
			"Produce your final brief in the required format.",
		]
			.filter(Boolean)
			.join("\n\n");

		const fetchedUrls: string[] = [];
		// Directorio de PDF por tarea (oleada de PDF del researcher, 2026-10-07): las
		// descargas de web_fetch_pdf acaban aquí; todas las herramientas de PDF se limitan
		// a él; muere con la tarea (nunca entra en el registro).
		const pdfDir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-research-"));

		try {
			jobStore.updateJob(jobId, { activity: "researching" });
			const brief = await runResearcherAgent(prompt, {
				engine: model,
				search: deps.searchProvider,
				pdfDir,
				abortSignal: loop.abortSignal,
				chatId: loop.chatId,
				// Canal del dinero: cada paso del agente es una llamada al modelo; su uso se
				// suma al registro al completarse (escritura de progreso).
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onToolStart: (toolName, args) => {
					const input = args as { query?: string; url?: string } | undefined;
					if (typeof input?.url === "string" && (toolName === "web_fetch" || toolName === "web_fetch_pdf")) {
						fetchedUrls.push(input.url);
					}
					jobStore.updateJob(jobId, { activity: activityLine(toolName, input) });
				},
			});
			if (!brief.trim()) throw new Error("the researcher produced no text");
			const research: ResearchResult = { brief: brief.trim(), sources: parseSources(brief.trim(), fetchedUrls) };
			await finishJob(jobId, research);
		} catch (err) {
			// Cancelación con terminación real (2026-09): la ruta de cancelación cambió el
			// registro y encoló la reorientación de cancelación; se deshace en silencio,
			// conservando el uso acumulado hasta ahora (lo vuelca el finally de runJob).
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { brief: `Research failed: ${reason}`, sources: [] });
		} finally {
			await fs.rm(pdfDir, { recursive: true, force: true });
		}
	}

	// ─── demo + visual ──────────────────────────────────────────────────────

	async function runDemoJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as DemoToolInput | undefined;
		const title = typeof input?.title === "string" && input.title.trim() ? input.title : "Interactive demo";
		const brief = typeof input?.brief === "string" ? input.brief : "";

		try {
			jobStore.updateJob(jobId, { activity: "building demo" });
			const result = await runDemoBuilder(
				{ title, brief },
				{
					engine: model,
					abortSignal: loop.abortSignal,
					chatId: loop.chatId,
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (isDemoFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "demo build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { title, html: "", tested: true, notes: `FAILED: ${reason}` });
		}
	}

	async function runVisualJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as VisualToolInput | undefined;
		const brief = typeof input?.brief === "string" ? input.brief : "";
		const imagePath = typeof input?.image === "string" ? input.image : undefined;

		try {
			// Anotación (issue #363): la imagen del alumno se lee una sola vez, aquí,
			// y viaja al maker acotada para el almacenamiento.
			let image: LearnerImage | undefined;
			if (imagePath !== undefined) {
				jobStore.updateJob(jobId, { activity: "loading image" });
				image = await loadLearnerImage(imagePath, loop.abortSignal);
			}
			jobStore.updateJob(jobId, { activity: image ? "annotating image" : "drawing figure" });
			const result = await runVisualMaker(
				{ brief, image },
				{
					engine: model,
					abortSignal: loop.abortSignal,
					chatId: loop.chatId,
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (image && result.svg && stillRunning(jobId)) chatStore.saveImageSnapshot(job.chatId, image.snapshotId, image);
			if (isVisualFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "visual build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { svg: "", notes: `FAILED: ${reason}` });
		}
	}

	// ─── lectura de PDF (sources v0) ─────────────────────────────────────────

	async function runPdfJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as PdfToolInput | undefined;
		const path = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : "";
		const question = typeof input?.question === "string" ? input.question : "";

		try {
			jobStore.updateJob(jobId, { activity: "reading pdf" });
			const result = await runPdfReaderAgent(
				{ path, question },
			{
				engine: model,
				abortSignal: loop.abortSignal,
				chatId: loop.chatId,
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
				onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
			},
			);
			if (isPdfFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.brief.replace(/^PDF failed:\s*/i, "") });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { path, question, brief: `PDF failed: ${reason}`, pagesRead: [], pagesConsulted: [] });
		}
	}

	return { runJob };
}

// ─── auxiliares puros a nivel de módulo ─────────────────────────────────────

/** Forma de fallo (informe W6): html === "" con notas "FAILED: …". */
function isDemoFailure(result: DemoResult): boolean {
	return typeof result.html !== "string" || result.html.length === 0;
}

function isVisualFailure(result: VisualResult): boolean {
	return typeof result.svg !== "string" || result.svg.length === 0;
}

/** El informe de fallo del pdf-reader (refleja la forma de fallo de research). */
function isPdfFailure(result: PdfResult): boolean {
	return /^PDF failed:/i.test(result.brief);
}

/** La línea de actividad que muestra la interfaz: `web_search: "query"` / `web_fetch: host`. */
function activityLine(toolName: string, input: { query?: string; url?: string } | undefined): string {
	if (toolName === "web_search") return `web_search: "${input?.query ?? ""}"`;
	if (toolName === "web_fetch") return `web_fetch: ${hostOf(input?.url)}`;
	return toolName;
}

function hostOf(url: string | undefined): string {
	if (!url) return "(no url)";
	try {
		return new URL(url).hostname;
	} catch {
		return url.slice(0, 40);
	}
}

/** Fuentes del resultado: los enlaces Markdown citados en el informe o, si no,
 * las URL descargadas. Las URL descargadas se registran antes de que la
 * herramienta de descarga valide su esquema; solo las fuentes http(s) pueden
 * convertirse en enlaces, también en tareas guardadas anteriormente. */
export function parseSources(brief: string, fetchedUrls: string[]): ResearchResult["sources"] {
	const sources: ResearchResult["sources"] = [];
	const seen = new Set<string>();
	for (const match of brief.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
		const title = (match[1] ?? "").trim();
		const url = match[2]!;
		if (!title || seen.has(url)) continue;
		seen.add(url);
		sources.push({ title, url });
	}
	if (sources.length === 0) {
		for (const url of fetchedUrls) {
			if (seen.has(url) || !isWebSourceUrl(url)) continue;
			seen.add(url);
			sources.push({ title: hostOf(url), url });
		}
	}
	return sources.slice(0, 10);
}
