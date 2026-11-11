# plugin-tree

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Comportamiento de los árboles](../plugin-tree-contract.md)

- [PluginTreeColumn](#plugintreecolumn)
- [PluginTreeContent](#plugintreecontent)
- [PluginTreeProps](#plugintreeprops)
- [PluginTreeRow](#plugintreerow)

## PluginTreeColumn

Tipo público del SDK, exportado como `PluginTreeColumn`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTreeColumn {
    key: string;
    header: PluginTreeContent;
    width: number | string;
    align?: "left" | "right";
}
```

**Tipos relacionados:** [PluginTreeContent](plugin-tree.md#plugintreecontent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [key](#plugintreecolumn-key)
- [header](#plugintreecolumn-header)
- [width](#plugintreecolumn-width)
- [align](#plugintreecolumn-align)

### PluginTreeColumn key

```ts
key: string;
```

### PluginTreeColumn header

```ts
header: PluginTreeContent;
```

### PluginTreeColumn width

Fixed trailing-column width: pixels for numbers, CSS width for strings.

```ts
width: number | string;
```

### PluginTreeColumn align

```ts
align?: "left" | "right";
```

## PluginTreeContent

Tipo público del SDK, exportado como `PluginTreeContent`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginTreeContent = string | PluginUiContent;
```

**Tipos relacionados:** [PluginUiContent](plugin-ui.md#pluginuicontent).

## PluginTreeProps

Tipo público del SDK, exportado como `PluginTreeProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTreeProps {
    label: string;
    rows: readonly PluginTreeRow[];
    header?: PluginTreeContent;
    columns?: readonly PluginTreeColumn[];
}
```

**Tipos relacionados:** [PluginTreeColumn](plugin-tree.md#plugintreecolumn), [PluginTreeContent](plugin-tree.md#plugintreecontent), [PluginTreeRow](plugin-tree.md#plugintreerow).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [label](#plugintreeprops-label)
- [rows](#plugintreeprops-rows)
- [header](#plugintreeprops-header)
- [columns](#plugintreeprops-columns)

### PluginTreeProps label

Accessible name; visible headings belong to header or row content.

```ts
label: string;
```

### PluginTreeProps rows

```ts
rows: readonly PluginTreeRow[];
```

### PluginTreeProps header

```ts
header?: PluginTreeContent;
```

### PluginTreeProps columns

```ts
columns?: readonly PluginTreeColumn[];
```

## PluginTreeRow

Tipo público del SDK, exportado como `PluginTreeRow`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginTreeRow {
    key: string;
    content: PluginTreeContent;
    cells?: Record<string, PluginTreeContent>;
    children?: readonly PluginTreeRow[];
    selection?: {
        label: string;
        checked: boolean;
        indeterminate?: boolean;
        disabled?: boolean;
        onChange: PluginUiCallback<boolean>;
    };
    disclosure?: {
        label: string;
        expanded: boolean;
        onChange: PluginUiCallback<boolean>;
    };
}
```

**Tipos relacionados:** [PluginTreeContent](plugin-tree.md#plugintreecontent), [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [key](#plugintreerow-key)
- [content](#plugintreerow-content)
- [cells](#plugintreerow-cells)
- [children](#plugintreerow-children)
- [selection](#plugintreerow-selection)
- [selection.label](#plugintreerow-selectionlabel)
- [selection.checked](#plugintreerow-selectionchecked)
- [selection.indeterminate](#plugintreerow-selectionindeterminate)
- [selection.disabled](#plugintreerow-selectiondisabled)
- [selection.onChange](#plugintreerow-selectiononchange)
- [disclosure](#plugintreerow-disclosure)
- [disclosure.label](#plugintreerow-disclosurelabel)
- [disclosure.expanded](#plugintreerow-disclosureexpanded)
- [disclosure.onChange](#plugintreerow-disclosureonchange)

### PluginTreeRow key

Globally unique occurrence identity, independent of represented entities.

```ts
key: string;
```

### PluginTreeRow content

```ts
content: PluginTreeContent;
```

### PluginTreeRow cells

```ts
cells?: Record<string, PluginTreeContent>;
```

### PluginTreeRow children

```ts
children?: readonly PluginTreeRow[];
```

### PluginTreeRow selection

```ts
selection?: {
    label: string;
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    onChange: PluginUiCallback<boolean>;
};
```

### PluginTreeRow selection.label

```ts
label: string;
```

### PluginTreeRow selection.checked

```ts
checked: boolean;
```

### PluginTreeRow selection.indeterminate

```ts
indeterminate?: boolean;
```

### PluginTreeRow selection.disabled

```ts
disabled?: boolean;
```

### PluginTreeRow selection.onChange

```ts
onChange: PluginUiCallback<boolean>;
```

### PluginTreeRow disclosure

```ts
disclosure?: {
    label: string;
    expanded: boolean;
    onChange: PluginUiCallback<boolean>;
};
```

### PluginTreeRow disclosure.label

```ts
label: string;
```

### PluginTreeRow disclosure.expanded

```ts
expanded: boolean;
```

### PluginTreeRow disclosure.onChange

```ts
onChange: PluginUiCallback<boolean>;
```
