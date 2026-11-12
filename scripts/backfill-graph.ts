/**
 * Relleno a posteriori de una sola vez: borra los registros heredados y
 * vuelve a extraer todos los chats con el proceso rediseñado (visión §1,
 * commit b07c907). Ejecútalo solo desde el árbol maestro; los datos nunca
 * cruzan de un árbol a otro:
 *
 *   npx tsx --env-file=.env.local scripts/backfill-graph.ts
 */
import { chatStore } from "../src/store/chats.ts";
import { graphStore } from "../src/store/graph.ts";
import { createExtractionPipeline } from "../src/agent/subagents/extraction.ts";
import { getGraph } from "../src/core/graph.ts";
import { effectiveSettings } from "../src/server/stores.ts";

async function main() {
	const only = process.argv[2]; // opcional: extraer solo un id de chat
	const chats = only ? chatStore.listChats().filter((c) => c.id === only) : chatStore.listChats();
	console.log(`[backfill] ${chats.length} chats to extract`);
	const pipeline = createExtractionPipeline({
		chatStore,
		graphStore,
		// Presupuesto en vivo: el ajuste de la sección graph, igual que el disparador de la app
		getChunkTokens: () => effectiveSettings().graph.extractionChunkTokens,
	});
	for (const chat of chats) {
		const t0 = Date.now();
		try {
			const stats = await pipeline.runExtraction(chat.id);
			console.log(
				`[backfill] ${chat.id} (${chat.title.slice(0, 40)}): ` +
					`${stats.nodes} nodes, ${stats.chains ?? 0} chains in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
			);
		} catch (err) {
			console.error(`[backfill] ${chat.id} FAILED:`, err);
		}
	}
	const graph = getGraph(graphStore);
	console.log(
		`[backfill] done: ${graph.nodes.length} nodes, ${graph.chains.length} chains`,
	);
}

main();
