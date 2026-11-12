/**
 * Auxiliares de descarga de artefactos (pulido de la versión, 2026-10-07): la
 * pequeña frontera de guardar un blob compartida por las tarjetas de demo y de
 * figura, más el slug del nombre de fichero. El slug es puro (fijado en las
 * pruebas); downloadFile toca el DOM y solo se ejecuta al hacer clic.
 */

/** Convierte el título de una demo en la raíz de un nombre de fichero:
 * minúsculas, acentos plegados, secuencias de caracteres no alfanuméricos
 * reducidas a "-", recortado y con un tope de 64 caracteres. Los títulos
 * vacíos o solo de símbolos recurren a "demo". */
export function slugFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "demo";
}

/** Guarda texto (o bytes) como fichero descargado. La URL del blob se revoca
 * justo después del clic; Chromium mantiene viva la descarga tras la revocación. */
export function downloadFile(name: string, content: string | Uint8Array<ArrayBuffer>, mime: string): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
