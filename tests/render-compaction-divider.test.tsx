/**
 * LOS DIVISORES DE COMPACTACIÓN: fijaciones de render SSR (ronda 14 del
 * responsable; inertes desde el pulido de la release del 2026-10-06). Dos
 * superficies regladas a partir de un marcador: el divisor del MOMENTO (texto
 * pequeño centrado y mínimo, el registro del mensaje de reintento, sin rayas)
 * donde está el usuario cuando llega la compactación, y el divisor del CORTE
 * (el más largo: geometría de phase-divider, rayas punteadas + una etiqueta con
 * el recuento de tokens resumidos) en el límite conservado.
 *
 * NO SE PUEDE VER (responsable, 2026-10-06): el diálogo del resumen ha
 * desaparecido: el contenido de la compactación es fontanería de cara al
 * modelo; quien quiera inspeccionarlo lee los registros de su proveedor. Las
 * fijaciones de abajo mantienen los divisores INERTES: marcado simple, sin
 * botón, sin indicación, y el texto del resumen del marcador nunca llega al DOM.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
	CompactionCutDivider,
	CompactionMomentDivider,
	type CompactionDividerData,
} from "../components/compaction-divider.tsx";

const data: CompactionDividerData = {
	content: "[SESSION HISTORY COMPACTED]\n\nTHE LEARNER'S UNDERSTANDING: …",
	details: {
		firstKeptMessageId: "kept_1",
		tokensBefore: 152000,
		at: "2026-10-05T00:00:00.000Z",
	},
};

const INERT = ["no click affordance survives the 2026-10-06 ruling"];

describe("CompactionMomentDivider", () => {
	it("renders the minimal centered note — no rule lines, retrying-message register", () => {
		const html = renderToStaticMarkup(<CompactionMomentDivider data={data} />);
		assert.ok(html.includes('data-testid="compaction-divider"'));
		assert.ok(html.includes("Context compacted"));
		// SIN raya horizontal (la decisión del responsable: mínimo, a diferencia del corte)
		assert.ok(!html.includes("border-t-2"));
	});
});

describe("CompactionCutDivider", () => {
	it("renders the longer seam — dotted rules + chip with the token count", () => {
		const html = renderToStaticMarkup(<CompactionCutDivider data={data} />);
		assert.ok(html.includes('data-testid="compaction-cut-divider"'));
		assert.ok(html.includes("border-t-2 border-dotted"));
		assert.ok(html.includes("History compacted"));
		// 152000 → 152k tok
		assert.ok(html.includes("152k tok"));
	});
});

describe("not viewable (owner, release polish 2026-10-06)", () => {
	it("neither divider is a button — plain markup, no click affordance", () => {
		for (const html of [
			renderToStaticMarkup(<CompactionMomentDivider data={data} />),
			renderToStaticMarkup(<CompactionCutDivider data={data} />),
		]) {
			assert.ok(!html.includes("<button"), INERT[0]);
			assert.ok(!html.includes("cursor-pointer"), INERT[0]);
		}
	});

	it("the marker's summary text never reaches the DOM — provider logs are the inspection path", () => {
		for (const html of [
			renderToStaticMarkup(<CompactionMomentDivider data={data} />),
			renderToStaticMarkup(<CompactionCutDivider data={data} />),
		]) {
			assert.ok(!html.includes("[SESSION HISTORY COMPACTED]"), "the header stays out");
			assert.ok(!html.includes("THE LEARNER"), "the summary stays out");
		}
	});
});
