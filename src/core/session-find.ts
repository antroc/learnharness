/** Búsqueda literal en la sesión, sin distinguir mayúsculas (responsable, 2026-10-13). La
 * frontera del DOM aporta solo el texto mostrado; aquí no vive ningún índice de
 * transcripción, Markdown o TeX. */
export interface SessionTextMatch {
	start: number;
	end: number;
}

export function findSessionTextMatches(text: string, query: string): SessionTextMatch[] {
	if (!query) return [];
	// Escapa la cadena del usuario; nunca expongas la semántica de las regex. RegExp conserva
	// los offsets UTF-16 ORIGINALES, a diferencia del texto en minúsculas (İ puede cambiar de longitud).
	const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(literal, "giu");
	return Array.from(text.matchAll(pattern), (m) => ({ start: m.index, end: m.index + m[0].length }));
}

export function stepSessionMatch(index: number, count: number, direction: 1 | -1): number {
	if (!count) return -1;
	return ((index + direction) % count + count) % count;
}
