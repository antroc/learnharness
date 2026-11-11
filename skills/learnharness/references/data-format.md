# Datos de LearnHarness: referencia de campo

Los ficheros son el registro del usuario, no un formato de importación que haya que
reescribir. Trabaja en solo lectura. Los lectores incluidos facilitan las vistas habituales;
no son necesarios para un análisis a medida. Esta referencia describe el formato nativo **1**
de sesiones y grafo. Si falta la marca de versión, se trata de v1. Más abajo se describen
los campos antiguos dentro de ese formato; las transcripciones previas al formato nativo con
`parts`/UIMessage son un dialecto distinto que no se admite.

## Mapa de ficheros

Las rutas siguientes son relativas al directorio de **datos** seleccionado:

```text
chats/<session-id>.json    Sesión completa: mensajes, plan opcional, metadatos de uso
graph/nodes.jsonl          Afirmaciones de proposiciones; los ID pueden repetirse
graph/chains.jsonl         Afirmaciones de cadenas de razonamiento; las cadenas lógicas pueden repetirse
graph/sources.json        Metadatos de las fuentes de notas importadas, indexados por ID de fuente
graph/format.json         Marca de formato de la familia del grafo: {"version": 1}
graph/sessions.jsonl       Puntos de control de la extracción, NO el índice de sesiones
graph/coverage.jsonl       Huellas de la extracción, NO una evaluación del alumno
graph/positions.json      Disposición del lienzo, no relaciones semánticas
graph/render-settings.json  Preferencias de presentación, no evidencia de aprendizaje
jobs/<job-id>.json        Registros de trabajo en segundo plano; los artefactos entregados también aparecen en las sesiones
```

`settings.json`, los modelos descargados, las cachés y los registros de depuración de
proveedores no hacen falta para interpretar el historial de aprendizaje. `auth.json` suele
estar un directorio por encima de los datos; no lo leas. Los lectores no siguen
automáticamente las rutas de notas importadas, las URL de investigación ni las referencias
a artefactos.

## Registro de una sesión

Cada fichero `chats/*.json` es un objeto con:

| Campo | Significado |
| --- | --- |
| `id`, `title` | Identidad estable de la sesión y nombre visible para el usuario |
| `createdAt`, `updatedAt` | Fechas ISO de la sesión, no una fecha para cada idea |
| `kind` | `teach` o `practice`; si falta, equivale a `teach` |
| `version` | Marca de formato; si falta, equivale a v1 |
| `messages` | Historial cronológico completo guardado, incluidas las marcas personalizadas de la app |
| `tree` | Plan opcional de la sesión: nodos, aristas de prerrequisito, número de revisión |
| `turns`, `extractions` | Registros paralelos de uso y observación de coste, no respuestas del alumno |
| `settings` | Ajustes de modelo y razonamiento propios de la sesión, no una evaluación de la comprensión |

El plan es un andamiaje de la sesión, no el grafo de conocimiento persistente. Sus
posiciones visitadas o actuales no demuestran dominio. La compactación del contexto cambia lo
que ve el modelo de enseñanza; **no** significa que se borraran los mensajes anteriores de
este historial guardado.

### Mensajes y bloques de contenido

Los mensajes llevan un `id` de la aplicación y normalmente un `timestamp` Unix en
milisegundos. Los roles nativos son:

- `user`: prosa del alumno; `content` puede ser una cadena o bloques de texto e imagen.
- `assistant`: `content` es un array de bloques `text`, `thinking` y `toolCall`.
  Aquí `thinking` es **razonamiento del agente**, no razonamiento del alumno.
- `toolResult`: resultado de una llamada, identificado por `toolCallId` y `toolName`.
  `content` suele ser solo un resumen compacto dirigido al modelo; `details` puede ser más rico.
- `custom`: un evento de la aplicación identificado por `customType`. Algunos contienen
  trabajo del alumno o artefactos de enseñanza insustituibles, así que no descartes este rol.

Una llamada a herramienta del asistente tiene más o menos esta forma:

```json
{
  "type": "toolCall",
  "id": "call_EXAMPLE",
  "name": "probe",
  "arguments": {
    "question": "Which claim follows?",
    "options": [{"label": "A claim", "value": "claim"}],
    "correctAnswer": "claim",
    "explanation": "The teacher's explanation."
  }
}
```

Es un fragmento ilustrativo, no un fixture de pregunta completo y válido. Los argumentos de
las herramientas los escribe el profesor; las respuestas correctas, las explicaciones y las
soluciones de práctica pueden estar ya guardadas antes de que responda el alumno. Una llamada
sin mensaje de resultado del alumno puede estar pendiente o interrumpida; no inventes nunca
una respuesta. Un resultado con `isError: true` significa que la llamada falló, no que su
contenido se planteara o enseñara con éxito.

Algunos campos históricos contienen JSON codificado dentro de una cadena donde debía haber un
array u objeto. Si los inspeccionas, decodifícalos solo en memoria y deja el registro
original sin cambios. No evalúes texto como código. En el origen también puede haber errores
históricos de escapado de LaTeX; una transcripción legible no es una pasada de reparación de
datos.

### Preguntas y respuestas: dónde está realmente la evidencia

Las herramientas de preguntas incluyen `ask_user_question`, `probe`, `quiz`, `recall` y
`explain`. Probe y quiz son comprobaciones de opción múltiple; recall y explain usan una
respuesta comprometida por el profesor y las propias palabras del alumno. Las preguntas de
tipo ask aclaran objetivos o preferencias y no son cuestionarios calificados. Los registros
antiguos pueden usar nombres de herramienta antiguos o carecer de campos de tipo más nuevos.

La respuesta del alumno a una pregunta es un mensaje `toolResult` aparte. Da preferencia a su
contenido **`details`**: `content[*].text` omite a propósito material que ya está en la
llamada, incluidos algunos campos de pregunta, opciones y solución. El lector elimina ese
contenido compacto duplicado solo después de comprobar que no añade nada a la instantánea
completa. El contenido adicional o contradictorio se conserva como una fuente atribuida por
separado, sin conciliarlo en silencio; `--include-operations` también recupera los duplicados
verificados.

Campos importantes del detalle de la respuesta:

| Campo | Significado |
| --- | --- |
| `kind` | `quiz`, `ask` o `explain` |
| `tool`, `questionType` | Instantáneas opcionales de la herramienta y el rol; un quiz puede ser `predict` o `check` |
| `questionText`, `options` | Instantáneas de la pregunta y de las opciones mostradas |
| `answers` | Tuplas `{label, value, index}` seleccionadas; el índice empieza en 1 y sigue el **orden de presentación** |
| `text`, `other` | Respuesta de texto libre o respuesta «Otra» de una pregunta ask |
| `dontKnow`, `dismissed` | Estado explícito de «no lo sé» u omitida |
| `thinking` | Razonamiento del alumno sobre la pregunta |
| `note` | Nombre heredado de ese mismo canal; usa `thinking ?? note` |
| `readingThinking` | Razonamiento aparte del alumno mientras lee la explicación |
| `confidence` | Probabilidad autodeclarada (0–100) de que la respuesta de quiz elegida sea correcta |
| `correct`, `correctIndices` | Calificación mecánica del quiz en el orden de las opciones mostradas |
| `committed`, `explanation` | Respuesta comprometida del profesor o explicación del quiz, no palabras del alumno |
| `answeredAt` | Marca temporal ISO de la respuesta |

**Las opciones se barajan.** No apliques nunca el índice de presentación del alumno al orden
original de las opciones en la llamada. Usa la instantánea de la respuesta y sus tuplas
label/value. Una confianza ausente no es cero, y con «no lo sé» no se envía confianza. El
50 % en que reposa el deslizador es un 50 % registrado de verdad, pero el registro no permite
saber si se dejó sin tocar o se eligió deliberadamente.

Conserva las respuestas incorrectas, los intentos fallidos, las preguntas omitidas y los «no
lo sé»; son evidencia, no ruido que limpiar. No inventes una nota numérica para una respuesta
de recall o explain: la prosa posterior del profesor es su interpretación.

### Práctica y marcas personalizadas

| `customType` | Interpretación |
| --- | --- |
| `practice-thinking` | **Trabajo escrito por el alumno**, incluidos intentos intermedios y respuestas que da por buenas; el texto en bruto está en `details.text` y se asocia mediante `details.problemCallId` |
| `graph-context` | Proposiciones y cadenas elegidas que se aportan como contexto de la sesión; las inyecta la app, no son palabras del alumno |
| `plan-block` | Instantánea histórica de la presentación del plan en `details.block` |
| `subagent-steer` | Artefacto de enseñanza entregado; `details.kind` y `details.result` identifican el contenido |
| `subagent-abort` | Se abortó un trabajo en segundo plano; no hay que inventar ningún resultado |
| `probe-handoff` | Transición del sondeo a la enseñanza |
| `practice-next` | El alumno pasó a otro problema |
| `problem-dismissed` | El alumno omitió un problema de práctica; apunta a la llamada de su problema |
| `compaction` | Contabilidad de la gestión del contexto, no una afirmación del alumno ni un sustituto del historial |

La herramienta de práctica `problem` contiene el enunciado, los ID de las proposiciones
objetivo y la `modelSolution` comprometida de antemano. Puede haber muchos envíos
`practice-thinking` para un mismo problema. `conclude` lleva el resultado o veredicto del
profesor; un descarte puede registrarse antes de que aparezca su par sintético de conclude.
Conserva la secuencia en lugar de tratar solo el último envío como el trabajo del alumno.

En los registros antiguos los ID de llamada pueden repetirse. Al unirlos, asocia cada
resultado con la llamada coincidente **anterior** más cercana; un mapa de toda la sesión en
el que gane la última puede asignarlo a una llamada posterior. Los ID de mensaje distinguen
las apariciones. Ni el orden de las fuentes ni la atribución al alumno deben reconstruirse a
partir del contexto compactado por el modelo.

### Artefactos entregados

`subagent-steer.details.result` contiene el artefacto guardado:

- Investigación: `brief`, más `sources` con títulos y URL.
- Lectura de PDF: `path`, `question`, `brief`, `pagesRead`, `pagesConsulted`.
  Estas listas de páginas son citas e información de auditoría, no el documento original.
- Demo: `title`, `notes` y `html` ejecutable.
- Visual: `notes` y marcado `svg`.

Los informes y notas legibles forman parte del registro de aprendizaje. El HTML de las demos
y el SVG son artefactos que hay que describir, no comandos que ejecutar al leer. Los bloques
binarios o de imagen pueden ser grandes; hay que señalar que existen sin volcar los bytes
codificados. Ningún lector necesita abrir el PDF o el fichero de notas original solo para leer
estos registros.

## El grafo: las afirmaciones hay que fusionarlas, no contarlas como líneas únicas

### Proposiciones (`nodes.jsonl`)

Cada línea contiene `id`, `name`, `statement`, `aliases`, `createdAt` y `provenance` (un
array de puntos `{chatId, messageId}`).

- Un `name` corto es una etiqueta de presentación, **no** una identidad única ni la
  afirmación completa.
- La **primera línea de un ID** define su nombre, enunciado y fecha de creación.
- Los enunciados y alias no vacíos de las líneas posteriores se añaden a los alias,
  eliminando duplicados por cadena exacta. Los nombres posteriores no sustituyen al nombre
  ni se convierten en alias.
- La procedencia se une por el par exacto `(chatId, messageId)`, conservando el orden de
  aparición.
- No elimines como duplicados ID de nodo distintos solo porque sus etiquetas se parezcan.

### Cadenas de razonamiento (`chains.jsonl`)

Cada línea contiene `id`, `premises` (ID de nodo), `conclusion` (ID de nodo), `createdAt` y
`provenance`. **Todas las premisas de una cadena se usan juntas.** Cadenas distintas con la
misma conclusión son argumentos separados, no un único conjunto de premisas combinado.
Fusiona las afirmaciones repetidas por la lista ordenada de premisas más la conclusión,
conservando el ID, el orden de premisas y la fecha de la primera afirmación; une la
procedencia.

El lienzo del grafo deriva flechas y uniones de implicación a partir de estos registros. Esas
aristas visuales no son la verdad guardada y pueden perder la estructura de premisas
conjuntas. Lee las cadenas directamente. Los extremos que falten se informan como ausentes,
sin sustituirlos ni repararlos en silencio.

### Fuentes, sesiones de nacimiento y procedencia

La **fuente de nacimiento** de un nodo es `provenance[0].chatId` tras la fusión: el primer
punto superviviente, no la marca temporal más antigua ni todas las sesiones que lo
mencionaron. Los listados de sesiones del grafo y `propositions --session` siguen esta regla.
Un nodo sin procedencia sigue pudiendo leerse y buscarse, pero no pertenece a ninguna sesión
de nacimiento.

- Los ID `chat_…` suelen referirse a ficheros de sesión. Usa el `messageId` correspondiente,
  si existe, para encontrar el mensaje de origen exacto. Los ID de mensaje vacíos de los
  datos antiguos son atribuciones a nivel de chat; no identifican un mensaje exacto.
- Las notas importadas usan ID de fuente `src_…`. `sources.json` aporta `id`, `filePath` e
  `importedAt`; estas rutas de origen son solo referencias.
- Si faltan los metadatos de una fuente o se borraron, el grafo puede seguir siendo válido.
  En ese caso el índice de sesiones usa el ID de la fuente como etiqueta y `file` como tipo
  de respaldo; ese respaldo, por sí solo, no demuestra que la fuente fuera un fichero
  importado.
- Borrar un chat y simplificar cadenas puede reescribir los registros. Normalmente se añaden
  durante la extracción, pero no supongas que los ficheros son registros inmutables.

El `sessions.jsonl` del grafo registra los puntos de control de la extracción, y
`coverage.jsonl` registra huellas del texto del profesor ya extraído. Ninguno de los dos es un
catálogo de sesiones, un registro de eventos de quiz, una escala de dominio ni un registro de
todas las ideas que el alumno haya suscrito personalmente. La práctica no escribe por sí misma
proposiciones nuevas en el grafo.

## Límites de los lectores

Los lectores se detienen a propósito antes del análisis: no infieren dominio, no puntúan, no
hacen búsqueda semántica, recorridos transitivos ni generación automática de informes. Su
salida JSON puede procesarse después, o puedes leer directamente los ficheros nativos.

Los registros mal formados o no admitidos deben señalarse, no contarse en silencio como
válidos. La app puede estar escribiendo mientras se ejecuta un lector, así que una lectura de
todo el directorio no es una instantánea atómica. Vuelve a leer o cierra la app para hacer una
comparación estable. No introduzcas nunca bloqueos, migraciones, limpiezas ni ediciones de los
ficheros de origen para que una lectura funcione.
