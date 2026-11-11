/**
 * Contratos del grafo de conocimiento: nodos, registros, hallazgos de extracción
 *
 * La implementación mínima de la visión del grafo (docs/archive/vision.md §1, el
 * rediseño del 2026-09-02): todo nodo es una proposición VERDADERA; las aristas son follows
 * (derivable) y supports (fundamenta sin implicar); la procedencia tiene
 * granularidad de mensaje; la extracción es de forma libre y a posteriori, totalmente desacoplada
 * del árbol del plan de la sesión. El grafo es una extracción de las cadenas de
 * razonamiento de todas las sesiones de enseñanza (y de las notas importadas), NADA más:
 * ni resultados de quiz ni evaluaciones de comprensión (limpieza del 2026-09-27).
 * Todo lo que aún no
 * está decidido (el modelo de estados, la derivación de la fuerza, las estrategias de selección) NO está aquí a propósito: unos
 * esbozos transitorios sostienen el renderizador hasta que lleguen.
 *
 * Parte de los contratos divididos por dominio (src/core/contracts/): cada fichero de dominio
 * pertenece por completo a su línea de trabajo; los cambios de esquema entre dominios pasan por
 * master. Tipos puros + documentación del protocolo + pequeños helpers puros. Ver docs/archive/vision.md.
 */
// ─── Grafo de conocimiento (visión §1: global, entre sesiones) ───────────────────

import type { CallUsage, ExtractionRunUsage } from "./chat.ts";

/** Relación dirigida derivada de las cadenas de razonamiento guardadas, no un registro
 * independiente. Las aristas del lienzo conectan una premisa única directamente con su
 * conclusión, o varias premisas a través de un nodo de implicación derivado.
 * Las aristas lógicas conectan las premisas proposicionales directamente con las conclusiones. */
export interface GraphEdge {
	from: string;
	to: string;
}

/** Argumento guardado cuyas premisas implican conjuntamente su conclusión. Los argumentos
 * independientes siguen siendo cadenas separadas aunque compartan conclusión.
 * Las cadenas de varias premisas producen un nodo de implicación derivado con el ID arg_
 * de la cadena; las de una sola premisa se renderizan como flechas directas. Eliminar una
 * proposición elimina en cascada las cadenas que la referencian. */
export interface GraphChain {
	/** "arg_" + algo tipo nanoid (asignado por el store, el patrón de acuñación de nodos). */
	id: string;
	/** Ids de nodo de las premisas del argumento: al menos una, conjuntamente
	 *  suficientes. Locales del extractor en la red; ids de nodo tras la resolución. */
	premises: string[];
	/** El id de nodo que las premisas implican conjuntamente. */
	conclusion: string;
	/** Cada punto (chat, mensaje) donde se afirmó este argumento,
	 *  unidos entre las líneas de afirmación al leer. */
	provenance: ProvenancePoint[];
	createdAt: string;
}

/** Recuentos fusionados en los registros del grafo por una ejecución de extracción, guardados también con
 * el uso de la extracción. Los registros de uso antiguos pueden omitir las cadenas y llevar en su lugar
 * recuentos de aristas; las fusiones actuales escriben recuentos de cadenas. */
export interface EmissionStats {
	/** Nodos nuevos del grafo anexados. */
	nodes: number;
	/** Cadenas de razonamiento nuevas anexadas. */
	chains?: number;
	/** Cadenas eliminadas por simplificación durante esta fusión, aparte de los
	 * anexados nuevos contados en chains. Se omite cuando no se elimina ninguna; los registros sin
	 * este campo aportan cero eliminaciones. */
	droppedChains?: number;
}

/** Ubicación de origen de una afirmación de proposición o de cadena de razonamiento. Un ID de
 * mensaje la ancla a un pasaje del transcript nativo; la procedencia a nivel de chat y la de
 * ficheros importados pueden omitir ese ancla usando un messageId vacío. */
export interface ProvenancePoint {
	/** El chat al que se ancla este punto, o un id de fuente de notas ("src_…"):
	 *  las importaciones no llevan anclas de mensaje (la procedencia es el propio fichero,
	 *  registrada mediante la línea de correspondencia + el registro de la fuente). */
	chatId: string;
	messageId: string;
}

/** Fuente de notas importada procesada por la canalización extractor → auditor → fusionador.
 * La procedencia identifica el fichero en lugar de un mensaje de chat, y la fuente
 * es dueña de su registro de uso de extracción. Los ID son src_ más un hash determinista de la
 * ruta del fichero, así que reimportar la misma ruta usa la misma identidad de fuente. */
export interface NotesSource {
	id: string;
	filePath: string;
	/** ISO: cuándo se importó este fichero (el foldedAt del punto de control). */
	importedAt: string;
	/** Huella de contenido heredada. Se acepta al leer registros antiguos, pero
	 * se ignora: toda importación explícita de notas procesa el fichero entero. Las importaciones
	 * nuevas no calculan ni escriben este campo. No hace falta migración. */
	contentFp?: string;
	/** El registro de uso de la ejecución: la misma disciplina de solo anexado que
	 *  ChatRecord.extractions, idempotente por startedAt. */
	extractions?: ExtractionRunUsage[];
}

/** Lo que hizo un refresco de nombres de clústeres: el ClusterRefreshStats del nombrador,
 *  con forma de contrato para que la capa del agente no necesite importar los contratos.
 *  Los gemelos estructurales siguen siendo intercambiables. */
export interface NamingRunStats {
	/** Comunidades en las que se divide el grafo actual (de todos los tamaños). */
	detected: number;
	/** Comunidades que conservaron una etiqueta por supervivencia del núcleo. */
	claimed: number;
	/** Comunidades enviadas al nombrador (sin nombre, tamaño >= MIN_CLUSTER_SIZE). */
	named: number;
	/** Registros de etiquetado realmente anexados (la deduplicación idempotente puede reducirlos). */
	appended: number;
}

/** La versión de formato de la familia del grafo que este build escribe y entiende
 *  (el fichero auxiliar format.json: src/store/graph-format.ts). */
export const CURRENT_GRAPH_FORMAT_VERSION = 1;


export interface GraphNode {
	/** Id opaco y estable, asignado por el store: "n_" + algo tipo nanoid. */
	id: string;
	/** Una etiqueta muy corta para el nodo: un asa compacta como la entrada de un
	 *  glosario ("Voluntad de poder", "Teoría del mandato divino"): lo que el grafo
	 *  muestra de un vistazo. Solo de presentación: no es única, no es clave de
	 *  identidad, nunca es precisa: la precisión la lleva el enunciado. Se fija al
	 *  crear (la primera línea la define); un anexado de enlace nunca la cambia. */
	name: string;
	/** La proposición mínima: un enunciado verdadero y autocontenido, con
	 *  precisión plena. El ANCLA DE IDENTIDAD: el auditor reconoce un
	 *  reencuentro juzgando contra esto (enlazar o crear), no por
	 *  coincidencia de strings. Se muestra en la tarjeta de detalle; la etiqueta del lienzo es el
	 *  nombre. */
	statement: string;
	/** Formulaciones literales que usaron las sesiones para esta proposición (el rastro de
	 *  auditoría de identidad: cómo dijo el mundo lo que dice el nodo). */
	aliases: string[];
	createdAt: string;
	/** Cada punto (chat, mensaje) donde apareció esta proposición. */
	provenance: ProvenancePoint[];
}

/** Línea de sessions.jsonl: el punto de control de emisión de un chat (qué chats
 *  se han plegado, y hasta qué updatedAt; nunca plegar dos veces). */
export interface SessionCheckpoint {
	chatId: string;
	/** El `updatedAt` del registro del chat en el momento del pliegue. */
	foldedAt: string;
}

/** Entrada de coverage.jsonl que marca un mensaje extraído por la huella de su vista de
 * extracción. El contenido sin cubrir se deriva comparando las huellas actuales;
 * una respuesta que cambia la vista de una pregunta solo reabre ese mensaje. La extracción
 * de chats registra la cobertura de mensajes; las importaciones de notas usan puntos de control de la fuente. */
export interface CoverageEntry {
	chatId: string;
	/** sha256 de las líneas de la vista del mensaje: «cubierto» significa exactamente esto. */
	fp: string;
	/** Estimación caracteres/4 de la vista del mensaje: visualización + presupuesto. */
	tokens: number;
	/** ISO: cuándo se fusionó la última ejecución de extracción de este mensaje. */
	foldedAt: string;
}

/**
 * Formato del store (src/store/graph.ts): registros JSONL en config.LEDGER_FILES
 * (nodes/chains/sessions), todos de solo anexado. Las aristas NUNCA se guardan: la
 * vista derivada (nodos de implicación + flechas sin tipo) se reconstruye a partir de las cadenas
 * en cada lectura (las cadenas como fuente primaria, responsable 2026-09-30).
 *
 *   nodes.jsonl    una línea por nodo: la PRIMERA línea de un id define
 *                  name/statement/createdAt; las líneas posteriores del
 *                  mismo id son anexados de enlace (el reencuentro de una sesión):
 *                  sus enunciados/alias se suman a `aliases`, sus
 *                  procedencias se unen; el nombre sigue siendo el de la primera línea.
 *                  getGraph fusiona por id.
 *   chains.jsonl   una línea por AFIRMACIÓN de cadena; los lectores fusionan por
 *                  (premisas, conclusión), uniendo la procedencia: el
 *                  id arg_ de la primera línea es la identidad de la cadena.
 *
 * El grafo derivado se reconstruye leyendo los registros: se guardan eventos, se
 * deriva el estado. sessions.jsonl es el punto de control de la extracción: qué chats
 * ha procesado la canalización de extracción, y hasta qué updatedAt
 * (nunca extraer dos veces los mismos turnos).
 *
 * La CANALIZACIÓN DE EXTRACCIÓN es el único escritor del grafo (extractor → auditor →
 * fusionador), ciega al árbol y a posteriori (limpieza del 2026-09-27: separación clara
 * del trabajo): el extractor es la ÚNICA etapa que ve la fuente cruda
 * (la sesión entera como markdown legible, o las notas crudas) y extrae las
 * cadenas de razonamiento: proposiciones (incluidas las relevantes aisladas) más
 * aristas follows/supports; el auditor NUNCA ve
 * la fuente: su trabajo es preparar la fusión: veredictos de identidad
 * (enlazar o crear, fusionando formas equivalentes de la misma proposición) mediante
 * herramientas de exploración del grafo (find / list_sessions / list_propositions), y
 * puede trazar aristas PUENTE desde nodos existentes del grafo hacia las nuevas
 * proposiciones; el fusionador (core/graph.ts, determinista) aplica los
 * veredictos y anexa. Los eventos de quiz y las observaciones de comprensión HAN
 * DESAPARECIDO: la canalización es el único puente sesión→grafo, y lleva
 * proposiciones + aristas, nada más.
 */

// ─── Hallazgos de extracción (salida del extractor → auditoría → entrada del fusionador) ─

/** Una proposición propuesta: un candidato a nodo (o un reencuentro con uno). */
export interface ExtractedProposition {
	/** Id local del extractor ("p1", …) al que hacen referencia las aristas. */
	id: string;
	/** Una etiqueta muy corta: unas pocas palabras, un asa compacta como la entrada de un
	 *  glosario. No es una frase, no tiene por qué ser única ni autocontenida: la
	 *  precisión la lleva el enunciado. Pasa a ser el nombre del nodo al crearlo;
	 *  al enlazar, el nodo existente conserva su nombre. */
	name: string;
	/** La proposición mínima: un enunciado verdadero, autocontenido y referido al mundo,
	 *  con precisión plena. Sin referencias al alumno / profesor / sesión:
	 *  los errores conceptuales se enuncian como la corrección verdadera, y
	 *  el error nunca se registra en el grafo (2026-09-27: el registro de
	 *  eventos ha desaparecido). */
	statement: string;
	/** Formulaciones literales que usó la sesión. */
	aliases: string[];
	/* Esquema de envío adelgazado (responsable, 2026-09-28): `messages` y `evidence`
	 * HAN DESAPARECIDO. Los campos de citas literales nunca se persistían y los modelos
	 * débiles gastaban en ellos sus reintentos ("propositions.0: must be
	 * object": el colapso de la carga útil convertida en string). El extractor informa de
	 * proposiciones + estructura, nada más. */
	/** OPCIONAL, SOLO EN EL CAMINO DE SESIÓN (responsable, 2026-10-13): el id del mensaje del
	 *  ÚNICO pasaje del profesor del que salió esta proposición: el extractor
	 *  lo copia de la etiqueta "TEACHER [id]" de la vista (messageViewLines de
	 *  core/coverage.ts) y la frontera de envío lo valida contra el lote
	 *  ACTUAL. El fusionador lo estampa en el punto de procedencia del nodo
	 *  {chatId, messageId} (nodos nuevos Y anexados de enlace); las cadenas
	 *  se quedan a nivel de chat. Las importaciones de notas y los llamadores heredados/de core no lo tienen:
	 *  undefined → messageId "" (nivel de chat), así que NO cambia ninguna forma persistida ni
	 *  versión de formato (GraphNode / ProvenancePoint intactos). */
	messageId?: string;
}

/** Un argumento propuesto (rediseño del extractor, 2026-09-30). Los extremos son
 *  ids de proposición locales del extractor ("p1", …): el extractor es la ÚNICA
 *  etapa que propone cadenas; el fusionador las resuelve a ids de nodo. */
export interface ExtractedChain {
	/** Ids de proposición que implican CONJUNTAMENTE la conclusión. */
	premises: string[];
	/** El id de proposición que las premisas implican conjuntamente. */
	conclusion: string;
}

/** La forma de salida del extractor: las cadenas de razonamiento crudas. */
export interface SessionFindings {
	propositions: ExtractedProposition[];
	chains: ExtractedChain[];
}

/** Un veredicto de identidad: el id de proposición local del extractor → el nodo
 *  EXISTENTE del grafo que ES esa proposición. Al enlazar, las
 *  formulaciones de la sesión (statement, aliases) se suman a los alias del nodo y la
 *  procedencia se une. SESGO DE EQUIVALENCIA (2026-09-27): las paráfrasis,
 *  reformulaciones y compresiones de la misma afirmación se FUSIONAN: no crees
 *  un duplicado porque cambie la redacción. Solo las proposiciones realmente
 *  distintas se mantienen separadas. */
export interface IdentityLink {
	id: string;
	linkTo: string;
}

/** La salida del auditor: SOLO VEREDICTOS (responsable, 2026-09-28): el auditor
 *  nunca altera los hallazgos del extractor, así que no los repite;
 *  el fusionador determinista une hallazgos + veredictos. `links` = los
 *  veredictos de identidad (id local ⇄ nodo existente): TODO lo que
 *  entrega el auditor (responsable, 2026-09-28 por la tarde: el argumento de aristas HA DESAPARECIDO:
 *  el auditor nunca acuña aristas; el grafo se conecta entre fuentes
 *  únicamente a través de equivalencias identificadas). Sin canal de descarte: el
 *  auditor nunca rechaza; se confía plenamente en el extractor (2026-09-27). */
export interface AuditVerdicts {
	links: IdentityLink[];
}

/** Clúster renderizado en una instantánea del grafo. Los miembros son IDs de nodos de proposición;
 * la geometría de la envolvente se deriva de sus posiciones al renderizar. */
export interface Cluster {
	/** El id del registro de etiquetado cuando se ha reclamado; los clústeres sin etiqueta siguen
	 * apareciendo (envolvente, sin nombre) con un id hash de sus miembros. */
	id: string;
	/** null hasta que la llamada de nombrado ha acuñado/reclamado un etiquetado. */
	label: string | null;
	/** Ids de nodo, ordenados. La envolvente + el centroide son asunto del renderizador. */
	members: string[];
}

/** Proyección del grafo que contiene las proposiciones/cadenas guardadas y los datos derivados de
 * renderizado, disposición y procedencia. Las flechas/uniones derivadas no son argumentos guardados. */
export interface GraphSnapshot {
	/** Nodos del lienzo: proposiciones más nodos de implicación derivados para las cadenas de
	 * varias premisas. Cada nodo de implicación usa el ID de su cadena. */
	nodes: GraphNode[];
	/** Solo los nodos de proposición GUARDADOS (sin nodos de implicación derivados):
	 *  la verdad guardada, como `chains`: los consumidores que leen el mundo
	 *  (la tabla de cadenas) usan esta lista, nunca la imagen del lienzo. */
	propositions: GraphNode[];
	/** Flechas derivadas del lienzo: premisa → conclusión directa para las cadenas de una
	 * sola premisa, o premisa → nodo de implicación → conclusión para las de varias premisas.
	 * Se reconstruyen a partir de las cadenas, no se guardan por separado. */
	edges: GraphEdge[];
	/** Flechas directas premisa → conclusión derivadas, solo sobre IDs de proposición.
	 * Los cálculos de profundidad usan estas en lugar de la geometría de los nodos de implicación. */
	logicalEdges: GraphEdge[];
	/** Vínculo de unión derivado de cada cadena viva de varias premisas. La disposición usa
	 * las filas de premisa/conclusión para colocar su nodo de implicación entre ellas. */
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
	/** Las cadenas de razonamiento GUARDADAS (fusionadas por (premisas, conclusión) al
	 *  leer): la entrada de la tabla de cadenas y de la canalización de práctica: leen
	 * la verdad, nunca el despliegue derivado. */
	chains: GraphChain[];
	/** chatId → título, para cada chat que tocó el grafo. */
	sessions: Record<string, string>;
	/** srcId → ruta del fichero, para cada fichero de NOTAS IMPORTADAS que tocó el
	 *  grafo (la puerta de entrada agnóstica al formato): una entrada de procedencia estática:
	 *  la tarjeta de detalle muestra la ruta como texto plano, no como enlace. */
	fileSources: Record<string, string>;
	/** nodeId → chatIds que tocaron el nodo (procedencia navegable con clic). */
	nodeSessions: Record<string, string[]>;
	/** Comunidades por sesión de nacimiento (core/session-clusters.ts: cada
	 * proposición se une al clúster de la sesión que la hizo nacer:
	 * procedencia de sesión, sin Louvain, sin embeddings), con MIN_CLUSTER_SIZE
	 * ≥ 3 como regla de presentación de la envolvente. Solo proposiciones: los nodos
	 * de implicación nunca se particionan. Derivadas puramente de la procedencia: nunca
	 * dependen de la disposición. */
	clusters: Cluster[];
	/** Posiciones de reposo de la disposición por id de nodo, cuando existe un registro
	 *  de posiciones (lo escribe el settle de core/layout.ts). Ausente en un grafo nuevo:
	 *  la vista recurre entonces a su propia pasada puntual de forceAtlas2. */
	positions?: Record<string, Position>;
}

/** La posición de reposo de un nodo en el espacio de la disposición (el registro de posiciones). */
export interface Position {
	x: number;
	y: number;
}

/** El límite de caracteres del título automático (responsable, 2026-10-06): lo bastante largo para
 *  seguir siendo informativo en la barra lateral y en la barra superior, lo bastante corto para que
 *  un primer mensaje nunca se lea como un párrafo. Ajustable: un número, un
 *  sitio. */
export const TITLE_MAX_CHARS = 72;

/** Deriva un título corto de chat a partir del primer mensaje del alumno (puro).
 *  Truncado inteligente (responsable, 2026-10-06): el corte se ajusta a un límite de palabra
 *  IGUAL O POR DEBAJO del límite: un título nunca termina a mitad de palabra. La única excepción
 *  es una sola palabra más larga que el límite (raro, pero real: identificadores,
 *  URL): se corta en el límite, partiendo la palabra. Los espacios en blanco se colapsan primero
 *  a espacios simples, así que los límites siempre son de un solo espacio.
 *  Se usa al crear el chat; determinista para que las pruebas puedan fijarlo. */
export function titleFromPrompt(prompt: string): string {
	const oneLine = prompt.replace(/\s+/g, " ").trim();
	if (oneLine.length <= TITLE_MAX_CHARS) return oneLine;
	// Último espacio entre los primeros TITLE_MAX_CHARS caracteres; el corte va
	// antes de él para que no se cuele un espacio final en el título.
	let cut = -1;
	for (let i = TITLE_MAX_CHARS; i > 0; i--) {
		if (oneLine[i - 1] === " ") {
			cut = i - 1;
			break;
		}
	}
	// Una palabra larga: no hay límite de palabra por debajo del tope; se parte (caso
	// especial del responsable). Esto también funciona bien cuando la primera palabra llena
	// exactamente el tope: cortar en el tope ES el límite.
	if (cut < 0) cut = TITLE_MAX_CHARS;
	return `${oneLine.slice(0, cut)}…`;
}
