"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowRightIcon, CornerDownLeftIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PathInput } from "@/components/path-input";
import { AttachFilesButton } from "@/components/attach-files-button";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";

/**
 * El compositor del chat — SOLO la fila de contenido (el envoltorio redondeado
 * persistente vive en el overlay de la vista de chat, para que más adelante el
 * envoltorio pueda transformarse de chat → pregunta sin remontarse).
 *
 * Cálculo del radio de las esquinas (concéntrico con el envoltorio): envoltorio
 * rounded-2xl (16px) − relleno de la fila p-1.5 (6px) = botón rounded-[10px] =
 * 25 % del botón de 40px.
 */
/** Qué hace una pulsación de Enter, por orden de precedencia: detener un stream
 *  ocupado; si no, enviar el mensaje; si no — solo en sesiones de práctica —,
 *  disparar la señal del siguiente problema mientras la pausa entre problemas
 *  está viva (ronda 16 del responsable: Enter con el compositor VACÍO es el
 *  visto bueno; escribir cualquier cosa vuelve a convertir Enter en enviar).
 *  Pura, para que el banco de render estático pueda fijar la decisión (los
 *  eventos de teclado no se pueden simular en renderToStaticMarkup). */
export function enterAction(state: {
	busy: boolean;
	canSend: boolean;
	/** La pausa entre problemas está viva: sesión de práctica, nada activo,
	 *  ningún turno/compactación en curso (el plegado de quien llama). */
	nextProblem?: boolean;
}): "stop" | "send" | "next" | "none" {
	// Reorientación desde el compositor (arco del responsable 2026-10-03): mientras se ejecuta un turno,
	// el texto escrito convierte Enter en una REORIENTACIÓN (el envío que encola y redirige); Enter con
	// el compositor vacío sigue siendo el atajo de detener. El propio botón conserva
	// el cuadrado — Detener sigue a un clic en todo momento.
	if (state.busy) return state.canSend ? "send" : "stop";
	if (state.canSend) return "send";
	if (state.nextProblem) return "next";
	return "none";
}

/**
 * Compositor de la sesión con estado local de pulsaciones. El Chat propietario
 * guarda el borrador actual en una ref para el envío/dictado, así que escribir no
 * vuelve a renderizar la transcripción; revision señala los reinicios explícitos
 * del borrador que provoca el padre.
 */
export function ChatSessionComposer({
	busy,
	value,
	revision,
	onChange,
	onSend,
	onStop,
	sendAllowed,
	dictationActive,
	autoFocus,
	inputRef,
	onEscape,
	placeholder,
	nextProblem,
	onNext,
	pendingInput = false,
}: {
	busy: boolean;
	value: string;
	revision: number;
	onChange: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	sendAllowed: boolean;
	dictationActive: boolean;
	autoFocus?: boolean;
	inputRef?: React.RefObject<HTMLDivElement | null>;
	onEscape?: () => void;
	placeholder?: string;
	nextProblem?: boolean;
	onNext?: () => void;
	pendingInput?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	useLayoutEffect(() => { setDraft(value); }, [revision, value]);
	const canSend = sendAllowed && (draft.trim().length > 0 || dictationActive || pendingInput);
	const applyDraft = useCallback((next: string) => {
		setDraft(next);
		onChange(next);
	}, [onChange]);

	return (
		<Composer
			busy={busy}
			value={draft}
			onChange={applyDraft}
			onSend={onSend}
			onStop={onStop}
			canSend={canSend}
			autoFocus={autoFocus}
			inputRef={inputRef}
			onEscape={onEscape}
			placeholder={placeholder}
			nextProblem={nextProblem}
			onNext={onNext}
		/>
	);
}

export function Composer({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	autoFocus,
	inputRef,
	onEscape,
	placeholder = "Ask, answer, or steer the lesson…",
	nextProblem = false,
	onNext,
	defaultDropTarget = true,
	fileInsertion = true,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	autoFocus?: boolean;
	/** El manejador de la página para el textarea — el foco al terminar el dictado
	 *  (responsable, 2026-10-01): una ejecución que termina pasa el cursor al compositor desnudo. */
	inputRef?: React.RefObject<HTMLDivElement | null>;
	/** Escape mientras se ejecuta un dictado lo detiene (oleada STT, 2026-09-17).
	 *  Operación nula si falta — en otro caso, Esc no significa nada en el compositor. */
	onEscape?: () => void;
	/** El texto provisional del textarea (ronda de ajustes del responsable, 2026-09-24):
	 *  las sesiones activas muestran "Ask, answer, or steer the lesson…"; la página
	 *  nueva de sesión pregunta en su lugar la pregunta de apertura de la vista de grafo. */
	placeholder?: string;
	/** La pausa de la práctica está viva (ronda 16 del responsable): Enter con el
	 *  compositor vacío dispara la señal del siguiente problema en vez de no hacer
	 *  nada — el pasar al siguiente con el teclado primero. */
	nextProblem?: boolean;
	/** El despachador de la señal (send({type:"next"})) — lo comparten el chip y el
	 *  Enter con el compositor vacío. */
	onNext?: () => void;
	/** Los compositores neutros de los plugins se excluyen sin cambiar los valores por defecto del núcleo. */
	defaultDropTarget?: boolean;
	fileInsertion?: boolean;
}) {
	const controller = useOptionalInteractionLayers();
	const act = () => {
		const action = enterAction({ busy, canSend, nextProblem });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};
	const ownInputRef = useRef<HTMLDivElement>(null);
	const editorRef = inputRef ?? ownInputRef;
	return (
		<form
			data-testid="composer"
			className="flex items-end gap-1.5 p-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				act();
			}}
		>
			<PathInput
				ref={editorRef}
				value={value}
				onValueChange={onChange}
				defaultDropTarget={defaultDropTarget}
				fileInsertion={fileInsertion}
				onKeyDown={(e) => {
					if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
					// Esc termina el dictado antes que cualquier otra cosa que Esc pueda llegar a
					// significar aquí (las decisiones del dictado: otro clic o Esc para detener).
					// stopPropagation reclama el Esc (oleada A de teclado): la
					// cadena a nivel de window no debe abortar también un turno por debajo.
					if (e.key === "Escape" && onEscape) {
						controller?.claimEscape(e);
						e.preventDefault();
						e.stopPropagation();
						onEscape();
						return;
					}
					// Convención de chat: Enter envía, Shift+Enter es un salto de línea.
					// ⌘/Ctrl+Enter también envía — el atajo universal de envío
					// en todos los campos de la app (campo de razonamiento, respuestas).
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
						e.preventDefault();
						act();
					}
				}}
				placeholder={placeholder}
				autoFocus={autoFocus}
				className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
			/>
			<AttachFilesButton editorRef={editorRef} />
			{/* El botón sigue al texto (informe del responsable 2026-10-03): mientras
				se ejecuta un turno CON texto escrito, sigue siendo la indicación de ENVIAR
				(clic = reorientar — la reorientación debe poder hacerse con clic, no solo con Enter);
				solo un compositor vacío lo transforma en Detener. ESC conserva su aborto
				con ventana de confirmación en todos los estados, así que detener nunca es
				inalcanzable. Sin tooltip — el glifo ↵ es la indicación
				(responsable, ronda de sutileza 2026-09-25).
				
				LA TRANSFORMACIÓN NEXT (ajuste de la ronda 16 del responsable, 2026-10-06): un
				compositor vacío durante la pausa de la práctica transforma el botón en
				un NEXT PROBLEM verde y ancho — la indicación ES el botón
				(clic y Enter comparten un carril), y escribir cualquier cosa
				devuelve el envío normal. El verde es el registro de respuesta
				correcta de la app (el token de éxito de answered-card). */}
				{nextProblem && !busy && !canSend ? (
					<button
						type="submit"
						data-testid="next-problem-button"
						aria-label="Next problem"
						className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-success px-4 font-ui text-xs font-medium uppercase tracking-wide text-background transition-colors hover:bg-success/85"
					>
						Next problem
						<ArrowRightIcon className="size-4" />
					</button>
				) : (
					<button
						type="submit"
						aria-label={busy && !canSend ? "Stop" : "Send"}
						disabled={!busy && !canSend}
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-[10px] transition-colors",
							busy && !canSend
								? "bg-secondary text-foreground hover:bg-accent"
								: "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40",
						)}
					>
						{busy && !canSend ? <SquareIcon className="size-4" /> : <CornerDownLeftIcon className="size-5" />}
					</button>
				)}
		</form>
	);
}
