# question-core

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [ClientQuestion](#clientquestion) — declaración de apoyo
- [QuestionKind](#questionkind) — declaración de apoyo
- [QuestionMode](#questionmode) — declaración de apoyo
- [QUIZ_QUESTION_TYPES](#quiz_question_types) — declaración de apoyo
- [QuizOption](#quizoption) — declaración de apoyo
- [QuizQuestionType](#quizquestiontype) — declaración de apoyo
- [SelectMode](#selectmode) — declaración de apoyo

## ClientQuestion

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Contenido de la pregunta de cara al cliente; omite deliberadamente la respuesta.

```ts
export interface ClientQuestion {
    id: string;
    kind: QuestionKind;
    question: string;
    context?: string;
    mode: QuestionMode;
    options: QuizOption[];
}
```

**Tipos relacionados:** [QuestionKind](question-core.md#questionkind), [QuestionMode](question-core.md#questionmode), [QuizOption](question-core.md#quizoption).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#clientquestion-id)
- [kind](#clientquestion-kind)
- [question](#clientquestion-question)
- [context](#clientquestion-context)
- [mode](#clientquestion-mode)
- [options](#clientquestion-options)

### ClientQuestion id

```ts
id: string;
```

### ClientQuestion kind

```ts
kind: QuestionKind;
```

### ClientQuestion question

```ts
question: string;
```

### ClientQuestion context

```ts
context?: string;
```

### ClientQuestion mode

```ts
mode: QuestionMode;
```

### ClientQuestion options

```ts
options: QuizOption[];
```

## QuestionKind

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type QuestionKind = "quiz" | "ask" | "explain";
```

## QuestionMode

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type QuestionMode = SelectMode | "text";
```

**Tipos relacionados:** [SelectMode](question-core.md#selectmode).

## QUIZ_QUESTION_TYPES

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
declare const QUIZ_QUESTION_TYPES: readonly [
    "predict",
    "check"
];
```

## QuizOption

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export interface QuizOption {
    label: string;
    value: string;
    description?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [label](#quizoption-label)
- [value](#quizoption-value)
- [description](#quizoption-description)

### QuizOption label

```ts
label: string;
```

### QuizOption value

```ts
value: string;
```

### QuizOption description

```ts
description?: string;
```

## QuizQuestionType

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
```

**Tipos relacionados:** [QUIZ_QUESTION_TYPES](question-core.md#quiz_question_types).

## SelectMode

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type SelectMode = "single-select" | "multi-select";
```
