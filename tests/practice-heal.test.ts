/**
 * LA REPARACIÓN DE ARGUMENTOS DE MODELOS DÉBILES (responsable, 2026-10-04: el
 * incidente del bucle de práctica con GLM): glm-5.3 envió `"mode": "\"recall\""`
 * (un enum codificado como cadena JSON) en 19 llamadas `problem` seguidas; el
 * error "must be equal to constant" de TypeBox nunca nombraba los valores
 * esperados, así que el modelo reenviaba la carga idéntica hasta que se mató
 * el servidor de desarrollo.
 *
 * Estas fijaciones sostienen la reparación que se ejecuta en la frontera
 * prepareArguments de pi (ANTES de la validación): los valores de cadena donde
 * el esquema espera una unión de literales / booleano / null / número / array
 * se pasan por JSON.parse y se conservan si el valor analizado cumple el
 * esquema. Los argumentos bien formados pasan intactos (misma referencia); los
 * valores irreparables se quedan para que la validación los rechace con
 * honestidad: las fijaciones DE EXTREMO A EXTREMO usan el propio
 * validateToolArguments de pi-ai: los argumentos reparados pasan donde los
 * originales lanzaban error.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concludeInputObject, problemInputObject } from "../src/agent/tools/practice.ts";
import { healEncodedArguments } from "../src/core/argument-heal.ts";
import { validateToolArguments } from "@earendil-works/pi-ai";

/** La grafía exacta de mode en el incidente: la cadena  "recall"  INCLUIDAS
 *  sus comillas (lo que JSON.parse vuelve a convertir en recall). */
const QUOTED = (s: string) => `"${s}"`;

describe("healEncodedArguments — the GLM incident", () => {
	it("heals the double-encoded mode enum (the exact 19-call loop)", () => {
		const healed = healEncodedArguments({ mode: QUOTED("recall") }, problemInputObject) as {
			mode: unknown;
		};
		assert.equal(healed.mode, "recall");
	});

	it("END-TO-END: the healed args pass pi-ai validation where the raw threw", () => {
		const raw = {
			statement: "Prove that every finite group of prime order is cyclic.",
			mode: QUOTED("recall"), // el incidente: todos los campos válidos SALVO mode
			target: ["group-order"],
			modelSolution: "Let |G| = p. Any x ≠ e generates a subgroup whose order divides p…",
		};
		// La forma original es el incidente: la validación lanza error.
		assert.throws(() => {
			validateToolArguments({ name: "problem", parameters: problemInputObject } as never, {
				id: "call_x",
				type: "toolCall",
				name: "problem",
				arguments: raw,
			} as never);
		});
		const healed = healEncodedArguments(raw, problemInputObject);
		// La forma reparada es válida: el bucle no llega a empezar.
		const validated = validateToolArguments(
			{ name: "problem", parameters: problemInputObject } as never,
			{ id: "call_x", type: "toolCall", name: "problem", arguments: healed } as never,
		);
		assert.equal((validated as { mode: unknown }).mode, "recall");
	});

	it("well-formed args pass through untouched — the SAME reference", () => {
		const args = { mode: "recall", target: ["a"], retest: false };
		assert.equal(healEncodedArguments(args, problemInputObject), args);
		assert.equal(healEncodedArguments(args, concludeInputObject), args);
	});

	it("unhealable values stay — validation rejects them honestly", () => {
		const healed = healEncodedArguments({ mode: QUOTED("bogus") }, problemInputObject) as {
			mode: unknown;
		};
		assert.equal(healed.mode, QUOTED("bogus"));
	});
});

describe("healEncodedArguments — the sibling encodings", () => {
	it("heals the conclude enums (outcome) and the null rung", () => {
		const healed = healEncodedArguments(
			{ outcome: QUOTED("solved"), rung: "null" },
			concludeInputObject,
		) as { outcome: unknown; rung: unknown };
		assert.equal(healed.outcome, "solved");
		assert.equal(healed.rung, null);
	});

	it("heals the rung enum and the stringified boolean retest", () => {
		const healed = healEncodedArguments(
			{ rung: QUOTED("R2"), retest: "true" },
			concludeInputObject,
		) as { rung: unknown; retest: unknown };
		assert.equal(healed.rung, "R2");
		assert.equal(healed.retest, true);
	});

	it("heals a stringified array (the extraction-bug sibling)", () => {
		const healed = healEncodedArguments({ target: '["a","b"]' }, problemInputObject) as {
			target: unknown;
		};
		assert.deepEqual(healed.target, ["a", "b"]);
	});

	it("leaves plain string properties alone (statement is a string schema)", () => {
		const args = { statement: '"not JSON-healed"' };
		const healed = healEncodedArguments(args, problemInputObject) as { statement: unknown };
		// Una propiedad Type.String no tiene literales ni coincidencia de tipo escalar:
		// la cadena pasa tal cual (misma referencia, nada clonado).
		assert.equal(healed, args);
	});

	it("passes non-object shapes through (null, arrays, strings)", () => {
		assert.equal(healEncodedArguments(null, problemInputObject), null);
		const arr = [1, 2];
		assert.equal(healEncodedArguments(arr, problemInputObject), arr);
		assert.equal(healEncodedArguments("mode", problemInputObject), "mode");
	});
});
