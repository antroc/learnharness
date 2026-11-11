import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, questionResult } from "./tool-execute.ts";
import { providerEventObserver } from "./provider-events.ts";
import type { Usage } from "@earendil-works/pi-ai";
import { PATHS } from "../../config.ts";
import { APP_IDENTITY, piEngineFor, type PiEngine } from "./models.ts";
import { effectivePromptSegments } from "./prompt-segments.ts";
import {
	askUserQuestionTool,
	createProberTools,
	createTeacherTools,
	type ProbeDoneContext,
	type ProberToolContext,
	type TeacherToolContext,
} from "./tools.ts";
import { practiceTools, createPracticeGate, type PracticeGate, type PracticeToolContext } from "./tools/practice.ts";
import { pluginProblemTools, isPluginProblemPoseAcknowledgment, type NativePluginProblemContribution } from "./plugin-problem-tools.ts";
import { healToolRecord, withArgumentHeal } from "./tools/heal.ts";
import { sendToUserApplies, sendToUserTool } from "./tools/send-to-user.ts";
import { makeNarrationGuard, narrationGuardApplies, SEND_TO_USER_DELIVERY_RULE } from "./narration-guard.ts";
import { createReadTool, readTool } from "./tools/read.ts";
import { quizInputObject, quizInputProblems } from "../core/question-core.ts";
import { QUESTION_TOOLS, TOGGLEABLE_TOOLS, type EnabledTools } from "../core/pending.ts";
import type { PluginToolContext } from "../core/plugins.ts";
import { toLlmMessages, nativeInputCause, PRACTICE_PROBLEM_TOOL } from "../core/native-messages.ts";
import type { ChatGPTRequestCycle } from "./chatgpt-request-cycle.ts";
import { usageWasAdmitted } from "./subscription-request-cycle.ts";
import { PluginQuestionLedger, type NativePluginQuestionContribution } from "./plugin-question-tools.ts";

/**
 * Los dos agentes del lado de la enseñanza (docs/archive/probe-teach-split.md): el SONDEADOR y
 * el PROFESOR. Mismo transcript, distintos prompts y conjuntos de herramientas; el
 * chat-handler construye UNO por petición a partir de la frontera del transcript
 * (probe_done = profesor): el motor SIN ESTADO por turno (docs/
 * docs/archive/pi-engine-swap.md §2): el registro persistido es la fuente de verdad, el
 * agente se reconstruye a partir de él en cada POST y se descarta al final del turno.
 *
 * Los motores son inyectables para que las pruebas puedan pasar un motor falso con guion y
 * conducir lecciones deterministas (ver tests/chat-flow.test.ts).
 *
 * Los prompts de sistema se COMPONEN por agente: system-prompt.md (la base compartida:
 * agente, voz, filosofía, precisión) + cada fragmento con prefijo numérico del
 * directorio de ese agente (src/agent/prompts/prober/ o
 * src/agent/prompts/teacher/), por orden de nombre de fichero, y después los fragmentos de
 * shared/ como apéndice final (herramientas de preguntas, ficheros del alumno,
 * formato): la reordenación del 2026-09-27: primero el trabajo y el método del agente,
 * al final la mecánica. Unidos con separadores `---`.
 *
 * SOLO se cargan los ficheros con prefijo numérico: el cargador impone la convención, así que
 * la documentación que no es fragmento (README.md, …) puede vivir en los directorios
 * sin colarse nunca en el prompt del modelo.
 */

/** Qué directorio de prompts de agente se compone. La práctica (2026-10-04)
 *  compone SOLO su propio directorio: ver prompt-segments.ts. */
export type AgentKind = "prober" | "teacher" | "practice";

/** Reserva los builtins de conversación aunque las barreras de rol/mecánica/ajustes los oculten.
 * Los nombres de builtins nuevos deben entrar en este catálogo; las herramientas reales del turno también se reservan. */
export const CONVERSATION_TOOL_NAMES = Object.freeze([
	...QUESTION_TOOLS, ...TOGGLEABLE_TOOLS, "probe_done", "read", "ls", "find", "grep",
	"plan_init", "list_sessions", "list_propositions", "problem", "conclude", sendToUserTool.name,
] as const);

// P2 (2026-09-19): el descubrimiento de segmentos + la resolución de sustituciones viven ahora
// en UN lugar canónico: src/store/prompt-overrides.ts (listSourceSegments
// refleja las reglas de este cargador, shared/ incluido). El agente lo importa para
// la frontera de ficheros estáticos; los helpers locales de descubrimiento de fragmentos se retiran.

/** Exportado para las pruebas: comprueba qué se compone en el prompt del modelo.
 *  Orden de composición: base compartida → fragmentos de shared/ (ambos agentes, la
 *  frontera sources-v1 para la doctrina común a agentes) → los fragmentos propios del agente.
 *
 *  Reconciliación P2 (2026-09-19): la composición se DELEGA en
 *  effectivePromptSegments del módulo de store: una regla canónica de descubrimiento de
 *  segmentos (su listSourceSegments refleja la de este cargador, ahora incluyendo
 *  shared/), de modo que las SUSTITUCIONES por segmento van por el mismo camino: un segmento
 *  cuyo interruptor está ACTIVADO y cuyo fichero de sustitución existe compone el
 *  texto sustituto en lugar del original. `switches` es el mapa agent.prompts del registro
 *  de ajustes (clave ausente = desactivado), pasado por turno mediante
 *  AgentBuildOptions.promptSwitches; una llamada sin switches compone el original
 *  puro (idéntico byte a byte al cargador anterior a la refactorización, fijado en
 *  tests/prompt-overrides.test.ts). Las sustituciones son una lectura de fichero estático
 *  por las rutas de configuración, no estado de la petición: la importación de store no
 *  arrastra maquinaria de chats ni tareas. */
export function composeInstructions(kind: AgentKind, switches?: Record<string, boolean>): string {
	const segments = effectivePromptSegments(kind, switches ?? {});
	return segments
		.map((s) => (s.enabled ? s.overrideText! : s.sourceText))
		.map((t) => t.trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

// La composición original sin interruptores, en caché por tipo (una vez al cargar el módulo).
// Con promptSwitches, baseAgentOptions compone DE NUEVO en cada turno:
// un fichero de sustitución escrito con su interruptor ACTIVADO debe cambiar la composición
// del turno siguiente; la caché solo sirve al camino sin interruptores.
const composedInstructions: Record<AgentKind, string> = {
	prober: composeInstructions("prober"),
	teacher: composeInstructions("teacher"),
	practice: composeInstructions("practice"),
};

// Canal del dinero (oleada 4): el chat-handler pasa un recolector por turno;
// el uso de cada llamada al modelo acaba en el registro de turnos del chat
// (ChatStore.appendTurnUsage). El parámetro estrecho mantiene honesta la frontera.
export type StepUsageCollector = (usage: Usage) => void;

/** Opciones de construcción por petición (el handler las conecta todas). */
export interface AgentBuildOptions {
	/** Modelo + función de stream: las pruebas inyectan un motor falso con guion. */
	engine?: PiEngine;
	callPurpose?: { background: boolean };
	requestCycle?: ChatGPTRequestCycle;
	/** El transcript inicial, como mensajes de pi (el registro ES el estado del agente). */
	messages?: AgentMessage[];
	/** Canal del dinero: una llamada por petición al modelo. */
	onUsage?: StepUsageCollector;
	/** Actualizaciones de referencia solo de anexado antes de cada llamada interna al modelo
	 * ya programada. No programa una llamada extra ni interrumpe la salida en curso. */
	contextUpdates?: (messages: readonly AgentMessage[]) => AgentMessage[];
	/** Valida el contexto realmente seleccionado después de que se unan los mensajes
	 * preparados/en cola, antes del envío. Lanza a través del ciclo de vida normal de
	 * respuesta fallida del SDK, nunca a través de la frontera de conversión. */
	validateContext?: (messages: readonly AgentMessage[]) => void;
	/** Las pruebas pueden pasar un registro de herramientas desnudo para conducir flujos deterministas.
	 *  Un registro explícito NUNCA se filtra por interruptores: es del llamador. */
	tools?: Record<string, AgentTool<any>>;
	/** Resolvedor por turno propiedad del servidor. Solo aditivo; las sustituciones explícitas
	 * de herramientas de las pruebas se saltan las contribuciones. Sin identidad de conversación no se llama a la factoría. */
	pluginContributions?: (context: PluginToolContext, reservedToolNames: readonly string[]) => {
		instructions: readonly string[];
		tools: readonly AgentTool<any>[];
		questionTypes?: readonly NativePluginQuestionContribution[];
		problemTypes?: readonly NativePluginProblemContribution[];
	};
	/** Los interruptores de herramientas resueltos por usuario (EnabledTools de core/pending: el
	 *  puente P2 del 2026-09-19: el chat-handler de Platform pasa
	 *  effective.agent.tools; las factorías descartan toda herramienta explícitamente false.
	 *  EL conjunto DEFINITIVO activable es TOGGLEABLE_TOOLS (solo herramientas de tareas);
	 *  el filtrado es genérico, pero las escrituras se validan contra la lista). */
	toolToggles?: EnabledTools;
	/** INTERRUPTORES de sustitución del prompt de sistema por segmento (el mapa
	 *  agent.prompts del registro de ajustes, clave ausente = desactivado: las mismas claves que
	 *  usan las rutas de ajustes y effectivePromptSegments). Si se pasan → el prompt se compone
	 *  de nuevo en cada turno, respetando las sustituciones activadas (interruptor activado + el
	 *  fichero existe); si no → la composición original pura en caché. */
	promptSwitches?: Record<string, boolean>;
	/** Identidad nativa de la conversación: el id de chat persistido existente, reutilizado
	 * en los agentes sondeador, profesor y de práctica reconstruidos.
	 * Depuración: si está definido Y LH_PROVIDER_EVENTS=1, los eventos crudos del stream del proveedor
	 *  (antes de normalizar) se añaden a data/debug/provider-events/
	 *  <chatId>.jsonl mediante providerEventObserver: la capa de incidentes del truncado de GLM /
	 *  los ids de DeepSeek. Ausente o variable de entorno desactivada → sin observador. */
	chatId?: string;
}

/**
 * La regla de parada por pregunta del turno (docs/archive/pi-engine-swap.md §2; Oleada A
 * 2026-09-26, opción A del responsable): una llamada a una herramienta de preguntas (quiz /
 * ask_user_question) que se RESOLVIÓ (su resultado sintético "question posed"
 * no es un error) termina la ejecución: la respuesta del alumno llega como el siguiente
 * POST. Una llamada que FALLÓ la validación de autoría (resultado de error) NO debe
 * detener la ejecución: el modelo reintenta dentro del mismo turno, exactamente la antigua
 * semántica de InvalidToolInputError.
 *
 * Los resultados de preguntas también llevan terminate: true (questionResult de
 * tool-execute), así que los lotes de una sola pregunta se detienen de forma nativa en la
 * comprobación de lote del propio bucle de pi; este hook finishTurn (renombrado en 0.87.1 desde
 * shouldStopAfterTurn) es la
 * MITAD de cinturón y tirantes para el lote mixto (una pregunta + otras llamadas
 * en un mismo mensaje) que la semántica de solo terminate dejaría seguir: el
 * alumno no puede responder mientras hay un turno en curso (409 por chat), así que una
 * pregunta planteada limpiamente SIEMPRE debe terminar el turno. El planteamiento de problema de
 * la práctica tiene el mismo contrato de esperar al alumno, incluidos los lotes mixtos de
 * salida/problema; los planteamientos fallidos deben seguir reintentándose. maxTurns ha desaparecido
 * (decisión del responsable del 2026-09-25: ninguna red de máximo de turnos del agente en el
 * turno de enseñanza).
 */
function makeQuestionStopper(kind: AgentKind) {
	return (context: {
		message: { content: Array<{ type: string; id?: string; name?: string }> };
		toolResults: Array<{ toolCallId: string; isError?: boolean }>;
	}): boolean => {
		const called = new Set(
			context.message.content
				.filter((c) => c.type === "toolCall" && c.name !== undefined && (
					(QUESTION_TOOLS as readonly string[]).includes(c.name) ||
					(kind === "practice" && c.name === PRACTICE_PROBLEM_TOOL)
				))
				.map((c) => c.id!),
		);
		if (called.size === 0) return false;
		// Detenerse solo cuando todos los planteamientos de pregunta/problema se resolvieron limpiamente.
		for (const result of context.toolResults) {
			if (called.has(result.toolCallId) && result.isError) return false;
		}
		return true;
	};
}

function baseAgentOptions(kind: AgentKind, opts: AgentBuildOptions, tools: AgentTool<any, any>[], nodeExists?: (nodeId: string) => boolean,
	practice?: { gate: PracticeGate; graphNodes: PracticeToolContext["graphNodes"] }) {
	// La práctica nunca llega al respaldo por rol (el handler SIEMPRE inyecta
	// el motor de conversación de la sesión: la práctica usa la misma
	// resolución de conversation-spec que la enseñanza); el cast mantiene honesto a AgentKind
	// ("practice" no es un ModelRole) al respecto.
	const engine = opts.engine ?? piEngineFor(kind as "prober" | "teacher");
	const stopper = makeQuestionStopper(kind);
	const narrationGuard = narrationGuardApplies(kind, engine.model, opts.tools !== undefined);
	const narrationHooks = narrationGuard ? makeNarrationGuard() : undefined;
	const composedPrompt = opts.promptSwitches
		? composeInstructions(kind, opts.promptSwitches)
		: composedInstructions[kind]!;
	const builtinPrompt = narrationGuard ? `${composedPrompt}\n\n---\n\n${SEND_TO_USER_DELIVERY_RULE}` : composedPrompt;
	// Vincula el read nativo y conserva la barrera de salida de Claude sensible al tipo/modelo
	// antes de resolver los plugins aditivos. Los registros explícitos siguen siendo del llamador.
	const builtinTools = [
		...tools.map((tool) => tool.name === "read" && tool.execute === readTool.execute
			? { ...tool, execute: createReadTool(engine.model).execute as AgentTool<any>["execute"] }
			: tool),
		...(sendToUserApplies(kind, engine.model, opts.tools !== undefined)
			? [withArgumentHeal(sendToUserTool)]
			: []),
	];
	const contributions = opts.tools === undefined && opts.chatId && opts.pluginContributions
		? opts.pluginContributions({ chatId: opts.chatId, agent: kind }, [...CONVERSATION_TOOL_NAMES, ...builtinTools.map(tool => tool.name)])
		: undefined;
	const questionLedger = contributions?.questionTypes?.length && opts.chatId
		? new PluginQuestionLedger(contributions.questionTypes, opts.chatId, nodeExists) : undefined;
	const problemTools = kind === "practice" && practice && opts.chatId
		? pluginProblemTools(contributions?.problemTypes ?? [], opts.chatId, practice.gate, practice.graphNodes) : [];
	// Nunca sustituir el prompt ni las herramientas builtin, ni mutar un Agent ya en ejecución.
	const systemPrompt = contributions?.instructions.length
		? [builtinPrompt, ...contributions.instructions].join("\n\n---\n\n")
		: builtinPrompt;
	// Grabador de depuración (responsable, 2026-10-04): eventos crudos del proveedor cuando
	// LH_PROVIDER_EVENTS=1 y el llamador pasó un chatId; undefined es
	// el camino normal sin observador (pruebas, variable de entorno desactivada).
	const providerEvents = opts.chatId ? providerEventObserver(opts.chatId, kind) : undefined;
	const seenInputs = new Set((opts.messages ?? []).map((m) => (m as { id?: string }).id).filter(Boolean));
	const agent = new Agent({
		identity: APP_IDENTITY,
		sessionId: opts.chatId,
		initialState: {
			systemPrompt,
			model: engine.model,
			thinkingLevel: engine.level,
			tools: contributions ? [...builtinTools, ...contributions.tools, ...(questionLedger?.tools ?? []), ...problemTools] : builtinTools,
			messages: opts.messages ?? [],
		},
		streamFn: engine.streamFn,
		...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		// Ambas políticas comparten el hook del SDK: conservar el seguimiento de la prosa entregada
		// y la vinculación exacta de ocurrencias de plugins en lugar de sobrescribir cualquiera de ellos.
		...(questionLedger || narrationHooks ? {
			...narrationHooks,
			beforeToolCall: async (context: import("@earendil-works/pi-agent-core").BeforeToolCallContext) => {
				const guarded = await narrationHooks?.beforeToolCall?.(context);
				if (guarded?.block) return guarded;
				questionLedger?.validatedCall(context);
				return undefined;
			},
		} : {}),
		// 0.87.1: shouldStopAfterTurn → finishTurn. Mismo punto de llamada (después de
		// adjuntar los resultados de herramientas, antes de turn_end) y `{ action: "end" }` sigue
		// saliendo ANTES del sondeo de reorientación: el abandono del marcador aparcado del que
		// depende nuestro diseño de la Oleada C (registerLiveAgent antes de runPiTurn).
		// undefined conserva la programación normal (el antiguo booleano false).
		finishTurn: (turn) => (turn.toolResults.some(result => questionLedger?.isAcknowledgment(result) || (kind === "practice" && isPluginProblemPoseAcknowledgment(result))) || stopper(turn) ? { action: "end" } : undefined),
		// Oleada C (2026-09-26, corrección del responsable el mismo día): los marcadores entregados a
		// una ejecución en vivo se vacían desde la cola de REORIENTACIÓN de pi: el bucle de la lección es una
		// ejecución continua enseñar→quiz→enseñar, así que la entrega debe inyectarse en los límites de
		// turno DENTRO de la ejecución, no esperar a que se detenga (follow-ups).
		// "all" une todos los marcadores entregados en un mismo límite, igual que la semántica
		// de llevarlo todo del despertar en reposo (el "one-at-a-time" por defecto
		// gastaría un turno del profesor por marcador).
		steeringMode: "all",
		// Oleada B (aprobada por el responsable el 2026-09-26): la conversión de cara al modelo es
		// LA frontera de la app: los marcadores se aplanan a su texto de usuario canónico
		// (HANDOFF_TEXT / texto de reorientación, todo de fuente única),
		// los marcadores solo de interfaz (plan-block) se descartan, los campos de id de la app se quitan y
		// la llamada de pregunta colgada de un aborto recibe su resultado INTERRUPTED.
		// Nunca debe lanzar (el contrato convertToLlm de pi).
		convertToLlm: toLlmMessages,
		...(opts.contextUpdates ? { prepareNextTurnWithContext: ({ context }: { context: { messages: AgentMessage[] } }) => {
			const messages = opts.contextUpdates!(context.messages);
			return messages.length ? { messages } : undefined;
		} } : {}),
		prepareRequest: (request) => {
			if (opts.callPurpose) {
				let learner = false, automatic = false;
				const messages = request.context.messages;
				for (const message of messages) {
					const id = (message as { id?: string }).id;
					const cause = nativeInputCause(message, messages.slice(0, messages.indexOf(message)));
					if (cause === "neutral") continue;
					if (id && seenInputs.has(id)) continue;
					if (id) seenInputs.add(id);
					if (cause === "learner" && id) learner = true;
					else automatic = true; // una identidad ausente/no reconocida nunca concede el primer plano
				}
				if (automatic) opts.callPurpose.background = true;
				else if (learner) opts.callPurpose.background = false;
			}
			opts.requestCycle?.prepare(request);
			try { opts.validateContext?.(request.context.messages); }
			catch (error) {
				opts.requestCycle?.rejectLocalRequest();
				throw error;
			}
		},
	});
	questionLedger?.bind(agent);
	if (opts.onUsage) {
		agent.subscribe((event: AgentEvent) => {
			if (event.type === "message_end" && event.message.role === "assistant" && "usage" in event.message) {
				// Una llamada cancelada no es un paso facturado (el uso parcial/estimado
				// de un mensaje abortado no es dinero gastado).
				if (event.message.stopReason === "aborted" || !usageWasAdmitted(event.message.usage) || (opts.requestCycle && !opts.requestCycle.acceptsUsage(event.message))) return;
				opts.onUsage!(event.message.usage);
			}
		});
	}
	return agent;
}

/**
 * El SONDEADOR (agente A): la herramienta de quiz (quiz, o explain en
 * recuerdo libre; sin nodeId en ningún caso) + ask + probe_done, apoyado en la
 * doctrina de sondeo. Todo su trabajo es acotar el borde del alumno y
 * concluir con la evaluación (probe_done), que además pone en cola el
 * despertar de traspaso (ver tools/probe.ts) y es la frontera del transcript en la que el
 * handler basa la construcción del profesor.
 */
export function createProberAgent(ctx: ProberToolContext, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("prober", opts, Object.values(createProberTools(ctx, opts.toolToggles)));
}

/**
 * El PROFESOR (agente B): entra en la planificación (el sondeo ya ha
 * concluido: su evaluación está en el transcript), es dueño de plan_init y del
 * conjunto completo de herramientas (preguntas de enseñanza con nodeId validado, el mapa,
 * investigación, demos).
 */
export function createTeacherAgent(
	// Opcional para que las pruebas puedan construir un agente desnudo dirigido por mocks (sin
	// conexión con el almacenamiento): sin ctx, las herramientas recurren al conjunto de preguntas
	// sin validación. El handler SIEMPRE pasa ctx (la raíz de composición).
	ctx?: TeacherToolContext,
	opts: AgentBuildOptions = {},
) {
	const tools = opts.tools ?? (ctx ? createTeacherTools(ctx, opts.toolToggles) : bareQuestionTools());
	return baseAgentOptions("teacher", opts, Object.values(tools), ctx
		? nodeId => ctx.chatStore.getChat(ctx.chatId)?.tree?.nodes.some(node => node.id === nodeId) ?? false
		: undefined);
}

/** El conjunto desnudo de preguntas de enseñanza (pruebas, agentes desnudos): quiz con el
 *  refinamiento de autoría compartido (quizInputProblems, ejecutado en execute: devuelve un
 *  resultado isError de invalidInputResult sobre el que el modelo reintenta, convención de
 *  pi 1.0) pero SIN la comprobación de nodeId por sesión (no hay registro que leer),
 *  más ask. */
export function bareQuestionTools(): Record<string, AgentTool<any>> {
	// Una const tipada (no un literal en línea): el tipado concreto de AgentTool
	// da a execute su entrada Static precisa; los registros heterogéneos usan
	// AgentTool<any>, cuyo Static laxo la difuminaría a unknown.
	const quiz: AgentTool<typeof quizInputObject> = {
		name: "quiz",
		label: "quiz",
		description: "Ask the learner a graded question.",
		parameters: quizInputObject,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = quizInputProblems(input);
			if (problems.length > 0) return invalidInputResult("quiz", problems);
			return questionResult();
		},
	};
	// healToolRecord (responsable, 2026-10-09: la generalización de whitehead):
	// el quiz desnudo NO llevaba prepareArguments en absoluto, ni siquiera el
	// desempaquetado de options; ahora recibe la reparación estándar completa como toda herramienta.
	return healToolRecord({
		quiz,
		ask_user_question: askUserQuestionTool,
	});
}

/**
 * El PRACTICANTE (sesiones de práctica, diseño del responsable del 2026-10-04): se construye
 * desde el turno 1 de una sesión kind:"practice": sin división sondeador→profesor,
 * sin herramientas de plan, sin herramientas de preguntas. TODO su registro es
 * problem + conclude (tools/practice.ts); el prompt de doctrina
 * (prompts/practice/) lleva el método. Un planteamiento de problema correcto termina
 * la ejecución, de forma nativa en un lote solo de problema y mediante el hook de parada compartido
 * en un lote mixto (incluidas las herramientas de salida heredadas inyectadas por el llamador).
 * La práctica usa prosa final normal, no la herramienta de salida explícita.
 */
export function createPracticeAgent(ctx: PracticeToolContext, opts: AgentBuildOptions = {}) {
	// Los registros explícitos de prueba se saltan toda la construcción builtin y las contribuciones.
	if (opts.tools !== undefined) return baseAgentOptions("practice", opts, Object.values(opts.tools));
	const gate = createPracticeGate(ctx);
	return baseAgentOptions("practice", opts, Object.values(practiceTools(ctx, gate)), undefined, { gate, graphNodes: ctx.graphNodes });
}

export type ProberAgent = ReturnType<typeof createProberAgent>;
export type TeacherAgent = ReturnType<typeof createTeacherAgent>;
export type PracticeAgent = ReturnType<typeof createPracticeAgent>;
export type TeachingAgent = ProberAgent | TeacherAgent | PracticeAgent;

