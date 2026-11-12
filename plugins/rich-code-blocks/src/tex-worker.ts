import { tex, dvi2svg, BrowserResourceLoader } from "isomorphic-tikzjax";
import { checkSource, checkSvgSize } from "./contract.ts";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; source: string; resourcesUrl: string }>) => void) | null;
  postMessage(value: unknown): void;
};
let loader: BrowserResourceLoader | undefined;
let resourceUrl: string | undefined;
worker.onmessage = async ({ data }) => {
  try {
    checkSource("tikz", data.source);
    // Usa siempre la raíz de recursos local explícita del plugin, nunca el CDN por defecto del paquete.
    const url = new URL(data.resourcesUrl);
    if (url.origin !== new URL(import.meta.url).origin) throw new Error("TeX resources must be local plugin assets.");
    if (!loader || resourceUrl !== url.href) { resourceUrl = url.href; loader = new BrowserResourceLoader(url.href); }
    const dvi = await tex(data.source, { showConsole: false }, loader);
    // El análisis DOM de la biblioteca NO es un saneador. Nuestro reconstructor de SVG estático
    // del hilo principal es la única vía de admisión a la página. Aquí no se ejecuta DOM/SVGO.
    const raw = await dvi2svg(dvi, { disableSanitize: true, embedFontCss: false });
    // Este escritor DVI fijado omite la única etiqueta SVG exterior de cierre (su analizador
    // HTML habitual la repara). Cierra solo esa forma de fragmento conocida y después usa
    // el análisis XML inerte estricto en nuestro saneador; nunca analices el HTML generado.
    const svg = /^<svg\b/.test(raw) && (raw.match(/<svg\b/g) ?? []).length === 1 && !/<\/svg\s*>/.test(raw) ? raw + "</svg>" : raw;
    checkSvgSize(svg);
    worker.postMessage({ id: data.id, svg });
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : "TeX rendering failed." });
  }
};
