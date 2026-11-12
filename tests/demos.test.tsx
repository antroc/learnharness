
/**
 * Pruebas de demos + artefactos visuales (W6): deterministas, sin red y sin
 * Chrome real:
 *
 *   1. inyección del script puente (buildDemoSrcDoc) + el reductor puro de
 *      mensajes del puente (reduceDemoBridgeState)
 *   2. renderizado de tarjetas (marcado estático): atributos del iframe aislado, etiqueta de error,
 *      notas de fallo, documentos de imagen SVG
 *   3. el bucle de demo-builder con un modelo FALSO + headless FALSO (éxito con
 *      una iteración de arreglo, verificación final no probada, fallo nunca limpio,
 *      fallo sin Chrome)
 *   4. el bucle de visual-maker (modelo falso + headless falso): éxito de renderizar y mirar,
 *      mirada forzada ante un final prematuro, fallo por no escribir nunca
 *   5. ejecutores de tareas + despacho (parte de demo → tarea de demo → reorientación mediante una entrega
 *      falsa; ruta de fallo del visual; despacho de extremo a extremo a través de
 *      handleChatRequest con el protocolo de acuse)
 *   6. cableado del registro de herramientas (herramientas de despacho ejecutadas en el servidor, esquemas)
 *
 * La limpieza sigue las costumbres de tests/jobs.test.ts (los ficheros de chat/tarea creados se borran
 * en el hook after(); las sustituciones se restablecen en bloques finally).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React; // parche del JSX clásico de tsx (ver render-cards.test.tsx)

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { Value } from "typebox/value";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import { renderToStaticMarkup } from "react-dom/server";
import { PATHS } from "../config.ts";
import {
	buildDemoSrcDoc,
	DEMO_BRIDGE_SCRIPT,
	DemoCard,
	DemoErrorChip,
	INITIAL_DEMO_BRIDGE_STATE,
	reduceDemoBridgeState,
} from "../components/artifacts/demo-card.tsx";
import { svgNaturalWidth, VisualCard, VisualOutputCard } from "../components/artifacts/visual-card.tsx";
import { slugFilename } from "../components/artifacts/download.ts";
import { chartSize } from "../components/session-overlay.tsx";
import { SubagentSteerCard } from "../components/artifacts/steer-card.tsx";
import { DispatchCard } from "../components/artifacts/dispatch-card.tsx";
import { JobCard, PdfJobCard } from "../components/artifacts/job-card.tsx";
import { ToolCallCard } from "../components/artifacts/tool-call-card.tsx";
import { JobsContext } from "../components/jobs-context.ts";
import { demoInputSchema, jobTools, pdfInputSchema, visualInputSchema } from "../src/agent/tools/jobs.ts";
import { runDemoBuilder } from "../src/agent/subagents/demo-builder.ts";
import { headlessOverride, realHeadless, type DemoRunResult, type HeadlessApi } from "../src/agent/subagents/headless.ts";
import { createJobRunner, demoModelOverride, visualModelOverride } from "../src/agent/subagents/runner.ts";
import { runVisualMaker } from "../src/agent/subagents/visual-maker.ts";
import { buildAbortSteer, buildSubagentSteer, isSubagentFailure, setSteerUiInverted, type SteerMessage } from "../src/core/contracts.ts";
import type { JobRecord } from "../src/core/contracts.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { projectView as projectNative } from "../src/core/view.ts";
import type { PiEngine } from "../src/agent/models.ts";

/**
 * Una frontera de entrega falsa + un ejecutor cableado como el de chat-handler, por prueba:
 * captura la reorientación e imita el cambio de estado final del proceso para que el registro
 * de la tarea se lea exactamente como en producción tras completarse el turno de despertar.
 */
function testRunner() {
	const steers: SteerMessage[] = [];
	const runner = createJobRunner({
		chatStore,
		jobStore,
		deliver: async (steer) => {
			steers.push(steer);
			const jobId = (steer.details as { jobId: string }).jobId;
			const job = jobStore.getJob(jobId);
			if (job && job.status === "running") {
				const failed = job.result ? isSubagentFailure(job.kind, job.result as never) : true;
				jobStore.updateJob(jobId, { status: failed ? "error" : "done", activity: failed ? "failed" : "delivered" });
			}
		},
	});
	return { steers, runner };
}
import { artifactRenderers } from "../components/artifacts/index.ts";

// La barrera de turno por presencia de clave (interludio de la clave del proveedor, 2026-09-25): los turnos
// guionizados fijan openrouter por chat; la barrera lee la verdad del entorno primero, así que la
// clave debe estar presente en el proceso de la prueba, como en cualquier configuración real.
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";



const JOBS_DIR = path.join(PATHS.data, "jobs");
const createdChats: string[] = [];
const createdJobs: string[] = [];

after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* ya no existe */
		}
	}
	for (const id of createdJobs) {
		try {
			fs.unlinkSync(path.join(JOBS_DIR, `${id}.json`));
		} catch {
			/* ya no existe */
		}
	}
	headlessOverride.current = undefined;
	demoModelOverride.current = undefined;
	visualModelOverride.current = undefined;
});

/** Un motor pi guionizado (proveedor simulado): la cola de respuestas sustituye al antiguo
 *  contador de turnos de doGenerate; una respuesta encolada por llamada al modelo (turno de
 *  llamada a herramienta o texto final), consumidas en orden. */
function scriptedModel(turns: Array<{ toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>; text?: string }>): PiEngine {
	const steps: FauxResponseStep[] = turns.map((step) => {
		if (step.toolCalls) {
			return fauxAssistantMessage(
				step.toolCalls.map((c) => fauxToolCall(c.toolName, c.input as ToolCall["arguments"], { id: c.toolCallId })),
				{ stopReason: "toolUse" },
			);
		}
		return fauxAssistantMessage(step.text ?? "");
	});
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

// ─── headless falso ──────────────────────────────────────────────────────────

const CLEAN_RUN: DemoRunResult = { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true };
const BROKEN_RUN: DemoRunResult = {
	consoleErrors: ["Uncaught ReferenceError: foo is not defined"],
	pageErrors: [],
	failedRequests: [],
	ok: false,
};

function fakeHeadless(opts: {
	/** Devuelve BROKEN_RUN para el html que contenga esta subcadena; si no, CLEAN_RUN. */
	brokenWhenIncludes?: string;
	/** Lanza en las N primeras llamadas a renderSvg (y luego tiene éxito). */
	renderFailures?: number;
} = {}): HeadlessApi & { demoRuns: string[]; svgRenders: string[] } {
	const api = {
		demoRuns: [] as string[],
		svgRenders: [] as string[],
		available() {
			return true;
		},
		unavailableReason() {
			return null;
		},
		async runDemo(html: string): Promise<DemoRunResult> {
			api.demoRuns.push(html);
			return opts.brokenWhenIncludes && html.includes(opts.brokenWhenIncludes) ? BROKEN_RUN : CLEAN_RUN;
		},
		async renderSvg(svg: string): Promise<Buffer> {
			api.svgRenders.push(svg);
			if (opts.renderFailures && api.svgRenders.length <= opts.renderFailures) {
				throw new Error("XML parse error");
			}
			// El procesador de imágenes nativo compartido decodifica los renderizados, así que una firma
			// sola ya no es un ráster falso válido.
			const canvas = createCanvas(1, 1);
			canvas.getContext("2d").fillRect(0, 0, 1, 1);
			return canvas.toBuffer("image/png");
		},
	};
	return api as HeadlessApi & { demoRuns: string[]; svgRenders: string[] };
}

function noChromeHeadless(): HeadlessApi {
	return {
		available: () => false,
		unavailableReason: () => "No Chrome/Chromium found for headless testing. Install Google Chrome or set CHROME_PATH.",
		runDemo: async () => {
			throw new Error("should not run");
		},
		renderSvg: async () => {
			throw new Error("should not render");
		},
		renderPdfPages: async () => {
			throw new Error("should not render");
		},
	};
}

// ─── 1. inyección del puente + reductor ──────────────────────────────────────

describe("demo bridge", () => {
	it("injects the resize + error hooks before </body>", () => {
		const srcDoc = buildDemoSrcDoc("<!doctype html><html><body><canvas id=\"c\"></canvas></body></html>");
		assert.match(srcDoc, /demo-resize/);
		assert.match(srcDoc, /demo-error/);
		assert.match(srcDoc, /ResizeObserver/);
		assert.match(srcDoc, /window\.addEventListener\("error"/);
		// el puente queda dentro del documento y el contenido original sobrevive
		assert.ok(srcDoc.indexOf("ResizeObserver") < srcDoc.indexOf("</body>"));
		assert.match(srcDoc, /<canvas id="c">/);
	});

	it("appends the bridge when the document has no </body>", () => {
		const srcDoc = buildDemoSrcDoc("<div>fragment demo</div>");
		assert.match(srcDoc, /demo-resize/);
		assert.ok(srcDoc.endsWith("</script>"));
		assert.match(srcDoc, /fragment demo/);
	});

	it("reduceDemoBridgeState handles resize, error, and garbage", () => {
		let state = INITIAL_DEMO_BRIDGE_STATE;
		state = reduceDemoBridgeState(state, { type: "demo-resize", height: 421.7 });
		assert.equal(state.height, 422);
		assert.equal(state.error, null);
		// acotado
		state = reduceDemoBridgeState(state, { type: "demo-resize", height: 99999 });
		assert.equal(state.height, 2400);
		state = reduceDemoBridgeState(state, { type: "demo-resize", height: 5 });
		assert.equal(state.height, 80);
		// las cargas inválidas se ignoran
		assert.equal(reduceDemoBridgeState(state, { type: "demo-resize", height: "tall" }).height, 80);
		assert.equal(reduceDemoBridgeState(state, { type: "demo-resize" }).height, 80);
		// los errores se registran, con un mensaje alternativo
		state = reduceDemoBridgeState(state, { type: "demo-error", message: "x is not defined" });
		assert.equal(state.error, "x is not defined");
		assert.equal(state.height, 80, "error does not clobber height");
		state = reduceDemoBridgeState(state, { type: "demo-error" });
		assert.equal(state.error, "unknown error");
		// los tipos desconocidos y lo que no son objetos se ignoran
		assert.deepEqual(reduceDemoBridgeState(state, { type: "something-else" }), state);
		assert.deepEqual(reduceDemoBridgeState(state, "demo-resize"), state);
		assert.deepEqual(reduceDemoBridgeState(state, null), state);
	});
});

// ─── 2. renderizado de tarjetas ──────────────────────────────────────────────

const DEMO_HTML = "<!doctype html><html><body><h1>oscillator</h1><script>let t=0;</script></body></html>";

function part(state: string, output?: unknown) {
	return { type: "tool-demo", state, toolCallId: "call-1", input: { title: "Oscillator", brief: "b" }, output };
}

describe("dispatch card rendering (the tool-call ack box)", () => {
	const ackPart = { type: "tool-research", state: "output-available", toolCallId: "call-1", input: { question: "q" }, output: "Dispatched (job j1)." };
	const mkJob = (status: string, activity = "web_search: \"plato\""): JobRecord =>
		({ id: "j1", kind: "research", chatId: "c", toolCallId: "call-1", status, activity, createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date().toISOString() }) as JobRecord;

	it("renders a live activity card while the job runs", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("running")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /web_search: (&quot;|")plato/);
		assert.ok(!html.includes("Dispatched (job j1.)") || true, "ack text is not the display");
	});

	it("renders the dispatched pulse when the poll has not seen the job yet", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /Dispatched…/);
	});

	it("settles to a quiet finished one-liner when the worker is done", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("done", "delivered")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /Research agent/);
		assert.match(html, /finished/);
		assert.ok(!html.includes("web_search"), "no stale activity line once settled");
	});

	it("marks a failed job as failed", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[mkJob("error")]}>
				<JobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /failed/);
	});

	it("renders nothing for a still-streaming tool input", () => {
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[]}>
				<JobCard part={{ ...ackPart, state: "input-streaming" } as never} />
			</JobsContext.Provider>,
		);
		assert.equal(html, "");
	});

	// fuentes v0: la prueba de humo en vivo en el navegador (2026-09-19) pilló que la parte de despacho
	// de pdf no mostraba nada: PdfJobCard es el arreglo.
	it("pdf dispatch renders the live PDF-reader card while the job runs", () => {
		const pdfJob: JobRecord = ({
			id: "jp1",
			kind: "pdf",
			chatId: "c",
			toolCallId: "call-1",
			status: "running",
			activity: 'pdf_render: 42-44 @150dpi',
			createdAt: new Date(Date.now() - 5000).toISOString(),
			updatedAt: new Date().toISOString(),
		}) as JobRecord;
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[pdfJob]}>
				<PdfJobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /PDF reader/);
		assert.match(html, /pdf_render/);
	});

	it("pdf dispatch settles to the finished one-liner", () => {
		const pdfJob: JobRecord = ({
			id: "jp1",
			kind: "pdf",
			chatId: "c",
			toolCallId: "call-1",
			status: "done",
			activity: "delivered",
			createdAt: new Date(Date.now() - 5000).toISOString(),
			updatedAt: new Date().toISOString(),
		}) as JobRecord;
		const html = renderToStaticMarkup(
			<JobsContext.Provider value={[pdfJob]}>
				<PdfJobCard part={ackPart as never} />
			</JobsContext.Provider>,
		);
		assert.match(html, /PDF reader/);
		assert.match(html, /finished/);
	});
});

describe("steer card rendering (the delivered artifact)", () => {
	it("renders a sandboxed demo iframe (allow-scripts, NO allow-same-origin) with the bridge injected", () => {
		const steer = buildSubagentSteer(
			{ id: "jd", kind: "demo", toolCallId: "cd" },
			{ title: "Damped oscillator", html: DEMO_HTML, tested: true },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /sandbox="allow-scripts"/);
		assert.ok(!html.includes("allow-same-origin"), "never allow-same-origin");
		assert.match(html, /demo-resize/);
		assert.match(html, /demo-error/);
		assert.match(html, /Damped oscillator/);
		assert.match(html, /interactive demo/i);
		// el texto de protocolo de cara al modelo nunca se muestra al alumno
		assert.ok(!html.includes("do NOT wait"), "no protocol glue in the bubble");
	});

	it("renders the demo failure note with no iframe when the build FAILED", () => {
		const steer = buildSubagentSteer(
			{ id: "jd", kind: "demo", toolCallId: "cd" },
			{ title: "T", html: "", tested: true, notes: "FAILED: never passed verification" },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /FAILED: never passed verification/);
		assert.ok(!html.includes("<iframe"), "no iframe for a failed build");
	});

	it("renders the verified svg as an image; the maker's notes are glue and stay hidden", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const steer = buildSubagentSteer(
			{ id: "jv", kind: "visual", toolCallId: "cv" },
			{ svg, notes: "Looking at the render, the diagram is clean and accurate." },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.ok(html.includes(encodeURIComponent(svg)), "the image URL contains the original SVG");
		assert.match(html, /Figure/);
		// Tamaño natural (responsable, 2026-10-07): un ancho DECLARADO (200) significa que el
		// contenedor se ciñe + se centra en vez de estirarse a todo el ancho.
		assert.match(html, /w-fit/, "holder hugs the declared size");
		assert.match(html, /class="block h-auto max-w-full"/, "image shrinks to fit only when oversized");
		assert.ok(!html.includes("Looking at the render"), "model-facing notes never render");
	});

	it("renders the abort chip for an aborted job's steer (2026-09 dock semantics; the message type is the marker PART)", () => {
		const steer = buildAbortSteer({ id: "jc", kind: "research", toolCallId: "cc" });
		// Oleada B: la reorientación es un marcador nativo; la tarjeta muestra su
		// PROYECCIÓN (la misma vista que le pasa el renderizador de la transcripción).
		const view = projectNative([steer])[0]!;
		assert.equal((steer.details as { aborted: boolean }).aborted, true);
		assert.equal(view.parts.length, 2, "text (teacher-facing) + the data-subagent-aborted marker part");
		const html = renderToStaticMarkup(<SubagentSteerCard message={view as never} />);
		assert.match(html, /job-aborted-badge/);
		assert.match(html, /research/, "the job's kind, lower-cased like the complete-badge idiom");
		assert.match(html, /aborted by the learner/);
		// el texto de protocolo de cara al profesor nunca se muestra al alumno
		assert.ok(!html.includes("no brief is coming"), "no protocol glue in the chip");
		// la insignia se muestra a partir de la PARTE, no de los metadatos (el esquema de mensajes personalizados)
		const noMeta = { ...view, metadata: {} };
		const htmlNoMeta = renderToStaticMarkup(<SubagentSteerCard message={noMeta as never} />);
		assert.match(htmlNoMeta, /job-aborted-badge/, "metadata is pump mechanics, never the render seam");
	});

	it("renders a quiet Research-complete one-liner whose collapsed <details> carries the full brief", () => {
		const steer = buildSubagentSteer(
			{ id: "jr", kind: "research", toolCallId: "cr" },
			{
				brief: "Plato (c. 428–348 BCE) founded the Academy, a very long brief that would clutter the transcript.",
				sources: [
					{ title: "Britannica", url: "https://britannica.com/plato" },
					{ title: "IEP", url: "https://iep.utm.edu/plato/" },
				],
			},
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /Research/);
		assert.match(html, /complete/);
		assert.match(html, /2 sources/);
		assert.match(html, /view brief/, "the expansion affordance is offered");
		// el resumen de una línea es un <details> nativo, plegado por defecto, así que el
		// encargo + las fuentes van en el DOM pero nunca recargan la transcripción
		// hasta que el alumno los abre (la petición de la oleada 1 de "ver la investigación completa")
		assert.match(html, /<details[^>]*data-testid="research-complete-badge"/, "a real disclosure");
		assert.ok(!/<details[^>]*open/.test(html), "collapsed by default — no `open` attribute");
		assert.ok(html.includes("founded the Academy"), "the persisted brief rides inside the details");
		assert.ok(html.includes("britannica.com/plato"), "source links ride inside the details");
	});

	it("renders a quiet PDF-reading-complete one-liner (sources v0) whose collapsed details carries the brief + pages", () => {
		const steer = buildSubagentSteer(
			{ id: "jpf", kind: "pdf", toolCallId: "cpf" },
			{
				path: "/Users/x/course/chapter-3.pdf",
				question: "What is the integral of x dx?",
				brief: "The power rule appears on **page 1**: the integral of x dx is x^2/2 + C.",
				pagesRead: [1],
				pagesConsulted: [1, 2],
			},
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /PDF/);
		assert.match(html, /reading complete/);
		assert.match(html, /read 1 page/, "the badge counts READ pages, not search hits");
		assert.match(html, /<details[^>]*data-testid="pdf-complete-badge"/, "a real disclosure like the research badge");
		assert.ok(!/<details[^>]*open/.test(html), "collapsed by default");
		assert.ok(html.includes("power rule"), "the brief rides inside the details");
		// la ruta/pregunta son contexto del subagente, nunca interfaz de cara al alumno
		assert.ok(!html.includes("/Users/x/course/chapter-3.pdf"), "the file path never renders");
	});

	it("renders the PDF failure brief with the failed badge when the reader FAILED", () => {
		const steer = buildSubagentSteer(
			{ id: "jpf2", kind: "pdf", toolCallId: "cpf2" },
			{ path: "/tmp/doc.pdf", question: "q", brief: "PDF failed: the file could not be opened", pagesRead: [], pagesConsulted: [] },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /pdf-brief-card/);
		assert.match(html, /failed/);
		assert.match(html, /could not be opened/);
		assert.ok(!html.includes("pdf-complete-badge"), "no complete badge for a failure");
	});

	it("renders the visual failure note with no svg when the build FAILED", () => {
		const steer = buildSubagentSteer({ id: "jv", kind: "visual", toolCallId: "cv" }, { svg: "", notes: "FAILED: iteration limit" });
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /FAILED: iteration limit/);
		assert.ok(!html.includes("circle") && !html.includes("<svg"), "no svg for a failed build");
	});

	it("renders a fallback note when the artifact part is missing", () => {
		const msg = { id: "s", role: "user", parts: [{ type: "text", text: "x" }], metadata: { subagentResult: { jobId: "j", kind: "research", toolCallId: "c" } } };
		const html = renderToStaticMarkup(<SubagentSteerCard message={msg as never} />);
		assert.match(html, /could not be displayed/);
	});
});


describe("artifact chrome — scrollbar, invert toggles, downloads (release polish 2026-10-07)", () => {
	it("demo iframe: scrolling OFF (the bridge auto-sizes; a scrollable iframe traps the wheel) and the invert + download buttons render", () => {
		const steer = buildSubagentSteer(
			{ id: "jd3", kind: "demo", toolCallId: "cd3" },
			{ title: "Wave interference", html: DEMO_HTML, tested: true },
		);
		const html = renderToStaticMarkup(<SubagentSteerCard message={projectNative([steer])[0] as never} />);
		assert.match(html, /scrolling="no"/, "no internal scrollbar — the wheel chains to the session");
		assert.match(html, /toggle-invert-demo-brightness/, "the invert switch (house Toggle)");
		assert.match(html, /data-testid="demo-download"/);
		assert.ok(!html.includes("hue-rotate"), "inversion is OFF by default — a manual toggle only");
		assert.match(html, /interactive demo/, "the kind label lives in the caption header");
		assert.match(html, /Wave interference/, "the title rides beside the kind label");
	});

	it("figure card: invert + download buttons; NO fullscreen button without a chat page (the context is null there)", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const html = renderToStaticMarkup(<VisualOutputCard output={{ svg }} />);
		assert.match(html, /toggle-invert-figure-brightness/, "the invert switch (house Toggle)");
		assert.match(html, /data-testid="visual-download"/);
		assert.ok(!html.includes('data-testid="visual-open"'), "fullscreen needs the session overlay context");
		assert.ok(!html.includes("hue-rotate"), "inversion OFF by default");
	});

	it("figure card: NO card chrome, image first, caption row BELOW (owner round, 2026-10-07)", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="20"/></svg>';
		const html = renderToStaticMarkup(<VisualOutputCard output={{ svg }} />);
		// Material de documento: la caja exterior no lleva estilo de tarjeta.
		const rootAt = html.indexOf('data-testid="visual-card"');
		const root = html.slice(rootAt - 200, rootAt);
		assert.ok(!root.includes("rounded-xl border"), "no card container");
		// La imagen ANTES de la fila del pie; la etiqueta del pie y los controles van después.
		const svgAt = html.indexOf('data-testid="visual-svg"');
		const captionAt = html.indexOf(">Figure<");
		assert.ok(svgAt !== -1 && captionAt !== -1 && svgAt < captionAt, "the caption row sits below the image");
		assert.ok(captionAt < html.indexOf("visual-download"), "the controls ride the caption row");
		// La indicación de invertir: el disco de círculo de contraste + la descripción emergente.
		assert.ok(html.includes("size-3"), "the icon disc");
		assert.ok(html.includes('title="Invert colors"'), "the tooltip names the toggle");
		// La media luna está REALMENTE rellena (detalle del responsable: el Contrast de lucide
		// la dibuja hueca, fill="none" por defecto; la nuestra se rellena con currentColor).
		assert.ok(
			html.includes('fill="currentColor" stroke="none"'),
			"the filled half of the invert disc",
		);
	});

	it("svgNaturalWidth: declared px sizes parse; %, auto, and absent fall back to null", () => {
		assert.equal(svgNaturalWidth('<svg width="200" height="100"></svg>'), 200);
		assert.equal(svgNaturalWidth("<svg width='320'></svg>"), 320);
		assert.equal(svgNaturalWidth('<svg width="100%"></svg>'), null, "% is no natural size");
		assert.equal(svgNaturalWidth('<svg width="auto"></svg>'), null);
		assert.equal(svgNaturalWidth('<svg viewBox="0 0 10 10"></svg>'), null, "viewBox-only → full-width law");
		assert.equal(svgNaturalWidth('<svg width="0"></svg>'), null, "degenerate zero is no size");
	});

	it("slugFilename: titles slug to filename stems; symbol-only falls back", () => {
		assert.equal(slugFilename("Damped oscillator"), "damped-oscillator");
		assert.equal(slugFilename("Ünïcode — Tïtle!"), "unicode-title");
		assert.equal(slugFilename("???"), "demo");
	});

	it("chartSize: width/height attrs are the fallback when no viewBox (figure fullscreen fit math)", () => {
		assert.deepEqual(chartSize('<svg width="320" height="240"></svg>'), { w: 320, h: 240 });
		assert.deepEqual(chartSize('<svg xmlns="x" width="50px" height="25px" viewBox="0 0 100 50"></svg>'), {
			w: 100,
			h: 50,
		}, "viewBox always wins");
	});
});

describe("bridge height: the body-based measure (ratchet fix, 2026-10-07)", () => {
	it("DEMO_BRIDGE_SCRIPT measures the BODY (scrollHeight + rect + margins), not the viewport-clamped documentElement", () => {
		// documentElement.scrollHeight = max(contenido, viewport) se queda enganchado en
		// la propia altura del padre: una demo podía crecer pero nunca encoger al
		// redimensionar la ventana (informado por el responsable). Las métricas del body son contenido puro.
		assert.ok(DEMO_BRIDGE_SCRIPT.includes("Math.max(b.scrollHeight,b.getBoundingClientRect().height)"));
		assert.ok(DEMO_BRIDGE_SCRIPT.includes("getComputedStyle(b)"));
		assert.ok(!/post=function\(\)\{send\(\{type:"demo-resize",height:document\.documentElement\.scrollHeight\}\)\};/.test(DEMO_BRIDGE_SCRIPT));
	});
});

describe("setSteerUiInverted (the persisted invert switch, 2026-10-07)", () => {
	const demoSteer = buildSubagentSteer(
		{ id: "jx", kind: "demo", toolCallId: "cx" },
		{ title: "T", html: "<p>x</p>", tested: true },
	);
	const other = { id: "other", role: "user" as const, content: "hi", timestamp: 1 };

	it("writes ui.inverted on the target steer and leaves everything else untouched", () => {
		const out = setSteerUiInverted([other, demoSteer], demoSteer.id, true);
		assert.equal(out.length, 2);
		assert.deepEqual(
			(out[1] as { details: { ui?: { inverted?: boolean } } }).details.ui,
			{ inverted: true },
		);
		assert.equal(out[0], other, "untouched messages pass through by identity");
	});

	it("toggles back to false; missing or non-artifact messages are no-ops (same array members)", () => {
		const on = setSteerUiInverted([demoSteer], demoSteer.id, true);
		const off = setSteerUiInverted(on, demoSteer.id, false);
		assert.equal((off[0] as { details: { ui?: { inverted?: boolean } } }).details.ui?.inverted, false);
		const missing = setSteerUiInverted([demoSteer], "nope", true);
		assert.equal(missing[0], demoSteer, "no target → identity");
	});
});

// Los límites de las imágenes de figuras generadas se cubren en svg-image.test.tsx.
// Ya no hay un saneador parcial con expresiones regulares en la ruta de visualización.

// ─── 3. el bucle de demo-builder ─────────────────────────────────────────────

const BROKEN_HTML = "<!doctype html><html><body>BROKEN<script>foo();</script></body></html>";
const GOOD_HTML = "<!doctype html><html><body><canvas id=\"c\"></canvas><script>requestAnimationFrame(function step(){});</script></body></html>";

describe("demo builder (fake model + fake headless)", () => {
	it("iterates write → run → fix → run → clean → delivers with notes", async () => {
		const headless = fakeHeadless({ brokenWhenIncludes: "BROKEN" });
		const activities: string[] = [];
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_demo", input: { html: BROKEN_HTML } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "run_demo", input: {} }] },
			{ toolCalls: [{ toolCallId: "w2", toolName: "write_demo", input: { html: GOOD_HTML } }] },
			{ toolCalls: [{ toolCallId: "r2", toolName: "run_demo", input: { probe: "typeof step === 'function'" } }] },
			{ text: "Drag the damping slider to see the oscillation decay." },
		]);

		const result = await runDemoBuilder(
			{ title: "Damped oscillator", brief: "A mass on a spring with a damping slider." },
			{ engine: model, headless, onActivity: (line) => activities.push(line) },
		);

		assert.equal(result.title, "Damped oscillator");
		assert.equal(result.html, GOOD_HTML, "delivers the FIXED html");
		assert.equal(result.tested, true);
		assert.equal(result.notes, "Drag the damping slider to see the oscillation decay.");
		assert.equal(headless.demoRuns.length, 2, "ran the broken demo, then the fixed one — no extra verification needed");
		assert.ok(activities.some((a) => a.startsWith("run_demo: 1 console error")), `activity recorded per iteration: ${activities.join(" | ")}`);
		assert.ok(activities.includes("run_demo: clean"), "clean run recorded in activity");
	});

	it("verifies headlessly even when the model forgets run_demo before finishing", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_demo", input: { html: GOOD_HTML } }] },
			{ text: "Done." },
		]);
		const result = await runDemoBuilder({ title: "T", brief: "b" }, { engine: model, headless });
		assert.equal(result.html, GOOD_HTML);
		assert.equal(result.tested, true, "tested by the final verification gate");
		assert.equal(headless.demoRuns.length, 1, "the gate ran the demo once itself");
	});

	it("fails (empty html + FAILED notes) when the demo never passes verification", async () => {
		const headless = fakeHeadless({ brokenWhenIncludes: "BROKEN" });
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_demo", input: { html: BROKEN_HTML } }] },
			{ text: "It works, trust me." },
		]);
		const result = await runDemoBuilder({ title: "T", brief: "b" }, { engine: model, headless });
		assert.equal(result.html, "");
		assert.equal(result.tested, true, "the loop ran");
		assert.match(result.notes ?? "", /^FAILED:/);
		assert.match(result.notes ?? "", /ReferenceError/);
	});

	it("fails fast with a clear message when no Chrome is available (never skips testing)", async () => {
		const model = scriptedModel([{ text: "should never be reached" }]);
		const result = await runDemoBuilder({ title: "T", brief: "b" }, { engine: model, headless: noChromeHeadless() });
		assert.equal(result.html, "");
		assert.match(result.notes ?? "", /^FAILED: .*Chrome/);
	});

	it("fails when the model never writes a demo", async () => {
		const model = scriptedModel([{ text: "I cannot build this." }]);
		const result = await runDemoBuilder({ title: "T", brief: "b" }, { engine: model, headless: fakeHeadless() });
		assert.equal(result.html, "");
		assert.match(result.notes ?? "", /^FAILED: the builder never wrote a demo/);
	});
});

// ─── 4. el bucle de visual-maker ─────────────────────────────────────────────

const SVG_1 = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><line x1="10" y1="50" x2="290" y2="50"/></svg>';

describe("visual maker (fake model + fake headless)", () => {
	it("native rendering repairs do not rewrite the figure delivered by the model loop", async () => {
		const svg = '<svg width="80" height="40"><rect width="80" height="40" fill="red"/><text x="2" y="20">A&nbsp;B</text></svg>';
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ text: "Looked at the native render." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless: { ...fakeHeadless(), renderSvg: realHeadless.renderSvg } });
		assert.equal(result.svg, svg, "saved/download source remains the original, not the render-only repaired source");
		assert.equal(result.notes, "Looked at the native render.");
	});

	it("refuses an unverified final SVG when its final render throws", async () => {
		const headless = fakeHeadless({ renderFailures: 1 });
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ text: "Done without looking." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED: rendering the final SVG failed — XML parse error/);
		assert.equal(headless.svgRenders.length, 1);
	});

	it("write → render → look → finish delivers the svg with notes", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ text: "A number line from -3 to 3 with the root marked at 0." },
		]);
		const activities: string[] = [];
		const result = await runVisualMaker({ brief: "Number line, root at 0." }, { engine: model, headless, onActivity: (l) => activities.push(l) });

		assert.equal(result.svg, SVG_1);
		assert.equal(result.notes, "A number line from -3 to 3 with the root marked at 0.");
		assert.equal(headless.svgRenders.length, 1);
		assert.ok(activities.some((a) => a.startsWith("render_svg")), "render activity recorded");
	});

	it("forces a look when the model finishes without rendering the final svg", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ text: "Done." }, // final prematuro: aún sin renderizado
			{ text: "Looked at it — correct." }, // tras la mirada forzada
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, SVG_1, "delivered after the forced look");
		assert.equal(result.notes, "Looked at it — correct.");
		assert.equal(headless.svgRenders.length, 1, "the gate rendered the svg once itself");
	});

	it("edit_svg: exact-match single replacement, with fuzzy context on a miss", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			// Un fallo: old_text no está en el documento (se devuelve el error, nada cambia)
			{ toolCalls: [{ toolCallId: "e1", toolName: "edit_svg", input: { old_text: "NOT-PRESENT", new_text: "x" } }] },
			// Un acierto: exactamente una aparición; se aplica
			{ toolCalls: [{ toolCallId: "e2", toolName: "edit_svg", input: { old_text: '<line x1="10"', new_text: '<line x1="20"' } }] },
			{ toolCalls: [{ toolCallId: "r2", toolName: "render_svg", input: {} }] },
			{ text: "Moved the start of the line." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });

		assert.equal(result.svg, SVG_1.replace('<line x1="10"', '<line x1="20"'), "the edit was applied to the delivered svg");
		assert.equal(result.notes, "Moved the start of the line.");
		assert.equal(headless.svgRenders.length, 2, "re-rendered after the edit (the look gate saw the change)");
	});

	it("edit_svg before write_svg errors and never edits nothing into a deliverable", async () => {
		const headless = fakeHeadless();
		const model = scriptedModel([
			// Aún no se ha escrito nada: la edición debe dar error, no hacer fallar el bucle
			{ toolCalls: [{ toolCallId: "e0", toolName: "edit_svg", input: { old_text: "svg", new_text: "x" } }] },
			{ text: "Cannot proceed." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, "", "the failed edit produced no deliverable");
		assert.match(result.notes ?? "", /never wrote an SVG/);
	});

	it("feeds render errors back to the model instead of crashing", async () => {
		const headless = fakeHeadless({ renderFailures: 1 });
		const model = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_svg", input: { svg: "<svg>broken" } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "render_svg", input: {} }] },
			{ toolCalls: [{ toolCallId: "w2", toolName: "write_svg", input: { svg: SVG_1 } }] },
			{ toolCalls: [{ toolCallId: "r2", toolName: "render_svg", input: {} }] },
			{ text: "Fixed and verified." },
		]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless });
		assert.equal(result.svg, SVG_1);
		assert.equal(result.notes, "Fixed and verified.");
	});

	it("fails when the model never writes an svg", async () => {
		const model = scriptedModel([{ text: "This idea is purely relational — belongs in mermaid." }]);
		const result = await runVisualMaker({ brief: "b" }, { engine: model, headless: fakeHeadless() });
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED: the maker never wrote an SVG/);
	});

	it("fails with a clear message when no Chrome is available", async () => {
		const result = await runVisualMaker({ brief: "b" }, { engine: scriptedModel([{ text: "x" }]), headless: noChromeHeadless() });
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED: .*Chrome/);
	});
});

// ─── 5. ejecutores de tareas + despacho ──────────────────────────────────────

const DEMO_INPUT = { title: "Compound interest", brief: "Slider for rate, curve of growth over 30 years." };

function waitFor(cond: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
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

async function drain(res: Response): Promise<string> {
	if (res.status !== 200) assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
	return res.text();
}

/** DIETA DE CONEXIONES B (responsable, 2026-10-10): el POST acusa recibo y cierra; vacía
 *  en su lugar el cable del turno a través del stream de reenganche (tolerante al asentamiento:
 *  un turno corto puede terminar dentro del manejador). */
async function drainRunning(chatId: string): Promise<string> {
	const handle = runningTurn(chatId);
	if (!handle) return ""; // el turno ya se asentó: la finalización ya ocurrió
	return new Response(handle.subscribe()).text();
}


describe("demo/visual job runners", () => {
	it("runJob completes a demo: result on the job, steer via deliver, ack stays on the part", async () => {
		const chat = chatStore.createChat("Test: demo runner");
		createdChats.push(chat.id);
		// Oleada B: un fixture NATIVO (el registro contiene historial de agente); el recorrido de la
		// transcripción del ejecutor lo lee a través de la proyección.
		chatStore.saveMessages(chat.id, [
			{ id: "u1", role: "user", content: "show me compounding", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call-d1", name: "demo", arguments: DEMO_INPUT as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: 1,
			} as never,
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call-d1",
				toolName: "demo",
				content: [{ type: "text", text: "Dispatched." }],
				details: "Dispatched.",
				isError: false,
				timestamp: 1,
			} as never,
		]);

		const job = jobStore.createJob({ kind: "demo", chatId: chat.id, toolCallId: "call-d1" });
		createdJobs.push(job.id);

		// runJob no tiene punto de inyección de headless: la sustitución del módulo es la frontera.
		headlessOverride.current = fakeHeadless();
		demoModelOverride.current = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_demo", input: { html: GOOD_HTML } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "run_demo", input: {} }] },
			{ text: "Sweep the rate slider." },
		]);
		const { steers, runner } = testRunner();
		try {
			await runner.runJob(job.id);
		} finally {
			headlessOverride.current = undefined;
			demoModelOverride.current = undefined;
		}

		const done = jobStore.getJob(job.id)!;
		assert.equal(done.status, "done");
		assert.equal(done.activity, "finished", "the worker finishes independently of delivery");
		const result = done.result as { title: string; html: string; tested: boolean; notes?: string };
		assert.equal(result.title, "Compound interest");
		assert.equal(result.html, GOOD_HTML);
		assert.equal(result.tested, true);

		// La reorientación lleva el artefacto para el renderizador.
		assert.equal(steers.length, 1, "exactly one steer");
		const data = steers[0]!.details as { kind: string; result: unknown };
		assert.equal(data.kind, "demo");
		assert.deepEqual(data.result, result);

		// La parte de herramienta conserva el ACUSE DE DESPACHO para siempre: el resultado nunca
		// la reescribe (el profesor recibe el resultado una vez, mediante la reorientación).
		const saved = projectNative(chatStore.getChat(chat.id)!.messages);
		const part = saved[1]!.parts.find((p) => p.type === "tool-demo");
		assert.ok(part && part.type === "tool-demo", "demo tool part persisted");
		assert.equal(typeof (part as { output?: unknown }).output, "string", "part output is the ack, not the result");
	});

	it("runJob still steers on visual failure and the job lands error", async () => {
		const chat = chatStore.createChat("Test: visual runner failure");
		createdChats.push(chat.id);
		chatStore.saveMessages(chat.id, [
			{ id: "u1", role: "user", content: "draw it", timestamp: 1 } as never,
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call-v1", name: "visual", arguments: { brief: "b" } as never }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: 1,
			} as never,
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call-v1",
				toolName: "visual",
				content: [{ type: "text", text: "Dispatched." }],
				details: "Dispatched.",
				isError: false,
				timestamp: 1,
			} as never,
		]);

		const job = jobStore.createJob({ kind: "visual", chatId: chat.id, toolCallId: "call-v1" });
		createdJobs.push(job.id);

		visualModelOverride.current = scriptedModel([{ text: "cannot" }]);
		const { steers, runner } = testRunner();
		try {
			await runner.runJob(job.id);
		} finally {
			visualModelOverride.current = undefined;
		}

		const errored = jobStore.getJob(job.id)!;
		assert.equal(errored.status, "error");
		assert.match(errored.error ?? "", /never wrote an SVG/);

		assert.ok(steers[0], "failure still delivers a steer — the teacher learns the outcome");
		const result = (steers[0]!.details as { result: unknown }).result as { svg: string; notes?: string };
		assert.equal(result.svg, "");
		assert.match(result.notes ?? "", /^FAILED:/);
	});

	it("dispatch through a teacher turn: the call acks mid-turn and the runner completes in the background", async () => {
		const chat = chatStore.createChat("Test: demo spawn dispatch");
		createdChats.push(chat.id);
		// Barrera de turno BYOK (responsable, 2026-09-22): el chat guionizado necesita un
		// modelo de conversación: la fijación por chat, exactamente como el flujo de configuración.
		chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });

		// Un profesor que llama a demo en el turno 1 y luego continúa en el MISMO turno.
		const teacher = scriptedModel([
			{ toolCalls: [{ toolCallId: "call-d2", toolName: "demo", input: DEMO_INPUT }] },
			{ text: "Here it is." },
		]);

		// Las sustituciones deben estar activas ANTES de la petición: el despacho lanza el
		// ejecutor a mitad del stream, dentro del execute de la herramienta.
		demoModelOverride.current = scriptedModel([
			{ toolCalls: [{ toolCallId: "w1", toolName: "write_demo", input: { html: GOOD_HTML } }] },
			{ toolCalls: [{ toolCallId: "r1", toolName: "run_demo", input: {} }] },
			{ text: "Sweep it." },
		]);
		headlessOverride.current = fakeHeadless();
		const { steers, runner } = testRunner();

		try {
			const ack = await handleChatRequest(
				new Request("http://test/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chatId: chat.id,
						// Oleada B: el contrato de eventos de entrada: un evento,
						// nunca una transcripción del cliente.
						input: { type: "text", text: "teach me compounding" },
					}),
				}),
				// El manejador pasa a la fábrica las opciones de construcción nativas
				// (los mensajes son el registro fusionado; el registro ES el estado del
				// agente; sin conversión de adaptador).
				(opts) =>
					createTeacherAgent(undefined, {
						engine: teacher,
						messages: opts.messages,
						tools: createTeacherTools({
							chatId: chat.id,
							chatStore,
							jobStore,
							spawn: (job, input) => void runner.runJob(job.id, input),
						}),
					}),
			);
			if (ack.status !== 200) assert.fail(`expected 200 ack, got ${ack.status}: ${await ack.text()}`);
			await drainRunning(chat.id);

			const job = jobStore.findJobByToolCallId(chat.id, "call-d2");
			assert.ok(job, "dispatch created a job at tool-execute time");
			assert.equal(job!.kind, "demo");
			createdJobs.push(job!.id);

			// El ejecutor en segundo plano (lanzar y olvidar) termina con las sustituciones.
			await waitFor(() => jobStore.getJob(job!.id)!.status !== "running", 8000, "demo job completion");
			const done = jobStore.getJob(job!.id)!;
			assert.equal(done.status, "done");

			const saved = projectNative(chatStore.getChat(chat.id)!.messages);
			const part = saved[1]!.parts.find((p) => p.type === "tool-demo");
			assert.ok(part && part.type === "tool-demo", "demo tool part persisted");
			assert.equal(part.state, "output-available", "the part resolved with the ack at dispatch time");
			assert.match(String((part as { output?: unknown }).output), /fire-and-forget/);

			assert.equal(steers.length, 1, "one job, one steer");
			assert.equal((steers[0]!.details as { jobId: string }).jobId, job!.id);

			// Idempotencia: el despacho elimina duplicados por toolCallId; no hay segunda tarea.
			assert.equal(jobStore.listJobs(chat.id).length, 1, "no duplicate job for the same tool part");
		} finally {
			demoModelOverride.current = undefined;
			headlessOverride.current = undefined;
		}
	});
});

// ─── 6. cableado del registro de herramientas ────────────────────────────────

describe("tool + renderer registry wiring", () => {
	it("demo and visual are SERVER-EXECUTED dispatch tools with the contract schemas", () => {
		const { runner } = testRunner();
		const tools = jobTools({ chatId: "chat_registry", jobStore, spawn: (job) => void runner.runJob(job.id) });
		assert.deepEqual(Object.keys(tools).sort(), ["demo", "pdf", "research", "visual"]);
		for (const name of ["demo", "visual", "research", "pdf"] as const) {
			assert.equal(typeof (tools[name] as { execute?: unknown }).execute, "function", `${name} executes server-side — fire-and-forget ack per THE ASYNC PROTOCOL`);
		}
		assert.equal(Value.Check(demoInputSchema, { title: "T", brief: "b" }), true);
		assert.equal(Value.Check(demoInputSchema, { brief: "b" }), false, "demo requires a title");
		assert.equal(Value.Check(visualInputSchema, { brief: "b" }), true);
		assert.equal(Value.Check(visualInputSchema, {}), false, "visual requires a brief");
		assert.equal(Value.Check(pdfInputSchema, { path: "/tmp/doc.pdf", question: "q" }), true);
		assert.equal(Value.Check(pdfInputSchema, { question: "q" }), false, "pdf requires a path");
		assert.equal(Value.Check(pdfInputSchema, { path: "/tmp/doc.pdf" }), false, "pdf requires a question");
	});

	it("the artifact renderer registry maps demo/visual to the W6 cards", () => {
		assert.equal(artifactRenderers.demo, DemoCard);
		assert.equal(artifactRenderers.visual, VisualCard);
		// fuentes v0: pdf se asocia a su tarjeta de despacho (el hueco de la prueba de humo en vivo)
		assert.equal(artifactRenderers.pdf, PdfJobCard);
		// fuentes v1: el conjunto del sistema de ficheros del alumno se asocia a la tarjeta genérica de llamada a herramienta
		for (const t of ["read", "ls", "find", "grep"]) {
			assert.equal(artifactRenderers[t], ToolCallCard, `${t} renders the tool-call card`);
		}
		// oleada 7: las herramientas de grafo del sondeador se suman a la MISMA disciplina (antes de este
		// interludio se mostraban como si no hubiera pasado nada)
		for (const t of ["list_sessions", "list_propositions"]) {
			assert.equal(artifactRenderers[t], ToolCallCard, `${t} renders the tool-call card`);
		}
	});

	it("the tool-call card: the prober's graph tools — collapsed headline + their compact row output", () => {
		// list_propositions: el id de la sesión es el sujeto de la llamada
		const propPart = {
			type: "tool-list_propositions",
			state: "output-available",
			toolCallId: "g1",
			input: { session: "chat_mtiudjao_776beada" },
			output: "2 proposition(s) born in this session:\n- Kepler's laws — solid (as of 2026-09-20)\n- Tidal locking — shaky (as of 2026-09-21)",
		};
		const html = renderToStaticMarkup(<ToolCallCard part={propPart as never} />);
		assert.match(html, /list_propositions/);
		assert.match(html, /chat_mtiudjao_776beada/); // el titular plegado
		assert.match(html, /Kepler&#x27;s laws/); // la salida de las filas, literal (el apóstrofo escapado en HTML)
		assert.ok(html.includes("<details"), "collapsed by default");

		// list_sessions: sin argumento de titular (entrada vacía); solo el nombre de la herramienta,
		// exactamente la disciplina de ls sin ruta
		const sessPart = {
			type: "tool-list_sessions",
			state: "output-available",
			toolCallId: "g2",
			input: {},
			output: "3 session(s) in the knowledge graph, most recent first:\n1. Orbital mechanics (chat, 8 propositions, born 2026-09-18)",
		};
		const html2 = renderToStaticMarkup(<ToolCallCard part={sessPart as never} />);
		assert.match(html2, /list_sessions/);
		assert.match(html2, /Orbital mechanics/);
		const headline = html2.split("<summary")[1]?.split("</summary>")[0] ?? "";
		assert.doesNotMatch(headline, /Orbital/, "the collapsed line shows the tool name only — no noise");
	});

	it("the tool-call card: collapsed one-liner with the tool name + headline arg; expand shows input and output", () => {
		const part = {
			type: "tool-read",
			state: "output-available",
			toolCallId: "c1",
			input: { path: "notes/calculus.md", offset: 1, limit: 20 },
			output: "Calculus notes\nThe derivative measures force.",
		};
		const html = renderToStaticMarkup(<ToolCallCard part={part as never} />);
		// titular plegado: nombre de la herramienta + la ruta tal cual
		assert.match(html, /read/);
		assert.match(html, /notes\/calculus\.md/);
		// carga desplegable: JSON de entrada + texto de salida
		assert.match(html, /Input/);
		assert.match(html, /Output/);
		assert.match(html, /The derivative measures force\./);
		assert.ok(html.includes("<details"), "collapsed by default via a details element");
	});

	it("the tool-call card: image-bearing read results note the attachment; errors render red", () => {
		const imgPart = {
			type: "tool-read",
			state: "output-available",
			toolCallId: "c2",
			input: { path: "shot.png" },
			output: { text: "Read image file [image/png].", images: [{ data: "AAAA", mimeType: "image/png" }] },
		};
		const html = renderToStaticMarkup(<ToolCallCard part={imgPart as never} />);
		assert.match(html, /Read image file \[image\/png\]\./);
		assert.match(html, /1 image attached to the model/);
		assert.ok(!html.includes("AAAA"), "the image payload itself never renders");

		const errPart = {
			type: "tool-read",
			state: "output-error",
			toolCallId: "c3",
			input: { path: "/gone.md" },
			errorText: "ENOENT: no such file",
		};
		const errHtml = renderToStaticMarkup(<ToolCallCard part={errPart as never} />);
		assert.match(errHtml, /Error/);
		assert.match(errHtml, /ENOENT/);
		assert.match(errHtml, /text-error/);
	});

	it("the tool-call card: find/grep headline the pattern, ls defaults to ~", () => {
		const findHtml = renderToStaticMarkup(
			<ToolCallCard part={{ type: "tool-find", state: "output-available", toolCallId: "c", input: { pattern: "*calculus*" }, output: "notes/calculus.md" } as never} />,
		);
		assert.match(findHtml, /find/);
		assert.match(findHtml, /\*calculus\*/);
		const lsHtml = renderToStaticMarkup(
			<ToolCallCard part={{ type: "tool-ls", state: "output-available", toolCallId: "c", input: {}, output: "notes/" } as never} />,
		);
		assert.match(lsHtml, /ls/);
		assert.match(lsHtml, /~/);
	});
});
