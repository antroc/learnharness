"use client";

import { ChevronRightIcon, ClipboardCheckIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { parseProbeDoneInput, type ProbeDoneResult } from "@/src/core";

/**
 * La tarjeta de conclusión del sondeo (docs/archive/probe-teach-split.md §2):
 * renderiza la llamada probe_done del sondeador. La ENTRADA es la evaluación
 * del alumno —hilo a hilo, dónde está su límite— y pertenece tanto al alumno
 * como a la transcripción. La evaluación completada es un artefacto de
 * traspaso plegado; al desplegarlo se revela la entrada formateada completa.
 * La fila de herramienta en directo mientras se escribe es cosa de chat.tsx.
 * La SALIDA es el acuse de la frontera (ok) o el rechazo con el que el
 * sondeador reintentó (renderizado discreto y pequeño: es contabilidad
 * dirigida al modelo, conservada solo por honestidad de la transcripción).
 *
 * La vista previa de la entrada solo es fiable mientras la llamada está
 * pendiente: una entrada en input-available superó la validación del esquema
 * en el límite, y un parcial a mitad de stream se protege más abajo. La
 * entrada de una parte output-error fue RECHAZADA por la validación y puede
 * tener cualquier forma (fallo en vivo: el modelo convirtió `assessment` en
 * cadena); nunca la renderices.
 *
 * El estado de despliegue nativo es local a esta tarjeta montada, no se
 * persiste. Los rechazos, las llamadas mal formadas y la alternativa de
 * escritura siguen visibles y simples.
 */
export function ProbeDoneCard({ part }: { part: { input?: unknown; output?: unknown; state?: unknown } }) {
	const output = part.output as ProbeDoneResult | undefined;
	const state = typeof part.state === "string" ? part.state : "";

	// Analizar, no hacer cast (la regla de la frontera, src/core/tool-parts.ts): el modelo
	// escribió esta entrada; solo es fiable para el consumidor si el MISMO esquema
	// que declaró la herramienta lo dice. El análisis engloba los antiguos razonamientos
	// de estado y protecciones de forma: la evaluación convertida en cadena de una llamada con error,
	// un parcial a mitad de stream: todo lo que no se analiza cae en la rama de
	// alternativa. La salida sigue siendo un cast: la escribió NUESTRO execute.
	const input = parseProbeDoneInput(part.input);

	// La evaluación es la entrada de la LLAMADA (responsable, dieta de contexto 2026-10-09):
	// el eco en el resultado ya no existe; details es solo {ok:true}, y la rama de rechazo
	// de abajo sigue leyendo output.error.
	const assessment = input?.assessment;
	const strands = assessment && Array.isArray(assessment.strands) ? assessment.strands : null;

	const heading = <>
		<ClipboardCheckIcon className="size-3.5 text-primary" />
		<span className="min-w-0 truncate">Probe assessment</span>
	</>;
	const note = output && !output.ok ? <>
		The prober retried: {output.error}
	</> : state === "output-error" ? "The assessment was malformed — the prober retried with a corrected one."
		: !strands ? "Writing the assessment…" : null;

	if (note || !strands) return (
		<div data-testid="probe-done-card" className="my-3 rounded-xl border bg-card/60 p-3">
			<div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{heading}
			</div>
			<p className="text-sm text-muted-foreground">{note}</p>
		</div>
	);

	return (
		<details data-testid="probe-done-card" className="group my-3 overflow-hidden rounded-xl border bg-card/60">
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/40 group-open:rounded-b-none group-open:border-b [&::-webkit-details-marker]:hidden">
				{heading}
				<span className="ml-auto shrink-0 font-normal normal-case tracking-normal text-muted-foreground/70">
					{strands.length} strand{strands.length === 1 ? "" : "s"}
				</span>
				<ChevronRightIcon className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="divide-y">
				{strands.map((s, i) => (
					<div key={i} className="px-3 py-2">
						<ToolContentResponse className="text-sm font-medium">{s.strand}</ToolContentResponse>
						<ToolContentResponse className="mt-0.5 text-sm text-muted-foreground">{s.assessment}</ToolContentResponse>
					</div>
				))}
				{assessment?.summary && (
					<div className="px-3 py-2">
						<ToolContentResponse className="text-sm text-muted-foreground">{assessment.summary}</ToolContentResponse>
					</div>
				)}
			</div>
		</details>
	);
}
