/**
 * Borrado de sesiones — la PRIMERA operación destructiva sobre los registros
 * de solo añadido del grafo (decisión del responsable del 2026-09-22, oleada
 * 6, fragmento A).
 *
 * Hasta ahora mergeFindings era el único escritor; el borrado es el segundo,
 * y se le exige la misma disciplina: código PURO sobre los puertos de
 * almacenamiento (core/ports.ts), ningún juicio de LLM en ninguna parte,
 * determinista e idempotente. Quien llama (la ruta DELETE /api/chats/[id] a
 * través de la orquestación del servidor) se encarga de la coreografía entre
 * stores (registro del chat, tareas, cierre de la extracción); este módulo se
 * encarga de los REGISTROS.
 *
 * CADENAS PRIMERO (responsable, 2026-09-30): la verdad guardada son las
 * proposiciones + las cadenas de razonamiento; las aristas son una vista
 * derivada. Por eso el borrado opera sobre LÍNEAS DE CADENA donde antes
 * operaba sobre líneas de arista — una cadena muere cuando su procedencia se
 * vacía o muere cualquiera de sus nodos miembro — y la vista derivada se
 * ajusta en la siguiente lectura, nunca se reescribe aquí.
 *
 * Dos modos (semántica fijada por el responsable):
 *
 *   preserve-graph  muere la contabilidad de extracción del chat — sus filas
 *                   de cobertura y sus líneas de punto de control heredadas —
 *                   y NADA más: los nodos y las cadenas quedan idénticos byte
 *                   a byte. El grafo conserva las aportaciones de la sesión;
 *                   la instantánea simplemente ya no resuelve el chatId
 *                   muerto a un título (nodeSessions filtra los ids
 *                   desconocidos al leer — sin fantasmas en la interfaz).
 *
 *   delete-nodes    «esta sesión nunca ocurrió»: todo rastro del chat sale
 *                   de los registros — sus puntos de procedencia en cada
 *                   línea de nodo y de cadena, sus líneas de enlace (sus
 *                   formulaciones mueren con ellas), sus filas de cobertura y
 *                   de punto de control — y los huérfanos mueren: un nodo
 *                   cuyas referencias vinieran todas de este chat desaparece
 *                   por completo, podado también del registro de posiciones
 *                   (los miembros muertos romperían las envolventes de los
 *                   clústeres).
 *
 * Los nodos compartidos sobreviven automáticamente (la decisión): un nodo
 * vive si y solo si queda ALGUNA referencia superviviente — un punto de
 * procedencia de otro chat o de una fuente de notas. La línea de creación de
 * un nodo superviviente es especial: name/statement/createdAt son la
 * IDENTIDAD del nodo — el ancla compartida que reconocieron los veredictos de
 * enlace de otras sesiones — así que se quedan aunque el chat borrado creara
 * el nodo; pero las formulaciones de esa sesión (los alias de la línea) se
 * eliminan y se quitan sus puntos de procedencia (decisión del responsable
 * del 2026-09-23: todos los rastros, la identidad sobrevive).
 *
 * Esta purga de aportaciones acepta también ids de fuentes importadas. Los
 * registros de las fuentes, las conversaciones y la ubicación organizativa
 * siguen siendo responsabilidad de quien llama; este módulo solo reescribe
 * los registros del grafo.
 *
 * Seguridad frente a resurrecciones: el borrado se ejecuta como UN bloque
 * síncrono (sin awaits — atómico respecto al bucle de eventos, así que ningún
 * añadido de la extracción puede intercalarse), y el proceso de extracción
 * vuelve a comprobar el registro del chat antes de fusionar cada lote (un
 * chat borrado nunca se fusiona). Ambas fronteras juntas cierran todos los
 * caminos de corrupción o resurrección.
 */

import type {
	CoverageEntry,
	GraphChain,
	GraphNode,
	SessionCheckpoint,
} from "./contracts.ts";
import type { GraphStore } from "./ports.ts";

/** Los dos modos de borrado (fijados por el responsable el 2026-09-22).
 *  Comprobables por máquina en la API como el parámetro de consulta
 *  obligatorio `mode` — sin valor por defecto, así que no hay elección
 *  destructiva accidental. */
export type ChatDeleteMode = "preserve-graph" | "delete-nodes";

/** Lo que un borrado quitó de los registros (las estadísticas de la respuesta
 *  de DELETE; con esto la interfaz puede mostrar «3 temas, 2 enlaces
 *  eliminados»). */
export interface ChatDeletionStats {
	/** Nodos distintos que murieron por completo (todas sus líneas). */
	nodesRemoved: number;
	/** LÍNEAS de afirmación de cadena eliminadas (procedencia vacía o miembro muerto). */
	chainsRemoved: number;
	/** Filas de cobertura eliminadas. */
	coverageRemoved: number;
	/** Líneas de punto de control eliminadas. */
	checkpointsRemoved: number;
}

const EMPTY_STATS: ChatDeletionStats = {
	nodesRemoved: 0,
	chainsRemoved: 0,
	coverageRemoved: 0,
	checkpointsRemoved: 0,
};

/**
 * Elimina los rastros de un chat de los registros del grafo. Síncrono por
 * diseño (el argumento de atomicidad de arriba); idempotente (una segunda
 * ejecución no encuentra nada y devuelve estadísticas a cero).
 */
export function deleteChatTraces(graphStore: GraphStore, chatId: string, mode: ChatDeleteMode): ChatDeletionStats {
	return deleteSourcesTraces(graphStore, new Set([chatId]), mode);
}

/** Las mismas reglas de procedencia para un lote seleccionado, con una sola
 * reescritura de registros en lugar de volver a analizar/reescribir el grafo
 * entero una vez por cada fichero importado. */
export function deleteSourcesTraces(graphStore: GraphStore, sourceIds: ReadonlySet<string>, mode: ChatDeleteMode): ChatDeletionStats {
	if (mode !== "preserve-graph" && mode !== "delete-nodes") {
		throw new Error(`Unknown deletion mode: ${mode as string}`);
	}

	// Las filas de contabilidad mueren en AMBOS modos — la cobertura y los puntos de
	// control son estado de la extracción, no contenido del grafo (semántica del
	// responsable: incluso preserve-graph borra «las filas de cobertura del chat»).
	if (sourceIds.size === 0) return { ...EMPTY_STATS };
	const coverage = graphStore.readCoverage().filter((row) => !sourceIds.has(row.chatId));
	const checkpoints = graphStore.readCheckpoints().filter((row) => !sourceIds.has(row.chatId));
	const stats: ChatDeletionStats = {
		...EMPTY_STATS,
		coverageRemoved: graphStore.readCoverage().length - coverage.length,
		checkpointsRemoved: graphStore.readCheckpoints().length - checkpoints.length,
	};

	if (mode === "preserve-graph") {
		if (stats.coverageRemoved > 0 || stats.checkpointsRemoved > 0) {
			graphStore.rewriteLedgers({ coverage, checkpoints });
		}
		return stats;
	}

	// ── delete-nodes: la purga completa ───────────────────────────────────
	const nodeLines = graphStore.readNodes();
	const chainLines = graphStore.readChains();

	// ¿Toca el chat el grafo en algo? (Un chat nunca extraído sigue necesitando que
	// se quiten arriba sus filas de cobertura, pero no reescribir los registros —
	// así los mtimes se mantienen estables y la revisión del grafo solo se mueve
	// cuando algo cambió de verdad.)
	const touched =
		nodeLines.some((line) => line.provenance.some((pt) => sourceIds.has(pt.chatId))) ||
		chainLines.some((line) => line.provenance.some((pt) => sourceIds.has(pt.chatId)));
	if (!touched) {
		if (stats.coverageRemoved > 0 || stats.checkpointsRemoved > 0) {
			graphStore.rewriteLedgers({ coverage, checkpoints });
		}
		return stats;
	}

	// 1. Supervivencia: un nodo vive si y solo si queda una referencia de ALGUNA
	//    fuente superviviente — un punto de procedencia de otro chat/fuente en
	//    cualquiera de sus líneas. (Los miembros de cadena NO son referencias de
	//    supervivencia a propósito: la sesión que afirmó una cadena siempre dejó
	//    procedencia en sus extremos, así que una vida solo por extremos no puede
	//    darse en un registro coherente — y contarla mantendría vivos nodos cuyas
	//    líneas luego descartaríamos, dejando la cadena colgando.)
	const survives = (points: ReadonlyArray<{ chatId: string }>): boolean =>
		points.some((pt) => !sourceIds.has(pt.chatId));
	const touchedNodes = new Set(nodeLines.filter((line) => line.provenance.some((pt) => sourceIds.has(pt.chatId))).map((line) => line.id));
	const live = new Set<string>();
	for (const line of nodeLines) {
		// Los nodos heredados sin procedencia y sin relación quedan fuera del radio de
		// acción de este borrado; no son huérfanos creados al quitar esta fuente.
		if (!touchedNodes.has(line.id) || survives(line.provenance)) live.add(line.id);
	}

	// 2. Líneas de nodo. Por línea (cada línea es el añadido de UNA ejecución de
	//    extracción, así que la procedencia de alias por sesión existe a nivel de línea):
	//      nodo muerto           muere cada línea
	//      línea no tocada       se conserva literal
	//      borrada en parte      se conserva sin los puntos del chat
	//                           (defensivo — las líneas de una ejecución no mezclan chats)
	//      todos los puntos      línea CREATE: la identidad sobrevive, alias
	//      borrados             eliminados (decisión del 2026-09-23), puntos
	//                           vacíos / línea LINK: muere con sus formulaciones
	const outNodes: GraphNode[] = [];
	const seenIds = new Set<string>();
	for (const line of nodeLines) {
		if (!live.has(line.id)) continue; // muere el nodo entero
		const first = !seenIds.has(line.id);
		seenIds.add(line.id);
		const points = line.provenance.filter((pt) => !sourceIds.has(pt.chatId));
		if (points.length === line.provenance.length) {
			outNodes.push(line); // este chat no la tocó
			continue;
		}
		if (points.length > 0) {
			outNodes.push({ ...line, provenance: points });
			continue;
		}
		if (first) {
			// La línea de creación de un nodo superviviente que acuñó el chat borrado:
			// name/statement/createdAt son la identidad compartida que reconocieron otras
			// sesiones — se quedan; las formulaciones y la procedencia de la sesión
			// mueren (todos los rastros, responsable 2026-09-23).
			outNodes.push({ ...line, provenance: [], aliases: [] });
		}
		// si no: la línea de enlace del chat borrado — muere con sus formulaciones.
	}

	// 3. Cadenas: se quitan los puntos del chat; una afirmación muere cuando su
	//    procedencia se vacía o CUALQUIER nodo miembro (premisa o conclusión)
	//    murió EN ESTE BORRADO. (Solo cuentan los nodos que existían y murieron —
	//    una cadena cuyos miembros nunca se resolvieron como nodos son datos
	//    ajenos que el borrado deja en paz: la reescritura destructiva no puede
	//    exceder el radio de acción del chat borrado.)
	const deadNodes = new Set([...new Set(nodeLines.map((line) => line.id))].filter((id) => !live.has(id)));
	const outChains: GraphChain[] = [];
	for (const line of chainLines) {
		if (deadNodes.has(line.conclusion) || line.premises.some((premise) => deadNodes.has(premise))) continue;
		const points = line.provenance.filter((pt) => !sourceIds.has(pt.chatId));
		// Una afirmación muere cuando ESTE borrado vacía su procedencia — una línea que
		// ya no tenía puntos son datos ajenos o heredados, no un rastro de este chat;
		// se queda intacta.
		if (line.provenance.length > 0 && points.length === 0) continue;
		outChains.push(points.length === line.provenance.length ? line : { ...line, provenance: points });
	}

	stats.nodesRemoved = [...new Set(nodeLines.map((line) => line.id))].filter((id) => !live.has(id)).length;
	stats.chainsRemoved = chainLines.length - outChains.length;

	graphStore.rewriteLedgers({
		nodes: outNodes,
		chains: outChains,
		coverage,
		checkpoints,
	});

	// 4. Posiciones: se podan los nodos muertos Y las cadenas muertas (el nodo de
	//    implicación derivado de un argumento lleva el id arg_ de la cadena — unos
	//    puntos de reposo obsoletos no fijarían nada; podar mantiene honesto el
	//    registro y la revisión avanzando exactamente por el motivo correcto).
	const deadChainIds = new Set(
		chainLines
			.filter((line) => !outChains.includes(line))
			.map((line) => line.id),
	);
	const positions = graphStore.readPositions();
	const knownNodeIds = new Set(nodeLines.map((line) => line.id));
	const prunedPositions = Object.fromEntries(
		Object.entries(positions).filter(
			([id]) => (live.has(id) || !knownNodeIds.has(id)) && !deadChainIds.has(id),
		),
	);
	if (Object.keys(prunedPositions).length !== Object.keys(positions).length) {
		graphStore.writePositions(prunedPositions);
	}

	return stats;
}

// ─── borrado de un solo nodo (interludio de nodos, muerte total del responsable) ─

/**
 * MUERTE TOTAL de un nodo, por id (decisión del responsable del 2026-09-23):
 * que el usuario señale el nodo ES la intención — las referencias de otras
 * sesiones NO lo preservan. Es el remedio para los nodos imborrables
 * (huérfanos de preserve-graph tras borrar sesiones; nodos importados de
 * notas sin chat detrás) y el inverso deliberado de la cascada de chats de
 * arriba: aquella borra una SESIÓN y deja sobrevivir los nodos por
 * referencias ajenas; esta borra un NODO y se lleva todos sus rastros —
 *
 *   - todas las líneas del nodo (líneas de creación + de enlace)
 *   - todas las CADENAS que lo referencian (como premisa o conclusión),
 *     la afirmara la sesión que fuera — una cadena con un miembro muerto no
 *     es una cadena
 *   - su posición de reposo (y la de cada cadena muerta)
 *
 * Borrar un ARGUMENTO es la misma llamada con un id con prefijo arg_
 * (responsable, 2026-09-30: el borrado protegido de la tabla de cadenas mata
 * cadenas): el «nodo» es el nodo de implicación derivado cuyo id ES el id de
 * la cadena.
 *
 * El radio de acción son exactamente las filas que nombran el id: la
 * procedencia, los alias y las sesiones de otros nodos quedan intactos (la
 * muerte total tiene ámbito de NODO, no de sesión), y los registros de fuente
 * de las importaciones de notas se quedan (la contabilidad de la
 * importación; borrar una proposición no es borrar el fichero). Los datos
 * derivados no necesitan poda: la partición por nacimiento se deriva al leer
 * (el clúster baja de MIN_CLUSTER_SIZE y deja de mostrarse — está bien), y
 * ningún otro consumidor indexa nodos por id entre registros.
 *
 * Síncrono, una llamada a rewriteLedgers, sin awaits (el mismo argumento de
 * atomicidad que la cascada de chats); idempotente en el sentido de la
 * oleada 6 — una segunda ejecución no encuentra líneas y no cambia nada.
 */
export interface NodeDeletionStats {
	/** LÍNEAS de afirmación de cadena eliminadas (todas las cadenas que referencian el nodo). */
	chainsRemoved: number;
}

function nodeLinesOf(graphStore: GraphStore, nodeId: string): GraphNode[] {
	return graphStore.readNodes().filter((line) => line.id === nodeId);
}

function chainLinesOf(graphStore: GraphStore, chainId: string): GraphChain[] {
	return graphStore.readChains().filter((line) => line.id === chainId);
}

/**
 * Muerte total de un nodo (o de un argumento, por su id arg_). Devuelve null
 * cuando no existe ese nodo/cadena (la orquestación lo traduce a 404); solo
 * reescribe los registros que cambiaron (los ficheros sin cambios conservan
 * sus mtimes — el sello de versión solo se mueve cuando algo cambió de
 * verdad).
 */
export function deleteNodeTraces(graphStore: GraphStore, nodeId: string): NodeDeletionStats | null {
	const chainLines = graphStore.readChains();

	// La rama del argumento: un id arg_ nombra una CADENA, no una proposición —
	// mueren sus líneas, y esa es toda la muerte (las proposiciones miembro
	// sobreviven: borrar un argumento respeta sus premisas/conclusión).
	if (nodeId.startsWith("arg_")) {
		const outChains = chainLines.filter((line) => line.id !== nodeId);
		if (outChains.length === chainLines.length) return null; // argumento desconocido
		graphStore.rewriteLedgers({ chains: outChains });
		const positions = graphStore.readPositions();
		if (positions[nodeId] !== undefined) {
			const { [nodeId]: _dead, ...rest } = positions;
			graphStore.writePositions(rest);
		}
		return { chainsRemoved: chainLines.length - outChains.length };
	}

	const nodeLines = nodeLinesOf(graphStore, nodeId);
	if (nodeLines.length === 0) return null;

	const outChains = chainLines.filter(
		(line) => line.conclusion !== nodeId && !line.premises.includes(nodeId),
	);

	// Solo los registros tocados: las líneas propias del nodo siempre mueren (su fichero
	// debe cambiar); lo demás solo se reescribe cuando de verdad se descartan filas.
	const outNodes = graphStore.readNodes().filter((line) => line.id !== nodeId);
	graphStore.rewriteLedgers({
		nodes: outNodes,
		...(outChains.length !== chainLines.length ? { chains: outChains } : {}),
	});

	// Las posiciones de reposo mueren con el nodo y con cada cadena muerta.
	const deadChainIds = new Set(chainLines.filter((line) => !outChains.includes(line)).map((line) => line.id));
	const positions = graphStore.readPositions();
	const prunedPositions = Object.fromEntries(
		Object.entries(positions).filter(([id]) => id !== nodeId && !deadChainIds.has(id)),
	);
	if (Object.keys(prunedPositions).length !== Object.keys(positions).length) {
		graphStore.writePositions(prunedPositions);
	}

	return {
		chainsRemoved: chainLines.length - outChains.length,
	};
}
