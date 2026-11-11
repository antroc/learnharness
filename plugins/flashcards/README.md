# Flashcards

Un plugin del núcleo de LearnHarness: genera pistas de recuerdo de hechos a partir de tu grafo o de ficheros PDF o de texto subidos, organízalas en mazos planos y repásalas con FSRS-6. **Sin integración con Anki.** El paquete no contiene dependencias npm de runtime, importaciones privadas de la app, escrituras en el grafo del núcleo ni credenciales de proveedores.

## Plugin del núcleo y referencia de código

Activa Flashcards en **Ajustes → Plugins del núcleo**. La app aporta y actualiza su código;
sus registros escribibles viven en `<learning data>/core-plugin-data/flashcards/`. Este
proyecto de código es material de referencia, no una copia instalable de la comunidad:
`flashcards` es un ID reservado del núcleo aunque el plugin del núcleo esté desactivado o
falte. Un fork de la comunidad necesita su propio ID de manifiesto y carpeta y revisar los
nombres de contribuciones, herramientas y bloques cercados que puedan entrar en conflicto. No
copies esta build en una carpeta `plugins/flashcards/` de la comunidad.

Requiere un host correspondiente que exponga `mountKnowledgePicker`, `mountMarkdown`,
`mountTree`, `openSurface` del cuerpo de página, los iconos públicos de `mountButton`
(`icon` / `iconOnly`) y los colores personalizados (`variant: 'custom'` / `colors`), el
contrato `data-plugin-initial-focus` de las superficies y `ctx.workers`. Una cadena de versión
por sí sola no establece las capacidades. La generación a partir de ficheros requiere además
`ctx.documents.toMarkdown`; sin ella, solo se desactiva Generate from file, mientras que la
generación desde el grafo y los repasos existentes siguen disponibles.

## Build

Este proyecto JavaScript no necesita `.sdk/` ni generar el SDK. Prepara aparte las
dependencias de desarrollo del proyecto; LearnHarness no hace ninguna preparación con npm.
Con las dependencias ya disponibles, desde esta carpeta:

```sh
npm run build
```

La build escribe directamente en el **`dist/`** de este proyecto, empaqueta el frontend y el
backend CommonJS y copia el manifiesto, los estilos y las licencias. La limpieza solo
sustituye `dist/`, rechaza un `dist/` enlazado simbólicamente o un `dist/data/` mal colocado
y conserva el `data/` hermano. Compilar no instala, activa ni actualiza un plugin del núcleo.

## Uso

Abre Flashcards desde su icono de tarjetas apiladas en la barra lateral. Selecciona proposiciones en el selector de conocimiento real del host, ejecuta la comprobación previa y después confirma la generación. Usa la ranura del modelo barato actual salvo que fijes una sustitución específica del plugin; las llamadas pueden tener coste. La selección del grafo es manual; no hay disparadores automáticos de generación. Cada fragmento correcto añade pistas útiles que falten sin sustituir tarjetas existentes ni reiniciar calendarios. La navegación no cancela el trabajo. Los objetivos fallidos o interrumpidos requieren un nuevo intento de generación explícito.

Las tarjetas de la primera generación se unen a un mazo con el nombre de su fuente original. Los nombres iniciales usan los títulos públicos de los chats o los nombres base de los ficheros de notas; el lector de aprendizaje aún no expone los cambios de nombre de fuentes importadas hechos en el host. Renombra las colecciones en local, crea mazos personalizados y cambia las pertenencias sin cambiar las fuentes del núcleo. Una proposición puede aparecer en varios mazos manteniendo una única colección, calendario e historial. Mantén al menos una pertenencia al cambiarlas. Borrar es una operación aparte y explícita que elimina contenido de Flashcards, nunca nodos del grafo de aprendizaje.

### Escribir tarjetas a mano

El **+** que hay justo a la izquierda del engranaje de un mazo abre **Create card**: introduce un Name y después Question y Answer con los mismos campos de Markdown que Edit cue. Al guardar se crean juntos, en ese mazo, un objetivo nuevo exclusivo de Flashcards y su primera pista. No hay un paso aparte para crear objetivos ni un desplegable de objetivos existentes. Cada guardado nuevo deliberado crea un objetivo nuevo en lugar de buscar coincidencias con nombres existentes; reintentar una respuesta perdida no crea duplicados.

El **+** de la fila de un objetivo activo abre **Add cue**, solo con Question y Answer. La pista nueva comparte el calendario y las pertenencias existentes de ese objetivo sin reiniciar su historial, su pista de aprendizaje ni el recuento diario de introducciones. Ningún campo puede estar en blanco; Cancelar no crea nada. La creación manual no necesita un modelo configurado, no hace llamadas al modelo y nunca escribe en el grafo. Los objetivos escritos a mano siguen activos con independencia del contenido del grafo, también tras reiniciar. Las filas de pistas y el Archive no tienen controles de creación.

### Biblioteca y repaso

La biblioteca usa el árbol nativo Mazo → Proposición → Pista, con la búsqueda y Create deck agrupados dentro de su panel con borde. Haz clic en el nombre de un mazo para renombrarlo en línea (Enter o perder el foco guarda; Escape cancela); el botón Review con contorno que tiene al lado inicia el repaso del mazo. Unos glifos de tarjetas apiladas marcan los mazos y la rama Archive. Los menús de engranaje atenuados conservan los ajustes del mazo, las pertenencias, la edición y el borrado y la ordenación. Haz clic en una pista para ver una previsualización enriquecida de pregunta y respuesta, con el nombre de la proposición como único encabezado del diálogo y el mismo estilo centrado de pregunta, divisor y respuesta que en el repaso. El botón rojo Delete de la previsualización abre la confirmación compartida de borrado de contenido. La búsqueda desactiva la ordenación hasta que se borra.

Seleccionar una rama incluye sus descendientes, las casillas mixtas muestran la selección parcial y las pistas compartidas siguen seleccionadas en todos los mazos. La fila de acciones siempre está visible: Review all / Practice all pasan a Review selected / Practice selected cuando hay algo seleccionado, con anchos de botón naturales y una separación constante al alargarse las etiquetas. El recuento de la selección y Clear van juntos a la derecha; Clear está desactivado si no hay selección. Una selección sin pistas activas desactiva el repaso y la práctica de lo seleccionado en lugar de recurrir a toda la biblioteca; los contenedores vacíos se pueden seguir seleccionando para borrarlos. El repaso de lo seleccionado usa exactamente las pistas activas seleccionadas, no todas las pistas de sus proposiciones. Si se excluye la pista fijada de una proposición en aprendizaje o reaprendizaje, esa proposición espera a un ámbito de repaso que contenga esa pista.

El repaso se abre sobre la superficie del panel principal del host, atenuada y desenfocada, dejando disponibles la barra lateral y la superior. La tarjeta centrada solo contiene la pregunta y la respuesta revelada; los controles y las pistas de atajos atenuadas quedan fuera de ella. Las tarjetas de repaso, práctica y previsualización tienen una altura mínima apaisada 16:9 basada en su ancho, con el contenido corto centrado en vertical. Una respuesta revelada corta se queda dentro de esa caja de tamaño mínimo; el contenido más largo la amplía de forma natural en lugar de desbordar una proporción fija. En la cara de la pregunta no aparece ningún encabezado genérico; el nombre de la proposición solo aparece tras revelar. Cierra con la X del host o Escape. El host enfoca la región visible de la tarjeta mediante la marca pública de foco inicial. Espacio solo revela: tras revelar nunca envía una calificación del repaso programado, tampoco sobre botones de calificación enfocados. Usa 1–4 cuando el foco no esté en un control, haz clic en una calificación o pulsa Enter sobre un botón de calificación enfocado. Los botones de calificación usan tintes rojo, ámbar, verde y azul para Again/Hard/Good/Easy mediante la API compartida de colores personalizados. Reveal es un botón con contorno más discreto con una breve pista “Space”. El recuento de listas va pegado al borde inferior de la tarjeta, alineado a la derecha por encima de los controles. Piensa, revela y después califícate con Again/Hard/Good/Easy. El repaso es local y no hace llamadas al modelo. El recuento “N ready” incluye la proposición actual, las proposiciones vencidas y las proposiciones nuevas admisibles según los límites diarios; los pasos de aprendizaje futuros no se cuentan hasta que estén listos. Cuenta proposiciones compartidas, no cada pista.

Primero va el aprendizaje y reaprendizaje listo, después los repasos vencidos y después las proposiciones nuevas. El cupo de nuevas es de 20 por mazo y día por defecto; los repasos vencidos no tienen tope. Una primera calificación cuenta en todos los mazos que la contienen; solo el mazo que admite o en el que se estudia controla la admisión. El repaso de toda la biblioteca busca un mazo elegible sin crear un cupo global aparte.

### Borrar contenido de Flashcards

Al seleccionar cualquier cosa aparece un botón de papelera accesible solo con icono justo a la derecha de Review selected / Practice selected. Delete en la previsualización o el menú de una pista y Deck settings → Delete deck… usan la misma confirmación única, con una explicación atenuada en el cuerpo y **Delete empty decks too** marcada por defecto. No hace falta un selector de mazo de sustitución.

Las pistas seleccionadas se borran físicamente en todos los sitios donde se comparten. Quitar la última pista de un objetivo elimina ese objetivo de Flashcards y su calendario activo; los objetivos que sobreviven conservan sus demás pistas, calendarios y pertenencias. Las calificaciones y marcas de tiempo de repasos pasados siguen disponibles para las estadísticas, pero los registros de repaso ya no conservan instantáneas de pregunta y respuesta. Con la limpieza de mazos vacíos marcada, solo se borran los mazos afectados que quedan vacíos (o los mazos vacíos seleccionados explícitamente); los mazos vacíos no relacionados sobreviven. Desmarcarla mantiene los contenedores vaciados. Borrar un mazo selecciona su contenido, incluidos los objetivos compartidos con otros mazos. Nunca se borran nodos del grafo de aprendizaje ni fuentes nativas.

El borrado espera a que la generación termine o se cancele, tanto en la interfaz como en el backend, para que los resultados tardíos no puedan volver a crear contenido borrado. La confirmación congela la selección y la revisión de la biblioteca; si la biblioteca cambia, hace falta una confirmación nueva. Los reintentos por respuesta perdida reutilizan un recibo duradero sin texto y no aplican otro borrado. Las preguntas borradas no se conservan como lápidas ni se pasan a generaciones posteriores, y no son una lista negra para la generación.

### Generar a partir de un fichero

Elige **Generate from file…** y selecciona un PDF o un fichero de texto UTF-8. El conversor compartido del host usa el mismo motor de PDF a Markdown que la importación de notas y las herramientas de lectura de PDF; en este paquete no hay un segundo conversor. Los PDF se identifican por su cabecera o por el nombre de fichero `.pdf`, de modo que un PDF corrupto no se trata en silencio como texto normal. Se admiten otros nombres de fichero cuando su contenido es texto UTF-8 válido, en lugar de restringir las subidas a una lista corta de extensiones. Se rechazan el binario no admitido o el texto no válido, los documentos vacíos y los PDF sin texto extraíble. No hay OCR; en los PDF mixtos pueden omitirse las páginas que solo tienen imagen y mostrarse avisos antes de la generación.

La confirmación muestra el nombre del fichero seguido del recuento aproximado de tokens de entrada entre paréntesis, juntos en un párrafo atenuado del cuerpo. La generación desde el grafo usa el mismo formato, con el número de proposiciones en lugar del nombre del fichero. Los avisos de la conversión aparecen debajo del resumen; ningún diálogo añade una frase aparte de aviso de coste. No empieza ninguna llamada al modelo hasta que confirmas. Cada fichero nuevo confirmado crea un mazo con su nombre de fichero, incluida la extensión, que puedes renombrar normalmente. El agente crea hechos atómicos y pistas de recuerdo **solo dentro de Flashcards**: no se importa nada al grafo. Las pistas de un mismo hecho comparten su calendario, igual que las tarjetas respaldadas por el grafo; los hechos de ficheros siguen activos con independencia del contenido del grafo. El repaso, la práctica, los límites diarios, las pertenencias, la edición y las estadísticas funcionan igual para ambos orígenes.

Subir el mismo nombre de fichero con exactamente el mismo contenido convertido reabre el mazo de fichero existente sin otra ejecución de generación; un contenido distinto crea un mazo nuevo sin modificar las tarjetas ni el progreso existentes. La generación se trocea según el presupuesto de texto fuente configurado y usa la ranura barata actual o la sustitución del plugin. El trabajo aceptado continúa tras la navegación y usa los mecanismos existentes de cancelación y recuperación. Los reintentos explícitos procesan los fragmentos fallidos, cancelados o interrumpidos, nunca los correctos. Un fichero confirmado conserva su mazo aunque la generación falle o no devuelva tarjetas, con un estado visible de resultado y reintento.

Los límites de conversión son 25 MiB por fichero, 26 MiB de cuerpo multipart real, 1.000 páginas de PDF y 2 MiB de Markdown UTF-8 final, incluidos los marcadores de página; lo que exceda se rechaza, nunca se trunca en silencio. El host permite una única conversión a la vez e informa de que está ocupado en lugar de ponerla en cola. La cancelación es de mejor esfuerzo: los límites de entrada, páginas y salida **no** son un límite de tiempo de CPU estricto ni un tope de memoria máxima, y una conversión cancelada puede retener el hueco hasta que el parser subyacente se detenga. Antes de confirmar la generación, salir de la vista cancela la conversión o ignora los resultados tardíos de la preparación.

Solo se conserva en los datos del plugin el Markdown convertido, para reintentar e identificar ficheros repetidos, no la subida original. Este texto y el registro de detección de duplicados pertenecen al mazo del fichero: conservar un mazo vacío conserva ambos, y las subidas idénticas lo reabren sin regenerar; borrar ese mazo elimina ambos, de modo que una subida posterior puede ofrecer una generación nueva. Mover sus objetivos a otros mazos no transfiere la propiedad del texto fuente guardado; esos objetivos locales siguen siendo utilizables después de borrar el mazo original del fichero. Los registros normales de tareas en segundo plano también conservan sus entradas de generación. Las subidas no crean fuentes en el grafo ni disparan la canalización de extracción del grafo.

### Resumen de la repetición espaciada

Debajo del panel de mazos, el panel de control de toda la biblioteca muestra los recuentos de proposiciones nuevas, en aprendizaje, en repaso y en reaprendizaje, las fechas de vencimiento actuales (vencidas, hoy y los siete días de estudio siguientes) y catorce días de estudio de actividad de repasos programados. Las proposiciones compartidas cuentan una vez; las proposiciones archivadas y los grupos sin pistas activas se excluyen de los gráficos de estado actual y de vencimientos. El gráfico de vencimientos muestra las fechas de vencimiento siguientes existentes, no una predicción de repeticiones futuras. La actividad cuenta las calificaciones registradas, incluidos los repasos históricos de tarjetas archivadas o borradas después, no proposiciones únicas. La búsqueda y la selección no filtran el resumen. El resumen comparte la paleta de las calificaciones: New azul, Learning ámbar, Review verde, Relearning rojo. Las barras de vencimientos usan rojo para lo vencido, ámbar para hoy y azul para los días futuros; las barras de actividad son verdes. Solo se atenúan las fechas de la segunda línea del gráfico de vencimientos; los días de la semana y las fechas de actividad no cambian.

### Práctica extra

Elige **Practice selected / Practice all** en la fila de la selección; la práctica no se duplica en los menús de engranaje de los mazos. La práctica toma una instantánea de las pistas activas en el orden guardado de mazos, proposiciones y pistas, eliminando duplicados de las pistas compartidas y excluyendo las tarjetas archivadas o borradas. Incluye tarjetas nuevas y no vencidas sin límite diario. Revela cada respuesta y después selecciona Next; Espacio revela o avanza. No hay calificaciones, cambios de calendario, consumo de introducciones ni escrituras en el historial. Cada pista aparece una vez en esa sesión de práctica. El contador de práctica cuenta las otras pistas que siguen en la instantánea, sin incluir la pista mostrada. El contador va pegado al borde inferior de la tarjeta, encima de los controles. “Practice mode does not change your review schedule.” aparece centrado cerca del fondo del panel, fluyendo por debajo del contenido largo en lugar de taparlo. Reveal y Next son botones discretos con contorno y breves pistas “Space”. Cierra con la X del host o Escape.

Los ajustes controlan la retención deseada (90 % al principio), los pasos de aprendizaje (1m 10m), los pasos de reaprendizaje (10m), el inicio del día de estudio local (04:00), el presupuesto de los fragmentos de la fuente (unos 4.000 tokens de texto fuente, sin contar instrucciones ni contexto adicional) y las sustituciones de modelo y razonamiento para la generación. La sección del modelo tiene su propio conmutador Follow cheap slot: activado, sigue tanto el modelo como el razonamiento y oculta las filas de sustitución; desactivado, fija el modelo y razonamiento baratos actuales si están disponibles, o abre un borrador de selección de modelo sin guardar si no hay modelo barato disponible. El ajuste Model usa la etiqueta sans nativa y la descripción estándar “Follow cheap slot” debajo, con el conmutador a la derecha. Desactivado, solo aparecen debajo los selectores de modelo y razonamiento, uno junto al otro y alineados a la derecha, sin etiquetas extra ni un botón aparte de razonamiento por defecto o restablecer. Esto usa la API de ajustes existente sin fuentes personalizadas, estilos privados de widgets ni campos extra de la API. Volver a activar el conmutador borra ambas sustituciones; no se introduce ningún ajuste extra ni cambio de calendario. FSRS-6 usa los parámetros publicados e intervalos deterministas (sin variación aleatoria ni optimizador). Las repeticiones de aprendizaje usan la misma pista; el repaso normal pondera la elección de pista por su última autocalificación. El calendario es por proposición y, de forma intencionada, no es idéntico a la planificación por tarjeta de Anki.

Las preguntas y respuestas usan el renderizado real de Markdown del host, incluidos código, tablas, matemáticas y Mermaid. Edita las tarjetas sin reiniciar el progreso. Borrar una pista la elimina físicamente del almacén de tarjetas del plugin; la generación solo ve las tarjetas activas actuales, nunca un historial de tarjetas borradas. Si desaparece la proposición del grafo, su colección se archiva y se excluye del repaso; si vuelve el mismo ID, se activa de nuevo. Borrar una fuente no reorganiza las tarjetas que sobreviven.

## Prompts de generación

Toda la redacción de los prompts de generación está en **`src/generation-prompts.cjs`**:

- **`cardWriting`** — el marco compartido de tareas de recuperación: elección del objetivo frente a diseño de la pista; hechos atómicos coherentes; rutas de acceso distintas; preguntas centradas, precisas, coherentes, abordables y que exijan esfuerzo; autoevaluación justa; comprobaciones de falsos positivos y falsos negativos; y conjuntos de pistas selectivos y no redundantes. Los ejemplos usan el rendimiento de peticiones y las transacciones de bases de datos. Edítalo para cambiar a la vez los dos puntos de entrada de generación.
- **`inputSafety`** — tratamiento de las fuentes citadas y requisitos de fundamentación.
- **`outputProtocol`** — capacidades concisas de Markdown, delimitadores de LaTeX, signos de dólar literales (prosa o moneda escapadas frente a tokens de código), etiquetas de Mermaid, escapado de JSON, barras invertidas y saltos de línea, y el procedimiento compartido de finalización y reparación de `submit_result`. No hay indicaciones sobre avisos destacados ni énfasis.
- **`graphSourceInstructions` / `fileSourceInstructions`** — tareas específicas de cada fuente, reglas de contexto, cardinalidad e instrucciones sobre la forma del resultado.
- **`graphPromptFor` / `filePromptFor`** — los mensajes de usuario por fragmento y los envoltorios JSON de la carga útil.

Ambos workers usan instrucciones compuestas desde ese módulo. Igual que en la extracción del núcleo, el **presupuesto de fragmento solo cubre el material fuente**, estimado como caracteres divididos entre cuatro (redondeando hacia arriba): la generación desde el grafo suma el nombre de cada objetivo seleccionado más un salto de línea más su enunciado, y la generación desde ficheros cuenta el Markdown que se trocea. Las instrucciones, los esquemas de salida, los ID y envoltorios JSON, las proposiciones y cadenas vecinas y las tarjetas activas existentes no consumen ese presupuesto de fuente. Los objetivos del grafo siguen siendo indivisibles; un objetivo que supere el presupuesto de fuente recibe su propio fragmento. Los fragmentos de ficheros mantienen las preferencias existentes de párrafo y salto de línea sin pérdida y el troceado seguro para Unicode, incluidos los tramos exactos de reintento.

La **estimación de la petición completa es aparte**: sigue contando las instrucciones compuestas, el esquema de salida real y el mensaje de usuario completo como bytes UTF-8 divididos entre tres (redondeando hacia arriba), más el margen existente de 256 tokens de sobrecarga. Los diálogos de confirmación informan de esta estimación de entrada completa para tener presente el coste, y las comprobaciones del contexto del modelo reservan espacio de salida frente a la petición completa, no solo frente a la fuente. Los cambios en el marco de redacción no cambian la agrupación de los fragmentos de fuente. Los esquemas de resultado, los validadores y el troceado siguen en `src/backend.cjs` y `src/file-generation.cjs`; esa mecánica difiere entre los objetivos del grafo y los hechos extraídos de ficheros. Las instrucciones específicas de cada fuente siguen determinando si usar los objetivos proporcionados o extraer hechos nuevos, mientras que la seguridad y la mecánica de salida siguen separadas del marco de redacción.

## Datos y ciclo de vida

El estado propio del plugin es `data/flashcards.json`: una instantánea JSON con versión, sustituida de forma atómica tras las mutaciones locales. Contiene mazos, pistas, calendarios, registros de repaso, progreso de la generación y metadatos ligeros de las fuentes de ficheros. Los objetivos escritos a mano usan un origen local; los recibos de creación de pistas hacen idempotentes los reintentos de guardado manual incluso tras reiniciar, editar o borrar después. El texto convertido de los ficheros se guarda aparte en `data/sources/`, manteniendo los documentos grandes fuera de la instantánea que se reescribe en cada repaso. Los registros respaldados por el grafo existentes siguen siendo compatibles y conservan sus calendarios e historial. Los registros de tareas propiedad del host siguen en `data/tasks/`; el plugin no los sobrescribe. Desactivar o actualizar conserva las tarjetas vivas y el progreso. La migración del almacén purga de forma atómica las antiguas lápidas de pistas borradas y las viejas instantáneas de pregunta y respuesta de los repasos, saca de las pistas los recibos de reintento manual y olvida los registros de subidas huérfanos cuyos mazos borraron versiones anteriores. La eliminación de fuentes guardadas usa una cola de limpieza duradera, de modo que un fallo del sistema de ficheros se notifica y se puede reintentar o completar en la siguiente activación sin restaurar un mazo. Un almacén corrupto o no admitido es un error, nunca se reinicia en silencio.

Los montajes de contenido del repaso solo son dueños de su DOM, sus widgets y sus temporizadores. La limpieza y el remontaje de la presentación por parte del host (incluida la repetición de StrictMode en desarrollo) no cierran la sesión lógica de repaso; el cierre real, la reapertura y la cancelación por el propietario siguen desmontando sus ámbitos de contenido. Las calificaciones de repaso aceptadas y los fragmentos de los workers se aplican una sola vez. Cancelar cierra la barrera de aplicación del lote antes de cancelar las tareas pendientes; los fragmentos ya aplicados se mantienen. El reinicio concilia los resultados duraderos de los workers sin repetir el trabajo del modelo sin terminar. Un guardado fallido se muestra separado de una generación correcta del modelo; reintentar el guardado no hace otra llamada al modelo. Todo borrado de contenido espera a que la generación termine o se cancele, para evitar resultados y destinos obsoletos.

El almacén es deliberadamente pequeño y sencillo: un único proceso de backend es dueño de las escrituras. No se admite ejecutar a la vez procesos independientes del servidor de la app sobre el mismo directorio de datos del plugin. Si el tamaño de los datos hace que reescribir la instantánea sea caro, mide ese caso concreto antes de introducir más maquinaria de almacenamiento.

## Pruebas y límites

Con las dependencias de prueba disponibles:

```sh
npm test
```

Las pruebas del plugin cubren el almacenamiento y las migraciones, el borrado y los recibos
de reintento, la limpieza de fuentes ligadas a mazos, la creación manual, la generación,
cancelación y recuperación simuladas, el repaso filtrado por pistas, las pertenencias, la
planificación y las estadísticas con cambios de horario, el panel de control, la práctica de
solo lectura, la selección en el árbol y los ciclos de vida del frontend. La conversión de
documentos y los widgets del host están simulados; estas comprobaciones no llaman a ningún
modelo ni establecen la conversión de documentos con el host real ni la calidad de las
pistas.

Las pruebas DOM requieren además **`linkedom`**, que aporta el checkout de LearnHarness pero
no está declarado en el manifiesto de paquete de este proyecto. Un proyecto copiado necesita
que ese requisito de prueba se aporte por separado; su build solo necesita el `esbuild`
declarado.

`npm run test:native` es un arnés para mantenedores orientado al checkout, no una
comprobación del kit independiente. Requiere `puppeteer-core`, Chrome local, un runtime de
Electron Node (por defecto la ruta del checkout, o `LH_NODE_RUNTIME`), un host
correspondiente ya compilado en `LH_STANDALONE` y su `LH_APPROVED_HOST_DIGEST`, además del
plugin compilado. Copia los bytes del host y del paquete en almacenamiento desechable y
prueba los widgets nativos contra registros sintéticos con tráfico de catálogo por loopback.
El arnés supone una fixture `flashcards` cargada como plugin de la comunidad; ese supuesto de
admisión no es compatible con el ID reservado del núcleo en un host con paquetes del núcleo.
No lo tomes como una instrucción para instalar un duplicado de la comunidad ni como una
prueba de humo portable del núcleo. Las fixtures de navegador no son aceptación con ventana
física de Electron, proveedores reales ni experiencia de usuario humana.

## Ruta de lectura del código

- [`src/main.js`](src/main.js): vista, acciones y ajustes públicos, selección de
  conocimiento, conversión de documentos y llamadas entre frontend y backend.
- [`src/library-tree.js`](src/library-tree.js), [`src/review.js`](src/review.js),
  [`src/practice-queue.js`](src/practice-queue.js) y [`src/dashboard.js`](src/dashboard.js):
  estado controlado del árbol, ciclos de vida de las superficies, práctica de solo lectura e
  interfaz de estadísticas.
- [`src/backend.cjs`](src/backend.cjs), [`src/file-generation.cjs`](src/file-generation.cjs)
  y [`src/generation-prompts.cjs`](src/generation-prompts.cjs): definiciones de workers,
  troceado, validación, confirmación explícita y aplicación de resultados duraderos.
- [`src/store.cjs`](src/store.cjs), [`src/scheduler.cjs`](src/scheduler.cjs) y
  [`src/statistics.cjs`](src/statistics.cjs): registros propios del plugin y algoritmos del
  dominio, no requisitos de la API del host.
- [`scripts/build.mjs`](scripts/build.mjs) y [`tests/`](tests/): guardas de empaquetado y
  fixtures.

Consulta el [mapa de ejemplos](../../docs/plugin-examples.md), la
[guía de autoría](../../docs/plugin-authoring.md) y la
[referencia de la API](../../docs/plugin-api/README.md).

## Licencia

AGPL-3.0-only, igual que LearnHarness. El subconjunto de FSRS sin dependencias está adaptado selectivamente del `ts-fsrs@5.2.3` con licencia MIT; consulta `FSRS-LICENSE.txt`.
