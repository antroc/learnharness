import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
const renderToStaticMarkup = (node: ReactNode) => renderMarkup(<InteractionLayersProvider>{node}</InteractionLayersProvider>);
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	PlanBlock,
	PlanPopup,
	blockLayout,
	topoFor,
	edgePathD,
	wrapTitle,
	GAP_X,
	NODE_H,
	NODE_W_MIN,
	nodeWidth,
	estimateLineWidth,
	type PopupMessage,
} from "../components/plan-block.tsx";
import type { PlanBlockData, PlanTree } from "../src/core/contracts.ts";

// Bloques de plan: el layout puro por capas, el render de la instantánea congelada
// (full = sin borde + llenando la columna
// con el actual brillando) y la derivación EN VIVO de la ventana emergente.

const CHAIN: PlanTree = {
	nodes: [
		{ id: "a", title: "Alpha node" },
		{ id: "b", title: "Beta node" },
		{ id: "c", title: "Gamma node" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
	],
	version: 1,
};

describe("plan block layout (pure)", () => {
	it("layers a chain top-down, one node per depth row", () => {
		const { order, depth } = topoFor(CHAIN.nodes, CHAIN.edges);
		assert.deepEqual(order.map((n) => n.id), ["a", "b", "c"]);
		assert.equal(depth.get("c"), 2);
		const layout = blockLayout(CHAIN.nodes, CHAIN.edges);
		// Tamaño a partir del texto (responsable, ronda de ceñido del plan 2026-10-07): estos
		// títulos cortos se ciñen al mínimo: se acabaron los bloques fijos de 160px.
		const W = nodeWidth(wrapTitle("Alpha node"));
		assert.equal(W, NODE_W_MIN); // est ≈ 50 → se queda en el mínimo
		// Los tres títulos cortos se quedan en el suelo: la extensión es el propio suelo.
		assert.equal(nodeWidth(wrapTitle("Gamma node")), NODE_W_MIN); // est ≈ 59.9
		assert.equal(layout.width, NODE_W_MIN);
		assert.equal(layout.height, 3 * NODE_H + 2 * 48);
		assert.equal(layout.nodeW.get("a"), W);
	});

	it("centers same-depth nodes over the widest row; tolerates dangling edges", () => {
		const nodes = [
			{ id: "r", title: "Root" },
			{ id: "x", title: "Left" },
			{ id: "y", title: "Right" },
		];
		const layout = blockLayout(nodes, [
			{ from: "r", to: "x" },
			{ from: "r", to: "y" },
			{ from: "ghost", to: "r" }, // colgante: se ignora por precaución
		]);
		const W = nodeWidth(wrapTitle("Root"));
		assert.equal(layout.width, 2 * W + GAP_X);
		// Raíz centrada sobre sus dos hijos: (2*W+GAP - W)/2
		assert.equal(layout.x.get("r"), (2 * W + GAP_X - W) / 2);
		assert.ok(layout.x.get("x") === 0 && layout.x.get("y") === W + GAP_X);
	});

	it("edgePathD draws dagre's route through curveBasis — mouth pulled back from the border", () => {
		// Ruta recta de 3 puntos (borde de origen → medio → borde de destino): la
		// curva basis empieza justo en el punto del borde; el FINAL retrocede
		// HEAD_TIP_OVERHANG + el hueco de acoplamiento (92 − 2.359 − 2.667) para que
		// la PUNTA de la cabeza quede a 2.67 del borde con su boca en el
		// final del trazado, sobre un fuste recto (responsable, rondas 11–12; la cabeza
		// + el hueco escalados a ⅔ con las líneas de 1px, 2026-09-26).
		const d = edgePathD([{ x: 80, y: 44 }, { x: 80, y: 68 }, { x: 80, y: 92 }]);
		assert.ok(d.startsWith("M80,44"), "starts at the source border point");
		assert.ok(d.endsWith("L80,86.974"), "mouth pulled back; tip floats 2.67 off the border");
		// Todo el trazado sigue en el eje (todas las x valen 80): una ruta colineal
		// se renderiza recta: el tramo del fuste nunca dobla una arista recta.
		const xs = [...d.matchAll(/(?:[MLC]|,)(-?[\d.]+),/g)].map((m) => m[1]);
		assert.ok(xs.length > 0 && xs.every((v) => v === "80"), "collinear route renders on-axis");
		// Una entrada perpendicular a la caja de destino es la MISMA geometría.
		const pd = edgePathD([{ x: 80, y: 44 }, { x: 80, y: 68 }, { x: 80, y: 92 }], { x: 0, y: 92, w: 160, h: 44 });
		assert.equal(pd, d);
	});

	it("edgePathD clamps the entry to ±40° of the face perpendicular (owner, round 14)", () => {
		const box = { x: 20, y: 100, w: 160, h: 44 };
		// Una inclinación de 60° hacia la cara superior gira hasta el borde del cono de 40°: la
		// boca cae en (97.726, 93.289) y el segmento final va a
		// exactamente 40° (Δx/Δy = tan 40°). La punta queda a DOCK_GAP (4) de la
		// cara a lo largo de la normal: borde (100,100) → punta (100,96).
		const clamped = edgePathD([{ x: 70, y: 70 }, { x: 100, y: 100 }], box);
		assert.ok(clamped.endsWith("L98.484,95.526"), "swung to the cone edge");
		// el punto de partida del L final es el par de números anterior; recalcula la dirección
		const nums = [...clamped.matchAll(/(-?[\d.]+)/g)].map((m) => Number(m[1]));
		const ax = nums[nums.length - 4]!;
		const ay = nums[nums.length - 3]!;
		const bx = nums[nums.length - 2]!;
		const by = nums[nums.length - 1]!;
		assert.ok(Math.abs((bx - ax) / (by - ay) - Math.tan((40 * Math.PI) / 180)) < 0.01, "40° cone edge");
		// Punta = boca + u'·saliente, queda a 2.67 por encima de la cara.
		const tipY = by + 0.766 * 2.359;
		assert.ok(Math.abs(tipY - 97.333) < 0.01, "docking gap along the face normal");
		// Una inclinación leve (~9.5°) está DENTRO del límite: sin giro.
		const free = edgePathD([{ x: 90, y: 40 }, { x: 100, y: 100 }], box);
		assert.ok(free.endsWith("L99.612,95.006"), "unclamped within the cone");
	});

	it("wrapTitle wraps greedily and NEVER drops content (boxes grow instead)", () => {
		assert.deepEqual(wrapTitle("Chain rule intuition"), ["Chain rule intuition"]); // muy por debajo: una línea
		assert.deepEqual(wrapTitle("Chain rule intuition and fluency"), [
			"Chain rule intuition and", // 24: añadir "fluency" pasaría de 28
			"fluency",
		]);
		// La palabra demasiado larga se trocea a la fuerza, sin perder nada (responsable, ronda 7).
		assert.deepEqual(wrapTitle("supercalifragilisticexpialidocious word"), [
			"supercalifragilisticexpialid", // el troceador corta EN maxChars
			"ocious word",
		]);
		assert.deepEqual(wrapTitle("supercalifragilistic"), ["supercalifragilistic"]); // exactamente 20: cabe
	});

	it("nodeWidth hugs the wrapped text (the box grows WITH its lines)", () => {
		// Los títulos cortos se quedan en el mínimo; los anchos toman el tamaño de la línea más ancha.
		// Estimación por CLASE de carácter (seguimiento del responsable: la tasa plana de px/carácter
		// se pasaba del ancho renderizado: holgura invisible junto al texto).
		assert.equal(nodeWidth(["supercalifragilistic"]), 117); // est ≈ 85 + 2×16
		assert.equal(nodeWidth(wrapTitle("Symmetry and orthogonal complements")), 149);
		// El ceñido es un relleno simétrico: 16 por lado, el MISMO que el vertical
		// (44−12)/2, y nunca por debajo del suelo.
		assert.ok(nodeWidth(["a"]) === NODE_W_MIN);
		assert.ok(Math.abs(estimateLineWidth("The normal-form ladder") - 106.3) < 0.5);
	});
});

describe("plan block render", () => {
	it("full block: borderless, column-filling, statuses AS CARRIED (never re-derived)", () => {
		const data: PlanBlockData = {
			kind: "full",
			at: "2026-09-09T12:00:00Z",
			current: null,
			nodes: [
				{ id: "a", title: "Alpha node", status: "visited" },
				{ id: "b", title: "Beta node", status: "upcoming" },
			],
			edges: [{ from: "a", to: "b" }],
		};
		const html = renderToStaticMarkup(<PlanBlock data={data} onOpen={() => {}} />);
		assert.match(html, /data-testid="plan-block-full"/);
		// Sin borde: el envoltorio no lleva adorno de borde/redondeo.
		assert.ok(!/data-testid="plan-block-full"[^>]*border/.test(html), "no wrapping chrome");
		// Llena la columna HASTA el tope de la fuente del chat: el svg es w-full +
		// mx-auto con maxWidth = extensión × TEXT_CAP_SCALE, así que el texto de los nodos nunca
		// se renderiza por encima del tamaño de prosa de 16px (responsable, ronda 1 del grafo
		// del plan; el ajuste 16.5→16 llegó en la ronda 4 de tipografía).
		assert.match(html, /<svg[^>]*class="block h-auto w-full mx-auto"/);
		// La fuente de lectura, no la fuente mono de la UI (responsable, 2026-09-26), mediante la
		// variable en tiempo de ejecución (la utilidad font-prose consolidaría el literal de @theme
		// e ignoraría la sustitución de la fuente de lectura de Apariencia).
		assert.match(html, /<svg[^>]*font-family:var\(--font-prose\)/);
		// Líneas + contornos con el grosor de borde estándar de 1px de la app (responsable,
		// 2026-09-26; antes 1.5).
		assert.match(html, /<rect[^>]*stroke-width="1"/);
		assert.match(html, /max-width:143\.36px/); // (96+16) × 1.28: ahora las cajas se ciñen
		// Texto centrado (responsable, ronda de ceñido del plan 2026-10-07): cada línea del título
		// se ancla a la línea media de su caja: el antiguo margen izquierdo x=12 ha desaparecido.
		assert.match(html, /<text[^>]*x="48"[^>]*text-anchor="middle"/); // 96/2
		assert.ok(!/x="12"/.test(html), "no left-inset text");
		// El bloque dentro del chat habla el idioma del dock (responsable, 2026-10-07):
		// cajas de fondo más claro como los armazones del compositor, con contornos en la
		// tinta de línea fuerte (blanca en oscuro; seguimiento del responsable: el relleno gris
		// está bien, los bordes de las cajas siguen blancos).
		assert.match(html, /<rect[^>]*class="fill-card stroke-line-strong"/);
		assert.ok(!/stroke-white|fill-white/.test(html), "no hardcoded white ink");
		// Dos nodos apilados: 2*NODE_H + GAP_Y = 136 de extensión + GRAPH_PAD en
		// cada lado (los trazos/el brillo nunca se recortan en los bordes). El ancho
		// sigue ahora al ceñido: cajas de 96 mínimo, no los antiguos bloques de 160.
		assert.match(html, /viewBox="-8 -8 112 152"/);
		// Los estados de la instantánea se renderizan tal como vienen.
		assert.match(html, /data-testid="plan-node-a" data-status="visited"/);
		assert.match(html, /data-testid="plan-node-b" data-status="upcoming"/);
		assert.ok(html.includes('aria-label="Open the full plan"'), "the trigger names itself (tooltip copy)");
	});

});

describe("plan popup (live derivation)", () => {
	function messages(): PopupMessage[] {
		return [
			{
				parts: [
					{
						type: "tool-plan_init",
						state: "output-available",
						output: { ok: true, tree: CHAIN },
					},
				],
			},
			{
				parts: [
					{
						type: "tool-quiz",
						state: "output-available",
						input: { nodeId: "a" },
						output: { correct: true },
					},
				],
			},
			{
				parts: [
					{
						type: "tool-quiz",
						state: "input-available",
						input: { nodeId: "b" },
					},
				],
			},
		];
	}

	it("derives statuses at click time: latest tagged call → current, earlier → visited (glowing)", () => {
		const html = renderToStaticMarkup(<PlanPopup messages={messages()} onClose={() => {}} />);
		assert.match(html, /data-testid="plan-popup"/);
		assert.match(html, /data-testid="plan-node-a" data-status="visited"/);
		assert.match(html, /data-testid="plan-node-b" data-status="current"/);
		assert.match(html, /data-testid="plan-node-c" data-status="upcoming"/);
		// El nodo actual es el destino del brillo: un relleno amarillo tenue, difuminado
		// para que se derrame por los bordes; estático, sin pulso (responsable, ronda 6).
		assert.match(html, /fill-yellow-400\/25/);
		assert.match(html, /feGaussianBlur/);
		assert.doesNotMatch(html, /animate-pulse/);
		// Las flechas hacia nodos aún no visitados se muestran en gris (responsable, ronda 6).
		assert.match(html, /marker-end="url\(#.*-dim\)"/);
		assert.match(html, /live — statuses derive from your check outcomes/);
		// Sin destello arriba a la izquierda: en el render estático settled=false, así que el
		// envoltorio del diagrama se pinta con opacidad 0: el ajuste se ejecuta en un efecto
		// DESPUÉS de la primera pintura y, si no, el gráfico destellaría un fotograma en el
		// estado inicial arriba a la izquierda con zoom:1 (informe del responsable, 2026-09-19;
		// condicionar solo la transición no lo ocultaba).
		assert.match(html, /opacity: ?0[;,}]/, "diagram hidden until the first fit applies");
	});

	it("dims an arrow when EITHER end is gray — white needs both ends white (owner, 2026-09-26)", () => {
		// x próximo → y visitado: la regla ANTIGUA (solo el destino) pintaba esto de
		// blanco; la nueva lo mantiene gris: las flechas salientes de una caja gris
		// siguen grises incluso hacia terreno cubierto. y → z (visitado → actual)
		// sigue blanca: LOS DOS extremos blancos.
		const tree: PlanTree = {
			nodes: [
				{ id: "x", title: "Gray origin" },
				{ id: "y", title: "Covered middle" },
				{ id: "z", title: "Covered latest" },
			],
			edges: [
				{ from: "x", to: "y" },
				{ from: "y", to: "z" },
			],
			version: 1,
		};
		const msgs: PopupMessage[] = [
			{ parts: [{ type: "tool-plan_init", state: "output-available", output: { ok: true, tree } }] },
			{ parts: [{ type: "tool-quiz", state: "output-available", input: { nodeId: "y" }, output: { correct: true } }] },
			{ parts: [{ type: "tool-quiz", state: "output-available", input: { nodeId: "z" }, output: { correct: true } }] },
		];
		const html = renderToStaticMarkup(<PlanPopup messages={msgs} onClose={() => {}} />);
		assert.match(html, /data-testid="plan-node-x" data-status="upcoming"/);
		assert.match(html, /data-testid="plan-node-y" data-status="visited"/);
		assert.match(html, /data-testid="plan-node-z" data-status="current"/);
		// Exactamente una arista gris (x→y, origen gris) y una blanca (y→z,
		// los dos extremos blancos): cuenta los marcadores de punta, uno por arista.
		const dimHeads = (html.match(/marker-end="url\(#.*-dim\)"/g) ?? []).length;
		const whiteHeads = (html.match(/marker-end="url\(#(?:R\d+(?:H\d+)?|[a-z0-9-]+)\)"/g) ?? []).length;
		assert.equal(dimHeads, 1, "the gray-origin edge dims");
		assert.equal(whiteHeads, 1, "the both-white edge stays white");
		assert.match(html, /<path[^>]*class="fill-none stroke-border"/);
		assert.match(html, /<path[^>]*class="fill-none stroke-line-strong"/);
		assert.ok(!/stroke-white|fill-white/.test(html), "no hardcoded white ink");
	});

	it("renders the empty state when the session has no plan", () => {
		const html = renderToStaticMarkup(<PlanPopup messages={[{ parts: [] }]} onClose={() => {}} />);
		assert.match(html, /No plan in this session yet\./);
	});
});