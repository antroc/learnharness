/**
 * Pruebas de la infraestructura de tareas: deterministas, sin red:
 *
 *   1. CRUD del almacén de tareas (crear → obtener → actualizar → listar → deduplicar por toolCallId)
 *   2. auxiliares de reorientación (puros, contracts.ts): forma de buildSubagentSteer por tipo,
 *      isSubagentFailure, steerDelivered
 *   3. despacho (protocolo asíncrono §2): ejercita handleChatRequest con un profesor
 *      simulado guionizado que emite una llamada a la herramienta research → la parte de herramienta se resuelve
 *      INMEDIATAMENTE con el acuse de lanzar y olvidar (el turno del profesor
 *      CONTINÚA: no hay corte de turno en la llamada), existe un registro de tarea y el
 *      ejecutor de prueba (entrega falsa) produce la reorientación
 *   4. finalización del ejecutor: un modelo de investigador falso (llamada a web_search → informe
 *      de texto final, safeFetchOverride sustituido) → la tarea guarda el resultado,
 *      la reorientación lleva el informe + las fuentes y la entrega falsa marca la
 *      tarea como terminada
 *   5. fallo del ejecutor: un modelo que lanza → la reorientación de fallo se dispara igualmente
 *      (el profesor conoce el resultado) y la tarea acaba en error
 *   6. el proceso de despertar (src/server/jobs.ts): entrega de reorientaciones en el servidor:
 *      ruta feliz (dispara el ejecutor de turnos inyectado, cambia el estado de la tarea), aplazamiento por
 *      quiz pendiente, reintento ante 409, reentrega idempotente
 *
 * La limpieza sigue a tests/chat-flow.test.ts: los ficheros de chat/tarea creados se borran en
 * bloques finally / el hook after().
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type AssistantMessage, type FauxResponseStep } from "@earendil-works/pi-ai";
import {
	accumulateJobUsage,
	buildAbortSteer,
	buildSubagentSteer,
	isSubagentFailure,
	steerDelivered,
	type DemoResult,
	type JobUsage,
	type PdfResult,
	type ResearchResult,
	type SubagentArtifactData,
	type SteerMessage,
	type VisualResult,
	buildProbeHandoffSteer,
} from "../src/core/contracts.ts";
import { composeInstructions, createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { webTools } from "../src/agent/tools/web.ts";
import { safeFetchOverride } from "../src/agent/tools/safe-fetch.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import {
	abortJob,
	deliverJobResult,
	noteSteersDurable,
	discardChatDeliveries,
	reconcileUserSteers,
	recoverStaleJobs,
	registerLiveAgent,
	setJobRespawn,
	setTurnRunner as setRawTurnRunner,
	type TurnRunner,
	settleSteers,
	steerLiveChat,
	unregisterLiveAgent,
} from "../src/server/jobs.ts";
import { isJobLive, registerJobAbort, unregisterJobAbort } from "../src/agent/subagents/aborts.ts";
import { beginTurn, endTurn, isTurnRunning } from "../src/server/turn-liveness.ts";
import { persistTurn } from "../src/server/turn-service.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { createJobRunner, pdfModelOverride, researchModelOverride } from "../src/agent/subagents/runner.ts";
import { providerKeyMissing, type ModelSlotName } from "../src/core/settings.ts";
import type { PiEngine } from "../src/agent/models.ts";
import type { SearchProvider } from "../src/core/search.ts";
import { PATHS } from "../config.ts";
import { projectView as projectNative } from "../src/core/view.ts";
import { subscribe } from "../src/core/events.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { SteerInput, TurnInput } from "../src/core/input-events.ts";

const JOBS_DIR = path.join(PATHS.data, "jobs");

const createdChats: string[] = [];

// La barrera de turno por presencia de clave (interludio de la clave del proveedor, 2026-09-25): los turnos
// guionizados fijan openrouter por chat; la barrera lee la verdad del entorno primero, así que la
// clave debe estar presente en el proceso de la prueba, como en cualquier configuración real.
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";
const createdJobs: string[] = [];

function trackChat(id: string) {
	createdChats.push(id);
}

/** Fixture nativo de la oleada B: texto del usuario + una llamada a herramienta del asistente + su acuse;
 *  el registro es historial del agente; el recorrido de la transcripción del ejecutor (resolución
 *  de la entrada) lo lee a través de la proyección. */
function nativeToolMessages(text: string, tool: string, toolCallId: string, input: unknown): LhMessage[] {
	return [
		{ id: "u1", role: "user", content: text, timestamp: 1 } as never,
		{
			id: "a1",
			role: "assistant",
			content: [{ type: "toolCall", id: toolCallId, name: tool, arguments: input as never }],
			api: "openai-completions",
			provider: "openrouter",
			model: "test",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			stopReason: "toolUse",
			timestamp: 1,
		} as never,
		{
			id: "r1",
			role: "toolResult",
			toolCallId,
			toolName: tool,
			content: [{ type: "text", text: "Dispatched." }],
			details: "Dispatched.",
			isError: false,
			timestamp: 1,
		} as never,
	];
}

function trackJob(id: string) {
	createdJobs.push(id);
}

/* LA VALLA DE HERMETICIDAD (ronda 7 del responsable, 2026-10-05): las fronteras de jobs son
 * GLOBALES DEL MÓDULO (setJobRespawn / setTurnRunner / el registro de abortos) y
 * el barrido recorre TODAS las tareas del almacén. Una prueba asíncrona que agota su tiempo
 * con la carga de la batería completa deja atrás un registro "running" y un despertar tardío,
 * y ese estado suelto envenena después la SIGUIENTE prueba (una reaparición ajena
 * cae en su contador; un huérfano ajeno, en su barrido). Aislada,
 * nada agota nunca su tiempo, y por eso el fichero pasa solo y fallaba de forma intermitente
 * en la ejecución completa. La valla hace idéntico el estado inicial de cada prueba:
 * todas las tareas seguidas asentadas, abortos sin registrar, fronteras inertes. */
afterEach(() => {
	for (const id of createdJobs) {
		try {
			const job = jobStore.getJob(id);
			if (job && job.status === "running") {
				jobStore.updateJob(id, { status: "done", activity: "settled (fence)" });
			}
			if (job?.delivery?.status === "pending") jobStore.updateJob(id, { delivery: { ...job.delivery, status: "delivered" } });
			unregisterJobAbort(id);
		} catch {
			/* ya no existe */
		}
	}
	for (const chatId of createdChats) discardChatDeliveries(chatId);
	// Los despertares tardíos de una prueba anterior deben ser inertes: una reaparición que no hace nada no puede
	// incrementar el contador de nadie, un ejecutor que no hace nada no puede lanzar trabajo real.
	setJobRespawn(() => {});
	setTurnRunner(async () => 200);
});

after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* ya no existe */
		}
	}
	for (const id of createdJobs) {
		try {
			fs.unlinkSync(path.join(JOBS_DIR, `${id}.json`));
		} catch {
			/* ya no existe */
		}
	}
	researchModelOverride.current = undefined;
});

/** Un motor pi guionizado (proveedor simulado): la cola de respuestas sustituye a los
 *  antiguos contadores de turnos de doStream/doGenerate. tokenSize está fijado para que cada cadena
 *  de prueba se emita como UN delta: las aserciones sobre el cuerpo SSE ("Back with the
 *  brief.") leen texto contiguo. */
function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** Una fábrica de respuestas guionizada cuya llamada al modelo nunca se resuelve hasta que se dispara su
 *  señal de aborto (una petición al proveedor cancelada); una señal ya abortada
 *  se resuelve enseguida: el stream simulado termina entonces el mensaje como abortado. */
function abortableFactory(): FauxResponseStep {
	const factory = (_context: unknown, options: { signal?: AbortSignal } | undefined) =>
		new Promise<AssistantMessage>((resolve) => {
			const sig = options?.signal;
			if (sig?.aborted) {
				resolve(fauxAssistantMessage("late"));
				return;
			}
			sig?.addEventListener("abort", () => resolve(fauxAssistantMessage("late")), { once: true });
		});
	return factory as unknown as FauxResponseStep;
}

async function drain(res: Response): Promise<string> {
	if (res.status !== 200) {
		assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
	}
	return res.text();
}

/** DIETA DE CONEXIONES B (responsable, 2026-10-10): el POST acusa recibo y cierra; vacía
 *  en su lugar el cable del turno a través del stream de reenganche. */
async function drainTurn(req: Request, factory: Parameters<typeof handleChatRequest>[1]): Promise<string> {
	const cloned = req.clone();
	const ack = await handleChatRequest(req, factory);
	if (ack.status !== 200) {
		assert.fail(`expected 200 ack, got ${ack.status}: ${await ack.text()}`);
	}
	const { chatId } = (await cloned.json()) as { chatId: string };
	const handle = runningTurn(chatId);
	if (!handle) return ""; // el turno se asentó dentro del manejador: la finalización ya ocurrió
	return new Response(handle.subscribe()).text();
}

function post(chatId: string, input: unknown): Request {
	return new Request("http://test/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		// Oleada B: el contrato de eventos de entrada: un evento explícito, nunca una
		// transcripción del cliente.
		body: JSON.stringify({ chatId, input }),
	});
}

/* Presupuesto de 30 s (ronda del responsable, 2026-10-05): con la carga paralela de la batería
 * COMPLETA el bucle de eventos se queda sin turno y un presupuesto de 8 s de reloj caducaba antes
 * de que se llegaran a observar condiciones sanas, y una entrega que agotaba su tiempo filtraba
 * un despertar tardío a la SIGUIENTE prueba (el hook de reaparición es global del módulo),
 * envenenando incluso a vecinas síncronas. waitFor vuelve en el instante en que se cumple
 * la condición, así que el presupuesto generoso no cuesta nada cuando todo va bien. */
function waitFor(cond: () => boolean, timeoutMs = 30_000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
			setTimeout(tick, 25);
		};
		tick();
	});
}

// ─── 1. CRUD del almacén de tareas ───────────────────────────────────────────

describe("job store", () => {
	it("create → get → update → list round-trips", () => {
		const job = jobStore.createJob({ kind: "research", chatId: "chat_storetest", toolCallId: "call-store" });
		trackJob(job.id);

		assert.match(job.id, /^job_/);
		assert.equal(job.status, "running");
		assert.equal(job.activity, "starting");

		const loaded = jobStore.getJob(job.id)!;
		assert.equal(loaded.toolCallId, "call-store");
		assert.equal(loaded.kind, "research");

		const updated = jobStore.updateJob(job.id, { activity: 'web_search: "test"', status: "done", result: { brief: "b" } })!;
		assert.equal(updated.activity, 'web_search: "test"');
		assert.equal(updated.status, "done");
		assert.ok(updated.updatedAt >= job.updatedAt);
		// los campos inmutables de identidad sobreviven a un parche
		assert.equal(updated.toolCallId, "call-store");
		assert.equal(jobStore.getJob(updated.id)!.toolCallId, "call-store");

		const listed = jobStore.listJobs("chat_storetest");
		assert.ok(listed.some((j) => j.id === job.id));
		assert.equal(jobStore.listJobs("chat_other").some((j) => j.id === job.id), false, "jobs are scoped to their chat");

		const byTool = jobStore.findJobByToolCallId("chat_storetest", "call-store");
		assert.equal(byTool?.id, job.id);
		assert.equal(jobStore.findJobByToolCallId("chat_storetest", "call-missing"), null);
	});

	// ── arquitectura push S4 (2026-10-02): toda ESCRITURA se anuncia en el
	// canal de eventos (notificar tras escribir); las lecturas siguen en silencio ──
	it("every mutation emits jobs-changed {chatId}; reads emit nothing", () => {
		const got: { chatId?: string }[] = [];
		const off = subscribe((e) => {
			if (e.type === "jobs-changed") got.push({ chatId: e.chatId });
		});
		const job = jobStore.createJob({ kind: "research", chatId: "chat_storeemit", toolCallId: "call-emit" });
		trackJob(job.id);
		assert.deepEqual(got, [{ chatId: "chat_storeemit" }], "createJob announces after the write");
		got.length = 0;

		jobStore.updateJob(job.id, { activity: "still working" });
		assert.deepEqual(got, [{ chatId: "chat_storeemit" }], "updateJob announces on EVERY write — progress lines included");
		got.length = 0;

		jobStore.updateJob("job_missing", { activity: "noop" });
		assert.deepEqual(got, [], "a missing id wrote nothing — silent");

		jobStore.listJobs("chat_storeemit");
		jobStore.getJob(job.id);
		assert.deepEqual(got, [], "reads are silent");

		jobStore.deleteJobsForChat("chat_storeemit");
		assert.deepEqual(got, [{ chatId: "chat_storeemit" }], "a real delete announces");
		got.length = 0;
		jobStore.deleteJobsForChat("chat_storeemit");
		assert.deepEqual(got, [], "a zero-file delete wrote nothing — silent");
		off();
	});
});

// ─── 2. auxiliares de reorientación (puros) ──────────────────────────────────

describe("steer helpers (contracts.ts)", () => {
	const research: ResearchResult = { brief: "BRIEF", sources: [{ title: "s", url: "https://x.test" }] };
	const demo: DemoResult = { title: "T", html: "<html></html>", tested: true, notes: "ok" };
	const visual: VisualResult = { svg: "<svg/>", notes: "ok" };

	it("buildSubagentSteer: a native marker — brief on the model-facing content, artifact payload in details", () => {
		const job = { id: "job_x", kind: "research" as const, toolCallId: "call-x" };
		const steer = buildSubagentSteer(job, research);
		assert.equal(steer.id, "steer_job_x", "deterministic id per job — idempotent delivery");
		// Oleada B: las reorientaciones son LhMarkerMessage personalizados: rol "custom", el
		// modelo lee `content` y la interfaz lee `details` (nunca visible para el modelo).
		assert.equal(steer.role, "custom");
		assert.equal(steer.customType, "subagent-steer");
		assert.equal(steer.display, true);
		assert.ok(steer.content.includes("BRIEF"), "the model-facing text carries the brief");
		const data = steer.details as { jobId: string; kind: string; toolCallId: string; result: ResearchResult };
		assert.equal(data.jobId, "job_x");
		assert.equal(data.kind, "research");
		assert.equal(data.toolCallId, "call-x");
		assert.deepEqual(data.result, research);
	});

	it("accumulateJobUsage: sums per model call; fields NO call reported stay undefined (absent is not zero)", () => {
		let total: JobUsage | undefined = undefined;
		total = accumulateJobUsage(total, "z-ai/glm-5.3-flash", {
			inputTokens: 10,
			outputTokens: 5,
			inputTokenDetails: { cacheReadTokens: 4 },
		});
		assert.deepEqual(total, {
			model: "z-ai/glm-5.3-flash",
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 4,
			cacheWriteTokens: undefined,
			reasoningTokens: undefined,
			cacheWrite1hTokens: undefined,
			calls: [{ inputTokens: 10, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: undefined, cacheWrite1hTokens: undefined, reasoningTokens: undefined }],
			steps: 1,
			lastStep: {
				cacheWrite1hTokens: undefined,
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 4,
				cacheWriteTokens: undefined,
				reasoningTokens: undefined,
			},
		}, "lastStep is the most recent call's accounting, not cumulative");
		// una llamada posterior que no informa de nada nuevo mantiene la suma de los campos informados
		// (lo no informado aporta 0) e incrementa el número de pasos facturados.
		total = accumulateJobUsage(total, "z-ai/glm-5.3-flash", { inputTokens: 20, outputTokens: 0 });
		assert.equal(total.inputTokens, 30);
		assert.equal(total.outputTokens, 5);
		assert.equal(total.cacheReadTokens, 4, "unreported after reported contributes 0");
		assert.equal(total.cacheWriteTokens, undefined, "never reported stays absent — never zero");
		assert.equal(total.reasoningTokens, undefined);
		assert.equal(total.steps, 2, "one step per model call, reported or not");
		assert.equal(total.calls?.length, 2);
		assert.deepEqual(total.lastStep, {
			cacheWrite1hTokens: undefined,
			inputTokens: 20,
			outputTokens: 0,
			cacheReadTokens: undefined,
			cacheWriteTokens: undefined,
			reasoningTokens: undefined,
		}, "lastStep always mirrors the LATEST call, never the sums");
	});

	it("buildAbortSteer: a subagent-abort marker — teacher-facing text on content, the abort payload in details", () => {
		const steer = buildAbortSteer({ id: "job_c", kind: "demo", toolCallId: "call-c" });
		assert.equal(steer.id, "steer_job_c", "same id space — steerDelivered treats either as delivered");
		assert.equal(steer.role, "custom");
		assert.equal(steer.customType, "subagent-abort");
		assert.ok(/aborted/.test(steer.content), "the teacher-facing text names the abort");
		// El customType del marcador es el tipo de mensaje: la interfaz muestra la
		// insignia de aborto a partir de la proyección (demos.test.tsx fija la tarjeta).
		assert.deepEqual(steer.details, { jobId: "job_c", kind: "demo", toolCallId: "call-c", aborted: true });
	});

	it("isSubagentFailure: failure shapes only (empty html/svg, failure brief)", () => {
		assert.equal(isSubagentFailure("research", research), false);
		assert.equal(isSubagentFailure("research", { brief: "Research failed: x", sources: [] }), true);
		// un informe con fuentes es un éxito aunque el texto mencione un fallo
		assert.equal(isSubagentFailure("research", { brief: "Research failed: x", sources: [{ title: "s", url: "https://x" }] }), false);
		assert.equal(isSubagentFailure("demo", demo), false);
		assert.equal(isSubagentFailure("demo", { ...demo, html: "" }), true);
		assert.equal(isSubagentFailure("visual", visual), false);
		assert.equal(isSubagentFailure("visual", { ...visual, svg: "" }), true);
	});

	it("steerDelivered: matches on the deterministic steer id (any steer kind)", () => {
		const steer = buildSubagentSteer({ id: "job_y", kind: "demo", toolCallId: "c" }, demo);
		assert.equal(steer.id, "steer_job_y");
		assert.equal(steerDelivered([], steer.id), false);
		assert.equal(steerDelivered([steer], steer.id), true);
		assert.equal(steerDelivered([steer], "steer_job_z"), false);
		// el traspaso del sondeo comparte el contrato del espacio de ids
		const handoff = buildProbeHandoffSteer("chat_q");
		assert.equal(handoff.id, "steer_probe_chat_q");
		assert.equal(steerDelivered([handoff], handoff.id), true);
		assert.equal(steerDelivered([steer], handoff.id), false);
	});

	it("failure steers tell the teacher how to recover (research/demo/visual wording)", () => {
		const failResearch = buildSubagentSteer({ id: "j1", kind: "research", toolCallId: "c" }, { brief: "Research failed: API down", sources: [] });
		const failDemo = buildSubagentSteer({ id: "j2", kind: "demo", toolCallId: "c" }, { title: "T", html: "", tested: true, notes: "FAILED: boom" });
		const failVisual = buildSubagentSteer({ id: "j3", kind: "visual", toolCallId: "c" }, { svg: "", notes: "FAILED: boom" });
		for (const steer of [failResearch, failDemo, failVisual]) {
			assert.ok(!steer.content.includes("rendered in the lesson"), "failure text never claims the artifact landed");
		}
		assert.ok(failResearch.content.includes("flag the uncertainty"));
	});

	it("pdf steers (sources v0): brief + page citations on success, PDF failed: shape on failure, abort wording per kind", () => {
		const pdf: PdfResult = { path: "/tmp/doc.pdf", question: "q?", brief: "The formula is on p. 2.", pagesRead: [2], pagesConsulted: [1, 2] };
		const ok = buildSubagentSteer({ id: "jp", kind: "pdf", toolCallId: "cp" }, pdf);
		assert.ok(ok.content.includes("page citations"), "the teacher is told to cite pages");
		assert.ok(ok.content.includes("The formula is on p. 2."));
		assert.equal((ok.details as { kind: string }).kind, "pdf");
		assert.deepEqual((ok.details as { result: unknown }).result, pdf);
		// la forma del fallo refleja la de research
		assert.equal(isSubagentFailure("pdf", pdf), false);
		assert.equal(isSubagentFailure("pdf", { ...pdf, brief: "PDF failed: unreadable" }), true);
		const fail = buildSubagentSteer({ id: "jf", kind: "pdf", toolCallId: "cf" }, { ...pdf, brief: "PDF failed: unreadable" });
		assert.ok(fail.content.includes("flag the gap"));
		// la redacción del aborto nombra la tarea de PDF
		const aborted = buildAbortSteer({ id: "ja", kind: "pdf", toolCallId: "ca" });
		assert.ok(aborted.content.includes("PDF reading job"));
	});
});

// ─── entrega falsa (el sustituto del proceso de despertar en las pruebas del ejecutor) ───

/**
 * Una frontera de entrega falsa: captura la reorientación e imita el cambio de estado final
 * del proceso (done/error según isSubagentFailure) para que el registro de la tarea se lea
 * exactamente como se leerá en producción tras completarse el turno de despertar.
 */
function fakeDeliver() {
	const steers: SteerMessage[] = [];
	return {
		steers,
		deliver: async (steer: SteerMessage) => {
			steers.push(steer);
			const job = jobStore.getJob((steer.details as { jobId: string }).jobId)!;
			chatStore.saveMessages(job.chatId, [...chatStore.getChat(job.chatId)!.messages, steer]);
			noteSteersDurable(job.chatId, [steer]);
		},
	};
}

/** Los despertares falsos modelan la aceptación canónica de la entrada, no solo el acuse HTTP. */
function setTurnRunner(run: TurnRunner): void {
	setRawTurnRunner(async (chatId, input) => {
		const status = await run(chatId, input);
		if (status === 200 && input.type === "steers") {
			const record = chatStore.getChat(chatId);
			if (record) chatStore.saveMessages(chatId, [...record.messages, ...input.steers.filter((s) => !steerDelivered(record.messages, s.id))]);
		}
		return status;
	});
}

// ─── 3. despacho: la llamada a la herramienta acusa recibo a mitad de turno y lanza ──

const RESEARCH_INPUT = {
	question: "What is the latest stable sigma.js version?",
	context: "Choosing a graph rendering library for the lesson.",
};

/** Un profesor que llama a research (texto → llamada) y después solo texto plano. */
function researchCallingTeacher(): PiEngine {
	return fauxEngine([
		fauxAssistantMessage(
			[fauxText("Let me check the current state of the library."), fauxToolCall("research", RESEARCH_INPUT, { id: "call-r1" })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxText("Back with the brief.")]),
	]);
}

describe("dispatch (async protocol §2)", () => {
	it("the research call resolves immediately with an ack; the turn continues and the runner steers", async () => {
		const chat = chatStore.createChat("Test: research dispatch");
		trackChat(chat.id);
		// Barrera de turno BYOK (responsable, 2026-09-22): el chat guionizado necesita un
		// modelo de conversación: la fijación por chat, exactamente como el flujo de configuración.
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });

		const delivery = fakeDeliver();
		const search = stubSearch();
		const testRunner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver, searchProvider: () => search });
		const engine = researchCallingTeacher();
		const tools = createTeacherTools({
			chatId: chat.id,
			chatStore,
			jobStore,
			spawn: (job, input) => void testRunner.runJob(job.id, input),
		});
		// El manejador pasa a la fábrica las opciones de construcción nativas: el
		// registro ES el estado del agente (oleada B: sin conversión de adaptador).
		const agent: Parameters<typeof handleChatRequest>[1] = (opts) =>
			createTeacherAgent(undefined, { engine, tools, messages: opts.messages });

		researchModelOverride.current = researcherModel();
		const body = await drainTurn(post(chat.id, { type: "text", text: "teach me graph rendering" }), agent);

		// El MISMO turno del profesor siguió adelante tras la llamada a la herramienta.
		assert.ok(body.includes("Back with the brief."), "the turn continued after the dispatch");

		const saved = projectNative(chatStore.getChat(chat.id)!.messages);
		const part = saved[1]!.parts.find((p) => p.type === "tool-research");
		assert.ok(part && part.type === "tool-research", "research tool part persisted");
		assert.equal(part.state, "output-available", "the part resolved at dispatch time (not held pending)");
		assert.equal(typeof (part as { output?: unknown }).output, "string", "the output is the ack, not the result");
		assert.match(String((part as { output?: unknown }).output), /fire-and-forget/);

		// El registro de la tarea existe y el ejecutor en segundo plano la completó.
		const job = jobStore.findJobByToolCallId(chat.id, "call-r1");
		assert.ok(job, "dispatch created a job record");
		trackJob(job!.id);
		await waitFor(() => jobStore.getJob(job!.id)!.status !== "running", 8000, "research job completion");

		const done = jobStore.getJob(job!.id)!;
		assert.equal(done.status, "done");
		assert.equal(done.activity, "finished");

		// La reorientación lleva el informe en su contenido de cara al modelo; la
		// carga del artefacto viaja en details para el renderizador (de la interfaz).
		assert.equal(delivery.steers.length, 1, "exactly one steer — one job, one result");
		const steer = delivery.steers[0]!;
		assert.equal((steer.details as { jobId: string }).jobId, job!.id);
		assert.ok(steer.content.includes("sigma.js v3 is current"), "steer text carries the brief");

		// Hilo de la búsqueda (2026-09-20): el web_search del investigador se ejecutó en
		// el puerto INYECTADO: el sustituto vio la consulta guionizada, sin red.
		assert.deepEqual(search.queries, ["sigma.js latest version (5)"]);
		researchModelOverride.current = undefined;
	});
});

// ─── el bucle del investigador con un modelo falso + fetch sustituido ───────

const BRIEF = `## Summary
sigma.js v3 is current.

## Findings
1. **v3 is the latest major.** [sigma.js docs](https://www.sigmajs.org/docs)

## Sources
- sigma.js docs (https://www.sigmajs.org/docs)`;

/** El motor guionizado del bucle del investigador. Turno 1: una llamada a la herramienta web_search;
 *  turno 2: el informe de texto final. */
function researcherModel(): PiEngine {
	return fauxEngine([
		fauxAssistantMessage([fauxToolCall("web_search", { query: "sigma.js latest version" }, { id: "ws1" })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText(BRIEF)]),
	]);
}

/** Un proveedor sustituto que graba (oleada del puerto de búsqueda, 2026-09-20): la frontera
 *  de búsqueda inyectada del ejecutor; sin red, con las consultas capturadas para las aserciones. */
function stubSearch(): SearchProvider & { queries: string[] } {
	const queries: string[] = [];
	return {
		id: "tavily",
		async search(query: string, count: number) {
			queries.push(`${query} (${count})`);
			return [{ title: "sigma.js", url: "https://www.sigmajs.org/", snippet: "v3 released" }];
		},
		queries,
	};
}

describe("research runner (async protocol §3)", () => {
	it("runJob completes the job: result + sources on the job, brief on the steer, activity recorded", async () => {
		const chat = chatStore.createChat("Test: runner completion");
		trackChat(chat.id);

		// Una parte de research despachada en el chat almacenado (la entrada es también
		// a lo que recurre el ejecutor en una reaparición de recuperación tras un fallo).
		chatStore.saveMessages(chat.id, nativeToolMessages("which sigma version?", "research", "call-run1", RESEARCH_INPUT));

		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-run1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		const search = stubSearch();
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver, searchProvider: () => search });
		researchModelOverride.current = researcherModel();
		try {
			await runner.runJob(job.id);
		} finally {
			researchModelOverride.current = undefined;
		}

		// La tarea ha terminado, con la línea de actividad de la llamada a la herramienta.
		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "done");
		assert.equal(done.activity, "finished", "delivery does not own the worker status");
		const result = done.result as ResearchResult;
		assert.equal(result.brief, BRIEF);
		assert.ok(result.sources.length > 0, "sources parsed from the brief");
		assert.equal(result.sources[0]!.url, "https://www.sigmajs.org/docs");

				// El rastro de actividad: la última actividad registrada es el cambio de estado
		// de la entrega; la línea de búsqueda se disparó antes. La búsqueda en sí se ejecutó en
		// el puerto INYECTADO: el sustituto vio la consulta (sin red):
		assert.deepEqual(search.queries, ["sigma.js latest version (5)"]);
	});

	it("a keyless fetch-only researcher still completes and delivers a sourced job result", async () => {
		const url = "https://example.com/supplied-source";
		const brief = `## Summary\nVerified supplied source. [Source](${url})\n\n## Sources\n- Source (${url})`;
		const input = { question: `Verify ${url}` };
		const chat = chatStore.createChat("Test: keyless fetch-only research");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("verify supplied URL", "research", "call-keyless", input));
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-keyless" });
		trackJob(job.id);
		const delivery = fakeDeliver();
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver, searchProvider: () => null });
		const fetched: string[] = [];
		safeFetchOverride.current = (async (source) => {
			fetched.push(String(source));
			assert.equal(String(source), url);
			return new Response("Synthetic verified source content", { headers: { "content-type": "text/plain" } });
		}) as typeof fetch;
		researchModelOverride.current = fauxEngine([
			fauxAssistantMessage([fauxToolCall("web_fetch", { url }, { id: "keyless-fetch" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText(brief)]),
		]);
		try {
			await runner.runJob(job.id);
		} finally {
			researchModelOverride.current = undefined;
			safeFetchOverride.current = undefined;
		}
		assert.deepEqual(fetched, [url]);
		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "done");
		assert.equal((done.result as ResearchResult).brief, brief);
		assert.ok((done.result as ResearchResult).sources.some((s) => s.url === url));
		assert.equal(delivery.steers.length, 1);
		assert.equal(isSubagentFailure("research", done.result as ResearchResult), false);
	});

	it("a failing runner still steers (the teacher learns the outcome) and the job lands error", async () => {
		const chat = chatStore.createChat("Test: runner failure");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("hi", "research", "call-err1", RESEARCH_INPUT));

		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-err1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver });
		researchModelOverride.current = fauxEngine([
			() => {
				throw new Error("model exploded");
			},
		]);
		try {
			await runner.runJob(job.id);
		} finally {
			researchModelOverride.current = undefined;
		}

		const errored = jobStore.getJob(job.id)!;
		assert.equal(errored.status, "error");
		assert.match(errored.error ?? "", /model exploded/);

		const steer = delivery.steers[0]!;
		assert.ok(steer, "failure still delivers a steer");
		assert.ok(steer.content.includes("Research failed: model exploded"), "failure brief on the steer text");
		assert.deepEqual(((steer.details as { result: ResearchResult }).result).sources, []);
	});

	it("runJob resolves the input from the transcript when dispatch-time input is absent (crash recovery)", async () => {
		const chat = chatStore.createChat("Test: transcript input fallback");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("go", "research", "call-fb1", RESEARCH_INPUT));
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-fb1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		const runner = createJobRunner({
			chatStore,
			jobStore,
			deliver: delivery.deliver,
			searchProvider: () => stubSearch(),
		});
		researchModelOverride.current = researcherModel();
		try {
			// sin entrada: como la llamaría una reaparición de recuperación
			await runner.runJob(job.id);
		} finally {
			researchModelOverride.current = undefined;
		}

		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "done", "the researcher ran from the transcript-resolved input");
		assert.equal((done.result as ResearchResult).brief, BRIEF);
	});
});

// ─── la construcción del agente investigador (frontera de resolución del modelo) ──


describe("pdf runner (sources v0)", () => {
	const PDF_FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");
	const PDF_INPUT = { path: PDF_FIXTURE, question: "What is the integral of x dx?" };
	const relativePath = path.join("Course notes", "sample document.pdf");
	let home: string;
	let homeAlias: string;
	const originalHome = process.env.HOME;
	const originalUserProfile = process.env.USERPROFILE;

	before(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-pdf-job-home-"));
		const target = path.join(home, relativePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(PDF_FIXTURE, target);
		// Ejercita un alias real aunque el HOME/TMPDIR de la prueba exterior sean
		// canónicos. Los llamadores no tienen por qué canonicalizar antes su entorno.
		homeAlias = `${home}-alias`;
		fs.symlinkSync(home, homeAlias, process.platform === "win32" ? "junction" : "dir");
		process.env.HOME = homeAlias;
		process.env.USERPROFILE = homeAlias;
	});

	after(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;
		fs.unlinkSync(homeAlias);
		fs.rmSync(home, { recursive: true, force: true });
	});

	/** Un lector de PDF que clasifica, extrae las páginas 1-2 y luego informa. */
	function pdfReaderModel(): PiEngine {
		return fauxEngine([
			fauxAssistantMessage([fauxToolCall("pdf_info", {}, { id: "i1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("pdf_extract", { pages: "1-2" }, { id: "e1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("The integral rule appears on page 1 (p. 1): x dx integrates to x^2/2.")]),
		]);
	}

	it("runJob completes a pdf job: brief + pagesConsulted land on the record, citation steer delivered", async () => {
		const chat = chatStore.createChat("Test: pdf runner");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("read this pdf", "pdf", "call-pdf1", PDF_INPUT));

		const job = jobStore.createJob({ kind: "pdf", chatId: chat.id, toolCallId: "call-pdf1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver });
		pdfModelOverride.current = pdfReaderModel();
		try {
			await runner.runJob(job.id);
		} finally {
			pdfModelOverride.current = undefined;
		}

		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "done");
		assert.equal(done.activity, "finished");
		const result = done.result as PdfResult;
		assert.equal(result.path, PDF_FIXTURE);
		assert.match(result.brief, /integral rule/);
		assert.deepEqual(result.pagesRead, [1, 2], "extracted pages are READ pages");
		assert.deepEqual(result.pagesConsulted, [1, 2]);

		assert.equal(delivery.steers.length, 1, "one job, one steer");
		const steer = delivery.steers[0]!;
		assert.equal((steer.details as { kind: string }).kind, "pdf");
		assert.ok(steer.content.includes("integral rule"), "steer text carries the brief");
	});

	for (const mode of ["dispatch", "recovery"] as const) {
		it(`resolves a home-relative PDF through aliased HOME from ${mode} input without rewriting history`, async () => {
			assert.equal(os.homedir(), homeAlias);
			assert.notEqual(homeAlias, fs.realpathSync.native(homeAlias));
			const chat = chatStore.createChat(`Test: relative PDF ${mode}`);
			trackChat(chat.id);
			const toolCallId = `call-pdf-relative-${mode}`;
			const input = { ...PDF_INPUT, path: relativePath };
			const messages = nativeToolMessages("read this pdf", "pdf", toolCallId, input);
			const before = structuredClone(messages);
			chatStore.saveMessages(chat.id, messages);
			const job = jobStore.createJob({ kind: "pdf", chatId: chat.id, toolCallId });
			trackJob(job.id);
			const delivery = fakeDeliver();
			const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver });
			pdfModelOverride.current = pdfReaderModel();
			try {
				await runner.runJob(job.id, mode === "dispatch" ? input : undefined);
			} finally {
				pdfModelOverride.current = undefined;
			}

			// La finalización del worker no es la barrera de entrega: espera a la
			// aceptación canónica antes de comprobar el prefijo del historial y el resultado anexado.
			await waitFor(() => jobStore.getJob(job.id)?.delivery?.status === "delivered", 8000, "canonical PDF delivery acknowledgement");
			const done = jobStore.getJob(job.id)!;
			assert.equal(done.status, "done");
			assert.deepEqual(done.delivery, { kind: "result", status: "delivered" });
			const result = done.result as PdfResult;
			assert.equal(result.path, fs.realpathSync.native(path.join(home, relativePath)));
			assert.match(result.brief, /integral rule/);
			assert.deepEqual(result.pagesRead, [1, 2]);
			assert.deepEqual(result.pagesConsulted, [1, 2]);
			assert.equal(delivery.steers.length, 1);
			assert.equal(input.path, relativePath, "dispatch input remains relative");
			const persisted = chatStore.getChat(chat.id)!.messages;
			assert.deepEqual(persisted.slice(0, before.length), before, "original history and tool-call arguments remain as supplied");
			const steer = delivery.steers[0]!;
			assert.equal(steer.id, `steer_${job.id}`);
			assert.equal(steer.role, "custom");
			assert.equal(steer.customType, "subagent-steer");
			const details = steer.details as { jobId: string; kind: string; toolCallId: string; result: PdfResult };
			assert.equal(details.jobId, job.id);
			assert.equal(details.kind, "pdf");
			assert.equal(details.toolCallId, toolCallId);
			assert.deepEqual(details.result, result, "the canonical steer carries the resolved PDF result");
			assert.deepEqual(persisted.slice(before.length), [steer], "exactly one captured result is appended after the unchanged history");
		});
	}

	it("an unreadable source: the job lands error with the PDF failed: brief and the steer flags the gap", async () => {
		const chat = chatStore.createChat("Test: pdf runner failure");
		trackChat(chat.id);
		const badPath = path.join(import.meta.dirname, "fixtures", "not-a-pdf.txt");
		const job = jobStore.createJob({ kind: "pdf", chatId: chat.id, toolCallId: "call-pdf2" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver });
		pdfModelOverride.current = pdfReaderModel();
		try {
			await runner.runJob(job.id, { path: badPath, question: "anything" });
		} finally {
			pdfModelOverride.current = undefined;
		}

		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "error", "the failure brief is a subagent failure");
		const result = done.result as PdfResult;
		assert.match(result.brief, /^PDF failed:/);
		assert.deepEqual(result.pagesRead, []);
		assert.deepEqual(result.pagesConsulted, []);

		const steer = delivery.steers[0]!;
		assert.ok(steer.content.includes("flag the gap"), "the teacher learns to flag the gap");
	});
});

describe("researcher agent", () => {
	it("runs with the web tool set (no network touched)", () => {
		// El investigador es una llamada a runSubagent sobre el registro webTools:
		// el conjunto de herramientas es lo que ve el bucle.
		assert.ok(webTools.web_search, "web_search available");
		assert.ok(webTools.web_fetch, "web_fetch available");
		assert.equal(Object.keys(webTools).length, 2, "ONLY the web tools — no question/plan tools");
		// restablece cualquier sustitución global accidental
		researchModelOverride.current = undefined;
	});

	it("the pdf-reader declares exactly the four skill tools (sources v0)", async () => {
		const { createPdfTools } = await import("../src/agent/subagents/pdf-reader.ts");
		const tools = createPdfTools(path.join(import.meta.dirname, "fixtures", "sample-3page.pdf"));
		assert.deepEqual(Object.keys(tools).sort(), ["pdf_extract", "pdf_info", "pdf_render", "pdf_search"]);
		// restablece cualquier sustitución global accidental
		pdfModelOverride.current = undefined;
	});
});

// ─── 6. el proceso de despertar (entrega de reorientaciones en el servidor) ───

/**
 * Las pruebas del proceso ejercitan deliverJobResult con un ejecutor de turnos falso inyectado
 * (setTurnRunner): el cableado real (el adaptador handleChatRequest de
 * chat-handler) nunca se dispara aquí, así que no se toca ningún modelo del profesor.
 *
 * Tiempos: la bomba sondea cada 400ms con 1,5 s de margen tras abrirse las barreras;
 * cada prueba de ruta feliz tarda ~2 s; waitFor lo tolera.
 */
describe("wake pipeline (src/server/jobs.ts)", () => {
	/** Un chat con una tarea terminada lista para entregarse. */
	function setup(kind: "research" | "demo" = "research"): { chatId: string; jobId: string; steer: SteerMessage } {
		const chat = chatStore.createChat("Test: wake pipeline");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, [{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never]);

		const job = jobStore.createJob({ kind, chatId: chat.id, toolCallId: `call-${jobStore.listJobs(chat.id).length}` });
		trackJob(job.id);
		const result: ResearchResult = { brief: "Done: it works.", sources: [{ title: "s", url: "https://x.test" }] };
		jobStore.updateJob(job.id, { result, status: "done", activity: "finished", delivery: { kind: "result", status: "pending" } });
		const steer = buildSubagentSteer(job, result);
		return { chatId: chat.id, jobId: job.id, steer };
	}

	it("delivers a PROBE HANDOFF steer the same way — the teacher's wake turn", async () => {
		const chat = chatStore.createChat("Test: probe handoff wake");
		trackChat(chat.id);
		// El sondeo concluido: una llamada probe_done persistida + su resultado (la
		// frontera nativa en la que se basa la rama de construcción de chat-handler) y ninguna
		// pregunta abierta.
		chatStore.saveMessages(chat.id, nativeToolMessages("teach me calc", "probe_done", "call-pd", { ok: true }));
		const handoff = buildProbeHandoffSteer(chat.id);
		let seen: { chatId: string; steers: SteerMessage[] } | undefined;
		setTurnRunner(async (cid, input) => {
			seen = { chatId: cid, steers: (input as SteerInput).steers as SteerMessage[] };
			return 200;
		});

		await deliverJobResult(handoff);
		await waitFor(() => seen !== undefined, 8000, "handoff wake fired");
		const firedHandoff = seen!;
		assert.equal(firedHandoff.chatId, chat.id);
		assert.equal(firedHandoff.steers.length, 1);
		assert.equal(firedHandoff.steers[0]!.id, `steer_probe_${chat.id}`, "the handoff IS the wake turn's input");
	});

	it("a redelivered handoff dedupes via the transcript (idempotent by steer id)", async () => {
		const chat = chatStore.createChat("Test: handoff idempotent");
		trackChat(chat.id);
		const handoff = buildProbeHandoffSteer(chat.id);
		// La transcripción ya lleva la reorientación (un despertar anterior se completó).
		chatStore.saveMessages(chat.id, [handoff as never]);
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		await deliverJobResult(handoff);
		assert.equal(fired, 0, "already delivered — the pump resolves without firing a wake");
	});

	it("delivers: fires the turn runner with the record + steer, then flips the job done", async () => {
		const { chatId, jobId, steer } = setup();
		let seen: { chatId: string; steers: SteerMessage[] } | undefined;
		setTurnRunner(async (cid, input) => {
			seen = { chatId: cid, steers: (input as SteerInput).steers as SteerMessage[] };
			return 200;
		});

		await deliverJobResult(steer);
		await waitFor(() => jobStore.getJob(jobId)!.status !== "running", 8000, "job flip after delivery");

		assert.equal(jobStore.getJob(jobId)!.status, "done");
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "delivered");
		assert.ok(seen, "the turn runner fired");
		assert.equal(seen.chatId, chatId);
		assert.equal(seen.steers.length, 1);
		assert.equal(seen.steers[0]!.id, steer.id, "the steer IS the wake turn's input");
	});

	it("waits while a question part is pending, and fires once it clears", async () => {
		const { chatId, jobId, steer } = setup();
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		// Una llamada de pregunta colgante bloquea el despertar (el modelo rechazaría una
		// llamada a herramienta sin responder; bifurcación 1: el registro termina en la llamada).
		chatStore.saveMessages(chatId, [
			{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "quiz-call", name: "quiz", arguments: { question: "q", choices: ["a", "b"] } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
		]);

		// La promesa de entrega flota mientras el quiz bloquea; esperarla ahora
		// interbloquearía la prueba (la bomba aplaza hasta que se abre la barrera).
		const delivery = deliverJobResult(steer);

		await delay(1200);
		assert.equal(fired, 0, "no wake while the quiz is pending");
		assert.equal(jobStore.getJob(jobId)!.status, "done", "worker is finished while delivery waits");
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "pending");

		// El alumno responde: el resultado de herramienta real despeja la llamada colgante.
		const record = chatStore.getChat(chatId)!;
		chatStore.saveMessages(chatId, [
			...record.messages,
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "quiz-call",
				toolName: "quiz",
				content: [{ type: "text", text: "answered" }],
				details: { answer: "a", correct: true, explanation: "" },
				isError: false,
				timestamp: 1,
			} as never,
		]);

		await waitFor(() => fired > 0, 8000, "wake after the quiz answer");
		await delivery; // ahora se resuelve: la reorientación se entregó
		await waitFor(() => jobStore.getJob(jobId)!.status !== "running", 8000, "job flip after the deferred wake");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});

	for (const pause of ["dismissal", "question recovery"] as const) it(`the ${pause} pause holds deliveries until the user's next turn settles`, async () => {
		const { chatId, jobId, steer } = setup();
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		// Ambas resoluciones despejan la llamada colgante, así que solo la pausa
		// persistida de solo manual retiene el despertar. La recuperación puede interrumpirse tras
		// la persistencia anticipada, pero antes de persistir ninguna salida de sustitución.
		chatStore.saveMessages(chatId, [
			{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "quiz-call", name: "quiz", arguments: { question: "q" } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "quiz-call",
				toolName: "quiz",
				content: [{ type: "text", text: pause === "dismissal" ? "skipped" : "Replacement requested" }],
				details: pause === "dismissal" ? { kind: "quiz", questionText: "q", dontKnow: false, answers: [], dismissed: true, answeredAt: "t" } : { questionRecovery: true },
				isError: pause === "question recovery",
				timestamp: 1,
			} as never,
		]);

		const delivery = deliverJobResult(steer);

		await delay(1200);
		assert.equal(fired, 0, `no wake while the session sits ${pause}-paused`);
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "pending", "the delivery holds (queued, not lost)");

		// El siguiente mensaje del usuario es el despertar: su turno se asienta y el
		// rebombeo del asentamiento coloca la entrega retenida justo después.
		const record = chatStore.getChat(chatId)!;
		const afterUser = [...record.messages, { id: "u2", role: "user", content: "moving on", timestamp: 2 } as never];
		chatStore.saveMessages(chatId, afterUser);
		settleSteers(chatId, afterUser);

		await waitFor(() => fired > 0, 8000, "wake after the pause lifts");
		await delivery;
		await waitFor(() => jobStore.getJob(jobId)!.status !== "running", 8000, "job flip after the held wake");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});

	it("retries with backoff on a 409 (a client turn raced in) and delivers on the retry", async () => {
		const { jobId, steer } = setup();
		let calls = 0;
		setTurnRunner(async () => {
			calls++;
			return calls === 1 ? 409 : 200;
		});

		await deliverJobResult(steer);
		assert.ok(calls >= 2, "409 was retried");
		await waitFor(() => jobStore.getJob(jobId)!.status !== "running", 8000, "job flip after the retry");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});

	it("is idempotent: a steer already in the transcript flips the job without firing a turn", async () => {
		const { chatId, jobId, steer } = setup();
		// Simula la ventana del fallo: el despertar se completó, pero el cambio de estado no.
		const record = chatStore.getChat(chatId)!;
		chatStore.saveMessages(chatId, [...record.messages, steer] as never);

		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		await deliverJobResult(steer);
		assert.equal(fired, 0, "no duplicate wake for an already-delivered steer");
		assert.equal(jobStore.getJob(jobId)!.status, "done", "the job still flips — recovery completes");
	});

// ─── agrupación de continuaciones (el arreglo de la inanición de entregas) ───

describe("Wave C: live steering handoff + settlement reconciliation", () => {
	/** Un sustituto mínimo del Agent de pi: la bomba solo toca steer(). */
	function fakeAgent(): { handed: SteerMessage[]; agent: unknown } {
		const handed: SteerMessage[] = [];
		return { handed, agent: { steer: (m: SteerMessage) => handed.push(m) } };
	}

	it("hands queued markers to the LIVE run (pi steering queue) — no wake fires, the registry waits", async () => {
		const { chatId, jobId, steer } = setup();
		const { handed, agent } = fakeAgent();
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		// Un turno vivo está haciendo streaming (registro de turnos + agente vivo registrado).
		assert.ok(beginTurn(chatId));
		registerLiveAgent(chatId, agent as never);

		const delivery = deliverJobResult(steer); // flota: se resuelve al asentarse
		await waitFor(() => handed.length === 1, 8000, "marker handed to the live agent");
		await delay(1200);
		assert.equal(fired, 0, "no wake while the run is live");
		assert.equal(jobStore.getJob(jobId)!.status, "done", "worker finished before delivery");
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "pending");

		// Asentamiento: la ejecución persistió el marcador inyectado.
		unregisterLiveAgent(chatId);
		settleSteers(chatId, [steer as never]);
		await delivery;
		assert.equal(jobStore.getJob(jobId)!.status, "done", "delivery resolves at settlement");
		assert.equal(fired, 0, "never needed a wake");
		endTurn(chatId);
	});

	it("a handed marker the run never injected (stopper exit / missed poll) strands at settlement — the idle wake delivers it", async () => {
		const { chatId, jobId, steer } = setup();
		const { handed, agent } = fakeAgent();
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		assert.ok(beginTurn(chatId));
		registerLiveAgent(chatId, agent as never);

		const delivery = deliverJobResult(steer);
		await waitFor(() => handed.length === 1, 8000, "handed");
		// La ejecución se asienta SIN el marcador (el detenedor de preguntas salió antes del
		// sondeo de follow-ups): concilia con la verdad persistida.
		unregisterLiveAgent(chatId);
		settleSteers(chatId, []);
		endTurn(chatId);

		// El marcador volvió a pendiente: el despertar en reposo de la bomba lo entrega.
		await delivery;
		assert.equal(fired, 1, "the stranded marker rode the idle wake");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});

	it("a probe-handoff NEVER rides a live run — it waits the turn out and wakes", async () => {
		const chat = chatStore.createChat("Test: handoff never live");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("teach me calc", "probe_done", "call-pd", { ok: true }));
		const handoff = buildProbeHandoffSteer(chat.id);
		const { handed, agent } = fakeAgent();
		const fired: SteerMessage[][] = [];
		setTurnRunner(async (_cid, input) => {
			fired.push((input as SteerInput).steers as SteerMessage[]);
			return 200;
		});

		assert.ok(beginTurn(chat.id));
		registerLiveAgent(chat.id, agent as never);

		const delivery = deliverJobResult(handoff);
		await delay(1200);
		assert.equal(handed.length, 0, "the handoff was NOT handed to the live agent");
		assert.equal(fired.length, 0, "no wake while the prober's turn streams");

		// El turno del sondeador se asienta: ahora el traspaso despierta al PROFESOR.
		unregisterLiveAgent(chat.id);
		settleSteers(chat.id, []);
		endTurn(chat.id);
		await delivery;
		assert.equal(fired.length, 1);
		assert.equal(fired[0]![0]!.id, handoff.id, "the handoff rode the wake");
	});

	it("registerLiveAgent immediately steers pending markers into the NEW run (the parked-behind-quiz path)", async () => {
		const { chatId, jobId, steer } = setup();
		const { handed, agent } = fakeAgent();
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});

		// Una pregunta colgante tiene la bomba aparcada en waitForIdle: el
		// marcador está pendiente, pero no existe ninguna ejecución viva que lo recoja.
		chatStore.saveMessages(chatId, [
			...nativeToolMessages("teach me", "probe_done", "call-q", { ok: true }),
			{
				id: "a-q",
				role: "assistant",
				content: [{ type: "toolCall", id: "quiz-call", name: "quiz", arguments: { question: "q", choices: ["a", "b"] } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
		]);
		const delivery = deliverJobResult(steer);
		await delay(300); // deja que la bomba se aparque tras la pregunta colgante
		assert.equal(handed.length, 0, "nothing to hand to — no live agent");

		// El alumno responde: el manejador registra el agente de la ejecución de la respuesta
		// ANTES de runPiTurn, así que el marcador se reorienta hacia él de forma síncrona:
		// viaja en el sondeo de reorientación del INICIO de la ejecución (la primera llamada al LLM).
		assert.ok(beginTurn(chatId));
		registerLiveAgent(chatId, agent as never);
		assert.equal(handed.length, 1, "registration itself steered the marker in");
		assert.equal(handed[0]!.id, steer.id);

		// La ejecución de la respuesta persistió el marcador: la nueva comprobación del despertar de la
		// bomba aparcada lo resuelve sin llegar a disparar ningún turno.
		unregisterLiveAgent(chatId);
		settleSteers(chatId, [steer as never]);
		endTurn(chatId);
		await delivery;
		assert.equal(fired, 0, "the parked wake never fired — the run delivered");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});

	it("only a durable marker acknowledges delivery, independently of worker completion", () => {
		const { chatId, jobId, steer } = setup();
		assert.equal(jobStore.getJob(jobId)!.status, "done");
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "pending");
		chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, steer]);
		noteSteersDurable(chatId, [steer]);
		noteSteersDurable(chatId, [steer]);
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "delivered");
		assert.equal(jobStore.getJob(jobId)!.activity, "finished");
	});

	it("the idle wake carries EVERY pending marker in ONE turn", async () => {
		const { chatId, steer } = setup();
		const job2 = jobStore.createJob({ kind: "research", chatId, toolCallId: "call-2" });
		trackJob(job2.id);
		const result: ResearchResult = { brief: "Second result.", sources: [] };
		jobStore.updateJob(job2.id, { result });
		const steer2 = buildSubagentSteer(job2, result);

		const fired: SteerMessage[][] = [];
		setTurnRunner(async (_cid, input) => {
			fired.push((input as SteerInput).steers as SteerMessage[]);
			return 200;
		});

		await Promise.all([deliverJobResult(steer), deliverJobResult(steer2)]);
		assert.equal(fired.length, 1, "one wake for the whole queue");
		assert.equal(fired[0]!.length, 2, "both markers ride the same turn");
		const ids = fired[0]!.map((s) => s.id).sort();
		assert.deepEqual(ids, [steer.id, steer2.id].sort());
	});
});


	it("a failed start stays pending without changing the worker outcome", async () => {
		const { chatId, jobId, steer } = setup();
		let attempts = 0;
		setTurnRunner(async () => { attempts++; return 500; });
		const delivery = deliverJobResult(steer);
		await waitFor(() => attempts === 1, 8000, "failed start attempted");
		await delay(1000);
		assert.equal(attempts, 1, "no automatic retry loop");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
		assert.equal(jobStore.getJob(jobId)!.error, undefined);
		assert.equal(jobStore.getJob(jobId)!.delivery?.status, "pending");
		const handed: SteerMessage[] = [];
		assert.ok(beginTurn(chatId));
		registerLiveAgent(chatId, { steer: (m: SteerMessage) => handed.push(m) } as never);
		assert.deepEqual(handed.map((m) => m.id), [steer.id]);
		unregisterLiveAgent(chatId);
		settleSteers(chatId, [steer]);
		endTurn(chatId);
		await delivery;
	});
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── higiene de ids al persistir (el fallo de la clave vacía duplicada) ──────

describe("persistTurn (native history, Wave B)", () => {
	it("stamps EMPTY ids (pi minted no id) at the canonical write and preserves existing ones", () => {
		const chat = chatStore.createChat("Test: persist stamps ids");
		trackChat(chat.id);
		const stamped = persistTurn(chatStore, chat.id, 0, [
			{ id: "", role: "user", content: "wake turn", timestamp: 1 } as never,
			{
				id: "msg_kept",
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: 1,
			} as never,
		], false);
		assert.notEqual(stamped[0]!.id, "", "empty id replaced");
		assert.match(stamped[0]!.id, /^msg_/);
		assert.equal(stamped[1]!.id, "msg_kept", "server-authored id untouched");
		const record = chatStore.getChat(chat.id)!;
		assert.equal(record.messages.length, 2, "both messages persisted");
		assert.ok(record.messages.every((m) => m.id && m.id.length > 0), "no empty ids survive persist");
	});

	it("baseCount slices the turn's own messages (the agent's state is append-only across turns)", () => {
		const chat = chatStore.createChat("Test: persist slices the turn tail");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, [
			{ id: "base_1", role: "user", content: "first", timestamp: 1 } as never,
		]);
		// El estado del agente en onFinish: el registro base + los mensajes nuevos PROPIOS
		// del turno (oleada B: onFinish recibe el historial nativo completo; el
		// troceado mantiene la persistencia de solo anexado).
		const state = [
			{ id: "base_1", role: "user", content: "first", timestamp: 1 } as never,
			{
				id: "",
				role: "assistant",
				content: [{ type: "text", text: "wake turn" }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: 1,
			} as never,
		];
		const stamped = persistTurn(chatStore, chat.id, 1, state, false);
		assert.equal(stamped.length, 1, "only the turn's new tail persists");
		const record = chatStore.getChat(chat.id)!;
		assert.equal(record.messages.length, 2, "the base record is untouched — append-only");
		assert.match(record.messages[1]!.id, /^msg_/);
	});

	it("drops clean question placeholders, keeps errored ones (fork 1: the record ends at the unanswered call)", () => {
		const chat = chatStore.createChat("Test: persist placeholder filtering");
		trackChat(chat.id);
		const stamped = persistTurn(chatStore, chat.id, 0, [
			{
				id: "",
				role: "assistant",
				content: [{ type: "toolCall", id: "q1", name: "quiz", arguments: { question: "q?" } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
			// El resultado sintético "question posed" del bucle: nunca es un hecho.
			{
				id: "",
				role: "toolResult",
				toolCallId: "q1",
				toolName: "quiz",
				content: [{ type: "text", text: "question posed" }],
				details: "question posed",
				isError: false,
				timestamp: 1,
			} as never,
			// Una llamada de autoría con ERROR SÍ se persiste: el contexto de reintento del modelo.
			{
				id: "",
				role: "toolResult",
				toolCallId: "q1",
				toolName: "quiz",
				content: [{ type: "text", text: "bad options" }],
				details: "bad options",
				isError: true,
				timestamp: 1,
			} as never,
		], false);
		assert.equal(stamped.length, 2, "the clean placeholder is filtered, the errored result stays");
		const record = chatStore.getChat(chat.id)!;
		assert.equal(record.messages.length, 2);
		assert.equal((record.messages[1] as { isError: boolean }).isError, true);
	});
});

// ─── higiene de la composición del prompt (la fuga del README) ───────────────

describe("prompt composition", () => {
	it("loads ONLY numeric-prefix fragments — README.md never enters the system prompt", () => {
		const instructions = composeInstructions("teacher");
		assert.ok(!instructions.includes("# Composición de los prompts"), "README content must not leak");
		assert.ok(!instructions.includes("## Editar fragmentos"), "README content must not leak (rules)");
		// todo fragmento numerado SÍ se compone, literal, tras el prompt base
		const base = fs.readFileSync("src/agent/system-prompt.md", "utf-8").trim();
		assert.ok(instructions.startsWith(base), "base prompt first");
		for (const f of fs.readdirSync("src/agent/prompts").filter((f) => /^\d+-[\w.-]+\.md$/.test(f)).sort()) {
			const body = fs.readFileSync(`src/agent/prompts/${f}`, "utf-8").trim();
			assert.ok(instructions.includes(body), `fragment ${f} must compose verbatim`);
		}
	});

	it("the question principles compose into the teacher prompt; the probe's quick-measurement revision landed", () => {
		const teacher = composeInstructions("teacher");
		// el fragmento de doctrina T2a (redacción fijada por el usuario el 2026-09-15): presencia literal
		for (const pin of [
			"Respondible razonando a partir de la sesión",
			"Nunca solo repetir tus palabras",
			"Prefiere problemas que apliquen el conocimiento",
			"Detecta la confusión pronto y haz que se pueda nombrar",
		]) {
			assert.ok(teacher.includes(pin), `teacher prompt lost the principle: ${pin}`);
		}
		// se carga en el orden de los fragmentos: justo después de 20-teaching, antes de 30-jobs
		assert.ok(
			teacher.indexOf("Principios de las preguntas") > teacher.indexOf("# Enseñar: un paso cada vez"),
			"principles sit after the teaching loop",
		);
		// la doctrina del sondeador: desaparece el planteamiento de «sin prisa» y entra la medición rápida
		const prober = composeInstructions("prober");
		assert.ok(!prober.includes("No hay prisa"), "the old no-rush framing is retired");
		assert.ok(
			prober.includes("cada pregunta desperdiciada es resolución que el mapa final no obtiene"),
			"the efficiency-is-resolution directive is in",
		);
		assert.ok(!prober.includes("Principios de las preguntas"), "the teach-phase fragment never composes into the prober");
	});

	it("the predict-check cycle composes into the teacher; the craft chunk reaches BOTH agents (owner 2026-10-03)", () => {
		const teacher = composeInstructions("teacher");
		// la doctrina del ciclo (28-predictions.md): solo del profesor
		assert.ok(teacher.includes("predecir → enseñar → comprobar"), "the cycle line is in");
		assert.ok(teacher.includes('La predicción (`type: "predict"`)'), "the prediction role section is in");
		assert.ok(teacher.includes("Omite la predicción"), "the skip rule is in");
		assert.ok(teacher.includes('La comprobación (`type: "check"`)'), "the check role section is in");
		// los canales de oficio + razonamiento (shared/20-question-tools.md): AMBOS agentes
		const prober = composeInstructions("prober");
		for (const [name, prompt] of [
			["teacher", teacher],
			["prober", prober],
		] as const) {
			assert.ok(prompt.includes("asimetría"), `${name} carries the option craft (moved out of tool descriptions)`);
			assert.ok(prompt.includes("HABLA TRANSCRITA"), `${name} reads dictated thinking leniently`);
			assert.ok(prompt.includes("thinkingWhileReading"), `${name} knows the reading channel`);
		}
		// el ciclo es doctrina de la fase de enseñanza: nunca se compone en el sondeador
		assert.ok(!prober.includes("predecir → enseñar → comprobar"), "the teaching cycle stays out of the prober");
	});

	it("the sources-v0 prompt lines compose: read/pdf doctrine in the teacher, the read line in the prober", () => {
		const teacher = composeInstructions("teacher");
		assert.ok(teacher.includes("Ficheros fuente del alumno"), "the teacher carries the source-files section");
		assert.ok(teacher.includes("informe con citas de página"), "the pdf brief's citation duty is stated");
		const prober = composeInstructions("prober");
		assert.ok(prober.includes("la herramienta `read` puede examinarlo directamente"), "the prober knows it can read learner files");
	});

	it("the sources-v1 shared fragment composes into BOTH agents (find/ls/grep doctrine)", () => {
		for (const kind of ["teacher", "prober"] as const) {
			const instructions = composeInstructions(kind);
			assert.ok(instructions.includes("## Ficheros del alumno"), `${kind} carries the shared learner-files fragment`);
			assert.ok(instructions.includes("búscalo tú con `find`"), `${kind} knows to locate files itself`);
			assert.ok(instructions.includes("directorio personal"), `${kind} knows the home-anchored path rule`);
		}
		// los fragmentos PROPIOS del agente se componen antes del apéndice compartido
		// (la regla de orden de la reordenación, 2026-09-27: primero la tarea y el método)
		const teacher = composeInstructions("teacher");
		assert.ok(
			teacher.indexOf("## Ficheros fuente del alumno") < teacher.indexOf("## Ficheros del alumno"),
			"the teacher's own 40-jobs section precedes the shared learner-files fragment",
		);
	});

	it("guards prompt size — no fragment can silently balloon (the README-leak class)", () => {
		// La fuga de la oleada 1: README.md (815 bytes / ~200 tokens) se colaba en cada
		// turno del profesor hasta que el filtro de prefijo numérico lo paró. Esta guarda
		// detecta el modo de fallo hermano: un volcado accidental pegado en un
		// fragmento. Umbrales: el fragmento real más grande es 40-demos.md, con ~3,2k
		// caracteres; 8k es un margen generoso. Total compuesto ≤ 60k caracteres.
		for (const f of fs.readdirSync("src/agent/prompts").filter((f) => /^\d+-[\w.-]+\.md$/.test(f))) {
			const body = fs.readFileSync(`src/agent/prompts/${f}`, "utf-8").trim();
			assert.ok(body.length <= 8_000, `fragment ${f} is ${body.length} chars — over the 8k guard`);
		}
		assert.ok(composeInstructions("teacher").length <= 60_000, "composed system prompt over the 60k guard");
	});
});

// ─── aborto (semántica de 2026-09: terminación real, estado cancelado, se avisa al profesor) ──

describe("abort (src/server/jobs.ts abortJob)", () => {
	/** Un modelo que se cuelga y cuya llamada nunca se resuelve hasta que se dispara su señal
	 *  de aborto: la ruta de terminación real: se mata la propia llamada en curso. */
	function hangingModel(): PiEngine {
		return fauxEngine([abortableFactory()]);
	}

	/** Un paso (facturado) y luego un cuelgue: demuestra que el uso hasta ese momento sobrevive a la terminación. */
	function oneStepThenHangModel(): PiEngine {
		return fauxEngine([
			fauxAssistantMessage([fauxToolCall("web_search", { query: "anything" }, { id: "ws1" })], {
				stopReason: "toolUse",
			}),
			abortableFactory(),
		]);
	}

	function newChatWithResearchJob(label: string, toolCallId: string): { chatId: string; jobId: string } {
		const chat = chatStore.createChat(`Test: ${label}`);
		trackChat(chat.id);
		// Fixture nativo: el registro es historial del agente (oleada B).
		chatStore.saveMessages(chat.id, [
			{ id: "u1", role: "user", content: "hi", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [
					{ type: "text", text: "Checking." },
					{ type: "toolCall", id: toolCallId, name: "research", arguments: RESEARCH_INPUT as never },
				],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
			{
				id: "r1",
				role: "toolResult",
				toolCallId,
				toolName: "research",
				content: [{ type: "text", text: "Dispatched." }],
				details: "Dispatched.",
				isError: false,
				timestamp: 1,
			} as never,
		]);
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId });
		trackJob(job.id);
		return { chatId: chat.id, jobId: job.id };
	}

	it("kills the running loop: error \"Aborted by learner\" immediately, loop unwinds silently, teacher gets the abort steer", async () => {
		const { jobId } = newChatWithResearchJob("abort running job", "call-abort1");
		const fired: SteerMessage[] = [];
		setTurnRunner(async (_cid, input) => {
			fired.push(...((input as SteerInput).steers as SteerMessage[]));
			return 200;
		});
		researchModelOverride.current = hangingModel();
		const runner = createJobRunner({
			chatStore,
			jobStore,
			deliver: async () => {
				throw new Error("a cancelled job must never deliver a result steer");
			},
		});
		try {
			const settled = runner.runJob(jobId, RESEARCH_INPUT);
			await waitFor(() => jobStore.getJob(jobId)!.activity === "researching", 8000, "loop started");

			const outcome = abortJob(jobId);
			assert.ok(outcome.ok);
			const killed = jobStore.getJob(jobId)!;
			assert.equal(killed.status, "error", "flipped synchronously — the poll sees it at once");
			assert.equal(killed.error, "Aborted by learner", "abort reads as an error with a reason, not a failure");
			assert.equal(killed.activity, "aborted");

			await settled; // se deshace: sin cuelgue
			assert.equal(jobStore.getJob(jobId)!.status, "error", "the runner never overwrites the flip");
			assert.equal(jobStore.getJob(jobId)!.error, "Aborted by learner");
			assert.equal(jobStore.getJob(jobId)!.result, undefined, "no result on an aborted job");

			await waitFor(() => fired.length > 0, 8000, "abort wake fired");
			const last = fired[0]!;
			assert.equal((last.details as { aborted: boolean }).aborted, true);
			assert.equal(last.id, `steer_${jobId}`);
			assert.equal(last.customType, "subagent-abort", "the abort marker — no artifact");
			// abortado es terminal: que el despertar se complete no debe cambiarle el estado
			assert.equal(jobStore.getJob(jobId)!.status, "error", "terminal after the wake");
		} finally {
			researchModelOverride.current = undefined;
		}
	});

	it("the usage folded so far survives the kill (money channel outlives the abort)", async () => {
		const { jobId } = newChatWithResearchJob("abort keeps usage", "call-abort2");
		setTurnRunner(async () => 200);
		researchModelOverride.current = oneStepThenHangModel();
		const runner = createJobRunner({ chatStore, jobStore, deliver: async () => {}, searchProvider: () => stubSearch() });
		try {
			const settled = runner.runJob(jobId, RESEARCH_INPUT);
			await waitFor(() => (jobStore.getJob(jobId)!.usage?.steps ?? 0) === 1, 8000, "first step folded");
			abortJob(jobId);
			await settled;
			const job = jobStore.getJob(jobId)!;
			assert.equal(job.status, "error");
		assert.equal(job.error, "Aborted by learner");
			assert.equal(job.usage!.steps, 1, "usage-so-far persisted by the runner's finally");
			// oleada de ranuras de modelo: el sello es el modelo real del MOTOR,
			// cualificado con el proveedor: aquí, el motor simulado guionizado.
			assert.equal(job.usage!.model, "faux:faux-1");
			// el simulado estima los tokens a partir del texto del prompt/respuesta; el
			// hecho fijado es que el gasto del ÚNICO paso completado sobrevivió.
			assert.ok(job.usage!.inputTokens! > 0, "input tokens billed");
			assert.ok(job.usage!.outputTokens! > 0, "output tokens billed");
		} finally {
			researchModelOverride.current = undefined;
		}
	});

	it("a finished worker with a queued result is no longer abortable", async () => {
		const chat = chatStore.createChat("Test: abort delivering job");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, [{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never]);
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-abort3" });
		trackJob(job.id);
		const result: ResearchResult = { brief: "Done: it works.", sources: [{ title: "s", url: "https://x.test" }] };
		jobStore.updateJob(job.id, { result, status: "done", activity: "finished", delivery: { kind: "result", status: "pending" } });

		// Bloquea las barreras de reposo de la bomba para que la reorientación del resultado quede EN COLA, no en curso.
		assert.ok(beginTurn(chat.id));
		const fired: SteerMessage[] = [];
		setTurnRunner(async (_cid, input) => {
			fired.push(...((input as SteerInput).steers as SteerMessage[]));
			return 200;
		});
		void deliverJobResult(buildSubagentSteer(job, result)).catch(() => {
			/* lo descarta el aborto de abajo */
		});
		assert.equal(jobStore.getJob(job.id)!.delivery?.status, "pending");

		const outcome = abortJob(job.id);
		assert.deepEqual(outcome, { ok: false, reason: "not_running" });
		assert.equal(jobStore.getJob(job.id)!.status, "done");
		assert.equal(jobStore.getJob(job.id)!.error, undefined);

		endTurn(chat.id); // las barreras se abren: se dispara lo que quede en la cola
		await waitFor(() => fired.length > 0, 8000, "wake fired");
		assert.equal(fired.length, 1, "exactly one result delivery");
		assert.equal(fired[0]!.customType, "subagent-steer");
		assert.equal(jobStore.getJob(job.id)!.status, "done");
	});

	it("outcome reasons: not_found for unknown, not_running for settled jobs", () => {
		assert.deepEqual(abortJob("job_does_not_exist"), { ok: false, reason: "not_found" });
		const chat = chatStore.createChat("Test: abort settled job");
		trackChat(chat.id);
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-abort4" });
		trackJob(job.id);
		jobStore.updateJob(job.id, { status: "done", activity: "delivered" });
		assert.deepEqual(abortJob(job.id), { ok: false, reason: "not_running" });
	});
});

// ─── 7. recuperación tras fallos, CON BARRERA DE VIDA (oleada de precisión de la observabilidad, 2026-09-19) ──
//
// El barrido (recoverStaleJobs) se basa en el registro de abortos (isJobLive de
// subagents/aborts.ts), no en la antigüedad del registro: un registro "running" con un registro vivo
// pertenece a un bucle que se ejecuta en ESTE proceso (colgado o lento; nunca se vuelve a ejecutar
// a su lado); sin él, es un huérfano de una muerte del proceso y se recupera
// enseguida. La antigua heurística STALE_JOB_MS de 15 minutos ha desaparecido; estas pruebas demuestran
// la inmediatez ejecutando el barrido sobre registros RECIENTES.

describe("stale-job recovery sweep (liveness-gated)", () => {
	/** Restablece la limitación de 30 s del barrido: las pruebas lo disparan directamente, una y otra vez. */
	function resetSweepThrottle(): void {
		const g = globalThis as { __lhWakePipeline?: { lastSweepAt: number } };
		if (g.__lhWakePipeline) g.__lhWakePipeline.lastSweepAt = 0;
	}

	/** Un registro "running" RECIENTE (sin registro del bucle): la forma del huérfano.
	 *  Lo reciente es la clave: el código antiguo necesitaba 15 minutos de antigüedad. */
	function orphanJob(withResult?: ResearchResult): { chatId: string; jobId: string } {
		const chat = chatStore.createChat("Test: stale sweep");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, [{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never]);
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: `call-sweep-${createdJobs.length}` });
		trackJob(job.id);
		if (withResult) jobStore.updateJob(job.id, { result: withResult, activity: "delivering result" });
		return { chatId: chat.id, jobId: job.id };
	}

	it("a running record with a LIVE loop registration is never recovered — however old (the double-run guard)", () => {
		const { jobId } = orphanJob();
		// Atrasa la fecha del registro mucho más allá de cualquier ejecución en curso plausible: la
		// antigüedad por sí sola ya NO debe disparar la recuperación.
		jobStore.updateJob(jobId, { updatedAt: new Date(Date.now() - 30 * 60_000).toISOString() });
		registerJobAbort(jobId, new AbortController()); // hay un bucle en ejecución
		// JURISDICCIONAL (ronda 8 del responsable, 2026-10-05): el barrido recorre el
		// directorio de tareas COMPARTIDO: con la batería completa, los procesos de OTROS FICHEROS
		// dejan legítimamente registros "running" que este barrido puede hacer reaparecer. Solo
		// la tarea de ESTA prueba es asunto de esta prueba: recoge ids y comprueba que la nuestra
		// nunca reaparece (la versión con contador veía las reapariciones ajenas como fallos).
		const respawnedIds: string[] = [];
		setJobRespawn((id) => {
			respawnedIds.push(id);
		});
		resetSweepThrottle();
		recoverStaleJobs();
		assert.ok(!respawnedIds.includes(jobId), "a live loop is provably executing — no respawn beside it");
		assert.equal(jobStore.getJob(jobId)!.activity, "starting", "the record is untouched");
		// Desmontaje hermético: asienta + quita el registro para que los barridos posteriores de ESTA batería
		// nunca vean este fixture como un huérfano reciente.
		jobStore.updateJob(jobId, { status: "done", activity: "settled (test)" });
		unregisterJobAbort(jobId);
	});

	it("a running record WITHOUT a registration is an orphan: the loop is re-spawned immediately (no age wait)", () => {
		const { jobId } = orphanJob();
		// JURISDICCIONAL (ver arriba): las reapariciones ajenas pueden intercalarse con
		// la batería completa; la nuestra debe estar entre ellas, de inmediato.
		const respawnedIds: string[] = [];
		setJobRespawn((id) => {
			respawnedIds.push(id);
		});
		resetSweepThrottle();
		recoverStaleJobs();
		assert.ok(respawnedIds.includes(jobId), "the orphan's loop is re-spawned at once");
		assert.equal(jobStore.getJob(jobId)!.activity, "recovering: re-running");
		// Desmontaje hermético (ver arriba): el bucle que reaparece es la frontera falsa
		// de la PRUEBA; no se ejecuta nada real.
		jobStore.updateJob(jobId, { status: "done", activity: "settled (test)" });
	});

	it("an orphan WITH a stored result is re-delivered: the wake fires and the job flips done", async () => {
		const { jobId } = orphanJob({ brief: "Done: it works.", sources: [] });
		let fired = 0;
		setTurnRunner(async () => {
			fired++;
			return 200;
		});
		resetSweepThrottle();
		recoverStaleJobs();
		await waitFor(() => fired > 0, 8000, "recovery wake fired");
		await waitFor(() => jobStore.getJob(jobId)!.status !== "running", 8000, "orphan settled after re-delivery");
		assert.equal(jobStore.getJob(jobId)!.status, "done");
	});
});

// ─── BYOK: el rechazo por motor irresoluble (responsable, 2026-09-22) ────────

describe("BYOK job refusal (no factory floor)", () => {
	it("runJob with NO resolvable engine lands the job as error — the envelope wording, no phantom run", async () => {
		const chat = chatStore.createChat("Test: unconfigured spawn");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("hi", "research", "call-nc1", RESEARCH_INPUT));

		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-nc1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		// SIN sustitución de prueba, SIN engineFor: la cadena (sustitución → ranura → suelo)
		// sale vacía; el ejecutor debe rechazar honestamente, no recurrir a una alternativa.
		const runner = createJobRunner({ chatStore, jobStore, deliver: delivery.deliver });
		await runner.runJob(job.id);

		const done = jobStore.getJob(job.id)!;
		// El rechazo llega por la MISMA convención que cualquier otra
		// tarea fallida (arreglo de la revisión BYOK, stream Teacher 2026-09-22): el resultado de
		// fallo del tipo reorienta al profesor (una tarea despachada nunca queda
		// varada esperando un resultado que nunca llegará) y
		// finalizeJob pasa el registro a error tras la entrega.
		assert.equal(done.status, "error", "the job lands error, never a phantom run");
		assert.match(done.error ?? "", /No model configured/);
		assert.match(done.error ?? "", /missing: cheap/);
		assert.equal(delivery.steers.length, 1, "the refusal STEERED — the teacher is not stranded");
		assert.ok(
			delivery.steers[0]!.content.includes("Research failed: No model configured"),
			"the steer carries the kind's failure shape",
		);
		const result = done.result as ResearchResult;
		assert.equal(result.sources.length, 0, "the failure result matches the research convention");
	});
});

// ─── clave del proveedor: el rechazo de tareas por presencia de clave (responsable, 2026-09-25) ──

describe("provider-key job refusal (key-presence interlude)", () => {
	it("an engine whose provider key is gone refuses the spawn — envelope wording, no phantom run", async () => {
		const chat = chatStore.createChat("Test: keyless spawn");
		trackChat(chat.id);
		chatStore.saveMessages(chat.id, nativeToolMessages("hi", "research", "call-km1", RESEARCH_INPUT));

		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-km1" });
		trackJob(job.id);

		const delivery = fakeDeliver();
		// La cadena SE RESUELVE (existe un motor): lo que falta es la CLAVE.
		// La comprobación inyectada es el sustituto de la frontera del servidor: ve el
		// proveedor del motor + el nivel de ranura del tipo, exactamente como está cableado.
		const engine = fauxEngine([]);
		const seen: Array<[string, ModelSlotName]> = [];
		const runner = createJobRunner({
			chatStore,
			jobStore,
			deliver: delivery.deliver,
			engineFor: () => engine,
			providerKeyMissing: (provider, tier) => {
				seen.push([provider, tier]);
				return providerKeyMissing(provider, [tier]);
			},
		});
		await runner.runJob(job.id);

		// El rechazo llega por la MISMA convención que cualquier tarea fallida:
		// registro honesto, forma de fallo del tipo reorientada y cambio a terminal después.
		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "error", "the job lands error, never a phantom run");
		assert.equal(done.error, providerKeyMissing(engine.model.provider, ["cheap"]).error, "the envelope's error line verbatim");
		assert.deepEqual(seen, [[engine.model.provider, "cheap"]], "the check saw the engine's provider + the researcher's tier");
		assert.equal(delivery.steers.length, 1, "the refusal STEERED — the teacher is not stranded");
		assert.ok(
			delivery.steers[0]!.content.includes(`Research failed: No ${engine.model.provider} key is set`),
			"the steer carries the kind's failure shape",
		);
		const result = done.result as ResearchResult;
		assert.equal(result.sources.length, 0, "the failure result matches the research convention");
	});
});

// ─── reorientación desde el compositor (arco del responsable 2026-10-03): el registro de reorientaciones del usuario ──

describe("composer steering: steerLiveChat + the deliver-or-requeue lifecycle", () => {
	/** Un sustituto mínimo del Agent de pi: solo se toca steer(). */
	function fakeAgent(): { handed: unknown[]; agent: unknown } {
		const handed: unknown[] = [];
		return { handed, agent: { steer: (m: unknown) => handed.push(m) } };
	}

	it("no live turn → false, nothing parked (the client falls back to a plain send)", () => {
		const chatId = chatStore.createChat("steer: idle").id;
		const msg = { id: "steer_x1", role: "user", content: "hold on", timestamp: 1 };
		assert.equal(steerLiveChat(chatId, msg as never), false);
		const { handed, agent } = fakeAgent();
		registerLiveAgent(chatId, agent as never); // una ejecución posterior no entrega NADA
		assert.equal(handed.length, 0, "nothing was parked by the refused steer");
		unregisterLiveAgent(chatId);
	});

	it("live agent → steered AND parked (the stranding safety net)", () => {
		const chatId = chatStore.createChat("steer: live").id;
		const msg = { id: "steer_x2", role: "user", content: "also cover Venus", timestamp: 1 };
		const { handed, agent } = fakeAgent();
		registerLiveAgent(chatId, agent as never);
		assert.equal(steerLiveChat(chatId, msg as never), true);
		assert.equal(handed.length, 1, "handed to the live agent's steering queue");
		// Volver a registrar el MISMO agente nunca vuelve a entregar (guarda contra el doble traspaso).
		registerLiveAgent(chatId, agent as never);
		assert.equal(handed.length, 1);
		unregisterLiveAgent(chatId);
	});

	it("settlement reconciliation: delivered ids drop, stranded ones ride the NEXT run", () => {
		const chatId = chatStore.createChat("steer: reconcile").id;
		const delivered = { id: "steer_d1", role: "user", content: "delivered", timestamp: 1 };
		const stranded = { id: "steer_s1", role: "user", content: "stranded behind a question", timestamp: 2 };
		const { handed, agent } = fakeAgent();
		registerLiveAgent(chatId, agent as never);
		assert.equal(steerLiveChat(chatId, delivered as never), true);
		assert.equal(steerLiveChat(chatId, stranded as never), true);

		// Asentamiento: la ejecución persistió SOLO la entregada (la copia varada
		// murió con el agente: terminación por pregunta / aborto).
		unregisterLiveAgent(chatId);
		reconcileUserSteers(chatId, [delivered] as never);

		// La siguiente ejecución del chat (el turno de la respuesta) recoge la reorientación varada.
		const next = fakeAgent();
		registerLiveAgent(chatId, next.agent as never);
		assert.equal(next.handed.length, 1, "exactly the stranded steer rides the next run");
		assert.deepEqual((next.handed[0] as { id: string }).id, "steer_s1");
		unregisterLiveAgent(chatId);
		reconcileUserSteers(chatId, [stranded, delivered] as never); // limpieza
	});
});
