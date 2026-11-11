// La normalización de las imágenes del alumno se ejecuta fuera del hilo del servidor y se puede terminar al abortar.
// Volver a codificar elimina los metadatos de origen y aplica la orientación antes de guardar o usar con el modelo.
import { parentPort } from "node:worker_threads";
import { convertImageBytesToPng } from "./convert.mjs";
import { resizeImageInProcess } from "./resize-core.mjs";

parentPort.once("message", async ({ bytes }) => {
	try {
		const png = await convertImageBytesToPng(bytes);
		if (!png) throw new Error("Could not decode image");
		const result = await resizeImageInProcess(png, "image/png", { maxWidth: 1600, maxHeight: 1600, maxBytes: 1024 * 1024 });
		if (!result) throw new Error("Could not shrink image to an embeddable size");
		parentPort.postMessage({ result });
	} catch (error) {
		parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
});
