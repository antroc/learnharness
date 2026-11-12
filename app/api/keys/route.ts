/**
 * GET /api/keys — la lista de claves de la página de autenticación (oleada
 * de claves de autenticación, 2026-09-19; los proveedores se añadieron en el
 * interludio de claves de proveedor de la misma oleada).
 *
 * Todas las claves curadas (presentes o no) más las variables desconocidas
 * del fichero mostradas como filas genéricas; las claves de proveedor
 * AUSENTES, a propósito, NO llenan de filas de estado: el desplegable de
 * proveedores es la superficie de descubrimiento. `providers` lo alimenta:
 * {id, envVar, label} para cada proveedor de pi-ai de clave simple,
 * derivado de la propia tabla proveedor→variable de entorno de pi-ai
 * (fijación anti-deriva en tests/auth-provider-keys.test.ts); la UI de
 * ajustes lo lee como opcional, con una alternativa elegante.
 *
 * Solo enmascaradas: los 4 últimos caracteres + la longitud para las claves
 * normales; las claves personalizadas se ocultan por completo a cualquier
 * longitud (sin sufijo de la credencial). EL TEXTO EN CLARO NUNCA SALE DEL
 * ALMACÉN A TRAVÉS DE ESTA API (decisión del responsable). `source` indica
 * a la página si el valor activo viene del entorno (.env.local en
 * desarrollo / entorno de arranque) o del fichero, y `shadowedByEnv`
 * explica por qué una clave guardada no es la activa (el entorno siempre gana).
 */
import { keyStatuses, providerKeyList } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ keys: keyStatuses(), providers: providerKeyList() });
}
