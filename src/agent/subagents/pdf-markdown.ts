import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * PDF → Markdown por reglas, sin modelo: las posiciones del texto y los tamaños de fuente de pdfjs se
 * convierten en encabezados, texto separado en líneas y listas. Sirve a la importación de notas (cuyo
 * fragmentador divide luego el Markdown) y a las herramientas del pdf-reader. Se conservan las líneas,
 * las palabras y el texto repetido de los márgenes tal como se extraen: el modelo interpreta la fuente,
 * en lugar de depender aquí de borrados o de reconstruir líneas partidas.
 */

export type PdfPage =
	| { kind: "text"; number: number; markdown: string }
	| { kind: "image-only"; number: number }
	| { kind: "empty"; number: number };

type TextContentItem = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number];

interface Glyph {
	str: string;
	rtl: boolean;
	x: number;
	y: number;
	size: number;
	width: number;
	rotated: boolean;
	hasEOL: boolean;
}

interface Line {
	text: string;
	rotated: boolean;
	size: number;
	y: number;
	x0: number;
}

interface PageScan {
	page: PDFPageProxy;
	lines: Line[];
}

type Block =
	| { type: "heading"; level: 1 | 2 | 3; text: string }
	| { type: "item"; depth: number; y: number; text: string }
	| { type: "paragraph"; text: string };

const BULLET = /^\s*[\u2022\u25CF\u25AA\u2013\u2014\uF0B7-]\s+/;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;
// Solo formas de presentación árabes y ligaduras latinas: un NFKC sobre todo el texto también convertiría x² en x2.
const COMPAT = /[\uFB00-\uFB06\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
const MAX_HEADING_CHARS = 150;

// Los bytes de control (NUL de emojis y glifos matemáticos extensibles) no llevan texto; el tabulador y el salto de línea ya son espacio.
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const clean = (s: string) => s.replace(COMPAT, (m) => m.normalize("NFKC")).replace(PRIVATE_USE, "").replace(CONTROL, "");
const roundSize = (l: Line) => Math.round(l.size * 10) / 10;
// Un encabezado es casi todo letras; las etiquetas de figuras ("∑=") y los dígitos de gráficos o zonas ("2 2/3 43") no lo son.
const mostlyLetters = (s: string) => (s.match(/\p{L}/gu) ?? []).length >= s.replace(/\s/g, "").length / 2;

function toGlyph(item: TextContentItem): Glyph | null {
	if (!("str" in item)) return null;
	const [a, b, c, d, x, y] = item.transform.map(Number);
	return {
		str: item.str,
		rtl: item.dir === "rtl",
		x: x ?? 0,
		y: y ?? 0,
		size: Math.hypot(a ?? 0, b ?? 0),
		width: item.width,
		rotated: Math.abs(b ?? 0) > 0.01 || Math.abs(c ?? 0) > 0.01,
		hasEOL: item.hasEOL,
	};
}

function toLine(glyphs: Glyph[]): Line | null {
	const visible = glyphs.filter((g) => g.str.trim());
	const first = visible[0];
	if (!first) return null;
	const rtl = glyphs.filter((g) => g.str && g.rtl).length > glyphs.filter((g) => g.str).length / 2;
	// pdfjs emite las palabras de derecha a izquierda en orden visual: se leen al revés, de derecha a izquierda.
	const ordered = rtl ? [...glyphs].sort((p, q) => q.x - p.x) : glyphs;
	let joined = "";
	let prevEnd: number | null = null;
	for (const g of ordered) {
		// Las casillas separadas de un formulario se tocan en el flujo sin ningún elemento de espacio: se añade uno si hay un hueco visible,
		// o cuando el texto salta hacia la izquierda ("2025" y luego "U.S." en un formulario, "Hours" y luego la línea de la columna siguiente).
		const size = g.size || 1;
		const apart = prevEnd !== null && (g.x - prevEnd > size * 0.25 || g.x < prevEnd - size * 2);
		if (!rtl && apart && g.str && !/\s$/.test(joined) && !/^\s/.test(g.str)) joined += " ";
		joined += g.str;
		if (g.str) prevEnd = g.x + g.width;
	}
	const text = clean(joined).replace(/\s+/g, " ").trim();
	if (!text) return null;
	return {
		text,
		rotated: visible.some((g) => g.rotated),
		size: Math.max(...visible.map((g) => g.size)),
		y: first.y,
		x0: Math.min(...visible.map((g) => g.x)),
	};
}

const visible = (line: readonly Glyph[]) => line.filter((g) => g.str.trim() && !g.rotated && !g.rtl).sort((p, q) => p.x - q.x);

/** Huecos de al menos un tamaño de fuente entre glifos vecinos de una misma línea. */
function gapsIn(line: readonly Glyph[]): { lo: number; hi: number; y: number; size: number }[] {
	const v = visible(line);
	return v.slice(1).flatMap((g, k) => {
		const lo = v[k]!.x + v[k]!.width;
		return g.x - lo >= Math.max(g.size, 6) ? [{ lo, hi: g.x, y: g.y, size: g.size }] : [];
	});
}

/** Un lado de un canal se lee como una columna de prosa: sin huecos de celda dentro (las mitades de una
 * tabla sí los tienen), trozos de 15 o más caracteres y palabras sobre todo en minúscula (las celdas de
 * una tabla son códigos y números: "SDA0 SA5 PCLK"). */
function isProseColumn(halves: readonly Glyph[][]): boolean {
	if (halves.filter((half) => gapsIn(half).length > 0).length > halves.length * 0.3) return false;
	const texts = halves.map((half) => visible(half).map((g) => g.str).join(" ").trim());
	const lengths = texts.map((t) => t.length).sort((a, b) => a - b);
	const words = texts.join(" ").split(/\s+/).filter(Boolean);
	const lowercase = words.filter((w) => /\p{Ll}/u.test(w)).length;
	return (lengths[Math.floor(lengths.length / 2)] ?? 0) >= 15 && lowercase >= words.length / 2;
}

/** Dos columnas de prosa que comparten líneas base nos llegan pegadas, una línea de pdfjs por línea base
 * ("generating" y luego "• Direct Replacement"). Un canal es una franja vertical vacía que al menos 5
 * líneas cruzan de un salto; solo se divide ahí si los dos lados se leen como prosa, y entonces se emite
 * toda la columna izquierda antes que la derecha. */
function splitColumns(lines: Glyph[][]): Glyph[][] {
	const gaps = lines.flatMap((line, index) => gapsIn(line).map((gap) => ({ ...gap, index })));
	for (const seed of gaps) {
		let [lo, hi] = [seed.lo, seed.hi];
		const members = new Set<number>();
		const ys: number[] = [];
		for (const gap of gaps) {
			const [nlo, nhi] = [Math.max(lo, gap.lo), Math.min(hi, gap.hi)];
			if (nhi - nlo < seed.size * 0.5) continue;
			[lo, hi] = [nlo, nhi];
			members.add(gap.index);
			ys.push(gap.y);
		}
		if (members.size < 5) continue;
		const [top, bottom] = [Math.max(...ys) + seed.size, Math.min(...ys) - seed.size];
		const region = lines.flatMap((line, i) => (visible(line).some((g) => g.y <= top && g.y >= bottom) ? [i] : []));
		if (region.some((i) => visible(lines[i]!).some((g) => g.x < hi - 1 && g.x + g.width > lo + 1))) continue;
		const mid = (lo + hi) / 2;
		const half = (line: Glyph[], left: boolean) => line.filter((g) => (g.x + g.width / 2 < mid) === left);
		if (![true, false].every((left) => isProseColumn([...members].map((i) => half(lines[i]!, left))))) continue;
		const column = (left: boolean) => region.map((i) => half(lines[i]!, left)).filter((l) => l.some((g) => g.str.trim()));
		const outside = (keep: (i: number) => boolean) => lines.filter((_, i) => !region.includes(i) && keep(i));
		const first = region[0]!;
		return splitColumns([...outside((i) => i < first), ...column(true), ...column(false), ...outside((i) => i > first)]);
	}
	return lines;
}

async function scanPage(page: PDFPageProxy, signal?: AbortSignal): Promise<PageScan> {
	signal?.throwIfAborted();
	const content = await page.getTextContent();
	signal?.throwIfAborted();
	const glyphs = content.items.flatMap((item) => toGlyph(item) ?? []);
	const groups: Glyph[][] = [[]];
	for (const glyph of glyphs) {
		groups.at(-1)!.push(glyph);
		if (glyph.hasEOL) groups.push([]);
	}
	const lines = splitColumns(groups).flatMap((group) => toLine(group) ?? []);
	return { page, lines };
}

/** Si una página sin texto dibuja una imagen. Solo se pregunta por esas páginas: construir la lista de
 * operadores suponía dos tercios del tiempo de conversión cuando todas las páginas lo pagaban. */
async function drawsImage(page: PDFPageProxy, signal?: AbortSignal): Promise<boolean> {
	signal?.throwIfAborted();
	const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	signal?.throwIfAborted();
	const imageOps = new Set([
		OPS.paintImageXObject,
		OPS.paintImageXObjectRepeat,
		OPS.paintInlineImageXObject,
		OPS.paintInlineImageXObjectGroup,
		OPS.paintImageMaskXObject,
		OPS.paintImageMaskXObjectGroup,
		OPS.paintImageMaskXObjectRepeat,
		OPS.paintSolidColorImageMask,
	]);
	const operators = await page.getOperatorList();
	signal?.throwIfAborted();
	return operators.fnArray.some((op) => imageOps.has(op));
}

/** Tamaño del cuerpo: el tamaño en puntos enteros que cubre más caracteres. Puntos enteros, porque el
 * texto justificado oscila entre 9,8 y 10,2 pt; el texto girado (sellos de margen de arXiv) nunca cuenta. */
function bodySize(lines: readonly Line[]): number {
	const chars = new Map<number, number>();
	for (const l of lines) if (!l.rotated) chars.set(Math.round(l.size), (chars.get(Math.round(l.size)) ?? 0) + l.text.length);
	let best = 0;
	let most = -1;
	for (const [size, n] of chars) if (n > most) [best, most] = [size, n];
	return best;
}

/** Las apps de diapositivas escriben los cuadros de texto en orden z (Keynote escribe el título el
 * último), pero el orden del flujo es el correcto para los artículos, cuyas columnas y cuadrículas de
 * autores se desordenan al ordenar de arriba abajo. Así que solo un título que quede claramente por
 * encima de todo lo demás, junto con sus líneas partidas, vuelve al principio. */
function titleFirst(lines: Line[], body: number): Line[] {
	const [top, next] = lines.filter((l) => !l.rotated).sort((p, q) => q.y - p.y);
	if (!top || !next) return lines;
	const i = lines.indexOf(top);
	if (i <= 0 || top.size < body + 1.95 || top.y - next.y < top.size * 0.8) return lines;
	let j = i + 1;
	while (j < lines.length && Math.abs(lines[j]!.size - top.size) < 0.5 && lines[j - 1]!.y - lines[j]!.y < top.size * 1.8) j++;
	return [...lines.slice(i, j), ...lines.slice(0, i), ...lines.slice(j)];
}

function toBlocks(lines: readonly Line[], body: number): Block[] {
	// Niveles por tamaño respecto al cuerpo de la página: clasificar todos los tamaños falla en las diapositivas, donde una etiqueta de figura de 72 pt se lleva el nivel 1.
	const levelOf = (l: Line): 0 | 1 | 2 | 3 => {
		if (l.rotated || BULLET.test(l.text) || roundSize(l) < body + 1.95 || !mostlyLetters(l.text)) return 0;
		return l.size >= body * 1.6 ? 1 : l.size >= body * 1.3 ? 2 : 3;
	};
	const blocks: Block[] = [];
	const listXs: number[] = []; // x de cada nivel de lista abierto
	for (const l of lines) {
		const level = levelOf(l);
		const indent = l.size * 0.3;
		const bullet = BULLET.test(l.text);
		if (level) {
			blocks.push({ type: "heading", level, text: l.text });
		} else if (bullet) {
			// Una viñeta más arriba en la página que la anterior empieza una nueva columna de lista contigua.
			const lastItem = blocks.findLast((b) => b.type === "item");
			if (lastItem && l.y > lastItem.y + indent) listXs.length = 0;
			while (listXs.length && l.x0 < listXs.at(-1)! - indent) listXs.pop();
			if (!listXs.length || l.x0 > listXs.at(-1)! + indent) listXs.push(l.x0);
			blocks.push({ type: "item", depth: listXs.length - 1, y: l.y, text: l.text.replace(BULLET, "") });
		} else {
			blocks.push({ type: "paragraph", text: l.text });
		}
	}
	return blocks;
}

function toMarkdown(blocks: readonly Block[]): string {
	// El texto del cuerpo que empieza por "#" ("# of pixels") no debe leerse como encabezado.
	const plain = (s: string) => s.replace(/^#/, "\\#");
	return blocks
		.map((b, i) => {
			switch (b.type) {
				case "heading":
					return b.text.length <= MAX_HEADING_CHARS ? `${"#".repeat(b.level)} ${b.text}` : plain(b.text);
				case "item":
					return `${"  ".repeat(b.depth)}- ${plain(b.text)}${blocks[i + 1]?.type === "item" ? "\n" : ""}`;
				case "paragraph":
					return plain(b.text);
			}
		})
		.join("\n\n")
		.replace(/\n\n\n/g, "\n");
}

/** Convierte las páginas indicadas (por defecto, todas). El formato es local a cada página, para que la
 * búsqueda y las lecturas seleccionadas coincidan. La cancelación se comprueba alrededor del trabajo
 * asíncrono por página, no durante el trabajo síncrono de pdfjs o de formato. */
export async function documentToMarkdown(doc: PDFDocumentProxy, pageNumbers?: readonly number[], signal?: AbortSignal): Promise<PdfPage[]> {
	signal?.throwIfAborted();
	const numbers = pageNumbers ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
	const pages: PageScan[] = [];
	for (const n of numbers) {
		signal?.throwIfAborted();
		const page = await doc.getPage(n);
		signal?.throwIfAborted();
		pages.push(await scanPage(page, signal));
	}
	const out: PdfPage[] = [];
	for (const p of pages) {
		signal?.throwIfAborted();
		const number = p.page.pageNumber;
		if (!p.lines.length) {
			out.push({ kind: (await drawsImage(p.page, signal)) ? "image-only" : "empty", number });
			continue;
		}
		// Se juzga el cuerpo por debajo del tamaño mayor de la página (a menudo su título),
		// recurriendo al tamaño dominante de la página si el texto es uniforme. Nunca depende
		// de qué otras páginas se pidieron: eso cambiaría el orden de los títulos y las líneas de búsqueda.
		const top = Math.max(...p.lines.map(roundSize));
		const body = bodySize(p.lines.filter((l) => roundSize(l) < top)) || bodySize(p.lines);
		out.push({ kind: "text", number, markdown: toMarkdown(toBlocks(titleFirst(p.lines, body), body)) });
	}
	signal?.throwIfAborted();
	return out;
}

/** Las páginas que tienen texto, cada una bajo un marcador `--- Page N ---` (el formato existente del pdf-reader). */
export function joinPages(pages: readonly PdfPage[]): string {
	return pages.flatMap((p) => (p.kind === "text" ? [`--- Page ${p.number} ---\n\n${p.markdown}`] : [])).join("\n\n");
}
