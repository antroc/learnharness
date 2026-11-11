/**
 * LA REPARACIÓN DE ARGUMENTOS DE LOS MODELOS DÉBILES: el núcleo puro
 * (responsable, 2026-10-09: generalizar la reparación de prácticas del
 * 2026-10-04; ver agent/tools/heal.ts para la historia del cableado en todos
 * los registros). Vive en el núcleo porque la necesitan AMBAS fronteras (la
 * ley de tool-parts: los análisis de visualización reflejan la conversión de
 * la frontera, o una llamada reparada en la frontera cuyo registro conserva
 * los argumentos EN BRUTO se muestra como un quiz pendiente invisible):
 *
 *   - la frontera del agente: la frontera prepareArguments de pi, ANTES de la
 *     validación de TypeBox (withArgumentHeal / healToolRecord);
 *   - el análisis de visualización: parseQuizInput de tool-parts, antes de
 *     boundaryParse; el registro persistido conserva los argumentos en bruto,
 *     así que el mismo vaivén se repara al leer.
 *
 * Nació del incidente de GLM (responsable, 2026-10-04): 19 llamadas `problem`
 * rechazadas seguidas, todas con `"mode": "\"recall\""` (un enum codificado
 * como cadena JSON), mientras el texto de error de TypeBox `must be equal to
 * constant` nunca nombraba los valores esperados, así que el modelo volvía a
 * emitir la misma carga una y otra vez; la sesión whitehead del 2026-10-09
 * repitió el mismo bucle con el `type` del quiz durante diez turnos. Un valor
 * CADENA donde el esquema espera una unión de literales / booleano / null /
 * número / array se pasa por JSON.parse y se conserva si el valor analizado
 * cumple lo esperado. Los argumentos bien formados pasan SIN TOCAR (la misma
 * referencia); los valores que no se pueden reparar se dejan para que la
 * validación los rechace con honestidad.
 */

/** El esquema de una propiedad de un objeto TypeBox (las formas que emite este
 * fork: las uniones de literales llevan anyOf[{const}], los escalares llevan type). */
type PropSchema = {
	type?: string;
	const?: unknown;
	anyOf?: PropSchema[];
};

/** Los valores literales que acepta una propiedad ([] si no es una unión de
 *  literales / un literal a secas). */
function literalsOf(prop: PropSchema): unknown[] {
	if (prop.anyOf) return prop.anyOf.flatMap((m) => literalsOf(m));
	return "const" in prop ? [prop.const] : [];
}

/** ¿Acepta la propiedad null (Type.Null solo o como miembro de una unión)? */
function acceptsNull(prop: PropSchema): boolean {
	if (prop.type === "null") return true;
	return (prop.anyOf ?? []).some((m) => m.type === "null");
}

/** JSON.parse que nunca lanza (undefined si la entrada está mal formada). */
function tryParse(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

export function healEncodedArguments(
	args: unknown,
	schema: { properties?: Record<string, PropSchema> },
): unknown {
	if (typeof args !== "object" || args === null || Array.isArray(args)) return args;
	const properties = schema.properties;
	if (!properties) return args;
	let healed: Record<string, unknown> | null = null;
	for (const [key, prop] of Object.entries(properties)) {
		const raw = (args as Record<string, unknown>)[key];
		if (typeof raw !== "string") continue;
		const parsed = tryParse(raw);
		let fixed: unknown;
		const literals = literalsOf(prop);
		if (literals.length > 0) {
			if (literals.includes(raw)) continue; // ya es un miembro válido
			if (literals.includes(parsed)) fixed = parsed;
		}
		// La rama de literales no cubre null (Type.Null no lleva const); una unión de
		// literales ∪ null también debe aceptar "null".
		if (fixed === undefined && acceptsNull(prop) && parsed === null) fixed = null;
		if (fixed === undefined && prop.type === "boolean" && typeof parsed === "boolean") {
			fixed = parsed;
		}
		if (
			fixed === undefined &&
			(prop.type === "number" || prop.type === "integer") &&
			typeof parsed === "number"
		) {
			fixed = parsed;
		}
		if (fixed === undefined && prop.type === "array" && Array.isArray(parsed)) fixed = parsed;
		if (fixed !== undefined) {
			healed ??= { ...(args as Record<string, unknown>) };
			healed[key] = fixed;
		}
	}
	return healed ?? args;
}
