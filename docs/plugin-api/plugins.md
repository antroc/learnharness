# plugins

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Autoría y ciclo de vida](../plugin-authoring.md)

- [PluginAction](#pluginaction)
- [PluginActionContext](#pluginactioncontext)
- [PluginActionPlacement](#pluginactionplacement)
- [PluginAgentKind](#pluginagentkind)
- [PluginBackendContext](#pluginbackendcontext)
- [PluginBackendModule](#pluginbackendmodule)
- [PluginCleanup](#plugincleanup)
- [PluginCodeBlockProps](#plugincodeblockprops)
- [PluginCodeBlockRenderer](#plugincodeblockrenderer)
- [PluginFrontendContext](#pluginfrontendcontext)
- [PluginFrontendModule](#pluginfrontendmodule)
- [PluginGraphFileData](#plugingraphfiledata)
- [PluginInference](#plugininference)
- [PluginInferenceOptions](#plugininferenceoptions)
- [PluginInferenceRequest](#plugininferencerequest)
- [PluginInfo](#plugininfo)
- [PluginInstructions](#plugininstructions)
- [PluginLearningData](#pluginlearningdata)
- [PluginManifest](#pluginmanifest)
- [PluginNotification](#pluginnotification)
- [PluginPageActionContext](#pluginpageactioncontext)
- [PluginSettingsRegistration](#pluginsettingsregistration)
- [PluginToolContext](#plugintoolcontext)
- [PluginToolRenderer](#plugintoolrenderer)
- [PluginToolRenderProps](#plugintoolrenderprops)
- [PluginTools](#plugintools)
- [PluginView](#pluginview)

## PluginAction

Tipo público del SDK, exportado como `PluginAction`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginAction {
    id: string;
    name: string;
    icon?: string;
    readonly shortcut?: import("./plugin-shortcuts.ts").PluginActionShortcut;
    disabled?: boolean | ((context: PluginActionContext) => boolean);
    run(context: PluginActionContext): void | Promise<void>;
}
```

**Tipos relacionados:** [PluginActionContext](plugins.md#pluginactioncontext), [PluginActionShortcut](plugin-shortcuts.md#pluginactionshortcut).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginaction-id)
- [name](#pluginaction-name)
- [icon](#pluginaction-icon)
- [shortcut](#pluginaction-shortcut)
- [disabled](#pluginaction-disabled)
- [run](#pluginaction-run)

### PluginAction id

```ts
id: string;
```

### PluginAction name

```ts
name: string;
```

### PluginAction icon

Marcado SVG de confianza del plugin. El host sigue representando el botón que lo rodea.

```ts
icon?: string;
```

### PluginAction shortcut

Activación voluntaria sin crear elementos de interfaz. El ámbito y el valor por
defecto se capturan al registrar.

```ts
readonly shortcut?: import("./plugin-shortcuts.ts").PluginActionShortcut;
```

### PluginAction disabled

```ts
disabled?: boolean | ((context: PluginActionContext) => boolean);
```

### PluginAction run

Se ejecuta para la colocación y la página de la invocación real. El host impide
invocarla de nuevo mientras está ocupada e informa de los errores lanzados o
rechazados. Los datos de la vista de la sesión se capturan una vez antes de la
invocación y siguen siendo independientes a través de los await.

```ts
run(context: PluginActionContext): void | Promise<void>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginActionContext` |

**Devuelve:** `void \| Promise<void>`.

## PluginActionContext

Tipo público del SDK, exportado como `PluginActionContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginActionContext = ({
    placement: "top-bar";
} & Exclude<PluginPageActionContext, {
    surface: "app";
}>) | ({
    placement: "keyboard";
} & PluginPageActionContext) | {
    placement: "sidebar";
    surface: "sidebar";
} | {
    placement: "graph";
    surface: "graph";
};
```

**Tipos relacionados:** [PluginPageActionContext](plugins.md#pluginpageactioncontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [placement](#pluginactioncontext-placement) — 4 firmas o variantes
- [surface](#pluginactioncontext-surface) — 2 firmas o variantes

### PluginActionContext placement

```ts
placement: "top-bar";
```

```ts
placement: "keyboard";
```

```ts
placement: "sidebar";
```

```ts
placement: "graph";
```

### PluginActionContext surface

```ts
surface: "sidebar";
```

```ts
surface: "graph";
```

## PluginActionPlacement

Tipo público del SDK, exportado como `PluginActionPlacement`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Registrar por sí solo nunca crea elementos de interfaz. Cada colocación es explícita.

```ts
export type PluginActionPlacement = {
    id: string;
    actionId: string;
    location: "sidebar" | "graph";
} | {
    id: string;
    actionId: string;
    location: "top-bar";
    sessions?: ("teaching" | "practice")[];
    views?: string[];
};
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginactionplacement-id) — 2 firmas o variantes
- [actionId](#pluginactionplacement-actionid) — 2 firmas o variantes
- [location](#pluginactionplacement-location) — 2 firmas o variantes
- [sessions](#pluginactionplacement-sessions)
- [views](#pluginactionplacement-views)

### PluginActionPlacement id

```ts
id: string;
```

```ts
id: string;
```

### PluginActionPlacement actionId

```ts
actionId: string;
```

```ts
actionId: string;
```

### PluginActionPlacement location

```ts
location: "sidebar" | "graph";
```

```ts
location: "top-bar";
```

### PluginActionPlacement sessions

```ts
sessions?: ("teaching" | "practice")[];
```

### PluginActionPlacement views

```ts
views?: string[];
```

## PluginAgentKind

Tipo público del SDK, exportado como `PluginAgentKind`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginAgentKind = "prober" | "teacher" | "practice";
```

## PluginBackendContext

Tipo público del SDK, exportado como `PluginBackendContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Ámbito de activación del backend, una vez por plugin activado y por servidor, no por
ventana. El código Node de confianza debe cooperar con la cancelación; no hay aislamiento
forzoso de procesos.

```ts
export interface PluginBackendContext {
    readonly manifest: PluginManifest;
    readonly directory: string;
    readonly dataDirectory: string;
    readonly signal: AbortSignal;
    cleanup(dispose: PluginCleanup): void;
    learning: PluginLearningData;
    inference: PluginInference;
    agents: PluginAgentService;
    workers: PluginWorkerService;
    createBackgroundTool<T extends TSchema>(context: PluginToolContext, definition: PluginBackgroundTool<T>): AgentTool<T>;
    registerInstructions(contribution: PluginInstructions): () => void;
    registerTools(contribution: PluginTools): () => void;
    registerQuestionType<Q extends TSchema, A extends TSchema>(definition: PluginQuestionTypeDefinition<Q, A>): () => void;
    registerProblemType<Q extends TSchema, S extends TSchema>(definition: PluginProblemTypeDefinition<Q, S>): () => void;
    handle(name: string, handler: (input: unknown) => unknown | Promise<unknown>): () => void;
    events: {
        on(listener: (event: ServerEvent) => void): () => void;
        emit(topic: string, data?: unknown): void;
    };
}
```

**Tipos relacionados:** [PluginAgentService](plugin-agents.md#pluginagentservice), [PluginBackgroundTool](plugin-workers.md#pluginbackgroundtool), [PluginCleanup](plugins.md#plugincleanup), [PluginInference](plugins.md#plugininference), [PluginInstructions](plugins.md#plugininstructions), [PluginLearningData](plugins.md#pluginlearningdata), [PluginManifest](plugins.md#pluginmanifest), [PluginProblemTypeDefinition](plugin-problems.md#pluginproblemtypedefinition), [PluginQuestionTypeDefinition](plugin-questions.md#pluginquestiontypedefinition), [PluginToolContext](plugins.md#plugintoolcontext), [PluginTools](plugins.md#plugintools), [PluginWorkerService](plugin-workers.md#pluginworkerservice), [ServerEvent](events.md#serverevent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [manifest](#pluginbackendcontext-manifest)
- [directory](#pluginbackendcontext-directory)
- [dataDirectory](#pluginbackendcontext-datadirectory)
- [signal](#pluginbackendcontext-signal)
- [cleanup](#pluginbackendcontext-cleanup)
- [learning](#pluginbackendcontext-learning)
- [inference](#pluginbackendcontext-inference)
- [agents](#pluginbackendcontext-agents)
- [workers](#pluginbackendcontext-workers)
- [createBackgroundTool](#pluginbackendcontext-createbackgroundtool)
- [registerInstructions](#pluginbackendcontext-registerinstructions)
- [registerTools](#pluginbackendcontext-registertools)
- [registerQuestionType](#pluginbackendcontext-registerquestiontype)
- [registerProblemType](#pluginbackendcontext-registerproblemtype)
- [handle](#pluginbackendcontext-handle)
- [events](#pluginbackendcontext-events)
- [events.on](#pluginbackendcontext-eventson)
- [events.emit](#pluginbackendcontext-eventsemit)

### PluginBackendContext manifest

```ts
readonly manifest: PluginManifest;
```

### PluginBackendContext directory

Directorio absoluto del código: core-plugins/<id> de la app o plugins/<id>/dist de la
comunidad.

```ts
readonly directory: string;
```

### PluginBackendContext dataDirectory

Registros escribibles: core-plugin-data/<id> o plugins/<id>/data de la comunidad.

```ts
readonly dataDirectory: string;
```

### PluginBackendContext signal

Se cancela cuando termina esta activación del backend. Vuelve a comprobarlo tras cada
await antes de producir efectos secundarios propios del plugin; la cancelación no
detiene a la fuerza código arbitrario.

```ts
readonly signal: AbortSignal;
```

### PluginBackendContext cleanup

Registra la limpieza de recursos para la desactivación; también se admite como valor
de retorno de activate. Una limpieza registrada tras la caducidad se invoca
igualmente.

```ts
cleanup(dispose: PluginCleanup): void;
```

| Parámetro | Tipo |
| --- | --- |
| `dispose` | `PluginCleanup` |

**Devuelve:** `void`.

### PluginBackendContext learning

Registros nativos de aprendizaje de solo lectura; no es una API programable de
escritura de datos del núcleo.

```ts
learning: PluginLearningData;
```

### PluginBackendContext inference

Peticiones en bruto al modelo autenticadas por el host, con ámbito en la activación;
pueden tener coste.

```ts
inference: PluginInference;
```

### PluginBackendContext agents

Conversaciones persistentes de plugins, no sesiones nativas de data/chats.

```ts
agents: PluginAgentService;
```

### PluginBackendContext workers

Tareas acotadas duraderas, independientes de las vistas del frontend; pueden tener
coste de modelo.

```ts
workers: PluginWorkerService;
```

### PluginBackendContext createBackgroundTool

Devuelve una herramienta nativa de Pi vinculada a este turno de conversación.
Confirma de inmediato la aceptación del worker y entrega el resultado terminal más
tarde mediante la gestión nativa de tareas y reorientaciones. La identidad derivada
por el host fuerza el propósito background; el resultado de la tarea y su formateo o
entrega posteriores son cosas separadas.

```ts
createBackgroundTool<T extends TSchema>(context: PluginToolContext, definition: PluginBackgroundTool<T>): AgentTool<T>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginToolContext` |
| `definition` | `PluginBackgroundTool<T>` |

**Devuelve:** `AgentTool<T>`.

### PluginBackendContext registerInstructions

Añade texto al prompt de sistema para los tipos de agente nativo seleccionados, sin
sustituir los prompts del host. Las contribuciones no válidas lanzan una excepción;
anular el registro solo afecta a los turnos futuros.

```ts
registerInstructions(contribution: PluginInstructions): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `contribution` | `PluginInstructions` |

**Devuelve:** `() => void`.

### PluginBackendContext registerTools

Añade factorías de herramientas nuevas para los tipos de agente nativo seleccionados,
conservando las integradas. Un registro no válido lanza una excepción; los errores de
factoría o de colisión de cada turno omiten la contribución de este plugin. La
función de anulación devuelta afecta a los turnos futuros.

```ts
registerTools(contribution: PluginTools): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `contribution` | `PluginTools` |

**Devuelve:** `() => void`.

### PluginBackendContext registerQuestionType

Registra un tipo en el ciclo de vida nativo de sondeo y enseñanza propiedad del host,
con validación y calificación opcionales por parte del plugin. Las definiciones no
válidas o duplicadas lanzan una excepción; la función de anulación devuelta elimina
la disponibilidad y cancela el ámbito de esta definición.

```ts
registerQuestionType<Q extends TSchema, A extends TSchema>(definition: PluginQuestionTypeDefinition<Q, A>): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `definition` | `PluginQuestionTypeDefinition<Q, A>` |

**Devuelve:** `() => void`.

### PluginBackendContext registerProblemType

Registra planteamientos de práctica alternativos que comparten el ciclo de vida
nativo de problema activo y conclusión. Las definiciones no válidas o duplicadas
lanzan una excepción; la función de anulación devuelta elimina la disponibilidad y
cancela el ámbito de esta definición, no el historial guardado.

```ts
registerProblemType<Q extends TSchema, S extends TSchema>(definition: PluginProblemTypeDefinition<Q, S>): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `definition` | `PluginProblemTypeDefinition<Q, S>` |

**Devuelve:** `() => void`.

### PluginBackendContext handle

Registra una operación con nombre para el puente de llamadas del frontend de este
plugin. Las entradas y los resultados deben ser compatibles con JSON; valida la
entrada en el manejador. Los nombres no válidos o duplicados lanzan una excepción.
Devuelve la función de anulación; no es una API HTTP arbitraria.

```ts
handle(name: string, handler: (input: unknown) => unknown | Promise<unknown>): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `name` | `string` |
| `handler` | `(input: unknown) => unknown \| Promise<unknown>` |

**Devuelve:** `() => void`.

### PluginBackendContext events

Avisos en vivo de la app y notificaciones de ámbito de plugin, no un registro
duradero de eventos.

```ts
events: {
    on(listener: (event: ServerEvent) => void): () => void;
    emit(topic: string, data?: unknown): void;
};
```

### PluginBackendContext events.on

Observa los eventos admitidos de la app hasta cancelar la suscripción o hasta la
limpieza de la activación. Los fallos de los listeners quedan aislados. Vuelve a
leer el estado cuando haga falta; turn-settled sigue a la persistencia del turno,
no al final de la extracción asíncrona.

```ts
on(listener: (event: ServerEvent) => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `listener` | `(event: ServerEvent) => void` |

**Devuelve:** `() => void`.

### PluginBackendContext events.emit

Notifica con datos JSON a los listeners del frontend de este plugin en las
ventanas conectadas. Los temas no válidos lanzan una excepción mientras está
activo; las activaciones caducadas no emiten nada. No se ofrece persistencia,
reproducción ni acuse de la gestión en el frontend.

```ts
emit(topic: string, data?: unknown): void;
```

| Parámetro | Tipo |
| --- | --- |
| `topic` | `string` |
| `data?` | `unknown` |

**Devuelve:** `void`.

## PluginBackendModule

Tipo público del SDK, exportado como `PluginBackendModule`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginBackendModule {
    activate(context: PluginBackendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [PluginBackendContext](plugins.md#pluginbackendcontext), [PluginCleanup](plugins.md#plugincleanup).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [activate](#pluginbackendmodule-activate)

### PluginBackendModule activate

Inicializa los registros y recursos de ámbito de servidor; opcionalmente devuelve una
limpieza. Los fallos de activación marcan este plugin como erróneo. Los módulos
siguen en caché, así que pon aquí los efectos secundarios de la activación y no en el
nivel superior del módulo.

```ts
activate(context: PluginBackendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginBackendContext` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginCleanup

Tipo público del SDK, exportado como `PluginCleanup`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Libera los recursos de activación o montaje; el host acepta limpieza síncrona o asíncrona.

```ts
export type PluginCleanup = () => void | Promise<void>;
```

## PluginCodeBlockProps

Tipo público del SDK, exportado como `PluginCodeBlockProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginCodeBlockProps {
    language: string;
    source: string;
    meta: string;
    incomplete: boolean;
    signal: AbortSignal;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [language](#plugincodeblockprops-language)
- [source](#plugincodeblockprops-source)
- [meta](#plugincodeblockprops-meta)
- [incomplete](#plugincodeblockprops-incomplete)
- [signal](#plugincodeblockprops-signal)

### PluginCodeBlockProps language

```ts
language: string;
```

### PluginCodeBlockProps source

```ts
source: string;
```

### PluginCodeBlockProps meta

```ts
meta: string;
```

### PluginCodeBlockProps incomplete

```ts
incomplete: boolean;
```

### PluginCodeBlockProps signal

Se cancela al sustituir, desmontar o desactivar el plugin.

```ts
signal: AbortSignal;
```

## PluginCodeBlockRenderer

Tipo público del SDK, exportado como `PluginCodeBlockRenderer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginCodeBlockRenderer {
    language: string;
    mount(container: HTMLElement, block: PluginCodeBlockProps): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [PluginCleanup](plugins.md#plugincleanup), [PluginCodeBlockProps](plugins.md#plugincodeblockprops).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [language](#plugincodeblockrenderer-language)
- [mount](#plugincodeblockrenderer-mount)

### PluginCodeBlockRenderer language

```ts
language: string;
```

### PluginCodeBlockRenderer mount

Representa este bloque cercado en el contenedor indicado; devuelve una limpieza
síncrona o asíncrona. Sustituir, anular el registro o desactivar cancela
block.signal. Los renderizadores que fallan o faltan recurren al código fuente
legible; mountMarkdown, que es solo del host, no usa este hook.

```ts
mount(container: HTMLElement, block: PluginCodeBlockProps): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `block` | `PluginCodeBlockProps` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginFrontendContext

Tipo público del SDK, exportado como `PluginFrontendContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Ámbito de activación del frontend, una vez por plugin activado y por ventana. Los
registros, las suscripciones y la interfaz caducan con esta activación; el trabajo del
backend es propiedad del servidor.

```ts
export interface PluginFrontendContext {
    readonly manifest: PluginManifest;
    readonly signal: AbortSignal;
    cleanup(dispose: PluginCleanup): void;
    registerView(view: PluginView): () => void;
    registerAction(action: PluginAction): () => void;
    placeAction(placement: PluginActionPlacement): () => void;
    refreshActions(): void;
    registerSubmissionInterceptor(definition: PluginSubmissionInterceptor): () => void;
    refreshSubmissions(): void;
    registerSettings(mount: PluginView["mount"]): () => void;
    registerSettings(schema: import("./plugin-ui.ts").PluginSettingsSchema): import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
    registerSettings(settings: PluginSettingsRegistration): (() => void) | import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
    readonly ui: import("./plugin-ui.ts").PluginUi;
    registerCodeBlock(renderer: PluginCodeBlockRenderer): () => void;
    registerToolRenderer(renderer: PluginToolRenderer): () => void;
    registerQuestionRenderer(renderer: PluginQuestionRenderer): () => void;
    registerProblemRenderer(renderer: PluginProblemRenderer): () => void;
    call<T = unknown>(operation: string, input?: unknown): Promise<T>;
    readonly documents: {
        toMarkdown(file: File, options?: {
            signal?: AbortSignal;
        }): Promise<{
            name: string;
            markdown: string;
            notices: string[];
        }>;
    };
    onNotification(listener: (event: PluginNotification) => void): () => void;
    onAppEvent(listener: (event: ServerEvent) => void): () => void;
    onResync(listener: () => void): () => void;
    app: {
        pathname(): string;
        openSession(id: string): void;
        openHome(): void;
        openView(id: string): void;
        openSettings(): void;
    };
}
```

**Tipos relacionados:** [PluginAction](plugins.md#pluginaction), [PluginActionPlacement](plugins.md#pluginactionplacement), [PluginCleanup](plugins.md#plugincleanup), [PluginCodeBlockRenderer](plugins.md#plugincodeblockrenderer), [PluginManifest](plugins.md#pluginmanifest), [PluginNotification](plugins.md#pluginnotification), [PluginProblemRenderer](plugin-problems.md#pluginproblemrenderer), [PluginQuestionRenderer](plugin-questions.md#pluginquestionrenderer), [PluginSettingsRegistration](plugins.md#pluginsettingsregistration), [PluginSettingsSchema](plugin-ui.md#pluginsettingsschema), [PluginSubmissionInterceptor](plugin-submissions.md#pluginsubmissioninterceptor), [PluginToolRenderer](plugins.md#plugintoolrenderer), [PluginUi](plugin-ui.md#pluginui), [PluginView](plugins.md#pluginview), [PluginWidgetHandle](plugin-ui.md#pluginwidgethandle), [ServerEvent](events.md#serverevent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [manifest](#pluginfrontendcontext-manifest)
- [signal](#pluginfrontendcontext-signal)
- [cleanup](#pluginfrontendcontext-cleanup)
- [registerView](#pluginfrontendcontext-registerview)
- [registerAction](#pluginfrontendcontext-registeraction)
- [placeAction](#pluginfrontendcontext-placeaction)
- [refreshActions](#pluginfrontendcontext-refreshactions)
- [registerSubmissionInterceptor](#pluginfrontendcontext-registersubmissioninterceptor)
- [refreshSubmissions](#pluginfrontendcontext-refreshsubmissions)
- [registerSettings](#pluginfrontendcontext-registersettings) — 3 firmas o variantes
- [ui](#pluginfrontendcontext-ui)
- [registerCodeBlock](#pluginfrontendcontext-registercodeblock)
- [registerToolRenderer](#pluginfrontendcontext-registertoolrenderer)
- [registerQuestionRenderer](#pluginfrontendcontext-registerquestionrenderer)
- [registerProblemRenderer](#pluginfrontendcontext-registerproblemrenderer)
- [call](#pluginfrontendcontext-call)
- [documents](#pluginfrontendcontext-documents)
- [documents.toMarkdown](#pluginfrontendcontext-documentstomarkdown)
- [onNotification](#pluginfrontendcontext-onnotification)
- [onAppEvent](#pluginfrontendcontext-onappevent)
- [onResync](#pluginfrontendcontext-onresync)
- [app](#pluginfrontendcontext-app)
- [app.pathname](#pluginfrontendcontext-apppathname)
- [app.openSession](#pluginfrontendcontext-appopensession)
- [app.openHome](#pluginfrontendcontext-appopenhome)
- [app.openView](#pluginfrontendcontext-appopenview)
- [app.openSettings](#pluginfrontendcontext-appopensettings)

### PluginFrontendContext manifest

```ts
readonly manifest: PluginManifest;
```

### PluginFrontendContext signal

Se cancela cuando termina la activación de esta ventana. Usa señales más cortas por
montaje para los widgets de las vistas y el trabajo asíncrono cooperativo.

```ts
readonly signal: AbortSignal;
```

### PluginFrontendContext cleanup

Registra la limpieza síncrona o asíncrona de recursos para la desactivación; los
registros tardíos se invocan igualmente. Una activación también puede devolver una
función de limpieza.

```ts
cleanup(dispose: PluginCleanup): void;
```

| Parámetro | Tipo |
| --- | --- |
| `dispose` | `PluginCleanup` |

**Devuelve:** `void`.

### PluginFrontendContext registerView

Registra una vista de cuerpo propiedad del plugin con el marco de la interfaz del
host. Los IDs no válidos o duplicados lanzan una excepción; la función de anulación
devuelta elimina la vista sin borrar los datos del plugin.

```ts
registerView(view: PluginView): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `view` | `PluginView` |

**Devuelve:** `() => void`.

### PluginFrontendContext registerAction

Registra una acción invocable y un atajo opcional, pero sin colocar ningún botón. Los
registros no válidos o duplicados lanzan una excepción. Devuelve la función de
anulación; el ámbito y el valor por defecto del atajo se capturan aquí y
refreshActions no los cambia.

```ts
registerAction(action: PluginAction): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `action` | `PluginAction` |

**Devuelve:** `() => void`.

### PluginFrontendContext placeAction

Coloca una acción ya registrada en un elemento explícito de la interfaz del host. Los
destinos no válidos o los IDs de colocación duplicados lanzan una excepción. Devuelve
una función de anulación solo para esta colocación.

```ts
placeAction(placement: PluginActionPlacement): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `placement` | `PluginActionPlacement` |

**Devuelve:** `() => void`.

### PluginFrontendContext refreshActions

Notifica explícitamente al host cuando cambia el estado dinámico de activación de una
acción.

```ts
refreshActions(): void;
```

**Devuelve:** `void`.

### PluginFrontendContext registerSubmissionInterceptor

Registra la preparación de la entrada del alumno con la identidad de este plugin. Las
definiciones no válidas o duplicadas lanzan una excepción; la función de anulación
devuelta cancela su ámbito capturado. Las reglas de aceptación, reintento y
conservación de borradores siguen siendo propiedad del host.

```ts
registerSubmissionInterceptor(definition: PluginSubmissionInterceptor): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `definition` | `PluginSubmissionInterceptor` |

**Devuelve:** `() => void`.

### PluginFrontendContext refreshSubmissions

Notifica al host cuando cambia la entrada de envío pendiente propiedad del plugin.

```ts
refreshSubmissions(): void;
```

**Devuelve:** `void`.

### PluginFrontendContext registerSettings

Registra un montaje diferido del cuerpo de ajustes; devuelve la función de anulación.
Solo se permite un registro de ajustes por activación. La señal de montaje acota su
interfaz hija.

```ts
registerSettings(mount: PluginView["mount"]): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `mount` | `PluginView["mount"]` |

**Devuelve:** `() => void`.

Registra filas de ajustes controladas; devuelve un manejador de actualización
superficial y liberación. Los esquemas no válidos o los registros de ajustes
duplicados lanzan una excepción. El plugin es propietario de la persistencia y debe
publicar los valores aceptados tras guardarlos.

```ts
registerSettings(schema: import("./plugin-ui.ts").PluginSettingsSchema): import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
```

| Parámetro | Tipo |
| --- | --- |
| `schema` | `import("./plugin-ui.ts").PluginSettingsSchema` |

**Devuelve:** `import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>`.

Registra o bien un montaje personalizado diferido (función de anulación) o bien un
esquema controlado (manejador de widget); ninguna de las dos formas carga ni guarda
los ajustes del plugin automáticamente.

```ts
registerSettings(settings: PluginSettingsRegistration): (() => void) | import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>;
```

| Parámetro | Tipo |
| --- | --- |
| `settings` | `PluginSettingsRegistration` |

**Devuelve:** `(() => void) \| import("./plugin-ui.ts").PluginWidgetHandle<import("./plugin-ui.ts").PluginSettingsSchema>`.

### PluginFrontendContext ui

Widgets y overlays controlados del host; acceder a un host de interfaz no disponible
lanza una excepción.

```ts
readonly ui: import("./plugin-ui.ts").PluginUi;
```

### PluginFrontendContext registerCodeBlock

Registra un renderizador para un lenguaje de bloque cercado; las reclamaciones
reservadas o duplicadas lanzan una excepción. Devuelve la función de anulación, que
cancela los montajes existentes del renderizador además de eliminar el hook.

```ts
registerCodeBlock(renderer: PluginCodeBlockRenderer): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `renderer` | `PluginCodeBlockRenderer` |

**Devuelve:** `() => void`.

### PluginFrontendContext registerToolRenderer

Registra la presentación nativa de resultados de herramientas; las reclamaciones
reservadas o duplicadas lanzan una excepción. Devuelve la función de anulación, que
cancela los montajes existentes. No registra ninguna herramienta.

```ts
registerToolRenderer(renderer: PluginToolRenderer): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `renderer` | `PluginToolRenderer` |

**Devuelve:** `() => void`.

### PluginFrontendContext registerQuestionRenderer

Registra huecos con ámbito de propietario dentro de la tarjeta de pregunta del host.
Las versiones del contrato deben coincidir con las de las preguntas guardadas y en
vivo; los registros no válidos o duplicados lanzan una excepción. Devuelve la función
de anulación; la identidad y la aceptación de preguntas del host siguen siendo
autoritativas.

```ts
registerQuestionRenderer(renderer: PluginQuestionRenderer): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `renderer` | `PluginQuestionRenderer` |

**Devuelve:** `() => void`.

### PluginFrontendContext registerProblemRenderer

Registra la presentación de envíos de práctica con ámbito de propietario para las
versiones de contrato admitidas. Los registros no válidos o duplicados lanzan una
excepción. Devuelve la función de anulación; representar un problema no lo plantea,
procesa ni concluye.

```ts
registerProblemRenderer(renderer: PluginProblemRenderer): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `renderer` | `PluginProblemRenderer` |

**Devuelve:** `() => void`.

### PluginFrontendContext call

Invoca la operación de backend con nombre de este plugin con una entrada compatible
con JSON y resuelve su resultado. Se rechaza si fallan la serialización, el
transporte, el backend o la activación. T es una anotación del llamador, no una
validación en tiempo de ejecución; no se expone ninguna señal del llamador ni acceso
HTTP arbitrario. Desactivar el plugin acota la petición del frontend.

```ts
call<T = unknown>(operation: string, input?: unknown): Promise<T>;
```

| Parámetro | Tipo |
| --- | --- |
| `operation` | `string` |
| `input?` | `unknown` |

**Devuelve:** `Promise<T>`.

### PluginFrontendContext documents

Conversión pura en memoria de PDF/UTF-8; sin efectos secundarios de aprendizaje,
modelo ni almacenamiento. Tiene ámbito automático en la activación; la cancelación
por el llamador es opcional y cooperativa.

```ts
readonly documents: {
    toMarkdown(file: File, options?: {
        signal?: AbortSignal;
    }): Promise<{
        name: string;
        markdown: string;
        notices: string[];
    }>;
};
```

### PluginFrontendContext documents.toMarkdown

Convierte un File del navegador a Markdown más avisos sin guardarlo. La firma o
el sufijo de PDF selecciona la conversión de PDF (sin OCR); si no, UTF-8
estricto. Una entrada ocupada, no válida, vacía o por encima del límite se
rechaza con Error, nunca con un éxito truncado. La cancelación por el llamador
conserva signal.reason mientras la activación está viva; la cancelación es
cooperativa, no un plazo de ejecución estricto.

```ts
toMarkdown(file: File, options?: {
    signal?: AbortSignal;
}): Promise<{
    name: string;
    markdown: string;
    notices: string[];
}>;
```

| Parámetro | Tipo |
| --- | --- |
| `file` | `File` |
| `options?` | `{             signal?: AbortSignal;         }` |

**Devuelve:** `Promise<{             name: string;             markdown: string;             notices: string[];         }>`.

### PluginFrontendContext onNotification

Observa las notificaciones solo en vivo de este plugin; devuelve la función para
cancelar la suscripción y caduca con la activación. Vuelve a leer el estado al
resincronizar; no se implica ninguna reproducción duradera.

```ts
onNotification(listener: (event: PluginNotification) => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `listener` | `(event: PluginNotification) => void` |

**Devuelve:** `() => void`.

### PluginFrontendContext onAppEvent

Observa los eventos en vivo admitidos de la app, excluidas las notificaciones de
mensajes de plugins. Devuelve la función para cancelar la suscripción; la caducidad
de la activación también termina la entrega. Los eventos son avisos, no una
reproducción duradera ni el final de la extracción asíncrona.

```ts
onAppEvent(listener: (event: ServerEvent) => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `listener` | `(event: ServerEvent) => void` |

**Devuelve:** `() => void`.

### PluginFrontendContext onResync

Vuelve a leer el estado autoritativo tras resincronizar la conexión; los eventos
perdidos no se reproducen. Devuelve la función para cancelar la suscripción y caduca
con esta activación.

```ts
onResync(listener: () => void): () => void;
```

| Parámetro | Tipo |
| --- | --- |
| `listener` | `() => void` |

**Devuelve:** `() => void`.

### PluginFrontendContext app

Navegación del host en esta ventana; openView/openSettings apuntan a este plugin. Los
métodos de navegación son inertes tras caducar la activación y no esperan a los
montajes.

```ts
app: {
    pathname(): string;
    openSession(id: string): void;
    openHome(): void;
    openView(id: string): void;
    openSettings(): void;
};
```

### PluginFrontendContext app.pathname

Lee el pathname actual del host, no una instantánea capturada de la página de
invocación.

```ts
pathname(): string;
```

**Devuelve:** `string`.

### PluginFrontendContext app.openSession

Navega a una sesión nativa por ID; no crea ni ejecuta ninguna sesión.

```ts
openSession(id: string): void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `void`.

### PluginFrontendContext app.openHome

Navega a la página de inicio del host.

```ts
openHome(): void;
```

**Devuelve:** `void`.

### PluginFrontendContext app.openView

Navega al ID de vista registrado de este plugin, no a la vista de otro plugin.

```ts
openView(id: string): void;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `void`.

### PluginFrontendContext app.openSettings

Abre la página de Ajustes propia de este plugin, no la gestión de paquetes.

```ts
openSettings(): void;
```

**Devuelve:** `void`.

## PluginFrontendModule

Tipo público del SDK, exportado como `PluginFrontendModule`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginFrontendModule {
    activate(context: PluginFrontendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [PluginCleanup](plugins.md#plugincleanup), [PluginFrontendContext](plugins.md#pluginfrontendcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [activate](#pluginfrontendmodule-activate)

### PluginFrontendModule activate

Inicializa los registros y recursos de ámbito de ventana; opcionalmente devuelve una
limpieza. Una activación que lanza una excepción o se rechaza desmonta esta
generación e informa de un error. El código del módulo sigue en caché; pon aquí los
efectos secundarios, no en el nivel superior del módulo.

```ts
activate(context: PluginFrontendContext): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginFrontendContext` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginGraphFileData

Tipo público del SDK, exportado como `PluginGraphFileData`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginGraphFileData {
    "nodes.jsonl": GraphNode[];
    "chains.jsonl": GraphChain[];
    "sessions.jsonl": SessionCheckpoint[];
    "coverage.jsonl": CoverageEntry[];
    "sources.json": NotesSource[];
    "positions.json": Record<string, Position>;
    "render-settings.json": unknown;
    "format.json": unknown;
}
```

**Tipos relacionados:** [CoverageEntry](contracts-graph.md#coverageentry), [GraphChain](contracts-graph.md#graphchain), [GraphNode](contracts-graph.md#graphnode), [NotesSource](contracts-graph.md#notessource), [Position](contracts-graph.md#position), [SessionCheckpoint](contracts-graph.md#sessioncheckpoint).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- ["nodes.jsonl"](#plugingraphfiledata-nodesjsonl)
- ["chains.jsonl"](#plugingraphfiledata-chainsjsonl)
- ["sessions.jsonl"](#plugingraphfiledata-sessionsjsonl)
- ["coverage.jsonl"](#plugingraphfiledata-coveragejsonl)
- ["sources.json"](#plugingraphfiledata-sourcesjson)
- ["positions.json"](#plugingraphfiledata-positionsjson)
- ["render-settings.json"](#plugingraphfiledata-render-settingsjson)
- ["format.json"](#plugingraphfiledata-formatjson)

### PluginGraphFileData "nodes.jsonl"

```ts
"nodes.jsonl": GraphNode[];
```

### PluginGraphFileData "chains.jsonl"

```ts
"chains.jsonl": GraphChain[];
```

### PluginGraphFileData "sessions.jsonl"

```ts
"sessions.jsonl": SessionCheckpoint[];
```

### PluginGraphFileData "coverage.jsonl"

```ts
"coverage.jsonl": CoverageEntry[];
```

### PluginGraphFileData "sources.json"

```ts
"sources.json": NotesSource[];
```

### PluginGraphFileData "positions.json"

```ts
"positions.json": Record<string, Position>;
```

### PluginGraphFileData "render-settings.json"

Metadatos versionados en bruto en lugar de un segundo esquema específico del plugin.

```ts
"render-settings.json": unknown;
```

### PluginGraphFileData "format.json"

```ts
"format.json": unknown;
```

## PluginInference

Tipo público del SDK, exportado como `PluginInference`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Llamadas al modelo autenticadas por el host, que pueden tener coste. Se aplican un modelo
y un propósito explícitos y la política existente de consentimiento y cuota; no hay
alternativa silenciosa de modelo ni de clave de API. El uso se registra en los datos del
plugin, no en un chat del núcleo. La cancelación de la activación acota las llamadas.

```ts
export interface PluginInference {
    catalog(): Promise<ModelCatalogResponse>;
    stream(request: PluginInferenceRequest): AsyncIterable<AssistantMessageEvent>;
    complete(request: PluginInferenceRequest): Promise<AssistantMessage>;
}
```

**Tipos relacionados:** [ModelCatalogResponse](contracts-models.md#modelcatalogresponse), [PluginInferenceRequest](plugins.md#plugininferencerequest).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [catalog](#plugininference-catalog)
- [stream](#plugininference-stream)
- [complete](#plugininference-complete)

### PluginInference catalog

Devuelve el último catálogo conocido del host, independiente, sin refrescar cuentas
ni elegir un modelo. Se rechaza si no está disponible o si la activación se ha
cancelado.

```ts
catalog(): Promise<ModelCatalogResponse>;
```

**Devuelve:** `Promise<ModelCatalogResponse>`.

### PluginInference stream

Emite en *streaming* los eventos nativos del asistente para una petición, no un bucle
de herramientas gestionado. Los fallos de preparación o validación lanzan una
excepción durante la iteración; los estados de transporte, error o cancelación pueden
llegar como eventos nativos de error terminales. Respeta request.signal e inspecciona
el mensaje terminal en lugar de tomar el texto parcial como un éxito.

```ts
stream(request: PluginInferenceRequest): AsyncIterable<AssistantMessageEvent>;
```

| Parámetro | Tipo |
| --- | --- |
| `request` | `PluginInferenceRequest` |

**Devuelve:** `AsyncIterable<AssistantMessageEvent>`.

### PluginInference complete

Consume una petición y devuelve su mensaje nativo terminal del asistente, incluido un
stopReason de error o aborted. Los fallos de preparación o validación pueden producir
un rechazo; un mensaje resuelto no es necesariamente un éxito. Se aplica la
cancelación del llamador o de la activación.

```ts
complete(request: PluginInferenceRequest): Promise<AssistantMessage>;
```

| Parámetro | Tipo |
| --- | --- |
| `request` | `PluginInferenceRequest` |

**Devuelve:** `Promise<AssistantMessage>`.

## PluginInferenceOptions

Tipo público del SDK, exportado como `PluginInferenceOptions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

El host es propietario de las credenciales y del transporte; los plugins solo configuran
la generación.

```ts
export type PluginInferenceOptions = Pick<SimpleStreamOptions, "temperature" | "maxTokens" | "cacheRetention" | "reasoning" | "thinkingBudgets" | "toolChoice" | "timeoutMs" | "maxRetries" | "maxRetryDelayMs" | "metadata">;
```

## PluginInferenceRequest

Tipo público del SDK, exportado como `PluginInferenceRequest`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginInferenceRequest {
    model: PluginModelSpec;
    context: Context;
    purpose: PluginCallPurpose;
    options?: PluginInferenceOptions;
    signal?: AbortSignal;
}
```

**Tipos relacionados:** [PluginCallPurpose](plugin-agents.md#plugincallpurpose), [PluginInferenceOptions](plugins.md#plugininferenceoptions), [PluginModelSpec](plugin-agents.md#pluginmodelspec).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#plugininferencerequest-model)
- [context](#plugininferencerequest-context)
- [purpose](#plugininferencerequest-purpose)
- [options](#plugininferencerequest-options)
- [signal](#plugininferencerequest-signal)

### PluginInferenceRequest model

```ts
model: PluginModelSpec;
```

### PluginInferenceRequest context

```ts
context: Context;
```

### PluginInferenceRequest purpose

Trabajo iniciado por el usuario frente a trabajo automático o en segundo plano; se
aplica la política de conexión existente.

```ts
purpose: PluginCallPurpose;
```

### PluginInferenceRequest options

```ts
options?: PluginInferenceOptions;
```

### PluginInferenceRequest signal

```ts
signal?: AbortSignal;
```

## PluginInfo

Tipo público del SDK, exportado como `PluginInfo`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginInfo {
    id: string;
    origin: "core" | "community";
    manifest?: PluginManifest;
    enabled: boolean;
    status: "disabled" | "active" | "error";
    error?: string;
    revision: string;
}
```

**Tipos relacionados:** [PluginManifest](plugins.md#pluginmanifest).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#plugininfo-id)
- [origin](#plugininfo-origin)
- [manifest](#plugininfo-manifest)
- [enabled](#plugininfo-enabled)
- [status](#plugininfo-status)
- [error](#plugininfo-error)
- [revision](#plugininfo-revision)

### PluginInfo id

```ts
id: string;
```

### PluginInfo origin

Procedencia del paquete propiedad del host; nunca se lee de un manifiesto de plugin.

```ts
origin: "core" | "community";
```

### PluginInfo manifest

```ts
manifest?: PluginManifest;
```

### PluginInfo enabled

```ts
enabled: boolean;
```

### PluginInfo status

```ts
status: "disabled" | "active" | "error";
```

### PluginInfo error

```ts
error?: string;
```

### PluginInfo revision

Solo cambia tras reiniciar el servidor, no simplemente al activar o desactivar.

```ts
revision: string;
```

## PluginInstructions

Tipo público del SDK, exportado como `PluginInstructions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Las contribuciones a los agentes son aditivas y se aplican a los tipos de agente
seleccionados explícitamente.

```ts
export interface PluginInstructions {
    agents: PluginAgentKind[];
    text: string;
}
```

**Tipos relacionados:** [PluginAgentKind](plugins.md#pluginagentkind).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [agents](#plugininstructions-agents)
- [text](#plugininstructions-text)

### PluginInstructions agents

```ts
agents: PluginAgentKind[];
```

### PluginInstructions text

```ts
text: string;
```

## PluginLearningData

Tipo público del SDK, exportado como `PluginLearningData`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Acceso nuevo de solo lectura a los registros nativos de aprendizaje guardados. Varias
lecturas no forman una transacción entre ficheros; guarda los datos derivados del plugin
en almacenamiento propiedad del plugin.

```ts
export interface PluginLearningData {
    readonly directory: string;
    listSessions(): ChatListItem[];
    getSession(id: string): ChatRecord | null;
    graph(): GraphSnapshot;
    readGraphFile<K extends keyof PluginGraphFileData>(name: K): PluginGraphFileData[K];
}
```

**Tipos relacionados:** [ChatListItem](contracts-chat.md#chatlistitem), [ChatRecord](contracts-chat.md#chatrecord), [GraphSnapshot](contracts-graph.md#graphsnapshot), [PluginGraphFileData](plugins.md#plugingraphfiledata).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [directory](#pluginlearningdata-directory)
- [listSessions](#pluginlearningdata-listsessions)
- [getSession](#pluginlearningdata-getsession)
- [graph](#pluginlearningdata-graph)
- [readGraphFile](#pluginlearningdata-readgraphfile)

### PluginLearningData directory

Raíz de los datos de aprendizaje, no un directorio de credenciales ni un permiso para
escribir ficheros del núcleo.

```ts
readonly directory: string;
```

### PluginLearningData listSessions

Lista los resúmenes de las sesiones guardadas con los indicadores actuales
busy/compacting; sin trabajo de modelo.

```ts
listSessions(): ChatListItem[];
```

**Devuelve:** `ChatListItem[]`.

### PluginLearningData getSession

Lee una sesión nativa guardada completa, o null si no existe. Los IDs no válidos
lanzan una excepción. Las transcripciones conservan respuestas y razonamientos del
alumno que el grafo no representa.

```ts
getSession(id: string): ChatRecord | null;
```

| Parámetro | Tipo |
| --- | --- |
| `id` | `string` |

**Devuelve:** `ChatRecord \| null`.

### PluginLearningData graph

Lee la proyección actual del grafo y los registros en bruto, sin un segundo lenguaje
de consulta. No es una transcripción completa de las respuestas del alumno.

```ts
graph(): GraphSnapshot;
```

**Devuelve:** `GraphSnapshot`.

### PluginLearningData readGraphFile

Lee el JSON de libros y metadatos del grafo usando la interpretación actual de los
ficheros por parte del host. Se aplican las comprobaciones de validación y versión
del host; los nombres de fichero desconocidos lanzan una excepción.

```ts
readGraphFile<K extends keyof PluginGraphFileData>(name: K): PluginGraphFileData[K];
```

| Parámetro | Tipo |
| --- | --- |
| `name` | `K` |

**Devuelve:** `PluginGraphFileData[K]`.

## PluginManifest

Tipo público del SDK, exportado como `PluginManifest`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginManifest {
    apiVersion: 1;
    id: string;
    name: string;
    version: string;
    minAppVersion: string;
    description?: string;
    author?: string;
    main?: string;
    backend?: string;
    styles?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [apiVersion](#pluginmanifest-apiversion)
- [id](#pluginmanifest-id)
- [name](#pluginmanifest-name)
- [version](#pluginmanifest-version)
- [minAppVersion](#pluginmanifest-minappversion)
- [description](#pluginmanifest-description)
- [author](#pluginmanifest-author)
- [main](#pluginmanifest-main)
- [backend](#pluginmanifest-backend)
- [styles](#pluginmanifest-styles)

### PluginManifest apiVersion

```ts
apiVersion: 1;
```

### PluginManifest id

```ts
id: string;
```

### PluginManifest name

```ts
name: string;
```

### PluginManifest version

```ts
version: string;
```

### PluginManifest minAppVersion

```ts
minAppVersion: string;
```

### PluginManifest description

```ts
description?: string;
```

### PluginManifest author

```ts
author?: string;
```

### PluginManifest main

Módulo ES de navegador empaquetado. Las rutas de entrada no deben apuntar a los datos
del plugin.

```ts
main?: string;
```

### PluginManifest backend

Módulo CommonJS de Node empaquetado. Los módulos integrados de Node están disponibles.

```ts
backend?: string;
```

### PluginManifest styles

```ts
styles?: string;
```

## PluginNotification

Tipo público del SDK, exportado como `PluginNotification`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginNotification {
    pluginId: string;
    topic: string;
    data?: unknown;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [pluginId](#pluginnotification-pluginid)
- [topic](#pluginnotification-topic)
- [data](#pluginnotification-data)

### PluginNotification pluginId

```ts
pluginId: string;
```

### PluginNotification topic

```ts
topic: string;
```

### PluginNotification data

```ts
data?: unknown;
```

## PluginPageActionContext

Tipo público del SDK, exportado como `PluginPageActionContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginPageActionContext = {
    surface: "session";
    sessionId: string;
    kind: "teaching" | "practice";
    surfaceTarget: import("./plugin-ui.ts").PluginSurfaceTarget;
    readonly view: import("./plugin-view-context.ts").PluginSessionViewContext;
} | {
    surface: "plugin-view";
    pluginId: string;
    viewId: string;
} | {
    surface: "app";
    pathname: string;
};
```

**Tipos relacionados:** [PluginSessionViewContext](plugin-view-context.md#pluginsessionviewcontext), [PluginSurfaceTarget](plugin-ui.md#pluginsurfacetarget).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [surface](#pluginpageactioncontext-surface) — 3 firmas o variantes
- [sessionId](#pluginpageactioncontext-sessionid)
- [kind](#pluginpageactioncontext-kind)
- [surfaceTarget](#pluginpageactioncontext-surfacetarget)
- [view](#pluginpageactioncontext-view)
- [pluginId](#pluginpageactioncontext-pluginid)
- [viewId](#pluginpageactioncontext-viewid)
- [pathname](#pluginpageactioncontext-pathname)

### PluginPageActionContext surface

```ts
surface: "session";
```

```ts
surface: "plugin-view";
```

```ts
surface: "app";
```

### PluginPageActionContext sessionId

```ts
sessionId: string;
```

### PluginPageActionContext kind

```ts
kind: "teaching" | "practice";
```

### PluginPageActionContext surfaceTarget

```ts
surfaceTarget: import("./plugin-ui.ts").PluginSurfaceTarget;
```

### PluginPageActionContext view

Vista independiente de la sesión completa, capturada una vez antes de invocar la
acción.

```ts
readonly view: import("./plugin-view-context.ts").PluginSessionViewContext;
```

### PluginPageActionContext pluginId

```ts
pluginId: string;
```

### PluginPageActionContext viewId

```ts
viewId: string;
```

### PluginPageActionContext pathname

```ts
pathname: string;
```

## PluginSettingsRegistration

Tipo público del SDK, exportado como `PluginSettingsRegistration`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSettingsRegistration = PluginView["mount"] | import("./plugin-ui.ts").PluginSettingsSchema;
```

**Tipos relacionados:** [PluginSettingsSchema](plugin-ui.md#pluginsettingsschema), [PluginView](plugins.md#pluginview).

## PluginToolContext

Tipo público del SDK, exportado como `PluginToolContext`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginToolContext {
    readonly chatId: string;
    readonly agent: PluginAgentKind;
}
```

**Tipos relacionados:** [PluginAgentKind](plugins.md#pluginagentkind).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#plugintoolcontext-chatid)
- [agent](#plugintoolcontext-agent)

### PluginToolContext chatId

```ts
readonly chatId: string;
```

### PluginToolContext agent

```ts
readonly agent: PluginAgentKind;
```

## PluginToolRenderer

Tipo público del SDK, exportado como `PluginToolRenderer`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginToolRenderer {
    toolName: string;
    backgroundPresentation?: "collapsed" | "card" | "plain";
    mount(container: HTMLElement, tool: PluginToolRenderProps): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [PluginCleanup](plugins.md#plugincleanup), [PluginToolRenderProps](plugins.md#plugintoolrenderprops).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [toolName](#plugintoolrenderer-toolname)
- [backgroundPresentation](#plugintoolrenderer-backgroundpresentation)
- [mount](#plugintoolrenderer-mount)

### PluginToolRenderer toolName

```ts
toolName: string;
```

### PluginToolRenderer backgroundPresentation

Los resultados posteriores de workers se pliegan por defecto; los resultados
enriquecidos pueden optar por una tarjeta o por un contenedor sin marco.

```ts
backgroundPresentation?: "collapsed" | "card" | "plain";
```

### PluginToolRenderer mount

Representa el estado de entrada y resultado de una herramienta nativa; devuelve una
limpieza síncrona o asíncrona. Sustituir, anular el registro o desactivar cancela
tool.signal; los errores recurren a resultados legibles. La presentación por sí sola
no crea entrada pendiente del alumno ni ejecuta ninguna herramienta.

```ts
mount(container: HTMLElement, tool: PluginToolRenderProps): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `tool` | `PluginToolRenderProps` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.

## PluginToolRenderProps

Tipo público del SDK, exportado como `PluginToolRenderProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginToolRenderProps {
    toolName: string;
    toolCallId: string;
    input: unknown;
    state: "input-streaming" | "input-available" | "output-available" | "output-error";
    output?: unknown;
    errorText?: string;
    result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
    background?: PluginBackgroundMeta;
    signal: AbortSignal;
}
```

**Tipos relacionados:** [PluginBackgroundMeta](plugin-workers.md#pluginbackgroundmeta).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [toolName](#plugintoolrenderprops-toolname)
- [toolCallId](#plugintoolrenderprops-toolcallid)
- [input](#plugintoolrenderprops-input)
- [state](#plugintoolrenderprops-state)
- [output](#plugintoolrenderprops-output)
- [errorText](#plugintoolrenderprops-errortext)
- [result](#plugintoolrenderprops-result)
- [background](#plugintoolrenderprops-background)
- [signal](#plugintoolrenderprops-signal)

### PluginToolRenderProps toolName

```ts
toolName: string;
```

### PluginToolRenderProps toolCallId

```ts
toolCallId: string;
```

### PluginToolRenderProps input

```ts
input: unknown;
```

### PluginToolRenderProps state

```ts
state: "input-streaming" | "input-available" | "output-available" | "output-error";
```

### PluginToolRenderProps output

Detalles del resultado nativo, que también usan las tarjetas de herramientas
existentes de la app.

```ts
output?: unknown;
```

### PluginToolRenderProps errorText

```ts
errorText?: string;
```

### PluginToolRenderProps result

```ts
result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
```

### PluginToolRenderProps background

Presente en la tarjeta separada del resultado posterior; la llamada original conserva
su acuse.

```ts
background?: PluginBackgroundMeta;
```

### PluginToolRenderProps signal

```ts
signal: AbortSignal;
```

## PluginTools

Tipo público del SDK, exportado como `PluginTools`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Un conjunto nuevo de herramientas nativas de Pi por turno de conversación; sin
importaciones privadas de la app.

```ts
export interface PluginTools {
    agents: PluginAgentKind[];
    create(context: PluginToolContext): AgentTool<any>[];
}
```

**Tipos relacionados:** [PluginAgentKind](plugins.md#pluginagentkind), [PluginToolContext](plugins.md#plugintoolcontext).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [agents](#plugintools-agents)
- [create](#plugintools-create)

### PluginTools agents

```ts
agents: PluginAgentKind[];
```

### PluginTools create

Crea herramientas nativas nuevas para el contexto congelado de chat y agente del
turno correspondiente. Los errores de factoría o de admisión omiten la contribución
de este plugin en ese turno en lugar de sustituir las herramientas del host. Respeta
la señal de cancelación de cada ejecución de herramienta.

```ts
create(context: PluginToolContext): AgentTool<any>[];
```

| Parámetro | Tipo |
| --- | --- |
| `context` | `PluginToolContext` |

**Devuelve:** `AgentTool<any>[]`.

## PluginView

Tipo público del SDK, exportado como `PluginView`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginView {
    id: string;
    name: string;
    mount(container: HTMLElement, signal: AbortSignal): void | PluginCleanup | Promise<void | PluginCleanup>;
}
```

**Tipos relacionados:** [PluginCleanup](plugins.md#plugincleanup).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#pluginview-id)
- [name](#pluginview-name)
- [mount](#pluginview-mount)

### PluginView id

```ts
id: string;
```

### PluginView name

```ts
name: string;
```

### PluginView mount

Monta solo el cuerpo de la vista; el host es propietario del título, la barra
superior y las acciones. Salir, sustituir o desactivar cancela esta señal de montaje.
Devuelve una limpieza síncrona o asíncrona y acota la interfaz hija a esta señal, no
solo a la activación, que dura más.

```ts
mount(container: HTMLElement, signal: AbortSignal): void | PluginCleanup | Promise<void | PluginCleanup>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `signal` | `AbortSignal` |

**Devuelve:** `void \| PluginCleanup \| Promise<void \| PluginCleanup>`.
