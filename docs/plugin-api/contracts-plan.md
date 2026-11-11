# contracts-plan

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [PlanEdge](#planedge) — declaración de apoyo
- [PlanNode](#plannode) — declaración de apoyo
- [PlanTree](#plantree) — declaración de apoyo

## PlanEdge

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export interface PlanEdge {
    from: string;
    to: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [from](#planedge-from)
- [to](#planedge-to)

### PlanEdge from

Id del nodo prerrequisito.

```ts
from: string;
```

### PlanEdge to

Nodo que depende de `from`.

```ts
to: string;
```

## PlanNode

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Contratos del árbol del plan: el árbol de dependencias de ámbito de sesión

Forma parte de los contratos divididos por dominio (src/core/contracts/): cada fichero de
dominio pertenece por completo a su flujo de trabajo; los cambios de esquema entre dominios
pasan por master. Tipos puros + documentación de protocolo + helpers puros diminutos;
importaciones solo de tipos de "ai" (seguras en cualquier sitio: servidor, cliente, pruebas).
Consulta docs/archive/vision.md.

```ts
export interface PlanNode {
    id: string;
    title: string;
    summary?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#plannode-id)
- [title](#plannode-title)
- [summary](#plannode-summary)

### PlanNode id

Slug opaco elegido por el agente y estable entre ediciones: "chain-rule-intuition".

```ts
id: string;
```

### PlanNode title

Etiqueta corta para el panel del árbol.

```ts
title: string;
```

### PlanNode summary

1-2 frases: qué cubre este nodo.

```ts
summary?: string;
```

## PlanTree

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export interface PlanTree {
    nodes: PlanNode[];
    edges: PlanEdge[];
    version: number;
}
```

**Tipos relacionados:** [PlanEdge](contracts-plan.md#planedge), [PlanNode](contracts-plan.md#plannode).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [nodes](#plantree-nodes)
- [edges](#plantree-edges)
- [version](#plantree-version)

### PlanTree nodes

```ts
nodes: PlanNode[];
```

### PlanTree edges

```ts
edges: PlanEdge[];
```

### PlanTree version

Se incrementa en cada mutación; permite que la interfaz anime los cambios o reaccione a ellos.

```ts
version: number;
```
