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

Valor por defecto de la conversación resuelto a partir de la ranura potente; se usa en las
sesiones nuevas y como alternativa en las sesiones sin elecciones propias. Si se omite el
nivel de razonamiento, se elige según la preferencia de niveles admitidos del host al
construir el motor.

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

Una fila de la superficie de proveedores.

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

Nombre de la variable de entorno de la credencial; vacío para las rutas de suscripción o de
CLI nativa.

```ts
envVar: string;
```

### CatalogProvider keyPresent

Indicador de disponibilidad de credenciales o conexión del host, no una comprobación de
salud remota. Las conexiones personalizadas sin clave pueden estar disponibles sin clave
de API.

```ts
keyPresent: boolean;
```

## ModelCatalogEntry

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Una fila del selector: todo lo que la interfaz muestra sobre un modelo, proyectado desde el
catálogo de pi-ai. Los costes están en USD por cada millón de tokens (el mismo catálogo y
las mismas unidades que la calculadora de precios de Pi en el servidor).

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

Niveles de razonamiento que acepta este modelo, según informa el catálogo del host.

```ts
supportedLevels: ThinkingLevel[];
```

### ModelCatalogEntry cost

Null cuando LearnHarness no puede estimar los precios de esta conexión.

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

Null para los alias de CLI nativa cuyos límites efectivos dependen de la sesión.

```ts
contextWindow: number | null;
```

### ModelCatalogEntry maxTokens

```ts
maxTokens: number | null;
```

## ModelCatalogResponse

Tipo público del SDK, exportado como `ModelCatalogResponse`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Respuesta de GET /api/models.

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

Valor por defecto de la conversación de la ranura potente, o null cuando no hay ningún
modelo por defecto configurado. La elección explícita de modelo de una sesión se resuelve
aparte.

```ts
defaults: CatalogDefaults | null;
```

### ModelCatalogResponse rolePins

Modelos resueltos de los roles en segundo plano, con la misma resolución que la ejecución.
Cada rol sin configurar es null.

```ts
rolePins: RolePins;
```

### ModelCatalogResponse slots

Elecciones resueltas de las ranuras potente/barata/visión; null para cada nivel sin
definir. Las sustituciones por rol se representan en rolePins, no en estos valores de
ranura.

```ts
slots: SlotPins;
```

### ModelCatalogResponse providers

Filas de proveedores y conexiones con indicadores de disponibilidad, incluidos los
proveedores desconectados cuando el host los expone. No garantiza que cada proveedor tenga
en ese momento modelos seleccionables; consulta models y keyPresent.

```ts
providers: CatalogProvider[];
```

## RolePins

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Elección de modelo resuelta por rol en segundo plano: la sustitución del rol y, si no, la
ranura del nivel que tiene asignado. Null significa que no hay ningún modelo configurado y
que el trabajo que requiere ese rol no está disponible; no hay ninguna alternativa
implícita a un modelo de fábrica.

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

Elección de modelo resuelta para cada nivel de ranura. Null significa que ese nivel no tiene
modelo; las entradas configuradas incluyen preferencias opcionales de razonamiento y de
retención de caché.

```ts
export type SlotPins = Record<ModelSlotName, (ModelSlot & {
    model: {
        provider: string;
        id: string;
    };
}) | null>;
```

**Tipos relacionados:** [ModelSlot](settings.md#modelslot), [ModelSlotName](settings.md#modelslotname).
