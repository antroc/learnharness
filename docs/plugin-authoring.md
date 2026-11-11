# Crear un plugin de LearnHarness

Los plugins son **código local de confianza**, no extensiones en un sandbox. Los módulos de
backend se ejecutan en el servidor Node de LearnHarness con acceso al sistema de ficheros y
a la red; los frontends se ejecutan en la página de la app. Instala solo código en el que
confíes. La API no expone las credenciales de los proveedores ni relaja el aislamiento del
renderer de Electron.

Esta guía describe la API v1 del código fuente y la build correspondientes. La API v1 puede
ganar capacidades sin cambiar su número. Usa documentación y tipos que correspondan a la app
de destino, y fija `minAppVersion` en una versión que proporcione realmente todas las
capacidades que uses. El `bundle.json` de la skill descargada identifica las versiones de la
app que la generó, de la API y del SDK; son números distintos, no garantías de
compatibilidad intercambiables.

## Mapa de la documentación

| Necesidad | Lectura |
| --- | --- |
| Primer plugin e instalación | [Inicio rápido](#inicio-rápido) y después la [estructura del paquete](#empaquetado-e-instalación) |
| Cada firma, propiedad y tipo de apoyo públicos | [Referencia completa de la API](plugin-api/README.md) |
| Proyectos reales y rutas de lectura del código | [Ejemplos](plugin-examples.md) |
| Preguntas de enseñanza y calificación | [Contrato de preguntas](plugin-question-contract.md) |
| Problemas de práctica y procesamiento | [Contrato de problemas](plugin-problem-contract.md) |
| Intercepción de envíos, imágenes y superficies | [Extensiones de sesión](plugin-session-extension-contract.md) |
| Instantáneas y borradores de la sesión actual | [Contexto de vista](plugin-view-context.md) |
| Árboles controlados | [Contrato de árboles](plugin-tree-contract.md) |
| Reglas de modales, menús, foco y Escape | [Contrato de interacción](dialog-overlay-contract.md) |
| Responsabilidades del host y límites de la implementación | [Arquitectura](plugin-architecture.md) |

La referencia de la API se genera a partir de los mismos contratos públicos que el SDK
portable. Indexa cada tipo público y cada miembro declarado, incluidas las sobrecargas y los
tipos locales de datos y eventos referenciados. Las guías explican el comportamiento y la
recuperación; las firmas de la referencia explican las formas exactas. Ninguna requiere
importar módulos privados del runtime de la app.

## Inicio rápido

El flujo principal de desarrollo desde el código fuente es **clonar en el directorio de
plugins de la app y compilar allí**. No hace falta clonar el repositorio de LearnHarness.

1. Abre **Ajustes → Plugins de la comunidad** y copia la ruta del directorio de plugins.
2. Clona el repositorio del plugin en `<plugins-directory>/<plugin-id>`. El nombre de la
   carpeta debe coincidir con el `id` de su manifiesto, que puede ser distinto del nombre
   del repositorio.
3. Sigue la preparación de dependencias del proyecto y ejecuta `npm run build` en esa
   carpeta. La build escribe directamente en su `dist/`; no hace falta ningún paso de
   instalación adicional.
4. Refresca la lista y activa el plugin. Reinicia LearnHarness después de cambiar código ya
   cargado; Refrescar descubre paquetes, no recarga JavaScript en caliente.

Para un proyecto que incluya lockfile y script de build:

```sh
git clone <repository-url> "<plugins-directory>/my-plugin"
cd "<plugins-directory>/my-plugin"
npm ci
npm run build
```

Compila solo código en el que confíes: la instalación de dependencias y los scripts de build
ejecutan código local. LearnHarness por sí mismo no ejecuta ningún comando npm. Las builds
deben conservar el `data/` hermano.

Para un plugin nuevo, descarga y extrae **Descargar skill de autoría** y después entrega la
carpeta `learnharness-plugins/` completa a tu agente de programación y pídele que lea
`SKILL.md`. Su README explica cómo preparar el agente. El SDK incluido funciona sin un
checkout de LearnHarness; las herramientas de build y dependencias del plugin se instalan
aparte.

Empieza con **Hello** para el plugin más pequeño. Después usa [las rutas de lectura de los
ejemplos](plugin-examples.md) para explorar **UI Showcase**, **Drawing Pad**, **Coding
Questions**, **Flashcards** y **Rich Code Blocks**. La skill incluye sus proyectos de código
reales, no implementaciones de ejemplo paralelas. Managed Agent y Teaching Extension son
recetas centradas en capacidades que los proyectos mayores no muestran de forma tan directa.

Hello y las dos recetas centradas incluyen distribuciones sin build que se pueden
[instalar directamente](#instalar-un-paquete-precompilado); sus manifiestos exportados exigen
la versión de la app que los generó, indicada en `bundle.json`. Los manifiestos de referencia
del código oficial no cambian. Cuatro proyectos oficiales son plugins del núcleo con ID
reservados: lee su código, no lo tomes como instrucciones para instalar copias de la
comunidad sin cambios. UI Showcase es una galería de la comunidad para desarrolladores. Las
recetas que usan modelos pueden tener coste cuando se ejecutan explícitamente. No se instala
nada automáticamente; mantén la skill completa y no instales nunca la skill entera como
plugin.

## Elegir el punto de extensión

| Objetivo | API / referencia |
| --- | --- |
| Pantalla y controles propios | `registerView`, acciones y `ctx.ui`, más abajo |
| Ajustes propios del plugin | `registerSettings`, más abajo |
| Inspeccionar la sesión actual, incluida la entrada no enviada | `context.view` de la barra superior de la sesión; [contexto de vista](plugin-view-context.md) |
| Añadir instrucciones o herramientas a agentes existentes | `registerInstructions` y `registerTools`, más abajo |
| Pregunta de enseñanza y editor personalizados | `registerQuestionType` + `registerQuestionRenderer`; [contrato de preguntas](plugin-question-contract.md) |
| Problema de práctica y editor personalizados | `registerProblemType` + `registerProblemRenderer`; [contrato de problemas](plugin-problem-contract.md) |
| Transformar la entrada del alumno o adjuntar imágenes | `registerSubmissionInterceptor`; [extensiones de sesión](plugin-session-extension-contract.md) |
| Cubrir el cuerpo de la página actual | `ctx.ui.openSurface`; [contrato de superficies](plugin-session-extension-contract.md#8-contrato-público-de-superficies) |
| Renderizar bloques de código cercados o resultados de herramientas | `registerCodeBlock` y `registerToolRenderer`, más abajo |
| Mostrar una jerarquía controlada | `ctx.ui.mountTree`; [contrato de árboles](plugin-tree-contract.md) |
| Convertir un PDF o fichero de texto subido | `ctx.documents.toMarkdown` del frontend, más abajo |
| Leer registros de aprendizaje guardados | `ctx.learning` del backend, más abajo |
| Llamar a modelos, ejecutar conversaciones o tareas acotadas | `ctx.inference`, `ctx.agents` y `ctx.workers` del backend, más abajo |

Los contratos de cada funcionalidad definen las reglas de ciclo de vida y aceptación; esta
guía es el punto de entrada. Consulta la [referencia completa de la API](plugin-api/README.md)
para las firmas exactas y los tipos con enlaces cruzados. Los contratos públicos canónicos
están en `src/core/plugins.ts`, `plugin-ui.ts`, `plugin-agents.ts`, `plugin-workers.ts`,
`plugin-questions.ts`, `plugin-problems.ts`, `plugin-submissions.ts`,
`plugin-view-context.ts` y `plugin-tree.ts` (todos en `src/core/`). Usa importaciones
**solo de tipos**, nunca importaciones en tiempo de ejecución de módulos privados del host.
El SDK portable, que solo contiene tipos, lo emite `node scripts/build-plugin-types.mjs`. Los
plugins TypeScript del repositorio usan un `.sdk/` local y `npm run sdk`; fuera de un
checkout, copia el `types/` de la skill extraída en `.sdk/` antes de instalar las
dependencias. Por ejemplo, usa `"learnharness-plugin-api": "file:./.sdk"` en tus
dependencias de desarrollo e `import type { PluginFrontendContext } from
"learnharness-plugin-api"` en TypeScript. Proporciona las dependencias peer declaradas del
paquete del SDK al comprobar tipos; no lo importes en tiempo de ejecución. Compilar el SDK
requiere un checkout; usar el SDK descargado, no. Los tipos nativos de Pi forman parte
deliberadamente de la API v1 y siguen el SDK fijado por la app, no versiones arbitrarias de
Pi.

## Empaquetado e instalación

Los paquetes de la comunidad usan esta estructura de instalación escribible:

```text
<learning data>/plugins/my-plugin/
  package.json       # configuración de autoría opcional
  src/               # código fuente opcional; nunca un recurso en tiempo de ejecución
  dist/              # raíz de runtime fija obligatoria
    manifest.json
    main.js          # módulo ES de navegador opcional
    backend.cjs      # módulo CommonJS de Node opcional
    styles.css       # opcional; requiere una entrada de frontend
    assets/          # recursos y módulos públicos distribuibles
  data/              # hermano persistente; no lo distribuyas ni lo sirvas nunca
```

Un manifiesto tiene `apiVersion: 1`, un `id` en minúsculas con guiones que coincide con la
carpeta del espacio de trabajo, `name`, y `version` y `minAppVersion` numéricos `x.y.z`; los
campos opcionales son `description`, `author`, `main`, `backend` y `styles`. Se necesita al
menos uno de `main` o `backend`. Los nombres de fichero de las entradas designan ficheros de
la raíz de `dist/` con sus extensiones obligatorias, no rutas hacia el código fuente o los
datos. Los paquetes mal formados o incompatibles se notifican sin evaluarlos.

- Compila directamente en el `dist/` del proyecto, no en `dist/<id>/`. Empaqueta las
  dependencias JavaScript; deja externos los módulos integrados de Node en el backend
  CommonJS. El host no instala dependencias ni recompila módulos nativos.
- Distribuye el **contenido** del `dist/` compilado e instálalo en `<id>/dist/`, no en
  `<id>/`. Los ejemplos sin build ya tienen esta estructura y se pueden copiar como carpetas
  completas.
- Conserva `<id>/data/` al actualizar el código. La limpieza de la build solo debe eliminar
  el `dist/` generado, nunca el espacio de trabajo ni los datos. Rechaza un `dist/` enlazado
  simbólicamente y cualquier entrada `dist/data/` mal colocada, incluidos los enlaces
  simbólicos, antes de borrar o compilar.
- El plugin es responsable del esquema y las migraciones de sus datos; niégate a reescribir
  un formato más nuevo que no entiendas. Reserva `data/agents/`, `data/tasks/` y
  `data/usage.jsonl` para los servicios del host.
- Los plugins recién descubiertos están desactivados por defecto. Desactivar no borra datos.
  Los proyectos que solo tienen código fuente y los manifiestos solo en la raíz no son
  instalables. No hay registro aparte para desarrollo, recurso a la estructura antigua ni
  sustitución de código en caliente.

Los plugins del núcleo y de la comunidad usan las mismas API, pero tienen ubicaciones de
código y datos distintas. La app incluye Flashcards, Coding Questions, Drawing Pad y Rich
Code Blocks como paquetes compilados planos en `core-plugins/<id>/` de la app, cargados
directamente sin una copia del código en los datos de usuario. Sus ajustes y registros
escribibles viven en `<learning data>/core-plugin-data/<id>/`. Usa siempre `ctx.directory`
para el código y `ctx.dataDirectory` para los registros escribibles; no deduzcas uno del
otro. Los plugins del núcleo se actualizan con la app y se gestionan en **Ajustes → Plugins
del núcleo**; los cuatro empiezan desactivados, las decisiones explícitas existentes
sobreviven a las actualizaciones y desactivar nunca borra datos. Sus ID (`flashcards`,
`coding-questions`, `drawing-pad`, `rich-code-blocks`) están reservados aunque un paquete del
núcleo esté roto o falte. Las carpetas de la comunidad en conflicto se omiten con un
diagnóstico y no se modifican.

El código fuente del repositorio se queda en `plugins/`. `npm run plugins:build-core`
compila el catálogo seleccionado en `core-plugins.json` y prepara los paquetes generados. UI
Showcase sigue siendo un ejemplo de código para desarrolladores, no un paquete del núcleo
incluido. Este comando de build nunca instala ni activa un paquete en un directorio de datos
de aprendizaje.

### Instalar un paquete precompilado

Copia o extrae el plugin de modo que sus ficheros compilados ocupen
`<plugins-directory>/<plugin-id>/dist/manifest.json` y los bundles y recursos hermanos. Los
ejemplos sin build incluidos ya tienen la estructura `<plugin-id>/dist/`: copia la carpeta
completa de un ejemplo, refresca la lista y actívalo. Esos ejemplos no requieren preparar
Node ni npm. No añadas una capa anidada extra `dist/<plugin-id>/`.

Al actualizar un plugin existente, sustituye solo su `dist/` y conserva el `data/` hermano.
Reinicia LearnHarness para cargar las actualizaciones de código ya cargado.

### Desarrollar fuera del directorio de plugins

Mantén la misma estructura de proyecto y compila en local. Copia el `dist/` terminado en
`<plugins-directory>/<plugin-id>/dist/` o usa el instalador local portable.

1. Copia `tools/install-plugin-local.mjs` de la skill de autoría extraída en
   `scripts/install-plugin-local.mjs` de tu proyecto. En un checkout de LearnHarness, el
   mismo helper está en `scripts/install-plugin-local.mjs`.
2. Añade este script al `package.json` del plugin, junto a su script `build` existente:

   ```json
   {
     "scripts": {
       "install:local": "npm run build && node scripts/install-plugin-local.mjs"
     }
   }
   ```

3. Desde el proyecto del plugin, indica el directorio que muestran los Ajustes:

   ```sh
   npm run install:local -- "<plugins-directory>"
   ```

El comando compila primero. Si la build falla, la instalación no se ejecuta. El helper solo
usa módulos integrados de Node, comprueba el manifiesto y los ficheros de entrada compilados e
instala con el ID de plugin del manifiesto. El directorio de plugins indicado debe existir ya.
No deduce un perfil ni guarda configuración. El host sigue decidiendo la compatibilidad con
la app y la admisión de ID reservados al refrescar.

En las actualizaciones, el helper prepara una sustitución completa antes de apartar el
`dist/` anterior; los recursos obsoletos se eliminan en lugar de fusionarse. Si la
sustitución falla, restaura el paquete anterior. Si falla la propia reversión, el error
indica la ruta de la copia de seguridad conservada. El `data/` hermano, los ficheros fuente y
las decisiones de activación no se tocan. Se rechazan raíces, entradas del paquete o rutas de
destino enlazadas simbólicamente y un `dist/data/` mal colocado. `data/`, `node_modules/`,
`.git/` y los ficheros de credenciales, que no son distribuibles, no deben estar en `dist/`.

Si el código fuente y el `dist/` instalado ya son el mismo directorio, el helper informa de
una build in situ sin copiar. Para ese flujo, es preferible un simple `npm run build`.
Después refresca y activa un plugin nuevo; reinicia LearnHarness para el código ya cargado.
El comando no activa plugins ni reinicia la app automáticamente.

## Ciclo de vida y navegación en el frontend

```js
export function activate(ctx) {
  ctx.registerView({
    id: "library",
    name: "My library",
    mount(container, signal) {
      const button = ctx.ui.mountButton(container, {
        label: "Plugin settings", onClick: () => ctx.app.openSettings()
      }, { signal });
      return () => button.dispose();
    }
  });
  ctx.registerAction({
    id: "open-library", name: "Open my library",
    run: () => ctx.app.openView("library")
  });
  ctx.placeAction({ id: "library-sidebar", actionId: "open-library", location: "sidebar" });
}
```

La activación ocurre una vez por plugin activado **en cada ventana**. La limpieza devuelta y
`ctx.cleanup(fn)` se ejecutan al desactivar. Registra vistas, acciones y ajustes durante la
activación; no inicies efectos secundarios en el nivel superior del módulo, porque los
módulos nativos permanecen en caché. Los ID de vistas y acciones tienen de 1 a 128 letras
ASCII, dígitos, puntos, guiones bajos o guiones, y empiezan por letra o dígito. Los nombres
visibles son texto normal.

Una vista solo monta el cuerpo de la funcionalidad. El host es responsable de su barra
superior, el título, las acciones colocadas, el desbordamiento y el engranaje de ajustes.
`mount(container, signal)` puede devolver la limpieza de forma asíncrona; salir, sustituir o
desactivar cancela su señal. Pasa esa señal **de cada montaje** a los widgets, no solo la
señal de activación, de vida más larga. Desmonta las raíces de React y libera eventos y
temporizadores. Usa CSS con ámbito y variables de tema (`--foreground`, `--background`,
`--border`) e inserción de texto segura; el CSS de la página compartida no está en un
sandbox.

El cuerpo de la vista hace scroll en un viewport del host acotado y a todo lo ancho **por
debajo de la barra superior**, con la barra de scroll pegada al borde derecho del panel
principal. El contenido largo no debe mover el documento, la barra superior ni la lateral.
Los plugins pueden seguir aportando sus propias zonas de scroll acotadas; el contenido que
cabe no crea una segunda barra de scroll del host. Las superficies del cuerpo de página son
overlays hermanos aparte, no hijos del viewport de scroll de fondo.

`ctx.app` expone `pathname()`, `openSession(id)`, `openHome()`, `openView(id)` y
`openSettings()`; los dos últimos se refieren a este plugin. No expone el contexto privado de
React ni los detalles internos de la selección del grafo.

### Acciones

Registra una acción **antes** de colocarla. Una acción tiene `id`, `name`, un `icon` SVG de
confianza opcional, un `shortcut` declarativo opcional, un `disabled` opcional (booleano o
predicado sobre el contexto) y `run(context)` (síncrono o asíncrono). El host aporta el botón
y el tooltip, la prevención de estado ocupado y repeticiones y la notificación de errores.
Usa `ctx.refreshActions()` cuando el estado del plugin cambie un predicado dinámico.

Las colocaciones tienen ID y handles de anulación de registro independientes:
`{ id, actionId, location }`. `sidebar` comparte el área de acciones del núcleo; `graph` usa
la franja de acciones del grafo. `top-bar` requiere `sessions: ["teaching", "practice"]`
explícito (o cualquier subconjunto) y/o `views` (ID de vistas de este plugin). El registro
por sí solo no crea ningún elemento de navegación.

| `placement` / `surface` del contexto | Campos adicionales |
| --- | --- |
| `top-bar` / `session` | `sessionId`, `kind`, `surfaceTarget` opaco, `view` de solo lectura |
| `top-bar` / `plugin-view` | `pluginId`, `viewId` |
| `sidebar` / `sidebar` | Ninguno |
| `graph` / `graph` | Ninguno |
| `keyboard` / `session` | Los mismos campos de sesión, incluido un `view` de solo lectura nuevo |
| `keyboard` / `plugin-view` | `pluginId`, `viewId` |
| `keyboard` / `app` | `pathname` actual (otras páginas de la app) |

`context.view` de la sesión es una instantánea nueva, separada y congelada: los `messages`
nativos completos del navegador, la `transcript` proyectada por el host, metadatos y estado,
reorientaciones en cola, el texto conservado del compositor y la entrada nativa o
personalizada que selecciona el host, incluido el orden de opciones mostrado y los borradores
no enviados publicados. Sigue vinculada a su sesión y aparición originales a través de los
`await`. Las lecturas nunca revelan entrada, vacían el dictado, guardan, procesan ni envían.
Los predicados de desactivación reciben la misma forma de solo lectura; los clics capturan de
nuevo. Respeta los indicadores de revelación y disponibilidad que se proporcionan al elegir
referencias visibles para el alumno: el historial completo es inspeccionable, no se depura
para que coincida con la prosa pintada en ese momento. Consulta el [contrato de contexto de
vista](plugin-view-context.md).

### Atajos de acciones

Haz que una acción existente aparezca en los Ajustes de teclado y en la chuleta de atajos:

```ts
ctx.registerAction({
  id: "open-board", name: "Open board",
  shortcut: {
    scope: { sessions: ["teaching", "practice"], views: ["board"] },
    defaultBinding: "mod+shift+d", // ilustrativo; omítelo para empezar sin asignar
  },
  run(context) {
    if (context.surface === "session") {
      // Tanto las invocaciones por teclado como las de la barra superior reciben context.view.
    }
  },
});
```

`scope: "app"` activa explícitamente una acción en todas las páginas. En otro caso, indica un
ámbito `sessions` y/o `views` no vacío; los ID de vista siempre pertenecen a este plugin. El
registro captura un ámbito y un valor por defecto separados y congelados. Anula el registro y
vuelve a registrar para cambiarlos; `refreshActions()` sigue siendo para el estado activado
dinámico, no para cambios en los metadatos del atajo. Un atajo no requiere colocar un botón, y
las acciones sin `shortcut` no cambian. Las acciones existentes que se suman deben aceptar
`placement: "keyboard"`, no suponer `top-bar`. Las acciones de toda la app siguen recibiendo
el contexto real de sesión o vista de plugin en esas páginas.

Las asignaciones usan el orden canónico existente `mod`, `alt`, `shift`, tecla:
`mod+shift+d`, `alt+x`, `f8`, etc. `mod` acepta Ctrl o Cmd. Solo se admiten acordes simples
con Mod/Alt y las teclas de función F1–F24. No se admiten combinaciones con Escape/Tab/Enter,
teclas sueltas de escritura o navegación, secuencias ni atajos globales del sistema
operativo. Se aplican las guardas existentes de las superficies de escritura; los editores
hoja tienen la primera opción de rechazar. Las repeticiones, los eventos ya gestionados y la
composición no invocan acciones de plugins. La invocación usa el ejecutor de acciones
existente, que gestiona la desactivación, el estado ocupado y los errores.

«De toda la app» significa en todas las páginas, no a través de interfaz que bloquea. Los
diálogos, menús, visores nativos expandidos y la superficie en primer plano de otro plugin
bloquean los atajos. Una acción sigue siendo elegible sobre una superficie del cuerpo de
página de su propio plugin, lo que permite que un conmutador la cierre. El ámbito se sigue
refiriendo a la página activa subyacente. La navegación o la conservación nunca invocan el
lector de una página antigua; las instantáneas de sesión se separan antes de ejecutar la
acción y siguen siendo inmutables a través de los `await`. Una misma pulsación física no
puede atravesar un primer plano que esa misma tecla ha cerrado.

Los Ajustes listan los atajos registrados bajo el nombre de cada plugin, incluidas las
entradas sin asignar o en conflicto. Reasignar asigna un acorde; Borrar guarda como sin
asignar; Restablecer recupera el valor por defecto opcional del plugin. Las sustituciones
comparten `lh:keymap` con la clave `plugin:<pluginId>:<actionId>` y sobreviven a desactivar y
reactivar o a una ausencia temporal. Restablecer todo también elimina estas sustituciones.
Solo los registros activados y activos participan en el despacho y los conflictos.

Las asignaciones efectivas del núcleo siempre tienen prioridad. Los valores por defecto de
plugins en competencia con ámbitos solapados quedan inactivos, sin ganador por orden de
carga. Las asignaciones explícitas de plugins ganan a los valores por defecto de plugins; los
Ajustes rechazan las colisiones con el núcleo y con otras asignaciones explícitas de plugins
sin cambiar las asignaciones guardadas. Los conflictos usan el solapamiento de ámbitos
declarado, no el estado transitorio de desactivación, ocupado o foco. Ámbitos que no se
solapan pueden compartir acorde. Si las asignaciones guardadas entran en conflicto tras
cambios de ámbito o ediciones manuales del almacenamiento, las asignaciones afectadas fallan
en cerrado y los Ajustes explican el conflicto. Las acciones con clic siguen funcionando.

### Interfaz controlada del host

Los 15 métodos de `ctx.ui` reciben como último argumento opciones `{ signal }` y devuelven un
handle con `update(partialProps)` superficial y `dispose()` idempotente. Sustituye por
completo las props anidadas al actualizarlas. Cancelar o desactivar el plugin libera los
montajes y overlays asociados. El plugin es responsable de los valores y la persistencia;
devuelve los valores aceptados mediante `update`.

| Método | Props principales |
| --- | --- |
| `mountModelPicker` | `value: {provider,id} \| undefined`, `onChange`, `disabled` opcional |
| `mountThinkingPicker` | `model`, `value: ThinkingLevel \| undefined`, `onChange`, `disabled` opcional |
| `mountKnowledgePicker` | `value: readonly string[]`, `onChange`, `disabled` opcional |
| `mountComposer` | `value`, `onChange`, `onSend`; opcionales `busy`, `onStop`, `canSend`, `placeholder`, `autoFocus` |
| `mountDictation` | `onTranscript`, `disabled` opcional; métodos extra del handle `toggle`, `finish`, `cancel` |
| `mountStandardComposer` | `{composer,model,thinking,dictation}` con props de control independientes |
| `mountButton` | `label`, `onClick`; opcionales `icon`, `iconOnly`, `disabled`, `variant`, `colors`, `size`, `title` |
| `mountBadge` | `text`, `color` opcional |
| `mountSettingsRows` | `{rows}`, como se describe más abajo |
| `mountWorkerResult` | `label`, `status` terminal, `text`; opcionales `content`, `presentation` |
| `mountMarkdown` | `text` (Markdown estático completo) |
| `mountTree` | `label` accesible, `rows` controladas; opcionales `header` y `columns` finales |
| `openMenu` | `items: [{key,label,onSelect,disabled?}]`; opcionales `label`, `preferredSide`, `onClose` |
| `openDialog` | `title` accesible, `content`, `onClose` opcional |
| `openSurface` | `title` accesible, `content`; opcionales `background`, `onClose`; destino de vista nativa explícito opcional |

Los métodos de montaje reciben un contenedor antes de las props; `openMenu` recibe un ancla.
Consulta los tipos para las firmas completas. Las callbacks pueden ser asíncronas; los
errores se muestran en lugar de contar como éxito.

Llamar de nuevo a `openMenu` desde el mismo propietario de interfaz con exactamente el mismo
elemento ancla cierra el menú existente en lugar de apilar otro, incluso antes de que se
renderice. El último `onClose` del menú existente se ejecuta una vez; la llamada que cierra
devuelve un handle inerte y no usa sus props ni su callback. Otros propietarios de interfaz y
otras anclas siguen siendo independientes. Los clics fuera (incluidos otros botones), las
acciones del menú y Escape mantienen sus reglas de descarte existentes; solo Escape devuelve
el foco al ancla. La liberación explícita del handle y la caducidad de quien llama, del plugin
o de la superficie siguen siendo liberación, sin `onClose`.

**Controles de escritura.** Los selectores de modelo y de razonamiento usan el catálogo del
host sin cambiar los valores por defecto del núcleo ni elegir modelos de recurso. Su
tipografía compacta es autocontenida. El compositor independiente es una entrada desnuda; el
preajuste estándar solo enmarca la entrada de texto, con los controles debajo. Excluye los
medidores de uso, los controles de práctica, los adjuntos y el comportamiento por defecto de
ficheros y arrastre. El preajuste termina el dictado antes de enviar; los controles
independientes deben coordinarlo ellos mismos.

El dictado tiene un único propietario de grabación por ventana. Un inicio en competencia
informa de `Dictation is active elsewhere`. El habla solo va al `onTranscript` proporcionado,
no a un compositor nativo oculto. Los controles con el foco son propietarios de los atajos
correspondientes; un mismo Escape no debe cancelar también la grabación de otra capa.
`finish()` espera a la entrega; `cancel()` cancela.

**Botones.** `icon` es marcado SVG de confianza, no un hueco para sanitizar, DOM o un
renderizador personalizado. Precede a la etiqueta obligatoria. `iconOnly: true` oculta el
texto y usa `label` como nombre accesible; tanto el icono como la etiqueta deben no estar en
blanco. `size` solo controla la geometría; `title` no aparece automáticamente. Las
actualizaciones en vivo no válidas se rechazan de forma atómica; quitar un icono también
exige desactivar `iconOnly`.

`variant: "custom"` permite colores sin sustituir la geometría ni la activación. Los huecos
opcionales de `colors` son los normales `background`, `text`, `border`; objetos `hover`,
`active` y `disabled` con esos mismos huecos; y `focusVisible` con esos huecos más `ring`.
Las sustituciones se aplican en cascada por propiedad: disabled > active > focus-visible >
hover > normal. Los valores de recurso normales son los colores primarios nativos con un
borde transparente reservado de 1px. Se mantienen la geometría nativa del anillo de foco, el
bloqueo del puntero y la opacidad del 50 % al desactivar.

Los colores deben ser colores CSS no vacíos admitidos por el navegador (se permiten
variables y expresiones). Los huecos, formas o sintaxis desconocidos se rechazan de forma
atómica; la resolución de variables y el contraste son responsabilidad del plugin. Los
colores se validan con cualquier variante, pero solo se aplican con `custom`. Pon
`colors: undefined` para recuperar los valores de recurso; actualizar `colors` sustituye la
paleta completa. No hay sustituciones arbitrarias de CSS, geometría ni teclado.

**Insignias.** `text` es texto plano, no un enum de calificación ni Markdown. `color`
opcional fija el texto y un fondo `color-mix(in oklab, color 15%, transparent)`; si se omite,
es neutra. Los tipos o la sintaxis de color no válidos (incluidas las palabras clave
globales de CSS) se rechazan de forma atómica. No implica puntuación, persistencia,
comportamiento al hacer clic ni anuncio en vivo.

**Markdown.** `mountMarkdown` usa la canalización real compartida del host para matemáticas,
código resaltado, tablas, avisos destacados, Mermaid, imágenes y tipografía, solo con los
elementos integrados: los renderizadores de bloques cercados registrados por plugins no se
ejecutan. Omite los controles auxiliares de copiar, descargar, reintentar, expandir, zoom y
desplegar. Los enlaces conservan el comportamiento nativo de nueva pestaña con
`noopener noreferrer`; un Mermaid no válido muestra directamente su error y su código. No
fabriques un resultado de worker solo para obtener el estilo de Markdown ni importes un
renderizador privado.

**Árboles.** `mountTree` es presentación controlada, no un controlador de ficheros o mazos.
Sé responsable de la jerarquía, la selección, las acciones, el almacenamiento y el
contenedor de scroll. Usa claves de aparición de fila únicas globalmente, identidades de
montaje de contenido estables y un ancho suficiente; las columnas más la sangría y los
controles pueden desbordarse y descuadrarse si no se acotan bien. Plegar desmonta el
contenido descendiente, así que guarda los borradores en el estado del plugin. Consulta el
[contrato de árboles](plugin-tree-contract.md) para los huecos de filas y celdas, el
comportamiento de las flechas y Espacio y un ejemplo.

**Selección de conocimiento.** `mountKnowledgePicker` reutiliza la burbuja nativa de Elegir
nodos/recuento/Borrar y el selector de Chains. La selección cambia de inmediato; refleja
`onChange(ids)` con `update({value: ids})`. Hecho/X/Escape cierran sin descartar la selección
controlada. El host captura el origen: los orígenes de página o superficie abren una vista en
el panel principal, mientras que los de diálogo o Ajustes abren un modal a pantalla completa
con el padre pintado pero inerte. El ciclo de vida del origen y del widget, la restauración
del foco y la protección frente a cargas obsoletas son del host, no props del plugin. Solo
hay un selector activo. Siguen disponibles las operaciones existentes que hace el usuario
para renombrar fuentes, crear carpetas y arrastrar; el Borrar de gestión, no. Esto no es una
API de escritura en el grafo desde el backend.

**Diálogos y superficies.** `content` es un HTMLElement o un montaje con ámbito de señal con
limpieza síncrona o asíncrona. Ambos exigen títulos accesibles, pero no renderizan una fila
de título del host; los plugins son responsables de los encabezados y acciones visibles. Una
X discreta flota sobre el contenido con scroll. Las superficies solo cubren el cuerpo de la
página, no las barras superiores ni la lateral, y se apilan manteniendo montado el contenido
cubierto. Usa `openSurface(props, {signal})` sin destino para capturar el límite actual una
vez, o pasa el `surfaceTarget` nativo exacto. Salir de la página lo hace caducar; nunca
reconstruyas ni persistas destinos. `background` es `dimmed` (tinte y desenfoque por
defecto) u `opaque`.

Una superficie puede marcar una región enfocable visible, montada de forma síncrona, con
`data-plugin-initial-focus`. Tiene prioridad el foco elegible existente, después la marca y
después los campos, encabezados o el marco. No se promete reintento asíncrono del
autoenfoque ni enfoque al actualizar. La propiedad compartida de modales, menús, Escape y
foco sigue el [contrato de interacción](dialog-overlay-contract.md); Tab y Mayús+Tab no se
convierten en navegación de foco del navegador. Consulta el [contrato de
superficies](plugin-session-extension-contract.md#8-contrato-público-de-superficies) para las
reglas de ciclo de vida, apilado, cierre y devolución del foco.

### Ajustes propios

Cada plugin activado tiene una página de Ajustes, incluidos los que solo tienen backend o no
tienen ajustes. Ajustes → Plugins del núcleo / Plugins de la comunidad gestiona los paquetes;
`ctx.app.openSettings()` y el engranaje de la vista abren la página de este plugin. Sin
registro, muestra `No settings available`.

`registerSettings({rows})` devuelve un handle de widget con update/dispose. Como
alternativa, `registerSettings({mount(container, signal) {...}})` devuelve una función para
anular el registro; el montaje personalizado se ejecuta de forma perezosa y puede usar
`mountSettingsRows` por su cuenta.

Las filas tienen `key` única no vacía, `label`, `value` controlado y `onChange`; opcionales
`description`, `disabled` y `validate(value): string | undefined` síncrono. Tipos: `toggle`
(booleano), `text` (cadena), `dropdown` (cadena con opciones `{value,label}`),
`number`/`slider` (número finito con `min`, `max`, `step` opcionales). Los esquemas no
válidos se rechazan; los fallos de validación o rango se muestran en línea sin llamar a la
persistencia. Una Promise realmente pendiente desactiva su fila; los cambios síncronos del
slider no interrumpen el arrastre. Los guardados que lanzan o se rechazan muestran errores.
Valida también las entradas en el backend.

El host no carga ni guarda los ajustes de los plugins. Publica las filas aceptadas a través
del handle solo después de persistir con éxito; mutar un esquema no crea un almacén
reactivo.

## Documentos subidos

`ctx.documents.toMarkdown(file, {signal}?)` del frontend recibe un `File` del navegador y
resuelve `{name, markdown, notices}`. La cancelación de la activación es automática; una
señal opcional de quien llama añade un ciclo de vida más corto. Los fallos rechazan con
`Error`; la cancelación de quien llama conserva `AbortSignal.reason`. No hay miembro de
documentos en el backend, ni DTO público de códigos de error, ni entrada por ruta, URL o
token, ni API de selector de ficheros. Usa un input nativo y este helper, no `ctx.call` (que
solo admite JSON) ni una ruta multipart privada.

- Una firma `%PDF-` **o** el sufijo `.pdf` seleccionan el motor PDF nativo determinista y
  los marcadores de página. Los PDF no válidos no recurren a texto. Las páginas que solo
  tienen imagen en documentos mixtos se omiten con avisos; los PDF formados solo por
  imágenes se rechazan de forma distinta a los PDF en blanco. No hay OCR.
- Todo lo demás es UTF-8 estricto, sea cual sea la extensión o el MIME. Se rechazan la
  entrada binaria, la vacía y los caracteres de control distintos de Tab/LF/CR (el resto de
  C0, DEL y C1). HTML y DOCX no se convierten en Markdown semántico.
- Límites: **25 MiB por fichero**, **26 MiB de cuerpo multipart real**, **1.000 páginas de
  PDF** comprobadas tras abrirlo, **2 MiB de Markdown UTF-8 final**, incluidos los
  marcadores. Se rechaza, nunca se trunca.
- **Una única conversión global** entre todos los plugins; las peticiones en competencia
  fallan de inmediato como ocupadas, sin cola. La admisión precede al buffering y dura hasta
  que terminan el trabajo y la destrucción, incluso tras una cancelación.

La cancelación es cooperativa, no una garantía de plazo, CPU, memoria máxima o aislamiento
de procesos. El análisis de PDF con el worker simulado puede ejecutarse de forma síncrona. La
conversión no persiste nada, no hace peticiones al modelo ni cambia datos de aprendizaje; el
plugin puede guardar después el texto devuelto por su cuenta.

## Backend y datos

Los backends CommonJS exportan `activate(ctx)`. La activación ocurre una vez por servidor;
devuelve la limpieza o regístrala con `ctx.cleanup`. Los recursos del host respetan
`ctx.signal`; las tareas personalizadas deben cooperar y volver a comprobar la cancelación
tras cada `await` antes de producir efectos secundarios. No hay proceso por plugin ni
terminación forzosa de código que no coopere.

Registra operaciones compatibles con JSON con `ctx.handle(name, handler)` y llámalas desde
el frontend con `await ctx.call(name, input)`. Esto solo enruta hacia ese plugin, no hacia
endpoints HTTP arbitrarios. Valida las entradas, expón los errores reales y usa escrituras
atómicas para el estado importante del plugin en `ctx.dataDirectory`.

`ctx.learning` es de solo lectura:

| Miembro | Significado |
| --- | --- |
| `directory` | Ruta de los datos de aprendizaje, no una ruta de credenciales |
| `listSessions()`, `getSession(id)` | Resúmenes y registros nativos completos |
| `graph()` | Proyección actual del grafo |
| `readGraphFile(name)` | Libros, fuentes, posiciones y metadatos de formato y render interpretados por el host; las fuentes son un array de registros |

Lee las transcripciones para conocer las respuestas, el razonamiento y los errores del
alumno: el grafo se extrae de la prosa del profesor, no es un registro completo de las
respuestas del alumno. Las lecturas que abarcan varios ficheros no son transaccionales.
Escribe los datos derivados de tu funcionalidad en el estado del plugin, nunca en los
ficheros de aprendizaje del núcleo.

## Agentes existentes y renderizadores de contenido

`registerInstructions({agents, text})` y `registerTools({agents, create(context)})` son
contribuciones aditivas dirigidas a `prober`, `teacher` y/o `practice`. No sustituyen los
prompts del host, los ajustes de modelo ni las herramientas integradas. Cada turno
coincidente recibe una dotación nativa de Pi nueva con `{chatId, agent}` congelado; el host
guarda las llamadas y los resultados. El texto de las instrucciones se compone en el prompt
de sistema, no como mensajes separados de la transcripción.

Usa nombres de herramienta nativos distintivos: de 1 a 64 letras, dígitos, guiones bajos o
guiones aceptados por los proveedores, empezando por letra o guion bajo. Los nombres del
núcleo siguen reservados aunque estén desactivados. La admisión ordenada por ID de plugin
nunca sobrescribe colisiones; un error en una definición o factoría omite toda la
contribución del paquete en ese turno, notifica un aviso del paquete y deja disponibles las
vistas y el backend independientes. Un éxito posterior borra el aviso. Que el esquema nativo
compile no garantiza que todos los proveedores lo acepten.

Anular el registro afecta a turnos futuros; desactivar cancela las ejecuciones cooperativas y
acota las herramientas y resultados capturados sin reescribir un prompt en curso. Respeta las
señales antes de producir efectos secundarios; los efectos externos no se pueden deshacer.

`registerCodeBlock({language, mount})` del frontend recibe el código fuente, los metadatos y
el estado incompleto; `registerToolRenderer({toolName, mount})` recibe la entrada, el estado
y los detalles nativos como `output`, el contenido opcional del resultado y `background` en
una tarjeta de worker posterior. Monta en el HTMLElement proporcionado y devuelve la
limpieza; sustituir, anular el registro o desactivar cancela su señal. Se admite la limpieza
asíncrona. Los errores o la falta de renderizador recurren a mostrar el código o los
resultados de forma legible.

Los hooks de bloques cercados participan en el Markdown extensible compartido, pero no en
`mountMarkdown`. Las reclamaciones integradas de Mermaid y de herramientas dedicadas u
ocultas siguen reservadas; las colisiones notifican errores. La identidad del productor es
un metadato, no un sandbox que impida que un plugin presente herramientas de otro. Usa texto
seguro y recursos de confianza, nunca HTML del modelo sin sanitizar. Un renderizador no crea
entrada pendiente del alumno: para eso usa las API específicas de preguntas y problemas.

## Preguntas de enseñanza, problemas de práctica y envíos del alumno

Estos puntos de extensión comparten los ciclos de vida nativos del host; no son API
genéricas de formularios.

- **Enseñanza:** registra esquemas y herramientas de planteamiento de sondeo y enseñanza con
  `registerQuestionType`; registra `mountQuestion`, `mountAnswerEditor` y, opcionalmente,
  `mountAnswered` con ámbito de propietario mediante `registerQuestionRenderer`. El host es
  responsable de la identidad, la revelación, el razonamiento, la validación, la aceptación y
  la continuación del profesor. `gradeAnswer` opcional se ejecuta tras la validación y antes
  de guardar; los resultados y errores en JSON finito se persisten y los renderiza el plugin,
  no se interpretan como corrección del host. [Contrato de preguntas](plugin-question-contract.md).
- **Práctica:** registra `registerProblemType` y `registerProblemRenderer` para el dock
  nativo enunciado → editor del plugin → *Your thinking*. Cada envío sigue validar →
  `processSubmission` opcional → guardar → continuar. El procesamiento aporta observaciones;
  solo el `conclude` existente del modelo evalúa y cierra el problema. Los planteamientos
  nativos y de plugins comparten una única barrera de problema activo. [Contrato de problemas](plugin-problem-contract.md).
- **Preparación de la entrada:** `registerSubmissionInterceptor` captura el conjunto
  ordenado de hooks en cada intento, puede transformar campos del alumno y adjuntar imágenes
  nativas, y falla en cerrado conservando los borradores. `hasPendingInput` es síncrono y
  sin efectos secundarios; `refreshSubmissions()` actualiza la disponibilidad. Borra el
  material del plugin capturado solo mediante un `onAccepted` con acuse, no por reintentos
  del modelo, descartes ni acuses perdidos. Los valores de un editor personalizado que esté
  listo siguen siendo obligatorios. [Contrato de extensiones de sesión](plugin-session-extension-contract.md).

No deduzcas autoridad de los nombres de herramienta en bruto del modelo ni del DOM privado,
no reconstruyas opciones barajadas a partir del historial guardado, no fabriques sobres de
respuesta nativos ni vuelvas a ejecutar el procesamiento en la presentación histórica.
Importan la aparición exacta, el contrato guardado y las barreras de disponibilidad.

## Inferencia y trabajo persistente

### Llamadas directas al modelo

`ctx.inference.catalog()` devuelve el último catálogo conocido del host; elige
explícitamente un modelo disponible (o usa explícitamente una ranura configurada). No se
ofrece refresco silencioso, recurso cuando no hay modelo definido ni recurso a otra clave de
API. `stream(request)` devuelve eventos nativos; `complete(request)` devuelve un mensaje
nativo del asistente, incluidos los estados de error y cancelación. Comprueba `stopReason`,
no solo el texto.

Las peticiones reciben `model` (incluido el nivel de razonamiento), `context` nativo,
`purpose: "user" | "background"` explícito, `options` opcionales de generación, razonamiento
y reintento de una lista permitida, y una señal. El host es responsable de las credenciales y
el transporte y aplica las reglas existentes de consentimiento de suscripción, cuota y
cancelación. `purpose` debe reflejar quién inició la acción, no si hay una vista abierta; no
clasifiques trabajo automático como entrada del usuario para eludir el consentimiento. Fetch,
entorno, cabeceras o trabajo remoto diferido personalizados no son opciones de la API. El uso
se añade al `data/usage.jsonl` del plugin, no a los registros de chat del núcleo.

### Agentes conversacionales gestionados

`ctx.agents.register(definition)` define instrucciones, modelo y herramientas nativas;
`create(definitionId)` crea una conversación; `send(sessionId, text, {requestId,purpose})`
añade entrada. Persiste y reconstruye definiciones compatibles entre activaciones: los
manejadores guardados no son JavaScript, y que falte una definición es un error, no permiso
para reinterpretar el historial.

Una herramienta `kind: "input"` no tiene `execute`; persiste entrada externa. Renderiza tú
mismo `snapshot.pending` y llama a `answer(sessionId, toolCallId, answer, options)` a través
de tu backend. Reintenta la misma acción con el mismo ID de petición; ID nuevos significan
acciones nuevas. Todas las entradas obligatorias necesitan resultado antes de continuar. Las
respuestas no válidas no se guardan; `formatResult` puede dar forma al contenido que ve el
modelo. Las herramientas de servidor ordinarias pueden usar `endRun: true` para pausar tras
un éxito; el texto posterior no es un resultado de herramienta que falte.

`get`, `list` y `subscribe` exponen el estado y el parcial actual. Las notificaciones
`agents-changed` y `onResync` del frontend desencadenan relecturas agrupadas; no consultes
periódicamente vistas ocultas. Cancelar la suscripción solo desconecta la observación. La
navegación o la recarga no detienen la ejecución; `abort` cancela de forma cooperativa y
`run` reanuda la entrada ejecutable sin escribir un “Continue”. El reinicio recupera las
entradas en espera e interrumpe el trabajo en curso. No hay repetición automática ni promesa
de efectos exactamente una vez para las herramientas externas. Consulta
`examples/plugins/managed-agent`.

### Workers orientados a resultados y herramientas en segundo plano

`ctx.workers` ejecuta tareas acotadas con un único resultado validado, no conversaciones que
requieran entrada humana. Registra instrucciones, `resultSchema`, `validateResult` opcional
sin efectos secundarios y herramientas nativas.
`start(workerId, {requestId,input,prompt,model,purpose,maxTurns,...})` persiste la
aceptación de forma síncrona y devuelve una instantánea, **no la finalización**. `options`
usa la lista permitida de inferencia; `timeoutMs` es el tiempo de vida real total, incluidas
las esperas de admisión, distinto del `options.timeoutMs` de cada petición. El modelo, el
propósito y `maxTurns` son explícitos; un ID de petición y una petición idénticos devuelven
la tarea original, mientras que una reutilización en conflicto da error. Reintenta con un ID
nuevo para un intento nuevo.

`submit_result({result})` del host valida el esquema y los refinamientos y aporta comentarios
de corrección en el mismo contexto nativo. Gana el primer JSON válido aceptado de forma
duradera, incluidos los valores falsy. Salir sin resultado, agotarse o fallar no es un éxito.
`wait(id)` resuelve un resultado terminal; cancelar su señal solo detiene esa espera. `get`,
`list` y `subscribe` (que entrega primero una instantánea) exponen el estado y el progreso
confirmados; los parciales de streaming son efímeros.

Estados: queued, running, succeeded, failed, cancelled, interrupted. Las vistas y las
cancelaciones de suscripción no cancelan el trabajo; llama a `cancel`. Desactivar o reiniciar
interrumpe **todas las tareas sin terminar**, incluso las encoladas o guardadas en paquetes
desactivados. No se promete repetición automática, DAG ni planificador, ni ejecución con la
app cerrada. Reserva `data/tasks/` para los registros.

Dentro de `registerTools.create(context)`, `ctx.createBackgroundTool(context, spec)` devuelve
una herramienta nativa con ID de worker, `prepare(input, context)` puro y
`format(outcome, context)` que devuelve `{text,data?}`. La identidad derivada por el host
siempre la clasifica como de segundo plano. El resultado nativo inicial sigue siendo un acuse;
el texto posterior para el modelo y los datos renderizados usan la canalización existente de
entrega de tareas y reorientaciones, respetando las preguntas pendientes y los límites de
turno. No produzcas efectos secundarios en prepare/format.

El resultado de la tarea y la entrega son cosas distintas. El resultado genérico se persiste
antes del formateo asíncrono; la entrega en vivo espera al formateo, pero el reinicio puede
entregar el recurso persistido sin volver a ejecutar herramientas ni formateadores. Un fallo
del formateador o código no disponible no cambia la etiqueta del resultado real de la tarea.
Si falta el estado de la tarea, se produce un fallo honesto, no un resultado fabricado.

Las tarjetas posteriores fijan `tool.background`.
`backgroundPresentation: "collapsed" | "card" | "plain"` en un renderizador de herramienta
elige su marco; `mountWorkerResult` ofrece la misma `presentation` para interfaz propia del
plugin. Collapsed es el valor por defecto; card tiene borde y está expandido; plain no tiene
marco y está expandido. La identidad, el estado y los errores del formateador del host quedan
fuera del cuerpo personalizado. La cabecera compacta es icono de estado + etiqueta, con el
estado accesible y en un tooltip. `content` opcional es un HTMLElement o un montaje con
ámbito de señal; el estado terminal es succeeded, failed, cancelled o interrupted. Esto no
rediseña las tarjetas nativas de Investigación ni de PDF.

**Admisión compartida.** Ajustes → Agente → Modelos → Peticiones de workers concurrentes
(`agent.workerRequestConcurrency`, **8** por defecto) controla un único pool FIFO global del
proceso para los streams de peticiones al modelo en segundo plano, no para tareas completas.
Solo enteros seguros positivos; los valores no válidos se rechazan, los aumentos admiten
peticiones en cola y las reducciones dejan terminar las activas. Todos los workers separados
lo comparten con los workers nativos en segundo plano, incluso con `purpose: "user"`. Quedan
excluidos el profesor, el sondeo y la práctica directos y la compactación, los agentes
gestionados interactivos y la inferencia en bruto de plugins. Los permisos terminan antes de
las herramientas nativas o las esperas de hijos; cancelar en cola impide el despacho.
`purpose` controla el consentimiento, no la clasificación en el pool.

Las tareas independientes aparecen en Agentes en segundo plano como **nombre del plugin · ID
de la definición del worker**, sin un enlace de sesión inventado; las tareas enlazadas de
herramientas en segundo plano no duplican filas. END cancela el trabajo en cálculo o en cola,
no un resultado terminado ni una entrega pendiente.

## Eventos, recuperación y pruebas

`ctx.events.on` del backend y `ctx.onAppEvent` del frontend observan los eventos de la app
admitidos. `turn-settled` sigue a la persistencia del turno, no a la finalización de la
extracción asíncrona. `ctx.events.emit(topic, jsonData)` del backend notifica a
`onNotification` del frontend de este plugin. Es entrega en vivo, no un registro duradero de
eventos arbitrarios. Al reconectar, usa `onResync` y obtén el estado. Libera las
suscripciones en la limpieza; evita emisiones recursivas.

Antes de distribuir, comprueba los tipos, la estructura del paquete compilado, el
descubrimiento desactivado, activar y desactivar, el reinicio, la limpieza y los `await`
tardíos, el recurso cuando falta el renderizador y las actualizaciones que conservan los
datos. Prueba los caminos de ciclo de vida nativos que usa tu funcionalidad, no solo su
interfaz aislada. Es preferible usar perfiles desechables y proveedores de loopback; no
sobrescribas una app instalada solo para probar un plugin. Consulta [arquitectura del host y
costuras para pruebas](plugin-architecture.md#pruebas).

## Límites deliberados

Nada de marketplace ni actualizador de la comunidad, sandbox ni proceso por plugin,
sustitución en caliente, escrituras programables en los datos del núcleo, interfaz o
formularios generales ni framework de eventos de teclado en bruto, ni repetición automática de
herramientas arbitrarias interrumpidas. La plataforma aporta mecanismos, no prompts de
funcionalidad, algoritmos, valores por defecto ni política de borrado; las decisiones de
producto corresponden a la persona.
