# Arquitectura del host de plugins — API v1

Este es el mapa para quien mantiene el host. Para el código de un plugin, empieza por la
[guía de autoría](plugin-authoring.md) y usa los contratos de cada funcionalidad para el
comportamiento público normativo. Describe la API v1 del código fuente y la build
correspondientes.

## Límites y responsabilidades

Los plugins son código local de confianza. Los backends se ejecutan de forma cooperativa en
el servidor Node existente; los frontends se ejecutan en la página de la aplicación, no en un
iframe no fiable. El aislamiento del renderer de Electron y los límites de credenciales HTTP
del escritorio siguen vigentes, pero la API de plugins no es un sandbox de sistema de
ficheros o de red ni una garantía de aislamiento de recursos.

El host es responsable de la identidad y compatibilidad de los paquetes, el estado de
activación, los ciclos de vida, los contratos nativos de sesión, la persistencia y admisión y
el transporte de credenciales. Los plugins son responsables de los datos de su
funcionalidad, los prompts, las herramientas, la presentación, los algoritmos y la política
de producto. Los plugins oficiales y los instalados externamente usan el mismo host y las
mismas API. En la infraestructura del host no cabe lógica de dominio específica de
Flashcards, Coding Questions o Drawing Pad.

Las API de aprendizaje del backend comparten la interpretación nativa de los registros y son
de solo lectura, no un control de acceso obligatorio al sistema de ficheros. Las lecturas que
abarcan varios ficheros no son transaccionales. La gestión nativa de fuentes que hace el
usuario en el selector de conocimiento no es una API programable de escritura en el grafo.

## Mapa del código fuente

| Límite | Implementación principal |
| --- | --- |
| Contratos públicos seguros para el navegador | `src/core/plugins.ts`, `plugin-ui.ts`, `plugin-agents.ts`, `plugin-workers.ts`, `plugin-questions.ts`, `plugin-problems.ts`, `plugin-submissions.ts`, `plugin-view-context.ts`, `plugin-tree.ts` |
| Composición y runtime del servidor | `src/server/plugins.ts`, `plugin-host.ts` |
| Carga nativa de backends externos | `scripts/plugin-loader.cjs` |
| Carga de módulos en el navegador | `public/plugin-loader.js`, `components/plugin-manager.ts`, `plugins.tsx` |
| Selección y preparación de la build del núcleo | `core-plugins.json`, `scripts/build-core-plugins.mjs` |
| Rutas de datos escribibles según el origen | `src/store/plugin-data-paths.ts` |
| Adaptadores de datos y modelos | `src/server/plugin-learning.ts`, `plugin-inference.ts` |
| Conversaciones y tareas persistentes | `src/agent/plugin-agents.ts`, `plugin-workers.ts`; `src/store/plugin-agent-records.ts`, `plugin-task-records.ts` |
| Entrega de resultados y actividad en segundo plano | `src/server/plugin-background-tools.ts`, `plugin-worker-activity.ts` y las tareas y reorientaciones existentes del host |
| Contribuciones de herramientas al agente | Composición nativa del agente más `src/agent/plugin-question-tools.ts`, `plugin-problem-tools.ts` |
| Envío canónico de preguntas y problemas | `src/server/plugin-questions.ts`, `plugin-problems.ts` |
| Preparación de envíos en el frontend | `components/plugin-submission-runner.ts`, `plugin-submission-adapters.ts` |
| Marco, interfaz controlada y ajustes | `components/plugin-chrome.tsx`, `plugin-ui-host.tsx`, `plugin-settings-rows.tsx` |
| Identidad de superficies y cobertura del cuerpo | `components/plugin-surface-targets.ts`, `plugin-surfaces.tsx`, `plugin-surface-shell.tsx` |
| Lectores de instantáneas locales a la vista | `components/chat.tsx`, `session-view-readers.ts`, propietarios de docks nativos y personalizados |
| Carga útil y tipos para autoría | `scripts/build-server.mjs`, `build-plugin-types.mjs` |

Los nombres de fichero sueltos de una fila comparten el directorio anterior. Son costuras de
la implementación, no importaciones de runtime admitidas para el código de los plugins.

## Descubrimiento, instalación y ciclo de vida de los paquetes

La versión de la API del manifiesto es 1; las versiones de la app y de los paquetes son
numéricas `x.y.z`. Valida identidad, rutas, compatibilidad y entradas compiladas antes de
ejecutar código. Los paquetes desactivados se inspeccionan sin evaluarlos. Los plugins nuevos
del núcleo y de la comunidad están desactivados por defecto; las decisiones explícitas de
activar o desactivar comparten `plugins-state.json` y sobreviven a las actualizaciones de la
app.

Las ubicaciones de código y datos son explícitas:

| Propósito | Ubicación |
| --- | --- |
| Proyectos de autoría | `plugins/<id>/` del repositorio, con `dist/` generado |
| Código del núcleo, propiedad de la app y de solo lectura | `core-plugins/<id>/manifest.json` de la app y recursos compilados planos |
| Registros escribibles del núcleo | `<learning data>/core-plugin-data/<id>/` |
| Código de la comunidad | `<learning data>/plugins/<id>/dist/manifest.json` y recursos compilados |
| Registros escribibles de la comunidad | `<learning data>/plugins/<id>/data/` |

`core-plugins.json` selecciona Flashcards, Coding Questions, Drawing Pad y Rich Code Blocks.
`plugins:build-core` compila y prepara esos paquetes, recursos y licencias antes de las
builds admitidas de desarrollo y producción, web y de escritorio. UI Showcase sigue siendo un
ejemplo para desarrolladores. La preparación valida antes de sustituir la salida generada
anterior; si una build falla, se conserva el árbol preparado previo. `build-server.mjs` exige
el catálogo exacto, copia los paquetes del núcleo compilados y elimina el árbol de autoría
`plugins/` exacto de la raíz standalone trazada. Nunca elimina módulos de runtime con globs
amplios de `plugins`/`dist`.

El host carga directamente el código del núcleo; no hay copia en el arranque, ni diario de
instalación, ni migración de datos. La procedencia es `PluginInfo.origin`, propiedad del host,
no metadatos del manifiesto. Los ID del núcleo siguen reservados cuando falta un paquete o
está corrupto; las colisiones de la comunidad se omiten y se notifican aparte, sin modificar
ficheros ni bloquear el paquete legítimo del núcleo. Los metadatos de activación compartidos
corruptos se rechazan en lugar de sobrescribirse.

Electron fija `LH_DATA_DIR` en `<Electron userData>/data`; en macOS es
`~/Library/Application Support/LearnHarness/data/`. El desarrollo ordinario usa por defecto
`data/` del repositorio. La activación del backend y la recuperación de tareas de paquetes
desactivados usan el mismo resolutor de rutas escribibles según el origen; ninguna recurre a
copias antiguas de la comunidad de datos del núcleo. La recuperación nunca ejecuta código de
plugins ni crea directorios de datos que falten.

Refrescar descubre carpetas manuales y primeras builds; los cambios en código ya admitido
requieren reiniciar el servidor. No hay sustitución en caliente, ni registro aparte para
desarrollo, ni instalación npm en tiempo de ejecución, ni recurso a un manifiesto en la raíz,
ni actualizador automático de la comunidad. La limpieza de la build no debe alcanzar nunca
los datos hermanos ni seguir datos enlazados simbólicamente o mal colocados dentro de la
salida de la build.

La activación del backend pertenece al servidor; la del frontend, a la ventana; los montajes
de vistas tienen su propio ámbito independiente. La cancelación y la limpieza devuelta o
registrada revocan los registros, widgets y trabajo cooperativo propios; los resultados
asíncronos tardíos quedan acotados por instancia y generación. La caché de módulos dura hasta
el reinicio, así que los efectos secundarios de nivel superior no forman parte del ciclo de
vida. La navegación no desactiva un plugin ni detiene sus tareas en el servidor.

Solo se sirven públicamente las entradas de frontend y de estilos declaradas y `assets/`,
nunca el código del backend ni los datos persistentes. El puente de operaciones JSON del
frontend enruta hacia los manejadores registrados del backend propietario; no es un router
arbitrario. La conversión de documentos usa una ruta multipart acotada aparte, no ese puente
JSON.

## Presentación e interacción en el frontend

El host es responsable de los marcos de las vistas, los títulos, el desbordamiento de la
barra superior y el engranaje de ajustes. Las vistas solo montan el cuerpo de la
funcionalidad. Registrar acciones o vistas no crea navegación implícita: las ubicaciones se
dirigen explícitamente a la barra lateral, al grafo o a las barras superiores de la sesión o
vista de plugin seleccionada. El host gestiona el estado ocupado, la repetición y los errores
de las acciones asíncronas. Cada plugin activado tiene su propia página de Ajustes; la gestión
de paquetes se divide entre Ajustes → Plugins del núcleo y Plugins de la comunidad. La gestión
del núcleo omite los preámbulos de instalación y confianza, el directorio, el refresco y las
versiones rutinarias; la de la comunidad los conserva y muestra los conflictos de ID
reservados.

`ctx.ui` expone helpers controlados en lugar de acceso a React o a componentes privados. Los
handles actualizan las props de forma superficial, se liberan de forma idempotente y siguen
sus señales de montaje. Los valores y la persistencia siguen siendo del plugin; los selectores
nunca modifican los valores por defecto del modelo del núcleo. Las insignias y colores
genéricos no interpretan calificaciones. `mountMarkdown` usa la canalización real del host
solo con los elementos integrados, sin controles auxiliares ni despacho de bloques cercados de
plugins. `mountTree` comparte las primitivas de presentación y navegación con Chains, no su
controlador de dominio; quien lo llama es responsable de la jerarquía y la selección, de un
ancho suficiente y del scroll.

Los diálogos, menús, selectores y superficies del cuerpo de página usan el controlador de
interacción compartido; consulta las [reglas de diálogos y overlays](dialog-overlay-contract.md).
Cada Escape tiene un único propietario, el contenido cubierto no puede recibir acciones
nativas de envío o dictado, y el foco elegible se restaura sin enfocar controles separados o
cubiertos. La navegación con Tab del navegador no cambia. Los atajos declarativos de acciones
usan `src/core/plugin-shortcuts.ts` para la validación y la resolución estática de
solapamientos y conflictos de ámbito, y `components/plugin-shortcuts.tsx` para los lectores
de página indexados por ruta y el despacho elegible a través del ejecutor de acciones
existente. Los metadatos del atajo se capturan al registrarlo; el estado desactivado dinámico
se mantiene vivo. El almacén `lh:keymap` existente, los Ajustes de teclado y la chuleta
incluyen las acciones de plugins. El controlador de interacción toma una instantánea del
propietario original del primer plano al capturar la tecla; solo las superficies del cuerpo
de página de ese mismo propietario dejan pasar una acción de plugin. Las factorías de
interfaz reciben del host la identidad del plugin para esta comprobación, nunca props de
superficie proporcionadas por el autor. Consulta [atajos de acciones](plugin-authoring.md#atajos-de-acciones)
para el contrato público.

Los selectores de conocimiento capturan el origen desde el que se abren. Los orígenes de
página o superficie usan una vista en el panel principal; los orígenes modales o de Ajustes
usan un modal a pantalla completa con el padre aún pintado e inerte. El ciclo de vida del
origen y del widget y la invalidación de cargas pendientes impiden que cargas obsoletas del
grafo se abran en una vista sucesora. La organización de fuentes existente del usuario sigue
siendo del host.

Las superficies del cuerpo de página capturan un límite vivo (sin destino) o usan un destino
nativo opaco explícito. La barra superior y la lateral siguen utilizables. Las páginas y
superficies cubiertas siguen montadas; los hermanos ordinarios de la pila no adquieren los
ciclos de vida de los demás. La navegación hace caducar los límites; los tokens nunca reviven
al volver. Los diálogos y Ajustes quedan delante sea cual sea el orden de apertura. Los
títulos son nombres accesibles, no encabezados visibles obligatorios. Consulta el
[contrato de superficies](plugin-session-extension-contract.md#8-contrato-público-de-superficies).

## Contribuciones al agente y autoridad nativa sobre la entrada

Las instrucciones y herramientas nativas, los tipos de pregunta y los tipos de problema se
admiten una vez por turno como una dotación atómica por paquete. Los nombres del núcleo
siguen reservados. La admisión ordenada de paquetes nunca sobrescribe colisiones; un paquete
defectuoso no aporta nada en ese turno y recibe un aviso visible sin perder su backend o
vista no relacionados. Las ejecuciones de herramientas capturadas son revocables; anular el
registro afecta a las dotaciones futuras. Las llamadas y resultados nativos usan el ejecutor
y el historial existentes, no un framework de conversación específico de plugins.

Las preguntas de enseñanza y los problemas de práctica usan deliberadamente autoridades
nativas distintas:

- **Preguntas:** un registro congelado por turno y un libro de planteamientos certifican la
  ejecución correcta. Los metadatos `lhQuestions`, exclusivos de la app, vinculan los
  contratos guardados a apariciones exactas del asistente; los nombres, argumentos y
  resultados en bruto de las herramientas no crean autoridad pendiente. Los acuses temporales
  de planteamiento se suprimen; la adopción canónica controla los editores accionables. Los
  esquemas, el refinamiento y los requisitos de calificación guardados gobiernan las
  respuestas. Validar → calificar (opcional) → guardar → continuar; las observaciones y
  errores de calificación no fabrican una corrección nativa. Si faltan implementaciones
  necesarias, la entrada pendiente sigue no disponible. Consulta el [contrato de preguntas](plugin-question-contract.md).
- **Práctica:** los detalles del acuse de planteamiento aceptado contienen `pluginProblem`;
  los acuses nativos ya persisten, así que no hace falta un segundo libro de preguntas. Los
  planteamientos nativos y de plugins comparten una única barrera de problema activo y la
  evaluación `conclude` existente. Cada envío valida, procesa opcionalmente, guarda
  observaciones y continúa. Si faltan implementaciones o son incompatibles, el problema sigue
  activo pero no disponible, con descarte nativo; no hay recurso a un editor de texto.
  Consulta el [contrato de problemas](plugin-problem-contract.md).

La calificación y el procesamiento se ejecutan dentro del propietario existente de la
preparación del turno en línea, no en una tarea, cola o pasada de modelo nueva. Las
comprobaciones de identidad y registro tras cada `await` impiden guardados tardíos. Un Stop
explícito o una revocación cancelan de forma cooperativa y conservan la propiedad hasta que
la callback termina. Una desconexión HTTP o una navegación por sí solas no cancelan trabajo ya
admitido en el servidor. La proyección histórica, los reintentos y los remontajes nunca
recalculan la calificación o el procesamiento guardados.

## Preparación de envíos, imágenes e instantáneas de vista

Un único ejecutor de preparación en el frontend captura la aparición de destino, los
interceptores ordenados y el destino original del dictado antes de los `await`. Congela el
contexto y la entrada separados, transforma en serie los valores del alumno, vuelve a
comprobar la propiedad y después usa la admisión nativa por POST o reorientación. Cancelar o
fallar la preparación conserva los borradores; una entrega aceptada solo borra las revisiones
capturadas. La concesión termina con el acuse o el rechazo, no al final del stream del
modelo, de modo que la reorientación ordinaria mientras está ocupado sigue siendo posible.

Las callbacks de aceptación son en vivo y de mejor esfuerzo, no transacciones duraderas. Un
acuse perdido nunca autoriza a borrar material del plugin. Los reintentos del modelo
reutilizan la entrada transformada guardada; el recurso interno de reorientación a envío no
intercepta dos veces. El host reconstruye las respuestas derivadas integradas a partir de los
datos nativos capturados de la pregunta, no las copia de campos del plugin. El JSON del plugin
sigue sujeto a los esquemas canónicos guardados. Consulta [extensiones de sesión](plugin-session-extension-contract.md).

Los bloques de imagen nativos explícitos pasan por la admisión existente de bytes/MIME,
capacidad efectiva del modelo y redimensionado. Las imágenes normalizadas persistidas llegan
tanto al canal de interfaz como al del modelo; las rutas no se leen implícitamente y el
base64 no se inserta en cadenas de respuesta JSON. La conciliación optimista/canónica
existente evita previsualizaciones duplicadas y conserva los borradores inciertos. No se
añade un almacén de recursos de imagen ni un rediseño amplio de proveedores o cambio de
modelo.

`context.view` de la barra superior de la sesión es una instantánea separada y congelada de
toda la sesión, capturada al invocar. Reutiliza los mensajes actuales del navegador, la
transcripción proyectada y los lectores de entrada locales a la vista; los propietarios de
docks nativos y personalizados exponen la presentación y los borradores reales sin
inspeccionar el DOM, sin otro parser de historial y sin un almacén global. Las lecturas nunca
guardan, vacían el habla, revelan, procesan ni envían. Los datos se mantienen vinculados a
través de los `await`; los destinos opacos conservan sus ciclos de vida vivos. Los predicados
de desactivación usan instantáneas perezosas de render; los clics capturan de nuevo a través
del límite de errores de la acción. Consulta [contexto de vista](plugin-view-context.md).

## Inferencia, trabajo persistente y recuperación

`plugin-inference.ts` reutiliza la admisión de modelos y proveedores del host, el
consentimiento, la cancelación y la atribución del uso. La selección del catálogo y el
propósito son explícitos; no se expone ningún DTO de credenciales, transporte personalizado
ni recurso silencioso a otra clave.

Los agentes gestionados persisten conversaciones interactivas nativas y entradas externas
pendientes en los datos del plugin. Las definiciones las reconstruye la activación, no se
serializan los manejadores. Los ID de petición distinguen los reintentos de las acciones
nuevas. El reinicio recupera la entrada en espera y marca como interrumpidas las ejecuciones
en curso; la navegación solo desconecta a los observadores.

Los workers de resultados persisten la entrada y configuración aceptadas, el progreso nativo
y un resultado terminal validado en `data/tasks/`. Gana el primer resultado válido duradero,
incluido un JSON falsy; la cancelación no puede sustituirlo. Desactivar o reiniciar
interrumpe todo el trabajo sin terminar, incluidas las tareas en cola. La recuperación nunca
repite herramientas arbitrarias.

`createBackgroundTool` devuelve un acuse de despacho nativo y enlaza una tarea genérica del
host. El resultado del worker y la entrega posterior son hechos duraderos distintos: persiste
el resultado genérico antes del formateo asíncrono, usa las barreras existentes de despertar
y reorientación y los ID de entrega deterministas, y conserva un recurso legible cuando falla
el formateo o la disponibilidad del plugin. El reinicio vuelve a entregar resultados
persistidos, no formateadores ni herramientas. END no cancela la entrega pendiente de un
worker terminado. Los renderizadores de plugins solo sustituyen el cuerpo del resultado, no
la identidad, el estado ni los errores del host.

Un único pool de admisión FIFO global del proceso limita los **streams de modelo** en
segundo plano y libera los permisos antes de herramientas o esperas de hijos. Cubre los
workers nativos en segundo plano y todos los workers de plugins separados, no la enseñanza,
la práctica o la compactación directas, las conversaciones gestionadas interactivas ni la
inferencia en bruto de plugins. `agent.workerRequestConcurrency` vale 8 por defecto, acepta
enteros seguros positivos y se actualiza en vivo. El propósito gobierna el consentimiento de
suscripción, no la pertenencia al pool. La actividad de los workers independientes usa
Agentes en segundo plano sin duplicar las filas de tareas enlazadas.

La conexión de notificaciones de la app por ventana existente transporta eventos de
disponibilidad y de la app y mensajes de plugins con espacio de nombres. No es un registro
duradero de eventos arbitrarios. Al reconectar se invocan las callbacks de resincronización;
los observadores obtienen instantáneas actuales y liberan las suscripciones en la limpieza.

## Pruebas

Mantén pruebas en cada límite real:

- Guardas del manifiesto y las rutas, descubrimiento de desactivados, limpieza al activar y
  desactivar y revocación.
- Carga directa del núcleo, valores por defecto desactivados y decisiones persistidas,
  colisiones de ID reservados, rutas de datos escribibles aisladas y recuperación, y cargas
  útiles del núcleo completas sin código fuente.
- Atomicidad de colisiones en la dotación nativa, autoridad canónica de planteamientos,
  apariciones exactas, compatibilidad de esquemas, lotes mixtos de herramientas y rechazo de
  envíos obsoletos.
- Propiedad de la calificación y el procesamiento en línea, Stop y revocación, escritura
  antes de continuar, uniones con la compactación y ausencia de recálculo al reproducir.
- Generaciones de concesión de editores, limpieza asíncrona y StrictMode, conservación de
  borradores, teclado e IME, destino del dictado, recurso cuando falta el renderizador y
  colocación de imágenes.
- Carreras entre intercepción de envíos y acuses, y frescura e inmutabilidad de las
  instantáneas, incluidos los propietarios reales de la entrada y las acciones en línea y en
  el desbordamiento de la barra superior.
- Estado duradero de agentes y tareas, conservación de resultados aceptados y recuperación de
  la entrega de recurso.
- Compilación del SDK portable y carga útil seleccionada de docs, ejemplos y tipos de autoría.
- Cobertura completa de la referencia de la API generada y fidelidad de la exportación
  canónica del código fuente oficial.

Ejecuta las pruebas, la comprobación de tipos y el lint de la raíz y las pruebas de plugins
relevantes. Las comprobaciones de producción necesitan además una build desde un checkout
limpio, una auditoría seleccionada de standalone y privacidad, y comprobaciones aisladas de
runtime y navegador empaquetados; que pasen los fixtures de componentes no demuestra que la
app empaquetada funcione. Usa directorios desechables de alumno y autenticación y proveedores
de loopback en lugar de cuentas reales o de sustituir la app instalada. Entre las
herramientas relevantes están `build-plugin-types.mjs`, `build-server.mjs`,
`smoke-plugin-runtime.mjs`, `smoke-plugin-browser.mjs` y `smoke-server.mjs` en `scripts/`.

### Mantenimiento de la referencia de autoría

La [referencia de la API](plugin-api/README.md) es Markdown generado, no un segundo esquema
escrito a mano. Edita el JSDoc canónico del contrato público y las guías de comportamiento, y
después regenera a partir de las declaraciones correspondientes en un checkout del código
fuente con sus dependencias existentes:

```sh
node scripts/build-plugin-types.mjs dist/plugin-sdk
node scripts/build-plugin-api-reference.mjs dist/plugin-sdk docs/plugin-api
```

`tests/plugin-api-reference.test.ts` inventaría de forma independiente las exportaciones del
SDK y compara la referencia confirmada con una generación nueva, incluidas sobrecargas,
métodos anidados y tipos locales de apoyo referenciados. Los métodos de contexto son
capacidades del host invocables; el SDK, que solo contiene tipos, no expone en tiempo de
ejecución los helpers de implementación del host.

`npm run plugins:build-authoring` genera su referencia directamente a partir del SDK preparado
y exporta los proyectos oficiales canónicos sin sus builds, dependencias ni datos locales. Las
pruebas del paquete comprueban la identidad de los ficheros fuente, la admisión de privacidad
y rutas, los archivos deterministas y los enlaces autocontenidos. Mantén coherentes la
referencia de la API, el [mapa de ejemplos](plugin-examples.md) y las instrucciones de los
README de los proyectos cuando añadas una capacidad o un ejemplo de código.

## Fuera del alcance

Nada de sandbox ni proceso por plugin, marketplace ni actualizador de la comunidad,
sustitución en caliente, escrituras programables en los datos del núcleo, formularios o
interfaz genéricos ni framework de eventos de teclado en bruto, borradores persistentes de
editores arbitrarios, ni repetición automática o efectos externos exactamente una vez. La
infraestructura del host no debe elegir los prompts de producto, algoritmos, valores por
defecto ni política de borrado de los plugins.
