/**
 * Pruebas del almacén de sustituciones de prompts (oleada de almacenamiento de
 * ajustes, 2026-09-19): src/store/prompt-overrides.ts: CRUD de ficheros de
 * sustitución, la disciplina de rutas del layout espejo (guarda contra el
 * recorrido de directorios) y la lista de segmentos DERIVADA DEL CÓDIGO FUENTE
 * (el cargador replica el descubrimiento de composeInstructions de
 * teacher-agent.ts; estas pruebas fijan que el espejo sigue el árbol real de
 * src/agent/prompts).
 *
 * AISLAMIENTO DEL DIRECTORIO DE PRUEBAS (arreglo del contrato, interludio
 * 2026-09-26): data/prompts contiene ficheros REALES de sustitución del
 * usuario y esta batería nunca debe tocarlo (el antiguo after() lo borraba
 * como «espacio temporal desechable», lo que mataba sustituciones reales y
 * dejaba huérfanos sus interruptores ON). LH_DATA_DIR es la frontera
 * establecida de ubicación de datos (contrato de Electron, 2026-09-17; ver
 * data-dir-seam.test.ts), que se evalúa al CARGAR EL MÓDULO config.ts, así que
 * debe fijarse antes del primer import que cargue (transitivamente) config.
 * Por eso mismo todos los imports de módulos de la app de abajo son dinámicos;
 * solo los módulos integrados de Node y las bibliotecas independientes de
 * config siguen siendo estáticos. Las fijaciones de la frontera del final
 * comprueban la redirección y after() verifica con una instantánea que el
 * data/prompts REAL del repo sobrevivió intacto a la batería.
 *
 * Este fichero es el RESPONSABLE del directorio temporal (disciplina de
 * pruebas en paralelo: un responsable del sistema de ficheros por fichero):
 * todas las pruebas que escriben sustituciones viven aquí, incluidas las
 * fijaciones del contrato a nivel de ruta del mismo interludio
 * (borrar-limpia-el-interruptor, ON-huérfano-se-repara-a-OFF).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

// ── la frontera, ANTES de cualquier import que cargue la configuración ──────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-prompt-overrides-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { PROMPTS_OVERRIDE_DIR } = await import("../config.ts");
const teacherAgent = await import("../src/agent/teacher-agent.ts");
const { allSegmentPaths, effectivePromptSegments } = await import("../src/agent/prompt-segments.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
// Las fijaciones a nivel de ruta usan los manejadores reales de app/api (Request/Response
// sin framework), aislados bajo el mismo LH_DATA_DIR temporal.
const { PUT: putSettingsSection } = await import("../app/api/settings/[section]/route.ts");
const { PUT: putPromptText, DELETE: deletePromptText } = await import("../app/api/settings/prompts/[...segment]/route.ts");
const { GET: getPromptSegments } = await import("../app/api/settings/prompts/route.ts");
const { readSettingsRecord } = await import("../src/server/index.ts");

/** El directorio de prompts REAL del repo, que esta batería nunca debe tocar (solo lectura). */
const REPO_PROMPTS = path.resolve(import.meta.dirname, "../data/prompts");

/** Instantánea recursiva de solo lectura de un directorio (líneas ordenadas
 *  "rel|size"): la fijación de supervivencia compara antes/después de toda la batería. */
function snapshotDir(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (rel: string) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(child);
			else out.push(`${child}|${fs.statSync(path.join(dir, child)).size}`);
		}
	};
	walk("");
	return out;
}
const REAL_PROMPTS_BEFORE = snapshotDir(REPO_PROMPTS);

after(() => {
	// El espacio temporal propio de la batería desaparece; el directorio REAL del usuario debe quedar intacto.
	assert.deepEqual(
		snapshotDir(REPO_PROMPTS),
		REAL_PROMPTS_BEFORE,
		"real data/prompts survives npm test byte-for-byte (the old suite wiped it)",
	);
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** Un motor pi guionizado (el proveedor simulado de pi-ai): construir el agente
 *  requiere un motor inyectado desde que BYOK quitó las fijaciones de fábrica (responsable, 2026-09-22). */
function fauxEngine(): PiEngine {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** PUT /api/settings/<section> con un contexto de params fabricado. */
function putSection(section: string, body: unknown): Promise<Response> {
	return putSettingsSection(
		new Request(`http://test/api/settings/${section}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ section }) },
	);
}

/** DELETE /api/settings/prompts/<segment...> con un contexto de params fabricado. */
function deleteSegment(segment: string[]): Promise<Response> {
	return deletePromptText(new Request("http://test/api/settings/prompts", { method: "DELETE" }), {
		params: Promise.resolve({ segment }),
	});
}

describe("isValidSegmentPath (the mirror-layout discipline)", () => {
	it("accepts the shared base and numeric fragments, rejects everything else", () => {
		assert.equal(isValidSegmentPath("system-prompt.md"), true);
		assert.equal(isValidSegmentPath("teacher/20-teaching.md"), true);
		assert.equal(isValidSegmentPath("prober/10-probe-doctrine.md"), true);
		// el directorio de fragmentos shared/ (fuentes v1): lo componen LOS DOS agentes
		// y se puede sustituir como cualquier otro segmento
		assert.equal(isValidSegmentPath("shared/10-personality.md"), true);
		for (const bad of [
			"", // vacío
			"README.md", // sin directorio de agente
			"teacher/README.md", // sin prefijo numérico
			"teacher/20-teaching.txt", // no es .md
			"../system-prompt.md", // recorrido de directorios
			"agent/../teacher/20-teaching.md", // recorrido de directorios
			"/etc/passwd", // absoluta
			"teacher", // directorio a secas
			"teacher/", // directorio a secas
			"teacher/sub/10-x.md", // anidada (no es el layout espejo)
			"prober\\10-x.md", // barra invertida
		]) {
			assert.equal(isValidSegmentPath(bad), false, bad);
		}
	});
});

describe("the override store", () => {
	it("listOverrides is empty with no dir, then lists written mirrors sorted", () => {
		fs.rmSync(PROMPTS_OVERRIDE_DIR, { recursive: true, force: true });
		assert.deepEqual(promptOverrides.listOverrides(), []);
		promptOverrides.writeOverride("teacher/20-teaching.md", "custom teaching");
		promptOverrides.writeOverride("system-prompt.md", "custom base");
		assert.deepEqual(promptOverrides.listOverrides(), ["system-prompt.md", "teacher/20-teaching.md"]);
	});

	it("readOverride round-trips; delete removes idempotently; invalid paths no-op", () => {
		promptOverrides.writeOverride("prober/30-probe-done.md", "custom probe-done");
		assert.equal(promptOverrides.readOverride("prober/30-probe-done.md"), "custom probe-done");
		promptOverrides.deleteOverride("prober/30-probe-done.md");
		assert.equal(promptOverrides.readOverride("prober/30-probe-done.md"), null);
		promptOverrides.deleteOverride("prober/30-probe-done.md"); // otra vez: no lanza error
		// la basura de recorrido de directorios nunca llega al disco
		promptOverrides.writeOverride("../evil.md", "nope");
		assert.equal(fs.existsSync(path.join(PROMPTS_OVERRIDE_DIR, "..", "evil.md")), false);
	});

	it("switches are NOT the store's concern — files alone never enable", () => {
		promptOverrides.writeOverride("system-prompt.md", "custom base");
		const off = effectivePromptSegments("teacher", {}) // sin interruptores
			.find((s) => s.path === "system-prompt.md");
		assert.ok(off);
		assert.equal(off.overrideText, "custom base"); // el fichero existe...
		assert.equal(off.enabled, false); // ...pero sin interruptor → valor por defecto de la fuente
		promptOverrides.deleteOverride("system-prompt.md"); // deja limpio para las pruebas hermanas
	});
});

describe("the source-derived segment list", () => {
	it("mirrors composeInstructions' discovery: base first, numeric fragments sorted, per agent", () => {
		const prober = effectivePromptSegments("prober", {});
		const teacher = effectivePromptSegments("teacher", {});
		// La base compartida compone ambos prompts, MISMA ruta.
		assert.equal(prober[0]?.path, "system-prompt.md");
		assert.equal(teacher[0]?.path, "system-prompt.md");
		assert.equal(prober[0].shared, true);
		assert.equal(teacher[0].shared, true);
		assert.equal(prober[0].sourceText.length > 0, true, "base prompt text loads");
		// Los fragmentos siguen el árbol fuente REAL (orden numérico, directorio de agente correcto),
		// con los fragmentos PROPIOS del agente entre la base y el apéndice shared/:
		// el orden exacto en que los carga composeInstructions (reordenación, 2026-09-27:
		// la tarea y el método van delante, la mecánica detrás).
		assert.deepEqual(
			prober.map((s) => s.path),
			[
				"system-prompt.md",
				"prober/10-probe-doctrine.md",
				"shared/10-voice.md",
				"shared/15-accuracy.md",
				"shared/16-mental-model.md",
				"shared/20-question-tools.md",
				"shared/25-confidence.md",
				"shared/30-learner-files.md",
				"shared/35-side-conversations.md",
				"shared/40-formatting.md",
			],
		);
		assert.equal(teacher.some((s) => s.path === "teacher/05-method.md"), true);
		assert.equal(teacher.some((s) => s.path === "teacher/10-planning.md"), true);
		assert.equal(teacher.some((s) => s.path === "teacher/60-probing-in-brief.md"), false);
		assert.equal(
			teacher.every(
				(s) => s.path === "system-prompt.md" || s.path.startsWith("teacher/") || s.path.startsWith("shared/"),
			),
			true,
		);
		// los fragmentos compartidos se componen para LOS DOS agentes, misma clave de ruta.
		assert.equal(teacher.some((s) => s.path === "shared/30-learner-files.md" && s.shared), true);
		assert.equal(prober.some((s) => s.path === "shared/30-learner-files.md" && s.shared), true);
		// La voz y la precisión VOLVIERON a los fragmentos de shared/ (ronda 13 del responsable,
		// 2026-10-05): una ley para todos los agentes, práctica incluida, cuya
		// casi copia se había quedado desfasada ("You have no research tool here").
		assert.equal(prober.some((s) => s.path === "shared/10-voice.md" && s.shared), true);
		assert.equal(teacher.some((s) => s.path === "shared/10-voice.md" && s.shared), true);
		assert.equal(prober.some((s) => s.path === "shared/15-accuracy.md" && s.shared), true);
		// La MECÁNICA de las herramientas es compartida; la METODOLOGÍA de las preguntas pertenece a cada fase.
		assert.equal(prober.some((s) => s.path.startsWith("teacher/")), false);
		assert.equal(teacher.some((s) => s.path.startsWith("prober/")), false);
		// El README y los demás ficheros no numéricos nunca se cargan.
		assert.equal(allSegmentPaths().some((p) => p.includes("README")), false);
	});

	it("effective segments: switch+file → override; either missing → source text", () => {
		promptOverrides.writeOverride("teacher/20-teaching.md", "MY WAY");
		const switches = { "teacher/20-teaching.md": true, "system-prompt.md": false };
		const teacher = effectivePromptSegments("teacher", switches);
		const teaching = teacher.find((s) => s.path === "teacher/20-teaching.md");
		assert.ok(teaching);
		assert.equal(teaching.overrideText, "MY WAY");
		assert.equal(teaching.enabled, true);
		// base: interruptor OFF con el fichero AUSENTE → fuente, desactivado
		const base = teacher.find((s) => s.path === "system-prompt.md");
		assert.ok(base);
		assert.equal(base.overrideText, null);
		assert.equal(base.enabled, false);
		// un interruptor para un segmento SIN fichero de sustitución nunca lo activa
		const weird = effectivePromptSegments("teacher", { "teacher/10-planning.md": true });
		const planning = weird.find((s) => s.path === "teacher/10-planning.md");
		assert.ok(planning);
		assert.equal(planning.enabled, false);
		assert.equal(planning.overrideText, null);
	});

	it("adapts to source changes by construction: the list is computed, not stored", () => {
		// Si un fragmento desaparece en el original, su interruptor/sustitución simplemente deja
		// de componerse: aquí nada puede quedar obsoleto. Se fija por ausencia:
		const before = allSegmentPaths().length;
		assert.equal(before > 5, true, "base + prober fragments + teacher fragments");
	});
});

// ─── composeInstructions respeta las sustituciones (conciliación P2, 2026-09-19) ─
// Este fichero es el RESPONSABLE del PROMPTS_OVERRIDE_DIR (aislado) (disciplina de
// pruebas en paralelo), así que aquí viven todas las pruebas de composición que escriben sustituciones.

describe("composeInstructions: override honoring + the byte-identical source path", () => {
	const { composeInstructions, createTeacherAgent } = teacherAgent;

	it("switches-less composition is byte-identical to the pre-refactor loader", () => {
		// El cargador simple, reconstruido aquí: base + los fragmentos propios del
		// agente + el apéndice shared/ (la reordenación del 2026-09-27),
		// recortados, sin los vacíos y unidos con el separador.
		const oldLoader = (kind: "prober" | "teacher") => {
			const fragmentsOf = (dir: string) =>
				fs
					.readdirSync(dir)
					.filter((f) => /^\d+-[\w.-]+\.md$/.test(f))
					.sort()
					.map((f) => fs.readFileSync(path.join(dir, f), "utf-8").trim())
					.filter(Boolean);
			const base = fs.readFileSync("src/agent/system-prompt.md", "utf-8").trim();
			return [
				base,
				...fragmentsOf(`src/agent/prompts/${kind}`),
				...fragmentsOf("src/agent/prompts/shared"),
			].join("\n\n---\n\n");
		};
		assert.equal(composeInstructions("teacher"), oldLoader("teacher"));
		assert.equal(composeInstructions("prober"), oldLoader("prober"));
	});

	it("an enabled override swaps in; switch off or file absent composes source", () => {
		promptOverrides.writeOverride("teacher/20-teaching.md", "CUSTOM TEACHING LOOP");
		try {
			const on = composeInstructions("teacher", { "teacher/20-teaching.md": true });
			assert.ok(on.includes("CUSTOM TEACHING LOOP"), "override composes when switch on");
			assert.ok(!on.includes("# Teach — one step at a time"), "source text is replaced");
			// interruptor apagado → valor por defecto de la fuente (el fichero sigue en disco)
			const off = composeInstructions("teacher", {});
			assert.ok(off.includes("# Teach — one step at a time"), "source composes when switch off");
			// interruptor encendido para un segmento SIN fichero → fuente (activarlo requiere ambos)
			const noFile = composeInstructions("teacher", { "teacher/10-planning.md": true });
			assert.ok(noFile.includes("# Planning"), "file absent → source default");
		} finally {
			promptOverrides.deleteOverride("teacher/20-teaching.md");
		}
	});

	it("shared/ fragments are overridable — one edit swaps the doctrine in BOTH agents", () => {
		promptOverrides.writeOverride("shared/30-learner-files.md", "MY SHARED FILES DOCTRINE");
		try {
			const switches = { "shared/30-learner-files.md": true };
			for (const kind of ["teacher", "prober"] as const) {
				const composed = composeInstructions(kind, switches);
				assert.ok(composed.includes("MY SHARED FILES DOCTRINE"), `${kind} composes the override`);
				assert.ok(!composed.includes("## Learner files"), `${kind} source fragment is replaced`);
			}
			// sin interruptores: los dos conservan el fragmento de la fuente (la ruta en caché)
			assert.ok(composeInstructions("teacher").includes("## Learner files"));
		} finally {
			promptOverrides.deleteOverride("shared/30-learner-files.md");
		}
	});

	it("promptSwitches threads through agent construction into the system prompt", () => {
		promptOverrides.writeOverride("system-prompt.md", "TOTALLY CUSTOM BASE");
		try {
			// BYOK (responsable, 2026-09-22): sin fijaciones de fábrica: construir el agente
			// requiere un motor inyectado; uno simulado y guionizado hace las veces (aquí se
			// prueba el prompt, no el modelo).
			const engine = fauxEngine();
			const agent = createTeacherAgent(undefined, { engine, promptSwitches: { "system-prompt.md": true } });
			assert.ok(agent.state.systemPrompt.includes("TOTALLY CUSTOM BASE"));
			const source = createTeacherAgent(undefined, { engine });
			assert.ok(!source.state.systemPrompt.includes("TOTALLY CUSTOM BASE"), "no switches → cached source");
		} finally {
			promptOverrides.deleteOverride("system-prompt.md");
		}
	});
});

// ─── el contrato de reparación de huérfanos (interludio, 2026-09-26) ─────────
// La trampa del 400 huérfano: un interruptor ON cuyo fichero desaparece dejaba huérfano
// el registro; después todas las escrituras de la sección de agentes daban 400 mientras el
// conmutador desactivado no podía llegar a la salida de emergencia OFF: el usuario no podía guardar ajustes.
// Arreglo: la ruta de borrado limpia el interruptor por construcción, Y el camino de escritura
// repara cualquier huérfano que aún surja (borrados del disco fuera de la app).

describe("delete clears the switch — the record and file agree by construction", () => {
	const SEGMENT = "teacher/20-teaching.md";

	it("DELETE removes the file AND clears the on-switch in one operation", async () => {
		promptOverrides.writeOverride(SEGMENT, "custom teaching");
		const on = await putSection("agent", { prompts: { [SEGMENT]: true } });
		assert.equal(on.status, 200, "ON with a real file is valid");
		assert.equal(readSettingsRecord()?.agent?.prompts?.[SEGMENT], true, "switch landed in the record");

		const res = await deleteSegment(["teacher", "20-teaching.md"]);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { deleted: boolean; switchCleared: boolean };
		assert.deepEqual(body, { path: SEGMENT, deleted: true, switchCleared: true }, "the response names what happened");

		assert.equal(readSettingsRecord()?.agent?.prompts?.[SEGMENT], undefined, "the switch is GONE from the record");
		assert.equal(promptOverrides.readOverride(SEGMENT), null, "the file is gone");
		// Y el paso 4 de la trampa (cambiar después cualquier conmutador de herramienta)
		// funciona sin más (no hay nada huérfano que replicar):
		const followUp = await putSection("agent", { tools: { research: false } });
		assert.equal(followUp.status, 200, "a subsequent agent write succeeds");
		assert.equal(readSettingsRecord()?.agent?.tools?.research, false);
	});

	it("DELETE is idempotent for file and switch — nothing to clear, still 200", async () => {
		const res = await deleteSegment(["teacher", "20-teaching.md"]);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { switchCleared: boolean };
		assert.equal(body.switchCleared, false, "no switch was present — nothing cleared");
	});
});

describe("an orphaned ON heals to OFF on write — never a 400 (the invariant: a user can never get stuck)", () => {
	const SEGMENT = "teacher/20-teaching.md";

	it("the exact repro: file wiped at disk level → UI mirrors the orphan and flips a tool toggle → the write SUCCEEDS and heals", async () => {
		promptOverrides.writeOverride(SEGMENT, "custom teaching");
		const on = await putSection("agent", { prompts: { [SEGMENT]: true } });
		assert.equal(on.status, 200);

		// El borrado a nivel de disco, FUERA de la app (la ruta de borrado ya limpia
		// el interruptor, así que es la única forma de que aún surja un huérfano).
		fs.rmSync(path.join(PROMPTS_OVERRIDE_DIR, "teacher", "20-teaching.md"));

		// La forma exacta de la trampa: el cliente replica el ON huérfano del registro
		// mientras escribe un conmutador de herramienta no relacionado. Hoy (antes del arreglo) → 400 para siempre.
		const res = await putSection("agent", { tools: { research: false }, prompts: { [SEGMENT]: true } });
		assert.equal(res.status, 200, "the write heals instead of 400-ing — the user is never stuck");

		const record = readSettingsRecord();
		assert.equal(record?.agent?.prompts?.[SEGMENT], undefined, "the orphaned ON landed as OFF (key dropped)");
		assert.equal(record?.agent?.tools?.research, false, "the rest of the write landed — nothing was silently dropped");

		// Y la SEGUNDA escritura (el «400 para siempre» de la trampa) también funciona:
		const again = await putSection("agent", { tools: { research: false }, prompts: { [SEGMENT]: true } });
		assert.equal(again.status, 200, "repeated writes keep succeeding");
	});

	it("an ON for a segment that left the source tree heals the same way", async () => {
		promptOverrides.writeOverride(SEGMENT, "custom teaching");
		// Un huérfano de fragmento desaparecido: el interruptor apunta a una ruta que ya
		// no es un segmento actual de la fuente (se simula con una clave basura que el
		// almacén nunca vigiló: el registro es el único sitio donde existe).
		const on = await putSection("agent", { prompts: { "teacher/99-vanished.md": true, [SEGMENT]: true } });
		assert.equal(on.status, 200, "vanished-fragment ON heals too, not a 400");
		assert.equal(readSettingsRecord()?.agent?.prompts?.["teacher/99-vanished.md"], undefined, "the vanished key healed to OFF");
		promptOverrides.deleteOverride(SEGMENT);
	});

	it("a VALID ON (file present) stays valid — no heal, no 400", async () => {
		promptOverrides.writeOverride(SEGMENT, "custom teaching");
		try {
			const res = await putSection("agent", { prompts: { [SEGMENT]: true } });
			assert.equal(res.status, 200);
			const record = (await res.json()) as { settings: { agent?: { prompts?: Record<string, boolean> } } };
			assert.equal(record.settings.agent?.prompts?.[SEGMENT], true, "a real ON+file write keeps the switch on");
		} finally {
			promptOverrides.deleteOverride(SEGMENT);
		}
	});
});

describe("Practice settings API and effective prompt loading", () => {
	it("GET exposes the actual source-discovered Practice fragments and shared subset", async () => {
		const response = await getPromptSegments();
		assert.equal(response.status, 200);
		const view = await response.json();
		for (const kind of ["teacher", "prober", "practice"] as const) {
			assert.deepEqual(view[kind], effectivePromptSegments(kind, readSettingsRecord()?.agent?.prompts ?? {}));
		}
		assert.deepEqual(view.practice.map((s: { path: string }) => s.path), [
			"practice/00-base.md", "practice/10-doctrine.md",
			"shared/10-voice.md", "shared/15-accuracy.md", "shared/16-mental-model.md", "shared/35-side-conversations.md", "shared/40-formatting.md",
		]);
		assert.ok(!view.practice.some((s: { path: string }) => s.path === "system-prompt.md"));
	});

	for (const segment of ["practice/00-base.md", "practice/10-doctrine.md"]) {
		it(`${segment}: save, enable, disable, re-enable and delete recover defaults without changing other agents`, async () => {
			const defaults = Object.fromEntries((["teacher", "prober", "practice"] as const).map((kind) => [kind, teacherAgent.composeInstructions(kind)]));
			const text = `SYNTHETIC PRACTICE OVERRIDE ${segment}`;
			const context = { params: Promise.resolve({ segment: segment.split("/") }) };
			const saved = await putPromptText(new Request("http://test/api/settings/prompts", {
				method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
			}), context);
			assert.equal(saved.status, 200);
			const loaded = () => teacherAgent.composeInstructions("practice", readSettingsRecord()?.agent?.prompts ?? {});
			assert.equal((await putSection("agent", { prompts: {} })).status, 200);
			assert.equal(loaded(), defaults.practice, "saving text alone does not enable it");
			for (const on of [true, false, true]) {
				assert.equal((await putSection("agent", { tools: { research: false }, prompts: on ? { [segment]: true } : {} })).status, 200);
				const view = await (await getPromptSegments()).json();
				const row = view.practice.find((s: { path: string }) => s.path === segment);
				assert.equal(row.enabled, on);
				assert.equal(row.overrideText, text);
				const expected = effectivePromptSegments("practice", {}).map((s) => (on && s.path === segment ? text : s.sourceText).trim()).filter(Boolean).join("\n\n---\n\n");
				assert.equal(loaded(), expected, "actual composed instructions replace exactly one source fragment");
				for (const kind of ["teacher", "prober"] as const) {
					assert.equal(teacherAgent.composeInstructions(kind, readSettingsRecord()?.agent?.prompts ?? {}), defaults[kind]);
				}
			}
			assert.equal((await deleteSegment(segment.split("/"))).status, 200);
			assert.equal(readSettingsRecord()?.agent?.prompts?.[segment], undefined);
			assert.equal(readSettingsRecord()?.agent?.tools?.research, false, "unrelated settings preserved");
			assert.equal(loaded(), defaults.practice);
			const view = await (await getPromptSegments()).json();
			const row = view.practice.find((s: { path: string }) => s.path === segment);
			assert.equal(row.enabled, false);
			assert.equal(row.overrideText, null);
			assert.equal(teacherAgent.composeInstructions("practice", { [segment]: true }), defaults.practice, "missing file cannot enable an override");
		});
	}

	it("shared edits reach exactly their runtime members, never adding the teaching base to Practice", () => {
		const defaults = Object.fromEntries((["teacher", "prober", "practice"] as const).map((kind) => [kind, teacherAgent.composeInstructions(kind)]));
		for (const segment of ["system-prompt.md", "shared/10-voice.md", "shared/20-question-tools.md"]) {
			const text = `SYNTHETIC SHARED OVERRIDE ${segment}`;
			promptOverrides.writeOverride(segment, text);
			try {
				for (const kind of ["teacher", "prober", "practice"] as const) {
					const member = effectivePromptSegments(kind, {}).some((s) => s.path === segment);
					const composed = teacherAgent.composeInstructions(kind, { [segment]: true });
					assert.equal(composed.includes(text), member);
					if (!member) assert.equal(composed, defaults[kind]);
				}
			} finally { promptOverrides.deleteOverride(segment); }
		}
	});
});

describe("test isolation (the suite must never touch real user data)", () => {
	it("every write this suite makes lands under the LH_DATA_DIR seam, not the repo data dir", () => {
		assert.ok(
			PROMPTS_OVERRIDE_DIR.startsWith(TMP_DATA),
			`PROMPTS_OVERRIDE_DIR (${PROMPTS_OVERRIDE_DIR}) must live under the temp seam (${TMP_DATA})`,
		);
		assert.notEqual(
			PROMPTS_OVERRIDE_DIR,
			REPO_PROMPTS,
			"the seam must NOT resolve to the repo's real data/prompts",
		);
		// La batería demuestra que escribe aquí:
		promptOverrides.writeOverride("system-prompt.md", "isolation probe");
		assert.equal(
			fs.existsSync(path.join(TMP_DATA, "prompts", "system-prompt.md")),
			true,
			"the write landed under the temp dir",
		);
		promptOverrides.deleteOverride("system-prompt.md");
	});
});
