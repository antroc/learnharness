"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";
import type { ChatDeleteMode, ChatListItem } from "@/src/core";

/** El texto de la casilla de las trazas del grafo (responsable, reelaboración
 *  del flujo del 2026-09-24 — era el cuerpo de la opción delete-nodes en el
 *  diseño de dos botones): la consecuencia que toca el grafo lo dice, incluida
 *  la supervivencia de los temas compartidos. Exportada como función pura para
 *  las fijaciones de render: el texto es diseño, no implementación. */
export const TRACES_COPY = {
	testid: "delete-traces",
	checkbox: "delete-traces-checkbox",
	title: "Also remove its graph traces",
	body: "This session’s topics, links, and events leave the graph too. Topics other sessions or imported notes also cover survive; topics only this session created are removed entirely.",
};

/**
 * Borrado de sesiones (oleada 6, fragmento A; reelaboración del flujo del
 * responsable 2026-09-24) — LA superficie de confirmación destructiva, en un
 * portal con z-50 como el diálogo de configuración, ahora con la forma del
 * diálogo de nodos (los dos deben leerse como un único diseño):
 *
 *   - título rojo "Delete session?" con el aspecto de abort-turn (responsable,
 *     pulido del 2026-10-13: text-sm font-semibold JetBrains Mono por el valor
 *     por defecto de la interfaz — el título de cabecera con serifa ha
 *     desaparecido), el nombre de la sesión debajo en JetBrains Mono con el
 *     tamaño text-sm normal (antes text-lg agrandado), sin cromo de bloque de
 *     código;
 *   - UNA casilla desmarcada por defecto "Also remove its graph traces"
 *     (desmarcada = preserve-graph: mueren el registro de la sesión, sus tareas y
 *     su contabilidad de extracción; el grafo conserva todas las aportaciones.
 *     marcada = delete-nodes: también se van las trazas de la sesión en el registro);
 *   - una fila inferior Cancel + Delete en rojo destructivo, exactamente el par
 *     del diálogo de nodos.
 *
 * Los fallos reintentables se muestran con honestidad con un Try again: 409
 * turn_in_flight / jobs_running («espera al trabajo en curso») y 503
 * extraction_winding_down («en un momento») se despejan solos — la línea de error
 * del servidor ya está escrita para el usuario; la mostramos tal cual. Try again
 * es simplemente volver a pulsar Delete — el modo se vuelve a derivar de la casilla.
 */
export function DeleteSessionDialog({
	chat,
	onClose,
	onDeleted,
}: {
	/** La sesión que se va a borrar; null = cerrado. */
	chat: Pick<ChatListItem, "id" | "title"> | null;
	onClose: () => void;
	/** Ruta de éxito — la barra lateral es responsable de la navegación + el parcheo de la lista. */
	onDeleted: (id: string, mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	// Reintentar ES volver a pulsar Delete: el modo siempre se deriva del
	// estado actual de la casilla (cambiarla entre el fallo y el reintento es un
	// cambio de intención y se respeta como tal — la casilla está desactivada mientras
	// está ocupado, así que no hay cambios a mitad de vuelo).
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	// Estado nuevo por sesión: cerrar reinicia, abrir un chat nuevo empieza limpio.
	useEffect(() => {
		if (!chat) {
			setTraces(false);
			setBusy(false);
			setFailure(null);
		}
	}, [chat]);

	const run = async () => {
		if (!chat || busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json()) as {
				ok?: boolean;
				error?: string;
				code?: string;
				graphRevision?: number;
			};
			if (!res.ok) {
				// El 409 (turno/tareas en ejecución) y el 503 (extracción terminando) son
				// ambos reintentables — mantén el diálogo abierto y muestra la línea del servidor.
				setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
				setBusy(false);
				return;
			}
			onDeleted(chat.id, mode, body.graphRevision ?? 0);
		} catch {
			setFailure({ code: "network", error: "Delete failed — network error. Try again." });
			setBusy(false);
		}
	};

	if (!chat) return null;

	return <DeleteSessionBody
				chat={chat}
				traces={traces}
				busy={busy}
				failure={failure}
				onTraces={(next) => setTraces(next)}
				onClose={onClose}
				onRun={() => void run()}
				renderFrame={(frame) => <HostDialog open frame={frame} onClose={() => {
					if (busy) return "blocked";
					onClose(); return "closed";
				}} backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-background/80" }}>{frame.props.children}</HostDialog>}
			/>;
}

/** El cuerpo puro del diálogo — exportado para las fijaciones SSR (el patrón del
 *  cuerpo del diálogo de ajustes / de nodos). El envoltorio es responsable del estado, los efectos y el portal. */
export function DeleteSessionBody({
	chat,
	traces,
	busy,
	failure,
	onTraces,
	onClose,
	onRun,
	renderFrame,
}: {
	chat: Pick<ChatListItem, "id" | "title">;
	/** La casilla de las trazas del grafo — desmarcada por defecto (preserve-graph). */
	traces: boolean;
	busy: boolean;
	failure: { code: string; error: string } | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const frame = (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete session"
			data-testid="delete-session-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">Delete session?</h2>
			{/* El nombre de la sesión bajo el título en JetBrains Mono (responsable,
			2026-09-24): sin cromo de bloque de código — la fuente ya dice
			código. Responsable, pulido del 2026-10-13: tamaño text-sm normal (antes
			text-lg agrandado), sigue en blanco. La misma forma que el diálogo
			de nodos. */}
			<div className="mt-1.5">
				<code data-testid="session-name-code" className="font-mono text-sm text-foreground">
					{chat.title}
				</code>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				This permanently removes the session — its messages, background jobs, and extraction records. Everything
				it added to the graph stays unless you check below. This cannot be undone.
			</p>
			<label
				data-testid={TRACES_COPY.testid}
				className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3"
			>
				<input
					type="checkbox"
					data-testid={TRACES_COPY.checkbox}
					checked={traces}
					onChange={(e) => onTraces(e.target.checked)}
					disabled={busy}
					className="mt-0.5 size-4 shrink-0 accent-primary"
				/>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">{TRACES_COPY.title}</span>
					<span className="mt-1 block text-xs text-muted-foreground">{TRACES_COPY.body}</span>
				</span>
			</label>
			{failure && (
				<div
					role="alert"
					data-testid="delete-failure"
					className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs"
				>
					<span className="text-foreground">{failure.error}</span>
					<button
						type="button"
						data-testid="delete-retry"
						onClick={onRun}
						disabled={busy}
						className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			{/* La misma fila inferior que el diálogo de nodos: Cancel discreto, Delete en
			rojo destructivo (borde + texto, relleno al pasar el ratón — el par
			destructivo establecido de la app). */}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="delete-confirm"
					onClick={onRun}
					disabled={busy}
					className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
	return renderFrame ? renderFrame(frame) : frame;
}