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

Prerequisite node id.

```ts
from: string;
```

### PlanEdge to

Node that depends on `from`.

```ts
to: string;
```

## PlanNode

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Plan-tree contracts — the session-scoped dependency tree

Part of the domain-split contracts (src/core/contracts/): each domain file
is owned outright by its stream — cross-domain schema changes go through
master. Pure types + protocol docs + tiny pure helpers; type-only imports
of "ai" (safe everywhere: server, client, tests). See docs/archive/vision.md.

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

Opaque, agent-chosen slug, stable across edits: "chain-rule-intuition".

```ts
id: string;
```

### PlanNode title

Short label for the tree panel.

```ts
title: string;
```

### PlanNode summary

1-2 sentences: what this node covers.

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

Increments on every mutation — lets the UI animate/react to changes.

```ts
version: number;
```
