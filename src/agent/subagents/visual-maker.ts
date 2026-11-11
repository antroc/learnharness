import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message, Tool, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { processImage, type ProcessImageResult } from "../image-processing/index.ts";
import { Type } from "typebox";
import { piEngineFor, type PiEngine, type ThinkingLevel } from "../models.ts";
import { providerEventObserver, type ProviderEventObserver } from "../provider-events.ts";
import { backgroundCaptureStream, createBackgroundCapture, type BackgroundCapture } from "../background-capture.ts";
import { workerRequestStream } from "../worker-request-admission.ts";
import type { VisualResult } from "../../core/contracts.ts";
import type { LearnerImage } from "../tools/learner-image.ts";
import { embedLearnerImage, LEARNER_IMAGE_HREF } from "../../core/learner-image-svg.ts";
import { annotationPlacementProblem } from "./annotation-svg.ts";
import { getHeadless, type HeadlessApi } from "./headless.ts";

/**
 * El subagente visual-maker (visión §2.5): crea UN SVG preciso a partir de un
 * encargo, lo renderiza a PNG con el mismo rasterizador que usará la
 * transcripción, MIRA el resultado e itera hasta que es correcto; una
 * adaptación directa de la doctrina svg-maker de la prueba de concepto del
 * vault ("the one rule that matters: verify by looking").
 *
 * FORMA DEL BUCLE (decidida en el informe W6): hecho a mano con generateText +
 * un array de mensajes, porque el bucle debe devolver una IMAGEN al modelo
 * después de cada renderizado. write_svg / render_svg se declaran SIN execute:
 * cuando el modelo las llama, generateText se detiene con las llamadas a
 * herramientas y este bucle añade él mismo los resultados, seguidos de un
 * mensaje de usuario que contiene el PNG renderizado como parte de fichero
 * ("Here is the current render"). La fontanería de execute de ToolLoopAgent no
 * puede expresar limpiamente esa forma de imagen dentro del bucle.
 *
 * Aplicación de la doctrina en el código: si el modelo intenta terminar
 * mientras el SVG actual no se ha renderizado nunca (o ha cambiado desde su
 * último renderizado), el bucle lo renderiza de todos modos, muestra la imagen
 * y pide al modelo que la mire antes de terminar. No se entrega nada sin
 * haberlo mirado.
 *
 * La semántica de fallo refleja la del demo-builder: { svg: "", notes: "FAILED: …" }.
 *
 * MODO IMAGEN (issue #363): con una imagen del alumno, el maker la anota. El
 * modelo ve la imagen y la coloca con un href provisional
 * (LEARNER_IMAGE_HREF); el bucle incrusta los bytes solo para renderizar. Los
 * SVG entregados conservan el marcador provisional y una referencia a una
 * instantánea de la sesión. El maker recibe contenido de imagen nativo, nunca
 * base64 en el texto o las ediciones del SVG.
 */

export interface VisualMakerInput {
	brief: string;
	/** La imagen del alumno que hay que anotar, ya acotada para el almacenamiento. */
	image?: LearnerImage;
}

/** El href provisional que el modelo da a la imagen del alumno. */
export { LEARNER_IMAGE_HREF };

export interface VisualMakerOptions {
	/** Frontera de pruebas: motor con guion; en producción se usa el rol visualMaker. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Máximo de rondas del modelo (ciclos de escritura/renderizado + respuesta final). Por defecto, 8. */
	maxIterations?: number;
	/** Callback de la línea de actividad en vivo (actualiza el registro de la tarea). */
	onActivity?: (line: string) => void;
	/** Mata la ejecución en mitad de una llamada al modelo (semántica de cancelación con terminación real de 2026-09). */
	abortSignal?: AbortSignal;
	/** Canal del dinero: una llamada por iteración del bucle (streamSimple),
	 * sumada a JobRecord.usage. */
	onUsage?: (usage: Usage) => void;
	/** Depuración: clave de grabación de eventos en bruto del proveedor (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

const INSTRUCTIONS = `You are a visual maker — a diagram author + renderer for precise, spatial figures. You
receive a brief describing ONE idea that needs exact placement (coordinate geometry, number lines,
vectors, function plots, physical layouts — things auto-layout diagrams cannot express), and you return
ONE clean, correct SVG. You never see the lesson; the brief is everything you know.

You do NOT decide what idea to show — the teacher already decided. Your job is faithful, precise
composition, and above everything CORRECTNESS: the picture must not assert anything false. A right-angle
mark on the wrong corner, a vector pointing the wrong way, a point plotted at the wrong coordinate is a
failure even if it renders cleanly.

Your three tools:
- write_svg({ svg }) — write the complete <svg>…</svg> source (overwrites the previous version).
- edit_svg({ old_text, new_text }) — a surgical exact-match replacement in the current SVG:
  old_text must appear EXACTLY ONCE; it is replaced by new_text. Call write_svg first. For anything
  beyond a one-spot fix (new elements, restructured layout), write_svg the whole document again.
- render_svg({}) — rasterize the current SVG to a PNG. The render arrives as an image in the
  message right after the tool result.

THE ONE RULE THAT MATTERS MOST: verify by looking. You are done only when you have LOOKED at the
rendered PNG and confirmed it is true to the brief. Rendering success only proves the SVG parsed; it
says nothing about whether the geometry is right or the picture is readable. When you look:

- Is every coordinate, angle, direction, and proportion actually correct? Re-derive the geometry if unsure.
- Are labels placed clearly, not overlapping lines or each other?
- Is anything clipped by the viewBox, too small to read, or cramped?
- Would a learner instantly read the intended idea from this picture alone?

Workflow: plan the coordinate space (viewBox + margins, nothing touching the edges) → write_svg →
render_svg → LOOK critically → fix (edit_svg for one-spot fixes, write_svg otherwise) and re-render
until correct and clean. Never finish without having looked at a render of your FINAL SVG.

SVG requirements:
- A complete <svg> with explicit width/height AND a matching viewBox.
- White background (<rect> or style), dark strokes, sans-serif labels at generous sizes.
- One idea, fewest elements — sparse and large beats busy and tiny.
- Draw only what the brief specifies; never invent data, values, or shapes to fill space.
- Plain, clean styling: at most one accent color. An explanatory diagram, not art.

Your FINAL message: 1-2 sentences of notes for the teacher (what the figure shows, any caveats) —
NEVER the SVG source itself. If you genuinely cannot make a correct picture of the brief, say exactly
that in your final message and why.`;

const IMAGE_INSTRUCTIONS = `ANNOTATING THE LEARNER'S IMAGE — this brief comes with one of the learner's own pictures. Your
figure is that picture with marks on it, not a new drawing:

- Place it EXACTLY ONCE, at its natural size, before your marks so they sit on top:
  <image href="${LEARNER_IMAGE_HREF}" x="…" y="…" width="W" height="H"/> — W×H is given with the image.
  The loop substitutes the real picture; never draw or describe its content yourself.
- Use static SVG marks and inline attributes only: no scripts, animation, foreignObject, style blocks,
  external resources, or escaped resource syntax. Local #fragment references are allowed.
- Annotate in the picture's own pixel coordinates (shifted by your x/y if you add margins for labels).
- Every mark must land on the exact feature it names — an arrow at the wrong part is a false statement.
  Locate the feature in the picture first, then check each mark against the render.
- Marks must read against any background: thick strokes in one or two high-contrast colors, and labels
  with a white halo (stroke="white" paint-order="stroke") or set in a margin with a leader line.
- Never hide what the brief is about under a label or a fill.
- If a feature the brief names is not in the picture, never guess where it is: leave it unmarked and say
  so in your notes.`;

/** Las declaraciones que van por la red (Tool de pi-ai, parámetros TypeBox):
 *  este bucle se encarga él mismo de la ejecución (write/edit se despachan en
 *  línea más abajo y render alimenta el mensaje con la imagen en el bucle),
 *  así que las declaraciones no llevan execute. */
export function createVisualTools(): Record<string, Tool> {
	return {
		write_svg: {
			name: "write_svg",
			description: "Write the complete SVG source for the figure (overwrites any previous version).",
			parameters: Type.Object({
				svg: Type.String({ description: 'Complete <svg xmlns="…">…</svg> markup.' }),
			}),
		},
		edit_svg: {
			name: "edit_svg",
			description:
				"Replace one exact spot in the current SVG: old_text must appear EXACTLY ONCE and is replaced by new_text. Call write_svg first. For larger changes, write_svg the whole document.",
			parameters: Type.Object({
				old_text: Type.String({ description: "The exact text to replace — must match exactly once in the current SVG." }),
				new_text: Type.String({ description: "The replacement text." }),
			}),
		},
		render_svg: {
			name: "render_svg",
			description: "Render the current SVG to a PNG and show it to you for inspection. No arguments.",
			parameters: Type.Object({}),
		},
	};
}

const LOOK_MESSAGE =
	"Here is the current render of your SVG — inspect it critically (geometry, labels, clipping, readability):";
const UNLOOKED_FINISH_MESSAGE =
	"You finished without looking at a render of your final SVG. Above is its render. If it is correct and clean, reply with just your notes; otherwise call write_svg with fixes and render again.";

export async function runVisualMaker(input: VisualMakerInput, opts: VisualMakerOptions = {}): Promise<VisualResult> {
	const headless = opts.headless ?? getHeadless();
	const brief = input.brief.trim() || "(no brief)";
	const maxIterations = opts.maxIterations ?? 8;

	const reason = headless.unavailableReason();
	if (reason) {
		return { svg: "", notes: `FAILED: ${reason}` };
	}

	const tools = createVisualTools();
	const toolDeclarations = Object.values(tools);
	const engine = opts.engine ?? piEngineFor("visualMaker");
	// BYOK (responsable, 2026-09-22): el nivel viaja con el motor inyectado; no hay
	// fijación de fábrica que consultar (engine.level es el valor resuelto/acotado).
	const reasoning = engine.level;
	const sessionId = randomUUID();
	const capture = createBackgroundCapture({ role: "visualMaker", runId: sessionId, sourceId: opts.chatId });
	const streamEngine = { ...engine, streamFn: backgroundCaptureStream(workerRequestStream(engine.streamFn), capture) };
	const learnerImage = input.image;
	const systemPrompt = learnerImage ? `${INSTRUCTIONS}\n\n${IMAGE_INSTRUCTIONS}` : INSTRUCTIONS;
	const prompt = [
		learnerImage
			? "Brief for ONE annotated image (from the teacher, verbatim — it is everything you know):"
			: "Brief for ONE precise figure (from the teacher, verbatim — it is everything you know):",
		brief,
		"",
		...(learnerImage
			? [
					`The learner's image follows: ${learnerImage.width}×${learnerImage.height} px. Place it with <image href="${LEARNER_IMAGE_HREF}" … width="${learnerImage.width}" height="${learnerImage.height}"/>.`,
				]
			: []),
		"Author the SVG, render it, look at it, iterate until correct, then finish with your notes.",
	].join("\n");

	let messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
	if (learnerImage) {
		const shown = await processImage(Buffer.from(learnerImage.data, "base64"), learnerImage.mimeType, {
			resizeOptions: engine.model.inputLimits?.images?.resize,
		});
		if (!shown.ok) return { svg: "", notes: `FAILED: showing the learner's image to the maker failed — ${shown.message}` };
		messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: [prompt, ...shown.hints].join("\n") },
					{ type: "image", data: shown.data, mimeType: shown.mimeType },
				],
				timestamp: Date.now(),
			},
		];
	}
	/** Incrustación solo para renderizar; los SVG persistidos conservan el pequeño marcador provisional. */
	const embed = (svg: string): string => learnerImage ? embedLearnerImage(svg, learnerImage) : svg;
	const render = (svg: string) => headless.renderSvg(embed(svg), learnerImage ? { nativeOnly: true } : undefined);
	/** Modo imagen: el problema de un SVG que no coloca la imagen exactamente una
	 *  vez (null = correcto, y siempre correcto si no hay imagen). */
	const placementProblem = (svg: string): string | null => {
		if (!learnerImage) return null;
		return annotationPlacementProblem(svg, learnerImage.width, learnerImage.height);
	};
	let currentSvg: string | null = null;
	/** El SVG mostrado en el renderizado más reciente (null = nunca renderizado). */
	let renderedSvg: string | null = null;
	let finalText = "";
	let captureError: unknown;

	try {
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			// Una llamada al modelo por iteración (streamSimple, sin bucle de agente: este
			// bucle se encarga de ejecutar las herramientas y de inyectar la imagen en el bucle).
			const result = await streamOnce(
				streamEngine,
				systemPrompt,
				messages,
				toolDeclarations,
				sessionId,
				reasoning,
				opts.abortSignal,
				opts.chatId ? providerEventObserver(opts.chatId, "job:visualMaker") : undefined,
				capture,
			);
			// Canal del dinero: cada iteración es una llamada al modelo.
			opts.onUsage?.(result.usage);
			messages = [...messages, result];

			const toolCalls = result.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
			if (toolCalls.length === 0) {
				finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				// Barrera de doctrina: nunca se entrega un SVG sin mirar. Si el SVG actual cambió
				// desde su último renderizado (o nunca se renderizó), se muestra ahora y se
				// obliga al modelo a mirarlo antes de aceptar que termine.
				if (currentSvg && renderedSvg !== currentSvg) {
					let png: Buffer;
					try {
						png = await render(currentSvg);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						return { svg: "", notes: `FAILED: rendering the final SVG failed — ${msg}` };
					}
					const image = await processImage(png, "image/png", { resizeOptions: engine.model.inputLimits?.images?.resize });
					opts.abortSignal?.throwIfAborted();
					if (!image.ok) return { svg: "", notes: `FAILED: inspecting the final SVG failed — ${image.message}` };
					opts.onActivity?.("render_svg: inspecting final render");
					renderedSvg = currentSvg;
					messages = [
						...messages,
						{
							role: "user",
							content: [
								{ type: "text", text: [UNLOOKED_FINISH_MESSAGE, ...image.hints].join("\n") },
								{ type: "image", data: image.data, mimeType: image.mimeType },
							],
							timestamp: Date.now(),
						},
					];
					continue;
				}
				return finish(currentSvg, finalText, learnerImage);
			}

			const toolResults: ToolResultMessage[] = [];
			let renderImage: Extract<ProcessImageResult, { ok: true }> | null = null; // se añade DESPUÉS de los resultados de las herramientas
			for (const call of toolCalls) {
				if (call.name === "write_svg") {
					const svg = (call.arguments as { svg?: unknown }).svg;
					if (typeof svg !== "string" || !svg.includes("<svg")) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected a complete <svg>…</svg> document in the `svg` field."));
						continue;
					}
					const problem = placementProblem(svg);
					if (problem) {
						toolResults.push(toolText(call.id, call.name, `ERROR: ${problem}.`));
						continue;
					}
					currentSvg = svg;
					opts.onActivity?.(`write_svg: ${(svg.length / 1024).toFixed(1)} KB`);
					toolResults.push(toolText(call.id, call.name, `Saved (${svg.length} bytes). Call render_svg to look at it.`));
				} else if (call.name === "edit_svg") {
					const edit = call.arguments as { old_text?: unknown; new_text?: unknown };
					if (!currentSvg) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to edit — call write_svg first."));
						continue;
					}
					if (typeof edit.old_text !== "string" || typeof edit.new_text !== "string" || !edit.old_text) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected old_text (non-empty) and new_text strings."));
						continue;
					}
					const occurrences = currentSvg.split(edit.old_text).length - 1;
					if (occurrences === 0) {
						toolResults.push(
							toolText(
								call.id,
								call.name,
								`ERROR: old_text not found. Closest line for reference:\n${snippetAround(currentSvg, edit.old_text)}`,
							),
						);
						continue;
					}
					if (occurrences > 1) {
						toolResults.push(
							toolText(call.id, call.name, `ERROR: old_text appears ${occurrences} times — it must match EXACTLY ONCE. Include more surrounding context to make it unique.`),
						);
						continue;
					}
					const edited: string = currentSvg.replace(edit.old_text, edit.new_text);
					const problem = placementProblem(edited);
					if (problem) {
						toolResults.push(toolText(call.id, call.name, `ERROR: edit not applied — ${problem}.`));
						continue;
					}
					currentSvg = edited;
					opts.onActivity?.("edit_svg: applied");
					toolResults.push(toolText(call.id, call.name, "OK — replaced 1 occurrence. Call render_svg to look at the edited SVG."));
				} else if (call.name === "render_svg") {
					if (!currentSvg) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to render — call write_svg first."));
						continue;
					}
					try {
						const png = await render(currentSvg);
						const image = await processImage(png, "image/png", { resizeOptions: engine.model.inputLimits?.images?.resize });
						opts.abortSignal?.throwIfAborted();
						if (!image.ok) throw new Error(image.message);
						renderImage = image;
						renderedSvg = currentSvg;
						opts.onActivity?.("render_svg: inspecting render");
						toolResults.push(toolText(call.id, call.name, "Rendered — the PNG follows in the next message. Look at it."));
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						opts.onActivity?.("render_svg: render error");
						toolResults.push(toolText(call.id, call.name, `RENDER ERROR (the SVG may be malformed): ${msg}. Fix it with write_svg and render again.`));
					}
				} else {
					toolResults.push(toolText(call.id, call.name, `ERROR: unknown tool "${call.name}". Use write_svg, edit_svg, or render_svg.`));
				}
			}
			// Orden de los mensajes: llamadas a herramientas del asistente → resultados → imagen renderizada.
			for (const result of toolResults) capture?.toolResult(result);
			messages = [...messages, ...toolResults];
			if (renderImage) {
				messages = [
					...messages,
					{
						role: "user",
						content: [
							{ type: "text", text: [LOOK_MESSAGE, ...renderImage.hints].join("\n") },
							{ type: "image", data: renderImage.data, mimeType: renderImage.mimeType },
						],
						timestamp: Date.now(),
					},
				];
			}
		}
	} catch (err) {
		captureError = err;
		const msg = err instanceof Error ? err.message : String(err);
		return { svg: "", notes: `FAILED: the maker crashed — ${msg}` };
	} finally {
		capture?.finish(captureError);
	}

	// Límite de iteraciones: se entrega el último SVG escrito solo si se miró.
	if (currentSvg && renderedSvg === currentSvg) {
		return finish(currentSvg, finalText || "Iteration limit reached — delivering the last verified SVG.", learnerImage);
	}
	return { svg: "", notes: `FAILED: iteration limit (${maxIterations}) reached without a verified SVG.` };
}

function toolText(toolCallId: string, toolName: string, value: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: value }],
		isError: value.startsWith("ERROR:") || value.startsWith("RENDER ERROR"),
		timestamp: Date.now(),
	};
}

/** Una llamada al modelo en bruto (sin bucle de agente): consume el flujo de
 *  eventos hasta el AssistantMessage final; los errores del proveedor y las
 *  cancelaciones lanzan para que la ruta catch del bucle mantenga la antigua
 *  semántica de generateText. */
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
				err.name = "AbortError";
				throw err;
			}
			throw new Error(event.error.errorMessage ?? "the model call failed");
		}
	}
	throw new Error("the model stream ended without a result");
}

/** Una ventana de contexto numerada de 3 líneas alrededor de la coincidencia
 *  aproximada más cercana de una edición fallida: suficiente para que el modelo
 *  vea qué salió mal y reintente (la semántica de snippetAround de svg_tools de pi). */
function snippetAround(svg: string, target: string): string {
	const words = target.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "(empty old_text)";
	const lines = svg.split("\n");
	let bestAt = -1;
	let bestScore = -1;
	for (let i = 0; i < lines.length; i++) {
		const score = words.filter((w) => lines[i]!.includes(w)).length;
		if (score > bestScore) {
			bestScore = score;
			bestAt = i;
		}
	}
	if (bestAt < 0) return "(no similar line found)";
	const from = Math.max(0, bestAt - 1);
	const to = Math.min(lines.length, bestAt + 2);
	return lines
		.slice(from, to)
		.map((line, idx) => `${from + idx + 1} | ${line}`)
		.join("\n");
}

function finish(svg: string | null, finalText: string, image?: LearnerImage): VisualResult {
	if (!svg) {
		return {
			svg: "",
			notes: `FAILED: the maker never wrote an SVG.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`,
		};
	}
	return { svg, notes: finalText || undefined, ...(image ? { image: { path: image.path, snapshotId: image.snapshotId } } : {}) };
}
