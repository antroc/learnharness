/**
 * La ley de los colores de estado (oleada de temas, 2026-11-04): el adorno de
 * error / éxito / aviso usa los tokens del tema (text-error, bg-success/15, …),
 * nunca una clase fija de la paleta de Tailwind, que ignoraría el tema activo.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

describe("status colors are theme tokens", () => {
	it("no red/green/amber palette class is left under components/ or app/", () => {
		let out = "";
		try {
			out = execFileSync(
				"git",
				["grep", "--untracked", "-n", "-E", "\\b(text|bg|border|fill|stroke|ring)-(red|green|amber)-[0-9]{3}", "--", "components", "app"],
				{ cwd: new URL("..", import.meta.url), encoding: "utf8" },
			).trim();
		} catch (e) {
			// git grep sale con 1 cuando nada coincide: el caso que pasa.
			if ((e as { status?: number }).status !== 1) throw e;
		}
		assert.equal(out, "");
	});
});
