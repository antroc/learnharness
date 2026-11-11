# contracts-jobs

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [JobUsage](#jobusage) — declaración de apoyo

## JobUsage

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Uso acumulado del modelo en una ejecución de worker: totales de tokens más un recuento de
llamadas, con contabilidad opcional por llamada. Igual que en CallUsage, un campo de tokens
que ninguna llamada haya informado sigue sin definir; la falta de datos de uso no debe
implicar coste cero.

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

Identidad del modelo cualificada por proveedor (provider:id) para buscarla en el catálogo.

```ts
model: string;
```

### JobUsage inputTokens

Totales acumulados de las llamadas al modelo de la ejecución hasta el momento.

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

Llamadas individuales para aplicar los precios por tramo y llamada del catálogo actual.
No existen en tareas antiguas; no las reconstruyas nunca a partir de los totales
acumulados.

```ts
calls?: CallUsage[];
```

### JobUsage steps

Cuántas llamadas al modelo ha hecho la ejecución (cada una se factura por separado).

```ts
steps: number;
```

### JobUsage lastStep

Contabilidad de la última llamada al modelo completada, usada para el uso actual del
contexto en lugar de los totales acumulados. No existe hasta que termina una llamada; los
campos que el proveedor no informa siguen sin definir.

```ts
lastStep?: CallUsage;
```
