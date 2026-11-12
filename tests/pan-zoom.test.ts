/**
 * Pruebas puras de las matemáticas compartidas del viewport de desplazamiento/zoom (components/pan-zoom.ts),
 * extraídas de la ventana emergente del plan para que el overlay de foco de mermaid ejecute la misma
 * geometría de suelo de encaje: con el zoom al mínimo ES el encaje, el desplazamiento se bloquea en el
 * suelo (y se recentra), la rueda hace zoom hacia el cursor, techo 4×. Cobertura de
 * funciones puras: sin DOM, sin renderizado (el cableado vivo del puntero de los overlays
 * se ejercita en el navegador; estas pruebas fijan las matemáticas que ejecuta).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIT_ZOOM_MAX, ZOOM_MAX, fitGraphView, fitZoomFor, zoomedGraphView } from "../components/pan-zoom.ts";

describe("fitZoomFor", () => {
	it("binds on the axis that runs out of room (wide box → width)", () => {
		assert.equal(fitZoomFor({ w: 800, h: 400 }, { w: 400, h: 300 }), 384 / 800);
	});

	it("binds on height for a tall box", () => {
		assert.equal(fitZoomFor({ w: 400, h: 800 }, { w: 400, h: 300 }), 284 / 800);
	});

	it("caps the fit at FIT_ZOOM_MAX — a tiny box must not blow up", () => {
		assert.equal(fitZoomFor({ w: 50, h: 50 }, { w: 1000, h: 1000 }), FIT_ZOOM_MAX);
	});

	it("degenerate viewport (zero-sized) renders at 1×", () => {
		assert.equal(fitZoomFor({ w: 400, h: 300 }, { w: 0, h: 0 }), 1);
	});
});

describe("fitGraphView", () => {
	it("centers the box at the given zoom", () => {
		assert.deepEqual(fitGraphView({ w: 800, h: 400 }, { w: 400, h: 300 }, 0.5), {
			x: (400 - 400) / 2,
			y: (300 - 200) / 2,
			zoom: 0.5,
		});
	});
});

describe("zoomedGraphView", () => {
	const box = { w: 800, h: 400 };
	const viewport = { w: 400, h: 300 };
	const floor = fitZoomFor(box, viewport);

	it("zooms to the focus point: the focus stays visually fixed", () => {
		const out = zoomedGraphView({ x: 0, y: 0, zoom: 1 }, 1.25, floor, { x: 200, y: 150 }, box, viewport);
		assert.equal(out.zoom, 1.25);
		// focus.x - x_out = (focus.x - x_in) * k → el cursor hace de ancla.
		assert.equal(200 - out.x, 200 * 1.25);
		assert.equal(150 - out.y, 150 * 1.25);
	});

	it("clamps at the floor and re-fits + RE-CENTERS (the fit is the floor)", () => {
		const nearFloor = { x: -100, y: 40, zoom: floor * 1.1 };
		const out = zoomedGraphView(nearFloor, 0.5, floor, { x: 200, y: 150 }, box, viewport);
		assert.deepEqual(out, fitGraphView(box, viewport, floor));
	});

	it("clamps at ZOOM_MAX", () => {
		const atMax = { x: 0, y: 0, zoom: ZOOM_MAX };
		const out = zoomedGraphView(atMax, 2, floor, { x: 200, y: 150 }, box, viewport);
		assert.deepEqual(out, atMax);
	});

	it("no-ops when the factor lands exactly on the current zoom", () => {
		const view = { x: -37, y: 12, zoom: 1 };
		const out = zoomedGraphView(view, 1, floor, { x: 0, y: 0 }, box, viewport);
		assert.equal(out, view);
	});
});
