"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";

/** La línea del 409 extraction_running (redacción del responsable, interludio
 *  de nodos): el error del servidor nombra la extracción; el DOCK DE ACTIVIDAD es
 *  la superficie donde el usuario ve realmente cómo se vacía. Exportada como
 *  función pura para las fijaciones. */
export const EXTRACTION_RETRY_LINE = "An extraction is running — try again when the activity dock drains.";

/**
 * Borrado de nodos (interludio de nodos, motor 50bfcba de Platform) — la
 * superficie de confirmación, en un portal con z-50 como el diálogo de borrado
 * de sesión, cuyo tono sigue. MUERTE COMPLETA por decisión del responsable: el
 * nodo, todas las aristas que lo tocan, todos los eventos que lo nombran, su
 * posición.
 *
 * MÍNIMO POR DECISIÓN DEL RESPONSABLE (2026-09-30): NADA de lectura previa del
 * impacto — lo que se lleva la muerte completa es evidente (las aristas mueren
 * con el nodo), la lectura hacía parpadear el diálogo abierto-cerrado, y unos
 * datos más ricos solo resultarían más confusos a medida que evolucione la
 * semántica del borrado (se está hablando de recablear). La pantalla es: título,
 * nombres, una línea sobre la permanencia, Cancel / Delete. El 409
 * extraction_running sigue recibiendo la redacción del dock con un Try again —
 * la ejecución nunca se aborta en el servidor, se despeja sola; los demás fallos
 * se explican por sí mismos, sin rodeos.
 *
 * REDACCIÓN: "node"/"nodes" — LA palabra de la interfaz para los objetos del
 * grafo (decisión del responsable, el mismo día, estandarizada en toda la interfaz).
 */
/** El cuerpo puro del diálogo — exportado para las fijaciones SSR (el patrón del
 *  cuerpo del diálogo de ajustes). El envoltorio es responsable del estado, los efectos y el portal. */
export function DeleteNodeBody({
	nodes,
	folders = [],
	busy,
	failure,
	onClose,
	onRun,
	renderFrame,
}: {
	/** Un nodo (el menú contextual del lienzo) o muchos (la selección de la tabla de
	 *  cadenas). Uno se nombra solo; muchos ponen el título en plural y listan los
	 *  nombres. */
	nodes: { id: string; name: string }[];
	folders?: { id: string; name: string }[];
	busy: boolean;
	failure: { code: string; error: string } | null;
	onClose: () => void;
	onRun: () => void;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const frame = (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete node"
			data-testid="delete-node-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">
				{folders.length > 0 ? (nodes.length > 0 ? "Delete nodes and remove empty folders?" : "Remove empty folders?") : nodes.length === 1 ? "Delete node?" : `Delete ${nodes.length} nodes?`}
			</h2>
			{/* El nombre o los nombres de nodo bajo el título en JetBrains Mono (responsable,
			2026-09-24): el nombre es la carga útil — la monoespaciada le sienta bien, y
			SIN el cromo de bloque de código (la fuente ya dice código). Responsable,
			pulido del 2026-10-13: el título pierde el aspecto de cabecera con serifa por el
			aspecto de abort-turn (text-sm font-semibold mono, se mantiene el rojo), y
			los nombres dejan el text-lg agrandado por el text-sm normal —
			siguen en blanco y en monoespaciada. La misma forma que el diálogo de sesión.
			Una selección múltiple lista sus nombres (con un tope de 8 + "and K
			more" — el recuento del título lleva el número completo). */}
			<div className="mt-1.5">
				{nodes.length === 1 ? (
					<code data-testid="node-name-code" className="font-mono text-sm text-foreground">
						{nodes[0]?.name}
					</code>
				) : (
					<code data-testid="node-names-code" className="font-mono text-sm text-foreground">
						{nodes.slice(0, 8).map((n) => n.name).join(", ")}
						{nodes.length > 8 ? `, and ${nodes.length - 8} more` : ""}
					</code>
				)}
			</div>
			{folders.length > 0 && <p className="mt-2 text-sm" data-testid="folder-removal-names">Empty folders: {folders.map((f) => f.name).join(", ")}</p>}
			{nodes.length > 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid="node-permanence-line">
				{nodes.length === 1
					? "This permanently deletes the node — this cannot be undone."
					: `This permanently deletes all ${nodes.length} nodes — this cannot be undone.`}
			</p>}
			<p className="mt-2 text-xs text-muted-foreground" data-testid="folder-removal-explanation">
				{folders.length > 0 ? "Only the named empty folders are removed. " : ""}Sessions, imported source records, and non-empty folders are kept.
			</p>
			{failure && (
				<div
					role="alert"
					data-testid="node-delete-failure"
					className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs"
				>
					<span className="text-foreground">
						{failure.code === "extraction_running" ? EXTRACTION_RETRY_LINE : failure.error}
					</span>
					<button
						type="button"
						data-testid="node-delete-retry"
						onClick={onRun}
						disabled={busy}
						className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="node-delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="node-delete-confirm"
					onClick={onRun}
					disabled={busy}
					// Rojo destructivo (responsable, ronda de pulido) — el
					// par destructivo establecido de la app (el aviso de
					// rechazo del chat): borde + texto, relleno al pasar el ratón.
					className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
	return renderFrame ? renderFrame(frame) : frame;
}

export function DeleteNodeDialog({
	nodes,
	folders = [],
	onRemoveFolder,
	onFoldersDeleted,
	onClose,
	onDeleted,
}: {
	/** Los nodos que se van a borrar; null/vacío = cerrado. Uno (el menú contextual
	 *  del lienzo) o muchos (la selección de la tabla de cadenas). Nombres sacados de
	 *  la instantánea del cliente — lo que ve el usuario es lo que nombra el
	 *  diálogo. */
	nodes: { id: string; name: string }[] | null;
	folders?: { id: string; name: string }[];
	onRemoveFolder?: (id: string) => Promise<void>;
	onFoldersDeleted?: (ids: string[]) => void;
	onClose: () => void;
	/** Ruta de éxito — quienes llaman anuncian lh:graph-revision para que la
	 *  instantánea se vuelva a leer. Los ids borrados viajan con él para que quienes
	 *  llaman desde el lado de la selección puedan podar. */
	onDeleted: (nodeIds: string[], graphRevision: number) => void;
}) {
	const [busy, setBusy] = useState(false);
	const hasItems = Boolean(nodes?.length || folders.length);
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	// Estado nuevo por diálogo: cerrar reinicia.
	useEffect(() => {
		if (!hasItems) {
			setBusy(false);
			setFailure(null);
		}
	}, [hasItems]);

	// Muertes completas secuenciales — nunca en paralelo (el contador de revisiones
	// del almacén y el barrido deben verlas en orden). Un fallo DETIENE
	// la ejecución: lo que murió, murió; la línea del fallo dice por qué el resto
	// sigue en pie (sobre todo extraction_running no debe arrollarse
	// sin más). onDeleted se dispara con todo lo que murió de verdad.
	const run = async () => {
		if (!hasItems || busy) return;
		setBusy(true);
		setFailure(null);
		const dead: string[] = [];
		const removedFolders: string[] = [];
		let revision = 0;
		try {
			for (const n of nodes ?? []) {
				const res = await fetch(`/api/graph/nodes/${encodeURIComponent(n.id)}`, { method: "DELETE" });
				const body = (await res.json()) as {
					error?: string;
					code?: string;
					graphRevision?: number;
				};
				if (!res.ok) {
					setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
					setBusy(false);
					if (dead.length > 0) onDeleted(dead, revision);
					return;
				}
				dead.push(n.id);
				revision = body.graphRevision ?? revision;
			}
			for (const folder of folders) {
				if (!onRemoveFolder) throw new Error("Folder removal is unavailable.");
				await onRemoveFolder(folder.id);
				removedFolders.push(folder.id);
			}
			if (removedFolders.length > 0) onFoldersDeleted?.(removedFolders);
			onDeleted(dead, revision);
		} catch (error) {
			setFailure({ code: "network", error: folders.length > 0 && error instanceof Error ? error.message : "Delete failed — network error. Try again." });
			if (removedFolders.length > 0) onFoldersDeleted?.(removedFolders);
			setBusy(false);
			if (dead.length > 0) onDeleted(dead, revision);
		}
	};

	if (!hasItems) return null;

	return <DeleteNodeBody
				nodes={nodes ?? []}
				folders={folders}
				busy={busy}
				failure={failure}
				onClose={onClose}
				onRun={() => void run()}
				renderFrame={(frame) => <HostDialog open frame={frame} onClose={() => {
					if (busy) return "blocked";
					onClose(); return "closed";
				}} backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-background/80" }}>{frame.props.children}</HostDialog>}
			/>;
}
