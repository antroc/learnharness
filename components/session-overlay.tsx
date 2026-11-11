"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fitGraphView, fitZoomFor, zoomedGraphView, type Viewport } from "@/components/pan-zoom";
import { renderMermaid } from "@/components/mermaid-render";
import { useAppearance } from "@/components/settings/appearance";
import { MermaidError } from "@/components/mermaid-error";
import { Hint } from "@/components/ui/hint";
import { SvgImage } from "@/components/artifacts/svg-image";
import { InteractionLayerOwner, useInteractionLayer } from "./interaction-layers";

/**
 * OVERLAYS CON ÁMBITO DE SESIÓN (oleada del responsable, 2026-09-19): las
 * ampliaciones "a pantalla completa" — el foco del plan, este foco de
 * mermaid — NO cubren el cromo de la app. Se montan en ABSOLUTO DENTRO DEL
 * ÁREA DE LA SESIÓN (el div `relative` bajo la barra superior, a la derecha
 * de la barra lateral, donde viven la transcripción y el dock), así que la
 * barra de arrastre de 60px sigue nítida, visible y arrastrable, y la X nunca
 * puede caer en territorio de arrastre — los antiguos overlays
 * `fixed inset-0` la ponían justo ahí, que es lo que motivó este rediseño.
 * Superficie: fondo al 80% + difuminado (decisión del usuario) — la
 * transcripción se transparenta mientras el foco ocupa el área de la sesión.
 *
 * El código del diagrama se registra desde donde esté en la transcripción
 * (el botón de ampliar de md-blocks) mediante el contexto de abajo; la
 * PÁGINA DEL CHAT es dueña del estado abierto para que este overlay se monte
 * como hermano del elemento con scroll dentro del área de la sesión — nunca
 * dentro de él (un absolute inset-0 dentro del elemento con scroll cubriría
 * la extensión desplazable, no el área visible).
 */

/** La frontera de ampliar: el botón de hover de mermaid de md-blocks llama a
 *  openMermaid con el código del diagrama; el botón de pantalla completa de
 *  la tarjeta de figura llama a openFigure con el svg en bruto (+ su estado
 *  de inversión). La página del chat (que proporciona este contexto) abre el
 *  overlay. Null cuando no hay ninguna página de chat montada (vistas
 *  previas de la barra lateral, etc.) — ahí los botones simplemente no se renderizan. */
export interface SessionImage {
	src: string;
	width: number;
	height: number;
}

export const SessionMermaidContext = createContext<{
	openMermaid: (chart: string) => void;
	openFigure: (svg: string, inverted: boolean) => void;
	openImage?: (image: SessionImage) => void;
} | null>(null);

export function useSessionMermaid() {
	return useContext(SessionMermaidContext);
}

/** El tamaño natural del svg de un diagrama — mermaid siempre emite un
 *  viewBox; esta es la extensión con zoom 1 (1 unidad svg = 1 px), como el
 *  tamaño natural del diagrama del plan. Los svg de figuras (2026-10-07)
 *  pueden declarar en su lugar width/height — ese par es la alternativa. La
 *  alternativa final cubre un svg degenerado sin ninguno de los dos. Pura. */
export function chartSize(svg: string): { w: number; h: number } {
	const m = /<svg[^>]*\bviewBox="([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/.exec(svg);
	if (m) {
		const w = Number.parseFloat(m[3]!);
		const h = Number.parseFloat(m[4]!);
		if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
	}
	const attr = (name: string): number | null => {
		const a = new RegExp(`<svg\\b[^>]*?\\b${name}\\s*=\\s*["'](\\d+(?:\\.\d+)?)(?:px)?["']`, "i").exec(svg);
		if (!a) return null;
		const n = Number.parseFloat(a[1]!);
		return Number.isFinite(n) && n > 0 ? n : null;
	};
	const w = attr("width");
	const h = attr("height");
	if (w !== null && h !== null) return { w, h };
	return { w: 600, h: 400 };
}

/** El foco del diagrama: el diagrama a tamaño natural dentro de un viewport
 *  de desplazamiento/zoom (la semántica de suelo de ajuste de la ventana
 *  emergente del plan — fitGraphView/zoomedGraphView en pan-zoom.ts), Esc/X
 *  cierran. Renderiza su propia copia del diagrama (los ids de mermaid son
 *  por render), no el svg en línea inyectado. MODO FIGURA (2026-10-07): pasa
 *  un `svg` en bruto en lugar de un `chart` de mermaid — el mismo armazón
 *  enfoca entonces el svg de una tarjeta de figura sobre un escenario blanco,
 *  conservando el estado de inversión de quien llama (el filtro va sobre el
 *  escenario blanco, exactamente como el contenedor dentro de la tarjeta). */
export function MermaidOverlay({
	chart,
	svg: rawSvg,
	image,
	inverted = false,
	onClose,
}: {
	chart?: string;
	svg?: string;
	image?: SessionImage;
	inverted?: boolean;
	onClose: () => void;
}) {
	// ── render del diagrama (instancia propia, ids propios); el modo figura usa el svg en bruto ──
	const [svg, setSvg] = useState<string | null>(rawSvg ?? null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const { resolvedMode } = useAppearance();
	useEffect(() => {
		if (image) {
			setSvg(null);
			setError(null);
			return;
		}
		if (rawSvg !== undefined) {
			setSvg(rawSvg);
			setError(null);
			return;
		}
		if (chart === undefined) return;
		let cancelled = false;
		setSvg(null);
		setError(null);
		renderMermaid(chart, resolvedMode)
			.then((s) => {
				if (!cancelled) setSvg(s);
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [rawSvg, chart, image, attempt, resolvedMode]);

	const rootRef = useRef<HTMLDivElement>(null);
	const layer = useInteractionLayer({
		kind: "view", enabled: true, rootRef,
		onClose: () => { onClose(); return "closed"; },
	});

	// ── viewport de desplazamiento/zoom (la misma conexión que la ventana emergente del plan) ──
	const viewportRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const box = useMemo(() => image ? { w: image.width, h: image.height } : svg ? chartSize(svg) : { w: 0, h: 0 }, [svg, image]);
	const mediaName = image ? "Image" : "Diagram";
	const fitLabel = image ? "Fit image to view" : "Fit diagram to view";
	const fitZoom = useMemo(() => fitZoomFor(box, size), [box, size]);

	const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
	const userAdjustedRef = useRef(false);
	const atFloor = view.zoom <= fitZoom + 1e-9;
	const [settled, setSettled] = useState(false);
	const [panning, setPanning] = useState(false);

	useEffect(() => {
		if (atFloor) userAdjustedRef.current = false;
	}, [atFloor]);
	useEffect(() => {
		if (userAdjustedRef.current || !size.w || !size.h || (!svg && !image)) return;
		setView(fitGraphView(box, size, fitZoom));
		const raf = requestAnimationFrame(() => setSettled(true));
		return () => cancelAnimationFrame(raf);
	}, [fitZoom, size, box, svg, image]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			const factor = Math.exp(-dy * 0.0015);
			const rect = el.getBoundingClientRect();
			setView((v) =>
				zoomedGraphView(v, factor, fitZoom, { x: e.clientX - rect.left, y: e.clientY - rect.top }, box, size),
			);
			userAdjustedRef.current = true;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [fitZoom, box, size]);

	const dragRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
	const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest("button")) return;
		if (atFloor) return;
		dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
		setPanning(true);
		e.currentTarget.classList.add("cursor-grabbing");
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		d.moved = true;
		setView((v) =>
			v.zoom <= fitZoom + 1e-9 ? v : { ...v, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) },
		);
	};
	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (d) {
			dragRef.current = null;
			if (d.moved) userAdjustedRef.current = true;
		}
		setPanning(false);
		e.currentTarget.classList.remove("cursor-grabbing");
	};
	const stepZoom = (factor: number) => {
		userAdjustedRef.current = true;
		setView((v) => zoomedGraphView(v, factor, fitZoom, { x: size.w / 2, y: size.h / 2 }, box, size));
	};
	const fitView = () => {
		userAdjustedRef.current = false;
		if (!size.w || !size.h) return;
		setView(fitGraphView(box, size, fitZoom));
	};

	return (
		<InteractionLayerOwner.Provider value={layer.id}>
		<div
			ref={rootRef}
			data-testid="mermaid-overlay"
			// CON ÁMBITO DE SESIÓN (no fijo): se monta en absoluto dentro del div del
			// área de la sesión de la página del chat — bajo la barra de arrastre, a la
			// derecha de la barra lateral. 80% + difuminado: la transcripción se transparenta
			// (decisión del responsable, 2026-09-19).
			className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-background/80 p-4 backdrop-blur-sm"
			// Ordenado dentro de la pila de vistas acotada de la sesión, por debajo de los modales de la app.
			style={{ zIndex: 100 + layer.order }}
			role="region"
			aria-label={`${mediaName} focus`}
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="text-sm font-medium">{mediaName}</span>
				<span className="text-xs text-muted-foreground">from this lesson</span>
				<Hint label="Close" binding="escape" side="left">
<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					data-testid="mermaid-overlay-close"
					className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
</Hint>
			</div>
			<div
				ref={viewportRef}
				className={cn(
					"relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl border select-none",
					atFloor ? "cursor-default" : "cursor-grab",
				)}
				onPointerDown={startDrag}
				onPointerMove={moveDrag}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				{error ? (
					<div className="flex h-full items-center justify-center p-4">
						<MermaidError chart={chart ?? ""} error={error} retry={() => setAttempt((a) => a + 1)} />
					</div>
				) : (svg || image) ? (
					<>
						<div
							className="absolute top-0 left-0 origin-top-left"
							style={{
								width: `${box.w}px`,
								transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
								// Oculto hasta que se ha APLICADO el primer ajuste: el ajuste corre en un
							// efecto (tras el pintado), y si no el diagrama parpadearía
							// en el estado inicial arriba a la izquierda con zoom:1 durante un fotograma (el
							// responsable vio exactamente eso; condicionar solo la transición no basta para
							// ocultarlo — la VISIBILIDAD también debe condicionarse a settled).
								opacity: settled ? 1 : 0,
								transition:
									panning || !settled
										? "none"
										: "transform 180ms ease-out, opacity 160ms ease-out",
							}}
						>
							{/* Las figuras comparten el límite de imagen y el fondo blanco de la tarjeta.
							Mermaid conserva su renderizador en línea; globals.css quita
							su tope max-width para que llene la caja de tamaño natural. */}
							{image ? (
								// Reutiliza el viewport de la figura sin volver a codificar ni invertir los bytes del ráster.
								// eslint-disable-next-line @next/next/no-img-element
								<img src={image.src} alt="Submitted image" draggable={false} className="block h-auto w-full" />
							) : rawSvg !== undefined ? (
								<div
									data-lh-overlay-chart
									className="bg-white"
									style={inverted ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
								>
									<SvgImage svg={svg ?? ""} className="block h-auto w-full" />
								</div>
							) : (
								<div
									data-lh-overlay-chart
									className="[&_svg]:h-auto [&_svg]:w-full"
									dangerouslySetInnerHTML={{ __html: svg ?? "" }}
								/>
							)}
						</div>
						<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
							<span className="text-xs text-muted-foreground/60">Drag to pan · scroll to zoom</span>
							<div className="flex gap-1">
								<Hint label="Zoom out" side="bottom">
<button
									type="button"
									aria-label="Zoom out"
									onClick={() => stepZoom(1 / 1.25)}
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<MinusIcon className="size-3.5" />
								</button>
</Hint>
								<Hint label={fitLabel} side="bottom">
<button
									type="button"
									aria-label={fitLabel}
									onClick={fitView}
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<MaximizeIcon className="size-3.5" />
								</button>
</Hint>
								<Hint label="Zoom in" side="bottom">
<button
									type="button"
									aria-label="Zoom in"
									onClick={() => stepZoom(1.25)}
									className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-border/70 bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
								>
									<PlusIcon className="size-3.5" />
								</button>
</Hint>
							</div>
						</div>
					</>
				) : (
					<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
						<span className="inline-block size-4 animate-spin rounded-full border border-current border-b-2" />
						Rendering diagram…
					</div>
				)}
			</div>
		</div>
		</InteractionLayerOwner.Provider>
	);
}
