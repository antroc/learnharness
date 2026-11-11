import type { GraphNode } from "./contracts/graph.ts";

/** Solo recuperación: las puntuaciones ordenan candidatos léxicos, nunca deciden la identidad. */
export interface CandidateProposition {
	id: string;
	name: string;
	statement: string;
	aliases: readonly string[];
}

export interface CandidateRequest {
	id: string;
	hints?: readonly string[];
	offset?: number;
}

export interface CandidateBatch {
	matches: Array<{
		propositionId: string;
		candidateIds: string[];
		offset: number;
		totalCandidates: number;
		hasMore: boolean;
		nextOffset: number | null;
	}>;
	candidates: Array<{
		id: string;
		name: string;
		statement: string;
		matchedAliases: string[];
		sessions: string[];
	}>;
}

export const CANDIDATE_PAGE_SIZE = 5;

// Se conservan la negación y el vocabulario del dominio. Estas son solo palabras funcionales
// comunes del inglés; las palabras Unicode (incluidos símbolos matemáticos escritos con letras)
// siguen siendo buscables, sin lematización solo para inglés ni sintaxis de subcadenas/glob.
const STOP_WORDS = new Set((
	"a an the and or of to in on at by for from with as is are was were be been being " +
	"it its this that these those which who whose their them they we our you your " +
	"can could may might must will would should has have had does do did " +
	"such than then when where each every any all also into through"
).split(" "));

function words(text: string): string[] {
	return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
		.filter((word) => !STOP_WORDS.has(word));
}

interface TextIndex {
	terms: Map<string, number>;
	length: number;
	alias?: string;
}

function indexText(text: string, alias?: string): TextIndex {
	const tokens = words(text);
	const terms = new Map<string, number>();
	for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
	return { terms, length: tokens.length, alias };
}

/** Un índice inmutable en memoria por auditoría. Cada formulación canónica o alias se
 * puntúa por separado, para que un nodo no salga penalizado por acumular muchos alias.
 * La frecuencia de documento cuenta NODOS, no alias; las formulaciones repetidas no pueden
 * inflar la frecuencia de un término ni producir candidatos duplicados.
 *
 * BM25 usa los valores estándar k1=1.2, b=0.75. Las palabras de la consulta son una unión
 * (no una frase exacta ni una condición AND). Las pistas añaden vocabulario a la proposición
 * real; nunca la sustituyen. No hay red, modelo de embeddings, caché persistente, umbral de
 * equivalencia ni filtrado de "ya visto" entre llamadas.
 */
export function createPropositionCandidateSearch(nodes: readonly GraphNode[]) {
	const indexed = nodes.map((node) => ({
		node,
		texts: [
			indexText(`${node.name} ${node.statement}`),
			...[...new Set(node.aliases)].filter((alias) => alias !== node.statement)
				.map((alias) => indexText(`${node.name} ${alias}`, alias)),
		],
	}));
	const frequency = new Map<string, number>();
	let totalLength = 0;
	let textCount = 0;
	for (const entry of indexed) {
		const nodeTerms = new Set<string>();
		for (const text of entry.texts) {
			totalLength += text.length;
			textCount++;
			for (const term of text.terms.keys()) nodeTerms.add(term);
		}
		for (const term of nodeTerms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
	}
	const averageLength = totalLength / textCount || 1;

	return (proposition: CandidateProposition, hints: readonly string[] = []) => {
		const query = new Set(words([proposition.name, proposition.statement, ...proposition.aliases, ...hints].join(" ")));
		const hits: Array<{ node: GraphNode; score: number; matchedAlias?: string }> = [];
		for (const { node, texts } of indexed) {
			let bestScore = 0;
			let matchedAlias: string | undefined;
			for (const text of texts) {
				let score = 0;
				for (const term of query) {
					const tf = text.terms.get(term) ?? 0;
					if (tf === 0) continue;
					const df = frequency.get(term)!;
					const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5));
					score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * text.length / averageLength));
				}
				if (score > bestScore) {
					bestScore = score;
					// Un alias solo es evidencia útil cuando ha coincidido su propia
					// redacción, y no simplemente el nombre canónico repetido.
					matchedAlias = text.alias && words(text.alias).some((term) => query.has(term)) ? text.alias : undefined;
				}
			}
			if (bestScore > 0) hits.push({ node, score: bestScore, matchedAlias });
		}
		return hits.sort((a, b) => b.score - a.score || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
	};
}

/** Rechaza ids u offsets incorrectos antes de devolver cualquier parte de un lote. Cada
 * llamada es sin estado: repetir una petición devuelve la misma página, nunca un fallo oculto. */
export function propositionCandidateBatch(
	search: ReturnType<typeof createPropositionCandidateSearch>,
	propositions: readonly CandidateProposition[],
	requests: readonly CandidateRequest[],
): CandidateBatch {
	// Igual que mergeFindings: los ids repetidos aceptados remiten a su PRIMER hallazgo.
	// Buscar la última aparición podría devolver un veredicto de otra afirmación.
	const byId = new Map<string, CandidateProposition>();
	for (const proposition of propositions) {
		if (!byId.has(proposition.id)) byId.set(proposition.id, proposition);
	}
	const seen = new Set<string>();
	for (const request of requests) {
		if (!byId.has(request.id)) throw new Error(`Unknown proposition id "${request.id}". Use an id from the proposed findings.`);
		if (seen.has(request.id)) throw new Error(`Repeated proposition id "${request.id}". Combine its hints in one request.`);
		if (!Number.isSafeInteger(request.offset ?? 0) || (request.offset ?? 0) < 0) throw new Error("offset must be a nonnegative safe integer.");
		seen.add(request.id);
	}
	const candidates = new Map<string, CandidateBatch["candidates"][number]>();
	const matches = requests.map((request) => {
		const hits = search(byId.get(request.id)!, request.hints);
		const offset = request.offset ?? 0;
		const page = hits.slice(offset, offset + CANDIDATE_PAGE_SIZE);
		for (const { node, matchedAlias } of page) {
			let candidate = candidates.get(node.id);
			if (!candidate) {
				candidate = {
					id: node.id, name: node.name, statement: node.statement, matchedAliases: [],
					sessions: [...new Set(node.provenance.map((point) => point.chatId))],
				};
				candidates.set(node.id, candidate);
			}
			if (matchedAlias && !candidate.matchedAliases.includes(matchedAlias)) candidate.matchedAliases.push(matchedAlias);
		}
		const hasMore = offset + page.length < hits.length;
		return {
			propositionId: request.id, candidateIds: page.map((hit) => hit.node.id), offset,
			totalCandidates: hits.length, hasMore, nextOffset: hasMore ? offset + page.length : null,
		};
	});
	return { matches, candidates: [...candidates.values()] };
}
