/**
 * La llamada al modelo de PREGUNTA LATERAL: la generación en streaming sin herramientas de #487,
 * con el modelo de conversación de la sesión. Sin bucle de agente, sin herramientas, sin
 * identidad de sesión: una llamada de Claude Code sin id de sesión nunca retiene ni reutiliza
 * el proceso vivo de la CLI de la lección (docs/claude-code.md, «Preguntas, reutilización y
 * cancelación»).
 *
 * Instrucciones: la base del hilo lateral y después el apéndice compartido seleccionado que
 * también compone el agente de práctica (voz, precisión, formato: una ley para todos los
 * agentes que tratan con el alumno; el contrato de LaTeX/Markdown importa porque las
 * respuestas se renderizan por la misma canalización de Markdown). Los fragmentos compartidos
 * respetan las sustituciones activadas del alumno, con la misma clave que usan los demás
 * agentes. Un fragmento final de estilo solo para el hilo lateral mantiene las respuestas
 * breves tras el apéndice compartido; ninguno de los dos fragmentos propios del hilo lateral
 * es editable.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeContext, type AssistantMessage, type Message, type Usage } from "@earendil-works/pi-ai";
import { backgroundCaptureStream, createBackgroundCapture } from "./background-capture.ts";
import { providerEventObserver } from "./provider-events.ts";
import { PATHS } from "../../config.ts";
import type { SideModelTurn } from "../core/side-chat.ts";
import type { PiEngine } from "./models.ts";
import { readPromptOverride } from "./prompt-segments.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");
const SIDE_BASE = path.join(PROMPTS_DIR, "side-chat", "00-base.md");
const SIDE_STYLE = path.join(PROMPTS_DIR, "side-chat", "90-style.md");
/** El apéndice compartido, en orden de composición (claves = rutas de sustitución). */
const SIDE_SHARED_FRAGMENTS = ["shared/10-voice.md", "shared/15-accuracy.md", "shared/40-formatting.md"];

function readSource(file: string): string {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return "";
	}
}

/** El prompt de sistema del modelo lateral, compuesto de nuevo en cada llamada (una sustitución
 *  activada entre preguntas se aplica en la siguiente). */
export function composeSideChatInstructions(switches: Record<string, boolean> = {}): string {
	const segments = [readSource(SIDE_BASE)];
	for (const key of SIDE_SHARED_FRAGMENTS) {
		const override = switches[key] === true ? readPromptOverride(key) : null;
		segments.push(override ?? readSource(path.join(PROMPTS_DIR, ...key.split("/"))));
	}
	segments.push(readSource(SIDE_STYLE));
	return segments
		.map((s) => s.trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

export interface SideAnswerResult {
	/** El texto de la respuesta (parcial si se detuvo o falló). */
	text: string;
	/** Presente cuando el proveedor informó del uso (también en los fallos). */
	usage?: Usage;
	/** Cómo terminó la llamada. */
	outcome: "done" | "aborted" | "error";
	/** El texto de fallo del proveedor (resultado "error"). */
	errorMessage?: string;
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

/**
 * Emite en streaming una respuesta lateral. `onText` recibe el texto COMPLETO hasta el momento
 * en cada delta de texto (sustituir, nunca añadir: la misma disciplina de ranura que el stream
 * del turno). Nunca lanza por fallos del proveedor ni abortos: el resultado indica cómo terminó
 * y `text` conserva lo que haya llegado.
 */
export async function streamSideAnswer(opts: {
	engine: PiEngine;
	instructions: string;
	turns: readonly SideModelTurn[];
	signal?: AbortSignal;
	onText?: (text: string) => void;
	/** Identidad de diagnóstico opcional existente, NO una sesión de proveedor reutilizable. */
	chatId?: string;
	runId?: string;
}): Promise<SideAnswerResult> {
	const now = Date.now();
	const messages: Message[] = opts.turns.map((turn) =>
		turn.role === "user"
			? { role: "user", content: turn.text, timestamp: now }
			: ({
					role: "assistant",
					content: [{ type: "text", text: turn.text }],
					api: opts.engine.model.api,
					provider: opts.engine.model.provider,
					model: opts.engine.model.id,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: now,
				} as AssistantMessage),
	);
	let text = "";
	let failure: unknown;
	const capture = createBackgroundCapture({ role: "sideQuestion", runId: opts.runId ?? randomUUID(), sourceId: opts.chatId });
	const providerEvents = opts.chatId ? providerEventObserver(opts.chatId, "sideQuestion") : undefined;
	try {
		const stream = backgroundCaptureStream(opts.engine.streamFn, capture)(opts.engine.model, normalizeContext({ systemPrompt: opts.instructions, messages, tools: [] }), {
			signal: opts.signal,
			reasoning: opts.engine.level === "off" ? undefined : opts.engine.level,
			...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		});
		for await (const event of stream) {
			if (event.type === "text_delta" || event.type === "text_end") {
				const next = textOf(event.partial);
				if (next !== text) {
					text = next;
					opts.onText?.(text);
				}
			} else if (event.type === "done") {
				capture?.reply(event.message);
				return { text: textOf(event.message) || text, usage: event.message.usage, outcome: "done" };
			} else if (event.type === "error") {
				capture?.reply(event.error);
				failure = new Error(event.error.errorMessage ?? event.reason);
				const partial = textOf(event.error) || text;
				if (event.reason === "aborted") return { text: partial, usage: event.error.usage, outcome: "aborted" };
				return { text: partial, usage: event.error.usage, outcome: "error", errorMessage: event.error.errorMessage ?? "The model call failed." };
			}
		}
		failure = new Error("The model stream ended without a result.");
		return { text, outcome: "error", errorMessage: (failure as Error).message };
	} catch (err) {
		failure = err;
		if (opts.signal?.aborted) return { text, outcome: "aborted" };
		return { text, outcome: "error", errorMessage: err instanceof Error ? err.message : String(err) };
	} finally {
		capture?.finish(failure);
	}
}
