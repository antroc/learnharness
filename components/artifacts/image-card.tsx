"use client";

import { DownloadIcon, MaximizeIcon } from "lucide-react";
import { useSessionMermaid } from "@/components/session-overlay";
import { downloadFile } from "@/components/artifacts/download";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import type { ArtifactPartProps, ImageSnapshot, ShowImageDetails } from "@/src/core";
import { useImageSnapshot } from "./use-image-snapshot";

/**
 * La tarjeta de show_image (issue #363): una de las imágenes propias del
 * alumno, como material del documento al estilo de una figura: la imagen y
 * después una fila de pie con "Image" + el pie del profesor a la izquierda y
 * los controles a la derecha. Sin interruptor de inversión (decisión del
 * responsable: una foto invertida es un negativo). Una llamada fallida o aún
 * en curso mantiene la tarjeta discreta de llamada a herramienta.
 */

function isShowImageDetails(value: unknown): value is ShowImageDetails {
	const v = value as Partial<ShowImageDetails> | null | undefined;
	return (
		typeof v?.snapshotId === "string" &&
		/^[a-f0-9]{64}$/.test(v.snapshotId) &&
		(v.mimeType === "image/png" || v.mimeType === "image/jpeg") &&
		typeof v.path === "string" &&
		typeof v.width === "number" &&
		typeof v.height === "number"
	);
}

/** El nombre de fichero del alumno, sin su directorio. Puro. */
function baseName(path: string): string {
	return path.split(/[\\/]/).pop() || "image";
}

/** El nombre de descarga: la raíz del fichero con la extensión del formato
 * GUARDADO (una imagen convertida o reducida ya no son los bytes originales). Puro. */
export function imageDownloadName(image: Pick<ShowImageDetails, "path" | "mimeType">): string {
	const stem = baseName(image.path).replace(/\.[^.]*$/, "") || "image";
	return `${stem}.${image.mimeType === "image/png" ? "png" : "jpg"}`;
}

/** La imagen como documento SVG independiente: la forma que admite la
 * superposición a pantalla completa (un visor SVG dimensionado por viewBox). Puro. */
export function imageSvgDocument(image: ImageSnapshot): string {
	const { width, height } = image;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="data:${image.mimeType};base64,${image.data}" width="${width}" height="${height}"/></svg>`;
}

export function ImageCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return <ToolCallCard part={part} />;
	const image = part.output;
	if (!isShowImageDetails(image)) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Image shown, but it could not be displayed.
			</div>
		);
	}
	return <StoredImageCard details={image} />;
}

function StoredImageCard({ details }: { details: ShowImageDetails }) {
	const { image, failed } = useImageSnapshot(details.snapshotId);
	if (!image) return <div className="my-4 text-sm text-muted-foreground" role="status">{failed ? "Image snapshot could not be loaded." : "Loading image…"}</div>;
	return <ImagePresentation image={{ ...image, path: details.path, caption: details.caption }} />;
}

/** Presentación resuelta compartida por la vista en línea, la descarga y la pantalla completa. */
export function ImagePresentation({ image }: { image: ImageSnapshot & Pick<ShowImageDetails, "path" | "caption"> }) {
	const overlay = useSessionMermaid();
	const save = () => {
		const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
		downloadFile(imageDownloadName(image), bytes, image.mimeType);
	};
	return (
		/* Las dimensiones automáticas dejan que las restricciones de anchura/60vh
		   escalen toda la imagen proporcionalmente, sin agrandarla nunca. El envoltorio
		   se ciñe a su anchura mostrada; w-0 + min-w-full evita que el pie ensanche la tarjeta. */
		<figure className="my-4 mx-auto w-fit max-w-full" data-testid="image-card">
			<div className="w-fit max-w-full overflow-hidden rounded-lg">
				{/* Una imagen en memoria procedente del registro; sin optimización de imágenes de Next. */}
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src={`data:${image.mimeType};base64,${image.data}`}
					alt={image.caption ?? baseName(image.path)}
					width={image.width}
					height={image.height}
					className="block h-auto w-auto max-h-[60vh] max-w-full"
					draggable={false}
				/>
			</div>
			<figcaption className="mt-2 flex w-0 min-w-full items-start justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Image</span>
					{image.caption && (
						<span className="text-sm text-muted-foreground" data-testid="image-caption">
							{image.caption}
						</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						aria-label="Download image"
						title="Download image"
						onClick={save}
						data-testid="image-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
					{overlay && (
						<button
							type="button"
							aria-label="Open image fullscreen"
							title="Open fullscreen"
							onClick={() => overlay.openFigure(imageSvgDocument(image), false)}
							data-testid="image-open"
							className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<MaximizeIcon className="size-3.5" />
						</button>
					)}
				</div>
			</figcaption>
		</figure>
	);
}
