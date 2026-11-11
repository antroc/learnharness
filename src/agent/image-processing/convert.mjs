// Adaptado de @earendil-works/pi-coding-agent 1.1.0, dist/utils/image-convert.js (MIT).
// Solo se conserva la conversión de imágenes en línea; no se usa el registro de terminal/Kitty.
import { applyExifOrientation } from "./exif-orientation.mjs";
import { loadPhoton } from "./photon.mjs";

function encodePng(photon, bytes) {
    try {
        const rawImage = photon.PhotonImage.new_from_byteslice(bytes);
        const image = applyExifOrientation(photon, rawImage, bytes);
        if (image !== rawImage) rawImage.free();
        try {
            return new Uint8Array(image.get_bytes());
        } finally {
            image.free();
        }
    } catch {
        return null;
    }
}

export async function convertImageBytesToPng(bytes) {
    const photon = await loadPhoton();
    if (!photon) return null;
    return encodePng(photon, bytes);
}
