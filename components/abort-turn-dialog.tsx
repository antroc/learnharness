"use client";

import type { ReactElement, ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";

/**
 * La protección del aborto con ESC (responsable, 2026-10-02): la cadena global
 * Esc → abortar abre este diálogo de confirmación EN TODAS PARTES — tanto para
 * abortar a mitad de streaming como para descartar una pregunta pendiente. Esc en el
 * propio diálogo cancela (reclamado — nunca debe encadenarse con otro aborto), y por
 * eso el manejador de aborto de Chat ignora los eventos mientras este diálogo está
 * abierto: por cada Esc se disparan dos listeners de window y stopPropagation por sí
 * solo no puede ordenarlos.
 *
 * MÍNIMO, con el tono del diálogo de borrar nodos: título, una línea, Cancelar +
 * acción. Sin estado de ocupado — ambas acciones son locales (un fetch que se lanza y
 * se olvida, un envío de respuesta cuya propia maquinaria muestra el progreso).
 *
 * Lo que significa "abortar" depende del modo: con un turno en curso, lo mata (lo
 * parcial se queda); con una pregunta pendiente no hay turno que matar — abortar ES
 * descartar (A2, 2026-10-03): la ruta silenciosa escribe el toolResult de pregunta
 * saltada y no despierta NADA; la sesión se pausa hasta el siguiente mensaje normal
 * del usuario, que lleva el descarte al modelo en su contexto.
 */

/** Qué está abortando Esc — determina el texto y la acción de confirmación. */
export type AbortMode = "turn" | "question" | "problem";

const COPY: Record<AbortMode, { title: string; line: string; action: string }> = {
	turn: {
		title: "Abort this turn?",
		line: "The partial answer stays in the transcript.",
		action: "Abort",
	},
	question: {
		title: "Dismiss this question?",
		line: "Skipped — the teacher moves on without it.",
		action: "Dismiss",
	},
	problem: {
		title: "Discard this problem?",
		line: "The problem is dropped — no solution is revealed.",
		action: "Discard",
	},
};

/** El cuerpo puro del diálogo — exportado para las fijaciones de SSR (el patrón de
 * delete-node). El envoltorio se encarga de los efectos + el portal. */
export function AbortTurnBody({
	mode,
	onClose,
	onConfirm,
	busy = false,
	renderFrame,
}: {
	mode: AbortMode;
	onClose: () => void;
	onConfirm: () => void;
	/** El descarte hace también de aborto cuando todavía hay un turno en curso
	 * (responsable, 2026-10-04): la línea lo dice. */
	busy?: boolean;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const copy = COPY[mode];
	const frame = (
			<div
				className="mx-4 w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-sm font-semibold text-card-foreground" data-testid="abort-turn-title">
					{copy.title}
				</h2>
				<p className="mt-1.5 text-xs text-muted-foreground" data-testid="abort-turn-line">
					{copy.line}
					{busy && mode !== "turn" ? " The working turn stops too." : ""}
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="abort-turn-cancel"
						onClick={onClose}
						className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="abort-turn-confirm"
						onClick={onConfirm}
						// Rojo destructivo — el par destructivo establecido de la app.
						className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
					>
						{copy.action}
					</button>
				</div>
			</div>
	);
	if (renderFrame) return renderFrame(frame);
	return <div role="dialog" aria-modal="true" aria-label={copy.title} data-testid="abort-turn-dialog"
		className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
		{...backdropDismiss}>{frame}</div>;
}

export function AbortTurnDialog({
	mode,
	onClose,
	onConfirm,
	busy = false,
}: {
	/** Qué está abortando Esc; null = cerrado (no se renderiza nada). */
	mode: AbortMode | null;
	onClose: () => void;
	onConfirm: (mode: AbortMode) => void;
	busy?: boolean;
}) {
	if (mode === null) return null;
	return <AbortTurnBody mode={mode} onClose={onClose} onConfirm={() => onConfirm(mode)} busy={busy}
		renderFrame={(frame) => <HostDialog open frame={frame} aria-label={COPY[mode].title}
			onClose={() => { onClose(); return "closed"; }}
			backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm", "data-testid": "abort-turn-dialog" }}>
			{frame.props.children}
		</HostDialog>} />;
}
