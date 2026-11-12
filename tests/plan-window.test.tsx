import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanMarginalia, planExists } from "../components/plan-window.tsx";
import { blockLayout, edgePathD, type LayoutNode, type PopupMessage } from "../components/plan-block.tsx";
import type { PlanTree } from "../src/core/contracts.ts";

// La nota al margen del plan: el diagrama desnudo en el flanco derecho de la franja
// del dock: plan completo (viewBox con relleno, ajuste meet), estados + brillo en vivo
// por derivación, nada hasta que exista un árbol. La posición y el fundido viven en DockOverlay.

const CHAIN: PlanTree = {
	nodes: [
		{ id: "a", title: "Alpha" },
		{ id: "b", title: "Beta" },
		{ id: "c", title: "Gamma" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
	],
	version: 1,
};

/** Una transcripción con un plan_init correcto (que lleva `tree`) y,
 *  opcionalmente, una llamada de quiz etiquetada. */
function transcript(tree: PlanTree, taggedNodeId?: string): PopupMessage[] {
	return [
		{ id: "m1", role: "user", parts: [] } as never,
		{
			id: "m2",
			role: "assistant",
			parts: [{ type: "tool-plan_init", state: "output-available", output: { ok: true, tree } }],
		} as never,
		...(taggedNodeId
			? [
					{
						id: "m3",
						role: "assistant",
						parts: [{ type: "tool-quiz", state: "input-available", input: { nodeId: taggedNodeId } }],
					} as never,
				]
			: []),
	];
}

describe("planExists", () => {
	it("false without a tree — the phantom-click gate (owner report, 2026-10-01)", () => {
		// Un elemento JSX siempre es verdadero; el ENVOLTORIO debe condicionarse a la
		// presencia real o queda un botón invisible y clicable en el flanco.
		assert.equal(planExists([]), false);
		assert.equal(planExists(transcript({ nodes: [], edges: [], version: 0 })), false);
	});

	it("true once the transcript holds a plan tree", () => {
		assert.equal(planExists(transcript(CHAIN)), true);
	});
});

describe("PlanMarginalia render", () => {
	it("renders nothing until a tree exists", () => {
		assert.equal(renderToStaticMarkup(<PlanMarginalia messages={[]} />), "");
	});

	it("renders the FULL plan (padded full-extent viewBox), not a windowed crop", () => {
		const html = renderToStaticMarkup(<PlanMarginalia messages={transcript(CHAIN)} />);
		// El viewBox cubre todo el layout más el relleno que despeja el brillo;
		// nunca el recorte 2:1 de la ventana retirada.
		const layout = blockLayout(CHAIN.nodes, CHAIN.edges);
		const pad = 24; // MARGIN_PAD: GRAPH_PAD + 16 (holgura del halo de brillo)
		const vb = `viewBox="${-pad} ${-pad} ${layout.width + 2 * pad} ${layout.height + 2 * pad}"`;
		assert.ok(html.includes(vb), `expected ${vb} in the svg`);
		assert.ok(!/viewBox="-?\d+(\.\d+)? -?\d+(\.\d+)? 360 180"/.test(html), "the windowed viewBox is retired");
		// Modo de ajuste meet: el svg llena la caja de la franja (h-full w-full) y deja
		// que preserveAspectRatio contenga el diagrama en el flanco.
		assert.ok(html.includes('font-family:var(--font-prose)'), "fill mode classes");
	});

	it("glows the current node and dims the not-yet-visited (live statuses)", () => {
		const html = renderToStaticMarkup(<PlanMarginalia messages={transcript(CHAIN, "b")} />);
		// El halo amarillo difuminado marca el nodo de la comprobación etiquetada…
		assert.ok(html.includes("fill-yellow-400/25"), "glow on the current node");
		assert.ok(html.includes('data-testid="plan-node-b" data-status="current"'), "b is current");
		// …y las flechas hacia nodos próximos llevan la punta atenuada.
		assert.ok(
			html.includes("url(#:r0:-dim)") || /url\(#\S*-dim\)/.test(html),
			"dimmed arrowhead into the upcoming node",
		);
	});
});

// ─── El lienzo debe cubrir las flechas (responsable, 2026-10-10) ─────────────
// El plan REAL de álgebra lineal del responsable (chat_mv19m6xe, el mermaid de
// plan_init analizado a nodos/aristas; las fixtures doradas usan datos reales,
// decisión del responsable 2026-10-10): los puntos de control bezier de una arista
// entre columnas llegaban a x=776 mientras que el ancho de los nodos según dagre era
// 754: 14px de flecha recortados en el borde del viewBox (el plan de Hume cortaba 20px igual).
const LINEAR_ALGEBRA_NODES: LayoutNode[] = [
{ id: "vector-space-axioms", title: "What a vector space is" },
	{ id: "span-basis-dimension", title: "Span, basis, dimension" },
	{ id: "matrix-as-map", title: "Matrices as maps" },
	{ id: "elimination-rank", title: "Elimination exposes rank" },
	{ id: "determinant-volume", title: "Det as volume scaling" },
	{ id: "orthogonality-complements", title: "Orthogonality and complements" },
	{ id: "projection-theorem", title: "The projection theorem" },
	{ id: "transpose-adjoint", title: "The transpose as bridge" },
	{ id: "normal-equations", title: "Least squares, normal equations" },
	{ id: "eigen-diagonalization", title: "Eigenvectors as coordinates" },
	{ id: "spectral-theorem", title: "The spectral theorem" },
	{ id: "pca-synthesis", title: "Goal: PCA and least-squares derivations" }
];
const LINEAR_ALGEBRA_EDGES: ReadonlyArray<{ from: string; to: string }> = [
{ from: "span-basis-dimension", to: "matrix-as-map" },
	{ from: "matrix-as-map", to: "elimination-rank" },
	{ from: "matrix-as-map", to: "determinant-volume" },
	{ from: "matrix-as-map", to: "orthogonality-complements" },
	{ from: "span-basis-dimension", to: "orthogonality-complements" },
	{ from: "orthogonality-complements", to: "projection-theorem" },
	{ from: "orthogonality-complements", to: "transpose-adjoint" },
	{ from: "matrix-as-map", to: "transpose-adjoint" },
	{ from: "projection-theorem", to: "normal-equations" },
	{ from: "transpose-adjoint", to: "normal-equations" },
	{ from: "matrix-as-map", to: "normal-equations" },
	{ from: "determinant-volume", to: "eigen-diagonalization" },
	{ from: "matrix-as-map", to: "eigen-diagonalization" },
	{ from: "span-basis-dimension", to: "eigen-diagonalization" },
	{ from: "eigen-diagonalization", to: "spectral-theorem" },
	{ from: "transpose-adjoint", to: "spectral-theorem" },
	{ from: "orthogonality-complements", to: "spectral-theorem" },
	{ from: "spectral-theorem", to: "pca-synthesis" },
	{ from: "normal-equations", to: "pca-synthesis" }
];

describe("blockLayout ink extent", () => {
	it("covers every edge path's control points — arrows never clip (owner, 2026-10-10)", () => {
		const L = blockLayout(LINEAR_ALGEBRA_NODES, LINEAR_ALGEBRA_EDGES);
		// La extensión del viewBox debe alcanzar el punto de control más lejano de
		// cada arista dibujada (una bezier nunca sale de la envolvente de sus puntos de control).
		let ctrlMaxX = -Infinity;
		for (const e of LINEAR_ALGEBRA_EDGES) {
			const pts = L.edgePts.get(`${e.from}->${e.to}`);
			if (!pts) continue;
			const target = {
				x: L.x.get(e.to)!,
				y: L.y.get(e.to)!,
				w: L.nodeW.get(e.to)!,
				h: L.nodeH.get(e.to)!,
			};
			const nums = edgePathD(pts, target).match(/-?\d+(?:\.\d+)?/g) ?? [];
			for (let i = 0; i + 1 < nums.length; i += 2)
				ctrlMaxX = Math.max(ctrlMaxX, parseFloat(nums[i]!));
		}
		assert.ok(ctrlMaxX > -Infinity, "the fixture has edges");
		assert.ok(
			ctrlMaxX <= (L.originX ?? 0) + L.width + 0.5,
			`control point ${ctrlMaxX} exceeds the canvas right edge ${(L.originX ?? 0) + L.width}`,
		);
	});

	it("the real plan's overhang actually EXTENDS the canvas past the node extent", () => {
		const L = blockLayout(LINEAR_ALGEBRA_NODES, LINEAR_ALGEBRA_EDGES);
		let nodeMaxX = -Infinity;
		for (const n of LINEAR_ALGEBRA_NODES)
			nodeMaxX = Math.max(nodeMaxX, (L.x.get(n.id) ?? 0) + (L.nodeW.get(n.id) ?? 0));
		// Antes del arreglo, el ancho de dagre era 754 con tinta en 776: el ancho debe
		// ser ≥ tinta, que aquí supera estrictamente la extensión de los nodos.
		assert.ok(L.width > nodeMaxX + 1, `layout width ${L.width} should exceed node extent ${nodeMaxX}`);
	});
});
