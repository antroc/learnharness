export type LiveProcess = { readonly owner: symbol; readonly sessionId: string | undefined; toolCallIds: string[]; kill(): void };

// Las herramientas suelen volver a llamar en segundos, pero una herramienta de pregunta retiene su llamada hasta que el alumno
// responde. Pasado esto, se mata el proceso y la respuesta arranca uno nuevo con una reproducción completa.
// Se queda por debajo de MCP_TOOL_TIMEOUT para que el proceso muera antes de que la CLI se rinda por su cuenta.
export const LIVE_PROCESS_IDLE_TIMEOUT_MS = 10 * 60_000;

/** Juntura para pruebas (el patrón pdfModelOverride de runner.ts). */
export const liveProcessIdleTimeoutMs = { current: LIVE_PROCESS_IDLE_TIMEOUT_MS };

// Cada proceso vivo, asociado al temporizador que lo mata si pi nunca vuelve a llamar.
const liveProcesses = new Map<LiveProcess, NodeJS.Timeout>();

export function addLiveProcess(process: LiveProcess): void {
	removeLiveProcess(process);
	const timer = setTimeout(() => {
		removeLiveProcess(process);
		process.kill();
	}, liveProcessIdleTimeoutMs.current);

	timer.unref();

	liveProcesses.set(process, timer);
}

function hasSameIds(ids: string[], otherIds: string[]): boolean {
	return ids.length === otherIds.length && new Set(otherIds).size === otherIds.length && ids.every((id) => otherIds.includes(id));
}

export function getLiveProcess(toolCallIds: string[], owner: symbol, sessionId: string | undefined): LiveProcess | null {
	if (!sessionId || toolCallIds.length === 0) return null;

	for (const process of liveProcesses.keys()) {
		if (process.owner === owner && process.sessionId === sessionId && hasSameIds(process.toolCallIds, toolCallIds)) return process;
	}

	return null;
}

export function removeLiveProcess(process: LiveProcess): void {
	clearTimeout(liveProcesses.get(process));
	liveProcesses.delete(process);
}
