import type { ImageContent } from "@earendil-works/pi-ai";
import type { PiEngine } from "../agent/models.ts";
import { detectSupportedImageMimeType, processImage } from "../agent/image-processing/index.ts";
import { validatePluginSubmissionImageArray, validatePluginSubmissionImages, type PluginSubmissionImages } from "../core/plugin-submissions.ts";
import { ChatInputError } from "../core/input-events.ts";
import { preparePluginProblemSubmissionImages, type PluginProblemSubmissionImages } from "../core/plugin-submissions.ts";

type ImageEngine = Pick<PiEngine, "model">;

/** Solo política de admisión, no un segundo resolutor de proveedor/modelo. El llamante
 * aporta el motor real al que despachará (o el modelo vivo capturado). */
export function submissionImagePolicyKey(engine: ImageEngine): string {
	const resize = engine.model.inputLimits?.images?.resize;
	return JSON.stringify([engine.model.provider, engine.model.id, engine.model.input.includes("image"),
		resize?.maxWidth, resize?.maxHeight, resize?.maxBytes, resize?.jpegQuality]);
}

/** Solo bloques nativos estrictos. El decodificador de abajo verifica la imagen entera;
 * la detección por firma también impide que le llegue una declaración MIME falsa. */
export async function prepareSubmissionImages(
	images: readonly Readonly<ImageContent>[] | undefined,
	engine: ImageEngine,
): Promise<ImageContent[] | undefined> {
	if (images === undefined) return undefined;
	try { images = validatePluginSubmissionImageArray(images); }
	catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submitted images"); }
	if (images.length === 0) return undefined;
	if (!engine.model.input.includes("image")) throw new ChatInputError("The selected model does not support images. Your input has been kept.");
	// Se capturan los bytes y la política antes del primer await; las modificaciones del
	// llamante no deben alterar un envío en curso ni sus canales de imagen posteriores.
	const resizeOptions = { ...engine.model.inputLimits?.images?.resize };
	const captured = images.map(image => {
		const bytes = Buffer.from(image.data, "base64");
		// El detector existente de la herramienta de ficheros excluye a propósito los PNG
		// animados. Los PNG de un envío pueden seguir decodificándose con el procesador real;
		// no se restringe en silencio la familia de formatos PNG aprobada a ficheros estáticos.
		const detected = detectSupportedImageMimeType(bytes) ?? (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : null);
		if (!bytes.length || bytes.toString("base64") !== image.data || detected !== image.mimeType)
			throw new ChatInputError("Submitted image bytes do not match their declared format");
		return { bytes, mimeType: image.mimeType };
	});
	const prepared: ImageContent[] = [];
	for (const image of captured) {
		try {
			const result = await processImage(image.bytes, image.mimeType, { resizeOptions });
			if (!result.ok) throw new Error("Image processing failed");
			// Las pistas del procesador no son texto del alumno; solo los bytes de imagen
			// normalizados pasan a ser contenido nativo aceptado. Nunca se sustituye por un marcador de omisión.
			prepared.push({ type: "image", data: result.data, mimeType: result.mimeType });
		} catch {
			throw new ChatInputError("Could not prepare the submitted image. Your input has been kept.");
		}
	}
	return prepared;
}

export async function prepareProblemSubmissionImageChannels(images: PluginProblemSubmissionImages | undefined, engine: ImageEngine): Promise<PluginProblemSubmissionImages | undefined> {
	if (images === undefined) return undefined;
	try { images = preparePluginProblemSubmissionImages(images); }
	catch { throw new ChatInputError("Invalid problem submission images"); }
	const [submission, thinking] = await Promise.all([prepareSubmissionImages(images.submission, engine), prepareSubmissionImages(images.thinking, engine)]);
	return submission || thinking ? { ...(submission ? { submission } : {}), ...(thinking ? { thinking } : {}) } : undefined;
}

export async function prepareSubmissionImageChannels(
	images: PluginSubmissionImages | undefined,
	engine: ImageEngine,
): Promise<PluginSubmissionImages | undefined> {
	if (images === undefined) return undefined;
	try { images = validatePluginSubmissionImages(images); }
	catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submitted image channels"); }
	// Todas las preparaciones arrancan de forma síncrona para capturar todos los canales
	// antes de que el procesamiento ceda; ni los llamantes directos del servidor pueden modificar los posteriores.
	const [answer, thinking, readingThinking] = await Promise.all([
		prepareSubmissionImages(images.answer, engine),
		prepareSubmissionImages(images.thinking, engine),
		prepareSubmissionImages(images.readingThinking, engine),
	]);
	if (!answer && !thinking && !readingThinking) return undefined;
	return { ...(answer ? { answer } : {}), ...(thinking ? { thinking } : {}), ...(readingThinking ? { readingThinking } : {}) };
}
