# Atajos de teclado

**Mod** significa ⌘ en macOS y Ctrl en Windows/Linux; el despachador acepta
cualquiera de los dos modificadores en todas las plataformas. Pulsa **?** fuera
de un campo de texto para ver la chuleta de atajos de la app. Consulta
[Primeros pasos](getting-started.md) para la configuración.

## Mapa de teclas por defecto

| Acción | Atajo |
|---|---|
| Activar/desactivar el dictado | Mod+D |
| Abrir los ajustes | Mod+, |
| Selector de modelo | Mod+K |
| Cambiar el nivel de razonamiento | Shift+Tab |
| Mostrar/ocultar la barra lateral de sesiones | Mod+B |
| Buscar sesiones | Mod+Shift+F |
| Vista del grafo | Mod+G |
| Sesión nueva | Mod+N |
| Renombrar la sesión actual | F2 |
| Mostrar/ocultar todo tu razonamiento en la sesión | Mod+T |
| Buscar en la sesión / buscar en el grafo o en la vista de cadenas | Mod+F |
| Chuleta de atajos | ? |

Las acciones propias de una superficie requieren que esa superficie esté montada.
Los atajos sin modificador, como **?** y **F2**, no se activan mientras escribes;
los atajos con modificador sí.

**Ajustes → Teclado** muestra el registro y ofrece los controles Reasignar,
Restablecer por acción y Restablecer todo. Las personalizaciones se guardan en
este dispositivo, en localStorage (`lh:keymap`), no en el fichero de ajustes de
los datos de aprendizaje. Las teclas contextuales de las preguntas aparecen como
**Fijo — parte de esta pantalla** y no se pueden reasignar. Tab y Esc también
tienen un tratamiento propio, aparte del despacho normal del registro.

## Distribuciones de teclado

La coincidencia de atajos y la reasignación en Ajustes usan la misma
normalización. Con **Ctrl, ⌘ o Alt/Opción** pulsado, un único carácter no ASCII
recurre a la posición física de su tecla **A–Z o coma** cuando el evento
proporciona ese código. Por ejemplo, Ctrl+`л` en ruso sobre `KeyK` coincide con
**Mod+K**, y ⌘+`б` sobre `Comma` coincide con **Mod+,**. Esto cubre también los
caracteres no ASCII que produce Alt/Opción, como Opción+K, que informa de `˚`
sobre `KeyK` y se normaliza a `alt+k`.

Los caracteres ASCII siguen ateniéndose al carácter informado, no a la posición
física: un evento AZERTY que informa de `q` sobre `KeyA` sigue siendo `mod+q`.
La escritura sin modificadores no cambia. Los demás códigos físicos y las teclas
con nombre (incluidas las teclas muertas) conservan su tratamiento actual; esto
no es una garantía para cualquier sistema operativo/IME ni para las teclas
propias de cada distribución.

## Foco y Esc

- **Tab** no usa el recorrido de foco normal del navegador. En las páginas con
  compositor recorre hacia delante los campos de texto activos, volviendo al
  primero al final. En una sesión el orden es razonamiento durante la lectura →
  campos del dock activo → compositor, incluyendo solo los campos montados en
  ese momento. Desde cualquier otro sitio entra en el primer campo. El dock de
  preguntas de selección expandido tiene su propio ciclo filas↔razonamiento
  (ver más abajo).
- **Shift+Tab** cambia el nivel de razonamiento del modelo, también mientras
  escribes; no es el recorrido de foco hacia atrás. Los diálogos de conexión
  pueden tener su propia trampa de Tab.
- **Esc** actúa primero sobre el campo activo o sobre la capa visible superior:
  por ejemplo, salir de un campo, cerrar un menú/diálogo o cerrar Buscar. Los
  manejadores reclaman el evento para que un solo Esc no actúe también sobre las
  capas inferiores. Si ninguna capa lo reclama, el comportamiento por defecto
  cierra la chuleta o cancela el dictado (descartando su transcripción pendiente)
  antes de llegar a la confirmación del chat para descartar una pregunta/problema
  pendiente o abortar un turno en curso. Abortar un turno tras confirmarlo avisa
  al servidor, también en los turnos en segundo plano; además desconecta
  cualquier stream local.

Para conservar el texto dictado, detén el dictado con **Mod+D** / Detener en
lugar de cancelarlo con el Esc por defecto.

## Enter y envío

- En el **compositor del chat**, en los **campos de respuesta/razonamiento de las
  preguntas** y en el **campo de razonamiento de la práctica**, **Enter envía**;
  **Shift+Enter** inserta un salto de línea; **Mod+Enter** también envía. Una
  pregunta sigue necesitando una respuesta, y la práctica necesita un
  razonamiento no vacío. El envío está desactivado durante la compactación.
- La acción del compositor depende de su estado: enviar texto (o reorientar un
  turno en curso), Detener cuando está ocupado y no hay texto que enviar, o
  **Siguiente problema** cuando está vacío en la pausa de la práctica.
- Un **Enter normal fuera de una superficie de escritura** también envía la
  pregunta o la respuesta de práctica activa cuando es válida, o avanza desde la
  pausa de la práctica. Un botón de la transcripción pulsado con el puntero no
  se queda con este envío. Los botones con el foco de teclado y los botones de
  menús/diálogos abiertos conservan la activación nativa con Enter.
- Cuando una comprobación pendiente está cerrada, **Enter** la abre en lugar de
  enviar una respuesta oculta. En **Razonamiento durante la lectura**, Enter /
  Mod+Enter abre esa comprobación en espera; si no, Enter inserta un salto de
  línea y Mod+Enter sale del campo.
- La respuesta de una sola línea **Otra…** se envía con Enter, también con
  Shift+Enter.
- Los campos de búsqueda y de los menús gestionan su propio Enter; la navegación
  de Buscar nunca envía una respuesta.

## Dock de preguntas

Mientras una pregunta de selección está expandida y activa:

- **↑/↓** recorren las filas de respuesta: primero las opciones y después
  **No lo sé** (quiz) u **Otra…** (ask). El recorrido se detiene en cada
  extremo; no vuelve al principio.
- **Espacio** equivale a hacer clic en la fila recorrida: marca o desmarca una
  opción de selección múltiple o elige una opción de selección única. Seleccionar
  Otra pone el foco en su campo; Espacio sobre una fila Otra ya seleccionada la
  deselecciona sin borrar su texto.
- **←/→** ajustan la confianza del quiz por sus niveles, salvo en **No lo sé**.
- **Tab** alterna entre el campo de razonamiento y la fila de respuesta recorrida
  (o la primera). Mientras estás en las filas, el foco sigue al recorrido con las
  flechas. El control deslizante de confianza no forma parte de este ciclo.
  **Shift+Tab** sigue siendo el atajo del nivel de razonamiento.
- Las flechas y Espacio conservan su función de edición en los campos de
  escritura; las combinaciones con Alt/Ctrl/⌘ no recorren el dock. En Otra,
  **Esc** sale del campo pero mantiene la respuesta seleccionada.

Las preguntas solo de texto no tienen la mecánica de filas de respuesta; su
campo de respuesta sigue las convenciones de envío anteriores.

## Vista de cadenas

- **Mod+F** pone el foco en la búsqueda de cadenas mientras la vista está
  abierta, en lugar de en la búsqueda del grafo que hay debajo. **↓** desde ese
  campo entra en el primer resultado; las demás flechas conservan allí su
  función de edición de texto.
- **↑/↓** se mueven entre elementos hermanos de la capa actual, saltándose los
  descendientes expandidos y deteniéndose en cada extremo sin volver al principio.
- **→** expande la fila resaltada y entra en su primer hijo: carpetas → fuentes →
  cadenas → proposiciones. Una hoja se queda donde está.
- **←** vuelve al padre y pliega el contenido de ese padre. En el nivel superior,
  pliega la fila resaltada si está abierta.
- **Espacio** marca o desmarca la casilla de la fila resaltada, si la tiene. La
  navegación normal selecciona fuentes/carpetas completas; el «Elegir nodos» de
  la práctica también ofrece casillas de cadena/proposición. Los campos de texto
  conservan el comportamiento normal de Espacio.
- Hacer clic en el espacio en blanco debajo del árbol quita el foco/resaltado de
  la fila, no los elementos marcados. Crear una carpeta borra cualquier búsqueda
  y pone el foco en la carpeta nueva.
- Toda la fila activa se resalta y se desplaza hasta quedar a la vista. Este foco
  es independiente de la selección con casillas; navegar no selecciona nodos del
  grafo. Hacer clic en una fila fija la posición de navegación. Los campos de
  renombrar conservan las flechas normales de edición de texto; los menús y
  diálogos en primer plano tienen prioridad.

## Búsqueda y menús

- **Búsqueda de sesiones (Mod+Shift+F):** abre la barra lateral si hace falta y
  pone el foco en su campo de búsqueda. **↑/↓** recorren las sesiones filtradas,
  volviendo al principio al final; **Enter** abre la fila recorrida, o la primera
  coincidencia si no se ha recorrido ninguna, y después sale del campo. **Esc**
  sale del campo sin borrar la consulta.
- **Menús de búsqueda de modelos:** el foco se queda en la búsqueda. **↑/↓**
  recorren los resultados filtrados sin volver al principio; el primer ↓ empieza
  en el primer resultado y el primer ↑ en el último. **Enter** elige el resultado
  recorrido o el primero. Editar la consulta reinicia el recorrido. Los menús sin
  campo de búsqueda mueven en cambio el foco entre botones con **↑/↓** cíclicos,
  admiten **Inicio/Fin** y usan la activación nativa con **Enter**.
- **Buscar (Mod+F):** en el grafo, pone el foco en la búsqueda de nodos; con la
  vista de cadenas abierta, pone el foco en la búsqueda de esa vista. En una
  sesión, abre una búsqueda literal, sin distinguir mayúsculas, en el texto
  mostrado de la sesión, incluido el contenido fuera de pantalla por scroll pero
  excluido el contenido oculto/plegado, los campos de borrador y los documentos
  incrustados. **Enter / Shift+Enter** en el campo de Buscar pasan a la
  coincidencia siguiente/anterior, volviendo al principio al final. **Esc** cierra
  Buscar, quita los resaltados y restaura el foco anterior. Al volver a abrirlo
  se conservan la consulta y la posición de lectura dentro de esa sesión; cambiar
  de sesión reinicia Buscar. Un menú/diálogo en primer plano tiene prioridad.

## Puntos de entrada para mantenedores

El [registro](../src/core/keyboard.ts) define los valores por defecto y la
persistencia; el [despachador de ventana](../components/keyboard-shortcuts.tsx)
gestiona las acciones globales. El comportamiento contextual vive con su
superficie: los docks de preguntas/práctica, el compositor, los menús, Buscar y
la [navegación de cadenas](../components/chain-navigation.ts).
