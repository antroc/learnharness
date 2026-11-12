/**
 * El saneador del commit de posiciones (PUT /api/graph/positions): el arreglo de
 * arg_ (responsable, 2026-10-06): el lienzo persiste todo el mundo de la vista
 * derivada (proposiciones almacenadas + nodos de implicación arg_ derivados), y el
 * commit debe CONSERVAR ambos. Quitar los args purgaba sus entradas del registro
 * en cada commit de arrastre, así que cada montaje los volvía a sembrar en un anillo gigante:
 * el informe de «salpicado desde el centro». También fija la comprobación de crecimiento:
 * una carga que cubre toda la vista NO ejecuta asentamiento (el fichero es exactamente
 * igual a la carga); una carga a la que le falta un nodo de la vista (una fusión llegó
 * a mitad del arrastre) dispara exactamente un asentamiento que lo absorbe.
 *
 * Hermética: LH_DATA_DIR → un directorio temporal, fijado ANTES de la primera importación de
 * los módulos del servidor (la frontera es el entorno al cargar el módulo, ver
 * tests/data-dir-seam.test.ts).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { before, describe, it } from "node:test";

process.env.LH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lh-pos-commit-"));

let commitPositions: (input: unknown) => Record<string, { x: number; y: number }>;
let readPositions: () => Record<string, { x: number; y: number }>;
let appendNode: (node: unknown) => void;
let appendChain: (assertion: unknown) => void;

before(async () => {
	({ commitPositions } = await import("../src/server/commit-positions.ts"));
	const { stores } = await import("../src/server/stores.ts");
	const positionsFile = path.join(process.env.LH_DATA_DIR!, "graph", "positions.json");
	readPositions = () => JSON.parse(fs.readFileSync(positionsFile, "utf8")).positions as Record<string, { x: number; y: number }>;
	appendNode = stores.graphStore.appendNode as (node: unknown) => void;
	appendChain = stores.graphStore.appendChain as (assertion: unknown) => void;

	// Dos proposiciones + una cadena de dos premisas → la vista derivada son
	// 2 proposiciones + 1 nodo arg_.
	const node = (id: string) => ({
		id,
		name: id,
		statement: `${id} statement`,
		aliases: [],
		createdAt: "2026-10-06T00:00:00.000Z",
		provenance: [],
	});
	appendNode(node("n_a"));
	appendNode(node("n_b"));
	appendNode(node("n_c"));
	appendChain({
		id: "arg_chain1",
		premises: ["n_a", "n_b"],
		conclusion: "n_c",
		provenance: [],
		createdAt: "2026-10-06T00:00:00.000Z",
	});
});

describe("commitPositions (the arg_ fix)", () => {
	it("persists arg_ implication ids alongside propositions — the canvas's whole world", () => {
		const persisted = commitPositions({
			n_a: { x: 10, y: 20 },
			n_b: { x: 30, y: 40 },
			n_c: { x: 50, y: 60 },
			arg_chain1: { x: 34.5, y: 44.5 },
			garbage_id: { x: 1, y: 1 },
		});
		assert.deepEqual(Object.keys(persisted).sort(), ["arg_chain1", "n_a", "n_b", "n_c"]);
		assert.deepEqual(readPositions().arg_chain1, { x: 34.5, y: 44.5 });
		assert.ok(!("garbage_id" in readPositions()), "unknown ids still discarded");
	});

	it("a payload covering the whole view runs NO settle — the file equals the payload exactly", () => {
		commitPositions({
			n_a: { x: 100, y: 200 },
			n_b: { x: 300, y: 400 },
			n_c: { x: 500, y: 600 },
			arg_chain1: { x: 350, y: 450 },
		});
		assert.deepEqual(readPositions(), {
			n_a: { x: 100, y: 200 },
			n_b: { x: 300, y: 400 },
			n_c: { x: 500, y: 600 },
			arg_chain1: { x: 350, y: 450 },
		}, "no settle recomputation — the client's rest state is the ledger");
	});

	it("a payload missing a view node (a merge landed mid-drag) triggers the absorbing settle", () => {
		// El cliente nunca conoció arg_chain1 (se fusionó después de empezar el arrastre).
		commitPositions({
			n_a: { x: 1, y: 2 },
			n_b: { x: 3, y: 4 },
			n_c: { x: 5, y: 6 },
		});
		const after = readPositions();
		assert.ok("arg_chain1" in after, "the settle laid out the node the client missed");
		// Se respetan las anclas del cliente (arranque en caliente), no se machacan a 0.
		assert.ok(Math.abs(after.n_a!.x - 1) < 50, `anchor n_a near its committed rest (got ${after.n_a!.x})`);
	});

	it("garbage still sanitizes: non-finite drops, absurd clamps, nothing throws", () => {
		const persisted = commitPositions({
			n_a: { x: Number.NaN, y: 1 },
			n_b: { x: 5, y: Number.POSITIVE_INFINITY },
			n_c: { x: 1e9, y: 0 },
		});
		assert.ok(!("n_a" in persisted), "NaN drops");
		assert.ok(!("n_b" in persisted), "Infinity drops");
		assert.equal(persisted.n_c!.x, 1e6, "absurd clamps to MAX_COORD");
	});
});
