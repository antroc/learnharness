import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SEND_TO_USER_TOOL } from "../../core/native-messages.ts";
import { CLAUDE_CODE_PROVIDER } from "../claude-code/constants.ts";
import { serverExecute } from "../tool-execute.ts";

/** Los modelos Claude reciben la herramienta de salida (su texto plano puede resumirse
 *  dentro del razonamiento). Reconoce Claude en todos los proveedores (incluido OpenRouter),
 *  no el transporte de la API. El agente de preguntas laterales usa esto directamente. */
export function needsSendToUser(model: { provider: string; id: string }): boolean {
	return model.provider === CLAUDE_CODE_PROVIDER || model.id.toLowerCase().includes("claude");
}

/** Una única regla de disponibilidad para la herramienta y su guarda de entrega solo para el profesor.
 * La práctica usa prosa final normal; los registros explícitos siguen siendo del llamador. */
export function sendToUserApplies(
	kind: string,
	model: { provider: string; id: string },
	toolsOverridden: boolean,
): boolean {
	return (kind === "prober" || kind === "teacher") && !toolsOverridden && needsSendToUser(model);
}

const sendToUserInput = Type.Object({
	message: Type.String({
		minLength: 1,
		pattern: "\\S",
		description: "The complete content to display to the learner. Markdown and LaTeX are supported.",
	}),
});

/** El canal documentado de Claude para salida literal a mitad de turno. La disponibilidad tiene
 * barrera por modelo en el límite de construcción compartido del agente de conversación;
 * la llamada nativa se queda en el historial y la vista renderiza su mensaje. */
export const sendToUserTool: AgentTool<typeof sendToUserInput> = {
	name: SEND_TO_USER_TOOL,
	label: SEND_TO_USER_TOOL,
	description:
		"## REQUIRED OUTPUT CHANNEL — ALWAYS USE `send_to_user`\n\n" +
		"**ALL learner-facing messages MUST be sent using `send_to_user`.** This includes explanations, teaching, " +
		"feedback, corrections, hints, introductions, progress messages, and final responses. " +
		"There is no exception for short messages or the end of a turn.\n\n" +
		"Ordinary response text may be converted into summarized thinking instead of reaching the learner. " +
		"**Never rely on ordinary response text to communicate with the learner. Thinking is not delivery.**\n\n" +
		"Put the complete message in `message`. Markdown and LaTeX are supported. " +
		"Do not duplicate it in ordinary response text.\n\n" +
		"Question content still belongs in the appropriate question tool; send any accompanying teaching or " +
		"commentary through `send_to_user` before calling that tool.\n\n" +
		"This tool does not pause or end your turn. Continue with other tools when needed. " +
		"After delivering your final message, end the turn without additional ordinary response text.",
	parameters: sendToUserInput,
	executionMode: "sequential",
	execute: serverExecute(SEND_TO_USER_TOOL, sendToUserInput, () => "Message received for display."),
};
