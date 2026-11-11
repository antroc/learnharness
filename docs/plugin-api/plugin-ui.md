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

Generic native-style badge. No grading semantics or automatic placement.

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

CSS color for text and a 15% background tint. Omit for the native neutral badge.

```ts
color?: string;
```

## PluginButtonColors

Tipo público del SDK, exportado como `PluginButtonColors`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

CSS colors only; state overrides cascade per property, not as complete palettes.

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

Visible text, or the accessible name when iconOnly is true.

```ts
label: string;
```

### PluginButtonProps icon

Trusted plugin SVG markup, rendered decoratively before the label.

```ts
icon?: string;
```

### PluginButtonProps iconOnly

Hide visible text; requires a nonblank label and icon. Size remains independent.

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

Validated for every variant, applied only to custom. Updates replace this whole object.

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

Modal content with host close/focus handling and no visible host title row.
User close notifies onClose, not an async veto; disposal/abort only cleans up.

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

Accessible name only; visible headings belong to plugin content.

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

Start recording when idle, or stop and keep speech when active. One recording
owner is allowed per window; a competing start reports an error.

```ts
toggle(): void;
```

**Devuelve:** `void`.

### PluginDictationHandle finish

Stop this recording and await transcript delivery before sending. Does not
start capture when idle; delivery failures can reject. This does not send a
message or update a hidden native composer.

```ts
finish(): Promise<void>;
```

**Devuelve:** `Promise<void>`.

### PluginDictationHandle cancel

Cancel capture and discard buffered speech rather than flushing it. Does not
undo text already delivered through onTranscript. Disposal/abort also cancels.

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

Built-in host Markdown rendering without auxiliary controls or plugin code-block widgets.

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

Page-body overlay content, not a modal dialog or top-bar/sidebar replacement.
User close notifies onClose; it is not an asynchronous veto. Abort/programmatic
disposal performs cleanup without a close notification.

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

Accessible name only; visible headings belong to plugin content.

```ts
title: string;
```

### PluginSurfaceProps background

Defaults to the translucent, blurred Chains-like background.

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

Opaque host-created identity for one mounted host page body.

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

Controlled host presentation: plugins own values, persistence and accepted-value
updates. Every method returns a shallow-update/idempotent-dispose handle and is
scoped to options.signal plus activation; aborted scopes produce inert handles.
Async interaction failures are reported by the host, not silently saved.

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

Mount host-catalog model selection; returns a controlled picker handle.
Does not change core defaults, silently refresh accounts or choose a fallback.

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

Mount thinking-level selection for the supplied model/value. Returns a
controlled handle; selection alone does not update plugin or core settings.

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

Mount the native knowledge-selection bubble/Chains picker. Reflect onChange
immediately via the returned handle; Done/X/Escape do not discard selection.
Host manages origin, focus and selector lifetime; no graph-write API is added.

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

Mount a controlled text composer with send/stop callbacks and return its
handle. No default attachment/drop handling or model dispatch is added;
standalone users coordinate dictation completion themselves.

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

Mount native dictation into onTranscript only; returns update/dispose plus
toggle/finish/cancel controls. Abort/dispose cancels capture. Speech never
targets a hidden native composer; recording ownership is per window.

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

Mount text entry with model/thinking/dictation controls. Finishes dictation
before onSend; no attachment, usage or practice controls are included. Returns
a controlled handle; replace whole nested control props on update.

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

Mount a native-style button and return its handle. SVG is trusted plugin
markup. Invalid label/icon/color combinations throw on mount/update; updates
reject atomically. onClick does not implicitly persist or dispatch anything.

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

Mount a plain-text status badge, not grading or automatic placement. Returns
an update/dispose handle; invalid text/color props reject atomically.

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

Mount controlled settings fields and return their handle; no automatic reads
or saves. Validation/range failures stay inline without onChange persistence;
pending async saves disable their row and failures are shown.

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

Mount complete Markdown through built-in host rendering, including math/code,
without auxiliary controls or registered plugin fence renderers. Returns a
text-update/dispose handle; no model, storage or worker work is started.

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

Mount a controlled accessible hierarchy, not a file/deck controller. Returns
a handle; invalid trees throw on mount/update. Collapse/removal/replacement
cleans affected content mounts, so retain drafts in plugin state.

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

Mount a terminal worker-result presentation and return its handle. This only
renders supplied status/text/content; it does not start, wait for or cancel a
task. Optional content is signal-scoped and cleaned on replacement/disposal.

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

Open an anchored menu and return its handle. Same UI owner + exact anchor
toggles an existing menu closed, calls its latest onClose once, and returns
an inert handle. Other owners/anchors are independent. Abort/dispose does not
call onClose; detached anchors/expired scopes return inert handles.

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

Open a modal with accessible title and plugin-owned content; returns its
handle. Content gets a mount signal and sync/async cleanup. Host owns close,
Escape and focus; title does not create a visible heading.

```ts
openDialog(props: PluginDialogProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginDialogProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `PluginDialogProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginDialogProps>`.

### PluginUi openSurface

Capture the active host page once, for this surface's whole lifetime; return
an overlay handle. Page leave/hide expires it, not a later page after awaits.
A missing live boundary throws; already-aborted signals return inert handles first.

```ts
openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `PluginSurfaceProps` |
| `options` | `PluginWidgetOptions` |

**Devuelve:** `PluginWidgetHandle<PluginSurfaceProps>`.

Bind explicitly to an existing page instance, including native submission
targets; returns an overlay handle. Targets are opaque, nonpersistent and do
not revive on re-entry. Missing/expired targets throw unless already aborted;
covered bodies stay mounted, with host-owned stacking/interaction/focus.

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

Host-invoked interaction callback; async failures are reported, not accepted as
successful persistence. Callbacks do not change controlled values by themselves.

```ts
export type PluginUiCallback<T = void> = (value: T) => void | Promise<void>;
```

## PluginUiContent

Tipo público del SDK, exportado como `PluginUiContent`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Content stays plugin-owned; mount may return cleanup, including asynchronously.

```ts
export type PluginUiContent = HTMLElement | ((container: HTMLElement, signal: AbortSignal) => void | (() => void) | Promise<void | (() => void)>);
```

## PluginWidgetHandle

Tipo público del SDK, exportado como `PluginWidgetHandle`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Control one registration/mount; handles do not persist plugin values.

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

Shallow-merge props and callbacks; replace whole nested objects/arrays.
Publish accepted values explicitly. Disposed handles ignore updates; where
props are validated, invalid updates throw before replacing current props.

```ts
update(props: Partial<Props>): void;
```

| Parámetro | Tipo |
| --- | --- |
| `props` | `Partial<Props>` |

**Devuelve:** `void`.

### PluginWidgetHandle dispose

Idempotently release this registration/mount and its scoped resources.
UI content signals abort and cleanup runs; explicit overlay disposal is not
a user close notification and does not call onClose.

```ts
dispose(): void;
```

**Devuelve:** `void`.

## PluginWidgetOptions

Tipo público del SDK, exportado como `PluginWidgetOptions`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Required caller lifetime, combined with plugin activation and any owning host
surface lifetime. Pass a per-mount signal for UI inside a view.

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
