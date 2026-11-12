// Límites acotados para los paquetes de terceros fijados: las declaraciones SVG publicadas de smiles-drawer
// referencian un tipo Vertex no importado; las declaraciones por defecto de TikZ
// describen su entrada de Node en vez de la entrada de Worker del navegador que usa esta compilación.
declare module "rich-code-blocks-smiles" {
  const SmilesDrawer: {
    parse(source: string, success: (tree: unknown) => void, failure: (error: Error) => void): void;
    SvgDrawer: new (options: { scale: number }) => {
      opts: { fontSizeLarge: number; fontSizeSmall: number; fontFamily: string };
      draw(tree: unknown, target: null, theme: "light"): SVGSVGElement;
    };
  };
  export default SmilesDrawer;
}
declare module "isomorphic-tikzjax" {
  export class BrowserResourceLoader {
    constructor(baseUrl: string);
  }
  export function tex(source: string, options: { showConsole: boolean }, loader: BrowserResourceLoader): Promise<Uint8Array>;
  export function dvi2svg(dvi: Uint8Array, options: { disableSanitize: boolean; embedFontCss: boolean }): Promise<string>;
}

declare module "abcjs/src/api/abc_tunebook_svg.js" {
  const renderAbc: typeof import("abcjs").renderAbc;
  export default renderAbc;
}
