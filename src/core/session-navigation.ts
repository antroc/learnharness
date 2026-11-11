import type { GraphNode } from "./contracts/graph.ts";
import type { LhViewMessage } from "./view.ts";

/** Enlaces del grafo a nivel de mensaje (responsable, 2026-10-13). La procedencia
 * persistida y los IDs nativos ya llevan todo lo necesario; solo la frontera de
 * renderizado es nueva. */
export function messageAnchorId(messageId: string): string {
	return `message-${messageId}`;
}

export function messageIdFromHash(hash: string): string | null {
	try {
		const anchor = decodeURIComponent(hash.replace(/^#/, ""));
		return anchor.startsWith("message-") && anchor.length > "message-".length
			? anchor.slice("message-".length)
			: null;
	} catch {
		return null;
	}
}

/** Las anclas vacías antiguas no tapan una real posterior. El orden del registro, no la
 * fecha ni el orden léxico, selecciona el PRIMER mensaje registrado de esta fuente. */
export function propositionSessionHref(node: Pick<GraphNode, "provenance">, chatId: string): string {
	const messageId = node.provenance.find((p) => p.chatId === chatId && p.messageId !== "")?.messageId;
	return `/chat/${encodeURIComponent(chatId)}${messageId ? `#${encodeURIComponent(messageAnchorId(messageId))}` : ""}`;
}

/** La identidad de las partes de texto de projectView es <ID de mensaje nativo>-t<índice de texto>.
 * Los IDs de GRUPO del asistente no pueden identificar una fuente de extracción concreta. */
export function textPartMessageId(partId: string | undefined): string | null {
	return partId?.match(/^(.*)-t\d+$/)?.[1] || null;
}

/** Un ancla del DOM por mensaje nativo del profesor, en su primer bloque de prosa no
 * vacío. Los bloques de texto vacíos y las herramientas o razonamientos intermedios no
 * se la quitan. */
export function firstSourceTextParts(messages: readonly LhViewMessage[]): Map<string, string> {
	const first = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type !== "text" || typeof part.text !== "string" || !part.text.trim() || !part.id) continue;
			const messageId = textPartMessageId(part.id);
			if (messageId && !first.has(messageId)) first.set(messageId, part.id);
		}
	}
	return first;
}
