/** El flujo de conexión/modelo manual/fijación sin conexión del PR #62, con fronteras de petición
 * del host, vinculación de credenciales y escritura optimista. Ningún secreto llega a GET. */
import { createHmac, randomBytes } from "node:crypto";
import { normalizeBaseUrl, parseModelIds, sanitizeCustomModelOverrides, type CustomProviderSettings } from "../core/settings.ts";
import { readSettings, writeSettings } from "../store/settings.ts";
import { readCustomAuth } from "../store/auth.ts";
import { customAuthState, customKeyAuthorized, persistCustomAuth } from "./custom-provider-auth.ts";
import type { CustomAuthBinding } from "../core/custom-provider-auth.ts";
import { desktopAPIAuthorized } from "./desktop-access.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { discoverModels, mergeManualModels, syncCustomProvider } from "./custom-provider.ts";
import { parseCustomModelOverridesBody } from "./settings-body.ts";
import { CustomBodyLimitError, readBoundedJson } from "./custom-provider-body.ts";

const revisionKey = Symbol.for("learnharness.custom-provider-revision");
const globals = globalThis as typeof globalThis & { [revisionKey]?: Buffer };
const secret = globals[revisionKey] ??= randomBytes(32);
const failure = (error: string, status = 400) => Response.json({ error }, { status });
const stale = () => failure("Custom configuration or credentials changed. Reload configuration and retry.", 409);

function snapshot(inspectKey = false) {
	const record = readSettings() ?? { version: 1 };
	const cp = record.customProvider;
	// Sin clave nunca se busca una clave para autenticar ni para generar revisiones.
	// Una inspección explícita de la clave API solo se usa después de que el usuario elija ese modo.
	const auth = customAuthState(inspectKey);
	const key = auth.key;
	// Las revisiones públicas solo contienen configuración, nunca material de credenciales.
	// Las credenciales efectivas se comparan en privado a lo largo del sondeo esperado.
	const etag = `"${createHmac("sha256", secret).update(JSON.stringify([cp ?? null, auth.binding ?? null, auth.readable])).digest("base64url")}"`;
	return { record, cp, auth, key, etag };
}

function response(body: object) {
	return Response.json(body, { headers: { etag: snapshot().etag, "cache-control": "no-store" } });
}

export function customProviderGet(request: Request): Response {
	const inspect = new URL(request.url).searchParams.get("authMode") === "apiKey";
	const current = snapshot();
	const s = snapshot(inspect || current.cp?.authMode === "apiKey");
	return response({
		baseUrl: s.cp?.baseUrl ?? "", authMode: s.cp?.authMode ?? "keyless",
		models: s.cp?.models ?? [], overrides: s.cp?.overrides ?? {}, manualModels: s.cp?.manualModels ?? [],
		keyPresent: Boolean(s.key), keySource: s.auth.source,
		keyReuseRequired: Boolean(s.key) && !customKeyAuthorized(s.cp, s.auth),
	});
}

function authorized(request: Request): boolean {
	const desktop = process.env.LH_DESKTOP_SERVER === "1" || Boolean(process.env.LH_DESKTOP_API_SECRET);
	if (desktop) return desktopAPIAuthorized(request.headers);
	const origin = request.headers.get("origin");
	if (!origin || origin === "null") return false;
	try {
		// La URL de Request de Next en modo standalone puede usar su nombre de host interno.
		// Se compara con el Host realmente direccionado mediante la frontera de origen
		// existente de la app; nunca se confía en las cabeceras de origen reenviadas.
		return origin === subscriptionRequestOrigin(request)
			&& (!request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin");
	} catch { return false; }
}

/** Primero el par de autenticación y después el nonce de configuración coincidente. Cualquier
 * publicación entre ficheros interrumpida/fallida queda inutilizable de forma duradera, incluso con
 * una clave real en el entorno. La reversión de mejor esfuerzo restaura el par antiguo entero, nunca
 * solo su secreto. */
function commit(cp: CustomProviderSettings | undefined, binding?: CustomAuthBinding, fileKey?: string): void {
	const latest = readSettings() ?? { version: 1 };
	const oldAuth = binding ? readCustomAuth() : undefined;
	let published = false;
	try {
		if (binding) { persistCustomAuth(binding, fileKey); published = true; }
		const { customProvider: _old, ...rest } = latest;
		writeSettings(cp ? { ...rest, customProvider: cp } : rest);
	} catch {
		if (published && oldAuth) {
			try { persistCustomAuth(oldAuth.binding, oldAuth.fileKey()); } catch { /* un nonce duradero que no coincide falla cerrado tras reiniciar */ }
		}
		throw new Error("Unable to save custom configuration. Reload configuration and retry.");
	}
	syncCustomProvider();
}

export async function customProviderMutation(request: Request): Promise<Response> {
	if (!authorized(request)) return failure("Custom configuration requires a trusted same-origin request.", 403);
	if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return failure("JSON content-type is required.", 415);
	try {
		// Next puede representar un DELETE vacío como un flujo de cero bytes en lugar de
		// null. Se acota en ambos casos; solo DELETE permite un cuerpo vacío.
		const body = await readBoundedJson(request, 64 * 1024, request.method === "DELETE");
		if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Invalid JSON body");
		const raw = body as Record<string, unknown>;
		const before = snapshot(raw.authMode === "apiKey");
		if (!before.auth.readable) return failure("Custom authorization storage is unavailable. No changes were saved.", 500);
		if (request.headers.get("if-match") !== before.etag) return stale();
		if (request.method === "DELETE") {
			commit(undefined, { version: 1, id: randomBytes(16).toString("hex"), authMode: "disabled" });
			return response({ ok: true });
		}
		if (request.method === "PATCH") {
			const parsed = parseCustomModelOverridesBody(raw);
			if (!parsed.ok) return failure(parsed.error);
			if (!before.cp?.baseUrl) return failure("No custom endpoint configured", 409);
			const overrides = sanitizeCustomModelOverrides(parsed.settings, before.cp.models?.map((m) => m.id));
			commit({ ...before.cp, overrides });
			return response({ ok: true, overrides });
		}
		if (request.method !== "POST") return failure("Unsupported method", 405);
		const base = normalizeBaseUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : "");
		if (!base) return failure("Base URL must be http(s), with no credentials, query or fragment.");
		if (raw.authMode !== "keyless" && raw.authMode !== "apiKey") return failure("Choose Keyless or API key authentication.");
		const authMode = raw.authMode;
		if (raw.key !== undefined && typeof raw.key !== "string") return failure("API key must be a string.");
		const supplied = typeof raw.key === "string" ? raw.key.trim() : undefined;
		if (authMode === "apiKey" && supplied === "") return failure("Choose Keyless to clear authentication.");
		const envOwned = before.auth.source === "env";
		if (envOwned && supplied) return failure("Environment owns the effective key. Change the environment or explicitly reuse that key.");
		// Una clave de fichero tapada no es la clave que se va a usar. Se exige consentimiento
		// para la clave de entorno real al autorizar un endpoint distinto.
		const hasNewEffectiveKey = Boolean(supplied) && !envOwned;
		const changedTarget = before.cp?.baseUrl !== base;
		if (authMode === "apiKey" && (changedTarget || !customKeyAuthorized(before.cp, before.auth)) && !hasNewEffectiveKey && raw.reuseKey !== true) {
			return failure("Enter a new key or explicitly allow reuse of the effective existing key for this URL.");
		}
		const effectiveKey = authMode === "apiKey" ? (envOwned ? before.key : supplied || before.key) : undefined;
		if (authMode === "apiKey" && !effectiveKey) return failure("API key mode requires an effective key.");
		const manualModels = parseModelIds(raw.manualModels);
		if (manualModels.length > 10_000) return failure("Model list exceeds 10000 entries");
		const found = await discoverModels(base, effectiveKey);
		if (!found.ok && (found.fatal || found.status === 401 || found.status === 403)) return failure(found.error, 502);
		if (!found.ok && !manualModels.length) return failure(`${found.error}. If this endpoint has no /models list, add model IDs manually.`, 502);
		// El descubrimiento cede; tanto el registro personalizado como la credencial deben
		// seguir coincidiendo. Las ediciones de ajustes no relacionadas se conservan con la fusión nueva de commit.
		const now = snapshot(authMode === "apiKey");
		if (before.etag !== now.etag || JSON.stringify(before.auth) !== JSON.stringify(now.auth)) return stale();
		const discovered = found.ok ? found.models : !changedTarget ? before.cp?.models ?? [] : [];
		const models = mergeManualModels(discovered, manualModels);
		if (models.length > 10_000) return failure("Model list exceeds 10000 entries");
		const overrides = sanitizeCustomModelOverrides(!changedTarget ? before.cp?.overrides : undefined, models.map((m) => m.id));
		const id = randomBytes(16).toString("hex");
		const fileKey = authMode === "keyless" ? undefined : supplied && !envOwned ? supplied : now.auth.fileKey;
		const fileKeyBaseUrl = authMode === "apiKey" ? envOwned ? now.auth.binding?.fileKeyBaseUrl : base : undefined;
		const binding: CustomAuthBinding = { version: 1, id, baseUrl: base, authMode, ...(fileKey && fileKeyBaseUrl ? { fileKeyBaseUrl } : {}) };
		commit({ baseUrl: base, authMode, credentialBindingId: id, models, overrides, ...(manualModels.length ? { manualModels } : {}) }, binding, fileKey);
		return response({ ok: true, models });
	} catch (error) {
		return failure(error instanceof CustomBodyLimitError ? "Configuration body exceeds 64 KiB." : error instanceof SyntaxError ? "Invalid JSON body." : "Unable to save custom configuration. Reload configuration and retry.", error instanceof CustomBodyLimitError ? 413 : error instanceof SyntaxError ? 400 : 500);
	}
}
