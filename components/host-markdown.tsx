"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { ExtraProps } from "streamdown";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { MarkdownDisplayOnlyContext, mdComponents } from "@/components/md-blocks";
import { cn } from "@/lib/utils";

/** La imagen por defecto de Streamdown añade un botón de descarga con independencia
 * de su ajuste de controles. Conserva aquí su estilo de imagen y su alternativa
 * pasiva ante errores, sin cambiar el componente de imagen que usan las transcripciones normales. */
function StaticMarkdownImage({ className, src, alt, node, onLoad, onError, ...props }: ComponentProps<"img"> & ExtraProps) {
	const image = useRef<HTMLImageElement>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (image.current?.complete) setFailed(image.current.naturalWidth === 0);
	}, []);
	const fallback = failed && props.width == null && props.height == null;
	if (!src) return null;
	return (
		<div className="group relative my-4 inline-block" data-streamdown="image-wrapper">
			{/* La cadena de Markdown es responsable de sanear las URL, igual que en el chat. */}
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				alt={alt}
				className={cn("max-w-full rounded-lg", fallback && "hidden", className)}
				data-streamdown="image"
				onError={event => { setFailed(true); onError?.(event); }}
				onLoad={event => { setFailed(false); onLoad?.(event); }}
				ref={image}
				src={src}
				{...props}
			/>
			{fallback && <span className="text-muted-foreground text-xs italic" data-streamdown="image-fallback">Image not available</span>}
			<div className="pointer-events-none absolute inset-0 hidden rounded-lg bg-black/10 group-hover:block" />
		</div>
	);
}

// Se resuelve de forma perezosa: el grafo de módulos existente de mensajes/host de plugins es cíclico.
// Una vez inicializada, la identidad con ámbito de módulo se mantiene estable entre instantáneas.
let components: typeof mdComponents & { img: typeof StaticMarkdownImage };
function getComponents() {
	return components ??= { ...mdComponents, img: StaticMarkdownImage };
}
const linkSafety = { enabled: false };

/** Instantáneas de Markdown completas, solo de visualización, a través de la cadena
 * real de mensajes del host, incluida su recuperación de matemáticas de herramientas,
 * solo de presentación. El perfil local nunca cambia los controles de la
 * transcripción ni los renderizadores de los plugins. Una instantánea nueva retira el
 * subárbol asíncrono de código/diagramas anterior. */
export function HostMarkdown({ text }: { text: string }) {
	return (
		<MarkdownDisplayOnlyContext.Provider value={true}>
			<ToolContentResponse key={text} mode="static" isAnimating={false} controls={false} components={getComponents()} linkSafety={linkSafety}>
				{text}
			</ToolContentResponse>
		</MarkdownDisplayOnlyContext.Provider>
	);
}
