/**
 * Importa ficheros de notas en bruto por la puerta de entrada agnóstica del
 * formato (visión §1, 2026-09-13): cada fichero *.md / *.txt de un directorio
 * se convierte en una ejecución de extracción (extractor → auditor →
 * fusionador) sobre su texto en bruto. Ejecútalo solo desde este worktree;
 * los datos nunca cruzan de un árbol a otro:
 *
 *   npx tsx --env-file=.env.local scripts/import-notes.ts <dir> [concurrency]
 *
 * Directorio por defecto: real-data-extraction/learn-sessions (las
 * exportaciones de sesiones de aprendizaje del prototipo; a propósito NO se
 * importan como chats: pasan en bruto por la vía de notas). Se ejecuta en
 * este proceso: las etiquetas de estado del servidor de desarrollo NO las ven
 * (el registro es por proceso); el servidor de desarrollo ve las ejecuciones
 * lanzadas mediante /api/graph/import.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createExtractionPipeline } from "../src/agent/subagents/extraction.ts";
import { getGraph } from "../src/core/graph.ts";
import { effectiveSettings, stores } from "../src/server/stores.ts";

async function main() {
	const dir = process.argv[2] ?? "real-data-extraction/learn-sessions";
	const limit = Number(process.argv[3] ?? 4);
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".md") || f.endsWith(".markdown") || f.endsWith(".txt"))
		.sort();
	console.log(`[import-notes] ${files.length} note files from ${dir} (concurrency ${limit})`);

	const pipeline = createExtractionPipeline({
		...stores,
		// Presupuesto en vivo: el ajuste de la sección graph, igual que el disparador de la app
		getChunkTokens: () => effectiveSettings().graph.extractionChunkTokens,
	});
	const queue = [...files];
	const totals = { nodes: 0, chains: 0, failed: 0 };
	const workers = Array.from({ length: Math.min(limit, files.length) }, async () => {
		for (;;) {
			const file = queue.shift();
			if (!file) return;
			const filePath = path.join(dir, file);
			const t0 = Date.now();
			try {
				const stats = await pipeline.importNotes({ filePath, text: fs.readFileSync(filePath, "utf-8") });
				totals.nodes += stats.nodes;
				totals.chains += stats.chains ?? 0;
				console.log(
					`[import-notes] ${file}: ${stats.nodes} nodes, ${stats.chains ?? 0} chains in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
				);
			} catch (err) {
				totals.failed++;
				console.error(`[import-notes] ${file} FAILED:`, err);
			}
		}
	});
	await Promise.all(workers);

	const graph = getGraph(stores.graphStore);
	console.log(
		`[import-notes] done: +${totals.nodes} nodes, +${totals.chains} chains, ${totals.failed} failed — ` +
			`graph now ${graph.nodes.length} nodes, ${graph.chains.length} chains`,
	);
}

main();