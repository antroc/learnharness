# contracts-jobs

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [JobUsage](#jobusage) — declaración de apoyo

## JobUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Uso de modelo acumulado de una ejecución de worker: totales de tokens más un recuento
de llamadas, con contabilidad opcional por llamada. Como en CallUsage, un campo de tokens
del que no informó ninguna llamada sigue siendo undefined; la falta de uso no debe implicar coste cero.

```ts
export interface JobUsage {
    model: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
    reasoningTokens: number | undefined;
    cacheWrite1hTokens?: number;
    calls?: CallUsage[];
    steps: number;
    lastStep?: CallUsage;
}
```

**Tipos relacionados:** [CallUsage](contracts-chat.md#callusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#jobusage-model)
- [inputTokens](#jobusage-inputtokens)
- [outputTokens](#jobusage-outputtokens)
- [cacheReadTokens](#jobusage-cachereadtokens)
- [cacheWriteTokens](#jobusage-cachewritetokens)
- [reasoningTokens](#jobusage-reasoningtokens)
- [cacheWrite1hTokens](#jobusage-cachewrite1htokens)
- [calls](#jobusage-calls)
- [steps](#jobusage-steps)
- [lastStep](#jobusage-laststep)

### JobUsage model

Identidad de modelo calificada por proveedor (provider:id) para buscar en el catálogo.

```ts
model: string;
```

### JobUsage inputTokens

Totales acumulados sumados sobre las llamadas al modelo de la ejecución hasta ahora.

```ts
inputTokens: number | undefined;
```

### JobUsage outputTokens

```ts
outputTokens: number | undefined;
```

### JobUsage cacheReadTokens

```ts
cacheReadTokens: number | undefined;
```

### JobUsage cacheWriteTokens

```ts
cacheWriteTokens: number | undefined;
```

### JobUsage reasoningTokens

```ts
reasoningTokens: number | undefined;
```

### JobUsage cacheWrite1hTokens

```ts
cacheWrite1hTokens?: number;
```

### JobUsage calls

Llamadas individuales para la tarificación por tramos por llamada del catálogo actual. Ausente en
las tareas antiguas; nunca se rellenan a partir de los totales acumulados.

```ts
calls?: CallUsage[];
```

### JobUsage steps

Cuántas llamadas al modelo ha hecho la ejecución (cada una se factura por separado).

```ts
steps: number;
```

### JobUsage lastStep

Contabilidad de la llamada al modelo completada más reciente, usada para el uso de
contexto actual en lugar de los totales acumulados. Ausente hasta que se completa una llamada;
los campos de los que no informa el proveedor siguen siendo undefined.

```ts
lastStep?: CallUsage;
```
