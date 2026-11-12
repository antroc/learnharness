/** Limpieza acotada de un grupo de procesos POSIX creado por el lanzamiento
 * separado de esta prueba de humo. Nunca descubre procesos por nombre ni
 * equipara la salida del líder con la salida del grupo.
 */
import { setTimeout as delay } from "node:timers/promises";

/** @template T @param {() => Promise<T>} operation @param {number} timeoutMs @param {T} fallback */
export async function boundedSmokeOperation(operation, timeoutMs, fallback) {
	let timer;
	try {
		return await Promise.race([
			Promise.resolve().then(operation).catch(() => fallback),
			new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
		]);
	} finally { clearTimeout(timer); }
}

/** @param {import("node:child_process").ChildProcess} server
 * @param {{ graceMs?: number, killMs?: number }} options
 */
export async function stopOwnedSmokeServer(server, { graceMs = 3000, killMs = 3000 } = {}) {
	if (process.platform === "win32" || !server.pid) throw new Error("Owned smoke cleanup requires a successfully spawned detached POSIX group");
	// El llamante debe haber usado detached:true. Conserva el id de grupo de ese lanzamiento exacto.
	const group = -server.pid;
	const signalGroup = signal => {
		try { process.kill(group, signal); return true; }
		catch (error) {
			if (error.code === "ESRCH") return false;
			// Un permiso denegado de POSIX con la señal 0 sigue significando que el grupo puede
			// existir (incluido un estado transitorio de apagado/recogida). Nunca lo des por desaparecido.
			if (signal === 0 && error.code === "EPERM") return true;
			throw new Error(`Cannot signal owned smoke group ${server.pid} with ${signal}`, { cause: error });
		}
	};
	const waitForGroupExit = async timeoutMs => {
		const deadline = performance.now() + timeoutMs;
		while (signalGroup(0)) {
			if (performance.now() >= deadline) return false;
			await delay(Math.min(25, Math.max(1, deadline - performance.now())));
		}
		return true;
	};
	if (!signalGroup("SIGTERM")) return { escalated: false };
	if (await waitForGroupExit(graceMs)) return { escalated: false };
	// La salida del líder no cancela a propósito esta escalada.
	const escalated = signalGroup("SIGKILL");
	if (!await waitForGroupExit(killMs)) throw new Error(`Owned smoke group ${server.pid} survived bounded cleanup`);
	return { escalated };
}
