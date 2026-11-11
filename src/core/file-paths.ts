/** Una proyección sin pérdidas del texto plano del alumno, no un analizador de Markdown. */
export type FilePathPart =
	| { kind: "text"; text: string; start: number; end: number }
	| { kind: "path"; text: string; path: string; start: number; end: number };

// Sin acceso al sistema de ficheros ni normalización: hasta la puntuación y las barras
// invertidas pueden ser caracteres legítimos de nombre POSIX. Solo se exige sintaxis con raíz.
function isFilePath(path: string): boolean {
	if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(path)) return false;
	return path.startsWith("/")
		|| path.startsWith("~/")
		|| /^[a-z]:[\\/]/i.test(path)
		|| /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(path);
}

/**
 * Envuelve una ruta con raíz para guardarla/transmitirla como texto ordinario
 * y sin pérdidas. El relleno de un espacio de CommonMark evita que las
 * comillas invertidas de los bordes se unan a los delimitadores.
 */
export function quoteFilePath(path: string): string {
	if (!isFilePath(path)) throw new TypeError("Expected a single-line rooted file path");
	let width = 1;
	for (const run of path.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1);
	const delimiter = "`".repeat(width);
	const padding = path.startsWith("`") || path.endsWith("`") ? " " : "";
	return `${delimiter}${padding}${path}${padding}${delimiter}`;
}

/**
 * Reconoce toda ruta con raíz completa envuelta en comillas invertidas,
 * aunque esté junto a palabras. Los delimitadores son series enteras de
 * exactamente la misma longitud; una serie dentro de otro fragmento de código
 * nunca se reconsidera como token de ruta parcial. Los desplazamientos son de
 * cadena JS (UTF-16) y `text` siempre corta exactamente la entrada original.
 */
export function parseFilePaths(text: string): FilePathPart[] {
	const runs = Array.from(text.matchAll(/`+/g), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
		width: match[0].length,
	}));
	// La siguiente serie de la misma anchura permite que las aperturas sin pareja queden
	// como texto plano sin volver a recorrer una y otra vez el resto de un borrador largo.
	const next = new Map<number, number>();
	const closing = new Map<number, number>();
	for (let i = runs.length - 1; i >= 0; i--) {
		const width = runs[i]!.width;
		const match = next.get(width);
		if (match !== undefined) closing.set(i, match);
		next.set(width, i);
	}

	const parts: FilePathPart[] = [];
	let plainStart = 0;
	for (let i = 0; i < runs.length; i++) {
		const closeIndex = closing.get(i);
		if (closeIndex === undefined) continue;
		const open = runs[i]!;
		const close = runs[closeIndex]!;
		let path = text.slice(open.end, close.start);
		// CommonMark quita exactamente un espacio en cada borde, no todo el espacio en blanco.
		if (path.startsWith(" ") && path.endsWith(" ") && /[^ ]/.test(path)) {
			path = path.slice(1, -1);
		}
		if (isFilePath(path)) {
			if (plainStart < open.start) {
				parts.push({ kind: "text", text: text.slice(plainStart, open.start), start: plainStart, end: open.start });
			}
			parts.push({ kind: "path", text: text.slice(open.start, close.end), path, start: open.start, end: close.end });
			plainStart = close.end;
		}
		i = closeIndex;
	}
	if (plainStart < text.length) {
		parts.push({ kind: "text", text: text.slice(plainStart), start: plainStart, end: text.length });
	}
	return parts;
}

function isWindowsPath(path: string): boolean {
	return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

/** Sintaxis de directorio, no un sondeo del sistema de ficheros. Una barra
 * invertida es un carácter legítimo de nombre POSIX, así que solo marca un
 * directorio en rutas de Windows. */
export function isDirectoryReference(path: string): boolean {
	return path.endsWith("/") || (isWindowsPath(path) && path.endsWith("\\"));
}

/** Llámala solo para un directorio conocido con certeza (metadatos del
 * selector nativo o de arrastrar y soltar). El marcador duradero sobrevive sin
 * cambios al guardado, copia y recarga ordinarios del texto. */
export function directoryReferencePath(path: string): string {
	quoteFilePath(path);
	return isDirectoryReference(path) ? path : path + (isWindowsPath(path) ? "\\" : "/");
}

/** Nombre base solo para mostrar; la ruta completa original queda intacta. */
export function filePathLabel(path: string): string {
	const windows = isWindowsPath(path);
	const separator = windows ? /[\\/]/ : /\//;
	const trimmed = windows ? path.replace(/[\\/]+$/, "") : path.replace(/\/+$/, "");
	if (!trimmed || (windows && /^[a-z]:$/i.test(trimmed)) || trimmed === "~") return path;
	return trimmed.split(separator).at(-1) || path;
}
