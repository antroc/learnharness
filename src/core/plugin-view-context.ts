/** Datos de vista de toda la sesión para acciones contextuales. Seguros para el navegador, sin propiedad de interfaz ni de store. */
import type { LhMessage } from "./native-messages.ts";
import type { LhViewMessage } from "./view.ts";
import type { Phase3 } from "./phases.ts";
import type { PluginActionContext } from "./plugins.ts";
import type { PluginSubmissionTarget, PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import type { PluginQuestionInput } from "./plugin-questions.ts";
import type { PluginProblemInput } from "./plugin-problems.ts";

type Immutable<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type Target<T extends PluginSubmissionTarget["type"]> = Extract<PluginSubmissionTarget, { type: T }>;
type ImmutableJson = null | boolean | number | string | readonly ImmutableJson[] | { readonly [key: string]: ImmutableJson };
type EditorState = { readonly status: "empty" } | { readonly status: "unready" | "ready"; readonly value: ImmutableJson };
type QuestionInput = Readonly<PluginQuestionInput<ImmutableJson>>;
type ProblemInput = Readonly<Omit<PluginProblemInput<ImmutableJson>, "target">> & { readonly target?: readonly string[] };
export interface PluginNativeQuestionViewDraft {
  readonly dontKnow: boolean;
  readonly values: readonly string[];
  readonly otherSelected: boolean;
  readonly other: string;
  readonly text: string;
  readonly thinking: string;
  readonly readingThinking: string;
  readonly confidence?: number;
}
export type PluginSessionViewInput =
  | Target<"text">
  | (Target<"answer"> & { readonly expanded: boolean; readonly revealed: boolean; readonly available: boolean; readonly draft: PluginNativeQuestionViewDraft })
  | (Target<"thinking"> & { readonly expanded: boolean; readonly draft: { readonly thinking: string } })
  | (Target<"plugin-question-answer"> & { readonly input: QuestionInput; readonly expanded: boolean; readonly revealed: boolean; readonly available: boolean;
      readonly draft: { readonly answer: EditorState; readonly thinking: string; readonly readingThinking: string } })
  | (Target<"plugin-problem-submission"> & { readonly input: ProblemInput; readonly expanded: boolean; readonly available: boolean;
      readonly draft: { readonly submission: EditorState; readonly thinking: string } })
  | { readonly type: "unavailable"; readonly occurrence?: PluginSubmissionOccurrence; readonly expanded: boolean; readonly revealed: boolean };
export interface PluginSessionViewContext {
  readonly sessionId: string;
  readonly kind: "teaching" | "practice";
  readonly title: string;
  /** La misma visibilidad del historial del navegador que el contexto de envío, incluido el contenido en streaming. */
  readonly messages: readonly Immutable<LhMessage>[];
  /** La proyección existente del host, no otro analizador de transcripciones escrito por el consumidor. */
  readonly transcript: readonly Immutable<LhViewMessage>[];
  readonly status: "ready" | "submitted" | "streaming" | "error";
  readonly reconciliation: "ready" | "syncing" | "failed";
  readonly busy: boolean;
  readonly compacting: boolean;
  readonly phase: Phase3 | "practice";
  readonly contextTokens: number | null;
  readonly queuedSteers: readonly { readonly id: string; readonly text: string }[];
  readonly composer: { readonly text: string };
  readonly input: PluginSessionViewInput;
}
type SessionViewSource = Omit<PluginSessionViewContext, "messages" | "transcript"> & {
  messages: readonly LhMessage[];
  transcript: readonly LhViewMessage[];
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
/** Desvincula todos los datos, pero nunca clona ni congela la capacidad de superficie opaca viva existente. */
export function capturePluginSessionView(source: SessionViewSource): PluginSessionViewContext {
  const { input, ...rest } = source;
  if (input.type === "unavailable") return freeze(structuredClone(source)) as unknown as PluginSessionViewContext;
  const { surfaceTarget, ...data } = input;
  const copy = freeze(structuredClone({ ...rest, input: data }));
  return Object.freeze({ ...copy, input: Object.freeze({ ...copy.input, surfaceTarget }) }) as PluginSessionViewContext;
}
/** Perezoso para los predicados de desactivación en tiempo de render; el marco fuerza una captura nueva al hacer clic. */
export function createPluginSessionActionContext(base: Omit<Extract<PluginActionContext, { surface: "session"; placement: "top-bar" }>, "view">,
  read: () => SessionViewSource): Extract<PluginActionContext, { surface: "session"; placement: "top-bar" }> {
  let snapshot: PluginSessionViewContext | undefined;
  return { ...base, get view() { return snapshot ??= capturePluginSessionView(read()); } };
}
