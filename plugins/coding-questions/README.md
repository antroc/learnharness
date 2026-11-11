# Coding questions

Un plugin de LearnHarness para **preguntas de enseñanza y práctica de programación**, con un
editor de código con resaltado de sintaxis, código inicial opcional, soluciones modelo en
Markdown comprometidas y pruebas escritas por el agente que se ejecutan automáticamente al
enviar. El agente revisa el código exacto, el razonamiento separado y las observaciones de
las pruebas registradas. La práctica permite varios intentos; solo la herramienta nativa
**conclude** evalúa y cierra el problema.

**La ejecución local de código no está en un sandbox.** El código de prueba del profesor y el
código del alumno se ejecutan con los permisos del usuario de LearnHarness y el entorno
heredado: pueden acceder a ficheros, a la red y a los programas instalados. Un directorio de
trabajo temporal, un límite de tiempo y límites de salida son salvaguardas operativas, no
aislamiento de seguridad. Úsalo solo con código en el que confíes.

## Plugin del núcleo y requisitos

Activa Coding questions en **Ajustes → Plugins del núcleo**. Su código se incluye y se
actualiza con la app; los ficheros escribibles del plugin viven en
`<learning data>/core-plugin-data/coding-questions/`. Este proyecto de código es material de
referencia, no una copia instalable de la comunidad. `coding-questions` es un ID reservado
del núcleo, aunque esté desactivado o falte. Un fork de la comunidad necesita su propio ID de
manifiesto y carpeta y debe reconsiderar los ID de contribuciones y tipos, los nombres de
herramientas y los nombres de bloques cercados en conflicto; cambiar solo el ID del paquete
no renombra `coding_question` ni `coding_problem`. No instales esta build en una carpeta
`plugins/coding-questions/` de la comunidad.

Requiere una build de LearnHarness correspondiente con la API pública de calificación de
preguntas nativas (`registerQuestionType` con `gradeAnswer`), `registerQuestionRenderer`, las
API de práctica `registerProblemType` con `processSubmission` y `registerProblemRenderer`, y
`ctx.ui.mountBadge`/`ctx.ui.mountMarkdown`. Ambos registros son obligatorios en esta versión.
La colocación exacta de Test output y de Model solution en la enseñanza usa los huecos
opcionales `footerContainer` de respuesta y envío; los hosts compatibles sin esos huecos
mantienen un recurso legible en el cuerpo. El `minAppVersion` del manifiesto es solo una base
numérica, no una prueba de que el host aporte todas las capacidades necesarias. Usa
documentación y tipos del host que correspondan.

Los runtimes, compiladores, shells y bibliotecas necesarias deben estar ya instalados en la
máquina del usuario. Este plugin no incluye ninguno ni instala nada. Los programas se
resuelven mediante el **PATH** del proceso de la app, que puede ser distinto del de un
terminal interactivo, o mediante una ruta de ejecutable explícita que indique el profesor.
No hay herramienta de comprobación de versiones, catálogo de runtimes, instalador de paquetes
ni tabla de ejecutores por lenguaje.

La build solo del plugin escribe directamente en el **`dist/`** de este proyecto, que
contiene `manifest.json`, `main.js`, `backend.cjs`, `styles.css`, `assets/` y los avisos de
licencia. La limpieza solo sustituye `dist/` y rechaza un `dist/` enlazado simbólicamente o
un `dist/data/` mal colocado; el `data/` hermano se conserva. Compilar no instala, activa ni
actualiza el plugin del núcleo. El empaquetado de la app es una operación aparte del host.

## Contrato de preguntas y pruebas

El plugin aporta `coding_question` solo al **profesor**, no al sondeo ni al agente de
práctica. Los agentes de práctica reciben aparte `coding_problem` (ver más abajo). La
herramienta nativa recibe la `question` del host, `type` (`predict`/`check`), `nodeId` y esta
carga útil:

```ts
{
  language: string;
  starterCode?: string;
  modelSolution: string; // Markdown con el código de la solución cercado y una explicación opcional
  tests: {
    program: string;
    args: string[];
    code: string;
  };
}
```

Toda pregunta **nueva** requiere pruebas y un **modelSolution** en Markdown no vacío,
escritos en la llamada original de la pregunta. La solución contiene el código modelo
cercado y puede incluir una explicación; se conserva con la pregunta, se oculta en la
interfaz pendiente y solo se muestra tras el envío. No se ejecuta ni se prueba
automáticamente. Las preguntas existentes sin ella conservan sus datos originales y no tienen
el desplegable Model solution.

Si falta el código inicial o está vacío, se empieza en blanco; el alumno envía su código
completo, no un diff. Se permite el código inicial sin cambios. La disponibilidad exige
código que no sea solo espacios, no que pase las comprobaciones de sintaxis ni las pruebas.
Los finales de línea del editor pasan a LF; el resto de espacios en blanco se conserva.

Ante un envío válido, antes de guardar y continuar con el profesor, el plugin:

1. Crea un directorio de trabajo nuevo `data/test-runs/<questionId>/attempt-…/`.
2. Escribe el código enviado exacto en **`answer.txt`** como UTF-8.
3. Lanza `tests.program` con los `tests.args` literales, **sin shell implícita**, y envía
   `tests.code` a su entrada estándar. El directorio de trabajo es la ejecución nueva.
4. Registra el estado de salida y hasta **64 KiB por stream** de stdout/stderr, descartando
   la salida sobrante. El texto se decodifica como UTF-8; se omiten los caracteres finales
   incompletos truncados. Aplica un plazo de proceso de **30 segundos**.
5. Elimina el directorio del intento, incluida la salida del compilador y otros ficheros
   escritos dentro. Pueden quedar directorios de preguntas vacíos. El host guarda la
   respuesta aceptada y el resultado de la calificación y continúa con el profesor ordinario.

No hay ninguna convención de ejecución específica de cada lenguaje que mantener. El profesor
elige un intérprete o shell instalado y escribe el código completo del driver y las pruebas.
Por ejemplo, las pruebas de Python se pueden indicar en la llamada original a la herramienta
así:

```json
{
  "language": "Python",
  "starterCode": "def square(x):\n    pass\n",
  "modelSolution": "```python\ndef square(x):\n    return x * x\n```\n\nMultiply the value by itself.",
  "tests": {
    "program": "python3",
    "args": ["-"],
    "code": "from pathlib import Path\nnamespace = {}\nexec(compile(Path('answer.txt').read_text(encoding='utf-8'), 'answer.txt', 'exec'), namespace)\nassert namespace['square'](3) == 9\nassert namespace['square'](-2) == 4\nprint('Two supplied tests passed')\n"
  }
}
```

Para C++, el profesor puede elegir `program: "sh"`, `args: ["-s"]` y enviar un script de
shell que escriba un pequeño driver de pruebas que incluya `answer.txt`, invoque el
compilador del usuario y después ejecute el ejecutable. JavaScript puede usar `node` con
`["-"]`; otros lenguajes usan las herramientas instaladas que puedan interpretar o compilar
el driver proporcionado. El profesor es responsable de comprobar de verdad la respuesta y de
salir con un código distinto de cero si una prueba falla. Una shell es una elección
explícita de programa, nunca una interpolación del ejecutor. Las pruebas no deben instalar ni
descargar runtimes, compiladores o paquetes ni cambiar la configuración de la máquina. No hace
falta ninguna llamada aparte del profesor a herramientas ni ningún paso de gestión del
espacio de trabajo.

### Resultados y ciclo de vida

El resultado de calificación guardado tiene esta forma JSON propia del producto:

```ts
{
  status: "passed" | "failed" | "error";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  message?: string;
}
```

La salida 0 muestra una insignia verde **Tests passed**; una distinta de cero, una roja
**Tests failed**. Los programas que faltan, los errores de lanzamiento, los límites de tiempo
o la terminación inesperada por una señal muestran la neutra **Could not run tests**. El host
registra un fallo inesperado del calificador o del espacio de trabajo como `grading.error`,
que también recibe la presentación neutra. Todos estos resultados completados aceptan la
respuesta y continúan con el profesor; no son rechazos de validación. Describen las pruebas
proporcionadas, **no correcto/incorrecto**, y no hay puntuación.

La insignia va justo después de **Coding question** en el encabezado del host, como el
resultado de una pregunta nativa. El hueco público opcional `headerContainer` de
`mountAnswered` pertenece a la generación del host de ese montaje; los hosts más antiguos sin
él mantienen el recurso de colocarla en el cuerpo. No se consulta ni modifica el DOM
circundante del host.

Dentro de una tarjeta respondida, el orden es **pregunta original → código enviado → Your
thinking → Test output → Model solution**. La `input.question` original guardada siempre se
renderiza encima del código mediante el renderizador público de Markdown del host, también
en el historial existente; no hace falta almacenamiento nuevo, migración ni regenerar la
pregunta. Ambos desplegables empiezan cerrados y usan botones de texto discretos del ancho
del contenido, iguales que el control **Why** del quiz nativo: fuente de interfaz heredada,
texto de 11px y respuesta al pasar el ratón solo en el texto. No hay chevrón, mayúsculas ni
fondo en toda la fila. Las etiquetas expandidas son **Hide test output** y **Hide model
solution**; se conservan la activación nativa del botón con Enter/Espacio y el foco de
teclado visible.

Test output solo aparece si hay texto capturado, un mensaje de error o un aviso de
truncado. Los stdout/stderr no vacíos usan marcos y tipografía de bloque de código iguales,
con un tope de scroll de 16rem por stream; los espacios en blanco se conservan y los streams
vacíos no reciben caja. La salida nunca se interpreta como HTML. Model solution usa el
renderizador público de Markdown del host, incluidos el código cercado y la explicación, y
solo se monta mientras está abierta. Ambos desplegables comparten el `footerContainer`
público opcional, un bloque propiedad de la generación debajo del razonamiento del host; sin
ese hueco, el plugin mantiene un recurso legible en el cuerpo en lugar de mover o consultar
el DOM del host. No hay control para volver a ejecutar, recalificación automática ni
ejecución de la solución de referencia.

El host es responsable de la admisión de envíos, la persistencia y la continuación. Stop,
desactivar el plugin y perder la autoridad del envío cancelan la calificación sin guardar una
respuesta; la navegación por sí sola no la cancela. Los envíos cancelados o cuyo guardado
falla requieren un reintento explícito del alumno, que puede volver a ejecutar las pruebas.
Por tanto, las pruebas deben ser seguras ante reintentos; la ejecución no es una garantía de
exactamente una vez. Fuera del editor de código, Escape ofrece la confirmación existente del
host **Dismiss this question?**. Cancelar/Escape conserva el borrador; la confirmación solo
salta la aparición de la pregunta capturada, sin iniciar un turno del profesor. Si las
pruebas se están ejecutando, la misma petición al servidor valida el destino, aparca su
descarte y detiene la ejecución antes de responder. Una confirmación obsoleta no puede
detener ni saltar una pregunta sucesora. Se mantiene intacta la prioridad normal de Escape
para overlays y dictado. La terminación del árbol de procesos es de mejor esfuerzo: se matan
los grupos de procesos POSIX, pero un proceso que cree una sesión aparte puede sobrevivir; en
Windows, la terminación del árbol usa `taskkill`; el comportamiento de cada plataforma
requiere pruebas nativas. Los procesos que escapan no pueden dejar al ejecutor esperando
indefinidamente en las tuberías de salida heredadas tras el plazo o la cancelación. Los
ficheros escritos fuera del directorio de la ejecución no se eliminan.

Las preguntas históricas sin el requisito de calificación guardado siguen sin calificar; no
se ejecutan ni se reescriben con efecto retroactivo. Las instantáneas calificadas nuevas usan
el protocolo 2 del host, mientras que el contrato de preguntas compatible de este plugin
sigue en la versión 1. **No vuelvas a una versión anterior del host con preguntas
calificadas pendientes:** un host más antiguo puede cancelar una pregunta de protocolo 2 que
no sabe leer en lugar de limitarse a mostrarla como no disponible.

## Práctica de programación

Los agentes de práctica reciben la herramienta de planteamiento **coding_problem**,
registrada aparte como tipo de problema `code`, con etiqueta **Coding problem** y versión de
contrato 1. El nombre del plugin y del paquete sigue siendo **Coding questions**. Las
herramientas del profesor y el historial de enseñanza existente no cambian. El host aporta
los campos comunes:

```ts
{
  statement: string;
  mode: "recall" | "discrimination" | "composition";
  target?: string[];
  modelSolution: string; // solución en Markdown comprometida, que solo revela la conclusión
  payload: {
    language: string;
    starterCode?: string;
    tests: { program: string; args: string[]; code: string };
  };
}
```

El lenguaje y las pruebas son obligatorios. La solución modelo es un **campo común del
host**, nunca se repite dentro de la carga útil del plugin. Se compromete al plantear y nunca
se ejecuta. El enunciado se queda en la tarjeta de problema duradera del host; no se duplica
en cada envío. El dock usa el mismo editor, los mismos diagnósticos y las mismas teclas de
edición, seguidos del **Your thinking** del host y un único botón **Enviar**. No hay fase de
lectura ni de revelación.

Cada envío no vacío ejecuta la misma receta contra `answer.txt`, con los mismos límites,
permisos y limpieza descritos arriba. Su directorio de intento nuevo se agrupa en
`data/test-runs/<problemId>/`. El host guarda el código enviado exacto, el razonamiento
separado y `processing: {result: CodingTestResult} | {error: string}` antes de una
continuación de práctica ordinaria. Los fallos de las pruebas y los errores de ejecución son
observaciones sobre intentos aceptados, no rechazos de admisión ni una evaluación final de
corrección.

El alumno puede revisar y enviar repetidamente sobre el mismo problema activo. La aceptación
conserva el valor del editor y el estado de deshacer para iterar; el host solo borra el
razonamiento capturado que no ha cambiado. Los problemas nativos y de plugins comparten una
única barrera de problema activo. **Solo la herramienta conclude existente** evalúa y cierra
el problema y revela la solución modelo comprometida original en la tarjeta de conclusión
nativa. Que pasen las pruebas nunca concluye automáticamente, y los intentos individuales no
tienen desplegable Model solution.

Cada intento guardado muestra el código en solo lectura y su insignia de encabezado Tests
passed/Tests failed/Could not run tests. El orden es **código enviado → Your thinking → Test
output**. Test output usa el mismo desplegable discreto, cerrado al principio, y la misma
política de ocultar la salida vacía que en la enseñanza. Usa el `footerContainer` público de
`mountSubmitted` debajo de las imágenes y el razonamiento del host y `headerContainer` para la
insignia; si falta cualquiera de los huecos, hay recurso en el cuerpo. Los intentos
anteriores nunca se sobrescriben ni se vuelven a procesar cuando se envía una revisión
posterior. Si un registro guardado no tiene procesamiento, no se inventa una insignia ni se
ejecutan pruebas con efecto retroactivo.

La cancelación sigue la señal de procesamiento del host y la limpieza existente del
ejecutor; ningún resultado tardío puede guardarse tras perder la autoridad. La navegación o
la desconexión por sí solas no cancelan el trabajo aceptado. Un reintento explícito puede
volver a ejecutar las pruebas. Los plugins ausentes, desactivados o incompatibles mantienen
un problema activo como no disponible en lugar de sustituirlo por un editor de texto nativo;
el alumno puede usar el descarte nativo de la práctica. Escape en el código sale al
razonamiento; Escape fuera usa la confirmación nativa de la práctica y la precedencia de
capas.

## Editor y comportamiento nativo de las preguntas

El host aporta la presentación en Markdown de la pregunta, la tarjeta, la revelación y el
plegado, el razonamiento y el razonamiento de lectura, el micrófono, los controles de modelo
y razonamiento, Enviar respuesta y Descartar solo para recuperación, la persistencia nativa y
la continuación del profesor. **El dictado siempre va al razonamiento del host, nunca al
código.** Las comprobaciones conservan la lectura antes de la revelación. El host coloca el
razonamiento del alumno separado de la presentación del código y los resultados del plugin.

El editor ligero CodeMirror 6 incluye números de línea discretos, deshacer y rehacer,
emparejamiento de corchetes, sangría con Tab de cuatro espacios y sangría automática al
saltar de línea. **Enter y Mayús+Enter insertan un salto de línea dentro del código**;
**Cmd/Ctrl+Enter envía** a través del host. El razonamiento del host mantiene Enter para
enviar y Mayús+Enter para saltar de línea. El plugin solo gestiona las teclas de edición y no
implementa ninguna acción de envío. **Escape en el editor de código activo lleva el foco a
Your thinking**, sin abrir el diálogo de descarte ni cambiar el borrador. Desde ahí, Enter
envía; Tab continúa el ciclo de campos del host (razonamiento de lectura → código → Your
thinking en las comprobaciones; código → Your thinking en las predicciones). Tab dentro del
código sigue sangrando. Mayús+Tab mantiene el atajo del host para el razonamiento del modelo.
Esto es solo navegación entre campos, no un rediseño del orden de Tab del navegador en toda
la app. Las líneas largas hacen scroll horizontal. No se incluye autocompletado, inserción
automática de corchetes, formateador, controles de plegado, barra de ejecutar o copiar ni
servicios de IDE.

### Comentarios de sintaxis en vivo

Python, JavaScript, TypeScript, C, C++, Java, Rust, Go y JSON reciben comentarios
orientativos de sintaxis de parsers incluidos. Los alias del catálogo como `js`, `ts` y `cpp`
siguen la política canónica de lenguajes. Tras una pausa de escritura de 300 ms, los
problemas del parser aparecen como subrayados rojos o marcadores puntuales con el mensaje
**“Syntax problem.”** al pasar el ratón. No hay margen extra, panel de problemas, atajo,
corrección automática ni modificación del código. Las respuestas guardadas de solo lectura no
muestran diagnósticos.

Esto son comentarios del parser, no validación del compilador ni comprobación de tipos. Una
respuesta sin marcas puede seguir conteniendo errores; las respuestas grandes usan la región
analizada disponible sin forzar un análisis del documento completo. Los demás lenguajes solo
conservan el resaltado; en particular, el parser de SQL incluido no es un validador de SQL.
Los diagnósticos nunca bloquean el envío.

El catálogo estándar completo `@codemirror/language-data` se incluye en local. Los alias de
lenguaje cargan el resaltado bajo demanda; los lenguajes desconocidos o las cargas fallidas
siguen siendo utilizables como texto plano. No hay descargas de resaltado, ajustes de
lenguaje ni restricciones de lenguaje. Los colores One Dark de CodeMirror van dentro de un
marco monoespaciado con el tema del host.

Las preguntas y problemas pendientes y las respuestas e intentos enviados son registros
duraderos del host. El código y el razonamiento no enviados usan **borradores en memoria del
host**: plegar o remontar mientras vive el modelo de la sesión conserva los borradores, pero
la destrucción del modelo, la recarga y el reinicio de la app no tienen por qué. El plugin no
tiene almacén duradero de respuestas propio, RPC de backend, vistas ni ajustes.

## Desarrollo

En el kit de autoría extraído, copia el **contenido de `types/` de la raíz del kit**
compartido en el `.sdk/` de este proyecto **antes de preparar las dependencias**. Desde
`plugins/coding-questions/`:

```sh
mkdir -p .sdk
cp -R ../../types/. .sdk/
```

En cambio, en un checkout del código de LearnHarness, `npm run sdk` genera `.sdk/` usando
`../../scripts/build-plugin-types.mjs`. Ese comando **solo funciona en un checkout**; el kit
extraído no incluye el generador del host. El SDK solo contiene tipos y nunca se importa en
tiempo de ejecución.

Prepara aparte las dependencias de desarrollo, incluidas las dependencias peer y los tipos
declarados por el SDK. Ni esta referencia de código ni LearnHarness las instalan
automáticamente. Con las dependencias ya disponibles, el comando que solo compila es:

```sh
npm run build
```

La build empaqueta las dependencias JavaScript, emite el frontend ESM, el backend CommonJS y
los fragmentos locales de `assets/`, e incluye los avisos de licencia de terceros. No
necesita importaciones privadas del host ni una build de la app del host.

## Pruebas y límites

Tras preparar el SDK y las dependencias, estas son comprobaciones solo del plugin:

```sh
npm run typecheck            # consumidor estricto del SDK público, skipLibCheck=false
npm test                     # procesos Node locales reales, incluidos casos de límite de tiempo
npm run build
npm run test:browser          # plugin compilado en una fixture desechable de Chrome
```

Las pruebas unitarias cubren los contratos, los diagnósticos del parser, los bytes,
argumentos y entorno del ejecutor, la limpieza del espacio de trabajo, los errores de
lanzamiento, los límites de salida, el límite de tiempo y la cancelación, el registro y el
análisis de resultados. Ejecutan programas de prueba reales de confianza; no están en un
sandbox. La fixture de navegador cubre las teclas de edición, los borradores, la
presentación guardada de enseñanza y práctica, las insignias, los desplegables de salida y
solución y la limpieza. Requiere Chrome/Chromium local (`CHROME_PATH` o una ruta por defecto
admitida) y simula el host, incluidos los montajes de Markdown. No prueba la autoridad real
de envío del host, el renderizado de Markdown, la continuación de la práctica ni la
conclusión nativa. Para eso hacen falta pruebas de integración del host en el checkout, no
solo este proyecto exportado.

`npm run test:native` es un arnés de enseñanza orientado al checkout. Requiere los ficheros
del plugin compilados, un host correspondiente ya compilado en `LH_STANDALONE`, Chrome local
y el runtime de Electron Node de macOS del checkout. El host debe aportar la calificación de
preguntas, los registros de práctica y los huecos de cabecera y pie de las respuestas. El
arnés copia el host en almacenamiento desechable y usa tráfico de un agente simulado y
programas de prueba de Node instalados; no cubre turnos de práctica. Su fixture instala un
paquete `coding-questions` de la comunidad, un supuesto de admisión incompatible con el ID
reservado del núcleo en un host con paquetes del núcleo. No es una prueba de humo portable
del núcleo ni una instrucción para instalar un duplicado de la comunidad.

Las comprobaciones con fixtures no establecen la corrección con proveedores reales, el
comportamiento del micrófono o el IME, la experiencia con la ventana física de Electron, el
comportamiento del instalador firmado ni la ejecución multiplataforma. Usa datos sintéticos y
fixtures de loopback, nunca perfiles reales de alumnos ni proveedores de pago.

## Límite de la API

Solo se usan importaciones de tipos de `learnharness-plugin-api` y contratos públicos de
registro e interfaz. La ejecución en el backend usa módulos integrados de Node, no
importaciones privadas del host. Los hooks públicos `gradeAnswer`/`processSubmission` aportan
ciclos de vida de espera y guardado propiedad del host. Los `headerContainer` y
`footerContainer` opcionales de respuesta y envío aportan montajes acotados junto al
encabezado y debajo del razonamiento del host. `mountMarkdown`, público, renderiza las
preguntas guardadas y las soluciones modelo de la enseñanza; la conclusión nativa de la
práctica revela su solución comprometida. El plugin no añade ningún interceptor de envíos,
worker, agente aparte, ciclo de vida personalizado de preguntas o problemas ni herramienta de
conclusión. Las respuestas y envíos siguen siendo cadenas; la calificación y el procesamiento
siguen siendo metadatos aparte. El comportamiento en estado no disponible o desactivado y el
descarte seguro siguen siendo del host. Si la API no puede admitir un comportamiento
necesario, detente y pide una corrección explícita del host.

## Ruta de lectura del código

- [`src/contract.ts`](src/contract.ts): definiciones separadas de enseñanza y práctica,
  esquemas e instrucciones de ejecución para el modelo.
- [`src/backend.ts`](src/backend.ts) → [`src/runner.ts`](src/runner.ts): hooks públicos de
  calificación y procesamiento, ejecución de procesos, cancelación y limpieza.
- [`src/main.ts`](src/main.ts) → [`src/editor.ts`](src/editor.ts),
  [`src/diagnostics.ts`](src/diagnostics.ts) y [`src/question-view.ts`](src/question-view.ts):
  registro de renderizadores, editores controlados, sintaxis orientativa y enunciados
  guardados.
- [`src/result-view.ts`](src/result-view.ts), [`src/solution-view.ts`](src/solution-view.ts)
  y [`src/disclosure.ts`](src/disclosure.ts): montajes acotados de cabecera y pie y limpieza.
- [`scripts/build.mjs`](scripts/build.mjs) y [`tests/`](tests/): bundles, licencias y fixtures.

Consulta el [mapa de ejemplos](../../docs/plugin-examples.md), la
[guía de autoría](../../docs/plugin-authoring.md) y la
[referencia de la API](../../docs/plugin-api/README.md).

## Licencia

AGPL-3.0-only. Los paquetes compilados incluyen `THIRD-PARTY-LICENSES.txt` para CodeMirror/
Lezer y las bibliotecas de apoyo incluidas.
