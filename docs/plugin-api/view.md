# view

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [LhViewMessage](#lhviewmessage) — declaración de apoyo
- [LhViewPart](#lhviewpart) — declaración de apoyo

## LhViewMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Un mensaje de la vista: del usuario (burbuja) o del asistente (una única secuencia continua).

```ts
export interface LhViewMessage {
    id: string;
    role: "user" | "assistant";
    parts: LhViewPart[];
    metadata?: unknown;
}
```

**Tipos relacionados:** [LhViewPart](view.md#lhviewpart).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#lhviewmessage-id)
- [role](#lhviewmessage-role)
- [parts](#lhviewmessage-parts)
- [metadata](#lhviewmessage-metadata)

### LhViewMessage id

```ts
id: string;
```

### LhViewMessage role

```ts
role: "user" | "assistant";
```

### LhViewMessage parts

```ts
parts: LhViewPart[];
```

### LhViewMessage metadata

Los metadatos de subagentResult que leen las tarjetas de reorientación (details del
marcador).

```ts
metadata?: unknown;
```

## LhViewPart

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Una parte proyectada de la transcripción que consumen los renderizadores del host y los
analizadores de fase y de entrada. type selecciona el vocabulario de la parte; los campos
comunes son opcionales porque las partes de texto, de herramientas y de datos llevan
contenidos distintos. Los campos adicionales quedan como desconocidos a través de la
firma de índice y requieren estrechamiento.

```ts
export interface LhViewPart extends Record<string, unknown> {
    type: string;
    id?: string;
    text?: string;
    state?: string;
    toolCallId?: string;
    sourceMessageId?: string;
    sourceContentIndex?: number;
    pluginQuestion?: Exclude<PluginQuestionAnnotationRead, {
        status: "absent";
    }>;
    pluginProblem?: PluginProblemSnapshot;
    input?: unknown;
    output?: unknown;
    rawInput?: unknown;
    errorText?: string;
    result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
    data?: unknown;
}
```

**Tipos relacionados:** [PluginProblemSnapshot](plugin-problems.md#pluginproblemsnapshot), [PluginQuestionAnnotationRead](plugin-questions.md#pluginquestionannotationread).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [type](#lhviewpart-type)
- [id](#lhviewpart-id)
- [text](#lhviewpart-text)
- [state](#lhviewpart-state)
- [toolCallId](#lhviewpart-toolcallid)
- [sourceMessageId](#lhviewpart-sourcemessageid)
- [sourceContentIndex](#lhviewpart-sourcecontentindex)
- [pluginQuestion](#lhviewpart-pluginquestion)
- [pluginProblem](#lhviewpart-pluginproblem)
- [input](#lhviewpart-input)
- [output](#lhviewpart-output)
- [rawInput](#lhviewpart-rawinput)
- [errorText](#lhviewpart-errortext)
- [result](#lhviewpart-result)
- [data](#lhviewpart-data)

### LhViewPart type

```ts
type: string;
```

### LhViewPart id

```ts
id?: string;
```

### LhViewPart text

```ts
text?: string;
```

### LhViewPart state

```ts
state?: string;
```

### LhViewPart toolCallId

```ts
toolCallId?: string;
```

### LhViewPart sourceMessageId

Ubicación nativa, conservada a través de la agrupación de visualización (solo cliente).

```ts
sourceMessageId?: string;
```

### LhViewPart sourceContentIndex

```ts
sourceContentIndex?: number;
```

### LhViewPart pluginQuestion

Debe seleccionarse antes que cualquier renderizador genérico de herramientas; nunca
es una traza en bruto.

```ts
pluginQuestion?: Exclude<PluginQuestionAnnotationRead, {
    status: "absent";
}>;
```

### LhViewPart pluginProblem

```ts
pluginProblem?: PluginProblemSnapshot;
```

### LhViewPart input

```ts
input?: unknown;
```

### LhViewPart output

```ts
output?: unknown;
```

### LhViewPart rawInput

```ts
rawInput?: unknown;
```

### LhViewPart errorText

```ts
errorText?: string;
```

### LhViewPart result

Resultado nativo conservado para los renderizadores públicos de plugins y las
alternativas legibles.

```ts
result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
```

### LhViewPart data

```ts
data?: unknown;
```
