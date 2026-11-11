/**
 * JobStore: el adaptador JSON de fs: un fichero por tarea de subagente en segundo plano en
 * data/jobs/ ("THE ASYNC PROTOCOL" de contracts.ts). Indexado por toolCallId para
 * deduplicar: el hook de lanzamiento del chat-handler nunca crea dos tareas para la misma
 * parte de herramienta. Implementa el JobStore de core/ports.ts. Patrones: fs síncrono, nombres
 * de fichero protegidos por id, JSON con sangría de tabuladores. Las escrituras son pequeñas y raras (actualizaciones
 * de la línea de actividad); las secciones de lectura-modificación-escritura no contienen awaits. Las tareas
 * vinculadas a plugins requieren sustitución atómica antes de confirmar el vínculo. Las tareas nativas
 * conservan el respaldo de compatibilidad de Windows para ficheros retenidos (integración del responsable q22).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { JobStore } from "../core/ports.ts";
import type { CreateJobInit, JobPatch } from "../core/ports.ts";
import type { JobRecord } from "../core/contracts.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

/** Tareas en segundo plano (data/jobs). No está en los PATHS de config.ts (propiedad del orquestador). */
const JOBS_DIR = path.join(/* turbopackIgnore: true */ PATHS.data, "jobs");

function jobFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid job id: ${id}`);
	return path.join(/* turbopackIgnore: true */ JOBS_DIR, `${id}.json`);
}

/** Usa la ley compartida de reintento/limpieza, pero nunca trunca una tarea vinculada a un plugin.
 * Los metadatos también hacen estricta una tarea builtin: un vínculo de plugin aceptado debe seguir
 * siendo legible aunque su worker sea nativo. Una identidad de plugin malformada/ausente
 * no puede conceder a las tareas de tipo plugin permiso para recurrir a la escritura en el sitio. */
function writeJob(record: JobRecord): void {
	const strict = record.kind === "plugin" || record.plugin !== undefined;
	writeFileAtomicSync(jobFile(record.id), JSON.stringify(record, null, "\t"), {
		allowInPlaceFallback: !strict,
		...(strict ? { mode: 0o600 } : {}),
	});
	if (strict && process.platform !== "win32") {
		const directory = fs.openSync(JOBS_DIR, "r");
		try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
	}
}

/** Las escrituras se anuncian en el canal de eventos DESPUÉS de que llegue la escritura (la
 *  ley de notificar tras escribir, precedente de beginTurn): jobs-changed es lo que
 *  retira el sondeo por intervalo de la vista (push S4, 2026-10-02): las tarjetas de despacho,
 *  las líneas de progreso, los asentamientos y los abortos afloran todos como una sola petición. */
function createJob(init: CreateJobInit): JobRecord {
	const now = new Date().toISOString();
	const record: JobRecord = {
		id: `job_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		kind: init.kind,
		chatId: init.chatId,
		toolCallId: init.toolCallId,
		...(init.input !== undefined ? { input: init.input } : {}),
		status: "running",
		activity: init.activity ?? "starting",
		createdAt: now,
		updatedAt: now,
		...(init.plugin ? { plugin: init.plugin } : {}),
	};
	fs.mkdirSync(JOBS_DIR, { recursive: true });
	writeJob(record);
	emit("jobs-changed", { chatId: init.chatId });
	return record;
}

function getJob(id: string): JobRecord | null {
	try {
		return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ jobFile(id), "utf-8")) as JobRecord;
	} catch {
		return null;
	}
}

/** Fusiona un parche parcial en el registro (los campos de identidad son inmutables).
 *  Se respeta un patch.updatedAt explícito (las pruebas fijan un orden determinista);
 *  si no, la fusión lo actualiza a ahora. */
function updateJob(id: string, patch: JobPatch): JobRecord | null {
	const record = getJob(id);
	if (!record) return null;
	const next: JobRecord = { ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
	writeJob(next);
	// TODA escritura, no solo los cambios de estado: las actualizaciones de la línea de progreso deben llegar
	// a las tarjetas de despacho (la vista agrupa las ráfagas de peticiones). Un id inexistente
	// no escribió nada y se queda en silencio.
	emit("jobs-changed", { chatId: next.chatId });
	return next;
}

/** Todas las tareas de un chat, con la actividad más reciente primero. */
function listJobs(chatId: string): JobRecord[] {
	try {
		fs.mkdirSync(JOBS_DIR, { recursive: true });
		return fs
			.readdirSync(/* turbopackIgnore: true */ JOBS_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getJob(f.slice(0, -5)))
			.filter((j): j is JobRecord => j !== null && j.chatId === chatId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** La tarea que cumple una parte de herramienta dada, si existe (deduplicación del hook de lanzamiento). */
function findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null {
	return listJobs(chatId).find((j) => j.toolCallId === toolCallId) ?? null;
}

/** Borra todos los ficheros de registro de tareas de un chat (oleada 6 de borrado de sesiones):
 *  en ejecución o terminadas, son registros del chat y mueren con él.
 *  Devuelve cuántos ficheros se eliminaron. La ruta de borrado se niega mientras
 *  haya tareas en ejecución, así que todo registro de aquí está terminado. */
function deleteJobsForChat(chatId: string): number {
	let removed = 0;
	for (const job of listJobs(chatId)) {
		try {
			fs.unlinkSync(jobFile(job.id));
			removeLeftoverTemps(jobFile(job.id));
			removed++;
		} catch {
			/* ya no existe: el recuento es una verdad de mejor esfuerzo */
		}
	}
	// Solo cuando algo murió de verdad: un borrado de cero ficheros no escribió nada
	// (la ley de la entrada presente de endTurn).
	if (removed > 0) emit("jobs-changed", { chatId });
	return removed;
}

export const jobStore: JobStore = {
	createJob,
	getJob,
	updateJob,
	listJobs,
	findJobByToolCallId,
	deleteJobsForChat,
};
