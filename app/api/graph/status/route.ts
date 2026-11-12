/**
 * GET /api/graph/status — las ejecuciones de extracción en segundo plano en
 * curso (visión §1: el estado del proceso debe verse en el grafo de inicio).
 * Transporte fino sobre el registro a nivel de módulo del proceso: fase
 * (queued / extracting / waiting / auditing / merging) por tarea, de la más
 * antigua a la más nueva; una fuente de varios fragmentos muestra una fila
 * POR FRAGMENTO (sufijo "· i/N", tareas por fragmento, responsable
 * 2026-09-28). Los títulos se cruzan con el almacén de chats; un registro
 * de chat ausente sigue informando de la ejecución.
 */
import { chatStore, extractionStatuses } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const runs = extractionStatuses().map((run) => ({
		// Id de fila único (la clave de tarea del registro: el id de la fuente, o
		// "src#i" para las tareas de fragmento); las filas de una fuente comparten
		// chatId, y las keys de React sobre él chocarían. chatId sigue siendo el
		// id de la FUENTE: la revelación/seguimiento de coste de la vista es por fuente a propósito.
		id: run.part ? `${run.chatId}#${run.part.i}` : run.chatId,
		chatId: run.chatId,
		// Gana la etiqueta propia de la ejecución (la ruta del fichero en las
		// importaciones de notas); las ejecuciones de chat recurren al título del almacén
		// de chats. Las tareas de fragmento añaden su parte ("· 2/5"): una fila por fragmento de la difusión.
		title:
			(run.label ?? chatStore.getChat(run.chatId)?.title ?? run.chatId) +
			(run.part ? ` · ${run.part.i}/${run.part.n}` : ""),
		phase: run.phase,
		startedAt: run.startedAt,
		// Uso en directo por etapa (el canal del dinero): modelo + CallUsage por
		// paso, acumulado a medida que se facturan los pasos. Los pliegues de coste y de ventana de
		// contexto son cosa del consumidor (auxiliares de core/prices.ts; nada guarda dólares).
		usage: run.usage,
	}));
	return Response.json({ runs });
}
