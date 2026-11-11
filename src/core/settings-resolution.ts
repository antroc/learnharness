/**
 * LA CAPA DE RESOLUCIÓN DE AJUSTES (oleada de almacenamiento de ajustes,
 * 2026-09-19): proyección pura del registro de deltas (UserSettings de
 * core/settings.ts) en EffectiveSettings — todos los campos CONCRETOS, listos
 * para los consumidores sin que tengan que recorrer deltas por su cuenta.
 *
 * Regla de resolución (decisión del responsable): gana el valor explícito del
 * registro; una clave ausente se resuelve al valor por defecto de fábrica
 * compilado — SALVO LOS MODELOS (BYOK hasta el fondo, responsable 2026-09-22): no
 * existen fijaciones de fábrica, así que una cadena de modelos que acaba vacía se
 * resuelve a null/undefined y lo que lo necesite se niega con honestidad (503
 * models_not_configured). Este módulo se mantiene puro y seguro para el
 * navegador, así que importa solo TIPOS de config, nunca el módulo de tiempo de
 * ejecución (config.ts arrastra node:path).
 *
 * Deliberadamente NO se resuelve aquí (ver la documentación del módulo settings.ts):
 * - las sustituciones por chat: los ChatSettings del registro del chat se aplican
 *   mediante la cadena de conversación en chat-handler (chat.model → ranura
 *   fuerte) — el sondeador y el profesor siguen controlados por el chat, nunca
 *   por el registro de ajustes;
 * - los interruptores de herramientas: se pasan tal cual como mapa de deltas;
 *   los consumidores buscan por id de herramienta con ausente → activada (el
 *   cumplimiento vive en la banda del agente);
 * - los interruptores de prompts: se pasan tal cual; la composición efectiva
 *   vive en src/store/prompt-overrides.ts (lista de segmentos derivada del
 *   código fuente).
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelRole } from "../../config.ts";
import type { ChatSettings } from "./contracts/chat.ts";
import type { SearchEngineId } from "./search.ts";
import {
	BACKGROUND_MODEL_ROLES,
	FACTORY_SETTINGS,
	MODEL_SLOTS,
	ROLE_SLOT,
	type AgentSettings,
	type BackgroundModelRole,
	type FactorySettings,
	type GeneralSettings,
	type DictationSettings,
	type CompactionSettings,
	type CustomModel,
	type CustomModelOverride,
	type GraphSettings,
	type ModelSlot,
	type ModelSlotName,
	type RoleModelOverride,
	type UserSettings,
} from "./settings.ts";

/** Una ranura de modelo configurada: el modelo concreto del nivel, con su nivel de
 * razonamiento opcional. Un nivel SIN FIJAR es válido — la construcción del motor lo
 * resuelve a partir de DEFAULT_THINKING_ORDER de config.ts (la primera entrada que
 * admite el modelo; responsable, 2026-09-22). Una ranura está CONFIGURADA si y solo si
 * su modelo está presente; una ranura con solo el nivel es inerte (se conserva en
 * disco y se resuelve como null). */
export interface EffectiveSlot {
	cacheRetention?: ModelSlot["cacheRetention"];
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

/** Una fijación de modelo totalmente resuelta para un rol — misma forma y misma
 * semántica de nivel que EffectiveSlot; undefined significa que toda la cadena del
 * rol ha salido vacía y lo que lo necesite se niega con honestidad. */
export interface EffectiveModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

/** La vista concreta de la apariencia — misma forma que la de fábrica. */
export type EffectiveAppearance = FactorySettings["appearance"];

/** La vista concreta: todos los parámetros resueltos, sin campos ausentes. */
export interface EffectiveSettings {
	general: Required<GeneralSettings>;
	dictation: Required<DictationSettings>;
	agent: {
		workerRequestConcurrency: number;
		models: Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
		/** Mapa de deltas tal como se guarda — los consumidores resuelven clave ausente → activada. */
		tools: Record<string, boolean>;
		/** Mapa de deltas tal como se guarda — clave ausente → sustitución desactivada. */
		prompts: Record<string, boolean>;
		/** La preferencia de motor de búsqueda tal como se guarda (oleada de búsqueda,
		 * 2026-09-20): delta que se pasa tal cual — la resolución del motor (fijado →
		 * automático → no disponible) vive en server/search.ts, donde las claves son visibles. */
		search: { engine?: SearchEngineId };
		/** Herramientas del grafo del sondeador (oleada 7): delta que se pasa tal cual —
		 * enabled ausente/undefined = ACTIVADO; los consumidores usan graphToolsEnabled. */
		graphTools: { enabled?: boolean };
	};
	/** Las ranuras fuerte/barata/visión resueltas: el modelo concreto de cada nivel o
	 * NULL si el nivel no tiene modelo (sin suelo de fábrica — BYOK hasta el fondo,
	 * responsable 2026-09-22). Son las vistas por nivel que leen los rótulos del selector
	 * y las barreras de rechazo por necesidad. */
	models: Record<ModelSlotName, EffectiveSlot | null>;
	appearance: EffectiveAppearance;
	graph: Required<GraphSettings>;
	/** Compactación (ronda 14 del responsable): resuelta y concreta — una sección
	 * ausente del registro se resuelve a los 150k de fábrica. */
	compaction: Required<CompactionSettings>;
	/** Endpoint personalizado, resuelto y concreto: baseUrl por defecto "", y los
	 * modelos y las fijaciones del usuario, vacíos por defecto. */
	customProvider: { baseUrl: string; models: CustomModel[]; overrides: Record<string, CustomModelOverride>; manualModels: string[] };
}

/** La cadena del par de conversación (BYOK, responsable 2026-09-22): la sustitución de
 * modelo propia del chat sobre la ranura FUERTE, cada campo independiente (un nivel de
 * razonamiento suelto del chat va con el modelo de la ranura fuerte). null = no hay
 * modelo en ninguna parte — la barrera del turno se niega con el sobre 503
 * models_not_configured. */
export function resolveConversationSpec(
	chat: ChatSettings | undefined,
	strong: EffectiveSlot | null,
): EffectiveModelSpec | null {
	const model = chat?.model ?? (strong ? { provider: strong.provider, id: strong.id } : undefined);
	if (!model) return null;
	return {
		provider: model.provider,
		id: model.id,
		thinkingLevel: chat?.thinkingLevel ?? strong?.thinkingLevel,
	};
}

/** Preguntas laterales (#16): la cadena de conversación propia del chat, bajo la
 * sustitución opcional agent.models.sideQuestion (campo a campo). */
export function resolveSideQuestionSpec(chat: ChatSettings | undefined, record: UserSettings | null): EffectiveModelSpec | null {
	const conversation = resolveConversationSpec(chat, resolveSlot(record?.models?.strong));
	const override = record?.agent?.models?.sideQuestion;
	const model = override?.model ?? (conversation ? { provider: conversation.provider, id: conversation.id } : undefined);
	if (!model) return null;
	return { provider: model.provider, id: model.id, thinkingLevel: override?.thinkingLevel ?? conversation?.thinkingLevel };
}

/** Resolución de la cadena completa para CUALQUIER rol (BYOK, responsable 2026-09-22):
 * sustitución por rol (solo roles en segundo plano) → RANURA → NADA. El par de
 * conversación (sondeador/profesor) resuelve la misma cadena SIN la sustitución por
 * rol (su sustitución son los ajustes propios del chat — chat-handler los superpone
 * él mismo). undefined = la cadena ha salido vacía; las barreras de rechazo por
 * necesidad saltan justo con eso. Esta es la única llamada del cableado del motor. */
export function resolveRoleSpec(role: ModelRole, record: UserSettings | null): EffectiveModelSpec | undefined {
	const bg = BACKGROUND_MODEL_ROLES as readonly string[];
	const override = bg.includes(role) ? record?.agent?.models?.[role as BackgroundModelRole] : undefined;
	return resolveModelSpec(role, override, record?.models);
}

/** Resuelve una ranura a su vista configurada, o null si el nivel no tiene modelo
 * (una ranura con solo thinkingLevel es inerte — sin el suelo de fábrica, el nivel
 * no tiene a qué acompañar). */
export function resolveSlot(slot: ModelSlot | undefined): EffectiveSlot | null {
	if (!slot?.model) return null;
	return {
		provider: slot.model.provider, id: slot.model.id, thinkingLevel: slot.thinkingLevel,
		...(slot.cacheRetention !== undefined ? { cacheRetention: slot.cacheRetention } : {}),
	};
}

/** Resuelve la especificación de un rol — la cadena BYOK (responsable 2026-09-22):
 * sustitución del rol → RANURA → NADA, cada campo independiente (una sustitución
 * puede tomar solo el modelo de la ranura, o solo su presupuesto de razonamiento —
 * un nivel sin modelo en ninguna parte se queda sin fijar y la construcción del
 * motor lo resuelve a partir de DEFAULT_THINKING_ORDER). undefined = no se ha
 * resuelto ningún modelo; las barreras de rechazo por necesidad saltan justo con eso. */
export function resolveModelSpec(
	role: ModelRole,
	override: RoleModelOverride | undefined,
	slots?: Partial<Record<ModelSlotName, ModelSlot>>,
): EffectiveModelSpec | undefined {
	const slotName = ROLE_SLOT[role] as ModelSlotName | undefined;
	const slot = slotName ? slots?.[slotName] : undefined;
	const model = override?.model ?? slot?.model;
	if (!model) return undefined;
	return {
		provider: model.provider,
		id: model.id,
		thinkingLevel: override?.thinkingLevel ?? slot?.thinkingLevel,
	};
}

/** Resuelve el registro entero. `record` puede ser null (primer arranque) — cada campo
 * con valor de fábrica toma su valor por defecto; los campos de MODELO se resuelven a
 * null/undefined si no están fijados (no existen fijaciones de fábrica — BYOK hasta el
 * fondo, responsable 2026-09-22). */
export function resolveSettings(record: UserSettings | null): EffectiveSettings {
	const agent = record?.agent ?? {};
	const modelsSection = record?.models ?? {};
	const appearance = record?.appearance ?? {};
	const md = appearance.mdRendering ?? {};
	const graph = record?.graph ?? {};
	const factoryAppearance = FACTORY_SETTINGS.appearance;
	const factoryMd = factoryAppearance.mdRendering;
	const models = {} as Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
	for (const role of BACKGROUND_MODEL_ROLES) {
		models[role] = resolveModelSpec(role, agent.models?.[role], modelsSection);
	}
	return {
		general: {
			autoUpdate: record?.general?.autoUpdate ?? FACTORY_SETTINGS.general.autoUpdate,
		},
		dictation: {
			language: record?.dictation?.language ?? FACTORY_SETTINGS.dictation.language,
		},
		agent: {
			workerRequestConcurrency: agent.workerRequestConcurrency ?? FACTORY_SETTINGS.agent.workerRequestConcurrency,
			models,
			tools: agent.tools ?? {},
			prompts: agent.prompts ?? {},
			search: agent.search ?? {},
			graphTools: agent.graphTools ?? {},
		},
		models: {
			strong: resolveSlot(modelsSection.strong),
			cheap: resolveSlot(modelsSection.cheap),
			vision: resolveSlot(modelsSection.vision),
		},
		appearance: {
			theme: appearance.theme ?? factoryAppearance.theme,
			background: appearance.background ?? factoryAppearance.background,
			colors: appearance.colors ?? factoryAppearance.colors,
			fontFamily: appearance.fontFamily ?? factoryAppearance.fontFamily,
			proseFontSize: appearance.proseFontSize ?? factoryAppearance.proseFontSize,
			codeLigatures: appearance.codeLigatures ?? factoryAppearance.codeLigatures,
			sessionNameSerif: appearance.sessionNameSerif ?? factoryAppearance.sessionNameSerif,
			mdRendering: {
				headingWeight: md.headingWeight ?? factoryMd.headingWeight,
				boldColor: md.boldColor ?? factoryMd.boldColor,
				italicColor: md.italicColor ?? factoryMd.italicColor,
			},
		},
		graph: {
			// Colapso de la oleada 7 (decisión del responsable, 2026-09-23): SOLO el interruptor
			// general — los escalones de embeddings/agrupación/etiquetado y el embeddingModel BYOK
			// han desaparecido (las claves obsoletas del registro simplemente no se leen aquí).
			enabled: graph.enabled ?? FACTORY_SETTINGS.graph.enabled,
			// El interruptor de RENDERIZADO (responsable, 2026-10-06): solo de visualización —
			// decide la vista principal del inicio (lienzo o cadenas), nunca los datos.
			rendering: graph.rendering ?? FACTORY_SETTINGS.graph.rendering,
			// El presupuesto de fragmentos (rediseño de la UX de extracción, 2026-09-24): si falta
			// (registro anterior al rediseño, instalación nueva) se resuelve a los 4096 de fábrica;
			// el saneador ya ha acotado/redondeado a la baja cualquier valor guardado.
			extractionChunkTokens: graph.extractionChunkTokens ?? FACTORY_SETTINGS.graph.extractionChunkTokens,
		},
		compaction: {
			thresholdTokens: record?.compaction?.thresholdTokens ?? FACTORY_SETTINGS.compaction.thresholdTokens,
			includeReasoning: record?.compaction?.includeReasoning ?? FACTORY_SETTINGS.compaction.includeReasoning,
		},
		customProvider: {
			baseUrl: record?.customProvider?.baseUrl ?? "",
			models: record?.customProvider?.models ?? [],
			overrides: record?.customProvider?.overrides ?? {},
			manualModels: record?.customProvider?.manualModels ?? [],
		},
	};
}

// ─── Barreras de los canales del grafo (cumplimiento en la frontera de la oleada de ajustes) ──

/**
 * La barrera del canal de ESCRITURA (extracción + su auditor): muere con el
 * interruptor general. La usa el disparador posterior al turno de chat-handler.
 * (Oleada 7: el interruptor general es el ÚNICO ajuste del grafo que queda — la
 * sección se colapsó.)
 */
export function extractionEnabled(graph: { enabled: boolean }): boolean {
	return graph.enabled;
}

/**
 * La barrera de RENDERIZADO (responsable, 2026-10-06): grafo desactivado = el inicio
 * muestra la vista de cadenas, no el lienzo. Solo de visualización por construcción —
 * ninguna ruta de datos (registros, extracción, herramientas) la consulta nunca.
 */
export function renderingEnabled(graph: { rendering: boolean }): boolean {
	return graph.rendering;
}

/**
 * La barrera de las HERRAMIENTAS DEL GRAFO DEL SONDEADOR (oleada 7, decisión del
 * responsable, 2026-09-23): el interruptor es de capacidad del agente (decide el
 * registro de herramientas), pero las herramientas solo tienen sentido cuando el
 * propio grafo funciona — así que la barrera efectiva combina el interruptor
 * general del grafo Y el interruptor.
 */
export function graphToolsEnabled(effective: {
	graph: { enabled: boolean };
	agent: { graphTools: { enabled?: boolean } };
}): boolean {
	return effective.graph.enabled && (effective.agent.graphTools.enabled ?? true);
}


