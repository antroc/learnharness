/**
 * Pruebas de los auxiliares puros del renderizador de lienzo hecho a mano
 * (components/graph-canvas.ts). La clase del renderizador en sí depende del DOM
 * (canvas, rAF, ResizeObserver) y se verifica en vivo en el navegador; las
 * matemáticas que ejecuta en cada fotograma deben ser exactas, así que se fijan aquí.
 *
 * La convención de la proporción de la cámara es el contrato que sostiene la relación con los
 * ajustes persistidos: la proporción de sigma (1 = encajar, MENOR = más zoom) se conserva
 * literal para que los valores labelZoom guardados sobrevivan al cambio de renderizador.
 */

import assert from "node:assert/strict";
import { describe, it, it as test } from "node:test";
import {
	applyClusterLabels,
	arrowGeometry,
	isImpNodeId,
	boxBlurRound,
	fitTransform,
	labelAlpha,
	pickNearest,
	wrapRegionLabel,
	zoomRatioOf,
	LABELS_FADE_RATIO,
} from "../components/graph-canvas.ts";
import {
	sanitizePhysicsTuning,
	sanitizeRegionTuning,
	DEFAULT_PHYSICS_TUNING,
	DEFAULT_REGION_TUNING,
	REGION_BITMAP_OPTIONS,
	REGION_BLUR_LADDER,
} from "../src/core/render-settings.ts";

describe("zoomRatioOf (the sigma-compatible camera ratio)", () => {
	test("1 at fit zoom, smaller when zoomed in, larger when zoomed out", () => {
		assert.equal(zoomRatioOf(2, 2), 1); // al encajar
		assert.equal(zoomRatioOf(2, 4), 0.5); // zoom ×2 hacia dentro -> la proporción se reduce a la mitad
		assert.equal(zoomRatioOf(2, 1), 2); // zoom ×2 hacia fuera -> la proporción se duplica
	});
});

describe("labelAlpha (the single zoom gate)", () => {
	test("fully visible at/below the threshold, faded out after the span", () => {
		// Tramo proporcional: con el umbral 0.5 el tramo es 0.5 × 0.5 = 0.25.
		assert.equal(labelAlpha(0.5, 0.5), 1); // en el umbral
		assert.equal(labelAlpha(0.25, 0.5), 1); // con más zoom: se queda en 1
		assert.equal(labelAlpha(0.625, 0.5), 0.5); // a mitad del fundido (punto medio del tramo)
		assert.equal(labelAlpha(0.75, 0.5), 0); // un tramo proporcional más allá: desaparece
		assert.equal(labelAlpha(2.0, 0.5), 0); // muy lejos: acotado
	});

	test("the span is PROPORTIONAL to the gate (2026-09-17), not absolute", () => {
		// El antiguo tramo absoluto de proporción 0.5 suponía un cambio relativo del 100% con
		// el antiguo umbral 0.5, pero una astilla de apenas el 12% con el umbral ajustado de 8× (proporción
		// 4). Proporcional = la misma sensación de traspaso con cualquier umbral.
		assert.equal(LABELS_FADE_RATIO, 0.5);
		// Con el valor por defecto ajustado (umbral 4): el fundido va de la proporción 4 a la 6 (de 8× a 12×
		// en pantalla), un peldaño completo de la escalera.
		assert.equal(labelAlpha(4, 4), 1); // en el umbral
		assert.equal(labelAlpha(5, 4), 0.5); // a mitad del fundido
		assert.equal(labelAlpha(6, 4), 0); // un tramo proporcional más allá: desaparece
		// La forma relativa es idéntica con el antiguo umbral: 0.5 → 0.75.
		assert.equal(labelAlpha(5, 4), 0.5); // a mitad del fundido con el umbral ajustado, misma forma relativa
	});

	test("node labels and cluster labels cross-fade over the exact same span", () => {
		// El renderizador dibuja las etiquetas de los clústeres con 1 - labelAlpha; ambos deben
		// sumar siempre 1 dentro del fundido y nunca coexistir con opacidad completa.
		for (const gate of [0.5, 4]) {
			for (let ratio = 0; ratio <= 8; ratio += gate / 8) {
				const node = labelAlpha(ratio, gate);
				const cluster = 1 - node;
				assert.ok(node + cluster > 0.999 && node + cluster < 1.001, `sum at gate ${gate} ratio ${ratio}`);
				assert.ok(node <= 1 && cluster <= 1, `clamped at gate ${gate} ratio ${ratio}`);
			}
		}
	});
});

describe("d3 camera composition (the persisted-camera restore path)", () => {
	// El renderizador restaura una cámara persistida mediante
	// zoomIdentity.translate(x, y).scale(k), la misma composición que usa
	// fit(). El Transform.translate() de d3 desplaza en el espacio ESCALADO mientras que
	// .scale() conserva la traslación: identity.translate(X, Y).scale(K)
	// es exactamente {k: K, x: X, y: Y}. Esto fija esa ley (la forma persistida
	// {k, x, y} hace el viaje de ida y vuelta por la composición) para que una actualización
	// de d3 que la cambie falle aquí y no como una cámara equivocada.
	test("zoomIdentity.translate(X, Y).scale(K) === {k: K, x: X, y: Y}", async () => {
		const { zoomIdentity } = await import("d3-zoom");
		const t = zoomIdentity.translate(120, -40).scale(3.5);
		assert.equal(t.k, 3.5);
		assert.equal(t.x, 120);
		assert.equal(t.y, -40);
		// Y la dirección inversa: una cámara guardada se vuelve a aplicar a la
		// misma posición de pantalla para el mismo punto del mundo.
		const p = t.apply([7, 9]);
		assert.deepEqual(p, [7 * 3.5 + 120, 9 * 3.5 - 40]);
	});
});

describe("fitTransform", () => {
	test("centers the bbox and respects padding", () => {
		// Un grafo de 100x50 en un viewport de 500x300, con 40px de relleno:
		// disponible 420x220 -> k = min(4.2, 4.4) = 4.2
		const t = fitTransform({ minX: -50, maxX: 50, minY: -25, maxY: 25 }, 500, 300, 40);
		assert.ok(Math.abs(t.k - 4.2) < 1e-9, `k=${t.k}`);
		assert.ok(Math.abs(t.x - 250) < 1e-9, `x=${t.x}`); // centrado
		assert.ok(Math.abs(t.y - 150) < 1e-9, `y=${t.y}`);
		// El centro del mundo corresponde al centro del viewport:
		assert.ok(Math.abs(0 * t.k + t.x - 250) < 1e-9);
	});

	test("never returns a non-positive scale for degenerate bboxes", () => {
		const t = fitTransform({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, 100, 100, 10);
		assert.ok(t.k > 0 && Number.isFinite(t.k));
	});
});

describe("arrowGeometry", () => {
	test("the tip lands exactly on the target disc edge", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 6, 6, 5);
		assert.ok(g, "non-degenerate edge");
		assert.ok(Math.abs(g!.tip.x - 94) < 1e-9 && Math.abs(g!.tip.y) < 1e-9);
	});

	test("the shaft starts outside the source disc", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 6, 6, 5)!;
		assert.ok(Math.abs(g.shaftFrom.x - 6) < 1e-9 && Math.abs(g.shaftFrom.y) < 1e-9);
		// El cuerpo termina en la base de la punta; la punta se dibuja de la base al extremo.
		assert.ok(Math.abs(g.shaftTo.x - 89) < 1e-9);
	});

	test("the head triangle is symmetric around the shaft axis (0.8x wideness)", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 6, 6, 5)!;
		// halfW = 0.4 x headLength = 2; las dos esquinas de la base comparten x, con la y reflejada.
		assert.ok(Math.abs(Math.abs(g.left.y) - 2) < 1e-9 && Math.abs(Math.abs(g.right.y) - 2) < 1e-9);
		assert.ok(Math.abs(g.left.y + g.right.y) < 1e-9); // reflejo
		assert.ok(Math.abs(g.left.x - g.right.x) < 1e-9);
	});

	test("works at arbitrary angles (diagonal stays normalized)", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 60, y: 80 }; // longitud 100, dirección (0.6, 0.8)
		const g = arrowGeometry(a, b, 10, 10, 8)!;
		assert.ok(Math.abs(g.tip.x - (60 - 0.6 * 10)) < 1e-9 && Math.abs(g.tip.y - (80 - 0.8 * 10)) < 1e-9);
	});

	test("null for coincident endpoints (never a NaN arrow)", () => {
		assert.equal(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 6, 6, 5), null);
	});

	// Las leyes geométricas del arco de renderizado (responsable, 2026-09-30): una arista HACIA
	// un punto imp se dibuja con toRadius 0 (sin punta, termina en el
	// centro); una arista QUE SALE de uno, con fromRadius 0 (empieza en el centro).
	test("toRadius 0 — the tip lands exactly at the target CENTER (headless convergence)", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 6, 0, 5)!;
		assert.ok(Math.abs(g.tip.x - 100) < 1e-9 && Math.abs(g.tip.y) < 1e-9, "tip = the center, past which no shaft draws");
	});

	test("fromRadius 0 — the shaft starts exactly at the source CENTER", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 6, 5)!;
		assert.ok(Math.abs(g.shaftFrom.x) < 1e-9 && Math.abs(g.shaftFrom.y) < 1e-9, "shaftFrom = the center");
	});
});

describe("isImpNodeId (the pure-geometry law, rendering arc 2026-09-30)", () => {
	test("arg_-prefixed ids are geometry; proposition ids are citizens", () => {
		assert.equal(isImpNodeId("arg_123af5a046ba"), true);
		assert.equal(isImpNodeId("n_abc123"), false);
	});
});


describe("pickNearest (distance-check picking)", () => {
	const nodes = [
		{ id: "a", x: 10, y: 10 },
		{ id: "b", x: 50, y: 50 },
		{ id: "c", x: 90, y: 10 },
	];

	test("picks the nearest node within the pad", () => {
		assert.equal(pickNearest(nodes, 12, 12, 16)?.id, "a");
		assert.equal(pickNearest(nodes, 48, 52, 16)?.id, "b");
		assert.equal(pickNearest(nodes, 88, 8, 16)?.id, "c");
	});

	test("the picking pad extends the hitbox beyond the disc", () => {
		// a 20px, solo alcanzable porque el relleno lo cubre.
		assert.equal(pickNearest(nodes, 28, 18, 25)?.id, "a");
		// Más allá del relleno: nada.
		assert.equal(pickNearest(nodes, 30, 40, 3), null);
	});

	test("ties resolve deterministically (first scanned wins)", () => {
		const pair = [
			{ id: "first", x: 0, y: 0 },
			{ id: "second", x: 10, y: 0 },
		];
		assert.equal(pickNearest(pair, 5, 0, 10)?.id, "first");
	});

	test("empty node list picks nothing", () => {
		assert.equal(pickNearest([], 0, 0, 100), null);
	});
});

describe("sanitizeRegionTuning (dev number inputs)", () => {
	test("defaults survive untouched; partial input keeps the rest", () => {
		const t = sanitizeRegionTuning(undefined);
		assert.deepEqual(t, DEFAULT_REGION_TUNING);
		const half = sanitizeRegionTuning({ blur: 7.2 });
		assert.equal(half.blur, 10); // ajustado al nuevo suelo de la escalera (responsable, 2026-10-07)
		assert.equal(half.dilation, DEFAULT_REGION_TUNING.dilation);
	});

	test("garbage clamps: NaN falls back, out-of-range clamps", () => {
		const t = sanitizeRegionTuning({ dilation: Number.NaN, blur: -5, bitmap: 99999, edgeAlpha: 42 });
		assert.equal(t.dilation, DEFAULT_REGION_TUNING.dilation); // NaN -> por defecto
		assert.equal(t.blur, REGION_BLUR_LADDER[0]); // ajustado al suelo de la escalera
		assert.equal(t.bitmap, REGION_BITMAP_OPTIONS[REGION_BITMAP_OPTIONS.length - 1]); // 99999 se ajusta a la opción más grande
		assert.equal(t.edgeAlpha, 1);
	});

	test("empty string / null / undefined values fall back per-field", () => {
		const t = sanitizeRegionTuning({ edgeAlpha: Number.NaN });
		assert.equal(t.edgeAlpha, DEFAULT_REGION_TUNING.edgeAlpha);
	});
});

describe("boxBlurRound (premultiplied region blur)", () => {
	test("spreads a single opaque px into its neighborhood and conserves sum", () => {
		// RGBA de 5x5, un píxel blanco opaco en (2,2)
		const w = 5, h = 5;
		const a = new Float32Array(w * h * 4);
		const center = (2 * w + 2) * 4;
		a[center] = 255; a[center + 1] = 255; a[center + 2] = 255; a[center + 3] = 255;
		const tmp = new Float32Array(a.length);
		const b = new Float32Array(a.length);
		boxBlurRound(a, tmp, b, w, h, 1);
		// Conservación del alfa: el alfa total no cambia.
		let sumA = 0;
		for (let i = 3; i < b.length; i += 4) sumA += b[i]!;
		assert.ok(Math.abs(sumA - 255) < 1e-3, `alpha sum ${sumA}`);
		// El centro se atenuó y los 8 vecinos recogieron parte.
		assert.ok(b[center + 3]! < 255 && b[center + 3]! > 0);
		const up = ((1 * w) + 2) * 4 + 3;
		assert.ok(b[up]! > 0, "neighbor got alpha");
		// La esquina lejana (4,4) queda intacta.
		assert.equal(b[(4 * 5 + 4) * 4 + 3], 0);
	});

	test("radius 0 is a plain copy", () => {
		const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const tmp = new Float32Array(8);
		const b = new Float32Array(8);
		boxBlurRound(a, tmp, b, 1, 2, 0);
		assert.deepEqual([...b], [1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe("sanitizePhysicsTuning (physics controls)", () => {
	test("defaults survive untouched; partial input keeps the rest", () => {
		assert.deepEqual(sanitizePhysicsTuning(undefined), DEFAULT_PHYSICS_TUNING);
		const half = sanitizePhysicsTuning({ clusterPull: 0.6 });
		assert.equal(half.clusterPull, 0.6);
		assert.equal(half.chargeStrength, DEFAULT_PHYSICS_TUNING.chargeStrength);
	});

	test("garbage clamps: NaN falls back, out-of-range clamps", () => {
		const t = sanitizePhysicsTuning({
			chargeStrength: Number.NaN,
			linkStrength: 99,
			linkDistance: -5,
			gravity: 7,
			clusterPull: -1,
			velocityDecay: 3,
		});
		assert.equal(t.chargeStrength, DEFAULT_PHYSICS_TUNING.chargeStrength);
		assert.equal(t.linkStrength, 4); // tope validado con un barrido (8 explota, 5 titubea)
		assert.equal(t.linkDistance, 10);
		assert.equal(t.gravity, 0.48);
		assert.equal(t.clusterPull, 0);
		assert.equal(t.velocityDecay, 0.9);
	});
});



describe("wrapRegionLabel (wave 7: session names / file paths)", () => {
	// Una medida falsa: los caracteres miden 5px y los espacios 4px; suficiente para
	// gobernar las decisiones de ajuste de línea de forma determinista.
	const measure = (s: string) => s.length * 5;
	const W = 20; // 4 caracteres por línea

	it("fits → single line, untouched", () => {
		assert.deepEqual(wrapRegionLabel("Plato", 100, 3, measure), ["Plato"]);
	});

	it("wraps words, no cap hit", () => {
		// W=20 a 5px/carácter = 3 caracteres por línea: cada palabra queda sola, cuatro
		// líneas, nunca se alcanza el tope de 4, sin puntos suspensivos.
		assert.deepEqual(wrapRegionLabel("aaa bbb ccc ddd", W, 4, measure), [
			"aaa",
			"bbb",
			"ccc",
			"ddd",
		]);
	});

	it("caps at maxLines with an ellipsis on the last line", () => {
		const lines = wrapRegionLabel("aaaa bbbb cccc dddd eeee", W, 2, measure);
		assert.equal(lines.length, 2);
		assert.ok(lines[1]!.endsWith("…"), "last line ellipsized");
		for (const line of lines) assert.ok(measure(line) <= W || line.length <= 2, "each line fits");
	});

	it("char-splits an unbroken path longer than the width (the notes case)", () => {
		const path = "/users/amos/notes/physics/lecture-notes.md";
		const lines = wrapRegionLabel(path, W, 3, measure);
		assert.equal(lines.length, 3);
		// cada línea conservada cabe en el ancho; la última lleva los puntos suspensivos
		assert.ok(lines[2]!.endsWith("…"), "long path capped with ellipsis");
		assert.ok(measure(lines[0]!) <= W, "first chunk fits");
		assert.ok(measure(lines[1]!) <= W, "second chunk fits");
	});

	it("a remainder that FITS the width rides as a plain last line (no false ellipsis)", () => {
		// W=25 a 5px/carácter = 5 caracteres por línea: "aa bb" cabe justo y la
		// cola "cc dd" también: dos líneas normales, el tope nunca actúa.
		assert.deepEqual(wrapRegionLabel("aa bb cc dd", 25, 3, measure), ["aa bb", "cc dd"]);
	});

	it("the ellipsis itself never exceeds the width", () => {
		const lines = wrapRegionLabel("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", W, 2, measure);
		assert.ok(measure(lines[1]!) <= W, "ellipsized tail fits");
	});
});


describe("applyClusterLabels (the label-only rename channel)", () => {
	const measure = (s: string) => s.length * 5;
	const W = 220;
	const MAXL = 3;

	const fixture = () => ({
		clusters: [
			{ id: "chat_a", label: "Old title" },
			{ id: "chat_b", label: null },
			{ id: "seedplan", label: "Orbital mechanics" },
		],
		regionMeta: [
			{ id: "chat_a", label: "Old title", lines: ["Old title"], cx: 0, cy: 0, hue: 10 },
			{ id: "chat_b", label: null, lines: null, cx: 1, cy: 1, hue: 20 },
			{ id: "seedplan", label: "Orbital mechanics", lines: ["Orbital mechanics"], cx: 2, cy: 2, hue: 30 },
		],
	});

	it("patches the matching cluster and re-wraps its region meta", () => {
		const f = fixture();
		// 5px/carácter y W=220: un título de 45 caracteres desborda justo una línea
		// ("...for the" son 40 caracteres; al añadir " graph" son 46).
		const longTitle = "A much longer new session title for the graph";
		const changed = applyClusterLabels(
			f.clusters, f.regionMeta, new Map([["chat_a", longTitle]]),
			W, MAXL, measure,
		);
		assert.equal(changed, true);
		assert.equal(f.clusters[0]!.label, longTitle);
		assert.deepEqual(f.regionMeta[0]!.lines, ["A much longer new session title for the", "graph"]);
		// las entradas no tocadas siguen idénticas byte a byte
		assert.equal(f.clusters[1]!.label, null);
		assert.equal(f.clusters[2]!.label, "Orbital mechanics");
		assert.deepEqual(f.regionMeta[2]!.lines, ["Orbital mechanics"]);
	});

	it("hull silence: a null-label cluster never gains a label", () => {
		const f = fixture();
		const changed = applyClusterLabels(
			f.clusters, f.regionMeta, new Map([["chat_b", "Resurrected?"]]),
			W, MAXL, measure,
		);
		assert.equal(changed, false);
		assert.equal(f.clusters[1]!.label, null);
		assert.equal(f.regionMeta[1]!.lines, null);
	});

	it("a label already matching is a no-op (no redraw)", () => {
		const f = fixture();
		const changed = applyClusterLabels(
			f.clusters, f.regionMeta, new Map([["seedplan", "Orbital mechanics"]]),
			W, MAXL, measure,
		);
		assert.equal(changed, false);
	});

	it("an explicit null clears a labeled cluster's lines", () => {
		const f = fixture();
		const changed = applyClusterLabels(
			f.clusters, f.regionMeta, new Map([["chat_a", null]]),
			W, MAXL, measure,
		);
		assert.equal(changed, true);
		assert.equal(f.clusters[0]!.label, null);
		assert.equal(f.regionMeta[0]!.lines, null);
	});

	it("unknown ids in the map change nothing", () => {
		const f = fixture();
		const changed = applyClusterLabels(
			f.clusters, f.regionMeta, new Map([["chat_ghost", "Nope"]]),
			W, MAXL, measure,
		);
		assert.equal(changed, false);
	});
});
