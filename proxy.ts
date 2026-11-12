import { NextResponse, type NextRequest } from "next/server";
import { apiRequestRefusal } from "./src/server/desktop-access.ts";

/** Protege los métodos de la API, incluidas las rutas de SSE y las de
 * gasto/ajustes. La única ruta de documentos en streaming impone la misma
 * política de peticiones para todos los métodos dentro de su manejador,
 * evitando el clon del cuerpo de Proxy que Next trunca en silencio. No hay
 * callback público ni atajo para workers: el auto-HTTP legítimo sigue
 * necesitando la capacidad. */
export function proxy(request: NextRequest) {
	const refusal = apiRequestRefusal(request);
	if (refusal) {
		return NextResponse.json(
			{ error: refusal },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
	return NextResponse.next();
}

export const config = {
	// Mantén cubierto el propio /api; exime solo el endpoint exacto en streaming, no
	// el subárbol de documentos ni otras rutas de plugins. Deben seguir siendo literales estáticos.
	matcher: ["/api", "/api/((?!plugins/[^/]+/documents/markdown/?$).*)"],
};
