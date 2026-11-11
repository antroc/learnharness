/**
 * La composición de autenticación/claves (oleada auth-keys, 2026-09-19): el
 * gestor de claves del servidor tras GET/PUT/DELETE /api/keys.
 *
 * LA FRONTERA DEL ENTORNO (la piedra angular de la arquitectura): todos los
 * consumidores (openRouterApiKey() de models.ts, los subagentes, web.ts, la
 * ruta de STT) leen process.env directamente, y la capa del agente no puede
 * importar la capa de almacenamiento. En lugar de recablear cinco
 * consumidores de distintas líneas de trabajo, el almacén se REFLEJA en el
 * entorno del proceso hijo: al arrancar (de forma idempotente, anclado en
 * globalThis como el registro de extracción) cada variable del fichero que NO
 * esté definida en el entorno real se rellena en process.env, y cada
 * guardado/borrado actualiza fichero y entorno a la vez. Por eso las claves
 * surten efecto al momento, sin reiniciar; y por eso también la antigua
 * inyección de main.cjs al lanzar TENÍA que retirarse: una copia del entorno
 * hecha al lanzar taparía cualquier cambio de la página de ajustes hasta
 * reiniciar (el entorno gana al fichero).
 *
 * PRECEDENCIA (decisión del responsable): las variables de entorno reales
 * (incluido .env.local en desarrollo) siempre ganan al fichero. Las variables
 * reales del entorno en el arranque se capturan una vez por proceso y nunca se
 * modifican; un PUT a una de ellas se persiste en el fichero (para cuando el
 * entorno desaparezca) y el estado indica con honestidad shadowedByEnv: la
 * página explica por qué la clave guardada no es la que está en uso.
 *
 * Las variables desconocidas del fichero se conservan tal cual y se muestran
 * como filas de estado genéricas (sin formulario del catálogo con el que
 * editarlas: solo las claves curadas tienen formas y documentación;
 * core/auth-keys.ts).
 *
 * EL INTERRUPTOR DE USUARIO NUEVO (responsable, interludio 2026-09-22):
 * LH_IGNORE_ENV_KEYS=1 hace invisibles en TODA LA APP las claves del entorno:
 * la simulación exacta de un usuario nuevo (un directorio de datos vacío +
 * el interruptor = cero claves, cero proveedores federados, fase 1 de la
 * configuración). Con el interruptor, las variables de entorno reales se
 * BORRAN del proceso (no solo las ignora esta frontera): pi-ai resuelve las
 * claves de los proveedores desde process.env de forma NATIVA en cada
 * petición (defaultProviderAuthContext de auth/context.js lee el entorno
 * vivo), así que borrarlas es el único mecanismo que oculta las claves a
 * todos los consumidores, motores de modelos incluidos. Solo cuenta el
 * almacén en fichero (auth.json); el relleno de huecos sigue reflejando las
 * claves del fichero para que un usuario nuevo pueda añadirlas a mitad de
 * sesión y los motores las vean sin reiniciar. Sin el interruptor = el
 * comportamiento actual, byte a byte.
 */

import {
	AUTH_KEYS,
	AUTH_PROVIDER_KEYS,
	AUTH_PROVIDER_ENV_VARS,
	CUSTOM_PROVIDER,
	type AuthKeyInfo,
	type AuthKeyStatus,
	genericProviderKeyGuard,
	isKnownAuthKey,
	isProviderEnvVar,
	maskKey,
	validateKeyShape,
} from "../core/auth-keys.ts";
import { authStore } from "../store/auth.ts";
import { isSubscriptionProvider, subscriptionConnected } from "../agent/subscription-connections.ts";
import { customProviderAvailable, installCustomProviderSource } from "./custom-provider.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";
import { CUSTOM_AUTH_BINDING } from "../core/custom-provider-auth.ts";

// Una procedencia compartida y estable frente a HMR permite a las CLI externas excluir las
// inyecciones solo de fichero sin importar este módulo respaldado por el almacén en la capa del agente.
import { authEnvRecord as boot } from "../core/auth-env.ts";

/** Nombres de clave normales que se pueden escribir. Las escrituras de autenticación personalizada
 * deben usar la frontera atómica de vinculación al endpoint, nunca la API genérica de una sola clave. */
export function isWritableAuthKey(id: string): boolean {
	return id !== CUSTOM_AUTH_BINDING && id !== CUSTOM_PROVIDER.envVar && (isKnownAuthKey(id) || isProviderEnvVar(id));
}

/** El desplegable de proveedores de la página de ajustes: todos los
 *  proveedores de pi-ai que aceptan una clave simple ({id, envVar, label};
 *  fijado contra desviaciones, ver la documentación de la tabla en
 *  core/auth-keys.ts y tests/auth-provider-keys.test.ts). Ordenado por id
 *  para que la carga sea estable. */
export function providerKeyList() {
	return [...AUTH_PROVIDER_KEYS].sort((a, b) => a.id.localeCompare(b.id));
}

/** El interruptor de usuario nuevo (responsable, interludio 2026-09-22): las
 *  claves del entorno son invisibles en toda la app (se borran del proceso al
 *  arrancar; solo claves de fichero). Se lee en vivo en cada llamada (el
 *  lanzador lo exporta antes de arrancar). */
export function envKeysIgnored(): boolean {
	return process.env.LH_IGNORE_ENV_KEYS === "1";
}

/**
 * El relleno de huecos del arranque, idempotente. La primera llamada captura
 * qué nombres gestionados son entorno real; las siguientes (reimportación por
 * HMR, o tras una edición a mano) solo rellenan las variables aún sin definir
 * en el entorno, así que una variable borrada mediante la API nunca resucita
 * (su entrada en el fichero también ha desaparecido).
 */
export function initAuthEnv(): void {
	const record = boot();
	const fileVars = Object.fromEntries(Object.entries(authStore.authVars()).filter(([name]) => name !== CUSTOM_AUTH_BINDING));
	const managed = new Set<string>([
		...Object.keys(fileVars),
		...AUTH_KEYS.map((k) => k.id),
		// Las variables de entorno de los proveedores también son nombres gestionados
		// (interludio de claves de proveedor): un OPENAI_API_KEY exportado en el entorno con
		// copia en fichero recibe una semántica de tapado honesta, igual que las variables curadas.
		...AUTH_PROVIDER_KEYS.map((p) => p.envVar),
		CUSTOM_PROVIDER.envVar,
	]);
	if (envKeysIgnored()) {
		// EL INTERRUPTOR DE USUARIO NUEVO: se borran todas las variables de entorno
		// gestionadas (en cada llamada; una variable reintroducida nunca resucita). realEnv
		// se queda VACÍO (nada cuenta como entorno); el relleno de huecos de abajo refleja
		// entonces las claves de auth.json para que los motores vean lo añadido a mitad de sesión.
		for (const name of managed) {
			delete process.env[name];
		}
	} else if (record.realEnv.size === 0 && record.fillGap.size === 0) {
		// Primera inicialización en este proceso: lo que ya está en el entorno es entorno REAL.
		for (const name of managed) {
			if (process.env[name] !== undefined) record.realEnv.add(name);
		}
	}
	for (const [name, value] of Object.entries(fileVars)) {
		if (!isManagedName(name)) continue;
		if (process.env[name] === undefined) {
			process.env[name] = value;
			record.fillGap.add(name);
		}
	}
}

/** ¿Es este nombre de variable de entorno uno de los que gestiona el sistema
 *  de claves (curado, de proveedor o guardado en el fichero)? */
function isManagedName(name: string): boolean {
	return name !== CUSTOM_AUTH_BINDING && (isWritableAuthKey(name) || name in authStore.authVars());
}

/**
 * La proyección pura del estado, exportada para las pruebas. `env` es la
 * vista viva del entorno del proceso; `realEnv`, la captura del arranque
 * (precedencia del entorno).
 */
export function resolveKeyStatuses(
	fileVars: Record<string, string>,
	env: Record<string, string | undefined>,
	realEnv: ReadonlySet<string>,
	/** Las variables de entorno de los proveedores de modelos (interludio de
	 *  claves de proveedor): las PRESENTES se suman a las filas de estado; las
	 *  ausentes nunca saturan (el desplegable es la superficie de descubrimiento).
	 *  Las claves curadas siempre tienen fila, estén presentes o no. */
	providerEnvVars: ReadonlySet<string> = new Set(),
): AuthKeyStatus[] {
	const ids = new Set<string>([...AUTH_KEYS.map((k) => k.id), ...Object.keys(fileVars)]);
	for (const envVar of providerEnvVars) {
		if (env[envVar] !== undefined || fileVars[envVar] !== undefined) ids.add(envVar);
	}
	const rows: AuthKeyStatus[] = [];
	for (const id of ids) {
		if (id === CUSTOM_AUTH_BINDING) continue;
		const envValue = env[id];
		const fileValue = fileVars[id];
		const isRealEnv = realEnv.has(id);
		// Gana el entorno: el valor vivo es el del entorno si está definido (real o reflejado;
		// tras el relleno, los valores del fichero VIVEN en el entorno, así que realEnv es lo
		// que distingue una variable de entorno REAL del propio reflejo del almacén).
		const live = envValue !== undefined ? envValue : fileValue;
		rows.push({
			id,
			info: AUTH_KEYS.find((k) => k.id === id) ?? null,
			present: live !== undefined,
			// Las claves personalizadas pueden tener un solo carácter: incluso un sufijo enmascarado
			// puede exponer la credencial entera. Se conserva el inventario y no se devuelve ningún carácter de la clave.
			masked: live !== undefined ? id === CUSTOM_PROVIDER.envVar ? "••••" : `${maskKey(live)} (${live.trim().length} chars)` : null,
			source: isRealEnv ? "env" : live !== undefined ? "file" : "none",
			shadowedByEnv: isRealEnv && fileValue !== undefined && envValue !== fileValue,
		});
	}
	return rows;
}

/** La vista del GET: todas las claves curadas (presentes o no) + las variables desconocidas del fichero. */
export function keyStatuses(): AuthKeyStatus[] {
	return resolveKeyStatuses(authStore.authVars(), process.env, boot().realEnv, new Set([...AUTH_PROVIDER_ENV_VARS, CUSTOM_PROVIDER.envVar]));
}

/** El valor vivo de una variable, primero el entorno (la regla de que gana el
 *  entorno): la lectura canónica para los consumidores que no viven tras el
 *  barrel @/src/server (la ruta de STT era el único agujero en frío: una
 *  primera petición a ella leería si no el entorno antes de que se ejecutara
 *  ningún relleno de huecos). */
export function keyValue(id: string): string | undefined {
	if (id === CUSTOM_AUTH_BINDING) return undefined;
	// El interruptor de usuario nuevo: SOLO cuenta el almacén en fichero (doble
	// seguridad: el borrado del arranque ya vació el entorno; esto protege frente a
	// cualquier clave de entorno reintroducida después del arranque).
	if (envKeysIgnored()) return authStore.authVars()[id];
	return process.env[id] ?? authStore.authVars()[id];
}

/** La verdad sobre la presencia de clave para un proveedor de modelos
 * (interludio de claves de proveedor, 2026-09-25): ¿estaría presente la clave
 * de este proveedor al hacer la petición? Lee mediante keyValue, la MISMA
 * búsqueda con prioridad del entorno que pi-ai hace de forma nativa en cada
 * petición, así que una clave tapada por el entorno cuenta como presente
 * (barrera según lo que se ejecutaría). Los proveedores ausentes de
 * AUTH_PROVIDER_KEYS no usan clave: no hay nada que filtrar, presentes por
 * definición. */
export function providerKeyPresent(provider: string): boolean {
	if (provider === CUSTOM_PROVIDER.id) return customProviderAvailable();
	// Solo opción activada explícitamente + instalación, nunca que esté lista y autenticada.
	// Se consulta en la admisión, no dentro de bucles de agente ya en marcha.
	if (provider === CLAUDE_CODE_PROVIDER) return claudeCodeAvailable();
	if (isSubscriptionProvider(provider)) return subscriptionConnected(provider);
	const info = AUTH_PROVIDER_KEYS.find((p) => p.id === provider);
	return info ? keyValue(info.envVar) !== undefined : true;
}

/**
 * Guarda una clave (PUT). Primero la barrera de forma (decisión del
 * responsable: un pegado incorrecto es un 400 y nunca se guarda), después la
 * escritura en el fichero y luego el reflejo en el entorno. Una variable que
 * pertenece al entorno REAL no se refleja (gana el entorno; la fila de estado
 * indica shadowedByEnv para que la página pueda explicarlo).
 */
export function saveKey(id: string, value: string): { ok: true; status: AuthKeyStatus } | { ok: false; error: string } {
	if (id === CUSTOM_PROVIDER.envVar || id === CUSTOM_AUTH_BINDING) return { ok: false, error: "Use the custom endpoint editor" };
	const shape = isProviderEnvVar(id) ? genericProviderKeyGuard(id, value) : validateKeyShape(id, value);
	if (!shape.ok) return { ok: false, error: shape.error };
	const trimmed = value.trim();
	authStore.setAuthVar(id, trimmed);
	const record = boot();
	if (!record.realEnv.has(id)) {
		process.env[id] = trimmed;
		record.fillGap.add(id);
	}
	// validateKeyShape garantiza que pertenece al catálogo, así que la fila existe.
	return { ok: true, status: keyStatuses().find((s) => s.id === id)! };
}

/**
 * Quita una clave (DELETE): siempre desaparece del fichero; del entorno solo
 * si la copia del entorno era NUESTRA (relleno de huecos); una variable de
 * entorno real se queda (gana el entorno) y el estado muestra la clave aún
 * presente desde el entorno.
 */
export function deleteKey(id: string): AuthKeyStatus {
	if (id === CUSTOM_PROVIDER.envVar || id === CUSTOM_AUTH_BINDING) throw new Error("Use the custom endpoint editor");
	authStore.deleteAuthVar(id);
	const record = boot();
	if (record.fillGap.has(id) && !record.realEnv.has(id)) {
		delete process.env[id];
		record.fillGap.delete(id);
	}
	return keyStatuses().find((s) => s.id === id)!;
}

// Refleja el fichero en el entorno en la primera importación (idempotente; el módulo
// lo importan todas las rutas/handlers que tocan claves).
initAuthEnv();
installCustomProviderSource();
