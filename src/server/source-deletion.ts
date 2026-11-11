import { deleteSourcesTraces } from "../core/graph-deletion.ts";
import { folderIsEmpty, type SourceDirectory } from "../core/source-organization.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { stores } from "./stores.ts";
import { sourceDirectory } from "./source-organization.ts";
import { deleteIdleChatRecord, runningWorkBlocker } from "./chats.ts";
import { graphRevision } from "./graph.ts";

export class SourceDeletionError extends Error {
	constructor(message: string, public status = 400, public code = "invalid_source_deletion") { super(message); }
}
export interface SourceDeletionRequest { sourceIds: string[]; folderIds: string[]; deleteSessions: boolean }
export function parseSourceDeletion(raw: unknown): SourceDeletionRequest {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SourceDeletionError("Invalid source deletion request.");
	const r = raw as Record<string, unknown>;
	const ids = (value: unknown) => {
		if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0)) throw new SourceDeletionError("Source and folder IDs must be arrays of non-empty strings.");
		return [...new Set(value)] as string[];
	};
	if (typeof r.deleteSessions !== "boolean") throw new SourceDeletionError("Session deletion must be explicitly selected or declined.");
	const result = { sourceIds: ids(r.sourceIds), folderIds: ids(r.folderIds), deleteSessions: r.deleteSessions };
	if (!result.sourceIds.length && !result.folderIds.length) throw new SourceDeletionError("Select at least one source or folder.");
	return result;
}

/** Un único tramo síncrono de borrado, tras el mismo rechazo global por extracción que el
 * antiguo borrado de la vista de cadenas. No se cancelan importaciones ni turnos. Las entradas
 * ausentes no causan daño al reintentar tras un fallo de E/S parcialmente completado. */
export function deleteSources(raw: unknown): SourceDirectory & { graphRevision: number } {
	const request = parseSourceDeletion(raw);
	const directory = sourceDirectory.read(); // se valida la organización antes de cualquier escritura destructiva
	const targets = directory.sources.filter((s) => request.sourceIds.includes(s.id));
	if (targets.length && extractionStatuses().length) throw new SourceDeletionError("An extraction is running — try again when the activity dock drains.", 409, "extraction_running");
	if (request.deleteSessions) for (const entry of targets) if (entry.kind === "chat") {
		const blocker = runningWorkBlocker(entry.id);
		if (blocker) throw new SourceDeletionError(blocker.error, blocker.status, blocker.code);
	}
	// Se limpia todo el lote seleccionado en una sola reescritura del grafo. Los chats conservados
	// también pierden la cobertura/los puntos de control, para que sus mensajes sin cambios puedan volver a extraerse.
	deleteSourcesTraces(stores.graphStore, new Set(targets.map((s) => s.id)), "delete-nodes");
	stores.graphStore.deleteSources(new Set(targets.filter((s) => s.kind === "notes").map((s) => s.id)));
	const removed = new Set(request.sourceIds.filter((id) => !directory.sources.some((s) => s.id === id)));
	for (const entry of targets) {
		if (entry.kind === "chat" && request.deleteSessions) {
			const outcome = deleteIdleChatRecord(entry.id);
			if (!outcome.ok) throw new SourceDeletionError(outcome.error, outcome.status, outcome.code);
			removed.add(entry.id);
		} else if (entry.kind !== "chat") removed.add(entry.id);
	}
	const state = structuredClone(directory.organization);
	state.placements = Object.fromEntries(Object.entries(state.placements).filter(([id]) => !removed.has(id)));
	const remainingSources = new Set(sourceDirectory.read().sources.map((s) => s.id));
	// Punto fijo de abajo arriba: se quitan los descendientes vacíos seleccionados y luego sus
	// ancestros que se han quedado vacíos. Las conversaciones conservadas y las entradas no seleccionadas impiden quitarlos.
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of request.folderIds) {
			if (state.folders.some((f) => f.id === id) && folderIsEmpty(state, id, remainingSources)) {
				state.folders = state.folders.filter((f) => f.id !== id);
				state.placements = Object.fromEntries(Object.entries(state.placements).filter(([, p]) => p.folderId !== id));
				changed = true;
			}
		}
	}
	if (JSON.stringify(state) !== JSON.stringify(directory.organization)) stores.sourceOrganizationStore.write(state);
	return { ...sourceDirectory.read(), graphRevision: graphRevision() };
}
