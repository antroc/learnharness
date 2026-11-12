import type { PluginFrontendContext } from "learnharness-plugin-api";
import { mountDisclosure } from "./disclosure.ts";

/** Las preguntas históricas sin solución modelo nunca se rellenan a posteriori. */
export function mountModelSolution(container: HTMLElement, ui: Pick<PluginFrontendContext["ui"], "mountMarkdown">, value: unknown, signal: AbortSignal): () => void {
  if (typeof value !== "string" || !/\S/.test(value)) return () => {};
  return mountDisclosure(container, "model-solution", "Model solution", signal, body => {
    const markdown = ui.mountMarkdown(body, { text: value }, { signal });
    return () => markdown.dispose();
  });
}
