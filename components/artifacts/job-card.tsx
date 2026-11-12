"use client";

import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { MessageResponse } from "@/components/ai-elements/message";
import { isWebSourceUrl, type ArtifactPartProps, type PdfResult, type ResearchResult } from "@/src/core";

/**
 * El cuadro de llamada a la herramienta de investigación (contracts.ts
 * "THE ASYNC PROTOCOL" §4).
 *
 * La salida de la parte es el ACUSE del despacho de lanzar y olvidar; el
 * cuadro en sí es la DispatchCard (estado en directo a través del feed de
 * tareas de la vista de chat; una línea discreta una vez entregado). El
 * informe de investigación ya no se renderiza en absoluto desde la parte de
 * herramienta: viaja en el mensaje de reorientación (la entrega con rol de
 * usuario inyectada tras el turno de despertar) y se renderiza allí mediante
 * ResearchBriefCard.
 */
export function JobCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="research" />;
}

/**
 * El cuadro de despacho de pdf (fuentes v0): el mismo idioma del protocolo
 * asíncrono que JobCard: la salida de acuse alimenta una DispatchCard (estado
 * en directo de "PDF reader" a través del feed de tareas de la vista de
 * chat); el informe en sí viaja en el mensaje de reorientación y se renderiza
 * bajo la insignia de PDF completado en la transcripción.
 */
export function PdfJobCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="pdf" />;
}

/**
 * El informe de lectura del PDF (fuentes v0): cuerpo markdown + la línea de
 * páginas consultadas. Se exporta: la tarjeta de reorientación lo renderiza
 * bajo la insignia de PDF completado, el mismo idioma de desplegar a
 * demanda que la investigación.
 */
export function PdfBriefCard({ output }: { output: unknown }) {
	const result = output as PdfResult | undefined;
	if (!result || typeof result.brief !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				PDF reading completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.brief.startsWith("PDF failed");
	// Leídas = la salida de extract/render entró en el bucle; consultadas = todas las páginas,
	// incluidos los resultados de búsqueda (el conjunto completo de auditoría; las citas del informe pueden apuntar
	// allí). Las alternativas ?? toleran los registros persistidos anteriores a la separación.
	const readList = result.pagesRead ?? result.pagesConsulted ?? [];
	const consultedList = result.pagesConsulted ?? [];
	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="pdf-brief-card">
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				PDF brief
				{failed && <span className="rounded bg-error/15 px-1.5 py-0.5 text-error">failed</span>}
			</div>
			<div className="text-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
				<MessageResponse>{result.brief}</MessageResponse>
			</div>
			{!failed && readList.length > 0 && (
				<div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
					Pages read: {readList.join(", ")}
				</div>
			)}
			{!failed && consultedList.length > readList.length && (
				<div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
					Pages consulted: {consultedList.join(", ")}
				</div>
			)}
		</div>
	);
}

/**
 * El informe de investigación: cuerpo markdown + una pequeña lista de enlaces
 * a fuentes. Se exporta: la tarjeta de reorientación (entrega del resultado
 * del subagente) renderiza el mismo artefacto.
 */
export function ResearchBriefCard({ output }: { output: unknown }) {
	const result = output as ResearchResult | undefined;
	if (!result || typeof result.brief !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Research completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.brief.startsWith("Research failed");
	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="research-brief-card">
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Research brief
				{failed && <span className="rounded bg-error/15 px-1.5 py-0.5 text-error">failed</span>}
			</div>
			<div className="text-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
				<MessageResponse>{result.brief}</MessageResponse>
			</div>
			{result.sources.length > 0 && (
				<div className="mt-3 border-t pt-2">
					<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</div>
					<ul className="flex flex-col gap-0.5 text-xs">
						{result.sources.map((s) => (
							<li key={s.url} className="truncate">
								{isWebSourceUrl(s.url) ? (
									<a
										href={s.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary underline-offset-2 hover:underline"
									>
										{s.title}
									</a>
								) : (
									// Guardado antes de que las fuentes se limitaran a http(s): nunca es un enlace.
									<span className="text-muted-foreground">{s.title}</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
