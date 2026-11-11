/**
 * Registro de abortos de tareas: QUIÉN puede matar de verdad un subagente en ejecución.
 *
 * El ejecutor crea un AbortController por tarea en ejecución y lo registra
 * aquí; el camino de aborto (abortJob de src/server/jobs.ts, accionado por el
 * botón FIN del dock mediante POST /api/jobs/[jobId]/abort) lo dispara con fireJobAbort.
 * Se encuentran dos árboles de módulos: el ejecutor (src/agent) y el endpoint
 * (src/server); el registro vive en globalThis por el mismo motivo que
 * el registro de turnos y la canalización de despertares: Next dev da a cada entrada de ruta
 * sus propias instancias de módulo, así que un Map a nivel de módulo sería un objeto
 * distinto en cada una. Está bajo src/agent (las importaciones servidor→agente son una
 * dirección establecida; agente→servidor no lo es: ver chat-handler).
 *
 * Semántica de aborto de 2026-09 (decidida por el usuario): MATAR DE VERDAD, no marcar y abandonar:
 * el controlador aborta la llamada al modelo en curso (agent.generate /
 * abortSignal de generateText); las ejecuciones de herramientas sin interfaz son de mejor esfuerzo (la siguiente
 * llamada al modelo es donde muere una colgada). La ruta se encarga de la contabilidad
 * (estado de error "Aborted by learner" + la reorientación de aborto); el ejecutor solo deshace.
 */

interface LhAbortGlobal {
	__lhJobAborts?: Map<string, AbortController>;
}

function registry(): Map<string, AbortController> {
	const g = globalThis as typeof globalThis & LhAbortGlobal;
	return (g.__lhJobAborts ??= new Map());
}

/** El ejecutor registra su controlador al empezar la tarea (sobrescritura idempotente). */
export function registerJobAbort(jobId: string, controller: AbortController): void {
	registry().set(jobId, controller);
}

/** El ejecutor lo desregistra en su bloque finally (tarea asentada o deshecha). */
export function unregisterJobAbort(jobId: string): void {
	registry().delete(jobId);
}

/** True mientras el bucle de la tarea se está EJECUTANDO (hay un controlador registrado):
 *  la barrera de vivacidad para el barrido de tareas obsoletas: un registro "running" con un
 *  registro vivo pertenece a un bucle propiedad de este proceso (colgado o lento, es
 *  la única verdad: nunca relanzar a su lado); sin él, el registro es
 *  un huérfano de la muerte de un proceso y se recupera de inmediato. El registro
 *  abarca solo el cálculo y la limpieza. Los resultados terminados tienen obligaciones de entrega
 *  independientes y persistidas; ningún worker espera a que se consuman. */
export function isJobLive(jobId: string): boolean {
	return registry().has(jobId);
}

/** Aborta el bucle de una tarea en ejecución. Devuelve false cuando no hay controlador vivo:
 * el bucle de la tarea no se está ejecutando. El endpoint rechaza por separado el aborto
 * de un worker terminado, aunque su entrega a la sesión siga pendiente. */
export function fireJobAbort(jobId: string): boolean {
	const controller = registry().get(jobId);
	if (!controller) return false;
	registry().delete(jobId);
	controller.abort();
	return true;
}
