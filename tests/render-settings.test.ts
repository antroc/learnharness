/**
 * Pruebas de src/core/render-settings.ts: el contrato de ajustes compartido
 * (forma, valores por defecto, saneador, correspondencia escalera/deslizador).
 * Módulo puro, pruebas puras: el JSON que llegue del disco o de la red pasa por
 * sanitizeRenderSettings y debe salir válido, sin lanzar nunca errores.
 */

import assert from "node:assert/strict";
import { describe, it as test } from "node:test";
import {
	ARROW_LENGTH_LADDER,
	CHARGE_RANGE,
	CLUSTER_LABEL_SIZE_LADDER,
	CLUSTER_PULL_RANGE,
	DEFAULT_RENDER_SETTINGS,
	DEPTH_BASE_RADIUS_RANGE,
	DEPTH_SPACING_RANGE,
	DEPTH_STRENGTH_RANGE,
	EDGE_WIDTH_LADDER,
	GRAVITY_RANGE,
	LABEL_SIZE_LADDER,
	LABEL_ZOOM_LADDER,
	LINK_DISTANCE_RANGE,
	LINK_STRENGTH_RANGE,
	NODE_SIZE_LADDER,
	REGION_BLUR_LADDER,
	sanitizeRegionTuning,
	REGION_DILATION_LADDER,
	REGION_EDGE_ALPHA_LADDER,
	VELOCITY_DECAY_RANGE,
	DEFAULT_PHYSICS_TUNING,
	DEFAULT_REGION_TUNING,
	fromLadderPosition,
	fromOffSliderPosition,
	fromSliderPosition,
	labelZoomDisplay,
	ladderIndex,
	sanitizeRenderSettings,
	snapToLadder,
	toLadderPosition,
	toOffSliderPosition,
	toSliderPosition,
} from "../src/core/render-settings.ts";

describe("sanitizeRenderSettings", () => {
	test("garbage in → full defaults out", () => {
		assert.deepEqual(sanitizeRenderSettings(null), DEFAULT_RENDER_SETTINGS);
		assert.deepEqual(sanitizeRenderSettings(undefined), DEFAULT_RENDER_SETTINGS);
		assert.deepEqual(sanitizeRenderSettings("junk"), DEFAULT_RENDER_SETTINGS);
		assert.deepEqual(sanitizeRenderSettings(42), DEFAULT_RENDER_SETTINGS);
	});

	test("partial input → defaults fill the gaps", () => {
		const s = sanitizeRenderSettings({ sizeUnits: "world", nodeSize: 6 });
		assert.equal(s.nodeSize, 6);
		assert.equal(s.edgeWidth, DEFAULT_RENDER_SETTINGS.edgeWidth);
		assert.equal(s.labelSize, DEFAULT_RENDER_SETTINGS.labelSize);
		assert.equal(s.labelZoom, DEFAULT_RENDER_SETTINGS.labelZoom);
		assert.equal(s.clusterLabels, DEFAULT_RENDER_SETTINGS.clusterLabels);
		assert.equal(s.clusterLabelSize, DEFAULT_RENDER_SETTINGS.clusterLabelSize); // ficheros antiguos → 14
	});

	test("out-of-range values snap to ladder ends; wrong types reset", () => {
		const s = sanitizeRenderSettings({
			sizeUnits: "world",
			nodeSize: 999,
			edgeWidth: 0,
			arrowLength: -5,
			labelZoom: 100,
			labelSize: "big" as unknown as number,
			clusterLabels: "yes" as unknown as boolean,
			clusterLabelSize: "huge" as unknown as number,
		});
		assert.equal(s.nodeSize, NODE_SIZE_LADDER[NODE_SIZE_LADDER.length - 1]); // ajustado al tope de la escalera
		assert.equal(s.edgeWidth, EDGE_WIDTH_LADDER[0]); // ajustado al suelo de la escalera
		assert.equal(s.arrowLength, ARROW_LENGTH_LADDER[0]);
		assert.equal(s.labelZoom, LABEL_ZOOM_LADDER[LABEL_ZOOM_LADDER.length - 1]);
		assert.equal(s.labelSize, DEFAULT_RENDER_SETTINGS.labelSize); // reinicio a prueba de NaN
		assert.equal(s.clusterLabels, DEFAULT_RENDER_SETTINGS.clusterLabels);
		assert.equal(s.clusterLabelSize, DEFAULT_RENDER_SETTINGS.clusterLabelSize); // reinicio a prueba de NaN
	});

	test("the ladder law: any finite value snaps to the nearest stop", () => {
		// Los artefactos guardados como 2.18137...977 (supervivientes de px-al-ajustar) pasan a
		// ser números redondos; nada no finito entra nunca en un fichero.
		assert.equal(snapToLadder(2.18, NODE_SIZE_LADDER), 2);
		assert.equal(snapToLadder(3.9, NODE_SIZE_LADDER), 4);
		assert.equal(snapToLadder(0.63, NODE_SIZE_LADDER), 0.75); // 0.63 está más cerca de 0.75 que de 0.5
		// Los empates se resuelven hacia abajo (determinista, y el valor inferior es la
		// dirección conservadora para todos los controles).
		assert.equal(snapToLadder(1.25, NODE_SIZE_LADDER), 1);
		// La escalera de etiquetas de clúster de la vista también se ajusta.
		assert.equal(sanitizeRenderSettings({ sizeUnits: "world", clusterLabelSize: 21 }).clusterLabelSize, 20);
	});

	test("clusterLabelSize snaps to its own ladder", () => {
		// El 14 por defecto es un valor de la escalera (índice 5) → deslizador justo en el centro.
		assert.equal(DEFAULT_RENDER_SETTINGS.clusterLabelSize, CLUSTER_LABEL_SIZE_LADDER[ladderIndex(14, CLUSTER_LABEL_SIZE_LADDER)]);
		const s = sanitizeRenderSettings({ sizeUnits: "world", clusterLabelSize: 999 });
		assert.equal(s.clusterLabelSize, CLUSTER_LABEL_SIZE_LADDER[CLUSTER_LABEL_SIZE_LADDER.length - 1]);
		const s2 = sanitizeRenderSettings({ sizeUnits: "world", clusterLabelSize: 1 });
		assert.equal(s2.clusterLabelSize, CLUSTER_LABEL_SIZE_LADDER[0]);
	});

	test("the low ends accept small sizes (ladder floors)", () => {
		const s = sanitizeRenderSettings({ sizeUnits: "world", nodeSize: 0.3, edgeWidth: 0.1, arrowLength: 0.2, labelSize: 0.3 });
		assert.deepEqual(
			{ nodeSize: s.nodeSize, edgeWidth: s.edgeWidth, arrowLength: s.arrowLength, labelSize: s.labelSize },
			{ nodeSize: 0.25, edgeWidth: 0.1, arrowLength: 0.25, labelSize: 0.5 }, // ajustados a los suelos de la escalera
		);
	});

	test("a fully valid object passes through unchanged", () => {
		const valid = {
			sizeUnits: "world",
			nodeSize: 4,
			edgeWidth: 2,
			arrowLength: 3,
			labelZoom: 2,
			labelSize: 4,
			clusterLabels: false,
			clusterLabelSize: 20,
			regions: DEFAULT_REGION_TUNING,
			physics: DEFAULT_PHYSICS_TUNING,
		};
		assert.deepEqual(sanitizeRenderSettings(valid), valid); // todos los valores, miembros de una escalera
	});

	test("supports settings are GONE (chains-primary, 2026-09-30): stale keys silently drop", () => {
		// Las aristas de apoyo se retiraron; showSupports/supportsWidth ya no
		// existen. Un fichero heredado que las lleve se carga sin esas claves: el
		// saneador descarta por construcción los campos desconocidos.
		const cleaned = sanitizeRenderSettings({ showSupports: false, supportsWidth: 0.9 } as never);
		assert.equal("showSupports" in cleaned, false);
		assert.equal("supportsWidth" in cleaned, false);
	});

	test("the pre-2026-09-13 stored shape (flat, no regions/physics) still loads", () => {
		// El data/render-settings.json del disco es anterior a las secciones anidadas:
		// esas cargas deben recibir valores por defecto, sin fallar y sin desplazar nada.
		// También es anterior a sizeUnits: los tamaños se reinician (abajo), los campos
		// planos conservan sus valores guardados (ajustados al valor más cercano).
		const s = sanitizeRenderSettings({ nodeSize: 4, edgeWidth: 1, arrowLength: 5, labelZoom: 0.5, clusterLabels: true });
		assert.deepEqual(s.regions, DEFAULT_REGION_TUNING);
		assert.deepEqual(s.physics, DEFAULT_PHYSICS_TUNING);
		assert.equal(s.nodeSize, DEFAULT_RENDER_SETTINGS.nodeSize); // los tamaños heredados se reinician
		assert.equal(s.edgeWidth, 1);
		assert.equal(s.labelZoom, 0.5); // ahora 0.5 ES el valor central (responsable, 2026-10-07)
	});

	test("the 2026-09-15 world-unit pivot: legacy files reset ONLY the size fields", () => {
		// Los ficheros anteriores al cambio guardaban los tamaños como «px de pantalla con el
		// zoom de ajuste», una unidad cuyo significado dependía de la extensión del propio grafo.
		// Esos valores no se pueden trasladar con honestidad a unidades del mundo → reinicio;
		// todo aquello cuya semántica NO cambió conserva su valor guardado.
		const s = sanitizeRenderSettings({
			nodeSize: 2, labelSize: 2, arrowLength: 2,
			edgeWidth: 3, labelZoom: 0.75, clusterLabelSize: 21,
			regions: { dilation: 28, blur: 8.1, bitmap: 512, edgeAlpha: 0.6, enabled: false },
			physics: { linkStrength: 2 },
		});
		assert.equal(s.sizeUnits, "world"); // el saneador siempre pone el sello
		assert.equal(s.nodeSize, DEFAULT_RENDER_SETTINGS.nodeSize);
		assert.equal(s.labelSize, DEFAULT_RENDER_SETTINGS.labelSize);
		assert.equal(s.arrowLength, DEFAULT_RENDER_SETTINGS.arrowLength);
		assert.equal(s.regions.dilation, DEFAULT_REGION_TUNING.dilation);
		// La semántica que no cambió sobrevive, ajustada a la escalera:
		assert.equal(s.edgeWidth, 3);
		assert.equal(s.labelZoom, 0.75);
		assert.equal(s.clusterLabelSize, 20); // 21 se ajusta a 20
		assert.equal(s.regions.blur, 10); // 8.1 se ajusta al nuevo suelo (responsable, 2026-10-07)
		assert.equal(s.regions.bitmap, 512);
		assert.equal(s.regions.edgeAlpha, 0.6);
		assert.equal(s.regions.enabled, false);
		assert.equal(s.physics.linkStrength, 2);
	});

	test("a stamped world-unit file keeps its size values", () => {
		const s = sanitizeRenderSettings({ sizeUnits: "world", nodeSize: 6, arrowLength: 8, labelSize: 3 });
		assert.equal(s.nodeSize, 6);
		assert.equal(s.arrowLength, 8);
		assert.equal(s.labelSize, 3);
	});

	test("the 2026-09-17 defaults are the user's live-tuned bake", () => {
		// nodeSize 2, edgeWidth 1, arrowLength 2, labelSize 3, labelZoom
		// 0.5 (se muestra 1×), dilation 20, blur 40, edgeAlpha 0.2, bitmap
		// 256: cada uno en el centro de su escalera recentrada (responsable, 2026-10-07).
		assert.equal(DEFAULT_RENDER_SETTINGS.nodeSize, 2);
		assert.equal(DEFAULT_RENDER_SETTINGS.edgeWidth, 1);
		assert.equal(DEFAULT_RENDER_SETTINGS.arrowLength, 2);
		assert.equal(DEFAULT_RENDER_SETTINGS.labelSize, 3);
		assert.equal(DEFAULT_RENDER_SETTINGS.labelZoom, 0.5); // se muestra 1× (responsable, 2026-10-07)
		assert.equal(DEFAULT_REGION_TUNING.dilation, 20);
		assert.equal(DEFAULT_REGION_TUNING.blur, 40); // nuevo valor por defecto (responsable, 2026-10-07)
		assert.equal(DEFAULT_REGION_TUNING.edgeAlpha, 0.2);
		assert.equal(DEFAULT_REGION_TUNING.bitmap, 256);
	});

	test("nested sections sanitize: garbage snaps inside them without touching the rest", () => {
		const s = sanitizeRenderSettings({
			sizeUnits: "world",
			nodeSize: 3,
			regions: { blur: -5, bitmap: 999, edgeAlpha: 9 },
			physics: { linkStrength: 99, gravity: 7, depthMode: "sideways" },
		});
		assert.equal(s.nodeSize, 3);
		assert.equal(s.regions.blur, REGION_BLUR_LADDER[0]); // ajustado al suelo de la escalera
		assert.equal(s.regions.bitmap, 512); // se ajusta a la opción fija más cercana
		assert.equal(s.regions.edgeAlpha, 1); // ajustado al tope de la escalera
		assert.equal(s.regions.dilation, DEFAULT_REGION_TUNING.dilation);
		assert.equal(s.physics.linkStrength, 4); // tope validado con barrido
		assert.equal(s.physics.gravity, 0.48);
		assert.equal(s.physics.depthMode, "off"); // modo desconocido → off
		assert.equal(s.physics.chargeStrength, DEFAULT_PHYSICS_TUNING.chargeStrength);
	});

	test("the pre-wave stored shape (no labelSize) still loads", () => {
		// los registros de la época de localStorage no tenían labelSize: no debe desplazar nada.
		const s = sanitizeRenderSettings({ sizeUnits: "world", nodeSize: 4, edgeWidth: 1, arrowLength: 5, labelZoom: 0.5, clusterLabels: true });
		assert.equal(s.labelSize, DEFAULT_RENDER_SETTINGS.labelSize);
		assert.equal(s.nodeSize, 4);
		assert.equal(s.labelZoom, 0.5); // ahora 0.5 ES el valor central
	});
});

describe("ladder mapping (11 stops, default-centered)", () => {
	const LADDERS: [string, readonly number[], number][] = [
		["nodeSize", NODE_SIZE_LADDER, DEFAULT_RENDER_SETTINGS.nodeSize],
		["edgeWidth", EDGE_WIDTH_LADDER, DEFAULT_RENDER_SETTINGS.edgeWidth],
		["arrowLength", ARROW_LENGTH_LADDER, DEFAULT_RENDER_SETTINGS.arrowLength],
		["labelSize", LABEL_SIZE_LADDER, DEFAULT_RENDER_SETTINGS.labelSize],
		["labelZoom", LABEL_ZOOM_LADDER, DEFAULT_RENDER_SETTINGS.labelZoom],
		["clusterLabelSize", CLUSTER_LABEL_SIZE_LADDER, DEFAULT_RENDER_SETTINGS.clusterLabelSize],
		["regions.dilation", REGION_DILATION_LADDER, DEFAULT_REGION_TUNING.dilation],
		["regions.blur", REGION_BLUR_LADDER, DEFAULT_REGION_TUNING.blur],
		["regions.edgeAlpha", REGION_EDGE_ALPHA_LADDER, DEFAULT_REGION_TUNING.edgeAlpha],
	];

	// Se restablece la ley del centro (responsable, 2026-10-07 ronda 2): se recentraron
	// las propias escaleras para que los nuevos valores por defecto (labelZoom
	// 0.5 (se muestra 1×) y regions.blur 40) vuelvan a estar en el valor n.º 5.
	test("every ladder has 11 stops; every default is stop #5 (dead-center)", () => {
		for (const [name, ladder, dflt] of LADDERS) {
			assert.equal(ladder.length, 11, name);
			assert.equal(ladder[5], dflt, name); // valor por defecto en el índice 5 → posición 50
		}
	});

	test("every value is a nice number (clean decimal, no float artifacts)", () => {
		// La peor granularidad de todas las escaleras es 1/40 (el suelo de
		// edge-alpha, 0.025); todo lo demás son octavos, cuartos,
		// medios o enteros. Nada parecido a 2.18137...977 puede persistir jamás.
		for (const [name, ladder] of LADDERS) {
			for (const v of ladder) {
				assert.ok(Number.isInteger(v * 40), `${name} stop ${v} isn't a clean fortieth`);
				assert.equal(String(v), `${+v.toFixed(3)}`, `${name} stop ${v} has float noise`);
			}
		}
	});

	test("round-trips: positions 0-100 step 10 hit every stop and back", () => {
		for (const [name, ladder] of LADDERS) {
			for (let i = 0; i < ladder.length; i++) {
				const p = i * 10;
				const stop = ladder[i] as number;
				assert.equal(fromLadderPosition(p, ladder), stop, `${name} @ ${p}`);
				assert.equal(toLadderPosition(stop, ladder), p, `${name} stop ${i}`);
			}
		}
	});

	test("off-ladder positions snap to the nearest stop; extremes clamp", () => {
		for (const [name, ladder] of LADDERS) {
			assert.equal(fromLadderPosition(-20, ladder), ladder[0], name);
			assert.equal(fromLadderPosition(120, ladder), ladder[ladder.length - 1], name);
			// Redondeo hacia arriba en el punto medio 55 (Math.round de JS), así que 54 → valor 5
			// y 58 → valor 6: la lectura del deslizador nunca muestra algo fuera de la escalera.
			assert.equal(fromLadderPosition(54, ladder), ladder[5], name);
			assert.equal(fromLadderPosition(58, ladder), ladder[6], name);
		}
	});

	test("display units are absolute (ratio / 0.5): 8× is the tuned default", () => {
		assert.equal(labelZoomDisplay(0.5), "1×");
		assert.equal(labelZoomDisplay(4), "8×"); // cálculo simple (ratio/0.5): 4 era el antiguo valor por defecto, 0.5 es el nuevo
		assert.equal(labelZoomDisplay(0.75), "1.5×");
		assert.equal(labelZoomDisplay(24), "48×");
		assert.equal(labelZoomDisplay(0.25), "0.5×");
		assert.equal(labelZoomDisplay(0.0625), "0.13×"); // redondeado a 2 decimales
	});
});

describe("physics sliders (fine-grained log, unchanged 2026-09-17)", () => {
	test("every region/physics default sits dead-center at position 50", () => {
		// La física mantiene la ley del deslizador logarítmico: por defecto = media geométrica
		// de los extremos del rango (la repulsión corresponde a |charge|; la fricción tolera
		// la deriva de menos de 0.5°).
		const pairs: [number, number, number][] = [
			[-CHARGE_RANGE.max, -CHARGE_RANGE.min, -DEFAULT_PHYSICS_TUNING.chargeStrength],
			[LINK_STRENGTH_RANGE.min, LINK_STRENGTH_RANGE.max, DEFAULT_PHYSICS_TUNING.linkStrength],
			[LINK_DISTANCE_RANGE.min, LINK_DISTANCE_RANGE.max, DEFAULT_PHYSICS_TUNING.linkDistance],
			[GRAVITY_RANGE.min, GRAVITY_RANGE.max, DEFAULT_PHYSICS_TUNING.gravity],
			[VELOCITY_DECAY_RANGE.min, VELOCITY_DECAY_RANGE.max, DEFAULT_PHYSICS_TUNING.velocityDecay],
			[DEPTH_STRENGTH_RANGE.min, DEPTH_STRENGTH_RANGE.max, DEFAULT_PHYSICS_TUNING.depthStrength],
			[DEPTH_SPACING_RANGE.min, DEPTH_SPACING_RANGE.max, DEFAULT_PHYSICS_TUNING.depthSpacing],
			[DEPTH_BASE_RADIUS_RANGE.min, DEPTH_BASE_RADIUS_RANGE.max, DEFAULT_PHYSICS_TUNING.depthBaseRadius],
		];
		for (const [min, max, d] of pairs) {
			assert.ok(Math.abs(toSliderPosition(d, min, max) - 50) < 0.6, `default ${d} in [${min}, ${max}]`);
		}
		// Campos con zona de apagado: el valor por defecto queda en 50 DENTRO de la parte encendida.
		assert.ok(Math.abs(toOffSliderPosition(DEFAULT_PHYSICS_TUNING.clusterPull, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max) - 50) < 0.6);
	});

	test("the 2026-09-17 charge bump: default −240, dead-center", () => {
		// Usuario: «la repulsión por defecto es demasiado débil». −240 es la media geométrica de
		// [120, 480]: el rango sigue dentro del [30, 480] validado con barrido.
		assert.equal(DEFAULT_PHYSICS_TUNING.chargeStrength, -240);
		assert.ok(Math.abs(toSliderPosition(240, 120, 480) - 50) < 1e-9);
	});

	test("off-slider mapping: position 0 ↔ value 0; the log part round-trips", () => {
		assert.equal(toOffSliderPosition(0, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max), 0);
		assert.equal(fromOffSliderPosition(0, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max), 0);
		const v = fromOffSliderPosition(toOffSliderPosition(0.15, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max), CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max);
		assert.ok(Math.abs(v - 0.15) < 1e-9);
		// Un paso hacia dentro (posición 5) queda justo por encima del suelo logarítmico:
		// min * (max/min)^(5/100), NO el propio suelo (esa es la posición 0,
		// la zona de apagado).
		const stepIn = CLUSTER_PULL_RANGE.min * (CLUSTER_PULL_RANGE.max / CLUSTER_PULL_RANGE.min) ** (5 / 100);
		assert.ok(Math.abs(fromOffSliderPosition(5, CLUSTER_PULL_RANGE.min, CLUSTER_PULL_RANGE.max) - stepIn) < 1e-9);
	});

	test("blur is WORLD units (2026-09-15): free values, snapped to the ladder", () => {
		// Se acabó la época de los px del bitmap: el alcance antiguo escalaba con la
		// extensión del grafo, así que un valor ajustado en un grafo grande se veía demasiado
		// nítido en uno pequeño. Ahora es un alcance canónico en el mundo: cualquier valor
		// guardado se ajusta al más cercano.
		assert.equal(DEFAULT_REGION_TUNING.blur, 40); // nuevo valor por defecto (responsable, 2026-10-07)
		assert.equal(sanitizeRegionTuning({ blur: 3.7 }).blur, 10); // el nuevo suelo
		assert.equal(sanitizeRegionTuning({ blur: 7.2 }).blur, 10);
		assert.equal(sanitizeRegionTuning({ blur: -5 }).blur, REGION_BLUR_LADDER[0]);
		assert.equal(sanitizeRegionTuning({ blur: 999 }).blur, REGION_BLUR_LADDER[REGION_BLUR_LADDER.length - 1]);
		assert.equal(sanitizeRegionTuning({ blur: 99 }).blur, 100); // dentro del intervalo → el valor más cercano, no el tope
		// Un blur guardado de 0 (la antigua zona de apagado) vuelve a ajustarse a la escalera.
		assert.equal(sanitizeRegionTuning({ blur: 0 }).blur, REGION_BLUR_LADDER[0]);
	});

	test("enabled is the compute off switch: only an explicit false turns it off", () => {
		// Activado por defecto; los ficheros persistidos antiguos son anteriores al campo
		// (ausente → activado); la basura cae en activado (fallar hacia el aspecto ajustado).
		assert.equal(DEFAULT_REGION_TUNING.enabled, true);
		assert.equal(sanitizeRegionTuning({}).enabled, true);
		assert.equal(sanitizeRegionTuning({ enabled: false }).enabled, false);
		assert.equal(sanitizeRegionTuning({ enabled: true }).enabled, true);
		assert.equal(sanitizeRegionTuning({ enabled: "no" as unknown as boolean }).enabled, true);
		// Un false explícito sobrevive incluso junto a basura en otros campos.
		assert.equal(sanitizeRegionTuning({ enabled: false, blur: 99, bitmap: 99999 }).enabled, false);
	});
});
