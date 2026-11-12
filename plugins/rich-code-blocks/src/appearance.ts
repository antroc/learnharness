import type { Language } from "./contract.ts";

// Las variables distintas conservan la pintura original cuando una máscara usa una definición,
// mientras que la tinta visible normal hereda el color Text del tema del host.
const NEUTRALS = [
  { color: "rgb(0, 0, 0)", original: "#000000", variable: "--rich-code-blocks-black" },
  { color: "rgb(34, 34, 34)", original: "#222222", variable: "--rich-code-blocks-carbon" },
  { color: "rgb(102, 102, 102)", original: "#666666", variable: "--rich-code-blocks-hydrogen" },
] as const;

/** Aplica el tema solo a un árbol recién saneado. No se admite CSS escrito
 * por el modelo. La pintura con color, los rellenos blancos, la opacidad y
 * el enmascarado estructural quedan intactos. Los degradados/patrones de
 * TikZ son ilustración intencionada, no tinta neutra normal; los degradados
 * de SMILES, en cambio, llevan la paleta de enlaces/átomos y deben seguir su
 * tinta.
 */
export function prepareInk(svg: SVGSVGElement, language: Language): void {
  const elements = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const protectedElements = new Set<Element>();
  function inherited(element: Element, name: string, fallback: string): string {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = node.getAttribute(name);
      if (!value || ["inherit", "unset"].includes(value.toLowerCase())) continue;
      if (value.toLowerCase() === "currentcolor") {
        if (name === "color") continue;
        return inherited(element, "color", "#000000");
      }
      return value.toLowerCase() === "initial" ? fallback : value;
    }
    return fallback;
  }
  // Captura todas las pinturas heredadas originales ANTES de modificar ningún ancestro. La
  // luminancia de la máscara no debe cambiar cuando la tinta visible sigue al Text del tema. Congelar
  // la herencia de los servidores de pintura conserva también los degradados y patrones escritos.
  const protectedRoots = elements.filter(element => element.localName === "mask" ||
    (language !== "smiles" && ["linearGradient", "radialGradient", "pattern"].includes(element.localName)))
    .map(element => ({ element, color: inherited(element, "color", "#000000"), fill: inherited(element, "fill", "#000000"), stroke: inherited(element, "stroke", "none") }));
  for (const { element, color, fill, stroke } of protectedRoots) {
    protectedElements.add(element);
    for (const child of element.querySelectorAll("*")) protectedElements.add(child);
    element.setAttribute("color", color);
    // currentColor necesita el color original congelado, no la tinta de la transcripción.
    if (!element.hasAttribute("fill")) element.setAttribute("fill", fill);
    if (!element.hasAttribute("stroke")) element.setAttribute("stroke", stroke);
    for (const neutral of NEUTRALS) element.style.setProperty(neutral.variable, neutral.original);
  }
  const parser = document.createElement("span").style;
  const palette = language === "smiles" ? NEUTRALS : NEUTRALS.slice(0, 1);
  for (const element of elements) {
    if (protectedElements.has(element)) continue;
    for (const attribute of ["fill", "stroke", "color", "stop-color"]) {
      const paint = element.getAttribute(attribute);
      if (!paint) continue;
      parser.color = ""; parser.color = paint;
      const canonical = parser.color === "black" ? "rgb(0, 0, 0)" : parser.color;
      const neutral = palette.find(entry => entry.color === canonical);
      if (neutral) element.setAttribute(attribute, `var(${neutral.variable})`);
    }
  }
  // El relleno implícito de SVG es negro, sea cual sea el color CSS heredado.
  if (!svg.hasAttribute("fill")) svg.setAttribute("fill", "var(--rich-code-blocks-black)");
}
