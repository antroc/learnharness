"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { joinDictation, useDictationTarget } from "@/components/dictation";
import { composingQuestionKey, pluginQuestionKeySuppressed } from "./plugin-question-keys";
import { PathInput } from "@/components/path-input";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";

/**
 * El campo de reading-thinking (diseño del responsable 2026-10-03, "dos
 * preguntas por unidad de enseñanza"): un textarea discreto para pensar
 * MIENTRAS SE LEE la prosa de enseñanza — el mismo canal de transferencia
 * que el "Your thinking" del dock de preguntas da a la respuesta, abierto
 * una fase antes. Se monta mientras una comprobación de la fase de enseñanza
 * espera tras su revelación (la misma señal que pliega la comprobación),
 * viaja con la respuesta de la comprobación como el canal APARTE
 * `readingThinking` (nunca mezclado con el thinking del quiz) y desaparece
 * con la pregunta.
 *
 * Dictado: mientras la comprobación sigue SIN REVELAR, este campo es el
 * destino principal (el dock libera su reclamación — los pensamientos de
 * lectura dictados caen aquí, no en el campo oculto del quiz); cuando el
 * alumno revela la comprobación, el dock la recupera y este campo pasa a ser
 * solo para teclear.
 */
export function ReadingThinkingField({
	value,
	revision,
	onChange,
	onEscape,
	onOpen,
	claim,
	inputRef,
}: {
	value: string;
	revision: number;
	onChange: (v: string) => void;
	/** Esc en el campo detiene el dictado (pasado desde el hook de la página). */
	onEscape?: () => void;
	/** La comprobación espera CERRADA — Enter la abre (responsable, ronda de
	 *  teclado 2026-10-06). Quien llama termina PRIMERO cualquier dictado en
	 *  vivo (el volcado cae aquí — el campo es la reclamación activa) y luego
	 *  revela. Ausente = la comprobación está abierta: Enter mantiene la
	 *  convención de volcado. */
	onOpen?: () => void;
	/** Reclamación principal del dictado — true mientras la comprobación está tras su revelación. */
	claim: boolean;
	inputRef?: RefObject<HTMLDivElement | null>;
}) {
	const controller = useOptionalInteractionLayers();
	const [draft, setDraft] = useState(value);
	// Los añadidos pueden llegar uno tras otro antes de que React confirme. Como el
	// espejo de envío de Chat, esta ref incluye cada edición de forma síncrona.
	const draftRef = useRef(value);
	useLayoutEffect(() => { draftRef.current = value; setDraft(value); }, [revision, value]);
	const applyDraft = useCallback((next: string) => {
		draftRef.current = next;
		setDraft(next);
		onChange(next);
	}, [onChange]);
	useDictationTarget(
		useCallback((text: string) => applyDraft(joinDictation(draftRef.current, text)), [applyDraft]),
		claim,
	);
	return (
		<div
			data-testid="reading-thinking-field"
			className="pointer-events-auto mb-2 rounded-2xl border bg-card/60 px-3 py-2 transition-colors focus-within:border-primary/50"
		>
			<div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Thinking while reading
			</div>
			<PathInput
				ref={inputRef}
				value={draft}
				onValueChange={applyDraft}
				/* py-0.5 (ronda del responsable, 2026-10-07): el arreglo de la barra de
				scroll. La caja de fuente de Source Sans 3 mide 22px a 16px; el
				interlineado 1.25 de lh-input da una caja de línea de 20px — el área de
				contenido sobresale 1px por debajo de la línea, Chromium lo cuenta en
				scrollHeight y un textarea sin relleno lo convierte en un scroll permanente
				de 1px (la barra aparece vacía y con cualquier tamaño por debajo de max-h).
				2px de relleno vertical lo absorben — la misma absorción que los campos del
				composer y del dock obtienen implícitamente de su py-2. El interlineado se
				queda en 1.25 (la ley del cursor, ronda 2 de tipografía). */
				onKeyDown={(e) => {
					if (composingQuestionKey(e) || pluginQuestionKeySuppressed(e)) return;
					if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
					if (e.key === "Escape") {
						controller?.claimEscape(e);
						// Esc detiene el dictado (la regla de la tira) — se reclama para que la
						// cadena de la ventana no lo lea además como abortar el turno.
						e.preventDefault();
						e.stopPropagation();
						onEscape?.();
						return;
					}
					// ENTER ABRE LA COMPROBACIÓN EN ESPERA (responsable, ronda de teclado
					// 2026-10-06): mientras la comprobación sigue cerrada, Enter a secas
					// (y el universal ⌘/Ctrl+Enter) la abre — el volcado del dictado
					// cae AQUÍ primero mediante el finishDictation de quien llama,
					// así que los pensamientos hablados viajan con ella. Shift+Enter sigue siendo un salto de línea.
					if (e.key === "Enter" && onOpen !== undefined && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.stopPropagation();
						onOpen();
						return;
					}
					// La convención de volcado del dock: Enter a secas es un salto de línea.
					// Aquí no hay botón de envío — el propio envío de la comprobación
					// transporta este campo —, así que ⌘↵ solo quita el foco.
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				placeholder="Whatever comes to mind as you read."
				className="field-sizing-content lh-input max-h-40 w-full resize-none bg-transparent py-0.5 outline-none placeholder:text-muted-foreground/70"
			/>
		</div>
	);
}
