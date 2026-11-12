import type { PluginSubmissionOccurrence } from "learnharness-plugin-api";

// Lee solo el pequeño vocabulario de acuses; no instancies tipos arbitrarios de carga/solución
// personalizados e inmutables de forma recursiva al inspeccionar la identidad.
type History = readonly unknown[];
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function occurrenceKey(occurrence: PluginSubmissionOccurrence): string {
  return JSON.stringify([occurrence.messageId, occurrence.contentIndex, occurrence.toolCallId, occurrence.toolName]);
}
/** Observa solo los ACUSES de planteamiento; nunca deduce la entrada activa,
 * baraja opciones, lee soluciones ni interpreta la prosa de conclusión/
 * descarte/modelo. Las identidades personalizadas vienen de
 * details.pluginProblem persistido por el host, no de nombres arbitrarios de
 * herramientas personalizadas. */
export function acceptedPoseKeys(messages: History): string[] {
  const results = new Map<string, { index: number; native: boolean; custom: boolean }>();
  messages.forEach((value, index) => {
    const message = object(value);
    if (!message || message.role !== "toolResult" || message.isError || typeof message.toolCallId !== "string" || typeof message.toolName !== "string") return;
    const details = object(message.details);
    const snapshot = object(details?.pluginProblem);
    const custom = snapshot?.protocolVersion === 1 && typeof snapshot.problemId === "string" &&
      typeof snapshot.pluginId === "string" && typeof snapshot.typeId === "string";
    if (message.toolName === "problem" || custom) results.set(JSON.stringify([message.toolCallId, message.toolName]),
      { index, native: message.toolName === "problem", custom });
  });
  const poses: string[] = [];
  messages.forEach((value, index) => {
    const message = object(value);
    if (!message || message.role !== "assistant" || typeof message.id !== "string" || !Array.isArray(message.content)) return;
    const messageId = message.id;
    message.content.forEach((value: unknown, contentIndex: number) => {
      const part = object(value);
      if (!part || part.type !== "toolCall" || typeof part.id !== "string" || typeof part.name !== "string") return;
      const ack = results.get(JSON.stringify([part.id, part.name]));
      if (!ack || ack.index <= index || (!ack.native && !ack.custom)) return;
      poses.push(occurrenceKey({ messageId, contentIndex, toolCallId: part.id, toolName: part.name }));
    });
  });
  return poses;
}
export function parsePoseResponse(value: unknown, sessionId: string): string[] {
  const input = object(value);
  if (!input || input.sessionId !== sessionId || !Array.isArray(input.poses) || !input.poses.every(pose => typeof pose === "string"))
    throw new Error("Could not confirm the current practice problem. Your drawing has been kept.");
  return input.poses as string[];
}
