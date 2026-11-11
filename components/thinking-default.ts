"use client";

/**
 * La resolución del orden por defecto, EN EL CLIENTE (fragmento 2,
 * interludio de Platform bd68486): la interfaz refleja EXACTAMENTE
 * defaultThinkingLevel de src/agent/models.ts — la primera entrada de
 * DEFAULT_THINKING_ORDER que admite el modelo; si no, el primer nivel
 * admitido; si no, "off". Una sola fuente de verdad para el orden (el barril
 * del núcleo); este auxiliar es su única interpretación en el cliente, para
 * que una elección nueva de modelo pueda autorrellenar el MISMO nivel que
 * ejecutaría el motor para un registro sin valor (decisión del responsable:
 * el ÚNICO propósito del orden es la primera asignación — una elección
 * explícita siempre gana, y tras un cambio la ESCRITURA acota en el
 * servidor, la señal vuelve a leer y se muestra la verdad acotada).
 */
import { DEFAULT_THINKING_ORDER } from "@/src/core";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** Etiquetas visibles de los niveles (compartidas por todo disparador que
 *  muestra uno). En minúsculas, siempre (ronda de refinamiento del
 *  responsable, 2026-09-24): las cadenas de nivel SON la forma visible — los
 *  menús de ajustes las renderizan en bruto, así que la píldora del composer
 *  y el diálogo de configuración deben coincidir, nunca en Title Case. */
export const THINKING_LABEL: Record<string, string> = {
	off: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/** El nivel con el que se rellena una elección nueva de `supported`. Un
 *  soporte vacío (no debería ocurrir — el catálogo siempre informa al menos
 *  ["off"]) se resuelve a "off", igual que la alternativa del servidor. */
export function defaultOrderLevel(supported: readonly ThinkingLevel[]): ThinkingLevel {
	for (const level of DEFAULT_THINKING_ORDER) {
		if (supported.includes(level)) return level;
	}
	return supported[0] ?? "off";
}

/** Un nivel EXPLÍCITO siempre viaja — aunque el modelo de la elección nueva
 *  no lo admita: la ESCRITURA lo acota en el servidor al nivel admitido más
 *  cercano (interludio de Platform bd68486 — el caso del 400 al cambiar del
 *  responsable ahora simplemente funciona), y la señal entre superficies
 *  vuelve a leer para que se muestre la verdad acotada. El orden solo asigna
 *  la PRIMERA vez: cuando no hay nivel explícito, una elección nueva de
 *  modelo rellena el nivel del orden para ese modelo (fragmento 2: el estado
 *  sin valor nunca puede volver a entrar). */
export function populateLevel(
	explicit: ThinkingLevel | undefined,
	supported: readonly ThinkingLevel[],
): ThinkingLevel {
	return explicit ?? defaultOrderLevel(supported);
}