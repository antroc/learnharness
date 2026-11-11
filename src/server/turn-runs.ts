/**
 * El registro de turnos en marcha (oleada del ejecutor de turnos en segundo
 * plano, decisión del responsable 2026-09-25): chatId → el PiTurnHandle vivo.
 * LA superficie de reenganche: GET /api/chats/[id]/stream se resuelve aquí, y
 * la terminación remota (/api/activity/abort, tipo "turn") mata a través de
 * aquí.
 *
 * La misma disciplina de globalThis que turn-liveness.ts (lee su cabecera):
 * en desarrollo, Next compila cada ruta como su propia instancia de módulo, así
 * que un Map a nivel de módulo sería un registro DISTINTO en la entrada de
 * POST /api/chat y en la de GET .../stream. globalThis abarca las instancias
 * de módulo dentro del proceso.
 *
 * Ciclo de vida del registro: chat-handler registra el identificador en
 * cuanto empieza el turno (tras la protección del 409) y su onFinish lo da de
 * baja AL FINAL (tras persistir, el uso, la extracción y endTurn), así que
 * todo lo que ve «ningún turno en marcha» ve la verdad duradera del registro.
 * Un asentamiento fallido también conserva su pequeño aviso antes de darse de
 * baja, para que los enganches tardíos no confundan una respuesta sin guardar
 * con un éxito. La protección del 409 por chat hace que un chatId pueda tener
 * como mucho un identificador. La preparación privada registra un
 * identificador exterior estable antes de esperar a su callback y después
 * delega en el profesor real sin sustituir esa entrada del registro. La
 * preparación no puede caducar mientras se ejecuta; una vez traspasada, el TTL
 * normal de 30 minutos del profesor en beginTurn acota el caso patológico de
 * que nunca se asiente. Un turno aceptado más tarde sobrescribe el
 * identificador obsoleto (Map.set), y la limpieza protegida por responsable no
 * puede dar de baja a ese sucesor.
 *
 * Cerrar la app a mitad de turno (el proceso muere con un turno sin
 * persistir) es el MISMO residuo que antes de la oleada: el registro es solo
 * en memoria; el registro de escritura anticipada + la recuperación por TTL
 * de la vida del turno cubren el siguiente montaje.
 */

import type { PiTurnHandle } from "./pi/ui-stream.ts";

interface LhTurnRunsGlobal {
	__lhTurnRuns?: Map<string, PiTurnHandle>;
	__lhTurnFailures?: Map<string, string>;
}

function runs(): Map<string, PiTurnHandle> {
	const g = globalThis as typeof globalThis & LhTurnRunsGlobal;
	return (g.__lhTurnRuns ??= new Map<string, PiTurnHandle>());
}

/** Un aviso pequeño y transitorio por sesión fallida. Nunca guarda mensajes.
 * Se borra con el siguiente inicio aceptado, al borrar la sesión o al salir del proceso. */
function failures(): Map<string, string> {
	const g = globalThis as typeof globalThis & LhTurnRunsGlobal;
	return (g.__lhTurnFailures ??= new Map<string, string>());
}

export function rememberTurnFailure(chatId: string, errorText: string): void {
	failures().set(chatId, errorText);
}

export function turnFailure(chatId: string): string | undefined {
	return failures().get(chatId);
}

export function clearTurnFailure(chatId: string): void {
	failures().delete(chatId);
}

/** Registra el turno en marcha del chat (chat-handler, justo después de que
 *  empiece el turno). Uno por chat por construcción: la protección del 409. */
export function registerTurn(chatId: string, handle: PiTurnHandle): void {
	runs().set(chatId, handle);
}

/** Da de baja al asentarse, AL FINAL (tras endTurn). La preparación pasa su
 * identificador exterior estable como protección; los llamantes normales mantienen el valor por defecto. */
export function unregisterTurn(chatId: string, ownerHandle?: PiTurnHandle): void {
	if (ownerHandle && runs().get(chatId) !== ownerHandle) return;
	runs().delete(chatId);
}

/** El identificador del turno vivo de un chat, o undefined: el punto de
 *  resolución del endpoint de suscripción y del canal de cancelación. */
export function runningTurn(chatId: string): PiTurnHandle | undefined {
	return runs().get(chatId);
}

/** La terminación remota: cualquier cliente (el remitente original, un
 *  espectador reenganchado, superficies futuras) puede detener un turno en
 *  marcha. not_running refleja el 409 honesto de abortJob: no había nada que
 *  cancelar y el llamante vuelve a pedir los datos. */
export function abortTurn(chatId: string): { ok: true } | { ok: false; reason: "not_running" } {
	const handle = runs().get(chatId);
	if (!handle) return { ok: false, reason: "not_running" };
	handle.abort();
	return { ok: true };
}

/** El final barato cuando GET /api/chats/[id]/stream no encuentra ningún turno
 *  en marcha (carrera con el asentamiento, o el cliente comprobó turnInFlight
 *  un instante tarde): una respuesta SSE del mismo dialecto cuyo único
 *  fragmento le dice al cliente «no hay nada a lo que engancharse: vuelve a
 *  pedir la verdad duradera». Primero se entrega un fallo de asentamiento
 *  conservado, también cuando ninguna vista se enganchó a tiempo. Se eligió
 *  como EVENTO (no como código de estado), consumiendo UN solo protocolo de
 *  red de extremo a extremo. */
export function settledTurnResponse(chatId?: string): Response {
	const errorText = chatId ? turnFailure(chatId) : undefined;
	const notice = errorText === undefined ? "" : `data: ${JSON.stringify({ type: "error", errorText })}\n\n`;
	return new Response(`${notice}data: {"type":"turn-settled"}\n\ndata: [DONE]\n\n`, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
