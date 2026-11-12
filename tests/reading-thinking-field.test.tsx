import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingThinkingField } from "../components/reading-thinking.tsx";

describe("the reading-thinking field (owner round, 2026-10-07)", () => {
	it("carries vertical padding — the 1px-scrollbar absorption", () => {
		const html = renderToStaticMarkup(
			<ReadingThinkingField value="" revision={0} onChange={() => {}} claim={false} />,
		);
		// El arreglo (diagnosticado de forma empírica): la caja de fuente de Source Sans 3 (22px a
		// 16px) supera en 1px la caja de línea de 20px de lh-input; Chromium lo cuenta
		// en scrollHeight y un textarea con field-sizing y sin relleno se convierte en un
		// scroll permanente de 1px (una barra visible vacía Y en cada expansión por debajo de
		// max-h). py-0.5 lo absorbe; los campos del compositor/dock reciben la misma
		// absorción implícita de py-2. La altura de línea se queda en 1.25 (ley del cursor).
		assert.ok(html.includes("py-0.5"), "the vertical padding is on the textarea");
		// El tope sobrevive: crecer más allá de max-h-40 sigue haciendo scroll honestamente.
		assert.ok(html.includes("max-h-40"), "the 160px growth cap stays");
	});
});
