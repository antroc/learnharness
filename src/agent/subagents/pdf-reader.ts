import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message, ToolResultMessage, Usage, Tool } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { processImage, type ProcessImageResult } from "../image-processing/index.ts";
import { Type } from "typebox";
import { resolveSourcePath } from "../tools/fs-shared.ts";
import { piEngineFor, type PiEngine, type ThinkingLevel } from "../models.ts";
import { providerEventObserver, type ProviderEventObserver } from "../provider-events.ts";
import { backgroundCaptureStream, createBackgroundCapture, type BackgroundCapture } from "../background-capture.ts";
import { workerRequestStream } from "../worker-request-admission.ts";
import type { PdfResult, PdfToolInput } from "../../core/contracts.ts";
import { getHeadless, type HeadlessApi } from "./headless.ts";
import { pdfExtract, pdfInfo, pdfProbe, pdfSearch, type PdfSearchHit } from "./pdf-ops.ts";

/**
 * El subagente pdf-reader (sources v0, 2026-09): lee un PDF aportado por el
 * alumno en nombre del profesor, con un bucle hecho a mano como el del
 * visual-maker (la imagen dentro del bucle no puede ir por la fontanería de
 * execute de las herramientas: las páginas renderizadas se muestran a los ojos
 * de ESTE agente y nunca se entregan más allá; decisión del usuario).
 *
 * Prompt de sistema = la doctrina de lectura de la skill pdf-reader, con la
 * estrategia tal cual: clasificar PRIMERO con pdf_info y después aplicar una
 * estrategia según el tamaño: los PDF cortos renderizan todas las páginas, los
 * medianos renderizan las páginas marcadas (con muchas matemáticas o imágenes)
 * y los largos hacen búsquedas concretas antes de leer nada a fondo.
 *
 * Su texto final ES el informe (al estilo del researcher), con citas (p. N);
 * runPdfJob lo envuelve en un PdfResult con las pagesConsulted que lleva el bucle.
 */

const INSTRUCTIONS = `You are a PDF reading specialist. You work for a teacher agent inside a learning
application: given a PDF path and a question, read the document on the teacher's behalf and
produce a focused brief that the teacher can teach from, with page citations.

You operate in an isolated context. The task gives you the PDF path and the question — that is
everything you know.

Reading doctrine — always in this order:
1. TRIAGE FIRST: call pdf_info. It returns page count plus per-page signals (text_length,
   image_count, math_density). Never read or render anything before this.
2. Pick a strategy by document size:
   - SHORT (≤ 10 pages): extract the full text; render every page that has meaningful
     math_density or images (you read equations and diagrams visually, not as extracted text).
   - MEDIUM (11-40 pages): extract promising pages; render only flagged pages (math- or
     image-heavy, or where extraction looks thin).
   - LONG (> 40 pages): pdf_search for the question's key terms first; extract and render only
     the pages that hit. Never read a long document front-to-back.
3. When the extracted text of a page looks math- or diagram-heavy, or garbled, RENDER that
   page and read it visually before drawing conclusions from it.
4. Render DPI guidance: 100 for text-dominant pages, 150 the default, 200 for dense small
   print (math details, fine diagrams).

Tool outputs may be error strings (file unreadable, invalid regex, no hits). Adapt: narrow the
page spec, change the query, lower DPI. If the document genuinely cannot answer the question,
say so in the brief instead of inventing content.

Your FINAL assistant message is your entire deliverable — it must stand alone, in this format:
2-6 sentences (or short sections) answering the teacher's question from the document, each
claim cited as (p. N). End with a line "Pages consulted: N, N, …" listing every page you
extracted or rendered.`;

const MAX_ITERATIONS = 14;
/** Páginas renderizadas por llamada a pdf_render: la skill renderiza de forma
 *  selectiva; un límite por lote impide que una llamada demasiado ansiosa
 *  inunde el contexto de visión. */
const RENDER_BATCH_CAP = 6;
/** Tope de la salida de extract: mejor acotar la especificación que volcar un libro. */
const EXTRACT_CAP = 24_000;

export interface PdfReaderOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	headless?: HeadlessApi;
	maxIterations?: number;
	/** Depuración: clave de grabación de eventos en bruto del proveedor (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

export interface PdfReaderInput extends PdfToolInput {}

/** Las declaraciones que van por la red (Tool de pi-ai, parámetros TypeBox).
 *  Este bucle se encarga él mismo de la ejecución: pdf_info/pdf_extract se
 *  ejecutan con los cuerpos simples pdfInfoText/pdfExtractText de más abajo y
 *  pdf_search/pdf_render se despachan en línea dentro del bucle (las
 *  coincidencias de búsqueda deben sumarse al conjunto de citas; los
 *  renderizados alimentan el mensaje con la imagen en el bucle), así que las
 *  declaraciones no llevan execute. dpi/context_lines/literal trasladan los
 *  antiguos `.default()` de zod como descripciones del esquema + rellenos ??
 *  en el bucle (el bucle los lee con numOr). */
export function createPdfTools(_pdfPath: string): Record<string, Tool> {
	return {
		pdf_info: {
			name: "pdf_info",
			description: "Metadata + per-page triage signals for the PDF (page count, text length, image count, math density). ALWAYS call this first.",
			parameters: Type.Object({}),
		},
		pdf_extract: {
			name: "pdf_extract",
			description: "Extract text from pages (spec: 'all', '1-5', '1,3,7', '3'). Use pdf_info first; narrow the spec for big documents.",
			parameters: Type.Object({
				pages: Type.String({ description: "Page spec, e.g. 'all', '1-5', '1,3,7'" }),
			}),
		},
		pdf_render: {
			name: "pdf_render",
			description:
				"Render pages to images and show them to you for visual reading (equations, diagrams, layout). DPI: 100 text, 150 default, 200 dense small print. Max 6 pages per call.",
			parameters: Type.Object({
				pages: Type.String({ description: "Page spec, e.g. '1-3' or '2,5,8'" }),
				dpi: Type.Optional(
					Type.Integer({ minimum: 72, maximum: 300, description: "Render DPI (100 text / 150 default / 200 dense)" }),
				),
			}),
		},
		pdf_search: {
			name: "pdf_search",
			description: "Search the PDF's text by keyword or regex (case-insensitive); returns hits with context lines. Use for long documents before reading anything at length.",
			parameters: Type.Object({
				query: Type.String({ description: "Keyword or regex" }),
				context_lines: Type.Optional(
					Type.Integer({ minimum: 0, maximum: 8, description: "Context lines around each hit (default 3)" }),
				),
				literal: Type.Optional(Type.Boolean({ description: "true = treat the query literally (no regex; default false)" })),
			}),
		},
	};
}

/** El cuerpo de pdf_info (el destino de despacho del bucle): el resultado de la clasificación. */
async function pdfInfoText(pdfPath: string): Promise<string> {
	const info = await pdfInfo(pdfPath);
	const lines = [
		`File: ${info.path}`,
		`Pages: ${info.page_count} (mean text length/page: ${info.mean_text_length})`,
		...info.pages.map(
			(p) =>
				`p${p.page}: len=${p.text_length} img=${p.image_count} math=${p.math_density.toFixed(2)}`,
		),
	];
	return lines.join("\n");
}

/** El cuerpo de pdf_extract: extracción de texto con tope y el aviso de acotar la especificación. */
async function pdfExtractText(pdfPath: string, pages: string): Promise<string> {
	const text = await pdfExtract(pdfPath, pages);
	if (text.length > EXTRACT_CAP) {
		return `${text.slice(0, EXTRACT_CAP)}\n\n[Output truncated at ${EXTRACT_CAP} chars — narrow the page spec and extract in smaller batches.]`;
	}
	return text;
}

function toolText(toolCallId: string, toolName: string, value: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: value }],
		isError: value.startsWith("ERROR:"),
		timestamp: Date.now(),
	};
}

/** Barrera de doctrina (la regla del visual-maker de no terminar sin mirar,
 *  trasladada aquí): nunca se entrega un informe que no consultó nada; un
 *  informe de un PDF sin leer es contenido inventado, justo la clase de fallo
 *  para la que existe la barrera. */
const UNREAD_FINISH_MESSAGE =
	"You finished without consulting any page of the PDF — your brief would be invention, not reading. Extract or render the relevant pages first, then write the brief from what you actually saw.";

export async function runPdfReaderAgent(
	input: PdfReaderInput,
	opts: PdfReaderOptions = {},
): Promise<PdfResult> {
	const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
	let pdfPath = input.path;
	let openError: string | null;
	// Que se deniegue la fuente es un fallo normal y previo del PDF, antes de analizar,
	// renderizar o hacer ninguna petición al modelo (también en invocaciones directas del lector).
	try {
		pdfPath = resolveSourcePath(input.path);
		openError = await probeReadable(pdfPath);
	} catch (err) {
		openError = err instanceof Error ? err.message : String(err);
	}
	if (openError) {
		return { path: pdfPath, question: input.question, brief: `PDF failed: ${openError}`, pagesRead: [], pagesConsulted: [] };
	}
	const headless = opts.headless ?? getHeadless();
	// Sin barrera de Chrome (oleada E, 2026-10-10): pdf_render ahora es nativo
	// (pdfjs pinta en @napi-rs/canvas en el proceso); todo el pdf-reader funciona
	// sin navegador; las herramientas de texto siempre funcionaron sin él.

	const tools = createPdfTools(pdfPath);
	const toolDeclarations = Object.values(tools);
	const engine = opts.engine ?? piEngineFor("pdfReader");
	// BYOK (responsable, 2026-09-22): el nivel viaja con el motor inyectado; no hay
	// fijación de fábrica que consultar (engine.level es el valor resuelto/acotado).
	const reasoning = engine.level;
	const sessionId = randomUUID();
	const capture = createBackgroundCapture({ role: "pdfReader", runId: sessionId, sourceId: opts.chatId });
	const streamEngine = { ...engine, streamFn: backgroundCaptureStream(workerRequestStream(engine.streamFn), capture) };
	const prompt = [
		`PDF path: ${pdfPath}`,
		`Question (what the teacher needs from this document): ${input.question || "(no question — give a structural overview)"}`,
		"",
		"Read the document per your doctrine, then produce your final brief in the required format.",
	].join("\n");

	let messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
	/** Todas las páginas que el lector extrajo o renderizó (el conjunto de citas). */
	const consulted = new Set<number>();
	/** Páginas LEÍDAS de verdad: la salida de extract o render entró en el bucle.
	 *  Las líneas de contexto de las coincidencias de búsqueda consultan pero no
	 *  leen (la división de la exageración «78 pages consulted», sources v1 2026-09-19). */
	const read = new Set<number>();
	let finalText = "";
	let nudged = false;
	let captureError: unknown;

	try {
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			const result = await streamOnce(
				streamEngine,
				INSTRUCTIONS,
				messages,
				toolDeclarations,
				sessionId,
				reasoning,
				opts.abortSignal,
				opts.chatId ? providerEventObserver(opts.chatId, "job:pdfReader") : undefined,
				capture,
			);
			// Canal del dinero: cada iteración es una llamada al modelo.
			opts.onUsage?.(result.usage);
			messages = [...messages, result];

			const toolCalls = result.content.filter(
				(c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall",
			);
			if (toolCalls.length === 0) {
				finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				// La barrera sigue en CONSULTADAS, no en leídas: las líneas de contexto de las
				// coincidencias son consulta genuina (deber contra la invención); un informe
				// solo con búsquedas es honesto. pagesRead es el recuento honesto para la
				// interfaz, no una barrera de entrega.
				if (consulted.size === 0 && !nudged) {
					nudged = true;
					messages = [
						...messages,
						{ role: "user", content: UNREAD_FINISH_MESSAGE, timestamp: Date.now() },
					];
					continue;
				}
				return { path: pdfPath, question: input.question, brief: finalText || "(no brief text)", pagesRead: [...read].sort((a, b) => a - b), pagesConsulted: [...consulted].sort((a, b) => a - b) };
			}

			const toolResults: ToolResultMessage[] = [];
			/** Páginas renderizadas en este lote, añadidas como imágenes DESPUÉS de los
			 *  resultados de las herramientas: el estilo de imagen en el bucle del visual-maker. */
			let renderedImages: { page: number; image: ProcessImageResult }[] | null = null;

			for (const call of toolCalls) {
				const args = (call.arguments ?? {}) as Record<string, unknown>;
				try {
					if (call.name === "pdf_info") {
						opts.onActivity?.("pdf_info: triaging");
						const r = await pdfInfoText(pdfPath);
						toolResults.push(toolText(call.id, call.name, String(r)));
					} else if (call.name === "pdf_extract") {
						const spec = String(args.pages ?? "all");
						opts.onActivity?.(`pdf_extract: ${spec}`);
						const r = await pdfExtractText(pdfPath, spec);
						toolResults.push(toolText(call.id, call.name, String(r)));
						for (const p of specNumbers(spec, Infinity)) {
							consulted.add(p);
							read.add(p);
						}
					} else if (call.name === "pdf_search") {
						const query = String(args.query ?? "");
						const contextLines = numOr(args.context_lines, 3);
						const literal = Boolean(args.literal);
						opts.onActivity?.(`pdf_search: "${query}"`);
						// Llamada directa (no el execute de la herramienta): el bucle necesita las páginas
						// de las coincidencias; sus líneas de contexto SON consulta, así que se suman
						// al conjunto de citas (la barrera de terminar sin leer las cuenta).
						const { hits } = await pdfSearch(pdfPath, query, { contextLines, literal });
						for (const h of hits) consulted.add(h.page);
						const cap = hits.slice(0, 40);
						const body =
							cap.length === 0
								? "No hits."
								: cap.map((h) => `=== Page ${h.page}, line ${h.line} ===\n${h.context}`).join("\n") +
									(hits.length > cap.length ? `\n\n[${hits.length - cap.length} more hits — narrow the query.]` : "");
						toolResults.push(toolText(call.id, call.name, body));
					} else if (call.name === "pdf_render") {
						const spec = String(args.pages ?? "1");
						const dpi = numOr(args.dpi, 150);
						const wanted = specNumbers(spec, RENDER_BATCH_CAP);
						opts.onActivity?.(`pdf_render: ${spec} @${dpi}dpi`);
						const pages = await headless.renderPdfPages(pdfPath, wanted, { dpi });
						const processed: { page: number; image: ProcessImageResult }[] = [];
						for (const p of pages) {
							const image = await processImage(p.png, "image/png", { resizeOptions: engine.model.inputLimits?.images?.resize });
							opts.abortSignal?.throwIfAborted();
							processed.push({ page: p.page, image });
							// Solo cuentan como leídas las imágenes que se entregaron de verdad al modelo.
							if (image.ok) {
								consulted.add(p.page);
								read.add(p.page);
							}
						}
						if (pages.length === 0) {
							toolResults.push(toolText(call.id, call.name, "ERROR: no pages rendered (spec matched nothing?)"));
						} else {
							renderedImages = [...(renderedImages ?? []), ...processed];
							toolResults.push(
								toolText(
									call.id,
									call.name,
									`Rendered ${pages.length} page(s) at ${dpi} DPI — processed images or explicit omission notes follow below. Read the images carefully (equations, diagrams, layout).`,
								),
							);
						}
					} else {
						toolResults.push(toolText(call.id, call.name, `ERROR: unknown tool "${call.name}"`));
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					toolResults.push(toolText(call.id, call.name, `ERROR: ${msg}`));
				}
			}

			for (const result of toolResults) capture?.toolResult(result);
			messages = [...messages, ...toolResults];
			if (renderedImages) {
				messages = [
					...messages,
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `The rendered page(s), in order (${renderedImages.map((p) => `p${p.page}`).join(", ")}):`,
							},
							...renderedImages.flatMap(({ page, image }) => image.ok
								? [
									{ type: "text" as const, text: [`Page ${page}`, ...image.hints].join("\n") },
									{ type: "image" as const, data: image.data, mimeType: image.mimeType },
								]
								: [{ type: "text" as const, text: `Page ${page}: ${image.message}` }]),
						],
						timestamp: Date.now(),
					},
				];
			}
		}
	} catch (err) {
		captureError = err;
		const msg = err instanceof Error ? err.message : String(err);
		return { path: pdfPath, question: input.question, brief: `PDF failed: the reader crashed — ${msg}`, pagesRead: [...read].sort((a, b) => a - b), pagesConsulted: [...consulted].sort((a, b) => a - b) };
	} finally {
		capture?.finish(captureError);
	}

	// Límite de iteraciones: se entrega lo que se consultó honestamente (nunca invención).
	return {
		path: pdfPath,
		question: input.question,
		brief: finalText || `PDF failed: iteration limit (${maxIterations}) reached without a brief.`,
		pagesRead: [...read].sort((a, b) => a - b),
		pagesConsulted: [...consulted].sort((a, b) => a - b),
	};
}

// ─── pequeños auxiliares ─────────────────────────────────────────────────────

/** Convierte una especificación de páginas en números de página concretos, con tope. */
function specNumbers(spec: string, cap: number): number[] {
	// total = Infinity: los límites salen del documento al ejecutar; el tope por
	// sí solo protege el lote.
	const parts = spec.trim().toLowerCase() === "all" ? [`${cap}`] : spec.split(",");
	const out = new Set<number>();
	for (const part of parts) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [s, e] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(s, 10) || 1);
			const end = Math.min(parseInt(e, 10) || start, start + cap - 1);
			for (let pg = start; pg <= end && out.size < cap; pg++) out.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (Number.isFinite(pg) && pg >= 1 && out.size < cap) out.add(pg);
		}
	}
	return [...out].sort((a, b) => a - b);
}

function numOr(v: unknown, dflt: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

/** Sondeo previo y barato de legibilidad; el análisis real ocurre dentro de las herramientas. */
async function probeReadable(pdfPath: string): Promise<string | null> {
	try {
		const fs = await import("node:fs/promises");
		const stat = await fs.stat(pdfPath);
		if (!stat.isFile()) return "not a regular file";
		if (stat.size === 0) return "file is empty";
		// sondeo de análisis: pdfProbe lanza el error preciso de pdfjs con los ficheros basura
		await pdfProbe(pdfPath);
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/** Una llamada al modelo en bruto (sin bucle de agente): el streamOnce del
 *  visual-maker, duplicado aquí porque su módulo lo mantiene privado. */
async function streamOnce(
	engine: PiEngine,
	systemPrompt: string,
	messages: Message[],
	tools: Tool[],
	sessionId: string,
	reasoning: ThinkingLevel | undefined,
	abortSignal?: AbortSignal,
	onProviderStreamEvent?: ProviderEventObserver,
	capture?: BackgroundCapture,
): Promise<AssistantMessage> {
	// 0.87.1: los contextos de cara al proveedor son TranscriptContexts; el prompt
	// y las declaraciones de herramientas se pliegan en un mensaje de sistema inicial.
	// normalizeContext es la única entrada de la biblioteca de Context→TranscriptContext.
	const stream = engine.streamFn(engine.model, normalizeContext({ systemPrompt, messages, tools }), {
		sessionId,
		reasoning: reasoning && reasoning !== "off" ? reasoning : undefined,
		signal: abortSignal,
		onProviderStreamEvent: onProviderStreamEvent as never,
	} as never);
	for await (const event of stream) {
		if (event.type === "done") { capture?.reply(event.message); return event.message; }
		if (event.type === "error") {
			capture?.reply(event.error);
			if (event.reason === "aborted") {
				const err = new Error("aborted");
				const abortedErr = err as Error & { name: string };
				abortedErr.name = "AbortError";
				throw abortedErr;
			}
			throw new Error(event.error.errorMessage ?? "the model call failed");
		}
	}
	throw new Error("the model stream ended without a result");
}