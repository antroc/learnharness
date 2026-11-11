# plugin-questions

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Ciclo de vida de las preguntas](../plugin-question-contract.md)

- [JsonValue](#jsonvalue)
- [PluginQuestionAnnotationRead](#pluginquestionannotationread)
- [PluginQuestionAnswer](#pluginquestionanswer)
- [PluginQuestionAnswerState](#pluginquestionanswerstate)
- [PluginQuestionAnswerValidationContext](#pluginquestionanswervalidationcontext)
- [PluginQuestionAttempt](#pluginquestionattempt)
- [PluginQuestionCancellation](#pluginquestioncancellation)
- [PluginQuestionEditorHandle](#pluginquestioneditorhandle)
- [PluginQuestionEditorKey](#pluginquestioneditorkey)
- [PluginQuestionEditorProps](#pluginquestioneditorprops)
- [PluginQuestionGradingContext](#pluginquestiongradingcontext)
- [PluginQuestionGradingOutcome](#pluginquestiongradingoutcome)
- [PluginQuestionInput](#pluginquestioninput)
- [PluginQuestionMountContext](#pluginquestionmountcontext)
- [PluginQuestionOccurrence](#pluginquestionoccurrence)
- [PluginQuestionOccurrenceMap](#pluginquestionoccurrencemap)
- [PluginQuestionRenderer](#pluginquestionrenderer)
- [PluginQuestionSnapshot](#pluginquestionsnapshot)
- [PluginQuestionTypeDefinition](#pluginquestiontypedefinition)
- [PluginQuestionValidationContext](#pluginquestionvalidationcontext)
- [PluginQuestionValidationResult](#pluginquestionvalidationresult)
- [PluginQuestionVariant](#pluginquestionvariant)

## JsonValue

Tipo público del SDK, exportado como `JsonValue`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [[index]](#jsonvalue-index)

### JsonValue [index]

```ts
[key: string]: JsonValue;
```

## PluginQuestionAnnotationRead

Tipo público del SDK, exportado como `PluginQuestionAnnotationRead`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Unreadable annotations remain classified as questions: never expose raw input.

```ts
export type PluginQuestionAnnotationRead = {
    status: "absent";
} | {
    status: "attempt";
    attempt: PluginQuestionAttempt;
} | {
    status: "posed";
    snapshot: PluginQuestionSnapshot;
} | {
    status: "unreadable";
    identity?: {
        questionId: string;
        occurrence: PluginQuestionOccurrence;
        pluginId: string;
        typeId: string;
        contractVersion: number;
    };
    binding?: {
        occurrence: PluginQuestionOccurrence;
        questionId?: string;
    };
};
```

**Tipos relacionados:** [PluginQuestionAttempt](plugin-questions.md#pluginquestionattempt), [PluginQuestionOccurrence](plugin-questions.md#pluginquestionoccurrence), [PluginQuestionSnapshot](plugin-questions.md#pluginquestionsnapshot).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [status](#pluginquestionannotationread-status) — 4 firmas o variantes
- [attempt](#pluginquestionannotationread-attempt)
- [snapshot](#pluginquestionannotationread-snapshot)
- [identity](#pluginquestionannotationread-identity)
- [identity.questionId](#pluginquestionannotationread-identityquestionid)
- [identity.occurrence](#pluginquestionannotationread-identityoccurrence)
- [identity.pluginId](#pluginquestionannotationread-identitypluginid)
- [identity.typeId](#pluginquestionannotationread-identitytypeid)
- [identity.contractVersion](#pluginquestionannotationread-identitycontractversion)
- [binding](#pluginquestionannotationread-binding)
- [binding.occurrence](#pluginquestionannotationread-bindingoccurrence)
- [binding.questionId](#pluginquestionannotationread-bindingquestionid)

### PluginQuestionAnnotationRead status

```ts
status: "absent";
```

```ts
status: "attempt";
```

```ts
status: "posed";
```

```ts
status: "unreadable";
```

### PluginQuestionAnnotationRead attempt

```ts
attempt: PluginQuestionAttempt;
```

### PluginQuestionAnnotationRead snapshot

```ts
snapshot: PluginQuestionSnapshot;
```

### PluginQuestionAnnotationRead identity

```ts
identity?: {
    questionId: string;
    occurrence: PluginQuestionOccurrence;
    pluginId: string;
    typeId: string;
    contractVersion: number;
};
```

### PluginQuestionAnnotationRead identity.questionId

```ts
questionId: string;
```

### PluginQuestionAnnotationRead identity.occurrence

```ts
occurrence: PluginQuestionOccurrence;
```

### PluginQuestionAnnotationRead identity.pluginId

```ts
pluginId: string;
```

### PluginQuestionAnnotationRead identity.typeId

```ts
typeId: string;
```

### PluginQuestionAnnotationRead identity.contractVersion

```ts
contractVersion: number;
```

### PluginQuestionAnnotationRead binding

Only available after matching a supplied canonical native occurrence.

```ts
binding?: {
    occurrence: PluginQuestionOccurrence;
    questionId?: string;
};
```

### PluginQuestionAnnotationRead binding.occurrence

```ts
occurrence: PluginQuestionOccurrence;
```

### PluginQuestionAnnotationRead binding.questionId

```ts
questionId?: string;
```

## PluginQuestionAnswer

Tipo público del SDK, exportado como `PluginQuestionAnswer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionAnswer {
    kind: "plugin-question";
    questionId: string;
    pluginId: string;
    typeId: string;
    contractVersion: number;
    answer: JsonValue;
    grading?: PluginQuestionGradingOutcome;
    thinking?: string;
    readingThinking?: string;
    images?: PluginSubmissionImages;
    answeredAt: string;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionGradingOutcome](plugin-questions.md#pluginquestiongradingoutcome), [PluginSubmissionImages](plugin-submissions.md#pluginsubmissionimages).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [kind](#pluginquestionanswer-kind)
- [questionId](#pluginquestionanswer-questionid)
- [pluginId](#pluginquestionanswer-pluginid)
- [typeId](#pluginquestionanswer-typeid)
- [contractVersion](#pluginquestionanswer-contractversion)
- [answer](#pluginquestionanswer-answer)
- [grading](#pluginquestionanswer-grading)
- [thinking](#pluginquestionanswer-thinking)
- [readingThinking](#pluginquestionanswer-readingthinking)
- [images](#pluginquestionanswer-images)
- [answeredAt](#pluginquestionanswer-answeredat)

### PluginQuestionAnswer kind

```ts
kind: "plugin-question";
```

### PluginQuestionAnswer questionId

```ts
questionId: string;
```

### PluginQuestionAnswer pluginId

```ts
pluginId: string;
```

### PluginQuestionAnswer typeId

```ts
typeId: string;
```

### PluginQuestionAnswer contractVersion

```ts
contractVersion: number;
```

### PluginQuestionAnswer answer

```ts
answer: JsonValue;
```

### PluginQuestionAnswer grading

```ts
grading?: PluginQuestionGradingOutcome;
```

### PluginQuestionAnswer thinking

```ts
thinking?: string;
```

### PluginQuestionAnswer readingThinking

```ts
readingThinking?: string;
```

### PluginQuestionAnswer images

```ts
images?: PluginSubmissionImages;
```

### PluginQuestionAnswer answeredAt

```ts
answeredAt: string;
```

## PluginQuestionAnswerState

Tipo público del SDK, exportado como `PluginQuestionAnswerState`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionAnswerState = {
    status: "empty";
} | {
    status: "unready" | "ready";
    value: JsonValue;
};
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [status](#pluginquestionanswerstate-status) — 2 firmas o variantes
- [value](#pluginquestionanswerstate-value)

### PluginQuestionAnswerState status

```ts
status: "empty";
```

```ts
status: "unready" | "ready";
```

### PluginQuestionAnswerState value

```ts
value: JsonValue;
```

## PluginQuestionAnswerValidationContext

Tipo público del SDK, exportado como `PluginQuestionAnswerValidationContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionAnswerValidationContext<Q = JsonValue, A = JsonValue> extends PluginQuestionValidationContext<Q> {
    readonly questionId: string;
    readonly answer: A;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionValidationContext](plugin-questions.md#pluginquestionvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [questionId](#pluginquestionanswervalidationcontext-questionid)
- [answer](#pluginquestionanswervalidationcontext-answer)

### PluginQuestionAnswerValidationContext questionId

```ts
readonly questionId: string;
```

### PluginQuestionAnswerValidationContext answer

```ts
readonly answer: A;
```

## PluginQuestionAttempt

Tipo público del SDK, exportado como `PluginQuestionAttempt`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Visibility only: an unsuccessful attempt never grants pending authority.

```ts
export interface PluginQuestionAttempt {
    protocolVersion: 1 | 2;
    requiresGrading?: true;
    pluginId: string;
    typeId: string;
    label: string;
    variant: PluginQuestionVariant;
}
```

**Tipos relacionados:** [PluginQuestionVariant](plugin-questions.md#pluginquestionvariant).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [protocolVersion](#pluginquestionattempt-protocolversion)
- [requiresGrading](#pluginquestionattempt-requiresgrading)
- [pluginId](#pluginquestionattempt-pluginid)
- [typeId](#pluginquestionattempt-typeid)
- [label](#pluginquestionattempt-label)
- [variant](#pluginquestionattempt-variant)

### PluginQuestionAttempt protocolVersion

```ts
protocolVersion: 1 | 2;
```

### PluginQuestionAttempt requiresGrading

Protocol v2 freezes grading at pose time; historical v1 omits this field.

```ts
requiresGrading?: true;
```

### PluginQuestionAttempt pluginId

```ts
pluginId: string;
```

### PluginQuestionAttempt typeId

```ts
typeId: string;
```

### PluginQuestionAttempt label

```ts
label: string;
```

### PluginQuestionAttempt variant

```ts
variant: PluginQuestionVariant;
```

## PluginQuestionCancellation

Tipo público del SDK, exportado como `PluginQuestionCancellation`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionCancellation {
    kind: "plugin-question-cancelled";
    questionId?: string;
    occurrence: PluginQuestionOccurrence;
    reason: "dismissed" | "incompatible" | "unreadable-protocol";
}
```

**Tipos relacionados:** [PluginQuestionOccurrence](plugin-questions.md#pluginquestionoccurrence).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [kind](#pluginquestioncancellation-kind)
- [questionId](#pluginquestioncancellation-questionid)
- [occurrence](#pluginquestioncancellation-occurrence)
- [reason](#pluginquestioncancellation-reason)

### PluginQuestionCancellation kind

```ts
kind: "plugin-question-cancelled";
```

### PluginQuestionCancellation questionId

Omitted only when the question is unreadable: explicit dismissal or protocol cancellation, with an exact occurrence binding.

```ts
questionId?: string;
```

### PluginQuestionCancellation occurrence

```ts
occurrence: PluginQuestionOccurrence;
```

### PluginQuestionCancellation reason

```ts
reason: "dismissed" | "incompatible" | "unreadable-protocol";
```

## PluginQuestionEditorHandle

Tipo público del SDK, exportado como `PluginQuestionEditorHandle`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionEditorHandle {
    update(props: {
        answer: PluginQuestionAnswerState;
        active: boolean;
    }): void;
    focus(): void;
    handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
    appendTranscript?(text: string): void | Promise<void>;
    dispose(): void;
}
```

**Tipos relacionados:** [PluginQuestionAnswerState](plugin-questions.md#pluginquestionanswerstate), [PluginQuestionEditorKey](plugin-questions.md#pluginquestioneditorkey).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [update](#pluginquestioneditorhandle-update)
- [focus](#pluginquestioneditorhandle-focus)
- [handleKeyDown](#pluginquestioneditorhandle-handlekeydown)
- [appendTranscript](#pluginquestioneditorhandle-appendtranscript)
- [dispose](#pluginquestioneditorhandle-dispose)

### PluginQuestionEditorHandle update

```ts
update(props: {
    answer: PluginQuestionAnswerState;
    active: boolean;
}): void;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `{         answer: PluginQuestionAnswerState;         active: boolean;     }` |

**Devuelve:** `void`.

### PluginQuestionEditorHandle focus

```ts
focus(): void;
```

**Devuelve:** `void`.

### PluginQuestionEditorHandle handleKeyDown

Optional editing override. Omission or "pass" uses host defaults:
Enter submits, Shift+Enter keeps native newline editing, Tab cycles fields.
Unhandled Escape moves to the next host field, or blurs an editor-only chain.
Meta/Ctrl+Enter remains reserved host submission.

```ts
handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
```

| Parámetro | Tipo |
| --- | --- |
| `key` | `PluginQuestionEditorKey` |

**Devuelve:** `"handled" \| "pass"`.

### PluginQuestionEditorHandle appendTranscript

```ts
appendTranscript?(text: string): void | Promise<void>;
```

| Parámetro | Tipo |
| --- | --- |
| `text` | `string` |

**Devuelve:** `void \| Promise<void>`.

### PluginQuestionEditorHandle dispose

```ts
dispose(): void;
```

**Devuelve:** `void`.

## PluginQuestionEditorKey

Tipo público del SDK, exportado como `PluginQuestionEditorKey`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionEditorKey = "Tab" | "Enter" | "Shift+Enter" | "Escape";
```

## PluginQuestionEditorProps

Tipo público del SDK, exportado como `PluginQuestionEditorProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionEditorProps<Q = JsonValue> extends PluginQuestionMountContext<Q> {
    readonly active: boolean;
    readonly answer: PluginQuestionAnswerState;
    onChange(answer: PluginQuestionAnswerState): void;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionAnswerState](plugin-questions.md#pluginquestionanswerstate), [PluginQuestionMountContext](plugin-questions.md#pluginquestionmountcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [active](#pluginquestioneditorprops-active)
- [answer](#pluginquestioneditorprops-answer)
- [onChange](#pluginquestioneditorprops-onchange)

### PluginQuestionEditorProps active

```ts
readonly active: boolean;
```

### PluginQuestionEditorProps answer

```ts
readonly answer: PluginQuestionAnswerState;
```

### PluginQuestionEditorProps onChange

Synchronous publication; stale mount publications are ignored by the host.

```ts
onChange(answer: PluginQuestionAnswerState): void;
```

| Parámetro | Tipo |
| --- | --- |
| `answer` | `PluginQuestionAnswerState` |

**Devuelve:** `void`.

## PluginQuestionGradingContext

Tipo público del SDK, exportado como `PluginQuestionGradingContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionGradingContext<Q = JsonValue, A = JsonValue> extends PluginQuestionAnswerValidationContext<Q, A> {
    readonly signal: AbortSignal;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionAnswerValidationContext](plugin-questions.md#pluginquestionanswervalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [signal](#pluginquestiongradingcontext-signal)

### PluginQuestionGradingContext signal

```ts
readonly signal: AbortSignal;
```

## PluginQuestionGradingOutcome

Tipo público del SDK, exportado como `PluginQuestionGradingOutcome`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionGradingOutcome = {
    result: JsonValue;
} | {
    error: string;
};
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [result](#pluginquestiongradingoutcome-result)
- [error](#pluginquestiongradingoutcome-error)

### PluginQuestionGradingOutcome result

```ts
result: JsonValue;
```

### PluginQuestionGradingOutcome error

```ts
error: string;
```

## PluginQuestionInput

Tipo público del SDK, exportado como `PluginQuestionInput`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionInput<Q = JsonValue> = {
    question: string;
    payload: Q;
} & ({
    type?: never;
    nodeId?: never;
} | {
    type: "predict" | "check";
    nodeId: string;
});
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [question](#pluginquestioninput-question)
- [payload](#pluginquestioninput-payload)
- [type](#pluginquestioninput-type) — 2 firmas o variantes
- [nodeId](#pluginquestioninput-nodeid) — 2 firmas o variantes

### PluginQuestionInput question

```ts
question: string;
```

### PluginQuestionInput payload

```ts
payload: Q;
```

### PluginQuestionInput type

```ts
type?: never;
```

```ts
type: "predict" | "check";
```

### PluginQuestionInput nodeId

```ts
nodeId?: never;
```

```ts
nodeId: string;
```

## PluginQuestionMountContext

Tipo público del SDK, exportado como `PluginQuestionMountContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionMountContext<Q = JsonValue> {
    readonly input: PluginQuestionInput<Q>;
    readonly chatId: string;
    readonly questionId: string;
    readonly contractVersion: number;
    readonly variant: PluginQuestionVariant;
    readonly signal: AbortSignal;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionInput](plugin-questions.md#pluginquestioninput), [PluginQuestionVariant](plugin-questions.md#pluginquestionvariant).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [input](#pluginquestionmountcontext-input)
- [chatId](#pluginquestionmountcontext-chatid)
- [questionId](#pluginquestionmountcontext-questionid)
- [contractVersion](#pluginquestionmountcontext-contractversion)
- [variant](#pluginquestionmountcontext-variant)
- [signal](#pluginquestionmountcontext-signal)

### PluginQuestionMountContext input

```ts
readonly input: PluginQuestionInput<Q>;
```

### PluginQuestionMountContext chatId

```ts
readonly chatId: string;
```

### PluginQuestionMountContext questionId

```ts
readonly questionId: string;
```

### PluginQuestionMountContext contractVersion

```ts
readonly contractVersion: number;
```

### PluginQuestionMountContext variant

```ts
readonly variant: PluginQuestionVariant;
```

### PluginQuestionMountContext signal

```ts
readonly signal: AbortSignal;
```

## PluginQuestionOccurrence

Tipo público del SDK, exportado como `PluginQuestionOccurrence`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionOccurrence {
    messageId: string;
    contentIndex: number;
    toolCallId: string;
    toolName: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [messageId](#pluginquestionoccurrence-messageid)
- [contentIndex](#pluginquestionoccurrence-contentindex)
- [toolCallId](#pluginquestionoccurrence-toolcallid)
- [toolName](#pluginquestionoccurrence-toolname)

### PluginQuestionOccurrence messageId

```ts
messageId: string;
```

### PluginQuestionOccurrence contentIndex

```ts
contentIndex: number;
```

### PluginQuestionOccurrence toolCallId

```ts
toolCallId: string;
```

### PluginQuestionOccurrence toolName

```ts
toolName: string;
```

## PluginQuestionOccurrenceMap

Tipo público del SDK, exportado como `PluginQuestionOccurrenceMap`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionOccurrenceMap = Record<string, PluginQuestionAttempt | PluginQuestionSnapshot>;
```

**Tipos relacionados:** [PluginQuestionAttempt](plugin-questions.md#pluginquestionattempt), [PluginQuestionSnapshot](plugin-questions.md#pluginquestionsnapshot).

## PluginQuestionRenderer

Tipo público del SDK, exportado como `PluginQuestionRenderer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionRenderer<Q = JsonValue, A = JsonValue> {
    id: string;
    supportedContractVersions: number[];
    mountQuestion?(container: HTMLElement, context: PluginQuestionMountContext<Q>): void | PluginCleanup | Promise<void | PluginCleanup>;
    mountAnswerEditor(container: HTMLElement, context: PluginQuestionEditorProps<Q>): PluginQuestionEditorHandle | Promise<PluginQuestionEditorHandle>;
    mountAnswered?(container: HTMLElement, context: PluginQuestionMountContext<Q> & {
        readonly answer: A;
        readonly grading?: PluginQuestionGradingOutcome;
        readonly headerContainer?: HTMLElement;
        readonly footerContainer?: HTMLElement;
    }): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginCleanup](plugins.md#plugincleanup), [PluginQuestionEditorHandle](plugin-questions.md#pluginquestioneditorhandle), [PluginQuestionEditorProps](plugin-questions.md#pluginquestioneditorprops), [PluginQuestionGradingOutcome](plugin-questions.md#pluginquestiongradingoutcome), [PluginQuestionMountContext](plugin-questions.md#pluginquestionmountcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginquestionrenderer-id)
- [supportedContractVersions](#pluginquestionrenderer-supportedcontractversions)
- [mountQuestion](#pluginquestionrenderer-mountquestion)
- [mountAnswerEditor](#pluginquestionrenderer-mountanswereditor)
- [mountAnswered](#pluginquestionrenderer-mountanswered)

### PluginQuestionRenderer id

```ts
id: string;
```

### PluginQuestionRenderer supportedContractVersions

```ts
supportedContractVersions: number[];
```

### PluginQuestionRenderer mountQuestion

```ts
mountQuestion?(container: HTMLElement, context: PluginQuestionMountContext<Q>): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `context` | `PluginQuestionMountContext<Q>` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

### PluginQuestionRenderer mountAnswerEditor

```ts
mountAnswerEditor(container: HTMLElement, context: PluginQuestionEditorProps<Q>): PluginQuestionEditorHandle | Promise<PluginQuestionEditorHandle>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `context` | `PluginQuestionEditorProps<Q>` |

**Devuelve:** `PluginQuestionEditorHandle \| Promise<PluginQuestionEditorHandle>`.

### PluginQuestionRenderer mountAnswered

```ts
mountAnswered?(container: HTMLElement, context: PluginQuestionMountContext<Q> & {
    readonly answer: A;
    readonly grading?: PluginQuestionGradingOutcome;
    readonly headerContainer?: HTMLElement;
    readonly footerContainer?: HTMLElement;
}): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `context` | `PluginQuestionMountContext<Q> & {         readonly answer: A;         readonly grading?: PluginQuestionGradingOutcome;         readonly headerContainer?: HTMLElement;         readonly footerContainer?: HTMLElement;     }` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginQuestionSnapshot

Tipo público del SDK, exportado como `PluginQuestionSnapshot`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionSnapshot extends PluginQuestionAttempt {
    questionId: string;
    occurrence: PluginQuestionOccurrence;
    contractVersion: number;
    input: PluginQuestionInput;
    questionSchema: TSchema;
    answerSchema: TSchema;
    showThinking: boolean;
    requiresAnswerRefinement: boolean;
}
```

**Tipos relacionados:** [PluginQuestionAttempt](plugin-questions.md#pluginquestionattempt), [PluginQuestionInput](plugin-questions.md#pluginquestioninput), [PluginQuestionOccurrence](plugin-questions.md#pluginquestionoccurrence).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [questionId](#pluginquestionsnapshot-questionid)
- [occurrence](#pluginquestionsnapshot-occurrence)
- [contractVersion](#pluginquestionsnapshot-contractversion)
- [input](#pluginquestionsnapshot-input)
- [questionSchema](#pluginquestionsnapshot-questionschema)
- [answerSchema](#pluginquestionsnapshot-answerschema)
- [showThinking](#pluginquestionsnapshot-showthinking)
- [requiresAnswerRefinement](#pluginquestionsnapshot-requiresanswerrefinement)

### PluginQuestionSnapshot questionId

```ts
questionId: string;
```

### PluginQuestionSnapshot occurrence

```ts
occurrence: PluginQuestionOccurrence;
```

### PluginQuestionSnapshot contractVersion

```ts
contractVersion: number;
```

### PluginQuestionSnapshot input

```ts
input: PluginQuestionInput;
```

### PluginQuestionSnapshot questionSchema

```ts
questionSchema: TSchema;
```

### PluginQuestionSnapshot answerSchema

```ts
answerSchema: TSchema;
```

### PluginQuestionSnapshot showThinking

```ts
showThinking: boolean;
```

### PluginQuestionSnapshot requiresAnswerRefinement

```ts
requiresAnswerRefinement: boolean;
```

## PluginQuestionTypeDefinition

Tipo público del SDK, exportado como `PluginQuestionTypeDefinition`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionTypeDefinition<Q extends TSchema = TSchema, A extends TSchema = TSchema> {
    id: string;
    label: string;
    contractVersion: number;
    incompatibleContractVersions?: number[];
    showThinking: boolean;
    questionSchema: Q;
    answerSchema: A;
    probe?: {
        toolName: string;
        description: string;
    };
    teach?: {
        toolName: string;
        description: string;
    };
    validateQuestion?: (context: PluginQuestionValidationContext<Static<Q>>) => undefined | string[];
    validateAnswer?: (context: PluginQuestionAnswerValidationContext<Static<Q>, Static<A>>) => undefined | string[];
    gradeAnswer?: (context: PluginQuestionGradingContext<Static<Q>, Static<A>>) => JsonValue | Promise<JsonValue>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionAnswerValidationContext](plugin-questions.md#pluginquestionanswervalidationcontext), [PluginQuestionGradingContext](plugin-questions.md#pluginquestiongradingcontext), [PluginQuestionValidationContext](plugin-questions.md#pluginquestionvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginquestiontypedefinition-id)
- [label](#pluginquestiontypedefinition-label)
- [contractVersion](#pluginquestiontypedefinition-contractversion)
- [incompatibleContractVersions](#pluginquestiontypedefinition-incompatiblecontractversions)
- [showThinking](#pluginquestiontypedefinition-showthinking)
- [questionSchema](#pluginquestiontypedefinition-questionschema)
- [answerSchema](#pluginquestiontypedefinition-answerschema)
- [probe](#pluginquestiontypedefinition-probe)
- [probe.toolName](#pluginquestiontypedefinition-probetoolname)
- [probe.description](#pluginquestiontypedefinition-probedescription)
- [teach](#pluginquestiontypedefinition-teach)
- [teach.toolName](#pluginquestiontypedefinition-teachtoolname)
- [teach.description](#pluginquestiontypedefinition-teachdescription)
- [validateQuestion](#pluginquestiontypedefinition-validatequestion)
- [validateAnswer](#pluginquestiontypedefinition-validateanswer)
- [gradeAnswer](#pluginquestiontypedefinition-gradeanswer)

### PluginQuestionTypeDefinition id

```ts
id: string;
```

### PluginQuestionTypeDefinition label

```ts
label: string;
```

### PluginQuestionTypeDefinition contractVersion

```ts
contractVersion: number;
```

### PluginQuestionTypeDefinition incompatibleContractVersions

```ts
incompatibleContractVersions?: number[];
```

### PluginQuestionTypeDefinition showThinking

```ts
showThinking: boolean;
```

### PluginQuestionTypeDefinition questionSchema

```ts
questionSchema: Q;
```

### PluginQuestionTypeDefinition answerSchema

```ts
answerSchema: A;
```

### PluginQuestionTypeDefinition probe

```ts
probe?: {
    toolName: string;
    description: string;
};
```

### PluginQuestionTypeDefinition probe.toolName

```ts
toolName: string;
```

### PluginQuestionTypeDefinition probe.description

```ts
description: string;
```

### PluginQuestionTypeDefinition teach

```ts
teach?: {
    toolName: string;
    description: string;
};
```

### PluginQuestionTypeDefinition teach.toolName

```ts
toolName: string;
```

### PluginQuestionTypeDefinition teach.description

```ts
description: string;
```

### PluginQuestionTypeDefinition validateQuestion

```ts
validateQuestion?: (context: PluginQuestionValidationContext<Static<Q>>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginQuestionValidationContext<Static<Q>>` |

**Devuelve:** `undefined \| string[]`.

### PluginQuestionTypeDefinition validateAnswer

```ts
validateAnswer?: (context: PluginQuestionAnswerValidationContext<Static<Q>, Static<A>>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginQuestionAnswerValidationContext<Static<Q>, Static<A>>` |

**Devuelve:** `undefined \| string[]`.

### PluginQuestionTypeDefinition gradeAnswer

```ts
gradeAnswer?: (context: PluginQuestionGradingContext<Static<Q>, Static<A>>) => JsonValue | Promise<JsonValue>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginQuestionGradingContext<Static<Q>, Static<A>>` |

**Devuelve:** `JsonValue \| Promise<JsonValue>`.

## PluginQuestionValidationContext

Tipo público del SDK, exportado como `PluginQuestionValidationContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginQuestionValidationContext<Q = JsonValue> {
    readonly chatId: string;
    readonly variant: PluginQuestionVariant;
    readonly contractVersion: number;
    readonly input: PluginQuestionInput<Q>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginQuestionInput](plugin-questions.md#pluginquestioninput), [PluginQuestionVariant](plugin-questions.md#pluginquestionvariant).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#pluginquestionvalidationcontext-chatid)
- [variant](#pluginquestionvalidationcontext-variant)
- [contractVersion](#pluginquestionvalidationcontext-contractversion)
- [input](#pluginquestionvalidationcontext-input)

### PluginQuestionValidationContext chatId

```ts
readonly chatId: string;
```

### PluginQuestionValidationContext variant

```ts
readonly variant: PluginQuestionVariant;
```

### PluginQuestionValidationContext contractVersion

```ts
readonly contractVersion: number;
```

### PluginQuestionValidationContext input

```ts
readonly input: PluginQuestionInput<Q>;
```

## PluginQuestionValidationResult

Tipo público del SDK, exportado como `PluginQuestionValidationResult`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    problems: string[];
};
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [ok](#pluginquestionvalidationresult-ok) — 2 firmas o variantes
- [value](#pluginquestionvalidationresult-value)
- [problems](#pluginquestionvalidationresult-problems)

### PluginQuestionValidationResult ok

```ts
ok: true;
```

```ts
ok: false;
```

### PluginQuestionValidationResult value

```ts
value: T;
```

### PluginQuestionValidationResult problems

```ts
problems: string[];
```

## PluginQuestionVariant

Tipo público del SDK, exportado como `PluginQuestionVariant`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginQuestionVariant = "probe" | "teach";
```
