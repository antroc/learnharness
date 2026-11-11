/**
 * El adaptador AuthStore (oleada de claves de autenticación, 2026-09-19): el mapa plano {VAR: value}
 * de auth.json en config.AUTH_FILE: el MISMO fichero que la app de Electron siempre ha
 * editado a mano (decisión del responsable: opción A: mismo fichero, ubicado por variable de entorno,
 * cero migración). 0600, escrituras atómicas, las ediciones a mano siguen funcionando (el fichero
 * se vuelve a leer del disco en cada acceso).
 *
 * El servidor (src/server/keys.ts) es el único escritor previsto: aplica la
 * validación de forma antes de setAuthVar y la precedencia de las variables de entorno por encima de
 * authVars(). Las lecturas normales nunca lanzan (fichero ausente/corrupto = {} =
 * «aún no hay claves»); las lecturas/escrituras del par solo personalizado de más abajo son deliberadamente
 * estrictas para que un registro privado ilegible nunca se sobrescriba como {}.
 * Las escrituras normales conservan literalmente las variables string desconocidas
 * (compatibilidad futura: entradas futuras, p. ej. un token de inicio de sesión de planes, van
 * sin tocar hasta que una entrada del catálogo las adopte).
 */

import fs from "node:fs";
import path from "node:path";
import { AUTH_FILE } from "../../config.ts";
import type { AuthStore } from "../core/ports.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { CUSTOM_AUTH_BINDING, parseCustomAuthBinding, type CustomAuthBinding } from "../core/custom-provider-auth.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

/** El mapa plano string→string, o {} si es ausente/corrupto/no es objeto. */
function readMap(): Record<string, string> {
	try {
		const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(
			Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][],
		);
	} catch {
		return {}; // ausente o corrupto: el estado documentado es «aún no hay claves»
	}
}

/** Escribe el mapa de forma atómica con modo 0600: una escritura parcial nunca debe
 *  dejar un fichero 0644 (secretos) ni un JSON truncado (parece «no hay claves»).
 *  atomic-write.ts fija el modo en el fichero temporal antes del renombrado, así que
 *  el modo nunca existe relajado en la ruta final. */
function writeMap(map: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
	writeFileAtomicSync(AUTH_FILE, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600 });
}

export const authStore: AuthStore = {
	authVars() {
		return readMap();
	},
	setAuthVar(name, value) {
		assertOrdinaryVar(name);
		const map = readMap();
		map[name] = value;
		writeMap(map);
	},
	deleteAuthVar(name) {
		assertOrdinaryVar(name);
		const map = readMap();
		if (!(name in map)) return; // ausente = éxito silencioso, idempotente
		delete map[name];
		writeMap(map);
	},
};

/** Las escrituras personalizadas nunca deben convertir un fichero privado ilegible/corrupto en {}.
 * Los demás proveedores conservan la semántica de su adaptador existente. Los valores JSON desconocidos
 * sobreviven a las actualizaciones solo personalizadas, no solo a la proyección de strings normal. */
function readCustomMap(): Record<string, unknown> {
	let text: string;
	try { text = fs.readFileSync(AUTH_FILE, "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Custom authorization storage unavailable"); }
	let raw: unknown;
	try { raw = JSON.parse(text); } catch { throw new Error("Custom authorization storage unavailable"); }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Custom authorization storage unavailable");
	const map = raw as Record<string, unknown>;
	if (Object.hasOwn(map, CUSTOM_AUTH_BINDING) && !parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING])) throw new Error("Invalid custom authorization record");
	if (Object.hasOwn(map, CUSTOM_PROVIDER.envVar) && typeof map[CUSTOM_PROVIDER.envVar] !== "string") throw new Error("Invalid custom credential record");
	return map;
}
function assertOrdinaryVar(name: string): void {
	if (name === CUSTOM_AUTH_BINDING || name === CUSTOM_PROVIDER.envVar) throw new Error("Use the custom endpoint editor");
}
/** Una instantánea inmutable del fichero. Los llamadores sin clave nunca invocan fileKey(). */
export function readCustomAuth() {
	const map = readCustomMap();
	return { binding: parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING]), fileKey: () => map[CUSTOM_PROVIDER.envVar] as string | undefined };
}
/** Sustituye solo el par personalizado en UNA escritura atómica de un registro existente. */
export function writeCustomAuth(binding: CustomAuthBinding | undefined, fileKey: string | undefined): void {
	const map = readCustomMap();
	if (binding && !parseCustomAuthBinding(JSON.stringify(binding))) throw new Error("Invalid custom authorization record");
	if (fileKey === undefined) delete map[CUSTOM_PROVIDER.envVar];
	else Object.defineProperty(map, CUSTOM_PROVIDER.envVar, { value: fileKey, enumerable: true, configurable: true, writable: true });
	if (binding === undefined) delete map[CUSTOM_AUTH_BINDING];
	else Object.defineProperty(map, CUSTOM_AUTH_BINDING, { value: JSON.stringify(binding), enumerable: true, configurable: true, writable: true });
	writeMap(map);
}
