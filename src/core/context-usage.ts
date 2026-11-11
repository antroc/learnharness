import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LhMessage } from "./native-messages.ts";

/** Última medición completada de la conversación, nunca una estimación del
 * tamaño de la petición. Los marcadores de compactación ordenados invalidan
 * todas las lecturas anteriores. Quien llame en vivo debe excluir las ranuras
 * del asistente que aún no hayan recibido message_end. El razonamiento ya está
 * dentro de output; totalTokens no se usa a propósito.
 */
export function measuredContextTokens(
	messages: readonly LhMessage[],
	incompleteIds: ReadonlySet<string> = new Set(),
): number | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!;
		if (message.role === "custom" && message.customType === "compaction") return null;
		if (message.role !== "assistant" || incompleteIds.has(message.id)) continue;
		const assistant = message as AssistantMessage;
		if (!["stop", "length", "toolUse"].includes(assistant.stopReason)) continue;
		const usage = assistant.usage;
		if (!usage) continue;
		const buckets = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
		if (buckets.some((value) => !Number.isFinite(value) || value < 0)) continue;
		const tokens = buckets.reduce((sum, value) => sum + value, 0);
		if (tokens > 0) return tokens;
	}
	return null;
}
