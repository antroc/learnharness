"use client";

/**
 * BLOQUES DE MARKDOWN, FUNDIDOS EN EL MENSAJE (oleada del responsable,
 * 2026-09-19): el cromo en cajas de streamdown — las tablas con doble marco
 * (borde + fondo de barra lateral + un segundo borde interior + filas de botones
 * de copiar/descargar/pantalla completa), el contenedor de mermaid (caja con
 * borde + cabecera con etiqueta monoespaciada + píldora de acciones + borde
 * interior + botones de zoom dentro del diagrama), las barras de cabecera del
 * código — se SUSTITUYE por este conjunto de componentes, conectado a
 * Streamdown mediante su prop `components`:
 *
 * - Tablas: una tabla de PROSA sencilla (sin caja, sin fondo de barra lateral,
 *   sin barra de botones) — reglas finas entre filas + un subrayado más fuerte
 *   en la cabecera (globals.css); las tablas anchas se desplazan dentro de la columna.
 * - Mermaid: el diagrama desnudo, parte del mensaje — sin etiqueta, sin
 *   contenedor, sin píldora de zoom (el zoom/desplazamiento vive ahora en el
 *   overlay de foco con ámbito de sesión).
 * - Código: el esqueleto CodeBlock de streamdown conserva la fontanería de
 *   shiki, pero el contenedor se funde (tinte de fondo sutil, sin borde, sin
 *   cabecera — globals.css) y los botones desaparecen.
 * - Matemáticas en bloque: visualmente intactas, pero ganan la copia de la esquina.
 *
 * LA ÚNICA INDICACIÓN (decidida por el usuario): un pequeño icono de COPIAR
 * atenuado en la esquina superior derecha de cada bloque, que aparece al pasar
 * el ratón — copia el ORIGEN (tabla → Markdown, código → texto, mermaid →
 * código del diagrama, matemáticas → el TeX en bruto). Nunca finge una columna
 * de tabla ni desplaza el diseño, y la aparición con hover mantiene limpia la
 * superficie de lectura — todo el sentido del fundido. La selección de texto
 * sigue libre: el icono vive en espacio muerto de la esquina. Mermaid recibe
 * además un icono de AMPLIAR (abre el overlay de la sesión) cuando hay una
 * página de chat montada.
 */

import { cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, CopyIcon, MaximizeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	CodeBlock,
	extractTableDataFromElement,
	tableDataToMarkdown,
	useIsCodeFenceIncomplete,
} from "streamdown";
import type { ExtraProps } from "streamdown";
import { MERMAID_FONT_SIZE, renderMermaid } from "@/components/mermaid-render";
import { useAppearance } from "@/components/settings/appearance";
import { MermaidError } from "@/components/mermaid-error";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { chartSize, useSessionMermaid } from "@/components/session-overlay";
import { Hint } from "@/components/ui/hint";
import { BUILTIN_MERMAID_LANGUAGE, PluginCodeBlock } from "@/components/plugin-renderers";

/** Perfil de renderizado local para Markdown montado por el host, solo de visualización. El
 * renderizado normal de la transcripción (incluido Streamdown SSR/estático) sigue siendo interactivo. */
export const MarkdownDisplayOnlyContext = createContext(false);

// ─── La única indicación: la copia de la esquina que aparece con hover ──────

/** Escritura en el portapapeles con alternativa: navigator.clipboard necesita
 *  el permiso `clipboard-sanitized-write`, que el manejador de Electron que
 *  deniega por defecto (electron/main.cjs) debe conceder desde el origen
 *  loopback — y los navegadores con una API obsoleta/ausente también rechazan.
 *  La ruta execCommand con un textarea oculto es el cinturón por debajo: si no,
 *  una escritura fallida sería una operación nula silenciosa, que es justo lo
 *  que vio el responsable. Devuelve si la copia llegó (dirige la píldora Copied). */
async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		/* se pasa a la ruta antigua */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

/** Un pequeño icono de copiar atenuado para la esquina superior derecha de un
 *  bloque. El envoltorio de QUIEN LO USA lleva `group/md relative` (un grupo CON
 *  NOMBRE — el contenedor del mensaje también es un `group`, y un group-hover
 *  sin nombre encendería TODAS las esquinas del mensaje a la vez, el todo a la
 *  vez que vio el responsable) y lo posiciona mediante className; el icono se
 *  oculta solo hasta el hover (opacity-0 → group-hover/md:opacity-100). Copia
 *  getText() al hacer clic; el icono cambia a una marca de verificación un
 *  instante — respuesta suficiente por sí sola (se probó una píldora "Copied" y
 *  se quitó a petición del responsable, 2026-09-19). */
export function CopyCorner({
	getText,
	label,
	className,
}: {
	getText: () => string;
	label: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timerRef.current), []);
	return (
		<span className={cn("relative inline-flex", className)}>
			<button
				type="button"
				aria-label={label}
				data-testid="md-copy"
				className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/md:opacity-100"
				onClick={(e) => {
					blurAfterPointerClick(e);
					void copyText(getText()).then((ok) => {
						if (!ok) return;
						setCopied(true);
						window.clearTimeout(timerRef.current);
						timerRef.current = window.setTimeout(() => setCopied(false), 1500);
					});
				}}
			>
				{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
			</button>
		</span>
	);
}

// ─── Bloques de código + mermaid (la sustitución de `code` de Streamdown) ───

/** El código del bloque a partir de los hijos de un elemento code — una cadena
 *  pelada en el caso habitual; un elemento que envuelve una cadena cuando rehype
 *  lo anida. Pura. */
export function codeSource(children: ReactNode): string {
	if (typeof children === "string") return children;
	if (typeof children === "number") return String(children);
	if (isValidElement(children)) {
		const inner = (children.props as { children?: ReactNode }).children;
		if (typeof inner === "string") return inner;
	}
	return "";
}

/** Mermaid, en el flujo del mensaje: el diagrama desnudo (el tema del modo
 *  renderizado, mediante el plugin propio de la app — components/mermaid-render.ts),
 *  la esquina con hover con copiar + ampliar y la alternativa de error de la casa.
 *  Sin cromo de contenedor ni píldora de zoom — el hogar del zoom/desplazamiento es
 *  el overlay de la sesión. Mientras el bloque sigue llegando por stream (el
 *  bloque abierto del final), un esqueleto discreto en lugar de un análisis
 *  condenado al fracaso. */
function MermaidInline({ chart }: { chart: string }) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const overlay = useSessionMermaid();
	const incomplete = useIsCodeFenceIncomplete();
	const { resolvedMode } = useAppearance();
	// El tope de paridad de fuente (regla del responsable, 2026-09-19): el CSS de la casa
	// (`max-width: 100% !important`) prevalece sobre el tope de tamaño natural de mermaid,
	// así que, si no, un diagrama se estiraría a toda la columna y renderizaría su
	// texto más grande que el propio texto de la sesión. Limita el contenedor al ancho
	// en el que la fuente base de 16px del diagrama queda en la fuente de la SESIÓN (medida
	// en vivo desde el envoltorio — hoy --lh-prose-size): un diagrama puede encoger para
	// caber en la columna, pero nunca agrandar su texto por encima del del chat.
	const holderRef = useRef<HTMLDivElement>(null);
	const [capW, setCapW] = useState<number | null>(null);
	useEffect(() => {
		if (!svg || !holderRef.current) return;
		const fs = Number.parseFloat(getComputedStyle(holderRef.current).fontSize);
		if (!Number.isFinite(fs) || fs <= 0) return;
		const { w } = chartSize(svg);
		setCapW((w * fs) / MERMAID_FONT_SIZE);
	}, [svg]);

	useEffect(() => {
		if (incomplete) return;
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
	}, [chart, attempt, incomplete, resolvedMode]);

	if (incomplete || (svg === null && error === null)) {
		return (
			<div data-testid="md-mermaid" className="my-4 flex justify-center p-4" aria-busy="true">
				<span className="inline-block size-4 animate-spin rounded-full border border-current border-b-2 text-muted-foreground" />
			</div>
		);
	}
	if (error !== null) {
		return <MermaidError chart={chart} error={error} retry={() => setAttempt((a) => a + 1)} displayOnly={displayOnly} />;
	}
	return (
		// data-streamdown="mermaid" mantiene vivo el gancho del CSS de la casa (la regla
		// max-width del svg en globals.css) para este bloque propio de la app.
		<div data-testid="md-mermaid" data-streamdown="mermaid" className="group/md relative my-4">
			<div
				ref={holderRef}
				className="mx-auto flex w-full justify-center"
				style={capW === null ? undefined : { maxWidth: `${capW}px` }}
				dangerouslySetInnerHTML={{ __html: svg ?? "" }}
			/>
			{!displayOnly && <div className="absolute top-0 right-0 flex items-start gap-0.5">
				<CopyCorner getText={() => chart} label="Copy diagram source" />
				{overlay && (
					<Hint
					// Texto del overlay a pantalla completa (oleada de tooltips) — "session view" era
					// jerga interna de dirección para lo mismo.
					label="Open full-screen"
					side="bottom"
				>
<button
						type="button"
						aria-label="Expand diagram"
						data-testid="md-mermaid-expand"
												className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/md:opacity-100"
						onClick={(e) => {
							blurAfterPointerClick(e);
							overlay.openMermaid(chart);
						}}
					>
						<MaximizeIcon className="size-3.5" />
					</button>
				</Hint>
				)}
			</div>}
		</div>
	);
}

/** La sustitución de `code` de Streamdown: el código en línea pasa con las
 *  clases en línea de la casa; los bloques se separan — mermaid se renderiza
 *  como el diagrama desnudo de arriba y todo lo demás delega en el CodeBlock
 *  exportado de streamdown (se conservan el resaltado de shiki + los números de
 *  línea) dentro de un envoltorio con copia por hover, SIN hijos para que su fila
 *  de botones sticky nunca se monte. El contenedor/aspecto se funde con CSS en
 *  globals.css (data-streamdown="code-block"…). */
export function MarkdownCode(props: ComponentProps<"code"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const incomplete = useIsCodeFenceIncomplete();
	const { children, className, node, ...rest } = props;

	// Código en línea: sin data-block (el manejador de pre solo marca los bloques).
	if (!("data-block" in props)) {
		return (
			<code className={cn("rounded px-1.5 py-0.5 font-mono text-sm text-(--lh-ink-code)", className)} data-streamdown="inline-code" {...rest}>
				{children}
			</code>
		);
	}

	const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
	const meta = (node?.properties?.metastring as string | undefined) ?? "";
	const source = codeSource(children);

	if (language === BUILTIN_MERMAID_LANGUAGE) return <MermaidInline chart={source} />;

	const startMatch = /startLine=(\d+)/.exec(meta);
	const startLine = startMatch ? Number.parseInt(startMatch[1]!, 10) : undefined;
	const lineNumbers = !/\bnoLineNumbers\b/.test(meta);
	const fallback = (
		<div className="group/md relative" data-testid="md-code">
			{!displayOnly && <CopyCorner className="absolute top-1.5 right-2 z-10" getText={() => source} label="Copy code" />}
			<CodeBlock
				code={source}
				language={language}
				className={className}
				isIncomplete={incomplete}
				startLine={startLine !== undefined && startLine >= 1 ? startLine : undefined}
				lineNumbers={lineNumbers}
			/>
		</div>
	);
	return displayOnly ? fallback : <PluginCodeBlock language={language} source={source} meta={meta} incomplete={incomplete} fallback={fallback} />;
}

// ─── Recuadros de idea clave (la sustitución de `blockquote` de Streamdown) ─

/** Marcadores de alerta al estilo de GitHub — la sintaxis que los modelos ya
 *  conocen de un millón de README. El PROMPT solo enseña [!IMPORTANT] (un único
 *  recurso de énfasis, un único significado: imprescindible); el renderizador
 *  acepta los cinco y los encuadra de forma idéntica — un [!NOTE] suelto también
 *  quería decir «esto merece énfasis», y una línea de marcador literal nunca
 *  debe colarse como texto (diseño del responsable, ronda de recuadros 2026-10-07). */
const ALERT_MARKER_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

export interface ParsedAlert {
	kind: string;
	/** Los hijos del blockquote sin la línea del marcador — la prosa intacta. */
	children: ReactNode;
}

const significant = (c: ReactNode) => c !== null && c !== undefined && c !== "" && !(typeof c === "string" && c.trim() === "");

/** La etiqueta markdown del elemento — Streamdown envuelve cada bloque en su
 *  propio componente con estilo (MarkdownParagraph, …), así que el tipo de React
 *  rara vez es el "p" en bruto: el nodo hast que viaja en las props dice la verdad. */
function markdownTag(el: React.ReactElement): string | null {
	if (typeof el.type === "string") return el.type;
	const node = (el.props as { node?: { tagName?: string } }).node;
	return node?.tagName ?? null;
}

/** Pura: ¿empieza este blockquote con un marcador de alerta de GitHub? Devuelve
 *  el tipo y los hijos sin la línea del marcador (el propio párrafo del marcador
 *  se quita entero cuando va solo — `> [!IMPORTANT]`, luego una línea de cita en
 *  blanco y luego el contenido; un marcador solo también quita el resto del salto
 *  forzado <br> que llevaba su salto de línea). Los blockquote sin alerta pasan
 *  sin tocar. Exportada para pruebas herméticas. */
export function parseAlertMarker(children: ReactNode): ParsedAlert | null {
	const list = Array.isArray(children) ? children : [children];
	const para = list.find(significant);
	if (!isValidElement(para) || markdownTag(para) !== "p") return null;
	const inner = (para.props as { children?: ReactNode }).children;
	const innerList = Array.isArray(inner) ? inner : [inner];
	const lead = innerList.find(significant);
	if (typeof lead !== "string") return null;
	const match = ALERT_MARKER_RE.exec(lead);
	if (!match) return null;
	const kind = match[1]!.toLowerCase();
	const stripped = lead.slice(match[0].length);
	// Reconstruye el párrafo sin la línea del marcador; quítalo entero cuando
	// el marcador iba solo (nada más que el texto del marcador en el párrafo).
	const leadIdxInner = innerList.indexOf(lead);
	const hasFollowing = innerList.some((c, i) => i > leadIdxInner && significant(c));
	let rebuiltPara: ReactNode = null;
	if (stripped.trim() !== "" || hasFollowing) {
		let rest = innerList.map((c) => (c === lead ? (stripped === "" ? null : stripped) : c));
		if (stripped === "") {
			// el salto forzado <br> que terminaba la línea del marcador es ahora basura inicial
			while (rest.length && (rest[0] === null || (isValidElement(rest[0]) && markdownTag(rest[0]) === "br"))) rest = rest.slice(1);
		}
		rebuiltPara = cloneElement(para, {}, ...rest);
	}
	const leadIdx = list.indexOf(para);
	const restChildren = [...list.slice(0, leadIdx), ...(rebuiltPara ? [rebuiltPara] : []), ...list.slice(leadIdx + 1)];
	return { kind, children: restChildren };
}

/** El recuadro de idea clave (decisiones del responsable, 2026-10-07): esquinas
 *  RECTAS, un trazo blanco, SIN fondo, SIN etiqueta, SIN icono — solo el
 *  contorno. La caja se ciñe a su texto (width: fit-content, con tope en la
 *  columna) en vez de estirarse a todo el ancho por el espacio vacío. */
export function MarkdownBlockquote(props: ComponentProps<"blockquote"> & ExtraProps) {
	const { children, node, ...rest } = props;
	const alert = parseAlertMarker(children);
	if (!alert) {
		// Cita normal — el estilo propio de Streamdown, restaurado a mano: sustituir
		// `blockquote` desplazó su componente con estilo (las clases de abajo son
		// sus valores por defecto tal cual), y un <blockquote> pelado se renderizaba sin estilo
		// (informe del responsable, 2026-10-07).
		return (
			<blockquote
				{...rest}
				className="my-4 border-l-4 border-muted-foreground/30 pl-4 text-muted-foreground italic"
				data-streamdown="blockquote"
			>
				{children}
			</blockquote>
		);
	}
	return (
		<div
			data-testid="md-callout"
			data-alert-kind={alert.kind}
			className="my-4 w-fit max-w-full border border-line-strong px-4 py-3 [&> :first-child]:mt-0 [&> :last-child]:mb-0"
		>
			{alert.children}
		</div>
	);
}

// ─── Tablas (la sustitución de `table` de Streamdown) ───────────────────────

/** Una tabla de PROSA sencilla: sin caja envolvente ni filas de botones — solo
 *  la tabla (las celdas interiores de streamdown conservan su relleno/tipografía;
 *  las reglas finas viven en globals.css sobre los atributos data-streamdown)
 *  dentro de un contenedor de scroll horizontal para las anchas, con la copia de
 *  la esquina. La copia serializa la tabla REAL del DOM (el propio extractor de
 *  la biblioteca → Markdown). */
export function MarkdownTable(props: ComponentProps<"table"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const { children, node, ...rest } = props;
	const ref = useRef<HTMLTableElement>(null);
	return (
		<div className="group/md relative my-4" data-testid="md-table">
			{!displayOnly && <CopyCorner
				// Dentro de la esquina superior derecha de la tabla (nota del responsable, 2026-09-19:
				// el antiguo -top-3 solo subía la mitad del botón de 24px por encima del desplazamiento de 12px,
				// así que quedaba a caballo del contorno superior). Metido 4px, con z por encima de las
				// celdas sobre las que flota; el contenedor de scroll queda debajo (la
				// esquina está fijada al envoltorio, no a la tabla que se desplaza).
				className="absolute top-1 right-1 z-10"
				label="Copy table"
				getText={() => (ref.current ? tableDataToMarkdown(extractTableDataFromElement(ref.current)) : "")}
			/>}
			<div className="overflow-x-auto">
				<table
					ref={ref}
					// Aquí no hay text-sm — el texto de la tabla va al tamaño de la prosa de la sesión
				// (nota del responsable, 2026-09-19: las celdas de streamdown fijan su propio text-sm
				// de 12,5px; globals.css hace que las celdas hereden, así que las tablas coinciden con el
				// texto de 16px del chat para un aspecto coherente).
					className="w-full border-collapse"
					data-streamdown="table"
					{...rest}
				>
					{children}
				</table>
			</div>
		</div>
	);
}

// ─── Matemáticas en bloque (la sustitución de `span` de Streamdown) ─────────

/** Las ecuaciones en bloque de KaTeX van envueltas en un SPAN.katex-display
 *  (rehype-katex las renderiza como spans con CSS display:block — NO divs;
 *  verificado en el render estático). Ganan la copia de la esquina (el TeX en
 *  bruto — KaTeX lo incrusta en el <annotation> de MathML; se lee del DOM al
 *  hacer clic, sin volver a analizar). Todos los demás spans pasan sin tocar. */
export function MathDisplay(props: ComponentProps<"span"> & ExtraProps) {
	const displayOnly = useContext(MarkdownDisplayOnlyContext);
	const { children, className, node, ...rest } = props;
	const ref = useRef<HTMLSpanElement>(null);
	if (!className?.includes("katex-display")) {
		return (
			<span className={className} {...rest}>
				{children}
			</span>
		);
	}
	return (
		// BLOQUE, no en línea: el hijo katex-display es él mismo display:block
		// (el CSS de KaTeX), y un envoltorio en línea alrededor de un hijo de bloque queda
		// FRAGMENTADO por las reglas de bloques anónimos — la esquina con posición
		// absoluta se queda entonces sin un bloque contenedor limpio y los eventos de puntero nunca
		// le llegan (informe del responsable: la esquina de las matemáticas ni se resalta con el hover
		// ni copia; todo lo demás funciona). display:block da a la esquina una
		// caja real; z-10 la mantiene por encima de los spans de la ecuación que tapa.
		<span className="group/md relative block z-0" data-testid="md-math">
			{!displayOnly && <CopyCorner
				className="absolute top-0 right-0 z-10"
				label="Copy equation source"
				getText={() => ref.current?.querySelector("annotation")?.textContent ?? ""}
			/>}
			<span ref={ref} className={className} {...rest}>
				{children}
			</span>
		</span>
	);
}

// ─── El conjunto estable de sustituciones (identidad de módulo: Streamdown está memorizado) ───

/** La negrita como el elemento REAL (arreglo de aspecto, 2026-09-23): el
 *  `strong` por defecto de streamdown renderiza `<span class="font-semibold"
 *  data-streamdown="strong">` — y `.lh-prose :where(strong, b)` coincide con
 *  ELEMENTOS strong/b, así que ni la tinta de fábrica (#ee928c) ni un boldColor
 *  de los ajustes llegaban nunca al texto en negrita (la cursiva sí funcionaba:
 *  streamdown deja `em` nativo). Renderizar el elemento semántico restaura el
 *  énfasis para los lectores de pantalla Y deja que se aplique sin cambios la
 *  regla de tokens diseñada — color --lh-ink-strong, peso 700 (que gana a la
 *  antigua utilidad de 600). */
export function MarkdownStrong(props: ComponentProps<"strong"> & ExtraProps) {
	const { children, className, node, ...rest } = props;
	return (
		<strong data-streamdown="strong" className={className} {...rest}>
			{children}
		</strong>
	);
}

export const mdComponents = {
	code: MarkdownCode,
	table: MarkdownTable,
	span: MathDisplay,
	strong: MarkdownStrong,
	blockquote: MarkdownBlockquote,
};
