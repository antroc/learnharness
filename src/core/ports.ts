/**
 * Puertos de almacenamiento (las fronteras hexagonales — visión §1 "el
 * almacenamiento sigue siendo intercambiable").
 *
 * Un puerto por ENTIDAD, con operaciones de dominio; nunca una interfaz
 * genérica clave/valor. El núcleo y la capa de servicios que gira a su
 * alrededor programan solo contra estos tipos; los adaptadores concretos
 * viven en src/store/ (JSON/JSONL en el sistema de ficheros hoy, SQLite
 * como sustituto directo más adelante) y se conectan exactamente una vez, en
 * la raíz de composición (src/server/stores.ts). Las dependencias van en un
 * solo sentido: los adaptadores pueden importar el núcleo; el núcleo NUNCA
 * importa un adaptador.
 */

import type { LhMessage } from "./native-messages.ts";
import type { PluginAgentRecord } from "./plugin-agents.ts";
import type { PluginTaskRecord } from "./plugin-workers.ts";
import type {
	ChatRecord,
	ImageSnapshot,
	ChatSettings,
	ChatSummary,
	GraphChain,
	GraphNode,
	JobKind,
	JobRecord,
	PluginJobMetadata,
	ExtractionRunUsage,
	PlanTree,
	Position,
	CoverageEntry,
	SessionCheckpoint,
	SideChatThread,
	TurnUsage,
	NotesSource,
} from "./contracts.ts";
import type { UserSettings } from "./settings.ts";
import type { Theme, ThemeFile } from "./themes.ts";

// ─── Sesiones de plugins — datos propiedad del plugin, separados de los chats del núcleo ───

/** Un solo escritor por directorio de plugin. Los reemplazos atómicos fallidos deben lanzar una excepción. */
export interface PluginAgentRecordStore {
	list(): PluginAgentRecord[];
	get(id: string): PluginAgentRecord | null;
	save(record: PluginAgentRecord): void;
}

/** Un solo escritor por directorio de tareas del plugin; los resultados aceptados exigen un guardado atómico. */
export interface PluginTaskRecordStore {
	list(): PluginTaskRecord[];
	get(id: string): PluginTaskRecord | null;
	save(record: PluginTaskRecord): void;
}

// ─── ChatStore — el hogar del registro de sesión (data/chats) ───────────────────

export interface ChatStore {
	/** Crea un registro de sesión (se persiste de inmediato). */
	/** Crea un registro de sesión; el tipo "practice" marca una sesión de
	 * práctica (ausente = enseñanza, el valor por defecto). */
	createChat(title: string, kind?: "practice"): ChatRecord;
	/** El registro completo, o null si el id es desconocido o el fichero está corrupto. */
	getChat(id: string): ChatRecord | null;
	/** Todas las sesiones, de actividad más reciente a más antigua (la vista de lista de la barra lateral). */
	listChats(): ChatSummary[];
	/** Persiste la lista completa de mensajes nativos (el registro ES el estado
	 * del agente — oleada B, aprobada por el responsable el 2026-09-26). */
	saveMessages(id: string, messages: LhMessage[]): void;
	/** Guarda una imagen procesada una sola vez, sin cambiar la actividad ni el orden de la conversación. */
	saveImageSnapshot(id: string, snapshotId: string, image: ImageSnapshot): void;
	/** Persiste el árbol del plan de la sesión (las herramientas del plan lo llaman en execute). */
	saveTree(id: string, tree: PlanTree): void;
	/** Añade una entrada de uso al registro de turnos (el canal del dinero,
	 * 2026-09): idempotente por id de turno — cada petición lleva el suyo, así
	 * que un turno persistido dos veces se añade una sola vez, mientras que los
	 * turnos de continuación (que comparten id de mensaje de respuesta) conservan
	 * cada uno su uso. */
	appendTurnUsage(id: string, entry: TurnUsage): void;
	/** Añade una entrada de uso de una ejecución de extracción — idempotente por startedAt. */
	appendExtractionUsage(id: string, entry: ExtractionRunUsage): void;
	/** Persiste los ajustes de modelo y razonamiento por chat (el control de modelo).
	 * Reemplazo completo: el selector envía el objeto de ajustes entero. */
	saveSettings(id: string, settings: ChatSettings): void;
	/** Renombra una sesión (el título editable con clic de la cabecera, 2026-09-17).
	 * Como saveSettings: renombrar NO es actividad de la conversación — updatedAt
	 * no se mueve, así que el orden de la barra lateral nunca se agita al renombrar. */
	renameChat(id: string, title: string): ChatRecord;
	/** Borra por completo el registro de la sesión (oleada 6 de borrado de sesiones,
	 * responsable, 2026-09-22). Devuelve false si el id es desconocido. La purga del
	 * registro del grafo y la limpieza de tareas son la coreografía del llamador
	 * (core/graph-deletion.ts + la ruta DELETE), no del almacén. */
	deleteChat(id: string): boolean;
	/** Lee, modifica y escribe los hilos de preguntas laterales del registro (hilos
	 * de aclaración en línea, 2026-11-02) en una sola sección síncrona — la misma
	 * disciplina por campo que los registros de uso, así nunca machaca los mensajes
	 * de un turno concurrente. Devuelve los hilos guardados, o null si el chat es
	 * desconocido (que se borre a mitad de respuesta no es un error). Silencioso:
	 * el servicio del hilo lateral anuncia sus propios cambios. No es actividad
	 * de la conversación — updatedAt no se mueve. */
	updateSideChats(id: string, update: (threads: SideChatThread[]) => SideChatThread[]): SideChatThread[] | null;
}

// ─── GraphStore — los registros de evidencia de solo adición (data/graph) ────────
// Las cadenas son la verdad almacenada (responsable, 2026-09-30): nodos + cadenas
// de razonamiento; las aristas son una vista DERIVADA (core/graph.ts) y nunca tocan
// esta frontera. Las lecturas devuelven las líneas en bruto en orden de adición; la
// fusión de aserciones de cadena por (premisas, conclusión) se DERIVA en core/graph.ts
// — el almacén nunca decide. El proceso de extracción es el único escritor; esta
// superficie de lectura se queda.

export interface GraphStore {
	/** Añade un GraphNode (los ids son únicos — no hace falta fusionar). */
	appendNode(node: GraphNode): void;
	/** Líneas de nodos en bruto, en orden de adición. */
	readNodes(): GraphNode[];

	/** Añade una ASERCIÓN de cadena (una segunda sesión que afirme las mismas
	 * (premisas, conclusión) añade otra línea; los lectores fusionan). */
	appendChain(assertion: GraphChain): void;
	readChains(): GraphChain[];

	/** Añade un punto de control de emisión. */
	appendCheckpoint(checkpoint: SessionCheckpoint): void;
	readCheckpoints(): SessionCheckpoint[];
	/** Cobertura de extracción a nivel de mensaje (vision-extraction-coverage.md):
	 * de solo adición; una línea por mensaje cubierto. El punto de control de la
	 * extracción del chat — lo "no cubierto" se deriva de aquí, nunca se rastrea. */
	appendCoverage(entry: CoverageEntry): void;
	readCoverage(): CoverageEntry[];

	/** Añade el uso de una ejecución de nombrado de clústeres (canal del dinero
	 * global del grafo) — idempotente por startedAt. */

	/** Inserta o actualiza un registro de fuente de apuntes importados
	 * (config.SOURCES_FILE — un mapa JSON, no un registro de adición; la
	 * actualización conserva el registro de uso existente). */
	upsertSource(source: NotesSource): void;
	/** Todos los registros de fuentes de apuntes, por id, sin importar el orden. */
	readSources(): NotesSource[];
	/** Elimina solo la contabilidad de la fuente importada; el servicio elimina antes los rastros del grafo. */
	deleteSources(ids: ReadonlySet<string>): number;
	/** Añade el uso de una ejecución a un registro de fuente — idempotente por
	 * startedAt, igual que ChatRecord.extractions. */
	appendSourceUsage(id: string, entry: ExtractionRunUsage): void;

	/** El registro de disposición (config.POSITIONS_FILE): nodeId → {x,y} de reposo.
	 * Lo ESCRIBE SOLO el asentamiento incremental tras una fusión (core/layout.ts
	 * settleGraphLayout) — de solo lectura para todo lo demás. */
	readPositions(): Record<string, Position>;
	/** Reemplaza el registro entero (el asentamiento es un cálculo sobre todo el grafo). */
	writePositions(positions: Record<string, Position>): void;

	/** LA FRONTERA DESTRUCTIVA (oleada 6 de borrado de sesiones, responsable,
	 * 2026-09-22 — la primera operación que no es de adición sobre estos
	 * registros): reemplaza de forma atómica el contenido completo de cualquier
	 * subconjunto de los seis registros reescribibles. Cada array proporcionado se
	 * escribe en un fichero temporal y se renombra sobre el registro (a prueba de
	 * caídas: una escritura a medias nunca reemplaza el original); las claves
	 * ausentes dejan su registro intacto. El cálculo puro está en
	 * core/graph-deletion.ts — el almacén solo hace atómico el reemplazo. */
	rewriteLedgers(next: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void;
}

/** Separado de los registros del grafo y de la identidad de las fuentes, para futuras vistas compartidas. */
export interface SourceOrganizationStore {
	read(): import("./source-organization.ts").SourceOrganization;
	write(state: import("./source-organization.ts").SourceOrganization): void;
}

// ─── JobStore — tareas de subagentes en segundo plano (data/jobs) ─────────────────

export interface CreateJobInit {
	kind: JobKind;
	chatId: string;
	toolCallId: string;
	/** Primera línea de actividad (por defecto, "starting"). */
	activity?: string;
	/** Vinculación con el worker del plugin propiedad del host, no un enrutado elegido por el modelo. */
	plugin?: PluginJobMetadata;
	/** Se guarda en la tarea antes de lanzar su worker. */
	input?: unknown;
}

/** Campos fusionables — la identidad (id, kind, chatId, toolCallId, createdAt) es inmutable. */
export type JobPatch = Partial<Omit<JobRecord, "id" | "kind" | "chatId" | "toolCallId" | "createdAt">>;

export interface JobStore {
	/** Crea una tarea en ejecución (indexada por toolCallId para deduplicar lanzamientos). */
	createJob(init: CreateJobInit): JobRecord;
	getJob(id: string): JobRecord | null;
	/** Fusiona un parche en el registro; null si el id es desconocido. */
	updateJob(id: string, patch: JobPatch): JobRecord | null;
	/** Todas las tareas de un chat, de actividad más reciente a más antigua. */
	listJobs(chatId: string): JobRecord[];
	/** La tarea que atiende una parte de herramienta dada, si la hay (deduplicación del hook de lanzamiento). */
	findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null;
	/** Borra todos los registros de tareas de un chat — en ejecución o terminadas
	 * (oleada 6 de borrado de sesiones). Devuelve cuántos ficheros se eliminaron.
	 * La ruta de borrado se niega mientras haya tareas en ejecución, así que cuando
	 * esto se dispara todos los registros están en estado terminal. */
	deleteJobsForChat(chatId: string): number;
}

// ─── SettingsStore — EL registro de ajustes del usuario (oleada de almacenamiento de ajustes, 2026-09-19) ──

/**
 * El único registro de todas las preferencias no secretas del producto
 * (UserSettings de core/settings.ts — semántica de deltas, ver la
 * documentación de ese módulo). El almacén reemplaza el REGISTRO entero; el
 * ámbito por sección es asunto de la banda del servidor (un solo proceso, sin
 * riesgo de clientes desactualizados del que defenderse en esta frontera). La
 * migración perezosa por versión de esquema ocurre dentro de readSettings,
 * nunca en los llamadores. (El plegado del antiguo default-settings.json murió
 * con la sección de chat — modelos por sesión, responsable, 2026-09-28.)
 */
export interface SettingsStore {
	/** El registro saneado, o null si aún no existe (primer arranque). */
	readSettings(): UserSettings | null;
	/** Persiste el registro (reemplazo completo). Los llamadores pasan un registro SANEADO. */
	writeSettings(settings: UserSettings): void;
}

// ─── ThemeStore — temas personalizados importados (oleada de temas, 2026-11-04) ──────────

/**
 * Temas personalizados como ficheros `<id>.json` bajo config.THEMES_DIR, uno
 * por tema importado (forma ThemeFile de core/themes.ts). El almacén persiste
 * lo que recibe; la validación y la elección del id son asunto de la ruta.
 * Los ficheros ilegibles o no válidos se omiten al listar, nunca lanzan.
 */
export interface ThemeStore {
	/** Todos los temas personalizados válidos del disco, ordenados por id. */
	listThemes(): Theme[];
	/** Un tema personalizado, o null si el fichero no existe o no es válido. */
	readTheme(id: string): Theme | null;
	/** Persiste un fichero de tema en `<id>.json` (crea el directorio). */
	writeTheme(id: string, theme: ThemeFile): void;
	/** Elimina `<id>.json`, si existe. */
	deleteTheme(id: string): void;
}

// ─── PromptOverrideStore — sustituciones del prompt del sistema por segmento (2026-09-19) ──

/**
 * Texto del usuario que sustituye UN segmento del prompt fuente (la base
 * compartida o un fragmento numerado), guardado en la frontera del directorio
 * de datos reflejando la estructura del código fuente
 * (config.PROMPTS_OVERRIDE_DIR). Que exista el fichero NO es la sustitución:
 * el interruptor agent.prompts del registro de ajustes es el encendido/apagado
 * explícito, así que un usuario puede conservar un fichero personalizado en
 * disco mientras usa el valor por defecto del código fuente. La LISTA de
 * segmentos se deriva siempre del código fuente en tiempo de ejecución — ver
 * el adaptador (src/store/prompt-overrides.ts) para las reglas del cargador.
 */
export interface PromptOverrideStore {
	/** Todas las rutas de sustitución que hay ahora en disco ("system-prompt.md",
	 * "teacher/20-teaching.md", ...), relativas en formato POSIX, ordenadas. */
	listOverrides(): string[];
	/** El texto de la sustitución, o null si la ruta no tiene fichero. */
	readOverride(segmentPath: string): string | null;
	/** Persiste el texto de sustitución de la ruta de un segmento (crea los directorios padre). */
	writeOverride(segmentPath: string, text: string): void;
	/** Elimina el fichero de sustitución, si existe (los interruptores no se tocan —
	 * un interruptor encendido sin fichero compone el valor por defecto del código
	 * fuente, inerte). */
	deleteOverride(segmentPath: string): void;
}

// ─── AuthStore — claves de proveedor BYOK (oleada de claves de autenticación, 2026-09-19) ────

/**
 * El antiguo mapa plano {VAR: valor} de auth.json (config.AUTH_FILE) — el
 * mismo fichero que la app de Electron siempre ha editado a mano, ahora
 * gestionado por el servidor como ciudadano de primera. Los valores son
 * cadenas opacas: validar su forma es asunto de la banda del servidor
 * (validateKeyShape de core/auth-keys.ts — el almacén persiste lo que recibe);
 * la precedencia del entorno también es asunto de la banda del servidor
 * (src/server/keys.ts). Las variables desconocidas viajan tal cual.
 */
export interface AuthStore {
	/** El mapa entero — fichero ausente o corrupto = {} ("aún no hay claves", el
	 * estado documentado del primer arranque). Nunca lanza. */
	authVars(): Record<string, string>;
	/** Fija una VAR (escritura atómica, siempre con modo 0600, el resto de variables se conservan). */
	setAuthVar(name: string, value: string): void;
	/** Elimina una VAR si existe (ausente = no hace nada, y sigue siendo un éxito silencioso). */
	deleteAuthVar(name: string): void;
}

