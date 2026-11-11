/** Solo metadatos vivos. Nunca se lee el historial de tareas para mostrar el feed de actividad. */
import type { PluginWorkerActivityMetadata } from "../agent/plugin-workers.ts";
import { emit } from "../core/events.ts";

export interface PluginWorkerActivity extends Omit<PluginWorkerActivityMetadata, "id" | "status"> {
	status: "queued" | "running";
	/** Identidad opaca de actividad/cancelación, no un chat ni una tarea duradera. */
	id: string;
	taskId: string;
	pluginId: string;
	title: string;
}
interface Activation {
	rows: Map<string, PluginWorkerActivity>;
	cancel(taskId: string): void;
	cleanup(): void;
}
interface ActivityGlobal { __lhPluginWorkerActivity?: Map<string, Activation> }
function registry(): Map<string, Activation> {
	const global = globalThis as typeof globalThis & ActivityGlobal;
	return global.__lhPluginWorkerActivity ??= new Map();
}

/** Un registro por activación. Las señales/callbacks antiguos no pueden borrar a un sustituto. */
export function registerPluginWorkerActivity(deps: {
	pluginId: string;
	pluginName: string;
	signal: AbortSignal;
	cancel(taskId: string): void;
}): (metadata: PluginWorkerActivityMetadata) => void {
	const entries = registry();
	entries.get(deps.pluginId)?.cleanup();
	const activation: Activation = { rows: new Map(), cancel: deps.cancel, cleanup };
	function cleanup() {
		deps.signal.removeEventListener("abort", cleanup);
		if (entries.get(deps.pluginId) !== activation) return;
		entries.delete(deps.pluginId);
		if (activation.rows.size) { activation.rows.clear(); emit("activity-changed", {}); }
	}
	if (!deps.signal.aborted) {
		entries.set(deps.pluginId, activation);
		deps.signal.addEventListener("abort", cleanup, { once: true });
	}
	return metadata => {
		if (deps.signal.aborted || entries.get(deps.pluginId) !== activation) return;
		if (metadata.status !== "queued" && metadata.status !== "running") {
			if (activation.rows.delete(metadata.id)) emit("activity-changed", {});
			return;
		}
		const row: PluginWorkerActivity = {
			...structuredClone(metadata), status: metadata.status, id: `${deps.pluginId}:${metadata.id}`,
			taskId: metadata.id, pluginId: deps.pluginId,
			title: `${deps.pluginName} · ${metadata.definitionId}`,
		};
		activation.rows.set(metadata.id, row);
		emit("activity-changed", {});
	};
}

/** Proyección de solo lectura sobre los servicios activos; sin suscripciones al sistema de ficheros ni a tareas. */
export function pluginWorkerActivities(): PluginWorkerActivity[] {
	return [...registry().values()].flatMap(activation => [...activation.rows.values()].map(row => structuredClone(row)));
}

/** Solo el servicio activo en ese momento puede recibir END. Los errores de almacenamiento/cancelación se propagan. */
export function abortPluginWorkerActivity(id: string): boolean {
	const separator = id.indexOf(":");
	if (separator < 1) return false;
	const activation = registry().get(id.slice(0, separator));
	const taskId = id.slice(separator + 1);
	if (!activation?.rows.has(taskId)) return false;
	activation.cancel(taskId);
	return true;
}
