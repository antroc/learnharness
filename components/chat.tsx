"use client";

import { createContext, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChatSession } from "@/components/session";
import { usePlugins } from "./plugins";
import { PluginSubmissionRunner, SubmissionModelEpoch, type SubmissionAttempt } from "./plugin-submission-runner";
import { submissionImages, type BuiltinSubmissionCapture, type PrepareBuiltinSubmission, type PrepareThinkingSubmission, type PreparePluginQuestionSubmission, type PreparePluginProblemSubmission } from "./plugin-submission-adapters";
import { SubmittedImages } from "./submitted-images";
import { usePageSurfaceBoundary, SurfaceRegion } from "./plugin-surfaces";
import { findSurfaceBoundary } from "./plugin-surface-targets";
import { scheduleOpeningSubmission } from "./plugin-submission-opening";
import { activeProblemOccurrenceOf, buildAnswer, toClientQuestion, type PluginSubmission, type PluginSubmissionTarget, type QuestionData } from "@/src/core";
import { validatePluginBuiltinSubmissionAnswer } from "@/src/core";
import { visibleQueuedSteers } from "@/components/session-core";
import { SetupDialog } from "@/components/setup-dialog";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { useModelSetup, selectedModelUnavailable, openModelPicker, ZeroKeysPill } from "@/components/setup-cta";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PathText } from "@/components/file-path-chip";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/components/braille-spinner";
import { ToolPartRenderer } from "@/components/plugin-renderers";
import { Separator } from "@/components/ui/separator";
import { AnsweredCard } from "@/components/answered-card";
import { MalformedQuestion } from "@/components/malformed-question";
import { SubagentSteerCard } from "@/components/artifacts/steer-card";
import { ChatSessionComposer } from "@/components/composer";
import { useEnterSubmits } from "@/components/enter-submits";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { dockStateKey } from "@/components/dock-state-key";
import { clearOpeningPrompt, readOpeningPromptEntry, stashOpeningPrompt, OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { forwardDockWheel, useDockHeight } from "@/components/dock-height";
import { createDockMorph } from "@/components/dock-morph";
import { QueuedSteersBody, type QueuedSteerLine } from "@/components/queued-steers";
import { DictationBar, finishDictation, joinDictation, useDictation, type Dictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { JobsContext } from "@/components/jobs-context";
import { StatsBar } from "@/components/stats-bar";
import { useServerEvent, useServerResync } from "@/components/server-events";
import {
	isProviderKeyRefusal,
	firstSourceTextParts,
	cliContextWindowOf,
	messageAnchorId,
	sideEntryPoints,
	sideSegmentId,
	textPartMessageId,
	kbdEventForAction as kbdEventForChat,
	type ChatInput,
	type ChatSettings,
	type LhMessage,
	type ModelSlotName,
} from "@/src/core";
import { PlanBlock, PlanPopup, latestTree } from "@/components/plan-block";
import { PlanMarginalia, planExists } from "@/components/plan-window";
import { MermaidOverlay, SessionMermaidContext, type SessionImage } from "@/components/session-overlay";
import { AbortTurnDialog, type AbortMode } from "@/components/abort-turn-dialog";
import { ArrowRightIcon, DumbbellIcon, MessageCircleQuestionIcon, WaypointsIcon } from "lucide-react";
import type { PlanBlockData } from "@/src/core";
import { QuestionDock } from "@/components/question-dock";
import { PluginQuestionDock } from "./plugin-question-dock";
import { PluginQuestionPart } from "./plugin-question-part";
import { pluginQuestionKeySuppressed, composingQuestionKey } from "./plugin-question-keys";
import { capturePluginQuestionDismissal, confirmPluginQuestionDismissal, type PluginQuestionDismissalTarget } from "./plugin-question-dismissal";
import { pendingPluginQuestionOf, pluginQuestionCallsOf } from "@/src/core";
import { pluginQuestionOccurrenceKey, type PluginQuestionSnapshot } from "@/src/core";
import type { PluginQuestionDraft } from "./session-core";
import { SessionFind } from "@/components/session-find";
import { SessionMessageNavigation } from "@/components/session-navigation";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { createCiteAction, type CitationEditTarget } from "@/components/citation-actions";
import { CitationActionsContext, type CitationActions } from "@/components/citation-chip";
import { CitationCommentPopover } from "@/components/citation-comment-popover";
import { revealCitationSource } from "@/components/citation-source";
import { createSideQuestionActions, SideThreadBody, SideThreadPanel, SideThreadPopover } from "@/components/side-thread";
import { useSideThread, type SideThreadOpenArgs } from "@/components/use-side-thread";
import { useRouter } from "next/navigation";
import { PracticeDock } from "@/components/practice-dock";
import { PluginProblemDock, type PluginProblemDockProps } from "./plugin-problem-dock";
import { practiceProblemForCall } from "@/src/core";
import { PluginProblemSubmitted } from "./plugin-problem-submitted";
import { readPluginProblemSubmission, pluginProblemById } from "@/src/core";
import { ThinkingCard, ProblemCard, type PracticeThinkingData } from "@/components/practice-cards";
import { GraphContextCard, type GraphContextData } from "@/components/graph-context-card";
import { TopBar } from "@/components/top-bar";
import { PluginTopBarActions } from "@/components/plugin-chrome";
import { usePluginShortcutPage } from "@/components/plugin-shortcuts";
import { createPluginSessionActionContext, type PluginSessionViewInput } from "@/src/core";
import type { SessionInputViewReader, SessionViewTargets, NativeQuestionViewState, ViewReaderRef } from "./session-view-readers";
import type { JobRecord, Phase3, QuestionAnswerData, QuestionFormDraft, TurnUsage, SessionPricing } from "@/src/core";
import type { LhViewMessage } from "@/src/core";
import { PhaseChip, PhaseDivider } from "@/components/phase-divider";
import {
	CompactionCutDivider,
	CompactionMomentDivider,
	type CompactionDividerData,
} from "@/components/compaction-divider";
import { CoverageRing } from "@/components/extraction-coverage";
import { Button } from "@/components/ui/button";
import {
	activeProblemOf,
	pendingQuestionOf,
	malformedQuestionsOf,
	dismissedAnswer,
	endsInFailedTurn,
	findPendingToolCall,
	phaseAt3,
	phaseTimeline,
	teachStepIndex,
	toolQuestionKind,
	questionNeedsReveal,
} from "@/src/core";
import { ReadingThinkingField } from "@/components/reading-thinking";
import { currentUserThinkingOpen, setAllUserThinkingOpen } from "@/components/thinking-block";

/** Un único ancho para todo: transcripción, tarjetas y la burbuja inferior comparten esta columna. */
/**
 * Tokens de ancho (rediseño de la oleada 5, decisión del responsable): la PROSA
 * de enseñanza ocupa todo el ancho de la sesión con un margen fino px-6; el
 * DOCK del compositor/las preguntas es a propósito más estrecho (~46rem,
 * centrado), según la referencia. Mismo ELEMENTO, mismo sitio — solo un
 * pulido del ancho.
 */
const COLUMN = "mx-auto w-full max-w-none px-6";
const DOCK = "mx-auto w-full max-w-[46rem] px-4";
// El ancho fijo del contenedor del DOCK (46rem) y la geometría de la nota al margen
// del plan (responsable, ronda de colocación del plan): el diagrama desnudo va en el flanco
// DERECHO de la franja del dock — a MARGIN_GAP del borde del contenedor del DOCK y a
// la misma distancia del borde derecho de la columna. El ancho de la caja es CSS puro, así que
// el diagrama se encoge de forma CONTINUA con el flanco; MARGIN_MIN_W es solo el
// suelo del fundido (responsable, ronda de redimensionado) — por debajo, la nota al margen
// se desvanece con la transición normal en vez de desaparecer de golpe, y sigue
// montada mientras la pregunta ocupa la franja, para que al ensanchar vuelva a aparecer.
const DOCK_W = 46 * 16;
const MARGIN_GAP = 16;
const MARGIN_MIN_W = 220;
// La franja con degradado del overlay del dock (h-24) — parte de la cola reservada.
const GRADIENT_H = 96;
// Umbrales de plegado (responsable, ronda 1 de scroll, ajustados en la ronda 3): distancia en
// píxeles desde abajo — posición, no velocidad. Al dejar el fondo → la caja se
// pliega (solo visual); al volver a alcanzarlo → se reabre. 96 (era 64, ronda 3 del
// responsable) tolera asomarse un poco hacia arriba sin plegar; la banda muerta
// frente a EXPAND_DIST absorbe la deriva del trackpad.
const COLLAPSE_DIST = 96;
const EXPAND_DIST = 16;

/**
 * Canal de sincronización con el servidor para los renderizadores de artefactos:
 * el sondeo CENTRAL de tareas de Chat llama a syncFromServer() cuando se asienta
 * una tarea en segundo plano — para entonces, la reorientación y la respuesta del
 * turno de despertar ya están persistidas, así que los mensajes nuevos sustituyen
 * al estado local de una sola vez. sendText alimenta el bucle de corrección de
 * errores de las demos. (contracts.ts "THE ASYNC PROTOCOL" §4.)
 */
export const ChatActionsContext = createContext<{
	chatId: string;
	syncFromServer: () => Promise<void>;
	/** Envía un mensaje de usuario a la sesión (bucle de corrección de errores de las demos, W6). */
	sendText: (text: string) => void;
	/** Abre el diálogo de configuración de modelos (BYOK, 2026-09-22): las tarjetas
	 *  de tareas rechazadas enlazan al mismo SetupDialog que usa la intercepción del envío. */
	openSetup: () => void;
} | null>(null);

/** El sobre de rechazo BYOK a partir del texto de error del transporte: el
 *  DefaultChatTransport lanza el cuerpo del 503 TAL CUAL como mensaje de error,
 *  así que la forma {code, missing}, legible por máquina, sobrevive hasta aquí.
 *  Los errores reales (cualquier otro texto) dan null y conservan el aviso
 *  honesto. Exportada como función pura para las pruebas. */
export function parseModelsRefusal(message: string | undefined): ModelSlotName[] | null {
	if (!message) return null;
	try {
		const body = JSON.parse(message) as { code?: unknown; missing?: unknown };
		if (body.code === "models_not_configured" && Array.isArray(body.missing)
			&& body.missing.every((s) => typeof s === "string")) {
			return body.missing as ModelSlotName[];
		}
		return null;
	} catch {
		return null;
	}
}

/** La frontera de transporte del rechazo por clave de proveedor (oleada de cero
 *  claves, 66dbea9 de Platform): la misma disciplina que parseModelsRefusal — el
 *  cuerpo del 503 viaja tal cual en el mensaje del error lanzado, así que decide
 *  el propio comparador del sobre (core, invariant-tail); la redacción nunca
 *  puede desviarse en el cliente. Exportada como función pura para las pruebas. */
export function parseProviderKeyRefusal(message: string | undefined): boolean {
	if (!message) return false;
	try {
		const body = JSON.parse(message) as { code?: unknown; error?: unknown };
		return body.code === "provider_key_missing" && typeof body.error === "string" && isProviderKeyRefusal(body.error);
	} catch {
		return false;
	}
}

/** Reintentar no envía texto del compositor. Su rechazo no debe resucitar el borrador
 * de un envío de texto anterior, ya duradero, por encima del compositor actual sin enviar.
 * Retira esa alternativa de forma síncrona, nunca cuando se asiente el Reintentar
 * asíncrono: para entonces, un envío normal posterior puede tener un borrador de recuperación nuevo. */
export function retryFailedResponse(
	send: (input: ChatInput) => void,
	submittedDraft: { current: string | null },
): void {
	submittedDraft.current = null;
	void send({ type: "retry" });
}

/** useLayoutEffect que no dice nada durante el SSR (en Next, los componentes de cliente también se renderizan en el servidor). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Un mensaje de reorientación del proceso de despertar: una entrega con rol de usuario cuyos
 * metadatos lo marcan como resultado de un subagente — se renderiza como tarjeta de artefacto, nunca como burbuja. */
/** La línea discreta del sistema (renderizado del esquema de mensajes
 *  personalizados): centrada, atenuada, pequeña — la voz de la transcripción
 *  para los eventos que no son habla (andamiaje del despertar). */
function SystemLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<div
			data-testid={testId}
			className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground"
		>
			{children}
		</div>
	);
}

/** Un único provisional optimista inmediato; solo cambia su redacción durante la
 * evaluación del envío gestionada por el host. El spinner conserva su identidad. */
export function PendingTurnIndicator({ evaluating }: { evaluating: boolean }) {
	return (
		<span className="flex items-center gap-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
			<BrailleSpinner label={evaluating ? "Evaluating" : "Thinking"} />
			<Shimmer duration={1}>{evaluating ? "EVALUATING…" : "THINKING…"}</Shimmer>
		</span>
	);
}

function isSubagentSteer(m: LhViewMessage): boolean {
	return (m.metadata as { subagentResult?: unknown } | undefined)?.subagentResult != null;
}

/**
 * La sesión de enseñanza. Todo el estado del chat vive en useChat; el servidor
 * persiste la transcripción canónica después de cada turno.
 *
 * La burbuja inferior es UN envoltorio persistente cuyo contenido se intercambia
 * (compositor del chat ↔ dock de preguntas ↔ barra plegada). El envoltorio es
 * sticky DENTRO del contenedor de scroll — nunca tapa la transcripción en
 * reposo ni cubre la barra de scroll — y DockOverlay anima su altura cuando
 * cambia la variante.
 */
export function Chat({
	chatId,
	title,
	initialMessages,
	initialError,
	initialPrompt,
	initiallyInFlight,
	initiallyCompacting = false,
	initialConfigured = false,
	kind = "teach",
}: {
	chatId: string;
	title: string;
	initialMessages: LhMessage[];
	/** Aviso de asentamiento, solo en memoria, que se proporciona al reabrir. */
	initialError?: string;
	/** El tipo de sesión (sesiones de práctica, responsable 2026-10-04): la práctica
	 *  no renderiza el chip de fase (no aplica el arco sondeo→enseñanza) y en su
	 *  lugar la cabecera lleva una etiqueta Practice. */
	kind?: "teach" | "practice";
	initialPrompt?: string;
	/** Hay un turno del profesor ejecutándose en el servidor pero sin enganchar a
	 * ningún cliente (se navegó a otra parte a mitad de turno y se volvió con él en curso). */
	initiallyInFlight?: boolean;
	/** Una compactación tiene la barrera de modelo del chat al montarse (se navegó a
	 * otra parte a mitad de compactación — el registro es estado vivo del servidor y el
	 * evento compaction-changed ya se disparó). El spinner de la transcripción y las
	 * barreras de envío dependen de esto. */
	initiallyCompacting?: boolean;
	/** slotsConfigured(registro del servidor) — la llamada a la acción persistente
	 *  de configuración depende de esto (BYOK, responsable 2026-09-22). La barrera del
	 *  servidor sigue siendo la verdad; esto solo decide si la píldora va en el compositor. */
	initialConfigured?: boolean;
}) {
	// Fontanería del reenganche (oleada del ejecutor de turnos en segundo plano): el hook guarda
	// el callback del terminal asentado — una ref estable asignada más abajo, en cuanto
	// existe syncFromServer (refs, no closures: nada de capturas obsoletas).
	const reattachSettledRef = useRef<() => void>(() => {});

	// EL HOOK DE SESIÓN (oleada D, aprobado por el responsable el 2026-09-26): el sustituto,
	// propio de la app, de useChat + el transporte del AI SDK. El registro es el historial
	// nativo; la VISTA (agrupada, golden master) se deriva en el cliente
	// (core/view.ts projectView); los envíos son UN evento de entrada explícito cada uno
	// ({chatId, input} — la indirección del alijo murió con el SDK), y el stream del
	// turno es el paso TAL CUAL de los AgentEvent que emite el servidor.
	const { canonicalMessages, reconciliation, reconcile, pluginQuestionAvailability, pluginQuestionDraft, pluginProblemAvailability, pluginProblemDraft, dismissPluginQuestion, readRecord, messages, nativeMessages, hasConfirmedConversation, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, dismissQuestion, dismissProblem, questionDraft, saveQuestionDraft, status, evaluating, error, stop, clearError, resumeStream, setReattachSettled } =
		useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });

	const controller = useOptionalInteractionLayers();
	const sessionFindScopeRef = useRef<HTMLDivElement | null>(null);
	const pathname = usePathname();
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === `/chat/${encodeURIComponent(chatId)}`, viewKey: chatId, bodyRef: sessionFindScopeRef });
	const { manager: pluginManager } = usePlugins();
	const [, submissionChanged] = useState(0);
	const [preparationError, setPreparationError] = useState<string>();
	const [submissionRunner] = useState(() => new PluginSubmissionRunner(() => submissionChanged(n => n + 1)));
	const [submissionModel] = useState(() => new SubmissionModelEpoch());
	const submissionMounted = useRef(true);
	useEffect(() => { submissionMounted.current = true; return () => { submissionMounted.current = false; submissionRunner.dispose(); }; }, [submissionRunner]);
	useEffect(() => () => submissionRunner.dispose(), [surfaceTarget, submissionRunner]);
	const inputViewReader = useRef<(() => PluginSessionViewInput) | null>(null) as SessionInputViewReader;
	const [, refreshViewContext] = useState(0);
	const notifyViewChanged = useCallback(() => { if (submissionMounted.current) refreshViewContext(value => value + 1); }, []);
	inputViewReader.changed = notifyViewChanged;
	const submissionLive = useRef({ nativeMessages, surfaceTarget, ready: true });
	submissionLive.current = { nativeMessages, surfaceTarget, ready: true };
	const runSubmission = async (target: PluginSubmissionTarget, capture: () => PluginSubmission | Promise<PluginSubmission>, current: () => boolean, deliver: (prepared: PluginSubmission, attempt: SubmissionAttempt) => Promise<boolean>): Promise<boolean> => {
		const modelRevision = submissionModel.capture();
		const attempt = submissionRunner.begin(target, pluginManager?.captureSubmissionInterceptors() ?? [], () => submissionMounted.current && submissionModel.isCurrent(modelRevision) && submissionLive.current.surfaceTarget === target.surfaceTarget && !!findSurfaceBoundary(target.surfaceTarget) && current());
		if (!attempt) return false;
		setPreparationError(undefined);
		try {
			const input = await attempt.finalize(async () => { await finishDictation(); return capture(); });
			const prepared = await attempt.prepare(input, submissionLive.current.nativeMessages);
			if (!prepared) return false;
			attempt.check();
			return await deliver(prepared, attempt);
		} catch (error) {
			attempt.cancel(); attempt.refused();
			if (!(error instanceof DOMException && error.name === "AbortError")) setPreparationError(attempt.preparationFailure(error).message);
			return false;
		}
	};
	const textTarget = (): Extract<PluginSubmissionTarget, { type: "text" }> | undefined => surfaceTarget ? { type: "text", sessionId: chatId, sessionKind: kind === "practice" ? "practice" : "teaching", surfaceTarget, channels: ["content"] } : undefined;
	const scrollContextRef = useRef<StickToBottomContext | null>(null);
	const sourceTextParts = useMemo(() => firstSourceTextParts(messages), [messages]);
	const sideEntries = useMemo(() => sideEntryPoints(nativeMessages, messages), [nativeMessages, messages]);

	// El terminal asentado del reenganche → la frontera de sincronizar y continuar (más abajo).
	setReattachSettled(() => reattachSettledRef.current());

	// Un turno que se ejecuta en el servidor sin enganchar a ninguna vista viva nuestra (se navegó
	// a otra parte a mitad de turno, o se descubrió un turno de despertar a mitad de sesión): el
	// stream de reenganche es el canal principal (resumeStream — la misma ruta de renderizado
	// que un turno vivo); este indicador es la fuente ALTERNATIVA de vida del turno — bloquea
	// el compositor, muestra el brillo previo al primer fragmento y dirige el sondeo del
	// registro cada 1500 ms, que lo adopta al asentarse si el stream no consigue engancharse.
	const [turnInFlight, setTurnInFlight] = useState(initiallyInFlight ?? false);

	// Título de la sesión: clic para renombrar (responsable, 2026-09-17). Hacer clic en el título
	// de la cabecera abre el modo de edición con todo seleccionado — escribir sustituye, las flechas
	// se mueven dentro. Enter o un clic fuera confirman (PUT /api/chats/:id); Escape
	// descarta. El servidor nunca actualiza updatedAt al renombrar (el orden de la barra lateral
	// no debe moverse), y el parche de la barra lateral es instantáneo gracias al evento de window —
	// su sondeo de 2,5 s es solo una red de seguridad.
	const [titleText, setTitleText] = useState(title);
	const [renaming, setRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const titleInputRef = useRef<HTMLInputElement | null>(null);

	const commitRename = useCallback(
		async (next: string) => {
			setRenaming(false);
			const t = next.trim();
			if (t === "" || t === titleText) return; // confirmación vacía = descartar
			try {
				const res = await fetch(`/api/chats/${chatId}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: t }),
				});
				if (!res.ok) throw new Error(`rename failed: ${res.status}`);
				setTitleText(t);
				window.dispatchEvent(
					new CustomEvent("lh:chat-renamed", { detail: { id: chatId, title: t } }),
				);
			} catch (err) {
				console.error("rename failed:", err); // se conserva el título antiguo
			}
		},
		[chatId, titleText],
	);

	// Seleccionar todo al abrir el modo de edición: el clic significa «sustituir», así que
	// todo el título se resalta al entrar (petición del responsable, 2026-09-17).
	useEffect(() => {
		if (renaming) {
			const el = titleInputRef.current;
			if (el) {
					el.focus();
					el.select();
			}
		}
	}, [renaming]);

	// ── Fronteras de teclado (oleada A de atajos, 2026-09-17) ──
	// F2 abre el renombrado del título (la cabecera del chat es responsable del estado de edición).
	useEffect(() => {
		const onRename = () => {
			if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
			setTitleDraft(titleText);
			setRenaming(true);
		};
		window.addEventListener("lh:kbd-rename-session", onRename);
		return () => window.removeEventListener("lh:kbd-rename-session", onRename);
	}, [titleText, controller]);

	// La OTRA superficie de renombrado (oleada 6: el renombrado en línea de la barra lateral): su
	// confirmación despacha el mismo evento lh:chat-renamed que el renombrado de esta cabecera
	// — si renombró ESTE chat, parchea el título de la cabecera en su sitio (el
	// evento es la única fuente de verdad; la cabecera es un oyente más).
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			if (id === chatId) setTitleText((prev) => (title !== prev ? title : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, [chatId]);

	// El último eslabón de la cadena de Esc: abortar el turno. El ejecutor en segundo plano
	// desacopló los turnos de las vistas, así que el aborto es SIEMPRE la terminación remota
	// (POST /api/activity/abort — cualquier turno en curso muere en el servidor y nuestra
	// vista renderiza el cierre parcial abortado cuando llega el final). Una vista
	// LOCAL además se desengancha antes — stop() asienta el cliente al instante
	// y conserva el parcial; el parcial del lado del servidor se persiste mediante el
	// propio onFinish del aborto. Inerte cuando no se ejecuta nada (barrera busyRef).
	const abortInFlightTurn = useCallback(() => {
		if (localStreamRef.current) stop();
		void fetch("/api/activity/abort", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "turn", id: chatId }),
		}).catch(() => {
			/* transitorio — el turno se asienta solo; el sondeo del registro lo adopta */
		});
		// 409 not_running es la carrera benigna de asentamiento: el final del stream
			// ya asentó la vista (o lo adopta el sondeo alternativo) — no se debe nada.
	}, [chatId, stop]);
	// Protección del aborto con ESC (responsable, 2026-10-02): la cadena de aborto abre una
	// ventana de confirmación EN TODAS PARTES (tanto streams como preguntas pendientes). Los dos
	// oyentes de window se disparan con cada Esc, así que lo que evita que el propio Esc de la
	// ventana encadene es esta barrera de estado — no el orden de stopPropagation.
	// ESC POR CAPAS (responsable, 2026-10-04): un overlay abierto RECLAMA el Esc — se cierra
	// él mismo — antes de que la cadena de aborto pueda abrir su confirmación. Un foco de mermaid,
	// la ventana del plan o el diálogo de configuración encima de una pregunta pendiente no deben
	// descartar la pregunta de debajo.
	const [abortAsk, setAbortAsk] = useState<AbortMode | null>(null);
	const abortAskRef = useRef<AbortMode | null>(null);
	abortAskRef.current = abortAsk;
	const pluginAbortTarget = useRef<PluginQuestionDismissalTarget | null>(null);
	const pluginDismissal = useRef({ canonicalMessages, reconciliation, stop, dismissPluginQuestion });
	pluginDismissal.current = { canonicalMessages, reconciliation, stop, dismissPluginQuestion };
	const closeAbortAsk = useCallback(() => { pluginAbortTarget.current = null; setAbortAsk(null); }, []);
	useEffect(() => {
		const onAbort = () => {
			if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
			const pluginQuestion = capturePluginQuestionDismissal(pluginDismissal.current.canonicalMessages);
			const target = escAbortTarget({
				abortAsk: abortAskRef.current !== null,
				sideThread: sideThreadOpenRef.current,
				mermaidFocus: mermaidFocusRef.current !== null || figureFocusRef.current !== null,
				planOpen: planOpenRef.current,
				setupOpen: setupOpenRef.current,
				pending: pendingRef.current !== null || pluginQuestion !== null,
				problem: activeProblemRef.current !== null,
				busy: busyRef.current,
			});
			if (target === "side-thread") closeSideThreadRef.current();
			else if (target === "question") { pluginAbortTarget.current = pluginQuestion; setAbortAsk("question"); }
			else if (target === "problem") setAbortAsk("problem");
			else if (target === "turn") setAbortAsk("turn");
			else if (target === "mermaid") setMermaidFocus(null);
			else if (target === "plan") setPlanOpen(false);
			// la configuración se cierra sola; null = nada que hacer — ambos reclamados.
		};
		window.addEventListener("lh:kbd-abort-turn", onAbort);
		return () => window.removeEventListener("lh:kbd-abort-turn", onAbort);
	}, [controller]);
	const confirmAbort = useCallback(
		(mode: AbortMode) => {
			const pluginQuestion = pluginAbortTarget.current;
			closeAbortAsk();
			if (mode === "question" && pluginQuestion) {
				confirmPluginQuestionDismissal(pluginQuestion, pluginDismissal.current);
				return;
			}
			if (mode === "turn") {
				abortInFlightTurn();
				return;
			}
			// Desde una pregunta pendiente, el descarte es silencioso (A2, 2026-10-03):
			// el toolResult omitido entra por la ruta SILENCIOSA, sin turno ni
			// despertar — el siguiente envío normal es el despertar. A MITAD DE TURNO (responsable,
			// 2026-10-04 — el bucle de GLM): la pregunta solo puede quedar colgante porque un
			// turno SIGUE EJECUTÁNDOSE, así que el descarte TAMBIÉN termina ese turno; la
			// ruta aparca el descarte (202) y el asentamiento lo aplica.
			const p = pendingRef.current;
			if (p) {
				const question = (p.input as { question?: string } | null)?.question ?? "";
				const reading = readingThinkingRef.current.trim() || undefined;
				clearReadingThinking();
				void closeSideThreadRef.current(); // su nota llega después de la omisión
				const answer = dismissedAnswer(toolQuestionKind(p.tool), question);
				void dismissQuestion(
					p.toolCallId,
					reading ? { ...answer, readingThinking: reading } : answer,
					p.key,
				);
				if (busyRef.current) abortInFlightTurn();
				return;
			}
			// El descarte de la práctica (responsable, 2026-10-04): al estilo de ask — la
			// ruta silenciosa del marcador; la síntesis de cierre viaja con la siguiente
			// entrada del usuario. El compositor vuelve de inmediato. A mitad de turno, el
			// descarte también termina el turno en curso (la misma ley de aparcar + asentar).
			const problem = activeProblemRef.current;
			if (problem) {
				void dismissProblem(problem.toolCallId);
				if (busyRef.current) abortInFlightTurn();
			}
		},
		[abortInFlightTurn, dismissQuestion, dismissProblem, closeAbortAsk],
	);
	// Continuación al montar: si la transcripción guardada termina con una herramienta completada
	// (llegó el resultado de una tarea sin ningún cliente abierto), reanuda la lección — el
	// sendAutomaticallyWhen del SDK solo se dispara dentro de addToolOutput, así que las recargas
	// necesitan este empujón. Una vez por montaje; el turno siguiente termina en texto (o
	// en una pregunta pendiente), así que no hay bucle. NUNCA mientras ya se esté ejecutando un turno
	// en el servidor — eso ejecutaría dos veces al profesor (el servidor le respondería con un
	// 409; en su lugar lo reanuda el sondeo de más abajo).
	const mountContinuation = useRef(false);
	useEffect(() => {
		if (mountContinuation.current) return;
		mountContinuation.current = true;
		if (!turnInFlight) continueIfOwed(initialMessages);
		// solo al montar, a propósito (turnInFlight se lee con su valor inicial)
	}, []);

	const pendingPlugin = pendingPluginQuestionOf(canonicalMessages);
	const unreadablePlugin = pluginQuestionCallsOf(canonicalMessages).find(call => call.status === "unreadable");
	const pluginOwnsDock = !!pendingPlugin || !!unreadablePlugin;
	const [pluginMicAvailable, setPluginMicAvailable] = useState(false);
	const pluginProblemIdentity = activeProblemOf(canonicalMessages)?.pluginProblem?.problemId;
	const pluginCanonicalIdentity = pendingPlugin?.questionId ?? (unreadablePlugin ? pluginQuestionOccurrenceKey(unreadablePlugin.occurrence) : pluginProblemIdentity ?? null);
	useEffect(() => {
		// La reconexión del efecto (incluida la repetición de StrictMode) debe renovar la
		// lectura canónica; una ref de identidad conservada no puede certificar una conexión.
		if (pluginCanonicalIdentity) void reconcile();
	}, [pluginCanonicalIdentity, reconcile]);
	useServerEvent("plugins-changed", () => {
		if ((pluginOwnsDock || pluginProblemIdentity) && status !== "submitted" && status !== "streaming") void reconcile();
	});
	const pending = findPendingToolCall(messages, pendingQuestionOf(nativeMessages));
	const malformedQuestions = malformedQuestionsOf(nativeMessages);
	// El manejador del aborto lee la pregunta pendiente de una ref (el oyente de window
	// tiene el ámbito del montaje; el valor que necesita tiene el ámbito del render).
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	// EL PROBLEMA DE PRÁCTICA ACTIVO (sesiones de práctica, 2026-10-04): la
	// misma regla de propiedad del dock que una pregunta pendiente — un problema activo
	// sustituye al compositor. Se calcula a partir del registro NATIVO (el plegado es
	// la barrera que leen las propias herramientas), no de la vista proyectada.
	const activeProblem = activeProblemOf(nativeMessages);
	const activeProblemOccurrence = activeProblemOccurrenceOf(nativeMessages);
	const activeProblemRef = useRef(activeProblem);
	activeProblemRef.current = activeProblem;

	const localStream = status === "submitted" || status === "streaming";
	const busy = localStream || turnInFlight || reconciliation !== "ready";
	const busyRef = useRef(busy);
	busyRef.current = busy;
	// El traspaso del enganche (oleada de reenganche del stream): en el momento en que un stream
	// reanudado toma el renderizado — el SDK salió de "ready", así que
	// submitted/streaming significa que llegan fragmentos — localStream cubre por sí solo
	// ocupado/brillo/barreras. Mantener turnInFlight activo solo conseguiría
	// renderizar dos veces el brillo y que el sondeo alternativo de 1500 ms siguiera peleando con
	// el stream vivo del que era alternativa.
	useEffect(() => {
		if (turnInFlight && (status === "submitted" || status === "streaming")) setTurnInFlight(false);
	}, [status, turnInFlight]);

	// Descubrimiento a mitad de sesión (sondeo de tareas, vigilancia del traspaso): existe un turno
	// en el servidor que no tiene ninguna de nuestras vistas — engánchate a él por la misma
	// ruta de reanudación que el reenganche al montar (renderizado vivo, puesta al día instantánea). El
	// indicador se queda como alternativa hasta que el stream se engancha (el vigilante de arriba);
	// las llamadas de reanudación simultáneas las protege el SDK (una más nueva aborta la petición
	// más antigua), así que no pasa nada si los ticks de descubrimiento vuelven a dispararlo.
	const turnInFlightRef = useRef(turnInFlight);
	turnInFlightRef.current = turnInFlight;
	const attachToRunningTurn = useCallback(() => {
		setTurnInFlight(true);
		void resumeStream();
	}, [resumeStream]);

	// El envío del dock de práctica (UN solo carril, responsable 2026-10-05): hace POST del
	// razonamiento contra el problema ACTIVO — si afirma una respuesta lo decide el agente
	// leyendo el texto, no se declara aquí. Inicia un turno;
	// el dock sigue montado (el problema sigue activo hasta que el agente
	// lo cierra).
	const submitThinking = useCallback(
		(text: string) => {
			const problem = activeProblemRef.current;
			if (!problem) return;
			void send({ type: "thinking", problemCallId: problem.toolCallId, text });
		},
		[send],
	);

	// Comprobación de la fase de enseñanza (W5, visión §2): un QUIZ pendiente que llega una vez que
	// un nodo del plan está OCUPADO (phaseAt3 "teach") empieza plegado tras un botón de
	// revelación "Check your understanding"; las preguntas de las fases de sondeo y de plan
	// se abren solas, como hasta ahora. Las dos herramientas de quiz de la enseñanza cumplen la
	// ley (responsable, 2026-10-09: las comprobaciones de explain se suman a las de quiz tras la
	// revelación); las predicciones de cualquiera de las dos mecánicas y ask llegan siempre abiertas.
	// Una pregunta pendiente nunca puede preceder a la frontera de su fase en la transcripción (el turno
	// del profesor termina en la llamada de la pregunta), así que la fase actual de la sesión ES la
	// fase de la pregunta.
	const requiresReveal = pendingPlugin ? pendingPlugin.variant === "teach" && pendingPlugin.input.type === "check" : pending !== null && questionNeedsReveal(pending.tool, pending.input, phaseAt3(messages));

	/* El canal de RAZONAMIENTO DURANTE LA LECTURA (responsable 2026-10-03): un campo de
	 * borrador para pensar mientras se lee la prosa de enseñanza, montado mientras una
	 * comprobación espera tras su revelación, que viaja con la respuesta a la comprobación
	 * (o con su descarte) como el campo aparte `readingThinking`. Se reinicia con cada pregunta pendiente. */
	const [readingThinkingSeed, setReadingThinkingSeed] = useState({ questionId: null as string | null, value: "", revision: 0 });
	const readingThinkingRef = useRef("");

	// ⌘T (toggle-user-thinking, ronda del responsable 2026-10-07): pone TODAS las filas de
	// razonamiento del usuario en un mismo estado — las filas de la transcripción están abiertas por
	// defecto, así que la primera pulsación lo pliega todo y la segunda lo vuelve a desplegar.
	useEffect(() => {
		const onToggle = () => {
			if (isInteractionScopeEligible(sessionFindScopeRef.current, controller)) setAllUserThinkingOpen(!currentUserThinkingOpen());
		};
		window.addEventListener(kbdEventForChat("toggle-user-thinking"), onToggle);
		return () => window.removeEventListener(kbdEventForChat("toggle-user-thinking"), onToggle);
	}, [controller]);
	const applyReadingThinking = useCallback((v: string) => {
		readingThinkingRef.current = v;
	}, []);
	const clearReadingThinking = useCallback(() => {
		readingThinkingRef.current = "";
		setReadingThinkingSeed((previous) => ({ ...previous, value: "", revision: previous.revision + 1 }));
	}, []);
	const pendingQuestionId = pendingPlugin ? pluginQuestionOccurrenceKey(pendingPlugin.occurrence) : pending?.key ?? null;
	useLayoutEffect(() => {
		// Llamadas distintas nunca comparten borrador; un envío fallido de ESTA
		// llamada restaura el canal de lectura junto con la instantánea del formulario.
		const value = pendingPlugin ? pluginQuestionDraft(pendingPlugin).readingThinking : pendingQuestionId ? questionDraft(pendingQuestionId)?.readingThinking ?? "" : "";
		readingThinkingRef.current = value;
		setReadingThinkingSeed((previous) =>
			previous.questionId === pendingQuestionId && previous.value === value
				? previous
				: { questionId: pendingQuestionId, value, revision: previous.revision + 1 },
		);
	}, [pendingQuestionId, questionDraft, pluginQuestionDraft]);

	// La fase en cada mensaje (un único plegado lineal): la transcripción dibuja un
	// divisor de puntos con código de color en cada límite; el chip de la cabecera lee la
	// fase actual de la sesión.
	const phases = useMemo(() => phaseTimeline(messages), [messages]);

	const [composerDraftRevision, setComposerDraftRevision] = useState(0);
	/* La ref del borrador del compositor es síncrona, así que los envíos y los volcados del
	 * dictado leen el texto más reciente sin un render del padre por cada evento de entrada. Los
	 * reinicios explícitos siguen incrementando una revisión para que el campo local se sincronice. */
	const textRef = useRef("");
	const composerEditRevision = useRef(0);
	const applyText = useCallback((v: string) => {
		textRef.current = v; composerEditRevision.current++;
		setComposerDraftRevision((revision) => revision + 1);
	}, []);
	const recordComposerText = useCallback((v: string) => {
		textRef.current = v; composerEditRevision.current++;
	}, []);
	// La completitud de las ranuras guardadas está viva, pero la ruta elegida para la sesión
	// sale de su propio control normal de modelo, nunca de la fijación Strong de hoy.
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const catalogRef = useRef(catalog);
	catalogRef.current = catalog;
	const [selectedModel, setSelectedModel] = useState<string | undefined>();
	const recordSelectedModel = useCallback((model: string | undefined) => { submissionModel.observe(model); setSelectedModel(model); }, [submissionModel]);
	const [setupOpen, setSetupOpen] = useState(false);
	/** El último borrador enviado de forma explícita (envío del compositor): el
	 *  flujo de rechazo lo restaura en el compositor, donde espera a que el alumno
	 *  lo vuelva a enviar (Save nunca envía solo, responsable 2026-10-09).
	 *  Las continuaciones automáticas (respuestas a sondeos) nunca lo fijan — su
	 *  rechazo abre la recuperación sin repetición. */
	const draftRef = useRef<string | null>(null);
	const openingDraftRef = useRef<string | null>(null);
	const [openingError, setOpeningError] = useState(false);
	const openingMountedRef = useRef(false);
	useEffect(() => {
		openingMountedRef.current = true;
		return () => { openingMountedRef.current = false; };
	}, []);

	const builtinTarget = (question: QuestionData): Extract<PluginSubmissionTarget, { type: "answer" }> | undefined => {
		if (!surfaceTarget || !pending) return;
		return { type: "answer", sessionId: chatId, sessionKind: kind === "practice" ? "practice" : "teaching", surfaceTarget,
			channels: ["answer", "thinking", ...(requiresReveal ? ["readingThinking" as const] : [])],
			question: { ...toClientQuestion(question), occurrence: { messageId: pending.messageId, contentIndex: pending.contentIndex, toolCallId: pending.toolCallId, toolName: pending.tool }, ...(question.questionType ? { questionType: question.questionType } : {}) },
		};
	};
	const prepareBuiltin: PrepareBuiltinSubmission = ({ question, capture, isCurrent }: BuiltinSubmissionCapture) => {
		const target = builtinTarget(question), original = pending;
		if (!target || !original || busyRef.current || compacting) return;
		void runSubmission(target, () => {
			const raw = capture();
			saveQuestionDraft(original.key, { readingThinking: readingThinkingRef.current });
			return { type: "answer", answer: {
				...(raw.dontKnow !== undefined ? { dontKnow: raw.dontKnow } : {}), ...(raw.values !== undefined ? { values: raw.values } : {}),
				...(raw.other !== undefined ? { other: raw.other } : {}), ...(raw.text !== undefined ? { text: raw.text } : {}),
				...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}), images: [],
			}, thinking: { text: raw.thinking ?? "", images: [] }, readingThinking: { text: requiresReveal ? readingThinkingRef.current : "", images: [] } };
		}, () => {
			const now = pendingQuestionOf(submissionLive.current.nativeMessages);
			return isCurrent() && !busyRef.current && now?.messageId === original.messageId && now.contentIndex === original.contentIndex && now.toolCallId === original.toolCallId && now.tool === original.tool;
		}, async (prepared, attempt) => {
			if (prepared.type !== "answer") return false;
			const raw = validatePluginBuiltinSubmissionAnswer(question, prepared.answer);
			const answer = buildAnswer(question, { ...raw, ...(prepared.thinking.text ? { thinking: prepared.thinking.text } : {}), ...(requiresReveal && prepared.readingThinking.text ? { readingThinking: prepared.readingThinking.text } : {}) }, original.tool);
			const images = submissionImages(prepared, target.channels);
			// Guarda las ediciones nativas más nuevas sin cambiar la carga preparada.
			capture(); saveQuestionDraft(original.key, { readingThinking: readingThinkingRef.current });
			attempt.deliver();
			return send({ type: "answer", toolCallId: original.toolCallId, occurrence: target.question.occurrence, answer: { ...answer, ...(images ? { images } : {}) } }, attempt.accepted, original.key, attempt.refused);
		});
	};
	const thinkingTarget = (): Extract<PluginSubmissionTarget, { type: "thinking" }> | undefined => {
		const occurrence = activeProblemOccurrenceOf(nativeMessages);
		if (!surfaceTarget || !activeProblem || activeProblem.pluginProblem || !occurrence) return;
		return { type: "thinking", sessionId: chatId, sessionKind: kind === "practice" ? "practice" : "teaching", surfaceTarget, channels: ["content"], problem: { occurrence, statement: (activeProblem.input as { statement: string }).statement } };
	};
	const prepareThinking: PrepareThinkingSubmission = (capture, clear) => {
		const target = thinkingTarget();
		if (!target || busyRef.current || compacting) return;
		let captured = "";
		void runSubmission(target, () => ({ type: "thinking", content: { text: captured = capture(), images: [] } }), () => !busyRef.current && JSON.stringify(activeProblemOccurrenceOf(submissionLive.current.nativeMessages)) === JSON.stringify(target.problem.occurrence), async (prepared, attempt) => {
			if (prepared.type !== "thinking") return false;
			if (!prepared.content.text.trim() && !prepared.content.images.length) throw new Error("Thinking text or images are required. Your input has been kept.");
			attempt.deliver();
			return send({ type: "thinking", problemCallId: target.problem.occurrence.toolCallId, occurrence: target.problem.occurrence, text: prepared.content.text, ...(prepared.content.images.length ? { images: prepared.content.images.map(image => ({ ...image })) } : {}) }, () => { clear(captured); attempt.accepted(); }, undefined, attempt.refused);
		});
	};
	const pluginProblemTarget = (): Extract<PluginSubmissionTarget, { type: "plugin-problem-submission" }> | undefined => {
		const original = activeProblem?.pluginProblem, occurrence = activeProblemOccurrence;
		if (!surfaceTarget || !original || !occurrence) return;
		return { type: "plugin-problem-submission", sessionId: chatId, sessionKind: "practice", surfaceTarget,
			channels: ["submission", "thinking"], problem: { problemId: original.problemId, occurrence, pluginId: original.pluginId, typeId: original.typeId, contractVersion: original.contractVersion, label: original.label, statement: original.input.statement } };
	};
	const preparePluginProblem: PreparePluginProblemSubmission = (capture, isCurrent, onAccepted) => {
		const original = activeProblem?.pluginProblem, occurrence = activeProblemOccurrence, target = pluginProblemTarget();
		if (!target || !original || !occurrence || busyRef.current || compacting) return Promise.resolve(false);
		return runSubmission(target, () => {
			const raw = capture();
			return { type: "plugin-problem-submission", submission: raw.submission, submissionImages: [], thinking: { text: raw.thinking ?? "", images: [] } };
		}, () => isCurrent() && !busyRef.current && activeProblemOf(submissionLive.current.nativeMessages)?.pluginProblem?.problemId === original.problemId, async (prepared, attempt) => {
			if (prepared.type !== "plugin-problem-submission") return false;
			const images = { ...(prepared.submissionImages.length ? { submission: prepared.submissionImages } : {}), ...(prepared.thinking.images.length ? { thinking: prepared.thinking.images } : {}) };
			attempt.deliver();
			return send({ type: "plugin-problem-submission", problemId: original.problemId, occurrence, submission: prepared.submission as Extract<ChatInput, { type: "plugin-problem-submission" }>["submission"],
				thinking: prepared.thinking.text, ...(Object.keys(images).length ? { images } : {}),
			}, () => { onAccepted(); attempt.accepted(); }, undefined, attempt.refused);
		});
	};
	const pluginQuestionTarget = (): Extract<PluginSubmissionTarget, { type: "plugin-question-answer" }> | undefined => {
		if (!surfaceTarget || !pendingPlugin) return;
		const original = pendingPlugin;
		return { type: "plugin-question-answer", sessionId: chatId, sessionKind: kind === "practice" ? "practice" : "teaching", surfaceTarget,
			channels: ["answer", ...(original.showThinking ? ["thinking" as const] : []), ...(requiresReveal ? ["readingThinking" as const] : [])],
			question: { questionId: original.questionId, occurrence: original.occurrence, pluginId: original.pluginId, typeId: original.typeId, contractVersion: original.contractVersion, label: original.label, variant: original.variant, showThinking: original.showThinking },
		};
	};
	const preparePluginQuestion: PreparePluginQuestionSubmission = (capture, isCurrent) => {
		const target = pluginQuestionTarget();
		if (!target || !pendingPlugin || busyRef.current || compacting) return Promise.resolve(false);
		const original = pendingPlugin;
		return runSubmission(target, () => {
			const raw = capture();
			return { type: "plugin-question-answer", answer: raw.answer, answerImages: [], thinking: { text: raw.thinking ?? "", images: [] }, readingThinking: { text: raw.readingThinking ?? "", images: [] } };
		}, () => isCurrent() && !busyRef.current && pendingPluginQuestionOf(submissionLive.current.nativeMessages)?.questionId === original.questionId, async (prepared, attempt) => {
			if (prepared.type !== "plugin-question-answer") return false;
			const images = submissionImages(prepared, target.channels);
			attempt.deliver();
			return send({ type: "plugin-question-answer", questionId: original.questionId, occurrence: original.occurrence, answer: prepared.answer as Extract<ChatInput, { type: "plugin-question-answer" }>["answer"],
				...(original.showThinking ? { thinking: prepared.thinking.text } : {}), ...(requiresReveal ? { readingThinking: prepared.readingThinking.text } : {}), ...(images ? { images } : {}),
			}, attempt.accepted, undefined, attempt.refused);
		});
	};
	const prepareText = (supplied?: string, openingAccepted?: () => void, beforePost?: (captured: string) => boolean) => {
		const target = textTarget();
		if (!target || pendingRef.current || pluginOwnsDock || activeProblemRef.current || compacting) return Promise.resolve(false);
		if (!busyRef.current && zeroKeys) { setSetupOpen(true); return Promise.resolve(false); }
		if (!busyRef.current && selectedModelUnavailable(catalog, selectedModel)) { openModelPicker(); return Promise.resolve(false); }
		let captured = "", capturedRevision = 0;
		return runSubmission(target, () => { capturedRevision = composerEditRevision.current; return { type: "text", content: { text: captured = supplied ?? textRef.current.trim(), images: [] } }; }, () => submissionLive.current.ready && !pendingQuestionOf(submissionLive.current.nativeMessages) && !pendingPluginQuestionOf(submissionLive.current.nativeMessages) && !activeProblemOf(submissionLive.current.nativeMessages), async (prepared, attempt) => {
			if (prepared.type !== "text") return false;
			if (!prepared.content.text.trim() && !prepared.content.images.length) throw new Error("Message text or images are required. Your input has been kept.");
			if (beforePost && !beforePost(captured)) { attempt.cancel(); return false; }
			draftRef.current = captured;
			const accepted = () => { if (composerEditRevision.current === capturedRevision && textRef.current.trim() === captured) applyText(""); openingAccepted?.(); attempt.accepted(); };
			attempt.deliver();
			if (busyRef.current) return steer(prepared.content.text, prepared.content.images, accepted, attempt.refused);
			return send({ type: "text", text: prepared.content.text, ...(prepared.content.images.length ? { images: prepared.content.images.map(image => ({ ...image })) } : {}) }, accepted, undefined, attempt.refused);
		});
	};

	const deliverOpeningPrompt = (prompt: string, captureNative = false) => {
		let submitted = prompt;
		openingDraftRef.current = prompt;
		// Persiste la incertidumbre ANTES del POST: otro montaje debe restaurar, no
		// competir con la petición que aún está llegando. Sin almacenamiento no hay envío automático.
		if (!stashOpeningPrompt(chatId, prompt, true)) {
			applyText(prompt);
			setOpeningError(true);
			return;
		}
		setOpeningError(false);
		draftRef.current = prompt; // El flujo existente del 503 también debe restaurarlo.
		void prepareText(captureNative ? undefined : prompt, () => {
			clearOpeningPrompt(chatId);
			openingDraftRef.current = null;
			if (draftRef.current === submitted) draftRef.current = null;
		}, captured => {
			submitted = captured; openingDraftRef.current = captured;
			const saved = stashOpeningPrompt(chatId, captured, true);
			if (!saved) setOpeningError(true);
			return saved;
		}).then(accepted => {
			if (!accepted && openingMountedRef.current && openingDraftRef.current === prompt && !textRef.current) {
				applyText(prompt);
			}
		});
	};

	const sentInitial = useRef(false);
	useEffect(() => {
		if (sentInitial.current || !surfaceTarget) return;
		return scheduleOpeningSubmission(
			() => !sentInitial.current && submissionMounted.current && submissionLive.current.surfaceTarget === surfaceTarget && !!findSurfaceBoundary(surfaceTarget),
			() => {
				sentInitial.current = true;
				const entry = readOpeningPromptEntry(chatId);
				const prompt = initialPrompt || entry?.text; // Los enlaces antiguos siguen funcionando.
				if (!initialPromptOwed(initialMessages, prompt)) {
					if (initialMessages.some(m => m.role === "user" || m.role === "assistant")) clearOpeningPrompt(chatId);
					return;
				}
				openingDraftRef.current = prompt!;
				if (entry?.attempted || initiallyInFlight) {
					applyText(prompt!); // Inicio interrumpido: el alumno vuelve a enviar de forma explícita.
					return;
				}
				deliverOpeningPrompt(prompt!);
			},
		);
	}, [chatId, initialPrompt, initialMessages, initiallyInFlight, surfaceTarget, deliverOpeningPrompt, applyText]);

	useEffect(() => {
		if (!hasConfirmedConversation) return;
		clearOpeningPrompt(chatId);
		// Una lectura canónica posterior puede confirmar un acuse perdido. Limpia
		// solo el borrador recuperado sin cambios, nunca el trabajo más nuevo del alumno.
		const opening = openingDraftRef.current;
		if (opening !== null && textRef.current === opening) applyText("");
		if (draftRef.current === opening) draftRef.current = null;
		openingDraftRef.current = null;
		setOpeningError(false);
	}, [chatId, hasConfirmedConversation, applyText]);

	// EL RECHAZO BYOK (responsable, 2026-09-22): un envío que recibe el sobre 503
	// models_not_configured del servidor se renderiza como el FLUJO DE CONFIGURACIÓN, nunca
	// como el aviso de error. La barrera rechaza ANTES de la persistencia anticipada,
	// así que el registro del servidor es la verdad menos el envío rechazado — el
	// mensaje optimista es un huérfano que vuelve A CASA: vuelve a leer el registro,
	// quita el huérfano, devuelve el borrador al compositor y abre el
	// diálogo (los niveles prerrellenados llevan su elección; los no fijados, las marcas
	// "needed"). El borrador se queda en el compositor hasta que el alumno
	// lo vuelve a enviar (decisión del responsable 2026-10-09).
	useEffect(() => {
		if (!error) return;
		const missing = parseModelsRefusal(error.message);
		// El gemelo del rechazo por clave (oleada de cero claves): un modelo fijado cuya
		// clave de proveedor ha desaparecido también restaura el borrador. Con otro proveedor
		// conectado, la reparación corresponde al selector normal de la sesión actual;
		// en otro caso, la configuración deriva su fase exclusiva de proveedor/carga.
		const keyRefused = parseProviderKeyRefusal(error.message);
		if (!missing && !keyRefused) return; // un error real conserva el aviso honesto
		// EL ORDEN IMPORTA: clearError() cambia la propia dependencia de este efecto (`error`)
		// y cancelaría el trabajo en curso de más abajo — así que cerrar el aviso,
		// restaurar el borrador y abrir el diálogo ocurren JUNTOS después de
		// volver a leer el registro (la verdad honesta menos el envío rechazado).
		let cancelled = false;
		void (async () => {
			try { await readRecord({ isCurrent: () => !cancelled }); }
			catch { /* el tratamiento del rechazo sigue restaurando el borrador si falla la lectura */ }
			if (cancelled) return;
			if (draftRef.current !== null) {
				if (!textRef.current) applyText(draftRef.current);
				draftRef.current = null;
			}
			clearError();
			if (keyRefused && catalogRef.current?.providers.some((p) => p.keyPresent)) openModelPicker();
			else setSetupOpen(true);
		})();
		return () => {
			cancelled = true;
		};
		// (readRecord/clearError son estables por instancia de useChat — el par de
		//  dependencias [error, chatId] es de lo que depende realmente el flujo.)
	}, [error, chatId, readRecord]);
	// Dictado por voz (oleada STT, 2026-09-17): los finales se añaden al final del
	// texto actual (la página es responsable del separador, al estilo de dictate-flush);
	// los intermedios aparecen como fantasma en la ranura central de la barra de estadísticas, junto al medidor.
	// TAB RECORRE LOS CAMPOS DEL CHAT (responsable, ronda de teclado 2026-10-06):
	// razonamiento de lectura → el campo del dock activo → el compositor, en
	// orden visual, solo hacia delante y dando la vuelta; Tab desde cualquier otro sitio
	// enfoca el primer campo vivo (navegar HACIA DENTRO). Se recogen del DOM vivo
	// en el momento del evento — los docks se montan y desmontan, las refs quedarían
	// obsoletas. El reclamo filas↔razonamiento del dock de quiz nunca llega aquí.
	const cycleChatFields = useCallback((): readonly HTMLElement[] => {
		const pick = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
		return [
			...pick('[data-testid="reading-thinking-field"] [data-file-path-input]'),
			...pick('[data-testid="question-dock"] [data-file-path-input]'),
			...pick('[data-testid="practice-dock"] [data-file-path-input]'),
			...pick('[data-testid="composer"] [data-file-path-input]'),
		];
	}, []);
	useFieldCycle(cycleChatFields);
	const recording = useDictation({
		// Primero la ref (ver textRef): la unión se calcula a partir del espejo, para que un
		// envío que se reanuda tras `await finish()` lea la cola dictada.
		append: (t) => { if (!pluginOwnsDock) applyText(joinDictation(textRef.current, t)); },
		disabled: pluginOwnsDock && !pluginMicAvailable,
	});
	const dictation: Dictation = { ...recording,
		phase: recording.destinationId === "main" ? recording.phase : "idle",
		active: recording.destinationId === "main" && recording.active,
		error: recording.destinationId === "main" ? recording.error : null,
		blocked: recording.destinationId !== "main" && recording.active,
	};
	/* Cuando termina una ejecución de dictado, el compositor desnudo toma el foco
	 * (responsable 2026-10-01) — las manos ya están en el teclado por la parada.
	 * Solo en el flanco de bajada de `active` (idle→idle nunca enfoca), y SOLO el
	 * compositor: con una pregunta pendiente el Composer está desmontado, la ref
	 * es null y el campo de razonamiento se deja en paz a propósito. */
	const dictationWasActiveRef = useRef(false);
	const composerInputRef = useRef<HTMLDivElement>(null);

	// CITE (2026-10-31): texto del tutor seleccionado → un chip de cita en el
	// compositor y después su ventana de comentario. El elemento de scroll de la transcripción
	// llega tarde (lo engancha StickToBottom), así que se comunica hacia arriba.
	const [transcriptElement, setTranscriptElement] = useState<HTMLElement | null>(null);
	const [citationEdit, setCitationEdit] = useState<CitationEditTarget | null>(null);
	const lastCiteInputRef = useRef<HTMLElement | null>(null);
	const citeInput = useCallback(() => {
		const fields = cycleChatFields();
		return fields.find((field) => field === lastCiteInputRef.current) ?? fields[0] ?? composerInputRef.current;
	}, [cycleChatFields]);
	useEffect(() => {
		const remember = (event: FocusEvent) => {
			const input = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-path-input]") : null;
			if (input && cycleChatFields().includes(input)) lastCiteInputRef.current = input;
		};
		document.addEventListener("focusin", remember);
		return () => document.removeEventListener("focusin", remember);
	}, [cycleChatFields]);
	const citeAction = useMemo(
		() => createCiteAction({ chatId, composer: citeInput, openEditor: setCitationEdit }),
		[chatId, citeInput],
	);
	// Un acompañante duradero por cada explicación/comprobación, en la enseñanza Y en la práctica.
	// Las peticiones principales añaden los intercambios en bruto nuevos de cada hilo; cerrar solo oculta la interfaz.
	const workingRef = useRef("");
	const sideThread = useSideThread(chatId, nativeMessages, () => {
		// Los editores de los plugins son responsables de valores opacos de respuesta/envío. Solo el
		// Thinking del host es contexto seguro para el auxiliar; lee su borrador vivo sin examinar el renderizador.
		if (pendingPlugin) return pendingPlugin.showThinking ? pluginQuestionDraft(pendingPlugin).thinking : "";
		if (activeProblem?.pluginProblem) return pluginProblemDraft(activeProblem.pluginProblem).thinking;
		return workingRef.current;
	});
	const sideNavigation = useRef(0);
	const closeSideThread = useCallback(() => {
		const id = sideThread.state?.threadId;
		if (!id) return;
		const navigation = ++sideNavigation.current;
		void recording.finishFor(`side:${id}`).then(() => {
			if (navigation === sideNavigation.current) sideThread.close(id);
		});
	}, [recording.finishFor, sideThread.state?.threadId, sideThread.close]);
	const openSideThread = useCallback((args: SideThreadOpenArgs) => {
		const navigation = ++sideNavigation.current;
		const current = sideThread.state;
		const source = args.sourceMessageId ?? args.passage?.sourceMessageId ?? (args.questionCallId ? nativeMessages.find((message) => message.role === "assistant" &&
			message.content.some((block) => block.type === "toolCall" && block.id === args.questionCallId))?.id : undefined);
		if (current && current.segmentId !== sideSegmentId(nativeMessages, source) && recording.active && recording.destinationId === `side:${current.threadId}`) {
			void recording.finishFor(`side:${current.threadId}`).then(() => {
				if (navigation === sideNavigation.current) sideThread.open(args);
			});
		} else sideThread.open(args);
	}, [nativeMessages, recording.active, recording.destinationId, recording.finishFor, sideThread.open, sideThread.state]);
	const goToCurrentSideStep = sideThread.state && sideThread.currentSegmentId && sideThread.state.segmentId !== sideThread.currentSegmentId
		? () => openSideThread({ sourceMessageId: sideThread.currentSegmentId!, anchor: sideThread.state!.anchor }) : undefined;
	const sideDictationFor = (id: string) => {
		const destinationId = `side:${id}`;
		const owns = recording.destinationId === destinationId;
		return { phase: owns ? recording.phase : "idle" as const, active: owns && recording.active,
			blocked: !owns && recording.active, error: owns ? recording.error : null, levelRef: recording.levelRef,
			toggle: () => recording.toggleFor({ id: destinationId, append: (text) => sideThread.saveDraft(id, joinDictation(sideThread.draftFor(id), text), true) }),
			finish: () => recording.finishFor(destinationId) };
	};
	const renderSideEntry = (sourceMessageId?: string) => {
		if (!sourceMessageId) return null;
		const hasHistory = sideThread.threads.some((thread) => thread.anchor.messageId === sourceMessageId && thread.messages.length > 0);
		return <div className="mt-1 flex justify-end">
			<Button type="button" variant="ghost" size="icon-xs" data-testid="side-conversation-button" data-side-segment-id={sourceMessageId}
				data-has-history={hasHistory} aria-label={hasHistory ? "Open side conversation" : "Ask a side question"}
				title={hasHistory ? "Open side conversation" : "Ask a side question"}
				className={hasHistory ? "border border-border/60 text-muted-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}
				onClick={(event) => openSideThread({ sourceMessageId, anchor: { kind: "element", element: event.currentTarget } })}>
				<MessageCircleQuestionIcon aria-hidden className="size-3.5" fill="currentColor" fillOpacity={hasHistory ? 0.12 : 0} />
			</Button>
		</div>;
	};
	const sideThreadOpenRef = useRef(false);
	sideThreadOpenRef.current = sideThread.state !== null;
	const closeSideThreadRef = useRef(closeSideThread);
	closeSideThreadRef.current = closeSideThread;
	const toggleQuestionThread = useCallback(() => {
		if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
		if (sideThreadOpenRef.current) closeSideThreadRef.current();
		else openSideThread({ anchor: { kind: "composer" }, questionCallId: pendingRef.current?.toolCallId });
	}, [controller, openSideThread]);
	useEffect(() => {
		window.addEventListener(kbdEventForChat("toggle-question-thread"), toggleQuestionThread);
		return () => window.removeEventListener(kbdEventForChat("toggle-question-thread"), toggleQuestionThread);
	}, [toggleQuestionThread]);
	// Avanzar la lección no cierra ni desactiva una conversación antigua.
	const sideActions = useMemo(() => createSideQuestionActions({ open: openSideThread }), [openSideThread]);
	const selectionActions = useMemo(() => [citeAction, ...sideActions], [citeAction, sideActions]);
	const router = useRouter();
	const transcriptElementRef = useRef<HTMLElement | null>(null);
	transcriptElementRef.current = transcriptElement;
	const citationActions = useMemo<CitationActions>(() => ({
		editComment: (citation, source) => setCitationEdit({ citation, link: source.link, start: source.start, host: source.host, input: source.host.closest<HTMLElement>("[data-file-path-input]") ?? undefined }),
		openSource: (citation) => {
			const context = scrollContextRef.current;
			revealCitationSource({
				transcript: transcriptElementRef.current,
				scroll: context ? { scrollRef: context.scrollRef, stopScroll: context.stopScroll } : null,
				citation,
				currentChatId: chatId,
				navigate: (href) => router.push(href),
			});
		},
	}), [chatId, router]);
	useEffect(() => {
		if (dictation.active) {
			dictationWasActiveRef.current = true;
		} else if (dictationWasActiveRef.current) {
			dictationWasActiveRef.current = false;
			// No robes el foco a un auxiliar ni a un responsable de la interacción más nuevo.
			if (!document.activeElement?.closest('[data-testid="side-thread"]') && isInteractionScopeEligible(composerInputRef.current, controller)) composerInputRef.current!.focus();
		}
	}, [dictation.active, controller]);

	// Las tareas nunca bloquean el compositor (contracts.ts "THE ASYNC PROTOCOL" §4): las
	// herramientas de tareas se resuelven con un acuse a mitad de turno, así que el alumno puede intervenir mientras
	// se ejecutan los subagentes — es una funcionalidad, no una carrera: el proceso de despertar encola las reorientaciones
	// hasta que termina el turno actual. Solo una PREGUNTA pendiente o un turno en
	// curso (turno de despertar del cliente o del servidor) bloquea el envío.
	// Un dictado VIVO también hace que el compositor se pueda enviar (responsable 2026-10-01):
	// el texto hablado se aplaza en el búfer de la ejecución — Enter debe poder
	// disparar el envío que primero termina el dictado (ver onSend), no quedar bloqueado por un
	// textarea vacío. Si no se dijo nada, el envío es una operación nula inofensiva.
	// Reorientación (2026-10-03): un turno en curso ya no bloquea el compositor —
	// Enter mientras se ejecuta un turno lo REORIENTA (la cola discreta encima del compositor);
	// una pregunta pendiente sigue siendo la responsable de la interacción (el dock sustituye al
	// compositor, y de todos modos no hay ningún turno vivo que reorientar — las preguntas terminan
	// los turnos).
	// Compactación (ronda 14 del responsable): el estado de EJECUCIÓN — compaction-changed
	// lo cambia; las rutas de envío, canSend y los docks dependen de él (el
	// mutex del registro del servidor es la barrera estructural; esto es la
	// indicación).
	const [compacting, setCompacting] = useState(initiallyCompacting);
	submissionLive.current.ready = !compacting && reconciliation === "ready";
	// Una respuesta fallida del modelo (issue #110): Reintentar conserva la entrada guardada
	// y el trabajo completado, sin otro mensaje del alumno. También se ofrece desde
	// "error": un stream cortado deja ahí al modelo, y send()
	// se recupera de ello. Una compactación posterior exige en cambio una entrada nueva.
	const retryable = !pluginOwnsDock && (status === "ready" || status === "error") && !busy && !compacting && endsInFailedTurn(nativeMessages);
	const retryFailedTurn = () => retryFailedResponse(send, draftRef);
	const sendAllowed = !pluginOwnsDock && reconciliation === "ready" && !pending && !activeProblem && !compacting && !submissionRunner.occupied;
	const pendingTextTarget = textTarget();
	const pendingTextInput = !!pendingTextTarget && !!pluginManager?.hasPendingSubmissionInput(pendingTextTarget);
	const pendingThinkingTarget = thinkingTarget();
	const pendingThinkingInput = !!pendingThinkingTarget && !!pluginManager?.hasPendingSubmissionInput(pendingThinkingTarget);

	/* LA PAUSA DE LA PRÁCTICA (ronda 16 del responsable): entre problemas — tipo
	 * práctica, nada activo, nada en curso y al menos un problema planteado
	 * alguna vez (en una sesión nueva se debe el turno de apertura, no el
	 * pasar al siguiente). Enter con el compositor vacío y el chip Next dependen de esto. */
	const nextReady =
		kind === "practice" &&
		!pending &&
		!pluginOwnsDock &&
		!activeProblem &&
		!compacting &&
		!busy &&
		nativeMessages.some(
			(m) => m.role === "assistant" && m.content.some(
					(b, contentIndex) => b.type === "toolCall" && !!practiceProblemForCall(nativeMessages, { messageId: m.id, contentIndex, toolCallId: b.id, toolName: b.name }),
				),
		);
	const sendNext = useCallback(() => {
		if (!nextReady || submissionRunner.occupied) return;
		if (pendingTextInput) { void prepareText(); return; }
		void send({ type: "next" });
	}, [nextReady, send, submissionRunner, pendingTextInput]);

	/* ENTER DESDE CUALQUIER SITIO (ajuste de la ronda 16 del responsable, 2026-10-06 —
	 * primero el teclado): pasar al siguiente no debe exigir el foco en el compositor. El
	 * Enter a nivel de window (excluidas las superficies de escritura y los botones — un
	 * compositor/botón enfocado conserva su propio carril, así que no hay doble disparo)
	 * dispara la señal con el foco en el body, tras un scroll, desde cualquier sitio. sendNext
	 * se protege a sí mismo con nextReady, así que el oyente es inerte fuera de la
	 * pausa — para entonces los oyentes montados en los docks ya no están (los docks se desmontan
	 * cuando no hay nada activo; los dos nunca coinciden). */
	useEnterSubmits(sendNext, sessionFindScopeRef);

	const syncFromServer = useCallback(async () => {
		const record = await readRecord().catch(() => undefined);
		if (!record) return;
		if (Array.isArray(record.turns)) setTurns(record.turns);
		setPricing(record.pricing);
		// La frontera de continuación (protocolo de contracts.ts §4): el resultado de una tarea
		// que llega al registro deja al agente debiendo una continuación — el
		// registro TERMINA en resultados sin consumir, el dock no tiene ninguna pregunta y
		// no se ejecuta nada. El plegado nativo (needsContinuation) es la antigua comprobación
		// lastAssistantMessageIsCompleteWithToolCalls del SDK.
		// La verdad actual del modelo también protege los fallos conservados/vivos: la sincronización
		// canónica nunca debe sustituir automáticamente una respuesta que no se pudo guardar.
		continueIfOwed(record.messages);
	}, [readRecord, continueIfOwed]);

	// La otra mitad del terminal asentado (oleada de reenganche del stream): el
	// transporte resolvió turn-settled — no hay ningún turno en ejecución y el registro está
	// al día. Quita el estado ocupado alternativo y adopta el registro (su
	// comprobación de continuación dispara el siguiente turno pendiente, exactamente como
	// siempre hizo la rama de asentamiento del sondeo).
	reattachSettledRef.current = () => {
		setTurnInFlight(false);
		void syncFromServer();
	};

	// ── Adopción del registro solo por anexado (reglas básicas del responsable, 2026-09-15) ──
	// El contenido entregado al registro en el servidor — artefactos de
	// subagentes, notas de aborto — debe hacerse visible en el
	// momento en que se persiste, también a mitad de turno: va entre mensajes, y
	// nada de un turno en ejecución debería ocultarlo. La sincronización completa de la instantánea
	// a mitad del stream está prohibida (rompe la fusión de continuación en su sitio del
	// SDK — la lección de la instantánea obsoleta), así que aquí la adopción es SOLO POR ANEXADO
	// (el adoptRecord del hook de sesión): inserta los ids nuevos del registro en su orden
	// canónico, nunca reescribe uno local y deja la cola en curso al final. La
	// syncFromServer completa sigue siendo la red en reposo (reordenación, bloques de plan, turnos).
	const adoptAppendOnly = useCallback(async () => {
		try {
			await readRecord({ adoption: "append" });
		} catch {
			/* transitorio — la sincronización completa en reposo es la red */
		}
	}, [readRecord]);

	// Ventana de inicio de turno: el servidor inserta las reorientaciones reclamadas justo después de
	// nuestro mensaje saliente, ANTES de que el stream produzca nada — así que una ventana acotada y
	// que termina sola de tres lecturas del registro (400 ms/1 s/2 s) atrapa
	// la inserción y muestra el marcador durante el turno, y luego para. Ningún
	// sondeo permanente — la ventana existe solo esos segundos. (Los empujones al dock
	// que vivían aquí murieron en S5: las escrituras de despacho anuncian jobs-changed
	// desde el almacén, y la extracción anuncia activity-changed en setPhase.)
	const turnStartStatusRef = useRef(status);
	// La ventana debe sobrevivir al cambio submitted→streaming (el stream empieza
	// en bastante menos de 400 ms), así que esta ref protege los temporizadores — se sueltan al
	// desmontar y en otro caso se dejan en paz: la ventana termina sola a los 2 s.
	const adoptionWindowOpenRef = useRef(false);
	const turnStartTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => {
		const was = turnStartStatusRef.current;
		turnStartStatusRef.current = status;
		if (was === "submitted" || status !== "submitted") return;
		// Acaba de empezar un turno (el estado pasó de ready a submitted): abre la
		// ventana acotada de adopción.
		adoptionWindowOpenRef.current = true;
		const timers = [400, 1000, 2000].map((ms) =>
			setTimeout(() => {
				if (adoptionWindowOpenRef.current) {
					void adoptAppendOnly();
				}
			}, ms),
		);
		// Aquí no hay limpieza a propósito: este efecto se vuelve a ejecutar con cada cambio
		// de estado, lo que cancelaría la ventana en submitted→streaming.
		timers.forEach((t) => {
			turnStartTimerRefs.current.push(t);
		});
	}, [status, adoptAppendOnly]);
	useEffect(() => {
		const timers = turnStartTimerRefs;
		return () => {
			adoptionWindowOpenRef.current = false;
			timers.current.forEach(clearTimeout);
			timers.current = [];
		};
	}, []);

	// La ventana del plan vivo (oleada 4): la abren cualquier bloque de plan de la transcripción,
	// el chip de plan de la barra superior y la nota al margen de la franja del dock.
	const [planOpen, setPlanOpen] = useState(false);
	// Presencia real del plan — es la barrera del flanco clicable de la nota al margen. Un
	// elemento JSX siempre es verdadero; usar solo el nodo como barrera montaba un botón fantasma
	// (invisible, clicable) abajo a la derecha siempre que había una pregunta
	// pendiente y aún no había plan (informe del responsable, ronda de interfaz 2026-10-01).
	const hasPlan = useMemo(() => planExists(messages), [messages]);
	// La cadena de refresco del anillo de cobertura (rediseño de la UX de extracción): se incrementa
	// al asentarse el turno — el momento en que cambia la masa sin cubrir de esta sesión.
	const [coverageTick, setCoverageTick] = useState(0);
	// El foco de mermaid (oleada de fundido del cromo, 2026-09-19): el botón de ampliar de
	// md-blocks registra aquí el código del diagrama; el overlay (y la ventana del
	// plan) se montan DENTRO del div del área de la sesión — los dos tienen ámbito de sesión, así que
	// la barra de arrastre sigue nítida y arrastrable mientras un foco ocupa el área.
	const [mermaidFocus, setMermaidFocus] = useState<string | null>(null);
	// Foco de figura (2026-10-07): el botón de pantalla completa de la tarjeta de figura — el mismo
	// envoltorio de overlay que mermaid, pero con el svg en bruto + el estado de inversión
	// de la tarjeta, para que la vista a pantalla completa sea fiel a la tarjeta con el conmutador.
	const [figureFocus, setFigureFocus] = useState<{ svg: string; inverted: boolean } | { image: SessionImage } | null>(null);

	// Espejos de los overlays para la barrera de Esc por capas (responsable 2026-10-04): el
	// manejador de lh:kbd-abort-turn los lee en el momento del EVENTO — se declaran aquí
	// junto a sus estados y se consumen más abajo, donde viven los estados.
	const mermaidFocusRef = useRef(mermaidFocus);
	mermaidFocusRef.current = mermaidFocus;
	// El foco de figura va en la capa de mermaid en la barrera de Esc — la misma
	// clase de overlay (foco de diagrama con ámbito de sesión; el propio overlay reclama el Esc
	// a nivel de documento); la cadena de window debe quedarse fuera.
	const figureFocusRef = useRef(figureFocus);
	figureFocusRef.current = figureFocus;
	const planOpenRef = useRef(planOpen);
	planOpenRef.current = planOpen;
	const setupOpenRef = useRef(setupOpen);
	setupOpenRef.current = setupOpen;
	// El plan vivo de la sesión (alimenta el chip de la barra superior; la nota al margen
	// deriva el suyo de la misma transcripción).
	const planTree = useMemo(() => latestTree(messages), [messages]);

	// ── Uso de la sesión (barra de estadísticas de la oleada 4) ──
	// El canal del dinero: el registro de turnos del registro y la proyección de precios de Pi
	// que hace el servidor al leer. Se siembra una vez al montar (la página no trae los turnos),
	// se refresca cuando el stream local se asienta (cada turno se anexa al registro
	// en el servidor) y lo mantiene al día syncFromServer siempre que ya
	// lee el registro. Sin turnos todavía → la barra muestra "—" en todas partes.
	const [turns, setTurns] = useState<TurnUsage[]>([]);
	const [pricing, setPricing] = useState<SessionPricing | undefined>();
	// El estado del control de modelo por chat (model-picker escribe con PUT; el
	// registro es la fuente de verdad, elevada aquí para que la barra de estadísticas se vuelva a renderizar).
	// La altura de la cola reservada del dock (la comunica DockOverlay; el espaciador al
	// final de la transcripción la renderiza). Vive aquí porque el espaciador está
	// dentro del contenedor de scroll, mientras que el dock se superpone FUERA de él — dos padres.
	// 208 ≈ degradado(96) + bloque del compositor(~112): la estimación para SSR/antes de la
	// hidratación, para que el pintado estático tenga una cola razonable. El primer efecto de
	// layout la sustituye por la medida real antes de pintar.
	const [dockReserve, setDockReserve] = useState(208);
	const syncTurns = useCallback(async () => {
		try {
			const record = await readRecord({ adoption: "none" });
			if (!record) return;
			if (Array.isArray(record.turns)) setTurns(record.turns);
			setPricing(record.pricing);
		} catch {
			// fallo transitorio: las estadísticas se quedan con las últimas cifras conocidas
		}
	}, [readRecord]);
	useEffect(() => {
		void syncTurns();
	}, [syncTurns]);
	// Cuando termina el turno del propio alumno, el registro tiene una entrada nueva — y el
	// asentamiento posterior al turno (la vigilancia ADELGAZADA — arquitectura push S3,
	// 2026-10-02): nuestro propio stream acaba de terminar. Solo dos acciones LOCALES
	// instantáneas — la relectura solo de los turnos trae la entrada del registro mientras el
	// persist/endTurn del servidor va milisegundos por detrás, y el anillo de cobertura vuelve a leer
	// (los mensajes de este turno acaban de sumarse a la masa sin cubrir). El BUCLE DE
	// ADOPCIÓN y la VIGILANCIA DEL TRASPASO que vivían aquí están RETIRADOS: un
	// turno iniciado por el servidor (el traspaso sondeo→enseñanza, el despertar de una tarea, otra
	// pestaña) ahora se ANUNCIA en el canal de eventos — la suscripción a turn-started
	// (debajo del sondeo de tareas) se engancha a él en vivo. Ninguna ventana de sondeo puede
	// caducar; la clase de congelaciones ha desaparecido.
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const transitioned = prevStatusRef.current !== "ready" && status === "ready";
		// En todas las rutas (el antiguo retorno anticipado se lo saltaba en la rama de
		// transición — el defecto de redisparar con el cambio de dependencias, corregido en S3).
		prevStatusRef.current = status;
		if (!transitioned) return;
		// inmediato: relectura solo de los turnos — la barra de estadísticas se actualiza aunque
		// el persist/endTurn del servidor vaya milisegundos por detrás del cliente
		void syncTurns();
		// El anillo de cobertura también vuelve a leer al asentarse el turno (rediseño de la UX de
		// extracción, 2026-09-24); el propio sondeo de ejecución del anillo se ocupa de las ejecuciones.
		setCoverageTick((t) => t + 1);
		// CANONIZACIÓN (arreglo B, el fallo del mensaje anterior duplicado, 2026-10-02):
		// turn-settled de NUESTRO PROPIO turno llega con el stream aún abierto
		// (endTurn emite desde onFinish antes de que termine la respuesta, así que la
		// trama SSE siempre gana a [DONE]) — el manejador de más abajo no puede sincronizar
		// ahí, así que marca un indicador, y ESTE cambio lo consume: el registro
		// refleja la verdad duradera (un asentamiento fallido conserva su aviso,
		// no su respuesta sin guardar), así que sustituir la vista absorbe en la base las copias
		// con id c_ que llegaron por stream en la cola, con sus ids del servidor. Sin
		// esto, la cola conservaba esas copias para siempre y la ventana de adopción de
		// reorientaciones del siguiente envío las renderizaba por segunda vez. Esta sincronización no puede
		// perderse el traspaso del despertar: el despertar solo se dispara tras las barreras de
		// reposo + el margen (≥750 ms después de este cambio), así que su evento turn-started
		// llega a una vista en reposo y ya canónica, y se engancha con normalidad.
		if (settleAnnouncedRef.current) {
			settleAnnouncedRef.current = false;
			void syncFromServer();
		}
		// (Los empujones de descubrimiento de la extracción que vivían aquí murieron en S5: el
		// proceso anuncia cada fase en el canal de eventos.)
	}, [status, syncTurns, syncFromServer]);

	// Un stream que murió EN PLENO VUELO (red): el ejecutor desacopló el turno
	// de su vista, así que el turno del servidor SIGUE ejecutándose detrás del aviso de error —
	// vuelve a entrar en la vigilancia del turno en curso (el sondeo alternativo de 1500 ms lo
	// adopta al asentarse) en vez de dejar la sesión a ciegas hasta que lo repare el
	// reintento con fusión del 409 del siguiente envío. Una comprobación del registro por cada transición de error.
	const prevErrorStatusRef = useRef(status);
	useEffect(() => {
		const was = prevErrorStatusRef.current;
		prevErrorStatusRef.current = status;
		if (was === "error" || status !== "error") return;
		let cancelled = false;
		void (async () => {
			try {
				const record = await readRecord({ adoption: "none", isCurrent: () => !cancelled });
				if (!record) return;
				if (record.turnInFlight === true) setTurnInFlight(true);
				else void syncFromServer();
			} catch {
				/* transitorio — el aviso se mantiene; el reintento con fusión del siguiente envío lo repara */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [status, readRecord, syncFromServer]);

	// ── Observabilidad central de las tareas (contracts.ts "THE ASYNC PROTOCOL" §4) ──
	// UNA lectura de /api/jobs alimenta todas las superficies de tareas (las tarjetas de
	// despacho de la transcripción, el panel de subagentes) y vuelve a sincronizar la transcripción exactamente una vez
	// cuando se asienta una tarea. PUSH (arquitectura S4, 2026-10-02): el almacén
	// anuncia cada escritura de tarea en el canal de eventos; el sondeo por intervalos y
	// sus barreras pollMs/jobPartCount están RETIRADOS. La vista lee una vez al
	// montar, una vez por cada anuncio de jobs-changed (con debounce al final — la ejecución
	// de un subagente escribe ráfagas de líneas de actividad; 250 ms las agrupa a la cadencia
	// del antiguo sondeo de 1 s o por debajo) y una vez al resincronizar el canal.
	//
	// Un asentamiento ya no implica que el registro esté completo: la AGRUPACIÓN DE
	// CONTINUACIONES marca la tarea como hecha al reclamarla — mientras el turno de respuesta del
	// propio alumno sigue llegando por stream (y un asentamiento puede competir con el turno de
	// despertar de una segunda tarea). Sincronizar a mitad de turno metería una instantánea obsoleta
	// a mitad del stream, lo que rompe la fusión de continuación en su sitio del SDK
	// (ids de mensaje duplicados). Así que un asentamiento durante un turno ocupado aplaza la
	// sincronización; la siguiente lectura en reposo adopta el registro terminado.
	const [jobs, setJobs] = useState<JobRecord[]>([]);
	const localStreamRef = useRef(false);
	localStreamRef.current = localStream;
	const jobStatusRef = useRef<Map<string, string>>(new Map());
	// Un asentamiento visto durante un turno ocupado — la sincronización se debe, no se descarta.
	const pendingSyncRef = useRef(false);
	// (El efecto de empujón del despacho que vivía aquí — refreshActivity por cada parte
	// de herramienta de despacho nueva — murió en S5: el almacén anuncia jobs-changed en
	// la escritura del despacho; el dock se suscribe.)
	// Protección de la primera lectura (la antigua protección del primer tick): la lectura inicial adopta
	// el historial existente (tareas registradas antes del montaje) sin empujar — solo se debe un
	// empujón por una tarea en ejecución que el feed no ha visto en ESTA sesión.
	const firstFetchRef = useRef(true);
	// El debounce final de los anuncios de jobs-changed (un temporizador), y
	// la ref a través de la que se dispara el temporizador (un closure obsoleto nunca debe leer un
	// chatId antiguo).
	const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const fetchJobsRef = useRef<() => void>(() => {});
	const fetchJobs = useCallback(async () => {
		try {
			const res = await fetch(`/api/jobs?chatId=${encodeURIComponent(chatId)}`);
			if (!res.ok) return;
			const data = (await res.json()) as { jobs?: JobRecord[]; turnInFlight?: boolean };
			const list = data.jobs ?? [];
			for (const j of list) {
				const prev = jobStatusRef.current.get(j.id);
				if (prev === "running" && j.status !== "running") {
					// Un asentamiento — la burbuja sale del dock mediante el anuncio de jobs-changed
					// del almacén en esta misma escritura (S5); este manejador es responsable del REGISTRO.
					// El registro solo está garantizado completo cuando no hay ningún turno en
					// curso — ni en local ni en el servidor (un asentamiento agrupado se dispara
					// a mitad de turno por diseño), así que la sincronización COMPLETA espera al reposo.
					// Regla básica (2026-09-15): el contenido entregado se muestra
					// de inmediato de todos modos — adopta solo por anexado AHORA; la sincronización
					// en reposo sigue asentando el registro como es debido.
					if (localStreamRef.current || data.turnInFlight === true) {
						pendingSyncRef.current = true;
						void adoptAppendOnly();
					} else {
						void syncFromServer();
					}
				}
				jobStatusRef.current.set(j.id, j.status);
			}
			firstFetchRef.current = false;
			if (
				pendingSyncRef.current &&
				!localStreamRef.current &&
				data.turnInFlight !== true
			) {
				pendingSyncRef.current = false;
				void syncFromServer();
			}
			setJobs(list);
			// (La adopción de turnos de despertar que vivía aquí — la línea de enganche de
			// turnInFlight — murió en S3: ahora el descubrimiento es cosa de turn-started en el
			// canal de eventos. turnInFlight SE SIGUE LEYENDO arriba: la comprobación de reposo
			// de la lógica de asentamiento lo necesita.)
		} catch {
			/* fallo transitorio de lectura — el siguiente anuncio de jobs-changed vuelve a leer */
		}
	}, [chatId, syncFromServer, adoptAppendOnly]);
	fetchJobsRef.current = () => void fetchJobs();
	// Montaje + cambio de chat: la lectura inicial INMEDIATA (sin debounce). La
	// protección firstFetch se reinicia con la regla antigua — verdadera solo cuando esta
	// sesión nunca ha visto una tarea (un cambio de chat conserva el mapa: los ids de tarea
	// son únicos por chat, y una tarea en ejecución vista por primera vez aún puede empujar).
	useEffect(() => {
		firstFetchRef.current = jobStatusRef.current.size === 0;
		void fetchJobs();
	}, [fetchJobs]); // la identidad cambia exactamente con chatId
	useServerEvent("jobs-changed", (p) => {
		if (p.chatId != null && p.chatId !== chatId) return; // nuestra o sin atribuir
		if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		fetchDebounceRef.current = setTimeout(() => {
			fetchDebounceRef.current = undefined;
			fetchJobsRef.current();
		}, 250);
	});
	// Puesta al día al reconectar: los eventos que se perdieron mientras el canal estaba caído.
	useServerResync(() => fetchJobsRef.current());
	useEffect(
		() => () => {
			if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		},
		[],
	);

	// ── Descubrimiento de turnos iniciados por el servidor (arquitectura push S3, 2026-10-02) ──
	// Cada turno que ejecuta ESTE chat se anuncia en el canal de eventos — el
	// traspaso sondeo→enseñanza, el despertar de una tarea, el envío de otra pestaña, el
	// caso de perdérselo al montar. Esto sustituye al bucle de vigilancia retirado y al
	// sondeo alternativo del registro de 1500 ms: el descubrimiento ya no es una ventana de sondeo
	// que pueda caducar. Los manejadores leen REFS, no estado de closures — los eventos se disparan
	// entre renders, y una ref guarda el valor vivo en el momento del evento.
	const statusRef = useRef(status);
	statusRef.current = status;
	/** Arreglo B (2026-10-02): llegó turn-settled de NUESTRO PROPIO turno — el
	 * registro es duradero (endTurn solo se dispara después de persistTurn); el cambio
	 * a ready consume este indicador para canonizar la vista sobre el registro. Ver el
	 * efecto de asentamiento y el manejador de turn-settled de más abajo. */
	const settleAnnouncedRef = useRef(false);
	useServerEvent("turn-started", (p) => {
		// Problema conocido sin importancia: beginTurn emite antes que registerTurn en el mismo
		// flujo síncrono de la petición; un GET /stream dentro de esa ventana de menos de un ms
		// recibe una respuesta asentada — imposible de ganar con un viaje de red de ida y vuelta,
		// y se repara solo con el turn-settled que acaba llegando. No lo esquives con más ingeniería.
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) return; // NUESTRO PROPIO turno — la protección contra la carrera del 409
		if (turnInFlightRef.current) return; // ya enganchado
		attachToRunningTurn();
	});
	useServerEvent("turn-settled", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) {
			// Nuestra propia ruta de [DONE] es la responsable del asentamiento del OCUPADO — pero no es una operación nula (arreglo B,
			// 2026-10-02): el evento es la garantía de que el registro es duradero (endTurn
			// solo se dispara después de persistTurn), y aquí siempre gana a [DONE]
			// (endTurn emite desde onFinish antes de que termine la respuesta). Márcalo;
			// el cambio a ready consume el indicador y canoniza la vista sobre
			// el registro. (Si por lo que sea [DONE] ganara esta carrera, esta rama
			// no se ejecutó y la rama de reposo total de más abajo ya sincronizó.)
			settleAnnouncedRef.current = true;
			return;
		}
		if (turnInFlightRef.current) {
			// La trama terminal del stream enganchado es la responsable del asentamiento normal —
			// sincronizar AQUÍ metería una instantánea obsoleta a mitad del stream (la
			// ley de agrupación de continuaciones, ver el sondeo de tareas de arriba). Solo
			// el caso de error repara: el stream enganchado murió, y el asentamiento
			// dice que persistTurn ha convertido el registro en verdad duradera.
			if (statusRef.current === "error") {
				setTurnInFlight(false);
				clearError();
				void syncFromServer();
			}
			return;
		}
		// Reposo total — un turno que nunca vimos (se perdieron todas las ventanas): adóptalo ahora.
		void syncFromServer();
	});
	useServerEvent("compaction-changed", (p) => {
		// El resumen en segundo plano que lanza el asentamiento: mientras se ejecuta, los envíos se bloquean
		// (el ensureCompacted del siguiente turno en el servidor lo espera de todos modos —
		// esto solo mantiene honesta la indicación). Al terminar, record-changed
		// (emitido por la propia escritura de la compactación) trae el marcador.
		if (p.chatId !== chatId) return;
		setCompacting(p.running);
	});
	useServerEvent("record-changed", (p) => {
		// La escritura silenciosa del descarte (A2, 2026-10-03): nunca se ejecutó ningún turno, así que
		// solo se movió el registro. Otras pestañas y las ventanas posteriores a un error lo adoptan;
		// NUESTRO PROPIO descarte ya renderizó su anexado optimista — sincronizar
		// aquí también es inofensivo (la ley de adopción cambia los ids locales por los
		// del servidor). Los estados ocupados lo ignoran: un turno en ejecución es responsable de la vista,
		// y de todos modos la escritura está protegida con un 409 justo contra eso.
		if (p.chatId !== chatId) return;
		if (localStreamRef.current || turnInFlightRef.current) return;
		void syncFromServer();
	});

	const onSend = () => {
		if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller) || submissionRunner.occupied) return;
		if (openingDraftRef.current !== null) { deliverOpeningPrompt(textRef.current.trim(), true); return; }
		void prepareText();
	};

	/* REORIENTAR FRENTE A ENVIAR (arco del responsable 2026-10-03): un envío mientras se
	 * ejecuta un turno lo reorienta — la cola discreta + el raíl de reorientación del agente vivo; el
	 * propio stream del turno trae la tarjeta cuando pi la vacía. La rama es BUSY, no
	 * turnInFlight: el caso del stream propio LIMPIA turnInFlight (la deduplicación
	 * local, chat.tsx ~370), así que bifurcar ahí se tragaba el Enter por completo
	 * durante nuestro propio turno (informe en vivo del responsable, corregido el mismo día). busy cubre
	 * el stream propio Y los turnos ajenos/de despertar — los dos tienen un agente vivo para cuando
	 * se resuelve el POST del envío, así que la reorientación llega. En reposo se usa el
	 * envío normal; un asentamiento en carrera da un 409 y recurre exactamente a eso. */

	const readViewInput = (): PluginSessionViewInput => {
		const expected = pendingPlugin?.occurrence ?? unreadablePlugin?.occurrence
			?? (pending ? { messageId: pending.messageId, contentIndex: pending.contentIndex, toolCallId: pending.toolCallId, toolName: pending.tool } : undefined) ?? activeProblemOccurrence;
		if (!expected && !unreadablePlugin) return textTarget()!;
		const current = inputViewReader.current?.();
		const occurrence = current?.type === "answer" || current?.type === "plugin-question-answer" ? current.question.occurrence
			: current?.type === "thinking" || current?.type === "plugin-problem-submission" ? current.problem.occurrence : current?.type === "unavailable" ? current.occurrence : undefined;
		if (current && current.type !== "text" && expected && occurrence && pluginQuestionOccurrenceKey(expected) === pluginQuestionOccurrenceKey(occurrence)) return current;
		return { type: "unavailable", ...(expected ? { occurrence: expected } : {}), expanded: false, revealed: false };
	};
	const actionContext = () => surfaceTarget ? createPluginSessionActionContext({ placement: "top-bar", surface: "session", sessionId: chatId, kind: kind === "practice" ? "practice" : "teaching", surfaceTarget }, () => {
		if (!submissionMounted.current || submissionLive.current.surfaceTarget !== surfaceTarget) throw new Error("This session view is no longer active.");
		return {
			sessionId: chatId, kind: kind === "practice" ? "practice" : "teaching", title: titleText,
			messages: nativeMessages, transcript: messages, status, reconciliation, busy, compacting,
			phase: kind === "practice" ? "practice" : phases.at(-1) ?? "probe", contextTokens,
			queuedSteers: visibleQueuedSteers(steerQueue, nativeMessages), composer: { text: textRef.current },
			input: readViewInput(),
		};
	}) : undefined;
	const renderedActionContext = actionContext();
	const captureActionContext = () => {
		if (!submissionMounted.current || !surfaceTarget || !findSurfaceBoundary(surfaceTarget)) return;
		const captured = actionContext();
		if (captured) void captured.view; // Desengancha una vez al invocar, no después de las esperas de los plugins.
		return captured;
	};

	usePluginShortcutPage(`/chat/${encodeURIComponent(chatId)}`, captureActionContext);

	return (
		<ChatActionsContext.Provider
			value={{
				chatId,
				syncFromServer,
				sendText: (t: string) => { void prepareText(t); },
				openSetup: () => setSetupOpen(true),
			}}
		>
		<SessionMermaidContext.Provider
			value={{
				openMermaid: setMermaidFocus,
				openFigure: (svg, inverted) => setFigureFocus({ svg, inverted }),
				openImage: image => setFigureFocus({ image }),
			}}
		>
		<JobsContext.Provider value={jobs}>
		<CitationActionsContext.Provider value={citationActions}>
		{/* La superficie de la sesión: la columna de la transcripción (cabecera + contenedor de
		scroll) y el panel del árbol del plan como HERMANOS a toda altura — el panel va de arriba
		abajo exactamente igual que la barra lateral izquierda, y la cabecera (nombre + chip
		de fase) va del borde de la barra lateral izquierda al borde del panel. El
		dock se superpone a la parte inferior de la columna (fuera del contenedor de scroll); un
		espaciador en la transcripción reserva su altura. */}
		<div className="flex h-dvh">
			<div className="flex min-w-0 flex-1 flex-col">
				{/* La barra superior es su propio bloque (responsable, ronda 4 del fundido superior): en el
				flujo, encima del contenedor de scroll, sobre el fondo liso de la página — sin degradado. Su
				contorno inferior (border-b border-border) coincide con el que separa la barra lateral
				izquierda — mismo grosor, mismo color (responsable, r5).
				h-15 (60px), no py-2: el conmutador (un botón de icono size-9) solo se renderiza
				mientras la barra lateral está CERRADA — una fila de altura automática se encogería
				cuando desaparece y subiría el título + el chip.
				60px es una ALINEACIÓN, no solo un tamaño: coincide con la franja del logotipo LH de la
				barra lateral, así que el border-b de la cabecera continúa el borde inferior de esa
				franja como una sola línea a lo ancho de la app (responsable, ronda 6). */}
				<TopBar
					// Mientras se renombra, la barra NO es una superficie de arrastre: app-region:drag
					// se comería el mousedown, así que el clic para salir (más abajo) nunca
					// podría dispararse. El modo de renombrado es modo interactivo (petición del responsable) —
					// la única vía de escape de la TopBar.
					drag={!renaming}
					onMouseDown={(e) => {
						// Zona de escape: cualquier mousedown fuera del propio input le quita
						// el foco, lo que ejecuta la ruta de confirmación onBlur existente. El input se
						// ajusta a su contenido (field-sizing), así que el resto de la barra es
						// este espaciador + chips inertes — todo ello clic para salir (petición del responsable).
						if (renaming && e.target !== titleInputRef.current) titleInputRef.current?.blur();
					}}
				>
					{renaming ? (
						<>
							<input
								ref={titleInputRef}
								value={titleDraft}
								onChange={(e) => setTitleDraft(e.target.value)}
								onKeyDown={(e) => {
									if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
									if (e.key === "Enter") void commitRename(titleDraft);
									// stopPropagation reclama el Esc (oleada A de teclado):
									// cerrar el renombrado no debe abortar también un turno.
									else if (e.key === "Escape") {
										controller?.claimEscape(e);
										e.stopPropagation();
										setRenaming(false);
									}
								}}
								onBlur={() => void commitRename(titleDraft)}
								spellCheck={false}
								data-plugin-chrome-title
								aria-label="Session title"
								title="Rename this session"
								className="lh-no-drag min-w-[8ch] max-w-[70%] shrink-0 bg-transparent font-title text-3xl tracking-tight caret-current outline-none [field-sizing:content]"
							/>
							{/* espaciador flex-1 también durante el renombrado, para que los chips sigan en
							el borde derecho; los clics aquí confirman mediante el manejador de
							mousedown de la cabecera. */}
							<div className="min-w-4 flex-1" aria-hidden="true" />
						</>
					) : (
					<>
						<Hint
							// F2 renombra (registro) — se muestra al pasar el ratón.
							label="Rename session"
							action="rename-session"
							side="bottom"
						>
<button
							type="button"
														onClick={() => {
								setTitleDraft(titleText);
								setRenaming(true);
							}}
							data-plugin-chrome-title
							className="lh-no-drag -mx-1.5 min-w-4 shrink cursor-text truncate rounded-md px-1.5 text-left font-title text-3xl tracking-tight transition-colors hover:bg-accent"
						>
							{titleText}
							</button>
						</Hint>
							{/* espaciador flex-1: mantiene los chips en el borde derecho Y sigue siendo una
							superficie de arrastre (sin recorte) — la barra liberada se puede agarrar. */}
							<div className="min-w-4 flex-1" aria-hidden="true" />
					</>
					)}
					{/* El chip de plan (responsable, ronda de colocación del plan): estructura a nivel
					de sesión junto al chip de fase — acceso a la ventana con el DAG completo
					a cualquier ancho; la nota al margen es la vista rápida de pantalla ancha. */}
					{planTree && (
						<Hint label="Open the full plan" side="bottom">
<button
							type="button"
							data-testid="plan-chip"
							onClick={(e) => {
								blurAfterPointerClick(e);
								setPlanOpen(true);
							}}
							className="lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:border-border hover:text-foreground"
						>
							<WaypointsIcon className="size-3.5 text-primary" aria-hidden />
							Plan
						</button>
</Hint>
					)}
					{/* El anillo de extracción (rediseño fijado por el responsable, 2026-09-24): se llena
					con lo no cubierto frente al umbral de fragmento, late mientras hay una ejecución en
					curso y desaparece cuando el grafo está desactivado. Clic → las cifras
					exactas. Antes de la etiqueta de fase — los chips se agrupan a la derecha. */}
					{/* Práctica (responsable, 2026-10-04): el anillo de cobertura se oculta —
				la práctica nunca extrae, así que un anillo que no para de llenarse sin ninguna
				ejecución detrás mentiría. */}
					{kind !== "practice" && <CoverageRing chatId={chatId} refreshKey={coverageTick} />}
					{/* Sesiones de práctica: sin arco de fases — una discreta etiqueta Practice
					en lugar del chip de fase. */}
					{kind === "practice" ? (
						<span
							data-testid="phase-chip"
							data-phase="practice"
							aria-hidden="true"
							className="pointer-events-none flex shrink-0 select-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
						>
							<DumbbellIcon className="size-3" />
							Practice
						</span>
					) : (
						<PhaseChip phase={phases.at(-1) ?? "probe"} />
					)}
					{renderedActionContext && <PluginTopBarActions context={renderedActionContext} captureContext={captureActionContext} />}
				</TopBar>

				<SessionFind scopeRef={sessionFindScopeRef} scrollContextRef={scrollContextRef} />
				<div ref={sessionFindScopeRef} className="relative flex min-h-0 flex-1">
				<Conversation className="h-full min-w-0 flex-1" initial="instant" contextRef={scrollContextRef}>
					<SessionMessageNavigation />
					<TranscriptElementReporter onElement={setTranscriptElement} />
					<ConversationContent className="min-h-full gap-0 p-0">
						<div data-session-find-root="" className={`${COLUMN} flex flex-1 flex-col gap-4 pt-4`}>
							{messages.length === 0 && !busy && (
								<ConversationEmptyState
									title="New session"
									description="The teacher will open by probing what you already know."
								/>
							)}

							{messages.map((m, mi) =>
								m.role === "user" && isSubagentSteer(m) ? (
									// Entrega de un subagente (reorientación del proceso de despertar): SIN burbuja de mensaje — la
									// tarjeta de artefacto va directamente en la columna de la transcripción, a todo el ancho
									// y centrada como los artefactos del profesor (contracts.ts "THE ASYNC
									// PROTOCOL" §4). Alternativa para la clave: las transcripciones antiguas (anteriores a la higiene de ids)
									// aún pueden tener ids vacíos — el índice mantiene únicas sus claves.
									<SubagentSteerCard key={m.id || `m-${mi}`} message={m} />
								) : m.role === "user" && m.parts.some((p) => p.type === "data-probe-handoff") ? (
								// El despertar del traspaso sondeo→enseñanza (esquema de mensajes personalizados): el
								// DIVISOR DE PLANIFICACIÓN ES la frontera (decisión del responsable 2026-09-26 — sustituyó
								// a la línea del sistema "Preparing your plan…"; el marcador se renderiza en el sitio
								// correcto por cómo se construye el registro, así que el antiguo divisor basado en el plegado
								// — que subía flotando al principio de la transcripción en cuanto la agrupación de la
								// oleada D fundía todo el sondeo en un único grupo gigante del
								// asistente — ha desaparecido). Nunca una burbuja de usuario: el despertar es
								// andamiaje; la instrucción dirigida al modelo vive en el adaptador.
								<PhaseDivider key={m.id || `m-${mi}`} phase="plan" />
							) : m.role === "user" && m.parts.length > 0 && m.parts.every((p) => p.type.startsWith("data-")) ? (
								// Tarjetas de marcador (mensajes personalizados, 2026-10-04): andamiaje del
								// lado del usuario — la elección del contexto del grafo, el rastro de razonamiento
								// de la práctica — se renderizan como tarjetas directamente en la columna de la
								// transcripción, SIN burbuja de chat (el precedente de la reorientación
								// del subagente). La rama de usuario de más abajo solo renderiza texto;
								// sin esta elevación, un mensaje con solo datos se leía como una burbuja
								// VACÍA (informe del responsable, 2026-10-04).
								<Fragment key={m.id || `m-${mi}`}>
									{m.parts.map((part, pi) => {
										switch (part.type) {
											case "data-graph-context":
												return <GraphContextCard key={pi} data={part.data as GraphContextData} />;
											case "data-compaction":
												return <CompactionMomentDivider key={pi} data={part.data as CompactionDividerData} />;
											case "data-compaction-cut":
												return <CompactionCutDivider key={pi} data={part.data as CompactionDividerData} />;
											case "data-plugin-problem-submission": {
												const submitted = readPluginProblemSubmission(part.data);
												return <PluginProblemSubmitted key={pi} data={part.data} snapshot={submitted ? pluginProblemById(nativeMessages, submitted.problemId) : null} chatId={chatId} />;
											}
											case "data-practice-thinking":
												return <ThinkingCard key={pi} data={part.data as PracticeThinkingData} />;
											case "data-practice-next":
												// La señal del alumno para pasar al siguiente (ronda 16 del responsable): una línea compacta,
												// centrada, en versalitas monoespaciadas — cromo, el registro del descarte.
												return (
													<div
														key={pi}
														data-testid="practice-next-line"
														className="my-4 flex items-center justify-center gap-1.5 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground"
													>
														<ArrowRightIcon className="size-3" />
														Next problem
													</div>
												);
											default:
												return null;
										}
									})}
								</Fragment>
							) : (
									<Fragment key={m.id || `m-${mi}`}>
									{/* LA FRONTERA INFERIDA DE LA ENSEÑANZA (decisión del responsable 2026-09-26, la muerte del
									veredicto): la enseñanza empieza donde se plantea el PRIMER quiz etiquetado con nodeId
									— el plegado (phaseTimeline, la misma derivación que lee el chip de
									fase) cambia a teach exactamente EN este grupo del asistente. A NIVEL DE PASO
									desde la ronda 8 del responsable (2026-10-05 — el fallo de los divisores apilados): la
									presentación del plan suele vivir en el MISMO mensaje, en un paso del proveedor
									anterior a la llamada del quiz, y la antigua frontera a nivel de mensaje
									dibujaba este divisor también antes del plan (Planning y Teaching
									apilados uno tras otro, sin nada en medio). teachStepIndex encuentra el
									límite de paso que rige la llamada del cambio: -1 = el primer paso del
									mensaje → se antepone a todo el bloque (esta rama); un índice
									posterior → el divisor se renderiza EN ese límite de parte, en el bucle
									de más abajo (sustituye a la línea fina normal de paso — una regla de fase con
									etiqueta prevalece sobre ella). La comprobación del límite (este índice cambia y el
									anterior no) sigue garantizando exactamente UN divisor por sesión.
									ANTEPUESTO, nunca una rama de sustitución: el grupo de enseñanza es un mensaje
									real con contenido — un ternario de sustitución se tragaba todo el
									primer bloque de la lección (la sesión de Lacan, 2026-09-27). */}
									{m.role === "assistant" &&
									mi > 0 &&
									phases[mi] === "teach" &&
									phases[mi - 1] !== "teach" &&
									teachStepIndex(m.parts) === -1 ? (
										<PhaseDivider key={`teach-${m.id || `m-${mi}`}`} phase="teach" />
									) : null}
									{m.role === "user" ? (
										/* LA FILA DE DOCUMENTO (ronda del responsable, 2026-10-05): sin burbuja
										alineada a la derecha — la transcripción se lee como un documento. El texto del usuario es un
										bloque de cita a todo el ancho: etiqueta "You" atenuada, raíl atenuado,
										texto con opacidad COMPLETA (las palabras del alumno son contenido, no un susurro).
										Se distingue de un vistazo del razonamiento del usuario: el razonamiento va
										plegado + en cursiva al 50 %; esto va recto y presente.
										El texto del usuario se renderiza tal cual — no se aplica la cadena de LaTeX del modelo
										al texto escrito por el alumno ($ sigue siendo $, sin sorpresas).
										Se renderiza SIN el envoltorio Message — ese es la burbuja. */
											<div
										data-testid="user-message"
										/* EL DOCUMENTO, DEL TODO (rondas dos y tres del responsable, 2026-10-07):
										sin lado de chat — el mensaje del usuario es una FRANJA a todo el ancho del color de
										las tarjetas, con una geometría IDÉNTICA a la de las filas de razonamiento: 5px de relleno
										de la franja, el hueco izquierdo coincide con él y el raíl ocupa el margen
										interior de 3ch (la franja es la marca de autoría frente a la prosa transparente
										del agente). La etiqueta "You" se mantiene — un mismo registro
										que las etiquetas del razonamiento. */
										className="my-2 w-full border-l-[calc(3ch-14px)] border-muted-foreground/30 bg-card py-1 pl-[14px] pr-4 font-ui text-xs"
									>
												{/* El raíl AGRUPA (ronda 4 del responsable, 2026-10-05): el encabezado YOU
												va DENTRO del raíl, con el mismo registro mono-xs y el mismo raíl de
												1ch que las filas de razonamiento — una única geometría de cita. */}
												<div className="font-medium uppercase tracking-wide text-muted-foreground">You</div>
												<div className="lh-prose whitespace-pre-wrap text-foreground">
													<PathText text={m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")} />
												</div>
												<SubmittedImages images={m.parts.filter((part) => part.type === "image").map(part => ({ type: "image" as const, data: part.data as string, mimeType: part.mimeType as string }))} />
											</div>
									) : (
									<Message from="assistant" className="max-w-full">
									<MessageContent className="w-full">
											{m.parts.map((part, pi) => {
												if (part.pluginProblem) return <ProblemCard key={pi} part={{ ...part, state: part.state ?? "input-available", toolCallId: part.toolCallId ?? "" }} />;
												if (part.pluginQuestion) return <PluginQuestionPart key={pi} part={part} chatId={chatId} />;
												const isLastPart = mi === messages.length - 1 && pi === m.parts.length - 1;
												// El límite de paso donde empieza la enseñanza (ronda 8): cuando
												// el cambio a teach ocurre en un paso POSTERIOR, su PhaseDivider
												// sustituye a la línea fina normal de este límite.
												const teachBoundary =
													m.role === "assistant" &&
													mi > 0 &&
													phases[mi] === "teach" &&
													phases[mi - 1] !== "teach" &&
													teachStepIndex(m.parts) === pi;
												// Una llamada a herramienta que devolvió un error AL AGENTE (fallo de
												// validación, argumentos mal formados) es trabajo invisible — el agente
												// lee el error y reintenta. Decisión del responsable 2026-09-26:
												// mostrar el bucle de reintentos como una línea discreta, con cualquier herramienta,
												// en lugar de silencio (las herramientas de preguntas renderizaban null,
												// así que un bucle de quiz dando tumbos parecía un atasco). Los abortos son
												// terminales — nada reintenta —, así que siguen en silencio.
												if (
													part.state === "output-error" &&
													part.type.startsWith("tool-") &&
													part.errorText !== "Operation aborted"
												) {
													return (
														<SystemLine key={`retry-${pi}`} testId="tool-retry">
															Retrying…
														</SystemLine>
													);
												}
												switch (part.type) {
													case "text": {
														const sourceId = textPartMessageId(part.id);
														const anchor = sourceId && sourceTextParts.get(sourceId) === part.id ? messageAnchorId(sourceId) : undefined;
														return (
															<div key={part.id || pi} id={anchor} data-source-message-id={sourceId ?? undefined} className="lh-source-passage">
																<MessageResponse>{part.text}</MessageResponse>
															</div>
														);
													}
													case "reasoning":
														return (
															<Reasoning key={pi} isStreaming={status === "streaming" && isLastPart} className="mb-2">
																<ReasoningTrigger />
																<ReasoningContent>{part.text ?? ""}</ReasoningContent>
															</Reasoning>
														);
													case "step-start":
														return <Fragment key={`step-${pi}`}>
															{renderSideEntry(sideEntries.get(m.id)?.get(pi))}
															{teachBoundary ? <PhaseDivider phase="teach" /> : pi > 0 ? <Separator className="my-3" /> : null}
														</Fragment>;
													case "data-plan-block":
														// El plan en el chat (oleada 4): un bloque con una
														// instantánea congelada — se renderiza tal como viene, nunca se vuelve a derivar.
														return (
															<PlanBlock
																key={pi}
																data={part.data as PlanBlockData}
																onOpen={() => setPlanOpen(true)}
															/>
														);
													case "tool-quiz":
													case "tool-probe":
													case "tool-ask_user_question":
													case "tool-explain":
													case "tool-recall": {
														const malformed = !busy && malformedQuestions.find(call => call.messageId === part.sourceMessageId && call.contentIndex === part.sourceContentIndex && call.toolCallId === part.toolCallId);
														if (malformed) return <MalformedQuestion key={pi} disabled={!!pending || compacting}
															reason={pending ? "Answer or discard the remaining question first." : undefined}
															onRetry={() => {
																draftRef.current = null;
																void send({ type: "retry-question", messageId: malformed.messageId, contentIndex: malformed.contentIndex, toolCallId: malformed.toolCallId });
															}} />;
														// Las preguntas pendientes/en stream viven en el dock, no en la
														// transcripción; las respondidas se renderizan como registros calificados.
														if (part.state === "output-available") {
															return (
																<AnsweredCard key={pi} answer={part.output as QuestionAnswerData} input={part.input} />
															);
														}
														return null;
													}
													default: {
														// La presentación integrada sigue mandando; los renderizadores de los plugins
														// solo amplían la ranura alternativa genérica de las herramientas nativas.
														if (part.type.startsWith("tool-")) return <ToolPartRenderer key={pi} part={part} />;
														return null;
													}
												}
											})}
										</MessageContent>
										{m.role === "assistant" && renderSideEntry(sideEntries.get(m.id)?.get(m.parts.length))}
									</Message>
									)}
								</Fragment>
							))}

							{/* EL provisional, sujeto a ACCIONES (responsable, ronda optimista
							3, 2026-10-02): spinner + Thinking… con brillo desde el
							instante de cualquier acción que produce tokens — enviar,
							responder, iniciar sesión, reenganchar (el estado pasa a
							submitted DE FORMA SÍNCRONA con la acción) — hasta el
							primer evento APLICADO del turno, donde el stream toma el relevo
							con el mismo aspecto: un mensaje llegado pero vacío renderiza
							la FILA de razonamiento (view.ts proyecta una parte de razonamiento
							vacía), así que submitted ⟺ provisional y streaming ⟺ una
							fila renderizada, mutuamente excluyentes por construcción.
							Los eventos de protocolo (agent_start) no aplican nada ni liberan
							nada — el provisional cubre todo el hueco de conexión con el
							proveedor. La calificación/el procesamiento opcional de los plugins
							usa EVALUATING… hasta que su POST acusa recibo; esto cambia
							solo la redacción, nunca la acción ni las barreras del stream.
							turnInFlight: el mismo estado
							al que se entra por descubrimiento externo (despertar) / el sondeo
							alternativo. Nunca es plegable por sí mismo. */}
							{/* Compactación (ronda 15 del responsable): el mismo registro que el
						provisional de razonamiento — un estado visible para toda la sesión mientras
						el resumidor tiene la barrera de modelo. Mutuamente excluyente con
						el provisional de THINKING por construcción (la barrera va
						ANTES de beginTurn; el arranque del asentamiento se ejecuta después de endTurn). */}
							{compacting && (
								<span className="flex items-center gap-2 font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
									<BrailleSpinner label="Compacting context" />
									<Shimmer duration={1}>COMPACTING CONTEXT…</Shimmer>
								</span>
							)}
							{(status === "submitted" || turnInFlight) && (
								<PendingTurnIndicator evaluating={evaluating} />
							)}
							{openingError && <p role="alert" className="text-sm text-destructive">{OPENING_PROMPT_FAILURE}</p>}
							{error && (
								<div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
									<span>Something went wrong: {error.message}</span>
									{retryable && (
										<Button variant="outline" size="xs" data-testid="retry-failed-turn" onClick={retryFailedTurn}>
											Retry
										</Button>
									)}
								</div>
							)}
						</div>

						{/* La cola reservada del dock (DockOverlay comunica su altura):
						mantiene el contenido de la transcripción en reposo con un scroll que queda
						del todo libre del overlay — el sustituto en el espacio del flujo del antiguo
						dock sticky. Es cero solo antes de medir (el primer efecto de
						layout lo comunica antes de pintar). */}
						<div aria-hidden data-testid="dock-spacer" style={{ height: dockReserve }} />
				</ConversationContent>
				{/* El dock: un overlay hermano del contenedor de scroll (el
				patrón de use-stick-to-bottom). El botón de bajar ahora vive
				DENTRO del overlay (ronda de ajustes del responsable, 2026-09-24):
				anclado al borde superior del bloque del dock, así que acompaña cada
				cambio de altura (al escribir, cuando una pregunta agranda la franja, el
				plegado) y NUNCA tapa el compositor. */}
				<DockOverlay
					viewReader={inputViewReader}
					viewTargets={surfaceTarget ? { text: textTarget()!, answer: builtinTarget, thinking: thinkingTarget(), pluginQuestion: pluginQuestionTarget(), pluginProblem: pluginProblemTarget() } : undefined}
					pending={pending}
					onPrepareBuiltin={prepareBuiltin}
					onBuiltinPendingInput={question => { const target = builtinTarget(question); return !!target && !!pluginManager?.hasPendingSubmissionInput(target); }}
					onPrepareThinking={prepareThinking}
					pendingThinkingInput={pendingThinkingInput}
					onPreparePluginQuestion={preparePluginQuestion}
					preparing={submissionRunner.occupied}
					preparationStatus={<>
						{preparationError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{preparationError}</p>}
					</>}
					pluginQuestion={pendingPlugin}
					pluginDraft={pendingPlugin ? pluginQuestionDraft(pendingPlugin) : undefined}
					pluginAvailable={!!pendingPlugin && pluginQuestionAvailability?.questionId === pendingPlugin.questionId && pluginQuestionAvailability.status === "available"}
					pluginReady={!busy && !compacting && reconciliation === "ready"}
					onPluginMicAvailable={setPluginMicAvailable}
					onPluginSend={send}
					onPluginDismiss={() => pendingPlugin ? dismissPluginQuestion(pendingPlugin.occurrence, pendingPlugin.questionId) : unreadablePlugin ? dismissPluginQuestion(unreadablePlugin.occurrence, unreadablePlugin.annotation.status === "unreadable" ? unreadablePlugin.annotation.identity?.questionId : undefined) : Promise.resolve()}
					unreadablePlugin={!!unreadablePlugin}
					unavailableOccurrence={unreadablePlugin?.occurrence}
					reconciliation={reconciliation}
					onRetrySync={() => { void reconcile(); }}
					initialQuestionDraft={pending ? questionDraft(pending.key)?.form : undefined}
					onSaveQuestionDraft={(form) => { if (pending) saveQuestionDraft(pending.key, { form }); }}
					workingRef={workingRef}
					practice={activeProblem}
					pluginPractice={activeProblem?.pluginProblem && activeProblemOccurrence ? {
						snapshot: activeProblem.pluginProblem, occurrence: activeProblemOccurrence, chatId, draft: pluginProblemDraft(activeProblem.pluginProblem),
						available: pluginProblemAvailability?.problemId === activeProblem.pluginProblem.problemId && pluginProblemAvailability.status === "available",
						ready: !busy && !compacting && reconciliation === "ready", reconciliation: activeProblemOf(canonicalMessages)?.pluginProblem?.problemId === activeProblem.pluginProblem.problemId ? reconciliation : "syncing",
						prepareSubmission: preparePluginProblem, send, preparing: submissionRunner.occupied, compactionRunning: compacting, onEscape: dictation.cancel,
					} : undefined}
					compactionRunning={compacting}
					onSubmitThinking={submitThinking}
					chatId={chatId}
					onModelChange={recordSelectedModel}
					plan={hasPlan ? <PlanMarginalia messages={messages} /> : undefined}
					onOpenPlan={() => setPlanOpen(true)}
					requiresReveal={requiresReveal}
					readingThinking={readingThinkingSeed.value}
					readingThinkingRevision={readingThinkingSeed.revision}
					onReadingThinking={(value) => { applyReadingThinking(value); if (pendingPlugin) pluginQuestionDraft(pendingPlugin).readingThinking = value; }}
					phase={phases.at(-1) ?? "probe"}
					turns={turns}
					contextTokens={contextTokens}
					cliContextWindow={cliContextWindowOf(nativeMessages)}
					pricing={pricing}
					onReserve={setDockReserve}
					dictationSlot={<DictationBar dictation={dictation} disabled={pluginOwnsDock && !pluginMicAvailable} />}
					dictationCancel={dictation.cancel}
					queuedSteers={visibleQueuedSteers(steerQueue, nativeMessages)}
					setupCta={
						zeroKeys ? (
							<ZeroKeysPill onOpen={() => setSetupOpen(true)} />
						) : (
							!configured && (
								<div className="pointer-events-auto mb-2 flex justify-center">
									<button
										type="button"
										data-testid="setup-cta"
										onClick={() => setSetupOpen(true)}
										className="rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
									>
										Set up your models
									</button>
								</div>
							)
						)
					}
					composer={
						<ChatSessionComposer
							// Detener aborta CUALQUIER turno en curso (oleada de reenganche del stream): el
							// cuadrado también se renderiza mientras se ejecuta un turno reenganchado/de despertar — el
							// canal de aborto lo termina en el servidor; stop() por sí solo
							// solo desengancharía nuestra vista.
							busy={busy}
							value={textRef.current}
							pendingInput={pendingTextInput}
							revision={composerDraftRevision}
							onChange={recordComposerText}
							inputRef={composerInputRef}
							onSend={onSend}
							onStop={abortInFlightTurn}
							sendAllowed={sendAllowed}
							dictationActive={dictation.active}
							onEscape={dictation.active ? dictation.cancel : undefined}
							// La indicación de la pausa (ronda 16 del responsable): el provisional
							// ES la pista — estado vacío, justo donde se aplica Enter con el
							// compositor vacío.
							nextProblem={nextReady}
							onNext={sendNext}
							placeholder={nextReady ? "Ask anything, or press Enter for the next one." : undefined}
						/>
					}
					onSubmitAnswer={(output) => {
						if (!pending) return;
						// LA RESPUESTA ES EL RESULTADO DE LA HERRAMIENTA DE LA LLAMADA DE LA PREGUNTA (bifurcación 1, responsable
						// 2026-09-26): un evento de entrada, un turno — el hook anexa
						// el resultado calificado optimista (la AnsweredCard se muestra al
						// instante) y la persistencia anticipada del servidor lo guarda antes del
						// turno; la reacción del profesor llega por stream debajo. Los descartes
						// van por el mismo callback (QuestionAnswerData.dismissed). El
						// borrador del razonamiento de lectura viaja con ella (responsable 2026-10-03) — la
						// respuesta a la comprobación es su único portador.
						saveQuestionDraft(pending.key, { readingThinking: readingThinkingRef.current });
						const reading = readingThinkingRef.current.trim() || undefined;
						// El efecto del id pendiente solo lo limpia cuando la pregunta
						// se va de verdad. Una comprobación previa sin conexión mantiene visible el borrador.
						const send = () => submitAnswer(pending.tool, pending.toolCallId, reading ? { ...output, readingThinking: reading } : output, pending.key);
						// Nunca esperes al auxiliar. El servidor anexa de forma atómica las nuevas
						// actualizaciones laterales en bruto junto con esta respuesta principal.
						send();
					}}
				/>
				</Conversation>
				{sideThread.state?.mode === "panel" && (
					<SideThreadPanel>
						<SideThreadBody
							key={sideThread.state.threadId}
							state={sideThread.state}
							chatId={chatId}
							draft={sideThread.draftFor(sideThread.state.threadId)}
							readDraft={sideThread.draftFor.bind(null, sideThread.state.threadId)}
							dictation={sideDictationFor(sideThread.state.threadId)}
							onDraftChange={sideThread.saveDraft.bind(null, sideThread.state.threadId)}
							onAsk={(text, retry) => sideThread.ask(text, retry, sideThread.state!.threadId)}
							onStop={sideThread.stop}
							onExpand={sideThread.expand}
							onFloat={sideThread.float}
							onClose={closeSideThread}
							onCurrentStep={goToCurrentSideStep}
						/>
					</SideThreadPanel>
				)}

				{sideThread.state?.mode === "popover" && (
					<SideThreadPopover
						state={sideThread.state}
						chatId={chatId}
						draft={sideThread.draftFor(sideThread.state.threadId)}
						readDraft={sideThread.draftFor.bind(null, sideThread.state.threadId)}
						dictation={sideDictationFor(sideThread.state.threadId)}
						onDraftChange={sideThread.saveDraft.bind(null, sideThread.state.threadId)}
						composer={() => composerInputRef.current}
						onAsk={(text, retry) => sideThread.ask(text, retry, sideThread.state!.threadId)}
						onStop={sideThread.stop}
						onExpand={sideThread.expand}
						onFloat={sideThread.float}
						onClose={closeSideThread}
						onCurrentStep={goToCurrentSideStep}
					/>
				)}

				{/* Los focos con ámbito de sesión (oleada de fundido del cromo, 2026-09-19): se montan
				DENTRO del área de la sesión — hermanos absolute inset-0 del contenedor de scroll,
				así que ocupan el área bajo la barra de arrastre, a la derecha de la barra lateral, y
				la barra superior sigue nítida + arrastrable mientras hay un foco abierto. */}
				<SurfaceRegion target={surfaceTarget}>
				{mermaidFocus !== null && (
					<MermaidOverlay chart={mermaidFocus} onClose={() => setMermaidFocus(null)} />
				)}
				{figureFocus !== null && (
					<MermaidOverlay
						{...figureFocus}
						onClose={() => setFigureFocus(null)}
					/>
				)}
				{planOpen && <PlanPopup messages={messages} onClose={() => setPlanOpen(false)} />}
				<SelectionToolbar viewport={transcriptElement} actions={selectionActions} />
				{citationEdit && (
					<CitationCommentPopover
						key={`${citationEdit.start}:${citationEdit.link}`}
						target={citationEdit}
						transcript={transcriptElement}
						composer={() => citationEdit.input?.isConnected ? citationEdit.input : citeInput()}
						onClose={() => setCitationEdit(null)}
						onSend={() => {
							const input = citationEdit.input?.isConnected ? citationEdit.input : citeInput();
							if (input === composerInputRef.current) onSend();
							else if (input) requestAnimationFrame(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
						}}
					/>
				)}
				</SurfaceRegion>
				<AbortTurnDialog mode={abortAsk} onClose={closeAbortAsk} onConfirm={confirmAbort} busy={busy} />
				</div>
			</div>
		</div>
		</CitationActionsContext.Provider>
		</JobsContext.Provider>
		</SessionMermaidContext.Provider>
		{/* El flujo de configuración BYOK (responsable, 2026-09-22): un único montaje sirve a la
		llamada a la acción persistente, a la intercepción del envío rechazado y al enlace
		de las tarjetas de tareas. Save deja el borrador en el compositor — nunca envía
		(decisión del responsable 2026-10-09); Esc también lo deja (el diálogo se puede
		cerrar por diseño — la barrera es el servidor, no este modal). */}
		<SetupDialog
			open={setupOpen}
			onClose={() => setSetupOpen(false)}
			onDone={() => {
				setSetupOpen(false);
				// Save solo guarda (decisión del responsable 2026-10-09): el borrador volvió
				// a casa, al compositor, en el momento del rechazo y SE QUEDA ahí —
				// lo envía el propio alumno.
			}}
		/>
		</ChatActionsContext.Provider>
	);
}

/**
 * La burbuja flotante: UN envoltorio persistente, SUPERPUESTO en la parte inferior
 * de la columna (absolute — hermano del contenedor de scroll, el patrón de
 * use-stick-to-bottom; sustituyó al antiguo dock sticky dentro del flujo, que murió
 * por el problema de latencia del plegado que se explica abajo). El contenido se
 * intercambia entre el compositor del chat y el dock de preguntas; la altura del
 * envoltorio cambia entre variantes (WAAPI, rápido). Un espaciador al final de la
 * transcripción (lo renderiza ChatView a partir de lo que comunica onReserve)
 * guarda el espacio del dock en el flujo, así que el contenido en reposo queda del
 * todo libre del overlay al hacer scroll.
 *
 * Por qué un overlay (responsable, ronda 1 de scroll): un dock dentro del flujo
 * ES geometría de scroll — plegarlo encoge el contenido desplazable, así que el
 * plegado tenía que esperar a que el alumno estuviera una altura entera de dock
 * por encima del fondo (más cerca, el ajuste del navegador lo devolvía abajo y
 * volvía a desplegar la caja: la oscilación). Desacoplado del flujo, el plegado
 * es SOLO VISUAL: se dispara en cuanto el alumno deja el fondo, y la cola
 * reservada solo CRECE mientras hay una pregunta abierta (una cola que encogiera
 * volvería a traer el ajuste).
 *
 * Plegado: al subir más allá de COLLAPSE_DIST, el dock se pliega en una barra
 * fina; haz clic en ella (o vuelve abajo) para desplegarla. El formulario de la
 * pregunta sigue MONTADO mientras está plegado (oculto, no desmontado), para que
 * una selección a medias sobreviva.
 */
/**
 * Cómo llega una pregunta de la fase de enseñanza (decisión del responsable,
 * 2026-09-25): plegada tras el botón de revelación cuando sigue al compositor —
 * el alumno lee primero la enseñanza —, pero ABIERTA cuando sigue a otra
 * pregunta (una comprobación paralela en cola): la lectura ya ocurrió, así que no
 * queda nada que esperar y la altura de scroll que ya tenía es la altura honesta.
 */
/** La decisión del Esc por capas (responsable, 2026-10-04): un overlay abierto
 *  reclama el Esc — se cierra él mismo — antes de que la cadena de aborto pueda
 *  abrir su confirmación. Un foco de mermaid, la ventana del plan o el diálogo de
 *  configuración encima de una pregunta pendiente deben cerrar el OVERLAY, nunca
 *  descartar la pregunta de debajo. La prioridad es el orden de apilado: la
 *  confirmación de aborto (la más alta, reclama mediante su propio diálogo),
 *  luego los overlays de sesión (mermaid se pinta encima del plan — más tarde en
 *  el DOM), luego la configuración (se cierra sola — la barrera solo no debe
 *  dispararse) y luego la cadena de aborto propiamente dicha del 2026-10-02 (la
 *  pregunta antes que el turno). */
export type EscAbortTarget = "side-thread" | "mermaid" | "plan" | "setup" | "question" | "problem" | "turn" | null;
	/**
 * ¿Debe aún el tema inicial su primer envío? El tema es el ?prompt= del servidor
 * o lo guardado en sessionStorage. La barrera es «todavía no hay conversación
 * real» (ningún mensaje de usuario/asistente) — NO que esté vacío: una sesión
 * iniciada con elecciones del mapa lleva un MARCADOR de contexto del grafo como
 * message[0], y ese andamiaje nunca debe tragarse el primer envío (informe del
 * responsable, 2026-10-04: el turno se quedaba muerto detrás de él — la antigua
 * comprobación `length === 0` veía el marcador y se negaba a disparar).
 */
export function initialPromptOwed(messages: readonly { role: string }[], prompt: string | undefined): boolean {
	if (!prompt) return false;
	return !messages.some((m) => m.role === "user" || m.role === "assistant");
}

export function escAbortTarget(s: {
	abortAsk: boolean;
	/** Un hilo lateral abierto (#16, F11): Esc lo cierra (y lo confirma) antes que
	 *  cualquier otra cosa de la escalera. */
	sideThread?: boolean;
	mermaidFocus: boolean;
	planOpen: boolean;
	setupOpen: boolean;
	pending: boolean;
	/** Un problema de práctica activo (sesiones de práctica, 2026-10-04): Esc abre
	 *  la confirmación de descarte — por debajo de una pregunta pendiente (las dos
	 *  nunca coexisten, pero el orden de capas se mantiene estricto) y por encima
	 *  del aborto del turno (un turno vivo solo puede estar ejecutándose DETRÁS de un
	 *  problema en reposo en las sesiones de enseñanza — los problemas de práctica
	 *  terminan sus turnos de planteamiento). */
	problem: boolean;
	busy: boolean;
}): EscAbortTarget {
	if (s.abortAsk) return null; // el propio Esc de la ventana — lo reclama el diálogo
	if (s.sideThread) return "side-thread";
	if (s.mermaidFocus) return "mermaid";
	if (s.planOpen) return "plan";
	if (s.setupOpen) return "setup";
	if (s.pending) return "question";
	if (s.problem) return "problem";
	if (s.busy) return "turn";
	return null;
}

export function revealArrival(wasQuestion: boolean): { expanded: boolean; revealed: boolean } {
	return wasQuestion ? { expanded: true, revealed: true } : { expanded: false, revealed: false };
}

/**
 * El estado de llegada de una pregunta de SONDEO (ronda del parpadeo,
 * 2026-09-26): abierta si y solo si el alumno está abajo siguiendo la
 * conversación; si ha subido en el historial → llega como la barra plegada
 * (decisión del responsable: «simplemente debería quedarse cerrada»). Se decide
 * DURANTE EL RENDER, como la frontera de la enseñanza de arriba — el antiguo
 * efecto posterior al pintado pintaba antes un fotograma abierto obsoleto (la
 * caja «se abría y se cerraba de inmediato» con el scroll arriba). Pura, para
 * las pruebas.
 */
export function probeArrivalExpanded(isAtBottom: boolean): boolean {
	return isAtBottom;
}

/**
 * La regla de crecimiento del silenciado por geometría (ronda del parpadeo,
 * 2026-09-26): un CRECIMIENTO de la reserva mientras hay una pregunta pendiente
 * es el dock estirándose (el volcado del dictado que trae muchas líneas de golpe)
 * — el espaciador llega en ese commit, la puesta al día suave va por detrás
 * exactamente lo que creció, y ese retraso es movimiento nuestro, no el alumno
 * yéndose, así que la máquina de plegado ignora los eventos de scroll durante la
 * ventana de silencio posterior (reproducido d≈152 > COLLAPSE_DIST). Los
 * encogimientos nunca marcan — esa ruta silenciaba por sí misma el redespliegue
 * al llegar abajo y dejaba la caja atascada plegada (ronda de redimensionado,
 * verificado en vivo). Pura, para las pruebas.
 */
export function shouldStampGeometryMute(nextH: number, prevH: number, pending: boolean): boolean {
	return pending && nextH > prevH + 1;
}

/** Comunica el elemento de scroll de la transcripción en cuanto StickToBottom lo
 *  engancha (su ref llega después del primer render, como la de SessionMessageNavigation). */
function TranscriptElementReporter({ onElement }: { onElement: (element: HTMLElement | null) => void }) {
	const { scrollRef } = useStickToBottomContext();
	useEffect(() => {
		if (scrollRef.current) { onElement(scrollRef.current); return () => onElement(null); }
		const id = window.setInterval(() => {
			if (!scrollRef.current) return;
			window.clearInterval(id);
			onElement(scrollRef.current);
		}, 50);
		return () => { window.clearInterval(id); onElement(null); };
	}, [scrollRef, onElement]);
	return null;
}

/** Frontera de composición/pruebas solo del host; nunca forma parte del SDK de plugins. */
export function DockOverlay({
	viewReader, viewTargets, unavailableOccurrence,
	pending,
	onPrepareBuiltin, onBuiltinPendingInput, onPrepareThinking, pendingThinkingInput, onPreparePluginQuestion, preparing, preparationStatus,
	pluginQuestion, pluginDraft, pluginAvailable, pluginReady, onPluginMicAvailable, onPluginSend, onPluginDismiss, unreadablePlugin, reconciliation, onRetrySync,
	initialQuestionDraft,
	onSaveQuestionDraft,
	workingRef,
	practice, pluginPractice,
	compactionRunning,
	onSubmitThinking,
	requiresReveal,
	readingThinking,
	readingThinkingRevision,
	onReadingThinking,
	phase,
	turns,
	contextTokens,
	cliContextWindow,
	pricing,
	composer,
	onSubmitAnswer,
	chatId,
	onModelChange,
	onReserve,
	plan,
	onOpenPlan,
	dictationSlot,
	dictationCancel,
	setupCta,
	queuedSteers,
}: {
	viewReader?: SessionInputViewReader;
	viewTargets?: SessionViewTargets;
	unavailableOccurrence?: import("@/src/core").PluginSubmissionOccurrence;
	pending: ReturnType<typeof pendingQuestionOf>;
	onPrepareBuiltin: PrepareBuiltinSubmission;
	onBuiltinPendingInput: (question: QuestionData) => boolean;
	onPrepareThinking: PrepareThinkingSubmission;
	pendingThinkingInput: boolean;
	onPreparePluginQuestion: PreparePluginQuestionSubmission;
	preparing: boolean;
	preparationStatus: React.ReactNode;
	pluginQuestion?: PluginQuestionSnapshot;
	pluginDraft?: PluginQuestionDraft;
	pluginAvailable: boolean;
	pluginReady: boolean;
	onPluginMicAvailable(available: boolean): void;
	onPluginSend(input: ChatInput): Promise<boolean>;
	onPluginDismiss(): Promise<void>;
	unreadablePlugin: boolean;
	reconciliation: "ready" | "syncing" | "failed";
	onRetrySync(): void;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	/** El trabajo actual sin enviar del dock, para el hilo lateral. */
	workingRef?: { current: string };
	/** Compactación en curso en este chat (ronda 14) — la barrera de la indicación
	 *  de envío de los docks (la real es el registro del servidor). */
	compactionRunning: boolean;
	/** El problema de práctica ACTIVO (sesiones de práctica, 2026-10-04):
	 *  {toolCallId, input} — propiedad del dock exactamente igual que una pregunta
	 *  pendiente (se sustituye el compositor); null en las sesiones de enseñanza. */
	practice: { toolCallId: string; input: unknown } | null;
	pluginPractice?: Omit<PluginProblemDockProps, "expanded" | "onExpand">;
	/** (commit, text) — los dos carriles de envío del dock de práctica. */
	onSubmitThinking: (text: string) => void;
	/** Pregunta pendiente de la fase de enseñanza: llega plegada tras el botón de revelación (W5). */
	requiresReveal: boolean;
	/** El borrador del razonamiento de lectura (responsable 2026-10-03) — ChatView es su
	 *  responsable, para que las fronteras de envío + descarte (fuera de este overlay) puedan fusionarlo. */
	readingThinking: string;
	readingThinkingRevision: number;
	onReadingThinking: (v: string) => void;
	/** Fase de la sesión en la pregunta pendiente — escala el campo de razonamiento. */
	phase: Phase3;
	/** El registro de uso de la sesión — la barra de estadísticas bajo el compositor lo pliega. */
	turns: TurnUsage[];
	contextTokens: number | null;
	cliContextWindow: ReturnType<typeof cliContextWindowOf>;
	pricing?: SessionPricing;
	composer: React.ReactNode;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	/** El paso del control de modelo (lo aloja la barra de estadísticas). */
	chatId: string;
	onModelChange: (model: string | undefined) => void;
	/** Comunica la altura asentada del dock (bloque + degradado) — el estado
	 *  dockReserve de ChatView alimenta con ella el espaciador de la transcripción. */
	onReserve: (h: number) => void;
	/** El contenido de la nota al margen del plan (el diagrama desnudo) — se renderiza
	 *  solo mientras una pregunta ocupa la franja. Null hasta que existe un plan. */
	plan?: React.ReactNode;
	/** Abre la ventana con el DAG completo (la comparten la nota al margen y el chip). */
	onOpenPlan: () => void;
	/** La tira de dictado (oleada STT): se renderiza en la ranura central de la barra
	 *  de estadísticas — el botón del micrófono + el medidor en vivo (components/dictation.tsx). */
	dictationSlot?: React.ReactNode;
	/** Esc en el campo de una pregunta pendiente detiene el dictado (la tira es de la
	 *  barra de estadísticas; la parada pertenece al hook de la página, que se pasa hacia abajo). */
	dictationCancel?: () => void;
	/** Las líneas del indicador de reorientaciones en cola (reorientación desde el compositor,
	 *  2026-10-03): ya filtradas por visibleQueuedSteers — solo reorientaciones sin vaciar. */
	queuedSteers: QueuedSteerLine[];
	/** La llamada a la acción persistente de configuración (BYOK, responsable 2026-09-22): la
	 *  misma píldora que llevan Inicio y /chat/new, encima del compositor mientras las ranuras no estén configuradas. */
	setupCta?: React.ReactNode;
}) {
	const controller = useOptionalInteractionLayers();
	const { isAtBottom, scrollToBottom, scrollRef } = useStickToBottomContext();
	// Estado de fondo fresco en cada render (ronda del parpadeo): el bloque de llegada de abajo
	// lo lee DURANTE EL RENDER — el mismo valor que el efecto posterior al pintado leía un
	// fotograma tarde. Se asigna en cada render, como las demás refs de más abajo.
	const atBottomRef = useRef(isAtBottom);
	atBottomRef.current = isAtBottom;
	// Montaje en la fase de enseñanza (recarga de sesión con una comprobación pendiente): el dock también
	// empieza como la invitación plegada — la comprobación no debe abrirse de golpe al recargar.
	const [expanded, setExpanded] = useState(!requiresReveal);
	// Estado de revelación (W5): false hasta que el alumno hace clic en la invitación. Mientras
	// sea false, la máquina de scroll NO debe desplegar sola al llegar abajo — el
	// alumno lee primero la enseñanza y abre la comprobación cuando está listo. Una vez
	// revelada, se aplican sin cambios las reglas normales de la máquina de plegado.
	const [revealed, setRevealed] = useState(false);
	const revealPending = requiresReveal && !revealed;

	const pendingId = pluginQuestion ? pluginQuestionOccurrenceKey(pluginQuestion.occurrence) : unreadablePlugin ? "unreadable-plugin-question" : pending?.key ?? null;
	const readingInputRef = useRef<HTMLDivElement>(null);
	const ownsDock = !!pending || !!pluginQuestion || unreadablePlugin || !!practice;
	const initialPendingRef = useRef(pendingId);
	const nativeViewReader = useRef<(() => NativeQuestionViewState) | null>(null) as ViewReaderRef<NativeQuestionViewState>;
	const practiceViewReader = useRef<(() => string) | null>(null) as ViewReaderRef<string>;
	const customViewReader = useRef<(() => { available: boolean }) | null>(null) as ViewReaderRef<{ available: boolean }>;
	nativeViewReader.changed = practiceViewReader.changed = customViewReader.changed = viewReader?.changed;

	// Estado de LLEGADA de una pregunta de enseñanza, aplicado durante el render — ANTES del
	// primer pintado (responsable, ronda de honestidad del scroll 2026-09-25). Hasta ahora, el
	// expanded=true obsoleto que dejaba la pregunta anterior pintaba un fotograma
	// de la pregunta ABIERTA: el dock se medía alto, reservaba esa altura para
	// siempre, y el plegado posterior al pintado nunca podía
	// devolverla (inmunidad del plegado) — así que una pregunta de enseñanza plegada desplazaba
	// la transcripción como si se hubiera abierto. Reiniciar aquí hace que el pintado
	// mida la barra, que la reserva conserve la altura del compositor y que el
	// único movimiento sea el propio texto de la enseñanza.
	const prevPendingIdRef = useRef(pendingId);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) {
			const arrival = revealArrival(wasQuestion);
			setExpanded(arrival.expanded);
			setRevealed(arrival.revealed);
		} else if (pendingId) {
			// Llegada de un sondeo (ronda del parpadeo): abierta si y solo si se sigue la conversación abajo.
			// Se pinta en ESTE render — sin fotograma abierto obsoleto ni cambio posterior al pintado.
			setExpanded(probeArrivalExpanded(atBottomRef.current));
		}
	}

	// Pregunta nueva A MITAD DE SESIÓN (ronda del parpadeo): el propio estado abierto/cerrado
	// se decide DURANTE EL RENDER, arriba; este efecto solo es responsable del scroll
	// de revelación para la llegada estando abajo — y ahora bajo la MISMA supresión del
	// plegado que usa la revelación de la enseñanza (el crecimiento de la llegada solía
	// adelantarse a la puesta al día del scroll, la máquina de posición leía el retraso como el
	// alumno yéndose, y el dock parpadeaba abierto → barra → abierto; reproducido
	// fotograma a fotograma el 2026-09-26, d llegó a ~405px). Al montar la sesión, el dock
	// empieza en su estado inicial — sin scroll ni transformación.
	useEffect(() => {
		if (!pendingId || pendingId === initialPendingRef.current) return;
		if (!requiresReveal && atBottomRef.current) void suppressFoldDuringReveal();
		// se dispara solo cuando llega una pregunta NUEVA
	}, [pendingId]);

	// ── Máquina de plegado (posición, no velocidad — responsable, ronda 1 de scroll) ──
	// El dock es un overlay: plegar es solo visual y la geometría de scroll nunca
	// se mueve, así que los umbrales pueden pegarse al fondo. Al dejarlo → se pliega; al volver
	// a alcanzarlo → se reabre. La banda muerta evita que la deriva del trackpad lo haga traquetear.
	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;
	// Propiedad del dock (la máquina de plegado, la inmunidad de la reserva, los
	// estados de llegada): una pregunta pendiente O un problema de práctica activo — cualquiera
	// de los dos sustituye al compositor y ocupa la franja.
	const pendingRef = useRef(ownsDock);
	pendingRef.current = ownsDock;
	const requiresRevealRef = useRef(requiresReveal);
	requiresRevealRef.current = requiresReveal;
	const revealedRef = useRef(revealed);
	revealedRef.current = revealed;

	const blockRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const shellRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const mode = pluginQuestion ? `plugin-question:${pendingId}` : unreadablePlugin ? "unreadable-plugin-question" : pending
		? `question:${pending.key}`
		: practice
			? `practice:${pluginPractice?.snapshot.problemId ?? practice.toolCallId}`
			: "chat";

	useLayoutEffect(() => {
		if (!viewReader || !viewTargets) return;
		const read = (): PluginSessionViewInput => {
			if (pluginQuestion && pluginDraft && viewTargets.pluginQuestion) return { ...viewTargets.pluginQuestion, input: pluginQuestion.input, expanded, revealed: !revealPending,
				available: customViewReader.current?.().available ?? false, draft: pluginDraft };
			if (unreadablePlugin) return { type: "unavailable", ...(unavailableOccurrence ? { occurrence: unavailableOccurrence } : {}), expanded, revealed: !revealPending };
			if (pending) {
				const state = nativeViewReader.current?.();
				const target = state && state.question.id === pending.toolCallId ? viewTargets.answer(state.question) : undefined;
				return target && state ? { ...target, expanded, revealed: !revealPending, available: true, draft: { ...state.draft, readingThinking } }
					: { type: "unavailable", occurrence: { messageId: pending.messageId, contentIndex: pending.contentIndex, toolCallId: pending.toolCallId, toolName: pending.tool }, expanded, revealed: !revealPending };
			}
			if (pluginPractice && viewTargets.pluginProblem) return { ...viewTargets.pluginProblem, input: pluginPractice.snapshot.input, expanded,
				available: customViewReader.current?.().available ?? false, draft: pluginPractice.draft };
			if (practice && viewTargets.thinking) return { ...viewTargets.thinking, expanded, draft: { thinking: practiceViewReader.current?.() ?? "" } };
			return viewTargets.text;
		};
		viewReader.current = read;
		return () => { if (viewReader.current === read) viewReader.current = null; };
	});
	const unavailableViewKey = unavailableOccurrence ? pluginQuestionOccurrenceKey(unavailableOccurrence) : "";
	useLayoutEffect(() => { viewReader?.changed?.(); }, [viewReader, mode, expanded, revealPending, readingThinking, unavailableViewKey]);

	// El ancho del flanco de la nota al margen del plan (responsable, ronda de colocación del plan): desde
	// el borde derecho del contenedor del DOCK hasta el borde derecho del bloque — el lienzo del
	// diagrama desnudo. Se sigue EN VIVO con un ResizeObserver sobre el bloque
	// (responsable, ronda de redimensionado): cada cambio de geometría — redimensionar la ventana, abrir o cerrar
	// la barra lateral, que aparezca la barra de scroll, el propio reajuste de líneas de la caja — comunica
	// el ancho real al instante, así que el suelo del fundido nunca va por detrás de la realidad (la antigua
	// medición en el render se quedaba obsoleta al redimensionar arrastrando y la decisión de
	// montaje llegaba tarde, de golpe).
	const [flankW, setFlankW] = useState(0);
	const flankWRef = useRef(0);
	// Parte A de la misma ronda (el silencio por redimensionado): cualquier cambio de tamaño del bloque
	// marca esto — la máquina de plegado ignora los eventos de scroll durante un instante después,
	// porque un redimensionado/reajuste de líneas vuelve a ajustar scrollTop y emite eventos de scroll
	// FANTASMA en pleno transitorio (la caja parpadeaba a la barra y volvía).
	// Los cambios de ancho marcan AQUÍ (redimensionados de la columna); el crecimiento de altura marca en
	// la OFERTA (ver offer más abajo) — el espaciador que crece es el origen del scroll fantasma,
	// no el campo que se estira. Los ENCOGIMIENTOS nunca marcan en ningún sitio: la
	// propia transformación del plegado encoge el bloque y devuelve la reserva, y
	// marcar eso silencia por sí mismo el redespliegue al llegar abajo — la caja se quedaba atascada
	// plegada (ronda de redimensionado).
	const geometryAtRef = useRef(0);
	useIsoLayoutEffect(() => {
		const block = blockRef.current;
		if (!block) return;
		const measure = () => {
			const next = Math.round(block.offsetWidth / 2 - DOCK_W / 2 - 2 * MARGIN_GAP);
			if (Math.abs(next - flankWRef.current) > 1) {
				flankWRef.current = next;
				setFlankW(next);
				geometryAtRef.current = Date.now();
			}
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(block);
		return () => ro.disconnect();
	}, []);

	// La reserva crece de inmediato, pero nunca encoge mientras una pregunta o un
	// problema de práctica ocupa el dock: encoger el espacio del flujo podría devolver abajo
	// a un alumno que esté cerca. El modo compositor sí puede devolver espacio.
	const reserveRef = useRef(0);
	const offer = useCallback((blockH: number) => {
		const next = blockH + GRADIENT_H;
		if (next <= reserveRef.current + 0.5 && pendingRef.current) return;
		// Marca el crecimiento en el origen, incluidos los redimensionados que solo afectan al campo hijo, para que
		// la puesta al día de stick-to-bottom no se confunda con el alumno yéndose.
		if (shouldStampGeometryMute(next, reserveRef.current, pendingRef.current)) geometryAtRef.current = Date.now();
		reserveRef.current = next;
		onReserve(next);
	}, [onReserve]);

	// El overlay no debe pintar encima de la barra de scroll del contenedor (responsable, ronda 2
	// de scroll): el contenedor reserva márgenes simétricos (scrollbar-gutter:
	// stable both-edges), así que se mete el borde derecho del overlay lo que mide el margen —
	// cero con las barras de scroll superpuestas de macOS, el ancho real en las plataformas clásicas.
	// Reparte el presupuesto de todo el dock sólido, dejando flexible solo el área de la pregunta.
	// El hook mide el contenido natural y visible antes del efecto de transformación/reserva
	// de más abajo. En ventanas bajas se desplaza el cuerpo de lectura/pregunta/respuesta;
	// la barra de estadísticas/modelo queda fuera de esa ventana de desbordamiento.
	const [sbInset, setSbInset] = useState(0);
	const stateKey = dockStateKey(mode, ownsDock, expanded);
	const heightMorphRef = useRef<ReturnType<typeof createDockMorph> | null>(null);
	if (!heightMorphRef.current) heightMorphRef.current = createDockMorph();
	const retargetOpening = useCallback(() => heightMorphRef.current?.retarget(stateKey), [stateKey]);
	useIsoLayoutEffect(() => () => heightMorphRef.current?.dispose(), []);
	useDockHeight({
		scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef,
		expanded, enabled: ownsDock, mode, onScrollbarInset: setSbInset, onHeight: offer,
		onLayout: retargetOpening,
	});

	// SILENCIO POR CRECIMIENTO (ronda del responsable, 2026-10-05 — el vaivén de la generación): durante un
	// turno vivo, el contenido de la transcripción crece y stick-to-bottom lo persigue;
	// la distancia transitoria al fondo solía leerse como el alumno
	// yéndose, y el dock se plegaba abierto↔barra («desaparece y vuelve a aparecer»).
	// Un ResizeObserver sobre el contenido del contenedor de scroll marca el MISMO silencio que usan
	// los propios redimensionados del dock — los fotogramas de crecimiento nunca pueden plegar. Los encogimientos no marcan
	// nada (la propia transformación del plegado encoge la reserva; silenciarla
	// silenciaría por sí mismo el redespliegue al llegar abajo).
	const growthAtRef = useRef(0);
	useEffect(() => {
		const el = scrollRef.current;
		const content = el?.firstElementChild as HTMLElement | null | undefined;
		if (!el || !content) return;
		let prevH = content.getBoundingClientRect().height;
		const ro = new ResizeObserver(() => {
			const h = content.getBoundingClientRect().height;
			if (h > prevH + 0.5) growthAtRef.current = Date.now();
			prevH = Math.max(prevH, h);
		});
		ro.observe(content);
		return () => ro.disconnect();
	}, [scrollRef]);

	// La rueda del ratón sobre el dock aún debe desplazar la transcripción (responsable, ronda 2
	// de scroll): el overlay es HERMANO del contenedor de scroll, así que el encadenamiento
	// nativo del scroll del navegador se detiene en el overlay (el antiguo dock dentro del flujo
	// encadenaba gratis). Los contenedores de scroll internos — el área de la pregunta, el desbordamiento
	// del textarea, los menús de modelo — conservan el scroll nativo, incluido su propio
	// encadenamiento en los bordes; solo cuando nada bajo el cursor puede absorber el
	// desplazamiento lo reenviamos a la transcripción.
	useEffect(() => {
		const root = blockRef.current;
		const el = scrollRef.current;
		if (!root || !el) return;
		const onWheel = (e: WheelEvent) => forwardDockWheel(e, root, el);
		root.addEventListener("wheel", onWheel, { passive: false });
		return () => root.removeEventListener("wheel", onWheel);
	}, [scrollRef]);

	// Despliegue explícito (clic en la barra): el scroll suave hasta el fondo tarda
	// cientos de ms, durante los que la posición sigue estando legítimamente dentro de
	// la zona de plegado — la máquina volvería a plegar el dock al instante
	// (abierto → se cierra de golpe → se reabre abajo, el parpadeo). Suprime la
	// rama de plegado hasta que el scroll de revelación se asiente o se interrumpa.
	// (Ronda del parpadeo, 2026-09-26: extraído — la llegada de un sondeo estando
	// abajo es la MISMA clase de movimiento y necesita la misma cobertura; en palabras
	// del responsable: la apertura de la llegada y su scroll hasta el fondo «deberían ser el
	// mismo tipo de movimiento».)
	const expandIntentRef = useRef(false);
	const intentTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const suppressFoldDuringReveal = () => {
		expandIntentRef.current = true;
		clearTimeout(intentTimerRef.current);
		intentTimerRef.current = setTimeout(() => {
			expandIntentRef.current = false;
		}, 2000);
		return Promise.resolve(scrollToBottom()).finally(() => {
			clearTimeout(intentTimerRef.current);
			expandIntentRef.current = false;
		});
	};
	const expandAndReveal = () => {
		setRevealed(true); // se aceptó la invitación a la comprobación de la enseñanza (W5)
		setExpanded(true);
		void suppressFoldDuringReveal();
	};
	const expandAndRevealRef = useRef(expandAndReveal);
	expandAndRevealRef.current = expandAndReveal;
	// ENTER ABRE LA COMPROBACIÓN QUE ESPERA (responsable, ronda de teclado 2026-10-06):
	// mientras una pregunta espera con el dock CERRADO — tras su invitación de
	// revelación o plegado por el scroll —, Enter nunca está muerto. Cualquier dictado
	// vivo TERMINA PRIMERO (el volcado va al campo de razonamiento de
	// lectura, su reclamo vivo — la ley de que nada se pierde) y luego se abre la
	// comprobación. Una superficie de escritura o un botón enfocado tiene su propio Enter (el
	// campo de razonamiento de lectura abre DESDE DENTRO cuando la comprobación está cerrada;
	// un botón enfocado se activa de forma nativa) — este oyente solo reclama
	// el caso muerto: foco normal con un Enter que no hace nada.
	useEffect(() => {
		if ((!pending && !pluginQuestion && !unreadablePlugin) || expanded) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.altKey || e.defaultPrevented || pluginQuestionKeySuppressed(e) || composingQuestionKey(e) || !isInteractionScopeEligible(blockRef.current, controller)) return;
			if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
			const t = e.target as HTMLElement | null;
			if (
				t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
				t.tagName === "TEXTAREA" ||
				t.isContentEditable ||
				t.closest("button"))
			)
				return;
			e.preventDefault();
			void finishDictation().then(() => {
				expandAndRevealRef.current();
			});
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [pending, pluginQuestion, unreadablePlugin, expanded, controller]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			if (!pendingRef.current) return;
			// Silencio por redimensionado (responsable, ronda de redimensionado): un cambio de geometría vuelve a ajustar
			// scrollTop y el navegador emite el ajuste como un evento de scroll —
			// leer la posición transitoria plegaba la caja a la barra durante un
			// parpadeo. El scroll real se reanuda tras la breve ventana de silencio.
			if (Date.now() - geometryAtRef.current < 400) return;
			// Silencio por crecimiento (ronda del responsable, 2026-10-05): que la transcripción crezca
			// bajo un turno vivo no es el alumno yéndose.
			if (Date.now() - growthAtRef.current < 400) return;
			const d = el.scrollHeight - el.clientHeight - el.scrollTop;
			if (expandedRef.current) {
				// PLEGADO SUJETO A LA INTENCIÓN (decisión del responsable, 2026-10-05): la distancia por sí sola
				// plegaba con los transitorios de puesta al día de stick-to-bottom; un plegado real
				// necesita la distancia Y que stick-to-bottom esté de acuerdo en que el alumno
				// dejó el fondo.
				if (d > COLLAPSE_DIST && !expandIntentRef.current && !atBottomRef.current) setExpanded(false);
			} else if (d < EXPAND_DIST) {
				// Las comprobaciones de la enseñanza siguen plegadas hasta que el alumno las abre (W5): el
				// despliegue automático al llegar abajo sacaría el formulario encima de la enseñanza.
				if (requiresRevealRef.current && !revealedRef.current) return;
				setExpanded(true);
				void scrollToBottom();
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [scrollRef, scrollToBottom]);

	// La altura asentada del bloque (sin el degradado), ofrecida al espaciador.
	// Solo se llama con alturas NATURALES — nunca con el valor animado a mitad de
	// transformación (la guarda getAnimations del efecto iso envuelve cada llamada).
	const measureBlock = () => {
		const b = blockRef.current;
		if (b) offer(b.getBoundingClientRect().height);
	};

	// La variante inicial de una sesión aparece al instante — el fundido/ascenso se
	// reserva para las transiciones a mitad de sesión.
	const initialModeRef = useRef(mode);

	// Transformación de altura: anima el envoltorio desde su altura anterior hasta la nueva
	// siempre que cambia la variante (chat ↔ pregunta ↔ barra plegada). El crecimiento
	// al escribir conserva la misma stateKey y NO se anima.
	// El fundido del CONTENIDO del plegado (ronda del responsable, 2026-10-05): la altura del envoltorio
	// se transforma, pero el contenido barra↔formulario se intercambiaba en seco. Un fundido/ascenso WAAPI
	// al conmutar — sin remontar, para que el estado del formulario de la pregunta sobreviva.
	const prevExpandedForFadeRef = useRef(expanded);
	useIsoLayoutEffect(() => {
		if (prevExpandedForFadeRef.current === expanded) return;
		prevExpandedForFadeRef.current = expanded;
		contentRef.current?.animate(
			[{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
			{ duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
		);
	}, [expanded]);
	// La clave de la transformación de altura (components/dock-state-key.ts): el término
	// expandido (el plegado) pertenece a TODAS las variantes del dock — pregunta Y
	// práctica (arreglo del responsable, 2026-10-06). El crecimiento al escribir conserva la clave y
	// nunca se anima; plegar/desplegar se transforma como siempre ha hecho la enseñanza.
	useIsoLayoutEffect(() => {
		const el = shellRef.current;
		if (!el) return;
		// El controlador privado solo es responsable de la animación de altura de este envoltorio. Un layout
		// tardío de los hijos puede redirigir una apertura durante el tiempo original que le queda;
		// el cierre y la escritura normal conservan su comportamiento actual.
		heightMorphRef.current?.layout(el, stateKey, ownsDock && expanded, measureBlock);
	});

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ right: sbInset }}>
			<div className="h-24 bg-gradient-to-t from-background via-background/85 to-transparent" />
			<div ref={blockRef} className="relative bg-background pb-5">
				<div className={DOCK}>
					<div ref={viewportRef} data-dock-viewport="" className="pointer-events-auto">
					<div ref={bodyRef}>
					{setupCta}
					{reconciliation === "failed" && <div role="alert" className="mb-2 rounded-2xl border bg-card px-4 py-3 text-sm">Could not sync the saved session. <Button type="button" variant="ghost" onClick={onRetrySync}>Retry syncing</Button></div>}
					{/* El indicador de reorientaciones en cola (especificación del responsable 2026-10-03):
					discretas líneas sueltas encima del envoltorio — alineadas a la derecha con el punto
					donde empieza el redondeo de su esquina, truncadas, sin fondo ni contenedor. Una
					línea muere cuando llega su tarjeta (visibleQueuedSteers). */}
					<QueuedSteersBody steers={queuedSteers} />
					{/* El campo de razonamiento de lectura (responsable 2026-10-03): montado mientras una
					comprobación de la fase de enseñanza espera — la misma señal que la pliega.
					Reclama la voz dictada hasta que el alumno revela la comprobación
					(entonces la recupera el dock). Viaja con la respuesta a la comprobación al enviar. */}
					{(pending || pluginQuestion) && requiresReveal && (
						<ReadingThinkingField
							inputRef={readingInputRef}
							value={readingThinking}
							revision={readingThinkingRevision}
							onChange={onReadingThinking}
							onEscape={dictationCancel}
							onOpen={
								!expanded
									? () => {
											void finishDictation().then(() => {
												expandAndRevealRef.current();
											});
										}
									: undefined
							}
							claim={revealPending}
						/>
					)}
					<div ref={shellRef} data-attachment-composer="" className="pointer-events-auto overflow-hidden rounded-2xl border bg-card shadow-lg">
						{preparationStatus}
						{/* Incluye los márgenes de los descendientes (en particular, el margen inferior del
						razonamiento de la práctica) en la medición del contenido natural. */}
						<div
							ref={contentRef}
							key={mode}
							className={mode === initialModeRef.current ? "flow-root" : "flow-root dock-variant"}
						>
							{pluginQuestion && pluginDraft ? (
								<PluginQuestionDock viewReader={customViewReader} snapshot={pluginQuestion} chatId={chatId} draft={pluginDraft} expanded={expanded} reveal={revealPending} onExpand={expandAndReveal} ready={pluginReady} available={pluginAvailable} reconciliation={reconciliation} readingRef={readingInputRef} onMicAvailable={onPluginMicAvailable} send={onPluginSend} dismiss={onPluginDismiss} prepareSubmission={onPreparePluginQuestion} />
							) : unreadablePlugin ? (
								<div className="px-4 py-3">
									{reconciliation === "syncing" && <p role="status" className="text-sm text-muted-foreground">Preparing question…</p>}
									{reconciliation === "ready" && <><p role="status" className="text-sm text-muted-foreground">Question unavailable</p><Button type="button" variant="ghost" disabled={!pluginReady} onClick={() => { void finishDictation().then(onPluginDismiss); }}>Dismiss question</Button></>}
								</div>
							) : pending ? (
								<QuestionDock
									viewReader={nativeViewReader}
									toolName={pending.tool as "quiz" | "probe" | "ask_user_question" | "explain" | "recall"}
									toolCallId={pending.toolCallId}
									input={pending.input as never}
									expanded={expanded}
									reveal={revealPending}
									phase={phase}
									onExpand={expandAndReveal}
									onSubmit={onSubmitAnswer}
									onPrepareSubmission={onPrepareBuiltin}
									hasPendingInput={onBuiltinPendingInput}
									preparing={preparing}
									initialDraft={initialQuestionDraft}
									onSaveDraft={onSaveQuestionDraft}
									workingRef={workingRef}
									onEscape={dictationCancel}
									dictationClaim={!revealPending}
									compactionRunning={compactionRunning}
								/>
							) : pluginPractice ? (
								<PluginProblemDock {...pluginPractice} viewReader={customViewReader} expanded={expanded} onExpand={() => { setExpanded(true); void suppressFoldDuringReveal(); }} />
							) : practice ? (
								<PracticeDock
									viewReader={practiceViewReader}
									problemCallId={practice.toolCallId}
									input={practice.input as { statement: string }}
									expanded={expanded}
									onExpand={() => {
										setExpanded(true);
										void suppressFoldDuringReveal();
									}}
									onSubmit={onSubmitThinking}
									onPrepareSubmission={onPrepareThinking}
									hasPendingInput={pendingThinkingInput}
									preparing={preparing}
									onEscape={dictationCancel}
									compactionRunning={compactionRunning}
								/>
							) : (
								composer
							)}
						</div>
					</div>
					</div>
					</div>
					{/* La fila de estadísticas: bajo el envoltorio del compositor/la pregunta, no
					pegada al borde inferior de la pantalla — altura estática, fuera del
					envoltorio que se transforma, para que nunca entre en una animación de altura. */}
					<StatsBar
						turns={turns}
						contextTokens={contextTokens}
						cliContextWindow={cliContextWindow}
						pricing={pricing}
						dictationSlot={dictationSlot}
						chatId={chatId}
						onModelChange={onModelChange}
					/>
					{/* El disco de bajar (traído aquí desde Conversation,
					ronda de ajustes del responsable 2026-09-24): anclado al borde superior
					del BLOQUE — encima del envoltorio del compositor Y de la fila de estadísticas, en
					la franja transparente del degradado —, así que nunca tapa
					ningún elemento del dock. Como el ancla es el propio bloque
					(no el fondo del contenedor de scroll), acompaña EN VIVO cada cambio de
					altura: el crecimiento al escribir, una pregunta pendiente que agranda la
					franja, la transformación de plegado de 180 ms. pointer-events-auto: el
					overlay es none por defecto. El contexto isAtBottom/scrollToBottom
					sigue llegándole — DockOverlay es hijo de
					Conversation. */}
					<ConversationScrollButton className="pointer-events-auto bottom-full mb-2" />
				</div>
				{/* La nota al margen del plan (responsable, ronda de colocación del plan): el
				diagrama desnudo en el flanco derecho de la franja — sin bordes, ajustado con meet, parte
				de la página de la lección más que un widget flotante. Montada solo
				mientras una pregunta ocupa la franja (su altura reservada es el lienzo);
				plegar el dock la funde + desenfoca hasta hacerla desaparecer, así que leer
				la transcripción completa deja limpio el margen. Clic → ventana.
				Ancho (responsable, ronda de redimensionado): la caja encoge de forma continua con
				el flanco; por debajo de MARGIN_MIN_W se FUNDE (nunca desaparece de golpe — no hay
				desmontaje a mitad de pregunta), y al ensanchar por encima del suelo vuelve
				a aparecer con un fundido. */}
				{(pending || pluginQuestion) && plan && (
					<Hint label="Open the full plan" side="bottom">
<button
						type="button"
						data-testid="plan-marginalia"
						onClick={onOpenPlan}
						style={{ left: `calc(50% + ${DOCK_W / 2 + MARGIN_GAP}px)` }}
						className={`absolute bottom-5 right-4 top-0 cursor-pointer transition-[filter,opacity] duration-300 ease-out ${
							expanded && flankW >= MARGIN_MIN_W
								? "pointer-events-auto opacity-100 blur-0"
								: "pointer-events-none opacity-0 blur-md"
						}`}
					>
						{plan}
					</button>
</Hint>
				)}
			</div>
		</div>
	);
}
