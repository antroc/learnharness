import { getChat } from "@/src/server";

/** Solo instantáneas propiedad de la sesión: nunca abre una ruta de origen ni acepta bytes subidos. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
	const { id, snapshotId } = await params;
	if (!/^[a-f0-9]{64}$/.test(snapshotId)) return Response.json({ error: "Not found" }, { status: 404 });
	const image = getChat(id)?.imageSnapshots?.[snapshotId];
	if (!image) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(image, { headers: { "Cache-Control": "private, no-store" } });
}
