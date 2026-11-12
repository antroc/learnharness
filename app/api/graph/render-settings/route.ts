/**
 * GET/PUT /api/graph/render-settings — persistencia en servidor de los
 * controles de renderizado de la vista del grafo (tamaños de nodo, arista,
 * flecha y etiqueta, el umbral de zoom de las etiquetas y el interruptor de
 * etiquetas de clúster). El fichero vive en data/render-settings.json
 * (config.RENDER_SETTINGS_FILE).
 *
 *   GET → 200 {settings} una vez guardado, 200 null en el primer arranque
 *         (el cliente mantiene los valores por defecto en memoria hasta que
 *         el usuario cambia algo).
 *   PUT → 200 {settings} (la copia saneada que se persistió de verdad; el
 *         cliente puede reflejarla para ser honesto con los valores acotados).
 *
 * Todo cuerpo pasa por sanitizeRenderSettings (src/core) antes de tocar el
 * disco: la basura se acota o vuelve a los valores por defecto, nunca lanza.
 */
import { readRenderSettings, writeRenderSettings } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(readRenderSettings());
}

export async function PUT(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}
	return Response.json(writeRenderSettings(body));
}
