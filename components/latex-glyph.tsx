import katex from "katex";

/**
 * LA frontera de los glifos de LaTeX (decisión del responsable, 2026-09-30): los
 * conectores de la interfaz que quieren símbolos matemáticos renderizan los
 * glifos REALES de LaTeX con KaTeX — el motor matemático de la app, que ya
 * viene incluido (app/layout.tsx lleva la hoja de estilos de katex) —, nunca
 * SVG hechos a mano ni unicode dependiente de la fuente. Nació para las
 * conectivas lógicas de la tabla de cadenas: las premisas se unen con \land
 * (∧) y la conclusión se separa con \implies (⟹) — `A ∧ B ⟹ C`, no el engañoso
 * `A → B → C`.
 *
 * Destacados por la misma decisión: las conectivas se renderizan en el color de
 * PRIMER PLANO del tema (blanco en el tema oscuro) — la lógica de la línea de la
 * cadena es la carga útil, no decoración. Quienes llaman pasan la clase.
 */

/** HTML de katex en caché por comando — el conjunto de glifos es diminuto y
 *  renderToString es pura; un render por comando y por proceso. */
const cache = new Map<string, string>();

/** El HTML de katex en bruto para un comando de LaTeX (puro, síncrono — seguro para SSR). */
export function latexGlyphHtml(cmd: string): string {
	let html = cache.get(cmd);
	if (html === undefined) {
		html = katex.renderToString(cmd, { throwOnError: false, output: "html" });
		cache.set(cmd, html);
	}
	return html;
}

/** Un glifo de LaTeX renderizado. `cmd` es el comando de LaTeX ("\land",
 *  "\implies"); la salida es aria-hidden — quienes llaman llevan el aria-label
 *  textual (formatChainLine conserva la forma en texto plano). */
export function LatexGlyph({
	cmd,
	testid,
	className,
}: {
	cmd: string;
	testid?: string;
	className?: string;
}) {
	return (
		<span
			data-testid={testid}
			aria-hidden="true"
			className={className}
			// katex.renderToString es la salida de confianza de la propia biblioteca
			// (lo mismo que inyecta rehype-katex para las matemáticas de markdown).
			dangerouslySetInnerHTML={{ __html: latexGlyphHtml(cmd) }}
		/>
	);
}
