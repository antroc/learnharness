"use client";

/**
 * EL HOOK DE SESIÓN (oleada D, aprobado por el responsable 2026-09-26): el
 * adaptador de React sobre el SessionModel puro (components/session-core.ts
 * — la máquina de estados, que se puede probar sin renderizador). Toda la
 * mecánica vive en el modelo; este hook re-renderiza al cambiar y deriva la
 * vista (projectView de core/view.ts — la agrupación de referencia dorada,
 * en el cliente).
 *
 * Cada turno es un proceso en segundo plano en el servidor (decisión del
 * responsable 2026-09-25); el hook es una vista. Cada envío es UN evento de
 * entrada explícito ({chatId, input}); el stream del turno es el paso
 * LITERAL de AgentEvent. Vocabulario de estado (paridad previa a la oleada
 * D): ready | submitted | streaming | error.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ChatInput, LhMessage, QuestionAnswerData } from "@/src/core";
import { SessionModel, type SessionState } from "@/components/session-core";

export interface UseChatSessionOptions {
	chatId: string;
	/** La semilla del registro nativo (página renderizada en el servidor o una sincronización completa). */
	initialMessages: LhMessage[];
	/** Fallo transitorio de asentamiento conservado por el servidor, no por la transcripción. */
	initialError?: string;
	/** Reenganche al montar: hay un turno en marcha en el servidor sin vista viva. */
	initiallyInFlight?: boolean;
}

export function useChatSession({ chatId, initialMessages, initialError, initiallyInFlight }: UseChatSessionOptions) {
	// El modelo es por montaje (componente con clave chatId); onChange fuerza el
	// re-render. El patrón de ref lo mantiene estable entre renders.
	const modelRef = useRef<SessionModel | null>(null);
	if (modelRef.current === null) {
		modelRef.current = new SessionModel({ chatId, initialMessages, initialError });
	}
	const model = modelRef.current;
	// La VERSIÓN del render — se incrementa con cada cambio del modelo, para que
	// el memo de estado de abajo se recalcule justo cuando el modelo cambia de
	// verdad. (Usar el dispatch del reducer como dependencia del memo era un fallo
	// de congelación: dispatch es ESTABLE por contrato, así que el memo se calculaba
	// una vez por montaje y la vista nunca veía ninguna actualización del modelo —
	// ni burbuja optimista, ni stream, ni banner de error. El fallo de la sesión vacía, 2026-09-26.)
	const [version, bump] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		model.onChange = bump;
		return () => {
			model.onChange = undefined;
		};
	}, [model, bump]);

	// Reenganche al montar (seguro con StrictMode: una reanudación más reciente cancela la anterior).
	// PRIMERO ENGANCHAR (responsable, ronda de reenganche 2026-10-02): el render de la página
	// acaba de leer el registro — la nueva petición bloqueante del registro solo añadía latencia
	// de negociación antes de la repetición instantánea, así que un montaje nuevo se engancha
	// directamente. El efecto de este hook es el ÚNICO responsable del reenganche al montar
	// (el duplicado de chat.tsx se borró en esa misma ronda).
	//
	// DIETA DE CONEXIONES A (responsable, 2026-10-10 — análisis post mortem del
	// bloqueo con sesiones en paralelo): desmontar LIBERA la conexión del stream. El
	// turno es un proceso del servidor — sigue corriendo sin ninguna vista; el
	// stream GET abierto de esta página (o, antes de la dieta B, su stream POST)
	// sobrevivía a la navegación, ocupando en silencio una de las 6 ranuras de
	// conexión por origen del navegador hasta que el turno se asentaba, emitiendo
	// hacia un componente muerto. Con suficientes vistas filtradas se ahogaba toda
	// petición NUEVA (incluidas las peticiones RSC de navegación) — el bloqueo de la navegación con varias sesiones.
	// Abortar no cuesta nada: al volver se repite el registro compactado + la cola viva.
	useEffect(() => {
		if (initiallyInFlight) void model.resumeStream(false);
		return () => {
			model.stop();
		};
	}, [initiallyInFlight, model]);

	// La vista + el estado, derivados del modelo en cada cambio del modelo.
	const state = useMemo<SessionState>(() => model.getState(), [model, version] as const);

	// LA DIFUSIÓN DEL ESTADO DEL TURNO (responsable, ronda de la barra lateral
	// 2026-10-02): la misma máquina optimista, propagada — en el instante en que
	// empieza un turno en local (submitted: send, respuesta, inicio de sesión,
	// reenganche, enganche al despertar) la barra lateral se entera sin esperar a
	// su sondeo de 2,5s; al asentarse, el evento limpia la fila y dispara una
	// nueva petición inmediata. El modelo sigue siendo puro; este adaptador es dueño de la frontera
	// de la ventana (el patrón de lh:chat-renamed).
	const prevStatusRef = useRef(state.status);
	useEffect(() => {
		const was = prevStatusRef.current;
		prevStatusRef.current = state.status;
		if (was === state.status) return;
		const running = state.status === "submitted" || state.status === "streaming";
		const wasRunning = was === "submitted" || was === "streaming";
		if (running === wasRunning) return; // submitted→streaming: sigue en marcha; error↔ready: no
		window.dispatchEvent(new CustomEvent("lh:turn-state", { detail: { id: chatId, running } }));
	}, [state.status, chatId]);

	// El terminal de asentamiento del reenganche → la frontera de sincronizar y continuar (chat.tsx).
	const setReattachSettled = useCallback(
		(fn: () => void) => {
			model.setReattachSettled(fn);
		},
		[model],
	);

	const send = useCallback((input: ChatInput, onAccepted?: () => void, questionKey?: string, onDeliverySettled?: () => void) => model.send(input, onAccepted, questionKey, onDeliverySettled), [model]);
	const continueIfOwed = useCallback((record: readonly LhMessage[]) => void model.continueIfOwed(record), [model]);
	const steer = useCallback((text: string, images?: import("@/src/core").PluginSubmissionContent["images"], onAccepted?: () => void, onDeliverySettled?: () => void) => model.steer(text, images, onAccepted, onDeliverySettled), [model]);
	const submitAnswer = useCallback(
		(tool: string, toolCallId: string, output: QuestionAnswerData, questionKey?: string) =>
			void model.submitAnswer(tool, toolCallId, output, questionKey),
		[model],
	);
	const dismissQuestion = useCallback(
		(toolCallId: string, answer: QuestionAnswerData, questionKey?: string) => void model.dismissQuestion(toolCallId, answer, questionKey),
		[model],
	);
	const dismissProblem = useCallback(
		(problemCallId: string) => void model.dismissProblem(problemCallId),
		[model],
	);
	const questionDraft = useCallback((questionKey: string) => model.questionDraft(questionKey), [model]);
	const saveQuestionDraft = useCallback((questionKey: string, draft: Parameters<SessionModel["saveQuestionDraft"]>[1]) => model.saveQuestionDraft(questionKey, draft), [model]);
	const setMessages = useCallback((record: LhMessage[], turnError?: string, availability?: Parameters<SessionModel["setMessages"]>[2], problemAvailability?: Parameters<SessionModel["setMessages"]>[3]) => model.setMessages(record, turnError, availability, problemAvailability), [model]);
	const reconcile = useCallback(() => model.reconcile(), [model]);
	const readRecord = useCallback((options?: Parameters<SessionModel["readRecord"]>[0]) => model.readRecord(options), [model]);
	const pluginProblemDraft = useCallback((snapshot: Parameters<SessionModel["pluginProblemDraft"]>[0]) => model.pluginProblemDraft(snapshot), [model]);
	const pluginQuestionDraft = useCallback((snapshot: Parameters<SessionModel["pluginQuestionDraft"]>[0]) => model.pluginQuestionDraft(snapshot), [model]);
	const dismissPluginQuestion = useCallback((occurrence: Parameters<SessionModel["dismissPluginQuestion"]>[0], questionId?: string) => model.dismissPluginQuestion(occurrence, questionId), [model]);
	const adoptRecord = useCallback((record: LhMessage[]) => model.adoptRecord(record), [model]);
	const stop = useCallback(() => model.stop(), [model]);
	const clearError = useCallback(() => model.clearError(), [model]);
	const resumeStream = useCallback(() => void model.resumeStream(), [model]);

	return {
		messages: state.messages,
		nativeMessages: state.nativeMessages,
		canonicalMessages: state.canonicalMessages,
		reconciliation: state.reconciliation,
		reconcile,
		readRecord,
		pluginQuestionAvailability: state.pluginQuestionAvailability,
		pluginProblemAvailability: state.pluginProblemAvailability,
		pluginProblemDraft,
		pluginQuestionDraft,
		dismissPluginQuestion,
		hasConfirmedConversation: state.hasConfirmedConversation,
		contextTokens: state.contextTokens,
		status: state.status,
		evaluating: state.evaluating,
		error: state.error,
		steerQueue: state.steerQueue,
		send,
		continueIfOwed,
		steer,
		submitAnswer,
		dismissQuestion,
		dismissProblem,
		questionDraft,
		saveQuestionDraft,
		setMessages,
		adoptRecord,
		stop,
		clearError,
		resumeStream,
		setReattachSettled,
	};
}
