/**
 * GET /api/activity — el único sondeo del dock: todo proceso en segundo
 * plano en marcha, en todas las vistas (chat, inicio, en todas partes). Solo
 * composición — el feed vive en server/observability.ts; los costes se
 * proyectan en el servidor mediante el catálogo y la calculadora pública de
 * Pi. Ver la cabecera de ese módulo para saber por qué /api/jobs sigue con
 * ámbito de chat y sin tocar.
 */
import { activityFeed } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(activityFeed());
}
