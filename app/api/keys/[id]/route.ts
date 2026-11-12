/**
 * PUT /api/keys/:id — guarda una clave; DELETE — la elimina (oleada de
 * claves de autenticación, 2026-09-19). `id` es el nombre de la clave como
 * variable de entorno/fichero (OPENROUTER_API_KEY, …).
 *
 * Cuerpo del PUT {value}: con barrera de forma (decisión del responsable:
 * los pegados erróneos son 400 que nombran el formato esperado y nunca se
 * guardan; la validación es SOLO DE FORMA, sin pings en directo). Los
 * guardados surten efecto de inmediato (se reflejan en fichero y entorno;
 * sin reiniciar). Una variable que pertenece al entorno REAL se persiste
 * para más tarde pero NO se refleja: la fila de estado de la respuesta lleva
 * shadowedByEnv para que la página explique por qué la clave guardada no es
 * la activa.
 *
 * DELETE: siempre desaparece del fichero; la copia del entorno solo se va
 * cuando era el propio reflejo del almacén (una variable de entorno real se
 * queda: el entorno gana). Idempotente (clave ausente = éxito). Los ids
 * escribibles son el CATÁLOGO CURADO ∪ LAS variables de entorno de los
 * PROVEEDORES DE MODELOS (interludio de claves de proveedor); cualquier otra
 * cosa es 404: las variables desconocidas del fichero se conservan, pero no
 * se pueden editar.
 */
import { isWritableAuthKey } from "@/src/server";
import { deleteKey, saveKey } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
	const { id } = await params;
	if (!isWritableAuthKey(id)) {
		return Response.json({ error: `unknown key "${id}"` }, { status: 404 });
	}
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "body must be JSON" }, { status: 400 });
	}
	if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { value?: unknown }).value !== "string") {
		return Response.json({ error: "body must be {value: string}" }, { status: 400 });
	}
	const result = saveKey(id, (body as { value: string }).value);
	if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
	return Response.json({ status: result.status });
}

export async function DELETE(_req: Request, { params }: Params) {
	const { id } = await params;
	if (!isWritableAuthKey(id)) {
		return Response.json({ error: `unknown key "${id}"` }, { status: 404 });
	}
	return Response.json({ status: deleteKey(id) });
}
