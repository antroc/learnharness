import { modelCatalog, refreshConnectionCatalog } from "@/src/server";

/**
 * Los datos del selector de modelos (oleada de control de modelos): el
 * catálogo de proveedores configurados de pi-ai como DTO seguros para el
 * cliente —id/nombre/coste/contexto/modalidad más los niveles de
 * razonamiento ADMITIDOS por cada modelo (según su thinkingLevelMap).
 * Catálogo estático: sin red, estable dentro de una versión de pi-ai.
 */
export async function GET() {
	await refreshConnectionCatalog();
	return Response.json(modelCatalog(), { headers: { "Cache-Control": "no-store" } });
}
