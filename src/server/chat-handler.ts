import type { Usage } from "@earendil-works/pi-ai";
import {
	createPracticeAgent,
	createProberAgent,
	createTeacherAgent,
	type AgentBuildOptions,
	type TeachingAgent,
} from "../agent/teacher-agent.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { connectionBackgroundAllowed as subscriptionBackgroundAllowed, connectionScopeCurrent, isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { nativeSubscriptionError } from "../agent/subscription-stream.ts";
import { chatGPTStreamError } from "../agent/chatgpt-stream.ts";
import { SubscriptionRequestCycle, type SubscriptionDispatchLifecycle } from "../agent/subscription-request-cycle.ts";
import { reconstructRequestCause } from "../core/native-messages.ts";
import { createJobRunner } from "../agent/subagents/runner.ts";
import { createExtractionPipeline } from "../agent/subagents/extraction.ts";
import type { ModelRole } from "../../config.ts";
import {
	deliverJobResult,
	noteSteersDurable,
	reconcileUserSteers,
	registerLiveAgent,
	restoreUncommittedAutomatic,
	setJobRespawn,
	setTurnRunner,
	settleSteers,
	steerLiveChat,
	unregisterLiveAgent,
} from "./jobs.ts";
import { runPiTurn } from "./pi/ui-stream.ts";
import { setFileAccessPolicy } from "../agent/tools/file-access.ts";
import { fileAccessPolicy } from "./file-access.ts";
import { collectToolCallIds } from "./pi/call-ids.ts";
import { providerEventNote } from "../agent/provider-events.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { getPluginAgentContributions, getPluginHost } from "./plugins.ts";
import { preparePluginQuestionSubmission, reconcilePluginQuestionCompatibility, type QuestionTypeResolver } from "./plugin-questions.ts";
import { searchAvailable, searchProvider } from "./search.ts";
import { prepareSubmissionImages, prepareSubmissionImageChannels, prepareProblemSubmissionImageChannels, submissionImagePolicyKey } from "./submission-images.ts";
import { preparePluginProblemSubmission, requirePluginProblemTarget, type ProblemTypeResolver } from "./plugin-problems.ts";
import { providerKeyPresent } from "./keys.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import {
	extractionEnabled,
	graphToolsEnabled,
	resolveConversationSpec,
	resolveRoleSpec,
} from "../core/settings-resolution.ts";
import { modelsNotConfigured, providerKeyMissing as providerKeyMissingEnvelope, ROLE_SLOT, type ModelSlotName, type ProviderKeyMissing } from "../core/settings.ts";
import { beginTurn, endTurn, isTurnRunning } from "./turn-liveness.ts";
import { claimPreparingTurn, type TurnPreparation } from "./turn-preparation.ts";
import { applyParkedDismissal } from "./dismissal-park.ts";
import { sideConversationEntries } from "../core/side-chat.ts";
import { sideChats, type SideChatService } from "./side-chat.ts";
import { SIDE_CONTEXT_BUDGET_ERROR, sideBudgetRetryDrops, sideContextWindow } from "./side-context-budget.ts";
import { registerTurn, rememberTurnFailure, unregisterTurn } from "./turn-runs.ts";
import { persistTurn, triggerExtraction, TurnPersistenceError } from "./turn-service.ts";
import { hasProbeDone, hasUnresolvedQuestion, pendingPluginQuestionOf, pluginQuestionCallsOf, questionCallsOf } from "../core/native-messages.ts";
import { samePluginQuestionOccurrence } from "../core/plugin-questions.ts";
import { composeInstructions } from "../agent/teacher-agent.ts";
import { ensureCompacted, kickCompaction, effectiveThresholdTokens, projectedContextTokens, compactionInFlight } from "./compaction.ts";
import { COMPACTION_RESERVE_TOKENS } from "../core/compaction.ts";
import { catalogContextLimits, refreshConnectionCatalog } from "./model-catalog.ts";
import { emit } from "../core/events.ts";
import { settledTurnResponse } from "./turn-runs.ts";
import { asAgentMessages, type LhMessage } from "../core/native-messages.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";
import {
	ChatInputError,
	assertPluginQuestionInputAllowed,
	assertNativeSubmissionTarget,
	inputAppends,
	parseChatInput,
	questionRecoveryAppends,
	retryDrops,
	type TurnInput,
} from "../core/input-events.ts";
import { steerDelivered } from "../core/contracts.ts";
import type {CallUsage} from "../core/contracts.ts";

/**
 * Un turno de chat sobre el registro nativo que controla el servidor. Sin
 * framework (Request/Response a secas) para que las pruebas puedan dirigirlo
 * directamente con un motor simulado con guion; el route handler de Next en
 * app/api/chat es un envoltorio de una línea.
 *
 * EL CONTRATO DE EVENTOS DE ENTRADA (oleada B, decisión del responsable
 * 2026-09-26): POST /api/chat lleva {chatId, input}, un único evento explícito
 * (texto / respuesta / veredicto / continuar), nunca una transcripción del
 * cliente. El servidor es el dueño del registro; este módulo es la RAÍZ DE
 * COMPOSICIÓN DEL TURNO: convierte el evento en añadidos nativos al registro
 * (core/input-events.ts), construye el agente a partir del registro (el
 * registro ES el estado del agente: state.messages = record.messages,
 * continue()) y ejecuta el turno como un objeto en segundo plano
 * (pi/ui-stream.ts). Las reorientaciones del proceso de despertar viajan por la
 * misma composición (el tipo steer de TurnInput).
 *
 * LA MISMA COMPOSICIÓN sirve a los dos puntos de entrada: las peticiones del
 * cliente y las reorientaciones del proceso de despertar en el servidor
 * (src/server/jobs.ts); una sola ruta de código para la persistencia
 * anticipada, la vida del turno y los servicios del turno.
 */

/** Comprobación nueva solo al admitir una nueva ejecución en segundo plano; nunca
 * se cancela una ejecución ya en curso si se desactiva la opción. */
function connectionBackgroundAllowed(provider: string): boolean {
	return subscriptionBackgroundAllowed(provider) && (provider !== CLAUDE_CODE_PROVIDER || providerKeyPresent(provider));
}

function settlementErrorText(error: unknown): string {
	return error instanceof TurnPersistenceError ? error.message : "An error occurred.";
}

const jobRunner = createJobRunner({
	chatStore: stores.chatStore,
	jobStore: stores.jobStore,
	deliver: deliverJobResult,
	// BYOK (responsable, 2026-09-22): los motores de las tareas resuelven la cadena
	// (sustitución del rol → ranura → NADA), leída DE NUEVO en cada tarea (un PUT de
	// ajustes entre el despacho y el lanzamiento se aplica); una cadena vacía llega
	// como undefined y el ejecutor rechaza el lanzamiento con honestidad.
	engineFor: (role) =>
		resolveEngine(role),
	// Barrera de presencia de clave (interludio de claves de proveedor, 2026-09-25): el
	// ejecutor lee el proveedor del motor resuelto y consulta ESTA comprobación (la capa
	// del agente no puede leer el almacén de claves); si falta la clave, el lanzamiento
	// se rechaza con la familia de sobres 503 en lugar de morir a mitad de ejecución.
	providerKeyMissing: (provider, tier) =>
		providerKeyPresent(provider) ? null : providerKeyMissingEnvelope(provider, [tier]),
	// Oleada del puerto de búsqueda (2026-09-20): el web_search del researcher funciona
	// sobre el puerto inyectado, resuelto DE NUEVO en cada tarea (las rotaciones de claves
	// se aplican al momento). null = no disponible, dicho con honestidad; la retirada en el
	// despacho (más abajo) usa la misma señal, así que los servidores sin clave ni ven la herramienta research.
	searchProvider,
});
/** La ÚNICA instancia del proceso de extracción de la app; la comparten las dos
 *  puertas de entrada: las ejecuciones de sesión disparadas por un quiz
 *  (turn-service) y las importaciones de notas (/api/graph/import) llegan al
 *  mismo registro de vuelo único. */
export const extraction = createExtractionPipeline({
	...stores,
	// BYOK (responsable, 2026-09-22): las etapas de extracción resuelven la cadena
	// (sustitución del rol → ranura → NADA), leída DE NUEVO en cada llamada a una etapa;
	// una cadena vacía llega como undefined y el proceso rechaza la ejecución con el
	// ModelsNotConfiguredError tipado. Los valores directos de las pruebas siguen ganando.
	engineFor: (role) =>
		resolveEngine(role),
	// Barrera de presencia de clave (interludio de claves de proveedor, 2026-09-25): la
	// misma comprobación que recibe el ejecutor de tareas; un motor de etapa sin clave de
	// proveedor se rechaza ANTES de que se ejecute ningún lote (el error tipado), nunca a mitad.
	providerKeyMissing: (provider, tier) =>
		providerKeyPresent(provider) ? null : providerKeyMissingEnvelope(provider, [tier]),
});


// Cableado del proceso de despertar (contracts.ts, "THE ASYNC PROTOCOL" §4): el proceso
// entrega sus reorientaciones a través de ESTA raíz de composición (un evento: el marcador
// de reorientación, añadido de forma nativa bajo la reclamación del turno), y la
// recuperación tras un fallo vuelve a lanzar los bucles de subagente huérfanos con ESTE ejecutor.
setTurnRunner(async (chatId, input) => {
	const res = await handleChatInput(chatId, input);
	// Se lleva el flujo hasta el final en el servidor: nadie más lo va a leer, y
	// onFinish (persistir, extracción, endTurn) solo se ejecuta cuando se vacía.
	await res.arrayBuffer().catch(() => undefined);
	return res.status;
});
/** El motor resuelto desde los ajustes para un rol. BYOK (responsable,
 *  2026-09-22): la cadena (sustitución del rol → ranura → NADA) puede acabar
 *  vacía, y undefined llega a las barreras de rechazo por necesidad
 *  (runner/extraction); se lee DE NUEVO para que se aplique un PUT de ajustes
 *  entre el despacho y el lanzamiento. */
function resolveEngine(role: ModelRole): PiEngine | undefined {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	return spec ? piEngineForSpec(spec, true, undefined, retentionForSlot(ROLE_SLOT[role])) : undefined;
}

/** La política de ranuras es independiente de las sustituciones de modelo. Se lee de nuevo en
 * cada operación, incluidas las conversaciones aparcadas, los bucles en segundo plano y la compactación. */
function retentionForSlot(slot: ModelSlotName) {
	return () => stores.settingsStore.readSettings()?.models?.[slot]?.cacheRetention;
}

setJobRespawn((jobId) => void jobRunner.runJob(jobId));
// La política del sistema de ficheros del alumno (oleada de acceso a ficheros): todos los
// registros de herramientas se construyen en esta raíz de composición, así que la frontera se
// instala aquí; las herramientas la leen de nuevo en cada llamada (carpetas permitidas + rutas privadas de la app).
setFileAccessPolicy(fileAccessPolicy);

/** La entrada de cara a la ruta: analiza {chatId, input} y ejecuta un turno. */
export async function handleChatRequest(
	req: Request,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
	sideContext: Pick<SideChatService, "snapshot"> = sideChats,
): Promise<Response> {
	let body: { chatId?: unknown; input?: unknown };
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const chatId = typeof body.chatId === "string" ? body.chatId : "";
	if (!chatId) return Response.json({ error: "Unknown chat" }, { status: 404 });
	let input: TurnInput;
	try {
		input = parseChatInput(body.input);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	return handleChatInput(chatId, input, buildAgent, sideContext);
}

/**
 * La composición del turno: un evento de entrada → añadidos nativos al
 * registro → un turno del agente como objeto en segundo plano. También es la
 * entrada del proceso de despertar (el tipo steer de TurnInput añade el
 * marcador bajo la misma reclamación).
 */
export async function handleChatInput(
	chatId: string,
	input: TurnInput,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
	sideContext: Pick<SideChatService, "snapshot"> = sideChats,
): Promise<Response> {
	await reconcilePluginQuestionCompatibility(stores.chatStore, chatId);
	const initialRecord = stores.chatStore.getChat(chatId);
	if (!initialRecord) {
		return Response.json({ error: "Unknown chat" }, { status: 404 });
	}
	let record = initialRecord;

	const capturedSession = { createdAt: record.createdAt, kind: record.kind };
	const freshSubmission = input.type === "text" || input.type === "thinking" || input.type === "answer" || input.type === "plugin-question-answer" || input.type === "plugin-problem-submission";
	try {
		assertPluginQuestionInputAllowed(record.messages, input);
		if (input.type !== "steers") assertNativeSubmissionTarget(record.messages, input);
		if (input.type === "plugin-problem-submission") requirePluginProblemTarget(record, input);
		if (input.type === "plugin-question-answer") {
			const pending = pendingPluginQuestionOf(record.messages);
			if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence))
				throw new ChatInputError("This question is no longer pending. Sync the saved session before trying again.");
		}
	}
	catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	if ((input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") && isTurnRunning(chatId))
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	let questionResolver: QuestionTypeResolver | undefined;
	let problemResolver: ProblemTypeResolver | undefined;
	if (input.type === "plugin-problem-submission") {
		try {
			const host = await getPluginHost();
			problemResolver = (pluginId, typeId, version) => host.resolveProblemType(pluginId, typeId, version);
		} catch { return Response.json({ error: "Problem unavailable" }, { status: 400 }); }
	}
	if (input.type === "plugin-question-answer") {
		try {
			const host = await getPluginHost();
			questionResolver = (pluginId, typeId, version) => host.resolveQuestionType(pluginId, typeId, version);
		} catch { return Response.json({ error: "Question unavailable" }, { status: 400 }); }
	}

	// Se rechaza un Retry no admisible antes de refrescar el catálogo, compactar o
	// producir efectos de turno/escritura. Se vuelve a validar tras las barreras esperadas de más abajo.
	if (input.type === "retry") {
		try {
			retryDrops(record.messages);
		} catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	if (input.type === "retry-question") {
		try { questionRecoveryAppends(record.messages, input); }
		catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	// LA BARRERA UNIVERSAL DEL TURNO (BYOK, responsable, 2026-09-22): un turno necesita
	// la cadena de CONVERSACIÓN (la sustitución de modelo del propio chat por encima de la
	// ranura potente) y no hay suelo de fábrica; si ambas están vacías, el turno se
	// rechaza con honestidad con el sobre 503 legible por máquina (igual en sesiones nuevas
	// que en las que continúan; los turnos del proceso de despertar van por esta misma ruta).
	// La ubicación es deliberada: ANTES de beginTurn (sin efectos sobre la vida del turno),
	// de la persistencia anticipada (no cambia nada duradero) y de toda resolución posterior
	// (las tareas y la extracción aplican su barrera por necesidad, según su propio nivel).
	const effective = effectiveSettings();
	const conversation = resolveConversationSpec(record.settings, effective.models.strong);
	if (!conversation) {
		const envelope = modelsNotConfigured(["strong"]);
		console.info(`[chat ${chatId}] turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}

	// LA BARRERA DE PRESENCIA DE CLAVE (interludio de claves de proveedor, responsable,
	// 2026-09-25): no basta con un modelo fijado; la clave de su PROVEEDOR debe estar
	// presente o el turno muere a mitad del flujo, enmascarado como un error genérico. La
	// verdad es primero el entorno (providerKeyPresent lee lo que pi-ai leería al hacer la
	// petición), así que una clave tapada por el entorno pasa. La misma disciplina de
	// ubicación que la barrera de modelos: ANTES de beginTurn (sin efectos sobre la vida del
	// turno) y de la persistencia anticipada (no cambia nada duradero); los turnos del proceso
	// de despertar van por la misma ruta. El nivel afectado es el potente, el propio de la
	// cadena de conversación (una sustitución chat.model también se resuelve a través de él).
	if (isSubscriptionProvider(conversation.provider)) {
		await refreshConnectionCatalog(conversation.provider);
		if (input.type === "steers" && !connectionBackgroundAllowed(conversation.provider)) {
			return Response.json({ error: "Background use is off for this connection. Automatic follow-up remains deferred in its queue." }, { status: 403 });
		}
	}
	if (!providerKeyPresent(conversation.provider)) {
		const envelope = providerKeyMissingEnvelope(conversation.provider, ["strong"]);
		console.info(`[chat ${chatId}] turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}

	// LA BARRERA DE COMPACTACIÓN (ronda 14 del responsable, 2026-10-05; la decisión
	// estructural: NADA de cara al modelo para este chat se intercala con una
	// compactación en curso): se espera a cualquier compactación en marcha (el impulso
	// al asentarse suele haber terminado durante la pausa de respuesta del alumno) y, si
	// el registro SIGUE por encima del umbral, se compacta de forma síncrona: esta
	// petición espera. Se omite en las pruebas (el precedente de la extracción); la
	// ubicación refleja la de las barreras BYOK/de claves (ANTES de los añadidos y de
	// beginTurn, sin efectos sobre la vida del turno) y el registro se vuelve a leer
	// después porque la compactación añade el marcador.
	const callPurpose = { background: input.type === "steers" || (input.type === "continue" && reconstructRequestCause(record.messages) !== "foreground") };
	let requestCycle: SubscriptionRequestCycle | undefined;
	const tentativeSideIds = new Set<string>();
	const admittedSideIds = new Set<string>();
	let preparedSideIds = new Set<string>();
	const admitSideContext = () => { for (const id of preparedSideIds) admittedSideIds.add(id); };
	const lifecycle: SubscriptionDispatchLifecycle = {
		captured: (scope) => requestCycle?.captured(scope),
		beforeDispatch: (scope) => { requestCycle?.beforeDispatch(scope); admitSideContext(); },
		noDispatch: (kind) => requestCycle?.noDispatch(kind),
	};
	let conversationEngine: PiEngine;
	let compactionEngine: PiEngine;
	try {
		conversationEngine = piEngineForSpec(conversation, () => callPurpose.background, lifecycle, retentionForSlot("strong"));
		compactionEngine = piEngineForSpec(conversation, true, undefined, retentionForSlot("strong"));
	}
	catch { return Response.json({ error: conversation.provider === "chatgpt" ? chatGPTStreamError("model catalog") : isSubscriptionProvider(conversation.provider) ? nativeSubscriptionError(conversation.provider, "model catalog") : "The selected model is unavailable." }, { status: 503 }); }
	const capturedPolicy = submissionImagePolicyKey(conversationEngine);
	const capturedConversation = JSON.stringify(conversation);
	try {
		switch (input.type) {
			case "text": case "thinking":
				input = { ...input, images: await prepareSubmissionImages(input.images, conversationEngine) };
				break;
			case "answer":
				input = { ...input, answer: { ...input.answer, images: await prepareSubmissionImageChannels(input.answer.images, conversationEngine) } };
				break;
			case "plugin-problem-submission":
				input = { ...input, images: await prepareProblemSubmissionImageChannels(input.images, conversationEngine) };
				break;
			case "plugin-question-answer":
				input = { ...input, images: await prepareSubmissionImageChannels(input.images, conversationEngine) };
				break;
		}
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const modelIdForCompaction = `${conversationEngine.model.provider}:${conversationEngine.model.id}`;
	const contextWindow = catalogContextLimits().get(modelIdForCompaction);
	const thresholdTokens = effectiveThresholdTokens(effective.compaction?.thresholdTokens, contextWindow);
	const systemPromptTokens = Math.ceil(composeInstructions(record.kind === "practice" ? "practice" : "teacher").length / 4);
	const estimateModel = effective.compaction.includeReasoning ? conversationEngine.model : undefined;
	const fitsSideContext = (messages: readonly LhMessage[]) => {
		const live = messages.filter((message) => (message as { role: string }).role !== "system");
		// La admisión estricta no es el disparador de la compactación. La capacidad de la CLI
		// sale del último informe de sesión coincidente de esta petición, nunca de valores provisionales del catálogo.
		// Se vuelve a resolver en cada barrera: nuevas respuestas o compactaciones pueden invalidarla.
		// El prefijo transitorio del SDK en Retry omite TODOS los fallos de la cola. El historial
		// guardado se mantiene en la vista solo de metadatos, para que la omisión no reviva un
		// informe invalidado por un fallo genuino del proveedor. Las respuestas en vivo nuevas ganan.
		const saved = conversation.provider === CLAUDE_CODE_PROVIDER ? stores.chatStore.getChat(chatId)?.messages ?? [] : [];
		const savedIds = new Set(saved.map((message) => message.id));
		const reportHistory = saved.length ? [...saved, ...live.filter((message) => !savedIds.has(message.id))] : live;
		const window = sideContextWindow(reportHistory, conversationEngine.model, contextWindow, input.type === "retry");
		const budget = window === undefined ? thresholdTokens : Math.max(1, window - Math.min(COMPACTION_RESERVE_TOKENS, conversationEngine.model.maxTokens));
		return projectedContextTokens(live, systemPromptTokens, estimateModel) <= budget;
	};
	const sideBudgetError = () => new Error(SIDE_CONTEXT_BUDGET_ERROR);
	const beforeCompaction = record.messages;
	await ensureCompacted(
		{
			chatStore: stores.chatStore,
			engine: compactionEngine,
			canStart: () => !isTurnRunning(chatId) && connectionBackgroundAllowed(conversation.provider),
			modelId: modelIdForCompaction,
			kind: record.kind === "practice" ? "practice" : hasProbeDone(record.messages) ? "teach" : "probe",
			includeReasoning: effective.compaction.includeReasoning,
			thresholdTokens,
			systemPromptTokens,
			projectMessages: (current) => {
				try {
					if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") {
						// El resultado procesado aún no existe. Solo se cuenta el historial guardado
						// + la carga lateral en bruto, nunca un resultado supuesto ni un callback
						// temprano de un plugin. La petición exacta ensamblada se comprueba más tarde.
						if (input.type === "plugin-question-answer") {
							const pending = pendingPluginQuestionOf(current.messages);
							if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence)) return current.messages;
							if (questionCallsOf(current.messages).length || pluginQuestionCallsOf(current.messages).some(call =>
								(call.status === "answerable" || call.status === "unreadable") && !samePluginQuestionOccurrence(call.occurrence, pending.occurrence))) return current.messages;
						} else {
							requirePluginProblemTarget(current, input);
							if (hasUnresolvedQuestion(current.messages)) return current.messages;
						}
						const updates = sideConversationEntries({ messages: current.messages, sideChats: sideContext.snapshot(chatId) });
						return updates.length ? [...current.messages, ...updates] : current.messages;
					}
					const next = input.type === "steers" ? input.steers.filter((entry) => !steerDelivered(current.messages, entry.id)) : inputAppends(current, input);
					const after = [...current.messages, ...next];
					if (hasUnresolvedQuestion(after)) return current.messages;
					const updates = sideConversationEntries({ messages: current.messages, sideChats: sideContext.snapshot(chatId) }, after);
					if (!updates.length) return current.messages;
					const projected = [...current.messages, ...(input.type === "answer" || input.type === "retry-question" ? [...next, ...updates] : [...updates, ...next])];
					const omitted = input.type === "retry" ? retryDrops(current.messages) : new Set<string>();
					return projected.filter((message) => !omitted.has(message.id));
				} catch (error) {
					if (error instanceof ChatInputError) return current.messages; // la validación normal de la entrada va después de la barrera
					throw error;
				}
			},
		},
		chatId,
	);
	let pluginContributions: AgentBuildOptions["pluginContributions"];
	if (!buildAgent) {
		try { pluginContributions = await getPluginAgentContributions(); }
		catch (error) {
			// Los fallos de arranque de los plugins no deben dejar inutilizable la lección nativa.
			console.error("[plugins] Agent contributions unavailable:", error);
		}
	}
	const compactedRecord = stores.chatStore.getChat(chatId);
	if (!compactedRecord) return Response.json({ error: "Unknown chat" }, { status: 404 });
	record = compactedRecord;
	// Frontera final de admisión: todas las esperas de imagen/comprobación previa han
	// terminado. Se resuelve con la MISMA cadena de conversación, nunca con un catálogo de roles
	// paralelo. Ninguna espera puede interponerse antes de la escritura solo-guardado o de beginTurn/escritura de abajo.
	const staleSubmission = () => Response.json({ code: "submission-stale", error: "The submission target or selected model changed. Your input has been kept." }, { status: 412 });
	const submissionIsCurrent = (checkModel = true) => {
		if (!freshSubmission) return true;
		if (record.createdAt !== capturedSession.createdAt || record.kind !== capturedSession.kind) return false;
		try {
			if (checkModel) {
				const spec = resolveConversationSpec(record.settings, effectiveSettings().models.strong);
				if (!spec || JSON.stringify(spec) !== capturedConversation) return false;
				const checked = piEngineForSpec(spec, () => callPurpose.background, lifecycle, retentionForSlot("strong"));
				if (submissionImagePolicyKey(checked) !== capturedPolicy || checked.level !== conversationEngine.level) return false;
			}
			assertPluginQuestionInputAllowed(record.messages, input);
			if (input.type !== "steers") assertNativeSubmissionTarget(record.messages, input);
			if (input.type === "plugin-problem-submission") requirePluginProblemTarget(record, input);
			if (input.type === "plugin-question-answer") {
				const pending = pendingPluginQuestionOf(record.messages);
				if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence)) return false;
			}
		} catch { return false; }
		return true;
	};
	if (!submissionIsCurrent()) return staleSubmission();
	// Se recalcula si Retry es admisible con la verdad actual, aún antes de beginTurn.
	// Durante las esperas puede haber llegado un marcador de compactación u otro escritor.
	// Estas omisiones afectan SOLO al contexto del agente, nunca al registro guardado.
	let retryOmissions = new Set<string>();
	if (input.type === "retry") {
		try {
			retryOmissions = sideBudgetRetryDrops(beforeCompaction, record.messages) ?? retryDrops(record.messages);
		} catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	// Los añadidos nativos de la entrada (puros; el 400 honesto para una respuesta sin
	// llamada de pregunta pendiente). Se calculan ANTES de beginTurn para que una entrada
	// rechazada no deje efectos sobre la vida del turno; se leen contra el registro ACTUAL.
	// Oleada C: el despertar en reposo lleva TODOS los marcadores en cola (steerDelivered filtra
	// un nuevo disparo de uno ya aterrizado); sin claimSteers, esta entrada de despertar es la
	// única que añade reorientaciones; la entrega durante la ejecución va por la propia cola
	// de seguimiento de pi y nunca construye un evento de entrada.
	let preparation: TurnPreparation | undefined;
	let turnClaimed = false;
	let handedOff = false;
	let inputSaved = false;
	const releaseOwnership = () => {
		if (preparation) preparation.finish();
		else { endTurn(chatId); unregisterTurn(chatId); }
	};
	// Toda la región controlada incluye la calificación, la persistencia y la construcción.
	// Cada salida previa al traspaso cierra las vistas en espera y libera su propia reclamación.
	try {
	let appends;
	try {
		assertPluginQuestionInputAllowed(record.messages, input);
		// Una comprobación previa concurrente puede iniciar una compactación durante la
		// espera de la contribución de arriba. Ninguna espera separa esta comprobación
		// estructural de la toma de control ni de la rama hermana solo-guardado de abajo.
		if (compactionInFlight(chatId))
			return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
		if ((input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") && isTurnRunning(chatId))
			return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
		if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") {
			const questionSubmission = input.type === "plugin-question-answer" ? preparePluginQuestionSubmission({ id: chatId, messages: record.messages }, input, questionResolver!) : undefined;
			const problemSubmission = input.type === "plugin-problem-submission" ? preparePluginProblemSubmission(record, input, problemResolver!) : undefined;
			const submission = questionSubmission ?? problemSubmission!;
			const work = questionSubmission?.grade ?? problemSubmission?.process;
			if (work) {
				const claim = claimPreparingTurn(chatId);
				if (!claim) return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
				preparation = claim;
				turnClaimed = true;
				const outcome = await work(preparation.signal);
				// No se puede escribir ningún historial capturado tras el procesamiento asíncrono de los plugins.
				const current = stores.chatStore.getChat(chatId);
				if (!current || !preparation.isCurrent()) return staleSubmission();
				record = current;
				// La admisión fija el modelo/proveedor de este envío. Los cambios posteriores en el
				// selector se aplican a la siguiente petición, no a este trabajo ya aceptado.
				if (!submissionIsCurrent(false)) return staleSubmission();
				preparation.signal.throwIfAborted();
				appends = submission.finish({ id: chatId, kind: record.kind, messages: record.messages }, outcome);
			} else appends = submission.finish({ id: chatId, kind: record.kind, messages: record.messages });
		} else appends = input.type === "steers"
			? input.steers.filter((s) => !steerDelivered(record.messages, s.id))
			: inputAppends(record, input);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}

	// LA BARRERA DE PREGUNTAS PARALELAS (responsable, 2026-10-03; el incidente del lote
	// paralelo de deepseek): una respuesta que deja colgada una pregunta HERMANA aplaza su
	// despertar. El dock pasa a la siguiente pregunta (el resultado optimista del cliente +
	// record-changed llevan la vista); la ÚLTIMA respuesta dispara el único turno de reacción
	// con todos los resultados CONTIGUOS al mensaje del asistente que hizo la llamada: la ley
	// de forma del proveedor (un resultado de herramienta añadido tras un mensaje del
	// asistente intermedio se rechaza, lo que antes de la corrección dejaba varada para
	// siempre la pregunta hermana). Nada más puede generar mientras cuelga una pregunta (los
	// despertares de tareas esperan, los plegados de continuación se rechazan, el compositor
	// tiene barrera), así que la contigüidad se cumple por construcción.
	if ((input.type === "answer" || input.type === "plugin-question-answer") && hasUnresolvedQuestion([...record.messages, ...appends])) {
		const merged = [...record.messages, ...appends];
		try { stores.chatStore.saveMessages(chatId, merged); inputSaved = true; }
		catch (err) {
			console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
			return new Response("Your input could not be saved. Please try again.", { status: 500 });
		}
		emit("record-changed", { chatId });
		return settledTurnResponse(); // el final barato: sin beginTurn, sin turno
	}

	// Un turno por chat, siempre. Una segunda petición mientras corre un turno significa
	// que un cliente obsoleto/remontado compitió con uno vivo; dejarla pasar ejecutaría
	// dos veces al profesor y machacaría la persistencia del primer turno.
	if (!preparation && !beginTurn(chatId)) {
		console.info(`[chat ${chatId}] turn already in flight — request rejected`);
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	}

	turnClaimed = true;

	// Persistencia anticipada: los añadidos nativos de la entrada van a disco ANTES de
	// que empiece el turno; la respuesta del alumno es duradera en el instante en que
	// llega la petición, y cualquier remontaje, segunda pestaña o caída del servidor lee
	// la verdad en lugar del registro previo a la respuesta. (Oleada C: los marcadores del
	// despertar viajan por esta misma escritura anticipada; la bomba los sacó de la cola al
	// dispararse, así que esta es la ÚNICA copia que se añade).
	// Se comprueban de antemano los intercambios nuevos de TODOS los hilos para un rechazo
	// automático temprano. Esta instantánea no autoriza la petición final ensamblada; la
	// preparación del SDK vuelve a recoger el texto vivo y valida también la reorientación en cola.
	const sideContextSnapshots = sideContext.snapshot(chatId);
	const afterInput = [...record.messages, ...appends];
	const sideQuestions = hasUnresolvedQuestion(afterInput) ? [] : sideConversationEntries({
		messages: record.messages, sideChats: sideContextSnapshots,
	}, afterInput);
	const withSideQuestions = input.type === "answer" || input.type === "retry-question" || input.type === "plugin-question-answer" ? [...appends, ...sideQuestions] : [...sideQuestions, ...appends];
	const prospective = [...record.messages, ...withSideQuestions].filter((message) => !retryOmissions.has(message.id));
	const sideContextBlocked = sideQuestions.length > 0 && !fitsSideContext(prospective);
	// Un lote automático no ha sido admitido; se rechaza sin persistir sus
	// marcadores. Su llamante existente conserva/restaura el trabajo en cola.
	if (sideContextBlocked && isSubscriptionProvider(conversation.provider) && input.type === "steers") {
		endTurn(chatId);
		return new Response(sideBudgetError().message, { status: 400 });
	}
	// Solo la entrada del alumno/automática se escribe por anticipado. Los intercambios en
	// bruto ya son duraderos en sideChats; sus entradas de entrega se suman a la petición
	// del SDK en su frontera de preparación y solo se publican si se admiten.
	const merged = [...record.messages, ...appends];
	// Retry conserva todos los intentos persistidos. Pi necesita una cola que no sea del
	// asistente para iniciar continue(), así que su historial temporal omite solo los fallos
	// finales. Se cuenta ese MISMO prefijo temporal al asentarse; si no, los fallos
	// conservados harían que persistTurn se saltara salida genuinamente nueva.
	const agentMessages = input.type === "retry" ? merged.filter((m) => !retryOmissions.has(m.id)) : merged;
	const stagedAutomatic = isSubscriptionProvider(conversation.provider) && input.type === "steers";
	let persistBaseCount = stagedAutomatic ? record.messages.length : agentMessages.length;
	try {
		if (!stagedAutomatic) {
			stores.chatStore.saveMessages(chatId, merged);
			inputSaved = true;
		}
	} catch (err) {
		console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
		return new Response("Your input could not be saved. Please try again.", { status: 500 });
	}
	// La contabilidad de visibilidad no es el guardado canónico. Su fallo no debe ni
	// dar por perdida una entrada guardada ni impedir que se ejecute el turno.
	try {
		if (!stagedAutomatic) noteSteersDurable(chatId, merged);
	} catch (err) {
		console.error(`[chat ${chatId}] input visibility bookkeeping failed:`, err);
	}

	// CANAL DEL DINERO (oleada 4): un colector por petición, alimentado por los eventos
	// message_end del agente. El uso de cada llamada al modelo llega al registro de turnos
	// de solo añadido del chat en onFinish; idempotente por id de turno.
	const turnUsageId = crypto.randomUUID();
	const steps: CallUsage[] = [];
	const collectUsage = (usage: Usage) => {
		steps.push({
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheReadTokens: usage.cacheRead,
			cacheWriteTokens: usage.cacheWrite,
			cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
			// Opcional en el Usage de pi: se persiste como 0, nunca se descarta.
			reasoningTokens: usage.reasoning ?? 0,
		});
	};

	// RAMA DE CONSTRUCCIÓN DEL AGENTE (docs/archive/probe-teach-split.md §2): la transcripción
	// es la frontera; una llamada probe_done en el registro significa que el sondeo ha
	// concluido: se construye el PROFESOR (planificación + todas las herramientas). Si no,
	// la sesión sigue sondeando: se construye el SONDEADOR (quiz/ask + probe_done).
	// Ambos comparten toda esta composición (persistencia anticipada, vida del turno,
	// reorientaciones, uso, extracción); solo cambia el agente.
	const teaching = hasProbeDone(agentMessages);
	// BYOK (responsable, 2026-09-22): la cadena de conversación ya la resolvió la barrera
	// del turno de arriba (sustitución chat.model → ranura potente → rechazo); desde aquí
	// la construcción del motor es pura; los niveles de razonamiento se acotan de forma nativa.
	// (Se construye una vez encima de la barrera de compactación y se reutiliza tal cual).
	const engine = conversationEngine;
	// Sello con proveedor (oleada de ranuras de modelo): coincide con las claves
	// proveedor:id de la tabla de precios.
	const modelId = `${engine.model.provider}:${engine.model.id}`;
	// Las pruebas inyectan una fábrica: el agente no tiene estado entre turnos, así que
	// cada petición construye uno nuevo a partir del registro; la fábrica refleja
	// exactamente esa frontera. Oleada B: el registro ES el estado del agente (mensajes
	// nativos; el campo id del registro se quita en la red en toLlmMessages).
	// FRONTERA ENTRE FLUJOS (conciliación P2, 2026-09-19): `toolToggles` viaja en las
	// opciones de construcción como mapa DELTA a nivel de usuario (clave ausente =
	// activada). El conjunto definitivo de herramientas conmutables es TOGGLEABLE_TOOLS:
	// las herramientas de TAREA de los subagentes (research/demo/visual/pdf; acordado con
	// el usuario: quiz/ask/fs/plan/probe_done están siempre activas).
	if (isSubscriptionProvider(conversation.provider)) requestCycle = new SubscriptionRequestCycle({
		initialMessages: asAgentMessages(agentMessages),
		staged: stagedAutomatic ? asAgentMessages(appends) : undefined,
		foregroundOwed: !callPurpose.background,
		purpose: callPurpose,
		scopeCurrent: (scope) => connectionScopeCurrent(conversation.provider, scope),
		commitStaged: () => {
			stores.chatStore.saveMessages(chatId, merged);
			persistBaseCount = merged.length;
			noteSteersDurable(chatId, merged);
		},
		restoreAutomatic: (automaticIds, retainedIds) => restoreUncommittedAutomatic(chatId, constructed, automaticIds, retainedIds),
	});
	let pendingSideBudgetError: Error | undefined;
	const agentOpts: AgentBuildOptions = {
		pluginContributions,
		engine,
		callPurpose,
		requestCycle,
		messages: asAgentMessages(agentMessages),
		validateContext: (messages) => {
			// Esta es la petición REAL del SDK, después de que se le hayan sumado las
			// referencias preparadas y la reorientación ya vaciada. Una estimación previa a la
			// cola no puede autorizar esta carga combinada.
			preparedSideIds = new Set(messages.map((message) => (message as LhMessage).id).filter((id) => tentativeSideIds.has(id)));
			if (pendingSideBudgetError || (preparedSideIds.size > 0 && !fitsSideContext(messages as readonly LhMessage[]))) {
				pendingSideBudgetError = sideBudgetError();
				const rejected = new Set([...tentativeSideIds].filter((id) => !admittedSideIds.has(id)));
				// Solo se retiran del estado transitorio del bucle las entradas de referencia no
				// admitidas. No se quita ningún prefijo guardado, reorientación del alumno ni herramienta completada.
				constructed.state.messages = constructed.state.messages.filter((message) => !rejected.has((message as LhMessage).id));
				requestCycle?.rejectLocalRequest(rejected);
				throw pendingSideBudgetError;
			}
			if (!requestCycle) admitSideContext(); // BYOK no tiene barrera de admisión por suscripción
		},
		contextUpdates: (messages) => {
			pendingSideBudgetError = undefined;
			const current = stores.chatStore.getChat(chatId);
			if (!current) return [];
			const saved = new Set(current.messages.map((message) => message.id));
			// Solo los acuses del SDK sin guardar y con detalle null son marcadores provisionales;
			// las respuestas calificadas reales y los resultados null guardados heredados se siguen resolviendo.
			const live = messages.filter((message) => message.role !== "toolResult" || message.isError || message.details !== null ||
				saved.has((message as LhMessage).id) || !(QUESTION_TOOLS as readonly string[]).includes(message.toolName)) as LhMessage[];
			if (hasUnresolvedQuestion(live)) return [];
			// Se incluyen las entradas que el bucle ya inyectó, pero sin plegar dos veces los
			// sufijos guardados. El historial completo en disco conserva el registro previo a la compactación.
			const pending = live.filter((message) => message.role === "custom" && message.customType === "side-question" && !saved.has(message.id));
			const history = [...current.messages, ...pending];
			const updates = sideConversationEntries({ messages: history, sideChats: sideContext.snapshot(chatId) });
			if (updates.length && !fitsSideContext([...live, ...updates])) {
				pendingSideBudgetError = sideBudgetError();
				return []; // sin marca de agua de entrega para intercambios que el modelo no puede recibir
			}
			for (const update of updates) tentativeSideIds.add(update.id);
			return asAgentMessages(updates);
		},
		onUsage: collectUsage,
		toolToggles: effective.agent.tools,
		// Depuración (responsable, 2026-10-04): eventos en bruto del proveedor del profesor/sondeador
		// con LH_PROVIDER_EVENTS=1 (provider-events.ts); si no, no hace nada.
		chatId,
		// Los interruptores de sustitución del prompt (P2, 2026-09-19): mismo punto de
		// resolución que el delta de herramientas; la capa del agente compone el prompt de
		// sistema de nuevo en cada turno, intercambiando los segmentos sustitutos activados.
		promptSwitches: effective.agent.prompts,
	};
	// RAMA DE PRÁCTICA (diseño del responsable, 2026-10-04): una sesión kind:"practice"
	// construye al practicante desde el turno 1: sin división sondeador→profesor, sin
	// herramientas de plan/preguntas/tareas; todo el registro es
	// problem + conclude. buildAgent se sigue respetando (la frontera de pruebas es
	// uniforme entre tipos).
	const constructed: TeachingAgent = buildAgent
		? buildAgent({ ...agentOpts, teaching })
		: record.kind === "practice"
			? createPracticeAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						// VALIDACIÓN DE OBJETIVOS (ronda 9 del responsable): las herramientas de práctica leen
						// TODO el grafo de nuevo en cada planteamiento; los objetivos se validan contra todas
						// las proposiciones, no solo contra las elegidas para la sesión (las sesiones sin elección
						// y los futuros planteamientos con herramientas de grafo siguen siendo válidos).
						graphNodes: () => stores.graphStore.readNodes(),
						// EL CONJUNTO RARA VEZ NECESARIO (ronda 10 del responsable): tareas de research + pdf
						// (el mismo ejecutor/barreras que las del profesor; research ausente con honestidad
						// cuando no hay motor vivo) y los lectores del mapa tras la MISMA barrera de ajustes
						// que los del sondeador.
						jobs: {
							chatId,
							jobStore: stores.jobStore,
							spawn: (job, input) => void jobRunner.runJob(job.id, input),
							searchAvailable,
						},
						...(graphToolsEnabled(effective) ? { graph: { chatStore: stores.chatStore, graphStore: stores.graphStore } } : {}),
					},
					agentOpts,
				)
			: teaching
			? createTeacherAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						jobStore: stores.jobStore,
						spawn: (job, input) => void jobRunner.runJob(job.id, input),
						// La señal para retirarla del registro (2026-09-20): sin motor vivo
						// = sin herramienta research en el registro del profesor.
						searchAvailable,
					},
					agentOpts,
				)
			: createProberAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						deliver: (steer) => void deliverJobResult(steer),
						// Oleada de correcciones (2026-09-20): el sondeador lleva el despacho de research +
						// pdf (decisión del responsable: presente en todas las fases), así que su ctx
						// necesita el mismo cableado de tareas que el del profesor.
						jobStore: stores.jobStore,
						spawn: (job, input) => void jobRunner.runJob(job.id, input),
						searchAvailable,
						// El lector del mapa (oleada 7): el sondeador lee el grafo de conocimiento del alumno
						// mediante herramientas cuando se abre la barrera: el interruptor general del grafo
						// Y el conmutador agent.graphTools.
						...(graphToolsEnabled(effective) ? { graphStore: stores.graphStore } : {}),
					},
					agentOpts,
				);

	// Un agente inyectado por una prueba no recibe colector de uso (las pruebas comprueban
	// la transcripción, no el canal del dinero); cuando es nuestro, el uso fluye por la
	// suscripción de la fábrica (conectada arriba mediante onUsage).
	try {
		// EL TURNO COMO OBJETO EN SEGUNDO PLANO (decisión del responsable, 2026-09-25):
		// runPiTurn se ejecuta desacoplado de esta respuesta; el flujo del POST es solo el
		// PRIMER suscriptor (una vista). Una desconexión del cliente ya no puede cancelar el
		// turno; la terminación remota es el canal de cancelación, y las vistas tardías se
		// vuelven a enganchar mediante GET /api/chats/[id]/stream.
		// Oleada C (corrección del responsable, 2026-09-26; reorientación): se registra el agente
		// vivo ANTES de runPiTurn; la consulta de reorientación al inicio del bucle vacía la cola
		// de forma SÍNCRONA dentro de esa llamada, así que un registro posterior se la perdería.
		// El registro también reorienta hacia esta ejecución cualquier marcador pendiente del
		// registro: un marcador aparcado tras un quiz recién respondido viaja en la primera
		// llamada al LLM de ESTA ejecución (el sustituto nativo de la unión de continuaciones).
		// Aun así, el asentamiento no puede adelantarse al flujo de abajo: necesita una
		// respuesta en streaming, que nunca ocurre dentro del constructor.
		registerLiveAgent(chatId, constructed, input.type !== "steers" && input.type !== "continue",
			input.type === "steers" ? new Set(appends.map((message) => message.id)) : undefined);
		// Marcador de ejecución del grabador de depuración (responsable, 2026-10-04): relaciona
		// el flujo de eventos JSONL con los turnos del registro; no hace nada salvo con
		// LH_PROVIDER_EVENTS=1.
		providerEventNote(chatId, "turn", `run start (base: ${agentMessages.length} messages)`);
		const handle = runPiTurn({
			agent: constructed,
			requestCycle,
			// El hook del SDK del siguiente turno cubre las llamadas internas. La consulta de
			// reorientación aporta la misma carga nueva en la primera llamada / la de recuperación,
			// con los eventos normales del ciclo de vida y sin una petición extra al proveedor.
			beforeCycle: () => {
				for (const message of agentOpts.contextUpdates!(constructed.state.messages)) constructed.steer(message);
			},
			// La frontera de la ventana de unión (LEY DE LA COMPACTACIÓN, 2026-10-09): las pruebas
			// la estrechan con LH_UPDATE_FLUSH_MS; en producción se usa el valor por defecto de
			// 100 ms de ui-stream.
			...(process.env.LH_UPDATE_FLUSH_MS ? { updateFlushMs: Number(process.env.LH_UPDATE_FLUSH_MS) } : {}),
			// LA CORRECCIÓN LACAN (2026-10-04): se siembra el generador de unicidad con todos los
			// ids de llamadas a herramientas que ya contiene el registro; así, un proveedor que
			// reinicia los ids en cada respuesta (DeepSeek) recibe ids únicos nuevos para las
			// llamadas de este turno en la frontera de red, en la red, en el registro y en el
			// contexto del turno siguiente por igual.
			usedToolCallIds: new Set(collectToolCallIds(merged)),
			// Los fallos a nivel de flujo son detalles internos del proveedor/transporte:
			// enmascarados, como en los valores por defecto del SDK. Los mensajes de validación de
			// la entrada de herramientas nunca pasan por aquí: van por la ruta del resultado de error
			// y llegan directamente a la transcripción (el contexto de reintento que vio el modelo).
			onError: (error) => {
				if (conversation.provider === "chatgpt") return chatGPTStreamError(String(error));
				if (isSubscriptionProvider(conversation.provider)) return nativeSubscriptionError(conversation.provider, String(error));
				console.error(`[chat ${chatId}] turn error:`, error);
				return "An error occurred.";
			},
			onSettleError: settlementErrorText,
			onSettleFailure: (error, reportedErrorText) => {
				if (preparation && !preparation.isCurrent()) return;
				// El POST solo acusa la aceptación; quien envía puede engancharse
				// después de que este turno ya haya fallado y salido del registro.
				rememberTurnFailure(chatId, reportedErrorText ?? settlementErrorText(error));
				try { applyParkedDismissal(stores.chatStore, chatId); }
				catch (dismissalError) { console.error(`[chat ${chatId}] parked dismissal failed:`, dismissalError); }
				finally { releaseOwnership(); unregisterLiveAgent(chatId); }
				// Puede que el guardado canónico tuviera éxito antes de que fallara la contabilidad
				// posterior. Se concilia contra la durabilidad real; nunca se repite la entrada solo
				// porque haya fallado el uso/la extracción/otro trabajo de asentamiento.
				const persisted = stores.chatStore.getChat(chatId)?.messages ?? [];
				reconcileUserSteers(chatId, persisted);
				settleSteers(chatId, persisted, true, constructed);
			},
			onFinish: (turnMessages, isAborted) => {
				if (preparation && !preparation.isCurrent()) return;
				// Oleada B: solo se añaden los mensajes posteriores al prefijo temporal del agente.
				// El registro guardado de Retry sigue incluyendo sus intentos fallidos anteriores.
				// Las entradas de referencia no admitidas no pueden convertirse en marcas de agua de
				// entrega solo porque un rechazo local/del proveedor haya asentado el turno en curso.
				const admittedMessages = turnMessages.filter((message) => !tentativeSideIds.has((message as LhMessage).id) || admittedSideIds.has((message as LhMessage).id));
				const stamped = persistTurn(stores.chatStore, chatId, persistBaseCount, admittedMessages, isAborted);
				noteSteersDurable(chatId, stores.chatStore.getChat(chatId)?.messages ?? stamped);
				// añadido al registro de uso (idempotente por id de turno); la barra de estadísticas
				// lo vuelve a plegar en el cliente cuando el turno se asienta. El mensaje de
				// procedencia es el PRIMER mensaje nuevo del asistente en el turno.
				const response = stamped.find((m) => (m as { role?: string }).role === "assistant");
				if (response && steps.length > 0) {
					stores.chatStore.appendTurnUsage(chatId, {
						id: turnUsageId,
						messageId: response.id,
						at: new Date().toISOString(),
						model: modelId,
						steps,
					});
				}
				// BARRERA DEL GRAFO (oleada de almacenamiento de ajustes, 2026-09-19): el canal de
				// escritura (la extracción y su auditor) muere con el interruptor general.
				// PRÁCTICA (responsable, 2026-10-04): las sesiones de práctica no escriben nada:
				// ni extracción, ni grafo, ni cobertura (v1: la propia sesión es
				// el entregable).
				if ((!requestCycle || requestCycle.dispatched) && record.kind !== "practice" && extractionEnabled(effective.graph)) {
					// Lectura nueva en cada turno del presupuesto de fragmentos de la sección del grafo
					// (rediseño de la UX de extracción, 2026-09-24): el disparador se compara
					// con él y los lotes del proceso lo comparten.
					triggerExtraction(stores, extraction, chatId, effective.graph.extractionChunkTokens);
				}
				// DESCARTE APARCADO (responsable, 2026-10-04): un descarte que llegó a mitad
				// de turno quedó aparcado por la ruta de descarte (202); ahora que persistTurn ha
				// guardado los mensajes del turno, se aplica contra la verdad real, ANTES de
				// endTurn, para que "turn-settled" garantice que una lectura posterior ya
				// encuentra el descarte en el registro (la misma ley de orden que la del
				// propio persistTurn).
				applyParkedDismissal(stores.chatStore, chatId);
				// Cualquier actividad de auxiliares tras la última llamada al modelo queda pendiente;
				// el asentamiento nunca la inyecta por detrás del contexto del agente.
				// AL FINAL: un sondeo que ve que no hay nada en curso debe leer un registro ya
				// persistido; endTurn solo después de que persistTurn haya hecho su trabajo.
				releaseOwnership();
				// Asentamiento de reorientaciones de la oleada C: el agente vivo ha muerto (no hay más
				// traspasos followUp); se concilia el registro de reorientaciones con lo que esta
				// ejecución persistió de verdad (las inyecciones durante la ejecución se resuelven; los
				// marcadores varados vuelven a pendientes) y luego se deja que la bomba lleve los
				// rezagados por el despertar en reposo.
				unregisterLiveAgent(chatId);
				settleSteers(chatId, stamped, false, constructed);
				// Reorientaciones del compositor (2026-10-03): se descartan los ids entregados y los
				// varados se quedan aparcados para la siguiente ejecución del chat (el registro es la red
				// de seguridad contra los varados; la copia sin vaciar del agente murió arriba).
				reconcileUserSteers(chatId, stamped);
				// EL IMPULSO AL ASENTARSE (ronda 14 del responsable): el turno se ha asentado;
				// si la proyección supera ahora el umbral, el resumen arranca en segundo plano,
				// DENTRO de la pausa de lectura/respuesta del alumno (los planteamientos de
				// preguntas/problemas terminan las ejecuciones, así que este momento es siempre
				// una ventana entre ejecuciones). La barrera ensureCompacted del turno siguiente
				// espera a lo que esto deje en marcha; un motor perdido o un registro por debajo
				// del umbral no hacen nada, en silencio. Se omite en las pruebas (el precedente
				// de la extracción: los chats con guion son fixtures; el propio servicio se fija
				// directamente).
				if (process.env.NODE_ENV !== "test" && !pendingSideBudgetError && (!requestCycle || requestCycle.dispatched))
					kickCompaction(() => {
						const fresh = effectiveSettings();
						const spec = resolveConversationSpec(stores.chatStore.getChat(chatId)?.settings, fresh.models.strong);
						if (!spec || !connectionBackgroundAllowed(spec.provider)) return null;
						let kickEngine: PiEngine;
						try { kickEngine = piEngineForSpec(spec, true, undefined, retentionForSlot("strong")); } catch { return null; }
						const kickModelId = `${kickEngine.model.provider}:${kickEngine.model.id}`;
						const freshRecord = stores.chatStore.getChat(chatId);
						if (!freshRecord) return null;
						return {
							chatStore: stores.chatStore,
							engine: kickEngine,
							canStart: () => !isTurnRunning(chatId) && connectionBackgroundAllowed(spec.provider),
							modelId: kickModelId,
							kind: freshRecord.kind === "practice" ? "practice" : hasProbeDone(freshRecord.messages) ? "teach" : "probe",
							includeReasoning: fresh.compaction.includeReasoning,
							thresholdTokens: effectiveThresholdTokens(
								fresh.compaction?.thresholdTokens,
								catalogContextLimits().get(kickModelId),
							),
							systemPromptTokens: Math.ceil(composeInstructions(freshRecord.kind === "practice" ? "practice" : "teacher").length / 4),
						};
					}, chatId);
			},
		});
		// El turno es ahora un objeto vivo en segundo plano: se registra para que cualquier
		// vista pueda volver a engancharse (GET /api/chats/[id]/stream) o cancelarlo en remoto
		// (POST /api/activity/abort, tipo "turn"). Registrarlo tras la llamada a runPiTurn no
		// tiene carreras: el bucle del agente solo avanza en microtareas posteriores, así que
		// el asentamiento (y, por tanto, la baja del registro) no puede adelantársenos aquí.
		if (preparation) preparation.handoff(handle);
		else registerTurn(chatId, handle);
		handedOff = true;
		// DIETA DE CONEXIONES B (responsable, 2026-10-10; el análisis del bloqueo con
		// sesiones paralelas): el POST ya no mantiene abierto el flujo SSE del turno
		// durante toda su duración. Acusa la aceptación y SE CIERRA; quien envía se
		// engancha mediante GET /api/chats/[id]/stream, el mismo cable universal de
		// reenganche que usa un visitante que vuelve. El grupo de 6 conexiones por
		// origen del navegador es el recurso escaso. Un envío calificado es la
		// excepción explícita: su POST sigue abierto durante la calificación y el
		// guardado canónico, y se cierra antes de la salida del profesor. El turno en
		// sí es un proceso del servidor (decisión 2026-09-25); nunca necesitó esta
		// conexión, solo la necesitaba una vista.
		if (stagedAutomatic && requestCycle && !(await requestCycle.admission)) return Response.json({ error: "Automatic follow-up remains deferred in its queue." }, { status: 403 });
		return Response.json({ ok: true });
	} catch (err) {
		console.error(`[chat ${chatId}] turn failed to start:`, err);
		if (preparation && inputSaved) {
			// La respuesta y el resultado ya son duraderos. El fallo posterior del profesor se
			// comunica mediante el aviso de flujo conservado que ya existe.
			rememberTurnFailure(chatId, "Failed to start the turn");
			return Response.json({ ok: true });
		}
		return Response.json({ error: "Failed to start the turn" }, { status: 500 });
	}
	} catch (err) {
		if (preparation && inputSaved) {
			console.error(`[chat ${chatId}] accepted answer continuation failed:`, err);
			rememberTurnFailure(chatId, "Failed to start the turn");
			return Response.json({ ok: true });
		}
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		if (preparation?.signal.aborted) {
			return Response.json({ error: preparation.signal.reason instanceof Error ? preparation.signal.reason.message : "Question unavailable" }, { status: 409 });
		}
		if (turnClaimed) {
			console.error(`[chat ${chatId}] turn failed to start:`, err);
			return Response.json({ error: "Failed to start the turn" }, { status: 500 });
		}
		throw err;
	} finally {
		if (turnClaimed && !handedOff) {
			try {
				if (!preparation || preparation.isCurrent()) applyParkedDismissal(stores.chatStore, chatId);
			} catch (err) { console.error(`[chat ${chatId}] parked dismissal failed:`, err); }
			finally {
				if (!preparation || preparation.isCurrent()) unregisterLiveAgent(chatId);
				releaseOwnership();
			}
		}
	}
}
