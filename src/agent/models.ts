import {
	clampThinkingLevel,
	createModels,
	getSupportedThinkingLevels,
	type Api,
	type CacheRetention,
	type Model,
	type Models,
	type MutableModels,
	type StreamFunction,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { lazyApi, lazyStream } from "@earendil-works/pi-ai/api/lazy";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type ModelRole } from "../../config.ts";
import { DEFAULT_THINKING_ORDER } from "../core/settings.ts";
import packageMetadata from "../../package.json" with { type: "json" };
import { chatGPTModel } from "./chatgpt-bridge.ts";
import { chatGPTStream } from "./chatgpt-stream.ts";
import type { ChatGPTDispatchLifecycle } from "./chatgpt-request-cycle.ts";
import { createClaudeCodeProvider } from "./claude-code/provider.ts";
import { streamClaudeCode } from "./claude-code/stream.ts";
import { nativeSubscriptionId, nativeSubscriptionModel } from "./subscription-bridge.ts";
import { nativeSubscriptionStream } from "./subscription-stream.ts";

/** La identidad de la app es inmutable y la comparten Models y todos los Agent nativos.
 * De lo contrario, la atribución a Pi por defecto de Agent sustituye a la identidad de Models. */
export const APP_IDENTITY = Object.freeze({
	userAgent: Object.freeze({ custom: `learnharness/${packageMetadata.version}` }),
	attribution: Object.freeze({ name: packageMetadata.name, url: packageMetadata.homepage }),
});

/**
 * La única factoría de motores de la que sale el modelo de cada agente (el cambio a pi-ai,
 * docs/archive/pi-engine-swap.md). BYOK HASTA EL FONDO (propietario, 2026-09-22):
 * no hay modelos fijados en la factoría: cada motor se resuelve a partir de una ESPECIFICACIÓN
 * RESUELTA (la salida de la cadena de ajustes) y el único constructor de aquí la conecta con
 * los catálogos federados de pi-ai.
 *
 * Un «motor» es el modelo + la función de stream sobre la que se ejecuta el bucle del agente:
 * las dos cosas que sustituye un falso de pruebas. Los motores de producción resuelven el modelo
 * a partir de los catálogos estáticos de pi-ai y hacen streaming a través de la misma colección
 * Models.
 */

export interface PiEngine {
	model: Model<Api>;
	streamFn: StreamFunction;
	/** El nivel de razonamiento resuelto inicialmente (de la configuración o los ajustes, LIMITADO).
	 *  Los streams personalizados vuelven a resolver la preferencia original en cada operación. */
	level?: ThinkingLevel;
}

export type { ThinkingLevel };

let collection: ReturnType<typeof createModels> | undefined;
interface ProviderSource {
	sync(models: MutableModels): void;
	isCustom(id: string): boolean;
}
let providerSource: ProviderSource | undefined;

/** El servidor inyecta la E/S de configuración; el agente nunca importa almacenes. */
export function configureProviderSource(source: ProviderSource): void {
	// Volver a evaluar el módulo del servidor puede sustituir el origen mientras esta colección
	// sobrevive. Retira solo las rutas del origen anterior, no las integradas.
	if (collection && providerSource) {
		for (const provider of collection.getProviders()) {
			if (providerSource.isCustom(provider.id)) collection.deleteProvider(provider.id);
		}
	}
	providerSource = source;
}

/** La colección Models de pi-ai de todo el proceso: el catálogo de TODOS los proveedores
 *  integrados (oleada de ranuras de modelo, 2026-09-20): los motores y el selector resuelven
 *  contra todos los catálogos por proveedor de pi-ai, así que una ranura de ajustes puede fijar
 *  cualquier id de modelo nativo. La propia pi-ai resuelve la autenticación en cada petición a
 *  partir del entorno (la juntura de claves refleja en env las claves guardadas en fichero), y
 *  un proveedor sin clave simplemente hace fallar su stream con "not configured": honesto,
 *  tardío e inalcanzable a través del selector, que se condiciona a keyPresent. */
export function piModels() {
	if (!collection) {
		collection = createModels({ identity: APP_IDENTITY });
		for (const provider of builtinProviders()) {
			// Mantén alcanzable para el rastreo independiente la implementación nativa de Bedrock.
			// El cargador por defecto de Pi, solo para Node, oculta esta importación a los empaquetadores. Solo
			// sustituye su reenvío diferido; conserva la autenticación y el catálogo de la factoría nativa.
			collection.setProvider(provider.id === "amazon-bedrock"
				? { ...provider, ...lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream")) }
				: provider);
		}
		collection.setProvider(createClaudeCodeProvider(streamClaudeCode));
	}
	providerSource?.sync(collection);
	return collection;
}

/** Clave de API de OpenRouter (BYOK); las pruebas nunca la leen: inyectan motores. */
export function openRouterApiKey(): string | undefined {
	return process.env.OPENROUTER_API_KEY || undefined;
}

/** Un modelo fijado totalmente resuelto, la forma de la que sale ahora cada motor:
 *  la salida de la cadena de resolución de ajustes (sustitución por rol → ranura, o la
 *  cadena de conversación del chat). thinkingLevel es OPCIONAL: sin asignar significa
 *  que aquí se resuelve el valor por defecto fijo (propietario, 2026-09-22): la primera entrada
 *  de DEFAULT_THINKING_ORDER que admita el modelo. */
export interface ResolvedModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

/** La primera entrada del orden por defecto fijo que admite el modelo (propietario,
 *  2026-09-22). Un modelo sin razonamiento informa exactamente ["off"], así que el
 *  recorrido del orden acaba ahí de forma natural. */
function defaultThinkingLevel(model: Model<Api>): ThinkingLevel {
	const supported = getSupportedThinkingLevels(model);
	for (const level of DEFAULT_THINKING_ORDER) {
		if (supported.includes(level)) return level;
	}
	return supported[0] ?? "off";
}

/** El motor de producción para una especificación RESUELTA (oleada de ranuras de modelo,
 *  2026-09-20): búsqueda en el catálogo según el proveedor + limitación del razonamiento. La
 *  propia pi-ai resuelve la clave de API a partir del entorno en cada petición (la juntura de
 *  claves refleja en env las claves guardadas en fichero), así que el motor nunca fija la
 *  de OpenRouter en el código. */
export function piEngineForSpec(spec: ResolvedModelSpec, background: boolean | (() => boolean) = true, lifecycle?: ChatGPTDispatchLifecycle, cacheRetention?: () => CacheRetention | undefined): PiEngine {
	const models: Models = piModels();
	const nativeId = nativeSubscriptionId(spec.provider);
	const registeredModel = spec.provider === "chatgpt" ? chatGPTModel(spec.id) : nativeId ? nativeSubscriptionModel(spec.provider, spec.id) : models.getModel(spec.provider, spec.id);
	const custom = providerSource?.isCustom(spec.provider) ?? false;
	// Los propietarios de endpoints personalizados autorizan los intentos con imágenes con independencia
	// de unos metadatos de descubrimiento escasos. Nunca promuevas las capacidades registradas o del catálogo.
	const permitImages = (value: Model<Api>): Model<Api> => ({ ...value, input: ["text", "image"] });
	const model = custom && registeredModel ? permitImages(registeredModel) : registeredModel;
	if (!model) {
		throw new Error(`${spec.provider} catalog has no model ${spec.id}`);
	}
	// Nivel SIN ASIGNAR → el orden por defecto fijo (la primera entrada que
	// admite el modelo); nivel ASIGNADO → la limitación al más cercano nativa de pi (al cambiar
	// de modelo se mantiene la intención del usuario y se adapta con honestidad).
	const thinkingPreference = spec.thinkingLevel;
	const level = thinkingPreference
		? clampThinkingLevel(model, thinkingPreference)
		: defaultThinkingLevel(model);
	// El bucle de agente de una lección puede seguir vivo a lo largo de muchas llamadas a herramientas.
	// Recuerda solo que es una ruta personalizada, nunca su configuración para esa ejecución.
	return {
		model,
		level,
		// El bucle del agente reenvía state.thinkingLevel como `reasoning` (undefined
		// = off en la escala de pi-ai). Los integrados mantienen la limitación de la factoría; las
		// peticiones personalizadas vuelven a resolver el razonamiento contra sus metadatos actuales, abajo.
		streamFn: (requestModel, context, options) => {
			// Lee la preferencia de la ranura en cada operación, no solo al crear el motor.
			// Sin asignar no añade NADA: los valores nativos por defecto, el env y las opciones explícitas del llamador sobreviven.
			const retention = cacheRetention?.();
			const requestOptions = {
				...options,
				...(retention !== undefined ? { cacheRetention: retention } : {}),
				reasoning: level === "off" ? undefined : level,
			};
			if (custom) {
				// Revalida antes de CADA operación del modelo aguas arriba, incluidos los pasos posteriores
				// del bucle de herramientas. Resuelve el razonamiento a partir de la preferencia ORIGINAL (o
				// del orden por defecto existente), no de la limitación de una instantánea anterior de metadatos.
				// Pi conserva la configuración de una operación que ya está en curso.
				const current = piModels();
				const currentModel = current.getModel(spec.provider, spec.id);
				if (!currentModel) return lazyStream(requestModel, async () => { throw new Error("The selected custom model is unavailable."); });
				const currentLevel = thinkingPreference
					? clampThinkingLevel(currentModel, thinkingPreference)
					: defaultThinkingLevel(currentModel);
				return current.streamSimple(permitImages(currentModel), context, { ...requestOptions, reasoning: currentLevel === "off" ? undefined : currentLevel });
			}
			const purpose = typeof background === "function" ? background : () => background;
			const stream = spec.provider === "chatgpt" ? chatGPTStream(purpose, lifecycle) : nativeId ? nativeSubscriptionStream(models.getProvider(nativeId)!, purpose, lifecycle) : models.streamSimple.bind(models);
			return stream(requestModel, context, requestOptions);
		},
	};
}

/** El punto de entrada HEREDADO por rol: BYOK lo convirtió en algo que LANZA con honestidad
 *  (propietario, 2026-09-22): no existen modelos fijados en la factoría a los que recurrir, y este
 *  módulo no puede leer los ajustes (ley de la arquitectura: la capa de agente nunca
 *  importa la capa de servidor). Producción resuelve la cadena en
 *  chat-handler y SIEMPRE inyecta motores; llegar aquí significa un error de
 *  cableado, así que falla ruidosamente en lugar de adivinar un modelo. */
export function piEngineFor(role: ModelRole): PiEngine {
	throw new Error(
		`no configured model for role "${role}" — set your model slots (settings → models)`,
	);
}
