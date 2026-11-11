/** Límites Markdown/TeX compartidos para la compatibilidad con delimitadores
 * heredados y la recuperación de contenido de herramientas solo para mostrar.
 * Los argumentos fuente nunca se reescriben. */
import {
	canParseTex, knownTexCommand, mapMathContent, numericPercentEscape, outsideTexComments,
	readContentSpans, recoverDocumentLayout, texRanges,
} from "./content-reader.ts";

const escaped = (text: string, i: number) => {
	let n = 0; while (i > 0 && text[--i] === "\\") n++;
	return n % 2 === 1;
};

/** Conserva la política heredada de continuación de listas: las fórmulas en
 * bloque sangradas se degradan a fórmulas en línea en lugar de romper la
 * estructura de la lista. La sangría literal del código ya la protege el
 * lector compartido. */
function indented(text: string, i: number): boolean {
	const prefix = text.slice(text.lastIndexOf("\n", i - 1) + 1, i);
	return prefix.length > 0 && /^[ \t]+$/.test(prefix);
}
function blockPosition(text: string, i: number): boolean {
	return /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i));
}

/** micromark también cierra los fragmentos nativos de un solo dólar en los
 * dólares escapados. Sustituye un dólar literal intencionado por TeX
 * equivalente sin dólares antes de tokenizar. El código, la prosa, los
 * fragmentos desequilibrados y los dólares de bloque se quedan tal cual. */
function replaceEscapedDollars(content: string): string {
	let out = "";
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\\" && content[i + 1] === "$" && !escaped(content, i)) {
			out += "\\text{\\textdollar}"; i++;
		} else out += content[i];
	}
	return out;
}

/** Lee la sintaxis antigua \(...\)/\[...\] sin tocar el contenido literal ni
 * volver a analizar como Markdown las fórmulas nativas. La escritura con
 * dólares sigue siendo nativa. */
export function transformMathDelimiters(markdown: string): string {
	let offset = 0;
	return readContentSpans(markdown).map(span => {
		const start = offset; offset += span.raw.length;
		if (span.kind !== "math") return span.raw;
		if (span.open === "$") return "$" + replaceEscapedDollars(span.body) + span.close;
		if (span.open !== "\\(" && span.open !== "\\[") return span.raw;
		const body = span.body.trim();
		if (!body) return span.raw;
		if (span.open === "\\(") return `$$${body}$$`;
		if (indented(markdown, start)) return `$$${body.replace(/\s*\n\s*/g, " ")}$$`;
		const before = blockPosition(markdown, start) ? "" : "\n\n";
		const end = start + span.raw.length;
		const after = end === markdown.length || markdown[end] === "\n" ? "" : "\n\n";
		return `${before}$$\n${body}\n$$${after}`;
	}).join("");
}

const DEBRIS: Record<string, string> = {
	"\b": "\\b", "\t": "\\t", "\v": "\\v", "\f": "\\f", "\r": "\\r",
};

/** Recupera los prefijos de comando que se tragó el JSON solo en fórmulas
 * reconocidas, nunca en código ni en comentarios TeX genuinos. Restaura todos
 * los restos en una sola pasada. Los saltos de línea físicos de bloque y los
 * CRLF siguen siendo espacio en blanco del código fuente. La recuperación de
 * LF en línea se limita a nombres completos conocidos de comandos que
 * empiezan por n. Bajo la política aprobada de escritura típica del modelo,
 * esto incluye salto de línea+u→nu solo en fórmulas en línea; los comandos ya
 * correctos nunca se decodifican como espacio en blanco. */
export function restoreMathEscapes(text: string): string {
	if (!/[\b\t\n\v\f\r]/.test(text)) return text;
	return mapMathContent(text, (body, display) => outsideTexComments(body, part => {
		const restored = part.replace(/[\b\t\v\f\r]/g, (char, offset: number) => {
			if (char === "\r" && part[offset + 1] === "\n") return char;
			const suffix = /^[A-Za-z]+/.exec(part.slice(offset + 1))?.[0];
			return suffix && knownTexCommand(DEBRIS[char]!.slice(1) + suffix) ? DEBRIS[char]! : char;
		});
		if (display) return restored;
		return restored.replace(/\n([A-Za-z]+)/g, (whole, suffix: string) =>
			knownTexCommand("n" + suffix) ? "\\n" + suffix : whole);
	}));
}

const commandSymbol = /[,;:!|{}%]/;

/** Decodifica prefijos y separadores de fila según el contexto TeX ORIGINAL.
 * Un par nativo es literal; un par codificado aporta un factor, así que una
 * fila codificada con cuatro barras invertidas pasa a DOS, nunca a un prefijo
 * de comando. Los comandos desconocidos sin esa prueba estructural se dejan
 * en paz. */
function recoverCommandRuns(inner: string, display: boolean): string {
	const ranges = texRanges(inner);
	const recovered = inner.replace(/\\+/g, (run: string, offset: number) => {
		const contexts = ranges.filter(r => offset >= r.start && offset < r.end);
		if (contexts.some(r => r.kind === "row" || r.kind === "comment") || run.length % 2 !== 0) return run;
		const next = inner[offset + run.length] ?? "";
		const encoded = contexts.filter(r => r.kind === "encoded").at(-1);
		const word = /^[A-Za-z]+/.exec(inner.slice(offset + run.length))?.[0];
		if (encoded) {
			const factor = encoded.factor!;
			const rows = run.length % (2 * factor) === 0;
			const command = word ? knownTexCommand(word) : commandSymbol.test(next);
			if (run.length % factor === 0 && (rows || command)) return "\\".repeat(run.length / factor);
			return run;
		}
		if (next === "%") return numericPercentEscape(inner, offset + run.length) ? "\\" : run;
		if (word) return word.length > 1 && knownTexCommand(word) ? "\\" : run;
		return next && commandSymbol.test(next) ? "\\" : run;
	});
	// La prueba estructural es lo principal (que el análisis salga bien no demuestra que
	// se conserven las filas). Como protección adicional, nunca convierte un código
	// analizable en un fallo de análisis por una recuperación parcial de comandos.
	if (recovered !== inner && !canParseTex(recovered, display) && canParseTex(inner, display)) return inner;
	return recovered;
}

export function healOverescapedCommands(text: string): string {
	return text.includes("\\\\") ? mapMathContent(text, recoverCommandRuns) : text;
}

/** Recuperación solo de presentación e independiente del idioma. El análisis
 * de forma, las identidades guardadas, la calificación y el historial del
 * modelo deben usar el código fuente sin proyectar. */
export function repairMathForDisplay(text: string): string {
	return healOverescapedCommands(restoreMathEscapes(recoverDocumentLayout(text)));
}
