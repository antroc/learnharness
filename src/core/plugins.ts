/** API de plugins v1. Contratos seguros para el navegador; el código en tiempo de ejecución
 * es código local de confianza. El SDK portable es solo de tipos: en tiempo de ejecución usa
 * los objetos de contexto proporcionados, no importaciones de estos auxiliares o constantes
 * del código fuente ni de módulos privados del host. */
import type { AssistantMessage, AssistantMessageEvent, Context, SimpleStreamOptions, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import type { ChatRecord, ChatListItem } from "./contracts/chat.ts";
import type { ModelCatalogResponse } from "./contracts/models.ts";
import type { GraphSnapshot, GraphNode, GraphChain, SessionCheckpoint, CoverageEntry, NotesSource, Position } from "./contracts.ts";
export type { ChatRecord, ChatListItem } from "./contracts/chat.ts";
export type { ModelCatalogResponse } from "./contracts/models.ts";
export type { GraphSnapshot, GraphNode, GraphChain, SessionCheckpoint, CoverageEntry, NotesSource, Position } from "./contracts.ts";
import type { ServerEvent } from "./events.ts";
import type { PluginAgentService, PluginCallPurpose, PluginModelSpec } from "./plugin-agents.ts";
import type { PluginBackgroundMeta, PluginBackgroundTool, PluginWorkerService } from "./plugin-workers.ts";
export type * from "./plugin-workers.ts";
import type { PluginQuestionRenderer, PluginQuestionTypeDefinition } from "./plugin-questions.ts";
export type * from "./plugin-questions.ts";
import type { PluginProblemTypeDefinition, PluginProblemRenderer } from "./plugin-problems.ts";
export type * from "./plugin-problems.ts";
import type { PluginSubmissionInterceptor } from "./plugin-submissions.ts";
export type * from "./plugin-submissions.ts";

export const PLUGIN_API_VERSION = 1 as const;
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Libera los recursos de activación o montaje; el host acepta limpieza síncrona o asíncrona. */
export type PluginCleanup = () => void | Promise<void>;
export interface PluginManifest {
	apiVersion: 1;
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description?: string;
	author?: string;
	/** Módulo ES de navegador empaquetado. Las rutas de entrada no deben apuntar a los datos
	 * del plugin. */
	main?: string;
	/** Módulo CommonJS de Node empaquetado. Los módulos integrados de Node están disponibles. */
	backend?: string;
	styles?: string;
}
export interface PluginInfo {
	id: string;
	/** Procedencia del paquete propiedad del host; nunca se lee de un manifiesto de plugin. */
	origin: "core" | "community";
	manifest?: PluginManifest;
	enabled: boolean;
	status: "disabled" | "active" | "error";
	error?: string;
	/** Solo cambia tras reiniciar el servidor, no simplemente al activar o desactivar. */
	revision: string;
}
export interface PluginNotification {
	pluginId: string;
	topic: string;
	data?: unknown;
}
export interface PluginGraphFileData {
	"nodes.jsonl": GraphNode[];
	"chains.jsonl": GraphChain[];
	"sessions.jsonl": SessionCheckpoint[];
	"coverage.jsonl": CoverageEntry[];
	"sources.json": NotesSource[];
	"positions.json": Record<string, Position>;
	/** Metadatos versionados en bruto en lugar de un segundo esquema específico del plugin. */
	"render-settings.json": unknown;
	"format.json": unknown;
}
/** Acceso nuevo de solo lectura a los registros nativos de aprendizaje guardados. Varias
 * lecturas no forman una transacción entre ficheros; guarda los datos derivados del plugin
 * en almacenamiento propiedad del plugin. */
export interface PluginLearningData {
	/** Raíz de los datos de aprendizaje, no un directorio de credenciales ni un permiso para
	 * escribir ficheros del núcleo. */
	readonly directory: string;
	/** Lista los resúmenes de las sesiones guardadas con los indicadores actuales
	 * busy/compacting; sin trabajo de modelo. */
	listSessions(): ChatListItem[];
	/** Lee una sesión nativa guardada completa, o null si no existe. Los IDs no válidos
	 * lanzan una excepción. Las transcripciones conservan respuestas y razonamientos del
	 * alumno que el grafo no representa. */
	getSession(id: string): ChatRecord | null;
	/** Lee la proyección actual del grafo y los registros en bruto, sin un segundo lenguaje
	 * de consulta. No es una transcripción completa de las respuestas del alumno. */
	graph(): GraphSnapshot;
	/** Lee el JSON de libros y metadatos del grafo usando la interpretación actual de los
	 * ficheros por parte del host. Se aplican las comprobaciones de validación y versión
	 * del host; los nombres de fichero desconocidos lanzan una excepción. */
	readGraphFile<K extends keyof PluginGraphFileData>(name: K): PluginGraphFileData[K];
}
/** El host es propietario de las credenciales y del transporte; los plugins solo configuran
 * la generación. */
export type PluginInferenceOptions = Pick<SimpleStreamOptions,
	| "temperature" | "maxTokens" | "cacheRetention" | "reasoning" | "thinkingBudgets" | "toolChoice"
	| "timeoutMs" | "maxRetries" | "maxRetryDelayMs" | "metadata"
>;
export interface PluginInferenceRequest {
	model: PluginModelSpec;
	context: Context;
	/** Trabajo iniciado por el usuario frente a trabajo automático o en segundo plano; se
	 * aplica la política de conexión existente. */
	purpose: PluginCallPurpose;
	options?: PluginInferenceOptions;
	signal?: AbortSignal;
}
/** Llamadas al modelo autenticadas por el host, que pueden tener coste. Se aplican un modelo
 * y un propósito explícitos y la política existente de consentimiento y cuota; no hay
 * alternativa silenciosa de modelo ni de clave de API. El uso se registra en los datos del
 * plugin, no en un chat del núcleo. La cancelación de la activación acota las llamadas. */
export interface PluginInference {
	/** Devuelve el último catálogo conocido del host, independiente, sin refrescar cuentas
	 * ni elegir un modelo. Se rechaza si no está disponible o si la activación se ha
	 * cancelado. */
	catalog(): Promise<ModelCatalogResponse>;
	/** Emite en *streaming* los eventos nativos del asistente para una petición, no un bucle
	 * de herramientas gestionado. Los fallos de preparación o validación lanzan una
	 * excepción durante la iteración; los estados de transporte, error o cancelación pueden
	 * llegar como eventos nativos de error terminales. Respeta request.signal e inspecciona
	 * el mensaje terminal en lugar de tomar el texto parcial como un éxito. */
	stream(request: PluginInferenceRequest): AsyncIterable<AssistantMessageEvent>;
	/** Consume una petición y devuelve su mensaje nativo terminal del asistente, incluido un
	 * stopReason de error o aborted. Los fallos de preparación o validación pueden producir
	 * un rechazo; un mensaje resuelto no es necesariamente un éxito. Se aplica la
	 * cancelación del llamador o de la activación. */
	complete(request: PluginInferenceRequest): Promise<AssistantMessage>;
}
export type PluginAgentKind = "prober" | "teacher" | "practice";
/** Las contribuciones a los agentes son aditivas y se aplican a los tipos de agente
 * seleccionados explícitamente. */
export interface PluginInstructions {
	agents: PluginAgentKind[];
	text: string;
}
export interface PluginToolContext {
	readonly chatId: string;
	readonly agent: PluginAgentKind;
}
/** Un conjunto nuevo de herramientas nativas de Pi por turno de conversación; sin
 * importaciones privadas de la app. */
export interface PluginTools {
	agents: PluginAgentKind[];
	/** Crea herramientas nativas nuevas para el contexto congelado de chat y agente del
	 * turno correspondiente. Los errores de factoría o de admisión omiten la contribución
	 * de este plugin en ese turno en lugar de sustituir las herramientas del host. Respeta
	 * la señal de cancelación de cada ejecución de herramienta. */
	create(context: PluginToolContext): AgentTool<any>[];
}
/** Ámbito de activación del backend, una vez por plugin activado y por servidor, no por
 * ventana. El código Node de confianza debe cooperar con la cancelación; no hay aislamiento
 * forzoso de procesos. */
export interface PluginBackendContext {
	readonly manifest: PluginManifest;
	/** Directorio absoluto del código: core-plugins/<id> de la app o plugins/<id>/dist de la
	 * comunidad. */
	readonly directory: string;
	/** Registros escribibles: core-plugin-data/<id> o plugins/<id>/data de la comunidad. */
	readonly dataDirectory: string;
	/** Se cancela cuando termina esta activación del backend. Vuelve a comprobarlo tras cada
	 * await antes de producir efectos secundarios propios del plugin; la cancelación no
	 * detiene a la fuerza código arbitrario. */
	readonly signal: AbortSignal;
	/** Registra la limpieza de recursos para la desactivación; también se admite como valor
	 * de retorno de activate. Una limpieza registrada tras la caducidad se invoca
	 * igualmente. */
	cleanup(dispose: PluginCleanup): void;
	/** Registros nativos de aprendizaje de solo lectura; no es una API programable de
	 * escritura de datos del núcleo. */
	learning: PluginLearningData;
	/** Peticiones en bruto al modelo autenticadas por el host, con ámbito en la activación;
	 * pueden tener coste. */
	inference: PluginInference;
	/** Conversaciones persistentes de plugins, no sesiones nativas de data/chats. */
	agents: PluginAgentService;
	/** Tareas acotadas duraderas, independientes de las vistas del frontend; pueden tener
	 * coste de modelo. */
	workers: PluginWorkerService;
	/** Devuelve una herramienta nativa de Pi vinculada a este turno de conversación.
	 * Confirma de inmediato la aceptación del worker y entrega el resultado terminal más
	 * tarde mediante la gestión nativa de tareas y reorientaciones. La identidad derivada
	 * por el host fuerza el propósito background; el resultado de la tarea y su formateo o
	 * entrega posteriores son cosas separadas. */
	createBackgroundTool<T extends TSchema>(context: PluginToolContext, definition: PluginBackgroundTool<T>): AgentTool<T>;
	/** Añade texto al prompt de sistema para los tipos de agente nativo seleccionados, sin
	 * sustituir los prompts del host. Las contribuciones no válidas lanzan una excepción;
	 * anular el registro solo afecta a los turnos futuros. */
	registerInstructions(contribution: PluginInstructions): () => void;
	/** Añade factorías de herramientas nuevas para los tipos de agente nativo seleccionados,
	 * conservando las integradas. Un registro no válido lanza una excepción; los errores de
	 * factoría o de colisión de cada turno omiten la contribución de este plugin. La
	 * función de anulación devuelta afecta a los turnos futuros. */
	registerTools(contribution: PluginTools): () => void;
	/** Registra un tipo en el ciclo de vida nativo de sondeo y enseñanza propiedad del host,
	 * con validación y calificación opcionales por parte del plugin. Las definiciones no
	 * válidas o duplicadas lanzan una excepción; la función de anulación devuelta elimina
	 * la disponibilidad y cancela el ámbito de esta definición. */
	registerQuestionType<Q extends TSchema, A extends TSchema>(definition: PluginQuestionTypeDefinition<Q, A>): () => void;
	/** Registra planteamientos de práctica alternativos que comparten el ciclo de vida
	 * nativo de problema activo y conclusión. Las definiciones no válidas o duplicadas
	 * lanzan una excepción; la función de anulación devuelta elimina la disponibilidad y
	 * cancela el ámbito de esta definición, no el historial guardado. */
	registerProblemType<Q extends TSchema, S extends TSchema>(definition: PluginProblemTypeDefinition<Q, S>): () => void;
	/** Registra una operación con nombre para el puente de llamadas del frontend de este
	 * plugin. Las entradas y los resultados deben ser compatibles con JSON; valida la
	 * entrada en el manejador. Los nombres no válidos o duplicados lanzan una excepción.
	 * Devuelve la función de anulación; no es una API HTTP arbitraria. */
	handle(name: string, handler: (input: unknown) => unknown | Promise<unknown>): () => void;
	/** Avisos en vivo de la app y notificaciones de ámbito de plugin, no un registro
	 * duradero de eventos. */
	events: {
		/** Observa los eventos admitidos de la app hasta cancelar la suscripción o hasta la
		 * limpieza de la activación. Los fallos de los listeners quedan aislados. Vuelve a
		 * leer el estado cuando haga falta; turn-settled sigue a la persistencia del turno,
		 * no al final de la extracción asíncrona. */
		on(listener: (event: ServerEvent) => void): () => void;
		/** Notifica con datos JSON a los listeners del frontend de este plugin en las
		 * ventanas conectadas. Los temas no válidos lanzan una excepción mientras está
		 * activo; las activaciones caducadas no emiten nada. No se ofrece persistencia,
		 * reproducción ni acuse de la gestión en el frontend. */
		emit(topic: string, data?: unknown): void;
	};
}
export interface PluginBackendModule {
	/** Inicializa los registros y recursos de ámbito de servidor; opcionalmente devuelve una
	 * limpieza. Los fallos de activación marcan este plugin como erróneo. Los módulos
	 * siguen en caché, así que pon aquí los efectos secundarios de la activación y no en el
	 * nivel superior del módulo. */
	activate(context: PluginBackendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
}
export interface PluginView {
	id: string;
	name: string;
	/** Monta solo el cuerpo de la vista; el host es propietario del título, la barra
	 * superior y las acciones. Salir, sustituir o desactivar cancela esta señal de montaje.
	 * Devuelve una limpieza síncrona o asíncrona y acota la interfaz hija a esta señal, no
	 * solo a la activación, que dura más. */
	mount(container: HTMLElement, signal: AbortSignal): void | PluginCleanup | Promise<void | PluginCleanup>;
}
export type * from "./plugin-view-context.ts";
export type { PluginActionShortcut, PluginShortcutViewScope } from "./plugin-shortcuts.ts";
export type PluginPageActionContext =
	| { surface: "session"; sessionId: string; kind: "teaching" | "practice"; surfaceTarget: import("./plugin-ui.ts").PluginSurfaceTarget;
		/** Vista independiente de la sesión completa, capturada una vez antes de invocar la
		 * acción. */
		readonly view: import("./plugin-view-context.ts").PluginSessionViewContext }
	| { surface: "plugin-view"; pluginId: string; viewId: string }
	| { surface: "app"; pathname: string };
export type PluginActionContext =
	| ({ placement: "top-bar" } & Exclude<PluginPageActionContext, { surface: "app" }>)
	| ({ placement: "keyboard" } & PluginPageActionContext)
	| { placement: "sidebar"; surface: "sidebar" }
	| { placement: "graph"; surface: "graph" };
export interface PluginAction {
	id: string;
	name: string;
	/** Marcado SVG de confianza del plugin. El host sigue representando el botón que lo rodea. */
	icon?: string;
	/** Activación voluntaria sin crear elementos de interfaz. El ámbito y el valor por
	 * defecto se capturan al registrar. */
	readonly shortcut?: import("./plugin-shortcuts.ts").PluginActionShortcut;
	disabled?: boolean | ((context: PluginActionContext) => boolean);
	/** Se ejecuta para la colocación y la página de la invocación real. El host impide
	 * invocarla de nuevo mientras está ocupada e informa de los errores lanzados o
	 * rechazados. Los datos de la vista de la sesión se capturan una vez antes de la
	 * invocación y siguen siendo independientes a través de los await. */
	run(context: PluginActionContext): void | Promise<void>;
}
/** Registrar por sí solo nunca crea elementos de interfaz. Cada colocación es explícita. */
export type PluginActionPlacement =
	| { id: string; actionId: string; location: "sidebar" | "graph" }
	| { id: string; actionId: string; location: "top-bar"; sessions?: ("teaching" | "practice")[]; views?: string[] };
export type PluginSettingsRegistration = PluginView["mount"] | import("./plugin-ui.ts").PluginSettingsSchema;
export interface PluginCodeBlockProps {
	language: string;
	source: string;
	meta: string;
	incomplete: boolean;
	/** Se cancela al sustituir, desmontar o desactivar el plugin. */
	signal: AbortSignal;
}
export interface PluginCodeBlockRenderer {
	language: string;
	/** Representa este bloque cercado en el contenedor indicado; devuelve una limpieza
	 * síncrona o asíncrona. Sustituir, anular el registro o desactivar cancela
	 * block.signal. Los renderizadores que fallan o faltan recurren al código fuente
	 * legible; mountMarkdown, que es solo del host, no usa este hook. */
	mount(container: HTMLElement, block: PluginCodeBlockProps): void | PluginCleanup | Promise<void | PluginCleanup>;
}
export interface PluginToolRenderProps {
	toolName: string;
	toolCallId: string;
	input: unknown;
	state: "input-streaming" | "input-available" | "output-available" | "output-error";
	/** Detalles del resultado nativo, que también usan las tarjetas de herramientas
	 * existentes de la app. */
	output?: unknown;
	errorText?: string;
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
	/** Presente en la tarjeta separada del resultado posterior; la llamada original conserva
	 * su acuse. */
	background?: PluginBackgroundMeta;
	signal: AbortSignal;
}
export interface PluginToolRenderer {
	toolName: string;
	/** Los resultados posteriores de workers se pliegan por defecto; los resultados
	 * enriquecidos pueden optar por una tarjeta o por un contenedor sin marco. */
	backgroundPresentation?: "collapsed" | "card" | "plain";
	/** Representa el estado de entrada y resultado de una herramienta nativa; devuelve una
	 * limpieza síncrona o asíncrona. Sustituir, anular el registro o desactivar cancela
	 * tool.signal; los errores recurren a resultados legibles. La presentación por sí sola
	 * no crea entrada pendiente del alumno ni ejecuta ninguna herramienta. */
	mount(container: HTMLElement, tool: PluginToolRenderProps): void | PluginCleanup | Promise<void | PluginCleanup>;
}
/** Ámbito de activación del frontend, una vez por plugin activado y por ventana. Los
 * registros, las suscripciones y la interfaz caducan con esta activación; el trabajo del
 * backend es propiedad del servidor. */
export interface PluginFrontendContext {
	readonly manifest: PluginManifest;
	/** Se cancela cuando termina la activación de esta ventana. Usa señales más cortas por
	 * montaje para los widgets de las vistas y el trabajo asíncrono cooperativo. */
	readonly signal: AbortSignal;
	/** Registra la limpieza síncrona o asíncrona de recursos para la desactivación; los
	 * registros tardíos se invocan igualmente. Una activación también puede devolver una
	 * función de limpieza. */
	cleanup(dispose: PluginCleanup): void;
	/** Registra una vista de cuerpo propiedad del plugin con el marco de la interfaz del
	 * host. Los IDs no válidos o duplicados lanzan una excepción; la función de anulación
	 * devuelta elimina la vista sin borrar los datos del plugin. */
	registerView(view: PluginView): () => void;
	/** Registra una acción invocable y un atajo opcional, pero sin colocar ningún botón. Los
	 * registros no válidos o duplicados lanzan una excepción. Devuelve la función de
	 * anulación; el ámbito y el valor por defecto del atajo se capturan aquí y
	 * refreshActions no los cambia. */
	registerAction(action: PluginAction): () => void;
	/** Coloca una acción ya registrada en un elemento explícito de la interfaz del host. Los
	 * destinos no válidos o los IDs de colocación duplicados lanzan una excepción. Devuelve
	 * una función de anulación solo para esta colocación. */
	placeAction(placement: PluginActionPlacement): () => void;
	/** Notifica explícitamente al host cuando cambia el estado dinámico de activación de una
	 * acción. */
	refreshActions(): void;
	/** Registra la preparación de la entrada del alumno con la identidad de este plugin. Las
	 * definiciones no válidas o duplicadas lanzan una excepción; la función de anulación
	 * devuelta cancela su ámbito capturado. Las reglas de aceptación, reintento y
	 * conservación de borradores siguen siendo propiedad del host. */
	registerSubmissionInterceptor(definition: PluginSubmissionInterceptor): () => void;
	/** Notifica al host cuando cambia la entrada de envío pendiente propiedad del plugin. */
	refreshSubmissions(): void;
	/** Registra un montaje diferido del cuerpo de ajustes; devuelve la función de anulación.
	 * Solo se permite un registro de ajustes por activación. La señal de montaje acota su
	 * interfaz hija. */
	registerSettings(mount: PluginView["mount"]): () => void;
	/** Registra filas de ajustes controladas; devuelve un manejador de actualización
	 * superficial y liberación. Los esquemas no válidos o los registros de ajustes
	 * duplicados lanzan una excepción. El plugin es propietario de la persistencia y debe
	 * publicar los valores aceptados tras guardarlos. */
	registerSettings(schema: import("./plugin-ui.ts").PluginSettingsSchema): import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
	/** Registra o bien un montaje personalizado diferido (función de anulación) o bien un
	 * esquema controlado (manejador de widget); ninguna de las dos formas carga ni guarda
	 * los ajustes del plugin automáticamente. */
	registerSettings(settings: PluginSettingsRegistration): (() => void) | import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
	/** Widgets y overlays controlados del host; acceder a un host de interfaz no disponible
	 * lanza una excepción. */
	readonly ui: import("./plugin-ui.ts").PluginUi;
	/** Registra un renderizador para un lenguaje de bloque cercado; las reclamaciones
	 * reservadas o duplicadas lanzan una excepción. Devuelve la función de anulación, que
	 * cancela los montajes existentes del renderizador además de eliminar el hook. */
	registerCodeBlock(renderer: PluginCodeBlockRenderer): () => void;
	/** Registra la presentación nativa de resultados de herramientas; las reclamaciones
	 * reservadas o duplicadas lanzan una excepción. Devuelve la función de anulación, que
	 * cancela los montajes existentes. No registra ninguna herramienta. */
	registerToolRenderer(renderer: PluginToolRenderer): () => void;
	/** Registra huecos con ámbito de propietario dentro de la tarjeta de pregunta del host.
	 * Las versiones del contrato deben coincidir con las de las preguntas guardadas y en
	 * vivo; los registros no válidos o duplicados lanzan una excepción. Devuelve la función
	 * de anulación; la identidad y la aceptación de preguntas del host siguen siendo
	 * autoritativas. */
	registerQuestionRenderer(renderer: PluginQuestionRenderer): () => void;
	/** Registra la presentación de envíos de práctica con ámbito de propietario para las
	 * versiones de contrato admitidas. Los registros no válidos o duplicados lanzan una
	 * excepción. Devuelve la función de anulación; representar un problema no lo plantea,
	 * procesa ni concluye. */
	registerProblemRenderer(renderer: PluginProblemRenderer): () => void;
	/** Invoca la operación de backend con nombre de este plugin con una entrada compatible
	 * con JSON y resuelve su resultado. Se rechaza si fallan la serialización, el
	 * transporte, el backend o la activación. T es una anotación del llamador, no una
	 * validación en tiempo de ejecución; no se expone ninguna señal del llamador ni acceso
	 * HTTP arbitrario. Desactivar el plugin acota la petición del frontend. */
	call<T = unknown>(operation: string, input?: unknown): Promise<T>;
	/** Conversión pura en memoria de PDF/UTF-8; sin efectos secundarios de aprendizaje,
	 * modelo ni almacenamiento. Tiene ámbito automático en la activación; la cancelación
	 * por el llamador es opcional y cooperativa. */
	readonly documents: {
		/** Convierte un File del navegador a Markdown más avisos sin guardarlo. La firma o
		 * el sufijo de PDF selecciona la conversión de PDF (sin OCR); si no, UTF-8
		 * estricto. Una entrada ocupada, no válida, vacía o por encima del límite se
		 * rechaza con Error, nunca con un éxito truncado. La cancelación por el llamador
		 * conserva signal.reason mientras la activación está viva; la cancelación es
		 * cooperativa, no un plazo de ejecución estricto. */
		toMarkdown(file: File, options?: { signal?: AbortSignal }): Promise<{ name: string; markdown: string; notices: string[] }>;
	};
	/** Observa las notificaciones solo en vivo de este plugin; devuelve la función para
	 * cancelar la suscripción y caduca con la activación. Vuelve a leer el estado al
	 * resincronizar; no se implica ninguna reproducción duradera. */
	onNotification(listener: (event: PluginNotification) => void): () => void;
	/** Observa los eventos en vivo admitidos de la app, excluidas las notificaciones de
	 * mensajes de plugins. Devuelve la función para cancelar la suscripción; la caducidad
	 * de la activación también termina la entrega. Los eventos son avisos, no una
	 * reproducción duradera ni el final de la extracción asíncrona. */
	onAppEvent(listener: (event: ServerEvent) => void): () => void;
	/** Vuelve a leer el estado autoritativo tras resincronizar la conexión; los eventos
	 * perdidos no se reproducen. Devuelve la función para cancelar la suscripción y caduca
	 * con esta activación. */
	onResync(listener: () => void): () => void;
	/** Navegación del host en esta ventana; openView/openSettings apuntan a este plugin. Los
	 * métodos de navegación son inertes tras caducar la activación y no esperan a los
	 * montajes. */
	app: {
		/** Lee el pathname actual del host, no una instantánea capturada de la página de
		 * invocación. */
		pathname(): string;
		/** Navega a una sesión nativa por ID; no crea ni ejecuta ninguna sesión. */
		openSession(id: string): void;
		/** Navega a la página de inicio del host. */
		openHome(): void;
		/** Navega al ID de vista registrado de este plugin, no a la vista de otro plugin. */
		openView(id: string): void;
		/** Abre la página de Ajustes propia de este plugin, no la gestión de paquetes. */
		openSettings(): void;
	};
}
export interface PluginFrontendModule {
	/** Inicializa los registros y recursos de ámbito de ventana; opcionalmente devuelve una
	 * limpieza. Una activación que lanza una excepción o se rechaza desmonta esta
	 * generación e informa de un error. El código del módulo sigue en caché; pon aquí los
	 * efectos secundarios, no en el nivel superior del módulo. */
	activate(context: PluginFrontendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
}

/** Nada de coaccionar con laxitud manifiestos mal formados ni de ejecutar paquetes incompatibles. */
export function parsePluginManifest(value: unknown, folder: string, appVersion: string): PluginManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest.json must be an object");
	const m = value as Record<string, unknown>;
	if (!PLUGIN_ID_PATTERN.test(folder) || m.id !== folder) throw new Error("Plugin id must match its lowercase-hyphen folder name");
	if (m.apiVersion !== PLUGIN_API_VERSION) throw new Error("Unsupported plugin apiVersion (expected 1)");
	for (const key of ["name", "version", "minAppVersion"] as const) {
		if (typeof m[key] !== "string" || !m[key].trim()) throw new Error(`Manifest ${key} is required`);
	}
	const version = (s: unknown): number[] => {
		if (typeof s !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s)) throw new Error("Versions must have three numeric components (x.y.z)");
		return s.split(".").map(Number);
	};
	version(m.version);
	const required = version(m.minAppVersion), actual = version(appVersion);
	for (let i = 0; i < 3; i++) {
		if (actual[i]! > required[i]!) break;
		if (actual[i]! < required[i]!) throw new Error(`Requires LearnHarness ${m.minAppVersion} or newer`);
	}
	for (const key of ["description", "author"] as const) {
		if (m[key] !== undefined && typeof m[key] !== "string") throw new Error(`Manifest ${key} must be a string`);
	}
	for (const [key, ext] of [["main", ".js"], ["backend", ".cjs"], ["styles", ".css"]] as const) {
		if (m[key] !== undefined && (typeof m[key] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(m[key]) || !m[key].endsWith(ext))) throw new Error(`Manifest ${key} must name a root ${ext} file`);
	}
	if (!m.main && !m.backend) throw new Error("A plugin needs a main or backend entry");
	if (m.styles && !m.main) throw new Error("styles requires a frontend main entry");
	return { apiVersion: 1, id: folder, name: m.name as string, version: m.version as string, minAppVersion: m.minAppVersion as string,
		...(m.description !== undefined ? { description: m.description as string } : {}), ...(m.author !== undefined ? { author: m.author as string } : {}),
		...(m.main ? { main: m.main as string } : {}), ...(m.backend ? { backend: m.backend as string } : {}), ...(m.styles ? { styles: m.styles as string } : {}) };
}
