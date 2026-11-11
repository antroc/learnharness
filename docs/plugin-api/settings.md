# settings

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [BACKGROUND_MODEL_ROLES](#background_model_roles) — declaración de apoyo
- [BackgroundModelRole](#backgroundmodelrole) — declaración de apoyo
- [MODEL_SLOTS](#model_slots) — declaración de apoyo
- [ModelSlot](#modelslot) — declaración de apoyo
- [ModelSlotName](#modelslotname) — declaración de apoyo

## BACKGROUND_MODEL_ROLES

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
declare const BACKGROUND_MODEL_ROLES: readonly [
    "researcher",
    "demoBuilder",
    "visualMaker",
    "extractor",
    "auditor",
    "sideQuestion"
];
```

## BackgroundModelRole

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type BackgroundModelRole = (typeof BACKGROUND_MODEL_ROLES)[number];
```

**Tipos relacionados:** [BACKGROUND_MODEL_ROLES](settings.md#background_model_roles).

## MODEL_SLOTS

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
declare const MODEL_SLOTS: readonly [
    "strong",
    "cheap",
    "vision"
];
```

## ModelSlot

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Preferencias guardadas de las ranuras de modelo. Una ranura solo está configurada cuando hay
`model`; los registros depurados que solo tienen nivel pueden conservarse, pero se resuelven
como sin definir. Un nivel de razonamiento por sí solo no elige un modelo de recurso
implícito.

```ts
export interface ModelSlot {
    cacheRetention?: CacheRetention;
    model?: {
        provider: string;
        id: string;
    };
    thinkingLevel?: ThinkingLevel;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [cacheRetention](#modelslot-cacheretention)
- [model](#modelslot-model)
- [model.provider](#modelslot-modelprovider)
- [model.id](#modelslot-modelid)
- [thinkingLevel](#modelslot-thinkinglevel)

### ModelSlot cacheRetention

Preferencia nativa de Pi. Si no está, el comportamiento de Pi y del entorno no cambia.

```ts
cacheRetention?: CacheRetention;
```

### ModelSlot model

Coordenadas del modelo configurado; provider e id deben indicarse juntos.

```ts
model?: {
    provider: string;
    id: string;
};
```

### ModelSlot model.provider

```ts
provider: string;
```

### ModelSlot model.id

```ts
id: string;
```

### ModelSlot thinkingLevel

Nivel de razonamiento opcional que se usa con el modelo configurado de esta ranura.

```ts
thinkingLevel?: ThinkingLevel;
```

## ModelSlotName

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type ModelSlotName = (typeof MODEL_SLOTS)[number];
```

**Tipos relacionados:** [MODEL_SLOTS](settings.md#model_slots).
