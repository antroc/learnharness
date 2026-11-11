"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, MicIcon } from "lucide-react";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { Hint } from "@/components/ui/hint";
import { deepgramListenUrl, type DictationLanguage } from "@/src/core";
import { useDictationLanguage } from "@/components/dictation-preference";
import { setDictationActive } from "@/components/dictation-state";
import { dispatchFocusedPluginShortcut } from "@/components/plugin-input-focus";
export { isDictationActive } from "@/components/dictation-state";

/**
 * Dictado por voz — el motor en la nube (oleada 1 de STT, 2026-09-17).
 *
 * Arquitectura (docs/research/stt.md): el renderer captura el audio del
 * micrófono en un AudioWorklet (public/worklets/pcm-capture.js → linear16
 * 16 kHz mono), abre DIRECTAMENTE el WebSocket de streaming de Deepgram (el
 * audio nunca da la vuelta por nuestro servidor) con un token de vida corta que
 * emite /api/stt/token (la clave real se queda en el servidor) y envía tramas
 * mientras escucha. Los finales se anexan a la ENTRADA PRINCIPAL (ver abajo).
 *
 * Patrones traídos de la extensión `dictate` de pi del responsable (en sus
 * palabras: «muy bien afinada») — ver ~/.pi/agent/extensions/dictate:
 *   - contador de generación: cada inicio/parada lo incrementa; todos los
 *     manejadores asíncronos no hacen nada si están obsoletos, así que el
 *     socket de una sesión que muere nunca puede desmontar la actual.
 *   - medidor: el último RMS nunca se reinicia — la ref del nivel guarda el
 *     último valor observado, así que un tick sin audio nuevo vuelve a pintar
 *     el último nivel en vez de caer al silencio (el tick de 60 ms muestrea la ref).
 *   - correspondencia de dB con suelo −50 / techo −10: el punto justo para mostrar
 *     el habla conversacional como barras a media altura sin llegar al tope.
 *   - parada: el micrófono muere PRIMERO (no se encola más audio), luego
 *     CloseStream y luego una red de seguridad de 3 s por si Deepgram nunca
 *     cierra el socket.
 *   - interim_results=false, endpointing=300: sus parámetros afinados en vivo —
 *     sin hipótesis parciales, los finales se confirman ~300 ms después de una
 *     pausa (ronda 1 del responsable: las palabras en vivo distraen y desplazan
 *     el medidor; el ancho del medidor es FIJO mientras se graba).
 *
 * Ronda 2 del responsable (2026-09-17, segunda prueba en vivo):
 *   - Transcripción APLAZADA: los finales se acumulan en un búfer durante la
 *     ejecución y se vuelcan en la entrada principal UNA vez, cuando termina el
 *     dictado (otro clic/Esc → Deepgram vuelca sus últimos finales → se cierra
 *     el socket → un único anexado unido). Mientras se graba no se renderiza
 *     nada de texto — solo el medidor. La salida en vivo podría volver como un
 *     ajuste conmutable en el hito de los ajustes; por ahora el aplazado es el
 *     único comportamiento.
 *   - Medidor ADAPTATIVO: el número de celdas de la tira se deriva de su ancho
 *     medido (paso de 4px, 8–48 celdas, ResizeObserver), para que las filas
 *     estrechas (la columna más ajustada de la vista de borrador) muestren menos
 *     barras en vez de desbordarse por debajo de sus vecinos.
 *
 * Ronda 1 del responsable (2026-09-17, primera prueba en vivo del micrófono):
 *   - UNA entrada principal de transcripción en todo momento: el campo de la
 *     pregunta quiz/ask pendiente mientras haya una esperando (modo texto → el
 *     campo de respuesta, modos de selección → "Your thinking"); si no, el
 *     compositor de la página. Implementado como un registro a nivel de módulo
 *     que el formulario de la pregunta reclama al montarse — ver
 *     useDictationTarget más abajo.
 *   - Clic → medidor DE INMEDIATO (optimista): la tira del medidor se renderiza
 *     desde el clic; la conexión + el TCC ocurren por detrás. La emisión del
 *     token y la obtención del micrófono se ejecutan EN PARALELO (Promise.all)
 *     para reducir el hueco real.
 *
 * El renderizado del medidor vive en <DictationBar> (con su propio temporizador
 * de 60 ms sobre la ref del nivel), así que los 16 renders por segundo nunca
 * tocan el componente de la página — solo se repinta la diminuta tira de barras.
 *
 * Oleada de mitigación de la latencia de inicio (responsable, 2026-09-27 —
 * A+B+C+D, el medidor optimista se queda): la antigua ruta de inicio
 * serializaba [token ∥ micrófono] → AudioContext NUEVO → lectura de addModule →
 * negociación WSS, y DESCARTABA cada trama que llegaba antes de que el socket
 * estuviera OPEN — los primeros segundos de habla nunca llegaban a Deepgram. Ahora:
 *   - ENCOLAR, NO DESCARTAR (A): las tramas que llegan antes de OPEN se guardan
 *     en un búfer (con tope, se descartan las más antiguas) y se vuelcan en
 *     orden al abrir — el habla capturada nunca se pierde, caiga donde caiga
 *     dentro de la preparación.
 *   - NEGOCIACIÓN EN PARALELO (B, sujeta al micrófono): la negociación empieza
 *     en cuanto el grafo de captura está vivo, no después. Sujeta al micrófono,
 *     NO al token: un aviso de TCC del sistema operativo puede durar más que el
 *     tiempo de inactividad de 10 s de Deepgram.
 *   - GRAFO PERSISTENTE (C): un AudioContext para toda la vida de la app + un
 *     módulo de worklet memorizado — los contextos por ejecución pagaban la
 *     creación del contexto Y una lectura del módulo del worklet en cada inicio
 *     (a través del servidor de desarrollo, en desarrollo).
 *   - TOKEN CALIENTE (D): se emite de antemano al montar la página y se renueva
 *     después de cada ejecución (TTL de 3 min); el clic ya no espera a la
 *     emisión remota. Un fallo de negociación por token obsoleto se repara solo
 *     mediante la ruta de reconectar una vez, que siempre emite uno NUEVO.
 *   - El suelo honesto se mantiene: getUserMedia no se puede precalentar (el
 *     indicador del micrófono se quedaría encendido) — de ahí el medidor
 *     optimista del responsable.
 */

/*
 * Parámetros de streaming de Deepgram (la configuración de dictate afinada en
 * vivo por el responsable): nova-3, endpointing=300, sin intermedios. El
 * silencio también se envía (el worklet nunca hace pausa), así que el socket
 * nunca queda inactivo — no hace falta KeepAlive.
 */
// La construcción de la URL vive en el núcleo seguro para el navegador; solo varía el idioma.

/** Ajuste del medidor — los valores probados por el responsable, ver la cabecera del fichero. */
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
export const METER_TICK_MS = 60;
/** Historial rodante: 48 celdas × 60 ms ≈ 2,9 s de sonoridad reciente. */
export const METER_CELLS = 48;

/** El id de la clave de Deepgram en el almacén de claves (el nombre de la variable
 *  de entorno — el estado openRow de la sección Keys y la frontera PUT /api/keys/:id). */
export const DEEPGRAM_KEY_ID = "DEEPGRAM_API_KEY";

/** La línea SIN CLAVE escrita por el cliente (oleada de cero claves, responsable
 * 2026-09-25): el mensaje 503 en bruto de la ruta del token es jerga de
 * desarrollo ("add it to auth.json (desktop) or .env.local (dev)") — la
 * superficie dice en su lugar la verdad corta. Exportada para las fijaciones;
 * el clic del botón inactivo con error la reconoce y enlaza a Ajustes → Keys →
 * la fila de Deepgram. */
export const DICTATION_KEYLESS = "Dictation needs a Deepgram key";
export const DICTATION_ACTIVE_ELSEWHERE = "Dictation is active elsewhere";

// Los controladores montados no reclaman la captura. Solo start() adquiere el único
// propietario para toda la ventana, de forma síncrona, antes de las esperas de ajustes/micrófono/token.
let recordingOwner: symbol | null = null;
let recordingTarget: ((text: string) => unknown) | null = null;
const controllers = new Map<symbol, { primary: boolean; toggle: () => void; cancel: () => void }>();
function toggleGlobalDictation() {
	if (dispatchFocusedPluginShortcut("toggle-dictation")) return;
	for (const controller of controllers.values()) {
		if (controller.primary) {
			controller.toggle();
			return;
		}
	}
}
function cancelGlobalDictation() {
	if (recordingOwner) controllers.get(recordingOwner)?.cancel();
}
function registerController(id: symbol, controller: { primary: boolean; toggle: () => void; cancel: () => void }) {
	if (controllers.size === 0) {
		window.addEventListener("lh:kbd-toggle-dictation", toggleGlobalDictation);
		window.addEventListener("lh:kbd-cancel-dictation", cancelGlobalDictation);
	}
	controllers.set(id, controller);
	return () => {
		controllers.delete(id);
		if (controllers.size === 0) {
			window.removeEventListener("lh:kbd-toggle-dictation", toggleGlobalDictation);
			window.removeEventListener("lh:kbd-cancel-dictation", cancelGlobalDictation);
		}
	};
}

/** Emite un token nuevo de vida corta (la ruta guarda la clave real en el
 *  servidor). A nivel de módulo: tanto la caché caliente de la ruta de inicio
 *  como la ruta de reconexión acaban aquí. El 503 sin clave (sin
 *  DEEPGRAM_API_KEY) es el ÚNICO 503 de la ruta — el mensaje en bruto es jerga
 *  de desarrollo, así que el error se convierte en la línea corta escrita por el
 *  cliente (oleada de cero claves, responsable 2026-09-25). */
async function mintFreshToken(): Promise<string> {
	const res = await fetch("/api/stt/token");
	const data = (await res.json()) as { token?: string; message?: string };
	if (!res.ok || !data.token) {
		if (res.status === 503) throw new Error(DICTATION_KEYLESS);
		throw new Error(data.message ?? `token route ${res.status}`);
	}
	return data.token;
}

/** Caché del token caliente (mitigación D, responsable 2026-09-27): la ruta del
 *  clic toma la promesa en caché en vez de una emisión remota. El TTL evita que
 *  un token en caché quede obsoleto (de todos modos se repara solo: una
 *  negociación rechazada va por la ruta de reconectar una vez con una emisión
 *  NUEVA); una emisión fallida reinicia la caché para que la siguiente llamada
 *  vuelva a emitir — la ruta de error honesta sigue siendo honesta. refresh()
 *  vuelve a emitir en segundo plano (al montar la página, al terminar la
 *  ejecución); sus fallos se toleran en silencio (una emisión previa sin clave
 *  simplemente no calienta). */
export const WARM_TOKEN_TTL_MS = 3 * 60_000;

export type WarmMinter = { mint: () => Promise<string>; refresh: () => void };

export function createWarmMinter(
	mint: () => Promise<string>,
	now: () => number = Date.now,
	ttlMs: number = WARM_TOKEN_TTL_MS,
): WarmMinter {
	let warm: { p: Promise<string>; at: number } | null = null;
	const m: WarmMinter = {
		mint: () => {
			if (!warm || now() - warm.at > ttlMs) {
				const p = mint().catch((e: unknown) => {
					warm = null; // emisión fallida: la siguiente llamada vuelve a emitir
					throw e;
				});
				warm = { p, at: now() };
			}
			return warm.p;
		},
		refresh: () => {
			warm = null;
			m.mint().catch(() => {}); // en segundo plano, en la medida de lo posible
		},
	};
	return m;
}

const warmTokens = createWarmMinter(mintFreshToken);

/* Grafo de captura persistente (mitigación C, responsable 2026-09-27): un
 * AudioContext para toda la vida de la app + una memo de la carga del módulo. Se
 * crea bajo el gesto del clic (política de autoplay) y NUNCA se cierra — en su
 * lugar, los nodos por ejecución (fuente, worklet) se desconectan al desmontar. */
let sharedCtx: AudioContext | null = null;
let workletModule: Promise<void> | null = null;

function ensureAudioGraph(): { ctx: AudioContext; module: Promise<void> } {
	if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 16000 });
	if (!workletModule) {
		workletModule = sharedCtx.audioWorklet.addModule("/worklets/pcm-capture.js").catch((e: unknown) => {
			workletModule = null; // carga fallida: se reintenta en la siguiente ejecución
			throw e;
		});
	}
	return { ctx: sharedCtx, module: workletModule };
}

/** RMS (0..1) → normalizado a 0..1 dentro de la ventana de dB audible. */
export function rmsToMeter(rms: number): number {
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	const t = (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);
	return Math.max(0, Math.min(1, t));
}

/**
 * El registro de la entrada principal: como mucho UNA entrada que no sea el
 * compositor puede reclamar el destino del dictado mientras está montada — el
 * campo de respuesta/razonamiento de la pregunta pendiente (question-dock.tsx).
 * El `append` de la página (el compositor) es la alternativa cuando nadie
 * reclama. A nivel de módulo por diseño: quien reclama es un subárbol hermano
 * lejos del propietario del hook, y hay exactamente una ventana, una pregunta
 * pendiente y un destino a la vez.
 */
let questionTarget: ((text: string) => void | Promise<void>) | null = null;
let composerTarget: ((text: string) => void) | null = null;

/** Las referencias a ficheros usan exactamente el mismo destino por defecto que el
 * dictado, incluidos los reclamos cuyo dock está plegado. Un editor enfocado puede
 * insertar en su cursor; quienes llaman usan esto solo como alternativa. */
export function appendToPrimaryInput(text: string): boolean {
	const target = questionTarget ?? composerTarget;
	if (!target) return false;
	target(text);
	return true;
}

/* El registro de finalizadores del NÚCLEO: el dock de la pregunta pendiente
 * necesita finish() sin un puente por props. Los controladores explícitos de los
 * plugins nunca se registran aquí; sus rutas de envío esperan a su propio controller.finish(). */
let dictationFinisher: (() => Promise<void>) | null = null;

/** Termina el dictado de la página del núcleo antes de continuar (ver Dictation.finish). */
export function finishDictation(): Promise<void> {
	return dictationFinisher ? dictationFinisher() : Promise.resolve();
}

/** Une un final dictado al texto actual (regla de separador compartida). */
export function joinDictation(current: string, final: string): string {
	return current ? current.replace(/\s+$/, "") + " " + final : final;
}

/**
 * Reclama el destino del dictado mientras está montado (y `claimed` es true). La
 * guarda del desmontaje se basa en la identidad, para que los efectos invocados
 * dos veces en modo desarrollo no puedan quitar a otro que haya reclamado.
 */
export function usePluginQuestionDictationTarget(append: (text: string) => void | Promise<void>, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) {
				// Cancela/descarta una captura obsoleta antes de liberar su destino.
				if (recordingTarget === append) cancelGlobalDictation();
				questionTarget = null;
			}
		};
	}, [append, claimed]);
}

export function useDictationTarget(append: (text: string) => void, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) questionTarget = null;
		};
	}, [append, claimed]);
}

export type DictationPhase = "idle" | "connecting" | "recording" | "stopping";

export interface DictationDestination { id: string; append: (text: string) => void | Promise<void> }

export type Dictation = {
	phase: DictationPhase;
	/** Una única grabadora compartida; un destino lateral explícito nunca reclama la entrada principal. */
	destinationId: string;
	blocked?: boolean;
	toggleFor: (destination: DictationDestination) => void;
	finishFor: (destinationId: string) => Promise<void>;
	/** Explicación del estado terminal, mostrada dentro del botón ancho (se limpia en el siguiente inicio). */
	error: string | null;
	/** Último RMS observado, 0..1 — lo muestrea el propio tick del medidor; nunca se reinicia. */
	levelRef: { current: number };
	/** No inactivo — desde el clic hasta que termina la parada (la ventana optimista). */
	active: boolean;
	/** Terminar + CONSERVAR la transcripción: vuelca el búfer aplazado en la entrada
	 *  principal (la píldora Stop y ⌘D). */
	toggle: () => void;
	stop: () => void;
	/** TERMINAR Y LUEGO CONTINUAR (responsable, ronda de «nada se pierde» del
	 *  2026-10-01): si hay una ejecución viva, la detiene y solo se resuelve cuando
	 *  la ejecución ha terminado del todo — los últimos finales de Deepgram han
	 *  llegado al campo de destino. Una ruta de envío espera a esto antes de montar
	 *  su carga, así que un alumno que olvida detener el dictado antes de Enter nunca
	 *  pierde el razonamiento hablado. Inactivo → se resuelve de inmediato (el envío
	 *  habitual sin ejecución no paga nada). Todas las rutas terminales ejecutan
	 *  cleanup(), y cleanup() asienta a los que esperan. Cancelar (Esc) normalmente
	 *  se resuelve tras descartar el habla del búfer; cancelar/desechar durante la
	 *  entrega asíncrona de la transcripción la rechaza, para que un envío que
	 *  espera no pueda mandar texto obsoleto. */
	finish: () => Promise<void>;
	/** Terminar + DESCARTAR la transcripción: sin volcado, desmontaje inmediato. La
	 *  semántica de Esc (responsable, ronda 3 del 2026-09-17): Esc es cancelar, no
	 *  detener — antes volcaba exactamente igual que el conmutador. */
	cancel: () => void;
	/** Limpia el error terminal sin iniciar una ejecución (oleada de cero claves):
	 * el clic sin clave se va a Ajustes y la superficie debe volver limpia. */
	clearError: () => void;
};

/**
 * Motor de captura compartido con un único propietario síncrono de la grabación
 * para toda la ventana. Cada ejecución principal captura su destino
 * principal/de pregunta o su destino lateral explícito. Los controladores
 * explícitos de los plugins nunca reclaman el destino principal ni el
 * finalizador; la entrega asíncrona de su transcripción forma parte de terminar.
 */
export function useDictation({ append, destination = "primary", disabled = false }: {
	append: (text: string) => void;
	/** Los destinos explícitos nunca registran ni consultan el destino principal del núcleo. */
	destination?: "primary" | "explicit";
	disabled?: boolean;
}): Dictation {
	const primary = destination === "primary";
	const owner = useRef(Symbol("dictation")).current;
	const { getLanguage } = useDictationLanguage();
	const [phase, setPhaseState] = useState<DictationPhase>("idle");
	const phaseRef = useRef<DictationPhase>("idle");
	const setPhase = useCallback((next: DictationPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);
	const [destinationId, setDestinationId] = useState("main");
	const destinationRef = useRef<DictationDestination | null>(null);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const [error, setError] = useState<string | null>(null);
	/** Último RMS del worklet — el medidor muestrea esto (patrón de dictate). */
	const levelRef = useRef(0);
	/** Alternativa nueva para el siguiente inicio; una ejecución viva conserva su propio destino. */
	const appendRef = useRef(append);
	appendRef.current = append;
	useEffect(() => {
		if (!primary) return;
		const target = (text: string) => appendRef.current(text);
		composerTarget = target;
		return () => {
			if (composerTarget === target) composerTarget = null;
		};
	}, [primary]);

	// Maquinaria viva (valores que no son de render). Las pistas del MediaStream se detienen y
	// los nodos por ejecución se desconectan al desmontar; el socket se recrea en cada
	// ejecución; el AudioContext dura toda la vida de la app (mitigación C).
	const wsRef = useRef<WebSocket | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	/** Nodos del grafo por ejecución — el CONTEXTO sobrevive a las ejecuciones (mitigación C). */
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const workletRef = useRef<AudioWorkletNode | null>(null);
	/** Tramas capturadas antes de que el socket esté OPEN (mitigación A): se vuelcan
	 *  en orden al abrir; con un tope de 256 tramas (≈32 s) descartando las más
	 *  antiguas; se limpian al desmontar para que el audio de una ejecución muerta no
	 *  se cuele en la siguiente. */
	const pendingRef = useRef<ArrayBuffer[]>([]);
	const genRef = useRef(0); // guarda contra manejadores obsoletos (patrón de dictate)
	const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectsRef = useRef(0);
	/** La transcripción aplazada (ronda 2 del responsable): los finales llegan aquí
	 *  durante la ejecución y se vuelcan en la entrada principal una vez, al desmontar. */
	const bufferRef = useRef<string[]>([]);
	/** Resolutores que esperan a que la ejecución termine del todo (finish(),
	 *  responsable 2026-10-01): los libera cleanup() — todas las rutas terminales lo ejecutan. */
	const waitersRef = useRef<Array<{ resolve: () => void; reject: (error: unknown) => void }>>([]);
	const appendFailureRef = useRef<{ error: unknown } | null>(null);
	const appendPendingRef = useRef(false);

	/** Vuelca en el destino fijo de esta ejecución. Se llama exactamente una vez en la
	 *  limpieza; el búfer se vacía solo, así que una doble limpieza no hace nada. */
	const flush = useCallback((): unknown => {
		if (bufferRef.current.length === 0) return;
		const text = bufferRef.current.join(" ");
		bufferRef.current = [];
		return (destinationRef.current?.append ?? appendRef.current)(text);
	}, []);

	/** Desmontaje completo de la maquinaria de una ejecución. Idempotente; quienes llaman la protegen por generación. */
	const cleanup = useCallback((warmNext = true) => {
		const endGen = ++genRef.current;
		let appended: unknown;
		// Una segunda limpieza (cancelar/desechar) no puede convertir un anexado asíncrono
		// sin terminar en un final correcto: eso enviaría el borrador antiguo.
		let failure: { error: unknown } | null = appendPendingRef.current
			? { error: new DOMException("Dictation transcript delivery canceled", "AbortError") }
			: null;
		appendPendingRef.current = false;
		try {
			appended = flush(); // exactamente un anexado, después de la transcripción final
		} catch (error) {
			failure = { error };
		}
		if (safetyRef.current) {
			clearTimeout(safetyRef.current);
			safetyRef.current = null;
		}
		pendingRef.current = [];
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;
		// El AudioContext dura toda la vida de la app (mitigación C) — los nodos mueren, él se queda.
		const ws = wsRef.current;
		wsRef.current = null;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			try {
				ws.close();
			} catch {}
		}
		const complete = (failed: { error: unknown } | null) => {
			if (endGen !== genRef.current) return;
			appendPendingRef.current = false;
			appendFailureRef.current = failed;
			if (failed) setError(failed.error instanceof Error ? failed.error.message : "Dictation transcript could not be applied");
			if (recordingOwner === owner) {
				recordingOwner = null;
				recordingTarget = null;
				setDictationActive(false);
			}
			setPhase("idle");
			// El onTranscript asíncrono de un plugin forma parte de terminar, no es una
			// notificación de disparar y olvidar: el envío debe ver su texto controlado.
			for (const waiter of waitersRef.current.splice(0)) {
				if (failed) waiter.reject(failed.error);
				else waiter.resolve();
			}
			if (warmNext) warmTokens.refresh();
		};
		if (appended && typeof (appended as PromiseLike<unknown>).then === "function") {
			appendPendingRef.current = true;
			setPhase("stopping");
			// Las dos ramas consumen la promesa, incluida la de detener sin terminar.
			void Promise.resolve(appended).then(() => complete(null), (error: unknown) => complete({ error }));
		} else complete(failure);
	}, [flush, owner, setPhase]);

	/** Abre el socket de Deepgram y conecta sus mensajes. `gen` protege contra la obsolescencia. */
	const openSocket = useCallback(
		(gen: number, token: string, language: DictationLanguage) => {
			// Los JWT emitidos se autentican mediante el subprotocolo "bearer" — ["token",
			// jwt] se rechaza en la negociación (verificado en vivo; "token" es solo para
			// claves de API en bruto, como en la extensión dictate de pi del responsable).
			const ws = new WebSocket(deepgramListenUrl(language), ["bearer", token]);
			wsRef.current = ws;

			ws.addEventListener("open", () => {
				if (gen !== genRef.current) return;
				// Mitigación A: todo lo capturado durante la negociación (o en un hueco de
				// reconexión) sale ahora, en orden — Deepgram acepta envíos
				// más rápidos que el tiempo real.
				for (const frame of pendingRef.current) ws.send(frame);
				pendingRef.current = [];
				setPhase("recording");
			});
			ws.addEventListener("message", (ev) => {
				if (gen !== genRef.current) return;
				let msg: any;
				try {
					msg = JSON.parse(ev.data as string);
				} catch {
					return;
				}
				if (msg.type === "Results") {
					const text: string | undefined = msg.channel?.alternatives?.[0]?.transcript;
					// Solo llegan finales (interim_results=false). APLAZADO (ronda 2 del
					// responsable): se acumulan aquí y llegan a la entrada una vez, al
					// desmontar — el medidor es la única respuesta en vivo.
					if (msg.is_final && text) bufferRef.current.push(text);
				}
			});
			ws.addEventListener("close", (ev) => {
				if (gen !== genRef.current) return;
				if (ev.code === 1000) {
					// Llega nuestro propio CloseStream: termina ahora — la red de seguridad de la ruta de
					// parada se queda solo como respaldo por si no se cierra.
					cleanup();
					return;
				}
				// Cierre anómalo a mitad de ejecución: UNA reconexión con un token nuevo (la
				// pasada de investigación: reanudar es cosa nuestra, no hay SDK en el que apoyarse).
				if (reconnectsRef.current < 1) {
					reconnectsRef.current++;
					mintFreshToken() // siempre NUEVO — un token caliente obsoleto es el culpable probable
						.then((t) => {
							if (gen === genRef.current) openSocket(gen, t, language);
						})
						.catch(() => {
							if (gen === genRef.current) {
								setError("Deepgram reconnect failed");
								cleanup();
							}
						});
				} else {
					setError(`Deepgram connection lost (${ev.code})`);
					cleanup();
				}
			});
		},
		[cleanup, setPhase],
	);

	const start = useCallback(async (destination?: DictationDestination) => {
		if (disabledRef.current || phaseRef.current !== "idle") return;
		if (recordingOwner !== null && recordingOwner !== owner) {
			setError(DICTATION_ACTIVE_ELSEWHERE);
			return;
		}
		const target = destination ?? { id: "main", append: primary ? questionTarget ?? appendRef.current : (text: string) => appendRef.current(text) };
		destinationRef.current = target;
		setDestinationId(target.id);
		recordingOwner = owner;
		recordingTarget = target.append;
		setDictationActive(true);
		setError(null);
		appendFailureRef.current = null;
		setPhase("connecting");
		reconnectsRef.current = 0;
		bufferRef.current = []; // ejecución nueva, búfer nuevo (ronda 2)
		pendingRef.current = []; // ejecución nueva, cola nueva (mitigación A)
		const gen = ++genRef.current;
		let language: DictationLanguage;
		try {
			language = await getLanguage();
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(e instanceof Error ? e.message : "Dictation language unavailable");
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;

		// Mitigación D: el token caliente (emitido de antemano al montar / tras la última
		// ejecución) se resuelve casi al instante; una emisión en frío/sin clave aparece más abajo. El
		// micrófono es el cuello de botella (inicialización de HAL + APM de macOS) y condiciona todo —
		// el token se ejecuta en paralelo con él. 127.0.0.1 es un contexto
		// seguro, así que getUserMedia funciona sin TLS; el TCC de macOS pregunta en
		// el primer uso.
		const tokenPromise = warmTokens.mint();
		tokenPromise.catch(() => {}); // aparece más abajo; sin rechazo sin tratar
		const micPromise = navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		let stream: MediaStream;
		try {
			stream = await micPromise;
			if (gen !== genRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;

			// Mitigación C: contexto para toda la vida de la app + módulo de worklet memorizado —
			// desaparecen los costes por ejecución (creación del contexto, lectura del módulo).
			const { ctx, module } = ensureAudioGraph();
			await module;
			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== genRef.current) return;

			const worklet = new AudioWorkletNode(ctx, "pcm-capture");
			workletRef.current = worklet;
			worklet.port.onmessage = (e) => {
				if (gen !== genRef.current) return;
				const msg = e.data as { type: string; rms?: number; buffer?: ArrayBuffer };
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0; // nunca se reinicia a cero (patrón de dictate)
				} else if (msg.type === "audio") {
					const ws = wsRef.current;
					if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg.buffer!);
					// Mitigación A: aún no está OPEN (negociación o hueco de reconexión) —
					// encola, con tope; el manejador de apertura vuelca en orden.
					else {
						pendingRef.current.push(msg.buffer!);
						if (pendingRef.current.length > 256) pendingRef.current.shift();
					}
				}
			};
			const source = ctx.createMediaStreamSource(stream);
			sourceRef.current = source;
			source.connect(worklet);
			// Saca del grafo un flujo de silencio (el worklet no escribe salida) —
			// un nodo de worklet sin conectar nunca recibe reloj.
			worklet.connect(ctx.destination);
		} catch (e) {
			if (gen !== genRef.current) return;
			const msg =
				e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
					? "Microphone permission denied"
					: e instanceof Error
						? e.message
						: "mic unavailable";
			setError(msg);
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		let token: string;
		try {
			token = await tokenPromise;
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(e instanceof Error ? e.message : "token unavailable");
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		// Mitigación B: la negociación se dispara en cuanto el grafo está vivo,
		// solapándose con lo que quede de espera del token — sujeta al micrófono, nunca antes.
		openSocket(gen, token, language);
	}, [openSocket, cleanup, getLanguage, owner, primary, setPhase]);

	const stop = useCallback(() => {
		const gen = genRef.current;
		if (phaseRef.current !== "recording" && phaseRef.current !== "connecting") return;
		setPhase("stopping");

		// El micrófono muere PRIMERO — no se encola más audio (patrón de dictate). Los
		// nodos por ejecución mueren con él; el AudioContext se queda (mitigación C).
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;

		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(JSON.stringify({ type: "CloseStream" }));
			} catch {
				cleanup();
				return;
			}
			// Deepgram vuelca los finales que quedan y luego cierra; si nunca lo
			// hace, la red de seguridad termina igualmente la ejecución (patrón de dictate).
			safetyRef.current = setTimeout(() => {
				if (gen === genRef.current) cleanup();
			}, 3000);
		} else {
			cleanup();
		}
	}, [cleanup, setPhase]);

	const cancel = useCallback(() => {
		if (phaseRef.current === "idle") return;
		// Primero descarta y después desmonta — cleanup() vuelca, y el búfer ya vacío
		// convierte ese volcado en una operación nula. También mata una ejecución "stopping": el
		// volcado ya en marcha se abandona (su temporizador se limpia dentro).
		bufferRef.current = [];
		cleanup();
	}, [cleanup]);

	const finishCurrent = useCallback((): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (phaseRef.current === "idle") {
				if (appendFailureRef.current) reject(appendFailureRef.current.error);
				else resolve();
				return;
			}
			waitersRef.current.push({ resolve, reject });
			// "stopping" ya está terminando — quien espera simplemente llega hasta la limpieza.
			if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
		});
	}, [stop]);
	const finishFor = useCallback((id: string) => destinationRef.current?.id === id ? finishCurrent() : Promise.resolve(), [finishCurrent]);
	// Un envío principal no debe detener ni esperar una grabación de una entrada lateral.
	const finish = useCallback(() => finishFor("main"), [finishFor]);

	// Publica finish() para los subárboles hermanos (el dock de la pregunta
	// pendiente) — registrado mientras esta página sea la propietaria del hook.
	useEffect(() => {
		if (!primary) return;
		dictationFinisher = finish;
		return () => {
			if (dictationFinisher === finish) dictationFinisher = null;
		};
	}, [finish, primary]);

	const toggleFor = useCallback((destination?: DictationDestination) => {
		if (phaseRef.current === "idle") void start(destination);
		else if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
		// El foco elige dónde EMPEZAR. Una ejecución activa siempre se detiene en su
		// destino original, aunque el foco pase a otro campo.
	}, [start, stop]);
	const toggle = useCallback(() => toggleFor(), [toggleFor]);

	// Un único par compartido de oyentes de atajos, sea cual sea el número de widgets:
	// primero el control enfocado del plugin, si no, la alternativa del núcleo; Esc siempre
	// cancela al propietario real de la grabación, no al widget enfocado.
	useEffect(() => {
		warmTokens.refresh(); // emisión previa al montar (mitigación D) — en silencio si no hay clave
		return () => {
			// La navegación cancela la captura: invalida todas las esperas pendientes antes de
			// liberar recursos, y nunca anexes en la entrada de otra página.
			bufferRef.current = [];
			cleanup(false);
		};
	}, [cleanup]);
	useEffect(() => registerController(owner, { primary, toggle, cancel }), [owner, primary, toggle, cancel]);

	return {
		phase,
		destinationId,
		toggleFor,
		finishFor,
		error,
		levelRef,
		active: phase !== "idle",
		toggle,
		stop,
		finish,
		cancel,
		clearError: () => setError(null),
	};
}

/**
 * La ranura de dictado de la barra de estadísticas (colocación del responsable,
 * ronda 1): el centro de la fila es una tira que siempre ocupa todo el ancho libre —
 *
 *   inactivo  un botón "Dictate" ancho y discreto (micrófono + etiqueta, en gris —
 *             todo el centro es la indicación, según el responsable).
 *   activo    optimista desde el CLIC: píldora roja de parada + el medidor de
 *             ancho fijo (ningún texto intermedio lo desplaza nunca). Spinner
 *             mientras Deepgram vuelca el último final.
 *   error     de nuevo el botón ancho, con la etiqueta cambiada por el motivo del
 *             fallo (el texto completo en el tooltip); se limpia con el siguiente clic.
 */
export function DictationBar({ dictation, disabled = false }: { dictation: Dictation; disabled?: boolean }) {
	const { phase, error, levelRef, toggle, active, clearError, blocked } = dictation;
	const { open: openSettings } = useSettingsDialog();
	/** El clic sin clave (oleada de cero claves, trío de dictado del responsable): el
	 *  botón inactivo con error enlaza a Ajustes → Keys → la fila de Deepgram y
	 *  limpia el error — la superficie está limpia cuando el usuario vuelve.
	 *  Cualquier otro error conserva el comportamiento anterior (clic = reintentar, que limpia). */
	const keyless = error === DICTATION_KEYLESS;
	const [levels, setLevels] = useState<number[]>(() => new Array(METER_CELLS).fill(0));
	/** Número de celdas adaptativo (ronda 2 del responsable): derivado del ancho
	 *  medido del medidor — las filas estrechas muestran menos barras en vez de
	 *  desbordarse por debajo de sus vecinos. */
	const [cellCount, setCellCount] = useState(METER_CELLS);
	const meterRef = useRef<HTMLDivElement | null>(null);

	// El latido propio del medidor — muestras de la ref del nivel cada 60 ms en un
	// anillo rodante. Solo se vuelve a renderizar ESTA tira; la página nunca.
	useEffect(() => {
		if (!active) return;
		setLevels(new Array(METER_CELLS).fill(0));
		const id = setInterval(() => {
			setLevels((ring) => {
				const next = ring.slice(1);
				next.push(rmsToMeter(levelRef.current));
				return next;
			});
		}, METER_TICK_MS);
		return () => clearInterval(id);
	}, [active, levelRef]);

	// Ajusta el número de celdas al ancho disponible (paso de 4px por celda:
	// barra de 2px + hueco de 2px, acotado a 8..48). El ancho del div del medidor lo fija
	// el espacio libre de la fila — las celdas no tienen ancho mínimo —, así que medirlo
	// una vez por activación + al redimensionar mantiene honesta la tira en las
	// filas de borrador/Inicio, donde el deslizador deja poco centro.
	useEffect(() => {
		if (!active) return;
		const el = meterRef.current;
		if (!el) return;
		const fit = () => {
			const w = el.clientWidth;
			setCellCount(Math.max(8, Math.min(METER_CELLS, Math.floor(w / 4))));
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [active]);

	if (!active) {
		return (
			<Hint
				// La línea de error se trunca en el botón; su tooltip la muestra.
				label={error ?? "Dictate"}
				action={error ? undefined : "toggle-dictation"}
				side="top"
			>
				<button
					type="button"
					onClick={() => {
						if (keyless) {
							clearError();
							openSettings("keys", DEEPGRAM_KEY_ID);
						} else {
							toggle();
						}
					}}
					disabled={disabled || blocked}
					aria-label={error ? `Dictation failed: ${error}` : "Start dictation"}
					data-testid="dictation-toggle"
					className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border/50 bg-card/50 text-xs text-muted-foreground/70 shadow-lg backdrop-blur transition-colors hover:border-border hover:text-muted-foreground"
				>
					<MicIcon className="size-3.5" />
					<span className="max-w-full truncate">{error ?? "Dictate"}</span>
				</button>
			</Hint>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center gap-2" data-testid="dictation-bar">
			<Hint label="Stop dictation (Esc)" side="top">
				<button
					type="button"
					onClick={toggle}
					disabled={phase === "stopping"}
					aria-label="Stop dictation"
					data-testid="dictation-toggle"
					className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
				>
					{phase === "stopping" ? <Loader2Icon className="size-3.5 animate-spin" /> : <MicIcon className="size-3.5" />}
					Stop
				</button>
			</Hint>
			<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
			<div ref={meterRef} className="flex h-4 min-w-0 flex-1 items-center gap-[2px]" data-testid="dictation-meter">
				{levels.slice(-cellCount).map((v, i) => (
					<span
						key={i}
						className="min-w-0 flex-1 rounded-full bg-foreground/40"
						style={{ height: `${2 + Math.round(v * 14)}px` }}
					/>
				))}
			</div>
		</div>
	);
}
