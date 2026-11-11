# plugin-problems

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Ciclo de vida de los problemas de práctica](../plugin-problem-contract.md)

- [NativePluginProblemDefinition](#nativepluginproblemdefinition)
- [PluginProblemEditorHandle](#pluginproblemeditorhandle)
- [PluginProblemEditorProps](#pluginproblemeditorprops)
- [PluginProblemInput](#pluginprobleminput)
- [PluginProblemMountContext](#pluginproblemmountcontext)
- [PluginProblemProcessingContext](#pluginproblemprocessingcontext)
- [PluginProblemProcessingOutcome](#pluginproblemprocessingoutcome)
- [PluginProblemRenderer](#pluginproblemrenderer)
- [PluginProblemSnapshot](#pluginproblemsnapshot)
- [PluginProblemSubmission](#pluginproblemsubmission)
- [PluginProblemSubmissionState](#pluginproblemsubmissionstate)
- [PluginProblemSubmissionValidationContext](#pluginproblemsubmissionvalidationcontext)
- [PluginProblemTypeDefinition](#pluginproblemtypedefinition)
- [PluginProblemValidationContext](#pluginproblemvalidationcontext)

## NativePluginProblemDefinition

Tipo público del SDK, exportado como `NativePluginProblemDefinition`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Internal heterogeneous registry; public registration remains schema-generic.

```ts
export type NativePluginProblemDefinition = Omit<PluginProblemTypeDefinition, "validateProblem" | "validateSubmission" | "processSubmission"> & {
    validateProblem?: (context: PluginProblemValidationContext<any>) => undefined | string[];
    validateSubmission?: (context: PluginProblemSubmissionValidationContext<any, any>) => undefined | string[];
    processSubmission?: (context: PluginProblemProcessingContext<any, any>) => JsonValue | Promise<JsonValue>;
};
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemProcessingContext](plugin-problems.md#pluginproblemprocessingcontext), [PluginProblemSubmissionValidationContext](plugin-problems.md#pluginproblemsubmissionvalidationcontext), [PluginProblemTypeDefinition](plugin-problems.md#pluginproblemtypedefinition), [PluginProblemValidationContext](plugin-problems.md#pluginproblemvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [validateProblem](#nativepluginproblemdefinition-validateproblem)
- [validateSubmission](#nativepluginproblemdefinition-validatesubmission)
- [processSubmission](#nativepluginproblemdefinition-processsubmission)

### NativePluginProblemDefinition validateProblem

```ts
validateProblem?: (context: PluginProblemValidationContext<any>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemValidationContext<any>` |

**Devuelve:** `undefined \| string[]`.

### NativePluginProblemDefinition validateSubmission

```ts
validateSubmission?: (context: PluginProblemSubmissionValidationContext<any, any>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemSubmissionValidationContext<any, any>` |

**Devuelve:** `undefined \| string[]`.

### NativePluginProblemDefinition processSubmission

```ts
processSubmission?: (context: PluginProblemProcessingContext<any, any>) => JsonValue | Promise<JsonValue>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemProcessingContext<any, any>` |

**Devuelve:** `JsonValue \| Promise<JsonValue>`.

## PluginProblemEditorHandle

Tipo público del SDK, exportado como `PluginProblemEditorHandle`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemEditorHandle {
    update(props: {
        submission: PluginProblemSubmissionState;
        active: boolean;
    }): void;
    focus(): void;
    handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
    appendTranscript?(text: string): void | Promise<void>;
    dispose(): void;
}
```

**Tipos relacionados:** [PluginProblemSubmissionState](plugin-problems.md#pluginproblemsubmissionstate), [PluginQuestionEditorKey](plugin-questions.md#pluginquestioneditorkey).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [update](#pluginproblemeditorhandle-update)
- [focus](#pluginproblemeditorhandle-focus)
- [handleKeyDown](#pluginproblemeditorhandle-handlekeydown)
- [appendTranscript](#pluginproblemeditorhandle-appendtranscript)
- [dispose](#pluginproblemeditorhandle-dispose)

### PluginProblemEditorHandle update

```ts
update(props: {
    submission: PluginProblemSubmissionState;
    active: boolean;
}): void;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `{         submission: PluginProblemSubmissionState;         active: boolean;     }` |

**Devuelve:** `void`.

### PluginProblemEditorHandle focus

```ts
focus(): void;
```

**Devuelve:** `void`.

### PluginProblemEditorHandle handleKeyDown

```ts
handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
```

| Parámetro | Tipo |
| --- | --- |
| `key` | `PluginQuestionEditorKey` |

**Devuelve:** `"handled" \| "pass"`.

### PluginProblemEditorHandle appendTranscript

```ts
appendTranscript?(text: string): void | Promise<void>;
```

| Parámetro | Tipo |
| --- | --- |
| `text` | `string` |

**Devuelve:** `void \| Promise<void>`.

### PluginProblemEditorHandle dispose

```ts
dispose(): void;
```

**Devuelve:** `void`.

## PluginProblemEditorProps

Tipo público del SDK, exportado como `PluginProblemEditorProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemEditorProps<Q = JsonValue> extends PluginProblemMountContext<Q> {
    readonly active: boolean;
    readonly submission: PluginProblemSubmissionState;
    onChange(submission: PluginProblemSubmissionState): void;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemMountContext](plugin-problems.md#pluginproblemmountcontext), [PluginProblemSubmissionState](plugin-problems.md#pluginproblemsubmissionstate).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [active](#pluginproblemeditorprops-active)
- [submission](#pluginproblemeditorprops-submission)
- [onChange](#pluginproblemeditorprops-onchange)

### PluginProblemEditorProps active

```ts
readonly active: boolean;
```

### PluginProblemEditorProps submission

```ts
readonly submission: PluginProblemSubmissionState;
```

### PluginProblemEditorProps onChange

```ts
onChange(submission: PluginProblemSubmissionState): void;
```

| Parámetro | Tipo |
| --- | --- |
| `submission` | `PluginProblemSubmissionState` |

**Devuelve:** `void`.

## PluginProblemInput

Tipo público del SDK, exportado como `PluginProblemInput`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemInput<Q = JsonValue> {
    statement: string;
    mode: "recall" | "discrimination" | "composition";
    target?: string[];
    modelSolution: string;
    payload: Q;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [statement](#pluginprobleminput-statement)
- [mode](#pluginprobleminput-mode)
- [target](#pluginprobleminput-target)
- [modelSolution](#pluginprobleminput-modelsolution)
- [payload](#pluginprobleminput-payload)

### PluginProblemInput statement

```ts
statement: string;
```

### PluginProblemInput mode

```ts
mode: "recall" | "discrimination" | "composition";
```

### PluginProblemInput target

```ts
target?: string[];
```

### PluginProblemInput modelSolution

```ts
modelSolution: string;
```

### PluginProblemInput payload

```ts
payload: Q;
```

## PluginProblemMountContext

Tipo público del SDK, exportado como `PluginProblemMountContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemMountContext<Q = JsonValue> extends PluginProblemValidationContext<Q> {
    readonly problemId: string;
    readonly signal: AbortSignal;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemValidationContext](plugin-problems.md#pluginproblemvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [problemId](#pluginproblemmountcontext-problemid)
- [signal](#pluginproblemmountcontext-signal)

### PluginProblemMountContext problemId

```ts
readonly problemId: string;
```

### PluginProblemMountContext signal

```ts
readonly signal: AbortSignal;
```

## PluginProblemProcessingContext

Tipo público del SDK, exportado como `PluginProblemProcessingContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemProcessingContext<Q = JsonValue, S = JsonValue> extends PluginProblemSubmissionValidationContext<Q, S> {
    readonly thinking: string;
    readonly images?: PluginProblemSubmissionImages;
    readonly signal: AbortSignal;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemSubmissionImages](plugin-submissions.md#pluginproblemsubmissionimages), [PluginProblemSubmissionValidationContext](plugin-problems.md#pluginproblemsubmissionvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [thinking](#pluginproblemprocessingcontext-thinking)
- [images](#pluginproblemprocessingcontext-images)
- [signal](#pluginproblemprocessingcontext-signal)

### PluginProblemProcessingContext thinking

```ts
readonly thinking: string;
```

### PluginProblemProcessingContext images

```ts
readonly images?: PluginProblemSubmissionImages;
```

### PluginProblemProcessingContext signal

```ts
readonly signal: AbortSignal;
```

## PluginProblemProcessingOutcome

Tipo público del SDK, exportado como `PluginProblemProcessingOutcome`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Per-submission observations, never the model's final problem assessment.

```ts
export type PluginProblemProcessingOutcome = {
    result: JsonValue;
} | {
    error: string;
};
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [result](#pluginproblemprocessingoutcome-result)
- [error](#pluginproblemprocessingoutcome-error)

### PluginProblemProcessingOutcome result

```ts
result: JsonValue;
```

### PluginProblemProcessingOutcome error

```ts
error: string;
```

## PluginProblemRenderer

Tipo público del SDK, exportado como `PluginProblemRenderer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemRenderer<Q = JsonValue, S = JsonValue> {
    id: string;
    supportedContractVersions: number[];
    mountSubmissionEditor(container: HTMLElement, context: PluginProblemEditorProps<Q>): PluginProblemEditorHandle | Promise<PluginProblemEditorHandle>;
    mountSubmitted?(container: HTMLElement, context: PluginProblemMountContext<Q> & {
        readonly submission: S;
        readonly processing?: PluginProblemProcessingOutcome;
        readonly headerContainer?: HTMLElement;
        readonly footerContainer?: HTMLElement;
    }): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginCleanup](plugins.md#plugincleanup), [PluginProblemEditorHandle](plugin-problems.md#pluginproblemeditorhandle), [PluginProblemEditorProps](plugin-problems.md#pluginproblemeditorprops), [PluginProblemMountContext](plugin-problems.md#pluginproblemmountcontext), [PluginProblemProcessingOutcome](plugin-problems.md#pluginproblemprocessingoutcome).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginproblemrenderer-id)
- [supportedContractVersions](#pluginproblemrenderer-supportedcontractversions)
- [mountSubmissionEditor](#pluginproblemrenderer-mountsubmissioneditor)
- [mountSubmitted](#pluginproblemrenderer-mountsubmitted)

### PluginProblemRenderer id

```ts
id: string;
```

### PluginProblemRenderer supportedContractVersions

```ts
supportedContractVersions: number[];
```

### PluginProblemRenderer mountSubmissionEditor

```ts
mountSubmissionEditor(container: HTMLElement, context: PluginProblemEditorProps<Q>): PluginProblemEditorHandle | Promise<PluginProblemEditorHandle>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `context` | `PluginProblemEditorProps<Q>` |

**Devuelve:** `PluginProblemEditorHandle \| Promise<PluginProblemEditorHandle>`.

### PluginProblemRenderer mountSubmitted

```ts
mountSubmitted?(container: HTMLElement, context: PluginProblemMountContext<Q> & {
    readonly submission: S;
    readonly processing?: PluginProblemProcessingOutcome;
    readonly headerContainer?: HTMLElement;
    readonly footerContainer?: HTMLElement;
}): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `context` | `PluginProblemMountContext<Q> & {         readonly submission: S;         readonly processing?: PluginProblemProcessingOutcome;         readonly headerContainer?: HTMLElement;         /** Generation-owned block after host submission images/thinking. */         readonly footerContainer?: HTMLElement;     }` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginProblemSnapshot

Tipo público del SDK, exportado como `PluginProblemSnapshot`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

The host persists this in the genuine pose acknowledgment, never model arguments.

```ts
export interface PluginProblemSnapshot {
    protocolVersion: 1;
    problemId: string;
    pluginId: string;
    typeId: string;
    label: string;
    contractVersion: number;
    input: PluginProblemInput;
    problemSchema: TSchema;
    submissionSchema: TSchema;
    requiresSubmissionRefinement: boolean;
    requiresProcessing: boolean;
}
```

**Tipos relacionados:** [PluginProblemInput](plugin-problems.md#pluginprobleminput).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [protocolVersion](#pluginproblemsnapshot-protocolversion)
- [problemId](#pluginproblemsnapshot-problemid)
- [pluginId](#pluginproblemsnapshot-pluginid)
- [typeId](#pluginproblemsnapshot-typeid)
- [label](#pluginproblemsnapshot-label)
- [contractVersion](#pluginproblemsnapshot-contractversion)
- [input](#pluginproblemsnapshot-input)
- [problemSchema](#pluginproblemsnapshot-problemschema)
- [submissionSchema](#pluginproblemsnapshot-submissionschema)
- [requiresSubmissionRefinement](#pluginproblemsnapshot-requiressubmissionrefinement)
- [requiresProcessing](#pluginproblemsnapshot-requiresprocessing)

### PluginProblemSnapshot protocolVersion

```ts
protocolVersion: 1;
```

### PluginProblemSnapshot problemId

```ts
problemId: string;
```

### PluginProblemSnapshot pluginId

```ts
pluginId: string;
```

### PluginProblemSnapshot typeId

```ts
typeId: string;
```

### PluginProblemSnapshot label

```ts
label: string;
```

### PluginProblemSnapshot contractVersion

```ts
contractVersion: number;
```

### PluginProblemSnapshot input

```ts
input: PluginProblemInput;
```

### PluginProblemSnapshot problemSchema

```ts
problemSchema: TSchema;
```

### PluginProblemSnapshot submissionSchema

```ts
submissionSchema: TSchema;
```

### PluginProblemSnapshot requiresSubmissionRefinement

```ts
requiresSubmissionRefinement: boolean;
```

### PluginProblemSnapshot requiresProcessing

```ts
requiresProcessing: boolean;
```

## PluginProblemSubmission

Tipo público del SDK, exportado como `PluginProblemSubmission`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemSubmission {
    kind: "plugin-problem-submission";
    problemId: string;
    pluginId: string;
    typeId: string;
    contractVersion: number;
    submission: JsonValue;
    thinking: string;
    images?: PluginProblemSubmissionImages;
    processing?: PluginProblemProcessingOutcome;
    submittedAt: string;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemProcessingOutcome](plugin-problems.md#pluginproblemprocessingoutcome), [PluginProblemSubmissionImages](plugin-submissions.md#pluginproblemsubmissionimages).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [kind](#pluginproblemsubmission-kind)
- [problemId](#pluginproblemsubmission-problemid)
- [pluginId](#pluginproblemsubmission-pluginid)
- [typeId](#pluginproblemsubmission-typeid)
- [contractVersion](#pluginproblemsubmission-contractversion)
- [submission](#pluginproblemsubmission-submission)
- [thinking](#pluginproblemsubmission-thinking)
- [images](#pluginproblemsubmission-images)
- [processing](#pluginproblemsubmission-processing)
- [submittedAt](#pluginproblemsubmission-submittedat)

### PluginProblemSubmission kind

```ts
kind: "plugin-problem-submission";
```

### PluginProblemSubmission problemId

```ts
problemId: string;
```

### PluginProblemSubmission pluginId

```ts
pluginId: string;
```

### PluginProblemSubmission typeId

```ts
typeId: string;
```

### PluginProblemSubmission contractVersion

```ts
contractVersion: number;
```

### PluginProblemSubmission submission

```ts
submission: JsonValue;
```

### PluginProblemSubmission thinking

```ts
thinking: string;
```

### PluginProblemSubmission images

```ts
images?: PluginProblemSubmissionImages;
```

### PluginProblemSubmission processing

```ts
processing?: PluginProblemProcessingOutcome;
```

### PluginProblemSubmission submittedAt

```ts
submittedAt: string;
```

## PluginProblemSubmissionState

Tipo público del SDK, exportado como `PluginProblemSubmissionState`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginProblemSubmissionState = {
    status: "empty";
} | {
    status: "unready" | "ready";
    value: JsonValue;
};
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [status](#pluginproblemsubmissionstate-status) — 2 firmas o variantes
- [value](#pluginproblemsubmissionstate-value)

### PluginProblemSubmissionState status

```ts
status: "empty";
```

```ts
status: "unready" | "ready";
```

### PluginProblemSubmissionState value

```ts
value: JsonValue;
```

## PluginProblemSubmissionValidationContext

Tipo público del SDK, exportado como `PluginProblemSubmissionValidationContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemSubmissionValidationContext<Q = JsonValue, S = JsonValue> extends PluginProblemValidationContext<Q> {
    readonly problemId: string;
    readonly submission: S;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemValidationContext](plugin-problems.md#pluginproblemvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [problemId](#pluginproblemsubmissionvalidationcontext-problemid)
- [submission](#pluginproblemsubmissionvalidationcontext-submission)

### PluginProblemSubmissionValidationContext problemId

```ts
readonly problemId: string;
```

### PluginProblemSubmissionValidationContext submission

```ts
readonly submission: S;
```

## PluginProblemTypeDefinition

Tipo público del SDK, exportado como `PluginProblemTypeDefinition`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemTypeDefinition<Q extends TSchema = TSchema, S extends TSchema = TSchema> {
    id: string;
    label: string;
    contractVersion: number;
    incompatibleContractVersions?: number[];
    tool: {
        toolName: string;
        description: string;
    };
    problemSchema: Q;
    submissionSchema: S;
    validateProblem?: (context: PluginProblemValidationContext<Static<Q>>) => undefined | string[];
    validateSubmission?: (context: PluginProblemSubmissionValidationContext<Static<Q>, Static<S>>) => undefined | string[];
    processSubmission?: (context: PluginProblemProcessingContext<Static<Q>, Static<S>>) => JsonValue | Promise<JsonValue>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemProcessingContext](plugin-problems.md#pluginproblemprocessingcontext), [PluginProblemSubmissionValidationContext](plugin-problems.md#pluginproblemsubmissionvalidationcontext), [PluginProblemValidationContext](plugin-problems.md#pluginproblemvalidationcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginproblemtypedefinition-id)
- [label](#pluginproblemtypedefinition-label)
- [contractVersion](#pluginproblemtypedefinition-contractversion)
- [incompatibleContractVersions](#pluginproblemtypedefinition-incompatiblecontractversions)
- [tool](#pluginproblemtypedefinition-tool)
- [tool.toolName](#pluginproblemtypedefinition-tooltoolname)
- [tool.description](#pluginproblemtypedefinition-tooldescription)
- [problemSchema](#pluginproblemtypedefinition-problemschema)
- [submissionSchema](#pluginproblemtypedefinition-submissionschema)
- [validateProblem](#pluginproblemtypedefinition-validateproblem)
- [validateSubmission](#pluginproblemtypedefinition-validatesubmission)
- [processSubmission](#pluginproblemtypedefinition-processsubmission)

### PluginProblemTypeDefinition id

```ts
id: string;
```

### PluginProblemTypeDefinition label

```ts
label: string;
```

### PluginProblemTypeDefinition contractVersion

```ts
contractVersion: number;
```

### PluginProblemTypeDefinition incompatibleContractVersions

```ts
incompatibleContractVersions?: number[];
```

### PluginProblemTypeDefinition tool

```ts
tool: {
    toolName: string;
    description: string;
};
```

### PluginProblemTypeDefinition tool.toolName

```ts
toolName: string;
```

### PluginProblemTypeDefinition tool.description

```ts
description: string;
```

### PluginProblemTypeDefinition problemSchema

```ts
problemSchema: Q;
```

### PluginProblemTypeDefinition submissionSchema

```ts
submissionSchema: S;
```

### PluginProblemTypeDefinition validateProblem

```ts
validateProblem?: (context: PluginProblemValidationContext<Static<Q>>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemValidationContext<Static<Q>>` |

**Devuelve:** `undefined \| string[]`.

### PluginProblemTypeDefinition validateSubmission

```ts
validateSubmission?: (context: PluginProblemSubmissionValidationContext<Static<Q>, Static<S>>) => undefined | string[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemSubmissionValidationContext<Static<Q>, Static<S>>` |

**Devuelve:** `undefined \| string[]`.

### PluginProblemTypeDefinition processSubmission

```ts
processSubmission?: (context: PluginProblemProcessingContext<Static<Q>, Static<S>>) => JsonValue | Promise<JsonValue>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginProblemProcessingContext<Static<Q>, Static<S>>` |

**Devuelve:** `JsonValue \| Promise<JsonValue>`.

## PluginProblemValidationContext

Tipo público del SDK, exportado como `PluginProblemValidationContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginProblemValidationContext<Q = JsonValue> {
    readonly chatId: string;
    readonly contractVersion: number;
    readonly input: PluginProblemInput<Q>;
}
```

**Tipos relacionados:** [JsonValue](plugin-questions.md#jsonvalue), [PluginProblemInput](plugin-problems.md#pluginprobleminput).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#pluginproblemvalidationcontext-chatid)
- [contractVersion](#pluginproblemvalidationcontext-contractversion)
- [input](#pluginproblemvalidationcontext-input)

### PluginProblemValidationContext chatId

```ts
readonly chatId: string;
```

### PluginProblemValidationContext contractVersion

```ts
readonly contractVersion: number;
```

### PluginProblemValidationContext input

```ts
readonly input: PluginProblemInput<Q>;
```
