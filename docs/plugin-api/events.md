# events

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [ServerEvent](#serverevent) — declaración de apoyo
- [ServerEvents](#serverevents) — declaración de apoyo
- [ServerEventType](#servereventtype) — declaración de apoyo

## ServerEvent

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Una notificación: se distribuye sobre el vocabulario para que estrechar
`type` estreche de verdad su carga (incluidos los mensajes con ámbito de
plugin).

```ts
export type ServerEvent<K extends ServerEventType = ServerEventType> = {
    [T in K]: {
        type: T;
    } & ServerEvents[T];
}[K];
```

**Tipos relacionados:** [ServerEvents](events.md#serverevents), [ServerEventType](events.md#servereventtype).

## ServerEvents

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Notificaciones en vivo de la app para cambios de turnos, tareas, registros
y disponibilidad. Los consumidores obtienen el estado autoritativo tras una
notificación y lo vuelven a obtener al reconectar; las notificaciones no son
un registro duradero que se pueda reproducir. El canal de mensajes de
plugins lleva además datos JSON con ámbito de plugin, con la misma
limitación de entrega solo en vivo.

El vocabulario de eventos del núcleo más el canal de extensión de plugins con espacio de nombres.

```ts
export interface ServerEvents {
    "turn-started": {
        chatId: string;
    };
    "turn-settled": {
        chatId: string;
    };
    "jobs-changed": {
        chatId?: string;
    };
    "activity-changed": Record<string, never>;
    "chats-changed": Record<string, never>;
    "sources-changed": Record<string, never>;
    "subscriptions-changed": Record<string, never>;
    "record-changed": {
        chatId: string;
    };
    "compaction-changed": {
        chatId: string;
        running: boolean;
    };
    "side-chats-changed": {
        chatId: string;
    };
    "plugins-changed": Record<string, never>;
    "plugin-message": {
        pluginId: string;
        topic: string;
        data?: unknown;
    };
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- ["turn-started"](#serverevents-turn-started)
- ["turn-started".chatId](#serverevents-turn-startedchatid)
- ["turn-settled"](#serverevents-turn-settled)
- ["turn-settled".chatId](#serverevents-turn-settledchatid)
- ["jobs-changed"](#serverevents-jobs-changed)
- ["jobs-changed".chatId](#serverevents-jobs-changedchatid)
- ["activity-changed"](#serverevents-activity-changed)
- ["chats-changed"](#serverevents-chats-changed)
- ["sources-changed"](#serverevents-sources-changed)
- ["subscriptions-changed"](#serverevents-subscriptions-changed)
- ["record-changed"](#serverevents-record-changed)
- ["record-changed".chatId](#serverevents-record-changedchatid)
- ["compaction-changed"](#serverevents-compaction-changed)
- ["compaction-changed".chatId](#serverevents-compaction-changedchatid)
- ["compaction-changed".running](#serverevents-compaction-changedrunning)
- ["side-chats-changed"](#serverevents-side-chats-changed)
- ["side-chats-changed".chatId](#serverevents-side-chats-changedchatid)
- ["plugins-changed"](#serverevents-plugins-changed)
- ["plugin-message"](#serverevents-plugin-message)
- ["plugin-message".pluginId](#serverevents-plugin-messagepluginid)
- ["plugin-message".topic](#serverevents-plugin-messagetopic)
- ["plugin-message".data](#serverevents-plugin-messagedata)

### ServerEvents "turn-started"

Empezó un turno nativo de conversación en el servidor, incluidos los
envíos, los turnos de despertar y los turnos iniciados desde otra ventana.

```ts
"turn-started": {
    chatId: string;
};
```

### ServerEvents "turn-started".chatId

```ts
chatId: string;
```

### ServerEvents "turn-settled"

Un turno se asentó tras persistirse. Vuelve a obtener el registro
guardado; esto no significa que la extracción asíncrona o el trabajo en
segundo plano hayan terminado.

```ts
"turn-settled": {
    chatId: string;
};
```

### ServerEvents "turn-settled".chatId

```ts
chatId: string;
```

### ServerEvents "jobs-changed"

Cambió el registro de una tarea (envío, progreso, asentamiento, aborto,
recuperación). chatId cuando se conoce — los consumidores que poseen un
chat filtran por él.

```ts
"jobs-changed": {
    chatId?: string;
};
```

### ServerEvents "jobs-changed".chatId

```ts
chatId?: string;
```

### ServerEvents "activity-changed"

Una ejecución de extracción cambió de fase (dock de actividad).

```ts
"activity-changed": Record<string, never>;
```

### ServerEvents "chats-changed"

Cambió la lista de sesiones (crear, borrar, título).

```ts
"chats-changed": Record<string, never>;
```

### ServerEvents "sources-changed"

Cambiaron el inventario de fuentes, los nombres mostrados o las carpetas organizativas.

```ts
"sources-changed": Record<string, never>;
```

### ServerEvents "subscriptions-changed"

Cambió el estado de una suscripción web. Ni datos de cuenta ni credenciales en el bus.

```ts
"subscriptions-changed": Record<string, never>;
```

### ServerEvents "record-changed"

El registro de un chat cambió SIN un turno (la escritura silenciosa del
descarte). El mismo contrato de notificar y luego obtener que los eventos
de turno: las vistas abiertas del chat vuelven a obtenerlo y adoptan el
registro duradero.

```ts
"record-changed": {
    chatId: string;
};
```

### ServerEvents "record-changed".chatId

```ts
chatId: string;
```

### ServerEvents "compaction-changed"

Empezó o terminó la compactación del contexto de este chat. Mientras
running es true, el servidor bloquea la interacción con el modelo y el
cliente desactiva el envío relacionado del compositor/dock. Es estado en
vivo, no un marcador persistido.

```ts
"compaction-changed": {
    chatId: string;
    running: boolean;
};
```

### ServerEvents "compaction-changed".chatId

```ts
chatId: string;
```

### ServerEvents "compaction-changed".running

```ts
running: boolean;
```

### ServerEvents "side-chats-changed"

Cambió una conversación lateral. Notificar y luego obtener: las vistas
abiertas vuelven a pedir GET /api/chats/:id/side-chats. Cerrarla nunca la
borra.

```ts
"side-chats-changed": {
    chatId: string;
};
```

### ServerEvents "side-chats-changed".chatId

```ts
chatId: string;
```

### ServerEvents "plugins-changed"

Cambió la disponibilidad o el ciclo de vida de los plugins; vuelve a obtener los paquetes instalados.

```ts
"plugins-changed": Record<string, never>;
```

### ServerEvents "plugin-message"

Notificaciones solo en vivo con ámbito de plugin. Al reconectar hay que resincronizar con una instantánea.

```ts
"plugin-message": {
    pluginId: string;
    topic: string;
    data?: unknown;
};
```

### ServerEvents "plugin-message".pluginId

```ts
pluginId: string;
```

### ServerEvents "plugin-message".topic

```ts
topic: string;
```

### ServerEvents "plugin-message".data

```ts
data?: unknown;
```

## ServerEventType

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

```ts
export type ServerEventType = keyof ServerEvents;
```

**Tipos relacionados:** [ServerEvents](events.md#serverevents).
