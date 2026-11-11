/**
 * El ÚNICO renderizador de mermaid de la app (la oleada de fundido del cromo,
 * 2026-09-19): tanto el bloque del chat (components/md-blocks.tsx) como el
 * overlay de foco con ámbito de sesión (components/session-overlay.tsx)
 * renderizan los diagramas a través de este módulo — una configuración por
 * modo renderizado, una instancia del plugin, ids de render únicos. Esto
 * SUSTITUYE por completo la ruta interna de mermaid de streamdown: su portal
 * de pantalla completa estaba fijado a `fixed inset-0` (tapando la barra de
 * arrastre de la ventana, con la X cayendo en territorio de arrastre) sin
 * ningún gancho de estilo, que es lo que motivó el componente propio desde
 * el principio.
 */

import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";
import type { RenderedMode } from "@/src/core";

/** El tamaño de fuente base del diagrama (px) — mermaid dimensiona TODO el
 *  texto en relación con él, así que es el número por el que divide el tope
 *  de ancho de visualización (md-blocks): un diagrama mostrado a su ancho
 *  natural renderiza el texto exactamente a este tamaño. Fijado de forma
 *  explícita para que un cambio en el valor por defecto de mermaid no pueda
 *  mover el tope en silencio (regla del responsable, oleada de retoques del
 *  fundido del cromo, 2026-09-19: el texto de un diagrama nunca debe verse
 *  más grande que el propio texto de la sesión). */
export const MERMAID_FONT_SIZE = 16;

// Los diagramas siguen el modo renderizado (oleada del modo claro, 2026-10-29):
// el tema oscuro de mermaid en oscuro, su tema por defecto en claro. Quien
// llama pasa el resolvedMode del proveedor y vuelve a renderizar cuando cambia.
// (Movido desde ai-elements/message.tsx cuando el renderizador pasó a ser de
// la app; la vieja conexión mediante la prop `mermaid` está retirada.)
export function mermaidConfig(mode: RenderedMode): MermaidConfig {
	return {
		fontFamily: "ui-sans-serif, system-ui, sans-serif",
		fontSize: MERMAID_FONT_SIZE,
		securityLevel: "strict",
		theme: mode === "dark" ? "dark" : "default",
	};
}

const plugin = createMermaidPlugin();

/** Renderiza el código de un diagrama a una cadena svg. El id es único por
 *  llamada — mermaid guarda en caché los ids renderizados, y un id repetido
 *  entre diagramas/renders devuelve el svg obsoleto (el fallo que evita la
 *  propia generación de ids de streamdown). */
export async function renderMermaid(chart: string, mode: RenderedMode): Promise<string> {
	const id = `lh-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
	const { svg } = await plugin.getMermaid(mermaidConfig(mode)).render(id, chart);
	return svg;
}
