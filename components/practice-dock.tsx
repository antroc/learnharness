"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ViewReaderRef } from "./session-view-readers";
import { ChevronRightIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { PathInput } from "@/components/path-input";
import type { PrepareThinkingSubmission } from "./plugin-submission-adapters";
import { cn } from "@/lib/utils";

/**
 * El dock de práctica (sesiones de práctica, diseño del responsable
 * 2026-10-04): un problema ACTIVO sustituye al composer del chat — la burbuja
 * persistente de abajo se transforma en el problema. El enunciado del agente
 * arriba; la mitad del alumno abajo — "Your thinking", un campo etiquetado
 * con UN botón de envío (ronda 2 del responsable, 2026-10-05): Enter envía,
 * Shift+Enter hace un salto de línea. No hay carriles — si un envío pretende
 * ser una respuesta se ve en el propio thinking; el agente lo lee. Un
 * problema puede llevar muchos envíos; cada uno empieza un turno.
 *
 * El plegado (scroll hacia arriba → barra fina) es cosa del DockOverlay;
 * este componente es solo contenido, y el formulario desplegado sigue
 * MONTADO mientras está plegado (oculto) para que una traza a medio escribir
 * sobreviva al scroll.
 *
 * El compromiso (modelSolution, decisionPoints, …) viaja en los argumentos
 * de la llamada a la herramienta y NO se renderiza aquí — solo el enunciado
 * es del alumno. Esc descarta el problema (la cadena de Esc por capas; el
 * diálogo de confirmación y luego la ruta silenciosa) — lo reclama la
 * página, no este componente.
 */

export interface PracticeDockProps {
	viewReader?: ViewReaderRef<string>;
	/** El id de la llamada a la herramienta del problema activo (los envíos lo tienen como destino). */
	problemCallId: string;
	/** Los argumentos del planteamiento — solo el enunciado es del alumno (la
	 *  insignia de modo tendería a anunciar el objetivo; descartada). */
	input: { statement: string };
	/** Estado de plegado, propiedad del DockOverlay. */
	expanded: boolean;
	onExpand: () => void;
	/** texto — POST {type:"thinking"} (un solo carril; el registro se deduce del texto). */
	onSubmit: (text: string) => void;
	onPrepareSubmission?: PrepareThinkingSubmission;
	/** Editor alternativo propiedad del host. El enunciado/thinking/controles nativos siguen compartidos. */
	customInput?: {
		editor: ReactNode;
		thinking: string;
		onThinkingChange(value: string): void;
		ready: boolean;
		prepare: PrepareThinkingSubmission;
	};
	hasPendingInput?: boolean;
	preparing?: boolean;
	/** Escape en el campo de thinking detiene el dictado (pasado desde la página). */
	onEscape?: () => void;
	/** Hay una compactación en marcha para este chat (ronda 14 del
	 *  responsable): el POST del thinking se bloquearía en la barrera de
	 *  compactación del servidor — desactiva el envío y dilo en la fila de
	 *  pista. El registro del servidor es la barrera real; esto es la indicación. */
	compactionRunning?: boolean;
}

export function PracticeDock({ viewReader, problemCallId, input, expanded, onExpand, onSubmit, onPrepareSubmission, customInput, hasPendingInput = false, preparing = false, onEscape, compactionRunning = false }: PracticeDockProps) {
	const controller = useOptionalInteractionLayers();
	const rootRef = useRef<HTMLElement>(null);
	const [nativeThinking, setNativeThinking] = useState("");
	const custom = useRef(customInput); custom.current = customInput;
	const thinking = customInput ? customInput.thinking : nativeThinking;
	const setThinking = (value: string) => { if (custom.current) custom.current.onThinkingChange(value); else setNativeThinking(value); };
	// La ref REFLEJA el campo ("no se pierde nada", la disciplina del dock de
	// preguntas): un envío que se reanuda tras `await finishDictation()` lee
	// la cola, nunca un cierre obsoleto.
	const thinkingRef = useRef(thinking); thinkingRef.current = thinking;
	const editRevision = useRef(0);
	useLayoutEffect(() => {
		if (!viewReader) return;
		const read = () => thinkingRef.current;
		viewReader.current = read;
		return () => { if (viewReader.current === read) viewReader.current = null; };
	}, [viewReader]);

	useDictationTarget(
		useCallback(
			(t: string) => {
				const v = joinDictation(thinkingRef.current, t);
				thinkingRef.current = v; editRevision.current++;
				setThinking(v);
			},
			[],
		),
		true,
	);

	useLayoutEffect(() => { viewReader?.changed?.(); }, [viewReader, thinking]);
	const submit = () => {
		if (compactionRunning || preparing) return;
		const prepare = customInput?.prepare ?? onPrepareSubmission;
		if (prepare) {
			if (customInput ? !customInput.ready : (!thinkingRef.current.trim() && !hasPendingInput)) return;
			let capturedRevision = editRevision.current;
			prepare(() => { capturedRevision = editRevision.current; return customInput ? thinkingRef.current : thinkingRef.current.trim(); }, captured => {
				if (editRevision.current === capturedRevision && (customInput ? thinkingRef.current : thinkingRef.current.trim()) === captured) { thinkingRef.current = ""; setThinking(""); }
			});
			return;
		}
		const text = thinkingRef.current.trim();
		if (text.length === 0) return;
		thinkingRef.current = "";
		setThinking("");
		onSubmit(text);
	};

	/* ENTER ENVÍA DESDE CUALQUIER SITIO (ronda 6 del responsable, 2026-10-05): con
	 * el dictado el campo a menudo nunca recibe el foco — el Enter a nivel de
	 * ventana (excluidas las superficies de escritura y los botones) envía la
	 * traza. Montado mientras lo esté el dock — incluida la barra plegada (la
	 * traza sobrevive). */
	useEnterSubmits(submit, rootRef);

	/* ── la barra plegada ── */
	const bar = (
			<button
				ref={element => { if (!customInput) rootRef.current = element; }}
				type="button"
				data-testid="practice-dock-bar"
				onClick={onExpand}
				className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon className="size-4 shrink-0 rotate-90" />
				<span className="font-medium">Problem</span>
				<span className="min-w-0 flex-1 truncate">{input.statement}</span>
			</button>
		);
	if (!expanded && !customInput) return bar;

	/* ── el formulario desplegado ── */
	return (
		<div ref={element => { rootRef.current = element; }} data-testid="practice-dock" data-problem={problemCallId}>
			{!expanded && bar}
			<div hidden={!expanded}>
			{/* La mitad del agente: el antetítulo 'Problem' (como la fila de etiqueta
			de las tarjetas del quiz — ronda del responsable, 2026-10-05) + el
			enunciado, con Markdown + LaTeX renderizados, limitado por la columna
			medida (--dock-max-h; el antiguo 40vh fijo cortaba los problemas largos). */}
			<div data-dock-scroll-area="" className="max-h-[var(--dock-max-h,40vh)] overflow-y-auto px-4 pt-3 pb-2">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
				<div className="lh-prose text-[15px]">
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
			</div>

			{customInput?.editor}

			{/* La mitad del alumno: Enter ENVÍA (ronda 2 del responsable, 2026-10-05);
			Shift+Enter hace un salto de línea — menos cosas que decidir. */}
			<div
				data-testid="practice-thinking-field"
				className="m-1.5 rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50"
			>
				<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					YOUR THINKING
				</div>
				<PathInput
					value={thinking}
					onValueChange={(value) => {
						thinkingRef.current = value; editRevision.current++;
						setThinking(value);
					}}
					onKeyDown={(e) => {
						if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
						// Esc termina el dictado — stopPropagation lo reclama (la
						// máquina del teclado) para que la cadena de la ventana no se dispare también.
						if (e.key === "Escape" && onEscape) {
							controller?.claimEscape(e);
							e.preventDefault();
							e.stopPropagation();
							onEscape();
							return;
						}
						// Enter ENVÍA — el único carril (ronda 2 del responsable, 2026-10-05);
						// Shift+Enter es el salto de línea, ⌘/Ctrl+Enter también es el acorde.
						if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							submit();
						}
					}}
					placeholder="Work here, think out loud."
					className={cn(
						"field-sizing-content lh-input max-h-64 min-h-16 w-full resize-none bg-transparent px-2.5 pb-2 outline-none placeholder:text-muted-foreground",
					)}
				/>
				{/* La fila de envío (ronda 4 del responsable, 2026-10-05): IDÉNTICA a la
				del dock de preguntas — pista a la izquierda, el MISMO Button (h-9, px-3.5),
				una fila p-1. Radios de esquina concéntricos: armazón 16 − m-1.5 (6) =
				campo 10 − p-1 (4) = botón 6. */}
				<div className="flex items-center justify-between gap-2 p-1">
					<span aria-hidden className="pl-1.5 text-xs text-muted-foreground">
						{compactionRunning ? "compacting session…" : "↵ submits · ⇧↵ newline"}
					</span>
					<Button
						type="button"
						data-testid="practice-send"
						disabled={(customInput ? !customInput.ready : (!thinking.trim() && !hasPendingInput)) || compactionRunning || preparing}
						onClick={() => submit()}
						className="ml-auto h-9 rounded-[6px] px-3.5 text-sm font-medium"
					>
						{customInput ? "Submit" : "Submit thinking"}
					</Button>
				</div>
			</div>
			</div>
		</div>
	);
}
