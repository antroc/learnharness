import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { loadLearnerImage } from "./learner-image.ts";
import type { ShowImageDetails } from "../../core/contracts.ts";
import type { ChatStore } from "../../core/ports.ts";

/**
 * show_image (issue #363): coloca en la lección uno de los ficheros de imagen del alumno
 * tal cual: el gemelo instantáneo y sin modelo de `visual` con una imagen.
 * Solo el profesor, siempre activa como el conjunto del sistema de ficheros del alumno.
 *
 * La imagen llega solo al registro (`details` → la salida de la parte de
 * herramienta → ImageCard). El resultado del profesor es UNA línea de texto (decisión
 * del responsable): la imagen nunca se reenvía en turnos posteriores; read es como el
 * profesor la mira.
 */

const showImageInput = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the learner's image file (relative or absolute)" }),
	caption: Type.Optional(Type.String({ description: "One short line shown under the image" })),
});

export function createShowImageTool(ctx: { chatId: string; chatStore: Pick<ChatStore, "saveImageSnapshot"> }): AgentTool<typeof showImageInput> {
	return {
		name: "show_image",
		label: "show_image",
		description:
			"Show one of the learner's image files (jpg, png, gif, webp, bmp) in the lesson as-is, with an optional caption. " +
			"Instant. The result only confirms what was shown — the image is not sent back to you; use read to look at it. " +
			"To draw marks on the image, call visual with its path instead. Visual results display automatically: do not repeat a newly delivered result. " +
			"Show a picture again only when resurfacing it meaningfully helps the current explanation. Local paths follow File access settings; use ls to discover allowed folders.",
		parameters: showImageInput,
		execute: serverExecute("show_image", showImageInput, async ({ path, caption }, { signal }): Promise<ImageFileResult> => {
			const image = await loadLearnerImage(path, signal);
			ctx.chatStore.saveImageSnapshot(ctx.chatId, image.snapshotId, image);
			const trimmed = caption?.trim();
			const details: ShowImageDetails = {
				path: image.path,
				...(trimmed ? { caption: trimmed } : {}),
				mimeType: image.mimeType,
				snapshotId: image.snapshotId,
				width: image.width,
				height: image.height,
			};
			return { text: `Shown to the learner: ${image.path} (${image.width}×${image.height}).`, details };
		}),
	};
}
