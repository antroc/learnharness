/** Dos reparaciones solo de render/presentación para entradas que aceptaba
 * la antigua incrustación en HTML. No reescribas los artefactos/descargas
 * guardados ni intentes una reparación general de XML. Los comentarios, las
 * CDATA y las instrucciones de procesamiento se copian tal cual. */
export function svgImageSource(svg: string): string {
	let foundRoot = false;
	return svg.replace(
		/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<\/?[a-zA-Z](?:[^<>"']|"[^"]*"|'[^']*')*>|&nbsp;/g,
		(token) => {
			if (token.startsWith("<!--") || token.startsWith("<![CDATA[") || token.startsWith("<?")) return token;
			if (!foundRoot && /^<svg(?=[\s/>])/i.test(token)) {
				foundRoot = true;
				// Consume valores de atributo completos, para que un texto que mencione xmlns
				// dentro de otro atributo no pueda hacerse pasar por una declaración.
				const attrs = token.matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g);
				const hasNamespace = Array.from(attrs).some((attr) => attr[1] === "xmlns");
				if (!hasNamespace) token = token.replace(/^<svg/i, '$& xmlns="http://www.w3.org/2000/svg"');
			}
			return token.replace(/&nbsp;/g, "&#160;");
		},
	);
}
