/**
 * Las superficies que tenían el modo oscuro escrito a fuego (oleada del modo claro, 2026-10-29): cada una
 * lee ahora la paleta activa o el modo renderizado.
 */

import React from "react";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { confidenceRailStyle } from "../components/confidence-rail.tsx";
import { mermaidConfig } from "../components/mermaid-render.ts";
import { CLUSTER_LIGHTNESS } from "../components/graph-canvas.ts";
import { LhMark } from "../components/lh-mark.tsx";

describe("confidence rail", () => {
	it("sits on the page background, ticks in the foreground ink", () => {
		const style = confidenceRailStyle(50);
		assert.equal(style.backgroundColor, "var(--background)");
		const tick = "color-mix(in oklab, var(--foreground) 35%, transparent)";
		assert.ok(String(style.backgroundImage).includes(`linear-gradient(90deg, ${tick}, ${tick})`));
		assert.ok(!String(style.backgroundImage).includes("rgba(230,230,230"));
	});
});

describe("mermaid", () => {
	it("dark mode renders mermaid's dark theme, light its default", () => {
		assert.equal(mermaidConfig("dark").theme, "dark");
		assert.equal(mermaidConfig("light").theme, "default");
		assert.equal(mermaidConfig("light").securityLevel, "strict");
	});
});

describe("graph clusters", () => {
	it("dark keeps today's lightness; light darkens rings and labels", () => {
		assert.deepEqual(CLUSTER_LIGHTNESS.dark, { ring: 60, label: 78 });
		assert.ok(CLUSTER_LIGHTNESS.light.ring < CLUSTER_LIGHTNESS.dark.ring);
		assert.ok(CLUSTER_LIGHTNESS.light.label < CLUSTER_LIGHTNESS.dark.label);
	});
});

describe("LH mark", () => {
	it("the ring follows the strong line ink; the spiral gray stays", () => {
		const html = renderToStaticMarkup(<LhMark />);
		assert.equal((html.match(/fill:var\(--lh-line-strong\)/g) ?? []).length, 2);
		assert.ok(!html.includes("#fff"));
		assert.ok(html.includes("rgb(148,148,148)"));
	});
});
