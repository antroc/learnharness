/** Solo visualización: la ruta original sigue siendo la identidad/procedencia de la
 * fuente. Conserva exactamente la ortografía y la puntuación; quita solo la extensión final. */
export function sourceFileLabel(filePath: string): string {
	const base = filePath.split(/[\\/]/).pop() || filePath;
	return base.replace(/\.[^.]+$/, "") || base;
}
