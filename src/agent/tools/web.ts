import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { safeFetch } from "./safe-fetch.ts";
// La forma de un resultado de búsqueda vive en el puerto de core desde la oleada de búsqueda
// (2026-09-20); este alias evita cambios en los llamadores.
import type { SearchHit as WebSearchResult, SearchProvider } from "../../core/search.ts";
export type { WebSearchResult };
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

/**
 * Herramientas web del lado del servidor para el subagente investigador: un port mínimo de las
 * extensiones de pi (~/.pi/agent/extensions/web-search + web-fetch):
 *
 *   web_search(query, count?) → {title, url, snippet}[]   (puerto de búsqueda inyectado)
 *   web_fetch(url)            → texto markdown legible     (Readability + Turndown,
 *                                                          Jina Reader como respaldo para
 *                                                          páginas renderizadas con JS)
 *
 * RECONEXIÓN DE LA BÚSQUEDA (oleada del puerto de búsqueda, 2026-09-20): el backend de Google CSE
 * se retira; web_search se ejecuta ahora sobre el puerto de búsqueda inyectado (core/search.ts).
 * El adaptador real (server/search.ts) llega como DEPENDENCIA
 * (ley de importación: esta herramienta depende del puerto de core, nunca de código del servidor). NADA
 * de respaldo silencioso (decisión del responsable): sin proveedor → la búsqueda no está disponible,
 * con honestidad. El despacho de research y web_fetch sin clave siguen disponibles.
 *
 * Contrato de herramienta: NUNCA lanzar dentro del bucle del agente: la falta de proveedor y
 * todo camino de fallo devuelven un STRING de error claro como salida de la herramienta, para que el
 * investigador pueda adaptarse (o informar) en lugar de romperse.
 */

// ── web_search ───────────────────────────────────────────────────────────────
// (WebSearchResult es el SearchHit de core, reexportado arriba).

// ── web_fetch ────────────────────────────────────────────────────────────────

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Mantiene cuerdo el contexto del investigador: las páginas largas se truncan con una marca. */
const MAX_CONTENT_CHARS = 40_000;
const MIN_USEFUL_CONTENT = 200;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function truncate(text: string): string {
	if (text.length <= MAX_CONTENT_CHARS) return text;
	return `${text.slice(0, MAX_CONTENT_CHARS)}\n\n[Truncated at ${MAX_CONTENT_CHARS} characters]`;
}

/** Jina Reader como respaldo para páginas renderizadas con JS (sin dependencias: fetch simple). */
async function fetchViaJina(url: string): Promise<string | null> {
	try {
		const res = await fetch(`https://r.jina.ai/${url}`, {
			headers: { Accept: "text/markdown", "X-No-Cache": "true" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) return null;
		const content = await res.text();
		const marker = "Markdown Content:";
		const start = content.indexOf(marker);
		if (start < 0) return null;
		const markdown = content.slice(start + marker.length).trim();
		if (markdown.length < MIN_USEFUL_CONTENT || markdown.startsWith("Loading...")) return null;
		return markdown;
	} catch {
		return null;
	}
}

function htmlToMarkdown(html: string): { title: string; content: string } | null {
	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document).parse();
	if (!article?.content) return null;
	const markdown = turndown.turndown(article.content);
	if (markdown.trim().length < MIN_USEFUL_CONTENT) return null;
	return { title: article.title ?? "", content: markdown };
}

async function fetchAndExtract(url: string): Promise<string> {
	const resp = await safeFetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

	// URL final tras las redirecciones + estado: la única forma que tiene el investigador
	// de distinguir una página real de un cuerpo de error servido con 200 (caso
	// "ill-formed request" del que informó el responsable: respondió el SITIO, nosotros solo lo transmitimos).
	const sourceLine = `Source: ${resp.url || url} (HTTP ${resp.status})`;

	const contentType = resp.headers.get("content-type") ?? "";
	if (contentType.includes("application/pdf")) {
		// Una indicación, no un callejón sin salida (oleada de PDF del investigador, 2026-10-07): la
		// herramienta web_fetch_pdf del investigador descarga + hace el triaje de los PDF.
		return `web_fetch: this URL is a PDF document — call web_fetch_pdf on it to download and read it.`;
	}
	if (/image\/|audio\/|video\/|zip|octet-stream/.test(contentType)) {
		throw new Error(`Unsupported content type: ${contentType.split(";")[0]}`);
	}
	const length = Number(resp.headers.get("content-length") ?? 0);
	if (length > MAX_RESPONSE_BYTES) throw new Error("Response too large");

	const text = await resp.text();
	if (!contentType.includes("html")) return `${sourceLine}\n\n${truncate(text)}`; // texto plano / markdown / código

	const extracted = htmlToMarkdown(text);
	if (extracted) {
		const header = extracted.title ? `# ${extracted.title}\n\n${sourceLine}\n\n---\n\n` : `${sourceLine}\n\n---\n\n`;
		return header + truncate(extracted.content);
	}
	// Readability ha fallado: probablemente renderizada con JS. Probar Jina Reader.
	const jina = await fetchViaJina(url);
	if (jina) return truncate(jina);
	throw new Error("Could not extract readable content (the page may be JavaScript-rendered)");
}

// ── registro de herramientas ─────────────────────────────────────────────────

const webSearchInput = Type.Object({
	query: Type.String({ description: "The search query (a normal search string, phrases included)" }),
	count: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 10, description: "Number of results (default 5, max 10)" }),
	),
});

const webFetchInput = Type.Object({
	url: Type.String({ description: "The URL to fetch" }),
});

export function createWebTools(search: () => SearchProvider | null): Record<string, AgentTool<any>> {
	return {
		web_search: {
			name: "web_search",
			label: "web_search",
			description: "Search the web. One search per call — use one call per search angle. " +
				"Returns an array of results with title, url, and snippet.",
			parameters: webSearchInput,
			execute: serverExecute("web_search", webSearchInput, async ({ query, count }): Promise<WebSearchResult[] | string> => {
				const provider = search();
				if (!provider) {
					return (
						"web_search is not available: no search engine is configured. " +
						"Set a Tavily, Brave, Exa, Firecrawl, or Ollama search API key in settings. Report in your brief that web search is unavailable."
					);
				}
				try {
					return await provider.search(query, count ?? 5);
				} catch (err) {
					return `web_search failed: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		},

		web_fetch: {
			name: "web_fetch",
			label: "web_fetch",
			description:
				"Fetch a web page and extract its readable content as markdown (Readability). " +
				"Handles HTML pages and plain text; JS-rendered pages fall back to a reader service.",
			parameters: webFetchInput,
			execute: serverExecute("web_fetch", webFetchInput, async ({ url }): Promise<string> => {
				try {
					const parsed = new URL(url);
					// URL.protocol lleva DOS PUNTOS AL FINAL ("https:", WHATWG): la
					// comparación sin dos puntos nacida del port de py-harness (el scheme de urlparse
					// NO lleva dos puntos) rechazaba todas las URL válidas que se intentaban descargar
					// (informado por el responsable a partir de los logs de OpenRouter, 2026-10-07).
					if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
						throw new Error("Only http(s) URLs are supported");
				} catch {
					return `web_fetch failed: invalid URL "${url}"`;
				}
				try {
					return await fetchAndExtract(url);
				} catch (err) {
					return `web_fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		},
	};
}

/** El tope de seguridad sin proveedor (las pruebas fijan la forma con él; el ejecutor
 *  siempre inyecta la frontera real: una frontera ausente se interpreta como no disponible,
 *  nunca como un fallo ni como un motor alternativo silencioso). */
export const webTools = createWebTools(() => null);
