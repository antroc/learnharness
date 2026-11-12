import { SVG_LIMIT, checkSvgSize, type Language } from "./contract.ts";
import { prepareInk } from "./appearance.ts";

const NS = "http://www.w3.org/2000/svg";
const ELEMENTS = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "marker", "pattern", "use"]);
const NUMERIC = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "dx", "dy", "stroke-width", "stroke-dashoffset", "font-size", "letter-spacing", "word-spacing", "offset", "markerWidth", "markerHeight", "refX", "refY"]);
const ENUMS: Record<string, readonly string[]> = {
  "stroke-linecap": ["butt", "round", "square"], "stroke-linejoin": ["miter", "round", "bevel"],
  "fill-rule": ["nonzero", "evenodd"], "clip-rule": ["nonzero", "evenodd"],
  "text-anchor": ["start", "middle", "end"], "font-style": ["normal", "italic", "oblique"],
  "font-weight": ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"],
  "alignment-baseline": ["baseline", "middle", "central", "hanging", "text-before-edge", "text-after-edge", "alphabetic"],
  "dominant-baseline": ["auto", "middle", "central", "hanging", "alphabetic", "text-before-edge", "text-after-edge"],
  "baseline-shift": ["baseline", "sub", "super"],
  "gradientUnits": ["userSpaceOnUse", "objectBoundingBox"], "clipPathUnits": ["userSpaceOnUse", "objectBoundingBox"],
  "maskUnits": ["userSpaceOnUse", "objectBoundingBox"], "maskContentUnits": ["userSpaceOnUse", "objectBoundingBox"],
  "patternUnits": ["userSpaceOnUse", "objectBoundingBox"], "patternContentUnits": ["userSpaceOnUse", "objectBoundingBox"],
  "markerUnits": ["strokeWidth", "userSpaceOnUse"], "spreadMethod": ["pad", "reflect", "repeat"],
};
const number = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
const LENGTH = new RegExp(`^${number}(?:px|pt|pc|cm|mm|in|em|ex|%)?$`);
const NUMBER_LIST = new RegExp(`^${number}(?:[\\s,]+${number})*$`);
const TRANSFORM = new RegExp(`^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\\(\\s*${number}(?:[\\s,]+${number})*\\s*\\)\\s*)+$`);
const CSS_TRANSFORM = new RegExp(`^(?:(?:matrix|translate[XY]?|scale[XY]?|rotate|skew[XY])\\(\\s*${number}(?:px|deg|rad)?(?:[\\s,]+${number}(?:px|deg|rad)?)*\\s*\\)\\s*)+$`);
const STYLE_ATTRIBUTES = new Set(["fill", "stroke", "color", "fill-opacity", "stroke-opacity", "opacity", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "fill-rule", "font-family", "font-size", "font-style", "font-weight", "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift"]);
let serial = 0;

function viewBox(value: string): string | undefined {
  const numbers = value.trim().split(/[\s,]+/).map(Number);
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2]! > 0 && numbers[3]! > 0 ? numbers.join(" ") : undefined;
}

/** Reconstruye un SVG estático a partir de un documento XML inerte. Nunca
 * inserta el árbol analizado. No sobreviven HTML, reglas CSS, manejadores de
 * eventos, animaciones, referencias externas ni nombres de atributo
 * arbitrarios. Es a propósito más estricto que un saneador SVG genérico.
 */
export function sanitizeSvg(source: string, label: string, language?: Language): SVGSVGElement {
  checkSvgSize(source);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("SVG document declarations are not supported.");
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg" || parsed.documentElement.namespaceURI !== NS) {
    throw new Error("The renderer did not produce a valid SVG.");
  }
  const prefix = `rich-code-blocks-${++serial}-`;
  const ids = new Map<string, string>();
  for (const element of parsed.querySelectorAll("[id]")) {
    const id = element.getAttribute("id")!;
    if (ELEMENTS.has(element.localName) && element.namespaceURI === NS && !ids.has(id)) ids.set(id, prefix + ids.size);
  }
  function fragment(value: string): string | undefined {
    const id = ids.get(value.slice(1));
    return value.startsWith("#") && id ? `#${id}` : undefined;
  }
  function safeValue(name: string, raw: string): string | undefined {
    const value = raw.trim();
    if (NUMERIC.has(name)) return LENGTH.test(value) && Number.isFinite(parseFloat(value)) ? value : undefined;
    if (name === "id") return ids.get(value);
    if (name === "href") return fragment(value);
    if (name === "viewBox") return viewBox(value);
    if (name === "d") return /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\s-]+$/.test(value) ? value : undefined;
    if (name === "points") return NUMBER_LIST.test(value) ? value : undefined;
    if (["transform", "gradientTransform", "patternTransform"].includes(name)) return TRANSFORM.test(value) ? value : undefined;
    if (["fill", "stroke", "color", "stop-color"].includes(name)) {
      const reference = /^url\(\s*['"]?(#[^\s'"()]+)['"]?\s*\)$/.exec(value);
      if (reference) { const target = fragment(reference[1]!); return target ? `url(${target})` : undefined; }
      if (/^(?:[a-z]+|#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+/-]+\))$/i.test(value) && CSS.supports("color", value)) return value;
      if (value === "none") return value;
      return undefined;
    }
    if (["clip-path", "mask", "marker-start", "marker-mid", "marker-end"].includes(name)) {
      const match = /^url\(\s*['"]?(#[^\s'"()]+)['"]?\s*\)$/.exec(value);
      const target = match && fragment(match[1]!);
      return target ? `url(${target})` : undefined;
    }
    if (["opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "stroke-miterlimit"].includes(name)) return LENGTH.test(value) && Number.isFinite(parseFloat(value)) ? value : undefined;
    if (name === "stroke-dasharray") return value === "none" || NUMBER_LIST.test(value) ? value : undefined;
    if (name === "font-family") {
      if (!/^[a-z\d ,"'-]+$/i.test(value)) return undefined;
      return value.split(",").map(font => {
        const clean = font.trim().replace(/^['"]|['"]$/g, "");
        if (/^(?:cm[a-z\d]+|msam\d+|msbm\d+|eu[a-z\d]+|line\d+|lcircle\d+)$/i.test(clean)) return `rich-code-blocks-font-${clean}`;
        if (/^(?:sans-serif|serif|monospace)$/i.test(clean)) return clean;
        return /^(?:Arial|Helvetica|Times|Times New Roman)$/i.test(clean) ? `'${clean}'` : "serif";
      }).join(",");
    }
    if (name === "orient") return ["auto", "auto-start-reverse"].includes(value) || LENGTH.test(value) ? value : undefined;
    if (name === "preserveAspectRatio") return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value) ? value : undefined;
    return ENUMS[name]?.includes(value) ? value : undefined;
  }
  const assignedIds = new Set<string>();
  function copy(element: Element): SVGElement | undefined {
    if (element.namespaceURI !== NS || !ELEMENTS.has(element.localName)) return undefined;
    const output = document.createElementNS(NS, element.localName);
    for (const attribute of element.attributes) {
      // Normaliza xlink:href; todos los demás espacios de nombres ajenos se descartan.
      const name = attribute.localName;
      if (attribute.namespaceURI && !(attribute.namespaceURI === "http://www.w3.org/1999/xlink" && name === "href")) continue;
      const value = safeValue(name, attribute.value);
      if (value !== undefined) {
        if (name === "id") { if (assignedIds.has(value)) continue; assignedIds.add(value); }
        output.setAttribute(name, value);
      }
    }
    // Analiza la sintaxis de las declaraciones con el navegador y después admite solo valores concretos.
    // Nunca copies una hoja de estilo ni una declaración CSS arbitraria al árbol vivo.
    const declarations = (element as SVGElement).style;
    if (declarations) for (const property of STYLE_ATTRIBUTES) {
      const value = safeValue(property, declarations.getPropertyValue(property));
      if (value !== undefined) output.setAttribute(property, value);
    }
    // Las etiquetas de SMILES usan translateX/translateY de CSS. Admite solo transformaciones
    // 2D finitas y conviértelas en atributos matrix SVG estáticos, no en CSS vivo.
    const cssTransform = declarations?.getPropertyValue("transform").trim();
    if (cssTransform && CSS_TRANSFORM.test(cssTransform)) {
      try {
        const matrix = new DOMMatrixReadOnly(cssTransform);
        const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
        if (matrix.is2D && values.every(Number.isFinite)) output.setAttribute("transform", `matrix(${values.join(",")})`);
      } catch { /* La sintaxis de transformación no admitida se descarta, nunca se evalúa. */ }
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && ["text", "tspan", "title", "desc"].includes(element.localName)) output.append(document.createTextNode(child.textContent ?? ""));
      else if (child.nodeType === Node.ELEMENT_NODE) { const safe = copy(child as Element); if (safe) output.append(safe); }
    }
    return output;
  }
  const svg = copy(parsed.documentElement) as SVGSVGElement;
  if (!svg.getAttribute("viewBox")) {
    const width = parseFloat(svg.getAttribute("width") ?? "");
    const height = parseFloat(svg.getAttribute("height") ?? "");
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error("SVG dimensions are missing or invalid.");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  // Conserva solo una anchura natural; al ajustar, el CSS deriva la altura del viewBox.
  // Algunos renderers indican su tamaño natural en style en vez de en atributos.
  const naturalWidth = (parsed.documentElement as unknown as SVGElement).style?.width || parsed.documentElement.getAttribute("width");
  if (naturalWidth && LENGTH.test(naturalWidth) && Number.isFinite(parseFloat(naturalWidth)) && parseFloat(naturalWidth) > 0) svg.setAttribute("width", naturalWidth);
  else svg.setAttribute("width", svg.viewBox.baseVal.width.toString());
  if (language === "tikz") {
    // La fuente normal del motor TeX fijado mide 10 unidades de viewBox. El KaTeX del chat usa
    // 1.21em, así que se escala todo el diagrama a ese mismo tamaño de fuente relativo al texto.
    // Las unidades em siguen los cambios del texto circundante sin observadores JS ni trabajo de TeX;
    // los tamaños de fuente relativos escritos, la geometría y el viewBox ajustado quedan intactos.
    svg.setAttribute("width", `${svg.viewBox.baseVal.width * (1.21 / 10)}em`);
  }
  svg.removeAttribute("height");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Solo se añaden declaraciones de apariencia propias del plugin, tras reconstruir el
  // árbol no fiable y antes de la comprobación final de admisión de recursos con use expandidos.
  if (language) prepareInk(svg, language);
  checkReferenceBudget(svg);
  return svg;
}

/** Aplica el mismo presupuesto de salida de 2 MiB al contenido con use
 * expandidos, sin expandirlo. La memoización más un conjunto de visitados
 * rechazan ciclos y bombas de referencias acíclicas con un trabajo lineal
 * sobre el grafo; la aritmética saturada se detiene en el tope de salida
 * existente.
 */
function checkReferenceBudget(svg: SVGSVGElement): void {
  const targets = new Map<string, Element>();
  if (svg.id) targets.set(svg.id, svg);
  for (const element of svg.querySelectorAll("[id]")) if (!targets.has(element.id)) targets.set(element.id, element);
  const memo = new Map<Node, number>();
  const visiting = new Set<Node>();
  const encoder = new TextEncoder();
  function size(node: Node): number {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    if (visiting.has(node)) throw new Error("Cyclic SVG references are not supported.");
    visiting.add(node);
    let cost = node.nodeType === Node.TEXT_NODE ? encoder.encode(node.textContent ?? "").byteLength : 0;
    const add = (amount: number) => {
      cost = Math.min(SVG_LIMIT + 1, cost + amount);
      if (cost > SVG_LIMIT) throw new Error("SVG references exceed the 2 MiB expanded output limit.");
    };
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      add(element.localName.length * 2 + 5);
      for (const attribute of element.attributes) add(attribute.name.length + 4 + encoder.encode(attribute.value).byteLength);
      for (const child of node.childNodes) add(size(child));
      if (element.localName === "use") {
        const href = element.getAttribute("href");
        const target = href?.startsWith("#") ? targets.get(href.slice(1)) : undefined;
        if (target) add(size(target));
      }
    }
    visiting.delete(node); memo.set(node, cost);
    return cost;
  }
  size(svg);
}
