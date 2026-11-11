import { parseComposerTokens, quoteFilePath, type ComposerToken } from "@/src/core";

/** Los tokens guardan su origen completo, no su etiqueta visual abreviada.
 *  Ambos tipos de token (rutas de fichero, citas del tutor) usan este único atributo. */
export const PATH_SOURCE_ATTRIBUTE = "data-file-path-source";
/** Un chip atómico: una ruta de fichero entre comillas o un enlace de cita del tutor. */
export type ChipToken = Exclude<ComposerToken, { kind: "text" }>;
export type ChipHost = { host: HTMLElement; token: ChipToken };
/** Caja de línea solo de presentación para el cursor tras un salto de línea final del modelo. */
export const PATH_CARET_ATTRIBUTE = "data-file-path-caret";
export type TextSelection = { anchor: number; focus: number };
export type DOMPoint = { node: Node; offset: number };
type Segment = { text: string; start: DOMPoint; end: DOMPoint; node?: Text; token?: Element };

function childIndex(node: Node): number {
	return Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
}

/** La edición del navegador puede dejar nodos BR/de bloque; nunca uses innerText (depende del layout/espacios). */
function segments(root: HTMLElement): Segment[] {
	const result: Segment[] = [];
	function walk(node: Node) {
		if (node.nodeType === 3) {
			const text = node as Text;
			result.push({ text: text.data, start: { node, offset: 0 }, end: { node, offset: text.length }, node: text });
			return;
		}
		if (node.nodeType !== 1) return;
		const element = node as Element;
		if (element.hasAttribute(PATH_CARET_ATTRIBUTE)) return;
		const raw = element.getAttribute(PATH_SOURCE_ATTRIBUTE);
		if (raw !== null) {
			const index = childIndex(node);
			result.push({ text: raw, start: { node: node.parentNode!, offset: index }, end: { node: node.parentNode!, offset: index + 1 }, token: element });
			return;
		}
		if (element.tagName === "BR") {
			// Un BR solitario de Chromium es un provisional de editor/párrafo vacío.
			if (node.parentNode?.childNodes.length === 1) return;
			const index = childIndex(node);
			result.push({ text: "\n", start: { node: node.parentNode!, offset: index }, end: { node: node.parentNode!, offset: index + 1 } });
			return;
		}
		Array.from(node.childNodes).forEach((child, index) => {
			const block = child.nodeType === 1 && /^(DIV|P)$/.test((child as Element).tagName);
			const previous = node.childNodes[index - 1];
			const previousBlock = previous?.nodeType === 1 && /^(DIV|P)$/.test((previous as Element).tagName);
			if (index > 0 && (block || previousBlock)) {
				result.push({ text: "\n", start: { node, offset: index }, end: { node, offset: index } });
			}
			walk(child);
		});
	}
	walk(root);
	return result;
}

export function readPathInput(root: HTMLElement): string {
	return segments(root).map((part) => part.text).join("");
}

/** Traduce un desplazamiento lógico UTF-16 a un límite del DOM, ajustando de forma atómica el interior de un chip. */
export function pathInputPoint(root: HTMLElement, offset: number): DOMPoint {
	const parts = segments(root);
	const trailing = root.lastChild;
	if (trailing?.nodeType === 1 && (trailing as Element).hasAttribute(PATH_CARET_ATTRIBUTE)
		&& offset >= parts.reduce((length, part) => length + part.text.length, 0)) {
		// Un extremo en un nodo de texto tras su salto de línea final no tiene caja de línea en Chromium.
		// El límite justo antes de este BR está en la última línea visible.
		return { node: root, offset: childIndex(trailing) };
	}
	let remaining = Math.max(0, offset);
	for (const part of parts) {
		if (remaining <= part.text.length) {
			if (part.node) return { node: part.node, offset: remaining };
			return remaining <= part.text.length / 2 ? part.start : part.end;
		}
		remaining -= part.text.length;
	}
	return { node: root, offset: root.childNodes.length };
}

/** Funciona sin Range: útil en entornos de prueba del DOM además de con una Selection real. */
export function pathInputOffset(root: HTMLElement, node: Node, offset: number): number | null {
	if (node !== root && !root.contains(node)) return null;
	let total = 0;
	for (const part of segments(root)) {
		if (part.node === node) return total + Math.min(Math.max(0, offset), part.text.length);
		if (part.token?.contains(node)) {
			// Una selección con el ratón o programática puede acabar dentro de una etiqueta no editable.
			// Conserva extremos interiores distintos para que atomicPathRange amplíe copiar/cortar
			// al origen completo en vez de filtrar el nombre de fichero abreviado.
			let visualOffset = node.nodeType === 3 ? offset : Array.from(node.childNodes).slice(0, offset).reduce((length, child) => length + (child.textContent?.length ?? 0), 0);
			let cursor = node;
			while (cursor !== part.token) {
				let sibling = cursor.previousSibling;
				while (sibling) { visualOffset += sibling.textContent?.length ?? 0; sibling = sibling.previousSibling; }
				cursor = cursor.parentNode!;
			}
			const visualLength = part.token.textContent?.length ?? 0;
			return total + (visualLength ? Math.round(Math.min(visualLength, visualOffset) / visualLength * part.text.length) : 0);
		}
		if (part.start.node === node && part.start.offset >= offset) return total;
		if (part.end.node === node && part.end.offset <= offset) {
			total += part.text.length;
			continue;
		}
		// Un límite en un ancestro está antes/después de todo segmento descendiente.
		let ancestor: Node = part.node ?? part.token ?? part.start.node;
		while (ancestor.parentNode && ancestor.parentNode !== node) ancestor = ancestor.parentNode;
		if (ancestor.parentNode === node && childIndex(ancestor) >= offset) return total;
		total += part.text.length;
	}
	return total;
}

/** Valida un StaticRange de beforeinput del navegador antes de proyectar sus extremos exactos. */
export function pathInputStaticRange(root: HTMLElement, range: Pick<StaticRange, "startContainer" | "startOffset" | "endContainer" | "endOffset">): TextSelection | null {
	function valid(node: Node, offset: number) {
		return (node === root || root.contains(node)) && Number.isInteger(offset) && offset >= 0
			&& offset <= (node.nodeType === 3 ? (node as Text).length : node.childNodes.length);
	}
	if (!valid(range.startContainer, range.startOffset) || !valid(range.endContainer, range.endOffset)) return null;
	const anchor = pathInputOffset(root, range.startContainer, range.startOffset);
	const focus = pathInputOffset(root, range.endContainer, range.endOffset);
	return anchor === null || focus === null || anchor >= focus ? null : { anchor, focus };
}

export function readPathSelection(root: HTMLElement): TextSelection | null {
	const selection = root.ownerDocument.getSelection?.();
	if (!selection?.anchorNode || !selection.focusNode) return null;
	const anchor = pathInputOffset(root, selection.anchorNode, selection.anchorOffset);
	const focus = pathInputOffset(root, selection.focusNode, selection.focusOffset);
	return anchor === null || focus === null ? null : { anchor, focus };
}

export function restorePathSelection(root: HTMLElement, selection: TextSelection): void {
	const browserSelection = root.ownerDocument.getSelection?.();
	if (!browserSelection) return;
	const anchor = pathInputPoint(root, selection.anchor);
	const focus = pathInputPoint(root, selection.focus);
	browserSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

/** Devuelve hosts de portal. React solo es dueño de su contenido visual, nunca del árbol editable. */
export function renderPathInput(root: HTMLElement, value: string): ChipHost[] {
	const document = root.ownerDocument;
	const fragment = document.createDocumentFragment();
	const chips: ChipHost[] = [];
	for (const part of parseComposerTokens(value)) {
		if (part.kind === "text") {
			fragment.append(document.createTextNode(part.text));
		} else {
			const host = document.createElement("span");
			host.contentEditable = "false";
			host.setAttribute("contenteditable", "false");
			host.setAttribute(PATH_SOURCE_ATTRIBUTE, part.text);
			fragment.append(host);
			chips.push({ host, token: part });
		}
	}
	// Los nodos de texto de límite vacíos permiten un cursor justo antes/después de un chip atómico.
	if (!fragment.firstChild || fragment.firstChild.nodeType !== 3) fragment.prepend(document.createTextNode(""));
	if (fragment.lastChild?.nodeType !== 3) fragment.append(document.createTextNode(""));
	if (value.endsWith("\n")) {
		// pre-wrap por sí solo colapsa la última línea vacía. Este BR le da su
		// altura/cursor sin añadir un segundo salto de línea al origen guardado.
		const caret = document.createElement("br");
		caret.setAttribute(PATH_CARET_ATTRIBUTE, "");
		caret.setAttribute("aria-hidden", "true");
		fragment.append(caret);
	}
	root.replaceChildren(fragment);
	root.dataset.empty = value.length === 0 ? "true" : "false";
	return chips;
}

export function clampPathSelection(value: string, selection: TextSelection): TextSelection {
	const clamp = (offset: number) => Math.min(value.length, Math.max(0, offset));
	return { anchor: clamp(selection.anchor), focus: clamp(selection.focus) };
}

/** Una selección que corta cualquier parte de un chip edita/copia ese origen completo. */
export function atomicPathRange(value: string, selection: TextSelection): { start: number; end: number } {
	const clamped = clampPathSelection(value, selection);
	let start = Math.min(clamped.anchor, clamped.focus);
	let end = Math.max(clamped.anchor, clamped.focus);
	for (const part of parseComposerTokens(value)) {
		if (part.kind === "text") continue;
		if (start > part.start && start < part.end) start = part.start;
		if (end > part.start && end < part.end) end = part.end;
	}
	return { start, end };
}

export function replacePathSelection(value: string, selection: TextSelection, text: string) {
	const { start, end } = atomicPathRange(value, selection);
	return { value: value.slice(0, start) + text + value.slice(end), selection: { anchor: start + text.length, focus: start + text.length } };
}

export function insertFilePaths(value: string, selection: TextSelection, paths: string[]) {
	const { start, end } = atomicPathRange(value, selection);
	const text = paths.map(quoteFilePath).join(" ");
	if (!text) return { value, selection };
	const before = start > 0 && !/\s/.test(value[start - 1]!) ? " " : "";
	const after = end < value.length && !/\s/.test(value[end]!) ? " " : "";
	return replacePathSelection(value, selection, before + text + after);
}

/** Inserta un enlace de cita en el rango guardado: un espacio separador
 *  delante cuando hace falta, y un espacio detrás que sustituye a uno existente. */
export function insertCitation(value: string, selection: TextSelection, link: string) {
	const { start, end: rangeEnd } = atomicPathRange(value, selection);
	const spaceBefore = start > 0 && !/\s/.test(value[start - 1]!);
	const swallow = value[rangeEnd] === " ";
	const end = swallow ? rangeEnd + 1 : rangeEnd;
	const next = replacePathSelection(value, { anchor: start, focus: end }, `${spaceBefore ? " " : ""}${link} `);
	const linkStart = start + (spaceBefore ? 1 : 0);
	return { ...next, inserted: { start: linkStart, end: linkStart + link.length, spaceBefore, spaceAfter: !swallow } };
}

/** Dónde está ahora un enlace de cita: sus desplazamientos registrados si
 *  siguen conteniendo el mismo origen; si no, su única aparición; null si ha desaparecido o es ambiguo. */
export function locateToken(value: string, start: number, source: string): { start: number; end: number } | null {
	if (value.slice(start, start + source.length) === source) return { start, end: start + source.length };
	const first = value.indexOf(source);
	if (first === -1 || value.indexOf(source, first + 1) !== -1) return null;
	return { start: first, end: first + source.length };
}

export function adjacentPathRange(value: string, selection: TextSelection, direction: "backward" | "forward"): TextSelection | null {
	if (selection.anchor !== selection.focus) return selection;
	const caret = selection.focus;
	for (const part of parseComposerTokens(value)) {
		if (part.kind !== "text" && (direction === "backward" ? caret > part.start && caret <= part.end : caret >= part.start && caret < part.end)) {
			return { anchor: part.start, focus: part.end };
		}
	}
	return null;
}

export type PathEditSnapshot = { value: string; selection: TextSelection };

/** Reproduce el algoritmo de saneado de valores de los input de texto: quita CR/LF, no los espacios. */
export function normalizePathInputValue(value: string, singleLine: boolean): string {
	return singleLine ? value.replace(/[\r\n]/g, "") : value;
}

export function normalizePathEdit(snapshot: PathEditSnapshot, singleLine: boolean): PathEditSnapshot {
	if (!singleLine) return snapshot;
	const selection = clampPathSelection(snapshot.value, snapshot.selection);
	return {
		value: normalizePathInputValue(snapshot.value, true),
		selection: {
			anchor: normalizePathInputValue(snapshot.value.slice(0, selection.anchor), true).length,
			focus: normalizePathInputValue(snapshot.value.slice(0, selection.focus), true).length,
		},
	};
}

/** Independiente de la pila de deshacer del DOM del navegador (la normalización sustituye nodos nativos). */
export class PathInputHistory {
	private undoStack: PathEditSnapshot[] = [];
	private redoStack: PathEditSnapshot[] = [];
	push(snapshot: PathEditSnapshot) {
		this.undoStack.push({ value: snapshot.value, selection: { ...snapshot.selection } });
		this.redoStack = [];
	}
	reset() { this.undoStack = []; this.redoStack = []; }
	undo(current: PathEditSnapshot): PathEditSnapshot | null {
		const previous = this.undoStack.pop();
		if (!previous) return null;
		this.redoStack.push(current);
		return previous;
	}
	redo(current: PathEditSnapshot): PathEditSnapshot | null {
		const next = this.redoStack.pop();
		if (!next) return null;
		this.undoStack.push(current);
		return next;
	}
}
