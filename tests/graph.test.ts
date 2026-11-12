/**
 * Pruebas del fusionador + disparador + derivación del grafo (visión §1, rediseño del 2026-09-02;
 * limpieza de eventos del 2026-09-27).
 * El fusionador (mergeFindings de core/graph.ts) es la etapa de aplicación determinista
 * del proceso: entran VEREDICTOS AUDITADOS, salen anexados al registro: identidad
 * de enlazar o crear (el linkTo del auditor, nunca comparación de cadenas) y las
 * garantías de idempotencia. Sin registro de eventos: los resultados de los quizzes y las
 * observaciones de comprensión ya no se formalizan en el grafo.
 *
 * Aislamiento de los registros: PATHS se fija al importar, así que los cinco registros
 * de data/graph se respaldan y vacían antes de la batería y se restauran después
 * (con forma de try/finally: el hook after() siempre se ejecuta, incluso si hay fallos).
 * Los fixtures de chat son ChatRecords reales en el almacén de chats (creados y
 * borrados por esta batería): el fusionador lee exactamente lo que lee producción.
 * El proceso completo con el LLM (extractor → auditor) se prueba en
 * tests/extraction.test.ts con modelos simulados.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, describe, it } from "node:test";
import type { AuditVerdicts, GraphChain, GraphNode, SessionFindings } from "../src/core/contracts.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { projectView as projectNative } from "../src/core/view.ts";
import { deriveView, getGraph, graphSnapshot, mergeFindings, type GraphDeps } from "../src/core/graph.ts";
import { coverageSlots } from "../src/core/coverage.ts";
import { graphStore } from "../src/store/graph.ts";
import { chatStore } from "../src/store/chats.ts";
import { LEDGER_FILES, PATHS, SOURCES_FILE } from "../config.ts";

/** Los adaptadores de sistema de ficheros cableados, exactamente lo que pasa src/server/stores.ts en producción. */
const graphDeps = { chatStore, graphStore } as const satisfies GraphDeps;

/** La fuente de fusión de sesión para un chat (lo que pasa el proceso): solo el
 *  sello de plegado (el fusionador no lee ninguna transcripción; la reconstrucción de eventos de quiz
 *  murió con el registro de eventos, 2026-09-27). */
function sessionSource(chatId: string): { foldedAt: string } {
	const record = chatStore.getChat(chatId)!;
	return { foldedAt: record.updatedAt };
}

// ─── aislamiento de los registros (respaldar y vaciar data/graph/*.jsonl) ───

const LEDGER_PATHS = [...Object.values(LEDGER_FILES), SOURCES_FILE];
const backups: Array<{ file: string; bak: string }> = [];
const createdChats: string[] = [];

fs.mkdirSync(PATHS.graph, { recursive: true });
for (const file of LEDGER_PATHS) {
	if (fs.existsSync(file)) {
		const bak = `${file}.w5test.bak`;
		fs.renameSync(file, bak);
		backups.push({ file, bak });
	}
}

after(() => {
	for (const file of LEDGER_PATHS) {
		try {
			fs.unlinkSync(file);
		} catch {
			/* aquí no se escribió nada */
		}
	}
	for (const { file, bak } of backups) fs.renameSync(bak, file);
	for (const id of createdChats) {
		try {
			fs.unlinkSync(`${PATHS.chats}/${id}.json`);
		} catch {
			/* ya no existe */
		}
	}
});

// ─── constructores de fixtures ───────────────────────────────────────────────

// Constructores de fixtures nativos (oleada B): el registro contiene historial nativo de pi:
// un mensaje del asistente con llamadas a herramientas + un resultado de herramienta por llamada. La
// proyección reproduce las antiguas formas de las partes (estado output-available, input
// = argumentos, output = detalles del resultado).
interface NativeCall {
	name: string;
	toolCallId: string;
	input: Record<string, unknown>;
	output: QuestionAnswerData;
}

function user(id: string, text: string): LhMessage[] {
	return [{ id, role: "user", content: text, timestamp: Date.now() } as never];
}

/** Un mensaje de prosa del profesor (la unidad de cobertura, responsable 2026-09-28). */
function teacher(id: string, text: string): LhMessage[] {
	return [{ id, role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() } as never];
}

function assistant(id: string, calls: NativeCall[]): LhMessage[] {
	const content = calls.map((c) => ({ type: "toolCall", id: c.toolCallId, name: c.name, arguments: c.input as never }));
	const out: LhMessage[] = [
		{
			id,
			role: "assistant",
			content,
			api: "openai-completions",
			provider: "openrouter",
			model: "test",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			stopReason: "stop",
			timestamp: Date.now(),
		} as never,
	];
	for (const c of calls) {
		out.push({
			id: `r_${c.toolCallId}`,
			role: "toolResult",
			toolCallId: c.toolCallId,
			toolName: c.name,
			content: [{ type: "text", text: "ok" }],
			details: c.output,
			isError: false,
			timestamp: Date.now(),
		} as never);
	}
	return out;
}

function quizPart(
	toolCallId: string,
	input: Record<string, unknown>,
	output: QuestionAnswerData,
): NativeCall {
	return { name: "quiz", toolCallId, input, output };
}

function askPart(
	toolCallId: string,
	input: Record<string, unknown>,
	output: QuestionAnswerData,
): NativeCall {
	return { name: "ask_user_question", toolCallId, input, output };
}

function answer(over: Partial<QuestionAnswerData>): QuestionAnswerData {
	return {
		kind: "quiz",
		questionText: "question text",
		dontKnow: false,
		answers: [],
		answeredAt: "2026-08-22T00:00:00.000Z",
		...over,
	};
}

/** Crea un chat con mensajes en el almacén real; devuelve el registro.
 *  Mundo ciego al árbol: el árbol del plan es irrelevante para el fusionador; sin árbol. */
function fixtureChat(title: string, messages: LhMessage[]) {
	const chat = chatStore.createChat(title);
	createdChats.push(chat.id);
	chatStore.saveMessages(chat.id, messages);
	return chatStore.getChat(chat.id)!;
}

/** La transcripción completa del fixture: cinco quizzes corregidos + uno descartado + un ask. */
function fixtureMessages(): LhMessage[] {
	return [
		user("u1", "teach me the fixture topic"),
		assistant("a1", [
			quizPart(
				"call-1",
				{ question: "Q1", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q1 text", correct: false, answeredAt: "2026-08-22T01:00:00.000Z" }),
			),
		]),
		assistant("a2", [
			quizPart(
				"call-2",
				{ question: "Q2", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q2 text", dontKnow: true, correct: false, answeredAt: "2026-08-22T01:01:00.000Z" }),
			),
		]),
		assistant("a3", [
			// input.nodeId "alpha" está presente a propósito y se IGNORA:
			// la atribución es la única vía quiz→nodo en el mundo ciego al árbol.
			quizPart(
				"call-3",
				{ question: "Q3", nodeId: "alpha", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q3 text", correct: true, thinking: "recalled the diagram", answeredAt: "2026-08-22T02:00:00.000Z" }),
			),
		]),
		assistant("a4", [
			quizPart(
				"call-4",
				{ question: "Q4", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q4 text", correct: false, answeredAt: "2026-08-22T02:01:00.000Z" }),
			),
		]),
		assistant("a5", [
			quizPart(
				"call-5",
				{ question: "Q5", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q5 text", dontKnow: true, correct: false, answeredAt: "2026-08-22T02:02:00.000Z" }),
			),
		]),
		assistant("a6", [
			// quiz descartado + un ask respondido: ninguno se convierte en evento
			quizPart(
				"call-6",
				{ question: "Q6", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
				answer({ questionText: "Q6 text", dismissed: true }),
			),
			askPart(
				"call-7",
				{ question: "free text?" },
				answer({ kind: "ask", questionText: "free text?", text: "because" }),
			),
		]),
	].flat();
}

/** Los hallazgos del extractor para el chat del fixture: tres proposiciones,
 *  una arista follows (el grafo empieza vacío: sin enlaces). */
function fixtureFindings(): SessionFindings {
	return {
		propositions: [
			{
				id: "p1",
				name: "Alpha",
				statement: "Alpha intuition",
				aliases: ["alpha feel"],
			},
			{
				id: "p2",
				name: "Beta rule",
				statement: "Beta rule",
				aliases: [],
			},
			{
				id: "p3",
				name: "Gamma",
				statement: "Gamma application",
				aliases: [],
			},
		],
		chains: [
			{
				premises: ["p1"],
				conclusion: "p2",
			},
		],
	};
}

/** Los veredictos del auditor cuando nada se enlaza: un conjunto de veredictos vacío es una
 *  revisión completa válida (solo veredictos, responsable 2026-09-28). */
function fixtureVerdicts(): AuditVerdicts {
	return { links: [] };
}

/** El chat que pliegan todas las pruebas del fusionador (compartido, así que el orden es intencionado). */
const chat1 = fixtureChat("Graph fixture", fixtureMessages());

/** Las fijan las pruebas entre sesiones; la prueba de la instantánea (que se ejecuta después) las lee. */
let chat2Id = "";
let chat3Id = "";

// ─── el fusionador ───────────────────────────────────────────────────────────

/** Todo lo que contiene el grafo para un conjunto de chats (las emisiones de prueba de otros
 *  procesos se ejecutan a la vez sobre los mismos ficheros: acota, nunca supongas). */
function scopedGraph(chatIds: string[]) {
	const graph = getGraph(graphStore);
	return {
		nodes: graph.nodes.filter((n) => n.provenance.some((pt) => chatIds.includes(pt.chatId))),
		chains: graph.chains.filter((c) => c.provenance.some((pt) => chatIds.includes(pt.chatId))),
	};
}

describe("the merger (mergeFindings)", () => {
	it("creates nodes from the verdicts with chat-level provenance", () => {
		const stats = mergeFindings(chat1.id, fixtureFindings(), fixtureVerdicts(), graphDeps, sessionSource(chat1.id));
		assert.deepEqual(stats, { nodes: 3, chains: 1 });

		const graph = scopedGraph([chat1.id]);
		assert.equal(graph.nodes.length, 3);
		const idByStatement = new Map(graph.nodes.map((n) => [n.statement, n.id]));
		for (const node of graph.nodes) {
			assert.match(node.id, /^n_/);
			assert.ok(node.name.length > 0, "name is required");
			assert.equal("kind" in node, false, "no kind field");
			assert.ok(Array.isArray(node.provenance), "provenance attached");
		}
		// La procedencia sin ancla se queda A NIVEL DE CHAT: este llamador no envía
		// messageId (la forma de legacy/core + notas; las anclas son solo de la
		// puerta de la sesión, 2026-10-13), así que la clave de la fuente de la ejecución es
		// todo el punto de procedencia.
		const alpha = graph.nodes.find((n) => n.statement === "Alpha intuition")!;
		assert.deepEqual(alpha.provenance, [{ chatId: chat1.id, messageId: "" }]);

		// La cadena almacenada, con la procedencia adjunta.
		assert.equal(graph.chains.length, 1);
		const chain = graph.chains[0]!;
		assert.match(chain.id, /^arg_/, "store-minted argument id");
		assert.deepEqual(chain.premises, [idByStatement.get("Alpha intuition")]);
		assert.equal(chain.conclusion, idByStatement.get("Beta rule"));
		assert.deepEqual(chain.provenance, [{ chatId: chat1.id, messageId: "" }]);

	});

	it("messageId anchors (2026-10-13): creates AND link-appends stamp the passage id; chains stay chat-level", () => {
		// El ancla del envío de la sesión (responsable, 2026-10-13): una proposición puede
		// llevar el id de mensaje de su pasaje; el fusionador lo sella en el punto de
		// procedencia del nodo tanto en los nacimientos como en los reencuentros. Un
		// llamador sin ella (notas, legacy/core; fijado arriba) conserva "".
		const chat = fixtureChat(
			"Anchor fixture",
			[
				...user("u1", "teach anchors"),
				...teacher("t1", "First anchored passage."),
				...teacher("t2", "Second anchored passage."),
			].flat(),
		);
		const first = mergeFindings(
			chat.id,
			{
				propositions: [{ id: "p1", name: "Anchored", statement: "Anchored statement", aliases: [], messageId: "t1" }],
				chains: [],
			},
			{ links: [] },
			graphDeps,
			sessionSource(chat.id),
		);
		assert.equal(first.nodes, 1);
		const created = scopedGraph([chat.id]).nodes.find((n) => n.statement === "Anchored statement")!;
		assert.deepEqual(created.provenance, [{ chatId: chat.id, messageId: "t1" }], "the created node anchors to its passage");

		// El reencuentro: anexado por enlace, anclado a SU pasaje, mientras que
		// la cadena que afirma la misma tarea se queda a nivel de chat.
		const second = mergeFindings(
			chat.id,
			{
				propositions: [
					{ id: "q1", name: "Anchored again", statement: "Anchored statement, rephrased", aliases: [], messageId: "t2" },
					{ id: "q2", name: "Follows", statement: "Follows the anchored claim", aliases: [], messageId: "t2" },
				],
				chains: [{ premises: ["q1"], conclusion: "q2" }],
			},
			{ links: [{ id: "q1", linkTo: created.id }] },
			graphDeps,
			sessionSource(chat.id),
		);
		assert.equal(second.nodes, 1, "q1 linked (no create), q2 created");
		const linkLine = graphStore
			.readNodes()
			.filter((n) => n.id === created.id)
			.find((line) => line.provenance.some((pt) => pt.chatId === chat.id && pt.messageId === "t2"));
		assert.ok(linkLine, "the link-append line carries the re-encounter's passage id");
		assert.equal(linkLine!.name, "Anchored again", "the appended line is the re-encounter (reads merge it into aliases)");
		const chains = graphStore.readChains().filter((c) => c.provenance.some((pt) => pt.chatId === chat.id));
		assert.equal(chains.length, 1);
		assert.deepEqual(chains[0]!.provenance, [{ chatId: chat.id, messageId: "" }], "chains stay chat-level — never anchored");
	});

	it("merges INDEPENDENTLY per call — no cross-run identity (owner, 2026-09-29)", () => {
		// El registro de correspondencias ya no existe: la resolución es un mapa en memoria
		// local a la tarea, así que una segunda fusión de los mismos veredictos no sabe nada de la
		// primera. La identidad entre ejecuciones es tarea del AUDITOR (linkTo) más el
		// registro de cobertura (nada se vuelve a extraer), nunca del fusionador.
		// (Chat propio + enunciados únicos: esta batería se apila sobre ficheros
		// compartidos, así que nada aquí puede tocar los recuentos de las otras pruebas).
		const rep = fixtureChat("Independence fixture", [user("u1", "rep")].flat());
		const findings: SessionFindings = {
			propositions: [
				{ id: "p1", name: "Rep one", statement: "Independence one statement", aliases: [] },
				{ id: "p2", name: "Rep two", statement: "Independence two statement", aliases: [] },
			],
			chains: [{ premises: ["p1"], conclusion: "p2" }],
		};
		const first = mergeFindings(rep.id, findings, { links: [] }, graphDeps, sessionSource(rep.id));
		assert.deepEqual(first, { nodes: 2, chains: 1 });
		const second = mergeFindings(rep.id, findings, { links: [] }, graphDeps, sessionSource(rep.id));
		assert.deepEqual(second, { nodes: 2, chains: 1 }, "nothing remembered — everything re-creates");
		const graph = scopedGraph([rep.id]);
		assert.equal(graph.nodes.length, 4, "the propositions merge again as fresh nodes");
		assert.equal(graph.chains.length, 2, "fresh endpoints — fresh chain assertions");
		// eso sí, exactamente una línea de registro de control por fusión: los registros de control son un log
		assert.equal(graphStore.readCheckpoints().filter((c) => c.chatId === rep.id).length, 2);
	});

	it("is idempotent WITHIN one submit — a repeated proposition id resolves once", () => {
		const dup = fixtureChat("Duplicate-id fixture", [user("u1", "dup")].flat());
		const findings: SessionFindings = {
			propositions: [
				{ id: "p1", name: "Dup", statement: "Dup statement", aliases: [] },
				{ id: "p1", name: "Dup", statement: "Dup statement", aliases: [] },
			],
			chains: [],
		};
		const stats = mergeFindings(dup.id, findings, { links: [] }, graphDeps, sessionSource(dup.id));
		assert.deepEqual(stats, { nodes: 1, chains: 0 }, "the duplicate id is skipped — first resolution stands");
	});

	it("applies a linkTo verdict: phrasings join aliases, provenance unions, no duplicate node", () => {
		const alphaId = scopedGraph([chat1.id]).nodes.find((n) => n.statement === "Alpha intuition")!.id;
		const chat2 = fixtureChat("Graph fixture 2", [
			user("u1", "again"),
			assistant("a1", [
				quizPart(
					"call-9",
					{ question: "Q9", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
					answer({ questionText: "Q9 text", correct: true, answeredAt: "2026-08-22T03:00:00.000Z" }),
				),
			]),
		].flat());
		chat2Id = chat2.id;

		// El veredicto de identidad del auditor: esta proposición ES el nodo alpha.
		const stats = mergeFindings(
			chat2.id,
			{
				propositions: [
					{
						id: "q1",
						name: "Alpha",
						statement: "Alpha feel", // una redacción DISTINTA: la identidad es el veredicto, no las cadenas
						aliases: ["alpha intuition"],
					},
				],
				chains: [],
			},
			// SOLO VEREDICTOS: la decisión de identidad es una entrada de enlace, no un campo
			// de la proposición (responsable, 2026-09-28).
			{ links: [{ id: "q1", linkTo: alphaId }] },
			graphDeps,
			sessionSource(chat2.id),
		);
		assert.deepEqual(stats, { nodes: 0, chains: 0 });

		const after = scopedGraph([chat1.id, chat2.id]);
		assert.equal(after.nodes.length, 3, "no duplicate node");
		const alpha = getGraph(graphStore).nodes.find((n) => n.id === alphaId)!;
		assert.ok(alpha.aliases.includes("Alpha feel"), "the session's phrasing joins the aliases");
		assert.ok(alpha.aliases.includes("alpha intuition"));
		assert.ok(
			alpha.provenance.some((pt) => pt.chatId === chat2.id),
			"provenance unions",
		);
	});

	it("resolves imported-notes ids to their file paths in the snapshot (static provenance)", () => {
		// La puerta de entrada de las notas en miniatura: un registro de fuente + una fusión con
		// su id src; la instantánea debe etiquetarla con la ruta del fichero (una
		// entrada estática), nunca como una sesión de chat.
		graphStore.upsertSource({ id: "src_snapfixture", filePath: "/vault/learn vim.md", importedAt: "2026-09-13T00:00:00.000Z" });
		mergeFindings(
			"src_snapfixture",
			{
				propositions: [
					{
						id: "p1",
						name: "Vim registers",
						statement: "Vim registers map single keys to editing commands.",
						aliases: [],
					},
				],
				chains: [],
			},
			{ links: [] },
			graphDeps,
			{ foldedAt: "2026-09-13T00:00:00.000Z" },
		);
		const snap = graphSnapshot(graphDeps);
		const node = snap.nodes.find((n) => n.statement === "Vim registers map single keys to editing commands.")!;
		assert.equal(snap.fileSources["src_snapfixture"], "/vault/learn vim.md");
		assert.deepEqual(snap.nodeSessions[node.id], ["src_snapfixture"], "the file entry joins the node's sessions list");
		assert.equal(snap.sessions["src_snapfixture"], undefined, "a notes source is never a chat session");
	});

	it("derives BIRTH-SESSION clusters in graphSnapshot, labeled with the session's name", () => {
		// Oleada 7 (cerrado por el responsable el 2026-09-23): los embeddings están muertos; un clúster es
		// la sesión que HIZO NACER sus proposiciones, derivada al leer a partir de la
		// procedencia. Sin partición del registro que jugar, sin pasada de nombrado por LLM: la
		// etiqueta ES el nombre de la sesión (título del chat / ruta del fichero).
		const tri = ["Alpha.", "Beta.", "Gamma cluster."] as const;
		graphStore.upsertSource({ id: "src_clusterfixture", filePath: "/vault/cluster notes.md", importedAt: "2026-09-13T00:00:00.000Z" });
		const merge = mergeFindings(
			"src_clusterfixture",
			{
				propositions: tri.map((statement, i) => ({
					id: `p${i + 1}`,
					name: `Cluster node ${i + 1}`,
					statement,
					aliases: [],
				})),
				chains: [
					{ premises: ["p1"], conclusion: "p2", },
					{ premises: ["p2"], conclusion: "p3", },
				],
			},
			{ links: [] },
			graphDeps,
			{ foldedAt: "2026-09-13T00:00:00.000Z" },
		);
		assert.equal(merge.nodes, 3);
		const snap = graphSnapshot(graphDeps);
		// Umbral de presentación: todo clúster tiene >= 3 miembros.
		assert.ok(snap.clusters.every((c) => c.members.length >= 3));
		// Nuestro trío es exactamente un clúster: el fichero de notas que lo HIZO NACER,
		// etiquetado con su ruta, id = el id de la fuente (estable, sin hash del contenido).
		const mine = snap.clusters.find((c) => c.members.length === 3 && tri.every((s) => c.members.includes(snap.nodes.find((n) => n.statement === s)!.id)));
		assert.ok(mine, "the trio is one cluster");
		assert.equal(mine!.id, "src_clusterfixture");
		assert.equal(mine!.label, "cluster notes", "a notes file label is its exact filename minus extension");

		// División con las cadenas como primarias (responsable, 2026-09-30): `nodes` es la imagen
		// del lienzo y `propositions` solo la verdad almacenada (la entrada de la tabla
		// de cadenas). El almacén se comparte en esta batería, así que comprueba la
		// INVARIANTE, no los recuentos; y desde el arco de renderizado
		// (2026-09-30), solo las cadenas vivas de VARIAS premisas acuñan nodos imp
		// (las dos cadenas de una sola premisa de este fixture se reducen a flechas
		// directas: aquí, cero nodos imp).
		const stored = graphStore.readChains();
		const live = new Set(snap.propositions.map((n) => n.id));
		const impChains = stored.filter(
			(c) => c.premises.length >= 2 && live.has(c.conclusion) && c.premises.every((p) => live.has(p)),
		);
		assert.ok(snap.propositions.every((n) => !n.id.startsWith("arg_")), "the stored-truth list never carries imp nodes");
		assert.equal(snap.nodes.length, snap.propositions.length + impChains.length, "image = truth + one imp node per MULTI-premise live chain");
		const imp = snap.nodes.filter((n) => n.id.startsWith("arg_"));
		assert.ok(imp.length === impChains.length && imp.every((n) => snap.propositions.every((p) => p.id !== n.id)), "the extra nodes are exactly the derived implication nodes");
		assert.equal(imp.length, 0, "this fixture's chains are single-premise — all collapsed to direct arrows");
	});

	it("derives the sessions index in graphSnapshot", () => {
		const snap = graphSnapshot(graphDeps);
		const idByStatement = new Map(snap.nodes.map((n) => [n.statement, n.id]));
		// Sin clases de estado de nodo (2026-09-08) y sin observaciones de
		// comprensión (limpieza del 2026-09-27): la instantánea solo lleva el
		// grafo objetivo + las sesiones.
		assert.equal("nodeStates" in snap, false);
		assert.equal("nodeObservations" in snap, false);

		assert.equal(snap.sessions[chat1.id], "Graph fixture");
		assert.equal(snap.sessions[chat2Id], "Graph fixture 2");
		assert.deepEqual(
			(snap.nodeSessions[idByStatement.get("Alpha intuition")!] ?? []).sort(),
			[chat1.id, chat2Id].sort(),
		);
		// Gamma solo la tocó chat1.
		assert.deepEqual(snap.nodeSessions[idByStatement.get("Gamma application")!], [chat1.id]);
	});

	it("never string-matches without a verdict — an identical statement without linkTo is a NEW node", () => {
		const chat3 = fixtureChat("Graph fixture 3", [user("u1", "third")].flat());
		chat3Id = chat3.id;
		const stats = mergeFindings(
			chat3.id,
			{
				propositions: [
					{
						id: "r1",
						name: "Alpha",
						statement: "Alpha intuition", // IDÉNTICO al enunciado del nodo existente
						aliases: [],
					},
				],
				chains: [],
			},
			// veredictos vacíos: la identidad es decisión exclusiva del auditor
			{ links: [] },
			graphDeps,
			sessionSource(chat3.id),
		);
		assert.equal(stats.nodes, 1, "created — the merger does not match strings");
		assert.equal(getGraph(graphStore).nodes.filter((n) => n.statement === "Alpha intuition").length, 2);
	});

	it("merges the notes front door: source id as chatId, checkpoint at import time", () => {
		// Las notas personales en bruto no llevan transcripción: sin anclas de mensaje; el
		// fichero es la procedencia (y no hay eventos que construir, 2026-09-27).
		const stats = mergeFindings(
			"src_notesfixture",
			{
				propositions: [
					{
						id: "p1",
						name: "Vim normal mode",
						statement: "Vim starts in Normal mode, where keys are commands.",
						aliases: [],
					},
				],
				chains: [],
			},
			{ links: [] },
			graphDeps,
			{ foldedAt: "2026-09-13T00:00:00.000Z" },
		);
		assert.deepEqual(stats, { nodes: 1, chains: 0 });

		const node = getGraph(graphStore).nodes.find((n) => n.statement.startsWith("Vim starts"))!;
		assert.deepEqual(node.provenance, [{ chatId: "src_notesfixture", messageId: "" }], "one chat-level point — the source key, no message anchors");
		// El registro de control sella el momento de la importación.
		assert.equal(graphStore.readCheckpoints().find((c) => c.chatId === "src_notesfixture")?.foldedAt, "2026-09-13T00:00:00.000Z");
	});
});


// ─── primitivas del almacén ──────────────────────────────────────────────────

describe("graph ledger store", () => {
	it("round-trips lines and skips corrupt / foreign-shaped lines (strict reads)", () => {
		const node = {
			id: "n_storetest",
			name: "Store test",
			statement: "Store test, elaborated.",
			aliases: [] as string[],
			createdAt: "2026-08-22T00:00:00.000Z",
			provenance: [{ chatId: "chat_c", messageId: "m1" }],
		};
		graphStore.appendNode(node);
		// Un anexado roto y un nodo anterior al giro hacia name (esquema antiguo: description, sin
		// name): la guarda estricta omite ambos.
		fs.appendFileSync(
			LEDGER_FILES.nodes,
			`{not json}\n${JSON.stringify({ id: "legacy", statement: "Legacy shape", description: "Old schema.", aliases: [], createdAt: "2026-08-22T00:00:00.000Z", provenance: [] })}\n`,
			"utf-8",
		);
		const nodes = graphStore.readNodes().filter((n) => n.id === "n_storetest" || n.id === "legacy");
		assert.equal(nodes.length, 1);
		assert.equal(nodes[0]!.name, "Store test");
		assert.equal(nodes[0]!.statement, "Store test, elaborated.");
		assert.deepEqual(nodes[0]!.provenance, [{ chatId: "chat_c", messageId: "m1" }]);
	});


	it("returns RAW node lines — repeated ids (link-appends) are each their own line; getGraph merges", () => {
		const line = (msgId: string) =>
			JSON.stringify({
				id: "n_linktest",
				name: "Link test",
				statement: `Phrasing ${msgId}`,
				aliases: [],
				createdAt: "2026-08-22T00:00:00.000Z",
				provenance: [{ chatId: "chat_c", messageId: msgId }],
			});
		fs.appendFileSync(LEDGER_FILES.nodes, `${line("m1")}\n${line("m2")}\n`, "utf-8");
		const lines = graphStore.readNodes().filter((n) => n.id === "n_linktest");
		assert.equal(lines.length, 2, "the store returns raw lines, one per append");
		const merged = getGraph(graphStore).nodes.find((n) => n.id === "n_linktest")!;
		assert.equal(merged.statement, "Phrasing m1", "the FIRST line defines the node");
		assert.ok(merged.aliases.includes("Phrasing m2"), "later phrasings join the aliases");
		assert.deepEqual(merged.provenance.map((p) => p.messageId), ["m1", "m2"]);
	});
});

// ─── borrado de sesiones (oleada 6: la primera operación destructiva del registro) ─────

import { deleteChatTraces, type ChatDeletionStats } from "../src/core/graph-deletion.ts";
import { deleteChatSession, sessionCoverage } from "../src/server/chats.ts";
import { rememberTurnFailure, settledTurnResponse } from "../src/server/turn-runs.ts";
import { beginTurn, endTurn } from "../src/server/turn-liveness.ts";
import { jobStore } from "../src/store/jobs.ts";
import {
	deleteNodeTraces,
	type NodeDeletionStats,
} from "../src/core/graph-deletion.ts";
import { deleteGraphNode, graphRevision } from "../src/server/graph.ts";

describe("session deletion (deleteChatTraces + deleteChatSession, wave 6)", () => {
	/** Escenario de dos sesiones: dA crea el nodo compartido X + el huérfano Y y
	 *  afirma X→Y; dB enlaza X (con sus propias redacciones), crea Z y afirma X→Z.
	 *  Borrar dA debe: conservar X (la línea de enlace de dB sobrevive y se quitan los alias
	 *  de la línea de creación de dA; la identidad se mantiene), matar Y (huérfano), conservar Z y
	 *  la arista de dB, y matar la cobertura/registros de control de dA. */
	function buildTwoSessionScenario() {
		const dA = fixtureChat("Deletion session A", [
			user("du1", "teach me the deletion topic"),
			assistant("da1", [
				quizPart(
					"d-call-1",
					{ question: "DQ1", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
					answer({ questionText: "DQ1 text", correct: true, answeredAt: "2026-09-23T00:00:00.000Z" }),
				),
			]),
		].flat());
		const findingsA: SessionFindings = {
			propositions: [
				{ id: "p1", name: "Shared core", statement: "Shared core statement", aliases: ["shared feel"], },
				{ id: "p2", name: "Solo fact", statement: "Solo fact statement", aliases: ["solo feel"], },
			],
			chains: [{ premises: ["p1"], conclusion: "p2", }],
		};
		mergeFindings(dA.id, findingsA, { links: [] }, graphDeps, sessionSource(dA.id));
		// Resuelve a través de la procedencia de ESTA sesión: el registro compartido
		// contiene enunciados parecidos de pruebas anteriores, así que acota por chat.
		const bornOf = (chatId: string, statement: string): string =>
			getGraph(graphStore).nodes.find((n) => n.statement === statement && n.provenance.some((pt) => pt.chatId === chatId))!.id;
		const xId = bornOf(dA.id, "Shared core statement");
		const yId = bornOf(dA.id, "Solo fact statement");

		const dB = fixtureChat("Deletion session B", [
			user("eu1", "more on the shared core"),
			assistant("eb1", [
				quizPart(
					"e-call-1",
					{ question: "EQ1", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" },
					answer({ questionText: "EQ1 text", correct: false, answeredAt: "2026-09-23T00:01:00.000Z" }),
				),
			]),
		].flat());
		const findingsB: SessionFindings = {
			propositions: [
				{ id: "q1", name: "Shared again", statement: "Shared core, rephrased", aliases: ["B phrasing"] },
				{ id: "q2", name: "B extra", statement: "B extra statement", aliases: ["b extra feel"], },
			],
			chains: [{ premises: ["q1"], conclusion: "q2", }],
		};
		mergeFindings(dB.id, findingsB, { links: [{ id: "q1", linkTo: xId }] }, graphDeps, sessionSource(dB.id));
		const zId = bornOf(dB.id, "B extra statement");

		// Filas de cobertura (ambos chats) + adorno de posiciones: el borrado
		// poda ambos registros.
		for (const chat of [dA, dB]) {
			for (let i = 0; i < 2; i++) {
				graphStore.appendCoverage({ chatId: chat.id, fp: `${chat.id}-${i}`, tokens: 10, foldedAt: "2026-09-23T00:02:00.000Z" });
			}
		}
		graphStore.writePositions({ ...graphStore.readPositions(), [xId]: { x: 1, y: 1 }, [yId]: { x: 2, y: 2 }, [zId]: { x: 3, y: 3 } });
		return { dA, dB, xId, yId, zId };
	}

	it("delete-nodes: the shared node survives with the other session's content; the orphan dies; the creator's aliases are stripped (owner ruling 2026-09-23)", () => {
		const { dA, dB, xId, yId, zId } = buildTwoSessionScenario();
		const zLineBefore = JSON.stringify(graphStore.readNodes().find((n) => n.id === zId));

		const stats = deleteChatTraces(graphStore, dA.id, "delete-nodes");
		assert.deepEqual(stats, {
			nodesRemoved: 1,
			chainsRemoved: 1,
			coverageRemoved: 2,
			checkpointsRemoved: 1,
		} satisfies ChatDeletionStats);

		const graph = getGraph(graphStore);
		// X sobrevive: identidad (name/statement/createdAt de la línea de
		// creación) intacta, los alias + la procedencia de dA desaparecen, entran las redacciones de dB.
		const x = graph.nodes.find((n) => n.id === xId)!;
		assert.equal(x.statement, "Shared core statement", "the shared identity survives");
		assert.equal(x.name, "Shared core");
		assert.ok(!x.aliases.includes("shared feel"), "the deleted creator's phrasings are stripped (owner ruling)");
		assert.ok(x.aliases.includes("B phrasing") && x.aliases.includes("Shared core, rephrased"));
		assert.deepEqual(x.provenance, [{ chatId: dB.id, messageId: "" }], "only dB's provenance remains");
		// Y (el huérfano) desaparece por completo.
		assert.equal(graph.nodes.some((n) => n.id === yId), false);
		assert.equal(graphStore.readNodes().some((n) => n.id === yId), false);
		// Z (solo de dB) queda intacto, idéntico byte a byte.
		assert.equal(JSON.stringify(graphStore.readNodes().find((n) => n.id === zId)), zLineBefore);
		// Cadenas: el argumento X⇒Y de dA murió (Y murió); el X⇒Z de dB sobrevivió.
		const scoped = scopedGraph([dA.id, dB.id]);
		assert.equal(scoped.chains.length, 1);
		assert.deepEqual(scoped.chains[0]!.premises, [xId]);
		assert.equal(scoped.chains[0]!.conclusion, zId);
		assert.deepEqual(scoped.chains[0]!.provenance, [{ chatId: dB.id, messageId: "" }]);
		// Posiciones: el huérfano, podado.
		const positions = graphStore.readPositions();
		assert.equal(positions[yId], undefined);
		assert.deepEqual(positions[xId], { x: 1, y: 1 });
		// La instantánea resuelve X solo a dB: el chat borrado no dejó ningún fantasma.
		const snapshot = graphSnapshot(graphDeps);
		assert.deepEqual(snapshot.nodeSessions[xId], [dB.id]);
		assert.ok(snapshot.sessions[dB.id] && !snapshot.sessions[dA.id]);
		// Las reescrituras atómicas no dejaron ficheros temporales y los anexados siguen funcionando.
		assert.equal(fs.readdirSync(PATHS.graph).filter((f) => f.includes(".tmp-")).length, 0);
		const nodesBefore = graphStore.readNodes().length;
		// Procedencia ajena: el sondeo son datos de otro chat, así que los borrados
		// posteriores deben dejarlo intacto (la doctrina de los datos ajenos).
		graphStore.appendNode({ id: "n_del_append_probe", name: "Probe", statement: "Probe statement", aliases: [], createdAt: "2026-09-23T00:04:00.000Z", provenance: [{ chatId: "chat_foreign_probe", messageId: "" }] });
		assert.equal(graphStore.readNodes().length, nodesBefore + 1);
		// Idempotente: una segunda ejecución no encuentra nada.
		assert.deepEqual(deleteChatTraces(graphStore, dA.id, "delete-nodes"), { ...stats, nodesRemoved: 0, chainsRemoved: 0, coverageRemoved: 0, checkpointsRemoved: 0 } satisfies ChatDeletionStats);
	});

	it("preserve-graph: only the extraction bookkeeping dies — the graph ledgers are byte-identical", () => {
		const { dA, dB, xId, yId, zId } = buildTwoSessionScenario();
		const before = {
			nodes: graphStore.readNodes(),
			chains: graphStore.readChains(),
			positions: graphStore.readPositions(),
		};
		const stats = deleteChatTraces(graphStore, dA.id, "preserve-graph");
		assert.deepEqual(stats, {
			nodesRemoved: 0,
			chainsRemoved: 0,
			coverageRemoved: 2,
			checkpointsRemoved: 1,
		} satisfies ChatDeletionStats);
		assert.deepEqual(graphStore.readNodes(), before.nodes);
		assert.deepEqual(graphStore.readChains(), before.chains);
		assert.deepEqual(graphStore.readPositions(), before.positions);
		assert.equal(graphStore.readCoverage().some((row) => row.chatId === dA.id), false);
		assert.equal(graphStore.readCoverage().some((row) => row.chatId === dB.id), true);
		void xId; void yId; void zId;
	});

	it("deleteChatSession: the orchestration's gates and the sync block", async () => {
		// 404: chat desconocido.
		assert.deepEqual(await deleteChatSession("chat_missing_delete", "delete-nodes"), { ok: false, status: 404, code: "not_found", error: "No such session" });

		const { dA } = buildTwoSessionScenario();
		// 409: un turno en curso.
		beginTurn(dA.id);
		const turnedAway = await deleteChatSession(dA.id, "delete-nodes");
		assert.deepEqual(turnedAway, { ok: false, status: 409, code: "turn_in_flight", error: "A turn is running in this session — try again when it finishes", jobIds: [] });
		endTurn(dA.id);
		// 409: tareas en segundo plano en ejecución; un borrado rechazado conserva su aviso.
		rememberTurnFailure(dA.id, "The reply could not be saved.");
		const job = jobStore.createJob({ kind: "research", chatId: dA.id, toolCallId: "del-call-1" });
		const jobsBlocked = await deleteChatSession(dA.id, "delete-nodes");
		assert.ok(!jobsBlocked.ok && jobsBlocked.status === 409, "refused with 409");
		if (jobsBlocked.code === "jobs_running") assert.deepEqual(jobsBlocked.jobIds, [job.id]);
		assert.match(await settledTurnResponse(dA.id).text(), /The reply could not be saved\./);
		assert.equal(jobStore.deleteJobsForChat(dA.id), 1, "test cleanup — the job file is gone");

		// Éxito: una tarea terminal va con él; el registro del chat muere el último.
		const doneJob = jobStore.createJob({ kind: "research", chatId: dA.id, toolCallId: "del-call-2" });
		jobStore.updateJob(doneJob.id, { status: "done", activity: "delivered" });
		const outcome = await deleteChatSession(dA.id, "delete-nodes");
		assert.equal(outcome.ok, true);
		if (outcome.ok) {
			assert.equal(outcome.mode, "delete-nodes");
			assert.equal(outcome.stats.nodesRemoved, 1);
			assert.equal(outcome.jobsRemoved, 1);
			assert.ok(outcome.graphRevision > 0, "the version stamp moved");
		}
		assert.equal(chatStore.getChat(dA.id), null, "the chat record is gone");
		assert.doesNotMatch(await settledTurnResponse(dA.id).text(), /"type":"error"/, "deletion clears its transient notice");
		assert.equal(jobStore.getJob(doneJob.id), null, "the chat's job records are gone");
		// Y una segunda llamada es un 404 honesto.
		assert.deepEqual(await deleteChatSession(dA.id, "delete-nodes"), { ok: false, status: 404, code: "not_found", error: "No such session" });
	});
});

// ─── borrado de un solo nodo (interludio de nodos, muerte completa) ──────────

describe("single-node deletion (deleteNodeTraces + deleteGraphNode, node interlude)", () => {
	/** El escenario de muerte completa: el nodo X nace en un fichero de notas (procedencia
	 *  VACÍA: una línea antigua; el ancla de correspondencias ya no existe, responsable
	 *  2026-09-29), un chat lo reencuentra (línea de enlace: alias +
	 *  procedencia) y dos sesiones lo afirman en cadenas. */
	function buildNodeScenario() {
		// Pizarra limpia por prueba: cada prueba de este describe construye su propio
		// escenario a partir de registros vacíos (el aislamiento de la batería cubre todo
		// el fichero; esto cubre el apilamiento dentro del describe).
		graphStore.rewriteLedgers({ nodes: [], chains: [] });
		graphStore.writePositions({});
		graphStore.appendNode({
			id: "n_dead",
			name: "Doomed",
			statement: "Doomed statement",
			aliases: [],
			createdAt: "2026-09-23T00:00:00.000Z",
			provenance: [],
		});
		// El reencuentro del chat: una línea de enlace (alias + su propia procedencia).
		graphStore.appendNode({
			id: "n_dead",
			name: "Doomed",
			statement: "Doomed statement",
			aliases: ["doomed, rephrased"],
			createdAt: "2026-09-23T00:00:00.000Z",
			provenance: [{ chatId: "chat_node_a", messageId: "m1" }],
		});
		// Un vecino + dos aristas: solo muere la que toca X.
		graphStore.appendNode({
			id: "n_keep",
			name: "Keeper",
			statement: "Keeper statement",
			aliases: [],
			createdAt: "2026-09-23T00:00:00.000Z",
			provenance: [{ chatId: "chat_node_a", messageId: "m2" }],
		});
		graphStore.appendChain({ id: "arg_dead_keep", premises: ["n_dead"], conclusion: "n_keep", createdAt: "2026-09-23T00:00:00.000Z", provenance: [{ chatId: "chat_node_a", messageId: "m1" }] });
		graphStore.appendChain({ id: "arg_keep_dead", premises: ["n_keep"], conclusion: "n_dead", createdAt: "2026-09-23T00:00:00.000Z", provenance: [{ chatId: "chat_node_b", messageId: "m3" }] });
		// Una cadena AJENA que el borrado no debe tocar (la reescritura destructiva
		// no puede superar el radio de la explosión: los datos ajenos se quedan intactos).
		graphStore.appendChain({ id: "arg_keep_other", premises: ["n_keep"], conclusion: "n_other", createdAt: "2026-09-23T00:00:00.000Z", provenance: [{ chatId: "chat_node_b", messageId: "m3" }] });
		// Posiciones de reposo para ambos nodos y para los nodos imp de las dos cadenas que mueren.
		graphStore.writePositions({ n_dead: { x: 1, y: 1 }, n_keep: { x: 2, y: 2 }, arg_dead_keep: { x: 1.5, y: 1.5 }, arg_keep_dead: { x: 2.5, y: 2.5 } });
	}

	it("deleteNodeTraces: FULL DEATH — the node, its edges, its evidence, its anchors, its position", () => {
		buildNodeScenario();
		const keepLineBefore = JSON.stringify(graphStore.readNodes().find((n) => n.id === "n_keep"));
		const stats = deleteNodeTraces(graphStore, "n_dead");
		assert.deepEqual(stats, { chainsRemoved: 2 } satisfies NodeDeletionStats);

		// TODAS las líneas del nodo desaparecen; el vecino es idéntico byte a byte
		// (la muerte completa se limita al nodo: las sesiones de los demás nodos conservan sus
		// alias y su procedencia).
		assert.equal(graphStore.readNodes().some((n) => n.id === "n_dead"), false);
		assert.equal(
			JSON.stringify(graphStore.readNodes().find((n) => n.id === "n_keep")),
			keepLineBefore,
			"the untouched node is byte-identical",
		);
		// Solo murieron las cadenas que hacían referencia a X; la cadena ajena se queda.
		assert.deepEqual(
			graphStore.readChains().map((c) => [c.premises, c.conclusion]),
			[[["n_keep"], "n_other"]],
		);
		// La posición de reposo murió con el nodo.
		const positions = graphStore.readPositions();
		assert.equal(positions["n_dead"], undefined);
		assert.deepEqual(positions["n_keep"], { x: 2, y: 2 });
		assert.equal(positions["arg_dead_keep"], undefined, "the dying chains' imp-node positions die too");
		assert.equal(positions["arg_keep_dead"], undefined);
		// Las reescrituras atómicas no dejaron ficheros temporales.
		assert.equal(fs.readdirSync(PATHS.graph).filter((f) => f.includes(".tmp-")).length, 0);
		// Idempotente: una segunda ejecución no encuentra el nodo: null.
		assert.equal(deleteNodeTraces(graphStore, "n_dead"), null);
	});

	it("deleteNodeTraces: a node nothing references still dies, and only its file moves", () => {
		graphStore.appendNode({
			id: "n_solo",
			name: "Solo",
			statement: "Solo statement",
			aliases: [],
			createdAt: "2026-09-23T00:00:00.000Z",
			provenance: [{ chatId: "chat_node_solo", messageId: "m1" }],
		});
		const stats = deleteNodeTraces(graphStore, "n_solo");
		assert.deepEqual(stats, { chainsRemoved: 0 } satisfies NodeDeletionStats);
		assert.equal(graphStore.readNodes().some((n) => n.id === "n_solo"), false);
	});

	it("deleteGraphNode: the orchestration — extraction gate, 404, success", () => {
		// 404: nodo desconocido.
		assert.deepEqual(deleteGraphNode("n_missing_node"), {
			ok: false,
			status: 404,
			code: "not_found",
			error: "No such node",
		});

		// 409: CUALQUIER ejecución de extracción registrada: una ejecución en pleno vuelo podría
		// volver a referenciar el nodo que muere; la ejecución nunca se aborta (su gasto
		// pertenece a otra sesión) y el llamador reintenta. El registro es
		// el almacén globalThis del proceso: una entrada falsa es la forma honesta
		// de fijar la barrera sin montar una ejecución real.
		const g = globalThis as { __lhExtractionRuns?: unknown };
		const realRuns = g.__lhExtractionRuns;
		g.__lhExtractionRuns = {
			running: new Map([
				["chat_busy", { chatId: "chat_busy", kind: "chat", phase: "extracting", startedAt: 1, usage: {}, controller: new AbortController() }],
			]),
			inFlight: new Set(),
			lastStartedAt: 0,
		};
		try {
			assert.deepEqual(deleteGraphNode("n_gate_probe"), {
				ok: false,
				status: 409,
				code: "extraction_running",
				error: "An extraction is running — try again when it finishes",
			});
		} finally {
			g.__lhExtractionRuns = realRuns;
		}

		// Éxito: el nodo muere y el sello de versión avanza.
		graphStore.appendNode({
			id: "n_orch",
			name: "Orchestrated",
			statement: "Orchestrated statement",
			aliases: [],
			createdAt: "2026-09-23T00:00:00.000Z",
			provenance: [{ chatId: "chat_node_c", messageId: "m1" }],
		});
		const revisionBefore = graphRevision();
		const outcome = deleteGraphNode("n_orch");
		assert.ok(outcome.ok);
		assert.deepEqual(outcome.stats, { chainsRemoved: 0 });
		assert.ok(outcome.graphRevision > 0);
		assert.ok(outcome.graphRevision >= revisionBefore, "the version stamp moved");
		assert.equal(graphStore.readNodes().some((n) => n.id === "n_orch"), false);
		// Y una segunda llamada es un 404 honesto.
		assert.deepEqual(deleteGraphNode("n_orch"), { ok: false, status: 404, code: "not_found", error: "No such node" });
	});
});

describe("session coverage read (extraction-UX redesign, 2026-09-24)", () => {
	it("one session's block: derived uncovered, the newest fold, honest nulls", () => {
		// Cobertura vacía: todo sin cubrir, aún sin plegado, sin ejecución en curso.
		// Solo prosa del profesor (responsable, 2026-09-28): las ranuras de cobertura son los
		// bloques de texto del profesor, así que el fixture es todo del profesor.
		const chat = fixtureChat("coverage read", [
			teacher("cov_t1", "tell me about coverage reads"),
			teacher("cov_t2", "and about per-session blocks"),
			teacher("cov_t3", "a third distinct message"),
		].flat());
		const empty = sessionCoverage(chat.id)!;
		assert.ok(empty);
		assert.equal(empty.totalMessages, 3);
		assert.equal(empty.coveredCount, 0);
		assert.equal(empty.uncoveredCount, 3);
		assert.equal(empty.coveredTokens, 0);
		assert.ok(empty.uncoveredTokens > 0);
		assert.equal(empty.running, false);
		assert.equal(empty.lastFoldedAt, null, "no fold yet");

		// Pliega los dos primeros mensajes: la lectura deriva la división + la marca de tiempo
		// del plegado más reciente a partir de las filas del registro.
		const slots = coverageSlots(chatStore.getChat(chat.id)!.messages);
		graphStore.appendCoverage({ chatId: chat.id, fp: slots[0]!.fp, tokens: slots[0]!.tokens, foldedAt: "2026-09-24T10:00:00.000Z" });
		graphStore.appendCoverage({ chatId: chat.id, fp: slots[1]!.fp, tokens: slots[1]!.tokens, foldedAt: "2026-09-24T11:30:00.000Z" });
		// La fila de otra sesión no debe filtrarse a esta lectura.
		graphStore.appendCoverage({ chatId: "chat_other", fp: slots[2]!.fp, tokens: slots[2]!.tokens, foldedAt: "2026-09-24T23:00:00.000Z" });

		const cov = sessionCoverage(chat.id)!;
		assert.equal(cov.totalMessages, 3);
		assert.equal(cov.coveredCount, 2);
		assert.equal(cov.uncoveredCount, 1);
		assert.equal(cov.coveredTokens, slots[0]!.tokens + slots[1]!.tokens);
		assert.equal(cov.uncoveredTokens, slots[2]!.tokens);
		assert.equal(cov.lastFoldedAt, "2026-09-24T11:30:00.000Z", "the NEWEST fold, and scoped to this session's rows");
	});

	it("running: true only for THIS session's chat-kind run (the registry pin)", () => {
		const chat = fixtureChat("coverage running", [user("cov_r1", "running pin")].flat());
		const g = globalThis as { __lhExtractionRuns?: unknown };
		const realRuns = g.__lhExtractionRuns;
		try {
			g.__lhExtractionRuns = {
				running: new Map([
					// una ejecución de notas para el mismo id NO es la ejecución de chat de esta sesión
					["src_notes", { chatId: "src_notes", kind: "notes", phase: "extracting", startedAt: 1, usage: {}, controller: new AbortController() }],
					["other_chat", { chatId: "other_chat", kind: "chat", phase: "auditing", startedAt: 2, usage: {}, controller: new AbortController() }],
				]),
				inFlight: new Set(),
				lastStartedAt: 0,
			};
			assert.equal(sessionCoverage(chat.id)!.running, false, "no chat-kind run for this id");
			g.__lhExtractionRuns = {
				running: new Map([
					[chat.id, { chatId: chat.id, kind: "chat", phase: "extracting", startedAt: 3, usage: {}, controller: new AbortController() }],
				]),
				inFlight: new Set(),
				lastStartedAt: 0,
			};
			assert.equal(sessionCoverage(chat.id)!.running, true);
		} finally {
			g.__lhExtractionRuns = realRuns;
		}
	});

	it("unknown chat → null (the caller owns the 404)", () => {
		assert.equal(sessionCoverage("chat_never_was"), null);
	});
});

// ─── deriveView (el arco de renderizado, responsable 2026-09-30) ─────────────

describe("deriveView (the argument's geometry)", () => {
	const prop = (id: string): GraphNode => ({
		id,
		name: id.toUpperCase(),
		statement: `${id} statement`,
		aliases: [],
		createdAt: "2026-09-30T00:00:00.000Z",
		provenance: [],
	});
	const chain = (id: string, premises: string[], conclusion: string): GraphChain => ({
		id,
		premises,
		conclusion,
		provenance: [],
		createdAt: "2026-09-30T00:00:00.000Z",
	});

	it("a SINGLE-premise chain collapses to ONE direct arrow — no imp node", () => {
		const view = deriveView({ nodes: [prop("a"), prop("b")], chains: [chain("arg_ab", ["a"], "b")] });
		assert.deepEqual(view.nodes.map((n) => n.id), ["a", "b"], "no arg_ node minted");
		assert.deepEqual(view.edges, [{ from: "a", to: "b" }], "the argument IS a plain arrow");
	});

	it("a MULTI-premise chain keeps the imp node + fan (premises in, conclusion out)", () => {
		const view = deriveView({
			nodes: [prop("a"), prop("b"), prop("c")],
			chains: [chain("arg_ab", ["a", "b"], "c")],
		});
		assert.deepEqual(view.nodes.map((n) => n.id).sort(), ["a", "arg_ab", "b", "c"]);
		assert.deepEqual(
			[...view.edges].sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.to < y.to ? -1 : 1)),
			[
				{ from: "a", to: "arg_ab" },
				{ from: "arg_ab", to: "c" },
				{ from: "b", to: "arg_ab" },
			],
		);
		const imp = view.nodes.find((n) => n.id === "arg_ab")!;
		assert.equal(imp.name, "\u27f9");
	});

	it("two chains SHARING a conclusion stay distinct — two geometry points, never a unioned fan", () => {
		const view = deriveView({
			nodes: [prop("a"), prop("b"), prop("c"), prop("d"), prop("e")],
			chains: [chain("arg_e1", ["a", "b"], "e"), chain("arg_e2", ["c", "d"], "e")],
		});
		assert.deepEqual(
			view.nodes.map((n) => n.id).sort(),
			["a", "arg_e1", "arg_e2", "b", "c", "d", "e"],
		);
		assert.ok(view.edges.some((x) => x.from === "arg_e1" && x.to === "e"));
		assert.ok(view.edges.some((x) => x.from === "arg_e2" && x.to === "e"));
	});

	it("dangling chains drop (missing member — the honest belt)", () => {
		const view = deriveView({ nodes: [prop("a")], chains: [chain("arg_ghost", ["a"], "gone"), chain("arg_gone", ["ghost"], "a")] });
		assert.deepEqual(view.nodes.map((n) => n.id), ["a"]);
		assert.deepEqual(view.edges, []);
	});

	it("LOGICAL edges: every chain contracts to direct premise→conclusion arrows (all chains, deduped)", () => {
		const view = deriveView({
			nodes: [prop("a"), prop("b"), prop("c")],
			chains: [chain("arg_ab", ["a", "b"], "c"), chain("arg_ac", ["a"], "c")],
		});
		// arg_ab: a→c Y b→c; arg_ac: a→c otra vez → se deduplica en una flecha.
		assert.deepEqual(
			[...view.logicalEdges].sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.to < y.to ? -1 : 1)),
			[
				{ from: "a", to: "c" },
				{ from: "b", to: "c" },
			],
		);
		// Solo ids de proposiciones: ningún extremo arg_ viaja nunca en el conjunto lógico.
		assert.ok(view.logicalEdges.every((e) => !e.from.startsWith("arg_") && !e.to.startsWith("arg_")));
	});

	it("impLinks: one linkage per MULTI-premise chain — the depth pass's midpoint input", () => {
		const view = deriveView({
			nodes: [prop("a"), prop("b"), prop("c")],
			chains: [chain("arg_ab", ["a", "b"], "c"), chain("arg_ac", ["a"], "c")],
		});
		assert.deepEqual(view.impLinks, [{ id: "arg_ab", premises: ["a", "b"], conclusion: "c" }]);
	});
});
