# UI Showcase

Una **galería ejecutable de la comunidad para desarrolladores**, no un plugin del núcleo. Este
plugin de LearnHarness, solo de frontend, muestra **los 15 métodos públicos de `ctx.ui`**
repartidos en **12 familias** en una única vista con scroll y el tema del host, incluidas
superficies del cuerpo de página y con destino nativo explícito. No tiene backend,
dependencias de runtime, almacenamiento, workers ni generación con modelos.

## Requisitos

- Un host de LearnHarness correspondiente con las API públicas de árbol, Markdown, selector
  de conocimiento y superficies, incluido `openSurface(surface, { signal })` sin destino.
- La versión **1** de la API del manifiesto y la versión mínima de la app declarada son
  necesarias, pero no demuestran que existan capacidades concretas. La activación comprueba
  los 15 métodos de interfaz y los registros necesarios y falla con un error explícito de
  capacidad ausente; no hay recurso copiado ni hecho a mano. Que exista `openSurface` no
  garantiza por sí solo que se admita su sobrecarga sin destino.
- Node/npm y las dependencias son solo requisitos de desarrollo. LearnHarness no ejecuta npm
  al cargar el plugin compilado.

## Desarrollo e instalación como plugin de la comunidad

En el kit de autoría extraído, copia el **contenido de `types/` de la raíz del kit**
compartido en `.sdk/` **antes de preparar las dependencias**. Desde `plugins/ui-showcase/`:

```sh
mkdir -p .sdk
cp -R ../../types/. .sdk/
```

En cambio, en un checkout del código de LearnHarness, `npm run sdk` genera `.sdk/` mediante
`../../scripts/build-plugin-types.mjs`. Ese comando **solo funciona en un checkout**; el kit
extraído no incluye el generador del host. Las importaciones del SDK son solo de tipos.

Prepara aparte las dependencias de desarrollo, incluidas las dependencias peer y los tipos
declarados por el SDK. Con las dependencias ya disponibles, el comando que solo compila es:

```sh
npm run build
```

La build escribe directamente en **`dist/`**, que contiene `manifest.json`, `main.js`,
`styles.css`, este README y la licencia. Comprueba que en el bundle de JavaScript solo entren
ficheros fuente del plugin. No incluye backend, SDK, código fuente, pruebas, dependencias de
desarrollo ni datos. El proyecto de código completo del kit de autoría es algo distinto de
esta salida de runtime.

Para desarrollar in situ, coloca el proyecto en `<plugins-directory>/ui-showcase/` usando la
ruta que muestra **Ajustes → Plugins de la comunidad**, prepara las dependencias y compila
allí. También puedes copiar el contenido del `dist/` compilado en local en
`<plugins-directory>/ui-showcase/dist/`. El host necesita `ui-showcase/dist/manifest.json`, no
un manifiesto solo en la raíz ni un `dist/ui-showcase/` anidado. Refresca la lista y activa
**UI Showcase**; reinicia LearnHarness después de cambiar código ya cargado. No hace falta un
registro aparte para desarrollo. Compilar no instala ni activa la galería. La limpieza solo
sustituye `dist/`, rechaza un `dist/` enlazado simbólicamente o un `dist/data/` mal colocado
y conserva el `data/` hermano. No distribuyas nunca datos persistentes. Usa un perfil de
aprendizaje sintético temporal para desarrollar, no plugins ni registros reales instalados.

## Uso

- Elige **UI Showcase** en la barra lateral. El host aporta el título de la barra superior; el plugin solo aporta el cuerpo de la galería.
- Cada familia tiene un botón **Reset**. Los valores, los borradores aceptados y las lecturas de las callbacks son locales a esa familia montada. Reset vuelve a montar solo los widgets de esa familia y cierra sus overlays. Salir de la vista borra su estado.
- Elige modelos reales del catálogo o nodos de conocimiento. Los controles de modelo y de razonamiento solo están enlazados dentro de su propia familia. Sus disparadores usan la misma tipografía compacta de interfaz que los controles nativos. El modelo, el razonamiento y el borrador del compositor estándar son independientes de los ejemplos sueltos. Cambiar un modelo local borra su elección local de razonamiento.
- El compositor suelto es la fila de entrada desnuda, de forma intencionada. El preajuste estándar añade el marco de texto con borde de estilo nativo, con los controles de dictado, modelo y razonamiento **debajo y fuera** de ese borde. El texto explicativo sigue la fuente y el tamaño de lectura configurados; los encabezados de familia usan el estilo compacto de las secciones de ajustes.
- Enviar entra en una **simulación local** y conserva tu borrador. Mientras está ocupado con un borrador no vacío, el host mantiene disponible Enviar para reorientar. Vacía el borrador para que aparezca **Detener**, o usa **Complete simulation**, que está disponible durante todo el estado ocupado. Esto vale para los dos ejemplos de compositor; no se envía nada a una conversación nativa ni a ningún modelo.
- La familia **Buttons** también incluye insignias neutra, verde, roja y ámbar con `mountBadge`. El texto y un color CSS los controla el plugin; el host aporta la forma y la tipografía nativas y el tinte de fondo del 15 %. Estos ejemplos estáticos no ejecutan calificaciones ni pruebas.
- **Start async example** devuelve una Promise de callback realmente pendiente. **Complete async example** la resuelve. El botón del host no muestra automáticamente un estilo pendiente o desactivado mientras se espera esa Promise; la lectura de pendiente y el control de finalización son locales a esta demo. Reset, la navegación o desactivar el plugin también liberan la Promise pendiente; no se usa ningún temporizador.
- En **Surfaces**, elige **Open surface** para llamar directamente a `ctx.ui.openSurface(surface, { signal })` desde la galería. Así se captura una vez el límite de su página activa; no se exige ni se inventa ningún destino de sesión nativa. La sobrecarga sin destino también admite el chat nativo, Inicio y Nuevo borrador. Salir u ocultar la página propietaria cancela la superficie; volver crea un límite nuevo, no una superficie restaurada.
- En una sesión real de enseñanza o práctica, elige **UI Showcase surface** en su barra superior nativa. Pasa el `context.surfaceTarget` opaco real a `openSurface(target, surface, { signal })`. El botón de la barra superior conmuta la superficie de la galería en esa página: haz clic de nuevo para cerrarla junto con sus ejemplos anidados, en lugar de apilar otra copia. X/Escape también la cierran; el siguiente clic la abre de nuevo. La navegación retira el destino de la página, así que al volver se empieza de cero. **Open nested surface** apila de forma intencionada, conservando el texto del padre y los ejemplos de menús y diálogos. Los títulos de diálogos y superficies son nombres accesibles, no filas de encabezado visibles automáticas. La X discreta flota sobre el contenido con scroll sin ocupar espacio en la disposición; los plugins son responsables de los encabezados y las acciones inferiores. El host es responsable del enrutado de Escape y del comportamiento del foco.
- Las superficies solo cubren el cuerpo de la página; las barras superiores nativas y de plugins y la barra lateral siguen utilizables. Inicio y Nuevo borrador solo conservan su conmutador flotante de la barra lateral y el marco de la ventana; los controles del grafo y el compositor siguen montados pero cubiertos e inactivos. Los diálogos y los Ajustes siempre quedan delante, aunque se pida una superficie con un diálogo abierto. La superficie pertenece a su página, no al modal que la abre, y no puede obtener elegibilidad de foco o Escape a través de él; puede mostrarse tras cerrar el diálogo solo si la señal de quien la llamó sigue viva.
- Cambia entre **Dimmed background** / **Opaque background** en el ejemplo de superficie. Llaman a la opción pública `background: "dimmed" | "opaque"`; Reset restaura el valor por defecto atenuado, translúcido y desenfocado sin volver a montar la superficie. El contenido del ejemplo no pinta una capa opaca sobre el tratamiento elegido.
- **Directory / tree** es una pequeña fixture sintética renderizada con `mountTree`, no una vista de gestión de fuentes. Las dos carpetas empiezan expandidas. El mismo **Shared item** tiene una clave de aparición distinta en cada carpeta; la selección es independiente, incluidas las filas padre, y nunca se propaga en cascada. **Enable selection** muestra las casillas del host; **Disable selection** las oculta sin borrar los valores. Haz clic en una fila para la navegación por flechas y filas del host y usa Espacio para una casilla del host habilitada. La entrada **Directory draft** conserva sus teclas de edición; su valor local sobrevive a plegar y volver a expandir gracias a una factoría de contenido estable. Reset borra la selección y el borrador y expande las dos carpetas sin cambiar los hermanos. Las columnas compactas **Kind**/**State** las renderiza el host; quien llama es responsable del contenedor de scroll horizontal y del ancho mínimo de 36rem, no un motor de disposición adaptable. No se persiste nada.
- La selección de conocimiento también está disponible dentro de un diálogo ordinario y de la superficie padre. Los orígenes de página o superficie usan una vista en el panel principal que deja la barra lateral visible e interactiva; un origen de diálogo o Ajustes usa un modal a pantalla completa. Salir de la página de origen cierra su selector. El selector de un modal vivo pertenece a ese modal, no a una ruta de fondo sin relación.

Consulta el [contrato de superficies](../../docs/plugin-session-extension-contract.md#8-contrato-público-de-superficies)
para las reglas de ciclo de vida con y sin destino explícito; son sobrecargas de un mismo
método, no familias de interfaz distintas.

## Límites de seguridad

**La selección local no es un sandbox para el selector del host.** El ejemplo de conocimiento muestra este aviso:

> Selection stays local to this demo. The host picker also offers source-management actions; those affect your real sources.

El selector es el selector real del host, con sus controles normales intactos. Este plugin
no llama a ninguna API de datos de aprendizaje ni escribe en el grafo, los valores por
defecto del núcleo ni los ajustes. Elegir valores de modelo, razonamiento o nodo solo cambia
valores controlados locales del plugin. Sin embargo, las acciones explícitas de gestión de
fuentes dentro del selector del host conservan sus efectos reales en el host. Usa datos
sintéticos al probarlas.

**El dictado es real y opcional.** Elegir **Dictate** o un micrófono del host inicia
explícitamente el servicio de dictado normal, con tu proveedor de voz configurado. Puede
enviar audio a ese proveedor y tener coste. Montar o restablecer la galería nunca inicia una
grabación. No se fabrica ningún estado de grabación. Las callbacks de transcripción solo
actualizan el estado y los borradores locales de la demo. El compositor estándar termina el
dictado y espera a la entrega final antes de su callback de Enviar; el ejemplo suelto expone
**Finish dictation** por separado. La cancelación y la liberación tienen ámbito en el handle
del host de ese control; no se toca ningún servicio global de dictado, manejador de teclado
ni la grabación de otro propietario.

No hay peticiones al modelo, cambios en la configuración de proveedores, operaciones de
backend, persistencia, inicio de workers, imágenes remotas ni llamadas de red creadas por el
plugin. Los controles reales de catálogo y conocimiento pueden cargar datos del host de forma
normal, y el dictado iniciado explícitamente usa el servicio configurado del host. El
Markdown es estático, incluido un diagrama Mermaid local; no contiene recursos remotos.

Todos los widgets usan señales de cancelación por montaje. Reset o la cancelación liberan
los widgets, overlays y ámbitos asíncronos pendientes propios. Los destinos nativos no se
serializan, no se deducen de ID de sesión ni se conservan para navegaciones posteriores. Los
ciclos de vida de las superficies anidadas están vinculados a su padre de la demo; las
superficies independientes del host o globales no se liberan. No se instalan manejadores de
teclado globales ni se sustituye el foco.

## Mapa de la galería

| Familia de la galería | API pública y ejemplos |
| --- | --- |
| Pickers | `mountModelPicker`, `mountThinkingPicker`, `mountKnowledgePicker`; catálogos y datos reales del host, selección controlada local |
| Composer | `mountComposer`; callbacks del borrador, Enviar/Detener/ocupado/finalización locales |
| Dictation | `mountDictation`; conmutar, terminar y cancelar explícitos, lectura de la transcripción |
| Standard composer | `mountStandardComposer`; estado independiente, modelo y razonamiento locales enlazados, dictado opcional real |
| Buttons | `mountButton`; las 6 variantes no personalizadas, los 8 tamaños, títulos con icono, desactivado y callback asíncrona que se completa a mano; `mountBadge` neutra y con tres colores personalizados |
| Settings rows | `mountSettingsRows`; toggle, text, dropdown, number, slider, descripciones, validación y ejemplo desactivado |
| Markdown | `mountMarkdown`; prosa y lista, código TypeScript, tabla, matemáticas en línea y en bloque, Mermaid |
| Directory / tree | `mountTree`; selección local a cada aparición, navegación del host, ciclo de vida de un borrador enriquecido, metadatos y scroll horizontal propio de quien llama |
| Worker results | `mountWorkerResult`; succeeded/failed/cancelled/interrupted × collapsed/card/plain, ejemplos estáticos sin ningún worker |
| Menus | `openMenu`; elementos activados y desactivados, selección local, lado preferido arriba/abajo |
| Dialogs | `openDialog`; ordinario, con scroll largo y anidado, nombres accesibles, X flotante, texto local conservado y selección de conocimiento con origen en un modal |
| Surfaces | `openSurface`; directa desde la galería y con destino explícito de la barra superior nativa, padre conservado al anidar, opciones de fondo, selección de conocimiento con origen en el panel y superposición de menús y diálogos |

## Pruebas y límites

Tras preparar el SDK y las dependencias, estas comprobaciones solo usan el proyecto del
plugin:

```sh
npm run typecheck
npm test
npm run build
```

Las pruebas unitarias usan una fixture DOM y un registrador de interfaz controlado para
probar la activación, el Reset local a cada familia, las callbacks, los borradores, el estado
del árbol, la propiedad de las superficies y la limpieza. No demuestran la disposición, el
teclado, Escape ni el comportamiento del foco nativos.

`npm run test:native` requiere además los ficheros de la galería compilados, un host
standalone correspondiente ya compilado en `LH_STANDALONE`, su `LH_APPROVED_HOST_DIGEST`
exacto, `LH_POLISH_BUILD_READY=1`, Chrome local y un runtime de Electron Node (el del checkout
por defecto o `LH_NODE_RUNTIME`). Lee [`tests/isolated.mjs`](tests/isolated.mjs) y
[`tests/native.mjs`](tests/native.mjs) antes de ejecutar este arnés para mantenedores. El
proyecto exportado por sí solo no aporta ese host ni ese runtime. El arnés copia ficheros del
host y del paquete en almacenamiento desechable y usa registros sintéticos y fixtures de
loopback, no perfiles reales de alumnos. No inicies grabaciones de voz reales, llamadas a
proveedores de pago ni generación con modelos. Esto no es aceptación con ventana física de
Electron, micrófono o IME reales, instalador ni multiplataforma.

## Ruta de lectura del código

- [`src/main.ts`](src/main.ts): comprobaciones de capacidades y registros en la barra lateral y en la barra superior nativa.
- [`src/gallery.ts`](src/gallery.ts): `mountGallery` y `FAMILY_IDS`; empieza aquí para los 15 métodos de interfaz.
- [`src/surfaces.ts`](src/surfaces.ts): superficies del cuerpo de página y con destino nativo, menús y diálogos y propiedad anidada.
- [`src/tree.ts`](src/tree.ts): directorio sintético controlado, selección independiente y borradores enriquecidos.
- [`src/dom.ts`](src/dom.ts): disposición y lecturas propias del plugin y limpieza con ámbito.
- [`src/styles.css`](src/styles.css): clases de disposición y texto del plugin, no un cambio de estilo de los widgets del host.
- [`scripts/build.mjs`](scripts/build.mjs) y [`tests/`](tests/): empaquetado solo del código fuente y fixtures.

Selectores estables para pruebas: `[data-showcase="gallery"]`, `[data-family="<family>"]`,
`[data-example="<semantic-id>"]`, `[data-state="<family>"]`. Los botones Reset están en
`[data-example="reset-<family>"]`. El directorio usa `[data-example="tree"]`,
`[data-example="toggle-tree-selection"]`, `[data-state="tree"]` e
`input[aria-label="Directory draft"]`; su lectura expone `selectionEnabled`,
`selectedOccurrenceKeys`, `expanded`, `draft` y `lastCallback`. Los valores de superficie son
`data-showcase="surface"` / `"surface-nested"`; los diálogos usan `"dialog-ordinary"`,
`"dialog-long"` y `"dialog-nested"`.

Consulta el [mapa de ejemplos](../../docs/plugin-examples.md), la
[guía de autoría](../../docs/plugin-authoring.md) y la
[referencia de la API](../../docs/plugin-api/README.md).

## Límites

`mountButton` no ofrece una respuesta visual automática de pendiente o desactivado para una
callback asíncrona. Esta galería muestra esa limitación en lugar de implementar un botón
sustituto o aparentar un estilo nativo de ocupado.

Esta es una galería de la API pública, no un rediseño de componentes, una capa de
persistencia, un banco de pruebas de modelos ni un ejecutor de workers. No altera la política
nativa de Escape, Tab y foco, las capacidades de gestión de fuentes del selector del host ni
el aspecto de los widgets del host. Los catálogos ausentes, el conocimiento vacío, los
errores de micrófono o proveedor y el comportamiento de la API del host los muestran los
controles reales, no se sustituyen por fixtures falsas. Notifica los defectos del host por
separado en lugar de parchearlos u ocultarlos en el plugin.

## Licencia

AGPL-3.0-only; consulta [`LICENSE`](LICENSE).
