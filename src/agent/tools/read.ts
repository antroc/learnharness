import * as fs from "node:fs/promises";
import { Type } from "typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { resolveSourcePath } from "./fs-shared.ts";
import { detectSupportedImageMimeTypeFromFile, processImage } from "../image-processing/index.ts";

/**
 * La herramienta read: sources v0 (2026-09): un port a Node de la semántica de read de pi
 * para los ficheros locales del alumno. El flujo es del alumno: pega rutas de ficheros
 * en el chat y el agente las lee en sus propios términos (nada se
 * inyecta automáticamente). El alcance siguen siendo las lecturas locales amplias, salvo las denegaciones
 * compartidas de ubicaciones sensibles/credenciales y el límite opcional de carpetas de fs-shared.ts; no es un sandbox.
 *
 * Comportamientos portados (reflejo del dist/core/tools/read.js de pi):
 * - ficheros de texto: utf-8, recorte por offset (desde 1) / limit, y el
 *   techo de truncado de 2000 líneas / 50 KB con avisos de continuación accionables
 *   "use offset=N": un fichero enorme nunca inunda el contexto en silencio.
 * - ficheros de imagen (jpg/png/gif/webp/bmp): se devuelven como partes de contenido de imagen
 *   nativas para que el modelo con visión los VEA de verdad (el glm-5.3-flash del
 *   profesor acepta entrada de imagen según el catálogo zai de pi; el toToolResult de
 *   tool-execute convierte ImageFileResult en el ImageContent de pi).
 * - los ficheros ilegibles/inexistentes lanzan: pi lo convierte en un resultado de herramienta
 *   de error que el modelo ve y del que se recupera.
 *
 * La guía de uso va en la descripción (el principio de herramientas
 * autocontenidas, decidido por el usuario 2026-09: los prompts de sistema solo hacen referencia a
 * herramientas siempre activas; read ES siempre activa, pero su doctrina sigue viviendo aquí).
 */

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const readInput = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read" })),
});

function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** Recorta + trunca el cuerpo del texto, al estilo de los avisos de continuación de pi. */
function readTextSlice(text: string, offset: number | undefined, limit: number | undefined): string {
	const allLines = text.split("\n");
	const totalLines = allLines.length;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
	}
	// respetar primero un limit explícito (nunca más allá del EOF)
	let selected = allLines.slice(startLine, limit !== undefined ? startLine + limit : totalLines);
	// después el techo de 2000 líneas
	let truncatedBy: "lines" | "bytes" | null = null;
	if (selected.length > MAX_LINES) {
		selected = selected.slice(0, MAX_LINES);
		truncatedBy = "lines";
	}
	// después el techo de 50 KB
	if (Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
		while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
			selected.pop();
		}
		truncatedBy = "bytes";
	}
	if (truncatedBy === null) {
		const remaining = totalLines - (startLine + selected.length);
		if (remaining > 0) {
			return `${selected.join("\n")}\n\n[${remaining} more lines in file. Use offset=${startLine + selected.length + 1} to continue.]`;
		}
		return selected.join("\n");
	}
	const endLineDisplay = startLine + selected.length;
	const reason =
		truncatedBy === "lines" ? `${MAX_LINES} line limit` : `${formatSize(MAX_BYTES)} limit`;
	return `${selected.join("\n")}\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${totalLines} (${reason}). Use offset=${endLineDisplay + 1} to continue.]`;
}

/**
 * La herramienta read, compartida literalmente por el sondeador y el profesor. Sources v1
 * (2026-09-19): la descripción es literal de pi (usuario: copiar exactamente la guía de uso
 * de la herramienta); la doctrina de enseñanza se trasladó al fragmento de prompt
 * compartido (prompts/shared/). Las rutas relativas se resuelven contra el
 * home del alumno (fs-shared.ts), el ancla del harness.
 */
export type ReadModel = Pick<Model<Api>, "input" | "inputLimits">;

/** Una implementación para todos los lectores de ficheros del alumno. Vincula el modelo activo
 * por agente, en lugar de compartir estado de modelo mutable entre conversaciones.
 * Las rutas relativas a home, el recorte de texto y la guarda de abortos de la app no cambian;
 * la detección/procesado de imágenes y sus notas siguen el comportamiento nativo de read de Pi. */
export function createReadTool(model?: ReadModel): AgentTool<typeof readInput> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. File access settings and protected-location denials apply; use ls without a path to discover allowed folders when restricted.`,
		parameters: readInput,
		execute: serverExecute("read", readInput, async ({ path: rawPath, offset, limit }, { signal }): Promise<string | ImageFileResult> => {
			const absolute = resolveSourcePath(rawPath);
			const mime = await detectSupportedImageMimeTypeFromFile(absolute);
			const buffer = await fs.readFile(absolute, { signal });
			if (mime) {
				const processed = await processImage(buffer, mime, { resizeOptions: model?.inputLimits?.images?.resize });
				signal?.throwIfAborted();
				const note = processed.ok
					? [`Read image file [${processed.mimeType}]`, ...processed.hints]
					: [`Read image file [${mime}]`, processed.message];
				if (model && !model.input.includes("image")) {
					note.push("[Current model does not support images. The image will be omitted from this request.]");
				}
				return {
					text: note.join("\n"),
					...(processed.ok ? { images: [{ data: processed.data, mimeType: processed.mimeType }] } : {}),
				};
			}
			return readTextSlice(buffer.toString("utf-8"), offset, limit);
		}),
	};
}

export const readTool = createReadTool();
