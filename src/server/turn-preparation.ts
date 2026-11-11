/**
 * Propiedad privada mientras se prepara una respuesta, antes de que exista un
 * profesor real. El único identificador exterior se registra de forma
 * síncrona y se mantiene estable durante el traspaso; solo el profesor real
 * es dueño de la reproducción/los eventos. Cancelar una vista nunca cancela la
 * preparación ni otra vista.
 */
import type { PiTurnHandle } from "./pi/ui-stream.ts";
import { beginTurn, endTurn, handoffTurn, isTurnOwner } from "./turn-liveness.ts";
import { registerTurn, runningTurn, settledTurnResponse, unregisterTurn } from "./turn-runs.ts";

export interface TurnPreparation {
	readonly signal: AbortSignal;
	isCurrent(): boolean;
	handoff(realHandle: PiTurnHandle): void;
	finish(): void;
}

/** Reclama la barrera de turno por sesión existente, sin await ni tarea aparte.
 * Cancelar la preparación NO la libera: el host debe esperar a que se resuelvan
 * su callback y la limpieza duradera y después llamar a finish (también en las
 * rutas de fallo). Una vez traspasada, el host llama a finish tras el
 * asentamiento del profesor real. */
export function claimPreparingTurn(chatId: string): TurnPreparation | null {
	const owner = {};
	const preparation = new AbortController();
	let real: PiTurnHandle | undefined;
	let finished = false;
	const waiting = new Set<() => void>();

	const outer: PiTurnHandle = {
		subscribe() {
			let cancelled = false;
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			let resolveReady!: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void;
			let rejectReady!: (error: unknown) => void;
			const ready = new Promise<ReadableStreamDefaultReader<Uint8Array> | null>((resolve, reject) => {
				resolveReady = resolve;
				rejectReady = reject;
			});
			const connect = () => {
				waiting.delete(connect);
				if (cancelled) return;
				try {
					// Un identificador traspasado siempre aporta su propia reproducción, aunque
					// mientras tanto se haya ejecutado finish. La preparación en sí no tiene registro de eventos.
					reader = (real ? real.subscribe() : settledTurnResponse(chatId).body!).getReader();
					resolveReady(reader);
				} catch (error) {
					rejectReady(error);
				}
			};
			return new ReadableStream<Uint8Array>({
				start() {
					if (real || finished) connect();
					else waiting.add(connect);
				},
				async pull(controller) {
					try {
						const source = await ready;
						if (!source || cancelled) return;
						const { value, done } = await source.read();
						if (cancelled) return;
						if (done) {
							reader = undefined;
							source.releaseLock();
							controller.close();
						} else controller.enqueue(value);
					} catch (error) {
						if (!cancelled) controller.error(error);
						reader?.releaseLock();
						reader = undefined;
					}
				},
				async cancel(reason) {
					cancelled = true;
					waiting.delete(connect);
					resolveReady(null);
					const source = reader;
					reader = undefined;
					if (source) {
						try { await source.cancel(reason); }
						finally { source.releaseLock(); }
					}
				},
			});
		},
		abort() {
			if (finished) return;
			if (real) real.abort();
			else preparation.abort();
		},
	};

	if (!beginTurn(chatId, owner)) return null;
	registerTurn(chatId, outer);

	const isCurrent = () => !finished && isTurnOwner(chatId, owner) && runningTurn(chatId) === outer;
	const connectWaiting = () => {
		for (const connect of waiting) connect();
	};
	return {
		signal: preparation.signal,
		isCurrent,
		handoff(realHandle) {
			if (real || preparation.signal.aborted || !isCurrent()) {
				realHandle.abort();
				throw new Error("Turn preparation is no longer eligible for teacher handoff");
			}
			// Sin await entre la comprobación de propiedad, el reinicio de la marca de tiempo y el traspaso.
			handoffTurn(chatId, owner);
			real = realHandle;
			connectWaiting();
		},
		finish() {
			if (finished) return;
			finished = true;
			connectWaiting();
			// Se mantiene registrado el identificador hasta el asentamiento de la vida del turno,
			// igual que en los turnos normales. Ambos borrados están protegidos frente a un sucesor,
			// incluido uno admitido porque caducó el TTL de un profesor.
			endTurn(chatId, owner);
			unregisterTurn(chatId, outer);
		},
	};
}
