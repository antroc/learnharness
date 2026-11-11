"use client";
/**
 * Las superficies sin claves (oleada sin claves, 2026-09-25, fijado por el
 * responsable por encima de la barrera de presencia de claves 66dbea9 de
 * Platform): cuando NO existe ninguna clave de proveedor de modelos, chat /
 * inicio / /chat/new suben al composer una píldora — "Add a provider key" —
 * que tiene PRIORIDAD sobre la CTA de configuración de modelos (las claves
 * van primero en la cadena: los selectores de modelos solo listan lo que
 * desbloquean las claves). El clic abre el SetupDialog, cuya etapa se deriva
 * sola a la pantalla de la primera clave.
 *
 * Verdad: GET /api/keys — hay una clave de PROVEEDOR (en env o en fichero;
 * las claves de herramientas como Deepgram no cuentan — no desbloquean
 * modelos). Las actualizaciones en vivo llegan por la señal "keys" de
 * lh:settings-saved (keys-section la despacha tras guardar Y borrar; la
 * pantalla de primera clave del diálogo de configuración la despacha al
 * guardar), el mismo patrón de volver a leer que usa chat.tsx para "models".
 */

import { useEffect, useState } from "react";
import { CUSTOM_PROVIDER, MODEL_SLOTS, type AuthKeyStatus, type ModelCatalogResponse } from "@/src/core";
import { classifyKeys, type ProviderKeyInfo } from "@/components/settings/keys-section";
import { useModelCatalog } from "@/components/model-catalog";

/** Pura: ¿existe una clave de PROVEEDOR DE MODELOS entre los estados?
 *  Reutiliza classifyKeys (la clasificación propia de la sección de claves —
 *  sin divergencias): cuenta un estado cuyo id es una variable de entorno de
 *  proveedor (o la forma alternativa previa al interludio) con present=true,
 *  presente o procedente de fichero, incluida la que es propiedad de env
 *  (env gana, pero EXISTE). Exportada para las fijaciones. */
export function hasProviderKey(
	statuses: readonly AuthKeyStatus[],
	providers: readonly ProviderKeyInfo[] | undefined,
): boolean {
	// Una clave de endpoint personalizado guardada también cuenta: classifyKeys la quita
	// de providerRows (tiene su propia fila dedicada), pero un endpoint personalizado
	// conectado ES una forma de ejecutar inferencia, así que supera la barrera sin claves.
	return (
		classifyKeys(statuses, providers).providerRows.some((s) => s.present) ||
		statuses.some((s) => s.id === CUSTOM_PROVIDER.envVar && s.present)
	);
}

/** La compleción es la identidad guardada, no la disponibilidad actual del proveedor. */
export function savedSlotsConfigured(slots: ModelCatalogResponse["slots"] | undefined): boolean {
	return MODEL_SLOTS.every((slot) => !!slots?.[slot]?.model);
}

/** Conserva la última compleción conocida durante la invalidación de la conexión, pero
 * sigue las reparaciones normales de ranuras en cuanto llega su instantánea compartida. */
export function useModelSetup(initialConfigured: boolean) {
	const { catalog } = useModelCatalog();
	const [lastConfigured, setLastConfigured] = useState(initialConfigured);
	const configured = catalog ? savedSlotsConfigured(catalog.slots) : lastConfigured;
	useEffect(() => { if (catalog) setLastConfigured(savedSlotsConfigured(catalog.slots)); }, [catalog]);
	return { catalog, configured, zeroKeys: catalog ? !catalog.providers.some((p) => p.keyPresent) : false };
}

/** Una ruta que se sabe no disponible necesita una sustitución explícita, nunca un
 * cambio automático de proveedor/modelo. Los metadatos desconocidos se remiten a la
 * barrera de admisión del servidor en lugar de declarar desconectada una ruta. */
export function selectedModelUnavailable(catalog: ModelCatalogResponse | undefined, selected: string | undefined): boolean {
	return !!catalog && !!selected && !catalog.models.some((m) => `${m.provider}:${m.id}` === selected);
}

/** Reutiliza el control normal (que también abre la acción de teclado existente). */
export function openModelPicker(): void {
	window.dispatchEvent(new CustomEvent("lh:kbd-open-model-picker"));
}

/** La verdad sin claves para la página que llama: TRUE solo después de
 *  que una lectura con éxito diga que no existe ninguna clave de proveedor
 *  (las lecturas pendientes y fallidas no renderizan nada — la píldora nunca
 *  debe parpadear en un hueco, y una lectura fallida que afirmara "cero
 *  claves" sería una mentira en la que luego se apoyaría el flujo de la CTA).
 *  Vuelve a leer con la señal de claves. */
export function useZeroKeys(): boolean {
	const { catalog } = useModelCatalog();
	return catalog ? !catalog.providers.some((provider) => provider.keyPresent) : false;
}

/** La píldora en sí — el cromo y la colocación de la CTA de modelos, el
 *  texto de la cadena de claves. testid "setup-cta-keys" (la CTA de modelos
 *  mantiene "setup-cta"; los sondeos pueden distinguirlas). */
export function ZeroKeysPill({ onOpen, inline = false }: { onOpen: () => void; inline?: boolean }) {
	const button = (
		<button
			type="button"
			data-testid="setup-cta-keys"
			onClick={onOpen}
			className="rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
		>
			Add a provider key
		</button>
	);
	return inline ? button : <div className="pointer-events-auto mb-2 flex justify-center">{button}</div>;
}
/** Pura: la ranura fuerte está fijada a un proveedor cuya clave ya NO está
 *  (interludio del responsable, 2026-09-25 — el escenario original de la
 *  clave borrada). El catálogo ya conoce ambas mitades: slots.strong es la
 *  fijación resuelta, providers[] lista solo los proveedores con clave
 *  PRESENTE (los que no tienen clave no aparecen, la misma disciplina que los
 *  motores de búsqueda). False cuando la ranura fuerte no tiene valor (de ese
 *  caso se encarga la guarda de modelos — esta comprobación solo corre cuando
 *  las ranuras SÍ están configuradas) o el catálogo no se ha cargado (la
 *  barrera del servidor sigue siendo el cinturón). Exportada para las
 *  fijaciones. */
export function strongKeyless(catalog: ModelCatalogResponse | undefined): boolean {
	const strong = catalog?.slots.strong;
	if (!strong) return false;
	return !catalog.providers.some((p) => p.id === strong.model.provider && p.keyPresent);
}

/** La verdad de ranura fuerte sin clave para la guarda PREVIA AL ENVÍO
 *  (inicio / /chat/new): la frontera del catálogo, que vuelve a leer con
 *  AMBAS señales que pueden cambiarla — "keys" (una clave de proveedor
 *  guardada o borrada) y "models" (la ranura fuerte refijada). Se actualiza en
 *  vivo con la página, nunca a mitad de un envío. */
export function useStrongKeyless(): boolean {
	const { catalog } = useModelCatalog();
	return strongKeyless(catalog);
}
