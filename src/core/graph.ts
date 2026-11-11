/**
 * El grafo de conocimiento: fusionador (la etapa final determinista del
 * proceso de extracción — construcción de vision §1) + derivación (lecturas).
 *
 * El proceso de extracción es el ÚNICO escritor del grafo, ciego al árbol y a
 * posteriori (limpieza del 2026-09-27 — separación clara del trabajo):
 *
 *   extractor (LLM)  → SessionFindings: las cadenas de razonamiento en bruto —
 *                      proposiciones (incluidas las relevantes aisladas) y
 *                      cadenas, del tramo (un lote) MÁS el resumen de la misma
 *                      fuente (consciente del resumen, 2026-09-30 por la
 *                      tarde: el extractor continúa su propia fuente,
 *                      referencia los ids existentes literalmente y él mismo
 *                      ensambla entre tramos). Las proposiciones de sesión
 *                      llevan el messageId de su pasaje (2026-10-13) — el
 *                      ancla de procedencia del fusionador. De plena
 *                      confianza: ninguna etapa lo vuelve a comprobar.
 *   auditor (LLM)    → AuditVerdicts: enlaces de identidad (id local → un
 *                      nodo existente, o crear) mediante herramientas de
 *                      exploración del grafo — SOLO enlaces (responsable,
 *                      2026-09-28 por la tarde: el auditor nunca acuña
 *                      aristas; la conexión entre fuentes ocurre solo a través
 *                      de equivalencias identificadas). Nunca ve la fuente;
 *                      nunca descarta; nunca ve las cadenas — su entrada son
 *                      solo las proposiciones nuevas.
 *   fusionador (AQUÍ) → mergeFindings(): añadidos deterministas a los registros
 *                      + la pasada de mantenimiento de simplificación de
 *                      cadenas (2026-09-30 por la tarde — simplifyChains abajo).
 *
 * El fusionador es a propósito la ÚNICA etapa que toca los registros, y es
 * código puro: el LLM aporta exactamente las decisiones de juicio (cuáles son
 * las proposiciones, qué se sigue de qué o qué apoya a qué, si una
 * proposición ES un nodo existente), mientras que las marcas de tiempo y la
 * procedencia — todo lo que el modelo podría copiar mal en silencio — se
 * reconstruyen de forma determinista. Idempotente + incremental: las aristas
 * se deduplican por (from,to,type)-ya-afirmada-por-este-chat, las líneas de
 * correspondencia por (chat, sourceId), y las entradas de cobertura / los
 * puntos de control de sessions.jsonl registran qué mensajes y chats se han
 * extraído (nunca los mismos turnos dos veces). Sin eventos: el registro de
 * eventos YA NO EXISTE (2026-09-27) — el grafo lleva proposiciones + aristas,
 * nada más.
 *
 * La identidad entre reencuentros es juicio del AUDITOR (enlazar o crear con
 * un sesgo hacia la equivalencia — las paráfrasis se fusionan), no una
 * comparación de cadenas. Las proposiciones de una sesión reextraída se
 * enlazan con los nodos existentes; el enlace añade una línea de nodo cuyas
 * formulaciones se unen a `aliases` y cuya procedencia se une (getGraph
 * fusiona las líneas por id).
 *
 * La derivación de abajo (getGraph / graphSnapshot) es solo de lectura — todo
 * se recalcula a partir de los registros. Cada función recibe los puertos de
 * almacenamiento (core/ports.ts) como parámetros explícitos — núcleo puro, sin
 * imports de adaptadores; la raíz de composición (src/server/stores.ts)
 * conecta los adaptadores de fs.
 */

import { randomBytes } from "node:crypto";
import type { CoverageEntry,
} from "./contracts/graph.ts";
import type {
	AuditVerdicts,
	ExtractedChain,
	GraphChain,
	SessionFindings,
	Cluster,
	EmissionStats,
	GraphEdge,
	GraphNode,
	ProvenancePoint,
	GraphSnapshot,
} from "./contracts.ts";
import { MIN_CLUSTER_SIZE } from "./clusters.ts";
import { formatChainLine } from "./chains.ts";
import { attachImpToCommunities, birthSessionOf, birthSessionPartition } from "./session-clusters.ts";
import { sourceFileLabel } from "./source-label.ts";
import type { ChatStore, GraphStore } from "./ports.ts";

/** Los puertos de almacenamiento que necesita cada operación del grafo, pasados explícitamente. */
export interface GraphDeps {
	chatStore: ChatStore;
	graphStore: GraphStore;
}

/** "n_" + 12 caracteres hex (GraphNode.id de contracts.ts — asignado por el store). */
function newGraphNodeId(): string {
	return `n_${randomBytes(6).toString("hex")}`;
}

/** "arg_" + 12 caracteres hex — el espacio de nombres de los nodos de
 *  implicación (el id de una cadena ES el id de su nodo derivado; sin
 *  colisiones con n_ por construcción). */
function newGraphChainId(): string {
	return `arg_${randomBytes(6).toString("hex")}`;
}

/** La clave de fusión de una cadena: premisas ordenadas + conclusión — la
 *  identidad bajo la que se fusiona una afirmación que reformula el mismo
 *  argumento. */
function chainKey(premises: ReadonlyArray<string>, conclusion: string): string {
	return `${[...premises].sort().join("+")}>${conclusion}`;
}

/** DE DÓNDE fusiona una ejecución (lo aporta quien llama — el fusionador nunca
 *  lee el store de chats): el punto de control de cobertura de un lote de
 *  sesión o — para la puerta de entrada de notas agnóstica del formato
 *  (2026-09-13) — ninguna cobertura: el punto de control del fichero entero
 *  sella la importación.
 *
 *  Cobertura (vision-extraction-coverage.md, asentado el 2026-09-15): una
 *  fusión de chat pasa el LOTE que extrajo — quien llama calculó las huellas
 *  antes de la ejecución, a partir de la misma instantánea que ve el
 *  fusionador — y el paso final añade una CoverageEntry por mensaje si todo
 *  va bien («cubierto» significa exactamente que ocurrió esta fusión). El
 *  camino de notas no pasa ninguna de las dos cosas y conserva el punto de
 *  control del fichero entero. */
export interface MergeSource {
	foldedAt: string;
	/** El lote que se fusiona (camino del chat): una entrada por mensaje del
	 *  lote extraído — undefined (camino de notas / llamadores sin cobertura)
	 *  → en su lugar se escribe el punto de control heredado del chat entero. */
	coverage?: CoverageEntry[];
}

/** El punto de procedencia de la ejecución. A nivel de chat por defecto
 *  (aligeramiento del esquema de envío, 2026-09-28 — la clave de fuente de la
 *  ejecución es lo esencial); desde la restauración del ancla (responsable,
 *  2026-10-13) un nacimiento de SESIÓN puede llevar el id de mensaje de su
 *  pasaje — el messageId copiado por el extractor, validado en la frontera de
 *  envío contra el lote actual. Las cadenas, las importaciones de notas y los
 *  llamadores heredados/del núcleo sin ancla mantienen "" (nivel de chat). */
function pointOf(chatId: string, messageId?: string): ProvenancePoint[] {
	return [{ chatId, messageId: messageId ?? "" }];
}

const samePoint = (a: ProvenancePoint, b: ProvenancePoint): boolean =>
	a.chatId === b.chatId && a.messageId === b.messageId;

// ─── el fusionador (etapa 3 del proceso de extracción — determinista) ────────

/**
 * Fusiona los hallazgos auditados de una tarea en los registros del grafo —
 * la etapa de aplicación del proceso. Determinista. Cada tarea de
 * fragmento/lote se fusiona DE FORMA INDEPENDIENTE (responsable, 2026-09-29):
 * la resolución es un mapa en memoria local a la tarea de los ids de
 * proposición de este envío a los ids de nodo del grafo — nada persiste
 * entre tareas, así que ninguna tarea puede ver (ni chocar con) los ids de
 * otra. La identidad entre tareas es cosa solo del auditor: enlaza las
 * proposiciones de esta tarea con nodos existentes antes de que se llame a
 * esta función.
 *
 * La identidad dentro de la tarea es el veredicto de enlazar o crear del
 * auditor: `linkTo` a un nodo existente (validado contra el registro — un id
 * desconocido recurre a crear) añade una línea de ENLACE (las formulaciones
 * de la tarea se unen a los alias del nodo y la procedencia se une; getGraph
 * fusiona las líneas por id); ausente → un nodo nuevo.
 *
 * `chatId` es la clave de fuente de la tarea: un chat real, o un id de fuente
 * de notas ("src_…") para el camino de importación agnóstico del formato. El
 * parámetro `source` lleva el sello del punto de control; el fusionador en sí
 * no depende del store de chats.
 */
export function mergeFindings(
	chatId: string,
	findings: SessionFindings,
	verdicts: AuditVerdicts,
	deps: GraphDeps,
	source: MergeSource,
): EmissionStats {
	const { graphStore: ledgers } = deps;
	const stats: EmissionStats = { nodes: 0, chains: 0 };

	// 1. Resolución: las proposiciones de ESTA tarea → ids de nodo del grafo, construida
	//    en memoria a medida que se resuelven las proposiciones (responsable,
	//    2026-09-29: el registro de correspondencias ya no existe — una tabla persistida
	//    era un espacio de nombres compartido entre tareas independientes, y las
	//    colisiones de ids entre tareas descartaban proposiciones en silencio y soldaban
	//    aristas erróneas). La deduplicación entre ejecuciones es el registro de cobertura
	//    (nada se reextrae) y los enlaces de equivalencia del auditor (lo reencontrado se fusiona).
	const existingIds = new Set(ledgers.readNodes().map((n) => n.id));
	const mapping = new Map<string, string>();
	const now = new Date().toISOString();
	const linkOf = new Map(verdicts.links.map((l) => [l.id, l.linkTo]));

	// SOLO VEREDICTOS (responsable, 2026-09-28): las proposiciones vienen literales de los
	// hallazgos del extractor; los enlaces del auditor se unen aquí por id.
	for (const p of findings.propositions) {
		if (mapping.has(p.id)) continue; // id duplicado DENTRO de este envío — vale la primera resolución
		// El ancla (2026-10-13): una proposición de sesión puede llevar el messageId de
		// su pasaje — va TANTO en la línea de creación como en la de enlace añadido
		// (cada reencuentro se ancla a SU pasaje); ausente (notas, llamadores
		// heredados/del núcleo) → "", nivel de chat como antes.
		const points = pointOf(chatId, p.messageId);
		const linkTo = linkOf.get(p.id);
		let graphNodeId: string;
		if (linkTo !== undefined && existingIds.has(linkTo)) {
			// Veredicto de identidad: esta proposición ES ese nodo. Se añade una línea de
			// enlace — las formulaciones de la sesión (enunciado + alias) se unen a los alias
			// del nodo y la procedencia se une. Las lecturas fusionan por id.
			graphNodeId = linkTo;
			// Enlace añadido: las formulaciones + la procedencia se unen al leer (valen el
			// name/statement/createdAt de la primera línea).
			ledgers.appendNode({
				id: graphNodeId,
				name: p.name,
				statement: p.statement,
				aliases: [...p.aliases],
				createdAt: now,
				provenance: points,
			});
		} else {
			const node: GraphNode = {
				id: newGraphNodeId(),
				name: p.name,
				statement: p.statement,
				aliases: [...p.aliases],
				createdAt: now,
				provenance: points,
			};
			ledgers.appendNode(node);
			stats.nodes++;
			graphNodeId = node.id;
			existingIds.add(graphNodeId);
		}
		mapping.set(p.id, graphNodeId);
	}

	// 2. Cadenas — solo del extractor desde el rediseño consciente del resumen
	//    (responsable, 2026-09-30 por la tarde: el extractor continúa su propia
	//    fuente, así que SUS cadenas pueden abarcar tramos y resúmenes). Los extremos
	//    se resuelven con el mapa local a la tarea O pasan literales cuando nombran
	//    un nodo existente (referencias del resumen, ids literales); las cadenas
	//    llevan el punto de procedencia a nivel de chat de la ejecución y se
	//    deduplican por (premisas, conclusión) ya afirmadas por ESTE chat — una
	//    afirmación de otro chat queda intacta (la procedencia se une al leer; un
	//    argumento conocido reformulado se añade bajo el MISMO id arg_ — como un
	//    enlace, exactamente igual que los enlaces añadidos de nodos; al leer valen
	//    las premisas/createdAt de la primera línea).
	const assertedByChat = new Set<string>();
	const idOfKey = new Map<string, string>();
	for (const line of ledgers.readChains()) {
		const key = chainKey(line.premises, line.conclusion);
		if (!idOfKey.has(key)) idOfKey.set(key, line.id);
		if (line.provenance.some((pt) => pt.chatId === chatId)) assertedByChat.add(key);
	}
	const emitChain = (chain: ExtractedChain): void => {
		// Espacio de nombres mixto (extracción consciente del resumen, 2026-09-30): un
		// extremo se resuelve con el mapa local a la tarea (las proposiciones de este
		// envío) O pasa literal cuando nombra un nodo existente (referencias de THE GRAPH
		// SO FAR, ids literales).
		// Cualquier otra cosa es irresoluble — se omite.
		const resolve = (endpoint: string): string | undefined =>
			mapping.get(endpoint) ?? (existingIds.has(endpoint) ? endpoint : undefined);
		const conclusion = resolve(chain.conclusion);
		if (conclusion === undefined) return; // extremo irresoluble — se omite
		// Los ids locales duplicados que se resuelven a un mismo nodo (dos formulaciones de
		// una premisa) se colapsan; una premisa igual a la conclusión se descarta.
		const premises = [...new Set(chain.premises.map(resolve))].filter(
			(p): p is string => p !== undefined && p !== conclusion,
		);
		if (premises.length === 0) return; // una cadena ES un argumento — las proposiciones sueltas van solo en el registro de nodos
		const key = chainKey(premises, conclusion);
		if (assertedByChat.has(key)) return; // este chat ya afirmó este argumento
		const id = idOfKey.get(key) ?? newGraphChainId();
		ledgers.appendChain({ id, premises, conclusion, createdAt: now, provenance: pointOf(chatId) });
		idOfKey.set(key, id);
		assertedByChat.add(key);
		stats.chains!++;
	};
	for (const chain of findings.chains) emitChain(chain); // las cadenas del extractor — la única fuente de cadenas (consciente del resumen, responsable 2026-09-30)

	// 2b. Simplificación (responsable, 2026-09-30 por la tarde) — la pasada determinista
	//     de deduplicación sobre TODO el registro de cadenas (esta fusión se ejecuta dentro
	//     de la sección serializada de auditoría, así que la reescritura no tiene carreras).
	//     Dos reglas, decididas por grupo de conclusión, de forma voraz en orden
	//     (premiseCount, createdAt, key) — vale la derivación más austera y temprana:
	//     • preferir menos premisas: una cadena cuyo conjunto de premisas contiene
	//       estrictamente el de una cadena conservada es redundante;
	//     • cobertura por ascendencia: una cadena cuyas premisas son todas premisas de
	//       una cadena conservada, o derivables de una (transitivamente, a través del
	//       conjunto COMPLETO de cadenas previo a la simplificación), es redundante —
	//       [A,B]⟹X más [X,C]⟹Y hacen redundante [A,B,C]⟹Y.
	//     Las claves descartadas se llevan todas sus líneas de procedencia (la reescritura es
	//     atómica); las estadísticas solo cuentan AÑADIDOS — simplificar es mantenimiento.
	const allChains = ledgers.readChains();
	const keptChains = simplifyChains(allChains);
	if (keptChains.length !== allChains.length) {
		ledgers.rewriteLedgers({ chains: keptChains });
		stats.droppedChains = allChains.length - keptChains.length;
	}

	// 3. Punto de control — LA DISCIPLINA DE COBERTURA (vision-extraction-coverage.md):
	//    solo ahora, tras haber tenido éxito todos los añadidos, queda cubierto el lote.
	//    El camino del chat añade una CoverageEntry por mensaje (atómico por lote — un
	//    aborto o fallo a mitad de ejecución deja cubiertos los lotes anteriores y sin
	//    cubrir los mensajes de este lote); el camino de notas conserva el punto de
	//    control del fichero entero (un fichero es de un solo intento).
	if (source.coverage !== undefined) {
		for (const entry of source.coverage) ledgers.appendCoverage(entry);
	} else {
		ledgers.appendCheckpoint({ chatId, foldedAt: source.foldedAt });
	}
	return stats;
}

/** La pasada determinista de simplificación de cadenas (responsable,
 *  2026-09-30 por la tarde): elimina derivaciones redundantes — cadenas con la
 *  misma conclusión cuyas premisas no aportan nada que una cadena conservada
 *  más austera no derive ya. Pura sobre la lista de entrada; quien llama se
 *  encarga de reescribir el registro. Exportada para las pruebas.
 *
 *  Las líneas con las mismas (premisas, conclusión) son UNA cadena lógica
 *  (semántica de fusión al leer) — una clave se conserva o se descarta entera,
 *  con todas sus líneas de procedencia. */
export function simplifyChains(lines: GraphChain[]): GraphChain[] {
	if (lines.length < 2) return lines;

	// Agrupa las líneas por clave de cadena (cadenas lógicas).
	const groups = new Map<string, GraphChain[]>();
	for (const line of lines) {
		const key = chainKey(line.premises, line.conclusion);
		const bucket = groups.get(key);
		if (bucket === undefined) groups.set(key, [line]);
		else bucket.push(line);
	}

	// Ascendencia sobre el conjunto COMPLETO de cadenas: cada id de nodo alcanzable como
	// premisa detrás de un id (A⟹X hace de A un ascendiente de X; [X,C]⟹Y hace de A y C
	// ascendientes de Y). Recorrido memoizado y protegido contra ciclos (el extractor no
	// puede acuñar un ciclo — se rechaza una premisa igual a la conclusión — pero el
	// recorrido sigue siendo honesto si alguna vez llega uno).
	const premisesOf = new Map<string, string[][]>();
	for (const line of lines) {
		const bucket = premisesOf.get(line.conclusion);
		if (bucket === undefined) premisesOf.set(line.conclusion, [line.premises]);
		else bucket.push(line.premises);
	}
	const ancestryMemo = new Map<string, Set<string>>();
	const ancestry = (id: string, visiting: Set<string>): Set<string> => {
		const memo = ancestryMemo.get(id);
		if (memo !== undefined) return memo;
		const out = new Set<string>();
		if (visiting.has(id)) return out;
		visiting.add(id);
		for (const premises of premisesOf.get(id) ?? []) {
			for (const premise of premises) {
				out.add(premise);
				for (const ancestor of ancestry(premise, visiting)) out.add(ancestor);
			}
		}
		visiting.delete(id);
		ancestryMemo.set(id, out);
		return out;
	};

	// Por conclusión: voraz en (premiseCount, createdAt, key).
	const byConclusion = new Map<
		string,
		Array<{ key: string; premises: string[]; createdAt: string }>
	>();
	for (const [key, bucket] of groups) {
		const head = bucket[0]!; // la representante — sus premisas valen
		const entry = { key, premises: head.premises, createdAt: head.createdAt };
		const list = byConclusion.get(head.conclusion);
		if (list === undefined) byConclusion.set(head.conclusion, [entry]);
		else list.push(entry);
	}
	const droppedKeys = new Set<string>();
	for (const candidates of byConclusion.values()) {
		candidates.sort(
				(a, b) =>
					a.premises.length - b.premises.length ||
					a.createdAt.localeCompare(b.createdAt) ||
					a.key.localeCompare(b.key),
		);
		const kept: typeof candidates = [];
		for (const candidate of candidates) {
			const candidateSet = new Set(candidate.premises);
			const redundant = kept.some((k) => {
					// Regla 1 — preferir menos premisas: subconjunto estricto (las claves iguales se
					// agrupan, así que una conservada ⊆ candidata con menos premisas es estricta).
					if (k.premises.every((p) => candidateSet.has(p))) return true;
					// Regla 2 — cobertura por ascendencia: cada premisa candidata es una premisa
					// conservada, o es alcanzable detrás de una.
					const covered = new Set(k.premises);
					for (const p of k.premises) {
						for (const ancestor of ancestry(p, new Set())) covered.add(ancestor);
					}
					return candidate.premises.every((p) => covered.has(p));
			});
			if (redundant) droppedKeys.add(candidate.key);
			else kept.push(candidate);
		}
	}
	if (droppedKeys.size === 0) return lines;
	return lines.filter((line) => !droppedKeys.has(chainKey(line.premises, line.conclusion)));
}

// ─── derivación (solo lecturas — todo lo de abajo es recalculable) ───────────

/** La verdad GUARDADA fusionada: proposiciones + cadenas (cadenas primero,
 *  responsable 2026-09-30). `nodes` son SOLO PROPOSICIONES — sin nodos de
 *  implicación derivados; las vistas del auditor y del sondeador ven el
 *  mundo, no su renderizado. La VISTA de cara al lienzo (nodos de implicación
 *  + flechas sin tipo) es deriveView() más abajo — la imagen con pérdidas. */
export interface DerivedGraph {
	nodes: GraphNode[];
	chains: GraphChain[];
}

/**
 * El grafo entero a partir de los registros. Las LÍNEAS de nodo pueden
 * repetir un id (enlaces añadidos): la PRIMERA línea define
 * name/statement/createdAt; los enunciados y alias de las líneas posteriores
 * se unen a `aliases` y la procedencia se une — el nombre nunca cambia tras
 * la creación. Las LÍNEAS de cadena son afirmaciones, fusionadas por
 * (premisas, conclusión) con la procedencia unida; el id arg_ / las premisas /
 * createdAt de la primera línea son la identidad de la cadena.
 * `store events, derive state` — este es el único lector que importa.
 */
export function getGraph(graphStore: Pick<GraphStore, "readNodes" | "readChains">): DerivedGraph {
	// Fusiona las líneas de nodo por id (la primera define; las posteriores añaden formulaciones).
	const byId = new Map<string, GraphNode>();
	for (const line of graphStore.readNodes()) {
		const existing = byId.get(line.id);
		if (!existing) {
			byId.set(line.id, { ...line, aliases: [...line.aliases], provenance: [...line.provenance] });
			continue;
		}
		// El enunciado de una línea posterior es una formulación, no un reemplazo.
		for (const phrasing of [line.statement, ...line.aliases]) {
			if (phrasing.length > 0 && !existing.aliases.includes(phrasing)) existing.aliases.push(phrasing);
		}
		for (const pt of line.provenance) {
			if (!existing.provenance.some((q) => samePoint(q, pt))) existing.provenance.push(pt);
		}
	}

	// Fusiona las líneas de afirmación de cadena por (premisas, conclusión): valen el
	// id/premisas/createdAt de la primera línea y la procedencia se une.
	const chains: GraphChain[] = [];
	const byKey = new Map<string, GraphChain>();
	for (const line of graphStore.readChains()) {
		const key = chainKey(line.premises, line.conclusion);
		const existing = byKey.get(key);
		if (existing) {
			for (const pt of line.provenance) {
				if (!existing.provenance.some((q) => samePoint(q, pt))) existing.provenance.push(pt);
			}
		} else {
			const chain: GraphChain = { ...line, premises: [...line.premises], provenance: [...line.provenance] };
			byKey.set(key, chain);
			chains.push(chain);
		}
	}
	return { nodes: [...byId.values()], chains };
}

/** La vista DERIVADA — lo que dibuja el lienzo. Una cadena de UNA premisa se
 *  colapsa en UNA flecha directa premisa → conclusión (sin nodo imp: una
 *  cadena siempre es N-entradas/1-salida, así que una premisa es el caso
 *  degenerado 1-entrada-1-salida). Una cadena de VARIAS premisas acuña un
 *  NODO de implicación (id = el id arg_ de la cadena; nombre "⟹"; statement =
 *  la línea de la cadena; la procedencia/createdAt de la cadena) más flechas:
 *  cada premisa → el nodo de implicación, el nodo de implicación → la
 *  conclusión — el lienzo dibuja los nodos imp como pura geometría
 *  (responsable, arco de renderizado: invisibles, no seleccionables; las
 *  líneas de las copremisas convergen sin punta en un punto y de él sale una
 *  línea con flecha). La física trata los nodos imp como ciudadanos normales
 *  (media distancia de enlace — layout.ts). Las cadenas colgantes (falta un
 *  nodo miembro) se descartan aquí — las cascadas de borrado deberían
 *  evitarlas; esto es el cinturón de seguridad honesto. */
export function deriveView(graph: DerivedGraph): {
	nodes: GraphNode[];
	edges: GraphEdge[];
	logicalEdges: GraphEdge[];
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
} {
	const names: Record<string, { name: string }> = {};
	for (const node of graph.nodes) names[node.id] = { name: node.name };
	const live = new Set(graph.nodes.map((node) => node.id));
	const impNodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	// El conjunto LÓGICO de aristas (responsable, 2026-09-30): cada cadena contraída en
	// flechas directas premisa→conclusión solo sobre ids de PROPOSICIÓN — lo que consume
	// la semántica de inferencia (la pasada de profundidad). Las aristas dibujadas son
	// la imagen del lienzo; estas son el significado.
	const impLinks: Array<{ id: string; premises: string[]; conclusion: string }> = [];
	const logicalEdges: GraphEdge[] = [];
	const logicalSeen = new Set<string>();
	const emitLogical = (from: string, to: string): void => {
		const key = from + "\u0000" + to;
		if (logicalSeen.has(key)) return;
		logicalSeen.add(key);
		logicalEdges.push({ from, to });
	};
	for (const chain of graph.chains) {
		if (!live.has(chain.conclusion) || !chain.premises.every((premise) => live.has(premise))) continue;
		for (const premise of chain.premises) emitLogical(premise, chain.conclusion);
		// Una sola premisa: el argumento ES una flecha simple — no hace falta un punto de
		// geometría (el colapso 1-entrada/1-salida; arco de renderizado, responsable).
		if (chain.premises.length === 1) {
			edges.push({ from: chain.premises[0]!, to: chain.conclusion });
			continue;
		}
		impNodes.push({
			id: chain.id,
			name: "⟹",
			statement: formatChainLine(chain, names),
			aliases: [],
			createdAt: chain.createdAt,
			provenance: [...chain.provenance],
		});
		// La conexión del cruce — lo que necesita la pasada de profundidad para el ancla
		// del punto medio (responsable, 2026-09-30).
		impLinks.push({ id: chain.id, premises: [...chain.premises], conclusion: chain.conclusion });
		for (const premise of chain.premises) edges.push({ from: premise, to: chain.id });
		edges.push({ from: chain.id, to: chain.conclusion });
	}
	return { nodes: [...graph.nodes, ...impNodes], edges, logicalEdges, impLinks };
}

// ─── la carga de /api/graph ──────────────────────────────────────────────────

/** Todo lo que necesita la vista del grafo de inicio, en una sola petición (forma: contracts). */
export function graphSnapshot(deps: GraphDeps, sourceNames: Readonly<Record<string, string>> = {}): GraphSnapshot {
	const graph = getGraph(deps.graphStore);
	// La imagen con pérdidas de cara al lienzo: proposiciones + nodos de implicación
	// derivados, flechas sin tipo. `chains` (la verdad guardada) viaja también para la
	// tabla de cadenas — esta lee la verdad, nunca el despliegue derivado,
	// nunca el despliegue derivado.
	const view = deriveView(graph);
	const nodes = view.nodes;

	const nodeChats = new Map<string, Set<string>>();
	const touch = (nodeId: string, chatId: string): void => {
		let chats = nodeChats.get(nodeId);
		if (!chats) {
			chats = new Set();
			nodeChats.set(nodeId, chats);
		}
		chats.add(chatId);
	};
	for (const node of nodes) {
		for (const pt of node.provenance) touch(node.id, pt.chatId);
	}
	// Etiquetas para cada fuente a la que el grafo puede remitir: chats reales (título,
	// con enlace profundo) y ficheros de notas importados (ruta, estática — la
	// procedencia de la puerta de entrada agnóstica del formato).
	const sourceIds = new Set<string>();
	for (const chats of nodeChats.values()) {
		for (const id of chats) sourceIds.add(id);
	}
	const sessions: Record<string, string> = {};
	const fileSources: Record<string, string> = {};
	for (const id of sourceIds) {
		const chat = deps.chatStore.getChat(id);
		if (chat) {
			sessions[id] = chat.title;
			continue;
		}
		const source = deps.graphStore.readSources().find((s) => s.id === id);
		if (source) fileSources[id] = source.filePath;
	}

	const nodeSessions: Record<string, string[]> = {};
	for (const [nodeId, chats] of nodeChats) {
		const ids = [...chats].filter((id) => sessions[id] !== undefined || fileSources[id] !== undefined);
		if (ids.length > 0) nodeSessions[nodeId] = ids;
	}

	// CLÚSTERES POR SESIÓN DE NACIMIENTO (oleada 7, fijado por el responsable el
	// 2026-09-23): los embeddings han muerto — un clúster es la SESIÓN QUE CREÓ SUS
	// PROPOSICIONES, derivada al leer a partir de la procedencia (core/session-clusters.ts).
	// La etiqueta es el NOMBRE de la sesión (título del chat / ruta del fichero): sin
	// pasada de nombrado con LLM, sin partición persistida que invalidar. MIN_CLUSTER_SIZE
	// sigue siendo la regla de presentación de la envolvente (una región necesita >= 3
	// proposiciones para tener envolvente). Una sesión de nacimiento cuyo registro ya no
	// existe (chat borrado) conserva sus miembros pero se muestra sin etiqueta — honesto.
	// SOLO PROPOSICIONES (responsable, 2026-09-30): los nodos de implicación derivados
	// nunca se reparten — el mundo guardado se agrupa y su imagen lo sigue.
	const communities = birthSessionPartition(graph.nodes);
	const clusters: Cluster[] = communities
		.filter((community) => community.members.length >= MIN_CLUSTER_SIZE)
		.map((community) => {
			// Los nombres mostrados nunca sustituyen la ruta de procedencia original.
			const file = fileSources[community.id];
			return {
				id: community.id,
				label: sessions[community.id] ?? (file === undefined ? null : sourceNames[community.id] ?? sourceFileLabel(file)),
				members: community.members,
			};
		});
	// ASIGNACIÓN DE CLÚSTER DE LOS NODOS IMP (responsable, 2026-09-30): mayoría entre las
	// sesiones de nacimiento de las premisas, los empates para el nacimiento de la propia
	// cadena — se adjunta TRAS el filtro de envolventes para que una comunidad de dos
	// proposiciones + su haz nunca resucite una envolvente (el filtro cuenta proposiciones).
	// Ambos consumidores de la pertenencia a clústeres — la atracción al centroide de la
	// simulación y la rasterización de regiones del lienzo — la leen de esta única lista.
	attachImpToCommunities(clusters, graph.nodes, graph.chains);

	// Disposición de reposo (opción A): el registro de posiciones, si el asentamiento se ha
	// ejecutado alguna vez. Ausente en un grafo nuevo — la vista recurre a su propia pasada
	// única hasta que la primera fusión escribe el registro.
	const positions = deps.graphStore.readPositions();

	return {
		nodes,
		propositions: graph.nodes,
		edges: view.edges,
		logicalEdges: view.logicalEdges,
		impLinks: view.impLinks,
		chains: graph.chains,
		sessions,
		fileSources,
		nodeSessions,
		clusters,
		...(Object.keys(positions).length > 0 ? { positions } : {}),
	};
}

// ─── Herramientas del grafo del sondeador — la frontera de datos (oleada 7, 2026-09-23) ─

/** Una sesión en la vista del grafo del sondeador: cada ancla de procedencia
 *  que el grafo puede nombrar — un chat real (con enlace profundo) o un
 *  fichero de notas importado (decisión del responsable del 2026-09-23: los
 *  ficheros también son sesiones de nacimiento, kind "file"). La herramienta
 *  de lista de sesiones del sondeador los muestra; la vista por sesión es
 *  graphSessionPropositions más abajo. Derivación pura sobre los mismos
 *  puertos que lee la instantánea — los manejadores de herramientas de Teacher
 *  los llaman en el mismo proceso. */
export interface GraphSessionEntry {
	/** chatId o id de fuente de notas ("src_…") — la clave de la sesión de nacimiento. */
	id: string;
	/** El título del chat, o la ruta del fichero — el origen de la etiqueta del clúster. */
	name: string;
	/** Un chat real (su registro aún existe) o un fichero de notas importado. */
	kind: "chat" | "file";
	/** Cuándo empezó la sesión: el createdAt del chat, o el importedAt del
	 *  fichero. null cuando ningún registro permite fecharla. */
	createdAt: string | null;
	/** Actividad más reciente: el updatedAt del chat, o el importedAt del
	 *  fichero. null cuando ningún registro permite fecharla. */
	updatedAt: string | null;
	/** Cuántas proposiciones NACIERON en esta sesión (el recuento de la
	 *  agrupación por sesión de nacimiento — los nodos compartidos o
	 *  reencontrados solo cuentan para su sesión de nacimiento). */
	propositions: number;
}

/** La lista de sesiones del sondeador: todas las sesiones de nacimiento, las
 *  de actividad más reciente primero (los registros sin fecha se hunden, en
 *  orden estable de id). */
export function graphSessionIndex(deps: GraphDeps): GraphSessionEntry[] {
	const counts = new Map<string, number>();
	const born = getGraph(deps.graphStore);
	for (const cluster of birthSessionPartition(born.nodes)) {
		counts.set(cluster.id, cluster.members.length);
	}
	const chats = new Map(deps.chatStore.listChats().map((chat) => [chat.id, chat]));
	const sources = new Map(deps.graphStore.readSources().map((s) => [s.id, s]));
	const entries: GraphSessionEntry[] = [];
	for (const [id, propositions] of counts) {
		const chat = chats.get(id);		if (chat) {
			entries.push({
				id,
				name: chat.title,
				kind: "chat",
				createdAt: chat.createdAt,
				updatedAt: chat.updatedAt,
				propositions,
			});
			continue;
		}
		const source = sources.get(id);
		entries.push({
			id,
			name: source?.filePath ?? id,
			kind: "file",
			createdAt: source?.importedAt ?? null,
			updatedAt: source?.importedAt ?? null,
			propositions,
		});
	}
	return entries.sort(
		(a, b) =>
			(b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
			(b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
			(a.id < b.id ? -1 : 1),
	);
}

/** Una proposición de nacimiento de una sesión — LO QUE SE CUBRIÓ allí
 *  (limpieza del 2026-09-27: sin niveles de comprensión; la evaluación es
 *  territorio y nada la escribe hasta que exista ese módulo). */
export interface GraphSessionProposition {
	nodeId: string;
	/** El identificador compacto — el mismo nombre que muestra el lienzo. */
	name: string;
}

/** Las proposiciones NACIDAS en una sesión — lo que esa sesión articuló
 *  primero. Miembros ordenados por id de nodo — determinista. */
export function graphSessionPropositions(deps: GraphDeps, sessionId: string): GraphSessionProposition[] {
	const born = getGraph(deps.graphStore).nodes.filter((node) => birthSessionOf(node) === sessionId);
	return born
		.map((node) => ({ nodeId: node.id, name: node.name }))
		.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
}

// Reexportación: el contrato define la forma; los importadores heredados aún la alcanzan.
export type { EmissionStats };


