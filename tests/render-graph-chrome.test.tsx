/**
 * Fijaciones del adorno con el grafo vacío (oleada del adorno con grafo vacío,
 * responsable 2026-09-25): Import Notes se renderiza SIEMPRE: la única acción
 * que funciona con un grafo vacío, el propio punto de entrada; la búsqueda y
 * los ajustes solo se renderizan cuando la instantánea tiene nodos (los
 * controles muertos son mentiras: el principio de honestidad). GraphChromeRow
 * es la frontera pura (el patrón de DeleteNodeBody): el SSR de los dos estados
 * fija la decisión. Las peticiones no se ejecutan con renderToStaticMarkup (los
 * efectos nunca se disparan), así que estas fijaciones ejercitan el componente
 * directamente.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderWithInteractionLayers as renderToStaticMarkup } from "./interaction-layer-render.tsx";
import { GraphChromeRow, GraphView } from "../components/graph-view.tsx";
import type { GraphRenderSettings } from "../components/graph-canvas.ts";
import { ServerEventsProvider } from "../components/server-events.tsx";

/** Dobles de refs: el arnés SSR nunca los asigna. */
const ref = { current: null };

const PROPS = {
	query: "",
	onQuery: () => {},
	noMatch: false,
	importing: false,
	searchInputRef: ref,
	onImportFiles: () => {},
	settings: {} as GraphRenderSettings,
	changeSettings: () => {},
	onOpenChains: () => {},
};

describe("GraphChromeRow — the empty-graph ruling (owner, 2026-09-25)", () => {
	it("EMPTY graph: Import and source inventory render; canvas search/settings stay absent", () => {
		const html = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: true }));
		assert.ok(html.includes('data-testid="import-notes"'));
		assert.ok(html.includes("Extract files…"));
		assert.ok(html.includes("lucide-waypoints"));
		assert.ok(!html.includes("lucide-upload"));
		assert.ok(!html.includes("Search nodes…"), "search is a lie on an empty graph");
		// el engranaje de ajustes es el svg lucide-settings (oleada de tooltips: su antiguo
		// title nativo ha desaparecido; ahora la etiqueta la lleva el tooltip con estilo)
		assert.ok(!html.includes("lucide-settings"), "settings is a lie on an empty graph");
		assert.ok(html.includes('data-testid="open-chain-table"'), "source inventory includes chats/files without graph nodes");
		assert.equal(html.split("graph-chrome-fade-in").length - 1, 1, "only the inventory button has the appearance animation");
	});

	it("empty graph uses the same session-first lead and secondary material guidance as home", () => {
		const html = renderToStaticMarkup(createElement(ServerEventsProvider, { children: createElement(GraphView, {}) }));
		assert.ok(html.includes("<p>Start a session to begin learning.</p>"));
		assert.ok(html.includes("Attach your material with the paperclip or drag and drop.</p>"));
		assert.ok(!html.includes("import notes to build"));
	});

	it("POPULATED graph: all four render, the gated trio carries the fade", () => {
		const html = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: false }));
		assert.ok(html.includes('data-testid="import-notes"'));
		assert.ok(html.includes("Search nodes…"));
		assert.ok(html.includes("lucide-settings"), "the settings gear renders");
		assert.ok(html.includes('data-testid="open-chain-table"'), "the chains entry renders");
		// el fundido de aparición única va exactamente en los tres controles condicionados, nunca en Import Notes
		assert.equal(html.split("graph-chrome-fade-in").length - 1, 3, "three fade carriers: search + chains + settings");
	});

	it("the no-match note renders only when the wrapper says so (its truth stays upstream)", () => {
		const html = renderToStaticMarkup(
			createElement(GraphChromeRow, { ...PROPS, isEmpty: false, query: "zzz", noMatch: true }),
		);
		assert.ok(html.includes("No matching nodes."));
		const quiet = renderToStaticMarkup(
			createElement(GraphChromeRow, { ...PROPS, isEmpty: false, query: "zzz", noMatch: false }),
		);
		assert.ok(!quiet.includes("No matching nodes."));
	});
});