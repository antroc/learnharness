/**
 * Contratos de las sesiones de chat: registros, resúmenes, puntos de extensión de la interfaz
 *
 * Parte de los contratos divididos por dominio (src/core/contracts/): cada fichero de dominio
 * pertenece por completo a su línea de trabajo; los cambios de esquema entre dominios pasan por
 * master. Tipos puros + documentación del protocolo + pequeños helpers puros. Ver docs/archive/vision.md.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { LhMessage } from "../native-messages.ts";
import type { Phase3 } from "../phases.ts";
import type { PlanNodeStatus, PlanTree } from "./plan.ts";
import type { EmissionStats } from "./graph.ts";

// ─── Registros de chat (el formato en disco del almacén de sesiones) ─────────────

/** Tipo de sesión: teach es el valor por defecto cuando un registro guardado omite kind.
 * Practice usa el agente de práctica adaptativa sin la extracción de la enseñanza ni
 * escrituras en el grafo. Leer un kind ausente no exige migrar el registro. */
export type ChatKind = "teach" | "practice";

/** Una sesión nativa persistida en data/chats/<id>.json. Los mensajes conservan el
 * historial nativo del agente; el renderizado del transcript los agrupa en una vista aparte.
 * El uso, las imágenes, el estado del plan y las conversaciones laterales son registros propiedad de la sesión. */
export interface ChatRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: LhMessage[];
	/** Imágenes procesadas locales de la sesión; los registros de artefactos solo llevan referencias. */
	imageSnapshots?: Record<string, ImageSnapshot>;
	/** El tipo de la sesión; un campo ausente se interpreta como teach. */
	kind?: ChatKind;
	/** El árbol del plan de la sesión, escrito por las herramientas de plan nativas. */
	tree?: PlanTree;
	/** Registro de uso solo de anexado, separado del historial de mensajes: una entrada por turno
	 * facturado, sin duplicados por identidad de petición. messageId asocia el uso con el
	 * transcript; los agregados de tokens/coste se calculan a partir del registro al leer. */
	turns?: TurnUsage[];
	/** Uso de la extracción en segundo plano de este chat, solo de anexado y separado de los
	 * mensajes. Las ejecuciones terminadas incluyen las fallidas con uso; los anexados son
	 * idempotentes por startedAt. */
	extractions?: ExtractionRunUsage[];
	/** Sustituciones de modelo/razonamiento por chat para los agentes de conversación. */
	settings?: ChatSettings;
	/** Hilos de aclaración duraderos. Cada explicación y su comprobación asociada
	 * comparten un hilo. Cada petición principal anexa los intercambios crudos nuevos de
	 * todos los hilos; el historial ya registrado del profesor nunca se reescribe. */
	sideChats?: SideChatThread[];
	/** Versión del esquema. Su ausencia denota la versión 1; las escrituras sellan la versión
	 * soportada actual. Las lecturas rechazan los registros sellados con una versión más nueva que este build
	 * para que una app con una versión anterior no pueda reescribir un registro no soportado. */
	version?: number;
}

/** El formato de registro de chat que este build escribe y entiende. */
export const CURRENT_CHAT_VERSION = 2;

/** Elecciones de modelo y razonamiento por sesión para los agentes de conversación nativos.
 * Cada campo ausente recurre de forma independiente al hueco del modelo potente; sin
 * modelo configurado, el trabajo de conversación no está disponible. Las elecciones se resuelven
 * al componer un turno, no a mitad de una petición activa. Los roles de worker
 * en segundo plano usan su propia resolución de modelo. */
export interface ChatSettings {
	/** Coordenadas explícitas de modelo calificadas por proveedor, del catálogo del host. */
	model?: { provider: string; id: string };
	/** Nivel de razonamiento de pi: debe estar en la lista de niveles soportados del modelo elegido
	 *  (getSupportedThinkingLevels; lo impone la ruta de ajustes). */
	thinkingLevel?: ThinkingLevel;
}


// ─── Uso de la extracción en segundo plano (el canal del dinero, lado de la extracción) ─

/** El uso del modelo de una etapa de la canalización: el modelo de la etapa + cada paso que
 *  facturó (CallUsage por paso del agente). Pasos, no una suma: los pliegues de coste y
 *  contexto se hacen al leer (core/prices.ts). */
export interface ExtractionStageUsage {
	/** El modelo que ejecutó esta etapa, calificado por proveedor ("provider:id")
	 * para buscarlo en el catálogo de Pi al leer, sin depender de la clave. */
	model: string;
	steps: CallUsage[];
}

/** El registro de uso de una ejecución de extracción terminada (o fallida a mitad de camino).
 *  Se anexa al registro `extractions` del chat cuando termina la ejecución, con éxito o
 *  con fallo, porque el dinero se gastó en ambos casos; `stats` solo está presente
 *  cuando el fusionador llegó a ejecutarse. */
export interface ExtractionRunUsage {
	/** El startedAt (ms) de la ejecución en el registro: la clave de idempotencia. */
	startedAt: number;
	at: string;
	durationMs: number;
	/** Lo que la ejecución fusionó en el grafo; ausente cuando falló antes. */
	stats?: EmissionStats;
	/** Uso del modelo por etapa, en el orden de la canalización (el fusionador es determinista:
	 *  sin llamada al modelo, sin entrada). */
	stages: {
		extractor: ExtractionStageUsage;
		auditor: ExtractionStageUsage;
	};
}

// ─── Contabilidad de uso (el canal del dinero) ────────────────────────────────────

// ─── Preguntas laterales (hilos de aclaración en línea, 2026-11-02) ──────────────

/** Dónde se sitúa un hilo lateral en el transcript: tras un bloque de nivel de párrafo
 *  (la división en bloques de markdown de Streamdown) de una parte de prosa del profesor.
 *  La prosa asentada del profesor nunca cambia, así que (partId, blockIndex) es estable. */
export interface SideChatAnchor {
	/** El mensaje nativo del asistente que lleva la prosa. */
	messageId: string;
	/** La identidad de la parte de texto de projectView (`<messageId>-t<n>`). */
	partId: string;
	/** Índice de bloque (desde 0) dentro del markdown renderizado de esa parte. */
	blockIndex: number;
	/** El markdown original del bloque cuando se abrió el hilo: la
	 *  cita por defecto, y el texto del ancla si el registro se vuelve a dividir alguna vez. */
	blockText: string;
}

/** Un mensaje de un hilo lateral. Texto plano, nunca historial nativo de pi: el
 *  hilo se reproduce al modelo lateral como turnos de texto de usuario/asistente. */
export interface SideChatMessage {
	id: string;
	role: "user" | "assistant";
	/** La pregunta del alumno, o la respuesta lateral (markdown). */
	text: string;
	/** Solo user: los pasajes que el alumno adjuntó a esta pregunta. */
	quotes?: string[];
	/** Los enlaces de cita canónicos del Tutor correspondientes conservan la fuente nativa real
	 * de cada pasaje y su selector de texto exacto, con independencia de la identidad del segmento.
	 * Las citas heredadas solo de string siguen siendo legibles sin un destino adivinado. */
	quoteCitations?: string[];
	/** Momento ISO en que se guardó el mensaje. */
	at: string;
	/** Solo assistant: modelo calificado por proveedor ("provider:id"). */
	model?: string;
	/** Identidad de idempotencia de la pregunta/reintento que produce esta respuesta. */
	requestId?: string;
	/** Solo assistant: el alumno detuvo la respuesta; `text` es parcial. */
	stopped?: boolean;
	/** Solo instantánea de entrega: esta respuesta aún se estaba generando al capturarla. */
	pending?: boolean;
	/** Solo assistant: la llamada falló; `text` es lo que haya llegado. */
	error?: string;
}

/** Un hilo lateral por explicación y pregunta asociada, mostrado en el
 * acompañante compartido flotante/acoplado en lugar de en ventanas en línea. */
export interface SideChatThread {
	id: string;
	anchor: SideChatAnchor;
	/** Estado abierto/cerrado guardado de este hilo. */
	open: boolean;
	createdAt: string;
	messages: SideChatMessage[];
	/** Instantánea de compatibilidad que se conserva al leer registros que usan un corte de
	 * contexto puntual. La entrega actual usa entradas de actualización nativas inmutables. */
	contextSnapshot?: SideChatMessage[];
}

/** Contabilidad de tokens persistida de una llamada al modelo. Undefined significa que el
 * proveedor no informó de ese campo; la ausencia no debe interpretarse como cero. */
export interface CallUsage {
	/** Tokens de entrada nuevos normalizados por Pi; los compartimentos de caché son disjuntos. */
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	/** Tokens de entrada LEÍDOS de la caché (facturados a la tarifa de lectura de caché, si la hay). */
	cacheReadTokens: number | undefined;
	/** Tokens de entrada escritos en la caché en esta llamada; undefined si no se informó. */
	cacheWriteTokens: number | undefined;
	/** Subconjunto de cacheWriteTokens escrito con retención de una hora. Falta
	 * en los registros antiguos; las capturas nativas nuevas registran cero explícitamente si no hay. */
	cacheWrite1hTokens?: number;
	/** La parte de razonamiento de los tokens de salida. */
	reasoningTokens: number | undefined;
}

/** Uso de una invocación del handler de conversación nativo, incluidos los turnos de usuario
 * y de despertar. Un turno que usa herramientas puede abarcar varias llamadas al modelo facturadas por separado.
 * La contabilidad se captura cuando el turno se persiste; el coste se estima a partir de las
 * llamadas registradas y del catálogo de modelos al leer. */
export interface TurnUsage {
	/** Identidad de petición de una invocación del handler y clave de idempotencia del registro
	 * solo de anexado. Distinta de la asociación con el transcript de messageId. */
	id: string;
	/** El mensaje del asistente que produjo el turno: procedencia; vincula esta
	 *  entrada con el transcript (el bloque al que «pertenece» este turno). */
	messageId: string;
	at: string;
	/** El modelo que ejecutó el turno, calificado por proveedor ("provider:id")
	 * para buscarlo en el catálogo de Pi al leer, sin depender de la clave. */
	model: string;
	/** Una entrada por paso del agente (llamada al modelo) en este turno. */
	steps: CallUsage[];
}

// ─── Bloques de plan (el plan vive en el chat) ──────────────────────────────────

/** Carga útil de la parte de interfaz persistida `data-plan-block` (diseño de 2026-09): una
 * INSTANTÁNEA del plan en el momento en que cambió, renderizada como un bloque en el
 * flujo del chat. Se adjunta al mensaje del asistente que lleva la llamada a la herramienta
 * plan_init (kind "full") o a la parte de quiz de comprobación respondida (kind
 * "neighborhood"). Las partes de datos nunca llegan al modelo (convertToModelMessages
 * las descarta): el bloque es historial puro de interfaz, que reaparece idéntico al
 * recargar porque vive en el registro.
 *
 * Contrato de renderizado: un bloque "full" renderiza el DAG entero sin borde,
 * llenando en horizontal la columna del chat, con su altura natural; un bloque "neighborhood"
 * renderiza el nodo actual + sus padres directos + sus hijos directos en su propio
 * contenedor pequeño, con el nodo actual iluminado: claramente un fragmento, no el
 * plan entero. Al hacer clic en cualquiera se abre el plan completo en un popup. */

/** El texto de cara al modelo del despertar de traspaso sondeo→enseñanza (el esquema de
 *  mensajes personalizados): el mensaje de despertar solo lleva la parte data-probe-handoff, y
 *  el adaptador la aplana a ESTO. De fuente única para que la frontera del sondeador, las
 *  pruebas y la realidad no puedan divergir.
 *
 *  RITMO CON EL RAZONAMIENTO PRIMERO (responsable, 2026-09-26): el despertar es la única
 *  señal por turno en el turno de arranque; la antigua frase única se leía como una orden de despacho
 *  («redacta ya») y el profesor se saltaba la deliberación que pide el fragmento
 *  de planificación. Así que el despertar marca el ritmo: razonar la forma óptima de
 *  enseñar ESTO a ESTA persona ANTES de plan_init. Fiel a la maquinaria:
 *  plan_init sigue siendo la primera herramienta, el mapa del plan sigue siendo el primer
 *  artefacto, y presentar sigue terminando el turno (la muerte del veredicto,
 *  2026-09-26: el siguiente mensaje del alumno es una respuesta natural: una petición
 *  de cambio o el visto bueno). */
export const HANDOFF_TEXT =
	"Next: plan the full teaching arc from my current understanding to the goal understanding. " +
	"Apply the teaching methodology in your system prompt, and find the optimal way to teach me this. " +
	"Find the unconditional truths, plan the motivated derivations/discoveries, so every reasoning step has to land as obviously true. " +
	"Take your time here and really think this through. " +
	"When it's genuinely reasoned out, call plan_init and present the plan; I'll accept it or ask for changes.";

// ─── Sesiones de práctica (responsable, 2026-10-04): textos de marcadores y acuses ──
// De fuente única aquí según la ley de los marcadores: el texto de cara al modelo de cada
// marcador personalizado vive en core/contracts, nunca en la frontera de aplanado.

/** El registro de cara al modelo de un envío de razonamiento (newThinkingMessage
 *  antepone esta etiqueta al texto del alumno). Las pistas y los compromisos van por
 *  un mismo canal: la etiqueta es la ÚNICA diferencia que ve el modelo. */
/** La etiqueta única de envío (ronda del responsable, 2026-10-05): un solo carril
 *  de envío; si un envío afirma una respuesta se lee del texto,
 *  no lo declara un botón. */
export const THINKING_LABEL = "Your thinking";

/** El acuse de la herramienta conclude: compartido por la llamada ejecutada (capa del agente) y
 *  el par sintetizado al descartar (input-events), para que un problema concluido
 *  se lea igual para el modelo concluya como concluya. Ronda 16 del responsable:
 *  el turno TERMINA tras concluir (una ley del prompt de sistema, sin terminate
 *  a nivel de herramienta: el modelo puede decir primero sus palabras de cierre y después debe
 *  dejar de llamar a herramientas); el siguiente problema espera el visto bueno
 *  explícito del alumno. */
export const CONCLUDE_ACK_TEXT =
	"Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, answer their questions about the concluded one.";

/** La señal explícita del alumno para seguir adelante (ronda 16 del responsable, 2026-10-06):
 *  el texto de cara al modelo del marcador practice-next, de fuente única
 *  como THINKING_LABEL. El camino del botón/Enter con el campo vacío anexa el
 *  marcador; el modelo lo lee y plantea (o cierra) según la doctrina. */
export const NEXT_PROBLEM_TEXT =
	"[NEXT PROBLEM] — the learner's explicit go-ahead: pose the next problem now per the selection rules, or wrap the session in text if the arc is complete.";

/** La cabecera de cara al modelo del marcador de compactación (ronda 14 del responsable,
 *  2026-10-05). El contenido del marcador es esta cabecera + el resumen: el
 *  único texto que ve el proveedor en lugar del tramo descartado. Ley de
 *  redacción: debe decirle al modelo (a) que hubo un corte y que es rutinario, (b) que el
 *  resumen sustituye todo lo anterior, (c) que lo que sigue es transcript reciente
 *  literal, para que el modelo ni vuelva a preguntar lo ya cubierto ni
 *  desconfíe de la frontera. */
export const COMPACTED_HISTORY_HEADER =
	"[SESSION HISTORY COMPACTED] The transcript before this point was summarized to fit the context window; the summary below replaces it. Everything after this message is the verbatim recent transcript.";


export interface PlanBlockData {
	/** Solo sobrevive "full" (el giro del 2026-09-11): el plan se renderiza EN EL
	 *  FLUJO una vez, al redactarlo. Los fragmentos de vecindario se retiran:
	 *  la posición se deriva en vivo del transcript (la ventana persistente del DAG
	 *  es la sucesora). */
	kind: "full";
	at: string;
	/** El nodo actual en el momento de la instantánea (el destino del brillo; null = ninguno). */
	current: string | null;
	/** Todos los nodos del árbol redactado. Los estados son los de la instantánea,
	 * derivados al emitirla: el bloque nunca los vuelve a derivar al renderizar. */
	nodes: Array<{ id: string; title: string; status: PlanNodeStatus }>;
	edges: Array<{ from: string; to: string }>;
}

/** Resumen de una sesión guardada con un recuento de mensajes en lugar del historial completo.
 * Los indicadores de fase y de entrada pendiente se derivan de los eventos nativos del transcript.
 * El estado en vivo de turno/compactación se añade aparte en ChatListItem, no se
 * infiere del registro guardado. */
export interface ChatSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	/** Tipo normalizado (un campo ausente en el registro se interpreta como teach). */
	kind: ChatKind;
	messageCount: number;
	/** Fase derivada del transcript: probe termina al completarse con éxito probe_done;
	 * plan termina en la primera llamada a una pregunta de enseñanza etiquetada con nodo, no en su respuesta. */
	phase: Phase3;
	/** Hay una pregunta quiz/ask sin responder esperando al alumno. */
	pendingQuestion: boolean;
	/** Hay un problema de práctica planteado pero no concluido. False en las sesiones de enseñanza. */
	pendingProblem: boolean;
	/** Elecciones de modelo/razonamiento guardadas por sesión incluidas en la carga útil de la lista. */
	settings?: ChatSettings;
}

/** Fila de la lista de sesiones que combina un resumen guardado con el estado en vivo del servidor.
 * busy significa que hay un turno de conversación nativo en curso; las tareas en segundo plano
 * desacopladas no ponen la sesión en busy. Estos indicadores no son un estado persistido. */
export interface ChatListItem extends ChatSummary {
	busy: boolean;
	/** True mientras la compactación de contexto en segundo plano tiene la barrera del modelo del chat.
	 * Lo proporciona el registro de compactaciones en vivo, no los marcadores de compactación guardados. */
	compacting: boolean;
}

// ─── Imágenes del alumno en la lección (issue #363) ──────────────────────────────

/** Una imagen enderezada y sin metadatos, guardada una vez por sesión. */
export interface ImageSnapshot {
	mimeType: "image/png" | "image/jpeg";
	data: string;
	width: number;
	height: number;
}

/** La carga útil del registro de show_image. Su instantánea propiedad de la sesión nunca llega al modelo. */
export interface ShowImageDetails {
	/** La ruta absoluta desde la que se leyó la imagen. */
	path: string;
	caption?: string;
	mimeType: "image/png" | "image/jpeg";
	/** Identidad SHA-256 en ChatRecord.imageSnapshots. */
	snapshotId: string;
	width: number;
	height: number;
}

// ─── Registro de renderizadores de artefactos (punto de extensión del cliente) ───

/**
 * components/chat.tsx renderiza toda parte de herramienta que no trata de forma especial mediante
 * el registro de components/artifacts/index.ts, indexado por nombre de herramienta ("research",
 * "demo", "visual", …). Los workers añaden ahí sus renderizadores: chat.tsx está vetado
 * para el trabajo de artefactos. El renderizador recibe la parte de herramienta cruda; normalmente renderiza
 * una tarjeta de actividad mientras el estado es input-available (sondea /api/jobs) y el
 * artefacto (iframe / svg) cuando es output-available.
 */
export interface ArtifactPartProps {
	part: {
		type: string;
		state: string;
		toolCallId: string;
		input?: unknown;
		output?: unknown;
		/** El pliegue del lado del planteamiento (ronda 17 del responsable): todos los argumentos de la
		 * llamada a problem unidos a la parte de conclude por projectView: los
		 * datos del cajón de observabilidad. */
		problemInput?: unknown;
		/** La unión en la frontera de la vista para las tarjetas de conclude (ronda del responsable, 2026-10-05):
		 *  la modelSolution comprometida en el momento del PLANTEAMIENTO, plegada sobre la parte por
		 *  projectView: la revelación nunca se vuelve a redactar. */
		reveal?: unknown;
	};
}
