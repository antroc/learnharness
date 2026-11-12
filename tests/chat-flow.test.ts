/**
 * Prueba de integración guionizada: el bucle completo del profesor sin gastar tokens:
 *
 *   el alumno abre el chat → el modelo simulado llama a `quiz` → el servidor hace streaming y persiste
 *   → el cliente corrige y devuelve el EVENTO DE RESPUESTA
 *   → el modelo simulado reacciona → transcripción persistida.
 *
 * Invoca handleChatRequest directamente (Request/Response normales, sin servidor
 * Next) con un motor pi guionizado (el proveedor simulado de pi-ai, docs/
 * docs/archive/pi-engine-swap.md §7). Oleada B: los POST llevan UN EVENTO DE ENTRADA (nunca una
 * transcripción del cliente), el registro es historial de agente nativo de pi (se lee a través de la
 * proyección cuando se fija la forma de una parte) y la respuesta llega como el
 * resultado de herramienta real de la llamada de la pregunta (bifurcación 1, responsable 2026-09-26).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { handleChatInput, handleChatRequest } from "../src/server/chat-handler.ts";
import { effectiveSettings } from "../src/server/stores.ts";
import { isTurnRunning } from "../src/server/turn-liveness.ts";
import { deliverJobResult, registerLiveAgent, setTurnRunner, steerLiveChat, unregisterLiveAgent } from "../src/server/jobs.ts";
import { SessionModel } from "../components/session-core.ts";
import { buildSubagentSteer } from "../src/core/contracts.ts";
import { abortTurn, runningTurn, settledTurnResponse } from "../src/server/turn-runs.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { buildAnswer, dismissedAnswer, normalizeOptions, resolveCorrect, type QuestionData } from "../src/core/question-core.ts";
import { danglingQuestionOf, endsInDismissal, needsContinuation, newAnswerResult, newUserMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import type { PiEngine } from "../src/agent/models.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

// Fijación a nivel de ruta (el patrón de chat-birth-stamp): el manejador de
// la ruta de descarte, invocado directamente. El entorno es el del ejecutor (el
// mismo en el que ya se resolvieron las importaciones estáticas del almacén).
const dismissRoute = await import("../app/api/chats/[id]/dismiss/route.ts");
const steerRoute = await import("../app/api/chats/[id]/steer/route.ts");
const streamRoute = await import("../app/api/chats/[id]/stream/route.ts");
const recordRoute = await import("../app/api/chats/[id]/route.ts");
import { PATHS } from "../config.ts";

// La barrera de turno por presencia de clave (interludio de la clave del proveedor, 2026-09-25): los turnos
// guionizados fijan openrouter por chat; la barrera lee la verdad del entorno primero, así que la
// clave debe estar presente en el proceso de la prueba, como en cualquier configuración real.
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";

const QUIZ_INPUT = {
	question: "Which planet is closest to the sun?",
	options: [
		{ label: "Venus" },
		{ label: "Mercury" },
		{ label: "Mars" },
	],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
	type: "check",
	nodeId: "planet-order",
};

/** Turno 1: un poco de razonamiento y luego la llamada a la herramienta quiz. Turno 2: texto plano.
 *  Cada fábrica de respuestas registra el prompt que recibió (la transcripción que
 *  vio el modelo): la antigua captura de doStream, con forma de motor. */
function scriptedTeacher(steps: (calls: string[][]) => FauxResponseStep[]): {
	engine: PiEngine;
	calls: string[][];
} {
	const calls: string[][] = [];
	const faux = createFauxCore({});
	faux.setResponses(steps(calls));
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, calls };
}

/** La lección por defecto de dos turnos: quiz de sondeo y luego reacción a la respuesta. */
function defaultLesson(calls: string[][]): FauxResponseStep[] {
	return [
		(context) => {
			calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
			return fauxAssistantMessage(
				[fauxThinking("Probe the basics first."), fauxToolCall("quiz", QUIZ_INPUT, { id: "call-1" })],
				{ stopReason: "toolUse" },
			);
		},
		(context) => {
			calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
			return fauxAssistantMessage([fauxText("Right — Mercury it is.")]);
		},
	];
}

/** La frontera del manejador (sin estado por turno): cada petición construye un agente nuevo
 *  a partir del registro que va a ejecutar; las pruebas inyectan la fábrica. Oleada B: el
 *  manejador pasa a la fábrica las opciones de construcción NATIVAS (el registro ES el
 *  estado del agente; sin conversión de adaptador). */
function agentFactory(engine: PiEngine): Parameters<typeof handleChatRequest>[1] {
	return (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages });
}

/** La respuesta corregida que envía un cliente para un quiz (la frontera compartida de corrección). */
function gradedAnswer(input: typeof QUIZ_INPUT, values: string[]) {
	const options = normalizeOptions(input.options);
	const qd: QuestionData = {
		id: "call-1",
		kind: "quiz",
		question: input.question,
		mode: "single-select",
		options,
		correctIndices: resolveCorrect(input.correctAnswer, options).indices,
		explanation: input.explanation,
		createdAt: new Date().toISOString(),
	};
	return buildAnswer(qd, { values });
}

/** Analiza un cuerpo SSE en sus eventos de cable (AgentEvents de pi literales +
 *  los terminales de error/turno asentado de la aplicación). Lo estructural gana a la subcadena:
 *  el orden de las claves nunca importa. */
function eventsOf(body: string): Array<Record<string, any>> {
	const out: Array<Record<string, any>> = [];
	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
		out.push(JSON.parse(line.slice(6)));
	}
	return out;
}

async function drain(res: Response): Promise<string> {
	if (res.status !== 200) {
		assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
	}
	return res.text(); // consume el stream SSE hasta el final (dispara onFinish)
}

/** DIETA DE CONEXIONES B (responsable, 2026-10-10 — postmortem de la congelación por sesiones paralelas):
 *  POST /api/chat ya no hace streaming del turno: acusa recibo y cierra, y el
 *  emisor (como toda vista) se engancha mediante el stream de reenganche. Esto
 *  refleja drain(): comprueba el acuse 200 y luego vacía el cuerpo SSE del turno hasta
 *  el final a través de runningTurn + subscribe, el mismo cable que sirve la ruta
 *  GET. Suscríbete INMEDIATAMENTE tras el acuse: los turnos simulados se asientan en
 *  rondas de microtareas y el identificador sale del registro al asentarse. */
async function drainTurn(req: Request, factory: Parameters<typeof handleChatRequest>[1]): Promise<string> {
	const cloned = req.clone();
	const ack = await handleChatRequest(req, factory);
	if (ack.status !== 200) {
		assert.fail(`expected 200 ack, got ${ack.status}: ${await ack.text()}`);
	}
	const { chatId } = (await cloned.json()) as { chatId: string };
	const handle = runningTurn(chatId);
	if (!handle)
		// Un turno corto (una reacción rápida a una respuesta) puede asentarse DENTRO de los
		// awaits finales del manejador: el registro ya está vacío. No hay nada
		// que vaciar: la finalización ya ocurrió. (Quien lee el cuerpo recibe "";
		// sus aserciones de eventsOf fallarían entonces de forma ruidosa si esto afectara a un turno
		// largo, que es el resultado honesto para un cable perdido).
		return "";
	return new Response(handle.subscribe()).text();
}

/** Vacía el cable de un turno EN EJECUCIÓN cuando el POST ya se hizo (la ruta
 *  del acuse no dejó nada que consumir; DIETA DE CONEXIONES B). Suscríbete de inmediato:
 *  los turnos simulados se asientan en rondas de microtareas. */
async function drainRunning(chatId: string): Promise<string> {
	const handle = runningTurn(chatId);
	if (!handle) assert.fail(`no running turn to drain: ${chatId}`);
	return new Response(handle.subscribe()).text();
}

function waitFor(cond: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
			setTimeout(tick, 25);
		};
		tick();
	});
}

/** Un profesor cuyo paso 1 se bloquea en una barrera externa: un turno retenido a mitad de ejecución
 *  para que los tiempos de cancelación de vista / reenganche / aborto sean deterministas. */
function gatedTeacher(gate: Promise<void>): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses([
		async () => {
			await gate;
			return fauxAssistantMessage([fauxText("Gated reply.")]);
		},
	]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** Un profesor que NUNCA se resuelve salvo con un aborto (el patrón abortableFactory
 *  de jobs): la única forma de que este turno termine es la terminación remota. */
function abortableTeacher(): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses([
		((_ctx: unknown, opts: { signal?: AbortSignal } | undefined) =>
			new Promise((resolve) => {
				const sig = opts?.signal;
				if (sig?.aborted) return resolve(fauxAssistantMessage("late"));
				sig?.addEventListener("abort", () => resolve(fauxAssistantMessage("late")), { once: true });
			})) as unknown as FauxResponseStep,
	]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

function post(chatId: string, input: unknown): Request {
	return new Request("http://test/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		// Oleada B: el contrato de eventos de entrada: un evento explícito por POST,
		// nunca una transcripción del cliente.
		body: JSON.stringify({ chatId, input }),
	});
}

/** El POST de la ruta de descarte silencioso (a nivel de módulo: las fijaciones
 *  de rondas paralelas también la usan). */
function dismissPost(chatId: string, toolCallId: string, kind: "quiz" | "ask" | "explain" = "quiz"): Promise<Response> {
	return dismissRoute.POST(
		new Request(`http://test/api/chats/${chatId}/dismiss`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				input: { type: "dismiss", toolCallId, answer: dismissedAnswer(kind, kind === "ask" ? "Next topic?" : QUIZ_INPUT.question) },
			}),
		}),
		{ params: Promise.resolve({ id: chatId }) },
	);
}

/** Barrera de turno BYOK (responsable, 2026-09-22): sin suelo de fábrica; un chat necesita un
 *  modelo de conversación antes de que ningún turno haga streaming. Las pruebas guionizadas dan
 *  a cada chat una fijación por chat exactamente como lo hace el flujo de configuración en
 *  producción (el motor simulado inyectado sigue ejecutando el bucle). */
function createConfiguredChat(title: string) {
	const chat = chatStore.createChat(title);
	chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	// nodeId es obligatorio en los quizzes de enseñanza (decisión del responsable 2026-09-26); las
	// lecciones guionizadas hacen quizzes sobre este árbol sembrado.
	chatStore.saveTree(chat.id, {
		nodes: [
			{ id: "planet-order", title: "Planet order" },
			{ id: "genealogy", title: "Genealogy of religion" },
			{ id: "indexicals", title: "Indexical 'actual'" },
			{ id: "modal-realism", title: "Modal realism" },
		],
		edges: [],
		version: 1,
	});
	return chat;
}

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* ya no existe */
		}
	}
});

describe("teacher chat flow (scripted model)", () => {
	it("quiz tool call persists as a pending part; the answer continues the lesson", async () => {
		const { engine, calls } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: solar system");
		createdChats.push(chat.id);

		// ── Turno 1: el alumno abre con un tema; el profesor sondea con un quiz ──
		await drainTurn(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine));

		const saved1 = chatStore.getChat(chat.id)!;
		// Registro nativo: usuario + asistente (bifurcación 1: el resultado provisional de la pregunta
		// limpia nunca se persiste, así que el registro termina en la llamada).
		assert.equal(saved1.messages.length, 2, "user message + assistant response persisted");
		const assistantMsg = saved1.messages[1]!;
		assert.equal(assistantMsg.role, "assistant");

		const thinking = assistantMsg.content.find((b) => b.type === "thinking");
		assert.ok(thinking && thinking.type === "thinking", "thinking block streamed + persisted");
		assert.match((thinking as { thinking?: string }).thinking!, /Probe the basics/);

		const quizCall = assistantMsg.content.find((b) => b.type === "toolCall" && b.name === "quiz");
		assert.ok(quizCall && quizCall.type === "toolCall", "quiz tool call persisted");
		assert.equal((quizCall as { id?: string }).id, "call-1");
		assert.deepEqual((quizCall as { arguments?: unknown }).arguments, QUIZ_INPUT);

		// La proyección fija la vista del cliente: parte de razonamiento + una parte de quiz
		// pendiente (input-available), el estado de montaje del dock.
		const view1 = projectView(saved1.messages);
		const reasoningPart = view1[1]!.parts.find((p) => p.type === "reasoning");
		assert.ok(reasoningPart && reasoningPart.type === "reasoning", "reasoning part projected");
		const quizPart = view1[1]!.parts.find((p) => p.type === "tool-quiz");
		assert.ok(quizPart && quizPart.type === "tool-quiz", "quiz tool part projected");
		assert.equal((quizPart as { state?: string }).state, "input-available", "unanswered quiz = pending state (resume record)");
		assert.deepEqual((quizPart as { input?: unknown }).input, QUIZ_INPUT);

		// La barrera de pregunta pendiente la ve (la frontera nativa).
		const pending = danglingQuestionOf(saved1.messages);
		assert.equal(pending?.toolCallId, "call-1");
		assert.equal(pending?.tool, "quiz");
		assert.deepEqual(pending?.input, QUIZ_INPUT);

		// ── El alumno responde: el cliente corrige y envía el EVENTO DE
		// RESPUESTA; la respuesta llega como el resultado de herramienta real de la llamada. ──
		const answer = gradedAnswer(QUIZ_INPUT, ["Mercury"]);
		assert.equal(answer.correct, true);
		await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-1", answer }), agentFactory(engine));

		// ── El profesor reacciona: la proyección agrupa la reacción en el
		// MISMO mensaje de vista del asistente que el quiz respondido (el canon de
		// agrupación nativo: los mensajes assistant/toolResult consecutivos delimitados
		// por mensajes de usuario forman un grupo). ──
		const saved2 = chatStore.getChat(chat.id)!;
		// Nativo: usuario, asistente, toolResult de la respuesta, asistente de la reacción.
		assert.equal(saved2.messages.length, 4, "the answer + reaction append natively");
		assert.equal((saved2.messages[2] as { role?: string }).role, "toolResult", "the graded answer is the call's tool result");
		const view2 = projectView(saved2.messages);
		assert.equal(view2.length, 2, "the reaction continues the same assistant message (one group)");
		const finalParts = view2[1]!.parts;
		const textPart = finalParts.find((p) => p.type === "text");
		assert.ok(textPart && textPart.type === "text", "reaction text appended after the tool part");
		assert.match((textPart as { text?: string }).text!, /Mercury it is/);
		// La parte del quiz respondido sigue ahí, ahora con su salida.
		const answeredQuiz = finalParts.find((p) => p.type === "tool-quiz");
		assert.ok(answeredQuiz && answeredQuiz.type === "tool-quiz" && (answeredQuiz as { state?: string }).state === "output-available");
		// La respuesta corregida viajó en el registro como resultado de herramienta de la llamada y
		// hace el viaje de ida y vuelta por JSON (las claves undefined desaparecen): compara su
		// SUSTANCIA, no clave por clave con lo construido en memoria.
		const out = (answeredQuiz as { output?: { kind?: string; correct?: boolean } }).output!;
		assert.equal(out.kind, "quiz");
		assert.equal(out.correct, true);

		// El modelo recibió de verdad la respuesta corregida como resultado de herramienta.
		assert.equal(calls.length, 2, "model saw exactly two prompts");
		const toolResultSent = calls[1]!.some((c) => c.includes("toolResult") || c.includes("Mercury"));
		assert.ok(toolResultSent, "continuation prompt carries the tool result to the model");

		// No queda ninguna pregunta pendiente.
		assert.equal(danglingQuestionOf(saved2.messages), null);
	});

	it("rejects unknown chats", async () => {
		const res = await handleChatRequest(post("chat_nonexistent", { type: "text", text: "hi" }));
		assert.equal(res.status, 404);
	});

	it("refuses malformed inputs with a clean 400 — no liveness effects, no lockout", async () => {
		const chat = createConfiguredChat("Test: malformed input");
		createdChats.push(chat.id);

		// Un evento de texto sin texto: rechazado en la frontera de análisis.
		const res = await handleChatRequest(post(chat.id, { type: "text" }), agentFactory(scriptedTeacher(defaultLesson).engine));
		assert.equal(res.status, 400, "malformed input is a clean 400");
		assert.equal(isTurnRunning(chat.id), false, "the refusal never registered a turn");

		// Una RESPUESTA sin llamada de pregunta colgante: la disciplina del 400 huérfano
		// (el servidor es responsable del registro: valida la llamada destino).
		const res2 = await handleChatRequest(
			post(chat.id, { type: "answer", toolCallId: "call-none", answer: { correct: true } }),
			agentFactory(scriptedTeacher(defaultLesson).engine),
		);
		assert.equal(res2.status, 400, "an answer with no pending question call is refused");
		assert.equal(isTurnRunning(chat.id), false);

		// Y el chat NO queda bloqueado: se acepta el siguiente turno (válido).
		const ok = await handleChatRequest(
			post(chat.id, { type: "text", text: "teach me" }),
			agentFactory(scriptedTeacher(defaultLesson).engine),
		);
		assert.equal(ok.status, 200);
		await drain(ok);
	});

	it("streams the toolCall partial before tool_execution_start/end (protocol pin for the 'Writing a question…' shimmer)", async () => {
		// Oleada D: el cable son AgentEvents de pi LITERALES. El indicador de escritura
		// del cliente deriva 'input-streaming' de un bloque toolCall visto en un
		// message_update aún sin ejecución; el dock se monta con un tool_execution_end
		// LIMPIO. Fija el orden que gobierna ambos: si el paso directo
		// dejara alguna vez de emitir uno de ellos, el indicador o
		// el dock morirían en silencio.
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: protocol pin");
		createdChats.push(chat.id);
		const body = await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));
		const events = eventsOf(body);
		const callSeen = events.findIndex(
			(e) => e.type === "message_update" && JSON.stringify(e.message?.content ?? []).includes('"type":"toolCall"'),
		);
		const execStart = events.findIndex((e) => e.type === "tool_execution_start" && e.toolCallId === "call-1");
		const execEnd = events.findIndex((e) => e.type === "tool_execution_end" && e.toolCallId === "call-1");
		assert.ok(callSeen !== -1, "a message_update carries the toolCall block (the shimmer source)");
		assert.ok(execStart !== -1, "tool_execution_start present in the stream");
		assert.ok(execEnd !== -1, "tool_execution_end present in the stream");
		assert.ok(callSeen < execStart && execStart < execEnd, "partial → execution start → execution end");
		assert.equal(events[execEnd]!.isError, false, "the clean end is what mounts the dock");
	});

	it("a pump-fired wake turn never double-appends its steer (Wave B regression of the 2026-09-18 bug)", { timeout: 15000 }, async () => {
		// LA FORMA: la bomba dispara {type:'steer'} mientras la MISMA reorientación sigue
		// en la cabeza de la cola de entrega (la bomba quita su entrada
		// solo DESPUÉS de que el turno se registre). El filtro claimSteers de la oleada B miraba
		// solo el registro ANTERIOR a la persistencia anticipada, así que la copia que llevaba la entrada
		// era invisible: el marcador se persistía DOS VECES con el mismo id, dos
		// mensajes de vista compartían una clave de React y el cliente fallaba (en vivo,
		// 2026-09-26: steer_job_muhlokbf_84e9373c en chat_muhlcltz).
		const chat = createConfiguredChat("Test: wake single-copy");
		createdChats.push(chat.id);
		// Siembra un turno de texto plano (sin pregunta colgante: waitForIdle debe pasar).
		const seed = scriptedTeacher(() => [() => fauxAssistantMessage([fauxText("On it — dispatched the researcher.")])]);
		await drainTurn(post(chat.id, { type: "text", text: "research it" }), agentFactory(seed.engine));

		// El ejecutor de turnos de la bomba, con forma fiel pero guionizado (el real
		// es el cableado a nivel de módulo de chat-handler; la importación de este fichero ya lo
		// estableció: lo sustituimos por el motor guionizado, como hace jobs.test).
		const wake = scriptedTeacher(() => [() => fauxAssistantMessage([fauxText("Good research — building on it.")])]);
		setTurnRunner(async (chatId, input) => {
			const res = await handleChatInput(chatId, input, agentFactory(wake.engine));
			await res.arrayBuffer().catch(() => undefined);
			return res.status;
		});

		// Un registro de tarea REAL: chatIdOf resuelve el chat a través del almacén
		// de tareas (details.jobId lo indexa); un id sintético sin registro
		// devuelve "" y la bomba no hace nada en silencio (el cuelgue que esta prueba nos
		// enseñó en el primer contacto).
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-1" });
		const steer = buildSubagentSteer(
			job,
			{ brief: "The Mercury answer, with sources.", sources: [{ title: "NASA", url: "https://nasa.gov" }] },
		);
		// NOTA: deliverJobResult se resuelve al RECLAMAR (el claimSteers del propio turno
		// de despertar vacía la cola dentro de handleChatInput: la persistencia anticipada
		// es inminente, pero el TURNO sigue en ejecución). Por eso la aserción sobre el
		// registro espera a que llegue la respuesta del despertar.
		await deliverJobResult(steer); // cola + bomba → waitForIdle → el turno de despertar
		await waitFor(() => {
			const rec = chatStore.getChat(chat.id);
			const at = rec?.messages.findIndex((m) => (m as { id?: string }).id === steer.id) ?? -1;
			return at !== -1 && (rec!.messages[at + 1] as { role?: string } | undefined)?.role === "assistant";
		}, 8000, "the wake turn to persist (marker + response)");

		const record = chatStore.getChat(chat.id)!;
		const copies = record.messages.filter((m) => (m as { id?: string }).id === steer.id);
		assert.equal(copies.length, 1, "exactly ONE copy of the steer marker (the carried filter)");
		const at = record.messages.findIndex((m) => (m as { id?: string }).id === steer.id);
		assert.ok(at !== -1, "the marker is in the record");
		assert.equal((record.messages[at + 1] as { role?: string } | undefined)?.role, "assistant", "the wake response follows the marker");
	});

	it("Wave C steering: a mid-run result injects BETWEEN turn units — never splitting a toolCall from its toolResult", { timeout: 15000 }, async () => {
		// LA CORRECCIÓN DEL RESPONSABLE (2026-09-26): una lección real es UNA ejecución continua
		// enseñar→quiz→enseñar, así que el resultado de un subagente debe llegar ENTRE mensajes
		// dentro de la ejecución: la cola de reorientación de pi, vaciada en los límites de turno
		// (tras un mensaje de asistente completado Y sus resultados de herramienta). Esperar
		// al final de la ejecución (follow-ups) nunca puede dispararse a mitad de lección: el detenedor
		// de preguntas se adelanta a ese sondeo justo en los momentos en que una ejecución SÍ termina.
		const chat = createConfiguredChat("Test: mid-run steering");
		createdChats.push(chat.id);

		// Paso 1 (con barrera): una herramienta que no es pregunta; un nombre desconocido produce un
		// toolResult de error SIN terminar, así que la ejecución continúa. Paso 2:
		// la reacción DESPUÉS de la inyección en el límite (registra su prompt).
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let release2!: () => void;
		const gate2 = new Promise<void>((r) => (release2 = r));
		let jobIdMid = "";
		let jobFlippedMidTurn: string | undefined;
		const seen: string[] = [];
		const faux = createFauxCore({});
		faux.setResponses([
			async () => {
				await gate;
				return fauxAssistantMessage(
					[fauxToolCall("no_such_tool", { note: "x" }, { id: "call-mid" })],
					{ stopReason: "toolUse" },
				);
			},
			async (context) => {
				seen.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)).join("\n"));
				// MANTÉN el turno abierto más allá de la inyección: el message_end
				// del marcador ya se disparó, así que la tarea debe marcarse
				// terminada AHORA (arreglo del dock, responsable 2026-09-26), no al
				// asentarse este turno.
				jobFlippedMidTurn = jobStore.getJob(jobIdMid)?.status;
				await gate2;
				return fauxAssistantMessage([fauxText("Folded the marker in.")]);
			},
		]);
		const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };

		// Un despertar aquí sería un FALLO (la entrega debe viajar en la ejecución viva); el
		// contador mantiene un despertar erróneo hermético y comprobable.
		let wakes = 0;
		setTurnRunner(async () => {
			wakes++;
			return 200;
		});

		// El turno flota a mitad de ejecución: el paso 1 tiene barrera, la ejecución está viva.
		const res = handleChatRequest(post(chat.id, { type: "text", text: "teach" }), agentFactory(engine));
		await waitFor(() => isTurnRunning(chat.id), 8000, "the turn is live");

		// El resultado llega A MITAD DE EJECUCIÓN: la bomba lo pasa a la cola de reorientación
		// del agente vivo (vehículo 1); el marcador encolado espera a que el
		// turno en curso termine para que la inyección llegue en su límite.
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-mid" });
		jobIdMid = job.id;
		// El ejecutor guarda el resultado ANTES de la entrega (finalizeJob lo lee).
		jobStore.updateJob(job.id, { status: "done", result: { brief: "Mid-run brief.", sources: [] }, delivery: { kind: "result", status: "pending" } });
		const steer = buildSubagentSteer(job, { brief: "Mid-run brief.", sources: [] });
		const delivery = deliverJobResult(steer);
		await new Promise((r) => setTimeout(r, 300)); // el vehículo 1 hace el traspaso
		assert.equal(wakes, 0, "no wake — the live run owns the delivery");

		release(); // el paso 1 termina → resultado de herramienta → LÍMITE DE TURNO → inyección → paso 2
		// El paso 2 ha quedado pendiente un momento: da un respiro a la frontera del cable y luego libera.
		await new Promise((r) => setTimeout(r, 150));
		release2();
		await drain(await res);
		await delivery; // se resuelve en settleSteers (la ejecución persistió el marcador)
		assert.equal(jobFlippedMidTurn, "done", "worker completion is independent of the streaming teacher turn");

		// Forma del registro: el marcador queda ENTRE unidades de turno completadas, tras
		// el toolResult, que nunca debe partir, y adyacente a él.
		const record = chatStore.getChat(chat.id)!;
		const at = (role: string, pred: (m: LhMessage) => boolean) =>
			record.messages.findIndex((m) => (m as { role?: string }).role === role && pred(m as never));
		const callAt = record.messages.findIndex(
			(m) => (m as { role?: string }).role === "assistant" &&
				JSON.stringify((m as { content?: unknown }).content).includes("call-mid"),
		);
		const resultAt = at("toolResult", (m) => (m as { toolCallId?: string }).toolCallId === "call-mid");
		const steerAt = record.messages.findIndex((m) => (m as { id?: string }).id === steer.id);
		const finalAt = at("assistant", (m) => JSON.stringify((m as { content?: unknown }).content).includes("Folded the marker in."));
		assert.ok(callAt !== -1 && resultAt !== -1 && steerAt !== -1 && finalAt !== -1, `all units present: ${callAt}/${resultAt}/${steerAt}/${finalAt}`);
		assert.ok(callAt < resultAt, "the toolCall precedes its toolResult (bonded pair)");
		assert.equal(steerAt, resultAt + 1, "the marker injected at the turn boundary — immediately after the completed unit");
		assert.ok(steerAt < finalAt, "the run CONTINUED after the injection (same run, no wake)");
		assert.equal(record.messages.filter((m) => (m as { id?: string }).id === steer.id).length, 1, "exactly one marker copy");
		assert.ok(seen[0]!.includes("Mid-run brief."), "the model SAW the marker in its next prompt");
		assert.equal(wakes, 0, "delivery rode the live run end to end");
	});

	it("the view canon HOISTS reasoning above the message text (owner ruling 2026-09-26)", () => {
		// GLM emite tokens de razonamiento al final: el contenido persistido queda
	// [text, thinking] (y [text, thinking, toolCall]), que la presentación por orden
	// de llegada mostraba con el razonamiento DEBAJO de su mensaje. La proyección
	// hace una partición estable: primero las partes de razonamiento (en su orden) y luego
	// el resto, tanto en los parciales vivos como en los registros asentados.
		const baseMessage = {
			role: "assistant",
			api: "openai-completions",
			provider: "openrouter",
			model: "test",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			timestamp: 1,
		};
		const trailingThink: LhMessage = {
			...baseMessage,
			id: "a_trail",
			content: [
				{ type: "text", text: "The answer text." },
				{ type: "thinking", thinking: "Checked the map afterwards." },
				{ type: "toolCall", id: "call-tr", name: "quiz", arguments: { question: "q", options: [{ label: "a" }], correctAnswer: "a", explanation: "" } },
			],
			stopReason: "toolUse",
		} as never;
		const view = projectView([{ id: "u0", role: "user", content: "hi", timestamp: 1 } as never, trailingThink]);
		assert.equal(view.length, 2);
		const parts = view[1]!.parts.filter((p) => p.type !== "step-start");
		const order = parts.map((p) => p.type);
		assert.equal(order[0], "reasoning", "reasoning renders FIRST regardless of content order");
		assert.ok(order.indexOf("text") > order.indexOf("reasoning"), "text follows the reasoning");
		assert.equal(order[order.length - 1], "tool-quiz", "the tool call stays last");
		// La forma canónica de pensar primero no cambia.
		const leadingThink: LhMessage = {
			...baseMessage,
			id: "a_lead",
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "First." }, { type: "text", text: "The answer text." }],
		} as never;
		const view2 = projectView([{ id: "u1", role: "user", content: "hi", timestamp: 1 } as never, leadingThink]);
		assert.deepEqual(view2[1]!.parts.filter((p) => p.type !== "step-start").map((p) => p.type), ["reasoning", "text"], "think-first messages project identically");
	});

	it("an arrived-but-empty STREAMING message projects the thinking row; a settled empty one stays hidden (optimistic round 3)", () => {
		const emptyArrived: LhMessage = {
			id: "a_empty",
			role: "assistant",
			content: [],
			stopReason: "stop",
		} as never;
		const live = {
			executions: new Map(),
			inFlight: true,
			streamingIds: new Set(["a_empty"]),
		} as never;
		// streaming: se muestra la LLEGADA del mensaje, una parte de razonamiento vacía
		// (Reasoning de chat.tsx aplica isStreaming a la última parte: el mismo indicador +
		// brillo que el provisional al que sustituye; traspaso sin costuras).
		const view = projectView([{ id: "u0", role: "user", content: "hi", timestamp: 1 } as never, emptyArrived], live);
		const parts = view[1]!.parts.filter((p) => p.type !== "step-start");
		assert.deepEqual(parts.map((p) => p.type), ["reasoning"], "empty streaming message = the thinking row");
		assert.equal(parts[0]!.text, "", "empty until the first token lands");
		// asentado (sin ventana viva): solo de presentación, oculto como siempre.
		const settled = projectView([{ id: "u0", role: "user", content: "hi", timestamp: 1 } as never, emptyArrived]);
		assert.equal(settled.length, 1, "a settled empty message renders nothing");
	});

	it("a cancelled view NEVER aborts the turn — it runs to completion (owner ruling 2026-09-25)", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const engine = gatedTeacher(gate);
		const chat = createConfiguredChat("Test: view cancel");
		createdChats.push(chat.id);

		const res = await handleChatRequest(post(chat.id, { type: "text", text: "hold my turn" }), agentFactory(engine));
		assert.equal(res.status, 200);
		// DIETA DE CONEXIONES B (2026-10-10): el POST es un acuse cerrado; el cable de la vista
		// es el stream de reenganche. Engánchate, lee un fragmento y cancela:
		// la vista del navegador se va a mitad del stream.
		const view = new Response(runningTurn(chat.id)!.subscribe());
		const reader = view.body!.getReader();
		await reader.read();
		await reader.cancel();
		// El turno SIGUE siendo un objeto en segundo plano en ejecución: ninguna vista lo mató.
		assert.equal(isTurnRunning(chat.id), true, "cancel detached the view only — the turn runs on");
		assert.ok(runningTurn(chat.id), "the running-turn registry still holds the handle");

		// Se ejecuta HASTA EL FINAL sin nadie mirando y luego se asienta solo.
		release();
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle after view cancel");
		const saved = chatStore.getChat(chat.id)!;
		assert.equal(saved.messages.length, 2, "complete turn persisted — not a partial");
		assert.equal(runningTurn(chat.id), undefined, "handle unregistered at settle");
	});

	it("an ungradeable quiz is rejected at the call boundary, the error reaches the model, and the model retries", async () => {
		// El contrato de autoría (superRefine de question-core): un quiz cuyo
		// correctAnswer no coincide con el valor de ninguna opción NUNCA debe llegar al dock;
		// la frontera vuelve a aplicar el esquema en el límite de la llamada, marca la
		// llamada como inválida y devuelve el error de validación al profesor como
		// resultado de herramienta. El bucle vuelve a preguntar al modelo, que reintenta en el
		// mismo turno. Esto fija todo ese mecanismo (el fallo en vivo de Nietzsche).
		const BAD_QUIZ_INPUT = {
			question: "What is Nietzsche's genealogical claim about religion?",
			type: "check",
			nodeId: "genealogy",
			options: [{ label: "A cultural diagnosis" }, { label: "Atheism as a conclusion" }],
			correctAnswer: "cultural-diagnosis", // la forma exacta del fallo en vivo: un slug, sin coincidencia
			explanation: "Genealogy diagnoses, it does not convert.",
		};

		const steps = (calls: string[][]): FauxResponseStep[] => [
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage(
					[fauxToolCall("quiz", BAD_QUIZ_INPUT, { id: "call-bad" })],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage(
					[fauxToolCall("quiz", QUIZ_INPUT, { id: "call-good" })],
					{ stopReason: "toolUse" },
				);
			},
		];
		const { engine, calls } = scriptedTeacher(steps);

		const chat = createConfiguredChat("Test: bad quiz retry");
		createdChats.push(chat.id);
		const body = await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));

		// Fijación del CABLE (el fallo en vivo de modal-realism): el final de ejecución de la
		// llamada inválida es un ERROR; el dock solo se monta con un tool_execution_end LIMPIO,
		// así que un quiz mal formado nunca puede llegar a él. El final del reintento es limpio.
		const events = eventsOf(body);
		const badEnd = events.find((e) => e.type === "tool_execution_end" && e.toolCallId === "call-bad");
		assert.ok(badEnd, "the invalid call's execution end is on the wire");
		assert.equal(badEnd.isError, true, "the invalid call surfaced as an error execution");
		assert.match(String(badEnd.result?.content?.[0]?.text ?? ""), /does not match any option value/);
		const goodEnd = events.find((e) => e.type === "tool_execution_end" && e.toolCallId === "call-good");
		assert.ok(goodEnd, "the valid retry's execution end is on the wire");
		assert.equal(goodEnd.isError, false, "the valid retry's end is CLEAN — the dock mounts on it");

		// Se volvió a preguntar al modelo (el error no terminó el turno)…
		assert.equal(calls.length, 2, "the invalid call triggered a second model prompt");
		// …y el segundo prompt llevaba de vuelta el error de validación como resultado de herramienta.
		assert.match(
			calls[1]!.join(" "),
			/does not match any option value/,
			"the validation error reached the model",
		);

		// La transcripción: la llamada fallida se persistió como RESULTADO DE ERROR (el
		// contexto de reintento del modelo: las llamadas de pregunta con error SÍ se persisten), y el
		// reintento como el quiz colgante. La proyección muestra la parte de error.
		const saved = chatStore.getChat(chat.id)!;
		const view = projectView(saved.messages);
		const quizParts = view[1]!.parts.filter((p) => p.type === "tool-quiz");
		const failed = quizParts.find(
			(p) => p.type === "tool-quiz" && (p as { state?: string }).state === "output-error",
		);
		assert.ok(failed, "the invalid call persisted as an error-state part");
		assert.match(
			String((failed as { errorText?: string }).errorText),
			/does not match any option value/,
		);
		const pending = danglingQuestionOf(saved.messages);
		assert.equal(pending?.toolCallId, "call-good", "the RETRIED quiz is the pending one");
		assert.deepEqual(pending?.input, QUIZ_INPUT);
	});

	it("structurally invalid quiz input (unhealable garbage) never reaches the dock and retries clean", async () => {
		// El mundo de dos niveles (responsable, 2026-10-09 — la reparación universal
		// de argumentos): un sustituto CODIFICADO EN JSON de la forma del esquema (la costumbre en vivo
		// de pasar las opciones como cadena) ahora se repara en TODOS los registros (ver
		// tests/tool-heal.test.ts para esa fijación), así que el rechazo estructural
		// que mantiene esta prueba es el OTRO nivel: basura que ninguna regla mecánica
		// podría rescatar (ni JSON ni un array) se rechaza honestamente en la
		// frontera (tool-input-error, nunca una pregunta pendiente) y el
		// reintento limpio del modelo se convierte en el quiz pendiente.
		const STRINGY_QUIZ_INPUT = {
			question: "Lewis's indexical analysis of 'actual' — which is it?",
			type: "check",
			nodeId: "indexicals",
			options: "definitely not a JSON array — denim all the way down", // ← basura irreparable
			correctAnswer: "indexical",
			explanation: "Indexical: every world is actual to its own inhabitants.",
		};

		const steps: FauxResponseStep[] = [
			() => fauxAssistantMessage([fauxToolCall("quiz", STRINGY_QUIZ_INPUT, { id: "call-stringy" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxToolCall("quiz", QUIZ_INPUT, { id: "call-clean" })], { stopReason: "toolUse" }),
		];
		const { engine } = scriptedTeacher(() => steps);

		const chat = createConfiguredChat("Test: string options");
		createdChats.push(chat.id);
		const body = await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));

		const events = eventsOf(body);
		const stringyEnd = events.find((e) => e.type === "tool_execution_end" && e.toolCallId === "call-stringy");
		assert.ok(stringyEnd, "the invalid quiz's execution end is on the wire");
		assert.equal(stringyEnd.isError, true, "the structural reject surfaced as an error execution");
		assert.match(String(stringyEnd.result?.content?.[0]?.text ?? ""), /options/);

		const saved = chatStore.getChat(chat.id)!;
		const view = projectView(saved.messages);
		const failed = view[1]!.parts.find(
				(p) => (p as { toolCallId?: string }).toolCallId === "call-stringy",
			);
		assert.equal((failed as { state?: string }).state, "output-error", "persisted as an error part");
		assert.match(String((failed as { errorText?: string }).errorText), /options/);
		const pending = danglingQuestionOf(saved.messages);
		assert.equal(pending?.toolCallId, "call-clean", "the retried quiz is the pending one");
	});

	it("parallel quiz calls are asked, saved, and answered in the model's call order", async () => {
		// La observación en vivo de modal-realism: el profesor agrupó dos quizzes
		// en un turno y el dock mostró primero el SEGUNDO (el recorrido hacia atrás
		// de las partes), así que el orden de interacción quedó invertido respecto al registro.
		// Fija: (A) danglingQuestionOf elige la PRIMERA pregunta sin responder en
		// orden de llamada; (B) las herramientas de pregunta se ejecutan en secuencia, así que sus
		// fragmentos tool-input-available llegan por el cable en orden de llamada.
		const QUIZ_A = { ...QUIZ_INPUT, question: "Quiz A: which planet is closest to the sun?" };
		const QUIZ_B = { ...QUIZ_INPUT, question: "Quiz B: which planet is largest?" };

		const { engine } = scriptedTeacher(() => [
			() =>
				fauxAssistantMessage(
					[fauxToolCall("quiz", QUIZ_A, { id: "call-a" }), fauxToolCall("quiz", QUIZ_B, { id: "call-b" })],
					{ stopReason: "toolUse" },
			),
		]);

		const chat = createConfiguredChat("Test: parallel quizzes");
		createdChats.push(chat.id);
		const body = await drainTurn(post(chat.id, { type: "text", text: "quiz me twice" }), agentFactory(engine));

		// (B) determinismo del cable: las herramientas de pregunta se ejecutan en secuencia, así que los
		// finales de ejecución LIMPIOS de los quizzes llegan en orden de llamada (el dock se monta
		// con finales limpios: el orden de montaje es el orden del cable).
		const events = eventsOf(body);
		const endA = events.findIndex((e) => e.type === "tool_execution_end" && e.toolCallId === "call-a" && e.isError === false);
		const endB = events.findIndex((e) => e.type === "tool_execution_end" && e.toolCallId === "call-b" && e.isError === false);
		assert.ok(endA !== -1 && endB !== -1, "both quizzes' clean ends are on the wire");
		assert.ok(endA < endB, "call A's end precedes call B's (sequential execution)");

		// Guardados en orden de llamada (la proyección conserva el orden del contenido).
		const saved = chatStore.getChat(chat.id)!;
		const quizIds = projectView(saved.messages)[1]!.parts
			.filter((p) => p.type === "tool-quiz")
			.map((p) => (p as { toolCallId: string }).toolCallId);
		assert.deepEqual(quizIds, ["call-a", "call-b"], "parts persisted in call order");

		// (A) el dock serializa las respuestas en el mismo orden: primero A, luego B.
		const pending = danglingQuestionOf(saved.messages);
		assert.equal(pending?.toolCallId, "call-a", "the FIRST asked question is the dock subject");
		// …the learner answers A: the answer lands as call-a's tool result —
		// the SECOND question becomes the dock subject only after that.
		const answered = [...saved.messages, newAnswerResult("call-a", "quiz", gradedAnswer(QUIZ_A, ["Mercury"]))];
		const next = danglingQuestionOf(answered);
		assert.equal(next?.toolCallId, "call-b", "the SECOND question becomes the dock subject only after the first is answered");
	});
});

describe("chat store", () => {
	it("round-trips and lists chats", async () => {
		const chat = chatStore.createChat("Store test");
		createdChats.push(chat.id);
		chatStore.saveMessages(chat.id, [{ id: "m1", role: "user", content: "hi", timestamp: 1 } as never]);
		const loaded = chatStore.getChat(chat.id)!;
		assert.equal(loaded.messages.length, 1);
		assert.equal(loaded.title, "Store test");
	});

	it("persist the per-chat model settings (replace-whole, no updatedAt churn)", async () => {
		const chat = chatStore.createChat("Settings test");
		createdChats.push(chat.id);
		const before = chatStore.getChat(chat.id)!.updatedAt;
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "high" });
		const saved = chatStore.getChat(chat.id)!;
		assert.deepEqual(saved.settings, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "high" });
		assert.equal(saved.updatedAt, before, "a picker write is not conversation activity");
		// replace-whole: a settings-less write clears the override (an empty
		// object persists — every field absent = config defaults)
		chatStore.saveSettings(chat.id, {});
		assert.deepEqual(chatStore.getChat(chat.id)!.settings, {});
	});
});

describe("canonical persistence failures", () => {
	it("refuses a failed input save without building an agent or leaving a live turn", async () => {
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: failed answer write-ahead");
		createdChats.push(chat.id);
		await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));
		const before = chatStore.getChat(chat.id)!.messages;
		const save = chatStore.saveMessages;
		let builds = 0;
		chatStore.saveMessages = () => { throw new Error("synthetic write-ahead failure"); };
		try {
			const res = await handleChatRequest(post(chat.id, { type: "answer", toolCallId: "call-1", answer: gradedAnswer(QUIZ_INPUT, ["Mercury"]) }), (opts) => {
				builds++;
				return agentFactory(engine)!(opts);
			});
			const running = runningTurn(chat.id);
			if (running) await new Response(running.subscribe()).text();
			assert.equal(res.status, 500);
			const client = new SessionModel({ chatId: chat.id, initialMessages: before, fetch: async () => res.clone() });
			await client.submitAnswer("quiz", "call-1", gradedAnswer(QUIZ_INPUT, ["Mercury"]));
			assert.equal(client.getState().error?.message, "Your input could not be saved. Please try again.");
			assert.equal(await res.text(), "Your input could not be saved. Please try again.");
			assert.equal(builds, 0);
			assert.equal(isTurnRunning(chat.id), false);
			assert.equal(runningTurn(chat.id), undefined);
			assert.deepEqual(chatStore.getChat(chat.id)!.messages, before);
		} finally { chatStore.saveMessages = save; }
	});

	it("reports a failed reply save before DONE while keeping the accepted answer durable", async () => {
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: failed reply persistence");
		createdChats.push(chat.id);
		await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));
		const save = chatStore.saveMessages;
		let writes = 0;
		chatStore.saveMessages = (id, messages) => {
			if (++writes === 2) throw new Error("synthetic reply save failure");
			return save(id, messages);
		};
		try {
			const body = await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-1", answer: gradedAnswer(QUIZ_INPUT, ["Mercury"]) }), agentFactory(engine));
			const errors = eventsOf(body).filter(e => e.type === "error");
			assert.equal(errors.length, 1);
			assert.equal(errors[0]!.errorText, "The reply could not be saved.");
			assert.ok(body.indexOf("The reply could not be saved.") < body.indexOf("[DONE]"));
			assert.equal(isTurnRunning(chat.id), false);
			assert.equal(runningTurn(chat.id), undefined);
			assert.equal(chatStore.getChat(chat.id)!.messages.at(-1)?.role, "toolResult");
			// The normal submitter may not reach GET /stream until AFTER the
			// failing turn has left the live registry. It must still see it.
			const late = await streamRoute.GET(new Request("http://test/stream"), { params: Promise.resolve({ id: chat.id }) });
			assert.equal(eventsOf(await late.text()).find(e => e.type === "error")?.errorText, "The reply could not be saved.");
			// An already-open idle view can miss both the start and the wire
			// error, then learn of settlement only via a record synchronization.
			const snapshot = await (await recordRoute.GET(new Request("http://test/record"), { params: Promise.resolve({ id: chat.id }) })).json();
			assert.equal(needsContinuation(snapshot.messages), true, "the durable answer alone looks like an owed continuation");
			let automaticPosts = 0;
			const missedView = new SessionModel({ chatId: chat.id, initialMessages: [], fetch: async () => {
				automaticPosts++;
				return new Response("unexpected automatic retry", { status: 500 });
			} });
			missedView.setMessages(snapshot.messages, snapshot.turnError);
			await missedView.continueIfOwed(snapshot.messages);
			assert.equal(automaticPosts, 0, "the record notice must block replacement even without a stream attachment");
			assert.equal(missedView.getState().error?.message, "The reply could not be saved.");
		} finally { chatStore.saveMessages = save; }
	});

	it("does not redeliver a persisted learner steer after usage bookkeeping fails", async () => {
		const { engine } = scriptedTeacher(() => [() => fauxAssistantMessage([fauxText("Synthetic response")])]);
		const chat = createConfiguredChat("Test: post-save bookkeeping failure");
		createdChats.push(chat.id);
		const steer = newUserMessage("Synthetic learner steer");
		const appendUsage = chatStore.appendTurnUsage;
		chatStore.appendTurnUsage = () => { throw new Error("synthetic usage write failure"); };
		try {
			const body = await drainTurn(post(chat.id, { type: "text", text: "go" }), opts => {
				const agent = createTeacherAgent(undefined, { engine, messages: opts.messages, onUsage: opts.onUsage });
				agent.subscribe(event => {
					if (event.type === "agent_start") assert.equal(steerLiveChat(chat.id, steer), true);
				});
				return agent;
			});
			assert.equal(eventsOf(body).find(e => e.type === "error")?.errorText, "An error occurred.");
			assert.ok(chatStore.getChat(chat.id)!.messages.some(m => m.id === steer.id), "the steer was saved before bookkeeping failed");
			const delivered: LhMessage[] = [];
			const next = { steer: (message: LhMessage) => delivered.push(message), state: { model: { provider: "faux" } } } as unknown as Parameters<typeof registerLiveAgent>[1];
			registerLiveAgent(chat.id, next);
			assert.deepEqual(delivered, [], "an already-saved learner steer must not reach another agent");
		} finally {
			chatStore.appendTurnUsage = appendUsage;
			unregisterLiveAgent(chat.id);
		}
	});
});

describe("mid-turn navigation (turn liveness + write-ahead)", () => {
	it("one turn per chat: a concurrent request is 409'd; the next one after finish is accepted", async () => {
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: turn guard");
		createdChats.push(chat.id);

		const res1 = await handleChatRequest(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine)); // acked; the turn runs as a background object (Diet B: no stream to hold)
		assert.equal(isTurnRunning(chat.id), true, "turn registered as in flight");
		const view1 = drainRunning(chat.id); // a live view — the turn would run on with none

		// A stale client (remount racing a live turn) tries to start a second turn.
		const res2 = await handleChatRequest(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine));
		assert.equal(res2.status, 409, "concurrent turn rejected — last-writer-wins persist would clobber it");

		await view1; // finish → onFinish → endTurn
		assert.equal(isTurnRunning(chat.id), false, "registry cleared at finish");

		const res3 = await handleChatRequest(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine));
		assert.equal(res3.status, 200, "the next turn is accepted after the previous finished");
		await drainRunning(chat.id);
	});

	it("write-ahead: the learner's answer is durable BEFORE the turn finishes", async () => {
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: write-ahead");
		createdChats.push(chat.id);

		// Turn 1: the teacher asks the quiz (dangling call in the record).
		await drainTurn(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine));

		// The learner answers; the client posts the ANSWER EVENT.
		const answer = gradedAnswer(QUIZ_INPUT, ["Mercury"]);

		// NOT drained: the teacher turn is streaming, but the answer is already
		// on disk — a remount (or crash) mid-turn sees the answered quiz, never
		// the stale pre-answer question.
		const res = await handleChatRequest(post(chat.id, { type: "answer", toolCallId: "call-1", answer }), agentFactory(engine));
		const midTurn = chatStore.getChat(chat.id)!;		assert.equal(midTurn.messages.length, 3, "write-ahead appended the answer tool result before finish");
		assert.equal((midTurn.messages[2] as { role?: string }).role, "toolResult");
		const midQuiz = projectView(midTurn.messages)[1]!.parts.find((p) => p.type === "tool-quiz");
		assert.ok(midQuiz && midQuiz.type === "tool-quiz");
		assert.equal((midQuiz as { state?: string }).state, "output-available", "write-ahead persisted the answer before finish");

		await drainRunning(chat.id); // finish → persist the full turn → endTurn
		const saved2 = chatStore.getChat(chat.id)!;
		// Native: user, assistant, answer result, reaction — one append-only
		// history; the projection still renders ONE assistant group.
		assert.equal(saved2.messages.length, 4, "full turn persisted as usual at finish");
		assert.equal(projectView(saved2.messages).length, 2, "the projection groups the answered quiz + reaction");
		assert.equal(isTurnRunning(chat.id), false, "registry cleared at finish");
	});
});

describe("renameChat (the header's click-to-edit title)", () => {
	it("persists the title and does NOT bump updatedAt — sidebar order must not churn", () => {
		const chat = chatStore.createChat("old title");
		createdChats.push(chat.id);
		const before = chatStore.getChat(chat.id)!.updatedAt;
		const renamed = chatStore.renameChat(chat.id, "  new title  ");
		assert.equal(renamed.title, "new title", "trimmed on the way in");
		assert.equal(chatStore.getChat(chat.id)!.title, "new title");
		assert.equal(
			chatStore.getChat(chat.id)!.updatedAt,
			before,
			"a rename is not conversation activity",
		);
		assert.equal(
			chatStore.listChats().find((c) => c.id === chat.id)!.title,
			"new title",
			"the sidebar list view sees it",
		);
	});

	it("falls back to Untitled session on an all-whitespace title (the honest floor)", () => {
		const chat = chatStore.createChat("keep me");
		createdChats.push(chat.id);
		const renamed = chatStore.renameChat(chat.id, "   ");
		assert.equal(renamed.title, "Untitled session");
	});
});

describe("the BYOK turn gate (no factory floor — owner, 2026-09-22)", () => {
	it("a chat with no model refuses the turn with the 503 envelope — nothing lingers", async () => {
		const chat = chatStore.createChat("Test: unconfigured chat");
		createdChats.push(chat.id);

		// The record's strong slot belongs to settings-store.test.ts (the
		// one-fs-owner policy) — READ the resolved truth, never write it.
		// Refusal holds when the chain is empty; a record-carried strong
		// slot legitimately opens the gate (the chain is honest both ways).
		const expectRefusal = effectiveSettings().models.strong === null;

		const res = await handleChatRequest(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(scriptedTeacher(defaultLesson).engine));

		if (expectRefusal) {
			assert.equal(res.status, 503, "the universal turn gate refuses before beginTurn");
			const body = (await res.json()) as { error: string; code: string; missing: string[] };
			assert.equal(body.code, "models_not_configured");
			assert.deepEqual(body.missing, ["strong"]);
			assert.match(body.error, /No model configured/);
		} else {
			assert.equal(res.status, 200, "the record's strong slot satisfies the conversation chain");
			await drainRunning(chat.id);
		}

		// Either way: no phantom liveness, nothing durable from a refused turn.
		if (expectRefusal) {
			assert.equal(isTurnRunning(chat.id), false, "the refusal never registers a live turn");
			const saved = chatStore.getChat(chat.id)!;
			assert.equal(saved.messages.length, 0, "no write-ahead persist before the gate");
		}
	});

	it("a per-chat model alone opens the gate (the setup flow's exact write)", async () => {
		const chat = createConfiguredChat("Test: per-chat pin only");
		createdChats.push(chat.id);
		const res = await handleChatRequest(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(scriptedTeacher(defaultLesson).engine));
		assert.equal(res.status, 200, "chat.settings.model satisfies the chain without any record slot");
		await drainRunning(chat.id);
	});
});

// ─── the key-presence turn gate (provider-key interlude, owner, 2026-09-25) ─

describe("the key-presence turn gate (provider-key interlude, 2026-09-25)", () => {
	// The gate's truth is env-first (keyValue): in tests process.env is the
	// WHOLE truth (the throwaway data dir has no auth.json), so each test
	// pins its provider's env var explicitly and restores it after.
	it("a pinned provider whose key is gone refuses with 503 provider_key_missing — nothing lingers", async () => {
		const chat = chatStore.createChat("Test: keyless provider");
		createdChats.push(chat.id);
		const saved = process.env.TOGETHER_API_KEY;
		delete process.env.TOGETHER_API_KEY;
		try {
			// The chat's own model override pins the provider — the same
			// chain the strong slot rides. The gate fires BEFORE the engine
			// build, so the fake model id never hits the catalog.
			chatStore.saveSettings(chat.id, { model: { provider: "together", id: "no-such-model" } });
			const res = await handleChatRequest(post(chat.id, { type: "text", text: "teach me something" }), agentFactory(scriptedTeacher(defaultLesson).engine));

			assert.equal(res.status, 503, "the key-presence gate refuses before beginTurn");
			const body = (await res.json()) as { error: string; code: string; provider: string; slots: string[] };
			assert.equal(body.code, "provider_key_missing");
			assert.equal(body.provider, "together", "the envelope names whose key is gone");
			assert.deepEqual(body.slots, ["strong"], "the conversation tier is the affected slot");
			assert.equal(body.error, "No Together key is set — add one in Settings → Keys", "the human line names the provider");
			assert.equal(isTurnRunning(chat.id), false, "the refusal never registers a live turn");
			assert.equal(chatStore.getChat(chat.id)!.messages.length, 0, "no write-ahead persist before the gate");
		} finally {
			if (saved !== undefined) process.env.TOGETHER_API_KEY = saved;
		}
	});

	it("an env-present key passes the gate (gate by what would run)", async () => {
		const chat = chatStore.createChat("Test: env-keyed provider");
		createdChats.push(chat.id);
		const saved = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "test-key-presence-gate";
		try {
			// A REAL catalog model: the engine build AFTER the gate must
			// resolve — the injected agent replaces the loop, not the build.
			chatStore.saveSettings(chat.id, { model: { provider: "openai", id: "gpt-4" } });
			const res = await handleChatRequest(post(chat.id, { type: "text", text: "teach me something" }), agentFactory(scriptedTeacher(defaultLesson).engine));

			assert.equal(res.status, 200, "the env-shadowed key counts as present — the turn runs");
			await drainRunning(chat.id);
		} finally {
			if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
			else delete process.env.OPENAI_API_KEY;
		}
	});
});

describe("background-turn runner (owner ruling 2026-09-25: every turn is a server-side process, clients are views)", () => {
	it("CONNECTION DIET B (owner, 2026-10-10): the POST acks and closes — the response never holds the turn's stream", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const engine = gatedTeacher(gate);
		const chat = createConfiguredChat("Test: ack-and-close");
		createdChats.push(chat.id);

		const res = await handleChatRequest(post(chat.id, { type: "text", text: "hold it" }), agentFactory(engine));
		assert.equal(res.status, 200);
		// The body must be FULLY readable while the turn is still gated
		// mid-run — a closed JSON ack, not an open stream. (The freeze
		// postmortem: each held-open POST response pinned one of the
		// browser's 6-per-origin connections for the turn's whole life.)
		const body = JSON.parse(await res.text());
		assert.deepEqual(body, { ok: true }, "the ack is a tiny JSON envelope");
		assert.equal(isTurnRunning(chat.id), true, "the turn runs on with its response closed");

		release();
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("subscribe mid-turn: a second view gets the FULL replay, then live, same dialect", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const engine = gatedTeacher(gate);
		const chat = createConfiguredChat("Test: reattach replay");
		createdChats.push(chat.id);

		const ack = await handleChatRequest(post(chat.id, { type: "text", text: "hold my turn" }), agentFactory(engine));
		assert.equal(ack.status, 200);
		// CONNECTION DIET B (2026-10-10): the POST acks and closes; the first
		// view consumes a little of the reattach wire (the start chunk is out).
		const firstHandle = runningTurn(chat.id)!;
		const firstView = new Response(firstHandle.subscribe());
		const reader = firstView.body!.getReader();
		await reader.read();

		// A SECOND view attaches mid-turn — a remount, another device.
		const handle = runningTurn(chat.id)!;
		assert.ok(handle, "the registry resolves the live turn");
		const secondText = new Response(handle.subscribe()).text();

		// Let the turn finish; both views close at settle.
		release();
		const text = await secondText;
		const replay = eventsOf(text);
		assert.equal(replay[0]!.type, "agent_start", "replay starts from the very first event");
		assert.ok(text.includes("Gated reply."), "replay carries the full streamed content");
		assert.ok(text.endsWith("data: [DONE]\n\n"), "live tail ends with the SSE terminal, same dialect as POST");
		// Wire honesty: a normal turn settles with NO error event (the live
		// smoke caught a close()-throw masked into the error path — unit
		// asserts never looked; these pins would have).
		assert.ok(!text.includes('"type":"error"'), "a clean turn never emits an error event");
		assert.ok(replay.some((e) => e.type === "message_end" && e.message?.stopReason === "stop"), "message_end carries the stop reason");
		// And the first view also closes cleanly (no hang, no drop): read its
		// remaining chunks through the reader we already hold.
		const decoder = new TextDecoder();
		let firstTail = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			firstTail += decoder.decode(value, { stream: true });
		}
		assert.ok(firstTail.endsWith("data: [DONE]\n\n"), "first view closes cleanly at settle, unaffected by the reattach");
	});

	it("COMPACTION LAW (owner 2026-10-09): the log stores state, not chunks — a chunk burst coalesces to ONE update, slim wire, full content", async () => {
		// The parallel-session freeze postmortem: pi's message_update is a FULL
		// snapshot per provider chunk; retaining and re-serializing every one
		// made memory and replay quadratic in message length (one high-thinking
		// message = hundreds of MB retained; every reattach re-stringified the
		// whole history in one blocking stretch). Pins the fix end-to-end: faux
		// streams a long text as many immediate chunks (microtask pacing — all
		// inside one flush window), yet the wire carries exactly ONE
		// message_update for the run, it is the LATEST snapshot, and the wire
		// never carries pi's duplicate partial.
		const long = "quadratic blowup ".repeat(40); // ~40 faux chunks
		const faux = createFauxCore({});
		faux.setResponses([fauxAssistantMessage([fauxText(long)])]);
		const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
		const chat = createConfiguredChat("Test: compaction law");
		createdChats.push(chat.id);
		const body = await drainTurn(post(chat.id, { type: "text", text: "go" }), agentFactory(engine));
		const events = eventsOf(body);
		const updates = events.filter((e) => e.type === "message_update");
		assert.equal(updates.length, 1, "a burst of chunks coalesces to exactly one update on the wire");
		assert.ok(
			JSON.stringify(updates[0]!.message?.content ?? []).includes(long),
			"the one update is the LATEST snapshot — the full streamed text",
		);
		assert.ok(!body.includes("assistantMessageEvent"), "WIRE DIET: the duplicate partial never crosses the boundary");
		const end = events.find((e) => e.type === "message_end" && (e as { message?: { role?: string } }).message?.role === "assistant");
		assert.ok(end, "message_end present");
		assert.ok(JSON.stringify((end as { message?: { content?: unknown[] } }).message?.content ?? []).includes(long), "message_end carries the full final message (authoritative, lossless)");
		// And the persisted record never knew about chunks at all.
		const record = chatStore.getChat(chat.id)!;
		assert.ok(JSON.stringify(record.messages).includes(long), "persistTurn wrote the settled message in full");
	});

	it("remote abort: any client can stop a running turn; the partial persists; subscribers close cleanly", async () => {
		const engine = abortableTeacher();
		const chat = createConfiguredChat("Test: remote abort");
		createdChats.push(chat.id);

		const res = await handleChatRequest(post(chat.id, { type: "text", text: "wait forever" }), agentFactory(engine));
		assert.equal(res.status, 200);
		assert.ok(runningTurn(chat.id), "turn registered while in flight");
		const viewText = new Response(runningTurn(chat.id)!.subscribe()).text(); // the first view, reading to settle

		// The remote kill from a DIFFERENT view (the dock's abort).
		const outcome = abortTurn(chat.id);
		assert.deepEqual(outcome, { ok: true }, "abort resolves ok on a live turn");

		const text = await viewText;
		assert.ok(text.endsWith("data: [DONE]\n\n"), "subscriber closes cleanly at the aborted settle");

		await waitFor(() => !isTurnRunning(chat.id), 8000, "aborted turn settle");
		const saved = chatStore.getChat(chat.id)!;
		assert.ok(saved.messages.length >= 2, "the partial transcript persisted via the usual settle path");
		assert.equal(runningTurn(chat.id), undefined, "handle unregistered after the aborted settle");

		// Honest 409 semantics: there is nothing left to abort.
		assert.deepEqual(abortTurn(chat.id), { ok: false, reason: "not_running" }, "second abort is not_running");
	});

	it("subscribe after settle: the cheap terminal tells the client the record is current", async () => {
		const { engine } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: settled terminal");
		createdChats.push(chat.id);

		// A quiet chat: no turn ever ran — the stream is the same terminal.
		const term = settledTurnResponse();
		assert.equal(await term.text(), 'data: {"type":"turn-settled"}\n\ndata: [DONE]\n\n', "terminal is one event + [DONE]");
		assert.equal(runningTurn(chat.id), undefined);

		// And after a settled turn, the registry is empty — the GET would
		// serve the same terminal, not a stale handle.
		await drainTurn(post(chat.id, { type: "text", text: "quiz me" }), agentFactory(engine));
		assert.equal(runningTurn(chat.id), undefined, "no handle survives settle");
	});

	it("concurrent two-chat reattach: two turns in flight, two views, both settle independently", async () => {
		const releaseFns: Array<() => void> = [];
		const chats = [1, 2].map((n) => {
			const gate = new Promise<void>((r) => (releaseFns.push(r)));
			const engine = gatedTeacher(gate);
			const chat = createConfiguredChat(`Test: two-chat ${n}`);
			createdChats.push(chat.id);
			return { n, engine, chat };
		});

		const views = new Map<string, Promise<string>>();
		for (const { chat, engine } of chats) {
			const res = await handleChatRequest(post(chat.id, { type: "text", text: "hold my turn" }), agentFactory(engine));
			assert.equal(res.status, 200);
			const handle = runningTurn(chat.id)!;
			assert.ok(handle, `chat ${chat.id} has its own handle`);
			views.set(chat.id, new Response(handle.subscribe()).text());
			// The other chat's handle must not be this one (per-chat keying).
			const others = chats.filter((c) => c.chat.id !== chat.id).map((c) => runningTurn(c.chat.id));
			assert.ok(!others.includes(handle), "per-chat handles are distinct objects");
		}

		// Release both; both settle independently.
		for (const release of releaseFns) release();
		for (const { chat } of chats) {
			const text = await views.get(chat.id)!;
			assert.ok(text.includes("Gated reply."), `chat ${chat.id} view replayed its own turn`);
			assert.ok(text.endsWith("data: [DONE]\n\n"), `chat ${chat.id} view closed at settle`);
			await waitFor(() => !isTurnRunning(chat.id), 8000, `chat ${chat.id} settle`);
			assert.equal(chatStore.getChat(chat.id)!.messages.length, 2, `chat ${chat.id} persisted its full turn`);
		}
	});
});

// ─── the explain mechanic end-to-end (free-recall, owner 2026-09-27) ───────

it("explain tool call persists as a pending part; the free-text answer reveals the commitment and reaches the model", async () => {
	const EXPLAIN_INPUT = {
		question: "Explain why Mercury is hard to observe.",
		correctAnswer: "Its small angular separation from the Sun — it never strays far from the Sun in our sky.",
		nodeId: "planet-order",
		type: "check", // the teach explain's role field (owner, 2026-10-09)
	};
	const { engine, calls } = scriptedTeacher((cs) => [
		(context) => {
			cs.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
			return fauxAssistantMessage(
				[fauxThinking("Free recall this time."), fauxToolCall("explain", EXPLAIN_INPUT, { id: "call-1" })],
				{ stopReason: "toolUse" },
			);
		},
		(context) => {
			cs.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
			return fauxAssistantMessage([fauxText("Right — it hugs the Sun.")]);
		},
	]);
	const chat = createConfiguredChat("Test: explain mechanic");
	createdChats.push(chat.id);

	// Free-recall armed: the mechanic swap is the ONLY change to the registry.
	const tools = createTeacherTools(
		{ chatId: chat.id, chatStore, jobStore, spawn: () => {} },
		{ explain: true },
	);
	assert.ok(tools.explain && !tools.quiz, "explain armed, quiz dropped — one quizzing tool");

	const factory: Parameters<typeof handleChatRequest>[1] = (opts) =>
		createTeacherAgent(undefined, { engine, messages: opts.messages, tools });
	await drainTurn(post(chat.id, { type: "text", text: "teach me the solar system" }), factory);

	const saved1 = chatStore.getChat(chat.id)!;
	const savedContent1 = (saved1.messages[1] as { content: unknown }).content as Array<{ type: string; name?: string }>;
	const call = savedContent1.find((b) => b.type === "toolCall" && b.name === "explain");
	assert.ok(call, "explain tool call persisted");

	const pending = danglingQuestionOf(saved1.messages);
	assert.equal(pending?.tool, "explain");
	assert.deepEqual(pending?.input, EXPLAIN_INPUT);

	const view1 = projectView(saved1.messages);
	assert.ok(view1[1]!.parts.some((p) => p.type === "tool-explain"), "tool-explain part projected — the dock arms");

	// The client answers in his own words (the dock's buildAnswer seam):
	const qd: QuestionData = {
		id: "call-1",
		kind: "explain",
		question: EXPLAIN_INPUT.question,
		mode: "text",
		options: [],
		committedAnswer: EXPLAIN_INPUT.correctAnswer,
		createdAt: new Date().toISOString(),
	};
	const answer = buildAnswer(qd, { text: "It stays near the Sun." });
	assert.equal(answer.correct, undefined, "no client grading — the model grades");

	await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-1", answer }), factory);

	const saved2 = chatStore.getChat(chat.id)!;
	const view2 = projectView(saved2.messages);
	const part = view2[1]!.parts.find((p) => p.type === "tool-explain");
	assert.equal((part as { state?: string }).state, "output-available");
	const out = (part as { output?: { committed?: string; explanation?: string } }).output!;
	assert.equal(out.committed, EXPLAIN_INPUT.correctAnswer, "the commitment snapshots into the answer record");
	assert.equal(out.explanation, undefined, "no explanation remnant — one committed field (owner 2026-09-27)");

	// The model's continuation saw the answer JSON (fork 1: the answer IS
	// the call's tool result) — his text AND the commitment snapshot ride it.
	const seen = calls[1]!.join("\n");
	assert.match(seen, /It stays near the Sun\./);
	assert.match(seen, /committed/);
	assert.match(seen, /small angular separation/);
	assert.ok(!/"explanation"/.test(seen), "the answer record carries no explanation field");
	assert.equal(danglingQuestionOf(saved2.messages), null, "no pending question remains");
});

// ─── the silent dismissal (owner design 2026-10-03, "A2") ──────────────────

describe("the silent dismissal (A2)", () => {
	it("writes the toolResult with NO wake — the next plain message carries it to the model", async () => {
		const { engine, calls } = scriptedTeacher(defaultLesson);
		const chat = createConfiguredChat("Test: silent dismissal");
		createdChats.push(chat.id);

		// Turn 1: the quiz dangles.
		await drainTurn(post(chat.id, { type: "text", text: "teach me the solar system" }), agentFactory(engine));
		assert.ok(danglingQuestionOf(chatStore.getChat(chat.id)!.messages), "the quiz is pending");

		// The dismissal: SILENT — record completes the call, nothing wakes.
		const res = await dismissPost(chat.id, "call-1");
		assert.equal(res.status, 200);
		const saved = chatStore.getChat(chat.id)!;
		assert.equal(danglingQuestionOf(saved.messages), null, "the call is answered by the dismissal");
		const tail = saved.messages[saved.messages.length - 1]! as { role?: string; details?: { dismissed?: boolean } };
		assert.equal(tail.role, "toolResult");
		assert.equal(tail.details?.dismissed, true, "the record's dismissal is the details payload");
		assert.equal(calls.length, 1, "NO second engine call — the dismissal woke nothing");
		assert.equal(isTurnRunning(chat.id), false);
		assert.equal(endsInDismissal(saved.messages), true, "the session sits dismissal-paused");

		// The next plain message is THE wake — the model sees the skipped
		// question and the user's text in one context (the steer-batch
		// outcome, delivered by record truth).
		await drainTurn(post(chat.id, { type: "text", text: "skip that — tell me about Mars" }), agentFactory(engine));
		assert.equal(calls.length, 2, "exactly one wake: the user's message");
		assert.match(calls[1]!.join("\n"), /dismissed/, "the dismissed result rode the wake's context");
		assert.equal(endsInDismissal(chatStore.getChat(chat.id)!.messages), false, "the pause lifted with the send");
	});

	it("rejects honestly: unknown chat 404, no dangling question 400", async () => {
		assert.equal((await dismissPost("chat_nonexistent", "call-x")).status, 404);
		const chat = createConfiguredChat("Test: dismiss no question");
		createdChats.push(chat.id);
		chatStore.saveMessages(chat.id, [{ id: "u1", role: "user", content: "hi", timestamp: 1 } as never]);
		assert.equal((await dismissPost(chat.id, "call-x")).status, 400);
	});

	it("parallel quizzes dismiss call-by-call — the composer returns only when nothing dangles", async () => {
		const chat = createConfiguredChat("Test: parallel dismiss");
		createdChats.push(chat.id);
		// Two quiz calls in one assistant message (the sequential-execution
		// shape the tools opt into).
		chatStore.saveMessages(chat.id, [
			{ id: "u1", role: "user", content: "hello", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [
					{ type: "toolCall", id: "call-a", name: "quiz", arguments: { ...QUIZ_INPUT, question: "A?" } as never },
					{ type: "toolCall", id: "call-b", name: "quiz", arguments: { ...QUIZ_INPUT, question: "B?" } as never },
				],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "toolUse",
				timestamp: 1,
			} as never,
		]);

		// First dismissal completes call-a; call-b still dangles.
		assert.equal((await dismissPost(chat.id, "call-a")).status, 200);
		const pending = danglingQuestionOf(chatStore.getChat(chat.id)!.messages);
		assert.equal(pending?.toolCallId, "call-b", "the dock advances to the next question");
		assert.equal(endsInDismissal(chatStore.getChat(chat.id)!.messages), true);

		// Second dismissal: nothing dangles, still paused.
		assert.equal((await dismissPost(chat.id, "call-b")).status, 200);
		assert.equal(danglingQuestionOf(chatStore.getChat(chat.id)!.messages), null, "the composer may return");
		assert.equal(endsInDismissal(chatStore.getChat(chat.id)!.messages), true, "paused until the user speaks");
	});
});

// ─── parallel question calls (the deepseek batch incident, 2026-10-03) ─────

describe("parallel question calls: the answer defers its wake while a sibling dangles", () => {
	const ASK_INPUT = {
		question: "Which topic should this test session cover next?",
		options: [{ label: "Chemistry" }, { label: "History" }],
	};

	/** Turn 1: BOTH calls in one assistant message (the parallel batch
	 *  shape deepseek emitted live). Turn 2: the reaction. */
	function parallelLesson(calls: string[][]): FauxResponseStep[] {
		return [
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage(
					[
						fauxThinking("Batch a graded and a non-graded check."),
						fauxToolCall("quiz", QUIZ_INPUT, { id: "call-1" }),
						fauxToolCall("ask_user_question", ASK_INPUT, { id: "call-2" }),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage([fauxText("Both answered — good.")]);
			},
		];
	}

	it("the sibling answer wakes NOTHING; the last answer fires the one turn with both results adjacent", async () => {
		const { engine, calls } = scriptedTeacher(parallelLesson);
		const chat = createConfiguredChat("Test: parallel questions");
		createdChats.push(chat.id);

		// Turn 1: the batch lands; both calls dangle (the dock shows the quiz —
		// the first in call order).
		await drainTurn(post(chat.id, { type: "text", text: "ask me two questions in parallel" }), agentFactory(engine));
		let saved = chatStore.getChat(chat.id)!;
		let pending = danglingQuestionOf(saved.messages);
		assert.equal(pending?.toolCallId, "call-1", "the dock holds the quiz first");

		// The graded answer: the result appends ADJACENT to the calling
		// assistant message — and NO wake fires while the ask still dangles.
		const quizAns = gradedAnswer(QUIZ_INPUT, ["Mercury"]);
		await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-1", answer: quizAns }), agentFactory(engine));
		assert.equal(calls.length, 1, "the sibling answer woke NOTHING (the gate deferred)");
		saved = chatStore.getChat(chat.id)!;
		assert.equal((saved.messages[2] as { toolCallId?: string }).toolCallId, "call-1", "quiz result adjacent to the batch");
		pending = danglingQuestionOf(saved.messages);
		assert.equal(pending?.toolCallId, "call-2", "the dock advances to the ask immediately — no turn ran");

		// The last answer: ONE wake; the model sees both results, adjacent to
		// their calling message (the provider shape law).
		const askAns = {
			kind: "ask",
			questionText: ASK_INPUT.question,
			dontKnow: false,
			answers: [],
			text: "History",
			answeredAt: new Date().toISOString(),
		};
		await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-2", answer: askAns }), agentFactory(engine));
		assert.equal(calls.length, 2, "exactly one wake: the last answer's turn");
		saved = chatStore.getChat(chat.id)!;
		assert.equal(danglingQuestionOf(saved.messages), null, "nothing dangles anymore");
		const prompt2 = calls[1]!.join("\n");
		assert.match(prompt2, /Mercury/, "the quiz result rode the wake's context");
		assert.match(prompt2, /History/, "the ask answer rode the wake's context");
		// The shape law: both results sit directly after the batch's assistant
		// message, before the reaction — nothing intervenes.
		const roles = saved.messages.map((m) => (m as { role?: string }).role);
		assert.deepEqual(roles.slice(1, 5), ["assistant", "toolResult", "toolResult", "assistant"], "batch → both results → reaction");
	});
});

describe("parallel rounds: the LAST resolution decides the wake (owner ruling 2026-10-03)", () => {
	/** The batch lesson, shared: turn 1 poses quiz + ask; turn 2 reacts. */
	function batchLesson(calls: string[][]): FauxResponseStep[] {
		return [
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage(
					[
						fauxThinking("Batch again."),
						fauxToolCall("quiz", QUIZ_INPUT, { id: "call-1" }),
						fauxToolCall("ask_user_question", { question: "Next topic?", options: [{ label: "Chemistry" }, { label: "History" }] }, { id: "call-2" }),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage([fauxText("Round done.")]);
			},
		];
	}

	it("round 1 — answer then dismiss: NO wake at all (ending on a dismissal pauses)", async () => {
		const { engine, calls } = scriptedTeacher(batchLesson);
		const chat = createConfiguredChat("Test: round 1");
		createdChats.push(chat.id);
		await drainTurn(post(chat.id, { type: "text", text: "two questions please" }), agentFactory(engine));

		// Answer the quiz — deferred by the parallel gate.
		await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-1", answer: gradedAnswer(QUIZ_INPUT, ["Mercury"]) }), agentFactory(engine));
		assert.equal(calls.length, 1, "the sibling answer deferred");

		// Dismiss the ask — the LAST resolution is a dismissal: no continuation
		// seam may fire either (the round-1 incident's leak, now closed).
		assert.equal((await dismissPost(chat.id, "call-2", "ask")).status, 200);
		const saved = chatStore.getChat(chat.id)!;
		assert.equal(danglingQuestionOf(saved.messages), null);
		assert.equal(needsContinuation(saved.messages), false, "ending on a dismissal owes nothing");
		assert.equal(endsInDismissal(saved.messages), true, "the session sits paused");
		assert.equal(calls.length, 1, "NO wake — the agent never ran a second turn");
	});

	it("round 2 — dismiss then answer: exactly one wake carrying both results", async () => {
		const { engine, calls } = scriptedTeacher(batchLesson);
		const chat = createConfiguredChat("Test: round 2");
		createdChats.push(chat.id);
		await drainTurn(post(chat.id, { type: "text", text: "two questions please" }), agentFactory(engine));

		assert.equal((await dismissPost(chat.id, "call-1")).status, 200);
		assert.equal(calls.length, 1, "the dismissal woke nothing");

		await drainTurn(post(chat.id, { type: "answer", toolCallId: "call-2", answer: { kind: "ask", questionText: "Next topic?", dontKnow: false, answers: [], text: "Chemistry", answeredAt: new Date().toISOString() } }), agentFactory(engine));
		assert.equal(calls.length, 2, "the trailing answer fired the one wake");
		const prompt2 = calls[1]!.join("\n");
		assert.match(prompt2, /Chemistry/, "the answer rode the wake");
		assert.match(prompt2, /dismissed/, "the dismissal rode the wake too");
	});
});

// ─── composer steering (owner arc 2026-10-03): the route + the live rail ────

describe("composer steering: POST /api/chats/[id]/steer", () => {
	const steerPost = (chatId: string, body: unknown): Promise<Response> =>
		steerRoute.POST(
			new Request(`http://test/api/chats/${chatId}/steer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			{ params: Promise.resolve({ id: chatId }) },
		);

	it("honest rejections: 404 unknown chat, 400 bad input, 409 when no turn is live", async () => {
		const chat = createConfiguredChat("Test: steer rejections");
		createdChats.push(chat.id);
		assert.equal((await steerPost("chat_nope", { input: { type: "steer", id: "steer_1", text: "hi" } })).status, 404);
		assert.equal((await steerPost(chat.id, { input: { type: "steer", id: "", text: "hi" } })).status, 400);
		assert.equal((await steerPost(chat.id, { input: { type: "text", text: "hi" } })).status, 400);
		assert.equal((await steerPost(chat.id, { input: { type: "steer", id: "steer_1", text: "  " } })).status, 400);
		assert.equal((await steerPost(chat.id, { input: { type: "steer", id: "steer_1", text: "hi" } })).status, 409);
	});

	it("200 + the live steering queue when a turn runs; the drain lands the card and the model sees it", async () => {
		// A GATED engine (the scriptedTeacher seam): the first factory
		// awaits our release, holding the turn open mid-generation so the
		// steer POST lands while the run is genuinely live.
		const calls: string[][] = [];
		let release!: () => void;
		const gate = new Promise<void>((res) => {
			release = res;
		});
		const faux = createFauxCore({});
		faux.setResponses([
			async (context: { messages: unknown[] }) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				await gate;
				return fauxAssistantMessage([fauxText("Teaching the solar system…")]);
			},
			(context: { messages: unknown[] }) => {
				calls.push(context.messages.map((m) => JSON.stringify((m as { content: unknown }).content)));
				return fauxAssistantMessage([fauxText("Steered — covering Venus too.")]);
			},
		]);
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };

		const chat = createConfiguredChat("Test: steer live");
		createdChats.push(chat.id);

		// The turn starts and holds at the first model call.
		const turnRes = await handleChatRequest(post(chat.id, { type: "text", text: "teach me" }), agentFactory(engine as never));
		await waitFor(() => calls.length === 1, 8000, "first model call started");

		// The steer lands mid-turn: 200, handed to the live agent.
		const res = await steerPost(chat.id, { input: { type: "steer", id: "steer_live1", text: "also cover Venus" } });
		assert.equal(res.status, 200);
		assert.equal((await res.json() as { ok: boolean }).ok, true);

		// CONNECTION DIET B: the drain rides the reattach wire (the POST
		// acked long ago). Attach BEFORE releasing — a live view.
		const viewText = drainRunning(chat.id);
		release(); // the first response completes → the drain → the second call
		const body = await viewText;
		assert.match(body, /also cover Venus/, "the drained steer rode the live stream verbatim");

		// ONE turn: the second model call's context contains the steer
		// BETWEEN the user message and the continuing assistant text.
		assert.equal(calls.length, 2, "still one run — the steer continued it, not a new turn");
		assert.match(calls[1]!.join("\n"), /also cover Venus/, "the model saw the steer in its context");

		// The record persists the user steer in its true position.
		const saved = chatStore.getChat(chat.id)!;
		const roles = saved.messages.map((m) => (m as { role?: string }).role);
		assert.deepEqual(roles, ["user", "assistant", "user", "assistant"], "text → teaching → STEER → steered reply");
		const steerMsg = saved.messages[2] as { id?: string; content?: unknown };
		assert.equal(steerMsg.id, "steer_live1", "the client-minted id survived to the record");
		assert.equal(steerMsg.content, "also cover Venus");
	});
});

// ─── THE LACAN INCIDENT: per-response tool-call ids (owner fix 2026-10-04) ──
// DeepSeek (via OpenRouter) returns tool-call ids that reset every response —
// `call_0` for every turn's single call. Before the uniquifier, the duplicate
// ids corrupted the fold (the quiz answer overwrote the ask card, the ask
// question vanished), answer routing, and the shuffle seeds. Now the wire
// boundary remints colliding ids ONCE — the client, the record, the pending
// gate, and the next turn's provider context all see unique ids.
describe("duplicate provider tool-call ids (the Lacan fix)", () => {
	it("every `call_0` turn keeps its identity: ask answered as ask, quiz as quiz, ids unique in the record", async () => {
		// the live shape (the real Lacan session): an ask with NO options
		const ASK = { question: "What do you want from Lacan?" };
		const QUIZ2 = { ...QUIZ_INPUT, type: "check" };
		// BOTH turns name their single call `call_0` — the provider's shape.
		const { engine } = scriptedTeacher(() => [
			(context) => {
				void context;
				return fauxAssistantMessage(
					[fauxText("First — a question about your goal."), fauxToolCall("ask_user_question", ASK, { id: "call_0" })],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				void context;
				return fauxAssistantMessage(
					[fauxText("The unconscious, then."), fauxToolCall("quiz", QUIZ2, { id: "call_0" })],
					{ stopReason: "toolUse" },
				);
			},
			() => fauxAssistantMessage([fauxText("Right — and that is where Lacan begins.")]),
		]);

		const chat = createConfiguredChat("Lacan: duplicate call_0 turns");
		createdChats.push(chat.id);
		// Turn 1: the ask question.
		await drainTurn(post(chat.id, { type: "text", text: "teach me Lacan" }), agentFactory(engine));
		let saved = chatStore.getChat(chat.id)!;
		let pending = danglingQuestionOf(saved.messages)!;
		assert.equal(pending.tool, "ask_user_question");
		// The client answers with the id IT SAW — the persisted one.
		const askId = pending.toolCallId;
		await drainTurn(post(chat.id, { type: "answer", toolCallId: askId, answer: { kind: "ask", questionText: ASK.question, dontKnow: false, answers: [], text: "The theory core", answeredAt: new Date().toISOString() }, }), agentFactory(engine));

		// Turn 2: the quiz — ALSO `call_0` from the provider.
		saved = chatStore.getChat(chat.id)!;
		pending = danglingQuestionOf(saved.messages)!;
		assert.equal(pending.tool, "quiz");
		const quizId = pending.toolCallId;
		assert.notEqual(quizId, askId, "the uniquifier reminted the colliding id at the wire boundary");
		assert.match(quizId, /^call_0~\d+$/, "mint scheme: orig~n");
		await drainTurn(post(chat.id, { type: "answer", toolCallId: quizId, answer: gradedAnswer(QUIZ2, ["Mercury"]) }), agentFactory(engine));

		saved = chatStore.getChat(chat.id)!;
		// The invariant: CALL ids are unique among themselves (a call and its
		// own result share one id by design — that pair is the point).
		const callIds = saved.messages.flatMap(
			(m) =>
				m.role === "assistant"
					? (m.content ?? []).filter((c) => c.type === "toolCall").map((c) => c.id)
					: [],
		);
		assert.equal(new Set(callIds).size, callIds.length, "no duplicate tool-call ids persist");
		assert.deepEqual(callIds, ["call_0", "call_0~2"], "the provider's two call_0s became distinct ids");

		// The fold is the Lacan heal: the ask card carries the ASK answer,
		// the quiz card the QUIZ answer — no overwrite, order preserved.
		const view = projectView(saved.messages);
		const parts = view.flatMap((v) => v.parts).filter((p) => p.type.startsWith("tool-"));
		const askPart = parts.find((p) => (p as { toolCallId?: string }).toolCallId === askId) as { state?: string; output?: { kind?: string } };
		const quizPart = parts.find((p) => (p as { toolCallId?: string }).toolCallId === quizId) as { state?: string; output?: { kind?: string } };
		assert.equal(askPart?.state, "output-available");
		assert.equal(askPart?.output?.kind, "ask", "the ask card keeps its own answer");
		assert.equal(quizPart?.state, "output-available");
		assert.equal(quizPart?.output?.kind, "quiz", "the quiz card got ITS answer (the pre-fix bug: it landed on the ask card)");
	});
});
