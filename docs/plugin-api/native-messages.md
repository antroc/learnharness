# native-messages

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [LhMarkerMessage](#lhmarkermessage) — declaración de apoyo
- [LhMessage](#lhmessage) — declaración de apoyo

## LhMarkerMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

The app's custom message (declaration-merged into pi-agent-core's
CustomAgentMessages below). Shaped like pi's own CustomMessage —
`content` is the MODEL-facing text (single-sourced in core/contracts,
never fake human speech), `details` is the UI payload (never
model-visible), `display` marks messages the UI renders (our projection
keys rendering on customType; the flag documents intent).

```ts
export interface LhMarkerMessage {
    id: string;
    role: "custom";
    customType: "graph-context" | "probe-handoff" | "subagent-steer" | "subagent-abort" | "plan-block" | "practice-thinking" | "plugin-problem-submission" | "practice-next" | "problem-dismissed" | "compaction" | "side-question" | "side-question-told";
    content: string;
    display: boolean;
    details: unknown;
    timestamp: number;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#lhmarkermessage-id)
- [role](#lhmarkermessage-role)
- [customType](#lhmarkermessage-customtype)
- [content](#lhmarkermessage-content)
- [display](#lhmarkermessage-display)
- [details](#lhmarkermessage-details)
- [timestamp](#lhmarkermessage-timestamp)

### LhMarkerMessage id

Record identity (pi messages carry no id — see the file header).

```ts
id: string;
```

### LhMarkerMessage role

```ts
role: "custom";
```

### LhMarkerMessage customType

```ts
customType: "graph-context" | "probe-handoff" | "subagent-steer" | "subagent-abort" | "plan-block" | "practice-thinking" | "plugin-problem-submission" | "practice-next" | "problem-dismissed" | "compaction" | "side-question" | "side-question-told";
```

### LhMarkerMessage content

The model-facing text ("" for plan blocks — UI-only).

```ts
content: string;
```

### LhMarkerMessage display

```ts
display: boolean;
```

### LhMarkerMessage details

Per-customType UI payload. Practice-thinking images also project to
native model blocks; its content string remains the text authority.

```ts
details: unknown;
```

### LhMarkerMessage timestamp

```ts
timestamp: number;
```

## LhMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

A record message: a native pi message (or our marker) plus the record id.

```ts
export type LhMessage = (UserMessage | AssistantMessage | ToolResultMessage | LhMarkerMessage) & {
    id: string;
    cliContextWindow?: number;
    lhQuestions?: PluginQuestionOccurrenceMap;
    lhQuestionOccurrence?: PluginQuestionOccurrence;
};
```

**Tipos relacionados:** [LhMarkerMessage](native-messages.md#lhmarkermessage), [PluginQuestionOccurrence](plugin-questions.md#pluginquestionoccurrence), [PluginQuestionOccurrenceMap](plugin-questions.md#pluginquestionoccurrencemap).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#lhmessage-id)
- [cliContextWindow](#lhmessage-clicontextwindow)
- [lhQuestions](#lhmessage-lhquestions)
- [lhQuestionOccurrence](#lhmessage-lhquestionoccurrence)

### LhMessage id

```ts
id: string;
```

### LhMessage cliContextWindow

CLI-reported effective context budget, not a catalog model maximum.
App-only metadata: never transmitted as provider/model message content.

```ts
cliContextWindow?: number;
```

### LhMessage lhQuestions

Host-owned occurrence annotations, never model input.

```ts
lhQuestions?: PluginQuestionOccurrenceMap;
```

### LhMessage lhQuestionOccurrence

Exact binding for genuine plugin-question results (details stays public envelope).

```ts
lhQuestionOccurrence?: PluginQuestionOccurrence;
```
