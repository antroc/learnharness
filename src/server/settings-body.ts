/**
 * Los analizadores compartidos del cuerpo de los PUT de ajustes: una frontera
 * por superficie de ajustes. Extraídos tal cual de la ruta por chat (oleada de
 * ajustes por defecto, 2026-09-18): mismo análisis, mismos errores. Los
 * analizadores de sección (oleada de almacenamiento de ajustes, 2026-09-19)
 * siguen las mismas reglas de la casa.
 *
 * Semántica de reemplazo completo: el cliente envía la SECCIÓN deseada
 * completa; los campos ausentes son sustituciones ausentes ({} lo borra todo).
 * Sin fusiones, así que un cliente obsoleto nunca puede resucitar una
 * sustitución borrada. Las claves desconocidas del cuerpo se descartan (la
 * misma tolerancia que parseSettingsBody); las claves desconocidas EN DISCO
 * son otro asunto y el saneador las conserva (core/settings.ts).
 */

import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { isHexColor, type ChatSettings } from "../core";
import { COLOR_OVERRIDE_KEYS, isThemeId, type AppearanceColorOverrides, type ColorOverrideKey } from "../core/themes.ts";
import type {
	AgentSettings,
	AppearanceSettings,
	BackgroundModelRole,
	CompactionSettings,
	CustomModelOverride,
	GeneralSettings,
	DictationSettings,
	GraphSettings,
	ModelsSettings,
	ModelSlot,
	RoleModelOverride,
} from "../core/settings.ts";
import { BACKGROUND_MODEL_ROLES, CACHE_RETENTIONS, COMPACTION_THRESHOLD_FLOOR, CUSTOM_MODEL_PIN_FLOOR, EXTRACTION_CHUNK_TOKENS_FLOOR, MODEL_SLOTS } from "../core/settings.ts";
import { WRITABLE_TOOL_KEYS } from "../core/pending.ts";
import { isSearchEngineId, SEARCH_ENGINES } from "../core/search.ts";
import { isDictationLanguage } from "../core/dictation.ts";
import { parseFileAccessSettings } from "../core/file-access.ts";

/** Analizado o rechazado: `ok: false` lleva el mensaje de error del 400. */
export type SettingsBodyResult<T> =
	| { ok: true; settings: T }
	| { ok: false; error: string };

export function parseSettingsBody(body: unknown): SettingsBodyResult<ChatSettings> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { ok: false, error: "Invalid JSON body" };
	}
	const raw = body as {
		model?: { provider?: unknown; id?: unknown };
		thinkingLevel?: unknown;
	};
	const settings: ChatSettings = {};
	if (raw.model !== undefined) {
		if (
			typeof raw.model !== "object" ||
			raw.model === null ||
			typeof raw.model.provider !== "string" ||
			typeof raw.model.id !== "string"
		) {
			return { ok: false, error: "model must be {provider, id}" };
		}
		settings.model = { provider: raw.model.provider, id: raw.model.id };
	}
	if (raw.thinkingLevel !== undefined) {
		if (typeof raw.thinkingLevel !== "string") {
			return { ok: false, error: "thinkingLevel must be a string" };
		}
		settings.thinkingLevel = raw.thinkingLevel as ThinkingLevel;
	}
	// La oleada 7 eliminó la inyección del contexto del grafo (responsable: cero configuración
	// más allá de los modelos del chat; el sondeador lee ahora su mapa mediante herramientas);
	// su control de presupuesto desapareció con ella. A un cliente obsoleto que envíe la clave
	// antigua se le descarta aquí en silencio (compatible hacia delante, como cualquier clave desconocida).
	return { ok: true, settings };
}

// ─── Analizadores de sección (oleada de almacenamiento de ajustes, 2026-09-19) ───
// Un analizador por sección de settings.json; la ruta asocia la sección de la URL a
// su analizador mediante SETTINGS_SECTIONS, más abajo. La misma disciplina que
// parseSettingsBody: estricta con cada campo conocido (un tipo/forma incorrectos son
// un 400, nunca un acotado/descarte silencioso); las claves desconocidas se descartan.

function asRecord(body: unknown): Record<string, unknown> | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	return body as Record<string, unknown>;
}

/** general: { autoUpdate?: boolean } */
export function parseGeneralSettingsBody(body: unknown): SettingsBodyResult<GeneralSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: GeneralSettings = {};
	if (raw.autoUpdate !== undefined) {
		if (typeof raw.autoUpdate !== "boolean") {
			return { ok: false, error: "autoUpdate must be a boolean" };
		}
		settings.autoUpdate = raw.autoUpdate;
	}
	return { ok: true, settings };
}

/** claudeCode: opción explícita para toda la app. Una sección vacía la restablece a desactivada. */
export function parseClaudeCodeSettingsBody(body: unknown): SettingsBodyResult<{ enabled?: boolean }> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	if (raw.enabled === undefined) return { ok: true, settings: {} };
	if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
	return { ok: true, settings: { enabled: raw.enabled } };
}

/** agent.models: solo los seis roles en segundo plano conocidos; los campos
 *  de cada sustitución reflejan ChatSettings (par de modelo + thinkingLevel independiente). */
function parseRoleOverride(value: unknown, role: string): { ok: true; override: RoleModelOverride } | { ok: false; error: string } {
	const raw = asRecord(value);
	if (!raw) return { ok: false, error: `${role} must be an object` };
	const override: RoleModelOverride = {};
	if (raw.model !== undefined) {
		if (
			typeof raw.model !== "object" ||
			raw.model === null ||
			typeof (raw.model as Record<string, unknown>).provider !== "string" ||
			typeof (raw.model as Record<string, unknown>).id !== "string"
		) {
			return { ok: false, error: `${role}.model must be {provider, id}` };
		}
		override.model = {
			provider: (raw.model as { provider: string }).provider,
			id: (raw.model as { id: string }).id,
		};
	}
	if (raw.thinkingLevel !== undefined) {
		if (typeof raw.thinkingLevel !== "string") {
			return { ok: false, error: `${role}.thinkingLevel must be a string` };
		}
		override.thinkingLevel = raw.thinkingLevel as ThinkingLevel;
	}
	return { ok: true, override };
}

/** Un mapa de booleanos (interruptores de tools / prompts): todos los valores deben ser booleanos. */
function parseBooleanMap(value: unknown, field: string): { map?: Record<string, boolean>; error?: string } {
	if (value === undefined) return {};
	const raw = asRecord(value);
	if (!raw) return { error: `${field} must be an object` };
	const out: Record<string, boolean> = {};
	for (const [key, entry] of Object.entries(raw)) {
		if (typeof entry !== "boolean") return { error: `${field}.${key} must be a boolean` };
		out[key] = entry;
	}
	return { map: out };
}

/** agent: { workerRequestConcurrency?, models?, tools?, prompts? }; la validez de modelo/razonamiento
 *  frente al catálogo la comprueba la ruta (disciplina de validateChatSettings); la pertenencia de
 *  los prompts que se activan la comprueba la ruta (necesita el almacén). */
export function parseAgentSettingsBody(body: unknown): SettingsBodyResult<AgentSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: AgentSettings = {};
	if (raw.workerRequestConcurrency !== undefined) {
		if (typeof raw.workerRequestConcurrency !== "number" || !Number.isSafeInteger(raw.workerRequestConcurrency) || raw.workerRequestConcurrency <= 0) {
			return { ok: false, error: "workerRequestConcurrency must be a positive, safely representable whole number" };
		}
		settings.workerRequestConcurrency = raw.workerRequestConcurrency;
	}
	if (raw.models !== undefined) {
		const models = asRecord(raw.models);
		if (!models) return { ok: false, error: "models must be an object" };
		const known = BACKGROUND_MODEL_ROLES as readonly string[];
		const parsed: NonNullable<AgentSettings["models"]> = {};
		for (const [role, value] of Object.entries(models)) {
			if (!known.includes(role)) {
				return { ok: false, error: `unknown role "${role}" (supported: ${known.join(", ")})` };
			}
			const override = parseRoleOverride(value, role);
			if (!override.ok) return { ok: false, error: override.error };
			if (Object.keys(override.override).length) parsed[role as BackgroundModelRole] = override.override;
		}
		if (Object.keys(parsed).length) settings.models = parsed;
	}
	const tools = parseBooleanMap(raw.tools, "tools");
	if (tools.error) return { ok: false, error: tools.error };
	if (tools.map) {
		// Las claves de herramienta desconocidas se rechazan al ESCRIBIR (decisión del usuario
		// 2026-09-19): el delta es inerte mientras no se lee, pero en cuanto el puente lo
		// respete, una clave falsa persistida se desviaría. El conjunto escribible son las
		// herramientas de tareas + el interruptor de la mecánica de los quizzes (explain,
		// responsable 2026-09-27). El saneador del lado de lectura sigue siendo permisivo por
		// compatibilidad hacia delante.
		const supported = WRITABLE_TOOL_KEYS as readonly string[];
		for (const key of Object.keys(tools.map)) {
			if (!supported.includes(key)) {
				return { ok: false, error: `unknown tool "${key}" (supported: ${supported.join(", ")})` };
			}
		}
		settings.tools = tools.map;
	}
	const prompts = parseBooleanMap(raw.prompts, "prompts");
	if (prompts.error) return { ok: false, error: prompts.error };
	if (prompts.map) settings.prompts = prompts.map;
	if (raw.search !== undefined) {
		const search = asRecord(raw.search);
		if (!search) return { ok: false, error: "search must be an object" };
		if (search.engine !== undefined) {
			if (!isSearchEngineId(search.engine)) {
				return { ok: false, error: `search.engine must be ${SEARCH_ENGINES.map((engine) => `"${engine.id}"`).join(", ")}` };
			}
			settings.search = { engine: search.engine };
		}
	}
	// Herramientas de grafo del sondeador (oleada 7, decisión del responsable 2026-09-23): una
	// subsección de la sección agent, no una clave de los conmutadores de herramientas; el
	// mecanismo es una capacidad del agente (registro de herramientas) y el tema es el grafo.
	// Lado de escritura estricto: solo forma de objeto; `enabled` booleano si está. Ausente = ACTIVADO.
	if (raw.graphTools !== undefined) {
		const graphTools = asRecord(raw.graphTools);
		if (!graphTools) return { ok: false, error: "graphTools must be an object" };
		if (graphTools.enabled !== undefined && typeof graphTools.enabled !== "boolean") {
			return { ok: false, error: "graphTools.enabled must be a boolean" };
		}
		settings.graphTools = graphTools.enabled === undefined ? {} : { enabled: graphTools.enabled };
	}
	if (raw.fileAccess !== undefined) {
		const parsed = parseFileAccessSettings(raw.fileAccess);
		if (!parsed.ok) return parsed;
		if (parsed.settings.folders.some((folder) => folder !== "~" && !folder.startsWith("~/") && !path.isAbsolute(folder))) {
			return { ok: false, error: "fileAccess.folders must be absolute on the server filesystem (or start with ~/)" };
		}
		settings.fileAccess = parsed.settings;
	}
	return { ok: true, settings };
}

/** Un campo de color hexadecimal o null (colores de apariencia): null = por defecto. */
function parseHexOrNull(value: unknown, field: string): { color?: string | null; error?: string } {
	if (value === null) return { color: null };
	if (typeof value !== "string" || !isHexColor(value)) {
		return { error: `${field} must be a #hex color or null` };
	}
	return { color: value };
}

/** appearance: { theme?, background?, colors?, fontFamily?,
 *  proseFontSize?, codeLigatures?, sessionNameSerif?, mdRendering? };
 *  aquí se comprueba la forma de `theme` (slug); si EXISTE lo comprueba la ruta. */
export function parseAppearanceSettingsBody(body: unknown): SettingsBodyResult<AppearanceSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: AppearanceSettings = {};
	if (raw.theme !== undefined) {
		if (!isThemeId(raw.theme)) return { ok: false, error: "theme must be a theme id (lowercase slug)" };
		settings.theme = raw.theme;
	}
	if (raw.background !== undefined) {
		const parsed = parseHexOrNull(raw.background, "background");
		if (parsed.error) return { ok: false, error: parsed.error };
		settings.background = parsed.color ?? null;
	}
	if (raw.colors !== undefined) {
		const colors = asRecord(raw.colors);
		if (!colors) return { ok: false, error: "colors must be an object" };
		const out: AppearanceColorOverrides = {};
		for (const [key, value] of Object.entries(colors)) {
			if (!(COLOR_OVERRIDE_KEYS as readonly string[]).includes(key)) {
				return { ok: false, error: `unknown color "${key}" (supported: ${COLOR_OVERRIDE_KEYS.join(", ")})` };
			}
			const parsed = parseHexOrNull(value, `colors.${key}`);
			if (parsed.error) return { ok: false, error: parsed.error };
			out[key as ColorOverrideKey] = parsed.color ?? null;
		}
		settings.colors = out;
	}
	if (raw.fontFamily !== undefined) {
		if (raw.fontFamily !== null && (typeof raw.fontFamily !== "string" || !raw.fontFamily.trim())) {
			return { ok: false, error: "fontFamily must be a non-empty string or null" };
		}
		settings.fontFamily = raw.fontFamily as string | null;
	}
	if (raw.proseFontSize !== undefined) {
		if (
			typeof raw.proseFontSize !== "number" ||
			!Number.isInteger(raw.proseFontSize) ||
			raw.proseFontSize < 12 ||
			raw.proseFontSize > 24
		) {
			return { ok: false, error: "proseFontSize must be an integer between 12 and 24" };
		}
		settings.proseFontSize = raw.proseFontSize;
	}
	if (raw.codeLigatures !== undefined) {
		if (typeof raw.codeLigatures !== "boolean") {
			return { ok: false, error: "codeLigatures must be a boolean" };
		}
		settings.codeLigatures = raw.codeLigatures;
	}
	if (raw.sessionNameSerif !== undefined) {
		if (typeof raw.sessionNameSerif !== "boolean") {
			return { ok: false, error: "sessionNameSerif must be a boolean" };
		}
		settings.sessionNameSerif = raw.sessionNameSerif;
	}
	if (raw.mdRendering !== undefined) {
		const md = asRecord(raw.mdRendering);
		if (!md) return { ok: false, error: "mdRendering must be an object" };
		const rendering: NonNullable<AppearanceSettings["mdRendering"]> = {};
		if (md.headingWeight !== undefined) {
			if (
				typeof md.headingWeight !== "number" ||
				!Number.isInteger(md.headingWeight) ||
				md.headingWeight < 100 ||
				md.headingWeight > 900
			) {
				return { ok: false, error: "mdRendering.headingWeight must be an integer between 100 and 900" };
			}
			rendering.headingWeight = md.headingWeight;
		}
		if (md.boldColor !== undefined) {
			const parsed = parseHexOrNull(md.boldColor, "mdRendering.boldColor");
			if (parsed.error) return { ok: false, error: parsed.error };
			rendering.boldColor = parsed.color ?? null;
		}
		if (md.italicColor !== undefined) {
			const parsed = parseHexOrNull(md.italicColor, "mdRendering.italicColor");
			if (parsed.error) return { ok: false, error: parsed.error };
			rendering.italicColor = parsed.color ?? null;
		}
		if (Object.keys(rendering).length) settings.mdRendering = rendering;
	}
	return { ok: true, settings };
}

/** graph: la sección plegada { enabled? } (oleada 7, decisión del responsable
 *  2026-09-23): SOLO el interruptor general; los peldaños de
 *  embeddings/clustering/etiquetado y el embeddingModel BYOK murieron con el
 *  embedder del proveedor (el clustering es la partición gratuita por sesión
 *  de origen; las etiquetas son los nombres de las sesiones). Las claves con
 *  la forma antigua en un cuerpo se ignoran, no se rechazan. */
export function parseGraphSettingsBody(body: unknown): SettingsBodyResult<GraphSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	// Plegado de la oleada 7 (decisión del responsable 2026-09-23) + el rediseño de la UX
	// de extracción (2026-09-24): la sección es el interruptor general y el presupuesto de
	// fragmentos. El PUT reemplaza el conjunto: un cuerpo como {enabled: true} ES toda la
	// sección (extractionChunkTokens ausente = valor de fábrica al resolver); las claves de
	// los peldaños muertos en registros antiguos no se leen (el saneador las descarta; ver
	// sanitizeGraph).
	const settings: GraphSettings = {};
	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
		settings.enabled = raw.enabled;
	}
	if (raw.rendering !== undefined) {
		if (typeof raw.rendering !== "boolean") return { ok: false, error: "rendering must be a boolean" };
		settings.rendering = raw.rendering;
	}
	if (raw.extractionChunkTokens !== undefined) {
		if (typeof raw.extractionChunkTokens !== "number" || !Number.isFinite(raw.extractionChunkTokens)) {
			return { ok: false, error: "extractionChunkTokens must be a number" };
		}
		const floored = Math.floor(raw.extractionChunkTokens);
		if (floored < EXTRACTION_CHUNK_TOKENS_FLOOR) {
			// la justificación del mínimo está en GraphSettings.extractionChunkTokens: cada
			// ejecución paga la sobrecarga del prompt que lleva el grafo; los lotes de calderilla
			// cuestan más por token extraído de lo que vale el contenido.
			return {
				ok: false,
				error: `extractionChunkTokens must be at least ${EXTRACTION_CHUNK_TOKENS_FLOOR} (smaller batches waste the per-run graph overhead)`,
			};
		}
		settings.extractionChunkTokens = floored;
	}
	return { ok: true, settings };
}

/** models: { strong?, cheap?, vision? }: los niveles de ranura (oleada de
 *  ranuras de modelo, 2026-09-20). Cada ranura tiene la misma forma que una
 *  sustitución de rol; un objeto de ranura presente pero vacío se rechaza
 *  (ranura ausente = sin definir; di lo que quieres decir). La validez frente
 *  al catálogo la comprueba la ruta (disciplina de validateChatSettings). */
export function parseModelsSettingsBody(body: unknown): SettingsBodyResult<ModelsSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: ModelsSettings = {};
	for (const key of Object.keys(raw)) {
		const known = MODEL_SLOTS as readonly string[];
		if (!known.includes(key)) {
			return { ok: false, error: `unknown slot "${key}" (supported: ${known.join(", ")})` };
		}
		const parsed = parseRoleOverride(raw[key], key);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		// BYOK (responsable, 2026-09-22): una ranura ES una elección de modelo; no existe suelo
		// de fábrica, así que un thinkingLevel solo nunca puede ejecutarse; toda escritura de
		// ranura debe llevar el modelo (el nivel es un añadido opcional). Una clave de ranura
		// ausente borra el nivel (reemplazo completo de la sección).
		if (!parsed.override.model) {
			return { ok: false, error: `slot "${key}" must set a model (thinkingLevel alone cannot run — absent slot = unset)` };
		}
		const slot: ModelSlot = parsed.override;
		const retention = (raw[key] as Record<string, unknown>).cacheRetention;
		if (retention !== undefined) {
			if (!CACHE_RETENTIONS.some((value) => value === retention)) {
				return { ok: false, error: `${key}.cacheRetention must be none, short, or long` };
			}
			slot.cacheRetention = retention as ModelSlot["cacheRetention"];
		}
		settings[key as (typeof MODEL_SLOTS)[number]] = slot;
	}
	return { ok: true, settings };
}

/** compaction: contabilidad de razonamiento opcional (booleano, desactivada
 *  por defecto) y el presupuesto de tokens proyectados por encima del cual una
 *  sesión resume su propio historial en el marcador de compactación. Lado de
 *  escritura estricto: un thresholdTokens presente debe ser un número igual o
 *  superior al mínimo (el mínimo evita el bucle inútil: cada compactación
 *  conserva una cola reciente de unos 20k tokens, así que un umbral menor
 *  volvería a resumir la cola que acaba de escribir). Ausente = valor de
 *  fábrica de 150k al resolver. Reemplazo completo, como todas las secciones. */
export function parseCompactionSettingsBody(body: unknown): SettingsBodyResult<CompactionSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: CompactionSettings = {};
	if (raw.includeReasoning !== undefined) {
		if (typeof raw.includeReasoning !== "boolean") {
			return { ok: false, error: "includeReasoning must be true or false" };
		}
		settings.includeReasoning = raw.includeReasoning;
	}
	if (raw.thresholdTokens !== undefined) {
		if (typeof raw.thresholdTokens !== "number" || !Number.isFinite(raw.thresholdTokens)) {
			return { ok: false, error: "thresholdTokens must be a number" };
		}
		const floored = Math.floor(raw.thresholdTokens);
		if (floored < COMPACTION_THRESHOLD_FLOOR) {
			return {
				ok: false,
				error: `thresholdTokens must be at least ${COMPACTION_THRESHOLD_FLOOR} (compaction keeps a ~20k-token recent tail — smaller budgets would churn it)`,
			};
		}
		settings.thresholdTokens = floored;
	}
	return { ok: true, settings };
}

/** dictation: { language?: uno de los códigos de idioma admitidos por Nova-3 } */
export function parseDictationSettingsBody(body: unknown): SettingsBodyResult<DictationSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	if (raw.language === undefined) return { ok: true, settings: {} };
	if (!isDictationLanguage(raw.language)) return { ok: false, error: "Unsupported dictation language" };
	return { ok: true, settings: { language: raw.language } };
}

/** Las fijaciones por modelo del endpoint personalizado (PATCH
 *  /api/custom-provider): el mapa deseado completo, con reemplazo completo como
 *  en todas las secciones. Lado de escritura estricto: un recuento de tokens
 *  debe ser un número entero igual o superior al mínimo (el lado de lectura
 *  acota; este rechaza: la disciplina de la compactación). `reasoning` es la
 *  fijación de capacidad de tres estados, no un conmutador de ejecución del backend. */
export function parseCustomModelOverridesBody(
	body: unknown,
): SettingsBodyResult<Record<string, CustomModelOverride>> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const map = asRecord(raw.overrides);
	if (!map) return { ok: false, error: "overrides must be a { modelId: { context?, maxTokens?, reasoning? } } map" };
	const out: Record<string, CustomModelOverride> = {};
	for (const [key, value] of Object.entries(map)) {
		const id = key.trim();
		if (!id) return { ok: false, error: "override keys must be non-empty model ids" };
		const entry = asRecord(value);
		if (!entry) return { ok: false, error: `override for ${id} must be an object` };
		const pin: CustomModelOverride = {};
		for (const field of ["context", "maxTokens"] as const) {
			const v = entry[field];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isInteger(v) || v < CUSTOM_MODEL_PIN_FLOOR) {
				return {
					ok: false,
					error: `${field} for ${id} must be a whole number of tokens at least ${CUSTOM_MODEL_PIN_FLOOR}`,
				};
			}
			pin[field] = v;
		}
		if (entry.reasoning !== undefined) {
			if (typeof entry.reasoning !== "boolean") return { ok: false, error: `reasoning for ${id} must be true or false` };
			pin.reasoning = entry.reasoning;
		}
		Object.defineProperty(out, id, { value: pin, enumerable: true, configurable: true, writable: true });
	}
	return { ok: true, settings: out };
}

/** El mapa sección→analizador para PUT /api/settings/[section]. El endpoint
 *  personalizado NO es una sección: se conecta mediante POST /api/custom-provider. */
export const SETTINGS_SECTIONS = {
	general: parseGeneralSettingsBody,
	chat: parseSettingsBody,
	agent: parseAgentSettingsBody,
	appearance: parseAppearanceSettingsBody,
	graph: parseGraphSettingsBody,
	compaction: parseCompactionSettingsBody,
	models: parseModelsSettingsBody,
	dictation: parseDictationSettingsBody,
	claudeCode: parseClaudeCodeSettingsBody,
} as const;

export type SettingsSectionName = keyof typeof SETTINGS_SECTIONS;
