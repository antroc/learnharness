import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { APP_IDENTITY, piEngineFor, type PiEngine } from "../models.ts";
import { usageWasAdmitted } from "../subscription-request-cycle.ts";
import { workerRequestStream } from "../worker-request-admission.ts";
import { providerEventObserver } from "../provider-events.ts";
import { backgroundCaptureStream, createBackgroundCapture } from "../background-capture.ts";
import type { ModelRole } from "../../../config.ts";

/**
 * El ejecutor compartido de subagentes (docs/archive/pi-engine-swap.md §6): un
 * auxiliar sobre el que se ejecutan todos los agentes en segundo plano
 * (researcher, demo-builder, visual-maker, extractor, auditor): un Agent de pi
 * sin estado construido en cada llamada, llevado hasta el final, con las
 * fronteras que necesitan el ejecutor de tareas y el canal del dinero.
 *
 * La semántica de errores refleja la del antiguo ToolLoopAgent.generate: los
 * fallos del proveedor o del bucle se LANZAN (pi los codifica en el flujo;
 * este auxiliar los hace aflorar) y una cancelación lanza un AbortError, para
 * que todos los retornos anticipados existentes con `signal.aborted` sigan
 * funcionando sin cambios.
 */

export interface SubagentRunOptions {
	/** Rol del núcleo con nombre para resolver el motor y para las capturas opcionales. Es
	 * opcional si se aporta un motor explícito; las ejecuciones de plugins no inventan roles del núcleo. */
	role?: ModelRole;
	/** Motor explícito (también la frontera de pruebas sin red); obligatorio si no hay rol. */
	engine?: PiEngine;
	systemPrompt: string;
	/** Transcripción inicial (semántica de continuación: termina en user / toolResult). */
	messages?: AgentMessage[];
	/** Texto del prompt de una ejecución nueva (excluyente con una continuación). */
	prompt?: string;
	/** Máximo de llamadas al modelo (la antigua red de seguridad stepCountIs). */
	maxTurns: number;
	/** Cancela en mitad de una llamada al modelo (la semántica de terminación real). */
	abortSignal?: AbortSignal;
	/** Canal del dinero: una llamada por petición al modelo. */
	onUsage?: (usage: Usage) => void;
	/** Línea de actividad por ejecución de herramienta (progreso del registro de la tarea). */
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Barrera de punto de control nativa y esperada, antes de otros observadores o de ejecutar herramientas. */
	onEvent?: (event: AgentEvent) => void | Promise<void>;
	/** Protección justo antes de cada petición nativa al proveedor. */
	beforeRequest?: () => void | Promise<void>;
	/** Excepción interna del ejecutor: la compactación de la conversación no es trabajo de worker. */
	bypassWorkerRequestAdmission?: boolean;
	/** Por cada mensaje del asistente completado (el registro de pasos de la extracción). */
	onAssistantMessage?: (message: AssistantMessage, step: number) => void;
	/** Regla de parada adicional (extractor: parar tras un submit limpio). */
	shouldStop?: (message: AssistantMessage, toolResults: ToolResultMessage[]) => boolean;
	/** Depuración: si está definido Y LH_PROVIDER_EVENTS=1, los eventos en bruto
	 *  del flujo del proveedor se añaden a data/debug/provider-events/<chatId>.jsonl
	 *  (contexto "job:<role>"). Sin definir o con la variable desactivada → sin
	 *  observador. También identifica el origen en las capturas opcionales de
	 *  LH_BACKGROUND_CAPTURE. */
	chatId?: string;
}

export interface SubagentRunResult {
	/** Los mensajes que añadió esta ejecución (asistente + resultados de herramientas). */
	newMessages: AgentMessage[];
	/** El texto final del asistente (el entregable). */
	text: string;
}

export function subagentEngine(role: ModelRole | undefined, override?: PiEngine): PiEngine {
	// BYOK (responsable, 2026-09-22): sin fijaciones de fábrica; la sustitución es la
	// única ruta real (el ejecutor inyecta motores resueltos desde los ajustes); una
	// inyección que falte llega al lanzador honesto de models.ts en lugar de a una suposición.
	if (override) return override;
	if (!role) throw new Error("An explicit engine or configured model role is required");
	return piEngineFor(role);
}

export async function runSubagent(tools: AgentTool<any, any>[], opts: SubagentRunOptions): Promise<SubagentRunResult> {
	if (opts.abortSignal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
	const engine = subagentEngine(opts.role, opts.engine);
	let turns = 0;
	// Grabador de depuración (responsable, 2026-10-04): eventos en bruto del proveedor por ejecución de tarea.
	const providerEvents = opts.chatId && opts.role ? providerEventObserver(opts.chatId, `job:${opts.role}`) : undefined;
	const sessionId = randomUUID();
	// Las capturas tienen una identidad de rol del núcleo. Los motores explícitos de plugins no
	// tienen ese rol; no se les atribuye mal ni se inventa una nueva superficie de producto de captura.
	const capture = opts.role ? createBackgroundCapture({ role: opts.role, runId: sessionId, sourceId: opts.chatId }) : undefined;
	const agent = new Agent({
		identity: APP_IDENTITY,
		// Una conversación sin guardar por invocación, estable a lo largo de todos los turnos.
		sessionId,
		initialState: {
			systemPrompt: opts.systemPrompt,
			model: engine.model,
			thinkingLevel: engine.level,
			tools,
			messages: opts.messages ?? [],
		},
		streamFn: backgroundCaptureStream(
			opts.bypassWorkerRequestAdmission ? engine.streamFn : workerRequestStream(engine.streamFn),
			capture,
		),
		prepareRequest: async () => {
			if (opts.abortSignal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
			await opts.beforeRequest?.();
		},
		...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		// 0.87.1: shouldStopAfterTurn → finishTurn (mismo punto de llamada; "end" sale
		// antes de consultar la reorientación, exactamente como el antiguo true booleano).
		finishTurn: (turn) => {
			turns++;
			return turns >= opts.maxTurns || opts.shouldStop?.(turn.message, turn.toolResults) === true
				? { action: "end" }
				: undefined;
		},
	});

	const onAbort = () => agent.abort();
	opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

	const before = opts.messages?.length ?? 0;
	let step = 0;
	let errorMessage: string | undefined;
	let aborted = false;
	let runFailure: unknown;

	try {
		agent.subscribe(async (event: AgentEvent) => {
			await opts.onEvent?.(event);
			switch (event.type) {
				case "message_end":
					if ((event.message as { role?: string }).role === "assistant") {
						const m = event.message as AssistantMessage;
						capture?.reply(m);
						if (m.stopReason === "aborted") {
							// La llamada se canceló: ningún paso completado, ningún uso facturado
							// (la ruta de cancelación comprueba que hay cero pasos).
								aborted = true;
							break;
						}
						if (!usageWasAdmitted(m.usage)) { if (m.stopReason === "error") errorMessage = m.errorMessage ?? "Subagent provider error"; break; }
						step++;
						opts.onUsage?.(m.usage);
						opts.onAssistantMessage?.(m, step);
						if (m.stopReason === "error") errorMessage = m.errorMessage ?? "Subagent provider error";
					} else if (event.message.role === "toolResult") {
						capture?.toolResult(event.message);
					}
					break;
				case "tool_execution_start":
					opts.onToolStart?.(event.toolName, event.args);
					break;
			}
		});
		if (opts.prompt !== undefined) await agent.prompt({
			role: "user",
			content: opts.prompt,
			timestamp: Date.now(),
		});
		else await agent.continue();
	} catch (error) {
		runFailure = error;
		throw error;
	} finally {
		opts.abortSignal?.removeEventListener("abort", onAbort);
		capture?.finish(runFailure);
	}

	if (aborted || opts.abortSignal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		capture?.finish(err);
		throw err;
	}
	if (errorMessage !== undefined) throw new Error(errorMessage);

	// 0.87.1: se descarta el SystemMessage inicial sembrado (rehecho de la transcripción;
	// ver settleWith de ui-stream) antes de cortar tras el número de mensajes de entrada, o
	// la semilla desplaza el corte y se cuela el último mensaje de ENTRADA.
	const newMessages = agent.state.messages
		.filter((m) => (m as { role?: string }).role !== "system")
		.slice(before);
	const assistants = newMessages.filter((m) => (m as { role?: string }).role === "assistant") as AssistantMessage[];
	const last = assistants[assistants.length - 1];
	const text = last
		? last.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
		: "";
	return { newMessages, text };
}