/**
 * GET /api/graph/costs — la píldora de coste de la vista del grafo (oleada
 * de métricas de coste del grafo, 2026-09): lo que costó el PROCESO del
 * grafo, plegado en lectura a partir de los tres canales de uso (ejecuciones
 * de extracción de chats, ejecuciones de fuentes de notas y ejecuciones de
 * nombrado de clústeres). Transporte fino sobre graphCosts() de src/server;
 * el pliegue en sí es núcleo puro (core/cost-summary.ts). Los dólares se
 * deducen del catálogo/calculadora de Pi en lectura —nunca se guardan, así
 * que una actualización del catálogo vuelve a valorar todo el historial gratis.
 *
 * Alcance (decidido por el usuario): SOLO el proceso del grafo; los turnos
 * de enseñanza y las tareas de subagentes tienen sus propios canales de coste.
 */
import { graphCosts } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(graphCosts());
}
