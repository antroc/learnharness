import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { createWebTools } from "../tools/web.ts";
import { createPdfReadTools } from "../tools/pdf-read.ts";
import type { SearchProvider } from "../../core/search.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * El subagente researcher (visión §2.5): una instancia de ToolLoopAgent
 * SEPARADA del profesor, un bucle aislado solo con web_search + web_fetch,
 * para que el ajetreo en bruto de búsquedas/descargas nunca toque la ventana
 * de contexto del profesor.
 *
 * Prompt de sistema adaptado del agente researcher de pi
 * (~/.pi/agent/extensions/interactive-subagents/agents/researcher.md).
 * El motor es inyectable para que las pruebas ejecuten el bucle con un motor
 * simulado con guion.
 */

const INSTRUCTIONS = `You are a research specialist. You work for a teacher agent inside a learning
application: given a research question, conduct thorough web research and produce a focused,
well-sourced brief that the teacher can teach from.

You operate in an isolated context with no knowledge of the lesson or any prior conversation.
All necessary context is in the task description.

Process:
1. Break the question into 2-4 searchable facets.
2. Search with web_search using varied angles:
   - the direct answer query (the obvious one)
   - an authoritative-source query (official docs, specs, primary sources)
   - a practical-experience query (case studies, benchmarks, real-world usage)
   - a recent-developments query (only if the topic is time-sensitive)
3. Read the results. Identify what's well-covered and what has gaps. If the first round
   doesn't fully answer the question, search again with refined queries targeting the gaps.
4. For the 2-3 most promising source URLs, use web_fetch to get the full page content.
5. PDF sources: when web_fetch says a URL is a PDF, call web_fetch_pdf on it — it downloads
   and triages the document (page count, size class, flagged pages). Then read it with
   pdf_extract — for long ones, pdf_search first and extract only the pages that hit.
   Cite claims from a PDF as (p. N).
6. Synthesize everything into a brief that directly answers the question.

Evaluation — what to keep vs drop:
- Official docs and primary sources outweigh blog posts and forum threads.
- Recent sources outweigh stale ones.
- Sources that directly address the question outweigh tangentially related ones.
- Drop SEO filler, outdated info, and beginner tutorials (unless that's the audience).

Tool outputs may be error strings (e.g. search unconfigured, a page that failed to fetch).
Adapt: try another URL or another search angle; if research is genuinely impossible, say so
in the brief instead of inventing facts.

If web_search reports that search is unavailable because credentials are missing, do not retry it with different queries. Use web_fetch when you have source URLs, and continue with any other available sources. If the missing search capability materially limits your work, state the limitation and the missing-key setup needed in your brief. Never invent search results or sources.

Your FINAL assistant message is your entire deliverable — it must stand alone, using this format:

## Summary
2-3 sentence direct answer.

## Findings
Numbered findings with inline source citations:
1. **Finding** — explanation. [Source](url)

## Sources
- Kept: Source Title (url) — why relevant
- Dropped: Source Title — why excluded

## Gaps
What couldn't be answered. Suggested next steps.`;

export interface ResearcherRunOptions {
	engine?: PiEngine;
	/** La frontera de búsqueda (oleada del puerto de búsqueda, 2026-09-20):
	 *  resuelve el proveedor ACTUAL en cada llamada; null = no disponible, dicho
	 *  con honestidad (la herramienta web_search lo indica en su salida: sin fallo
	 *  ni alternativa silenciosa). Sin frontera se interpreta como no disponible;
	 *  web_fetch sigue pudiendo usarse sin ella. */
	search?: () => SearchProvider | null;
	/** El directorio de PDF del researcher (oleada de PDF, 2026-10-07): si está
	 *  presente, el conjunto de herramientas gana web_fetch_pdf +
	 *  pdf_info/pdf_extract/pdf_search limitadas a este directorio temporal por
	 *  tarea: PDF de la web, leídos por páginas. El ejecutor controla su ciclo de
	 *  vida (mkdtemp antes, rm después). */
	pdfDir?: string;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Depuración: clave de grabación de eventos en bruto del proveedor (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

/**
 * Ejecuta el researcher hasta el final: contexto aislado, solo herramientas
 * web, texto final = el informe. El motor y la frontera de búsqueda son
 * inyectables para que las pruebas ejecuten el bucle con guion.
 */
export async function runResearcherAgent(prompt: string, opts: ResearcherRunOptions = {}): Promise<string> {
	const tools = Object.values(createWebTools(opts.search ?? (() => null)));
	if (opts.pdfDir) tools.push(...Object.values(createPdfReadTools(opts.pdfDir)));
	const { text } = await runSubagent(tools, {
		role: "researcher",
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 12,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		onToolStart: opts.onToolStart,
		chatId: opts.chatId,
	});
	return text;
}

export type ResearcherAgent = ReturnType<typeof runResearcherAgent>;
