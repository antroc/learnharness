import { Format } from "typebox/format";
import { Settings } from "typebox/system";

// Solo las copias creadas aquí llevan esta prueba. Un objeto arbitrario de un plugin,
// aunque esté congelado, no prueba propiedad ni lecturas estables (p. ej., proxies).
const immutable = new WeakSet<object>();
const container = (value: object) => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
const immutableValue = (value: unknown): boolean => value === null || (typeof value === "object" ? immutable.has(value) : typeof value !== "function");

/** Desvincula el historial del host a la entrada, conservando undefined, los
 * datos dispersos o mal formados y los metadatos de TypeBox para que los
 * juzguen los analizadores existentes. Nunca invoca getters ni congela los
 * objetos de quien llama. Los subárboles que ya son propios conservan su
 * identidad. */
export function copyImmutableData<T>(value: T): T {
	const copies = new WeakMap<object, object>();
	function copy(item: unknown): unknown {
		if (item === null || typeof item !== "object" || immutable.has(item) || !container(item)) return item;
		const previous = copies.get(item);
		if (previous) return previous;
		const result = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item));
		copies.set(item, result);
		let eligible = true;
		const descriptors = Object.getOwnPropertyDescriptors(item);
		for (const key of Reflect.ownKeys(descriptors)) {
			const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
			if ("value" in descriptor) {
				const child = copy(descriptor.value);
				if (!immutableValue(child)) eligible = false;
				Object.defineProperty(result, key, { ...descriptor, value: child });
			} else {
				eligible = false;
				Object.defineProperty(result, key, descriptor);
			}
		}
		Object.freeze(result);
		if (eligible) immutable.add(result);
		return result;
	}
	try { return copy(value) as T; }
	catch { return value; } // Los datos de ejecución no admitidos deben llegar igualmente a los lectores que fallan cerrados.
}

// Un resultado compilado/analizado no debe sobrevivir a un cambio en la política de
// validación o en las funciones de formato de TypeBox. Se guarda un entorno actual, no un
// registro de épocas. Leer las entradas detecta también cambios hechos fuera de la API del host.
let formats = Format.Entries();
let settings = Object.entries(Settings.Get());
let epoch = {};
function validationEpoch(): object {
	const nextFormats = Format.Entries(), nextSettings = Object.entries(Settings.Get());
	if (formats.length !== nextFormats.length || formats.some(([key, value], i) => key !== nextFormats[i]![0] || value !== nextFormats[i]![1]) ||
		settings.length !== nextSettings.length || settings.some(([key, value], i) => key !== nextSettings[i]![0] || value !== nextSettings[i]![1])) {
		formats = nextFormats; settings = nextSettings; epoch = {};
	}
	return epoch;
}

/** Caché interna de identidad para lecturas de datos inmutables propiedad del
 * host. Un contexto por clave débil, sin retención fuerte del historial, sin
 * claves globales de contenido ni política de capacidad. Las entradas o
 * contextos ajenos siempre siguen el camino de validación original. */
export class ImmutableReadCache<T> {
	private entries = new WeakMap<object, { context: unknown; epoch: object; value: T }>();
	read(input: unknown, context: unknown, compute: () => T): T {
		if (input === null || typeof input !== "object" || !immutable.has(input) || !immutableValue(context)) return compute();
		const currentEpoch = validationEpoch(), previous = this.entries.get(input);
		if (previous && previous.context === context && previous.epoch === currentEpoch) return previous.value;
		const value = copyImmutableData(compute());
		this.entries.set(input, { context, epoch: currentEpoch, value });
		return value;
	}
	seed(input: object, context: unknown, value: T): void {
		if (immutable.has(input) && immutableValue(context)) this.entries.set(input, { context, epoch: validationEpoch(), value: copyImmutableData(value) });
	}
}
