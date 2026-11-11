import { Compile } from "typebox/compile";
import type { TSchema } from "typebox";
import type { PluginInferenceOptions } from "./plugins.ts";
import { copyImmutableData, ImmutableReadCache } from "./immutable-data.ts";

// El SDK instalado usa este mismo compilador de TypeBox, pero acepta en silencio palabras
// clave conocidas mal formadas. Esto es higiene básica de esquemas nativos, NO un
// metavalidador completo ni una garantía de compatibilidad con todo proveedor/dialecto.
const types = new Set([
	"object", "array", "boolean", "integer", "number", "null", "string",
	"bigint", "constructor", "function", "symbol", "undefined", "void",
]);
const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const lists = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const nested = new Set([
	"additionalProperties", "additionalItems", "unevaluatedProperties", "unevaluatedItems",
	"contains", "propertyNames", "not", "if", "then", "else", "contentSchema",
]);
const numeric = new Set([
	"minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems",
	"minProperties", "maxProperties", "minContains", "maxContains",
]);
const references = new Set(["$ref", "$recursiveRef", "$dynamicRef"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** Conserva los objetos/extensiones de esquema nativos; rechaza las formas
 * conocidas obviamente mal formadas y luego compila exactamente como el SDK. Los
 * DATOS literales/de anotación (const, miembros de enum, default, examples,
 * extensiones desconocidas) nunca se recorren como esquema. */
export function validatePluginSchema(schema: unknown) {
	const seen = new WeakSet<object>();
	function fail(location: string): never { throw new Error(`Malformed native schema at ${location}`); }
	function visit(value: unknown, location: string): void {
		if (typeof value === "boolean") return; // Esquemas booleanos nativos de JSON Schema.
		if (!object(value)) fail(location);
		if (seen.has(value)) return;
		seen.add(value);
		for (const [key, child] of Object.entries(value)) {
			const at = `${location}.${key}`;
			if (key === "type") {
				const valid = (name: unknown) => typeof name === "string" && types.has(name);
				if (!(valid(child) || (Array.isArray(child) && child.length > 0 && child.every(valid)))) fail(at);
			} else if (maps.has(key) || key === "dependencies" || key === "dependentRequired") {
				if (!object(child)) fail(at);
				for (const [name, entry] of Object.entries(child)) {
					if (key === "dependentRequired") { if (!strings(entry)) fail(`${at}.${name}`); }
					else if (key === "dependencies" && strings(entry)) continue;
					else visit(entry, `${at}.${name}`);
				}
			} else if (lists.has(key) || (key === "items" && Array.isArray(child)) ||
				(key === "parameters" && (value.type === "function" || value.type === "constructor"))) {
				if (!Array.isArray(child)) fail(at);
				child.forEach((entry, index) => visit(entry, `${at}[${index}]`));
			} else if (nested.has(key) || key === "items" ||
				(key === "returnType" && value.type === "function") || (key === "instanceType" && value.type === "constructor")) visit(child, at);
			else if (references.has(key) || key === "format") { if (typeof child !== "string") fail(at); }
			else if (key === "pattern") { if (typeof child !== "string" && !(child instanceof RegExp)) fail(at); }
			else if (key === "required") { if (typeof child !== "boolean" && !strings(child)) fail(at); }
			else if (key === "enum") { if (!Array.isArray(child)) fail(at); }
			else if (key === "uniqueItems") { if (typeof child !== "boolean") fail(at); }
			else if (numeric.has(key)) { if (typeof child !== "number" && typeof child !== "bigint") fail(at); }
			else if (key === "exclusiveMinimum" || key === "exclusiveMaximum") {
				if (!["boolean", "number", "bigint"].includes(typeof child)) fail(at); // Borradores anteriores/posteriores.
			}
		}
	}
	visit(schema, "$");
	return Compile(schema as TSchema);
}

// Los validadores compilados se mantienen privados: quien llama a validatePluginSchema sigue
// obteniendo su propio Validator mutable de TypeBox. Solo los contratos internos inmutables
// reutilizan un cierre de comprobación; cada valor nuevo se comprueba, nunca se memoiza como envío.
const preparedChecks = new ImmutableReadCache<(value: unknown) => boolean>();
const booleanSchemas = copyImmutableData({ true: { schema: true }, false: { schema: false } });
function preparedCheck(schema: unknown): (value: unknown) => boolean {
	const key = typeof schema === "boolean" ? booleanSchemas[String(schema) as "true" | "false"] : schema;
	return preparedChecks.read(key, undefined, () => {
		const validator = validatePluginSchema(schema);
		return value => validator.Check(value);
	});
}
export function preparePluginSchema(schema: unknown): void { preparedCheck(schema); }
export function checkPluginSchema(schema: unknown, value: unknown): boolean { return preparedCheck(schema)(value); }

// Copiado sin cambios semánticos del adaptador de inferencia existente. Esto solo
// valida las opciones de generación; los campos de transporte/autenticación siguen siendo del host.
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const optionKeys = new Set(["temperature", "maxTokens", "cacheRetention", "reasoning", "thinkingBudgets", "toolChoice", "timeoutMs", "maxRetries", "maxRetryDelayMs", "metadata"]);
export function validatePluginInferenceOptions(value: PluginInferenceOptions | undefined): PluginInferenceOptions {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inference options");
	for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || !optionKeys.has(key)) throw new Error(`Unsupported plugin inference option: ${String(key)}`);
	const options = structuredClone(value);
	for (const key of ["temperature", "maxTokens", "timeoutMs", "maxRetries", "maxRetryDelayMs"] as const) {
		const n = options[key];
		if (n === undefined) continue;
		if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || (key !== "temperature" && !Number.isSafeInteger(n)) || ((key === "maxTokens" || key === "timeoutMs") && n === 0)) throw new Error(`Invalid inference option: ${key}`);
	}
	if (options.reasoning !== undefined && !levels.filter((l) => l !== "off").includes(options.reasoning)) throw new Error("Invalid inference option: reasoning");
	if (options.cacheRetention !== undefined && !["none", "short", "long"].includes(options.cacheRetention)) throw new Error("Invalid inference option: cacheRetention");
	if (options.toolChoice !== undefined && !["auto", "none"].includes(options.toolChoice)) throw new Error("Invalid inference option: toolChoice");
	if (options.thinkingBudgets !== undefined) {
		if (!options.thinkingBudgets || typeof options.thinkingBudgets !== "object" || Array.isArray(options.thinkingBudgets)) throw new Error("Invalid thinkingBudgets");
		for (const [key, n] of Object.entries(options.thinkingBudgets)) if (!["minimal", "low", "medium", "high"].includes(key) || typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid thinking budget: ${key}`);
	}
	if (options.metadata !== undefined) {
		if (!options.metadata || typeof options.metadata !== "object" || Array.isArray(options.metadata)) throw new Error("Invalid inference metadata");
		// Los metadatos son contenido de la petición, no un sitio por el que colar callbacks del host.
		JSON.stringify(options.metadata, (_key, item) => {
			if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint" || (typeof item === "number" && !Number.isFinite(item))) throw new Error("Metadata must be JSON compatible");
			return item;
		});
	}
	return options;
}
