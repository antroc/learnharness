/**
 * Auxiliares de presentación de dinero/tokens (interfaz de observabilidad de
 * la oleada 4) — compartidos por el dock de actividad y la barra de
 * estadísticas. Puros; exportados para las pruebas.
 */

/** USD para importes del orden de céntimos: >= $1 lleva dos decimales, menos lleva cuatro. */
export function formatUsd(c: number): string {
	return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`;
}

export function planCostLabel(dollars: number | null, subscription: boolean | string | readonly string[] | undefined, format = formatUsd): string {
	const labels = subscription === true ? ["ChatGPT"] : typeof subscription === "string" ? [subscription] : Array.isArray(subscription) ? [...new Set(subscription)] : [];
	return [...(dollars === null ? [] : [format(dollars)]), ...labels].join(" + ") || "—";
}

/** 38000 → "38k", 1234567 → "1.2M" — recortados, nunca "38.0k". */
export function formatTokens(n: number): string {
	if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
	return String(n);
}

/** Separa un sello cualificado por proveedor "provider:id" (la cualificación
 *  de los contratos de uso, oleada de ranuras de modelo 2026-09-20) en sus
 *  dos coordenadas. Sin dos puntos = sin cualificación de proveedor (un id de catálogo a secas). */
export function splitQualified(id: string): { provider: string | null; id: string } {
	const colon = id.indexOf(":");
	if (colon === -1) return { provider: null, id };
	return { provider: id.slice(0, colon), id: id.slice(colon + 1) };
}

/** Las etiquetas solo de modelo omiten la ruta del proveedor, nunca versiones, fechas ni variantes.
 * Solo quienes muestran el uso pasan `qualified`: los dos puntos de un id de catálogo a secas
 * pertenecen al modelo (p. ej. :free), no a un proveedor. El uso conserva su sufijo de proveedor. */
export function prettyModel(id: string, qualified = false): string {
	const { provider, id: bare } = qualified ? splitQualified(id) : { provider: null, id };
	const short = bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare;
	return provider ? `${short} · ${provider}` : short;
}