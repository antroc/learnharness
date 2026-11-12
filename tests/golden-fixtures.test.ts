/**
 * FIXTURES DE REFERENCIA (decisión del responsable, 2026-10-10): datos reales de usuario, literales,
 * leídos por las rutas de lectura de PRODUCCIÓN. tests/fixtures/golden-data/ es un
 * directorio de datos real (ver su README); esta batería lo copia a un directorio temporal, apunta
 * los almacenes a él mediante la frontera LH_DATA_DIR (fijada ANTES de cualquier importación que
 * cargue la configuración; toda importación de módulos de la aplicación es dinámica) y comprueba:
 *
 *   1. todo registro se analiza y supera los plegados de contrato que ejecuta la propia
 *      aplicación (fases, preguntas/problemas pendientes, árbol del plan, resúmenes);
 *   2. el aplanado para el cable del LLM (toLlmMessages) convierte cada registro completo en
 *      una lista de mensajes legal para el proveedor: la propiedad más fuerte que tiene un registro;
 *   3. la derivación del grafo se construye a partir de los registros reales de extremo a extremo;
 *   4. COBERTURA de marcadores: todo tipo de marcador personalizado del contrato actual
 *      aparece aquí en datos reales (un marcador nuevo sin actualizar el fixture
 *      hace fallar esta batería);
 *   5. las lecturas son de SOLO LECTURA: tras todo lo anterior, la copia es
 *      idéntica byte a byte a la fuente del fixture.
 *
 * LA LEY DE LOS FIXTURES: un cambio de formato intencionado actualiza los fixtures en el
 * mismo commit; uno no intencionado falla aquí.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures", "golden-data");

// ── la frontera, ANTES de cualquier importación que cargue la configuración ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-golden-"));
fs.cpSync(GOLDEN, TMP, { recursive: true });
process.env.LH_DATA_DIR = TMP;

const { chatStore } = await import("../src/store/chats.ts");
const { graphStore } = await import("../src/store/graph.ts");
const { jobStore } = await import("../src/store/jobs.ts");
const { settingsStore } = await import("../src/store/settings.ts");
const { readRenderSettings } = await import("../src/store/render-settings.ts");
const { getGraph, deriveView } = await import("../src/core/graph.ts");
const { sanitizeRenderSettings } = await import("../src/core/render-settings.ts");
const { toLlmMessages } = await import("../src/core/native-messages.ts");
const { phaseAt3Lh } = await import("../src/core/phases.ts");
const { danglingQuestionOf, activeProblemOf } = await import("../src/core/native-messages.ts");

const TEACH = "chat_mv27rrra_feff23b6";
const PRACTICE = "chat_mv293wv5_10656952";

function snapshotTree(dir: string): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		const st = fs.statSync(p);
		if (st.isDirectory()) for (const [k, v] of snapshotTree(p)) out.set(`${name}/${k}`, v);
		else out.set(name, fs.readFileSync(p));
	}
	return out;
}
const BEFORE = snapshotTree(TMP);

test.after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

// ── chats: registros, plegados y el cable ───────────────────────────────────

test("chats: both fixture records parse through the production read path", () => {
	const list = chatStore.listChats();
	const ids = new Set(list.map((c) => c.id));
	assert.ok(ids.has(TEACH), "the teach master record lists");
	assert.ok(ids.has(PRACTICE), "the practice lifecycle record lists");

	for (const id of [TEACH, PRACTICE]) {
		const r = chatStore.getChat(id);
		assert.ok(r, `${id} reads`);
		assert.ok(Array.isArray(r!.messages) && r!.messages.length > 0);
		// los plegados que ejecuta la propia aplicación en cada renderizado/turno:
		assert.equal(typeof phaseAt3Lh(r!.messages), "string", "the phase fold runs clean");
		assert.equal(danglingQuestionOf(r!.messages), null, "no dangling question tool call");
		activeProblemOf(r!.messages); // no debe lanzar
	}
});

test("chats: the LLM wire flattening turns each full record into a legal provider message list", () => {
	for (const id of [TEACH, PRACTICE]) {
		const r = chatStore.getChat(id)!;
		const wire = toLlmMessages(r.messages as never);
		assert.ok(wire.length > 0);
		for (const m of wire) {
			assert.ok(["system", "user", "assistant", "toolResult"].includes(m.role), `legal role ${m.role} in ${id}`);
			// todo toolResult responde a una llamada que apareció ANTES que él
			if (m.role === "toolResult") {
				const t = m as { toolCallId: string };
				assert.ok(
					wire.some((w) => w.role === "assistant" && JSON.stringify(w).includes(t.toolCallId)),
					`toolResult ${t.toolCallId} has its calling assistant message`,
				);
			}
		}
		// ningún toolCall del asistente queda sin respuesta (la síntesis de llamadas colgantes cubre los abortos)
		const answered = new Set(wire.filter((w) => w.role === "toolResult").map((w) => (w as { toolCallId: string }).toolCallId));
		for (const m of wire) {
			if (m.role !== "assistant") continue;
			for (const b of (m as { content: Array<{ type: string; id?: string }> }).content) {
				if (b.type === "toolCall" && b.id) assert.ok(answered.has(b.id), `call ${b.id} is answered on the wire`);
			}
		}
	}
});

test("markers: the fixture pair covers EVERY custom-marker kind of the current contract", () => {
	// La ley de cobertura: un customType nuevo añadido al contrato sin datos reales
	// de fixture falla aquí; amplía los fixtures en el mismo commit.
	const EXPECTED = [
		"graph-context",
		"probe-handoff",
		"subagent-steer",
		"subagent-abort",
		"plan-block",
		"practice-thinking",
		"practice-next",
		"problem-dismissed",
		"compaction",
	] as const;
	const seen = new Set<string>();
	for (const id of [TEACH, PRACTICE]) {
		for (const m of chatStore.getChat(id)!.messages) {
			if ((m as { role?: string }).role === "custom") seen.add((m as { customType: string }).customType);
		}
	}
	for (const kind of EXPECTED) assert.ok(seen.has(kind), `marker ${kind} appears in real fixture data`);
});

test("tools: the core tool surface appears in real fixture data", () => {
	// Un inventario vivo, no una fijación exhaustiva: herramientas de enseñanza en el registro
	// de enseñanza, herramientas de práctica en el de práctica. Las HERRAMIENTAS nuevas no hacen fallar
	// esto (fallan sus propias baterías): el conjunto NÚCLEO fijado simplemente debe
	// seguir pudiendo representarse en registros reales.
	const teachTools = new Set<string>();
	const practiceTools = new Set<string>();
	for (const m of chatStore.getChat(TEACH)!.messages) {
		for (const b of (m as { content?: Array<{ type?: string; name?: string }> }).content ?? []) {
			if (b.type === "toolCall" && b.name) teachTools.add(b.name);
		}
	}
	for (const m of chatStore.getChat(PRACTICE)!.messages) {
		for (const b of (m as { content?: Array<{ type?: string; name?: string }> }).content ?? []) {
			if (b.type === "toolCall" && b.name) practiceTools.add(b.name);
		}
	}
	for (const t of ["quiz", "ask_user_question", "plan_init", "probe_done", "recall", "explain", "research", "demo", "visual", "pdf"]) {
		assert.ok(teachTools.has(t), `teach tool ${t} exercised in the fixture record`);
	}
	for (const t of ["problem", "conclude"]) {
		assert.ok(practiceTools.has(t), `practice tool ${t} exercised in the fixture record`);
	}
});

// ── el grafo: los registros a través de la derivación completa ──────────────

test("graph: the real ledgers parse through their shape guards", () => {
	assert.ok(graphStore.readNodes().length >= 250, "nodes parse");
	assert.ok(graphStore.readChains().length >= 150, "chains parse");
	assert.ok(graphStore.readCheckpoints().length >= 5, "session checkpoints parse");
	assert.ok(graphStore.readCoverage().length >= 90, "coverage entries parse");
	assert.ok(graphStore.readSources().length >= 1, "imported-notes sources parse");
});

test("graph: getGraph + deriveView build the snapshot end-to-end", () => {
	const derived = getGraph(graphStore);
	assert.ok(derived.nodes.length >= 250, "merged nodes");
assert.ok(derived.chains.length >= 150, "chains survive derivation");
	const view = deriveView(derived);
	assert.ok(view.nodes.length >= 250, "the view carries every proposition");
	// las cadenas son la verdad almacenada; la vista muestra cada una como un nodo
	// de implicación con flechas premisa→implicación→conclusión (la imagen derivada),
	// y contrae cada una en aristas LÓGICAS directas premisa→conclusión.
	assert.ok(view.impLinks.length >= 90, "every unique chain renders into the view (lines merged by premises+conclusion)");
	assert.ok(view.edges.length >= view.impLinks.length, "premise/conclusion arrows drawn");
	assert.ok(view.logicalEdges.length > 0, "logical edge contraction runs");
});

test("graph: render-settings sanitize and positions parse", () => {
	const raw = readRenderSettings();
	assert.ok(raw, "render-settings.json reads");
	const clean = sanitizeRenderSettings(raw);
	assert.ok(clean.nodeSize > 0 && typeof clean.labelZoom === "number", "sanitizes to concrete knobs");
	const positionsFile = JSON.parse(fs.readFileSync(path.join(TMP, "graph", "positions.json"), "utf8")) as {
		positions: Record<string, unknown>;
	};
	assert.ok(Object.keys(positionsFile.positions).length >= 300, "positions parse");
});

// ── tareas + ajustes ────────────────────────────────────────────────────────

test("jobs: the kind × status matrix parses through the job store", () => {
	const kinds = new Set<string>();
	const statuses = new Set<string>();
	for (const f of fs.readdirSync(path.join(GOLDEN, "jobs"))) {
		const id = f.replace(/\.json$/, "");
		const j = jobStore.getJob(id);
		assert.ok(j, `${id} reads through the job store`);
		assert.ok(["research", "demo", "visual", "pdf"].includes(j!.kind), `${id}: known kind`);
		assert.ok(["done", "error"].includes(j!.status), `${id}: terminal status`);
		kinds.add(j!.kind);
		statuses.add(j!.status);
	}
	assert.deepEqual([...kinds].sort(), ["demo", "pdf", "research", "visual"], "every job kind is fixture-d");
	assert.deepEqual([...statuses].sort(), ["done", "error"], "both terminal statuses are fixture-d");
});

test("settings: the stamped record parses", () => {
	const s = settingsStore.readSettings();
	assert.ok(s, "settings record reads");
	assert.equal(s!.version, 1, "settings carry their version stamp");
	assert.ok(s!.models && typeof s!.models === "object", "model slots present");
});

// ── solo lectura: los lectores nunca escriben ───────────────────────────────

test("read-only: after every read above, the data dir is byte-identical to the fixture source", () => {
	const after = snapshotTree(TMP);
	assert.deepEqual([...after.keys()].sort(), [...BEFORE.keys()].sort(), "no files added or removed");
	for (const [name, buf] of after) {
		assert.ok(BEFORE.has(name), `${name} existed before`);
		assert.deepEqual(buf, BEFORE.get(name), `${name} unchanged by reads`);
	}
});
