/**
 * La superficie del catálogo de modelos en el servidor (oleada de control de
 * modelos, 2026-09-12; federado desde la oleada de ranuras de modelo,
 * 2026-09-20): el catálogo de pi-ai de cada proveedor CON CLAVE, proyectado a
 * DTO seguros para el cliente para el selector (GET /api/models), más la
 * barrera de validación de las escrituras de ajustes (PUT /api/settings/*; el
 * PUT de ajustes por chat ya no lo usa la interfaz; las sustituciones por chat
 * de los registros heredados se siguen resolviendo en el servidor).
 *
 * pi-ai es dueño de TODOS los datos: el catálogo (id/name/cost/context/
 * modality/thinkingLevelMap) y la verdad sobre el razonamiento de cada modelo
 * (getSupportedThinkingLevels / clampThinkingLevel). Este módulo solo
 * proyecta y valida: no hay un segundo registro que se desincronice.
 *
 * Federación: `getModels()` se llama por cada proveedor con clave (federado,
 * oleada de ranuras de modelo), así que un proveedor aparece en el selector
 * exactamente cuando su clave está presente; piModels() de
 * src/agent/models.ts es dueño del conjunto de proveedores; aquí no cambia nada.
 */

import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { piModels } from "../agent/models.ts";
import { customProviderAvailable } from "./custom-provider.ts";
import { chatGPTConnected, chatGPTModel, chatGPTModels, refreshChatGPTModels } from "../agent/chatgpt-bridge.ts";
import { NATIVE_SUBSCRIPTIONS } from "../core/contracts/subscriptions.ts";
import { nativeSubscriptionId, nativeSubscriptionConnected, nativeSubscriptionModel, nativeSubscriptionModels, refreshSubscriptionModels } from "../agent/subscription-bridge.ts";

export async function refreshConnectionCatalog(provider?: string): Promise<void> {
	await Promise.all([
		!provider || provider === "chatgpt" ? refreshChatGPTModels(piModels().getModels("openai").filter((m): m is Model<"openai-responses"> => m.api === "openai-responses")) : Promise.resolve(),
		!provider || nativeSubscriptionId(provider) ? refreshSubscriptionModels() : Promise.resolve(),
	]);
}
function connectionModel(provider: string, id: string): Model<Api> | undefined {
	if (provider === CLAUDE_CODE_PROVIDER && !claudeCodeAvailable()) return undefined;
	return provider === "chatgpt" ? chatGPTModel(id) : nativeSubscriptionId(provider) ? nativeSubscriptionModel(provider, id) : piModels().getModel(provider, id);
}
function connectionProviderIds(): string[] { return [...piModels().getProviders().map((p) => p.id), "chatgpt", ...NATIVE_SUBSCRIPTIONS.map((p) => p.logicalId)]; }
import { settingsStore } from "../store/settings.ts";
import { effectiveSettings } from "./stores.ts";
import { keyValue } from "./keys.ts";
import type { ChatSettings } from "../core/contracts/chat.ts";
import type {
	CatalogDefaults,
	CatalogProvider,
	ModelCatalogEntry,
	ModelCatalogResponse,
	RolePins,
	SlotPins,
} from "../core/contracts/models.ts";
import type { EffectiveModelSpec, EffectiveSlot } from "../core/settings-resolution.ts";
import { AUTH_PROVIDER_KEYS, CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";
import {
	BACKGROUND_MODEL_ROLES,
	MODEL_SLOTS,
	customProviderUsable,
	type BackgroundModelRole,
	type ModelSlotName,
	type ModelsSettings,
} from "../core/settings.ts";

/** La entrada de modelo del selector segura para el cliente (contrato: core/contracts/models.ts). */
export type ModelDto = ModelCatalogEntry;

/**
 * El valor por defecto resuelto de los agentes de conversación (forma pura:
 * entra la ranura potente y sale CatalogDefaults; `catalogDefaults()` de más
 * abajo es el envoltorio con el sistema de ficheros). MODELOS POR SESIÓN
 * (responsable, 2026-09-28): cada sesión es dueña de su modelo + nivel de
 * razonamiento desde que nace, sellados tal cual desde la ranura potente: LA
 * RANURA POTENTE ES EL VALOR POR DEFECTO DE LAS SESIONES NUEVAS, y la
 * alternativa al resolver para los registros heredados sin ajustes. BYOK
 * (responsable, 2026-09-22): no hay suelo de fábrica; si la ranura potente no
 * nombra ningún modelo, el valor por defecto es NULL y la barrera del turno lo
 * rechaza con el sobre 503 models_not_configured. Un thinkingLevel sin definir
 * se resuelve a partir de DEFAULT_THINKING_ORDER al construir el motor (aquí
 * se indica como ausente).
 */
export function catalogDefaultsFor(
	strong: EffectiveSlot | null,
): CatalogDefaults | null {
	const model = strong ? { provider: strong.provider, id: strong.id } : undefined;
	if (!model) return null;
	const level = strong?.thinkingLevel;
	return {
		model,
		...(level !== undefined ? { thinkingLevel: level } : {}),
	};
}

/** El valor por defecto resuelto de los agentes de conversación (lo que
 *  ejecuta un chat sin ajustes): la ranura potente, es decir, el valor de
 *  nacimiento de las sesiones nuevas. */
export function catalogDefaults(): CatalogDefaults | null {
	return catalogDefaultsFor(effectiveSettings().models.strong);
}

/** Proyecta las especificaciones resueltas por rol al DTO del cliente (puro;
 *  lo lee el rótulo "Default: <modelo fijado real>" de la interfaz de
 *  ajustes). BYOK (responsable, 2026-09-22): una cadena vacía se proyecta como
 *  NULL; el rótulo muestra con honestidad "not configured", nunca un valor por
 *  defecto fantasma. */
export function rolePinsFor(
	models: Record<BackgroundModelRole, EffectiveModelSpec | undefined>,
): RolePins {
	const pins = {} as RolePins;
	for (const role of BACKGROUND_MODEL_ROLES) {
		const spec = models[role];
		pins[role] = spec
			? {
					model: { provider: spec.provider, id: spec.id },
					...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
				}
			: null;
	}
	return pins;
}

/** Las fijaciones RESUELTAS de los roles en segundo plano: la sustitución de
 *  agent-models del usuario → ranura del nivel → nada; la misma resolución que
 *  usa el cableado de los agentes (effectiveSettings de src/server/stores.ts),
 *  así que el rótulo nunca puede desviarse de lo que se ejecuta de verdad. */
export function catalogRolePins(): RolePins {
	return rolePinsFor(effectiveSettings().agent.models);
}

/** Las fijaciones RESUELTAS de los tres niveles de ranura:
 *  effectiveSettings().models tal cual; la misma resolución que usa el
 *  cableado de los motores, así que los rótulos de la página de ajustes de
 *  modelos no pueden desviarse de lo que se ejecuta de verdad. NULL en cada
 *  nivel que no tenga modelo. */
export function catalogSlots(): SlotPins {
	const slots = effectiveSettings().models;
	const pins = {} as SlotPins;
	for (const name of ["strong", "cheap", "vision"] as const) {
		const slot: EffectiveSlot | null = slots[name];
		pins[name] = slot
			? {
					model: { provider: slot.provider, id: slot.id },
					...(slot.thinkingLevel !== undefined ? { thinkingLevel: slot.thinkingLevel } : {}),
					...(slot.cacheRetention !== undefined ? { cacheRetention: slot.cacheRetention } : {}),
				}
			: null;
	}
	return pins;
}

/** La superficie de proveedores (oleada de ranuras de modelo, 2026-09-20): una
 *  fila por proveedor de modelos con clave simple (la tabla de
 *  core/auth-keys.ts derivada de pi-ai), con keyPresent leído con prioridad
 *  del entorno mediante la frontera de claves, de nuevo en cada llamada:
 *  guardar una clave federa al momento el proveedor en el selector. */
export function catalogProviders(): CatalogProvider[] {
	piModels();
	return AUTH_PROVIDER_KEYS.map((p) => ({
		id: p.id,
		envVar: p.envVar,
		keyPresent: keyValue(p.envVar) !== undefined,
	})).concat([
		{ id: "chatgpt", envVar: "", keyPresent: chatGPTConnected() },
		{ id: CLAUDE_CODE_PROVIDER, envVar: "", keyPresent: claudeCodeAvailable() },
		...NATIVE_SUBSCRIPTIONS.map((p) => ({ id: p.logicalId, envVar: "", keyPresent: nativeSubscriptionConnected(p.providerId) })),
		// El endpoint personalizado: una fila solo si es utilizable (URL base definida). keyPresent
		// refleja que es utilizable, no la presencia de clave (se permiten servidores locales sin clave).
		...(customProviderUsable(effectiveSettings().customProvider)
			? [{ id: CUSTOM_PROVIDER.id, envVar: CUSTOM_PROVIDER.envVar, keyPresent: customProviderAvailable() }]
			: []),
	]).sort((a, b) => a.id.localeCompare(b.id));
}

/** Los proveedores cuya clave está presente; el selector federa exactamente
 *  estos (los modelos de un proveedor sin clave son inalcanzables por diseño;
 *  la página de claves es la superficie de descubrimiento, con la misma
 *  disciplina que la búsqueda). */
function keyedProviderIds(): Set<string> {
	return new Set(catalogProviders().filter((p) => p.keyPresent).map((p) => p.id));
}

/** Proyecta un modelo del catálogo al DTO del cliente. */
export function toModelDto(model: Model<Api>): ModelDto {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		reasoning: model.reasoning,
		input: [...model.input],
		supportedLevels: getSupportedThinkingLevels(model),
		cost: model.provider === CLAUDE_CODE_PROVIDER || model.provider === CUSTOM_PROVIDER.id ? null : {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cacheRead,
			cacheWrite: model.cost.cacheWrite,
		},
		contextWindow: model.provider === CLAUDE_CODE_PROVIDER ? null : model.contextWindow,
		maxTokens: model.provider === CLAUDE_CODE_PROVIDER ? null : model.maxTokens,
	};
}

/** El índice de límites vivos (enmienda del medidor de contexto, responsable
 *  2026-09-23): proveedor:id → contextWindow del catálogo de pi, sobre los
 *  MISMOS proveedores con clave que federa el selector. Se excluyen los alias
 *  nativos de CLI: solo un informe de la CLI propio de la sesión puede aportar
 *  su denominador. Para los demás modelos, la unión de la barra de
 *  estadísticas tiene la copia de /api/models, y el feed de actividad
 *  (observability.ts) resuelve con esto los límites de las tareas en el
 *  servidor. No existe ninguna alternativa fija en ningún sitio: un modelo que
 *  falte aquí se lee con límite null (solo uso, renderizado honesto). */
export function catalogContextLimits(): Map<string, number> {
	const keyed = keyedProviderIds();
	const index = new Map<string, number>();
	for (const provider of piModels().getProviders()) {
		if (!keyed.has(provider.id) || provider.id === CLAUDE_CODE_PROVIDER) continue;
		for (const model of piModels().getModels(provider.id)) {
			index.set(`${provider.id}:${model.id}`, model.contextWindow);
		}
	}
	for (const model of [...chatGPTModels(), ...nativeSubscriptionModels()]) index.set(`${model.provider}:${model.id}`, model.contextWindow);
	return index;
}

/** La carga completa del selector: todos los modelos de todos los
 *  proveedores configurados (ordenados por proveedor y luego por id: estable y
 *  fácil de comparar) + los valores por defecto de configuración que ejecuta un
 *  chat sin ajustes + las fijaciones resueltas de los roles en segundo plano
 *  (los rótulos de valor por defecto por rol de la interfaz de ajustes). */
export function modelCatalog(): ModelCatalogResponse {
	const keyed = keyedProviderIds();
	const models = piModels()
		.getProviders()
		.filter((p) => keyed.has(p.id))
		.flatMap((p) => piModels().getModels(p.id))
		.map(toModelDto)
		.sort((a, b) => (a.provider === b.provider ? a.id.localeCompare(b.id) : a.provider.localeCompare(b.provider)))
		.concat([...chatGPTModels(), ...nativeSubscriptionModels()].map(toModelDto));
	return {
		models,
		defaults: catalogDefaults(),
		rolePins: catalogRolePins(),
		slots: catalogSlots(),
		providers: catalogProviders(),
	};
}

/** Un resultado validado para una escritura de ajustes. */
export type SettingsValidation =
	| { ok: true }
	| { ok: false; error: string; supported?: ThinkingLevel[] };

/** Valida una escritura del selector frente al catálogo (la barrera de la ruta
 *  de ajustes). `settings` reemplaza el conjunto: los campos ausentes
 *  significan "valor por defecto de la configuración".
 *  - model: el proveedor debe estar configurado y el id debe existir en su catálogo.
 *  - thinkingLevel: debe estar en la lista admitida del modelo resuelto, el
 *    modelo contra el que escribe el selector (settings.model o, si no, la
 *    fijación prober/teacher de la configuración; un solo control, así que las
 *    dos especificaciones lo comparten). */
export function validateChatSettings(settings: ChatSettings): SettingsValidation {
	const providers = connectionProviderIds();
	if (settings.model) {
		const { provider, id } = settings.model;
		if (!providers.includes(provider)) {
			return { ok: false, error: `Unknown provider "${provider}" — configured: ${providers.join(", ")}` };
		}
		if (!connectionModel(provider, id)) {
			return { ok: false, error: `No model "${id}" in the ${provider} catalog` };
		}
	}
	// Interludio BYOK (responsable, 2026-09-22): los niveles de razonamiento NUNCA rechazan
	// una escritura; un cambio de modelo con un nivel fijado SIMPLEMENTE FUNCIONA. La
	// ESCRITURA acota la fijación al nivel admitido más cercano del modelo nuevo
	// (clampChatLevel de abajo, aplicado por las rutas) y guarda el resultado acotado; un
	// nivel suelto sin modelo en ningún sitio pasa sin comprobar y se acota contra lo que
	// tenga después la cadena al construir el motor.
	return { ok: true };
}

/** Valida las selecciones de modelo introducidas/sustituidas, no las fijaciones guardadas sin cambios.
 * Una suscripción desconectada pierde su catálogo disponible, pero sus selecciones guardadas no deben
 * impedir reparar otra ranura o editar el razonamiento. Solo puede pasar el proveedor+id de la MISMA
 * ranura; la admisión en ejecución sigue siendo independiente. Los llamantes sin sección guardada
 * mantienen la comprobación estricta contra el catálogo. */
export function validateModelsSettings(settings: ModelsSettings, stored?: ModelsSettings): SettingsValidation {
	for (const name of MODEL_SLOTS) {
		const slot = settings[name];
		if (!slot) continue;
		const previous = stored?.[name]?.model;
		if (slot.model && previous && slot.model.provider === previous.provider && slot.model.id === previous.id) continue;
		const verdict = validateSlotSpec(name, slot);
		if (!verdict.ok) return verdict;
	}
	return { ok: true };
}

function validateSlotSpec(name: ModelSlotName, slot: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel }): SettingsValidation {
	const providers = connectionProviderIds();
	if (slot.model) {
		const { provider, id } = slot.model;
		if (!providers.includes(provider)) {
			return { ok: false, error: `Unknown provider "${provider}" — configured: ${providers.join(", ")}` };
		}
		if (!connectionModel(provider, id)) {
			return { ok: false, error: `No model "${id}" in the ${provider} catalog` };
		}
	}
	// Interludio BYOK (responsable, 2026-09-22): el veredicto de nivel admitido está
	// MUERTO; una escritura de ranura con un nivel fijado nunca se rechaza; la ESCRITURA
	// acota el nivel al admitido más cercano del modelo (clampModelsLevels de abajo,
	// aplicado por la ruta) y guarda el resultado acotado.
	return { ok: true };
}

// ─── acotar al escribir (decisión del responsable, interludio 2026-09-22) ────
// Un cambio de modelo con un nivel de razonamiento fijado debe SIMPLEMENTE FUNCIONAR:
// la fijación se traduce al nivel admitido más cercano del modelo nuevo (el
// clampThinkingLevel de pi, la MISMA traducción que aplica piEngineForSpec en
// ejecución) y el valor acotado es lo que se guarda en el registro. El servidor es
// la verdad: el registro muestra el nivel acotado tras la escritura.

/** Acota un nivel frente a un modelo. Conserva la preferencia cuando no hay metadatos
 *  para una fijación guardada sin cambios; en ejecución se acota tras reconectar. */
function clampLevelFor(provider: string, id: string, level: ThinkingLevel): ThinkingLevel {
	const model = connectionModel(provider, id);
	return model ? clampThinkingLevel(model, level) : level;
}

/** La traducción de niveles de la escritura de la sección de modelos: el
 *  thinkingLevel fijado de cada ranura se acota frente al PROPIO modelo de la
 *  ranura (el analizador exige un modelo en cada escritura de ranura;
 *  responsable, 2026-09-22). Puro: entra el catálogo, sale la sección acotada;
 *  la ruta lo aplica tras la validación. */
export function clampModelsLevels(settings: ModelsSettings): ModelsSettings {
	const out: ModelsSettings = {};
	for (const name of MODEL_SLOTS) {
		const slot = settings[name];
		if (!slot?.model) continue;
		out[name] =
			slot.thinkingLevel !== undefined
				? {
						...slot,
						thinkingLevel: clampLevelFor(slot.model.provider, slot.model.id, slot.thinkingLevel),
					}
				: slot;
	}
	return out;
}

/** La traducción de niveles de la escritura de la sección del chat: un
 *  thinkingLevel fijado se acota frente al propio modelo del cuerpo o, si no,
 *  frente a la ranura potente resuelta del registro (la alternativa de la
 *  cadena de conversación: lo que ejecutaría un chat sin ajustes). Sin modelo
 *  en ningún sitio → pasa sin comprobar (se acota en ejecución al construir el
 *  motor; de todos modos, la barrera del turno rechaza el chat sin modelo). */
export function clampChatLevel(settings: ChatSettings, strong: EffectiveSlot | null): ChatSettings {
	if (settings.thinkingLevel === undefined) return settings;
	const provider = settings.model?.provider ?? strong?.provider;
	const id = settings.model?.id ?? strong?.id;
	if (!provider || !id) return settings;
	return { ...settings, thinkingLevel: clampLevelFor(provider, id, settings.thinkingLevel) };
}
