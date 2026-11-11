# contracts-chat

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [CallUsage](#callusage) — declaración de apoyo
- [ChatKind](#chatkind) — declaración de apoyo
- [ChatListItem](#chatlistitem)
- [ChatRecord](#chatrecord)
- [ChatSettings](#chatsettings) — declaración de apoyo
- [ChatSummary](#chatsummary) — declaración de apoyo
- [ExtractionRunUsage](#extractionrunusage) — declaración de apoyo
- [ExtractionStageUsage](#extractionstageusage) — declaración de apoyo
- [ImageSnapshot](#imagesnapshot) — declaración de apoyo
- [SideChatAnchor](#sidechatanchor) — declaración de apoyo
- [SideChatMessage](#sidechatmessage) — declaración de apoyo
- [SideChatThread](#sidechatthread) — declaración de apoyo
- [TurnUsage](#turnusage) — declaración de apoyo

## CallUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Contabilidad de tokens persistida de una llamada al modelo. Undefined significa que el
proveedor no informó de ese campo; su ausencia no debe interpretarse como cero.

```ts
export interface CallUsage {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
    cacheWrite1hTokens?: number;
    reasoningTokens: number | undefined;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [inputTokens](#callusage-inputtokens)
- [outputTokens](#callusage-outputtokens)
- [cacheReadTokens](#callusage-cachereadtokens)
- [cacheWriteTokens](#callusage-cachewritetokens)
- [cacheWrite1hTokens](#callusage-cachewrite1htokens)
- [reasoningTokens](#callusage-reasoningtokens)

### CallUsage inputTokens

Tokens de entrada nuevos normalizados por Pi; los compartimentos de caché son disjuntos.

```ts
inputTokens: number | undefined;
```

### CallUsage outputTokens

```ts
outputTokens: number | undefined;
```

### CallUsage cacheReadTokens

Tokens de entrada en caché LEÍDOS (facturados a la tarifa de lectura de caché, si la hay).

```ts
cacheReadTokens: number | undefined;
```

### CallUsage cacheWriteTokens

Tokens de entrada escritos en la caché en esta llamada; undefined si no se informa.

```ts
cacheWriteTokens: number | undefined;
```

### CallUsage cacheWrite1hTokens

Subconjunto de cacheWriteTokens escrito con retención de una hora. Falta en los registros
antiguos; las capturas nativas nuevas registran explícitamente cero si no hay.

```ts
cacheWrite1hTokens?: number;
```

### CallUsage reasoningTokens

La parte de razonamiento de los tokens de salida.

```ts
reasoningTokens: number | undefined;
```

## ChatKind

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Tipo de sesión: teach es el valor por defecto cuando un registro guardado omite kind.
Practice usa el agente de práctica adaptativa sin extracción de la enseñanza ni escrituras
en el grafo. Leer un kind ausente no requiere migrar el registro.

```ts
export type ChatKind = "teach" | "practice";
```

## ChatListItem

Tipo público del SDK, exportado como `ChatListItem`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Fila de la lista de sesiones que combina un resumen guardado con el estado en vivo del
servidor. busy significa que hay en curso un turno nativo de conversación; las tareas en
segundo plano independientes no ocupan la sesión. Estos indicadores no son estado
persistido.

```ts
export interface ChatListItem extends ChatSummary {
    busy: boolean;
    compacting: boolean;
}
```

**Tipos relacionados:** [ChatSummary](contracts-chat.md#chatsummary).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [busy](#chatlistitem-busy)
- [compacting](#chatlistitem-compacting)

### ChatListItem busy

```ts
busy: boolean;
```

### ChatListItem compacting

True mientras la compactación del contexto en segundo plano retiene el acceso del chat al
modelo. Lo aporta el registro en vivo de compactaciones, no los marcadores de compactación
guardados.

```ts
compacting: boolean;
```

## ChatRecord

Tipo público del SDK, exportado como `ChatRecord`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Una sesión nativa persistida en data/chats/<id>.json. Los mensajes conservan el historial
nativo del agente; el render de la transcripción los agrupa en una vista aparte.
El uso, las imágenes, el estado del plan y las conversaciones laterales son registros
propiedad de la sesión.

```ts
export interface ChatRecord {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: LhMessage[];
    imageSnapshots?: Record<string, ImageSnapshot>;
    kind?: ChatKind;
    tree?: PlanTree;
    turns?: TurnUsage[];
    extractions?: ExtractionRunUsage[];
    settings?: ChatSettings;
    sideChats?: SideChatThread[];
    version?: number;
}
```

**Tipos relacionados:** [ChatKind](contracts-chat.md#chatkind), [ChatSettings](contracts-chat.md#chatsettings), [ExtractionRunUsage](contracts-chat.md#extractionrunusage), [ImageSnapshot](contracts-chat.md#imagesnapshot), [LhMessage](native-messages.md#lhmessage), [PlanTree](contracts-plan.md#plantree), [SideChatThread](contracts-chat.md#sidechatthread), [TurnUsage](contracts-chat.md#turnusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#chatrecord-id)
- [title](#chatrecord-title)
- [createdAt](#chatrecord-createdat)
- [updatedAt](#chatrecord-updatedat)
- [messages](#chatrecord-messages)
- [imageSnapshots](#chatrecord-imagesnapshots)
- [kind](#chatrecord-kind)
- [tree](#chatrecord-tree)
- [turns](#chatrecord-turns)
- [extractions](#chatrecord-extractions)
- [settings](#chatrecord-settings)
- [sideChats](#chatrecord-sidechats)
- [version](#chatrecord-version)

### ChatRecord id

```ts
id: string;
```

### ChatRecord title

```ts
title: string;
```

### ChatRecord createdAt

```ts
createdAt: string;
```

### ChatRecord updatedAt

```ts
updatedAt: string;
```

### ChatRecord messages

```ts
messages: LhMessage[];
```

### ChatRecord imageSnapshots

Imágenes procesadas locales de la sesión; los registros de artefactos solo llevan
referencias.

```ts
imageSnapshots?: Record<string, ImageSnapshot>;
```

### ChatRecord kind

El tipo de la sesión; un campo ausente se lee como teach.

```ts
kind?: ChatKind;
```

### ChatRecord tree

El árbol del plan de la sesión, que escriben las herramientas nativas del plan.

```ts
tree?: PlanTree;
```

### ChatRecord turns

Registro de uso de solo añadir, separado del historial de mensajes: una entrada por turno
facturado, sin duplicados por identidad de petición. messageId asocia el uso con la
transcripción; los agregados de tokens y costes se calculan a partir del registro al leer.

```ts
turns?: TurnUsage[];
```

### ChatRecord extractions

Uso de la extracción en segundo plano de este chat, de solo añadir y separado de los
mensajes. Las ejecuciones terminadas incluyen las fallidas que tuvieron uso; las adiciones
son idempotentes por startedAt.

```ts
extractions?: ExtractionRunUsage[];
```

### ChatRecord settings

Sustituciones de modelo y razonamiento por chat para los agentes de conversación.

```ts
settings?: ChatSettings;
```

### ChatRecord sideChats

Hilos de aclaración duraderos. Cada explicación y su comprobación asociada comparten un
hilo. Cada petición principal añade nuevos intercambios en bruto de todos los hilos; el
historial ya registrado del profesor nunca se reescribe.

```ts
sideChats?: SideChatThread[];
```

### ChatRecord version

Versión del esquema. Si falta, es la versión 1; las escrituras ponen la versión admitida
actual. Las lecturas rechazan los registros con una versión más nueva que esta compilación,
para que una app con una versión anterior no pueda reescribir un registro que no admite.

```ts
version?: number;
```

## ChatSettings

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Elecciones de modelo y de razonamiento por sesión para los agentes nativos de conversación.
Cada campo ausente recurre por separado a la ranura del modelo potente; si no hay ningún
modelo configurado, el trabajo de conversación no está disponible. Las elecciones se
resuelven al componer un turno, no en mitad de una petición activa. Los roles de los
workers en segundo plano usan su propia resolución de modelo.

```ts
export interface ChatSettings {
    model?: {
        provider: string;
        id: string;
    };
    thinkingLevel?: ThinkingLevel;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#chatsettings-model)
- [model.provider](#chatsettings-modelprovider)
- [model.id](#chatsettings-modelid)
- [thinkingLevel](#chatsettings-thinkinglevel)

### ChatSettings model

Coordenadas explícitas del modelo, calificadas con el proveedor, del catálogo del host.

```ts
model?: {
    provider: string;
    id: string;
};
```

### ChatSettings model.provider

```ts
provider: string;
```

### ChatSettings model.id

```ts
id: string;
```

### ChatSettings thinkingLevel

Nivel de razonamiento de pi: debe estar en la lista de niveles admitidos del modelo elegido
(getSupportedThinkingLevels; lo impone la ruta de ajustes).

```ts
thinkingLevel?: ThinkingLevel;
```

## ChatSummary

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Resumen de una sesión guardada con un recuento de mensajes en lugar del historial completo.
Los indicadores de fase y de entrada pendiente se derivan de los eventos nativos de la
transcripción. El estado en vivo de turnos y compactación se añade aparte en ChatListItem;
no se infiere del registro guardado.

```ts
export interface ChatSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    kind: ChatKind;
    messageCount: number;
    phase: Phase3;
    pendingQuestion: boolean;
    pendingProblem: boolean;
    settings?: ChatSettings;
}
```

**Tipos relacionados:** [ChatKind](contracts-chat.md#chatkind), [ChatSettings](contracts-chat.md#chatsettings), [Phase3](phases.md#phase3).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#chatsummary-id)
- [title](#chatsummary-title)
- [createdAt](#chatsummary-createdat)
- [updatedAt](#chatsummary-updatedat)
- [kind](#chatsummary-kind)
- [messageCount](#chatsummary-messagecount)
- [phase](#chatsummary-phase)
- [pendingQuestion](#chatsummary-pendingquestion)
- [pendingProblem](#chatsummary-pendingproblem)
- [settings](#chatsummary-settings)

### ChatSummary id

```ts
id: string;
```

### ChatSummary title

```ts
title: string;
```

### ChatSummary createdAt

```ts
createdAt: string;
```

### ChatSummary updatedAt

```ts
updatedAt: string;
```

### ChatSummary kind

Tipo normalizado (un campo ausente en el registro se lee como teach).

```ts
kind: ChatKind;
```

### ChatSummary messageCount

```ts
messageCount: number;
```

### ChatSummary phase

Fase derivada de la transcripción: probe termina cuando probe_done se completa con éxito;
plan termina con la primera llamada a una pregunta de enseñanza etiquetada con un nodo, no
con su respuesta.

```ts
phase: Phase3;
```

### ChatSummary pendingQuestion

Una pregunta de quiz/ask sin responder espera al alumno.

```ts
pendingQuestion: boolean;
```

### ChatSummary pendingProblem

Se ha planteado un problema de práctica que no ha concluido. False en las sesiones de
enseñanza.

```ts
pendingProblem: boolean;
```

### ChatSummary settings

Elecciones guardadas de modelo y razonamiento por sesión, incluidas en el contenido de la
lista.

```ts
settings?: ChatSettings;
```

## ExtractionRunUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

El registro de uso de una ejecución de extracción terminada (o que falló a mitad).
Se añade al registro `extractions` del chat cuando termina la ejecución, con éxito o con
fallo, porque se ha gastado dinero en ambos casos; `stats` solo está presente cuando el
fusionador llegó a ejecutarse.

```ts
export interface ExtractionRunUsage {
    startedAt: number;
    at: string;
    durationMs: number;
    stats?: EmissionStats;
    stages: {
        extractor: ExtractionStageUsage;
        auditor: ExtractionStageUsage;
    };
}
```

**Tipos relacionados:** [EmissionStats](contracts-graph.md#emissionstats), [ExtractionStageUsage](contracts-chat.md#extractionstageusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [startedAt](#extractionrunusage-startedat)
- [at](#extractionrunusage-at)
- [durationMs](#extractionrunusage-durationms)
- [stats](#extractionrunusage-stats)
- [stages](#extractionrunusage-stages)
- [stages.extractor](#extractionrunusage-stagesextractor)
- [stages.auditor](#extractionrunusage-stagesauditor)

### ExtractionRunUsage startedAt

El startedAt (ms) de la ejecución en el registro: la clave de idempotencia.

```ts
startedAt: number;
```

### ExtractionRunUsage at

```ts
at: string;
```

### ExtractionRunUsage durationMs

```ts
durationMs: number;
```

### ExtractionRunUsage stats

Lo que la ejecución fusionó en el grafo; ausente si falló antes.

```ts
stats?: EmissionStats;
```

### ExtractionRunUsage stages

Uso del modelo por etapa, en el orden del flujo (el fusionador es determinista: no llama al
modelo y no tiene entrada).

```ts
stages: {
    extractor: ExtractionStageUsage;
    auditor: ExtractionStageUsage;
};
```

### ExtractionRunUsage stages.extractor

```ts
extractor: ExtractionStageUsage;
```

### ExtractionRunUsage stages.auditor

```ts
auditor: ExtractionStageUsage;
```

## ExtractionStageUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

El uso del modelo de una etapa del flujo: el modelo de la etapa + cada paso que facturó
(CallUsage por paso del agente). Pasos, no una suma: los cálculos de coste y de contexto se
hacen al leer (core/prices.ts).

```ts
export interface ExtractionStageUsage {
    model: string;
    steps: CallUsage[];
}
```

**Tipos relacionados:** [CallUsage](contracts-chat.md#callusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#extractionstageusage-model)
- [steps](#extractionstageusage-steps)

### ExtractionStageUsage model

El modelo que ejecutó esta etapa, calificado con el proveedor ("provider:id") para
consultar el catálogo de Pi al leer sin depender de la clave.

```ts
model: string;
```

### ExtractionStageUsage steps

```ts
steps: CallUsage[];
```

## ImageSnapshot

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Una imagen en posición vertical y sin metadatos, guardada una sola vez por sesión.

```ts
export interface ImageSnapshot {
    mimeType: "image/png" | "image/jpeg";
    data: string;
    width: number;
    height: number;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [mimeType](#imagesnapshot-mimetype)
- [data](#imagesnapshot-data)
- [width](#imagesnapshot-width)
- [height](#imagesnapshot-height)

### ImageSnapshot mimeType

```ts
mimeType: "image/png" | "image/jpeg";
```

### ImageSnapshot data

```ts
data: string;
```

### ImageSnapshot width

```ts
width: number;
```

### ImageSnapshot height

```ts
height: number;
```

## SideChatAnchor

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Dónde se sitúa un hilo lateral en la transcripción: tras un bloque de nivel de párrafo
(la división en bloques de markdown de Streamdown) de una parte de prosa del profesor.
La prosa asentada del profesor nunca cambia, así que (partId, blockIndex) es estable.

```ts
export interface SideChatAnchor {
    messageId: string;
    partId: string;
    blockIndex: number;
    blockText: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [messageId](#sidechatanchor-messageid)
- [partId](#sidechatanchor-partid)
- [blockIndex](#sidechatanchor-blockindex)
- [blockText](#sidechatanchor-blocktext)

### SideChatAnchor messageId

El mensaje nativo del asistente que lleva la prosa.

```ts
messageId: string;
```

### SideChatAnchor partId

La identidad de la parte de texto según projectView (`<messageId>-t<n>`).

```ts
partId: string;
```

### SideChatAnchor blockIndex

Índice del bloque, empezando en 0, dentro del markdown representado de esa parte.

```ts
blockIndex: number;
```

### SideChatAnchor blockText

El código markdown del bloque cuando se abrió el hilo: la cita por defecto y el texto del
ancla si el registro vuelve a dividirse alguna vez.

```ts
blockText: string;
```

## SideChatMessage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Un mensaje de un hilo lateral. Texto plano, nunca historial nativo de pi: el hilo se
reproduce al modelo lateral como turnos de texto de usuario/asistente.

```ts
export interface SideChatMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    quotes?: string[];
    quoteCitations?: string[];
    at: string;
    model?: string;
    requestId?: string;
    stopped?: boolean;
    pending?: boolean;
    error?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#sidechatmessage-id)
- [role](#sidechatmessage-role)
- [text](#sidechatmessage-text)
- [quotes](#sidechatmessage-quotes)
- [quoteCitations](#sidechatmessage-quotecitations)
- [at](#sidechatmessage-at)
- [model](#sidechatmessage-model)
- [requestId](#sidechatmessage-requestid)
- [stopped](#sidechatmessage-stopped)
- [pending](#sidechatmessage-pending)
- [error](#sidechatmessage-error)

### SideChatMessage id

```ts
id: string;
```

### SideChatMessage role

```ts
role: "user" | "assistant";
```

### SideChatMessage text

La pregunta del alumno o la respuesta lateral (markdown).

```ts
text: string;
```

### SideChatMessage quotes

Solo user: los pasajes que el alumno adjuntó a esta pregunta.

```ts
quotes?: string[];
```

### SideChatMessage quoteCitations

Los enlaces de cita canónicos de Tutor que coinciden conservan la fuente nativa real de cada
pasaje y su selector de texto exacto, con independencia de la identidad del segmento.
Las citas heredadas que son solo cadenas siguen siendo legibles sin adivinar un destino.

```ts
quoteCitations?: string[];
```

### SideChatMessage at

Hora ISO en que se guardó el mensaje.

```ts
at: string;
```

### SideChatMessage model

Solo assistant: modelo calificado con el proveedor ("provider:id").

```ts
model?: string;
```

### SideChatMessage requestId

Identidad de idempotencia de la pregunta o reintento que produce esta respuesta.

```ts
requestId?: string;
```

### SideChatMessage stopped

Solo assistant: el alumno detuvo la respuesta; `text` es parcial.

```ts
stopped?: boolean;
```

### SideChatMessage pending

Solo en la instantánea de entrega: esta respuesta aún se estaba generando al capturarla.

```ts
pending?: boolean;
```

### SideChatMessage error

Solo assistant: la llamada falló; `text` es lo que haya llegado.

```ts
error?: string;
```

## SideChatThread

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Un hilo lateral por explicación y pregunta asociada, que se muestra en el acompañante
compartido flotante o acoplado en lugar de en ventanas en línea.

```ts
export interface SideChatThread {
    id: string;
    anchor: SideChatAnchor;
    open: boolean;
    createdAt: string;
    messages: SideChatMessage[];
    contextSnapshot?: SideChatMessage[];
}
```

**Tipos relacionados:** [SideChatAnchor](contracts-chat.md#sidechatanchor), [SideChatMessage](contracts-chat.md#sidechatmessage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#sidechatthread-id)
- [anchor](#sidechatthread-anchor)
- [open](#sidechatthread-open)
- [createdAt](#sidechatthread-createdat)
- [messages](#sidechatthread-messages)
- [contextSnapshot](#sidechatthread-contextsnapshot)

### SideChatThread id

```ts
id: string;
```

### SideChatThread anchor

```ts
anchor: SideChatAnchor;
```

### SideChatThread open

Estado abierto/cerrado guardado de este hilo.

```ts
open: boolean;
```

### SideChatThread createdAt

```ts
createdAt: string;
```

### SideChatThread messages

```ts
messages: SideChatMessage[];
```

### SideChatThread contextSnapshot

Instantánea de compatibilidad que se conserva al leer registros que usan un corte de
contexto único. La entrega actual usa entradas de actualización nativas inmutables.

```ts
contextSnapshot?: SideChatMessage[];
```

## TurnUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Uso de una invocación del manejador nativo de conversación, incluidos los turnos del
usuario y de activación. Un turno que usa herramientas puede abarcar varias llamadas al
modelo facturadas por separado. La contabilidad se captura cuando el turno se persiste; el
coste se estima al leer a partir de las llamadas registradas y del catálogo de modelos.

```ts
export interface TurnUsage {
    id: string;
    messageId: string;
    at: string;
    model: string;
    steps: CallUsage[];
}
```

**Tipos relacionados:** [CallUsage](contracts-chat.md#callusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#turnusage-id)
- [messageId](#turnusage-messageid)
- [at](#turnusage-at)
- [model](#turnusage-model)
- [steps](#turnusage-steps)

### TurnUsage id

Identidad de la petición de una invocación del manejador y clave de idempotencia del
registro de solo añadir. Distinta de la asociación con la transcripción en messageId.

```ts
id: string;
```

### TurnUsage messageId

El mensaje del asistente que produjo el turno: procedencia; vincula esta entrada con la
transcripción (el bloque al que "pertenece" este turno).

```ts
messageId: string;
```

### TurnUsage at

```ts
at: string;
```

### TurnUsage model

El modelo que ejecutó el turno, calificado con el proveedor ("provider:id") para consultar
el catálogo de Pi al leer sin depender de la clave.

```ts
model: string;
```

### TurnUsage steps

Una entrada por paso del agente (llamada al modelo) en este turno.

```ts
steps: CallUsage[];
```
