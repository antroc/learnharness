import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del repositorio (este fichero está en <root>/config.ts). */
export const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * LA frontera de la ubicación de los datos (el contrato de Electron,
 * 2026-09-17): LH_DATA_DIR reubica todo registro MUTABLE —sesiones de chat,
 * registros del grafo, la caché del modelo de embeddings— cuando está
 * definido. El armazón de escritorio lo apunta a userData para que no se
 * escriba nada dentro del paquete .app de solo lectura (la translocación de
 * macOS garantiza de todos modos que el paquete sea de solo lectura). Sin
 * definir (desarrollo web normal / trabajo en el repo) se resuelve al data/
 * del repo, byte a byte como antes. Los recursos de solo lectura (prompts)
 * se anclan a ROOT a propósito: van dentro del paquete de la app por diseño.
 */
// Las rutas mutables de tiempo de ejecución no son recursos del despliegue. Turbopack analiza cada
// llamada que produce una ruta por separado, así que las rutas derivadas necesitan su propia exclusión.
// ROOT/teacherPrompt siguen siendo rastreables: los recursos de solo lectura que se distribuyen sí cuentan.
const DATA_ROOT = process.env.LH_DATA_DIR
	? path.resolve(/* turbopackIgnore: true */ process.env.LH_DATA_DIR)
	: path.join(/* turbopackIgnore: true */ ROOT, "data");

export const PATHS = {
	root: ROOT,
	/** Prompt de sistema del profesor: las instrucciones del agente (src/agent/). */
	teacherPrompt: path.join(ROOT, "src", "agent", "system-prompt.md"),
	data: DATA_ROOT,
	/** Sesiones de chat (transcripciones UIMessage del AI SDK, un fichero JSON por chat). */
	chats: path.join(/* turbopackIgnore: true */ DATA_ROOT, "chats"),
	graph: path.join(/* turbopackIgnore: true */ DATA_ROOT, "graph"),
	/** Artefactos de depuración (activados por entorno): data/debug/provider-events/<chatId>.jsonl
	 * grabaciones del stream en bruto del proveedor (src/agent/provider-events.ts). */
	debug: path.join(/* turbopackIgnore: true */ DATA_ROOT, "debug"),
} as const;

// ─── Modelos ───────────────────────────────────────────────────────────────
// BYOK DE ARRIBA ABAJO (responsable, 2026-09-22): NO hay modelos por defecto
// de fábrica. Todo motor se resuelve a partir de las ranuras de modelo del usuario (sección
// models de settings.json: strong/cheap/vision) sobre las sustituciones por rol/ChatSettings,
// y una cadena que acaba vacía SE NIEGA honestamente (503 models_not_configured).
// .env se queda solo para los secretos (claves de API). Lo que queda aquí son HECHOS DE
// CONSTRUCCIÓN DEL MOTOR: la escala de niveles de razonamiento y el orden por defecto.

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Todos los roles de agente de la app. La pareja de conversación
 * (prober/teacher) resuelve chat.model → ranura strong; los roles en segundo
 * plano resuelven su propia sustitución → ranura del nivel (ROLE_SLOT de
 * core/settings-resolution.ts). */
export type ModelRole =
	| "prober"
	| "teacher"
	| "researcher"
	| "demoBuilder"
	| "visualMaker"
	| "pdfReader"
	| "extractor"
	| "auditor"
	| "sideQuestion";

/**
 * El almacén del grafo EN VIVO (src/store/graph.ts), propiedad del proceso
 * de extracción de la app. Formas de las líneas: src/core/contracts.ts. LAS
 * CADENAS SON LA VERDAD GUARDADA (responsable, 2026-09-30): las aristas son
 * una vista derivada, nunca se guardan.
 */
export const LEDGER_FILES = {
	nodes: path.join(/* turbopackIgnore: true */ PATHS.graph, "nodes.jsonl"),
	chains: path.join(/* turbopackIgnore: true */ PATHS.graph, "chains.jsonl"),
	sessions: path.join(/* turbopackIgnore: true */ PATHS.graph, "sessions.jsonl"),
	/** Cobertura de extracción por mensaje (CoverageEntry de contracts/graph.ts;
	 * el sustituto del punto de control para las extracciones de chats: las
	 * notas conservan sessions.jsonl, de fichero completo, tal como están). */
	coverage: path.join(/* turbopackIgnore: true */ PATHS.graph, "coverage.jsonl"),
} as const;

/**
 * Contabilidad de la importación de notas (NO es un registro de eventos):
 * un único mapa JSON, src-id → registro NotesSource (contracts/graph.ts):
 * la ruta del fichero + la hora de importación + el log de uso de la
 * ejecución. Se lee-modifica-escribe como un fichero de chat, no se añade
 * al final como los registros.
 */
export const SOURCES_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "sources.json");
/** Nombres de fuentes/colocación en carpetas solo de presentación; nunca la identidad de extracción. */
export const SOURCE_ORGANIZATION_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "source-organization.json");
/** El registro de disposición (se lee-modifica-escribe como sources.json):
 * nodeId → posiciones de reposo {x,y} del asentamiento incremental
 * (core/layout.ts). Lleva un sello updatedAt para la futura gestión de
 * conflictos con física en vivo. */
export const POSITIONS_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "positions.json");

/**
 * Ajustes de renderizado del grafo (los controles del panel de ajustes): un
 * pequeño blob JSON que se lee-modifica-escribe. Forma/saneador compartidos:
 * src/core/render-settings.ts.
 */
export const RENDER_SETTINGS_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "render-settings.json");

/** El fichero adjunto del SELLO DE FORMATO de la familia del grafo (oleada
 * de versionado de esquemas, 2026-10-10): una versión para toda la familia:
 * los cuatro registros JSONL, sources.json y render-settings.json. v1
 * PEREZOSA: ausente = v1; la primera escritura de la familia del grafo lo
 * crea. positions.json es RECONSTRUIBLE y va sin versionar a propósito
 * (decisión del responsable). */
export const GRAPH_FORMAT_FILE = path.join(/* turbopackIgnore: true */ PATHS.graph, "format.json");

/**
 * EL REGISTRO DE AJUSTES DEL USUARIO (oleada de almacenamiento de ajustes,
 * 2026-09-19): un único blob JSON versionado y con forma DELTA en la
 * frontera del directorio de datos, que guarda todas las preferencias no
 * secretas del producto: general, agent (sustituciones de
 * modelo/razonamiento en segundo plano + conmutadores de herramientas +
 * interruptores de sustitución de prompts), appearance, graph. Solo
 * elecciones explícitas del usuario: las claves AUSENTES se resuelven a los
 * valores de fábrica compilados en src/core/settings.ts (FACTORY_SETTINGS),
 * así que una actualización del software que añade un control (herramienta
 * nueva, rol nuevo, campo de apariencia nuevo) no necesita migración: los
 * registros antiguos simplemente no tienen las claves nuevas. El campo de
 * versión es un contador PRIVADO del esquema solo para cambios de forma
 * incompatibles (campo renombrado/significado cambiado), sin relación con la
 * versión de la app. Los secretos (claves de API, tokens de inicio de
 * sesión) NUNCA viven aquí: ese papel lo tienen auth.json / .env.local. (La
 * sección de ajustes por defecto `chat` murió con los modelos por sesión,
 * responsable 2026-09-28: las sesiones son dueñas de su modelo desde su
 * nacimiento, sellado a partir de la ranura strong.)
 */
export const SETTINGS_FILE = path.join(/* turbopackIgnore: true */ DATA_ROOT, "settings.json");

/**
 * Ficheros de sustitución de prompts del usuario (oleada de almacenamiento
 * de ajustes, 2026-09-19): las sustituciones del prompt de sistema por
 * segmento, reflejando la disposición de la FUENTE (src/agent/prompts/): la
 * base compartida como prompts/system-prompt.md y los fragmentos como
 * prompts/teacher/<fichero> / prompts/prober/<fichero>. La sola PRESENCIA
 * del fichero no es la sustitución: el mapa agent.prompts de settings.json
 * (segmentPath → boolean) es el interruptor explícito, así que un usuario
 * puede tener un fichero personalizado en disco y ejecutar el valor por
 * defecto de la fuente para comparar. La lista de segmentos se deriva
 * SIEMPRE de la fuente en tiempo de ejecución (el cargador de
 * src/store/prompt-overrides.ts): las actualizaciones del código que
 * añaden, quitan o reordenan fragmentos se adaptan solas; una sustitución
 * asociada a un segmento desaparecido deja de componerse pero se queda en
 * disco.
 */
export const PROMPTS_OVERRIDE_DIR = path.join(/* turbopackIgnore: true */ DATA_ROOT, "prompts");

/**
 * Temas personalizados importados (oleada de temas, 2026-11-04): un
 * `<id>.json` por tema (la forma ThemeFile de core/themes.ts), escrito por
 * POST /api/themes y listado junto a los predefinidos integrados. El
 * registro de ajustes nombra el activo por su id (appearance.theme).
 */
export const THEMES_DIR = path.join(/* turbopackIgnore: true */ DATA_ROOT, "themes");

/**
 * EL ALMACÉN DE AUTENTICACIÓN/CLAVES (oleada de claves de autenticación,
 * 2026-09-19): claves de proveedor BYOK en un mapa JSON plano {VAR: valor},
 * el MISMO fichero que la app de Electron siempre ha editado a mano
 * (decisión del responsable: opción A, sin migración). main.cjs de
 * escritorio pasa LH_AUTH_FILE apuntando a userData/auth.json (modo 0600);
 * en desarrollo (sin Electron) el valor por defecto es el auth.json de la
 * raíz del repo (ignorado por git, el mismo patrón que .env.local; un
 * worktree puede enlazarlo simbólicamente a la copia maestra). El SERVIDOR
 * lee/escribe este fichero directamente en el momento de la llamada (sin
 * reiniciar para cambiar una clave); al arrancar refleja los valores en
 * process.env con precedencia de RELLENO DE HUECOS: las variables de entorno
 * reales (incluido .env.local en desarrollo) siempre ganan
 * (src/server/keys.ts). Las ediciones a mano siguen funcionando: el fichero
 * se vuelve a leer del disco en cada acceso a la API. Los secretos NUNCA van
 * en settings.json; este fichero tiene ese papel, junto a .env.local.
 */
export const AUTH_FILE = process.env.LH_AUTH_FILE
	? path.resolve(/* turbopackIgnore: true */ process.env.LH_AUTH_FILE)
	: path.join(/* turbopackIgnore: true */ ROOT, "auth.json");
