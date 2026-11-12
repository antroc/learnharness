# plugin-ui

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Interfaz controlada del host](../plugin-authoring.md#interfaz-controlada-del-host)

- [PluginBadgeProps](#pluginbadgeprops)
- [PluginButtonColors](#pluginbuttoncolors)
- [PluginButtonColorState](#pluginbuttoncolorstate)
- [PluginButtonProps](#pluginbuttonprops)
- [PluginComposerProps](#plugincomposerprops)
- [PluginDialogProps](#plugindialogprops)
- [PluginDictationHandle](#plugindictationhandle)
- [PluginDictationProps](#plugindictationprops)
- [PluginKnowledgePickerProps](#pluginknowledgepickerprops)
- [PluginMarkdownProps](#pluginmarkdownprops)
- [PluginMenuItem](#pluginmenuitem)
- [PluginMenuProps](#pluginmenuprops)
- [PluginModelPickerProps](#pluginmodelpickerprops)
- [PluginModelValue](#pluginmodelvalue)
- [PluginSettingsRow](#pluginsettingsrow)
- [PluginSettingsRowBase](#pluginsettingsrowbase) — declaración de apoyo
- [PluginSettingsSchema](#pluginsettingsschema)
- [PluginStandardComposerProps](#pluginstandardcomposerprops)
- [PluginSurfaceProps](#pluginsurfaceprops)
- [PluginSurfaceTarget](#pluginsurfacetarget)
- [pluginSurfaceTargetBrand](#pluginsurfacetargetbrand) — declaración de apoyo
- [PluginThinkingPickerProps](#pluginthinkingpickerprops)
- [PluginUi](#pluginui)
- [PluginUiCallback](#pluginuicallback)
- [PluginUiContent](#pluginuicontent)
- [PluginWidgetHandle](#pluginwidgethandle)
- [PluginWidgetOptions](#pluginwidgetoptions)
- [PluginWorkerResultProps](#pluginworkerresultprops)

## PluginBadgeProps

Tipo público del SDK, exportado como `PluginBadgeProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Distintivo genérico de estilo nativo. Sin semántica de calificación ni colocación automática.

```ts
export interface PluginBadgeProps {
    text: string;
    color?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [text](#pluginbadgeprops-text)
- [color](#pluginbadgeprops-color)

### PluginBadgeProps text

```ts
text: string;
```

### PluginBadgeProps color

Color CSS para el texto y un tinte de fondo del 15 %. Omítelo para el distintivo neutro nativo.

```ts
color?: string;
```

## PluginButtonColors

Tipo público del SDK, exportado como `PluginButtonColors`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Solo colores CSS; las sustituciones de estado se aplican en cascada por propiedad, no como paletas completas.

```ts
export interface PluginButtonColors extends PluginButtonColorState {
    hover?: PluginButtonColorState;
    active?: PluginButtonColorState;
    focusVisible?: PluginButtonColorState & {
        ring?: string;
    };
    disabled?: PluginButtonColorState;
}
```

**Tipos relacionados:** [PluginButtonColorState](plugin-ui.md#pluginbuttoncolorstate).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [hover](#pluginbuttoncolors-hover)
- [active](#pluginbuttoncolors-active)
- [focusVisible](#pluginbuttoncolors-focusvisible)
- [focusVisible.ring](#pluginbuttoncolors-focusvisiblering)
- [disabled](#pluginbuttoncolors-disabled)

### PluginButtonColors hover

```ts
hover?: PluginButtonColorState;
```

### PluginButtonColors active

```ts
active?: PluginButtonColorState;
```

### PluginButtonColors focusVisible

```ts
focusVisible?: PluginButtonColorState & {
    ring?: string;
};
```

### PluginButtonColors focusVisible.ring

```ts
ring?: string;
```

### PluginButtonColors disabled

```ts
disabled?: PluginButtonColorState;
```

## PluginButtonColorState

Tipo público del SDK, exportado como `PluginButtonColorState`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginButtonColorState {
    background?: string;
    text?: string;
    border?: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [background](#pluginbuttoncolorstate-background)
- [text](#pluginbuttoncolorstate-text)
- [border](#pluginbuttoncolorstate-border)

### PluginButtonColorState background

```ts
background?: string;
```

### PluginButtonColorState text

```ts
text?: string;
```

### PluginButtonColorState border

```ts
border?: string;
```

## PluginButtonProps

Tipo público del SDK, exportado como `PluginButtonProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginButtonProps {
    label: string;
    icon?: string;
    iconOnly?: boolean;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "custom";
    colors?: PluginButtonColors;
    size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
    title?: string;
}
```

**Tipos relacionados:** [PluginButtonColors](plugin-ui.md#pluginbuttoncolors).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [label](#pluginbuttonprops-label)
- [icon](#pluginbuttonprops-icon)
- [iconOnly](#pluginbuttonprops-icononly)
- [onClick](#pluginbuttonprops-onclick)
- [disabled](#pluginbuttonprops-disabled)
- [variant](#pluginbuttonprops-variant)
- [colors](#pluginbuttonprops-colors)
- [size](#pluginbuttonprops-size)
- [title](#pluginbuttonprops-title)

### PluginButtonProps label

Texto visible, o el nombre accesible cuando iconOnly es true.

```ts
label: string;
```

### PluginButtonProps icon

Marcado SVG de confianza del plugin, mostrado de forma decorativa antes de la etiqueta.

```ts
icon?: string;
```

### PluginButtonProps iconOnly

Oculta el texto visible; exige una etiqueta no vacía y un icono. El tamaño sigue siendo independiente.

```ts
iconOnly?: boolean;
```

### PluginButtonProps onClick

```ts
onClick: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

### PluginButtonProps disabled

```ts
disabled?: boolean;
```

### PluginButtonProps variant

```ts
variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "custom";
```

### PluginButtonProps colors

Se valida en todas las variantes y solo se aplica a custom. Las actualizaciones sustituyen este objeto entero.

```ts
colors?: PluginButtonColors;
```

### PluginButtonProps size

```ts
size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
```

### PluginButtonProps title

```ts
title?: string;
```

## PluginComposerProps

Tipo público del SDK, exportado como `PluginComposerProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginComposerProps {
    value: string;
    onChange: PluginUiCallback<string>;
    onSend: () => void | Promise<void>;
    busy?: boolean;
    onStop?: () => void | Promise<void>;
    canSend?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
}
```

**Tipos relacionados:** [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [value](#plugincomposerprops-value)
- [onChange](#plugincomposerprops-onchange)
- [onSend](#plugincomposerprops-onsend)
- [busy](#plugincomposerprops-busy)
- [onStop](#plugincomposerprops-onstop)
- [canSend](#plugincomposerprops-cansend)
- [placeholder](#plugincomposerprops-placeholder)
- [autoFocus](#plugincomposerprops-autofocus)

### PluginComposerProps value

```ts
value: string;
```

### PluginComposerProps onChange

```ts
onChange: PluginUiCallback<string>;
```

### PluginComposerProps onSend

```ts
onSend: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

### PluginComposerProps busy

```ts
busy?: boolean;
```

### PluginComposerProps onStop

```ts
onStop?: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

### PluginComposerProps canSend

```ts
canSend?: boolean;
```

### PluginComposerProps placeholder

```ts
placeholder?: string;
```

### PluginComposerProps autoFocus

```ts
autoFocus?: boolean;
```

## PluginDialogProps

Tipo público del SDK, exportado como `PluginDialogProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Contenido modal con gestión del cierre/foco por el host y sin fila de título
visible del host. El cierre por el usuario notifica a onClose, no es un veto
asíncrono; la liberación/cancelación solo limpia.

```ts
export interface PluginDialogProps {
    title: string;
    content: PluginUiContent;
    onClose?: () => void | Promise<void>;
}
```

**Tipos relacionados:** [PluginUiContent](plugin-ui.md#pluginuicontent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [title](#plugindialogprops-title)
- [content](#plugindialogprops-content)
- [onClose](#plugindialogprops-onclose)

### PluginDialogProps title

Solo nombre accesible; los encabezados visibles pertenecen al contenido del plugin.

```ts
title: string;
```

### PluginDialogProps content

```ts
content: PluginUiContent;
```

### PluginDialogProps onClose

```ts
onClose?: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

## PluginDictationHandle

Tipo público del SDK, exportado como `PluginDictationHandle`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginDictationHandle extends PluginWidgetHandle<PluginDictationProps> {
    toggle(): void;
    finish(): Promise<void>;
    cancel(): void;
}
```

**Tipos relacionados:** [PluginDictationProps](plugin-ui.md#plugindictationprops), [PluginWidgetHandle](plugin-ui.md#pluginwidgethandle).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [toggle](#plugindictationhandle-toggle)
- [finish](#plugindictationhandle-finish)
- [cancel](#plugindictationhandle-cancel)

### PluginDictationHandle toggle

Empieza a grabar si está en reposo, o detiene la grabación y conserva el habla si
está activa. Se permite un propietario de grabación por ventana; un inicio
competidor notifica un error.

```ts
toggle(): void;
```

**Devuelve:** `void`.

### PluginDictationHandle finish

Detiene esta grabación y espera a que se entregue la transcripción antes de
enviar. No inicia la captura si está en reposo; los fallos de entrega pueden
rechazar. Esto no envía un mensaje ni actualiza un compositor nativo oculto.

```ts
finish(): Promise<void>;
```

**Devuelve:** `Promise<void>`.

### PluginDictationHandle cancel

Cancela la captura y descarta el habla almacenada en lugar de volcarla. No
deshace el texto ya entregado mediante onTranscript. La liberación o la
cancelación también cancelan.

```ts
cancel(): void;
```

**Devuelve:** `void`.

## PluginDictationProps

Tipo público del SDK, exportado como `PluginDictationProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginDictationProps {
    disabled?: boolean;
    onTranscript: PluginUiCallback<string>;
}
```

**Tipos relacionados:** [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [disabled](#plugindictationprops-disabled)
- [onTranscript](#plugindictationprops-ontranscript)

### PluginDictationProps disabled

```ts
disabled?: boolean;
```

### PluginDictationProps onTranscript

```ts
onTranscript: PluginUiCallback<string>;
```

## PluginKnowledgePickerProps

Tipo público del SDK, exportado como `PluginKnowledgePickerProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginKnowledgePickerProps {
    value: readonly string[];
    onChange: PluginUiCallback<readonly string[]>;
    disabled?: boolean;
}
```

**Tipos relacionados:** [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [value](#pluginknowledgepickerprops-value)
- [onChange](#pluginknowledgepickerprops-onchange)
- [disabled](#pluginknowledgepickerprops-disabled)

### PluginKnowledgePickerProps value

```ts
value: readonly string[];
```

### PluginKnowledgePickerProps onChange

```ts
onChange: PluginUiCallback<readonly string[]>;
```

### PluginKnowledgePickerProps disabled

```ts
disabled?: boolean;
```

## PluginMarkdownProps

Tipo público del SDK, exportado como `PluginMarkdownProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Render integrado de Markdown del host sin controles auxiliares ni widgets de bloques de código de plugins.

```ts
export interface PluginMarkdownProps {
    text: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [text](#pluginmarkdownprops-text)

### PluginMarkdownProps text

```ts
text: string;
```

## PluginMenuItem

Tipo público del SDK, exportado como `PluginMenuItem`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginMenuItem {
    key: string;
    label: string;
    disabled?: boolean;
    onSelect: () => void | Promise<void>;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [key](#pluginmenuitem-key)
- [label](#pluginmenuitem-label)
- [disabled](#pluginmenuitem-disabled)
- [onSelect](#pluginmenuitem-onselect)

### PluginMenuItem key

```ts
key: string;
```

### PluginMenuItem label

```ts
label: string;
```

### PluginMenuItem disabled

```ts
disabled?: boolean;
```

### PluginMenuItem onSelect

```ts
onSelect: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

## PluginMenuProps

Tipo público del SDK, exportado como `PluginMenuProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginMenuProps {
    items: PluginMenuItem[];
    label?: string;
    preferredSide?: "up" | "down";
    onClose?: () => void | Promise<void>;
}
```

**Tipos relacionados:** [PluginMenuItem](plugin-ui.md#pluginmenuitem).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [items](#pluginmenuprops-items)
- [label](#pluginmenuprops-label)
- [preferredSide](#pluginmenuprops-preferredside)
- [onClose](#pluginmenuprops-onclose)

### PluginMenuProps items

```ts
items: PluginMenuItem[];
```

### PluginMenuProps label

```ts
label?: string;
```

### PluginMenuProps preferredSide

```ts
preferredSide?: "up" | "down";
```

### PluginMenuProps onClose

```ts
onClose?: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

## PluginModelPickerProps

Tipo público del SDK, exportado como `PluginModelPickerProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginModelPickerProps {
    value: PluginModelValue | undefined;
    onChange: PluginUiCallback<PluginModelValue>;
    disabled?: boolean;
}
```

**Tipos relacionados:** [PluginModelValue](plugin-ui.md#pluginmodelvalue), [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [value](#pluginmodelpickerprops-value)
- [onChange](#pluginmodelpickerprops-onchange)
- [disabled](#pluginmodelpickerprops-disabled)

### PluginModelPickerProps value

```ts
value: PluginModelValue | undefined;
```

### PluginModelPickerProps onChange

```ts
onChange: PluginUiCallback<PluginModelValue>;
```

### PluginModelPickerProps disabled

```ts
disabled?: boolean;
```

## PluginModelValue

Tipo público del SDK, exportado como `PluginModelValue`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginModelValue {
    provider: string;
    id: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [provider](#pluginmodelvalue-provider)
- [id](#pluginmodelvalue-id)

### PluginModelValue provider

```ts
provider: string;
```

### PluginModelValue id

```ts
id: string;
```

## PluginSettingsRow

Tipo público del SDK, exportado como `PluginSettingsRow`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export type PluginSettingsRow = (PluginSettingsRowBase<boolean> & {
    type: "toggle";
}) | (PluginSettingsRowBase<string> & {
    type: "text";
}) | (PluginSettingsRowBase<string> & {
    type: "dropdown";
    options: {
        value: string;
        label: string;
    }[];
}) | (PluginSettingsRowBase<number> & {
    type: "number" | "slider";
    min?: number;
    max?: number;
    step?: number;
});
```

**Tipos relacionados:** [PluginSettingsRowBase](plugin-ui.md#pluginsettingsrowbase).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [type](#pluginsettingsrow-type) — 4 firmas o variantes
- [options](#pluginsettingsrow-options)
- [min](#pluginsettingsrow-min)
- [max](#pluginsettingsrow-max)
- [step](#pluginsettingsrow-step)

### PluginSettingsRow type

```ts
type: "toggle";
```

```ts
type: "text";
```

```ts
type: "dropdown";
```

```ts
type: "number" | "slider";
```

### PluginSettingsRow options

```ts
options: {
    value: string;
    label: string;
}[];
```

### PluginSettingsRow min

```ts
min?: number;
```

### PluginSettingsRow max

```ts
max?: number;
```

### PluginSettingsRow step

```ts
step?: number;
```

## PluginSettingsRowBase

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
interface PluginSettingsRowBase<T> {
    key: string;
    label: string;
    description?: string;
    value: T;
    onChange: PluginUiCallback<T>;
    validate?: (value: T) => string | undefined;
    disabled?: boolean;
}
```

**Tipos relacionados:** [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [key](#pluginsettingsrowbase-key)
- [label](#pluginsettingsrowbase-label)
- [description](#pluginsettingsrowbase-description)
- [value](#pluginsettingsrowbase-value)
- [onChange](#pluginsettingsrowbase-onchange)
- [validate](#pluginsettingsrowbase-validate)
- [disabled](#pluginsettingsrowbase-disabled)

### PluginSettingsRowBase key

```ts
key: string;
```

### PluginSettingsRowBase label

```ts
label: string;
```

### PluginSettingsRowBase description

```ts
description?: string;
```

### PluginSettingsRowBase value

```ts
value: T;
```

### PluginSettingsRowBase onChange

```ts
onChange: PluginUiCallback<T>;
```

### PluginSettingsRowBase validate

```ts
validate?: (value: T) => string | undefined;
```

| Parámetro | Tipo |
| --- | --- |
| `value` | `T` |

**Devuelve:** `string \| undefined`.

### PluginSettingsRowBase disabled

```ts
disabled?: boolean;
```

## PluginSettingsSchema

Tipo público del SDK, exportado como `PluginSettingsSchema`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginSettingsSchema {
    rows: PluginSettingsRow[];
}
```

**Tipos relacionados:** [PluginSettingsRow](plugin-ui.md#pluginsettingsrow).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [rows](#pluginsettingsschema-rows)

### PluginSettingsSchema rows

```ts
rows: PluginSettingsRow[];
```

## PluginStandardComposerProps

Tipo público del SDK, exportado como `PluginStandardComposerProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginStandardComposerProps {
    composer: PluginComposerProps;
    model: PluginModelPickerProps;
    thinking: PluginThinkingPickerProps;
    dictation: PluginDictationProps;
}
```

**Tipos relacionados:** [PluginComposerProps](plugin-ui.md#plugincomposerprops), [PluginDictationProps](plugin-ui.md#plugindictationprops), [PluginModelPickerProps](plugin-ui.md#pluginmodelpickerprops), [PluginThinkingPickerProps](plugin-ui.md#pluginthinkingpickerprops).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [composer](#pluginstandardcomposerprops-composer)
- [model](#pluginstandardcomposerprops-model)
- [thinking](#pluginstandardcomposerprops-thinking)
- [dictation](#pluginstandardcomposerprops-dictation)

### PluginStandardComposerProps composer

```ts
composer: PluginComposerProps;
```

### PluginStandardComposerProps model

```ts
model: PluginModelPickerProps;
```

### PluginStandardComposerProps thinking

```ts
thinking: PluginThinkingPickerProps;
```

### PluginStandardComposerProps dictation

```ts
dictation: PluginDictationProps;
```

## PluginSurfaceProps

Tipo público del SDK, exportado como `PluginSurfaceProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Contenido de overlay del cuerpo de la página, no un diálogo modal ni un sustituto
de la barra superior/lateral. El cierre por el usuario notifica a onClose; no es un
veto asíncrono. La cancelación/liberación programática hace la limpieza sin
notificación de cierre.

```ts
export interface PluginSurfaceProps {
    title: string;
    background?: "dimmed" | "opaque";
    content: PluginUiContent;
    onClose?: () => void | Promise<void>;
}
```

**Tipos relacionados:** [PluginUiContent](plugin-ui.md#pluginuicontent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [title](#pluginsurfaceprops-title)
- [background](#pluginsurfaceprops-background)
- [content](#pluginsurfaceprops-content)
- [onClose](#pluginsurfaceprops-onclose)

### PluginSurfaceProps title

Solo nombre accesible; los encabezados visibles pertenecen al contenido del plugin.

```ts
title: string;
```

### PluginSurfaceProps background

Por defecto, el fondo translúcido y difuminado al estilo de Chains.

```ts
background?: "dimmed" | "opaque";
```

### PluginSurfaceProps content

```ts
content: PluginUiContent;
```

### PluginSurfaceProps onClose

```ts
onClose?: () => void | Promise<void>;
```

**Devuelve:** `void \| Promise<void>`.

## PluginSurfaceTarget

Tipo público del SDK, exportado como `PluginSurfaceTarget`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Identidad opaca creada por el host para el cuerpo de una página del host montada.

```ts
export interface PluginSurfaceTarget {
    readonly [pluginSurfaceTargetBrand]: true;
}
```

**Tipos relacionados:** [pluginSurfaceTargetBrand](plugin-ui.md#pluginsurfacetargetbrand).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [[pluginSurfaceTargetBrand]](#pluginsurfacetarget-pluginsurfacetargetbrand)

### PluginSurfaceTarget [pluginSurfaceTargetBrand]

```ts
readonly [pluginSurfaceTargetBrand]: true;
```

## pluginSurfaceTargetBrand

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
declare const pluginSurfaceTargetBrand: unique symbol;
```

## PluginThinkingPickerProps

Tipo público del SDK, exportado como `PluginThinkingPickerProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginThinkingPickerProps {
    model: PluginModelValue | undefined;
    value: ThinkingLevel | undefined;
    onChange: PluginUiCallback<ThinkingLevel>;
    disabled?: boolean;
}
```

**Tipos relacionados:** [PluginModelValue](plugin-ui.md#pluginmodelvalue), [PluginUiCallback](plugin-ui.md#pluginuicallback).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [model](#pluginthinkingpickerprops-model)
- [value](#pluginthinkingpickerprops-value)
- [onChange](#pluginthinkingpickerprops-onchange)
- [disabled](#pluginthinkingpickerprops-disabled)

### PluginThinkingPickerProps model

```ts
model: PluginModelValue | undefined;
```

### PluginThinkingPickerProps value

```ts
value: ThinkingLevel | undefined;
```

### PluginThinkingPickerProps onChange

```ts
onChange: PluginUiCallback<ThinkingLevel>;
```

### PluginThinkingPickerProps disabled

```ts
disabled?: boolean;
```

## PluginUi

Tipo público del SDK, exportado como `PluginUi`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Presentación controlada del host: los plugins son propietarios de los valores, la
persistencia y las actualizaciones de los valores aceptados. Cada método devuelve un
manejador de actualización superficial y liberación idempotente, con ámbito en
options.signal más la activación; los ámbitos cancelados producen manejadores inertes.
El host informa de los fallos de interacción asíncronos; no se guardan en silencio.

```ts
export interface PluginUi {
    mountModelPicker(container: HTMLElement, props: PluginModelPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginModelPickerProps>;
    mountThinkingPicker(container: HTMLElement, props: PluginThinkingPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginThinkingPickerProps>;
    mountKnowledgePicker(container: HTMLElement, props: PluginKnowledgePickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginKnowledgePickerProps>;
    mountComposer(container: HTMLElement, props: PluginComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginComposerProps>;
    mountDictation(container: HTMLElement, props: PluginDictationProps, options: PluginWidgetOptions): PluginDictationHandle;
    mountStandardComposer(container: HTMLElement, props: PluginStandardComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginStandardComposerProps>;
    mountButton(container: HTMLElement, props: PluginButtonProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginButtonProps>;
    mountBadge(container: HTMLElement, props: PluginBadgeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginBadgeProps>;
    mountSettingsRows(container: HTMLElement, props: PluginSettingsSchema, options: PluginWidgetOptions): PluginWidgetHandle<PluginSettingsSchema>;
    mountMarkdown(container: HTMLElement, props: PluginMarkdownProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMarkdownProps>;
    mountTree(container: HTMLElement, tree: PluginTreeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginTreeProps>;
    mountWorkerResult(container: HTMLElement, props: PluginWorkerResultProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginWorkerResultProps>;
    openMenu(anchor: HTMLElement, props: PluginMenuProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMenuProps>;
    openDialog(props: PluginDialogProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginDialogProps>;
    openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
    openSurface(target: PluginSurfaceTarget, props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
}
```

**Tipos relacionados:** [PluginBadgeProps](plugin-ui.md#pluginbadgeprops), [PluginButtonProps](plugin-ui.md#pluginbuttonprops), [PluginComposerProps](plugin-ui.md#plugincomposerprops), [PluginDialogProps](plugin-ui.md#plugindialogprops), [PluginDictationHandle](plugin-ui.md#plugindictationhandle), [PluginDictationProps](plugin-ui.md#plugindictationprops), [PluginKnowledgePickerProps](plugin-ui.md#pluginknowledgepickerprops), [PluginMarkdownProps](plugin-ui.md#pluginmarkdownprops), [PluginMenuProps](plugin-ui.md#pluginmenuprops), [PluginModelPickerProps](plugin-ui.md#pluginmodelpickerprops), [PluginSettingsSchema](plugin-ui.md#pluginsettingsschema), [PluginStandardComposerProps](plugin-ui.md#pluginstandardcomposerprops), [PluginSurfaceProps](plugin-ui.md#pluginsurfaceprops), [PluginSurfaceTarget](plugin-ui.md#pluginsurfacetarget), [PluginThinkingPickerProps](plugin-ui.md#pluginthinkingpickerprops), [PluginTreeProps](plugin-tree.md#plugintreeprops), [PluginWidgetHandle](plugin-ui.md#pluginwidgethandle), [PluginWidgetOptions](plugin-ui.md#pluginwidgetoptions), [PluginWorkerResultProps](plugin-ui.md#pluginworkerresultprops).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [mountModelPicker](#pluginui-mountmodelpicker)
- [mountThinkingPicker](#pluginui-mountthinkingpicker)
- [mountKnowledgePicker](#pluginui-mountknowledgepicker)
- [mountComposer](#pluginui-mountcomposer)
- [mountDictation](#pluginui-mountdictation)
- [mountStandardComposer](#pluginui-mountstandardcomposer)
- [mountButton](#pluginui-mountbutton)
- [mountBadge](#pluginui-mountbadge)
- [mountSettingsRows](#pluginui-mountsettingsrows)
- [mountMarkdown](#pluginui-mountmarkdown)
- [mountTree](#pluginui-mounttree)
- [mountWorkerResult](#pluginui-mountworkerresult)
- [openMenu](#pluginui-openmenu)
- [openDialog](#pluginui-opendialog)
- [openSurface](#pluginui-opensurface) — 2 firmas o variantes

### PluginUi mountModelPicker

Monta la selección de modelo del catálogo del host; devuelve un manejador de selector
controlado. No cambia los valores por defecto del núcleo, no refresca cuentas en silencio
ni elige una alternativa.

```ts
mountModelPicker(container: HTMLElement, props: PluginModelPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginModelPickerProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginModelPickerProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginModelPickerProps>`.

### PluginUi mountThinkingPicker

Monta la selección del nivel de razonamiento para el modelo y el valor indicados. Devuelve
un manejador controlado; seleccionar por sí solo no actualiza los ajustes del plugin ni del
núcleo.

```ts
mountThinkingPicker(container: HTMLElement, props: PluginThinkingPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginThinkingPickerProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginThinkingPickerProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginThinkingPickerProps>`.

### PluginUi mountKnowledgePicker

Monta la burbuja nativa de selección de conocimiento o el selector de Chains. Refleja
onChange de inmediato mediante el manejador devuelto; Hecho/X/Escape no descartan la
selección. El host gestiona el origen, el foco y la vida del selector; no se añade ninguna
API de escritura en el grafo.

```ts
mountKnowledgePicker(container: HTMLElement, props: PluginKnowledgePickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginKnowledgePickerProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginKnowledgePickerProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginKnowledgePickerProps>`.

### PluginUi mountComposer

Monta un compositor de texto controlado con callbacks de envío y detención y devuelve su
manejador. No se añade gestión por defecto de adjuntos o de soltar ficheros ni despacho al
modelo; quien lo use de forma independiente coordina por su cuenta la finalización del
dictado.

```ts
mountComposer(container: HTMLElement, props: PluginComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginComposerProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginComposerProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginComposerProps>`.

### PluginUi mountDictation

Monta el dictado nativo solo hacia onTranscript; devuelve update/dispose más los controles
toggle/finish/cancel. La cancelación o la liberación cancelan la captura. El dictado nunca
va a un compositor nativo oculto; la propiedad de la grabación es por ventana.

```ts
mountDictation(container: HTMLElement, props: PluginDictationProps, options: PluginWidgetOptions): PluginDictationHandle;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginDictationProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginDictationHandle`.

### PluginUi mountStandardComposer

Monta una entrada de texto con controles de modelo, razonamiento y dictado. Termina el
dictado antes de onSend; no incluye controles de adjuntos, de uso ni de práctica. Devuelve
un manejador controlado; al actualizar, sustituye completas las props de los controles
anidados.

```ts
mountStandardComposer(container: HTMLElement, props: PluginStandardComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginStandardComposerProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginStandardComposerProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginStandardComposerProps>`.

### PluginUi mountButton

Monta un botón de estilo nativo y devuelve su manejador. El SVG es marcado de confianza del
plugin. Las combinaciones no válidas de etiqueta, icono y color lanzan una excepción al
montar o actualizar; las actualizaciones se rechazan de forma atómica. onClick no persiste
ni despacha nada implícitamente.

```ts
mountButton(container: HTMLElement, props: PluginButtonProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginButtonProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginButtonProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginButtonProps>`.

### PluginUi mountBadge

Monta un distintivo de estado de texto plano, no de calificación ni de colocación
automática. Devuelve un manejador de actualización y liberación; las props de texto o color
no válidas se rechazan de forma atómica.

```ts
mountBadge(container: HTMLElement, props: PluginBadgeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginBadgeProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginBadgeProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginBadgeProps>`.

### PluginUi mountSettingsRows

Monta campos de ajustes controlados y devuelve su manejador; no hay lecturas ni guardados
automáticos. Los fallos de validación o de rango se quedan en línea sin persistencia de
onChange; los guardados asíncronos pendientes desactivan su fila y los fallos se muestran.

```ts
mountSettingsRows(container: HTMLElement, props: PluginSettingsSchema, options: PluginWidgetOptions): PluginWidgetHandle<PluginSettingsSchema>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginSettingsSchema` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginSettingsSchema>`.

### PluginUi mountMarkdown

Monta Markdown completo mediante el render integrado del host, incluidas matemáticas y
código, sin controles auxiliares ni renderizadores de bloques cercados registrados por
plugins. Devuelve un manejador de actualización de texto y liberación; no se inicia trabajo
de modelo, de almacenamiento ni de workers.

```ts
mountMarkdown(container: HTMLElement, props: PluginMarkdownProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMarkdownProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginMarkdownProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginMarkdownProps>`.

### PluginUi mountTree

Monta una jerarquía accesible y controlada, no un controlador de ficheros o mazos. Devuelve
un manejador; los árboles no válidos lanzan una excepción al montar o actualizar. Plegar,
eliminar o sustituir limpia los montajes de contenido afectados, así que conserva los
borradores en el estado del plugin.

```ts
mountTree(container: HTMLElement, tree: PluginTreeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginTreeProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `tree` | `PluginTreeProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginTreeProps>`.

### PluginUi mountWorkerResult

Monta la presentación de un resultado terminal de worker y devuelve su manejador. Solo
representa el estado, el texto y el contenido aportados; no inicia, espera ni cancela
ninguna tarea. El contenido opcional tiene ámbito en la señal y se limpia al sustituirlo o
liberarlo.

```ts
mountWorkerResult(container: HTMLElement, props: PluginWorkerResultProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginWorkerResultProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `container` | `HTMLElement` |
| `props` | `PluginWorkerResultProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginWorkerResultProps>`.

### PluginUi openMenu

Abre un menú anclado y devuelve su manejador. El mismo propietario de interfaz + el mismo
ancla exacto cierran un menú existente, llaman una vez a su onClose más reciente y devuelven
un manejador inerte. Los demás propietarios y anclas son independientes. La cancelación o
la liberación no llaman a onClose; las anclas desconectadas o los ámbitos caducados
devuelven manejadores inertes.

```ts
openMenu(anchor: HTMLElement, props: PluginMenuProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMenuProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `anchor` | `HTMLElement` |
| `props` | `PluginMenuProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginMenuProps>`.

### PluginUi openDialog

Abre un modal con título accesible y contenido propiedad del plugin; devuelve su manejador.
El contenido recibe una señal de montaje y limpieza síncrona o asíncrona. El host es
propietario del cierre, de Escape y del foco; el título no crea un encabezado visible.

```ts
openDialog(props: PluginDialogProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginDialogProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `PluginDialogProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginDialogProps>`.

### PluginUi openSurface

Captura una vez la página activa del host, para toda la vida de esta superficie; devuelve un
manejador de overlay. Salir de la página u ocultarla la hace caducar, no una página
posterior tras los await. Si falta un límite vivo se lanza una excepción; las señales ya
canceladas devuelven antes manejadores inertes.

```ts
openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `PluginSurfaceProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginSurfaceProps>`.

Se vincula explícitamente a una instancia de página existente, incluidos los destinos
de envío nativos; devuelve un manejador de overlay. Los destinos son opacos, no
persistentes y no reviven al volver a entrar. Los destinos ausentes o caducados lanzan
una excepción salvo que ya estén cancelados; los cuerpos cubiertos siguen montados, con
el apilamiento, la interacción y el foco gestionados por el host.

```ts
openSurface(target: PluginSurfaceTarget, props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `target` | `PluginSurfaceTarget` |
| `props` | `PluginSurfaceProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginSurfaceProps>`.

## PluginUiCallback

Tipo público del SDK, exportado como `PluginUiCallback`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Callback de interacción invocado por el host; los fallos asíncronos se notifican,
no se aceptan como persistencia correcta. Los callbacks no cambian por sí solos los
valores controlados.

```ts
export type PluginUiCallback<T = void> = (value: T) => void | Promise<void>;
```

## PluginUiContent

Tipo público del SDK, exportado como `PluginUiContent`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

El contenido sigue siendo propiedad del plugin; mount puede devolver una limpieza, también de forma asíncrona.

```ts
export type PluginUiContent = HTMLElement | ((container: HTMLElement, signal: AbortSignal) => void | (() => void) | Promise<void | (() => void)>);
```

## PluginWidgetHandle

Tipo público del SDK, exportado como `PluginWidgetHandle`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Controla un registro/montaje; los manejadores no persisten valores del plugin.

```ts
export interface PluginWidgetHandle<Props> {
    update(props: Partial<Props>): void;
    dispose(): void;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [update](#pluginwidgethandle-update)
- [dispose](#pluginwidgethandle-dispose)

### PluginWidgetHandle update

Fusiona superficialmente props y callbacks; sustituye enteros los objetos/arrays
anidados. Publica de forma explícita los valores aceptados. Los manejadores
liberados ignoran las actualizaciones; donde las props se validan, las
actualizaciones no válidas lanzan antes de sustituir las props actuales.

```ts
update(props: Partial<Props>): void;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `Partial<Props>` |

**Devuelve:** `void`.

### PluginWidgetHandle dispose

Libera de forma idempotente este registro/montaje y sus recursos con ámbito.
Las señales del contenido de la interfaz se abortan y se ejecuta la limpieza;
liberar explícitamente un overlay no es una notificación de cierre por el
usuario y no llama a onClose.

```ts
dispose(): void;
```

**Devuelve:** `void`.

## PluginWidgetOptions

Tipo público del SDK, exportado como `PluginWidgetOptions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Vida obligatoria del llamador, combinada con la activación del plugin y con la vida
de cualquier superficie del host propietaria. Pasa una señal por montaje para la
interfaz dentro de una vista.

```ts
export interface PluginWidgetOptions {
    signal: AbortSignal;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [signal](#pluginwidgetoptions-signal)

### PluginWidgetOptions signal

```ts
signal: AbortSignal;
```

## PluginWorkerResultProps

Tipo público del SDK, exportado como `PluginWorkerResultProps`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface PluginWorkerResultProps {
    label: string;
    status: "succeeded" | "failed" | "cancelled" | "interrupted";
    text: string;
    content?: PluginUiContent;
    presentation?: "collapsed" | "card" | "plain";
}
```

**Tipos relacionados:** [PluginUiContent](plugin-ui.md#pluginuicontent).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [label](#pluginworkerresultprops-label)
- [status](#pluginworkerresultprops-status)
- [text](#pluginworkerresultprops-text)
- [content](#pluginworkerresultprops-content)
- [presentation](#pluginworkerresultprops-presentation)

### PluginWorkerResultProps label

```ts
label: string;
```

### PluginWorkerResultProps status

```ts
status: "succeeded" | "failed" | "cancelled" | "interrupted";
```

### PluginWorkerResultProps text

```ts
text: string;
```

### PluginWorkerResultProps content

```ts
content?: PluginUiContent;
```

### PluginWorkerResultProps presentation

```ts
presentation?: "collapsed" | "card" | "plain";
```
