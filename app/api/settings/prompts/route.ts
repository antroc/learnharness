/**
 * GET /api/settings/prompts — la vista de segmentos del prompt de sistema
 * (oleada de almacenamiento de ajustes, 2026-09-19): los segmentos de prompt
 * efectivos de Teacher, Prober y Practice, derivados de la FUENTE en tiempo
 * de ejecución (src/agent/prompts; la lista se adapta cuando el código
 * publica, renombra o elimina fragmentos), cada uno con su texto fuente, su
 * texto de sustitución (si existe el fichero) y el estado efectivo del
 * interruptor (el mapa agent.prompts del registro de ajustes Y la presencia
 * del fichero).
 *
 *   GET → 200 {prober: SegmentInfo[], teacher: SegmentInfo[], practice: SegmentInfo[]}
 *   SegmentInfo = {path, sourceText, overrideText, enabled, shared}
 *
 * El uso compartido se descubre por la pertenencia de la ruta a estas
 * listas. La base compartida aparece en Teacher y Prober, NO en Practice;
 * Practice tiene su propia base y un subconjunto de los fragmentos
 * compartidos. Escrituras: los interruptores van por PUT
 * /api/settings/agent; el TEXTO va por PUT/DELETE
 * /api/settings/prompts/[...segment].
 */

import { effectivePromptSegments, readSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const switches = readSettingsRecord()?.agent?.prompts ?? {};
	return Response.json({
		prober: effectivePromptSegments("prober", switches),
		teacher: effectivePromptSegments("teacher", switches),
		practice: effectivePromptSegments("practice", switches),
	});
}
