import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/** Modo solo navegador: `next dev` / `next start` sin el secreto por arranque del
 * shell de escritorio. */
export function browserOnlyMode(env: Record<string, string | undefined> = process.env): boolean {
	return env.LH_DESKTOP_SERVER !== "1" && !env.LH_DESKTOP_API_SECRET;
}

/** Capacidad HTTP de escritorio por arranque. No es una frontera contra
 * malware del usuario del SO ni una credencial OAuth. El modo solo navegador
 * lo comprueba browserAPIRefusal. */
export function desktopAPIAuthorized(
	headers: Headers,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const expected = env.LH_DESKTOP_API_SECRET;
	if (browserOnlyMode(env)) return true;
	if (!expected || expected.length < 64) return false;
	const supplied = headers.get("x-learnharness-desktop");
	if (!supplied) return false;
	const actual = Buffer.from(supplied);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/** Controles de navegador del mismo origen, no autenticación del usuario. La web/el modo de
 * desarrollo conservan a propósito el modelo de confianza existente de servidor compartido/clave API.
 * Nunca se confía aquí en orígenes reenviados ni se añaden permisos CORS. Un despliegue público
 * necesita su propia barrera de acceso. */
export function subscriptionRequestOrigin(request: Request): string | undefined {
	try {
		const url = new URL(request.url);
		const host = request.headers.get("host") ?? url.host;
		const addressed = new URL(`${url.protocol}//${host}`);
		if (!["http:", "https:"].includes(addressed.protocol) || addressed.username || addressed.password || addressed.pathname !== "/" || addressed.search || addressed.hash) return;
		return addressed.origin;
	} catch { return; }
}

/** El DNS rebinding necesita un nombre DNS controlado por el atacante, así que los
 * nombres localhost y las IP literales siempre son seguros. Cualquier otro nombre
 * debe figurar en LH_ALLOWED_HOSTS (separados por comas, sin distinguir
 * mayúsculas, sin tener en cuenta el puerto). */
export function browserHostAllowed(host: string | null, env: Record<string, string | undefined> = process.env): boolean {
	if (!host) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) return true;
	const allowed = (env.LH_ALLOWED_HOSTS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	return allowed.includes(hostname);
}

/** Lo comparten Proxy y la ruta de documentos en streaming, que se salta a propósito
 * el clon truncado del cuerpo de Proxy. Se comprueba antes de cualquier trabajo propio de la ruta. */
export function apiRequestRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	if (browserOnlyMode(env)) return browserAPIRefusal(request, env);
	if (!desktopAPIAuthorized(request.headers, env)) return "Desktop API access requires the trusted LearnHarness window.";
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Barrera de la API solo navegador: una comprobación de Host contra el DNS
 * rebinding y una comprobación entre sitios en las escrituras. Las escrituras
 * sin Origin ni Sec-Fetch-Site vienen de clientes que no son navegadores y se
 * permiten. Devuelve el rechazo, si lo hay. */
export function browserAPIRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	if (!browserHostAllowed(request.headers.get("host") ?? new URL(request.url).host, env)) {
		return "This host name is not allowed. Use localhost or an IP address, or add the name to LH_ALLOWED_HOSTS.";
	}
	if (READ_METHODS.has(request.method.toUpperCase())) return;
	const site = request.headers.get("sec-fetch-site");
	const origin = request.headers.get("origin");
	if ((site !== null && site !== "same-origin") || (origin !== null && origin !== subscriptionRequestOrigin(request))) {
		return "Cross-site requests to the LearnHarness API are not allowed.";
	}
}
