/**
 * Vida de los turnos en el servidor: qué chats tienen ahora mismo un turno del
 * profesor en curso. La mitad que faltaba de «las sesiones siguen ejecutándose
 * en segundo plano»: junto con la persistencia anticipada de chat-handler,
 * permite a un cliente que vuelve distinguir «el profesor está a mitad de
 * turno: no resucites, no empieces nada» de «el registro ESTÁ al día».
 *
 * Vive en globalThis, NO en un Map a nivel de módulo: en desarrollo, Next
 * compila cada ruta como su propia entrada, así que un singleton a nivel de
 * módulo es una instancia DISTINTA en el renderizado de la página, en
 * GET /api/chats/[id] y en POST /api/chat; la página leería un registro vacío
 * mientras la ruta del chat tiene el turno vivo (el error: volver a mitad de
 * turno mostraba el aviso del 409 en lugar del estado ocupado). globalThis
 * abarca las instancias de módulo dentro del proceso; es el canal de
 * singletons estándar de Next.js (por el mismo motivo viven ahí los clientes
 * de Prisma).
 *
 * Sigue siendo efímero POR DISEÑO: un reinicio del proceso lo borra, así que
 * no hay indicadores obsoletos que limpiar; un turno caído se recupera con el
 * registro de escritura anticipada + la continuación al montar en la
 * siguiente visita. El TTL protege contra fugas de turnos del profesor cuyo
 * onFinish nunca se dispara. Los responsables de una preparación quedan
 * fijados hasta que se resuelve su callback: hacer caducar un calificador en
 * ejecución admitiría un segundo escritor. El traspaso restaura el TTL del
 * profesor con una marca de tiempo nueva.
 */

import { emit } from "../core/events.ts";
import { clearTurnFailure } from "./turn-runs.ts";

interface TurnOwner {
	token: object;
	preparing: boolean;
}

interface LhGlobal {
	__lhTurnRegistry?: Map<string, number>;
	__lhTurnOwners?: Map<string, TurnOwner>;
}

function registry(): Map<string, number> {
	const g = globalThis as typeof globalThis & LhGlobal;
	return (g.__lhTurnRegistry ??= new Map<string, number>());
}

function owners(): Map<string, TurnOwner> {
	const g = globalThis as typeof globalThis & LhGlobal;
	return (g.__lhTurnOwners ??= new Map<string, TurnOwner>());
}

const inFlight = registry();
const MAX_TURN_MS = 30 * 60_000;

/**
 * Marca un turno como iniciado. Devuelve false si ya hay uno en marcha para el
 * chat; el llamante rechaza la petición (solo un turno puede controlar un
 * chat). Anuncia "turn-started" DESPUÉS de escribir en el registro: un
 * listener que lea isTurnRunning o pida el registro ve una verdad coherente.
 * El doble inicio rechazado (la ruta del 409) se queda en silencio: no empezó
 * ningún turno. Un responsable privado de preparación fija la entrada hasta el
 * traspaso; los llamantes normales mantienen el comportamiento de TTL
 * existente y no necesitan pasar un responsable.
 */
export function beginTurn(chatId: string, preparationOwner?: object): boolean {
	if (isTurnRunning(chatId)) return false;
	clearTurnFailure(chatId);
	if (preparationOwner) owners().set(chatId, { token: preparationOwner, preparing: true });
	else owners().delete(chatId);
	inFlight.set(chatId, Date.now());
	emit("turn-started", { chatId });
	return true;
}

/**
 * Marca el turno del chat como terminado tras un asentamiento normal, o
 * después de que la limpieza del asentamiento haya conservado el aviso de
 * fallo. Una lectura posterior lee la verdad duradera, nunca la promesa de
 * que llegó una respuesta sin guardar. Solo emite cuando había de verdad una
 * entrada: un endTurn defensivo que no hace nada no debe disparar un
 * asentamiento espurio. Pasar un responsable protege la limpieza frente a un
 * turno más nuevo; sin él, se mantiene la API de fin incondicional original
 * para los turnos normales.
 */
export function endTurn(chatId: string, owner?: object): void {
	if (owner && owners().get(chatId)?.token !== owner) return;
	owners().delete(chatId);
	if (inFlight.delete(chatId)) emit("turn-settled", { chatId });
}

/** Protección privada de propiedad para la preparación y el profesor al que se traspasa. */
export function isTurnOwner(chatId: string, owner: object): boolean {
	return isTurnRunning(chatId) && owners().get(chatId)?.token === owner;
}

/** Pasa la preparación fijada al TTL normal del profesor, sin terminar ni
 * reiniciar el turno ni emitir otro evento de ciclo de vida. */
export function handoffTurn(chatId: string, owner: object): boolean {
	if (!isTurnOwner(chatId, owner)) return false;
	owners().get(chatId)!.preparing = false;
	inFlight.set(chatId, Date.now());
	return true;
}

/** True mientras el turno del chat está en curso; expulsa de forma perezosa
 * las entradas obsoletas. La ruta de expulsión NO emite eventos A PROPÓSITO:
 * protege contra fugas de un turno cuyo onFinish nunca se disparó (algo ya de
 * por sí patológico), se ejecuta de forma perezosa desde una lectura, y emitir
 * desde una lectura es un efecto secundario sospechoso. El silencio aquí es
 * una elección, no un descuido. */
export function isTurnRunning(chatId: string): boolean {
	const since = inFlight.get(chatId);
	if (since === undefined) return false;
	if (!owners().get(chatId)?.preparing && Date.now() - since > MAX_TURN_MS) {
		inFlight.delete(chatId);
		owners().delete(chatId);
		return false;
	}
	return true;
}
