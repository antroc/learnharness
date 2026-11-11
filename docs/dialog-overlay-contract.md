# Contrato de diálogos, popups e interacción

La interfaz principal y la de los plugins comparten la propiedad de la interacción, el
enrutado del teclado y las reglas de foco y de cierre. Los plugins usan los helpers públicos
de `ctx.ui`; los módulos de implementación descritos más abajo son infraestructura privada
del host, no importaciones para plugins.

## Presentación en los plugins

Los diálogos públicos de plugins y las superficies del cuerpo de página no tienen una fila
de título/cabecera visible del host. Su título obligatorio proporciona el nombre accesible.
Una X discreta en la esquina flota sobre el contenido desplazable alineado a los bordes; los
plugins se encargan de los encabezados visibles y de las acciones inferiores. Las superficies
ocupan los límites del cuerpo de la página. `background?: "dimmed" | "opaque"` controla el
fondo de la superficie; el valor por defecto, `"dimmed"`, usa el pintado translúcido y
difuminado al estilo de Cadenas.

## Propiedad de la interacción

### Escape: un evento, un propietario

Solo la interacción activa superior responde a un evento físico de Escape. Esto incluye un
editor con el foco que gestiona Escape, un menú encima de un diálogo o un diálogo hijo
encima de su padre.

- Los manejadores hoja tienen su oportunidad normal antes de que se cierre la superficie que
  los contiene.
- Un Escape ya gestionado no puede además cerrar un padre, cancelar el dictado ni abortar un
  turno.
- La propiedad se captura al empezar el evento. Cerrar una superficie no permite que la
  superficie que queda al descubierto gestione esa misma tecla.
- Una superficie que se niega a cerrarse consume igualmente el Escape.
- La cancelación explícita en un editor, incluido renombrar fuentes, carpetas o sesiones,
  conserva su propia semántica. No hay una regla genérica de «borrar primero la búsqueda»:
  los menús de modelo/proveedor/fuente tipográfica/idioma se cierran, mientras que la búsqueda
  de la barra lateral conserva su consulta y sale del campo.

### Tooltips pasivos

Los tooltips no son dueños de capas de interacción ni interceptan Escape. Siguen asociados a
su modal propietario para que su pintado, su comportamiento al pasar el puntero o al recibir
el foco y sus relaciones de accesibilidad sigan siendo válidos por encima de su marco.

### Tab: sin navegación nativa

La navegación nativa del navegador con Tab y Shift+Tab está desactivada, también en
diálogos y popups. Los atajos explícitos de la aplicación siguen aplicándose dentro de su
ámbito:

- Tab sin modificadores invoca la acción configurada de recorrer campos hacia delante o la
  acción de fila de opción/razonamiento de la pregunta.
- Shift+Tab invoca el cambio de nivel de razonamiento.
- La reasignación de atajos puede registrar Tab como candidato a atajo.

Los ámbitos de foco modales no añaden un bucle en los bordes. Los campos y los controles de
razonamiento tapados no pueden recibir estas acciones. Evitar el comportamiento nativo por
defecto no suprime los manejadores del destino.

### Campos de Ajustes: Escape conserva y confirma

Escape en un campo de texto/número de Ajustes con el foco reclama el evento, sale del campo
por su ruta normal de pérdida de foco/guardado y guarda un valor válido usando la validación
y la normalización del dominio. No cierra Ajustes ni descarta el valor escrito.

Los valores no válidos no se guardan; los borradores fallidos y los errores de validación se
mantienen. Los guardados aceptados muestran los valores canónicos confirmados, incluida la
normalización o el ajuste a límites. Un Escape posterior fuera del campo sí puede cerrar
Ajustes. Los flujos explícitos de renombrar/cancelar siguen siendo independientes.

Los editores de credenciales y de proveedores personalizados conservan las acciones
explícitas Guardar/Cancelar. Escape pliega el editor expandido sin guardar las credenciales
ni cerrar Ajustes, después de que una hoja con el foco o un menú superior hayan tenido su
turno. Los borradores sin guardar sobreviven al plegado y al cambio de editor hasta que se
cierra Ajustes.

Una respuesta sin un registro canónico válido de ajustes guardados muestra «No se han podido
confirmar los ajustes guardados. Se ha conservado lo que has escrito.» Los demás errores
HTTP/de red conservan sus propios mensajes. Las respuestas antiguas que llegan tarde no pueden
sustituir una instantánea confirmada más reciente ni su aspecto. Un guardado pendiente que
termina después de volver a abrir Ajustes actualiza la instancia actual; las lecturas
anteriores de Ajustes o del arranque no pueden deshacer un guardado confirmado.

### Foco inicial y retorno

Los destinos de foco inicial explícitos tienen prioridad. Si no hay, un modal pone el foco en:

1. Su primer campo de texto/número editable que cumpla los requisitos.
2. Su encabezado de contenido que cumpla los requisitos, si no hay ningún campo.
3. Su límite accesible o su marco pintado, no la acción de cerrar.

Los controles desactivados, de solo lectura, ocultos o inactivos no cumplen los requisitos.
Las superficies sin cabecera no ponen el foco en envoltorios `display: contents` que no se
pintan. Esto no activa el Tab nativo.

Cerrar un hijo devuelve el foco al elemento que lo invocó en el padre que se reanuda, si
cumple los requisitos. Los destinos desconectados, desactivados, ocultos o sustituidos no
pueden robar el foco; si el elemento invocador no está disponible, la superficie activa usa
su política de foco inicial. Los popups conservan sus reglas explícitas de retorno del foco.

### Padres de modales anidados

Un modal hijo no cierra, vuelve a montar ni oculta a su padre con `display: none`. Los padres
siguen pintados y conservan su estado y su posición de scroll. Solo el modal activo y sus
hijos interactivos propios reciben acceso a la interacción y a la accesibilidad. Un hijo
puede, naturalmente, tapar el pintado de su padre.

### Operaciones en curso y protecciones de cierre

Las confirmaciones de borrado de fuentes, carpetas, sesiones o nodos consumen Escape sin
cerrarse mientras el borrado está en curso, igual que sus rutas de cierre desactivadas
mediante Cancelar o el fondo. Un indicador genérico `busy` no implica un bloqueo del cierre:
las confirmaciones de aborto, la configuración inicial y los flujos de conexión/cancelación de
proveedores conservan su comportamiento propio del dominio. Cerrar una superficie no cancela
implícitamente una escritura aceptada ni otra operación del dominio.

### Instancia única de Ajustes y navegación de vuelta

Hay una única instancia de Ajustes. Abrir Ajustes la coloca encima de la superficie actual
sin descartar esa superficie. Volver a Ajustes cuando está debajo de capas hijas solicita el
cierre de arriba abajo mediante los callbacks normales:

- Detente si una capa se niega, gestiona la solicitud sin cerrarse o sigue abierta durante una
  cancelación asíncrona.
- Invoca cada callback de cierre como mucho una vez por solicitud. No fuerces la cancelación,
  no esperes en bucle a que desaparezca una capa ni encoles una navegación diferida.
- Redirige Ajustes solo cuando la vuelta haya tenido éxito, conservando el estado de la
  sección y del enlace profundo.

El orden de pintado no implica la propiedad del ciclo de vida: descargar un diálogo de plugin
que está debajo de los Ajustes globales no destruye Ajustes.

## Familias de superficies

| Familia | Ejemplos | Comportamiento |
| --- | --- | --- |
| Diálogos modales | Ajustes, configuración inicial, confirmaciones, conexiones de proveedores, diálogos de plugins, chuleta de atajos | Aislamiento modal del foco, la accesibilidad y el scroll, y protecciones de cierre propias del dominio. |
| Menús/popups anclados | Menús de modelo/razonamiento/proveedor/fuente tipográfica/idioma, menús contextuales, menús de plugins, paneles del grafo/estadísticas | Interacción acotada a su propietario con las reglas de geometría, búsqueda/flechas, puntero exterior, cierre por scroll y retorno del foco de cada popup. |
| Vistas del área de contenido | Navegador de cadenas, diagramas/figuras expandidos, plan completo expandido | Límites del contenido principal con la barra lateral interactiva, sin aislamiento modal de todo el viewport. |
| Interfaz en línea/no interactiva | Desplegables de actividad, notificaciones/banners de actualización, vistas previas de arrastre | Sin capa de interacción modal. |

### Alternancia del menú de plugin sobre el mismo ancla

Dentro de un mismo propietario de interfaz de plugin, las llamadas repetidas a `openMenu`
para exactamente el mismo elemento ancla cierran el menú existente, de forma síncrona incluso
antes de que React lo monte. Al cerrarse se llama una vez al `onClose` más reciente del menú
existente y se devuelve un manejador inerte para la llamada repetida. Las props y el callback
entrantes no crean otro menú. Los distintos propietarios y anclas mantienen un comportamiento
independiente.

Los clics fuera (incluido otro botón), el cierre por acción, el retorno del foco al ancla
solo con Escape y el comportamiento ante errores o asíncrono conservan su semántica normal. La
caducidad del llamante, el plugin o la superficie, o su liberación explícita, borran el
registro del ancla sin generar un `onClose`; los manejadores obsoletos no pueden afectar a un
menú posterior.

### Selector de conocimiento para plugins

El `mountKnowledgePicker` controlado usa la interfaz real de Cadenas y sus operaciones de
selección y de organización de fuentes. La presentación depende del propietario de la
invocación:

- Una página nativa o de plugin, o una superficie del cuerpo de página, abre una `view` en
  el panel de contenido principal, que excluye la barra lateral y la deja interactiva.
- Un diálogo, Ajustes u otro ancestro modal abre un modal de ventana completa, con su padre
  pintado y el fondo y la barra lateral inactivos.

El host captura el propietario y los límites; los plugins no proporcionan una opción de
origen. Salir de la página de origen o la caducidad del propietario/widget exacto cierra los
selectores pendientes o abiertos. Tapar un origen vivo conserva el estado montado. Un origen
de modal global sigue el ciclo de vida real de su modal/widget, no el de una ruta de fondo
ajena.

Ambas presentaciones reservan el espacio para los controles de la ventana nativa sin añadir
un control para volver a abrir la barra lateral ni cambiar la preferencia de la barra lateral
de fondo. La acción de selección es **Hecho**. El pintado de la vista local sigue el orden de
interacción, incluidas las superficies y los popups propios; los diálogos modales globales
quedan por encima de este estrato local principal. La propiedad de mazos y biblioteca sigue
siendo del plugin, no del selector.

## Implementación en el host

Los módulos de implementación privados son `components/interaction-layers.tsx`,
`components/host-dialog.tsx`, `components/menu-shell.tsx` y
`components/popover-dismiss.ts`. Coordinan la propiedad y el pintado sin encargarse de la
validación del dominio, la cancelación de la autenticación, las modificaciones de fuentes ni
la lógica de negocio de los plugins.

La composición modal usa la contención de FocusScope de Radix sin bucle, el aislamiento de
accesibilidad del contenido exterior, el aislamiento del scroll anidado y portales/fondos
propios del host. El cierre que empieza por las hojas sustituye al cierre estándar con Escape
en fase de captura. Los tooltips pasivos usan Popper/Presence sin registrar un propietario de
interacción.

La propiedad de Escape se observa antes de enrutar los eventos no consumidos tras los
manejadores hoja. Se evita el comportamiento nativo por defecto de Tab sin detener la
propagación. Buscar, el envío con Enter, los atajos de modelo/razonamiento y las acciones de
Escape por defecto usan los propietarios de interacción que cumplan los requisitos. Los
resultados del cierre distinguen entre cerrado, bloqueado, gestionado sin cerrar y pendiente;
una cancelación pendiente nunca autoriza un recorrido diferido de la pila.

Las confirmaciones de Ajustes distinguen entre aceptación, rechazo por validación, escrituras
bloqueadas y fallo de persistencia. Unos tickets de revisión protegen los borradores más
recientes; los campos numéricos nativos conservan los botones de incremento y el tratamiento
de `badInput`, para que los valores incompletos no se confundan con valores vacíos. Las
solicitudes de apertura liberadas o sustituidas no pueden activarse tras respuestas tardías.
Tapar un padre no libera su contenido. La propiedad de los popups en portales mantiene
alineados el foco, la accesibilidad, el scroll y el pintado sin recolocar manualmente el DOM
de React ni saltos de z-index sin relación.

Los proveedores de interacción viven en el AppShell del cliente. La inicialización de los
módulos y el renderizado en el servidor no acceden a globales del navegador ni importan
código privado del servidor/almacén en el grafo del cliente.
