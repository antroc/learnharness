# plugin-submissions

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Intercepción de envíos](../plugin-session-extension-contract.md)

- [Immutable](#immutable) — declaración de apoyo
- [ImmutableJson](#immutablejson) — declaración de apoyo
- [ImmutableJsonArray](#immutablejsonarray) — declaración de apoyo
- [ImmutableJsonObject](#immutablejsonobject) — declaración de apoyo
- [PluginBuiltinSubmissionAnswer](#pluginbuiltinsubmissionanswer)
- [PluginProblemSubmissionImages](#pluginproblemsubmissionimages)
- [PluginSubmission](#pluginsubmission)
- [PluginSubmissionChannel](#pluginsubmissionchannel)
- [PluginSubmissionContent](#pluginsubmissioncontent)
- [PluginSubmissionContext](#pluginsubmissioncontext)
- [PluginSubmissionImages](#pluginsubmissionimages)
- [PluginSubmissionInterceptor](#pluginsubmissioninterceptor)
- [PluginSubmissionOccurrence](#pluginsubmissionoccurrence)
- [PluginSubmissionTarget](#pluginsubmissiontarget)
- [SubmissionTargetBase](#submissiontargetbase) — declaración de apoyo

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
type ImmutableJson = null | boolean | number | string | ImmutableJsonArray | ImmutableJsonObject;
```

**Tipos relacionados:** [ImmutableJsonArray](plugin-submissions.md#immutablejsonarray), [ImmutableJsonObject](plugin-submissions.md#immutablejsonobject).

## ImmutableJsonArray

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
interface ImmutableJsonArray extends ReadonlyArray<ImmutableJson> {
}
```

**Tipos relacionados:** [ImmutableJson](plugin-submissions.md#immutablejson).

## ImmutableJsonObject

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
interface ImmutableJsonObject {
    readonly [key: string]: ImmutableJson;
}
```

**Tipos relacionados:** [ImmutableJson](plugin-submissions.md#immutablejson).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [[index]](#immutablejsonobject-index)

### ImmutableJsonObject [index]

```ts
readonly [key: string]: ImmutableJson;
```

## PluginBuiltinSubmissionAnswer

Tipo público del SDK, exportado como `PluginBuiltinSubmissionAnswer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginBuiltinSubmissionAnswer {
    readonly dontKnow?: boolean;
    readonly values?: readonly string[];
    readonly other?: string;
    readonly text?: string;
    readonly confidence?: number;
    readonly images: readonly Readonly<ImageContent>[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [dontKnow](#pluginbuiltinsubmissionanswer-dontknow)
- [values](#pluginbuiltinsubmissionanswer-values)
- [other](#pluginbuiltinsubmissionanswer-other)
- [text](#pluginbuiltinsubmissionanswer-text)
- [confidence](#pluginbuiltinsubmissionanswer-confidence)
- [images](#pluginbuiltinsubmissionanswer-images)

### PluginBuiltinSubmissionAnswer dontKnow

```ts
readonly dontKnow?: boolean;
```

### PluginBuiltinSubmissionAnswer values

```ts
readonly values?: readonly string[];
```

### PluginBuiltinSubmissionAnswer other

```ts
readonly other?: string;
```

### PluginBuiltinSubmissionAnswer text

```ts
readonly text?: string;
```

### PluginBuiltinSubmissionAnswer confidence

```ts
readonly confidence?: number;
```

### PluginBuiltinSubmissionAnswer images

```ts
readonly images: readonly Readonly<ImageContent>[];
```

## PluginProblemSubmissionImages

Tipo público del SDK, exportado como `PluginProblemSubmissionImages`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemSubmissionImages {
    readonly submission?: readonly Readonly<ImageContent>[];
    readonly thinking?: readonly Readonly<ImageContent>[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [submission](#pluginproblemsubmissionimages-submission)
- [thinking](#pluginproblemsubmissionimages-thinking)

### PluginProblemSubmissionImages submission

```ts
readonly submission?: readonly Readonly<ImageContent>[];
```

### PluginProblemSubmissionImages thinking

```ts
readonly thinking?: readonly Readonly<ImageContent>[];
```

## PluginSubmission

Tipo público del SDK, exportado como `PluginSubmission`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSubmission = {
    readonly type: "text";
    readonly content: PluginSubmissionContent;
} | {
    readonly type: "thinking";
    readonly content: PluginSubmissionContent;
} | {
    readonly type: "answer";
    readonly answer: PluginBuiltinSubmissionAnswer;
    readonly thinking: PluginSubmissionContent;
    readonly readingThinking: PluginSubmissionContent;
} | {
    readonly type: "plugin-problem-submission";
    readonly submission: ImmutableJson;
    readonly submissionImages: readonly Readonly<ImageContent>[];
    readonly thinking: PluginSubmissionContent;
} | {
    readonly type: "plugin-question-answer";
    readonly answer: ImmutableJson;
    readonly answerImages: readonly Readonly<ImageContent>[];
    readonly thinking: PluginSubmissionContent;
    readonly readingThinking: PluginSubmissionContent;
};
```

**Tipos relacionados:** [ImmutableJson](plugin-submissions.md#immutablejson), [PluginBuiltinSubmissionAnswer](plugin-submissions.md#pluginbuiltinsubmissionanswer), [PluginSubmissionContent](plugin-submissions.md#pluginsubmissioncontent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [type](#pluginsubmission-type) — 5 signatures/variants
- [content](#pluginsubmission-content) — 2 signatures/variants
- [answer](#pluginsubmission-answer) — 2 signatures/variants
- [thinking](#pluginsubmission-thinking) — 3 signatures/variants
- [readingThinking](#pluginsubmission-readingthinking) — 2 signatures/variants
- [submission](#pluginsubmission-submission)
- [submissionImages](#pluginsubmission-submissionimages)
- [answerImages](#pluginsubmission-answerimages)

### PluginSubmission type

```ts
readonly type: "text";
```

```ts
readonly type: "thinking";
```

```ts
readonly type: "answer";
```

```ts
readonly type: "plugin-problem-submission";
```

```ts
readonly type: "plugin-question-answer";
```

### PluginSubmission content

```ts
readonly content: PluginSubmissionContent;
```

```ts
readonly content: PluginSubmissionContent;
```

### PluginSubmission answer

```ts
readonly answer: PluginBuiltinSubmissionAnswer;
```

```ts
readonly answer: ImmutableJson;
```

### PluginSubmission thinking

```ts
readonly thinking: PluginSubmissionContent;
```

```ts
readonly thinking: PluginSubmissionContent;
```

```ts
readonly thinking: PluginSubmissionContent;
```

### PluginSubmission readingThinking

```ts
readonly readingThinking: PluginSubmissionContent;
```

```ts
readonly readingThinking: PluginSubmissionContent;
```

### PluginSubmission submission

```ts
readonly submission: ImmutableJson;
```

### PluginSubmission submissionImages

```ts
readonly submissionImages: readonly Readonly<ImageContent>[];
```

### PluginSubmission answerImages

```ts
readonly answerImages: readonly Readonly<ImageContent>[];
```

## PluginSubmissionChannel

Tipo público del SDK, exportado como `PluginSubmissionChannel`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSubmissionChannel = "content" | "answer" | "submission" | "thinking" | "readingThinking";
```

## PluginSubmissionContent

Tipo público del SDK, exportado como `PluginSubmissionContent`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginSubmissionContent {
    readonly text: string;
    readonly images: readonly Readonly<ImageContent>[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [text](#pluginsubmissioncontent-text)
- [images](#pluginsubmissioncontent-images)

### PluginSubmissionContent text

```ts
readonly text: string;
```

### PluginSubmissionContent images

```ts
readonly images: readonly Readonly<ImageContent>[];
```

## PluginSubmissionContext

Tipo público del SDK, exportado como `PluginSubmissionContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSubmissionContext = PluginSubmissionTarget & {
    readonly messages: readonly Immutable<LhMessage>[];
    readonly signal: AbortSignal;
    onAccepted(callback: () => void | Promise<void>): void;
};
```

**Tipos relacionados:** [Immutable](plugin-submissions.md#immutable), [LhMessage](native-messages.md#lhmessage), [PluginSubmissionTarget](plugin-submissions.md#pluginsubmissiontarget).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [messages](#pluginsubmissioncontext-messages)
- [signal](#pluginsubmissioncontext-signal)
- [onAccepted](#pluginsubmissioncontext-onaccepted)

### PluginSubmissionContext messages

Detached current browser history, including potentially streamed content.

```ts
readonly messages: readonly Immutable<LhMessage>[];
```

### PluginSubmissionContext signal

```ts
readonly signal: AbortSignal;
```

### PluginSubmissionContext onAccepted

Live, best-effort acknowledgment notification; not a durable event.

```ts
onAccepted(callback: () => void | Promise<void>): void;
```

| Parameter | Type |
| --- | --- |
| `callback` | `() => void \| Promise<void>` |

**Devuelve:** `void`.

## PluginSubmissionImages

Tipo público del SDK, exportado como `PluginSubmissionImages`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Optional native image channels alongside the existing text authorities.

```ts
export interface PluginSubmissionImages {
    readonly answer?: readonly Readonly<ImageContent>[];
    readonly thinking?: readonly Readonly<ImageContent>[];
    readonly readingThinking?: readonly Readonly<ImageContent>[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [answer](#pluginsubmissionimages-answer)
- [thinking](#pluginsubmissionimages-thinking)
- [readingThinking](#pluginsubmissionimages-readingthinking)

### PluginSubmissionImages answer

```ts
readonly answer?: readonly Readonly<ImageContent>[];
```

### PluginSubmissionImages thinking

```ts
readonly thinking?: readonly Readonly<ImageContent>[];
```

### PluginSubmissionImages readingThinking

```ts
readonly readingThinking?: readonly Readonly<ImageContent>[];
```

## PluginSubmissionInterceptor

Tipo público del SDK, exportado como `PluginSubmissionInterceptor`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginSubmissionInterceptor {
    id: string;
    priority?: number;
    hasPendingInput?(target: PluginSubmissionTarget): boolean;
    intercept(input: PluginSubmission, context: PluginSubmissionContext): PluginSubmission | null | void | Promise<PluginSubmission | null | void>;
}
```

**Tipos relacionados:** [PluginSubmission](plugin-submissions.md#pluginsubmission), [PluginSubmissionContext](plugin-submissions.md#pluginsubmissioncontext), [PluginSubmissionTarget](plugin-submissions.md#pluginsubmissiontarget).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginsubmissioninterceptor-id)
- [priority](#pluginsubmissioninterceptor-priority)
- [hasPendingInput](#pluginsubmissioninterceptor-haspendinginput)
- [intercept](#pluginsubmissioninterceptor-intercept)

### PluginSubmissionInterceptor id

```ts
id: string;
```

### PluginSubmissionInterceptor priority

```ts
priority?: number;
```

### PluginSubmissionInterceptor hasPendingInput

```ts
hasPendingInput?(target: PluginSubmissionTarget): boolean;
```

| Parameter | Type |
| --- | --- |
| `target` | `PluginSubmissionTarget` |

**Devuelve:** `boolean`.

### PluginSubmissionInterceptor intercept

```ts
intercept(input: PluginSubmission, context: PluginSubmissionContext): PluginSubmission | null | void | Promise<PluginSubmission | null | void>;
```

| Parameter | Type |
| --- | --- |
| `input` | `PluginSubmission` |
| `context` | `PluginSubmissionContext` |

**Devuelve:** `PluginSubmission \| null \| void \| Promise<PluginSubmission \| null \| void>`.

## PluginSubmissionOccurrence

Tipo público del SDK, exportado como `PluginSubmissionOccurrence`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Exact native tool occurrence, never merely a potentially reused tool-call ID.

```ts
export type PluginSubmissionOccurrence = Readonly<PluginQuestionOccurrence>;
```

**Tipos relacionados:** [PluginQuestionOccurrence](plugin-questions.md#pluginquestionoccurrence).

## PluginSubmissionTarget

Tipo público del SDK, exportado como `PluginSubmissionTarget`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSubmissionTarget = SubmissionTargetBase & ({
    readonly type: "text";
    readonly channels: readonly [
        "content"
    ];
} | {
    readonly type: "thinking";
    readonly channels: readonly [
        "content"
    ];
    readonly problem: {
        readonly occurrence: PluginSubmissionOccurrence;
        readonly statement: string;
    };
} | {
    readonly type: "answer";
    readonly channels: readonly PluginSubmissionChannel[];
    readonly question: Immutable<ClientQuestion & {
        occurrence: PluginSubmissionOccurrence;
        questionType?: QuizQuestionType;
    }>;
} | {
    readonly type: "plugin-problem-submission";
    readonly channels: readonly [
        "submission",
        "thinking"
    ];
    readonly problem: Immutable<Pick<PluginProblemSnapshot, "problemId" | "pluginId" | "typeId" | "contractVersion" | "label"> & {
        occurrence: PluginSubmissionOccurrence;
        statement: string;
    }>;
} | {
    readonly type: "plugin-question-answer";
    readonly channels: readonly PluginSubmissionChannel[];
    readonly question: Immutable<Pick<PluginQuestionSnapshot, "questionId" | "occurrence" | "pluginId" | "typeId" | "contractVersion" | "label" | "variant" | "showThinking">>;
});
```

**Tipos relacionados:** [ClientQuestion](question-core.md#clientquestion), [Immutable](plugin-submissions.md#immutable), [PluginProblemSnapshot](plugin-problems.md#pluginproblemsnapshot), [PluginQuestionSnapshot](plugin-questions.md#pluginquestionsnapshot), [PluginSubmissionChannel](plugin-submissions.md#pluginsubmissionchannel), [PluginSubmissionOccurrence](plugin-submissions.md#pluginsubmissionoccurrence), [QuizQuestionType](question-core.md#quizquestiontype), [SubmissionTargetBase](plugin-submissions.md#submissiontargetbase).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [type](#pluginsubmissiontarget-type) — 5 signatures/variants
- [channels](#pluginsubmissiontarget-channels) — 5 signatures/variants
- [problem](#pluginsubmissiontarget-problem) — 2 signatures/variants
- [problem.occurrence](#pluginsubmissiontarget-problemoccurrence)
- [problem.statement](#pluginsubmissiontarget-problemstatement)
- [question](#pluginsubmissiontarget-question) — 2 signatures/variants

### PluginSubmissionTarget type

```ts
readonly type: "text";
```

```ts
readonly type: "thinking";
```

```ts
readonly type: "answer";
```

```ts
readonly type: "plugin-problem-submission";
```

```ts
readonly type: "plugin-question-answer";
```

### PluginSubmissionTarget channels

```ts
readonly channels: readonly [
    "content"
];
```

```ts
readonly channels: readonly [
    "content"
];
```

```ts
readonly channels: readonly PluginSubmissionChannel[];
```

```ts
readonly channels: readonly [
    "submission",
    "thinking"
];
```

```ts
readonly channels: readonly PluginSubmissionChannel[];
```

### PluginSubmissionTarget problem

```ts
readonly problem: {
    readonly occurrence: PluginSubmissionOccurrence;
    readonly statement: string;
};
```

```ts
readonly problem: Immutable<Pick<PluginProblemSnapshot, "problemId" | "pluginId" | "typeId" | "contractVersion" | "label"> & {
    occurrence: PluginSubmissionOccurrence;
    statement: string;
}>;
```

### PluginSubmissionTarget problem.occurrence

```ts
readonly occurrence: PluginSubmissionOccurrence;
```

### PluginSubmissionTarget problem.statement

```ts
readonly statement: string;
```

### PluginSubmissionTarget question

```ts
readonly question: Immutable<ClientQuestion & {
    occurrence: PluginSubmissionOccurrence;
    questionType?: QuizQuestionType;
}>;
```

```ts
readonly question: Immutable<Pick<PluginQuestionSnapshot, "questionId" | "occurrence" | "pluginId" | "typeId" | "contractVersion" | "label" | "variant" | "showThinking">>;
```

## SubmissionTargetBase

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
type SubmissionTargetBase = {
    readonly sessionId: string;
    readonly sessionKind: "teaching" | "practice";
    readonly surfaceTarget: PluginSurfaceTarget;
};
```

**Tipos relacionados:** [PluginSurfaceTarget](plugin-ui.md#pluginsurfacetarget).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [sessionId](#submissiontargetbase-sessionid)
- [sessionKind](#submissiontargetbase-sessionkind)
- [surfaceTarget](#submissiontargetbase-surfacetarget)

### SubmissionTargetBase sessionId

```ts
readonly sessionId: string;
```

### SubmissionTargetBase sessionKind

```ts
readonly sessionKind: "teaching" | "practice";
```

### SubmissionTargetBase surfaceTarget

```ts
readonly surfaceTarget: PluginSurfaceTarget;
```
