/**
 * LA RAÍZ DE COMPOSICIÓN del almacenamiento: el único sitio donde se conectan
 * los adaptadores de almacén concretos. Todo lo demás (núcleo, servicios,
 * agentes) se programa contra los tipos de puerto de core/ports.ts y recibe
 * las instancias a través de este módulo. Cambiar más adelante el adaptador de
 * sistema de ficheros por SQLite modifica exactamente este fichero (y las
 * implementaciones de los adaptadores en src/store/).
 */

import { chatStore } from "../store/chats.ts";
import { graphStore } from "../store/graph.ts";
import { sourceOrganizationStore } from "../store/source-organization.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import { themeStore } from "../store/themes.ts";
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
import { syncCustomProvider } from "./custom-provider.ts";
import { configureWorkerRequestAdmission } from "../agent/worker-request-admission.ts";
/** Los adaptadores conectados. Cumple estructuralmente el GraphDeps de core/graph.ts. */
export const stores = {
	chatStore,
	graphStore,
	sourceOrganizationStore,
	jobStore,
	settingsStore,
	themeStore,
};

export type Stores = typeof stores;

/**
 * La vista resuelta del registro de ajustes (core/settings-resolution.ts):
 * cada control concreto sobre su valor de fábrica, EXCEPTO LOS MODELOS (BYOK
 * hasta el fondo, responsable 2026-09-22): no existen fijaciones de fábrica,
 * así que las ranuras de modelo sin definir se resuelven como null y las
 * barreras de rechazo por necesidad se disparan más adelante. Se lee de nuevo
 * en cada llamada: el registro es un fichero pequeño y los turnos son poco
 * frecuentes, así que no hay capa de caché (unos conmutadores obsoletos tras
 * un PUT de ajustes serían peores).
 */
export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsStore.readSettings());
}

// La política de ejecución se aporta en la raíz de composición; los agentes nunca la importan.
configureWorkerRequestAdmission(() => effectiveSettings().agent.workerRequestConcurrency);

// Arranque: se registra el endpoint personalizado (si está configurado) en piModels(); la
// ruta POST /api/custom-provider vuelve a sincronizar tras cada conexión.
syncCustomProvider();
