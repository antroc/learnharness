/** Registros autorizados sintéticos, importados solo después del entorno aislado de cada prueba. */
import { randomBytes } from "node:crypto";
import type { CustomProviderSettings } from "../../src/core/settings.ts";
import { persistCustomAuth } from "../../src/server/custom-provider-auth.ts";

export function authorizeFixture(cp: CustomProviderSettings, fileKey?: string): CustomProviderSettings {
	const id = randomBytes(16).toString("hex");
	persistCustomAuth({ version: 1, id, baseUrl: cp.baseUrl, authMode: cp.authMode ?? "keyless", ...(fileKey ? { fileKeyBaseUrl: cp.baseUrl } : {}) }, fileKey);
	return { ...cp, credentialBindingId: id };
}
