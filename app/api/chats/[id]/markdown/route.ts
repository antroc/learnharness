/**
 * LA EXPORTACIÓN DE LA SESIÓN A MARKDOWN (responsable, pulido de la versión
 * 2026-10-06): la exportación de cara al usuario para la que se construyó
 * el motor session-markdown — el mismo documento que lee el extractor,
 * generado sin anclas (las anclas son la procedencia de la extracción; la
 * exportación de un alumno no lleva ids de mensaje).
 *
 * GET /api/chats/:id/markdown → toda la sesión como un fichero Markdown
 * (Content-Disposition attachment; nombre de fichero a partir del título en
 * forma de slug). 404 si el chat no existe. Se exportan ambos tipos de
 * sesión — las sesiones de práctica usan el mismo motor (los resultados de
 * problem/conclude se renderizan como bloques de herramienta y los
 * marcadores son invisibles por la ley del motor).
 */
import { sessionMarkdown } from "@/src/core";
import { getChat } from "@/src/server";

/** Título apto para nombre de fichero (en su propio ámbito de módulo a propósito: diminuto + puro). */
function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "session";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const record = getChat(id);
	if (!record) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const markdown = sessionMarkdown(record.messages, { title: record.title, anchors: false });
	return new Response(markdown, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"content-disposition": `attachment; filename="${slugify(record.title)}.md"`,
		},
	});
}
