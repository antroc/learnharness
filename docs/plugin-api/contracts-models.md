# contracts-models

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [CatalogDefaults](#catalogdefaults) — declaración de apoyo
- [CatalogProvider](#catalogprovider) — declaración de apoyo
- [ModelCatalogEntry](#modelcatalogentry) — declaración de apoyo
- [ModelCatalogResponse](#modelcatalogresponse)
- [RolePins](#rolepins) — declaración de apoyo
- [SlotPins](#slotpins) — declaración de apoyo

## CatalogDefaults

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Conversation default resolved from the strong slot, used for new sessions
and as fallback for sessions without their own choices. An omitted thinking
level is selected from the host's supported-level preference at engine build.

```ts
export interface CatalogDefaults {
    model: {
        provider: string;
        id: string;
    };
    thinkingLevel?: ThinkingLevel;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#catalogdefaults-model)
- [model.provider](#catalogdefaults-modelprovider)
- [model.id](#catalogdefaults-modelid)
- [thinkingLevel](#catalogdefaults-thinkinglevel)

### CatalogDefaults model

```ts
model: {
    provider: string;
    id: string;
};
```

### CatalogDefaults model.provider

```ts
provider: string;
```

### CatalogDefaults model.id

```ts
id: string;
```

### CatalogDefaults thinkingLevel

```ts
thinkingLevel?: ThinkingLevel;
```

## CatalogProvider

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

One row of the providers surface.

```ts
export interface CatalogProvider {
    id: string;
    envVar: string;
    keyPresent: boolean;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#catalogprovider-id)
- [envVar](#catalogprovider-envvar)
- [keyPresent](#catalogprovider-keypresent)

### CatalogProvider id

```ts
id: string;
```

### CatalogProvider envVar

Credential environment-variable name; empty for subscription/native CLI routes.

```ts
envVar: string;
```

### CatalogProvider keyPresent

Host credential/connection availability flag, not a remote health check.
Custom keyless connections can be available without an API key.

```ts
keyPresent: boolean;
```

## ModelCatalogEntry

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

One picker row: everything the UI shows about a model, projected from
pi-ai's catalog. Costs are USD per 1M tokens (the same catalog, the same
units as Pi's server-side pricing calculator).

```ts
export interface ModelCatalogEntry {
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    supportedLevels: ThinkingLevel[];
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    } | null;
    contextWindow: number | null;
    maxTokens: number | null;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#modelcatalogentry-id)
- [name](#modelcatalogentry-name)
- [provider](#modelcatalogentry-provider)
- [reasoning](#modelcatalogentry-reasoning)
- [input](#modelcatalogentry-input)
- [supportedLevels](#modelcatalogentry-supportedlevels)
- [cost](#modelcatalogentry-cost)
- [cost.input](#modelcatalogentry-costinput)
- [cost.output](#modelcatalogentry-costoutput)
- [cost.cacheRead](#modelcatalogentry-costcacheread)
- [cost.cacheWrite](#modelcatalogentry-costcachewrite)
- [contextWindow](#modelcatalogentry-contextwindow)
- [maxTokens](#modelcatalogentry-maxtokens)

### ModelCatalogEntry id

```ts
id: string;
```

### ModelCatalogEntry name

```ts
name: string;
```

### ModelCatalogEntry provider

```ts
provider: string;
```

### ModelCatalogEntry reasoning

```ts
reasoning: boolean;
```

### ModelCatalogEntry input

```ts
input: ("text" | "image")[];
```

### ModelCatalogEntry supportedLevels

Thinking levels accepted by this model, as reported by the host catalog.

```ts
supportedLevels: ThinkingLevel[];
```

### ModelCatalogEntry cost

Null when LearnHarness cannot estimate prices for this connection.

```ts
cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
} | null;
```

### ModelCatalogEntry cost.input

```ts
input: number;
```

### ModelCatalogEntry cost.output

```ts
output: number;
```

### ModelCatalogEntry cost.cacheRead

```ts
cacheRead: number;
```

### ModelCatalogEntry cost.cacheWrite

```ts
cacheWrite: number;
```

### ModelCatalogEntry contextWindow

Null for native CLI aliases whose effective limits are session-specific.

```ts
contextWindow: number | null;
```

### ModelCatalogEntry maxTokens

```ts
maxTokens: number | null;
```

## ModelCatalogResponse

Tipo público del SDK, exportado como `ModelCatalogResponse`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

GET /api/models response.

```ts
export interface ModelCatalogResponse {
    models: ModelCatalogEntry[];
    defaults: CatalogDefaults | null;
    rolePins: RolePins;
    slots: SlotPins;
    providers: CatalogProvider[];
}
```

**Tipos relacionados:** [CatalogDefaults](contracts-models.md#catalogdefaults), [CatalogProvider](contracts-models.md#catalogprovider), [ModelCatalogEntry](contracts-models.md#modelcatalogentry), [RolePins](contracts-models.md#rolepins), [SlotPins](contracts-models.md#slotpins).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [models](#modelcatalogresponse-models)
- [defaults](#modelcatalogresponse-defaults)
- [rolePins](#modelcatalogresponse-rolepins)
- [slots](#modelcatalogresponse-slots)
- [providers](#modelcatalogresponse-providers)

### ModelCatalogResponse models

```ts
models: ModelCatalogEntry[];
```

### ModelCatalogResponse defaults

Strong-slot conversation default, or null when no default model is
configured. A session's explicit model choice resolves separately.

```ts
defaults: CatalogDefaults | null;
```

### ModelCatalogResponse rolePins

Resolved background-role models, using the same resolution as execution.
Each unconfigured role is null.

```ts
rolePins: RolePins;
```

### ModelCatalogResponse slots

Resolved strong/cheap/vision slot choices, null for each unset tier.
Per-role overrides are represented in rolePins, not in these slot values.

```ts
slots: SlotPins;
```

### ModelCatalogResponse providers

Provider/connection rows with availability flags, including disconnected
providers where exposed by the host. This is not a guarantee that each
provider has currently selectable models; inspect models and keyPresent.

```ts
providers: CatalogProvider[];
```

## RolePins

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Resolved model choice per background role: role override, then its assigned
tier slot. Null means no model is configured and work requiring that role
is unavailable; there is no implicit factory model fallback.

```ts
export type RolePins = Record<BackgroundModelRole, {
    model: {
        provider: string;
        id: string;
    };
    thinkingLevel?: ThinkingLevel;
} | null>;
```

**Tipos relacionados:** [BackgroundModelRole](settings.md#backgroundmodelrole).

## SlotPins

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Resolved model choice for each slot tier. Null means that tier has no model;
configured entries include optional thinking and cache-retention preferences.

```ts
export type SlotPins = Record<ModelSlotName, (ModelSlot & {
    model: {
        provider: string;
        id: string;
    };
}) | null>;
```

**Tipos relacionados:** [ModelSlot](settings.md#modelslot), [ModelSlotName](settings.md#modelslotname).
