"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ViewReaderRef, NativeQuestionViewState } from "./session-view-readers";
import { ArrowDownIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { finishDictation, isDictationActive, joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { PathInput } from "@/components/path-input";
import { MalformedQuestion } from "@/components/malformed-question";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { QuestionPreview } from "@/components/question-preview";
import { cn } from "@/lib/utils";
import {
	buildAnswer,
	toClientQuestion,
	normalizeQuizType,
	CONFIDENCE_STOPS,
	DEFAULT_CONFIDENCE_INDEX,
	emptyDockSelection,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	toolQuestionKind,
	parseAskInput,
	parseQuizInput,
	parseExplainInput,
	toggleOption,
	toggleOther,
	type AnswerRequest,
	type AskToolInput,
	type DockSelection,
	type ExplainToolInput,
	type QuestionAnswerData,
	type QuestionFormDraft,
	type QuestionData,
	type QuestionMode,
	type QuizToolInput,
	type SelectMode,
	type Phase3,
} from "@/src/core";
import type { PrepareBuiltinSubmission } from "./plugin-submission-adapters";
import { CONFIDENCE_COLORS, confidenceRailStyle } from "@/components/confidence-rail";

/**
 * El dock de preguntas — un quiz/ask pendiente SUSTITUYE al composer del
 * chat: la burbuja persistente de abajo se transforma en la pregunta. Aquí se
 * encuentran dos voces: la del profesor (pregunta, opciones, explicación) y
 * la del alumno — "Your thinking", un campo etiquetado gemelo del composer
 * para volcar el razonamiento, con Submit acoplado dentro exactamente como el
 * envío del composer del chat.
 *
 * El campo de thinking es el canal de transferencia de todo el producto
 * (oleada 2): nunca se le llama "opcional", Enter hace un SALTO DE LÍNEA
 * (sirve para volcar — pronto dictado, no tecleado), el envío es solo el
 * botón y su tamaño se escala con la fase (el sondeo se mantiene rápido; la
 * enseñanza invita a profundizar). La opción "Other…" es una FILA de opción
 * editable — círculo + input en línea, con el mismo estilo que sus hermanas
 * — para que elegir Other nunca desplace el thinking.
 *
 * El comportamiento de plegado (scroll hacia arriba → barra fina) es cosa
 * del DockOverlay de la vista del chat, que también es dueño del armazón
 * persistente y de su transformación de altura. Este componente es solo
 * contenido. El formulario desplegado sigue MONTADO mientras está plegado
 * (oculto, no desmontado) para que una selección a medias sobreviva al scroll.
 */

export interface QuestionDockProps {
	/** Lectura privada de la vista en el momento del clic: sin guardar el borrador ni volcar el dictado. */
	viewReader?: ViewReaderRef<NativeQuestionViewState>;
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall";
	toolCallId: string;
	input: QuizToolInput | AskToolInput | ExplainToolInput;
	/** Estado de plegado, propiedad del DockOverlay (gobierna la transformación de altura del armazón). */
	expanded: boolean;
	/**
	 * Comprobación de la fase de enseñanza a la espera de su revelación (visión
	 * §2, W5): mientras está plegada, la barra es la invitación "Check your
	 * understanding" en lugar de la tira del plegado por scroll. Propiedad del
	 * DockOverlay; false una vez que el alumno la ha revelado (a partir de ahí
	 * mandan las reglas normales de la máquina de plegado).
	 */
	reveal?: boolean;
	onExpand: () => void;
	onSubmit: (output: QuestionAnswerData) => void;
	onPrepareSubmission?: PrepareBuiltinSubmission;
	hasPendingInput?: (question: QuestionData) => boolean;
	preparing?: boolean;
	/** Restaura solo el envío sin confirmar de esta llamada tras la recuperación. */
	initialDraft?: QuestionFormDraft;
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Escape en un campo de pregunta detiene el dictado (oleada STT) — se pasa
	 *  desde la página que es dueña del hook de dictado. */
	onEscape?: () => void;
	/** El trabajo actual sin enviar del alumno (thinking, o la respuesta
	 *  tecleada en modo texto), mantenido al día para los empujones del hilo lateral. */
	workingRef?: { current: string };
	/** La máquina del teclado (oleada B) solo está armada mientras el dock está
	 *  desplegado — la barra plegada conserva su Enter nativo para desplegar. */
	active?: boolean;
	/** Fase de la sesión en la pregunta — escala el campo de thinking: el
	 *  sondeo se mantiene rápido (una fila), la enseñanza invita a volcar (tres filas). */
	phase?: Phase3;
	/** Reclamación del dictado (responsable 2026-10-03): false mientras una
	 *  comprobación de la fase de enseñanza sigue SIN REVELAR — el campo de
	 *  reading-thinking es dueño del habla dictada durante la lectura; el dock
	 *  lo recupera al revelar. Por defecto true (preguntas de sondeo,
	 *  predicciones, llamadores antiguos). */
	dictationClaim?: boolean;
	/** Hay una compactación en marcha para este chat (ronda 14 del
	 *  responsable): el POST de la respuesta se bloquearía en la barrera de
	 *  compactación del servidor — desactiva el envío y dilo en la fila de
	 *  pista. El registro del servidor es la barrera real; esto es la indicación. */
	compactionRunning?: boolean;
}

export function QuestionDock({
	viewReader,
	toolName,
	toolCallId,
	input,
	expanded,
	reveal = false,
	onExpand,
	onSubmit,
	onPrepareSubmission,
	hasPendingInput,
	preparing,
	initialDraft,
	onSaveDraft,
	onEscape,
	phase = "probe",
	dictationClaim = true,
	compactionRunning = false,
	workingRef,
}: QuestionDockProps) {
	// Los nombres de la fase de sondeo (responsable, 2026-10-09) se canonizan a
	// sus gemelos de enseñanza para todo lo que concierne al dock — despacho del
	// análisis, etiquetas, tipos: el quiz de sondeo ("probe") tiene forma de quiz,
	// el recuerdo libre de sondeo ("recall") tiene forma de explain. Los registros antiguos conservan los nombres de enseñanza.
	const canonical =
		toolName === "probe" ? "quiz" : toolName === "recall" ? "explain" : toolName;
	// El nombre visible del chip lleva el nombre PROPIO de la herramienta
	// (responsable 2026-10-09): las preguntas de la fase de sondeo se etiquetan
	// Probe/Recall en el composer; las herramientas de enseñanza conservan las etiquetas de siempre.
	const toolLabel = toolName === "probe" ? "Probe" : toolName === "recall" ? "Recall" : undefined;
	// Analiza, no fuerces el tipo (src/core/tool-parts.ts): el modelo escribió
	// esta entrada, y solo el esquema que declaró la herramienta responde de su
	// forma. El dock se monta sobre partes input-available (ya validadas en el
	// puente), así que esto es pura defensa en profundidad — pero ahora es
	// ESTRUCTURAL: lo que se cuele renderiza la alternativa discreta, nunca un
	// fallo por `.map` sobre bytes escritos por el modelo.
	const parsed = useMemo(() =>
		canonical === "quiz" ? parseQuizInput(input) : canonical === "explain" ? parseExplainInput(input) : parseAskInput(input), [canonical, input]);
	if (!parsed) {
		return <MalformedQuestion />;
	}
	return (
		<>
			{!expanded && (
				<QuestionDockBar
					toolName={canonical}
					question={parsed.question}
					onExpand={onExpand}
					variant={reveal ? "reveal" : "collapsed"}
					toolLabel={toolLabel}
					label={
						(canonical === "quiz" || canonical === "explain") &&
						normalizeQuizType((parsed as { type?: unknown }).type) === "predict"
							? "Prediction"
							: undefined
					}
				/>
			)}
			<div className={expanded ? "dock-variant" : "invisible h-0 overflow-hidden"}>
				<QuestionDockForm
					viewReader={viewReader}
					toolName={toolName}
					toolCallId={toolCallId}
					input={parsed}
					phase={phase}
					active={expanded}
					onSubmit={onSubmit}
					onPrepareSubmission={onPrepareSubmission}
					hasPendingInput={hasPendingInput}
					preparing={preparing}
					initialDraft={initialDraft}
					onSaveDraft={onSaveDraft}
					onEscape={onEscape}
					workingRef={workingRef}
					dictationClaim={dictationClaim}
					compactionRunning={compactionRunning}
				/>
			</div>
		</>
	);
}

/** La tira plegada. Dos especies (W5): "collapsed" es la minimización por scroll
 *  (chip de tipo + una línea + Answer ↓); "reveal" es la invitación de la
 *  comprobación de enseñanza — una indicación distinta y más atractiva, porque
 *  pide al alumno que empiece algo, no que retome algo. */
export function QuestionDockBar({
	toolName,
	question,
	onExpand,
	variant = "collapsed",
	label,
	toolLabel,
}: {
	toolName: "quiz" | "ask_user_question" | "explain";
	question: string;
	onExpand: () => void;
	variant?: "collapsed" | "reveal";
	/** El texto del chip de tipo (responsable 2026-10-03): "Prediction" cuando
	 *  un quiz de tipo predict se minimiza por scroll — las predicciones nunca
	 *  usan la variante reveal, pero la tira del plegado por scroll aún puede ocultarlas. */
	label?: string;
	/** El nombre visible de la HERRAMIENTA en el chip (responsable 2026-10-09):
	 *  las llamadas de la fase de sondeo se etiquetan Probe/Recall — el límite de
	 *  fase visible en el composer. */
	toolLabel?: string;
}) {
	if (variant === "reveal") {
		return (
			<button
				type="button"
				data-testid="teach-check-reveal"
				onClick={onExpand}
				className="dock-variant flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
			>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
					<PlayIcon className="size-3.5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">Check your understanding</span>
					<span className="block text-xs text-muted-foreground">
						<QuestionPreview>{question}</QuestionPreview>
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
					Open <ChevronRightIcon className="size-3.5" />
				</span>
			</button>
		);
	}
	return (
		<button
			type="button"
			data-testid="question-dock-bar"
			onClick={onExpand}
			className="dock-variant flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
		>
			<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label ??
							toolLabel ??
							(toolName === "quiz" ? "Check" : toolName === "explain" ? "Explain" : "Question")}
			</span>
			<span className="min-w-0 flex-1 text-muted-foreground">
				<QuestionPreview>{question}</QuestionPreview>
			</span>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium">
				Answer <ArrowDownIcon className="size-3.5" />
			</span>
		</button>
	);
}

/** La pregunta desplegada: etiqueta, pregunta, opciones y la fila inferior unificada. */
function QuestionDockForm({
	viewReader,
	toolName,
	toolCallId,
	input,
	phase = "probe",
	active,
	onSubmit,
	onPrepareSubmission,
	hasPendingInput,
	preparing,
	initialDraft,
	onSaveDraft,
	onEscape,
	dictationClaim = true,
	compactionRunning = false,
	workingRef,
}: Omit<QuestionDockProps, "expanded" | "onExpand" | "reveal">) {
	const kind = toolQuestionKind(toolName);
	const controller = useOptionalInteractionLayers();
	const rootRef = useRef<HTMLDivElement>(null);

	// QuestionData canónico, construido una vez por pregunta. Las opciones del quiz
	// se barajan de forma determinista (con semilla en toolCallId) para que la
	// posición nunca delate cuál es correcta Y el servidor y el cliente rendericen el mismo orden (seguro para la
	// hidratación); el orden mostrado se guarda como instantánea en el registro de la respuesta al enviar.
	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizToolInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainToolInput) : null;
		const multi = input instanceof Object && "multiSelect" in input ? input.multiSelect === true : false;
		const mode: QuestionMode =
			kind === "quiz"
				? multi
					? "multi-select"
					: "single-select"
				: askInput?.options?.length
					? multi
						? "multi-select"
						: "single-select"
						: "text";
		const options = normalizeOptions(
			(quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[],
		);
		const ordered = kind === "quiz" && options.length > 0 ? shuffleOptions(options, seededRandom(toolCallId)) : options;
		const q: QuestionData = {
			id: toolCallId,
			kind,
			// El rol (responsable 2026-10-03): las preguntas predict condicionan por él
			// la vista (nunca plegadas) y la tarjeta respondida recoge la explicación.
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
			createdAt: new Date().toISOString(),
		};
		if (quizInput) {
			const resolved = resolveCorrect(quizInput.correctAnswer, ordered);
			if (resolved.error) console.error("[quiz] correctAnswer did not resolve:", resolved.error);
			q.correctIndices = resolved.indices;
			q.explanation = quizInput.explanation;
		}
		if (explainInput) {
			// El compromiso viaja en los datos de la pregunta (nunca se envía al
			// cliente antes de responder) y se guarda como instantánea en la respuesta al enviar.
			// Un solo campo, razonamiento incluido — sin explicación aparte
			// (decisión del responsable 2026-09-27).
			q.committedAnswer = explainInput.correctAnswer;
		}
		return q;
	}, [toolCallId, kind, input]);

	// La máquina de estados de la selección vive en question-core (pura, probada):
	// la selección única desplaza, la múltiple convive — elegir la fila "Other…"
	// de un ask en una selección múltiple nunca debe borrar las opciones ya
	// elegidas, y elegir una opción nunca debe borrar una respuesta propia tecleada.
	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	// El canal de transferencia del alumno — thinking, nunca "una nota".
	const [thinking, setThinking] = useState(initialDraft?.thinking ?? "");
	const [other, setOther] = useState(initialDraft?.other ?? "");
	const [text, setText] = useState(initialDraft?.text ?? "");
	// Refleja el razonamiento para el hilo lateral (los empujones responden a él).
	useEffect(() => {
		if (workingRef) workingRef.current = (qd.mode === "text" ? text : thinking).trim();
	}, [workingRef, qd.mode, text, thinking]);
	useEffect(() => () => { if (workingRef) workingRef.current = ""; }, [workingRef]);
	/* Las refs REFLEJAN los dos campos destino del dictado (ronda "no se pierde
	 * nada", responsable 2026-10-01): el volcado de la ejecución llega mediante
	 * setState, que un cierre que espera a `await finishDictation()` no puede
	 * observar a tiempo — el envío lee estas, mantenidas al día en cada punto de escritura. */
	const thinkingTextRef = useRef(initialDraft?.thinking ?? "");
	const answerTextRef = useRef(initialDraft?.text ?? "");
	// Confianza (responsable, 2026-10-01): un índice en CONFIDENCE_STOPS,
	// en reposo en 50 — un auténtico cara o cruz por definición, se toque o no
	// (el mismo número, el mismo significado). El dock se desmonta entre
	// preguntas, así que cada pregunta empieza de nuevo en 50.
	const [confIdx, setConfIdx] = useState<number>(initialDraft?.confidenceIndex ?? DEFAULT_CONFIDENCE_INDEX);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	// La entrada PRINCIPAL del dictado (responsable, ronda 1 de STT): mientras
	// espera una pregunta, los finales dictados caen AQUÍ, nunca en el composer
	// oculto — el modo texto es dueño de "Your answer", los modos de selección
	// de "Your thinking". La reclamación tiene ámbito de efecto, así que al
	// desmontarse la pregunta se libera y el dictado vuelve solo al composer.
	useDictationTarget(
		useCallback(
			(t: string) => {
				// Primero la ref (ver el bloque de refs de arriba): la unión se calcula a
				// partir del espejo, y luego ambos espejos coinciden con el estado — un envío
				// que se reanuda tras terminar lee la cola, nunca un cierre obsoleto.
				if (qd.mode === "text") {
					const v = joinDictation(answerTextRef.current, t);
					answerTextRef.current = v;
					setText(v);
				} else {
					const v = joinDictation(thinkingTextRef.current, t);
					thinkingTextRef.current = v;
					setThinking(v);
				}
			},
			[qd.mode],
		),
		// Se libera mientras una comprobación de enseñanza sigue sin revelar (responsable 2026-10-03):
		// el campo de reading-thinking es dueño del habla dictada durante la lectura.
		dictationClaim,
	);

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));

	const nativeCanSubmit =
		qd.mode === "text"
			? text.trim().length > 0
			: sel.dontKnow || (sel.otherSelected && other.trim().length > 0) || sel.selected.size > 0;

	const canSubmit = nativeCanSubmit || hasPendingInput?.(qd) === true;
	const currentQuestion = useRef(qd); currentQuestion.current = qd;
	const mounted = useRef(true);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const formValues = useRef({ sel, other, confIdx }); formValues.current = { sel, other, confIdx };
	useLayoutEffect(() => {
		if (!viewReader) return;
		const read = (): NativeQuestionViewState => {
			const { sel, other, confIdx } = formValues.current;
			return { question: qd, draft: { dontKnow: sel.dontKnow,
				values: [...sel.selected].flatMap(index => qd.options[index] ? [qd.options[index]!.value] : []),
				otherSelected: sel.otherSelected, other, text: answerTextRef.current, thinking: thinkingTextRef.current,
				...(kind === "quiz" ? { confidence: CONFIDENCE_STOPS[confIdx] } : {}) } };
		};
		viewReader.current = read;
		return () => { if (viewReader.current === read) viewReader.current = null; };
	}, [viewReader, qd, kind]);
	const viewPresentationKey = JSON.stringify({ ...toClientQuestion(qd), questionType: qd.questionType });
	useLayoutEffect(() => { viewReader?.changed?.(); }, [viewReader, sel, other, text, thinking, confIdx, viewPresentationKey]);
	const submit = () => {
		if (!canSubmit || compactionRunning || preparing) return;
		if (onPrepareSubmission) {
			onPrepareSubmission({ question: qd, isCurrent: () => mounted.current && currentQuestion.current === qd && isInteractionScopeEligible(rootRef.current, controller), capture: captureRequest });
			return;
		}
		/* TERMINA EL DICTADO PRIMERO (responsable, 2026-10-01): Enter puede llegar
		 * con una ejecución en vivo y el razonamiento aún en manos de Deepgram.
		 * Detén la ejecución, deja que los últimos finales caigan en el campo
		 * destino y solo entonces construye la respuesta — el razonamiento hablado
		 * nunca se pierde por una parada olvidada. Los valores de los campos de
		 * abajo salen de los espejos en REF porque el volcado llega mediante
		 * setState tras un await. */
		if (!isDictationActive()) {
			doSubmit();
			return;
		}
		void finishDictation().then(doSubmit);
	};
	const captureRequest = (): AnswerRequest => {
		const { sel, other, confIdx } = formValues.current;
		const req: AnswerRequest = {
			dontKnow: sel.dontKnow,
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: sel.otherSelected ? other : undefined,
			text: qd.mode === "text" ? answerTextRef.current : undefined,
			thinking: qd.mode !== "text" ? thinkingTextRef.current.trim() || undefined : undefined,
			// Siempre se envía en las respuestas de quiz (responsable: 50 debe significar 50, nunca
			// "sin tocar"); buildAnswer lo descarta con "I don't know".
			confidence: kind === "quiz" ? CONFIDENCE_STOPS[confIdx] : undefined,
		};
		// Instantánea antes de que el envío optimista desmonte el formulario. Los valores de las refs
		// incluyen los finales del dictado que acaban de llegar, a diferencia de los cierres obsoletos.
		onSaveDraft?.({
			selection: { ...sel, selected: new Set(sel.selected) },
			thinking: thinkingTextRef.current,
			other,
			text: answerTextRef.current,
			confidenceIndex: confIdx,
		});
		return req;
	};
	const doSubmit = () => {
		if (!canSubmit) return;
		onSubmit(buildAnswer(qd, captureRequest(), toolName));
	};

	/* ENTER ENVÍA DESDE CUALQUIER SITIO (ronda 6 del responsable, 2026-10-05):
	 * la misma ley que en el dock de práctica — las respuestas dictadas rara vez
	 * enfocan el campo. Pasa por submit() para que la ley del volcado del
	 * dictado se comparta, no se bifurque. */
	useEnterSubmits(submit, rootRef);

	// Seleccionar Other nunca borra el campo de thinking — dos canales, la
	// respuesta y el razonamiento que la respalda, uno al lado del otro.
	const selectOther = () => setSel(toggleOther(selectMode, sel));

	/* ── La máquina del teclado (oleada de atajos B, rondas del responsable 2026-09-17) ──
	↑/↓ recorren TODAS las filas respondibles en orden — primero las
	opciones, luego el "I don't know" del quiz o el "Other…" del ask (la que
	exista) — ACOTADAS en los extremos, sin vuelta (responsable: se navega más
	rápido cuando el recorrido se para en la última fila). Espacio actúa sobre
	la fila recorrida exactamente como un clic (la múltiple alterna, la única
	desplaza; Other además enfoca su input para escribir), Enter envía en
	cuanto hay respuesta. Tab alterna el FOCO entre el campo de thinking y las
	filas de respuesta (ronda 3 del responsable) — nada más; Shift+Tab NO es
	nuestro (es del ciclo global del nivel de thinking). Dos guardas mantienen
	intacto el comportamiento nativo: las teclas desde una SUPERFICIE DE
	ESCRITURA conservan su significado (las flechas mueven el cursor, espacio
	escribe), y las combinaciones con modificadores nunca son nuestras
	(Alt+flechas recorre las sesiones — no deben recorrer TAMBIÉN las filas).
	El listener está a nivel de documento y solo vive mientras el dock está
	desplegado — plegado, el Enter nativo de la barra lo despliega. */
	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const otherInputRef = useRef<HTMLDivElement>(null);
	const thinkingRef = useRef<HTMLDivElement>(null);
	// Una fila más allá de las opciones es la fila final: quiz → no sé,
	// ask → Other (una pregunta nunca tiene ambas). El modo texto (ask/explain)
	// no tiene filas — el composer ES la superficie de respuesta.
	const optionCount = qd.mode === "text" ? 0 : qd.options.length;
	const rowCount = qd.mode === "text" ? 0 : optionCount + 1;

	const kbdAct = (idx: number) => {
		if (idx < optionCount) toggle(idx);
		else if (kind === "quiz")
			setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }));
		else {
			// Espacio en la fila Other del ask (ronda de refinamiento del responsable,
			// 2026-09-24): SELECCIONARLA enfoca el input para escribir, pero el
			// Espacio que DESELECCIONA un Other ya seleccionado nunca debe devolver al
			// usuario al campo de escritura — el toggleOther del núcleo no tiene ruta
			// de desactivación en selección única (desplaza), así que esa ruta vive
			// aquí: borra la elección, conserva el texto tecleado y el foco se queda
			// donde está. Volver a seleccionarla es el camino de vuelta al
			// campo.
			if (sel.otherSelected) setSel((prev) => ({ ...prev, otherSelected: false, dontKnow: false }));
			else {
				otherInputRef.current?.focus();
				selectOther();
			}
		}
	};

	// Enfoca el elemento enfocable de la fila recorrida — la fila Other es un div,
	// así que ahí el destino del foco es su input en línea.
	const focusRow = (idx: number) => {
		const row = rootRef.current?.querySelector(`[data-kbdrow="${idx}"]`) as HTMLElement | null;
		if (!row) return;
		const el = (row.querySelector("input, [data-file-path-input]") as HTMLElement | null) ?? row;
		el.focus();
	};

	useEffect(() => {
		if (!active || rowCount === 0) return;
		const onKeyDown = (e: KeyboardEvent) => {
			// Tab ya llega con preventDefault por la captura del proveedor; no lo
			// tomes como una reclamación. Las filas son de quien es elegible, no de quien solo tiene el foco.
			if (!isInteractionScopeEligible(rootRef.current, controller)) return;
			const t = e.target as HTMLElement | null;
			// Un campo de ESCRITURA es donde las teclas significan texto (ronda 4 del responsable):
			// los campos de thinking/respuesta, cajas de búsqueda, renombrados — nunca un
			// input range, cuyo foco tras un clic o arrastre no debe anular el recorrido
			// con flechas. En todos los demás sitios actúan las flechas.
			const typing =
				!!t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
					t.tagName === "TEXTAREA" ||
					t.isContentEditable);
			// Las combinaciones con Alt/Cmd/Ctrl nunca son nuestras (Alt+flechas recorre las sesiones
			// a nivel global — no deben recorrer TAMBIÉN las filas de la pregunta).
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			// Tab a secas alterna el foco: filas → thinking. El deslizador de
			// confianza NO recibe foco en absoluto (responsable, ronda de interfaz 2026-10-01) —
			// las ←/→ globales son dueñas de su teclado, así que nunca entra en la cadena.
			// Shift+Tab se deja pasar (es del ciclo global del nivel de thinking),
			// así que la comprobación de shift importa.
			if (e.key === "Tab" && !e.shiftKey && !modded) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest?.("[data-kbdrow]")) thinkingRef.current?.focus();
				else {
					const idx = kbdIdx ?? 0;
					setKbdIdx(idx);
					focusRow(idx);
				}
				return;
			}
			// Las teclas desde una superficie de escritura conservan su significado (las flechas mueven
			// el cursor, espacio escribe).
			if (typing || modded) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((kbdIdx ?? -1) + 1, rowCount - 1);
				setKbdIdx(next);
				// El foco sigue el recorrido mientras el usuario está EN las filas (Tab
				// lo llevó ahí) para que enfocado y recorrido nunca diverjan.
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((kbdIdx ?? rowCount) - 1, 0);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				// Ciclo global de la confianza (responsable, ronda de interfaz 2026-10-01):
				// El MISMO patrón que ↑/↓ sobre las filas — funciona esté donde esté el
				// foco, sin hacer clic, sin anillo de foco. Inactivo con "I don't know"
				// (el deslizador se agrisa y no se envía nada).
				if (kind !== "quiz" || sel.dontKnow) return;
				e.preventDefault();
				setConfIdx((i) =>
					Math.min(
						CONFIDENCE_STOPS.length - 1,
						Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)),
					),
				);
			} else if (e.key === " ") {
				if (kbdIdx === null) return; // Espacio a secas sigue desplazando la página
				e.preventDefault();
				kbdAct(kbdIdx);
			} else if (e.key === "Enter") {
				if (kbdIdx === null || !canSubmit) return;
				e.preventDefault();
				submit();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Mantén visible la fila recorrida (el área de la pregunta tiene scroll interno).
	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current
			?.querySelector(`[data-kbdrow="${kbdIdx}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	return (
		<div ref={rootRef} data-testid="question-dock">
			{/* Área de la pregunta — scroll interno si es muy alta; la fila inferior no se mueve.
			Limitada por la columna medida (--dock-max-h; el antiguo 55dvh fijo cortaba
			las preguntas largas — ronda del responsable, 2026-10-05). */}
			<div data-dock-scroll-area="" data-session-find-root="" className="max-h-[var(--dock-max-h,55dvh)] overflow-y-auto px-4 pt-3">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{toolName === "probe"
						? "Probe"
						: toolName === "recall"
							? "Recall"
							: kind === "quiz"
								? qd.questionType === "predict"
									? "Prediction"
									: "Check"
									: kind === "explain"
										? "Explain"
											: "Question"}
					{qd.mode === "multi-select" && " · select all that apply"}
				</div>
				<div className="mb-3 font-medium">
					<ToolContentResponse>{qd.question}</ToolContentResponse>
				</div>
				{qd.context && (
					<div className="mb-3 text-sm text-muted-foreground">
						<ToolContentResponse>{qd.context}</ToolContentResponse>
					</div>
				)}

				{qd.mode !== "text" && (
					<div className="flex flex-col gap-2 pb-2" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
						{qd.options.map((opt, i) => {
							const isSel = sel.selected.has(i);
							return (
								<button
									key={opt.value}
									type="button"
									role={qd.mode === "multi-select" ? "checkbox" : "radio"}
									aria-checked={isSel}
									data-kbdrow={i}
									onClick={() => toggle(i)}
									className={cn(
										"flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors",
										isSel ? "border-primary bg-accent" : "hover:bg-accent/50",
										i === kbdIdx && !isSel && "ring-1 ring-border bg-accent/40",
									)}
								>
									<span
										className={cn(
											"mt-0.5 flex size-4 shrink-0 items-center justify-center border",
											qd.mode === "multi-select" ? "rounded-sm" : "rounded-full",
											isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
										)}
									>
										{isSel && (
											<span className={cn(qd.mode === "multi-select" ? "text-base leading-none" : "size-1.5 rounded-full bg-current")}>
												{qd.mode === "multi-select" ? "✓" : ""}
											</span>
										)}
									</span>
									<span>
										<ToolContentResponse>{opt.label}</ToolContentResponse>
										{kind !== "quiz" && opt.description && (
											// El subtexto de las opciones se renderiza en Source Sans 3 (maqueta del responsable);
											// el texto "I don't know" se queda en JetBrains Mono. Las opciones de QUIZ NO
											// renderizan descripción (decisión del responsable 2026-09-26): el modelo las usaba para
											// insinuar cuál era correcta — el esquema eliminó el campo y los registros antiguos
											// tampoco deben filtrarla. La misma ruta MessageResponse que la
											// etiqueta (responsable, 2026-10-12): las descripciones son Markdown completo —
											// LaTeX incluido —, no texto plano.
											<ToolContentResponse className="lh-prose block text-xs text-muted-foreground">
												{opt.description}
											</ToolContentResponse>
										)}
									</span>
								</button>
							);
						})}

						{kind === "quiz" && (
							<button
								type="button"
								onClick={() =>
									setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }))
								}
								data-kbdrow={optionCount}
								aria-pressed={sel.dontKnow}
								className={cn(
									// Layout de fila de opción + círculo de radio (responsable); el contorno
									// discontinuo se queda — esta es la no-respuesta deliberada.
									"flex items-start gap-3 rounded-lg border border-dashed px-3 py-2 text-left text-sm outline-none transition-colors",
									sel.dontKnow ? "border-primary text-foreground" : "text-muted-foreground",
									kbdIdx === optionCount && !sel.dontKnow && "ring-1 ring-border bg-accent/40",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
										sel.dontKnow
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/40",
									)}
								>
									{sel.dontKnow && <span className="size-1.5 rounded-full bg-current" />}
								</span>
								<span>I don't know</span>
							</button>
						)}

						{kind === "ask" && (
							<div
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								data-kbdrow={optionCount}
								onClick={selectOther}
								className={cn(
									"flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors",
									sel.otherSelected ? "border-primary bg-accent" : "border-dashed hover:bg-accent/50",
									kbdIdx === optionCount && !sel.otherSelected && "ring-1 ring-border bg-accent/40",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center border",
										qd.mode === "multi-select" ? "rounded-sm" : "rounded-full",
										sel.otherSelected
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/40",
									)}
								>
									{sel.otherSelected && (
										<span className={cn(qd.mode === "multi-select" ? "text-base leading-none" : "size-1.5 rounded-full bg-current")}>
											{qd.mode === "multi-select" ? "✓" : ""}
										</span>
									)}
								</span>
								<PathInput
									ref={otherInputRef}
									singleLine
									value={other}
									onValueChange={(value) => {
										setOther(value);
										// Escribir selecciona la fila — desplazando en
										// selección única, junto a las hermanas en la múltiple.
										setSel((prev) => (prev.otherSelected ? prev : toggleOther(selectMode, prev)));
									}}
									onKeyDown={(e) => {
										if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
										// Esc sale de la escritura (ronda de refinamiento del responsable,
										// 2026-09-24): el foco deja el input, la fila SIGUE
										// seleccionada — deseleccionar es tarea del siguiente Espacio, que actúa
										// sobre la fila — y el recorrido con flechas se reanuda desde esta
										// fila (kbdIdx la fija). stopPropagation impide que la cadena de la
										// ventana lea este Esc como abortar el turno.
										if (e.key === "Escape") {
											controller?.claimEscape(e);
											e.preventDefault();
											e.stopPropagation();
											e.currentTarget.blur();
											setKbdIdx(optionCount);
										}
											// Enter envía directamente (responsable, ronda de teclado 2026-10-06):
											// la respuesta propia es un input de una sola línea — no hay salto de línea
											// que proteger, y escribir ya ha seleccionado la fila, así que
											// la carga está lista. Todo Enter (con shift o sin él — en un campo de una
											// línea no podría pasar nada más) pasa por la misma
											// frontera de envío que el botón, incluido el dictado que primero
											// termina.
											if (e.key === "Enter") {
												e.preventDefault();
												submit();
											}
									}}
									placeholder="Type your own answer…"
									className="lh-input w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Confianza (responsable, 2026-10-01; rondas de interfaz del mismo día): un
				deslizador con paradas bajo las opciones y encima de "Your thinking" — la
				probabilidad declarada por el alumno de que la respuesta seleccionada sea
				correcta. La POSICIÓN del tirador es la fracción en bruto; el RAÍL pintado
				cubre exactamente el intervalo de los centros del tirador (con medio disco
				de margen por lado), así que 0 y 100 quedan a ras de los extremos del raíl.
				El relleno y el tirador llevan el color de la rampa de la parada; las
				marcas SÓLIDAS de las paradas son capas de fondo tras el relleno (solo en
				el lado vacío, nunca sobre el color; 0/100 no necesitan marca — los
				extremos a ras ya lo dicen). Teclado: ←/→ GLOBALES (el patrón de ↑/↓; el
				anillo ha desaparecido de toda la app). Hacer clic y arrastrar son nativos.
				"I don't know" lo AGRISA — el layout se mantiene, no se envía ningún valor,
				la señal de no sé queda sola. */}
			{kind === "quiz" && (
				<div className="border-t border-border/60 px-4 py-2.5">
					<div className="flex items-center gap-3">
						<span
							className={cn(
								"shrink-0 text-xs font-medium uppercase tracking-wide",
								sel.dontKnow ? "text-muted-foreground/50" : "text-muted-foreground",
							)}
						>
							Confidence
						</span>
						<div
							className={cn("relative h-4 min-w-0 flex-1", sel.dontKnow && "opacity-40")}
							data-testid="confidence-track"
						>
							{/* El RAÍL se pinta aquí, no en el input: este overlay abarca
								exactamente el intervalo de los CENTROS del tirador (margen de 8px = la mitad
								del disco de 16px, a izquierda y derecha), así que en 0 y 100 el disco queda
								a ras de los extremos del raíl — sin un muñón desnudo asomando (ronda 4 del
								responsable). LEY DE APILAMIENTO (ronda 5 del responsable): el input también
								es absoluto — un overlay posicionado se pinta por encima de un input en el
								flujo sea cual sea el orden del DOM, lo que ponía el raíl ENCIMA del disco.
								Ambos posicionados, input después en el DOM → el disco va encima. La altura
								del envoltorio está fijada (h-4) para que el top-1/2 del raíl y la pista del
								disco compartan una caja — centrados por construcción, no por suerte. */}
							<div
								aria-hidden
								data-testid="confidence-rail"
								className="pointer-events-none absolute top-1/2 left-2 right-2 h-1.5 -translate-y-1/2 rounded-full border border-border"
								style={confidenceRailStyle(CONFIDENCE_STOPS[confIdx]!)}
							/>
							<input
								type="range"
								min={0}
								max={100}
								step={1}
								value={CONFIDENCE_STOPS[confIdx]}
								disabled={sel.dontKnow}
								aria-label="Confidence — the probability your selected answer is correct"
								aria-valuetext={`${CONFIDENCE_STOPS[confIdx]} percent`}
								title="The probability your selected answer is correct — 50% is a coin flip. Adjust with ←/→."
								data-testid="confidence-slider"
								onChange={(e) => {
									// Ajusta a la parada más cercana; el VALOR renderizado es el porcentaje de la
									// propia parada, así que el tirador siempre reposa en su fracción real (50 =
									// la mitad). El teclado no necesita manejador aquí: la máquina del dock trata
									// un range enfocado como no escritura (ver la guarda de arriba) y su rama ←/→
									// hace preventDefault, lo que también cancela el paso nativo del 1%.
									const v = Number(e.target.value);
									let best = 0;
									for (let i = 1; i < CONFIDENCE_STOPS.length; i++) {
										if (Math.abs(CONFIDENCE_STOPS[i]! - v) < Math.abs(CONFIDENCE_STOPS[best]! - v)) best = i;
									}
									setConfIdx(best);
								}}
								style={{ color: CONFIDENCE_COLORS[confIdx] }}
								className={cn(
									"absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent outline-none",
									"[&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent",
									"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current",
									"[&::-moz-range-track]:h-4 [&::-moz-range-track]:bg-transparent",
									"[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current",
								)}
							/>
						</div>
						<span
							data-testid="confidence-value"
							className={cn(
								"w-9 shrink-0 text-right font-mono text-sm tabular-nums",
								sel.dontKnow && "text-muted-foreground/50",
							)}
						>
							{sel.dontKnow ? "—" : `${CONFIDENCE_STOPS[confIdx]}%`}
						</span>
					</div>
				</div>
			)}

			{/* La mitad del alumno en el dock — un GEMELO del composer: un campo con
			etiqueta y borde con Submit acoplado dentro, exactamente como el envío del
			composer del chat. Los modos de selección reciben "Your thinking" (Enter
			hace un salto de línea — sirve para volcar, pronto dictado; envía el
			botón); el modo texto mantiene "Your answer" con Enter para enviar. */}
			<form
				className="border-t border-border/60 p-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div
					data-testid={qd.mode === "text" ? "answer-field" : "thinking-field"}
					className="rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50"
				>
					<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{qd.mode === "text" ? "Your answer" : "YOUR THINKING"}
					</div>
					{qd.mode === "text" ? (
						<PathInput
							value={text}
							onValueChange={(value) => {
								answerTextRef.current = value;
								setText(value);
							}}
							onKeyDown={(e) => {
								if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
								// Esc termina el dictado (las decisiones del dictado: volver a hacer clic
								// o Esc) — stopPropagation lo reclama (oleada de teclado
								// A) para que la cadena de la ventana no aborte además un turno.
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									controller?.claimEscape(e);
									onEscape();
									return;
								}
								// Convención del chat: Enter envía, Shift+Enter es un salto de línea;
								// ⌘/Ctrl+Enter también envía (universal en toda la app).
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
									e.preventDefault();
									submit();
								}
							}}
							placeholder="Type your answer…"
							className="field-sizing-content lh-input max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
						/>
					) : (
						<PathInput
							ref={thinkingRef}
							value={thinking}
							onValueChange={(value) => {
								thinkingTextRef.current = value;
								setThinking(value);
							}}
							onKeyDown={(e) => {
								if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
								// Esc termina el dictado (las decisiones del dictado: volver a hacer clic
								// o Esc) — stopPropagation lo reclama (oleada de teclado
								// A) para que la cadena de la ventana no aborte además un turno.
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									controller?.claimEscape(e);
									onEscape();
									return;
								}
								// EL ACORDE ESTÁNDAR (ronda 5 del responsable, 2026-10-05): Enter
								// envía, Shift+Enter es un salto de línea, ⌘/Ctrl+Enter funciona
								// también — idéntico al dock de práctica y al composer.
								if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									submit();
								}
							}}
							placeholder="Why this answer? Whatever comes to mind."
							className={cn(
								"field-sizing-content lh-input max-h-48 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground/70",
								// Protagonismo escalado por fase: la enseñanza invita a profundizar,
								// el sondeo se mantiene rápido.
								phase === "teach" ? "min-h-[4.5rem]" : "min-h-10",
							)}
						/>
					)}
					<div className="flex items-center justify-between gap-2 p-1">
						<span aria-hidden className="pl-1.5 text-xs text-muted-foreground">
								{compactionRunning ? "compacting session…" : "↵ submits · ⇧↵ newline"}
						</span>
						<Button
							type="submit"
							disabled={!canSubmit || compactionRunning || preparing}
							className="ml-auto h-9 rounded-[6px] px-3.5 text-sm font-medium"
						>
							Submit answer
						</Button>
					</div>
				</div>
			</form>
		</div>
	);
}
