/**
 * PUT /api/graph/positions — la confirmación del arrastre con física en
 * vivo. El cliente recuece un arrastre hasta el reposo y envía las nuevas
 * posiciones; el servidor las sanea (coordenadas finitas, solo ids
 * conocidos), escribe el registro y, si el grafo creció durante el
 * arrastre, ejecuta un asentamiento incremental para absorber los nodos
 * nuevos con la disposición del cliente como anclas. Ver
 * src/server/commit-positions.ts.
 *
 *   PUT → 200 {positions: {...}} con lo que haya sobrevivido al saneado
 *         (objeto vacío = no se escribió nada).
 */
import { commitPositions } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}
	return Response.json({ positions: commitPositions(body) });
}
