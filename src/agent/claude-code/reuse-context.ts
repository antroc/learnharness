import type { Api, Message, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";

/** Compara el historial visible para el modelo, no los ID de la app, las marcas temporales, el uso ni el thinkingLevel que añade Pi. */
export function conversationForReuse(messages: Message[]): unknown[] {
	return messages.flatMap((message): unknown[] => {
		switch (message.role) {
			case "system": return [];
			case "user": return [{ role: message.role, content: message.content }];
			case "assistant": return [{ role: message.role, content: message.content }];
			case "toolResult": return [{
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: message.content,
				isError: message.isError,
			}];
		}
	});
}

export function configurationForReuse(model: Model<Api>, context: TranscriptContext, effort: string): unknown {
	const systemPrompt = getCurrentSystemPrompt(context.messages);
	const tools = getCurrentTools(context.messages);
	// El cable es JSON: los símbolos de esquema de TypeBox no son configuración de la CLI.
	return JSON.parse(JSON.stringify({ model, effort, systemPrompt, tools })) as unknown;
}
