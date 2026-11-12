import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMenuPlacement, menuAnchorRect, type MenuSide } from "../components/menu-shell.tsx";

/**
 * La decisión de colocación del armazón de menú compartido (fragmento B de la oleada de arreglos): las
 * matemáticas puras detrás del anclaje de todos los desplegables: preferencia de lado, el
 * volteo cuando cabe de verdad, el tope de 60vh, la alineación. Los efectos del DOM (portal,
 * medir y luego mostrar, recolocación al hacer scroll/redimensionar) se verifican en vivo;
 * esto fija la geometría.
 */

const rect = (top: number, bottom: number) => ({ top, bottom, left: 100, right: 300 });
const viewport = (height: number) => ({ width: 1280, height });

describe("computeMenuPlacement — side", () => {
	it("keeps the preferred side when it shows the whole menu", () => {
		for (const preferred of ["up", "down"] as MenuSide[]) {
			const p = computeMenuPlacement(rect(400, 440), viewport(800), 300, preferred, "right");
			assert.equal(p.side, preferred);
		}
	});

	it("flips when the preferred side cannot hold the content and the other is roomier", () => {
		// Ancla a 30px del borde inferior del viewport: hacia abajo hay ~2px de espacio,
		// hacia arriba ~380. Un menú de 300px debe voltearse HACIA ARRIBA aunque prefiera abajo.
		const p = computeMenuPlacement(rect(770, 800), viewport(800), 300, "down", "right");
		assert.equal(p.side, "up");
		// ...y a la inversa: un ancla arriba del todo que prefiere arriba se voltea hacia abajo.
		const q = computeMenuPlacement(rect(0, 30), viewport(800), 300, "up", "right");
		assert.equal(q.side, "down");
	});

	it("stays put when neither side fits better (the roomier side already preferred)", () => {
		// Viewport bajo: hacia abajo hay 450 y hacia arriba 200; un menú de 600px se queda
		// abajo (con el tope aplicado con elegancia) porque arriba NO hay más espacio.
		const p = computeMenuPlacement(rect(150, 190), viewport(650), 600, "down", "right");
		assert.equal(p.side, "down");
	});

	it("nothing measured yet (contentHeight ≤ 0) keeps the preferred side", () => {
		const p = computeMenuPlacement(rect(770, 800), viewport(800), 0, "down", "right");
		assert.equal(p.side, "down");
	});
});

describe("computeMenuPlacement — cap + position", () => {
	it("caps at 60vh when the side has more room than that", () => {
		// Ancla alta: 648px por debajo, más que 60vh(480) → el tope es 60vh.
		const p = computeMenuPlacement(rect(100, 140), viewport(800), 300, "down", "right");
		assert.equal(p.maxHeight, 0.6 * 800);
		assert.equal(p.style.top, 144); // parte inferior del ancla + GAP(4)
		assert.equal(p.style.right, 1280 - 300); // alineado a la derecha con el ancla
	});

	it("caps at the side's available room when 60vh exceeds it", () => {
		// Ancla en 500/800: espacio hacia abajo = 800 − 8 − 544 = 248 < 480. El
		// contenido corto (100) cabe abajo (sin volteo), así que el tope actúa en 248.
		const p = computeMenuPlacement(rect(500, 540), viewport(800), 100, "down", "right");
		assert.equal(p.side, "down");
		assert.equal(p.maxHeight, 248);
	});

	it("never crushes below the usability floor, even against a tiny side", () => {
		// Ancla a 30px del fondo, ambos lados estrechos: se acota al
		// suelo, no a una astilla de 2px; el tope desborda en vez de aplastar.
		const p = computeMenuPlacement(rect(30, 60), viewport(90), 300, "down", "right");
		assert.equal(p.maxHeight, 96);
	});

	it("up-side menus anchor their BOTTOM above the anchor's top", () => {
		const p = computeMenuPlacement(rect(400, 440), viewport(800), 300, "up", "right");
		assert.equal(p.style.bottom, 800 - 400 + 4); // viewport − anchor.top − GAP
		assert.ok(!("top" in p.style));
	});

	it("left alignment keys off the anchor's left edge", () => {
		const p = computeMenuPlacement(rect(400, 440), viewport(800), 300, "down", "left");
		assert.equal(p.style.left, 100);
		assert.ok(!("right" in p.style));
	});
});
describe("menuAnchorRect — the anchor seam", () => {
	const doc = { querySelector: () => ({ getBoundingClientRect: () => ({ top: 1, bottom: 2, left: 3, right: 4 }) }) } as unknown as Pick<Document, "querySelector">;
	it("prefers a virtual anchor rect when it yields one", () => {
		assert.deepEqual(menuAnchorRect({ getAnchorRect: () => ({ top: 10, bottom: 20, left: 30, right: 40 }), anchorTestid: "x" }, doc), { top: 10, bottom: 20, left: 30, right: 40 });
	});
	it("falls back to the element seam when the virtual anchor is gone", () => {
		assert.deepEqual(menuAnchorRect({ getAnchorRect: () => null, anchorTestid: "x" }, doc), { top: 1, bottom: 2, left: 3, right: 4 });
	});
	it("is null with no anchor at all", () => {
		assert.equal(menuAnchorRect({}, doc), null);
	});
});
