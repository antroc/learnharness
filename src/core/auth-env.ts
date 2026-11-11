/** Solo procedencia compartida: en la capa del agente no se lee el almacén de credenciales. */
interface AuthBoot {
	/** Nombres que pertenecen al entorno de arranque original. */
	realEnv: Set<string>;
	/** Nombres que el almacén de claves de LearnHarness refleja en process.env. */
	fillGap: Set<string>;
}
const BOOT_KEY = Symbol.for("lh.authBoot");

export function authEnvRecord(): AuthBoot {
	const g = globalThis as Record<symbol, AuthBoot | undefined>;
	if (!g[BOOT_KEY]) g[BOOT_KEY] = { realEnv: new Set(), fillGap: new Set() };
	return g[BOOT_KEY];
}

/** Las CLI externas gestionan su propia autenticación. Nunca se les pasan inyecciones exclusivas de LearnHarness. */
export function externalCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const result = { ...env };
	const { realEnv, fillGap } = authEnvRecord();
	for (const name of fillGap) {
		if (!realEnv.has(name)) delete result[name];
	}
	return result;
}
