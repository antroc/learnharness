"use client";

/**
 * LA MITAD CLIENTE DEL CANAL DE NOTIFICACIONES (corte 3 de la arquitectura
 * push, 2026-10-02): UN EventSource("/api/events") por ventana abierta,
 * mantenido durante toda la vida de la ventana — el canal que retira el
 * entramado de sondeos periódicos de la app. Todo cambio iniciado por el
 * servidor llega como una trama SSE con nombre; los consumidores responden
 * pidiendo la verdad (notificar → pedir, todo el truco de la arquitectura —
 * ver src/core/events.ts y server/events-stream.ts).
 *
 * Este fichero es el ÚNICO sitio de la app que sabe que existe EventSource.
 * La reconexión automática es la del propio EventSource — nunca se combate,
 * siempre se aprovecha: cada (re)apertura dispara los callbacks de
 * resincronización, así que una reconexión se repara con una petición
 * normal por consumidor (un reinicio del servidor de desarrollo se repara
 * solo aquí).
 *
 * Forma: el proveedor tiene un hub (difusión local a la ventana — el gemelo
 * en el cliente del bus del servidor; por ventana, NO globalThis: la conexión
 * de cada ventana es suya) y conecta UNA fuente a él. Los hooks son finos:
 * callbacks con ref a lo último (los eventos se disparan entre renders —
 * nunca te fíes de un cierre obsoleto) más la pertenencia al hub durante la
 * vida del componente.
 *
 * FRONTERA DE PRUEBAS: `connect` inyecta la fábrica de la fuente — el hub y
 * la conexión son funciones simples que las pruebas manejan directamente
 * (sin React, sin servidor); el pegamento de React es una frontera adaptadora
 * como lh:turn-state (sin probar, por precedente, components/session.ts).
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { SERVER_EVENT_TYPES, type ServerEventType, type ServerEvents } from "@/src/core";

/** La superficie mínima de fuente que consume el proveedor — EventSource
 *  detrás en producción, imitaciones en las pruebas. */
export interface NotifySource {
	close(): void;
	onOpen(cb: () => void): void;
	onEvent(name: string, cb: (data: string) => void): void;
}

export function openEventsChannel(): NotifySource {
	const es = new EventSource("/api/events");
	return {
		close: () => es.close(),
		onOpen: (cb) => {
			es.onopen = () => cb();
		},
		onEvent: (name, cb) => {
			es.addEventListener(name, (ev) => cb((ev as MessageEvent).data));
		},
	};
}

/** La difusión por ventana: suscripciones tipadas sobre una fuente. Los
 *  errores de los listeners se aíslan según la ley del bus (un consumidor
 *  defectuoso nunca rompe la ventana), y el despacho recorre una instantánea
 *  (darse de baja durante el despacho es seguro). */
export function createNotifyHub() {
	const byType = new Map<string, Set<(data: never) => void>>();
	const resyncs = new Set<() => void>();
	return {
		subscribe<K extends ServerEventType>(type: K, cb: (payload: ServerEvents[K]) => void) {
			const set = byType.get(type) ?? new Set<(data: never) => void>();
			byType.set(type, set);
			const slot = cb as unknown as (data: never) => void;
			set.add(slot);
			return () => set.delete(slot);
		},
		/** Callbacks de resincronización: se disparan en cada (re)apertura de la
		 *  fuente — "puede que te hayas perdido eventos mientras estabas
		 *  desconectado; vuelve a pedir". Un consumidor que se monta con la fuente YA
		 *  abierta no recibe disparo (no se ha perdido nada desde que nació); su
		 *  propia petición al montar es su verdad inicial. */
		onResync(cb: () => void) {
			resyncs.add(cb);
			return () => resyncs.delete(cb);
		},
		/** Ha llegado una trama con nombre: analizar y difundir. Las tramas que no se
		 *  pueden analizar se descartan haciendo ruido — las cargas del canal son
		 *  diminutas y sin esquema, y una trama defectuosa nunca debe dispararse a medias. */
		dispatch(name: string, raw: string) {
			const set = byType.get(name);
			if (!set) return;
			let payload: unknown;
			try {
				payload = JSON.parse(raw);
			} catch (err) {
				console.error(`[events] unparseable frame for ${name}:`, err);
				return;
			}
			for (const cb of [...set]) {
				try {
					(cb as unknown as (data: unknown) => void)(payload);
				} catch (err) {
					console.error(`[events] ${name} handler failed:`, err);
				}
			}
		},
		fireOpen() {
			for (const cb of [...resyncs]) {
				try {
					cb();
				} catch (err) {
					console.error("[events] resync handler failed:", err);
				}
			}
		},
	};
}

/** Conecta una fuente a un hub — TODO el cuerpo del efecto del proveedor,
 *  extraído para que la conexión se pueda probar sin React. Devuelve la desconexión. */
export function wireSource(source: NotifySource, hub: ReturnType<typeof createNotifyHub>): () => void {
	for (const name of SERVER_EVENT_TYPES) source.onEvent(name, (raw) => hub.dispatch(name, raw));
	source.onOpen(() => hub.fireOpen());
	return () => source.close();
}

// ── el pegamento de React ───────────────────────────────────────────────────

const EventsContext = createContext<ReturnType<typeof createNotifyHub> | null>(null);

/** Los adaptadores de transporte también pueden montarse aislados con un puente inyectado. */
export function useNotifyHub() { return useContext(EventsContext); }

export function ServerEventsProvider({ children, connect }: { children: ReactNode; connect?: () => NotifySource }) {
	const hub = useMemo(() => createNotifyHub(), []);
	useEffect(() => wireSource((connect ?? openEventsChannel)(), hub), [hub, connect]);
	return <EventsContext.Provider value={hub}>{children}</EventsContext.Provider>;
}

/** Suscríbete a un tipo de evento durante la vida de este componente. El
 *  callback es una ref a lo último: pasa cierres en línea sin miedo — se
 *  ejecuta el cierre del render más reciente, así que es seguro leer el
 *  estado capturado en el último render completado (el proveedor lo vuelve a
 *  guardar en cada render). */
export function useServerEvent<K extends ServerEventType>(type: K, cb: (payload: ServerEvents[K]) => void): void {
	const hub = useContext(EventsContext);
	if (!hub) throw new Error("useServerEvent requires <ServerEventsProvider>");
	const cbRef = useRef(cb);
	cbRef.current = cb;
	useEffect(() => {
		const off = hub.subscribe(type, (payload) => cbRef.current(payload));
		return () => {
			off();
		};
	}, [hub, type]);
}

/** Vuelve a pedir la verdad en cada (re)conexión del canal de la ventana — la
 *  frontera de autorreparación para las reconexiones de EventSource y los reinicios del servidor de desarrollo. */
export function useServerResync(cb: () => void): void {
	const hub = useContext(EventsContext);
	if (!hub) throw new Error("useServerResync requires <ServerEventsProvider>");
	const cbRef = useRef(cb);
	cbRef.current = cb;
	useEffect(() => {
		const off = hub.onResync(() => cbRef.current());
		return () => {
			off();
		};
	}, [hub]);
}
