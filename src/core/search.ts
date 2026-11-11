/**
 * El puerto del proveedor de búsqueda (oleada del puerto de búsqueda + ranuras de
 * modelo, 2026-09-20).
 *
 * Los motores de búsqueda son intercambiables detrás de UNA frontera: el registro de
 * ajustes nombra un motor preferido (agent.search.engine — opcional), las claves viven
 * en el almacén de autenticación (el catálogo de claves seleccionado) y el servidor
 * compone el adaptador activo.
 *
 * Decisiones del responsable incorporadas aquí:
 *  - SIN motor por defecto en el registro de fábrica: un motor está activo si y solo si
 *    su clave está presente. Con una clave, el motor se activa solo (el usuario nunca
 *    elige un motor para que funcione la búsqueda — basta con poner la clave);
 *    agent.search.engine es solo una preferencia explícita.
 *  - Nada recurre en silencio a una alternativa: sin motor activo = la búsqueda no está
 *    disponible, y se dice con honestidad (la herramienta lo indica). La investigación
 *    sigue disponible sin claves mediante web_fetch para URL conocidas.
 *
 * Solo tipos puros, la tabla de motores + la documentación del protocolo (seguro para
 * el navegador, sin importaciones de node): los adaptadores están en el servidor
 * (src/server/search.ts) y llegan como dependencias inyectadas — la herramienta de la
 * capa del agente depende solo de ESTE puerto.
 */

/** Una fila de resultado de búsqueda — la forma que debe producir todo adaptador (el
 * contrato de la herramienta del investigador; los mismos campos que emitía el antiguo
 * adaptador de Google). */
export interface SearchHit {
	title: string;
	url: string;
	snippet: string;
}

/** Motores de búsqueda en orden automático de preferencia. Mantén estables las preferencias
 * existentes al añadir un motor: una fijación explícita siempre gana. */
export const SEARCH_ENGINES = [
	{ id: "tavily", label: "Tavily", envVar: "TAVILY_API_KEY" },
	{ id: "brave", label: "Brave", envVar: "BRAVE_API_KEY" },
	{ id: "exa", label: "Exa", envVar: "EXA_API_KEY" },
	{ id: "firecrawl", label: "Firecrawl", envVar: "FIRECRAWL_API_KEY" },
	{ id: "ollama", label: "Ollama", envVar: "OLLAMA_API_KEY" },
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]["id"];

/** La comprobación de pertenencia de las barreras de lectura/escritura (registro de ajustes + cuerpo del PUT). */
export function isSearchEngineId(value: unknown): value is SearchEngineId {
	return SEARCH_ENGINES.some((engine) => engine.id === value);
}

/** Un motor de búsqueda activo: un id (para estado/etiquetas) + una operación. Los
 * adaptadores son dueños de su protocolo de red (fetch, tiempos de espera, traducción
 * de errores) — los llamadores solo ven esto. `search` lanza una excepción si falla
 * (los adaptadores convierten los errores HTTP en mensajes de Error claros); la capa de
 * herramientas los captura e informa. */
export interface SearchProvider {
	id: SearchEngineId;
	search(query: string, count: number): Promise<SearchHit[]>;
}

/** Por qué la búsqueda está (o no) disponible — el estado honesto a partir del que se
 * explican la interfaz y la capa de herramientas. `engine` es el motor ACTIVO cuando lo hay. */
export interface SearchStatus {
	available: boolean;
	/** El motor activo (null si no hay ninguno disponible). */
	engine: SearchEngineId | null;
	/** El motivo en una línea del estado (texto de estado para la interfaz). */
	reason: string;
}
