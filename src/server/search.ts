/**
 * La composición en el servidor de los motores de búsqueda (oleada del puerto
 * de búsqueda + ranuras de modelo, 2026-09-20): adaptadores de búsqueda tras
 * el puerto del núcleo (core/search.ts) + la resolución del motor vivo que
 * leen tanto la interfaz de ajustes como la herramienta de la capa del agente.
 *
 * Decisiones del responsable (2026-09-20) incorporadas:
 *  - SIN motor por defecto: un motor está vivo si y solo si su clave está
 *    presente (almacén de autenticación o entorno; gana el entorno, con clave
 *    mediante keyValue de server/keys.ts).
 *  - Definir una clave es TODO lo que hace el usuario; detección automática:
 *    un agent.search.engine explícito fija la preferencia (si hay varias claves
 *    presentes, el orden es Tavily → Brave → Exa → Firecrawl → Ollama); sin
 *    fijación, gana el primer motor con clave.
 *  - Una elección explícita NO recurre en silencio a otro motor: motor fijado
 *    pero sin su clave = no disponible, dicho con honestidad (el motivo lo
 *    indica); no se adivina lo que quería el usuario.
 *
 * Los adaptadores son dependencias inyectadas (con forma de fetch) para que la
 * herramienta de la capa del agente dependa solo del PUERTO y las pruebas
 * nunca toquen la red.
 */

import { SEARCH_ENGINES, type SearchEngineId, type SearchHit, type SearchProvider, type SearchStatus } from "../core/search.ts";
import { keyValue } from "./keys.ts";
import { effectiveSettings } from "./stores.ts";

/** La forma invocable por la red que envuelven los adaptadores (las pruebas inyectan un sustituto). */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Tavily: POST https://api.tavily.com/search, con autenticación Bearer en la
 *  cabecera Authorization (el esquema documentado actual; la forma heredada con
 *  api_key en el cuerpo está retirada), query + max_results (0–20) en el cuerpo
 *  JSON. VERIFICADO contra el OpenAPI de docs.tavily.com, 2026-09-20: respuesta
 *  {results: [{title, url, content, score, …}]}, errores {detail: {error}}. */
export function tavilyProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "tavily",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.tavily.com/search", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ query, max_results: Math.min(count, 20) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) {
				const body = await resp.text();
				// Su cuerpo de error es {detail: {error: "…"}}: se muestra el mensaje si está
				// presente o, si no, el fragmento en bruto.
				let detail = body.slice(0, 200);
				try {
					const parsed = JSON.parse(body) as { detail?: { error?: string } };
					if (parsed.detail?.error) detail = parsed.detail.error.slice(0, 200);
				} catch {
					/* se mantiene el fragmento en bruto */
				}
				throw new Error(`Tavily search API ${resp.status}: ${detail}`);
			}
			const data = (await resp.json()) as {
				results?: Array<{ title?: string; url?: string; content?: string }>;
			};
			return (data.results ?? [])
				.filter((r) => typeof r.url === "string" && r.url)
				.map((r) => ({
					title: r.title ?? r.url ?? "",
					url: r.url ?? "",
					snippet: (r.content ?? "").replace(/\n/g, " ").slice(0, 500),
				}));
		},
	};
}

/** Brave: GET https://api.search.brave.com/res/v1/web/search con la clave en
 *  la cabecera X-Subscription-Token. VERIFICADO contra la documentación del
 *  panel de Brave, 2026-09-20: count máximo 20; respuesta
 *  {web: {results: [{title, url, description, …}]}}. */
export function braveProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "brave",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const url = new URL("https://api.search.brave.com/res/v1/web/search");
			url.searchParams.set("q", query);
			url.searchParams.set("count", String(Math.min(count, 20)));
			const resp = await fetchFn(url.toString(), {
				headers: {
					accept: "application/json",
					"x-subscription-token": apiKey,
				},
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) {
				const body = await resp.text();
				throw new Error(`Brave search API ${resp.status}: ${body.slice(0, 200)}`);
			}
			const data = (await resp.json()) as {
				web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
			};
			return (data.web?.results ?? [])
				.filter((r) => typeof r.url === "string" && r.url)
				.map((r) => ({
					title: r.title ?? r.url ?? "",
					url: r.url ?? "",
					snippet: (r.description ?? "").replace(/\n/g, " ").slice(0, 500),
				}));
		},
	};
}

/** Un JSON no válido no debe reproducir los cuerpos de respuesta del proveedor en los resultados de las herramientas. */
async function searchJson(response: Response, label: string): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new Error(`${label} search API returned an invalid response`);
	}
}

/** La API de búsqueda de Exa devuelve fragmentos destacados si se piden. Sus
 * fragmentos de resultado se normalizan a la misma forma acotada y neutral
 * respecto al proveedor que la de los demás adaptadores. No se exponen los
 * cuerpos de error, que pueden contener credenciales. */
export function exaProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "exa",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.exa.ai/search", {
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": apiKey },
				body: JSON.stringify({ query, type: "auto", numResults: Math.min(100, Math.max(1, Math.floor(count))), contents: { highlights: true } }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Exa search API ${resp.status}`);
			const data = await searchJson(resp, "Exa");
			if (!data || typeof data !== "object" || !Array.isArray((data as { results?: unknown }).results)) {
				throw new Error("Exa search API returned an invalid response");
			}
			return (data as { results: unknown[] }).results.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; highlights?: unknown; text?: unknown };
				if (typeof row.url !== "string" || !row.url.trim()) return [];
				try {
					const protocol = new URL(row.url).protocol;
					if (protocol !== "http:" && protocol !== "https:") return [];
				} catch { return []; }
				const highlights = Array.isArray(row.highlights) ? row.highlights.filter((v): v is string => typeof v === "string").join(" ") : "";
				const snippet = highlights || (typeof row.text === "string" ? row.text : "");
				return [{ title: typeof row.title === "string" && row.title ? row.title : row.url, url: row.url, snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 500) }];
			});
		},
	};
}

/** La API de búsqueda v2 de Firecrawl: sin scrapeOptions, así que web_fetch
 *  sigue encargándose del cuerpo de las páginas. La forma en la red se
 *  comprobó contra la instantánea oficial del 2026-11-03; el acceso real de la
 *  cuenta y los precios no se deducen de la configuración. */
export function firecrawlProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "firecrawl",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.firecrawl.dev/v2/search", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ query, limit: Math.min(100, Math.max(1, Math.floor(count))) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Firecrawl search API ${resp.status}`);
			const data = await searchJson(resp, "Firecrawl");
			if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
				throw new Error("Firecrawl search API returned an invalid response");
			}
			const payload = (data as { data?: unknown }).data;
			if (!payload || typeof payload !== "object" || !Array.isArray((payload as { web?: unknown }).web)) {
				throw new Error("Firecrawl search API returned an invalid response");
			}
			return (payload as { web: unknown[] }).web.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; description?: unknown };
				return searchHit(row.title, row.url, row.description);
			});
		},
	};
}

/** Solo búsqueda alojada, adaptada del PR #81 de chiranjivsethi (a216fa8).
 *  Sin URL de modelo local, registro de modelos ni descarga de páginas respaldada por un proveedor. */
export function ollamaProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "ollama",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://ollama.com/api/web_search", {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({ query, max_results: Math.min(10, Math.max(1, Math.floor(count))) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Ollama search API ${resp.status}`);
			const data = await searchJson(resp, "Ollama");
			if (!data || typeof data !== "object" || !Array.isArray((data as { results?: unknown }).results)) {
				throw new Error("Ollama search API returned an invalid response");
			}
			return (data as { results: unknown[] }).results.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; content?: unknown };
				return searchHit(row.title, row.url, row.content);
			});
		},
	};
}

/** Se ajusta al contrato de resultados acotados de Exa para los demás adaptadores nuevos. */
function searchHit(title: unknown, url: unknown, snippet: unknown): SearchHit[] {
	if (typeof url !== "string" || !url.trim()) return [];
	try {
		const protocol = new URL(url).protocol;
		if (protocol !== "http:" && protocol !== "https:") return [];
	} catch { return []; }
	return [{
		title: typeof title === "string" && title ? title : url,
		url,
		snippet: typeof snippet === "string" ? snippet.replace(/\s+/g, " ").trim().slice(0, 500) : "",
	}];
}

/** La clave del motor (entorno o fichero; gana el entorno); null cuando el
 *  motor no tiene clave, lo que por decisión del responsable significa NO VIVO. */
function engineKey(id: SearchEngineId): string | null {
	const envVar = SEARCH_ENGINES.find((e) => e.id === id)?.envVar;
	const value = envVar ? keyValue(envVar) : undefined;
	return value ? value : null;
}

/** La clave viva de cada motor, leída de nuevo (la entrada del resolutor). */
function engineKeys(): Partial<Record<SearchEngineId, string>> {
	const keys: Partial<Record<SearchEngineId, string>> = {};
	for (const { id } of SEARCH_ENGINES) {
		const key = engineKey(id);
		if (key) keys[id] = key;
	}
	return keys;
}

/** Resuelve el estado de búsqueda DE FORMA PURA a partir de las fijaciones
 *  dadas (comprobable): el motor explícito (si está fijado) gana, pero debe
 *  tener clave; sin fijación → el primer motor con clave en orden de
 *  preferencia. Nunca lanza. */
export function resolveSearchEngineFor(
	pinned: SearchEngineId | undefined,
	/** Claves vivas por motor (motor ausente = propiedad ausente, sin problema). */
	keys: Partial<Record<SearchEngineId, string | undefined>>,
): SearchStatus & { key: string | null } {
	const pinnedKey = pinned ? keys[pinned] ?? null : null;
	if (pinned) {
		if (!pinnedKey) {
			return {
				available: false,
				engine: null,
				reason: `search engine is set to "${pinned}" but its API key is missing — set the ${SEARCH_ENGINES.find((e) => e.id === pinned)?.envVar} key`,
				key: null,
			};
		}
		return { available: true, engine: pinned, reason: `search engine: ${pinned} (chosen)`, key: pinnedKey };
	}
	for (const { id } of SEARCH_ENGINES) {
		const key = keys[id] ?? null;
		if (key) return { available: true, engine: id, reason: `search engine: ${id} (auto)`, key };
	}
	return {
		available: false,
		engine: null,
		reason: "no search engine configured — set a Tavily, Brave, Exa, Firecrawl, or Ollama search API key",
		key: null,
	};
}

/** El estado de búsqueda vivo (la señal honesta de disponibilidad): lee la
 *  fijación del registro de ajustes + el almacén de autenticación de nuevo en
 *  cada llamada, así que una clave guardada a mitad de sesión se activa en la
 *  siguiente comprobación (sin reiniciar). */
export function searchStatus(): SearchStatus {
	const { available, engine, reason } = resolveSearchEngineFor(
		effectiveSettings().agent.search?.engine,
		engineKeys(),
	);
	return { available, engine, reason };
}

/** Solo el estado de la búsqueda; research sigue disponible sin clave. */
export function searchAvailable(): boolean {
	return searchStatus().available;
}

/** El adaptador VIVO, o null si no está disponible. Se compone de nuevo en
 *  cada llamada; la capa de herramientas (flujo del profesor) lo llama una vez
 *  por búsqueda, así que las rotaciones de claves surten efecto al momento. */
export function searchProvider(): SearchProvider | null {
	const resolved = resolveSearchEngineFor(effectiveSettings().agent.search?.engine, engineKeys());
	if (!resolved.available || !resolved.key) return null;
	switch (resolved.engine) {
		case "tavily":
			return tavilyProvider(resolved.key);
		case "brave":
			return braveProvider(resolved.key);
		case "exa":
			return exaProvider(resolved.key);
		case "firecrawl":
			return firecrawlProvider(resolved.key);
		case "ollama":
			return ollamaProvider(resolved.key);
		default:
			return null;
	}
}
