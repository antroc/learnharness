import { createTextSelector, findCitationText, type TextSelector } from "@/src/core";

/**
 * SELECCIÓN DE TEXTO DEL TUTOR (2026-10-31; las reglas siguen la selección
 * de texto del asistente de T3 Code, MIT): una unidad de origen es un
 * mensaje nativo del tutor — todo elemento que lleve su
 * `data-source-message-id`, en orden del DOM. El texto del mensaje es un
 * modelo estable de lo que ve el alumno: se saltan los controles y los nodos
 * ocultos, los límites de bloque se convierten en un "\n" y una fórmula de
 * KaTeX es un fragmento atómico que se lee como su código TeX.
 */

export const SOURCE_ATTRIBUTE = "data-source-message-id";

const EXCLUDED = "button, input, textarea, select, [role=button], [contenteditable], [hidden], [aria-hidden=true], script, style, template, noscript, svg";
const BLOCKS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TD", "TH", "TR", "UL"]);
const TEX = 'annotation[encoding="application/x-tex"]';

/** Un tramo del texto del mensaje: un nodo de texto o un elemento de fórmula atómico. */
export interface TextChunk {
	node: Node;
	start: number;
	end: number;
	atomic?: boolean;
}
export type BoundaryPoint = { node: Node; offset: number };

function isFormula(element: Element): boolean {
	return element.classList.contains("katex");
}

function isBlock(element: Element): boolean {
	return BLOCKS.has(element.tagName) || element.classList.contains("katex-display");
}

function besideBlock(node: Node): boolean {
	const parent = node.parentElement;
	if (parent && /^(OL|UL|DL|TABLE|THEAD|TBODY|TFOOT|TR)$/.test(parent.tagName)) return true;
	const neighbours = [node.previousSibling, node.nextSibling];
	return neighbours.some((sibling) => sibling?.nodeType === 1 && isBlock(sibling as Element));
}

export function sourceElements(viewport: ParentNode, messageId: string): Element[] {
	return Array.from(viewport.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`)).filter((element) => element.getAttribute(SOURCE_ATTRIBUTE) === messageId);
}

export function readSourceText(sources: readonly Element[]): { text: string; chunks: TextChunk[] } {
	let text = "";
	const chunks: TextChunk[] = [];
	let pendingBreak = false;
	const add = (node: Node, value: string, atomic?: boolean) => {
		if (!value) return;
		// Un "\n" solo entre contenido — nunca al principio, nunca duplicado.
		if (pendingBreak && text.length > 0) text += "\n";
		pendingBreak = false;
		chunks.push({ node, start: text.length, end: text.length + value.length, ...(atomic ? { atomic } : {}) });
		text += value;
	};
	const walk = (node: Node) => {
		if (node.nodeType === 3) {
			// La sangría del marcado entre bloques (p. ej. "\n" entre <li>) no es
			// texto que vea el alumno; el límite de bloque ya cuenta.
			if (!/\S/.test((node as Text).data) && besideBlock(node)) return;
			add(node, (node as Text).data);
			return;
		}
		if (node.nodeType !== 1) return;
		const element = node as Element;
		if (isFormula(element)) {
			const tex = element.querySelector(TEX)?.textContent;
			if (tex) add(element, element.parentElement?.closest(".katex-display") ? `$$${tex}$$` : `$${tex}$`, true);
			return;
		}
		if (element.matches(EXCLUDED)) return;
		if (element.tagName === "BR") { pendingBreak = true; return; }
		const block = isBlock(element);
		if (block) pendingBreak = true;
		for (const child of Array.from(element.childNodes)) walk(child);
		if (block) pendingBreak = true;
	};
	for (const source of sources) {
		pendingBreak = true;
		walk(source);
	}
	return { text, chunks };
}

/** El desplazamiento de texto en bruto de un límite del DOM, o null cuando no
 *  está en el mensaje. Un límite dentro de una fórmula se amplía a toda la fórmula. */
function rawOffset(chunks: readonly TextChunk[], point: BoundaryPoint, side: "start" | "end"): number | null {
	for (const chunk of chunks) {
		if (chunk.atomic) {
			if (chunk.node === point.node || chunk.node.contains(point.node)) return side === "start" ? chunk.start : chunk.end;
		} else if (chunk.node === point.node) {
			return chunk.start + Math.min(Math.max(0, point.offset), chunk.end - chunk.start);
		}
	}
	return null;
}

/** El selector para una selección ya ajustada a límites de texto/fórmula. */
export function selectorFromBoundaries(text: string, chunks: readonly TextChunk[], start: BoundaryPoint, end: BoundaryPoint): TextSelector | null {
	const rawStart = rawOffset(chunks, start, "start");
	const rawEnd = rawOffset(chunks, end, "end");
	if (rawStart === null || rawEnd === null || rawEnd <= rawStart) return null;
	return createTextSelector(text, rawStart, rawEnd);
}

/** Desplazamientos normalizados → en bruto. Inicio: el último índice en bruto con esa
 *  longitud normalizada (tras un tramo colapsado); final: el primero. */
export function rawRangeFor(text: string, selector: TextSelector): { start: number; end: number } | null {
	const found = findCitationText(text, selector);
	if (!found) return null;
	const lengths = [0];
	for (let i = 0; i < text.length; i++) {
		const collapsed = /\s/.test(text[i]!) && i > 0 && /\s/.test(text[i - 1]!);
		lengths.push(lengths[i]! + (collapsed ? 0 : 1));
	}
	const start = lengths.lastIndexOf(found.start);
	const end = lengths.indexOf(found.end);
	return start === -1 || end === -1 || end <= start ? null : { start, end };
}

/** El punto del DOM para un desplazamiento en bruto; los separadores se resuelven al
 *  fragmento siguiente (inicio) o anterior (final). Los fragmentos atómicos se resuelven alrededor de su elemento. */
export function chunkPoint(chunks: readonly TextChunk[], offset: number, side: "start" | "end"): (BoundaryPoint & { atomic?: Node }) | null {
	if (side === "start") {
		const chunk = chunks.find((c) => offset < c.end);
		if (!chunk) return null;
		if (chunk.atomic) return { node: chunk.node, offset: 0, atomic: chunk.node };
		return { node: chunk.node, offset: Math.max(0, offset - chunk.start) };
	}
	const chunk = [...chunks].reverse().find((c) => offset > c.start);
	if (!chunk) return null;
	if (chunk.atomic) return { node: chunk.node, offset: 0, atomic: chunk.node };
	return { node: chunk.node, offset: Math.min(chunk.end - chunk.start, offset - chunk.start) };
}

// ─── solo en el navegador: selecciones y rangos vivos ─────────────────────────

export interface CapturedSelection {
	messageId: string;
	range: Range;
	selector: TextSelector;
}

function selectableSlice(chunk: TextChunk, range: Range): boolean {
	if (!range.intersectsNode(chunk.node)) return false;
	const element = chunk.node.nodeType === 1 ? (chunk.node as Element) : chunk.node.parentElement;
	const view = element?.ownerDocument.defaultView;
	if (element && view && view.getComputedStyle(element).userSelect === "none") return false;
	if (chunk.atomic) return true;
	const length = chunk.end - chunk.start;
	const from = chunk.node === range.startContainer ? range.startOffset : 0;
	const to = chunk.node === range.endContainer ? range.endOffset : length;
	return to > from;
}

export function captureSelection(viewport: Element, selection: Selection | null): CapturedSelection | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
	const range = selection.getRangeAt(0).cloneRange();
	const startElement = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
	// El inicio decide el origen, como en T3; una selección que empieza fuera de
	// cualquier mensaje (p. ej. un triple clic desde la fila de arriba) se resuelve
	// en cambio por su primer texto seleccionado.
	let source = startElement?.closest(`[${SOURCE_ATTRIBUTE}]`) ?? null;
	if (!source) {
		source = Array.from(viewport.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`)).find((element) => range.intersectsNode(element)) ?? null;
	}
	if (!source || !viewport.contains(source)) return null;
	const messageId = source.getAttribute(SOURCE_ATTRIBUTE);
	// Los mensajes vivos (aún en streaming) llevan ids c_ que se sustituyen al persistir.
	if (!messageId || messageId.startsWith("c_")) return null;
	const { text, chunks } = readSourceText(sourceElements(viewport, messageId));
	const selected = chunks.filter((chunk) => selectableSlice(chunk, range));
	const first = selected[0];
	const last = selected.at(-1);
	if (!first || !last) return null;
	// El final no debe salir de este mensaje (a otro mensaje o a la página).
	const endElement = range.endContainer.nodeType === 1 ? (range.endContainer as Element) : range.endContainer.parentElement;
	const endSource = endElement?.closest(`[${SOURCE_ATTRIBUTE}]`);
	if (endSource && endSource.getAttribute(SOURCE_ATTRIBUTE) !== messageId) return null;
	const start: BoundaryPoint = first.node === range.startContainer ? { node: first.node, offset: range.startOffset } : { node: first.node, offset: 0 };
	const end: BoundaryPoint = last.node === range.endContainer ? { node: last.node, offset: range.endOffset } : { node: last.node, offset: last.end - last.start };
	const selector = selectorFromBoundaries(text, chunks, start, end);
	if (!selector) return null;
	const tight = range.cloneRange();
	if (first.atomic) tight.setStartBefore(first.node); else tight.setStart(start.node, start.offset);
	if (last.atomic) tight.setEndAfter(last.node); else tight.setEnd(end.node, end.offset);
	return { messageId, range: tight, selector };
}

/** Vuelve a encontrar una cita en la transcripción viva; null si ha desaparecido o es ambigua. */
export function resolveCitationRange(viewport: Element, messageId: string, selector: TextSelector): Range | null {
	const sources = sourceElements(viewport, messageId);
	if (sources.length === 0) return null;
	const { text, chunks } = readSourceText(sources);
	const raw = rawRangeFor(text, selector);
	if (!raw) return null;
	const start = chunkPoint(chunks, raw.start, "start");
	const end = chunkPoint(chunks, raw.end, "end");
	if (!start || !end) return null;
	const range = viewport.ownerDocument.createRange();
	if (start.atomic) range.setStartBefore(start.atomic); else range.setStart(start.node, start.offset);
	if (end.atomic) range.setEndAfter(end.atomic); else range.setEnd(end.node, end.offset);
	return range;
}
