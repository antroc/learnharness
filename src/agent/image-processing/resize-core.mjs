// Adaptado de @earendil-works/pi-coding-agent 1.1.0, dist/utils/image-resize-core.js (MIT).
// Los recursos .mjs de runtime se quedan sin empaquetar para el empaquetado de workers de Node/Electron de Next.
import { applyExifOrientation } from "./exif-orientation.mjs";
import { loadPhoton } from "./photon.mjs";
/**
 * Etiqueta de las respuestas del worker de redimensionado de imágenes. Node puede publicar sus propios mensajes en el
 * canal del worker (por ejemplo `{ "watch:require": [...] }` con `node --watch`), así que las respuestas deben ser identificables.
 */
export const IMAGE_RESIZE_WORKER_RESPONSE_TYPE = "pi:image-resize-response";
// 4,5 MB de carga en base64. Deja margen por debajo del límite de 5 MB de Anthropic.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;
const DEFAULT_OPTIONS = {
    maxWidth: 2000,
    maxHeight: 2000,
    maxBytes: DEFAULT_MAX_BYTES,
    jpegQuality: 80,
};
function encodeCandidate(buffer, mimeType) {
    const data = Buffer.from(buffer).toString("base64");
    return {
        data,
        encodedSize: Buffer.byteLength(data, "utf-8"),
        mimeType,
    };
}
/**
 * Redimensiona una imagen para que quepa en las dimensiones máximas y el tamaño de fichero codificado indicados.
 * Devuelve null si la imagen no se puede redimensionar por debajo de maxBytes.
 *
 * Usa Photon (Rust/WASM) para procesar la imagen. Si Photon no está disponible,
 * devuelve null.
 *
 * Estrategia para quedarse por debajo de maxBytes:
 * 1. Primero redimensiona a maxWidth/maxHeight
 * 2. Prueba primero PNG y después las calidades JPEG en orden de inserción (gana la primera que quede por debajo del límite)
 * 3. Si sigue siendo demasiado grande, prueba las calidades JPEG restantes
 * 4. Si sigue siendo demasiado grande, reduce progresivamente las dimensiones hasta 1x1
 */
export async function resizeImageInProcess(inputBytes, mimeType, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;
    const photon = await loadPhoton();
    if (!photon) {
        return null;
    }
    let image;
    try {
        const rawImage = photon.PhotonImage.new_from_byteslice(inputBytes);
        image = applyExifOrientation(photon, rawImage, inputBytes);
        if (image !== rawImage)
            rawImage.free();
        const originalWidth = image.get_width();
        const originalHeight = image.get_height();
        const format = mimeType.split("/")[1] ?? "png";
        // Comprueba si ya está dentro de todos los límites (dimensiones Y tamaño codificado)
        if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && inputBase64Size < opts.maxBytes) {
            return {
                data: Buffer.from(inputBytes).toString("base64"),
                mimeType: mimeType || `image/${format}`,
                originalWidth,
                originalHeight,
                width: originalWidth,
                height: originalHeight,
                wasResized: false,
            };
        }
        // Calcula las dimensiones iniciales respetando los límites máximos
        let targetWidth = originalWidth;
        let targetHeight = originalHeight;
        if (targetWidth > opts.maxWidth) {
            targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
            targetWidth = opts.maxWidth;
        }
        if (targetHeight > opts.maxHeight) {
            targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
            targetHeight = opts.maxHeight;
        }
        function tryEncodings(width, height, jpegQualities) {
            const resized = photon.resize(image, width, height, photon.SamplingFilter.Lanczos3);
            try {
                const candidates = [encodeCandidate(resized.get_bytes(), "image/png")];
                for (const quality of jpegQualities) {
                    candidates.push(encodeCandidate(resized.get_bytes_jpeg(quality), "image/jpeg"));
                }
                return candidates;
            }
            finally {
                resized.free();
            }
        }
        const qualitySteps = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
        let currentWidth = targetWidth;
        let currentHeight = targetHeight;
        while (true) {
            const candidates = tryEncodings(currentWidth, currentHeight, qualitySteps);
            for (const candidate of candidates) {
                if (candidate.encodedSize < opts.maxBytes) {
                    return {
                        data: candidate.data,
                        mimeType: candidate.mimeType,
                        originalWidth,
                        originalHeight,
                        width: currentWidth,
                        height: currentHeight,
                        wasResized: true,
                    };
                }
            }
            if (currentWidth === 1 && currentHeight === 1) {
                break;
            }
            const nextWidth = currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
            const nextHeight = currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
            if (nextWidth === currentWidth && nextHeight === currentHeight) {
                break;
            }
            currentWidth = nextWidth;
            currentHeight = nextHeight;
        }
        return null;
    }
    catch {
        return null;
    }
    finally {
        if (image) {
            image.free();
        }
    }
}
