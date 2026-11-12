import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * El diálogo de confirmación de borrado de nodos (interludio de nodos, motor 50bfcba de
 * Platform; extensión a varios nodos + REESCRITURA MÍNIMA, responsable 2026-09-30):
 * fijaciones de renderizado del texto; el texto es diseño, no implementación.
 * La ruta de borrado en sí se verifica en vivo contra la API real
 * (notas de verificación en desarrollo); aquí el SSR fija lo que el renderizado estático PUEDE
 * fijar.
 *
 * El contrato mínimo (decisión del responsable, 2026-09-30): SIN lectura previa del
 * impacto: lo que se lleva una muerte completa es obvio, la petición
 * parpadeaba y unos datos más ricos solo confundirían a medida que evolucione la semántica
 * del borrado (está sobre la mesa hablar de recablear). Título + nombres +
 * una línea de permanencia + Cancel/Delete. Y "node"/"nodes" es LA palabra de la interfaz
 * para los objetos del grafo (estandarizada en todas partes, misma decisión).
 */

import { DeleteNodeBody, DeleteNodeDialog, EXTRACTION_RETRY_LINE } from "../components/delete-node-dialog.tsx";

/** El cuerpo: puro, así que el SSR fija todo lo que muestra el diálogo en vivo. */
function bodyAt(nodes: { id: string; name: string }[], extra?: { failure?: { code: string; error: string } | null; busy?: boolean }) {
	return renderToStaticMarkup(
		createElement(DeleteNodeBody, {
			nodes,
			busy: extra?.busy ?? false,
			failure: extra?.failure ?? null,
			onClose: () => {},
			onRun: () => {},
		}),
	);
}

describe("EXTRACTION_RETRY_LINE (the 409 phrasing, owner-locked)", () => {
	it("names the activity dock — the surface the user watches drain", () => {
		assert.equal(EXTRACTION_RETRY_LINE, "An extraction is running — try again when the activity dock drains.");
	});
});

describe("DeleteNodeDialog (thin SSR)", () => {
	it("null and empty nodes both render nothing — closed either way", () => {
		for (const nodes of [null, []] as ({ id: string; name: string }[] | null)[]) {
			const html = renderToStaticMarkup(
				createElement(DeleteNodeDialog, { nodes, onClose: () => {}, onDeleted: () => {} }),
			);
			assert.equal(html, "");
		}
	});
});

describe("DeleteNodeBody — the minimal screen (owner, 2026-09-30)", () => {
	it("single: 'Delete node?' title, the name alone in mono, the one permanence line", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }]);
		assert.match(html, /data-testid="delete-node-dialog"/);
		// (responsable, pulido del 2026-10-13) el título con el aspecto de abort-turn:
		// text-sm font-semibold (JetBrains Mono por defecto en la interfaz), se mantiene
		// el rojo, SIN la serif font-title; el NOMBRE va debajo en JetBrains
		// Mono a tamaño text-sm normal, SIN adorno de bloque de código: la misma forma
		// que el diálogo de sesión.
		assert.match(html, /Delete node\?/);
		const title = html.match(/<h2[^>]*>/)?.[0] ?? "";
		assert.match(title, /text-sm font-semibold text-destructive/);
		assert.ok(!title.includes("font-title"), "no serif display title (owner, 2026-10-13)");
		const name = html.match(/data-testid="node-name-code"[^>]*>/)?.[0] ?? "";
		assert.match(name, /font-mono text-sm/);
		assert.ok(!name.includes("bg-muted"), "no code-block chrome — the font already says code");
		assert.match(html, /data-testid="node-name-code"[^>]*>Kepler&#x27;s three laws</);
		assert.match(html, /data-testid="node-permanence-line"[^>]*>This permanently deletes the node — this cannot be undone\./);
		assert.match(html, /data-testid="node-delete-cancel"/);
		assert.match(html, /data-testid="node-delete-confirm"/);
		// el botón Delete lleva el rojo destructivo (responsable, ronda de pulido)
		assert.match(html, /border-destructive\/50[^>]*text-destructive/);
	});

	it("NO impact facts, NO loading line, NO sessions join — the pre-flight read is dead", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }]);
		assert.ok(!html.includes("node-impact-facts"), "no facts list");
		assert.ok(!html.includes("node-impact-loading"), "no loading line");
		assert.ok(!html.includes("Reading what this would remove"), "no fetch copy");
		assert.ok(!html.includes("Referenced by"), "no sessions join");
		assert.ok(!html.includes("links to other topics"), "no edge count — it is obvious");
	});

	it("multi: 'Delete N nodes?' (the UI word is node, owner 2026-09-30), names capped at 8 + and-K-more", () => {
		const three = bodyAt([
			{ id: "kepler", name: "Kepler's three laws" },
			{ id: "newton", name: "Newton's second law" },
			{ id: "hook", name: "Hooke's law" },
		]);
		assert.match(three, /Delete 3 nodes\?/); // título en plural, NODES
		assert.match(three, /data-testid="node-names-code"/);
		assert.match(three, /Kepler&#x27;s three laws, Newton&#x27;s second law, Hooke&#x27;s law/);
		assert.ok(!three.includes('data-testid="node-name-code"'), "the single-name testid is gone in multi");
		assert.match(three, /This permanently deletes all 3 nodes — this cannot be undone\./);
		assert.ok(!three.includes("proposition"), "the old word is gone from the dialog");

		// el tope: 10 nombres muestran 8 + ", and 2 more"
		const ten = bodyAt(Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, name: `Prop ${i}` })));
		assert.match(ten, /Delete 10 nodes\?/);
		assert.match(ten, /Prop 7/); // el 8.º nombre sigue en la lista
		assert.doesNotMatch(ten, /Prop 8</); // el 9.º no
		assert.match(ten, /, and 2 more/);
	});

	it("failure: the 409 renders the activity-dock line with a Try-again; other codes state themselves", () => {
		const conflict = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], {
			failure: { code: "extraction_running", error: "server line" },
		});
		assert.match(conflict, /data-testid="node-delete-failure"/);
		assert.match(conflict, new RegExp(EXTRACTION_RETRY_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.doesNotMatch(conflict, /server line/); // la redacción del dock SUSTITUYE a la línea en bruto para el código conocido
		assert.match(conflict, /data-testid="node-delete-retry"/);

		const plain = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], {
			failure: { code: "not_found", error: "No such node" },
		});
		assert.match(plain, /No such node/); // en otro caso, la línea en bruto, honesta
	});

	it("busy: the confirm reads 'Deleting…' and both buttons disable", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], { busy: true });
		assert.match(html, /Deleting…</);
		assert.match(html, /data-testid="node-delete-cancel"[^>]*disabled/);
		assert.match(html, /data-testid="node-delete-confirm"[^>]*disabled/);
	});
});
