"use client";

import { ChevronRight } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toolActivityLabel } from "@/src/core";
import type { ArtifactPartProps } from "@/src/core";

/**
 * La tarjeta EN DIRECTO de la entrada de la herramienta (responsable, ronda de
 * streaming 2026-10-01): el aspecto de una llamada a herramienta mientras el
 * agente la ESCRIBE. Una parte de herramienta está en `input-streaming`
 * durante toda su ejecución (el puente aplaza input-available hasta
 * tool_execution_end), así que esta tarjeta ES el estado de trabajo: spinner
 * + etiqueta de actividad con brillo en la cabecera (el texto de la retirada
 * línea inferior de la transcripción, con la misma receta que la fila de
 * razonamiento), y la propia entrada en streaming visible al desplegar. En
 * cuanto la llamada se asienta, la parte se vuelve a renderizar mediante el
 * registro de artefactos y la tarjeta asentada y discreta sustituye a esta.
 *
 * La única gramática del estado de trabajo en todas partes (responsable):
 * spinner Braille + Shimmer(duration 1): la fila de razonamiento, esta
 * tarjeta y la fila de la barra lateral.
 */
interface StreamingToolPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
}

export function LiveToolCard({ part }: ArtifactPartProps) {
	const p = part as StreamingToolPart;
	const tool = p.type.replace(/^tool-/, "");
	const inp = (p.input ?? {}) as Record<string, unknown>;
	// El argumento principal (la regla de ToolCallCard, mostrado tal cual): la ruta en
	// read/ls, el patrón en find/grep, la sesión en list_propositions.
	let arg = "";
	if (typeof inp.path === "string" && inp.path) arg = inp.path;
	else if (typeof inp.pattern === "string" && inp.pattern) arg = inp.pattern;
	else if (typeof inp.session === "string" && inp.session) arg = inp.session;

	const hasInput = p.input != null && Object.keys(inp).length > 0;

	return (
		<details
			data-testid="live-tool-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
				<BrailleSpinner label={`${toolActivityLabel(tool)} — live`} />
				<Shimmer duration={1} className="text-xs">
					{toolActivityLabel(tool)}
				</Shimmer>
				{arg && <span className="truncate">{arg}</span>}
				<ChevronRight className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="mt-2 rounded-xl border bg-card p-3 text-xs">
				<div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">Input (streaming)</div>
				<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
					{hasInput ? JSON.stringify(p.input, null, 2) : "…"}
				</pre>
			</div>
		</details>
	);
}
