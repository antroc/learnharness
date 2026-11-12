/**
 * Pruebas del feed de actividad: la composición del dock
 * (server/observability.ts).
 *
 * Almacenes reales con chats/tareas de fixture, que se limpian en una prueba
 * de nivel superior. Verifica la recopilación entre chats, el filtrado de
 * solo las que están en curso, el cruce con los títulos, el orden estable de
 * la más antigua a la más nueva y el informe de los chats ocupados.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { PATHS } from "../config.ts";
import { activityFeed } from "../src/server/observability.ts";

test("activityFeed: running jobs across ALL chats, running-only, title-joined, oldest first", () => {
	const chatA = chatStore.createChat("feed chat A");
	const chatB = chatStore.createChat("feed chat B");
	// ids de tarea registrados al crearse: la limpieza del finally se limita a ellos aunque
	// la prueba lance a mitad (los ficheros de prueba se ejecutan como procesos concurrentes sobre
	// el data/ temporal compartido; borrar todo el directorio de tareas eliminaría las fixtures
	// vivas de otros procesos: la lección de la prueba inestable de la oleada 4)
	const createdJobs: string[] = [];
	try {
		const jobA = jobStore.createJob({ kind: "research", chatId: chatA.id, toolCallId: "tc_a" });
		const jobB = jobStore.createJob({ kind: "demo", chatId: chatB.id, toolCallId: "tc_b" });
		const jobDone = jobStore.createJob({ kind: "research", chatId: chatA.id, toolCallId: "tc_done" });
		createdJobs.push(jobA.id, jobB.id, jobDone.id);
		jobStore.updateJob(jobDone.id, { status: "done" });
		const jobB2 = jobStore.createJob({ kind: "research", chatId: chatB.id, toolCallId: "tc_b2" });
		createdJobs.push(jobB2.id);
		// hace que jobB2 sea la activa MÁS reciente → aun así debe ordenarse DESPUÉS de jobA/jobB (de la más antigua a la más nueva).
		// Marca de tiempo posterior explícita: la actualización real puede caer en el mismo ms que la creación.
		jobStore.updateJob(jobB2.id, { activity: "second step", updatedAt: new Date(Date.now() + 10).toISOString() });

		const feed = activityFeed();
		const feedJobs = feed.jobs.filter((j) => [jobA.id, jobB.id, jobB2.id].includes(j.id));
		assert.equal(feedJobs.length, 3); // la tarea terminada se filtra
		for (const j of feedJobs) {
			assert.ok(j.title.length > 0, "title joined onto every job");
			assert.equal(typeof j.chatId, "string");
		}
		// el cruce de título es el título del chat
		assert.equal(feedJobs.find((j) => j.id === jobA.id)?.title, "feed chat A");
		// de la más antigua a la más nueva según updatedAt: jobA/jobB se crearon antes de la actualización de jobB2
		const order = feedJobs.map((j) => j.id);
		assert.equal(order.indexOf(jobB2.id), order.length - 1);

		// las ejecuciones de extracción no aparecen cuando el proceso está en reposo (registro vacío)
		assert.deepEqual(feed.extractions, []);
	} finally {
		fs.unlinkSync(`${PATHS.chats}/${chatA.id}.json`);
		fs.unlinkSync(`${PATHS.chats}/${chatB.id}.json`);
		const jobsDir = path.join(PATHS.data, "jobs");
		for (const id of createdJobs) {
			fs.unlinkSync(path.join(jobsDir, `${id}.json`));
		}
	}
});

test("activityFeed: contextLimit is the server's live-catalog join (owner amendment, 2026-09-23)", () => {
	// federación de proveedores con clave: el mismo patrón de claves de entorno que las
	// pruebas del catálogo de modelos; local al fichero (cada fichero de prueba es su propio proceso)
	process.env.OPENROUTER_API_KEY ??= "test-key-openrouter-catalog";
	const chat = chatStore.createChat("limit join chat");
	const createdJobs: string[] = [];
	const usageFor = (model: string) => ({
		model,
		inputTokens: 1_000,
		outputTokens: 100,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		steps: 1,
	});
	try {
		const known = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "tc_known" });
		const unknown = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "tc_unknown" });
		const bare = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "tc_bare" });
		createdJobs.push(known.id, unknown.id, bare.id);
		jobStore.updateJob(known.id, { usage: usageFor("openrouter:z-ai/glm-5.3-flash") });
		jobStore.updateJob(unknown.id, { usage: usageFor("nope/unknown") });

		const feed = activityFeed();
		const knownJob = feed.jobs.find((j) => j.id === known.id)!;
		// catálogo de pi 1.0.2: contextWindow de glm-5.3-flash 1_048_575 (era
		// 1_048_576 en la 0.87.1: actualización de models.dev aguas arriba).
		assert.equal(knownJob.contextLimit, 1_048_575, "pi's catalog, joined server-side onto the feed");
		assert.ok(knownJob.costUsd !== null && Math.abs(knownJob.costUsd - 0.0002) < 1e-12, "Pi's price is projected on the server");
		const unknownJob = feed.jobs.find((j) => j.id === unknown.id)!;
		assert.equal(unknownJob.contextLimit, null, "missing from the live catalog → null, never a guessed window");
		assert.equal(unknownJob.costUsd, null);
		const bareJob = feed.jobs.find((j) => j.id === bare.id)!;
		assert.equal(bareJob.contextLimit, null, "no usage yet → no context line");
		assert.equal(bareJob.costUsd, null);
	} finally {
		fs.unlinkSync(`${PATHS.chats}/${chat.id}.json`);
		const jobsDir = path.join(PATHS.data, "jobs");
		for (const id of createdJobs) {
			fs.unlinkSync(path.join(jobsDir, `${id}.json`));
		}
	}
});
