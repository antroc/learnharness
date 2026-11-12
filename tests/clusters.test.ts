/**
 * Pruebas de las reglas de presentación de clústeres. La oleada 7 eliminó la detección semántica
 * Y el emparejador de etiquetas por LLM (clústeres por sesión de nacimiento, etiquetas con el nombre de la sesión;
 * core/session-clusters.ts tiene su propia batería); lo que queda fijado aquí
 * es el umbral de renderizado y la dispersión de colores de envolvente en la que se apoya la interfaz.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { MIN_CLUSTER_SIZE } from "../src/core/clusters.ts";
import { clusterHue } from "../components/cluster-geometry.ts";

describe("MIN_CLUSTER_SIZE", () => {
	test("is 3 (the render threshold — below this, no hull)", () => {
		assert.equal(MIN_CLUSTER_SIZE, 3);
	});
});

describe("clusterHue", () => {
	test("is stable per id and spreads", () => {
		// Mismo id → mismo tono, siempre; ids distintos → normalmente tonos distintos.
		assert.equal(clusterHue("cluster-a"), clusterHue("cluster-a"));
		const hues = new Set<number>();
		for (let i = 0; i < 40; i++) hues.add(clusterHue(`cluster-${i}`));
		assert.ok(hues.size > 20, `expected spread, got ${hues.size} distinct hues for 40 ids`);
		for (const h of hues) assert.ok(h >= 0 && h < 360);
	});
});