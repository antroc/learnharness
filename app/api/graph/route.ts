import { graphView } from "@/src/server";

/**
 * El endpoint de datos de la vista del grafo de inicio (W4; visión §1
 * "Home page"); transporte fino: la entrada del servidor
 * (src/server/graph.ts) devuelve nodos, aristas, la procedencia de las
 * sesiones y las observaciones de comprensión por sesión.
 */

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(graphView());
}
