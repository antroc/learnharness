/**
 * DELETE /api/themes/[id] (oleada de temas, 2026-11-04) — elimina un tema
 * importado. Los predefinidos no se pueden eliminar (400); un id
 * desconocido es un 404. Si el tema eliminado estaba activo, el registro
 * vuelve a "default" y todas las sustituciones de color se quedan
 * exactamente como estaban.
 */

import { isBuiltinThemeId } from "@/src/core";
import { readSettingsRecord, themeStore, writeSettingsRecord } from "@/src/server";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	if (isBuiltinThemeId(id)) return Response.json({ error: `"${id}" is a built-in theme` }, { status: 400 });
	const theme = themeStore.readTheme(id);
	if (!theme) return Response.json({ error: `unknown theme "${id}"` }, { status: 404 });
	themeStore.deleteTheme(id);
	const record = readSettingsRecord();
	if (record?.appearance?.theme === id) {
		writeSettingsRecord({ ...record, appearance: { ...record.appearance, theme: "default" } });
	}
	return Response.json({ theme });
}
