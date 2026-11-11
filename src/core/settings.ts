/**
 * La forma + el saneador del REGISTRO DE AJUSTES DEL USUARIO (oleada de
 * almacenamiento de ajustes, 2026-09-19): un registro versionado y con forma de
 * DELTA en la frontera del directorio de datos (config.SETTINGS_FILE) que contiene
 * todas las preferencias no secretas del producto.
 *
 * SEMÁNTICA DE DELTAS (decisión del responsable, 2026-09-19): el registro guarda
 * solo las elecciones EXPLÍCITAS del usuario — las claves AUSENTES se resuelven a
 * los valores de fábrica compilados en este módulo (FACTORY_SETTINGS). Los MODELOS
 * son la excepción (responsable, 2026-09-22 — BYOK hasta el fondo): no existen
 * fijaciones de fábrica, así que una clave de modelo ausente se resuelve a VACÍO y
 * las barreras por necesidad se niegan con honestidad. Por eso una actualización
 * que AÑADE un mando (herramienta nueva, rol nuevo, campo de apariencia nuevo) no
 * necesita migración: los registros antiguos simplemente no tienen las claves
 * nuevas. `version` es un contador PRIVADO del esquema solo para cambios de forma
 * INCOMPATIBLES (campo renombrado / significado cambiado) — no tiene nada que ver
 * con la versión de la app. Las migraciones viven en el adaptador
 * (src/store/settings.ts), no aquí.
 *
 * Contrato del saneador (con la misma disciplina que render-settings.ts): todo lo
 * que llega del disco o de la red pasa por sanitizeUserSettings antes de usarse —
 * nunca se confía en ello en bruto. Estricto con los campos conocidos, CONSERVA
 * tal cual las claves desconocidas (un registro más nuevo nunca debe destruirlo una
 * app más antigua al leerlo). Los valores conocidos no válidos se degradan con
 * suavidad: los números fuera de rango se ACOTAN y los campos con tipo erróneo o
 * no válidos se DESCARTAN (se resuelven al valor de fábrica); nunca lanza. La
 * política de acceso a ficheros es la excepción: una política mal formada se queda
 * restringida/vacía, nunca pasa al valor por defecto sin restricciones.
 *
 * Seguro para el navegador: solo lógica pura + tipos, sin importaciones de node.
 * La vista resuelta (totalmente concreta) vive en settings-resolution.ts.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CacheRetention } from "@earendil-works/pi-ai";
import { AUTH_PROVIDER_KEYS } from "./auth-keys.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import type { ModelRole } from "../../config.ts";
import type { ChatSettings } from "./contracts/chat.ts";
import { isSearchEngineId, type SearchEngineId } from "./search.ts";
import { isDictationLanguage, type DictationLanguage } from "./dictation.ts";
import { parseFileAccessSettings, type FileAccessSettings } from "./file-access.ts";
import { COLOR_OVERRIDE_KEYS, isThemeId, type AppearanceColorOverrides } from "./themes.ts";

/** La versión del esquema que entiende este código. Súbela SOLO con cambios de forma
 * incompatibles (un campo renombrado o con otro significado); las adiciones puras nunca la suben. */
export const CURRENT_SETTINGS_VERSION = 1;

/** Los roles de agente en segundo plano cuyos modelos exponen los ajustes del agente.
 * El par de conversación (sondeador/profesor) queda fuera — lo controla el chat con
 * la ranura fuerte (un solo control, el selector de modelo). Las pruebas fijan el conjunto. */
export const BACKGROUND_MODEL_ROLES = [
	"researcher",
	"demoBuilder",
	"visualMaker",
	"extractor",
	"auditor",
	// Preguntas laterales (#16): se listan aquí solo para la sustitución a nivel de esquema
	// (agent.models.sideQuestion). El rol en sí se ejecuta en primer plano,
	// pese al nombre de la lista.
	"sideQuestion",
] as const;

export type BackgroundModelRole = (typeof BACKGROUND_MODEL_ROLES)[number];

/** Una sustitución de modelo/razonamiento por rol — cada campo independiente (un campo
 * ausente = ese aspecto recurre a la fijación de config.ts para el rol). */
export interface RoleModelOverride {
	/** El cambio de modelo: ambas coordenadas o ninguna (igual que ChatSettings.model). */
	model?: { provider: string; id: string };
	/** El cambio de presupuesto de razonamiento. */
	thinkingLevel?: ThinkingLevel;
}

// ─── Ranuras de modelo (oleada de ranuras de modelo, 2026-09-20) ─────────────────

/** Los niveles de capacidad en los que un usuario puede fijar modelos
 * (correspondencia fijada por el responsable): strong = sondeador + profesor
 * (también el punto de partida del profesor por defecto de cada sesión); cheap =
 * investigador, demo-builder, extractor, auditor; vision = visual-maker +
 * pdf-reader. Resolución por rol: SUSTITUCIÓN DEL ROL → ranura → fijación de fábrica. */
export const MODEL_SLOTS = ["strong", "cheap", "vision"] as const;
export type ModelSlotName = (typeof MODEL_SLOTS)[number];

/** El nivel de razonamiento POR DEFECTO, solo para los niveles SIN FIJAR (responsable,
 * 2026-09-22): una ranura/sustitución/chat que nombra un modelo pero no un nivel de
 * razonamiento se resuelve a la PRIMERA entrada de este orden que admita el modelo
 * (getSupportedThinkingLevels); un modelo sin razonamiento se resuelve a "off" en
 * cualquier caso (pi informa exactamente ["off"]). Los niveles fijados
 * EXPLÍCITAMENTE nunca consultan esta lista — al cambiar de modelo se acotan al más
 * cercano con el clampThinkingLevel nativo de pi.
 *
 * Superficie del cliente (interludio, 2026-09-22): esta constante vive en el BARRIL
 * DEL NÚCLEO — la interfaz la importa para rellenar automáticamente un nivel de
 * razonamiento al elegir un modelo NUEVO (una sola fuente de verdad, con el
 * precedente de AUTH_KEYS; los supportedLevels por modelo ya llegan al cliente a
 * través del catálogo). El orden NO tiene otro papel en el cliente: los registros
 * antiguos sin nivel conservan la alternativa defaultThinkingLevel en tiempo de
 * ejecución al construir el motor. */
export const DEFAULT_THINKING_ORDER = [
	"medium",
	"low",
	"high",
	"minimal",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

/** El sobre de rechazo NO-CONFIGURADO legible por máquina (responsable, 2026-09-22):
 * toda barrera por necesidad — la barrera del turno en chat-handler, el lanzamiento
 * de una tarea, una importación de apuntes — se niega con esta forma exacta. Los
 * llamadores HTTP reciben 503 + este JSON; los consumidores internos (el campo de
 * error del registro de la tarea) llevan la línea `error` legible. `missing` nombra
 * los NIVELES de ranura que necesita la acción rechazada y que encontró sin fijar. */
export const MODELS_NOT_CONFIGURED_CODE = "models_not_configured" as const;
export interface ModelsNotConfigured {
	/** Legible por humanos — se puede renderizar tal cual. */
	error: string;
	/** El discriminador de máquina con el que decide el cliente. */
	code: typeof MODELS_NOT_CONFIGURED_CODE;
	/** Qué niveles de ranura necesita la acción rechazada ("strong" | "cheap" | "vision"). */
	missing: ModelSlotName[];
}
export function modelsNotConfigured(missing: ModelSlotName[]): ModelsNotConfigured {
	return {
		error: "No model configured — set up your models first",
		code: MODELS_NOT_CONFIGURED_CODE,
		missing,
	};
}

/** El texto de error del rechazo (BYOK, 2026-09-22): las superficies de tareas y
 * turnos componen la redacción del registro alrededor de este prefijo; los
 * consumidores de la interfaz detectan con él el trabajo rechazado (tono
 * informativo, no de error alarmante) — el módulo de origen del sobre es dueño de la
 * cadena, así el que escribe y el que compara nunca se desincronizan. */
export function isModelsRefusal(error: string | undefined): boolean {
	return !!error && error.startsWith(modelsNotConfigured([]).error);
}
/** La excepción tipada para las fronteras dentro del proceso (proceso de extracción):
 * los llamadores la capturan para omitir con honestidad (disparador) o exponer el
 * sobre 503 (rutas) en lugar de registrar un fallo. */
export class ModelsNotConfiguredError extends Error {
	readonly envelope: ModelsNotConfigured;
	constructor(missing: ModelSlotName[]) {
		super(modelsNotConfigured(missing).error);
		this.name = "ModelsNotConfiguredError";
		this.envelope = modelsNotConfigured(missing);
	}
}

/** El rechazo por presencia de clave (interludio de las claves de proveedor,
 * responsable, 2026-09-25): no basta con un modelo FIJADO — la clave de su proveedor
 * debe estar presente, o la acción muere a mitad de streaming disfrazada de error
 * genérico. Misma familia de sobres que modelsNotConfigured: los llamadores HTTP
 * reciben 503 + este JSON; los consumidores internos (el campo de error del registro
 * de la tarea) llevan la línea `error` legible. `provider` nombra de quién falta la
 * clave; `slots` nombra los niveles de ranura que la acción rechazada resuelve a ese
 * proveedor. */
export const PROVIDER_KEY_MISSING_CODE = "provider_key_missing" as const;
export interface ProviderKeyMissing {
	/** Legible por humanos — se puede renderizar tal cual. */
	error: string;
	/** El discriminador de máquina con el que decide el cliente. */
	code: typeof PROVIDER_KEY_MISSING_CODE;
	/** El proveedor cuya clave falta, p. ej. "openrouter". */
	provider: string;
	/** Qué niveles de ranura resuelve a ese proveedor la acción rechazada. */
	slots: ModelSlotName[];
}
/** La cola invariante de la redacción del rechazo — el comparador de abajo se basa en
 * ella (el prefijo de la etiqueta varía según el proveedor). */
const PROVIDER_KEY_MISSING_TAIL = "key is set — add one in Settings → Keys";
const CLAUDE_CODE_UNAVAILABLE = "Claude Code is unavailable. Enable and set it up in Settings → Providers.";
export function providerKeyMissing(provider: string, slots: ModelSlotName[]): ProviderKeyMissing {
	const label = AUTH_PROVIDER_KEYS.find((p) => p.id === provider)?.label ?? provider;
	return {
		error: provider === CLAUDE_CODE_PROVIDER ? CLAUDE_CODE_UNAVAILABLE : `No ${label} ${PROVIDER_KEY_MISSING_TAIL}`,
		code: PROVIDER_KEY_MISSING_CODE,
		provider,
		slots,
	};
}
/** El texto de error del rechazo (la misma disciplina que isModelsRefusal): los
 * consumidores de la interfaz detectan por la redacción el trabajo rechazado por la
 * clave (tono informativo, no de error alarmante) — el módulo de origen del sobre es
 * dueño de la cadena, así el que escribe y el que compara nunca se desincronizan. */
export function isProviderKeyRefusal(error: string | undefined): boolean {
	return !!error && (error.endsWith(PROVIDER_KEY_MISSING_TAIL) || error === CLAUDE_CODE_UNAVAILABLE);
}
/** La excepción tipada para las fronteras dentro del proceso (proceso de extracción)
 * — la hermana ProviderKeyMissing de ModelsNotConfiguredError: los llamadores la
 * capturan para omitir con honestidad (disparador) o exponer el sobre 503 (rutas). */
export class ProviderKeyMissingError extends Error {
	readonly envelope: ProviderKeyMissing;
	constructor(provider: string, slots: ModelSlotName[]) {
		const envelope = providerKeyMissing(provider, slots);
		super(envelope.error);
		this.name = "ProviderKeyMissingError";
		this.envelope = envelope;
	}
}

export const CACHE_RETENTIONS = ["none", "short", "long"] as const satisfies readonly CacheRetention[];

/** Preferencias guardadas de las ranuras de modelo. Una ranura solo está configurada cuando
 * hay model; los registros depurados que solo tienen nivel pueden conservarse, pero se
 * resuelven como sin definir. Un nivel de razonamiento por sí solo no elige un modelo de
 * recurso implícito. */
export interface ModelSlot {
	/** Preferencia nativa de Pi. Si no está, el comportamiento de Pi y del entorno no cambia. */
	cacheRetention?: CacheRetention;
	/** Coordenadas del modelo configurado; provider e id deben indicarse juntos. */
	model?: { provider: string; id: string };
	/** Nivel de razonamiento opcional que se usa con el modelo configurado de esta ranura. */
	thinkingLevel?: ThinkingLevel;
}

/** La sección de ajustes `models` (decisión del responsable 2026-09-20: una sección
 * propia — las ranuras son elecciones a nivel de motor, no de una sesión). Todas las
 * ranuras son opcionales: una ranura ausente significa que todos los roles de su
 * nivel usan lo que resuelvan los niveles más profundos de la cadena (sustitución
 * por rol → fijación de fábrica). */
export interface ModelsSettings {
	strong?: ModelSlot;
	cheap?: ModelSlot;
	vision?: ModelSlot;
}

// ─── Endpoint personalizado compatible con OpenAI ────────────────────────────────
// UN servidor compatible con OpenAI configurado por el usuario (vLLM / Ollama / un proxy). Es
// un proveedor más en la lista de claves, identificado por una URL base en lugar de una variable de entorno.
// Solo configuración NO SECRETA (URL base + ids de modelo descubiertos); la clave de API es un
// secreto del almacén de autenticación, nunca está aquí. Se registra en pi-ai como un
// proveedor normal (server/custom-provider.ts).

/** Solo valores alternativos de presupuesto; el precio del endpoint personalizado es desconocido. */
export const CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW = 8192;
export const CUSTOM_MODEL_DEFAULT_MAX_TOKENS = 4096;

/** Los presupuestos personalizados aceptan cualquier entero positivo, incluidos topes de salida pequeños. */
export const CUSTOM_MODEL_PIN_FLOOR = 1;

/** Un modelo personalizado descubierto. `image`/`reasoning`/`context`/`maxTokens` se
 * detectan a partir de los metadatos /models del endpoint; lo que este omita toma un
 * valor por defecto. */
export interface CustomModel {
	id: string;
	/** Acepta entrada de imagen (capaz de visión). Por defecto false (solo texto). */
	image?: boolean;
	/** Acepta un esfuerzo de razonamiento (thinking). Por defecto false → el único
	 * nivel de razonamiento es "off", exactamente como un modelo integrado sin razonamiento. */
	reasoning?: boolean;
	/** Ventana de contexto en tokens, según el endpoint. Ausente → el valor por defecto. */
	context?: number;
	/** Máximo de tokens de salida, según el endpoint. Ausente → el valor por defecto. */
	maxTokens?: number;
}

/** Una fijación del usuario para un modelo personalizado: prevalece sobre lo que
 * publica el endpoint (decisión del responsable — gana la intención explícita del
 * usuario; el número de un servidor local suele ser erróneo o faltar). Campo ausente
 * = sin fijación. `reasoning` tiene tres estados: true declara que admite
 * razonamiento, false retira esa declaración y ausente usa el descubrimiento. NO es
 * un interruptor de ejecución ni de desactivación en el backend. */
export interface CustomModelOverride {
	context?: number;
	maxTokens?: number;
	reasoning?: boolean;
}

/** La configuración guardada del único endpoint personalizado (sección de deltas). */
export interface CustomProviderSettings {
	/** Nonce aleatorio de autorización propiedad del servidor; nunca un hash de credenciales. */
	credentialBindingId?: string;
	/** Intención explícita de autenticación; nunca se deduce de una clave guardada. */
	authMode?: "keyless" | "apiKey";
	/** URL base normalizada (ver normalizeBaseUrl). Vacía/ausente = sin configurar. */
	baseUrl?: string;
	/** Modelos que ofrece este endpoint: los ids anunciados fusionados con los
	 * introducidos a mano (se reescriben al conectar; un sondeo fallido conserva la
	 * última instantánea del mismo endpoint). */
	models?: CustomModel[];
	/** Fijaciones del usuario indexadas por id de modelo — pura intención del usuario,
	 * nunca las reescribe el descubrimiento; al conectar se podan a los ids que ofrece la conexión. */
	overrides?: Record<string, CustomModelOverride>;
	/** Ids de modelo que el usuario escribió a mano, para un endpoint que no publica una
	 * lista /models utilizable. Se guardan aparte de la instantánea para que una
	 * reconexión pueda volver a fusionarlos tras refrescarse el descubrimiento. */
	manualModels?: string[];
}

export function parseModelIds(raw: unknown): string[] {
	const items = typeof raw === "string" ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw : [];
	const ids = items.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
	return [...new Set(ids)];
}

/** Forma canónica de la URL base (fuente única): recorta, exige http(s) absoluto y
 * quita las barras finales. Devuelve "" para cualquier cosa no válida ("sin configurar"). */
export function normalizeBaseUrl(raw: string): string {
	const value = raw.trim();
	if (!value) return "";
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return "";
	return url.toString().replace(/\/+$/, "");
}

/** LA fuente única de "¿se puede usar el endpoint personalizado?": una URL base no vacía.
 * La presencia de la clave se excluye deliberadamente (se permiten servidores locales sin clave). */
export function customProviderUsable(
	cp: CustomProviderSettings | undefined,
): cp is CustomProviderSettings & { baseUrl: string } {
	return Boolean(cp?.baseUrl);
}

/** Barrera del primer arranque (oleada de ranuras de modelo, responsable 2026-09-20):
 * la app se niega a iniciar chats hasta que el usuario haya elegido activamente las
 * tres ranuras — NO HAY valores por defecto para 33 proveedores; una app configurada
 * es aquella cuya sección de modelos tiene un modelo en cada ranura. Los niveles de
 * razonamiento siguen siendo opcionales (ausente = el presupuesto del nivel resuelto). */
export function slotsConfigured(models: ModelsSettings | undefined): boolean {
	return Boolean(models?.strong?.model && models?.cheap?.model && models?.vision?.model);
}

/** De qué ranura tira un rol (oleada de ranuras de modelo, 2026-09-20). Incluye el par
 * de conversación y pdfReader (no BackgroundModelRoles — el nivel de ranura abarca
 * todos los roles; solo los roles en segundo plano exponen sustituciones por rol). */
export const ROLE_SLOT: Readonly<Record<ModelRole, ModelSlotName>> = {
	prober: "strong",
	teacher: "strong",
	researcher: "cheap",
	demoBuilder: "cheap",
	extractor: "cheap",
	auditor: "cheap",
	visualMaker: "vision",
	pdfReader: "vision",
	sideQuestion: "strong", // la cadena de conversación, como el sondeador/profesor (resolveSideQuestionSpec)
};

/** Ajustes generales — comportamiento a nivel de app. La VISUALIZACIÓN de la versión y
 * el inicio de sesión de los planes viven fuera del registro (package.json /
 * auth.json) por decisión del responsable. */
export interface GeneralSettings {
	/** Comprobaciones automáticas de actualizaciones al arrancar y cada 24 h (por defecto ACTIVADAS). Las manuales no dependen de esto. */
	autoUpdate?: boolean;
}

/** Una única preferencia de dictado para toda la app, compartida por todos los compositores. */
export interface DictationSettings {
	language?: DictationLanguage;
}

/** Ajustes del agente — todo lo relativo a la maquinaria que no es de conversación. */
export interface AgentSettings {
	/** Máximo de peticiones simultáneas al modelo de los workers en segundo plano (por
	 * defecto 8). Las conversaciones directas no dependen de este límite. Solo enteros
	 * seguros positivos: sin techo arbitrario, redondeo ni acotación. */
	workerRequestConcurrency?: number;
	/** Sustituciones de modelo/razonamiento de los roles en segundo plano (rol ausente = fijación de config). */
	models?: Partial<Record<BackgroundModelRole, RoleModelOverride>>;
	/** Interruptores de herramientas indexados por id de herramienta (clave ausente =
	 * activada). Solo a nivel de usuario — sin sustitución por chat (decisión del responsable 2026-09-19). */
	tools?: Record<string, boolean>;
	/** Preferencia de motor de búsqueda (oleada de búsqueda, 2026-09-20). OPCIONAL por
	 * decisión del responsable: poner una clave activa su motor automáticamente — el
	 * usuario nunca elige un motor para que funcione la búsqueda. Una elección explícita
	 * solo fija la preferencia (p. ej. cuando están AMBAS claves); el motor elegido debe
	 * tener igualmente su clave, o la búsqueda no estará disponible, y se dirá con
	 * honestidad. Ausente + sin clave = no disponible (sin alternativa silenciosa ni valor por defecto). */
	search?: { engine?: SearchEngineId };
	/** Herramientas del grafo del sondeador (oleada 7, decisión del responsable
	 * 2026-09-23): vistas de solo lectura del grafo de conocimiento para el agente
	 * sondeador — una lista de sesiones + las proposiciones de cada sesión con sus
	 * niveles de comprensión. Su TEMA es el grafo, pero su MECANISMO es una capacidad del
	 * agente (registro de herramientas), así que vive aquí, en su PROPIA subsección, y no
	 * en el mapa de interruptores de herramientas. Ausente = activado (la disciplina de
	 * los interruptores); la barrera efectiva combina graph.enabled Y este interruptor. */
	graphTools?: { enabled?: boolean };
	/** INTERRUPTORES de sustitución del prompt del sistema indexados por ruta de segmento
	 * (clave ausente = desactivado). Encenderlo exige que exista el fichero de
	 * sustitución (lo hace cumplir la ruta); el interruptor es explícito para que los
	 * usuarios puedan conservar un fichero en disco y usar el valor por defecto del
	 * código fuente para comparar (decisión del responsable 2026-09-19). */
	prompts?: Record<string, boolean>;
	/** Límite opcional de las fuentes del alumno, DESACTIVADO si falta. Activado sin
	 * carpetas rechaza todas las lecturas de fuentes del alumno. Las rutas son absolutas
	 * o empiezan por ~/; la política vigente se lee en cada nueva llamada a herramienta o
	 * inicio de tarea. Las denegaciones existentes de ubicaciones sensibles y
	 * credenciales siempre ganan; no es una prohibición de todos los datos. */
	fileAccess?: FileAccessSettings;
}

/** Mandos del renderizado de Markdown — el conjunto mínimo (decisión del responsable). */
export interface MdRenderingSettings {
	/** Grosor de la fuente de los encabezados (100–900, por defecto 900). CSS resuelve el
	 * grosor disponible más cercano de la fuente elegida — no hace falta inspeccionar la fuente. */
	headingWeight?: number;
	/** Color de los tramos en **negrita** (por defecto #ffffff). */
	boldColor?: string | null;
	/** Color de los tramos en *cursiva* (por defecto #ffffff). */
	italicColor?: string | null;
}

/** Ajustes de apariencia — tema, colores sustituidos, tipografía, énfasis de markdown. */
export interface AppearanceSettings {
	/** El id del tema activo (preajustes de core/themes.ts o un fichero personalizado en
	 * THEMES_DIR). Ausente o desaparecido = "default". El tema declara el modo
	 * (oscuro/claro) — las antiguas claves `mode`/`lightBackground` ya no se leen
	 * (oleada de temas, 2026-11-04). */
	theme?: string;
	/** El color de fondo sustituido (null = el del tema). Se mantiene en su clave
	 * anterior a los temas para que los registros existentes conserven su color. */
	background?: string | null;
	/** Sustituciones por color sobre el tema (null/ausente = el del tema). Se conservan
	 * al cambiar de tema. Negrita y cursiva viven en mdRendering. */
	colors?: AppearanceColorOverrides;
	/** La fuente principal de lectura (todo lo que hoy es Source Sans 3), por nombre —
	 * elegida por el usuario entre las fuentes instaladas. null = Source Sans 3. */
	fontFamily?: string | null;
	/** Tamaño de la fuente de lectura en px (12–24, por defecto 16). Los encabezados se
	 * renderizan como múltiplos de él, así que un solo mando escala el documento de forma coherente. */
	proseFontSize?: number;
	/** Permite las ligaduras normales de la fuente en el código (incluidos el código en línea y los editores de código). Por defecto false; la prosa no se ve afectada. */
	codeLigatures?: boolean;
	/** Nombres de sesión en CMU Serif (por defecto true — el aspecto actual). */
	sessionNameSerif?: boolean;
	mdRendering?: MdRenderingSettings;
}

/** Ajustes del grafo de conocimiento — una escalera estricta de dependencias
 * (decisión del responsable 2026-09-19): grafo → embeddings → agrupación →
 * etiquetado, cada peldaño solo con sentido cuando su padre está activado (la
 * interfaz atenúa los dependientes; los valores guardados persisten pero se
 * resuelven inertes). Todos true por defecto. */
export interface GraphSettings {
	/** GENERAL (y, desde la oleada 7, el ÚNICO): desactivado = sin extracción ni auditor.
	 * El colapso de la oleada 7 (decisión del responsable 2026-09-23) eliminó los tres
	 * peldaños subordinados — embeddings/agrupación/etiquetado — y el embeddingModel
	 * BYOK: la agrupación es la partición gratuita por sesión de nacimiento que se deriva
	 * al leer (core/session-clusters.ts), las etiquetas SON los nombres de sesión y las
	 * herramientas del grafo del sondeador leen los registros directamente — ya no queda
	 * nada que configurar. Los datos se siguen guardando en cualquier caso. */
	enabled?: boolean;
	/** RENDERIZADO DEL GRAFO (responsable, 2026-10-06 — la ronda de controles del grafo de
	 * la versión): decide SOLO la vista principal del inicio. Desactivado = el inicio
	 * muestra la vista de cadenas en lugar del lienzo; los registros, el proceso de
	 * extracción y todas las rutas de escritura no se tocan — es un interruptor de
	 * visualización, no de datos (el interruptor general de extracción de arriba es el
	 * de datos). Activado por defecto. */
	rendering?: boolean;
	/** El presupuesto de fragmentos (rediseño de la UX de extracción, responsable
	 * 2026-09-24): la parte de tokens de transcripción del contexto del extractor — una
	 * ejecución se dispara cuando los tokens NO CUBIERTOS de un chat llegan a ella, y la
	 * ejecución agrupa los mensajes no cubiertos más antiguos en tandas de ≤ este número
	 * de tokens. Limita tanto el coste como el tamaño de los fragmentos (el prompt del
	 * extractor también lleva el grafo entero + las instrucciones, así que un
	 * presupuesto menor significa más ejecuciones y más pequeñas — y cada una paga ese
	 * coste fijo).
	 *
	 * VALOR DE FÁBRICA 4096 (responsable, 2026-10-13: se volvió a reducir a la mitad desde
	 * los 8192 de la era de los resúmenes — los pasajes etiquetados + las anclas de
	 * mensaje hicieron que los lotes más pequeños volvieran a compensar su coste fijo; la
	 * constante anterior al ajuste era 4096, vision-extraction-coverage.md, 2026-09-15).
	 * Solo se mueve el valor de FÁBRICA: un valor explícito del usuario siempre gana.
	 *
	 * SUELO 500 (EXTRACTION_CHUNK_TOKENS_FLOOR, decisión del implementador según el
	 * encargo del responsable): cada ejecución paga el coste fijo del prompt que lleva el
	 * grafo con el dinero del canal de escritura — un presupuesto por debajo de ~500
	 * tokens dispararía lotes de calderilla que cuestan más por token extraído de lo que
	 * vale el contenido, así que el saneador acota y el PUT rechaza por debajo. SIN TECHO
	 * a propósito: un presupuesto grande solo retrasa la extracción — el equilibrio entre
	 * coste y exhaustividad que ha elegido el usuario, no una mala configuración que
	 * vigilar. */
	extractionChunkTokens?: number;
}

/**
 * COMPACTACIÓN (ronda 14 del responsable, 2026-10-05): los controles de cara al
 * usuario de la mecánica de ajuste al contexto: el umbral de disparo y la
 * contabilidad opcional del razonamiento. El disparo efectivo es min(esto,
 * contextWindow del modelo − reserva de 16k) (decisión del responsable: en los
 * modelos grandes manda el ajuste; en los pequeños manda la ventana antes de que el
 * proveedor se desborde).
 *
 * VALOR DE FÁBRICA 150_000 (decisión del responsable).
 *
 * SUELO 32_000 (decisión del implementador, con la disciplina del presupuesto de
 * fragmentos): por debajo de la cola conservada (20k) + un resumen, el chat se
 * volvería a compactar en cada turno — un despilfarro, no una preferencia. SIN TECHO:
 * un umbral enorme solo significa "que quepa todo" hasta que mande la regla de la
 * ventana.
 */
export interface CompactionSettings {
	thresholdTokens?: number;
	/** Usa el uso de salida guardado para el razonamiento reproducible de Responses del
	 * mismo modelo. Ausente = false: conserva la heurística original del contenido legible. */
	includeReasoning?: boolean;
}

/** EL registro. Todas las secciones son opcionales (deltas); el saneador conserva tal
 * cual las claves de nivel superior desconocidas (compatibilidad hacia delante con
 * registros más nuevos). */
export interface UserSettings {
	version: number;
	general?: GeneralSettings;
	dictation?: DictationSettings;
	/** Activación explícita para toda la app; ausente o no válido es desactivado, también en registros antiguos. */
	claudeCode?: { enabled?: boolean };
	agent?: AgentSettings;
	/** Las ranuras de modelo fuerte/barata/visión (oleada de ranuras de modelo, 2026-09-20). */
	models?: ModelsSettings;
	/** El endpoint personalizado compatible con OpenAI (solo configuración no secreta). */
	customProvider?: CustomProviderSettings;
	appearance?: AppearanceSettings;
	graph?: GraphSettings;
	compaction?: CompactionSettings;
	[key: string]: unknown;
}

/** Valores de fábrica de todo lo que el núcleo puede fijar (decisiones del responsable
 * 2026-09-19). NO existen modelos de fábrica en ninguna parte (responsable, 2026-09-22
 * — BYOK hasta el fondo): la sección de chat y todas las ranuras quedan vacías hasta
 * que el usuario elige, y las barreras por necesidad se niegan con honestidad; las
 * herramientas están activadas por defecto; los prompts, desactivados — de ahí que
 * falten aquí. */
export interface FactorySettings {
	version: number;
	agent: Required<Pick<AgentSettings, "workerRequestConcurrency">>;
	general: Required<GeneralSettings>;
	dictation: Required<DictationSettings>;
	appearance: {
		theme: string;
		background: string | null;
		colors: AppearanceColorOverrides;
		fontFamily: string | null;
		proseFontSize: number;
		codeLigatures: boolean;
		sessionNameSerif: boolean;
		mdRendering: {
			headingWeight: number;
			boldColor: string | null;
			italicColor: string | null;
		};
	};
	graph: Required<GraphSettings>;
	compaction: Required<CompactionSettings>;
}

export const FACTORY_SETTINGS: FactorySettings = {
	version: CURRENT_SETTINGS_VERSION,
	agent: { workerRequestConcurrency: 8 },
	general: { autoUpdate: true },
	dictation: { language: "en" },
	appearance: {
		theme: "default",
		background: null, // null = el fondo del tema activo
		colors: {}, // sin sustituciones: todos los colores son los del tema
		fontFamily: null, // Source Sans 3
		proseFontSize: 16,
		codeLigatures: false,
		sessionNameSerif: true,
		mdRendering: { headingWeight: 900, boldColor: null, italicColor: null },
	},
	graph: { enabled: true, rendering: true, extractionChunkTokens: 4096 },
	compaction: { thresholdTokens: 150_000, includeReasoning: false },
};

/** El suelo validado del presupuesto de fragmentos (GraphSettings.extractionChunkTokens
 * — ver su documentación para el motivo de los lotes de calderilla; el PUT de ajustes
 * lo nombra en su rechazo y el saneador acota a él). */
export const EXTRACTION_CHUNK_TOKENS_FLOOR = 500;

// ─── Saneador ───────────────────────────────────────────────────────────────

const PROSE_FONT_MIN = 12;
const PROSE_FONT_MAX = 24;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** #rgb / #rrggbb (sin distinguir mayúsculas) — el único formato de color que aceptamos. */
export function isHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Convierte un campo arbitrario hexadecimal-o-null: null y los hexadecimales válidos
 * pasan tal cual, cualquier otra cosa se convierte en null (el valor de fábrica / por modo). */
function sanitizeHexOrNull(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value === "string" && isHexColor(value)) return value;
	return null;
}

const boolOrDrop = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

function sanitizeGeneral(raw: Record<string, unknown>): GeneralSettings {
	const out: GeneralSettings = {};
	const autoUpdate = boolOrDrop(raw.autoUpdate);
	if (autoUpdate !== undefined) out.autoUpdate = autoUpdate;
	return out;
}

const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

function sanitizeRoleOverride(raw: unknown): RoleModelOverride | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const out: RoleModelOverride = {};
	if (
		typeof r.model === "object" &&
		r.model !== null &&
		!Array.isArray(r.model) &&
		typeof (r.model as Record<string, unknown>).provider === "string" &&
		typeof (r.model as Record<string, unknown>).id === "string"
	) {
		out.model = {
			provider: (r.model as { provider: string }).provider,
			id: (r.model as { id: string }).id,
		};
	}
	if (typeof r.thinkingLevel === "string" && THINKING_LEVELS.includes(r.thinkingLevel as ThinkingLevel)) {
		out.thinkingLevel = r.thinkingLevel as ThinkingLevel;
	}
	return Object.keys(out).length ? out : undefined;
}

/** La sección de modelos (oleada de ranuras de modelo, 2026-09-20): cada ranura
 * conserva solo las partes bien formadas — las mismas reglas de forma que una
 * sustitución de rol, para que un cliente desactualizado no pueda aparcar basura en una ranura. */
function sanitizeModels(raw: Record<string, unknown>): ModelsSettings {
	const out: ModelsSettings = {};
	for (const slot of MODEL_SLOTS) {
		const cleaned: ModelSlot = sanitizeRoleOverride(raw[slot]) ?? {};
		const value = raw[slot];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const retention = (value as Record<string, unknown>).cacheRetention;
			if (CACHE_RETENTIONS.includes(retention as CacheRetention)) cleaned.cacheRetention = retention as CacheRetention;
		}
		if (Object.keys(cleaned).length) out[slot] = cleaned;
	}
	return out;
}

/** Un entero positivo, o undefined — conserva solo los recuentos de tokens con sentido. */
function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Una fijación, acotada hacia arriba hasta el suelo (acotar, nunca rechazar, al leer). */
function sanitizeCustomModelOverride(raw: unknown): CustomModelOverride | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const rec = raw as Record<string, unknown>;
	const out: CustomModelOverride = {};
	const context = positiveInt(rec.context);
	if (context) out.context = Math.max(CUSTOM_MODEL_PIN_FLOOR, context);
	const maxTokens = positiveInt(rec.maxTokens);
	if (maxTokens) out.maxTokens = Math.max(CUSTOM_MODEL_PIN_FLOOR, maxTokens);
	if (typeof rec.reasoning === "boolean") out.reasoning = rec.reasoning;
	return Object.keys(out).length ? out : undefined;
}

/** EL mapa de fijaciones + LA ley de poda: solo entradas bien formadas, ids recortados
 * y, cuando se da `liveIds`, se descarta toda entrada de un modelo que el endpoint ya
 * no anuncia. POST pasa los ids descubiertos; PATCH, la lista guardada. */
export function sanitizeCustomModelOverrides(
	raw: unknown,
	liveIds?: Iterable<string>,
): Record<string, CustomModelOverride> {
	const out: Record<string, CustomModelOverride> = {};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
	const live = liveIds ? new Set(liveIds) : undefined;
	for (const [key, value] of Object.entries(raw)) {
		const id = key.trim();
		if (!id || (live && !live.has(id))) continue;
		const pin = sanitizeCustomModelOverride(value);
		if (pin) Object.defineProperty(out, id, { value: pin, enumerable: true, configurable: true, writable: true });
	}
	return out;
}

/** La sección customProvider: URL base normalizada (no válida → se descarta) y modelos
 * descubiertos (ids recortados, duplicados y vacíos descartados; image solo se
 * conserva si es true; recuentos de tokens solo como enteros positivos). Acotar, nunca rechazar. */
function sanitizeCustomProvider(raw: Record<string, unknown>): CustomProviderSettings {
	const out: CustomProviderSettings = {};
	if (typeof raw.credentialBindingId === "string" && /^[a-f0-9]{32}$/.test(raw.credentialBindingId)) out.credentialBindingId = raw.credentialBindingId;
	if (raw.authMode === "keyless" || raw.authMode === "apiKey") out.authMode = raw.authMode;
	if (typeof raw.baseUrl === "string") {
		const base = normalizeBaseUrl(raw.baseUrl);
		if (base) out.baseUrl = base;
	}
	if (Array.isArray(raw.models)) {
		const byId = new Map<string, CustomModel>();
		for (const m of raw.models) {
			if (typeof m !== "object" || m === null) continue;
			const rec = m as Record<string, unknown>;
			if (typeof rec.id !== "string") continue;
			const id = rec.id.trim();
			if (!id) continue;
			const model: CustomModel = { id };
			if (rec.image === true) model.image = true;
			if (rec.reasoning === true) model.reasoning = true;
			const context = positiveInt(rec.context);
			if (context) model.context = context;
			const maxTokens = positiveInt(rec.maxTokens);
			if (maxTokens) model.maxTokens = maxTokens;
			byId.set(id, model);
		}
		out.models = [...byId.values()];
	}
	const overrides = sanitizeCustomModelOverrides(raw.overrides);
	if (Object.keys(overrides).length) out.overrides = overrides;
	const manualModels = parseModelIds(raw.manualModels);
	if (manualModels.length) out.manualModels = manualModels;
	return out;
}

function sanitizeBooleanMap(raw: unknown): Record<string, boolean> | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "boolean") out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

function sanitizeAgent(raw: Record<string, unknown>): AgentSettings {
	const out: AgentSettings = {};
	// Los valores no válidos del disco se descartan: la ausencia se resuelve a 8, nunca a una acotación silenciosa.
	if (typeof raw.workerRequestConcurrency === "number" && Number.isSafeInteger(raw.workerRequestConcurrency) && raw.workerRequestConcurrency > 0) {
		out.workerRequestConcurrency = raw.workerRequestConcurrency;
	}
	if (raw.models !== null && typeof raw.models === "object" && !Array.isArray(raw.models)) {
		const models: Partial<Record<BackgroundModelRole, RoleModelOverride>> = {};
		for (const [role, override] of Object.entries(raw.models as Record<string, unknown>)) {
			if ((BACKGROUND_MODEL_ROLES as readonly string[]).includes(role)) {
				const cleaned = sanitizeRoleOverride(override);
				if (cleaned) models[role as BackgroundModelRole] = cleaned;
			}
		}
		if (Object.keys(models).length) out.models = models;
	}
	const tools = sanitizeBooleanMap(raw.tools);
	if (tools) out.tools = tools;
	const prompts = sanitizeBooleanMap(raw.prompts);
	if (prompts) out.prompts = prompts;
	// Preferencia de búsqueda: lado de lectura indulgente (un id de motor desconocido se
	// descarta; el analizador del lado de escritura es estricto — un cliente desactualizado no
	// puede inutilizar el registro, solo pierde la fijación y vuelve la detección automática).
	if (raw.search !== null && typeof raw.search === "object" && !Array.isArray(raw.search)) {
		const engine = (raw.search as Record<string, unknown>).engine;
		if (isSearchEngineId(engine)) out.search = { engine };
	}
	// Herramientas del grafo del sondeador (oleada 7): su propia subsección de la sección del
	// agente — lado de lectura indulgente (una forma incorrecta descarta la clave y vuelve el
	// valor por defecto ACTIVADO; el analizador del lado de escritura es estricto).
	if (raw.graphTools !== null && typeof raw.graphTools === "object" && !Array.isArray(raw.graphTools)) {
		const enabled = (raw.graphTools as Record<string, unknown>).enabled;
		if (enabled === undefined) out.graphTools = {};
		else if (typeof enabled === "boolean") out.graphTools = { enabled };
	}
	// Nunca se deja caer una política de acceso mal formada en el valor por defecto sin restricciones.
	// El lector estricto del almacén informa por separado de su error de configuración;
	// esta vista segura también conserva el límite durante escrituras de la interfaz no relacionadas.
	if (raw.fileAccess !== undefined) {
		const parsed = parseFileAccessSettings(raw.fileAccess);
		out.fileAccess = parsed.ok ? parsed.settings : { restricted: true, folders: [] };
	}
	return out;
}

function sanitizeMdRendering(raw: unknown): MdRenderingSettings {
	const out: MdRenderingSettings = {};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r.headingWeight === "number" && Number.isFinite(r.headingWeight)) {
		out.headingWeight = clamp(Math.round(r.headingWeight), 100, 900);
	}
	if (r.boldColor !== undefined) out.boldColor = sanitizeHexOrNull(r.boldColor);
	if (r.italicColor !== undefined) out.italicColor = sanitizeHexOrNull(r.italicColor);
	return out;
}

function sanitizeAppearance(raw: Record<string, unknown>): AppearanceSettings {
	const out: AppearanceSettings = {};
	// Oleada de temas (2026-11-04): `mode`/`lightBackground` (oleada del modo claro)
	// ya no se leen — el tema declara el modo. Se descartan aquí, como los peldaños
	// muertos del grafo; la siguiente escritura de apariencia los elimina del todo.
	if (isThemeId(raw.theme)) out.theme = raw.theme;
	if (raw.background !== undefined) out.background = sanitizeHexOrNull(raw.background);
	if (raw.colors !== null && typeof raw.colors === "object" && !Array.isArray(raw.colors)) {
		const colors: AppearanceColorOverrides = {};
		const c = raw.colors as Record<string, unknown>;
		for (const key of COLOR_OVERRIDE_KEYS) {
			if (c[key] !== undefined) colors[key] = sanitizeHexOrNull(c[key]);
		}
		out.colors = colors;
	}
	if (raw.fontFamily !== undefined) {
		out.fontFamily = typeof raw.fontFamily === "string" && raw.fontFamily.trim() ? raw.fontFamily : null;
	}
	if (typeof raw.proseFontSize === "number" && Number.isFinite(raw.proseFontSize)) {
		out.proseFontSize = clamp(Math.round(raw.proseFontSize), PROSE_FONT_MIN, PROSE_FONT_MAX);
	}
	const codeLigatures = boolOrDrop(raw.codeLigatures);
	if (codeLigatures !== undefined) out.codeLigatures = codeLigatures;
	const sessionNameSerif = boolOrDrop(raw.sessionNameSerif);
	if (sessionNameSerif !== undefined) out.sessionNameSerif = sessionNameSerif;
	if (raw.mdRendering !== undefined) out.mdRendering = sanitizeMdRendering(raw.mdRendering);
	return out;
}

function sanitizeGraph(raw: Record<string, unknown>): GraphSettings {
	// Colapso de la oleada 7 (decisión del responsable 2026-09-23): la sección es SOLO el
	// interruptor general. Las claves de los peldaños muertos (embedding/clustering/labeling/
	// embeddingModel) de los registros existentes simplemente NO SE LEEN y esta reconstrucción
	// las DESCARTA — la historia de la migración: la siguiente escritura de la sección del grafo
	// (el PUT reemplaza entero) persiste la forma colapsada, y ningún código activo vuelve a
	// mirar los campos obsoletos.
	//
	// extractionChunkTokens (rediseño de la UX de extracción, 2026-09-24): el presupuesto de
	// fragmentos — acotar, nunca rechazar (la disciplina de bd68486): un número positivo
	// finito se acota hasta EXTRACTION_CHUNK_TOKENS_FLOOR (las fracciones se redondean a la
	// baja a enteros); cualquier otra cosa se descarta y se resuelve al valor de fábrica. Un
	// registro en disco por debajo del suelo (app antigua, edición a mano) se acota HACIA
	// ARRIBA — el suelo es una protección de costes, no un dato que respetar.
	const out: GraphSettings = {};
	const enabled = boolOrDrop(raw.enabled);
	if (enabled !== undefined) out.enabled = enabled;
	const rendering = boolOrDrop(raw.rendering);
	if (rendering !== undefined) out.rendering = rendering;
	const rawTokens = raw.extractionChunkTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.extractionChunkTokens = Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

/** acotar, nunca rechazar (la disciplina del saneador): un número positivo finito se
 * acota hasta COMPACTION_THRESHOLD_FLOOR; cualquier otra cosa se descarta (el valor de
 * fábrica se resuelve al leer). Se exporta para el rechazo con justificación del
 * analizador del PUT (el precedente del presupuesto de fragmentos del grafo). */
export const COMPACTION_THRESHOLD_FLOOR = 32_000;

function sanitizeCompaction(raw: Record<string, unknown>): CompactionSettings {
	const out: CompactionSettings = {};
	const includeReasoning = boolOrDrop(raw.includeReasoning);
	if (includeReasoning !== undefined) out.includeReasoning = includeReasoning;
	const rawTokens = raw.thresholdTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.thresholdTokens = Math.max(COMPACTION_THRESHOLD_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

/**
 * Convierte JSON arbitrario (fichero en disco, cuerpo de red) en un registro de deltas
 * válido: los campos conocidos se validan con rigor (los no válidos se descartan o se
 * acotan según la documentación del módulo) y las CLAVES DESCONOCIDAS SE CONSERVAN TAL
 * CUAL (un registro más nuevo debe sobrevivir a una app más antigua). Nunca lanza. Lo
 * que no es un objeto → null.
 */
export function sanitizeUserSettings(raw: unknown): UserSettings | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const out: UserSettings = {
		version: typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1 ? r.version : CURRENT_SETTINGS_VERSION,
	};
	if (r.general !== null && typeof r.general === "object" && !Array.isArray(r.general)) {
		out.general = sanitizeGeneral(r.general as Record<string, unknown>);
	}
	if (r.dictation !== undefined) {
		const raw = r.dictation;
		out.dictation = raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
			isDictationLanguage((raw as Record<string, unknown>).language)
			? { language: (raw as DictationSettings).language }
			: {};
	}
	if (r.claudeCode !== undefined) {
		const raw = r.claudeCode;
		out.claudeCode = raw !== null && typeof raw === "object" && !Array.isArray(raw)
			&& typeof (raw as Record<string, unknown>).enabled === "boolean"
			? { enabled: (raw as { enabled: boolean }).enabled } : {};
	}
	if (r.agent !== null && typeof r.agent === "object" && !Array.isArray(r.agent)) {
		out.agent = sanitizeAgent(r.agent as Record<string, unknown>);
	}
	if (r.appearance !== null && typeof r.appearance === "object" && !Array.isArray(r.appearance)) {
		out.appearance = sanitizeAppearance(r.appearance as Record<string, unknown>);
	}
	if (r.models !== null && typeof r.models === "object" && !Array.isArray(r.models)) {
		const models = sanitizeModels(r.models as Record<string, unknown>);
		if (Object.keys(models).length) out.models = models;
	}
	if (r.customProvider !== null && typeof r.customProvider === "object" && !Array.isArray(r.customProvider)) {
		out.customProvider = sanitizeCustomProvider(r.customProvider as Record<string, unknown>);
	}
	if (r.graph !== null && typeof r.graph === "object" && !Array.isArray(r.graph)) {
		out.graph = sanitizeGraph(r.graph as Record<string, unknown>);
	}
	if (r.compaction !== undefined && r.compaction !== null && typeof r.compaction === "object") {
		out.compaction = sanitizeCompaction(r.compaction as Record<string, unknown>);
	}
	// Las claves de nivel superior desconocidas viajan intactas (compatibilidad hacia delante).
	// Una clave CONOCIDA Y MUERTA se elimina en lugar de viajar: `chat` (la antigua sección
	// default-settings) murió con los modelos por sesión (responsable, 2026-09-28) — una copia
	// fósil en disco nunca debe resucitar mediante las lecturas (y cualquier escritura posterior
	// la elimina del fichero para siempre).
	for (const [key, value] of Object.entries(r)) {
		if (key === "chat") continue;
		if (!(key in out)) out[key] = value;
	}
	return out;
}
