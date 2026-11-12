# native-messages

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [LhMarkerMessage](#lhmarkermessage) — declaración de apoyo
- [LhMessage](#lhmessage) — declaración de apoyo

## LhMarkerMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

El mensaje personalizado de la app (fusionado por declaración en
CustomAgentMessages de pi-agent-core, más abajo). Con la forma del propio
CustomMessage de pi — `content` es el texto DE CARA AL MODELO (de una sola
fuente en core/contracts, nunca habla humana falsa), `details` es la carga
para la interfaz (nunca visible para el modelo), `display` marca los
mensajes que muestra la interfaz (nuestra proyección decide qué mostrar por
customType; la marca documenta la intención).

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

Identidad en el registro (los mensajes de pi no llevan id — consulta la cabecera del fichero).

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

El texto de cara al modelo ("" en los bloques de plan — solo interfaz).

```ts
content: string;
```

### LhMarkerMessage display

```ts
display: boolean;
```

### LhMarkerMessage details

Carga para la interfaz según customType. Las imágenes del razonamiento de
práctica también se proyectan a bloques nativos del modelo; su cadena de
contenido sigue siendo la autoridad textual.

```ts
details: unknown;
```

### LhMarkerMessage timestamp

```ts
timestamp: number;
```

## LhMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Un mensaje del registro: un mensaje nativo de pi (o nuestro marcador) más el id de registro.

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

Presupuesto de contexto efectivo informado por la CLI, no un máximo de
modelo del catálogo. Metadatos solo de la app: nunca se transmiten como
contenido de mensaje al proveedor/modelo.

```ts
cliContextWindow?: number;
```

### LhMessage lhQuestions

Anotaciones de aparición propiedad del host, nunca entrada del modelo.

```ts
lhQuestions?: PluginQuestionOccurrenceMap;
```

### LhMessage lhQuestionOccurrence

Vinculación exacta para resultados genuinos de preguntas de plugins (details sigue siendo el sobre público).

```ts
lhQuestionOccurrence?: PluginQuestionOccurrence;
```
