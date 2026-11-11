# plugin-agents

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Agentes gestionados](../plugin-authoring.md#agentes-conversacionales-gestionados)

- [PluginAgentDefinition](#pluginagentdefinition)
- [PluginAgentInputOptions](#pluginagentinputoptions)
- [PluginAgentRecord](#pluginagentrecord)
- [PluginAgentService](#pluginagentservice)
- [PluginAgentSnapshot](#pluginagentsnapshot)
- [PluginAgentTool](#pluginagenttool)
- [PluginCallPurpose](#plugincallpurpose)
- [PluginModelSpec](#pluginmodelspec)
- [PluginPendingInput](#pluginpendinginput)

## PluginAgentDefinition

Tipo público del SDK, exportado como `PluginAgentDefinition`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginAgentDefinition {
    id: string;
    instructions: string;
    model: PluginModelSpec;
    tools?: PluginAgentTool[];
    maxTurns?: number;
}
```

**Tipos relacionados:** [PluginAgentTool](plugin-agents.md#pluginagenttool), [PluginModelSpec](plugin-agents.md#pluginmodelspec).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginagentdefinition-id)
- [instructions](#pluginagentdefinition-instructions)
- [model](#pluginagentdefinition-model)
- [tools](#pluginagentdefinition-tools)
- [maxTurns](#pluginagentdefinition-maxturns)

### PluginAgentDefinition id

```ts
id: string;
```

### PluginAgentDefinition instructions

```ts
instructions: string;
```

### PluginAgentDefinition model

```ts
model: PluginModelSpec;
```

### PluginAgentDefinition tools

```ts
tools?: PluginAgentTool[];
```

### PluginAgentDefinition maxTurns

```ts
maxTurns?: number;
```

## PluginAgentInputOptions

Tipo público del SDK, exportado como `PluginAgentInputOptions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginAgentInputOptions {
    requestId: string;
    purpose?: PluginCallPurpose;
}
```

**Tipos relacionados:** [PluginCallPurpose](plugin-agents.md#plugincallpurpose).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [requestId](#pluginagentinputoptions-requestid)
- [purpose](#pluginagentinputoptions-purpose)

### PluginAgentInputOptions requestId

Reintenta una acción aceptada con la misma identidad para no aceptarla dos veces;
una acción nueva necesita un ID nuevo. Esto no garantiza efectos externos exactamente una vez.

```ts
requestId: string;
```

### PluginAgentInputOptions purpose

Clasificación de iniciación y consentimiento, no de visibilidad en la vista. Por defecto es
user para send/answer y background para run; clasifica explícitamente el trabajo automático.

```ts
purpose?: PluginCallPurpose;
```

## PluginAgentRecord

Tipo público del SDK, exportado como `PluginAgentRecord`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginAgentRecord {
    version: 1;
    id: string;
    definitionId: string;
    createdAt: string;
    updatedAt: string;
    messages: AgentMessage[];
    pending: PluginPendingInput[];
    status: "idle" | "running" | "waiting" | "error" | "interrupted";
    error?: string;
    acceptedInputs: string[];
}
```

**Tipos relacionados:** [PluginPendingInput](plugin-agents.md#pluginpendinginput).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [version](#pluginagentrecord-version)
- [id](#pluginagentrecord-id)
- [definitionId](#pluginagentrecord-definitionid)
- [createdAt](#pluginagentrecord-createdat)
- [updatedAt](#pluginagentrecord-updatedat)
- [messages](#pluginagentrecord-messages)
- [pending](#pluginagentrecord-pending)
- [status](#pluginagentrecord-status)
- [error](#pluginagentrecord-error)
- [acceptedInputs](#pluginagentrecord-acceptedinputs)

### PluginAgentRecord version

```ts
version: 1;
```

### PluginAgentRecord id

```ts
id: string;
```

### PluginAgentRecord definitionId

```ts
definitionId: string;
```

### PluginAgentRecord createdAt

```ts
createdAt: string;
```

### PluginAgentRecord updatedAt

```ts
updatedAt: string;
```

### PluginAgentRecord messages

```ts
messages: AgentMessage[];
```

### PluginAgentRecord pending

```ts
pending: PluginPendingInput[];
```

### PluginAgentRecord status

```ts
status: "idle" | "running" | "waiting" | "error" | "interrupted";
```

### PluginAgentRecord error

```ts
error?: string;
```

### PluginAgentRecord acceptedInputs

Las identidades de entrada aceptadas impiden que un envío reintentado se ejecute dos veces.

```ts
acceptedInputs: string[];
```

## PluginAgentService

Tipo público del SDK, exportado como `PluginAgentService`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Conversaciones persistentes propiedad del plugin, independientes de las vistas del
frontend. La ejecución del modelo puede tener coste. Vuelve a registrar definiciones
compatibles tras la activación; un reinicio interrumpe el trabajo en curso en lugar de
volver a ejecutar herramientas automáticamente.

```ts
export interface PluginAgentService {
    register(definition: PluginAgentDefinition): () => void;
    create(definitionId: string): PluginAgentSnapshot;
    list(): PluginAgentSnapshot[];
    get(id: string): PluginAgentSnapshot;
    send(id: string, text: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
    answer(id: string, toolCallId: string, value: unknown, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
    run(id: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
    abort(id: string): void;
    subscribe(id: string, listener: (snapshot: PluginAgentSnapshot) => void): () => void;
    dispose(): Promise<void>;
}
```

**Tipos relacionados:** [PluginAgentDefinition](plugin-agents.md#pluginagentdefinition), [PluginAgentInputOptions](plugin-agents.md#pluginagentinputoptions), [PluginAgentSnapshot](plugin-agents.md#pluginagentsnapshot).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [register](#pluginagentservice-register)
- [create](#pluginagentservice-create)
- [list](#pluginagentservice-list)
- [get](#pluginagentservice-get)
- [send](#pluginagentservice-send)
- [answer](#pluginagentservice-answer)
- [run](#pluginagentservice-run)
- [abort](#pluginagentservice-abort)
- [subscribe](#pluginagentservice-subscribe)
- [dispose](#pluginagentservice-dispose)

### PluginAgentService register

Registra instrucciones, modelo y herramientas para un ID de definición. Las definiciones no
válidas o duplicadas lanzan una excepción. Devuelve una función para anular el registro que
cancela cooperativamente las ejecuciones activas de esa definición sin borrar las
conversaciones guardadas.

```ts
register(definition: PluginAgentDefinition): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `definition` | `PluginAgentDefinition` |

**Devuelve:** `() => void`.

### PluginAgentService create

Persiste una conversación vacía e inactiva y devuelve su instantánea independiente; no se
inicia ninguna petición al modelo. Lanza una excepción si la definición no está disponible o
falla la persistencia.

```ts
create(definitionId: string): PluginAgentSnapshot;
```

| Parámetro | Tipo |
| --- | --- |
| `definitionId` | `string` |

**Devuelve:** `PluginAgentSnapshot`.

### PluginAgentService list

Devuelve instantáneas independientes de las conversaciones de este plugin, incluidos los
parciales efímeros actuales. No ejecuta, reanuda ni se suscribe a ninguna conversación.

```ts
list(): PluginAgentSnapshot[];
```

**Devuelve:** `PluginAgentSnapshot[]`.

### PluginAgentService get

Lee una instantánea independiente, incluido cualquier parcial actual. Los ID desconocidos
lanzan una excepción; un parcial devuelto es progreso, no historial confirmado.

```ts
get(id: string): PluginAgentSnapshot;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `PluginAgentSnapshot`.

### PluginAgentService send

Persiste texto explícito y no vacío del usuario y lanza la ejecución. Se resuelve tras la
aceptación, no al terminar; observa después el estado y los errores con get/subscribe.
Un requestId ya aceptado devuelve el estado actual sin otra entrada.
Rechaza las sesiones ocupadas, las entradas externas sin resolver y los errores de
aceptación o almacenamiento.

```ts
send(id: string, text: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `text` | `string` |
| `options` | `PluginAgentInputOptions` |

**Devuelve:** `Promise<PluginAgentSnapshot>`.

### PluginAgentService answer

Valida y persiste el resultado de una herramienta de entrada pendiente. Las respuestas no
válidas no se guardan; la última respuesta requerida lanza la continuación. Se resuelve con
el estado aceptado, no al terminar el modelo; los ID de petición aceptados no se envían dos
veces. Las entradas o definiciones inexistentes, las sesiones ocupadas y los fallos de
validación o almacenamiento producen un rechazo.

```ts
answer(id: string, toolCallId: string, value: unknown, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `toolCallId` | `string` |
| `value` | `unknown` |
| `options` | `PluginAgentInputOptions` |

**Devuelve:** `Promise<PluginAgentSnapshot>`.

### PluginAgentService run

Reanuda una entrada persistida existente que pueda ejecutarse sin añadir un prompt
sintético. Se resuelve tras la aceptación, no al terminar; los ID de petición aceptados
devuelven el estado actual. Rechaza las entradas externas pendientes, los lotes de
herramientas sin resolver que no sean seguros, las sesiones ocupadas o el historial sin
entrada ejecutable; usa send para una tarea explícita nueva.

```ts
run(id: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `options` | `PluginAgentInputOptions` |

**Devuelve:** `Promise<PluginAgentSnapshot>`.

### PluginAgentService abort

Solicita la cancelación cooperativa de una ejecución activa, conservando los mensajes y las
entradas pendientes. Las ejecuciones inactivas no cambian. No espera al código de
herramientas que no coopere ni deshace efectos externos; los ID desconocidos y los fallos
de persistencia lanzan una excepción.

```ts
abort(id: string): void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `void`.

### PluginAgentService subscribe

Entrega una instantánea independiente de forma síncrona y, después, los cambios en vivo de
estado y progreso. Devuelve una función para cancelar la suscripción; cancelarla nunca
cancela la ejecución. Los ID desconocidos lanzan una excepción; si el listener lanza una
excepción en la entrega inicial, se elimina la suscripción.

```ts
subscribe(id: string, listener: (snapshot: PluginAgentSnapshot) => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `listener` | `(snapshot: PluginAgentSnapshot) => void` |

**Devuelve:** `() => void`.

### PluginAgentService dispose

Cancela cooperativamente las ejecuciones propias y libera definiciones y listeners,
conservando los registros persistidos. Es idempotente; no espera al código del plugin que no
coopere. Se rechaza si falla la persistencia de la cancelación. Desactivar el plugin en el
host también lo libera.

```ts
dispose(): Promise<void>;
```

**Devuelve:** `Promise<void>`.

## PluginAgentSnapshot

Tipo público del SDK, exportado como `PluginAgentSnapshot`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginAgentSnapshot extends PluginAgentRecord {
    partial?: AssistantMessage;
}
```

**Tipos relacionados:** [PluginAgentRecord](plugin-agents.md#pluginagentrecord).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [partial](#pluginagentsnapshot-partial)

### PluginAgentSnapshot partial

Respuesta efímera hasta el momento; nunca se confunde con el historial confirmado.

```ts
partial?: AssistantMessage;
```

## PluginAgentTool

Tipo público del SDK, exportado como `PluginAgentTool`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginAgentTool = {
    name: string;
    description: string;
    parameters: TSchema;
    prepareArguments?: AgentTool<any>["prepareArguments"];
    resultSchema?: TSchema;
    formatResult?: (value: unknown) => AgentToolResult<unknown>;
} & ({
    kind: "input";
    execute?: never;
    endRun?: never;
} | {
    kind?: "server";
    execute: AgentTool<any>["execute"];
    endRun?: boolean;
});
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [name](#pluginagenttool-name)
- [description](#pluginagenttool-description)
- [parameters](#pluginagenttool-parameters)
- [prepareArguments](#pluginagenttool-preparearguments)
- [resultSchema](#pluginagenttool-resultschema)
- [formatResult](#pluginagenttool-formatresult)
- [kind](#pluginagenttool-kind) — 2 firmas o variantes
- [execute](#pluginagenttool-execute) — 2 firmas o variantes
- [endRun](#pluginagenttool-endrun) — 2 firmas o variantes

### PluginAgentTool name

```ts
name: string;
```

### PluginAgentTool description

```ts
description: string;
```

### PluginAgentTool parameters

```ts
parameters: TSchema;
```

### PluginAgentTool prepareArguments

```ts
prepareArguments?: AgentTool<any>["prepareArguments"];
```

### PluginAgentTool resultSchema

```ts
resultSchema?: TSchema;
```

### PluginAgentTool formatResult

```ts
formatResult?: (value: unknown) => AgentToolResult<unknown>;
```

| Parámetro | Tipo |
| --- | --- |
| `value` | `unknown` |

**Devuelve:** `AgentToolResult<unknown>`.

### PluginAgentTool kind

La entrada externa declarativa se persiste; nunca es una Promise suspendida.

```ts
kind: "input";
```

```ts
kind?: "server";
```

### PluginAgentTool execute

```ts
execute?: never;
```

```ts
execute: AgentTool<any>["execute"];
```

### PluginAgentTool endRun

```ts
endRun?: never;
```

Una herramienta ordinaria que termina bien puede devolver su resultado y pausar la ejecución.

```ts
endRun?: boolean;
```

## PluginCallPurpose

Tipo público del SDK, exportado como `PluginCallPurpose`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginCallPurpose = "user" | "background";
```

## PluginModelSpec

Tipo público del SDK, exportado como `PluginModelSpec`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginModelSpec = NonNullable<ChatSettings["model"]> & {
    thinkingLevel?: ChatSettings["thinkingLevel"];
};
```

**Tipos relacionados:** [ChatSettings](contracts-chat.md#chatsettings).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [thinkingLevel](#pluginmodelspec-thinkinglevel)

### PluginModelSpec thinkingLevel

```ts
thinkingLevel?: ChatSettings["thinkingLevel"];
```

## PluginPendingInput

Tipo público del SDK, exportado como `PluginPendingInput`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginPendingInput {
    toolCallId: string;
    toolName: string;
    input: unknown;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [toolCallId](#pluginpendinginput-toolcallid)
- [toolName](#pluginpendinginput-toolname)
- [input](#pluginpendinginput-input)

### PluginPendingInput toolCallId

```ts
toolCallId: string;
```

### PluginPendingInput toolName

```ts
toolName: string;
```

### PluginPendingInput input

```ts
input: unknown;
```
