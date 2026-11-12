import type { PluginSubmission } from "learnharness-plugin-api";
import type { exportSheet } from "./capture.ts";
type Image = Awaited<ReturnType<typeof exportSheet>>;

/** Se añade al canal nativo existente. Nunca cambia el texto, las selecciones ni el JSON. */
export function appendDrawing(input: PluginSubmission, image: Image): PluginSubmission {
  switch (input.type) {
    case "text": case "thinking": return { ...input, content: { ...input.content, images: [...input.content.images, image] } };
    case "answer": return { ...input, answer: { ...input.answer, images: [...input.answer.images, image] } };
    case "plugin-question-answer": return { ...input, answerImages: [...input.answerImages, image] };
    case "plugin-problem-submission": return { ...input, submissionImages: [...input.submissionImages, image] };
  }
}
