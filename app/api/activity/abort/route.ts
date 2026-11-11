/**
 * POST /api/activity/abort — el control de TERMINAR/ABORTAR del dock,
 * uniforme para todos los tipos de proceso (contrato decidido por el
 * usuario): cuerpo {kind: "job"|"plugin-worker"|"extraction"|"turn", id}
 * donde id es el jobId para las tareas de subagentes, el chatId para las
 * ejecuciones de extracción (el registro del proceso de extracción tiene
 * chat como clave) y el chatId para los turnos (oleada de turnos en segundo
 * plano, 2026-09-25: un turno en marcha es un objeto en segundo plano —
 * cualquier cliente puede detenerlo aquí; que una vista se vaya NUNCA lo
 * mata). Los mecanismos viven en sus dominios — abortJob (server/jobs.ts,
 * flujo de agentes), abortExtraction (el módulo del proceso de extracción,
 * flujo del grafo) y abortTurn (server/turn-runs.ts, el registro de turnos
 * en marcha); esta ruta es la composición fina.
 *
 * Resultados: not_found de una tarea -> 404, not_running -> 409,
 * aborted -> 200. Un turno sigue la misma semántica que las tareas:
 * not_running -> 409 (un honesto "no hay nada que abortar" — quien llama
 * vuelve a pedir), aborted -> 200 (el parcial se persiste por la ruta de
 * asentamiento habitual y todos los suscriptores se cierran limpiamente).
 * El abort de la extracción es idempotente por diseño (abortar sin nada en
 * vuelo es un éxito — la burbuja desaparece igualmente) -> 200.
 */
import { abortExtraction, abortJob, abortPluginWorkerActivity, abortTurn } from "@/src/server";

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const { kind, id } = (body ?? {}) as { kind?: string; id?: string };
	if ((kind !== "job" && kind !== "plugin-worker" && kind !== "extraction" && kind !== "turn") || typeof id !== "string" || id === "") {
		return Response.json({ error: 'Body must be {kind: "job"|"plugin-worker"|"extraction"|"turn", id: string}' }, { status: 400 });
	}
	if (!/^[A-Za-z0-9:_-]+$/.test(id)) {
		return Response.json({ error: "Invalid id" }, { status: 400 });
	}

	if (kind === "job") {
		const outcome = abortJob(id);
		if (!outcome.ok) {
			const status = outcome.reason === "not_found" ? 404 : 409;
			return Response.json({ ok: false, reason: outcome.reason }, { status });
		}
		return Response.json({ ok: true });
	}
	if (kind === "plugin-worker") {
		if (!abortPluginWorkerActivity(id)) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
		return Response.json({ ok: true });
	}
	if (kind === "turn") {
		const outcome = abortTurn(id);
		if (!outcome.ok) return Response.json({ ok: false, reason: outcome.reason }, { status: 409 });
		return Response.json({ ok: true });
	}
	// kind === "extraction": cancelación real; idempotente (sin nada en
	// vuelo es un éxito — el mismo resultado en el dock)
	abortExtraction(id);
	return Response.json({ ok: true });
}
