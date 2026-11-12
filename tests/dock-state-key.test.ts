/**
 * La clave de variante del armazón del dock: el disparador de la transformación de altura con WAAPI. Se fijó
 * tras el arreglo del plegado de la práctica (responsable, 2026-10-06): el término expandido
 * pertenece a todas las variantes acopladas, así que el plegado/desplegado de un dock de práctica
 * se transforma exactamente igual que el de una pregunta de enseñanza. Antes del arreglo la clave
 * era `pending ? expanded : "-"`: pending es null en la práctica, la
 * clave nunca cambiaba al plegar y la altura del dock de práctica saltaba
 * al instante entre formulario y barra mientras que la enseñanza se transformaba.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dockStateKey } from "../components/dock-state-key.ts";

describe("dockStateKey (the height-morph trigger)", () => {
	it("a docked variant carries its fold state — practice included", () => {
		assert.equal(dockStateKey("practice:call_p1", true, true), "practice:call_p1:true");
		assert.equal(dockStateKey("practice:call_p1", true, false), "practice:call_p1:false");
		assert.equal(dockStateKey("question:call_q1", true, true), "question:call_q1:true");
		assert.equal(dockStateKey("question:call_q1", true, false), "question:call_q1:false");
	});

	it("the fold toggling the key is what animates: same variant + same fold = same key (typing growth never morphs)", () => {
		assert.equal(
			dockStateKey("practice:call_p1", true, true),
			dockStateKey("practice:call_p1", true, true),
		);
		assert.notEqual(
			dockStateKey("practice:call_p1", true, true),
			dockStateKey("practice:call_p1", true, false),
		);
	});

	it("an undocked band (the composer) has no fold term", () => {
		assert.equal(dockStateKey("chat", false, true), "chat:-");
		assert.equal(dockStateKey("chat", false, false), "chat:-");
	});
});
