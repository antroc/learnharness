// El servidor de desarrollo se lanza desde fuera y puede que aún esté compilando los paquetes del núcleo
// o su primera ruta. No lleves Electron a una conexión rechazada.
const http = require("node:http");
const https = require("node:https");

/**
 * Cualquier respuesta HTTP significa disponible: una página de error de
 * desarrollo de Next debe seguir visible. Un único plazo total acota también
 * a los servidores conectados que nunca envían cabeceras.
 * @param {string} url
 * @param {{signal?: AbortSignal, timeoutMs?: number, retryMs?: number}} [options]
 * @returns {Promise<void>}
 */
async function waitForDevServer(url, { signal, timeoutMs = 30000, retryMs = 200 } = {}) {
	const target = new URL(url);
	const transport = target.protocol === "http:" ? http : target.protocol === "https:" ? https : null;
	if (!transport) throw new Error("Development server URL must use HTTP or HTTPS");
	return new Promise((resolve, reject) => {
		let settled = false;
		let activeRequest;
		let retryTimer;
		let lastError;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			clearTimeout(retryTimer);
			signal?.removeEventListener("abort", abort);
			activeRequest?.destroy();
			if (error) reject(error);
			else resolve();
		};
		const abort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Development server startup cancelled"));
		const deadline = setTimeout(() => finish(new Error(
			`Development server ${url} did not respond within ${timeoutMs}ms`, { cause: lastError },
		)), timeoutMs);
		const attempt = () => {
			if (settled) return;
			const request = transport.get(target, { agent: false }, response => {
				response.on("error", () => {}); // Cerrar una respuesta innecesaria es intencionado.
				response.resume();
				finish();
			});
			activeRequest = request;
			request.once("error", error => {
				if (settled) return;
				lastError = error;
				activeRequest = undefined;
				request.destroy();
				retryTimer = setTimeout(attempt, retryMs);
			});
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		else attempt();
	});
}
module.exports = { waitForDevServer };
