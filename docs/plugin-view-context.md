# Contexto de vista de toda la sesión para acciones — API v1

El contexto de solo lectura de toda la sesión es infraestructura general, no una API
específica de Drawing Pad ni limitada a la pregunta actual. Esto describe el código fuente y
la compilación correspondientes. Usa el `bundle.json` de la skill descargada para identificar
la app; la API v1 por sí sola no identifica todas las capacidades disponibles. Los tipos
públicos están en `src/core/plugin-view-context.ts` y en el SDK de solo tipos correspondiente.

## Punto de entrada público

Una acción de la barra superior de la sesión, o una acción con atajo invocada sobre una
sesión, recibe `context.view: PluginSessionViewContext` de solo lectura. Las invocaciones por
teclado usan `placement: "keyboard"`; consulta
[atajos de acciones](plugin-authoring.md#atajos-de-acciones) para las reglas de activación y
de ámbito:

```ts
ctx.registerAction({
  id: "inspect-session",
  name: "Inspect session",
  run(context) {
    if (context.surface !== "session") return;
    const view = context.view;
    console.log(view.title, view.messages.length, view.composer.text);
    if (view.input.type === "answer") {
      // El orden de visualización nativo real, no una mezcla/parser hecho por el consumidor.
      const options = view.input.question.options;
      const selectedValues = view.input.draft.values;
      console.log(view.input.revealed, options, selectedValues);
    }
  },
});
ctx.placeAction({
  id: "inspect-session",
  actionId: "inspect-session",
  location: "top-bar",
  sessions: ["teaching", "practice"],
});
```

Los campos existentes `placement`, `surface`, `sessionId`, `kind` y el `surfaceTarget` opaco
no cambian. Los contextos de la barra lateral y del grafo y los contextos de acción de vistas
propiedad de plugins no obtienen una instantánea de la sesión del host. Las vistas propiedad
de plugins conservan su identidad de propietario/vista; su plugin propietario ya es dueño de
su estado privado. No hay un serializador automático para un DOM arbitrario de plugin ni un
protocolo nuevo de proveedor de contexto para vistas de plugins.

## La vista completa, no solo un envío

`PluginSessionViewContext` contiene:

| Campo | Significado |
| --- | --- |
| `sessionId`, `kind`, `title` | La identidad de la sesión subyacente, su tipo enseñanza/práctica y su título confirmado actual. |
| `messages` | El historial nativo actual completo del navegador, desconectado, con la misma visibilidad que los mensajes del contexto de envío, incluido el contenido que pueda estar en streaming u optimista. |
| `transcript` | La transcripción proyectada existente del host (datos `LhViewMessage`), con su agrupación y sus partes. No es una serialización del DOM, una captura de pantalla ni una transcripción analizada por separado. |
| `status` | El estado de sesión existente: `ready`, `submitted`, `streaming` o `error`. |
| `reconciliation` | El estado de sincronización canónica existente: `ready`, `syncing` o `failed`. |
| `busy`, `compacting` | El estado actual de turno/conciliación del host y de compactación. |
| `phase` | La fase mostrada: `probe`, `plan`, `teach` o `practice`. |
| `contextTokens` | La estimación existente de uso de contexto de la conversación completada, o `null`. |
| `queuedSteers` | Las reorientaciones del alumno en cola visibles en ese momento, con `id` y `text`. |
| `composer.text` | El texto exacto sin enviar del compositor, que se conserva incluso mientras una pregunta/problema ocupa el dock. |
| `input` | La entrada actual seleccionada por el host, su estado de presentación aplicable y los valores sin enviar del alumno. |

El historial **no** se limita a los campos de pregunta orientados al alumno. Puede contener
argumentos de herramientas, compromisos, razonamiento, contenidos personalizados y otros
registros nativos ya expuestos. Esta API para plugins locales de confianza no crea una nueva
frontera de secreto ni promete persistencia canónica, entrega aceptada ni semántica de
exactamente una vez. Las partes de la transcripción proyectada son datos del modelo de vista;
el renderizado final todavía puede ocultar partes pendientes en favor del dock. Ninguno de los
dos campos afirma que cada byte se esté pintando en ese momento en el viewport.

## Entrada actual y entrada sin enviar del alumno

`PluginSessionViewInput` reutiliza los tipos existentes de destino de envío, incluidas las
apariciones exactas `{messageId, contentIndex, toolCallId, toolName}`, la identidad de la
sesión, los canales aplicables y el destino de superficie opaco existente. **No** es un
intento de envío.

- **`text`**: el destino de contenido ordinario existente. El borrador conservado es
  `view.composer.text`.
- **`answer`**: la `question` nativa orientada al alumno, con el orden real de las opciones
  tal como se muestran/mezclan, el contexto Markdown, las descripciones de opciones
  aplicables, la aparición exacta y un `questionType` opcional. Añade `expanded`, `revealed`,
  `available` y `draft`. `PluginNativeQuestionViewDraft` contiene `dontKnow`, los `values`
  seleccionados estables, `otherSelected`, `other`, `text`, `thinking`, `readingThinking` y,
  opcionalmente, la `confidence` numérica mostrada. El texto de Otra se conserva aunque su
  fila no esté seleccionada. Los valores son borradores en bruto, no un envoltorio de
  respuesta normalizado/evaluado; no se recortan los espacios.
- **`thinking`**: el destino/enunciado de práctica nativo existente y la aparición exacta,
  más `expanded` y `draft.thinking`.
- **`plugin-question-answer`**: la identidad/metadatos existentes del destino de pregunta de
  plugin, más la `input` guardada con su contenido, `expanded`, `revealed`, el `available` de
  la implementación y `draft: {answer, thinking, readingThinking}`.
- **`plugin-problem-submission`**: la identidad/metadatos existentes del destino de problema
  de plugin, más la `input` guardada con su contenido, `expanded`, el `available` de la
  implementación y `draft: {submission, thinking}`.
- **`unavailable`**: el host no puede interpretar/leer la entrada pendiente. Lleva
  `expanded`, `revealed` y la aparición exacta cuando se conoce. No inventa una alternativa
  de compositor/nativa ni fabrica un contrato respondible.

El estado del borrador personalizado de `answer`/`submission` es el estado real publicado por
el editor: `{status:"empty"}` o `{status:"unready"|"ready",value:JsonValue}`. Los valores JSON
finitos falsy y vacíos se mantienen exactos. El estado privado del editor que un plugin no ha
publicado no se lee inspeccionando su DOM. Del mismo modo, el material privado sin enviar de
plugins externos no se recoge en silencio. Estos campos son informativos; ni `available` ni el
estado `ready` de un editor conceden por sí solos permiso para enviar.

La `question` estructurada de la pregunta nativa usa la proyección `ClientQuestion`
existente, no sus claves de respuesta, explicación ni respuesta comprometida. El historial
completo sigue disponible por separado, sin filtrado artificial. Los indicadores de
revelado/plegado **describen** la interfaz del host: los datos de una pregunta no revelada
siguen siendo inspeccionables, pero una lectura nunca abre ni revela la pregunta. Un
consumidor que decida qué renderizar como referencia para el alumno debe usar los
indicadores proporcionados y el comportamiento de su propio producto, no fingir que los datos
inspeccionables ya están a la vista.

## Instantánea, identidad y ciclo de vida

- Una invocación real de una acción captura una instantánea nueva **antes** de llamar al
  `run` del plugin. Volver a leer `context.view` durante o después de un await devuelve esa
  misma instantánea desconectada; no sigue la navegación, una aparición más reciente ni las
  ediciones posteriores del alumno.
- Los datos de la instantánea son recursivamente de solo lectura/congelados. El historial
  nativo, la transcripción proyectada, la entrada/contenido y los valores del borrador están
  desconectados del estado vivo del host. Las capturas no conceden setters, callbacks de envío
  ni handles de componentes privados.
- Los destinos de superficie opacos existentes siguen siendo capacidades vivas del host. A
  propósito, no se clonan como JSON ni se congelan. Un destino capturado sigue refiriéndose a
  su vista subyacente original; las reglas normales del ciclo de vida de las superficies rigen
  su uso posterior. Una vista obsoleta no puede sustituir en silencio el contenido de una
  sesión nueva.
- Los predicados dinámicos `disabled(context)` reciben la misma forma de solo lectura. Su
  instantánea en tiempo de renderizado es diferida/compartida para ese renderizado; el clic o
  el atajo final captura de nuevo y vuelve a comprobar el estado desactivado. Los propietarios
  de entrada del host avisan al renderizado normal de React cuando cambian su presentación
  pública o sus borradores. El estado externo propiedad del plugin sigue usando el mecanismo
  existente `refreshActions()`.
- Los fallos de captura los contiene el tratamiento de errores existente de las acciones de
  plugins. No se ejecuta ninguna acción si su vista de origen ha desaparecido antes de la
  captura.

No hay una API pública de suscripción ni de contexto global mutable, ni un servicio de
capturas de pantalla, ni una adición de atajos de teclado en bruto, ni un modelo nuevo de
estado de sesión. Leer una instantánea no termina el dictado, ni pide acceso al micrófono, ni
guarda borradores, ni invoca interceptores de envío, ni procesa/evalúa, envía, acusa recibo o
lanza una petición al modelo. Informa de los valores escritos/publicados actuales, no fuerza
el vaciado del habla pendiente.

## Implementación en el host y pruebas

`components/chat.tsx` proporciona su historial nativo existente, la transcripción proyectada,
los metadatos de la sesión actual y las factorías compartidas de destinos de envío. Su dock
nativo publica un lector privado local a la vista. Los componentes de pregunta/práctica
montados leen su presentación real y el estado del borrador respaldado por refs; los
componentes personalizados exponen el valor de editor que ya han publicado y su
disponibilidad. La limpieza pertenece a cada generación. No se introduce un segundo parser
del historial, ni una mezcla independiente, ni inspección del DOM, ni un almacén global, ni
sondeo periódico, ni dependencias de plugins de producto.

Prueba los tipos del SDK de solo lectura/discriminados, la copia completa del contexto, los
contenidos/estados de editor personalizados, la entrada no disponible, las lecturas de los
propietarios de entrada nativos, los borradores sin recortar, la limpieza, la frescura de las
acciones en línea/desbordadas, la estabilidad de la captura asíncrona, los predicados de
desactivación y la contención de los errores de captura. Ejercita las acciones reales de la
barra superior del plugin y las entradas nativas/personalizadas en un perfil de app aislado.
