/**
 * La tarjeta de entrada de herramienta EN VIVO (responsable, ronda de streaming
 * del 2026-10-01): el aspecto de una llamada a herramienta mientras el agente la
 * escribe: spinner Braille + etiqueta de actividad con brillo en la cabecera (el
 * texto de la línea inferior retirada, una sola receta de destello), con la
 * entrada en streaming visible al desplegar. Estas fijaciones sostienen la
 * gramática del estado de trabajo en la tarjeta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveToolCard } from "../components/artifacts/live-tool-card.tsx";

function part(tool: string, input: unknown) {
	return { type: `tool-${tool}`, toolCallId: "c1", state: "input-streaming", input };
}

describe("LiveToolCard (the working-state grammar)", () => {
	it("spinner + shimmered activity label + headline arg, input on expand", () => {
		const html = renderToStaticMarkup(<LiveToolCard part={part("read", { path: "notes.md" }) as never} />);
		assert.match(html, /data-testid="live-tool-card"/);
		assert.match(html, /data-testid="braille-spinner"/);
		// la etiqueta nombra la herramienta REAL (el texto de la antigua línea inferior)
		assert.match(html, /Reading a file…/);
		// el argumento principal va en la cabecera
		assert.match(html, /notes\.md/);
		// la entrada en streaming se muestra en el cuerpo desplegable
		assert.match(html, /Input \(streaming\)/);
		assert.match(html, /notes\.md/);
	});

	it("unknown tools stay generic; jobs get their dispatch labels", () => {
		assert.match(renderToStaticMarkup(<LiveToolCard part={part("mystery_tool", {}) as never} />), /Working…/);
		assert.match(
			renderToStaticMarkup(<LiveToolCard part={part("research", { query: "x" }) as never} />),
			/Dispatching research…/,
		);
	});

	it("no input yet renders a placeholder, not an empty pre", () => {
		const html = renderToStaticMarkup(<LiveToolCard part={part("grep", undefined) as never} />);
		assert.match(html, /<pre[^>]*>…<\/pre>/);
	});
});
