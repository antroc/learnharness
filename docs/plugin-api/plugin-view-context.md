# plugin-view-context

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Contexto de vista de la sesión](../plugin-view-context.md)

- [EditorState](#editorstate) — declaración de apoyo
- [Immutable](#immutable) — declaración de apoyo
- [ImmutableJson](#immutablejson) — declaración de apoyo
- [PluginNativeQuestionViewDraft](#pluginnativequestionviewdraft)
- [PluginSessionViewContext](#pluginsessionviewcontext)
- [PluginSessionViewInput](#pluginsessionviewinput)
- [ProblemInput](#probleminput) — declaración de apoyo
- [QuestionInput](#questioninput) — declaración de apoyo
- [Target](#target) — declaración de apoyo

## EditorState

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type EditorState = {
    readonly status: "empty";
} | {
    readonly status: "unready" | "ready";
    readonly value: ImmutableJson;
};
```

**Tipos relacionados:** [ImmutableJson](plugin-view-context.md#immutablejson).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [status](#editorstate-status) — 2 firmas o variantes
- [value](#editorstate-value)

### EditorState status

```ts
readonly status: "empty";
```

```ts
readonly status: "unready" | "ready";
```

### EditorState value

```ts
readonly value: ImmutableJson;
```

## Immutable

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type Immutable<T> = T extends (...args: never[]) => unknown ? T : T extends object ? {
    readonly [K in keyof T]: Immutable<T[K]>;
} : T;
```

## ImmutableJson

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type ImmutableJson = null | boolean | number | string | readonly ImmutableJson[] | {
    readonly [key: string]: ImmutableJson;
};
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [[index]](#immutablejson-index)

### ImmutableJson [index]

```ts
readonly [key: string]: ImmutableJson;
```

## PluginNativeQuestionViewDraft

Tipo público del SDK, exportado como `PluginNativeQuestionViewDraft`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
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
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [dontKnow](#pluginnativequestionviewdraft-dontknow)
- [values](#pluginnativequestionviewdraft-values)
- [otherSelected](#pluginnativequestionviewdraft-otherselected)
- [other](#pluginnativequestionviewdraft-other)
- [text](#pluginnativequestionviewdraft-text)
- [thinking](#pluginnativequestionviewdraft-thinking)
- [readingThinking](#pluginnativequestionviewdraft-readingthinking)
- [confidence](#pluginnativequestionviewdraft-confidence)

### PluginNativeQuestionViewDraft dontKnow

```ts
readonly dontKnow: boolean;
```

### PluginNativeQuestionViewDraft values

```ts
readonly values: readonly string[];
```

### PluginNativeQuestionViewDraft otherSelected

```ts
readonly otherSelected: boolean;
```

### PluginNativeQuestionViewDraft other

```ts
readonly other: string;
```

### PluginNativeQuestionViewDraft text

```ts
readonly text: string;
```

### PluginNativeQuestionViewDraft thinking

```ts
readonly thinking: string;
```

### PluginNativeQuestionViewDraft readingThinking

```ts
readonly readingThinking: string;
```

### PluginNativeQuestionViewDraft confidence

```ts
readonly confidence?: number;
```

## PluginSessionViewContext

Tipo público del SDK, exportado como `PluginSessionViewContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginSessionViewContext {
    readonly sessionId: string;
    readonly kind: "teaching" | "practice";
    readonly title: string;
    readonly messages: readonly Immutable<LhMessage>[];
    readonly transcript: readonly Immutable<LhViewMessage>[];
    readonly status: "ready" | "submitted" | "streaming" | "error";
    readonly reconciliation: "ready" | "syncing" | "failed";
    readonly busy: boolean;
    readonly compacting: boolean;
    readonly phase: Phase3 | "practice";
    readonly contextTokens: number | null;
    readonly queuedSteers: readonly {
        readonly id: string;
        readonly text: string;
    }[];
    readonly composer: {
        readonly text: string;
    };
    readonly input: PluginSessionViewInput;
}
```

**Tipos relacionados:** [Immutable](plugin-view-context.md#immutable), [LhMessage](native-messages.md#lhmessage), [LhViewMessage](view.md#lhviewmessage), [Phase3](phases.md#phase3), [PluginSessionViewInput](plugin-view-context.md#pluginsessionviewinput).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [sessionId](#pluginsessionviewcontext-sessionid)
- [kind](#pluginsessionviewcontext-kind)
- [title](#pluginsessionviewcontext-title)
- [messages](#pluginsessionviewcontext-messages)
- [transcript](#pluginsessionviewcontext-transcript)
- [status](#pluginsessionviewcontext-status)
- [reconciliation](#pluginsessionviewcontext-reconciliation)
- [busy](#pluginsessionviewcontext-busy)
- [compacting](#pluginsessionviewcontext-compacting)
- [phase](#pluginsessionviewcontext-phase)
- [contextTokens](#pluginsessionviewcontext-contexttokens)
- [queuedSteers](#pluginsessionviewcontext-queuedsteers)
- [composer](#pluginsessionviewcontext-composer)
- [composer.text](#pluginsessionviewcontext-composertext)
- [input](#pluginsessionviewcontext-input)

### PluginSessionViewContext sessionId

```ts
readonly sessionId: string;
```

### PluginSessionViewContext kind

```ts
readonly kind: "teaching" | "practice";
```

### PluginSessionViewContext title

```ts
readonly title: string;
```

### PluginSessionViewContext messages

La misma visibilidad del historial del navegador que el contexto de envío, incluido el contenido en streaming.

```ts
readonly messages: readonly Immutable<LhMessage>[];
```

### PluginSessionViewContext transcript

La proyección existente del host, no otro analizador de transcripciones escrito por el consumidor.

```ts
readonly transcript: readonly Immutable<LhViewMessage>[];
```

### PluginSessionViewContext status

```ts
readonly status: "ready" | "submitted" | "streaming" | "error";
```

### PluginSessionViewContext reconciliation

```ts
readonly reconciliation: "ready" | "syncing" | "failed";
```

### PluginSessionViewContext busy

```ts
readonly busy: boolean;
```

### PluginSessionViewContext compacting

```ts
readonly compacting: boolean;
```

### PluginSessionViewContext phase

```ts
readonly phase: Phase3 | "practice";
```

### PluginSessionViewContext contextTokens

```ts
readonly contextTokens: number | null;
```

### PluginSessionViewContext queuedSteers

```ts
readonly queuedSteers: readonly {
    readonly id: string;
    readonly text: string;
}[];
```

### PluginSessionViewContext composer

```ts
readonly composer: {
    readonly text: string;
};
```

### PluginSessionViewContext composer.text

```ts
readonly text: string;
```

### PluginSessionViewContext input

```ts
readonly input: PluginSessionViewInput;
```

## PluginSessionViewInput

Tipo público del SDK, exportado como `PluginSessionViewInput`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSessionViewInput = Target<"text"> | (Target<"answer"> & {
    readonly expanded: boolean;
    readonly revealed: boolean;
    readonly available: boolean;
    readonly draft: PluginNativeQuestionViewDraft;
}) | (Target<"thinking"> & {
    readonly expanded: boolean;
    readonly draft: {
        readonly thinking: string;
    };
}) | (Target<"plugin-question-answer"> & {
    readonly input: QuestionInput;
    readonly expanded: boolean;
    readonly revealed: boolean;
    readonly available: boolean;
    readonly draft: {
        readonly answer: EditorState;
        readonly thinking: string;
        readonly readingThinking: string;
    };
}) | (Target<"plugin-problem-submission"> & {
    readonly input: ProblemInput;
    readonly expanded: boolean;
    readonly available: boolean;
    readonly draft: {
        readonly submission: EditorState;
        readonly thinking: string;
    };
}) | {
    readonly type: "unavailable";
    readonly occurrence?: PluginSubmissionOccurrence;
    readonly expanded: boolean;
    readonly revealed: boolean;
};
```

**Tipos relacionados:** [EditorState](plugin-view-context.md#editorstate), [PluginNativeQuestionViewDraft](plugin-view-context.md#pluginnativequestionviewdraft), [PluginSubmissionOccurrence](plugin-submissions.md#pluginsubmissionoccurrence), [ProblemInput](plugin-view-context.md#probleminput), [QuestionInput](plugin-view-context.md#questioninput), [Target](plugin-view-context.md#target).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [expanded](#pluginsessionviewinput-expanded) — 5 firmas o variantes
- [revealed](#pluginsessionviewinput-revealed) — 3 firmas o variantes
- [available](#pluginsessionviewinput-available) — 3 firmas o variantes
- [draft](#pluginsessionviewinput-draft) — 4 firmas o variantes
- [draft.thinking](#pluginsessionviewinput-draftthinking) — 3 firmas o variantes
- [input](#pluginsessionviewinput-input) — 2 firmas o variantes
- [draft.answer](#pluginsessionviewinput-draftanswer)
- [draft.readingThinking](#pluginsessionviewinput-draftreadingthinking)
- [draft.submission](#pluginsessionviewinput-draftsubmission)
- [type](#pluginsessionviewinput-type)
- [occurrence](#pluginsessionviewinput-occurrence)

### PluginSessionViewInput expanded

```ts
readonly expanded: boolean;
```

```ts
readonly expanded: boolean;
```

```ts
readonly expanded: boolean;
```

```ts
readonly expanded: boolean;
```

```ts
readonly expanded: boolean;
```

### PluginSessionViewInput revealed

```ts
readonly revealed: boolean;
```

```ts
readonly revealed: boolean;
```

```ts
readonly revealed: boolean;
```

### PluginSessionViewInput available

```ts
readonly available: boolean;
```

```ts
readonly available: boolean;
```

```ts
readonly available: boolean;
```

### PluginSessionViewInput draft

```ts
readonly draft: PluginNativeQuestionViewDraft;
```

```ts
readonly draft: {
    readonly thinking: string;
};
```

```ts
readonly draft: {
    readonly answer: EditorState;
    readonly thinking: string;
    readonly readingThinking: string;
};
```

```ts
readonly draft: {
    readonly submission: EditorState;
    readonly thinking: string;
};
```

### PluginSessionViewInput draft.thinking

```ts
readonly thinking: string;
```

```ts
readonly thinking: string;
```

```ts
readonly thinking: string;
```

### PluginSessionViewInput input

```ts
readonly input: QuestionInput;
```

```ts
readonly input: ProblemInput;
```

### PluginSessionViewInput draft.answer

```ts
readonly answer: EditorState;
```

### PluginSessionViewInput draft.readingThinking

```ts
readonly readingThinking: string;
```

### PluginSessionViewInput draft.submission

```ts
readonly submission: EditorState;
```

### PluginSessionViewInput type

```ts
readonly type: "unavailable";
```

### PluginSessionViewInput occurrence

```ts
readonly occurrence?: PluginSubmissionOccurrence;
```

## ProblemInput

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type ProblemInput = Readonly<Omit<PluginProblemInput<ImmutableJson>, "target">> & {
    readonly target?: readonly string[];
};
```

**Tipos relacionados:** [ImmutableJson](plugin-view-context.md#immutablejson), [PluginProblemInput](plugin-problems.md#pluginprobleminput).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [target](#probleminput-target)

### ProblemInput target

```ts
readonly target?: readonly string[];
```

## QuestionInput

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type QuestionInput = Readonly<PluginQuestionInput<ImmutableJson>>;
```

**Tipos relacionados:** [ImmutableJson](plugin-view-context.md#immutablejson), [PluginQuestionInput](plugin-questions.md#pluginquestioninput).

## Target

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type Target<T extends PluginSubmissionTarget["type"]> = Extract<PluginSubmissionTarget, {
    type: T;
}>;
```

**Tipos relacionados:** [PluginSubmissionTarget](plugin-submissions.md#pluginsubmissiontarget).
