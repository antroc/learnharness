"use client";

import { CircleX } from "lucide-react";
import type { PdfResult, ResearchResult, SubagentArtifactData } from "@/src/core";
import type { LhViewMessage, PluginBackgroundResult, SubagentResultMeta } from "@/src/core";
import { isSubagentFailure } from "@/src/core";
import { DemoOutputCard } from "@/components/artifacts/demo-card";
import { PdfBriefCard, ResearchBriefCard } from "@/components/artifacts/job-card";
import { VisualOutputCard } from "@/components/artifacts/visual-card";
import { PluginWorkerCard } from "@/components/artifacts/plugin-worker-card";
import { WorkerResultDetails } from "@/components/artifacts/worker-result-presentation";

/**
 * La tarjeta de entrega del resultado del subagente (contracts.ts "THE ASYNC
 * PROTOCOL" §4).
 *
 * Cuando una tarea en segundo plano termina, el proceso de despertar inyecta
 * un mensaje de REORIENTACIÓN en la transcripción: un UIMessage con rol de
 * usuario cuya parte de datos ("data-subagent-artifact") lleva el resultado.
 * Se renderiza como artefacto, NUNCA como burbuja del alumno ni envuelto en un
 * contenedor de mensaje:
 *
 *   research — una línea discreta "Research complete" que se despliega a
 *     demanda (<details> nativo) hasta el informe completo persistido + las
 *     fuentes: el informe es demasiado largo para mostrarlo en línea por
 *     defecto y el turno de despertar del profesor lo integra de todos modos
 *     en la lección. Los fallos conservan la tarjeta de fallo (el informe
 *     explica qué salió mal).
 *   demo / visual — el propio artefacto (iframe aislado / SVG saneado). Las
 *     notas de verificación del subagente son pegamento dirigido al modelo y
 *     NO se renderizan; solo se renderiza una nota de fallo.
 *   plugin — el resultado aparte y posterior de la tarea, con un renderer de
 *     herramienta registrado opcional y una alternativa legible persistida
 *     (la llamada conserva su acuse).
 */
export function SubagentSteerCard({ message }: { message: LhViewMessage }) {
	const artifactPart = message.parts.find((p) => p.type === "data-subagent-artifact");
	const data = artifactPart?.data as SubagentArtifactData | undefined;
	// La reorientación de aborto (semántica del dock de 2026-09): su parte de tipo de mensaje es
	// data-subagent-aborted (el esquema de mensajes personalizados: la parte, no los
	// metadatos, es el marcador); una etiqueta discreta, reflejo de la insignia de completado.
	if (!data) {
		const aborted = message.parts.find((p) => p.type === "data-subagent-aborted") as
			| { data?: { kind?: string; failure?: string } }
			| undefined;
		// Los fallos de recuperación/entrega comparten esta familia de marcadores, pero no son
		// abortos del alumno y no se inventan un resultado para una tarea ilegible.
		if (typeof aborted?.data?.failure === "string") return (
			<div data-testid="job-delivery-failure" role="alert" className="space-y-1 rounded-xl border bg-card p-4 text-sm">
				<p className="font-medium">Background job recovery/delivery failed</p>
				<p className="whitespace-pre-wrap break-words text-muted-foreground">{aborted.data.failure}</p>
			</div>
		);
		if (aborted?.data) return <AbortedBadge kind={aborted.data.kind ?? "job"} />;
		return (
				<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				A sub-agent finished, but its result could not be displayed.
			</div>
		);
	}
	switch (data.kind) {
		case "plugin": {
			const meta = (message.metadata as { subagentResult?: SubagentResultMeta } | undefined)?.subagentResult;
			return <PluginWorkerCard result={data.result as PluginBackgroundResult} toolCallId={meta?.toolCallId ?? ""} />;
		}
		case "research":
			return isSubagentFailure("research", data.result as ResearchResult) ? (
				<ResearchBriefCard output={data.result} />
			) : (
				<ResearchCompleteBadge result={data.result as ResearchResult} />
			);
		case "pdf":
			return isSubagentFailure("pdf", data.result as PdfResult) ? (
				<PdfBriefCard output={data.result} />
			) : (
				<PdfCompleteBadge result={data.result as PdfResult} />
			);
		case "demo":
			return <DemoOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
		case "visual":
			return <VisualOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
	}
}

/** La etiqueta de tarea abortada: refleja la línea de la insignia de
 * completado; el turno de despertar del profesor reconoce el aborto en la
 * propia lección, esto solo marca lo que pasó. */
function AbortedBadge({ kind }: { kind: string }) {
	return (
		<div data-testid="job-aborted-badge" className="flex items-center gap-2 text-xs text-muted-foreground">
			<CircleX className="size-3.5" />
			<span className="font-medium uppercase tracking-wide">{kind}</span>
			<span>aborted by the learner</span>
		</div>
	);
}

/** Línea discreta, el idioma de la insignia de investigación llevado al PDF:
 * el informe es demasiado largo para mostrarlo en línea por defecto y el
 * turno de despertar del profesor lo integra; la insignia marca la entrega y
 * los detalles plegados llevan el texto completo + las páginas consultadas. */
function PdfCompleteBadge({ result }: { result: PdfResult }) {
	// La cuenta honesta son las páginas LEÍDAS (extract/render; separación de fuentes v1);
	// el ?? es tolerancia en tiempo de ejecución para reorientaciones persistidas anteriores a la separación.
	const readPages = result.pagesRead ?? result.pagesConsulted;
	return (
		<WorkerResultDetails testId="pdf-complete-badge" heading={<>
				<span className="font-medium uppercase tracking-wide">PDF</span>
				<span>reading complete</span>
				{readPages.length > 0 && (
					<span>
						· read {readPages.length} page{readPages.length === 1 ? "" : "s"}
					</span>
				)}
			</>}>
			<PdfBriefCard output={result} />
		</WorkerResultDetails>
	);
}

/** Línea discreta, el idioma de despacho asentado: la lección vive en el
 * turno de despertar del profesor; la insignia solo marca la entrega. El
 * informe persistido viaja en un <details> plegado (la indicación "view full
 * research" de la oleada 1): markdown completo + fuentes, a un clic, sin
 * petición adicional; la parte de artefacto del registro es la única fuente
 * de verdad. */
function ResearchCompleteBadge({ result }: { result: ResearchResult }) {
	return (
		<WorkerResultDetails testId="research-complete-badge" heading={<>
				<span className="font-medium uppercase tracking-wide">Research</span>
				<span>complete</span>
				{result.sources.length > 0 && <span>· {result.sources.length} sources</span>}
			</>}>
			<ResearchBriefCard output={result} />
		</WorkerResultDetails>
	);
}
