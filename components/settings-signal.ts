"use client";

/**
 * LA señal de ajustes entre superficies (oleada de arreglos, decisión del
 * responsable 2026-09-22): todo ESCRITOR despacha tras un PUT con éxito, todo
 * LECTOR vuelve a leer — el composer refleja la ranura fuerte en el instante
 * en que la configuración guarda, la sección de ajustes refleja la elección
 * del composer en su siguiente montaje... y así sucesivamente, por
 * construcción. CustomEvent en la ventana, el patrón de lh:chat-renamed: los
 * escritores y los lectores viven en subárboles de componentes distintos
 * (diálogos en portal incluidos), y la app ya habla este dialecto.
 *
 * El evento lleva el nombre de la sección para que UN evento sirva a todas
 * las secciones — los lectores filtran por lo que de verdad leen.
 */
import { useEffect, useRef } from "react";

export const SETTINGS_SAVED_EVENT = "lh:settings-saved";

/** Las secciones de ajustes que un escritor puede tocar (la unión de la frontera de escritura). */
// "keys" se sumó a la lista (oleada sin claves, 2026-09-25): keys-section
// lo despacha tras guardar Y tras borrar — los borrados antes eran invisibles para
// la píldora sin claves y el avance automático del diálogo de configuración.
export type SettingsSection = "general" | "keys" | "agent" | "models" | "appearance" | "graph" | "compaction" | "dictation" | "claudeCode";

/** Los escritores llaman a esto cuando el PUT se resuelve bien — nunca antes (una
 *  escritura fallida no avisa de nada; el registro no ha cambiado). */
export function notifySettingsSaved(section: SettingsSection): void {
	window.dispatchEvent(
		new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { section } }),
	);
}

/** Listener que no es hook (fronteras imperativas, pruebas). Devuelve la baja. */
export function onSettingsSaved(handler: (section: SettingsSection) => void): () => void {
	const listener = (e: Event) => {
		const section = (e as CustomEvent<{ section?: SettingsSection }>).detail?.section;
		if (section !== undefined) handler(section);
	};
	window.addEventListener(SETTINGS_SAVED_EVENT, listener);
	return () => window.removeEventListener(SETTINGS_SAVED_EVENT, listener);
}

/** Suscripción del lector: se vuelve a invocar cada vez que llega un
 *  escritor, con el manejador capturado mediante una ref para que quien llama
 *  nunca rehaga la suscripción (ni la cierre con un valor obsoleto). */
export function useSettingsSaved(handler: (section: SettingsSection) => void): void {
	const saved = useRef(handler);
	saved.current = handler;
	useEffect(() => onSettingsSaved((section) => saved.current(section)), []);
}
