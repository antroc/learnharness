/** Una petición de importación: bytes de los ficheros más un margen acotado para los metadatos multipart. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_BODY_BYTES = 26 * 1024 * 1024;

/** Los tipos de fichero que admite "Extract files"; la comprobación del cliente, la del servidor y el `accept` del selector derivan todos de esta lista. */
const IMPORT_EXTENSION_NAMES = ["txt", "md", "markdown", "rst", "org", "adoc", "tex", "pdf"];
export const IMPORT_EXTENSIONS = new RegExp(`\\.(?:${IMPORT_EXTENSION_NAMES.join("|")})$`, "i");
export const IMPORT_ACCEPT = IMPORT_EXTENSION_NAMES.map((name) => `.${name}`).join(",");
export const UNSUPPORTED_TYPE_MESSAGE = "This file type isn't supported. Use text, Markdown, or PDF.";

/** El contrato de ruta relativa del contribuidor: solo identidad, nunca una
 * ruta de disco. Chromium puede serializar el nombre base o el
 * webkitRelativePath completo. */
export function validNotesPath(path: string, filename: string): boolean {
	const parts = path.split("/");
	return path.length > 0 && path.length <= 1024 && !/[\\:\x00-\x1f\x7f]/.test(path)
		&& parts.every((part) => part.length > 0 && part !== "." && part !== "..")
		&& (parts.at(-1) === filename || path === filename);
}
