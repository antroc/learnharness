# plugin-shortcuts

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Atajos de acciones](../plugin-authoring.md#atajos-de-acciones)

- [PluginActionShortcut](#pluginactionshortcut)
- [PluginShortcutViewScope](#pluginshortcutviewscope)

## PluginActionShortcut

Tipo público del SDK, exportado como `PluginActionShortcut`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginActionShortcut {
    readonly scope: "app" | PluginShortcutViewScope;
    readonly defaultBinding?: string;
}
```

**Tipos relacionados:** [PluginShortcutViewScope](plugin-shortcuts.md#pluginshortcutviewscope).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [scope](#pluginactionshortcut-scope)
- [defaultBinding](#pluginactionshortcut-defaultbinding)

### PluginActionShortcut scope

```ts
readonly scope: "app" | PluginShortcutViewScope;
```

### PluginActionShortcut defaultBinding

Grafía canónica del host, p. ej. mod+shift+d. Omítela para dejarla inicialmente sin asignar.

```ts
readonly defaultBinding?: string;
```

## PluginShortcutViewScope

Tipo público del SDK, exportado como `PluginShortcutViewScope`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Atajos de acciones declarativos y resolución determinista y segura para el navegador.

```ts
export interface PluginShortcutViewScope {
    readonly sessions?: readonly ("teaching" | "practice")[];
    readonly views?: readonly string[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [sessions](#pluginshortcutviewscope-sessions)
- [views](#pluginshortcutviewscope-views)

### PluginShortcutViewScope sessions

```ts
readonly sessions?: readonly ("teaching" | "practice")[];
```

### PluginShortcutViewScope views

Los IDs de vista siempre pertenecen al plugin que los registra.

```ts
readonly views?: readonly string[];
```
