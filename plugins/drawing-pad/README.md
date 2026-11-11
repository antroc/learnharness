# Drawing Pad

Un plugin del núcleo de LearnHarness, local y de confianza, para dibujar sobre referencias de
solo lectura de las preguntas. Requiere las API públicas de [contexto de vista de la
sesión](../../docs/plugin-view-context.md), [atajos de acciones con
ámbito](../../docs/plugin-authoring.md#atajos-de-acciones), superficies e intercepción de los
envíos del alumno. Un número de versión por sí solo no establece las capacidades; usa
documentación y tipos del host que correspondan a la app de destino.

## Plugin del núcleo y referencia de código

Activa Drawing Pad en **Ajustes → Plugins del núcleo**. La app aporta y actualiza su código;
las preferencias escribibles viven en `<learning data>/core-plugin-data/drawing-pad/`. Este
proyecto de código es material de referencia, no una copia instalable de la comunidad.
`drawing-pad` es un ID reservado del núcleo aunque esté desactivado o falte. Un fork de la
comunidad necesita su propio ID de manifiesto y carpeta y revisar los nombres de
contribuciones, herramientas y bloques cercados en conflicto. No instales esta build en una
carpeta `plugins/drawing-pad/` de la comunidad.

## Comportamiento

- **Draw** en las barras superiores de enseñanza y práctica abre y cierra la pizarra.
  **Draw (unsent)** indica que la tinta visible es elegible para el siguiente envío de
  contenido del alumno en esa sesión. X/Escape cierra sin enviar ni descartar. Se aplica el
  desbordamiento normal de la barra superior.
- Una pregunta integrada revelada y disponible muestra la pregunta, el contexto y las
  opciones en el orden real del host. Un problema de práctica nativo muestra su enunciado.
  `mountMarkdown`, público, conserva el renderizado de Markdown y matemáticas del host. Las
  preguntas no reveladas, las herramientas de preguntas o problemas personalizados, la
  entrada no disponible y la entrada ordinaria empiezan en blanco. No se capturan claves de
  respuesta, borradores, selecciones ni confianza del alumno, cargas útiles personalizadas ni
  la transcripción.
- La ventana es un viewport sobre coordenadas de dibujo sin límites, no una hoja ajustada.
  La referencia usa el ancho normal del contenido de las preguntas del compositor nativo:
  `calc(42rem - 2px)` (670 píxeles CSS con una raíz de 16px), derivado de la columna actual
  del dock de 46rem menos el relleno exterior, los bordes del marco y el relleno de la
  pregunta. No usa el ancho de la ventana, ni siquiera si se abre por primera vez en una
  ventana estrecha. La altura incluye el contenido completo. El centro de la referencia
  define el origen del mundo; la cámara lo coloca abajo en el centro con un margen de 24px.
  Al redimensionar se mantiene ese anclaje inferior central y el desplazamiento guardado con
  Hand, sin escalar ni recolocar el texto de la referencia ni la tinta. Pen y Eraser
  funcionan en toda la superficie, también más allá de la referencia. Las hojas en blanco
  conservan su origen centrado.
- **Hand** arrastra la vista a escala fija, moviendo juntas la referencia y la tinta. La
  posición de la cámara se conserva con cada hoja de sesión guardada al cerrar, navegar o
  remontar. La tinta fuera de la pantalla sigue siendo elegible para exportar; mover la
  cámara no es una edición del contenido ni una entrada de Undo. Mantener pulsado el **botón
  derecho del ratón** y arrastrar desplaza temporalmente con cualquier herramienta
  seleccionada; soltar o cancelar termina ese gesto sin cambiar de herramienta, dibujar,
  borrar ni añadir una entrada de Undo. La captura del puntero mantiene el desplazamiento y
  la liberación aunque se salga del lienzo. El comportamiento del borrador del lápiz óptico
  no cambia. No hay zoom ni Redo.
- Pen, Eraser de trazo completo, Undo y Clear reutilizan la mecánica de lápiz y ratón
  sensible a la presión de la contribución de escritura a mano. El tacto se ignora. Pen,
  Eraser, Hand y Undo son controles solo con icono, con nombres accesibles y tooltips; Clear
  sigue siendo texto. Los controles forman un grupo flotante compacto arriba a la izquierda,
  no una fila de barra de herramientas reservada: el lienzo ocupa la superficie, y los huecos
  y rellenos transparentes dejan pasar la entrada del puntero. Los controles en sí siguen
  siendo clicables por encima de la tinta. Mantener pulsado el botón de borrador del lápiz
  óptico selecciona temporalmente Eraser al usar Pen/Eraser; los gestos con Hand desplazan en
  lugar de dibujar.
- Clear elimina la tinta y el historial de Undo, pero mantiene el fondo mostrado. Cerrar y
  reabrir una hoja sin tocar o borrada explícitamente captura una referencia nueva. Una hoja
  borrada con historial de Undo conserva su fondo original hasta que se limpie o restablezca.
- El trabajo existente conserva el contenido y la geometría de su referencia original al
  reabrirse o redimensionarse. Los cambios en vivo del tema o la paleta de la app vuelven a
  rasterizar esa misma referencia guardada visible para el alumno, nunca la sustituyen por
  contenido posterior de la pregunta o la entrada, y recolorean la tinta según el modo activo
  de la app. Se conservan los trazos originales, las dimensiones y la posición de
  desplazamiento con Hand. La paleta la controla el tema seleccionado en la app
  (`html.light`/`html.dark`), no la preferencia de color del sistema operativo. Las imágenes
  ya enviadas no cambian. La exportación recorta de forma ajustada la unión de la referencia
  completa y toda la tinta visible (no borrada), incluido el trabajo fuera de la pantalla,
  con 24 píxeles CSS de relleno. Una referencia en blanco no aporta ningún rectángulo de
  lienzo artificial. No se incluye la barra de herramientas ni la extensión de la cámara o el
  viewport. Se aplica Image scale y después se reduce más si hace falta para no superar el
  **límite fijo de 2000 × 2000 píxeles**, conservando la proporción hasta el redondeo a
  píxeles enteros. Los lienzos de visualización solo cubren el viewport; los de exportación
  nunca superan el límite. Los trazos originales se conservan con precisión completa. Una
  hoja sin tocar o borrada por completo no envía ninguna imagen.
- Los dibujos se adjuntan al siguiente envío de contenido del alumno: mensaje ordinario,
  razonamiento de práctica, respuesta integrada, respuesta a pregunta personalizada o envío
  de problema personalizado. El texto, el JSON, las selecciones, la confianza y las imágenes
  existentes no cambian. Siguen aplicándose las reglas nativas de disponibilidad y validación
  y de capacidad de imagen del modelo.
- Enseñanza: una aceptación con acuse solo borra la revisión capturada sin cambios. Las
  ediciones más nuevas sobreviven. Los intentos fallidos, rechazados o cancelados y los acuses
  perdidos conservan el trabajo. Un fallo posterior del modelo no restaura un dibujo ya
  consumido.
- Práctica: se conservan la pizarra y el historial de Undo entre envíos, conclusión, descarte
  y cancelación de la generación. Solo se envía una imagen cuando el dibujo visible actual
  difiere de la última imagen con acuse. Deshacer hasta volver a esa imagen no la reenvía.
  Los cambios de color cuentan. Solo un **planteamiento de problema nuevo aceptado**
  restablece la pizarra; si está abierta, la pizarra antigua se cierra. Vuelve a abrir Draw
  para la referencia nueva que selecciona el host. Los planteamientos fallidos o colgantes,
  las conclusiones, los descartes y la prosa del modelo no la restablecen.
- Las continuaciones automáticas, los reintentos, los descartes silenciosos y el Siguiente
  solo de control no ejecutan la intercepción del contenido del alumno. Una entrada ordinaria
  pendiente formada solo por una imagen es contenido, no un Siguiente solo de control. El host
  gestiona y guarda los bytes de imagen aceptados.
- La hoja de cada sesión solo vive en la memoria de esta ventana de la app a través de la
  navegación. Recargar, reiniciar o desactivar pierde el trabajo no enviado. No hay
  persistencia de borradores editables.

## Atajos de teclado

Ajustes → Teclado → Drawing Pad lista las cuatro acciones, también cuando la pizarra está
cerrada. Usan el registro compartido de acciones y atajos del host, así que Reasignar, Borrar
y Restablecer funcionan sin recargar.

| Acción | Por defecto |
| --- | --- |
| Draw (abrir/cerrar) | Cmd/Ctrl+Mayús+D |
| Undo drawing | Cmd/Ctrl+Z |
| Toggle pen/eraser | Cmd/Ctrl+Mayús+E |
| Hand (selecciona, no conmuta) | Cmd/Ctrl+Mayús+H |

Estos atajos tienen ámbito en las páginas de enseñanza y práctica. Undo y el cambio de
herramienta requieren además una pizarra abierta y lista, con el foco en el dibujo y sin
ningún gesto activo. No le quitan Undo a inputs, textareas, áreas contenteditable ni otros
editores enfocados. Cambiar desde Hand selecciona Pen; cambiar de herramienta nunca edita la
tinta. El atajo de Hand selecciona Hand igual que su botón de la barra de herramientas;
pulsarlo otra vez mantiene Hand seleccionado. Cmd/Ctrl+Mayús+E vuelve de Hand a Pen. No se
sustituyen los nativos Cmd+H (Ocultar) ni Cmd+E. El host bloquea los atajos detrás de
diálogos, menús o superficies de otros plugins e ignora las repeticiones de teclas mantenidas
y la entrada IME. No hay un listener de Undo aparte escrito a mano.

## Ajustes

Ajustes → Drawing Pad:

- **Dark mode ink color**: por defecto **blanco** (`#ffffff`).
- **Light mode ink color**: por defecto **negro** (`#000000`).
  Ambos campos exigen exactamente seis dígitos hexadecimales precedidos de `#`; la entrada no
  distingue mayúsculas y se guarda en minúsculas. Cada preferencia es independiente. Los
  guardados correctos recolorean la tinta guardada cuando ese modo de tema de la app está
  activo, incluidas las hojas de práctica conservadas; cambiar de modo en la app selecciona
  el color de tinta guardado correspondiente. Las imágenes enviadas nunca cambian.
- **Image scale**: por defecto **50%**; un porcentaje numérico mayor que 0 y como máximo 100.
  Escala el ráster de exportación sin límite (incluida la densidad de píxeles del
  dispositivo capturada) **antes** de aplicar el límite fijo de 2000 × 2000. Al 50 %, un
  ráster de 1000 × 600 pasa a 500 × 300; uno de 6000 × 4000 queda en unos 2000 × 1333 tras
  el límite. Nunca escala la superficie de dibujo, cambia los trazos originales ni provoca
  reenvíos de práctica sin cambios. Cada intento de envío congela su escala. Las escalas muy
  pequeñas que no producen tinta visible rechazan la exportación y conservan el dibujo en
  lugar de enviar un PNG en blanco.

El backend solo guarda `{revision, darkInkColor, lightInkColor, imageScale}` en su propio
`data/settings.json`. `set-ink-color` acepta exactamente un campo `{darkInkColor}` o
`{lightInkColor}` por llamada; no hay alias antiguo `inkColor`. Los valores no válidos o cuya
escritura falla no se publican como ajustes guardados.

## Límite de la API pública

El contenido de la referencia procede únicamente de `context.view.input` en el momento del
clic. El historial completo, las soluciones, las cargas útiles personalizadas y los
borradores no enviados del alumno no se usan para construir referencias. La operación de solo
lectura `get-session-poses` del backend devuelve **solo identificadores de aparición de
planteamientos aceptados** a partir de los registros públicos de acuses nativos. Las
notificaciones existentes `turn-settled`/`record-changed` y las lecturas de resincronización
detectan planteamientos nuevos, también con la pizarra cerrada. No reconstruye el estado de
la pregunta activa, no interpreta conclusiones ni descartes y no duplica la proyección ni el
barajado de opciones del host. El contexto del envío también concilia la identidad del
planteamiento antes de capturar la imagen; si faltan lecturas del ciclo de vida, falla en
cerrado.

La captura solo observa DOM propio del plugin, el estado ARIA genérico de ocupado, las
fuentes y las imágenes. La incrustación de fuentes lee las reglas de hojas de estilo ya
analizadas por el navegador (incluidas importaciones anidadas y reglas de agrupación
activas), resuelve los recursos de fuentes respecto a su hoja de estilo propietaria y
entrega CSS de fuentes separado a la biblioteca de captura. No descarga como texto las hojas
de estilo importadas ni inserta reglas en las hojas de estilo vivas de la página. Las
respuestas de fuentes HTML o fallidas hacen fallar la preparación del fondo en lugar de
descartar fuentes en silencio; las descargas de fuentes respetan la cancelación de la
superficie. Esto impide que páginas 404 de importaciones relativas inyecten sus estilos de
página de error en la sesión. Los fallos del fondo se muestran en la superficie; los fallos
de exportación o de preparación del host conservan el trabajo. El trabajo asíncrono respeta
la cancelación y no puede reabrir una superficie liberada. El procesamiento y los límites de
imagen gestionados por el host y los rechazos de modelos solo de texto siguen teniendo la
autoridad.

No se incluyen importaciones del host en tiempo de ejecución, extracción del DOM nativo, hook
global de teclado, consultas periódicas, inferencia, escrituras en registros del núcleo,
sustitución de la app ni instalador. Las asignaciones de teclado se declaran en acciones
públicas del plugin; el host es responsable del despacho y de Escape.

## Desarrollo

En el kit de autoría extraído, copia el **contenido de `types/` de la raíz del kit**
compartido en `.sdk/` **antes de preparar las dependencias**. Desde `plugins/drawing-pad/`:

```sh
mkdir -p .sdk
cp -R ../../types/. .sdk/
```

En cambio, en un checkout del código de LearnHarness, `npm run sdk` genera `.sdk/` mediante
`../../scripts/build-plugin-types.mjs`. **Solo funciona en un checkout**; no es un comando
disponible en el kit extraído. El código de runtime no importa el SDK.

Prepara aparte las dependencias de desarrollo, incluidas las dependencias peer y los tipos
declarados por el SDK. Con las dependencias ya disponibles, compila sin un checkout del host:

```sh
npm run build
```

La build escribe directamente en `dist/`, empaqueta las dependencias de runtime e incluye los
avisos de licencia. Rechaza una salida enlazada simbólicamente o un `dist/data/` mal colocado
y conserva el `data/` hermano. No compila el host ni instala, activa o actualiza el plugin
del núcleo.

## Pruebas y límites

Tras preparar el SDK y las dependencias, las comprobaciones solo del plugin son:

```sh
npm run typecheck            # consumidor estricto del SDK, skipLibCheck=false
npm test
```

Las pruebas unitarias cubren los ajustes, la proyección pública de la referencia, la lógica
de trazos, estado y geometría, el seguimiento de planteamientos aceptados, la transformación
de envíos, el análisis de fuentes, los ciclos de vida del frontend y las guardas de la salida
de la build. Las capacidades del host están simuladas; no son pruebas del host nativo ni del
hardware.

La fixture de navegador **solo funciona en un checkout**: importa módulos y recursos privados
del host que no vienen en el kit de autoría y requiere las dependencias del checkout y Chrome
local (`CHROME_PATH` o el valor por defecto del arnés). En ese entorno:

```sh
npm run test:browser
npm run build
npm run test:browser -- --built
# Fixture opcional para inspección manual; Ctrl+C la detiene:
npm run test:browser -- --built --serve
```

La fixture usa los componentes reales del host de Markdown, matemáticas y Mermaid y de
acciones, atajos y teclado. Los marcos de superficie, los campos de preferencias, la
aceptación de envíos y el transporte de eventos siguen siendo adaptadores, no una app
instalada. Inspecciona los píxeles del lienzo y los PNG compuestos, los límites de
exportación, la geometría independiente de la cámara, la supresión de imágenes de práctica,
la limpieza al remontar o cancelar, las fuentes, los atajos y los gestos de arrastre con el
botón derecho y con lápiz. `--built` carga `dist/main.js`; las pruebas en modo código fuente
no regeneran el bundle.

Usa datos desechables y fixtures de loopback, no perfiles de aprendizaje reales ni
proveedores de pago. Estas comprobaciones no establecen el comportamiento con tabletas
reales, la app instalada, micrófono, modelos reales ni multiplataforma. Este proyecto no
tiene script `test:native`.

## Ruta de lectura del código

- [`src/main.ts`](src/main.ts): acciones y atajos contextuales, propiedad de las
  superficies, ajustes e intercepción de envíos.
- [`src/reference.ts`](src/reference.ts) y [`src/poses.ts`](src/poses.ts): proyección de la
  entrada seleccionada por el host y seguimiento de las apariciones de planteamientos
  aceptados.
- [`src/state.ts`](src/state.ts) y [`src/submission.ts`](src/submission.ts): hojas de sesión,
  revisiones capturadas, acuses y adjunto de imágenes.
- [`src/sheet.ts`](src/sheet.ts), [`src/strokes.ts`](src/strokes.ts) y
  [`src/geometry.ts`](src/geometry.ts): gestos propios del plugin y geometría del mundo y de
  exportación.
- [`src/capture.ts`](src/capture.ts) y [`src/fonts.ts`](src/fonts.ts): captura de la
  referencia consciente de la cancelación y recursos de fuentes.
- [`src/backend.ts`](src/backend.ts), [`src/settings.ts`](src/settings.ts),
  [`scripts/build.mjs`](scripts/build.mjs) y [`tests/`](tests/): preferencias, validación,
  empaquetado y fixtures.

Consulta el [mapa de ejemplos](../../docs/plugin-examples.md), la
[guía de autoría](../../docs/plugin-authoring.md) y la
[referencia de la API](../../docs/plugin-api/README.md).

## Licencia

AGPL-3.0-only. Consulta [`LICENSE`](LICENSE) y [`THIRD-PARTY.md`](THIRD-PARTY.md) para la
atribución de la biblioteca de captura incluida.
