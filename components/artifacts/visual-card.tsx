"use client";

import { useContext, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { DownloadIcon, MaximizeIcon } from "lucide-react";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { Toggle } from "@/components/settings/controls";
import { useSessionMermaid } from "@/components/session-overlay";
import { downloadFile } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { SvgImage } from "@/components/artifacts/svg-image";
import { embedLearnerImage, type ArtifactPartProps, type VisualResult } from "@/src/core";
import { useImageSnapshot } from "./use-image-snapshot";

/**
 * Tarjeta del artefacto visual (W6 → protocolo de acuse): la salida de la
 * parte de herramienta es el acuse del despacho, así que el cuadro de la
 * llamada es la DispatchCard (estado en directo a través del feed de tareas
 * de la vista de chat). El SVG en sí se renderiza a partir del mensaje de
 * reorientación (entrega del resultado del subagente) mediante VisualOutputCard.
 *
 * Ambos modos de presentación usan un documento de imagen SVG: el marcado
 * generado y sus estilos nunca se unen al DOM de la app. Las descargas siguen
 * conteniendo el SVG original.
 */

/** La anchura DECLARADA de la raíz svg en px, cuando la hay: el tamaño natural
 * con el que la tarjeta se muestra en vez de estirarse a todo el ancho
 * (responsable, 2026-10-07). %, em, "auto" o un atributo ausente → null (el
 * llamante recurre a todo el ancho). Puro. */
export function svgNaturalWidth(svg: string): number | null {
	const m = /<svg\b[^>]*?\bwidth\s*=\s*["']([^"']+)["'][^>]*>/i.exec(svg);
	if (!m) return null;
	const value = m[1]!.trim();
	const px = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	if (!px) return null;
	const n = Number.parseFloat(px[1]!);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function VisualCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="visual" />;
}

/** La figura en sí; se exporta porque la tarjeta de reorientación renderiza el artefacto entregado. */
export function VisualOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as VisualResult | undefined;
	const snapshot = useImageSnapshot(result?.image?.snapshotId);
	const svg = result?.image && snapshot.image ? embedLearnerImage(result.svg, snapshot.image) : result?.svg ?? "";
	const overlay = useSessionMermaid();
	const actions = useContext(ChatActionsContext);
	// Inversión de brillo (responsable, 2026-10-07): el estado del interruptor PERSISTE en
	// el registro de la reorientación (details.ui.inverted); se siembra aquí y se escribe a través
	// de la ruta silenciosa artifact-ui al conmutar; sin página de chat (pruebas,
	// vistas previas) se queda solo en local. El estado conmutado alimenta también la
	// superposición a pantalla completa (openFigure).
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	const natural = result && typeof result.svg === "string" ? svgNaturalWidth(result.svg) : null;
	if (!result || typeof result.svg !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Figure completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.svg.length === 0;
	// Una imagen anotada del alumno (issue #363) es una foto: invertirla
	// muestra un negativo, así que nunca se invierte y no muestra interruptor.
	const invertible = result.image === undefined;
	const shownInverted = invertible && inverted;
	if (failed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="visual-card-failed">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Figure
					<span className="rounded bg-error/15 px-1.5 py-0.5 text-error">failed</span>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{result.notes ?? "The figure could not be drawn."}</p>
			</div>
		);
	}
	if (result.image && !snapshot.image) return <div className="my-4 text-sm text-muted-foreground" role="status">{snapshot.failed ? "Image snapshot could not be loaded." : "Loading image…"}</div>;
	return (
		/* SIN ADORNOS DE TARJETA (ronda del responsable, 2026-10-07): la figura es
		   material del documento: sin borde, sin caja de relleno. Primero la imagen y
		   debajo la FILA DE PIE: "Figure" a la izquierda y los controles a la derecha,
		   con ambos bordes siguiendo la anchura propia de la IMAGEN (el envoltorio
		   lleva la ley de tamaño natural, así que la fila se ciñe a una figura
		   estrecha centrada, no a la columna). */
		<div
			className={
				!invertible || natural !== null
					? "my-4 mx-auto w-fit max-w-full"
					: "my-4 w-full"
			}
			data-testid="visual-card"
		>
			{/* Las figuras normales mantienen su ley de tamaño natural/a todo el ancho.
			   Las anotaciones de imágenes del alumno usan un tamaño automático intrínseco
			   con un tope de 60vh; anchura y altura se reducen a la vez, sin recortes ni
			   ampliaciones. El filtro de inversión va en el contenedor bg-white, así que el
			   fondo pasa de blanco a negro junto con los trazos; las zonas transparentes
			   SON el fondo. */}
			<div
				className={
					!invertible || natural !== null
						? "w-fit max-w-full overflow-hidden rounded-lg bg-white"
						: "w-full overflow-hidden rounded-lg bg-white"
				}
				style={{ filter: shownInverted ? "invert(1) hue-rotate(180deg)" : undefined }}
				data-testid="visual-svg"
			>
				<SvgImage
					svg={svg}
					width={natural ?? undefined}
					className={
						!invertible
							? "block h-auto w-auto max-h-[60vh] max-w-full"
							: natural !== null ? "block h-auto max-w-full" : "block h-auto w-full"
					}
				/>
			</div>
			<div className={
				!invertible
					? "mt-2 flex w-0 min-w-full flex-wrap items-center justify-between gap-2"
					: "mt-2 flex items-center justify-between gap-2"
			}>
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Figure</div>
				<div className={!invertible ? "ml-auto flex items-center gap-1.5" : "flex items-center gap-1.5"}>
					{/* La indicación de inversión (ronda del responsable, 2026-10-07): el disco ES
					    el círculo de contraste medio relleno; el tooltip le pone nombre. */}
					{invertible && (
						<Toggle
							checked={inverted}
							onChange={toggleInverted}
							label="Invert figure brightness"
							title="Invert colors"
							discIcon={<InvertDiscIcon className="size-3" />}
						/>
					)}
					<button
						type="button"
						aria-label="Download figure as SVG"
						title="Download as SVG"
						onClick={() => downloadFile("figure.svg", svg, "image/svg+xml")}
						data-testid="visual-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
					{overlay && (
						<button
							type="button"
							aria-label="Open figure fullscreen"
							title="Open fullscreen"
							onClick={() => overlay.openFigure(svg, shownInverted)}
							data-testid="visual-open"
							className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<MaximizeIcon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
