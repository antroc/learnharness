/**
 * GET /api/search — el estado de los motores de búsqueda (oleada de
 * búsqueda, 2026-09-20): la señal honesta de disponibilidad a partir de la
 * cual se explica la UI de ajustes (la indicación de atenuado) y que
 * cualquier superficie del cliente puede leer.
 *
 * { available, engine, reason } — nunca una clave, nunca un secreto:
 * `engine` es el motor ACTIVO cuando está disponible (autodetección o la
 * fijación explícita), y `reason` es la explicación del estado en una línea
 * (falta la clave de la API de búsqueda, o falta la del motor fijado).
 */

import { searchStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(searchStatus());
}
