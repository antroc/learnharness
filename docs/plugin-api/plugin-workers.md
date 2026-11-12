# plugin-workers

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Workers y herramientas en segundo plano](../plugin-authoring.md#workers-orientados-a-resultados-y-herramientas-en-segundo-plano)

- [PluginBackgroundMeta](#pluginbackgroundmeta)
- [PluginBackgroundPresentation](#pluginbackgroundpresentation)
- [PluginBackgroundResult](#pluginbackgroundresult)
- [PluginBackgroundTool](#pluginbackgroundtool)
- [PluginTaskError](#plugintaskerror)
- [PluginTaskOutcome](#plugintaskoutcome)
- [PluginTaskRecord](#plugintaskrecord)
- [PluginTaskSnapshot](#plugintasksnapshot)
- [PluginTaskStatus](#plugintaskstatus)
- [PluginWorkerContext](#pluginworkercontext)
- [PluginWorkerDefinition](#pluginworkerdefinition)
- [PluginWorkerService](#pluginworkerservice)
- [PluginWorkerStartOptions](#pluginworkerstartoptions)

## PluginBackgroundMeta

Tipo público del SDK, exportado como `PluginBackgroundMeta`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginBackgroundMeta {
    pluginId: string;
    taskId: string;
    status: PluginTaskOutcome["status"];
}
```

**Tipos relacionados:** [PluginTaskOutcome](plugin-workers.md#plugintaskoutcome).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [pluginId](#pluginbackgroundmeta-pluginid)
- [taskId](#pluginbackgroundmeta-taskid)
- [status](#pluginbackgroundmeta-status)

### PluginBackgroundMeta pluginId

```ts
pluginId: string;
```

### PluginBackgroundMeta taskId

```ts
taskId: string;
```

### PluginBackgroundMeta status

```ts
status: PluginTaskOutcome["status"];
```

## PluginBackgroundPresentation

Tipo público del SDK, exportado como `PluginBackgroundPresentation`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginBackgroundPresentation {
    text: string;
    data?: unknown;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [text](#pluginbackgroundpresentation-text)
- [data](#pluginbackgroundpresentation-data)

### PluginBackgroundPresentation text

```ts
text: string;
```

### PluginBackgroundPresentation data

```ts
data?: unknown;
```

## PluginBackgroundResult

Tipo público del SDK, exportado como `PluginBackgroundResult`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Se persiste en el resultado normal de la tarea en segundo plano y en el marcador de la conversación.

```ts
export interface PluginBackgroundResult extends PluginBackgroundPresentation {
    pluginId: string;
    toolName: string;
    input: unknown;
    outcome: PluginTaskOutcome;
    formatError?: string;
}
```

**Tipos relacionados:** [PluginBackgroundPresentation](plugin-workers.md#pluginbackgroundpresentation), [PluginTaskOutcome](plugin-workers.md#plugintaskoutcome).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [pluginId](#pluginbackgroundresult-pluginid)
- [toolName](#pluginbackgroundresult-toolname)
- [input](#pluginbackgroundresult-input)
- [outcome](#pluginbackgroundresult-outcome)
- [formatError](#pluginbackgroundresult-formaterror)

### PluginBackgroundResult pluginId

```ts
pluginId: string;
```

### PluginBackgroundResult toolName

```ts
toolName: string;
```

### PluginBackgroundResult input

```ts
input: unknown;
```

### PluginBackgroundResult outcome

```ts
outcome: PluginTaskOutcome;
```

### PluginBackgroundResult formatError

Un fallo de presentación no cambia retroactivamente el éxito del worker.

```ts
formatError?: string;
```

## PluginBackgroundTool

Tipo público del SDK, exportado como `PluginBackgroundTool`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Un adaptador fino de herramientas nativas, no otro framework de ejecución de agentes o de herramientas.

```ts
export type PluginBackgroundTool<T extends TSchema = TSchema> = Omit<AgentTool<T>, "execute"> & {
    workerId: string;
    prepare(input: Static<T>, context: PluginToolContext): Omit<PluginWorkerStartOptions, "requestId" | "purpose"> | Promise<Omit<PluginWorkerStartOptions, "requestId" | "purpose">>;
    format(outcome: PluginTaskOutcome, context: PluginToolContext): PluginBackgroundPresentation | Promise<PluginBackgroundPresentation>;
};
```

**Tipos relacionados:** [PluginBackgroundPresentation](plugin-workers.md#pluginbackgroundpresentation), [PluginTaskOutcome](plugin-workers.md#plugintaskoutcome), [PluginToolContext](plugins.md#plugintoolcontext), [PluginWorkerStartOptions](plugin-workers.md#pluginworkerstartoptions).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [workerId](#pluginbackgroundtool-workerid)
- [prepare](#pluginbackgroundtool-prepare)
- [format](#pluginbackgroundtool-format)

### PluginBackgroundTool workerId

```ts
workerId: string;
```

### PluginBackgroundTool prepare

Deriva la entrada del worker, el prompt y los límites explícitos sin efectos
secundarios. El host aporta la identidad de la petición y fuerza el propósito background.

```ts
prepare(input: Static<T>, context: PluginToolContext): Omit<PluginWorkerStartOptions, "requestId" | "purpose"> | Promise<Omit<PluginWorkerStartOptions, "requestId" | "purpose">>;
```

| Parámetro | Tipo |
| --- | --- |
| `input` | `Static<T>` |
| `context` | `PluginToolContext` |

**Devuelve:** `Omit<PluginWorkerStartOptions, "requestId" \| "purpose"> \| Promise<Omit<PluginWorkerStartOptions, "requestId" \| "purpose">>`.

### PluginBackgroundTool format

Convierte un resultado terminal en texto para el modelo y datos opcionales para representar;
mantenlo sin efectos secundarios. Un fallo registra un error de presentación, no un
resultado distinto de la tarea; la entrega tras un reinicio puede usar una alternativa
persistida sin volver a ejecutarlo.

```ts
format(outcome: PluginTaskOutcome, context: PluginToolContext): PluginBackgroundPresentation | Promise<PluginBackgroundPresentation>;
```

| Parámetro | Tipo |
| --- | --- |
| `outcome` | `PluginTaskOutcome` |
| `context` | `PluginToolContext` |

**Devuelve:** `PluginBackgroundPresentation \| Promise<PluginBackgroundPresentation>`.

## PluginTaskError

Tipo público del SDK, exportado como `PluginTaskError`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTaskError {
    code: "no_result" | "max_turns" | "timeout" | "run_error" | "storage_error" | "cancelled" | "interrupted";
    message: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [code](#plugintaskerror-code)
- [message](#plugintaskerror-message)

### PluginTaskError code

```ts
code: "no_result" | "max_turns" | "timeout" | "run_error" | "storage_error" | "cancelled" | "interrupted";
```

### PluginTaskError message

```ts
message: string;
```

## PluginTaskOutcome

Tipo público del SDK, exportado como `PluginTaskOutcome`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginTaskOutcome = {
    id: string;
    status: "succeeded";
    result: unknown;
} | {
    id: string;
    status: "failed" | "cancelled" | "interrupted";
    error: PluginTaskError;
};
```

**Tipos relacionados:** [PluginTaskError](plugin-workers.md#plugintaskerror).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#plugintaskoutcome-id) — 2 firmas o variantes
- [status](#plugintaskoutcome-status) — 2 firmas o variantes
- [result](#plugintaskoutcome-result)
- [error](#plugintaskoutcome-error)

### PluginTaskOutcome id

```ts
id: string;
```

```ts
id: string;
```

### PluginTaskOutcome status

```ts
status: "succeeded";
```

```ts
status: "failed" | "cancelled" | "interrupted";
```

### PluginTaskOutcome result

```ts
result: unknown;
```

### PluginTaskOutcome error

```ts
error: PluginTaskError;
```

## PluginTaskRecord

Tipo público del SDK, exportado como `PluginTaskRecord`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTaskRecord extends PluginWorkerStartOptions {
    version: 1;
    id: string;
    definitionId: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    status: PluginTaskStatus;
    messages: AgentMessage[];
    turns: number;
    activity?: string;
    usage?: JobUsage;
    result?: unknown;
    error?: PluginTaskError;
}
```

**Tipos relacionados:** [JobUsage](contracts-jobs.md#jobusage), [PluginTaskError](plugin-workers.md#plugintaskerror), [PluginTaskStatus](plugin-workers.md#plugintaskstatus), [PluginWorkerStartOptions](plugin-workers.md#pluginworkerstartoptions).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [version](#plugintaskrecord-version)
- [id](#plugintaskrecord-id)
- [definitionId](#plugintaskrecord-definitionid)
- [createdAt](#plugintaskrecord-createdat)
- [updatedAt](#plugintaskrecord-updatedat)
- [completedAt](#plugintaskrecord-completedat)
- [status](#plugintaskrecord-status)
- [messages](#plugintaskrecord-messages)
- [turns](#plugintaskrecord-turns)
- [activity](#plugintaskrecord-activity)
- [usage](#plugintaskrecord-usage)
- [result](#plugintaskrecord-result)
- [error](#plugintaskrecord-error)

### PluginTaskRecord version

```ts
version: 1;
```

### PluginTaskRecord id

```ts
id: string;
```

### PluginTaskRecord definitionId

```ts
definitionId: string;
```

### PluginTaskRecord createdAt

```ts
createdAt: string;
```

### PluginTaskRecord updatedAt

```ts
updatedAt: string;
```

### PluginTaskRecord completedAt

```ts
completedAt?: string;
```

### PluginTaskRecord status

```ts
status: PluginTaskStatus;
```

### PluginTaskRecord messages

```ts
messages: AgentMessage[];
```

### PluginTaskRecord turns

```ts
turns: number;
```

### PluginTaskRecord activity

```ts
activity?: string;
```

### PluginTaskRecord usage

```ts
usage?: JobUsage;
```

### PluginTaskRecord result

Solo es autoritativo cuando status es succeeded; los valores JSON falsy son válidos.

```ts
result?: unknown;
```

### PluginTaskRecord error

```ts
error?: PluginTaskError;
```

## PluginTaskSnapshot

Tipo público del SDK, exportado como `PluginTaskSnapshot`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTaskSnapshot extends PluginTaskRecord {
    partial?: AssistantMessage;
}
```

**Tipos relacionados:** [PluginTaskRecord](plugin-workers.md#plugintaskrecord).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [partial](#plugintasksnapshot-partial)

### PluginTaskSnapshot partial

Progreso efímero en streaming, no historial confirmado ni un resultado.

```ts
partial?: AssistantMessage;
```

## PluginTaskStatus

Tipo público del SDK, exportado como `PluginTaskStatus`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
```

## PluginWorkerContext

Tipo público del SDK, exportado como `PluginWorkerContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginWorkerContext {
    readonly taskId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [taskId](#pluginworkercontext-taskid)
- [input](#pluginworkercontext-input)
- [signal](#pluginworkercontext-signal)

### PluginWorkerContext taskId

```ts
readonly taskId: string;
```

### PluginWorkerContext input

Entrada aceptada inmutable, nunca una identidad aportada por el resultado del modelo.

```ts
readonly input: unknown;
```

### PluginWorkerContext signal

Cancelación ligada a la vida de la tarea. Las herramientas deben cooperar y volver a
comprobarla tras cada await antes de producir efectos secundarios; la cancelación no puede
deshacer efectos externos.

```ts
readonly signal: AbortSignal;
```

## PluginWorkerDefinition

Tipo público del SDK, exportado como `PluginWorkerDefinition`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginWorkerDefinition {
    id: string;
    instructions: string;
    resultSchema: TSchema;
    tools?: (context: PluginWorkerContext) => AgentTool<any>[];
    validateResult?: (result: unknown, context: PluginWorkerContext) => void | Promise<void>;
}
```

**Tipos relacionados:** [PluginWorkerContext](plugin-workers.md#pluginworkercontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginworkerdefinition-id)
- [instructions](#pluginworkerdefinition-instructions)
- [resultSchema](#pluginworkerdefinition-resultschema)
- [tools](#pluginworkerdefinition-tools)
- [validateResult](#pluginworkerdefinition-validateresult)

### PluginWorkerDefinition id

```ts
id: string;
```

### PluginWorkerDefinition instructions

```ts
instructions: string;
```

### PluginWorkerDefinition resultSchema

El host expone submit_result({ result: <este esquema> }).

```ts
resultSchema: TSchema;
```

### PluginWorkerDefinition tools

Crea las herramientas nativas para esta tarea aceptada; el envío del resultado es propiedad del host.

```ts
tools?: (context: PluginWorkerContext) => AgentTool<any>[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginWorkerContext` |

**Devuelve:** `AgentTool<any>[]`.

### PluginWorkerDefinition validateResult

Lanza una excepción con una corrección útil. Este validador no debe tener efectos secundarios.

```ts
validateResult?: (result: unknown, context: PluginWorkerContext) => void | Promise<void>;
```

| Parámetro | Tipo |
| --- | --- |
| `result` | `unknown` |
| `context` | `PluginWorkerContext` |

**Devuelve:** `void \| Promise<void>`.

## PluginWorkerService

Tipo público del SDK, exportado como `PluginWorkerService`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Tareas acotadas propiedad del plugin; la ejecución del modelo puede tener coste. La vida de
la tarea es independiente de las vistas y suscripciones. Desactivar o reiniciar interrumpe
las tareas sin terminar; la reactivación no las vuelve a ejecutar.

```ts
export interface PluginWorkerService {
    register(definition: PluginWorkerDefinition): () => void;
    start(definitionId: string, options: PluginWorkerStartOptions): PluginTaskSnapshot;
    list(): PluginTaskSnapshot[];
    get(id: string): PluginTaskSnapshot;
    subscribe(id: string, listener: (snapshot: PluginTaskSnapshot) => void): () => void;
    wait(id: string, signal?: AbortSignal): Promise<PluginTaskOutcome>;
    cancel(id: string): void;
    dispose(): Promise<void>;
}
```

**Tipos relacionados:** [PluginTaskOutcome](plugin-workers.md#plugintaskoutcome), [PluginTaskSnapshot](plugin-workers.md#plugintasksnapshot), [PluginWorkerDefinition](plugin-workers.md#pluginworkerdefinition), [PluginWorkerStartOptions](plugin-workers.md#pluginworkerstartoptions).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [register](#pluginworkerservice-register)
- [start](#pluginworkerservice-start)
- [list](#pluginworkerservice-list)
- [get](#pluginworkerservice-get)
- [subscribe](#pluginworkerservice-subscribe)
- [wait](#pluginworkerservice-wait)
- [cancel](#pluginworkerservice-cancel)
- [dispose](#pluginworkerservice-dispose)

### PluginWorkerService register

Registra instrucciones, esquema del resultado y, opcionalmente, herramientas y un validador
de refinamiento. Las definiciones no válidas o duplicadas lanzan una excepción. Devuelve una
función para anular el registro que interrumpe las tareas sin terminar de esta definición,
conservando sus registros.

```ts
register(definition: PluginWorkerDefinition): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `definition` | `PluginWorkerDefinition` |

**Devuelve:** `() => void`.

### PluginWorkerService start

Persiste una aceptación duradera y devuelve una instantánea en cola, no el final.
La ejecución del modelo y de las herramientas avanza con independencia de las vistas. Un ID
de petición y unas opciones idénticos devuelven la tarea existente; reutilizarlos de forma
conflictiva lanza una excepción. Las entradas no válidas, las definiciones inexistentes y
los fallos de persistencia de la aceptación lanzan una excepción de forma síncrona.

```ts
start(definitionId: string, options: PluginWorkerStartOptions): PluginTaskSnapshot;
```

| Parámetro | Tipo |
| --- | --- |
| `definitionId` | `string` |
| `options` | `PluginWorkerStartOptions` |

**Devuelve:** `PluginTaskSnapshot`.

### PluginWorkerService list

Devuelve instantáneas independientes de las tareas propias, incluido el progreso efímero;
listar no inicia ni reanuda trabajo.

```ts
list(): PluginTaskSnapshot[];
```

**Devuelve:** `PluginTaskSnapshot[]`.

### PluginWorkerService get

Devuelve una instantánea independiente de la tarea. Los IDs desconocidos lanzan una
excepción; solo el estado succeeded hace autoritativo el resultado, incluidos los resultados
JSON falsy.

```ts
get(id: string): PluginTaskSnapshot;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `PluginTaskSnapshot`.

### PluginWorkerService subscribe

Entrega una instantánea de forma síncrona y, después, los cambios en vivo de estado y
progreso. Devuelve una función para cancelar la suscripción, no un mecanismo para cancelar
la tarea. Los IDs desconocidos lanzan una excepción; si el listener lanza una excepción en
la entrega inicial, se elimina la suscripción.

```ts
subscribe(id: string, listener: (snapshot: PluginTaskSnapshot) => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `listener` | `(snapshot: PluginTaskSnapshot) => void` |

**Devuelve:** `() => void`.

### PluginWorkerService wait

Resuelve el resultado terminal, incluidos los estados failed/cancelled/interrupted; que la
tarea falle no hace que la espera se rechace. Una señal abortada rechaza con AbortError y
detiene solo esta espera, no la tarea. Los fallos de almacenamiento pueden producir un
rechazo, y un ID de tarea desconocido lanza una excepción antes de esperar.

```ts
wait(id: string, signal?: AbortSignal): Promise<PluginTaskOutcome>;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |
| `signal?` | `AbortSignal` |

**Devuelve:** `Promise<PluginTaskOutcome>`.

### PluginWorkerService cancel

Persiste el estado cancelled para el trabajo sin terminar y señala la cancelación
cooperativa. Las tareas terminadas no cambian; los efectos externos no pueden deshacerse.
Los IDs desconocidos y los fallos de persistencia lanzan una excepción.

```ts
cancel(id: string): void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `void`.

### PluginWorkerService dispose

Interrumpe las tareas sin terminar, borra definiciones y listeners y cancela los ámbitos de
las tareas, conservando el historial y los resultados; nunca vuelve a ejecutarlas al
reactivar. Es idempotente y no espera a las herramientas que no cooperen. Los fallos de
persistencia producen un rechazo. Desactivar el plugin en el host también libera este
servicio.

```ts
dispose(): Promise<void>;
```

**Devuelve:** `Promise<void>`.

## PluginWorkerStartOptions

Tipo público del SDK, exportado como `PluginWorkerStartOptions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginWorkerStartOptions {
    requestId: string;
    input: unknown;
    prompt: string;
    model: PluginModelSpec;
    purpose: PluginCallPurpose;
    maxTurns: number;
    options?: PluginInferenceOptions;
    timeoutMs?: number;
}
```

**Tipos relacionados:** [PluginCallPurpose](plugin-agents.md#plugincallpurpose), [PluginInferenceOptions](plugins.md#plugininferenceoptions), [PluginModelSpec](plugin-agents.md#pluginmodelspec).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [requestId](#pluginworkerstartoptions-requestid)
- [input](#pluginworkerstartoptions-input)
- [prompt](#pluginworkerstartoptions-prompt)
- [model](#pluginworkerstartoptions-model)
- [purpose](#pluginworkerstartoptions-purpose)
- [maxTurns](#pluginworkerstartoptions-maxturns)
- [options](#pluginworkerstartoptions-options)
- [timeoutMs](#pluginworkerstartoptions-timeoutms)

### PluginWorkerStartOptions requestId

Los reintentos de la misma aceptación usan el mismo id; un intento nuevo usa un id nuevo.

```ts
requestId: string;
```

### PluginWorkerStartOptions input

```ts
input: unknown;
```

### PluginWorkerStartOptions prompt

```ts
prompt: string;
```

### PluginWorkerStartOptions model

```ts
model: PluginModelSpec;
```

### PluginWorkerStartOptions purpose

```ts
purpose: PluginCallPurpose;
```

### PluginWorkerStartOptions maxTurns

Número máximo de turnos del modelo, incluidos los de corrección. Sin valor por defecto implícito.

```ts
maxTurns: number;
```

### PluginWorkerStartOptions options

```ts
options?: PluginInferenceOptions;
```

### PluginWorkerStartOptions timeoutMs

Duración en tiempo real desde la aceptación, incluidas las esperas de admisión.

```ts
timeoutMs?: number;
```
