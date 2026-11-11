import { getClaudeBinary } from "../agent/claude-code/binary.ts";
import { settingsStore } from "../store/settings.ts";

/** Estado de admisión actual, no una caché de todo el proceso. Las ejecuciones existentes
 * conservan sus motores; solo lo consultan las nuevas admisiones de chat/tarea/extracción/compactación. */
export function claudeCodeEnabled(): boolean {
	return settingsStore.readSettings()?.claudeCode?.enabled === true;
}

/** Solo disponibilidad de instalación/opción activada, nunca que esté lista y autenticada. */
export function claudeCodeAvailable(): boolean {
	return claudeCodeEnabled() && getClaudeBinary() !== null;
}
