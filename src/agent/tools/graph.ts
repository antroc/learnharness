import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { getGraph, graphSessionIndex, graphSessionPropositions } from "../../core/graph.ts";
import type { ChatStore, GraphStore } from "../../core/ports.ts";
import { createPropositionCandidateSearch, propositionCandidateBatch, type CandidateBatch, type CandidateProposition, type CandidateRequest } from "../../core/proposition-candidates.ts";

/**
 * LAS HERRAMIENTAS DE GRAFO DEL SONDEADOR (oleada 7, fijado por el responsable 2026-09-23): la
 * inyección de contexto ha muerto: cero configuración más allá de los modelos de chat. El sondeador
 * lee en su lugar el mapa de conocimiento persistente del alumno mediante dos herramientas,
 * sustituyendo el antiguo bloque inyectado por ojos bajo demanda.
 *
 * SOLO nombres + niveles + fechas: nada de texto de enunciados ni contenido de sesiones
 * (decisión del responsable: la ORGANIZACIÓN del mapa es asunto del sondeador, su
 * prosa no). Los datos vienen de las fronteras puras de core de Platform
 * (graphSessionIndex / graphSessionPropositions) sobre los mismos puertos que lee la
 * instantánea, así que el sondeador y la vista del grafo del alumno nunca pueden
 * discrepar.
 *
 * Se registran en el sondeador SOLO cuando se abre la barrera de ajustes
 * (graphToolsEnabled: el interruptor general del grafo Y el interruptor
 * agent.graphTools); decide la raíz de composición, la factoría solo recibe el
 * almacén (ausente = la barrera está cerrada, sin herramientas de mapa; las pruebas conducen esto).
 */

/** Sobre qué se cierran las herramientas de grafo: los almacenes que leen las vistas de sesión. */
export interface GraphToolContext {
	chatStore: ChatStore;
	graphStore: GraphStore;
}

const listSessionsInput = Type.Object({});

const listPropositionsInput = Type.Object({
	session: Type.String({
		minLength: 1,
		description: "The session's id exactly as list_sessions reported it (a chat id or a notes source id)",
	}),
});

export function proberGraphTools(ctx: GraphToolContext): Record<string, AgentTool<any>> {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	return {
		list_sessions: {
			name: "list_sessions",
			label: "list_sessions",
			description:
				"List the sessions of the learner's persistent knowledge graph — every chat or imported-notes file that ever contributed a proposition, most recent first. The map is organized into birth-session clusters (propositions grouped by the session they were first learned in), and session names are those clusters' labels. " +
				"Each line: the session's name, kind (chat/file), how many propositions were born in it, its dates, and its id — use that id with list_propositions. " +
				"Reading this first shows what he has already covered and when, before you probe anything.",
			parameters: listSessionsInput,
			execute: serverExecute("list_sessions", listSessionsInput, async (): Promise<string> => {
				const sessions = graphSessionIndex(deps);
				if (sessions.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
				const lines = sessions.map((s, i) =>
					`${i + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}, ` +
					`born ${s.createdAt ?? "unknown date"}${s.updatedAt ? `, last active ${s.updatedAt}` : ""}) — id: ${s.id}`,
				);
				return `${sessions.length} session(s) in the knowledge graph, most recent first:\n${lines.join("\n")}`;
			}),
		},
		list_propositions: {
			name: "list_propositions",
			label: "list_propositions",
			description:
				"List the propositions BORN in one knowledge-graph session — what was covered there. " +
				"Names only — no statement text, no session contents (owner ruling 2026-09-23: the map's ORGANIZATION is your business, its prose is not).",
			parameters: listPropositionsInput,
			execute: serverExecute("list_propositions", listPropositionsInput, async ({ session }): Promise<string> => {
				const propositions = graphSessionPropositions(deps, session);
				if (propositions.length === 0) {
					return `No propositions born in session "${session}". Call list_sessions for the current ids.`;
				}
				const lines = propositions.map((p) => `- ${p.name}`);
				return `${propositions.length} proposition(s) covered in this session:\n${lines.join("\n")}`;
			}),
		},
	};
}

// ─── las herramientas de grafo del auditor (reenlazado del 2026-09-27) ───────────

/**
 * EL CONJUNTO DE HERRAMIENTAS DEL AUDITOR: el auditor de extracción explora el grafo para
 * colocar las proposiciones nuevas en lugar de recibirlo inyectado (decisión del responsable
 * 2026-09-27: un volcado del grafo completo hincha el contexto a medida que crece el grafo; el
 * auditor busca él mismo los candidatos de identidad). Versiones específicas
 * del auditor, deliberadamente distintas de las del sondeador:
 *
 *   find_candidates   búsqueda léxica por lotes y ordenada usando los propios
 *                     hallazgos propuestos; cinco candidatos por hallazgo,
 *                     paginación explícita, enunciados completos y alias
 *                     coincidentes, sin duplicados dentro del lote devuelto.
 *   list_sessions     el índice de sesiones de nacimiento, sin marcas de tiempo.
 *   list_propositions texto completo de las proposiciones (respaldo opcional de exploración).
 *
 * Sin marcas de tiempo en ningún sitio: el trabajo de identidad necesita contenido, no cronología.
 * Solo lectura, fronteras puras de core, los mismos puertos que lee la instantánea.
 */

export interface AuditorCandidateBatch {
	matches: Array<{ propositionId: string; candidateIds: string[]; nextCursor: string | null }>;
	candidates: CandidateBatch["candidates"];
}

interface CandidateLookup {
	id: string;
	hints?: readonly string[];
	cursor?: string;
}

/** Prepara la primera página en código y mantiene todas las continuaciones ligadas a las
 * consultas inmutables de esta auditoría. Una búsqueda nueva no puede heredar por accidente un
 * desplazamiento antiguo. Los tokens son opacos, por auditoría y estables cuando se repite una petición;
 * nada de esto suprime registros devueltos antes. */
export function prepareAuditorReview(ctx: GraphToolContext, propositions: readonly CandidateProposition[] = []): {
	initialCandidates: AuditorCandidateBatch;
	tools: Record<string, AgentTool<any>>;
} {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	const findInput = Type.Object({
		propositions: Type.Array(Type.Object({
			id: Type.String({ minLength: 1, description: "An id from the proposed findings. Its name, statement and aliases are searched automatically." }),
			hints: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
				description: "Optional alternative words or phrases to add to the search. Plain text, not glob patterns.",
			})),
			cursor: Type.Optional(Type.String({ minLength: 1, description: "Continue a previous query with its nextCursor. Do not supply hints with a cursor; its query is already fixed. Omit cursor to start a new search at its first page." })),
		}, { additionalProperties: false }), { minItems: 1, description: "Look up only findings needing a specific additional search. Include each id once." }),
	}, { additionalProperties: false });
	let search: ReturnType<typeof createPropositionCandidateSearch> | undefined;
	const continuations = new Map<string, CandidateRequest>();
	const tokens = new Map<string, string>();
	function lookup(requests: readonly CandidateLookup[]): AuditorCandidateBatch {
		const queries = requests.map((request): CandidateRequest => {
			if (request.cursor === undefined) return { id: request.id, hints: request.hints ? [...request.hints] : undefined };
			if (request.hints !== undefined) throw new Error("A continuation already fixes its query. Omit hints, or omit cursor to start a new search.");
			const query = continuations.get(request.cursor);
			if (!query || query.id !== request.id) throw new Error("Unknown cursor for this finding and audit. Start a fresh lookup without cursor.");
			return query;
		});
		search ??= createPropositionCandidateSearch(getGraph(deps.graphStore).nodes);
		const batch = propositionCandidateBatch(search, propositions, queries);
		return {
			matches: batch.matches.map((match, index) => {
				let nextCursor: string | null = null;
				if (match.nextOffset !== null) {
					const query = { ...queries[index]!, offset: match.nextOffset };
					const key = JSON.stringify([query.id, query.hints ?? [], query.offset]);
					nextCursor = tokens.get(key) ?? randomUUID();
					tokens.set(key, nextCursor);
					continuations.set(nextCursor, query);
				}
				return { propositionId: match.propositionId, candidateIds: match.candidateIds, nextCursor };
			}),
			candidates: batch.candidates,
		};
	}
	const initialCandidates = lookup([...new Set(propositions.map((proposition) => proposition.id))].map((id) => ({ id })));
	const tools: Record<string, AgentTool<any>> = {
		find_candidates: {
			name: "find_candidates",
			label: "find_candidates",
			description:
				"Find existing proposition candidates for a batch of proposed ids, using their full text and optional hints. " +
				"Ranks word overlap across names, statements and aliases, not exact phrases or glob patterns. " +
				"The first page is already in your input. A new search returns five ranked candidates; nextCursor continues that exact query. " +
				"Each candidate's full statement and relevant matched aliases appear once in candidates; matches lists its ids per finding. " +
				"An unmatched finding can remain new; a continuation is an option, not a requirement to keep searching. " +
				"There is no cross-call suppression: repeating a request returns its full page again.",
			parameters: findInput,
			execute: serverExecute("find_candidates", findInput, async (input) => lookup(input.propositions)),
		},
		list_sessions: {
			name: "list_sessions",
			label: "list_sessions",
			description:
				"List the knowledge graph's birth sessions — every chat or imported-notes file that ever contributed a proposition. " +
				"Each line: name, kind, proposition count, id. Use the id with list_propositions to see what a session covered.",
			parameters: Type.Object({}),
			execute: serverExecute("list_sessions", Type.Object({}), async (): Promise<string> => {
				const sessions = graphSessionIndex(deps);
				if (sessions.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
				const lines = sessions.map((s, i) => `${i + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}) — id: ${s.id}`);
				return `${sessions.length} session(s):\n${lines.join("\n")}`;
			}),
		},
		list_propositions: {
			name: "list_propositions",
			label: "list_propositions",
			description:
				"List the propositions BORN in one session, with FULL statement text — the content-level view for identity work " +
				"(deciding whether a new proposition is really one of these).",
			parameters: listPropositionsInput,
			execute: serverExecute("list_propositions", listPropositionsInput, async ({ session }): Promise<string> => {
				const propositions = graphSessionPropositions(deps, session);
				if (propositions.length === 0) return `No propositions born in session "${session}". Call list_sessions for the current ids.`;
				const nodes = new Map(getGraph(deps.graphStore).nodes.map((n) => [n.id, n]));
				const lines = propositions.map((p) => {
					const node = nodes.get(p.nodeId);
					return `- ${p.nodeId} :: ${p.name}\n  statement: ${node?.statement ?? "(unknown)"}`;
				});
				return `${propositions.length} proposition(s) born in this session:\n${lines.join("\n")}`;
			}),
		},
	};
	return { initialCandidates, tools };
}
