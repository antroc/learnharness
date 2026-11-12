/**
 * POST /api/graph/import — el transporte de la puerta de entrada agnóstica
 * del formato (visión §1, 2026-09-13): entran ficheros de notas personales
 * en bruto y se hace una ejecución de extracción por fichero con el MISMO
 * proceso que usan las sesiones. Datos de formulario multipart (campo
 * "files"); el proceso acuña un id de fuente determinista por cada ruta de
 * fichero, persiste el registro de la fuente (la procedencia del fichero y
 * el uso de la ejecución) y ejecuta extractor → auditor → fusionador sobre
 * el texto en bruto.
 *
 * Solo se aceptan las extensiones de fichero que figuran en
 * lib/notes-import-limits.ts. De esos ficheros, un PDF (detectado por su
 * cabecera %PDF-) se convierte antes a Markdown. Los demás se decodifican
 * como UTF-8, salvo que un byte cero en sus primeros 8 KiB provoque el
 * rechazo. Es una heurística de fichero binario, no una validación completa
 * del texto ni de la codificación. Estos rechazos, y los PDF sin nada que
 * extraer, se producen antes de cualquier registro de fuente o llamada al
 * modelo.
 *
 * Tope de concurrencia pequeño: las llamadas al modelo son la parte lenta, y
 * una ráfaga de 25 ejecuciones simultáneas haría saltar los límites de tasa
 * del proveedor; un grupo de 3 workers mantiene sanos el registro de
 * ejecuciones (las etiquetas de estado del dock) y los registros. Las
 * etiquetas del dock y la nueva petición del grafo siguen el progreso en
 * directo mediante /api/graph/status, igual que con las ejecuciones de sesión.
 */
import { convertPdf, extraction, joinPages, NotesImportError, sourceDirectory } from "@/src/server";
import { IMPORT_EXTENSIONS, MAX_IMPORT_BODY_BYTES, MAX_IMPORT_BYTES, UNSUPPORTED_TYPE_MESSAGE, validNotesPath } from "@/lib/notes-import-limits.ts";
import { FormBodyLimitError, readBoundedFormData } from "@/lib/bounded-form-data.ts";
import {
	emit,
	ModelsNotConfiguredError,
	PROVIDER_KEY_MISSING_CODE,
	ProviderKeyMissingError,
	type EmissionStats,
} from "@/src/core";

export const dynamic = "force-dynamic";

interface ImportResult {
	requestIndex: number;
	outcome: "completed" | "failed" | "partial" | "aborted" | "busy";
	filePath: string;
	ok: boolean;
	stats?: EmissionStats;
	error?: string;
	/** El discriminador para máquinas cuando ok:false es un rechazo de
	 * configuración: el rechazo de modelos BYOK (responsable, 2026-09-22) o el
	 * de clave de proveedor (2026-09-25); el cliente puede abrir con él el
	 * flujo de configuración/claves. */
	code?: "models_not_configured" | (typeof PROVIDER_KEY_MISSING_CODE);
	missing?: string[];
	/** Los detalles del rechazo por clave (solo provider_key_missing). */
	provider?: string;
	slots?: string[];
	/** Se muestra junto a una importación completada (todo PDF: el texto escaneado puede estar mal). */
	notice?: string;
}

const MAX_PDF_PAGES = 1000;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

type NotesFile = { kind: "notes"; text: string; notice?: string } | { kind: "refused"; error: string };

/** Un PDF pasa a Markdown con marcas de página; cualquier otro fichero aceptado se lee como texto. */
async function readNotesFile(file: File): Promise<NotesFile> {
	if (!IMPORT_EXTENSIONS.test(file.name)) return { kind: "refused", error: UNSUPPORTED_TYPE_MESSAGE };
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) {
		if (bytes.subarray(0, 8192).includes(0)) return { kind: "refused", error: "This file isn't plain text." };
		return { kind: "notes", text: new TextDecoder().decode(bytes) };
	}
	const pdf = await convertPdf(bytes, MAX_PDF_PAGES);
	switch (pdf.kind) {
		case "unreadable":
			return { kind: "refused", error: "Could not open this PDF." };
		case "too-long":
			return { kind: "refused", error: "Too long. Max 1,000 pages." };
		case "converted": {
			const text = joinPages(pdf.pages);
			if (!text) return { kind: "refused", error: "OCR not supported yet." };
			const skipped = pdf.pages.filter((page) => page.kind === "image-only").length;
			const omission = skipped > 0 ? ` Skipped ${skipped} image-only ${skipped === 1 ? "page" : "pages"}; OCR is not supported.` : "";
			return { kind: "notes", text, notice: `Scanned pages may have errors.${omission}` };
		}
	}
}

export async function POST(request: Request) {
	let form: FormData;
	try {
		form = await readBoundedFormData(request, MAX_IMPORT_BODY_BYTES);
	} catch (err) {
		const oversized = err instanceof FormBodyLimitError;
		return Response.json({ results: [] as ImportResult[], error: oversized
			? "Import request is too large. Select fewer files."
			: "Could not read the upload. It may be incomplete; please select the files again." }, { status: oversized ? 413 : 400 });
	}
	const files = form.getAll("files").filter((f): f is File => f instanceof File);
	if (files.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) {
		return Response.json({ results: [] as ImportResult[], error: "Too big. Max 25 MB." }, { status: 413 });
	}
	if (files.length === 0) {
		return Response.json({ results: [] as ImportResult[], error: "no files" }, { status: 400 });
	}

	// PR198: identidad relativa a la carpeta, casada con cualquiera de las dos formas de nombre del navegador.
	// Valida todas las rutas antes de conversiones, escrituras de metadatos o llamadas al modelo.
	const suppliedPaths = form.getAll("paths");
	if (suppliedPaths.length > 0 && (suppliedPaths.length !== files.length || suppliedPaths.some((p) => typeof p !== "string"))) {
		return Response.json({ results: [], error: "Invalid import paths" }, { status: 400 });
	}
	const paths = suppliedPaths.length > 0 ? suppliedPaths as string[] : files.map((f) => f.name);
	if (files.some((file, i) => !validNotesPath(paths[i]!, file.name))) {
		return Response.json({ results: [], error: "Import contains an unsafe or mismatched relative path" }, { status: 400 });
	}
	const results: ImportResult[] = [];
	const queue = files.map((file, requestIndex) => ({ file, requestIndex, filePath: paths[requestIndex]! }));
	const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const { file, requestIndex, filePath } = next;
			try {
				const notes = await readNotesFile(file);
				if (notes.kind === "refused") {
					results.push({ filePath, requestIndex, outcome: "failed", ok: false, error: notes.error });
					continue;
				}
				sourceDirectory.registerImport(filePath);
				const stats = await extraction.importNotes({ filePath, text: notes.text });
				results.push({ filePath, requestIndex, outcome: "completed", ok: true, stats, ...(notes.notice ? { notice: notes.notice } : {}) });
			} catch (err) {
				if (err instanceof ModelsNotConfiguredError) {
					results.push({ filePath, ok: false, requestIndex, outcome: "failed", error: err.envelope.error,
						code: "models_not_configured", missing: err.envelope.missing });
				} else if (err instanceof ProviderKeyMissingError) {
					results.push({ filePath, ok: false, requestIndex, outcome: "failed", error: err.envelope.error,
						code: PROVIDER_KEY_MISSING_CODE, provider: err.envelope.provider, slots: err.envelope.slots });
				} else {
					results.push({ filePath, requestIndex, ok: false,
						outcome: err instanceof NotesImportError ? err.outcome : "failed",
						...(err instanceof NotesImportError ? { stats: err.partialStats } : {}),
						error: err instanceof Error ? err.message : String(err) });
				}
			} finally { emit("sources-changed", {}); }
		}
	});
	await Promise.all(workers);
	return Response.json({ results });
}