import { collectCitations, type TutorCitation } from "./citations.ts";
import { parseFilePaths } from "./file-paths.ts";

/** Una proyección sin pérdidas del texto del alumno en los tokens atómicos del
 *  compositor: rutas de fichero entre comillas y citas del tutor. Una cita gana
 *  a cualquier cosa que parezca una ruta dentro de su enlace. */
export type ComposerToken =
	| { kind: "text"; text: string; start: number; end: number }
	| { kind: "path"; text: string; path: string; start: number; end: number }
	| { kind: "citation"; text: string; citation: TutorCitation; start: number; end: number };

export function parseComposerTokens(text: string): ComposerToken[] {
	const tokens: ComposerToken[] = [];
	let cursor = 0;
	const gap = (end: number) => {
		if (end <= cursor) return;
		for (const part of parseFilePaths(text.slice(cursor, end))) {
			tokens.push({ ...part, start: part.start + cursor, end: part.end + cursor });
		}
	};
	for (const occurrence of collectCitations(text)) {
		gap(occurrence.start);
		tokens.push({ kind: "citation", text: occurrence.source, citation: occurrence.citation, start: occurrence.start, end: occurrence.end });
		cursor = occurrence.end;
	}
	gap(text.length);
	return tokens;
}
