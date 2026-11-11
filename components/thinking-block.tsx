"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { cn } from "@/lib/utils";
import type { ImageContent } from "@earendil-works/pi-ai";
import { SubmittedImages } from "./submitted-images";
import { PathText } from "@/components/file-path-chip";

/** La fila unificada de thinking del usuario (ronda del responsable,
 *  2026-10-05): UN solo lenguaje visual para toda superficie donde se
 *  renderiza el propio thinking del alumno — las trazas de thinking de
 *  práctica, el canal de lectura elevado encima de la tarjeta respondida, el
 *  thinking de la respuesta del quiz dentro de su contenedor. Llega como una
 *  fila disparadora en el registro exacto de las filas de razonamiento del
 *  agente (etiqueta atenuada + chevron + indicación al pasar el ratón); al
 *  desplegarse abre el bloque de cita — raíl, opacidad del 50%, cursiva. La
 *  cursiva + el texto a media opacidad son la firma de la voz interior; el
 *  raíl lo marca como material del alumno. Sin armazón, sin borde: material
 *  de documento, a todo el ancho.
 *
 *  La ley de un vistazo (responsable): thinking del usuario = raíl + cursiva
 *  al 50%; thinking del agente = sin raíl.
 *
 *  EL DOCUMENTO, A FONDO (rondas dos y tres del responsable, 2026-10-07): sin
 *  lados de chat — las filas del usuario son FRANJAS DEL COLOR DE TARJETA a
 *  todo el ancho (la franja es la marca de autoría frente a la prosa
 *  transparente del agente) con el raíl a lo largo del borde izquierdo. UNA
 *  sola geometría en todas partes, dentro y fuera de tarjetas: el relleno de
 *  la franja es un ajustado 5px (ronda tres: reducido a la mitad — sutil, no
 *  alto), y el hueco izquierdo lo IGUALA, así que el raíl ocupa el resto de la
 *  sangría de 3ch — la sangría total se queda en 3ch (sobrevive la ley de
 *  alineación de chevrons con las filas a ras del agente). Ronda cinco
 *  (responsable, 2026-10-07): el raíl vuelve a estrecharse (hueco de 14px,
 *  raíl calc(3ch-14px) — el raíl ancho distraía); relleno de franja 4px; pr-4
 *  para que el texto desplegado haga salto de línea PRONTO. Las filas dentro
 *  de tarjetas (sobre el propio fondo de la tarjeta) NO llevan franja — el
 *  paso de acento se veía demasiado claro (veredicto del responsable); solo
 *  raíl, alturas idénticas (`inCard`). `defaultOpen` marca las filas de la
 *  transcripción, que llegan DESPLEGADAS (transmite claramente que el
 *  thinking se envió).
 *
 *  ⌘T (toggle-user-thinking) pone TODAS las filas en un mismo estado
 *  mediante el store de módulo de abajo — una sola fuente de verdad, sin
 *  árbol de proveedores: las filas se suscriben al montar; los ajustes
 *  explícitos (y solo ellos) pisan los conmutadores individuales. */

// ── El store de ⌘T (ámbito de módulo, uno por carga de página) ─────────────
// null = "las filas usan sus propios valores por defecto" (el estado previo al conmutador); el primer ⌘T
// parte de `true` (las filas de la transcripción están abiertas por defecto) y luego alterna.
let allUserThinkingOpen: boolean | null = null;
const userThinkingListeners = new Set<(open: boolean) => void>();

export function currentUserThinkingOpen(): boolean {
	return allUserThinkingOpen ?? true;
}

/** El estado inicial de la fila: un ajuste explícito con ⌘T gana al valor por
 *  defecto propio de la fila (los montajes tardíos respetan el último ajuste —
 *  la misma ruta que la sincronización en vivo, legible al renderizar para que
 *  el SSR estático también refleje el store). */
function resolveUserThinkingOpen(defaultOpen: boolean): boolean {
	return allUserThinkingOpen ?? defaultOpen;
}

export function setAllUserThinkingOpen(open: boolean) {
	allUserThinkingOpen = open;
	for (const l of userThinkingListeners) l(open);
}

function subscribeUserThinking(fn: (open: boolean) => void): () => void {
	userThinkingListeners.add(fn);
	if (allUserThinkingOpen !== null) fn(allUserThinkingOpen); // los montajes tardíos respetan el último ajuste
	return () => userThinkingListeners.delete(fn);
}

export function ThinkingBlock({
	label = "YOUR THINKING",
	text,
	images,
	testId,
	dataCommit,
	defaultOpen = false,
	inCard = false,
}: {
	label?: string;
	text: string;
	images?: readonly Readonly<ImageContent>[];
	testId?: string;
	/** El indicador de registro del marcador de práctica (commit frente a nudge). */
	dataCommit?: boolean;
	/** Las filas de la transcripción llegan desplegadas (responsable, 2026-10-07). */
	defaultOpen?: boolean;
	/** Sobre el propio fondo de la tarjeta: sin franja (el acento se veía demasiado claro). */
	inCard?: boolean;
}) {
	const [open, setOpen] = useState(() => resolveUserThinkingOpen(defaultOpen));
	// ⌘T: un ajuste global explícito sustituye a todas las filas (una vez fijado, las filas se resincronizan).
	const syncedRef = useRef(false);
	useEffect(
		() => subscribeUserThinking((o) => { syncedRef.current = true; setOpen(o); }),
		[],
	);
	return (
		/* El raíl AGRUPA y el raíl ES EL CARÁCTER QUE FALTA (rondas del
		responsable, 2026-10-05): el encabezado va DENTRO del raíl, y el ancho
		completo del raíl (borde + relleno) es exactamente TRES CARACTERES de la
		fuente monoespaciada del encabezado — 'YOUR THINKING' es tres caracteres
		más corto que 'AGENT'S THINKING', así que con la fila del usuario
		desplazada por el raíl y la del agente a ras, los chevrons quedan alineados
		en vertical. Tres (no uno, ronda 5 del responsable): el hueco más ancho se
		lee mejor que el raíl apretado de un solo carácter. El registro del
		encabezado son las versalitas monoespaciadas pequeñas de los antetítulos
		de las tarjetas (text-xs = el peldaño de 11px). */
		<div
			data-testid={testId}
			data-commit={dataCommit === undefined ? undefined : dataCommit ? "true" : "false"}
			className={cn(
				// Ronda cinco (responsable, 2026-10-07): la sangría total sigue siendo 3ch (la
				// ley del chevron); el raíl se estrecha (hueco de 14px), relleno de 4px, pr-4
				// mantiene el texto lejos del borde derecho de la franja. Las filas dentro de tarjetas
				// NO llevan franja — la elevación del acento se veía demasiado clara; solo raíl.
				"lh-card-enter my-2 w-full border-l-[calc(3ch-14px)] border-muted-foreground/30 py-1 pl-[14px] pr-4 font-ui text-xs",
				inCard ? "" : "bg-card",
			)}
		>
			<button
				type="button"
				data-testid={testId ? `${testId}-trigger` : undefined}
				onClick={(e) => {
					setOpen((v) => !v);
					blurAfterPointerClick(e);
				}}
				aria-expanded={open}
				className="flex w-full items-center gap-2 font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
			>
				{label}
				<ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "rotate-0")} />
			</button>
			{open && (
				<div>{text && <span className="lh-prose mt-1.5 block whitespace-pre-wrap text-[15px] italic text-foreground/50"><PathText text={text} /></span>}<SubmittedImages images={images} /></div>
			)}
		</div>
	);
}
