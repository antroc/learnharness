# Ejemplos de plugins y mapa de lectura del código

Usa la [guía de autoría](plugin-authoring.md) para el flujo de trabajo y las reglas de ciclo
de vida, y la [referencia de la API](plugin-api/README.md) para las firmas públicas. Esta
página relaciona esas API con código que funciona; no es una segunda especificación de la
API. Lee el README de cada proyecto antes de compilarlo o probarlo: los plugins son código
local de confianza, no extensiones en un sandbox.

## Elegir un punto de partida

| Empieza aquí | Papel | Qué aprender |
| --- | --- | --- |
| [Hello plugin](../examples/plugins/hello-plugin/README.md) | Punto de partida mínimo; sin build | Activación del frontend, una vista, colocaciones explícitas de acciones, un botón y un diálogo del host y limpieza por montaje |
| [UI Showcase](../plugins/ui-showcase/README.md) | Galería ejecutable de la comunidad para desarrolladores | Los 15 métodos públicos de interfaz, valores controlados, Restablecer local a cada familia y propiedad de los overlays |
| [Flashcards](../plugins/flashcards/README.md) | Referencia de código del núcleo | Una funcionalidad completa: entrada de conocimiento y documentos, resultados duraderos de workers, almacenamiento propio del plugin, árbol, superficies de repaso y ajustes |
| [Coding questions](../plugins/coding-questions/README.md) | Referencia de código del núcleo | Preguntas de enseñanza y envíos repetidos de práctica, editores controlados, observaciones del procesamiento y renderizado de resultados guardados |
| [Drawing Pad](../plugins/drawing-pad/README.md) | Referencia de código del núcleo | Acciones con contexto de sesión, atajos, superficies, adjuntar imágenes a los envíos del alumno y consumo de borradores consciente de los acuses |
| [Rich code blocks](../plugins/rich-code-blocks/README.md) | Referencia de código del núcleo | Renderizadores condicionales de bloques cercados, instrucciones aditivas, sincronización de ajustes, recursos locales y renderizado acotado |

Hello es el sitio más pequeño para empezar. Los proyectos de código oficiales son los
ejemplos principales y sustanciales; lee más abajo la ruta del punto de extensión que
necesites en lugar de copiar una funcionalidad entera. UI Showcase es una galería para
desarrolladores, **no** un plugin del núcleo incluido en la app. Las [recetas centradas para
los huecos](#recetas-centradas-para-los-huecos) cubren lo que falta, sin sustituir a estos
ejemplos principales.

## Las referencias del núcleo no son paquetes de la comunidad

Los cuatro ID **`flashcards`**, **`coding-questions`**, **`drawing-pad`** y
**`rich-code-blocks`** están reservados para los plugins del núcleo incluidos en la app,
aunque un paquete del núcleo esté desactivado, roto o falte. Su código se incluye para
estudiarlo y adaptarlo, no para instalarlo como duplicados de la comunidad. Activa las
funcionalidades que aporta la app en **Ajustes → Plugins del núcleo**. Las actualizaciones de
la app aportan el código del núcleo; los registros escribibles viven en
`<learning data>/core-plugin-data/<id>/`, separados de ese código.

Un fork de la comunidad necesita su **propio ID de manifiesto y un nombre de carpeta que
coincida**. Revisa también los identificadores de contribuciones y tipos, los nombres de
herramientas nativas y los nombres de bloques cercados: cambiar solo el ID del plugin no
resuelve todas las colisiones. En particular, no des por hecho que un fork puede registrar
`coding_question` / `coding_problem` o `smiles` / `abc` / `tikz` junto a los originales. Sigue
las reglas de propiedad y admisión del contrato público correspondiente. Usa siempre
`ctx.directory` para el código y `ctx.dataDirectory` para los registros escribibles; no
deduzcas uno del otro.

UI Showcase usa en su README el flujo ordinario de la comunidad. Hello y las recetas
centradas contienen ficheros `dist/` listos para cargar. Nada de esta referencia se instala,
activa ni ejecuta automáticamente.

## Estructura del código y requisitos previos

El kit de autoría descargado conserva la estructura del repositorio:

```text
<kit-root>/
  types/                          # SDK compartido, solo tipos
  docs/                           # guía, referencia de la API y este mapa
  examples/plugins/
    hello-plugin/
    managed-agent/
    teaching-extension/
  plugins/
    flashcards/
    coding-questions/
    drawing-pad/
    rich-code-blocks/
    ui-showcase/
```

Cada proyecto `plugins/<id>/` se exporta **byte a byte desde sus ficheros fuente
canónicos**, incluidos `src/`, `scripts/`, `tests/`, licencias y avisos, manifiestos,
`package.json`, lockfile y configuración de TypeScript cuando existen. Se excluyen los
`node_modules/`, `.sdk/`, `dist/` y `data/` generados o locales. El SDK compartido se queda en
`types/` en la raíz del kit; no se duplica en cada proyecto. Mantén intacta esta estructura
para que los enlaces de los README y del código funcionen tanto en el repositorio como en el
kit extraído. No instales el kit completo como plugin.

### Proyectos TypeScript

Para Coding questions, Drawing Pad, Rich code blocks y UI Showcase, copia el **contenido** de
`types/` del kit extraído en el `.sdk/` de ese proyecto **antes de preparar las dependencias
de npm**. Desde el directorio `plugins/<id>/` del proyecto en el kit extraído:

```sh
mkdir -p .sdk
cp -R ../../types/. .sdk/
```

Estos proyectos usan el paquete local `learnharness-plugin-api` mediante `file:.sdk`. Las
declaraciones solo contienen tipos, nunca una importación del host en tiempo de ejecución.
Prepara aparte las dependencias de desarrollo del proyecto y los peers y tipos declarados por
el SDK; la exportación del código no aporta una cadena de herramientas ni dependencias
instaladas. Consulta `types/package.json` para los peers correspondientes en lugar de elegir
versiones arbitrarias de Pi. Un SDK copiado no basta por sí solo para comprobar tipos sin esos
requisitos previos.

`npm run sdk` **solo funciona en un checkout**: invoca `../../scripts/build-plugin-types.mjs`
desde un checkout del código de LearnHarness con sus dependencias. Ese generador del host no
viene en el kit descargado; allí usa el paso de copia anterior. Flashcards es JavaScript y no
necesita `.sdk/` en absoluto.

### Compilar por separado de la instalación y las pruebas

Una vez disponibles las dependencias, todo proyecto de código oficial tiene el comando que
solo compila, que se ejecuta en su propio directorio:

```sh
npm run build
```

Su script escribe directamente en el `dist/` de ese proyecto, empaqueta las dependencias de
runtime y copia los recursos y avisos necesarios. La limpieza de la build rechaza un `dist/`
enlazado simbólicamente y un `dist/data/` mal colocado y conserva el `data/` hermano. No
arranca ni compila el host, no instala ni activa un plugin, no llama a ningún modelo ni
actualiza el código del núcleo. Para un fork de la comunidad con identificador nuevo o para
UI Showcase, sigue la [guía de instalación de la comunidad](plugin-authoring.md#empaquetado-e-instalación);
no instales las cuatro referencias con ID reservado.

## Rutas de lectura

### Flashcards: una funcionalidad completa de frontend y backend

Empieza por el [README](../plugins/flashcards/README.md) para la generación, la pertenencia a
mazos, las diferencias entre repaso y práctica y el ciclo de vida de los datos.

1. [`src/main.js`](../plugins/flashcards/src/main.js): registros de vistas, acciones y
   ajustes, widgets controlados del host, confirmación explícita de grafo o fichero,
   `ctx.documents.toMarkdown` y llamadas entre frontend y backend.
2. [`src/library-tree.js`](../plugins/flashcards/src/library-tree.js): elementos lógicos
   frente a apariciones en el árbol, selección, contenido enriquecido estable y estado de
   edición local. Después [`src/review.js`](../plugins/flashcards/src/review.js) para la
   separación de los ciclos de vida de superficie y contenido y los controles de repaso
   conscientes del teclado.
3. [`src/backend.cjs`](../plugins/flashcards/src/backend.cjs): lecturas públicas de
   aprendizaje, registro, inicio, suscripción y espera de workers, validación, cancelación y
   aplicación de resultados duraderos. [`src/file-generation.cjs`](../plugins/flashcards/src/file-generation.cjs)
   y [`src/generation-prompts.cjs`](../plugins/flashcards/src/generation-prompts.cjs)
   separan la mecánica de troceado y protocolo de las instrucciones al modelo.
4. [`src/store.cjs`](../plugins/flashcards/src/store.cjs) para la persistencia propia del
   plugin; [`src/scheduler.cjs`](../plugins/flashcards/src/scheduler.cjs),
   [`src/statistics.cjs`](../plugins/flashcards/src/statistics.cjs),
   [`src/dashboard.js`](../plugins/flashcards/src/dashboard.js) y
   [`src/practice-queue.js`](../plugins/flashcards/src/practice-queue.js) para los
   algoritmos y la presentación del producto. Esos algoritmos son una política de ejemplo,
   no API del host.
5. [`tests/`](../plugins/flashcards/tests/) y
   [`scripts/build.mjs`](../plugins/flashcards/scripts/build.mjs): costuras del host
   simuladas, regresiones del dominio y empaquetado.

La generación puede tener el coste del modelo configurado cuando se confirma explícitamente.
Repasar, escribir a mano y la práctica extra no hacen llamadas al modelo. No inicies una
generación solo para inspeccionar este código.

### Coding questions: contratos nativos de enseñanza y práctica

Lee el [README](../plugins/coding-questions/README.md), el
[contrato de preguntas](plugin-question-contract.md) y el [contrato de problemas](plugin-problem-contract.md).

1. [`src/contract.ts`](../plugins/coding-questions/src/contract.ts): definiciones separadas
   de enseñanza y práctica, esquemas de carga útil y política de ejecución para el modelo.
2. [`src/backend.ts`](../plugins/coding-questions/src/backend.ts): registros de
   `gradeAnswer` y `processSubmission`. Sigue hasta
   [`src/runner.ts`](../plugins/coding-questions/src/runner.ts) para los argumentos literales
   del programa, los directorios de trabajo, los límites de salida, la cancelación y la
   limpieza.
3. [`src/main.ts`](../plugins/coding-questions/src/main.ts) y
   [`src/editor.ts`](../plugins/coding-questions/src/editor.ts): registro de renderizadores,
   valores controlados del editor, disponibilidad e integración de las teclas de edición.
   [`src/diagnostics.ts`](../plugins/coding-questions/src/diagnostics.ts) aporta comentarios
   orientativos de sintaxis, no una barrera para el envío.
4. [`src/question-view.ts`](../plugins/coding-questions/src/question-view.ts),
   [`src/result-view.ts`](../plugins/coding-questions/src/result-view.ts),
   [`src/solution-view.ts`](../plugins/coding-questions/src/solution-view.ts) y
   [`src/disclosure.ts`](../plugins/coding-questions/src/disclosure.ts): enunciados
   guardados, insignias de salida, soluciones de enseñanza y limpieza acotada de montajes.
5. [`tests/`](../plugins/coding-questions/tests/) y
   [`scripts/build.mjs`](../plugins/coding-questions/scripts/build.mjs): pruebas con procesos
   locales reales, fixture aislada de navegador, bundles y recopilación de licencias de las
   dependencias.

**La ejecución de código no está en un sandbox.** Los programas de prueba del alumno y del
profesor se ejecutan con los permisos del usuario y el entorno heredado. Los límites de tiempo
y los directorios temporales no son aislamiento de seguridad. Que pasen las pruebas son
observaciones, no corrección automática ni conclusión de la práctica; el ciclo de vida nativo
del host sigue teniendo la autoridad.

### Drawing Pad: acciones contextuales y preparación de la entrada del alumno

Lee el [README](../plugins/drawing-pad/README.md), el
[contexto de vista](plugin-view-context.md) y el [contrato de extensiones de sesión](plugin-session-extension-contract.md).

1. [`src/main.ts`](../plugins/drawing-pad/src/main.ts): acciones contextuales y atajos con
   ámbito, destino de superficie nativo capturado, ajustes e intercepción de envíos.
2. [`src/reference.ts`](../plugins/drawing-pad/src/reference.ts) y
   [`src/poses.ts`](../plugins/drawing-pad/src/poses.ts): respetan la entrada que selecciona
   el host, la revelación y la disponibilidad y las apariciones de planteamientos aceptados,
   en lugar de reconstruirlas.
3. [`src/state.ts`](../plugins/drawing-pad/src/state.ts) y
   [`src/submission.ts`](../plugins/drawing-pad/src/submission.ts): revisiones capturadas,
   consumo consciente de los acuses y adjunto aditivo de imágenes nativas.
4. [`src/sheet.ts`](../plugins/drawing-pad/src/sheet.ts),
   [`src/strokes.ts`](../plugins/drawing-pad/src/strokes.ts) y
   [`src/geometry.ts`](../plugins/drawing-pad/src/geometry.ts): dibujo, gestos, cámara y
   geometría de exportación acotada propios del plugin. Después
   [`src/capture.ts`](../plugins/drawing-pad/src/capture.ts) y
   [`src/fonts.ts`](../plugins/drawing-pad/src/fonts.ts) para la captura consciente de la
   cancelación.
5. [`src/backend.ts`](../plugins/drawing-pad/src/backend.ts),
   [`src/settings.ts`](../plugins/drawing-pad/src/settings.ts),
   [`tests/`](../plugins/drawing-pad/tests/) y
   [`scripts/build.mjs`](../plugins/drawing-pad/scripts/build.mjs): preferencias, lecturas
   públicas de aprendizaje, validación, fixtures y avisos.

El estado del dibujo es memoria por ventana, no un almacén duradero de respuestas editables.
El host sigue siendo responsable de la aceptación de envíos, el procesamiento de imágenes y
las reglas de capacidad de imagen del modelo.

### Rich code blocks: renderizado condicional y recursos empaquetados

Lee el [README](../plugins/rich-code-blocks/README.md) para los ejemplos de notación, los
límites, la apariencia transparente y la diferencia entre dibujo estático y simulación.

1. [`src/main.ts`](../plugins/rich-code-blocks/src/main.ts) y
   [`src/backend.ts`](../plugins/rich-code-blocks/src/backend.ts): `registerCodeBlock`
   condicional, instrucciones aditivas, ajustes aceptados y lecturas al reconectar.
2. [`src/contract.ts`](../plugins/rich-code-blocks/src/contract.ts): elección de familias,
   ajustes validados, prompts y límites de entrada, salida y caché.
3. [`src/render.ts`](../plugins/rich-code-blocks/src/render.ts),
   [`src/tex-runner.ts`](../plugins/rich-code-blocks/src/tex-runner.ts) y
   [`src/tex-worker.ts`](../plugins/rich-code-blocks/src/tex-worker.ts): recursos perezosos,
   tareas en serie en un Worker del navegador, cancelación y ciclos de vida volátiles de la
   caché.
4. [`src/svg.ts`](../plugins/rich-code-blocks/src/svg.ts) y
   [`src/appearance.ts`](../plugins/rich-code-blocks/src/appearance.ts): reconstruyen SVG
   estático revisado, restringen las referencias y aplican un pintado consciente del tema sin
   fiarse del HTML en bruto.
5. [`scripts/build.mjs`](../plugins/rich-code-blocks/scripts/build.mjs),
   [`THIRD-PARTY.md`](../plugins/rich-code-blocks/THIRD-PARTY.md),
   [`licenses/`](../plugins/rich-code-blocks/licenses/) y
   [`tests/`](../plugins/rich-code-blocks/tests/): recursos locales del motor, adaptaciones
   del proyecto original, licencias y fixtures de navegador con las bibliotecas reales.

El renderizado no hace peticiones al modelo. Los límites del Worker de TeX y la
sanitización de SVG son salvaguardas locales de la funcionalidad, no un sandbox para
JavaScript arbitrario de plugins.

### UI Showcase: los 15 métodos de interfaz

El [mapa de la galería del README](../plugins/ui-showcase/README.md#mapa-de-la-galería) agrupa
todos los métodos en 12 familias. Empieza por [`src/gallery.ts`](../plugins/ui-showcase/src/gallery.ts):

| Área | Métodos |
| --- | --- |
| Selectores | `mountModelPicker`, `mountThinkingPicker`, `mountKnowledgePicker` |
| Escritura | `mountComposer`, `mountDictation`, `mountStandardComposer` |
| Controles y contenido | `mountButton`, `mountBadge`, `mountSettingsRows`, `mountMarkdown`, `mountTree`, `mountWorkerResult` |
| Overlays | `openMenu`, `openDialog`, `openSurface` |

Después lee [`src/main.ts`](../plugins/ui-showcase/src/main.ts) para las comprobaciones de
capacidades y las colocaciones, [`src/tree.ts`](../plugins/ui-showcase/src/tree.ts) para el
estado y los borradores locales a cada aparición,
[`src/surfaces.ts`](../plugins/ui-showcase/src/surfaces.ts) para el cuerpo de página, el
destino nativo y la propiedad anidada, y [`src/dom.ts`](../plugins/ui-showcase/src/dom.ts)
para la limpieza con ámbito. Compara [`tests/fixture.ts`](../plugins/ui-showcase/tests/fixture.ts)
con [`tests/native.mjs`](../plugins/ui-showcase/tests/native.mjs) para distinguir las
callbacks simuladas de las comprobaciones reales de la interfaz del host.

Los controles Enviar/Detener de la galería simulan el trabajo en local. **El dictado es real
cuando se inicia explícitamente**, puede enviar audio al proveedor de voz configurado y tener
coste. El selector de conocimiento es el control real del host: las acciones explícitas de
gestión de fuentes afectan a fuentes reales, aunque la selección de la galería sea local. Usa
datos sintéticos; no inicies el dictado para inspeccionar la galería.

## Recetas centradas para los huecos

Estos pequeños ejemplos sin build son recetas secundarias para mecanismos que el código
principal no muestra de forma tan directa:

- [Managed Agent](../examples/plugins/managed-agent/README.md): conversaciones interactivas
  persistentes mediante `ctx.agents`, herramientas de entrada pendiente, ID de petición,
  suscripción y trabajo en el backend independiente de la navegación. Lee
  [`dist/backend.cjs`](../examples/plugins/managed-agent/dist/backend.cjs) junto con
  [`dist/main.js`](../examples/plugins/managed-agent/dist/main.js) para el compositor
  controlado y el puente entre frontend y backend. No es una galería a escala de
  funcionalidad.
- [Teaching Extension](../examples/plugins/teaching-extension/README.md): herramientas
  nativas aditivas mediante `registerTools`, un renderizador de herramienta, un bloque
  cercado sencillo y el despacho y la entrega de resultados con `createBackgroundTool`. Lee
  [`dist/backend.cjs`](../examples/plugins/teaching-extension/dist/backend.cjs) y
  [`dist/main.js`](../examples/plugins/teaching-extension/dist/main.js). Es una receta
  centrada en agentes existentes, no un sustituto de Flashcards, de la práctica de
  programación ni de los contratos de entrada personalizada del alumno.

Ejecutar explícitamente sus agentes o workers puede tener coste con el proveedor configurado.
Leer, copiar o activar los ejemplos no es permiso para hacer peticiones al modelo. Para API
que no cubra ninguna ruta, usa la referencia de la API y la guía en lugar de inventar el
comportamiento de un ejemplo.

## Qué aportan las comprobaciones y qué no

| Proyecto | Comprobaciones solo del plugin tras preparar los requisitos | Entorno extra / límite |
| --- | --- | --- |
| Flashcards | `npm run build`; `npm test` con su requisito adicional de pruebas DOM | Las pruebas usan `linkedom`, que no está declarado localmente; lo aporta el checkout. El arnés nativo necesita `puppeteer-core`, Chrome, Electron Node y un host standalone con digest correspondiente. |
| Coding questions | `npm run typecheck`, `npm test`, `npm run build`; `npm run test:browser` con Chrome | Las pruebas unitarias lanzan procesos Node locales reales. El host y el Markdown del navegador están simulados. El arnés nativo de enseñanza necesita un host standalone correspondiente, Chrome y el Electron de macOS del checkout; no es una comprobación de turnos de práctica. |
| Drawing Pad | `npm run typecheck`, `npm test`, `npm run build` | `test:browser` importa componentes, recursos y dependencias privados del host del checkout; el kit exportado por sí solo no puede ejecutarlo. No hay script `test:native`. |
| Rich code blocks | `npm run typecheck`, `npm test`, `npm run build`; `npm run test:browser` con Chrome | La fixture de navegador usa los bundles compilados y las bibliotecas de renderizado reales con un host simulado. No hay script `test:native`. |
| UI Showcase | `npm run typecheck`, `npm test`, `npm run build` | El arnés nativo necesita un host standalone con digest correspondiente, un indicador de disponibilidad, Chrome y Electron Node; los registradores de interfaz de las pruebas unitarias no demuestran la disposición ni el foco nativos reales. |

La exportación del código conserva las pruebas para estudiarlas; **no** promete que todas sean
independientes. Lee el README y el arnés del proyecto para conocer las variables de entorno y
los supuestos de plataforma. Los arneses nativos de Flashcards y Coding questions instalan
fixtures con ID de la comunidad, que un host con paquetes del núcleo e ID reservados no admite
sin cambios; no los uses como instrucciones de instalación ni como pruebas de humo portables
del núcleo. Las pruebas de integración exclusivas del host y los módulos privados del host no
se exportan con estos proyectos. Las comprobaciones con el host nativo empaquetado requieren
un host correspondiente aportado por separado, no solo el SDK público de declaraciones o un
plugin compilado.

Usa perfiles desechables, registros sintéticos y fixtures de loopback. Las comprobaciones de
los plugins no son aceptación funcional con proveedores reales, hardware, ventana completa de
Electron, instalador, multiplataforma ni humana. Este mapa no implica instalar dependencias,
lanzar el host, hacer peticiones a proveedores ni ejecutar verificaciones.
