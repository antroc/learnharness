"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Streamdown, type ExtraProps, type PluginConfig } from "streamdown";
import { streamdownPlugins } from "@/components/ai-elements/message";
import { MarkdownStrong } from "@/components/md-blocks";
import { repairMathForDisplay, transformMathDelimiters } from "@/src/core";

// Transforma el Markdown ya analizado por el renderizador, no un origen con los espacios aplanados:
// aplanar primero destruye los bloques de código cercados y los espacios significativos del código en línea.
// Son nodos propiedad del analizador; el origen de la pregunta/respuesta nunca se modifica.
type PreviewNode = {
	type: string;
	value?: string;
	children?: PreviewNode[];
	alt?: string | null;
	url?: string;
	data?: { hName: string; hProperties: { title: string; href?: undefined } };
};
// Pasa las etiquetas de los enlaces por el saneador compartido sin relajar su esquema.
// El renderizador de span local consume este marcador; nunca se convierte en un tooltip.
const linkLabelMarker = "lh-question-preview-link";
const cutMarker = "lh-question-preview-cut";

function remarkQuestionPreviewPrefix({ cutBeforeMath }: { cutBeforeMath: number | null }) {
	return (tree: { children: PreviewNode[] }) => {
		let stopped = false;
		let mathIndex = 0;
		const prefix = (nodes: PreviewNode[]): PreviewNode[] => {
			const out: PreviewNode[] = [];
			for (const node of nodes) {
				if (stopped) break;
				switch (node.type) {
					case "code":
					case "math":
						stopped = true;
						break;
					case "text":
						out.push({ ...node, value: node.value?.replace(/\s+/g, " ") });
						break;
					case "inlineCode":
						out.push(node);
						break;
					case "inlineMath":
						if (cutBeforeMath !== null && mathIndex++ >= cutBeforeMath) stopped = true;
						else out.push(node);
						break;
					case "emphasis":
					case "strong":
					case "delete":
						out.push({ ...node, children: prefix(node.children ?? []) });
						break;
					case "link":
					case "linkReference":
						// Conserva el estilo/las etiquetas de los enlaces, no la navegación ni los diálogos de seguridad.
						out.push({
							type: "link", url: "", children: prefix(node.children ?? []),
							data: { hName: "span", hProperties: { title: linkLabelMarker, href: undefined } },
						});
						break;
					case "image":
					case "imageReference":
						out.push({ type: "text", value: node.alt ?? "" });
						break;
					case "break":
						out.push({ type: "text", value: " " });
						break;
					case "html":
					case "definition":
						break;
					default:
						if (node.children) {
							const content = prefix(node.children);
							if (content.length) out.push(...content, { type: "text", value: " " });
						}
				}
			}
			return out;
		};
		const children = prefix(tree.children);
		tree.children = [{
			type: "paragraph", children,
			data: { hName: "p", hProperties: { title: stopped ? cutMarker : "" } },
		}];
	};
}

const previewComponents = {
	p: ({ children, title }: ComponentProps<"p"> & ExtraProps) => <span data-preview-cut={title === cutMarker}>{children}</span>,
	span: ({ children, title, node: _node, ...props }: ComponentProps<"span"> & ExtraProps) => title === linkLabelMarker
		? <span className="text-primary underline underline-offset-4">{children}</span>
		: <span title={title} {...props}>{children}</span>,
	code: ({ children }: ComponentProps<"code"> & ExtraProps) => (
		<code data-streamdown="inline-code" className="inline-block align-middle whitespace-pre rounded px-1.5 py-0.5 font-mono leading-none">{children}</code>
	),
	strong: MarkdownStrong,
};

/** Una única línea inerte dentro del botón de desplegar del dock. En un avance no caben
 * renderizadores de bloque, medios, enlaces, botones de copiar ni la división en bloques del streaming. */
export function QuestionPreview({ children }: { children: string }) {
	// Una pregunta nueva debe medirse entera, con independencia del corte anterior.
	return <MeasuredQuestionPreview key={children} source={children} />;
}

function MeasuredQuestionPreview({ source }: { source: string }) {
	const slotRef = useRef<HTMLSpanElement>(null);
	const [fit, setFit] = useState({ cutBeforeMath: Infinity, ready: false, truncated: false });
	const previewPlugins = useMemo(() => ({
		cjk: {
			...streamdownPlugins.cjk!,
			// Streamdown guarda en caché los procesadores por nombre de plugin + opciones serializadas,
			// no por identidad del cierre. Mantén el corte en opciones explícitas del plugin.
			remarkPluginsAfter: [...streamdownPlugins.cjk!.remarkPluginsAfter, [remarkQuestionPreviewPrefix, {
				cutBeforeMath: Number.isFinite(fit.cutBeforeMath) ? fit.cutBeforeMath : null,
			}]],
		},
		math: streamdownPlugins.math,
	} satisfies PluginConfig), [fit.cutBeforeMath]);

	useLayoutEffect(() => {
		if (fit.ready || !slotRef.current) return;
		const slot = slotRef.current;
		const box = slot.getBoundingClientRect();
		const height = box.height;
		if (height <= 0) return; // Dock oculto/sin layout: mide cuando adquiera tamaño.
		// Incluye las alternativas de error de KaTeX para que sus índices sigan coincidiendo con los nodos
		// inlineMath del AST. Mide la composición real, no una lista de comandos TeX supuestos.
		const math = [...slot.querySelectorAll<HTMLElement>(".katex, .katex-error")];
		const tall = math.findIndex((node) => node.getBoundingClientRect().height > height);
		const content = slot.querySelector<HTMLElement>(".lh-prose");
		// Las matemáticas anidadas pueden ocultar el desbordamiento al scrollWidth de la línea.
		// Compara con la RANURA restante, no con su caja intrínseca: los pequeños salientes de
		// la fuente dentro de una línea por lo demás holgada no deben producir puntos espurios.
		const overflows = (node: HTMLElement) => node.scrollWidth > Math.ceil(box.right - node.getBoundingClientRect().left);
		const truncated = tall >= 0 || !!slot.querySelector('[data-preview-cut="true"]') ||
			!!(content && overflows(content)) || math.some(overflows);
		setFit({ cutBeforeMath: tall < 0 ? Infinity : tall, ready: true, truncated });
	}, [fit]);

	useEffect(() => {
		const slot = slotRef.current;
		if (!slot) return;
		const reset = () => setFit({ cutBeforeMath: Infinity, ready: false, truncated: false });
		let previous = slot.getBoundingClientRect();
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
			const next = slot.getBoundingClientRect();
			if (next.width !== previous.width || next.height !== previous.height) {
				previous = next;
				reset();
			}
		});
		observer?.observe(slot);
		const fonts = slot.ownerDocument.fonts;
		fonts?.addEventListener("loadingdone", reset);
		return () => {
			observer?.disconnect();
			fonts?.removeEventListener("loadingdone", reset);
		};
	}, []);

	// Una línea compacta y apta para matemáticas, reservada incluso para un avance vacío.
	// El contenido absoluto no puede hacer crecer la ranura. El interlineado cero de KaTeX solo
	// quita espacio extra de la caja de línea: sus propios puntales conservan la altura completa y sin escalar del glifo.
	return (
		<span
			ref={slotRef}
			data-question-preview
			data-ready={fit.ready}
			className="relative block h-[1.6em] min-w-0 overflow-hidden"
			style={{ visibility: fit.ready ? "visible" : "hidden" }}
		>
			<span data-preview-line className="absolute inset-x-0 top-1/2 flex min-w-0 -translate-y-1/2 items-center overflow-hidden">
				<Streamdown
					mode="static"
					plugins={previewPlugins}
					components={previewComponents}
					controls={false}
					skipHtml
					className="lh-prose w-max min-w-0 max-w-full shrink overflow-hidden whitespace-nowrap text-[length:inherit]! leading-[inherit]! [&_.katex]:inline-block [&_.katex]:max-w-full [&_.katex]:overflow-hidden [&_.katex]:align-middle [&_.katex]:leading-[0]!"
				>
					{transformMathDelimiters(repairMathForDisplay(source))}
				</Streamdown>
				{fit.truncated && <span data-preview-ellipsis className="shrink-0">...</span>}
			</span>
		</span>
	);
}
