/** Autorización privada de credenciales personalizadas; ningún valor público derivado de la credencial. */
import { normalizeBaseUrl, type CustomProviderSettings } from "./settings.ts";

export const CUSTOM_AUTH_BINDING = "__learnharness_custom_provider_binding";
export interface CustomAuthBinding {
	version: 1;
	id: string;
	baseUrl?: string;
	authMode: "apiKey" | "keyless" | "disabled";
	/** Una clave de fichero tapada conserva su propio destino cuando se mueve una clave de entorno. */
	fileKeyBaseUrl?: string;
}
export function parseCustomAuthBinding(value: unknown): CustomAuthBinding | undefined {
	try {
		const b = typeof value === "string" ? JSON.parse(value) : undefined;
		if (!b || b.version !== 1 || typeof b.id !== "string" || !/^[a-f0-9]{32}$/.test(b.id)) return;
		if (!["apiKey", "keyless", "disabled"].includes(b.authMode)) return;
		if (b.authMode !== "disabled" && b.baseUrl === undefined) return;
		if (b.baseUrl !== undefined && (typeof b.baseUrl !== "string" || !b.baseUrl || normalizeBaseUrl(b.baseUrl) !== b.baseUrl)) return;
		if (b.fileKeyBaseUrl !== undefined && (typeof b.fileKeyBaseUrl !== "string" || !b.fileKeyBaseUrl || normalizeBaseUrl(b.fileKeyBaseUrl) !== b.fileKeyBaseUrl)) return;
		return { version: 1, id: b.id, authMode: b.authMode, ...(b.baseUrl !== undefined ? { baseUrl: b.baseUrl } : {}), ...(b.fileKeyBaseUrl !== undefined ? { fileKeyBaseUrl: b.fileKeyBaseUrl } : {}) };
	} catch { return; }
}
export function customBindingMatches(cp: CustomProviderSettings | undefined, binding: CustomAuthBinding | undefined): boolean {
	return Boolean(cp?.baseUrl && binding && binding.authMode !== "disabled" && cp.credentialBindingId === binding.id && cp.baseUrl === binding.baseUrl && cp.authMode === binding.authMode);
}
