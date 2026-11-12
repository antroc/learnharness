/**
 * PUT/DELETE /api/settings/prompts/[...segment] — el TEXTO de sustitución
 * de un segmento de prompt (oleada de almacenamiento de ajustes, 2026-09-19).
 *
 *   PUT    cuerpo {text} → escribe data/prompts/<espejo de la ruta del segmento>. 200.
 *          El segmento debe ser un segmento fuente ACTUAL (allSegmentPaths,
 *          derivado de src/agent/prompts en tiempo de ejecución): sustituir
 *          un segmento que no forma parte de la composición es una errata o
 *          un fragmento desaparecido, un 400, nunca un huérfano silencioso.
 *   DELETE → elimina el fichero de sustitución (idempotente) Y desactiva el
 *          interruptor del registro para ese segmento en la misma operación
 *          (arreglo del contrato, interludio 2026-09-26; anula la nota del
 *          2026-09-19 de que «el interruptor sobrevive a un ciclo de
 *          borrar/reescribir»). El comportamiento antiguo dejaba huérfano el
 *          interruptor activado: la validación de escritura respondía 400 a
 *          toda escritura de la sección agent mientras el interruptor
 *          desactivado de la UI no llegaba a la salida de emergencia de OFF,
 *          y el usuario quedaba atascado sin poder escribir ajustes. Borrar
 *          desactiva el interruptor para que la ruta y el registro coincidan
 *          POR CONSTRUCCIÓN; la vía de escritura repara además cualquier
 *          huérfano que aún surja (borrados a nivel de disco fuera del
 *          control de la app); ver [section]/route.ts. Orden aquí: primero se
 *          desactiva el interruptor y luego se borra el fichero; un fallo
 *          entre ambos deja "off + fichero", un estado válido, nunca un huérfano.
 *
 * El interruptor ON/OFF en sí vive en el mapa agent.prompts del registro
 * (PUT /api/settings/agent); la sola presencia del fichero nunca es la sustitución.
 */

import {
	allSegmentPaths,
	isValidSegmentPath,
	promptOverrides,
	readSettingsRecord,
	writeSettingsRecord,
} from "@/src/server";

export const dynamic = "force-dynamic";

/** Vuelve a unir los segmentos comodín en la ruta con disposición de espejo;
 * null cuando la forma no es válida (recorrido de directorios, disposición
 * incorrecta; el almacén vuelve a comprobarlo). */
function segmentPathFrom(segments: string[]): string | null {
	const joined = segments.map(decodeURIComponent).join("/");
	return isValidSegmentPath(joined) ? joined : null;
}

export async function PUT(request: Request, ctx: { params: Promise<{ segment: string[] }> }) {
	const { segment } = await ctx.params;
	const path = segmentPathFrom(segment);
	if (!path) return Response.json({ error: "invalid segment path" }, { status: 400 });
	const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
	if (!body || typeof body.text !== "string") {
		return Response.json({ error: "body must be {text: string}" }, { status: 400 });
	}
	if (!new Set(allSegmentPaths()).has(path)) {
		return Response.json(
			{ error: `"${path}" is not a current source segment`, supported: allSegmentPaths() },
			{ status: 400 },
		);
	}
	promptOverrides.writeOverride(path, body.text);
	return Response.json({ path, text: body.text });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ segment: string[] }> }) {
	const { segment } = await ctx.params;
	const path = segmentPathFrom(segment);
	if (!path) return Response.json({ error: "invalid segment path" }, { status: 400 });
	// Desactiva PRIMERO el interruptor del registro (un fallo entre ambos deja "off +
	// fichero" —válido—, nunca un ON huérfano) y luego borra el fichero.
	const record = readSettingsRecord();
	const hadSwitch = record?.agent?.prompts?.[path] === true;
	if (record && record.agent?.prompts?.[path] !== undefined) {
		const prompts = { ...record.agent.prompts };
		delete prompts[path];
		writeSettingsRecord({ ...record, agent: { ...record.agent, prompts } });
	}
	promptOverrides.deleteOverride(path);
	// switchCleared indica al llamante que su interruptor activado se apagó JUNTO con el
	// fichero (aditivo; la vista GET deriva la misma verdad del registro + fichero).
	return Response.json({ path, deleted: true, switchCleared: hadSwitch });
}
