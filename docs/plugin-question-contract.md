# Herramientas de preguntas de plugins — contrato de la API v1

Las preguntas de enseñanza personalizadas comparten el ciclo de vida nativo de las
preguntas. Este contrato describe el código fuente y la build correspondientes. Comprueba la
app de destino con el `bundle.json` de la skill descargada; la API v1 por sí sola no
identifica todas las capacidades disponibles. Los tipos exactos están en
`src/core/plugin-questions.ts` y en el SDK correspondiente, que solo contiene tipos. Para la
práctica, usa el [contrato de problemas](plugin-problem-contract.md), que es aparte, no la
inscripción en la enseñanza.

## 1. Alcance y responsabilidades

El host es responsable de la identidad canónica, los contratos guardados, la validación, la
persistencia y la continuación, las tarjetas y el dock de preguntas, el plegado y la
revelación, el envío y el descarte, las estadísticas de la sesión, los controles de micrófono
y modelo, el razonamiento opcional y el razonamiento de lectura de las comprobaciones, y del
posicionamiento en el sondeo y la enseñanza. El plugin es responsable de los esquemas de la
carga útil y de la respuesta, la presentación opcional, el editor de respuestas, las
instrucciones para usar su formato y la calificación genérica opcional y la presentación de
su resultado.

Esto no es un framework genérico de entrada pendiente o formularios, ni un catálogo de
editores de código del host, ni un formato persistente de borradores de editores, ni un hook
de migración del chat del núcleo, ni un sustituto de la calificación de preguntas integrada.
El profesor ordinario revisa la respuesta guardada y cualquier observación.

## 2. Registro en el backend

`ctx.registerQuestionType(definition)` devuelve una función para anular el registro:

```ts
{
  id: string;
  label: string;
  contractVersion: number;
  incompatibleContractVersions?: number[];
  showThinking: boolean;
  questionSchema: TSchema;
  answerSchema: TSchema;
  probe?: { toolName: string; description: string };
  teach?: { toolName: string; description: string };
  validateQuestion?: synchronousRefinement;
  validateAnswer?: synchronousRefinement;
  gradeAnswer?: (context: PluginQuestionGradingContext<Q, A>) => JsonValue | Promise<JsonValue>;
}
```

`Q`/`A` designan los valores de carga útil y respuesta inferidos del esquema. Los ID de tipo
usan `[A-Za-z0-9_-]`, de 1 a 128 caracteres; las etiquetas y descripciones deben contener
texto que no sea solo espacios. Las versiones del contrato son enteros seguros positivos,
independientes de la versión del paquete. `showThinking` es una política obligatoria del
plugin, no algo que escriba el modelo. Se necesita al menos una variante: probe solo aporta
al agente de sondeo y teach solo al profesor; no implica inscripción en la práctica.

El host construye herramientas nativas de planteamiento, no manejadores `execute` del
plugin. Los nombres siguen las reglas nativas de admisión de herramientas. Las herramientas
ordinarias, las preguntas, los problemas y las instrucciones de un paquete se admiten de
forma atómica a partir de una única instantánea de contribución por turno. No vuelvas a
invocar nunca una factoría para reconstruir la autoridad.

Los parámetros nativos son `{question: string, payload: Q}` para probe y
`{type: "predict" | "check", nodeId: string, question: string, payload: Q}` para teach. Los
campos comunes no pueden colisionar con los de la carga útil. `question` es Markdown visible
para el alumno, que no puede ser solo espacios y se conserva tal como se escribió, y sirve
como adelanto seguro o recurso. Los ID de nodo de teach deben ser nodos aplicables del plan
vivo; se aplica el ritmo existente de predict/check.

Los refinamientos síncronos opcionales y sin efectos secundarios reciben un contexto
inmutable: `validateQuestion({chatId,variant,contractVersion,input})` y
`validateAnswer({chatId,questionId,variant,contractVersion,input,answer})`. Devuelve
`undefined`/`[]` o cadenas de error legibles. Se rechaza la validación asíncrona o que
devuelva un thenable. Los errores de autoría no plantean ninguna pregunta; los errores de la
respuesta conservan la entrada pendiente y los borradores. Una respuesta válida según el
esquema pero incorrecta no es un fallo de validación.

## 3. Esquemas y límite JSON

Usa esquemas persistibles autocontenidos que admita el compilador de TypeBox instalado.
Compila la representación persistida plana, conservando el significado de las referencias
locales JSON Pointer al incrustar cargas útiles. Rechaza las referencias externas, la
resolución por `$id`, anclas o dinámica, las funciones, RegExp u objetos de validación que
dependen del runtime, las extensiones no JSON y los formatos no admitidos. El marcado
descriptivo de TypeBox no es validación persistida. Esto es higiene acotada de esquemas, no
una metavalidación completa de JSON Schema.

Los valores son JSON finito: cadenas, números finitos, booleanos, null, arrays y objetos
planos. No conviertas, limpies, recortes, filtres por veracidad ni omitas valores en
silencio. Conserva exactamente los espacios en bruto del código y los valores válidos
`false`, `0`, `null` y cadenas o arrays vacíos.

## 4. Autoridad duradera y presentación del stream

Un registro congelado aceptado por turno más el libro de planteamientos del host certifican
la ejecución correcta. Solo un planteamiento correcto del host crea autoridad pendiente: los
argumentos en bruto, la coincidencia de nombres de herramienta o los tokens arbitrarios en
los resultados, no. Las instantáneas inmutables vinculan el ID de pregunta acuñado por el
host, la aparición exacta de la llamada, el propietario, tipo, etiqueta, versión y variante,
la entrada validada, los esquemas, `showThinking`, los requisitos de refinamiento y
calificación y el papel y nodo de teach.

Los metadatos `lhQuestions`, exclusivos de la app, se indexan por posición en el contenido
del asistente. Las anotaciones de intentos llevan datos de visibilidad, pero no autoridad
pendiente. Las instantáneas sin calificación usan el protocolo local v1; las calificadas usan
v2 con `requiresGrading: true` (sección 6).

Un planteamiento correcto termina la ejecución nativa con un acuse temporal del motor, no con
una respuesta del alumno. Suprime solo los acuses temporales certificados por el libro en
todos los portadores de stream y resolución; conserva los errores y los resultados hermanos
ordinarios. Correlaciona los eventos originales antes de filtrar el cable. Un planteamiento
correcto detiene los lotes mixtos aunque falle otro intento de pregunta.

Los intentos de pregunta nunca caen en la traza genérica de entrada en bruto, incluidos los
intentos fallidos, en curso o interrumpidos y los que no tienen renderizador. Decora las
copias salientes de las instantáneas del asistente al inicio, al actualizar y al final del
mensaje, tras la admisión de la suscripción y el remapeo de ID y antes de elegir el
renderizador; no modifiques nunca objetos nativos compartidos. Persiste aparte la
clasificación de los intentos fallidos. Los intentos fallidos muestran un estado seguro del
host, no errores en bruto que citen cargas útiles privadas. El recurso usa la `question`
común, no un volcado de la carga útil. Este límite de presentación no es un sandbox del
sistema operativo o del navegador ni promete que la prosa escrita no pueda contener una
respuesta.

Quita los metadatos exclusivos de la app de los mensajes para el modelo. No reescribas nunca
llamadas históricas ni permitas que las callbacks de plugins migren registros del chat del
núcleo.

## 5. Adopción canónica, envío y compatibilidad

Monta los editores accionables solo después de la persistencia canónica y la adopción por el
cliente. Los intentos en curso pueden mostrar marcadores de posición no accionables. Tras
terminar el stream, concilia explícitamente; una lectura fallida sigue bloqueada con un
Reintentar que solo concilia, nunca con otro turno del profesor. Las barreras de generación
de conexión, época y ticket rechazan las finalizaciones separadas. Reconectar la misma
aparición debe iniciar o unirse a una tarea actual, no reutilizar una disponibilidad
obsoleta.

El envío vincula el ID estable de la pregunta **y la aparición exacta**, no solo el ID de la
llamada. Las preguntas de plugins pendientes no se pueden saltar con texto ordinario,
Continuar o Reintentar, ni con los caminos antiguos de respuesta o descarte integrados. Los
ajustes de la sesión y los cambios de modelo siguen siendo posibles.

El host fija un intento, termina el dictado, espera a que el editor publique la
transcripción, vuelve a comprobar la aparición, el montaje y la disponibilidad, resuelve los
esquemas canónicos guardados, valida y refina, califica opcionalmente, guarda el resultado
nativo real y después sigue las reglas existentes de continuación de hermanos y turnos
pendientes. Los intentos duplicados u obsoletos no pueden guardar otra respuesta ni lanzar
trabajo extra. Los hooks nuevos nunca cambian con efecto retroactivo los requisitos de
aceptación guardados antiguos.

La compatibilidad es explícita:

- El backend actual admite su `contractVersion` exacto. Los esquemas guardados siguen
  gobernando. Una revisión o hash del paquete o un número de versión distinto, por sí solos,
  nunca autorizan una cancelación.
- `incompatibleContractVersions` declara una incompatibilidad real; las declaraciones
  contradictorias se rechazan. Una incompatibilidad explícita o un protocolo del host
  realmente ilegible pueden producir una cancelación silenciosa del host solo si hay
  identidad legible suficiente para vincular la aparición exacta. Nunca adivines el destino
  de una cancelación ni compitas con un turno activo.
- Un backend ausente o desactivado, una versión no declarada, la falta de renderizador o un
  fallo al renderizar mantienen la entrada pendiente con un recurso legible y descarte de
  recuperación. Un fallo del frontend no puede declarar incompatibilidad. No existe
  actualización automática, rangos ni migración sobre los registros del chat.

## 6. Calificación y resultados guardados

`gradeAnswer(context)` opcional se ejecuta **después de la validación y antes de guardar**, y
recibe la entrada y la respuesta históricas inmutables y una señal del host. Devuelve
cualquier JSON finito, no un sobre del host. No hay esquema de resultado del host, ni enum de
corrección o estado, ni puntuación, ni interfaz automática de insignias.

El sobre de respuesta del host contiene `kind: "plugin-question"`, `questionId`, `pluginId`,
`typeId`, `contractVersion`, la `answer` exacta, `thinking`/`readingThinking` aplicables,
`answeredAt`, canales de imagen opcionales y `grading` opcional:

```ts
type PluginQuestionGradingOutcome = { result: JsonValue } | { error: string };
```

El servidor aporta la identidad y la hora. El razonamiento va separado de la respuesta;
`showThinking` controla la aplicabilidad, no exige escribir algo no vacío. El razonamiento de
lectura solo se aplica a las comprobaciones de teach. Conserva los valores aplicables
definidos que estén vacíos o sean solo espacios; rechaza los canales no aplicables
inyectados. Los detalles completos aceptados persisten en el resultado nativo; el texto para
el modelo incluye respuesta, razonamiento y calificación, con los bloques de imagen nativos
junto a él. El plugin no puede sustituir el mensaje de respuesta del host.

Las excepciones, rechazos o valores no JSON devueltos por la calificación guardan una
**respuesta aceptada con `grading.error`**, no un fallo de validación. Los resultados falsy,
null o vacíos correctos siguen siendo válidos. Los resultados llegan a `mountAnswered` y al
modelo; la proyección, la continuación o el reintento y el remontaje nunca vuelven a
ejecutar la calificación.

La calificación queda congelada en el planteamiento: el protocolo v2 registra
`requiresGrading: true`; v1 sigue sin calificar si después se añade un hook, y una
calificación v1 inesperada se ignora al proyectar sin reescribir el historial. Si falta el
calificador exacto obligatorio, la pregunta sigue no disponible o pendiente. Un host más
antiguo que no sepa leer v2 puede cancelar en silencio la aparición ilegible vinculada. La
versión de la API del manifiesto sigue siendo 1.

La calificación ocupa el POST de respuesta en línea y el propietario existente de la
preparación del turno: sin tareas, cola ni pasada extra del LLM. El modelo y el proveedor
capturados se mantienen durante la continuación. Una desconexión o navegación no cancelan una
calificación admitida. Stop, desactivar o quitar exactamente ese registro cancelan su señal y
bloquean el guardado: no se guarda ninguna respuesta del alumno para ese intento. El host
espera a que la callback termine de verdad, no a un envoltorio que compite con la
cancelación. La cancelación es cooperativa; los plugins se encargan de plazos y limpieza, sin
límite de tiempo estricto ni terminación de procesos por parte del host.

No hay reintento automático de respuestas de plugins tras un 409. Un reintento explícito
previo al guardado puede volver a ejecutar la calificación; no se promete garantía de
exactamente una vez a través de un cierre inesperado ni reversión de efectos secundarios
externos. Un acuse perdido requiere conciliación canónica, no un envío nuevo adivinado.

El descarte y la incompatibilidad producen resultados de cancelación honestos del host, no
respuestas del alumno, y no ejecutan automáticamente al profesor. La siguiente entrada
deliberada sigue las reglas normales de despertar.

## 7. Huecos del frontend, borradores y ciclo de vida

`registerQuestionRenderer({id,supportedContractVersions,mountQuestion?,mountAnswerEditor,
mountAnswered?})` devuelve una función para anular el registro con ámbito en el plugin y
tipo propietarios. La presentación por defecto de la pregunta es Markdown del host; la
presentación por defecto ya respondida son los datos guardados del alumno de forma legible.
Estos huecos no son renderizadores de herramientas ordinarios ni reclamaciones entre
plugins.

Los montajes reciben la entrada normalizada inmutable, el ID de chat y de pregunta, la
versión histórica del contrato, la variante y la señal. `mountAnswered` añade la respuesta
aceptada, la calificación opcional y `headerContainer` (en línea tras la etiqueta del host) /
`footerContainer` (tras el razonamiento de la respuesta del host) opcionales de solo lectura.
Estos huecos vivos del DOM comparten la generación, la señal y la limpieza del cuerpo, no
otorgan propiedad sobre el encabezado ni el razonamiento del host y desaparecen al fallar,
sustituir o desmontar. Si faltan, usa el cuerpo como recurso; no consultes ni muevas nunca el
DOM circundante del host ni conserves los huecos entre generaciones. Los montajes de
pregunta y de editor no reciben ninguno de los dos huecos. El razonamiento y las imágenes del
host quedan fuera de los cuerpos de los plugins.

El editor recibe `active`, `answer` controlado y `onChange(state)` síncrono:
`{status:"empty"}` o `{status:"unready"|"ready",value:JsonValue}`. Listo requiere un handle o
publicación actual; los valores falsy o vacíos válidos según el esquema pueden cumplirlo.
Los borradores no tienen por qué cumplir aún el esquema. `empty` no guarda ningún valor; usa
`unready` para conservar texto incompleto.

Handle obligatorio: `update({answer,active})`, `focus()`, `dispose()`; opcionales
`handleKeyDown(key): "handled" | "pass"` y `appendTranscript(text)` (síncrono o asíncrono).
Aplica las actualizaciones controladas sin reenviar una publicación ni reiniciar una
selección o composición idéntica. Los montajes asíncronos y las callbacks tardías tienen
ámbito de aparición y generación exactas: los handles obsoletos no pueden publicar, enfocar,
consumir teclas ni recibir habla.

Mantén vivos los montajes al plegar, actualizando el estado activo. La adopción canónica de
la misma pregunta no debe remontar. Los borradores en memoria indexados por aparición
sobreviven a los remontajes mientras vive el modelo de la sesión, no necesariamente a su
destrucción, recarga o reinicio. No se añade ningún formato persistente de borradores.

## 8. Teclado, dictado e interfaz nativa

Enter del host envía; Mayús+Enter inserta un salto de línea; el acorde reservado
Cmd/Ctrl+Enter envía, sujeto a la disponibilidad y al IME. Ofrece primero Tab, Enter,
Mayús+Enter y Escape sin modificadores al editor elegible activo. `handled` reclama una vez;
omitirlo o `pass` usa los valores por defecto del host. Tab usa la cadena privada de campos
del host, no el recorrido del navegador. Escape no gestionado pasa al siguiente campo del
host (o quita el foco en una cadena formada solo por el editor), reclamando ese evento sin
descartar ni cancelar además. Los atajos de la app conservan la precedencia, incluido el
cambio cíclico de razonamiento del modelo con Mayús+Tab. No hay registro público de atajos.

Fuera del editor, tras la gestión del campo enfocado, el dictado y las capas, Escape usa la
confirmación nativa de descarte de la pregunta. Cancelar o Escape en el diálogo conservan
los borradores. La confirmación se vincula a la aparición y la pregunta exactas; los destinos
obsoletos se cierran sin acción, nunca se redirigen. En reposo, la confirmación guarda la
cancelación sin despertar al profesor. Durante la calificación, la ruta de descarte
silencioso valida el estado actual, aparca el descarte y solicita Stop a la vez; la limpieza
real del calificador debe terminar antes de que se aplique la cancelación aparcada. Las
preguntas sanas siguen sin tener un botón Descartar ordinario, y el comportamiento de las
preguntas y problemas integrados no cambia.

La composición/229 no debe enviar, cambiar de campo ni ejecutar comandos de edición;
conserva el comportamiento nativo por defecto de Enter durante la composición y suprime el
enrutado del host. Los editores cubiertos, ocultos u obsoletos no pueden reclamar. Mantén el
editor fuera del formulario nativo del pie de envío; no fabriques despachos de teclado.

El dictado va al ReadingThinking de una comprobación no revelada; tras la revelación o en un
probe/predict abierto va al Thinking del host si está activado y, si no, al
`appendTranscript` explícito del editor si se proporciona. Sin ninguno de los dos, el
micrófono sigue visible pero desactivado y nunca enruta a un compositor oculto. Plegar no lo
borra ni lo redirige. Termina antes de revelar o enviar; las callbacks de transcripción deben
publicar antes de resolverse. Resuelve o cancela los destinos de captura obsoletos.

Reutiliza la maquinaria nativa de dock, tarjeta, estadísticas, barra de herramientas y
revelación, no una reescritura de los formularios integrados. El razonamiento usa el marco
nativo con un mínimo compacto de 40px y crecimiento natural. Las preguntas sanas no tienen
Descartar; es solo para recuperación. Una disponibilidad desconocida o con fallo de
sincronización no es una no disponibilidad confirmada: muestra `Preparing question…` o
contenido legible con `Retry syncing`, bloquea el envío y mantén en solo lectura un editor
admitido del mismo propietario hasta la disponibilidad canónica. Las publicaciones iniciales
legítimas y la finalización de la transcripción siguen resolviéndose bajo las comprobaciones
de propiedad del borrador mientras la interacción está inactiva.

La altura de apertura se reajusta desde la geometría actual durante el tiempo que quede de
la animación original cuando la admisión tardía del editor cambia el tamaño; no retrases ni
reinicies la apertura, no animes el crecimiento ordinario al escribir ni remontes el editor.
En el historial, el razonamiento de lectura va encima de la tarjeta con la etiqueta nativa y
abierto por defecto; el razonamiento de la respuesta va dentro, con inCard nativo y cerrado
por defecto. Los canales definidos vacíos o solo con espacios siguen presentes; el texto y
las imágenes se combinan por canal.

El recurso respeta el ritmo de revelación, muestra el Markdown y el estado guardados de forma
segura, desactiva el envío y expone el descarte de recuperación. Textos:
`Preparing question…`, `Question unavailable`, `Dismiss question`,
`Could not sync the saved session.` / `Retry syncing`.

## 9. Pruebas

Las pruebas deben cubrir los planteamientos certificados por el libro y los lotes mixtos, la
supresión en el stream, la reconexión y adopción canónicas, las apariciones exactas, los
esquemas y referencias locales, los estados no disponible e incompatible, la cancelación de
la calificación y el orden de guardado, los saltos duplicados o por caminos antiguos, las
generaciones de editores, los borradores, el teclado y el IME, la entrega del habla y el
recurso del host. Comprueba los tipos contra el SDK portable y prueba el plugin en un perfil
aislado de la app además de en fixtures unitarias y de componentes.
