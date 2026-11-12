"use client";

import { ChevronRight } from "lucide-react";
import type { ArtifactPartProps } from "@/src/core";

/**
 * La tarjeta genérica de llamada a herramienta (fuentes v1, 2026-09-19): una
 * línea discreta y plegada por cada llamada síncrona a herramienta —el nombre
 * de la herramienta más el argumento principal—, desplegable hasta la entrada
 * y la salida completas. La especificación del usuario: «al menos el nombre
 * de la herramienta; para read, el nombre del fichero; todo plegado por
 * defecto; que no distraiga, cosas de fondo». Las herramientas no registradas
 * siguen sin renderizar nada (el valor por defecto del registro de chat.tsx);
 * esta tarjeta es solo para el conjunto del sistema de ficheros del alumno
 * (read/ls/find/grep), donde la llamada SÍ merece dejar rastro en la
 * transcripción.
 */

interface ToolCallPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

/** El argumento principal plegado por herramienta: la ruta en
 * read/ls/show_image, el patrón en find/grep; se muestra tal cual, nunca
 * resuelto (la ruta absoluta aparece en la vista desplegada cuando está en
 * la salida). */
function headlineArg(tool: string, input: unknown): string {
	const inp = (input ?? {}) as Record<string, unknown>;
	if (tool === "read" || tool === "ls" || tool === "show_image") {
		const p = typeof inp.path === "string" && inp.path.length > 0 ? inp.path : "~";
		return p;
	}
	if (typeof inp.pattern === "string") return inp.pattern;
	// list_propositions: el id de sesión es el sujeto de la llamada; la
	// línea plegada dice "list_propositions chat_…". Se muestra tal cual
	// (el id es exactamente lo que list_sessions comunicó al modelo).
	if (tool === "list_propositions" && typeof inp.session === "string" && inp.session.length > 0) {
		return inp.session;
	}
	return "";
}

/** Renderiza el cuerpo de un resultado de herramienta: las cadenas simples tal
 * cual; los resultados de read con imágenes muestran su texto + una nota de
 * adjunto (la imagen en sí es para el modelo; el alumno solo ve que ocurrió). */
function outputText(output: unknown): string | null {
	if (output == null) return null;
	if (typeof output === "string") return output;
	if (typeof output === "object" && "text" in (output as Record<string, unknown>)) {
		const o = output as { text?: unknown; images?: unknown[] };
		const text = typeof o.text === "string" ? o.text : null;
		const n = Array.isArray(o.images) ? o.images.length : 0;
		return n > 0 ? `${text ?? ""}\n[${n} image${n > 1 ? "s" : ""} attached to the model]`.trim() : text;
	}
	try {
		return JSON.stringify(output, null, 2);
	} catch {
		return String(output);
	}
}

export function ToolCallCard({ part }: ArtifactPartProps) {
	const p = part as ToolCallPart;
	const tool = p.type.replace(/^tool-/, "");
	const arg = headlineArg(tool, p.input);
	const out = outputText(p.output);
	const failed = p.state === "output-error" || typeof p.errorText === "string";
	return (
		<details
			data-testid="tool-call-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
				<span className={`font-medium uppercase tracking-wide ${failed ? "text-error" : ""}`}>
					{tool}
				</span>
				{arg && <span className="truncate">{arg}</span>}
				<ChevronRight className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="mt-2 space-y-2 rounded-xl border bg-card p-3 text-xs">
				{p.input != null && (
					<div>
						<div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
							Input
						</div>
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
							{JSON.stringify(p.input, null, 2)}
						</pre>
					</div>
				)}
				{typeof p.errorText === "string" ? (
					<div>
						<div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
							Error
						</div>
						<pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-error">
							{p.errorText}
						</pre>
					</div>
				) : out != null ? (
					<div>
						<div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
							Output
						</div>
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
							{out}
						</pre>
					</div>
				) : (
					p.state !== "output-available" && (
						<div className="text-muted-foreground italic">running…</div>
					)
				)}
			</div>
		</details>
	);
}
