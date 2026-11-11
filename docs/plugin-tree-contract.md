# Presentación compartida de árboles — API v1 de plugins

Contrato actual de la API v1. Los tipos públicos exactos están en `src/core/plugin-tree.ts`,
con `mountTree` en `src/core/plugin-ui.ts`. Usa documentación y declaraciones del SDK de
solo tipos que correspondan a la app de destino, no importaciones privadas del runtime.

## Límite

Una base de presentación compartida y manejable la usa la interfaz nativa de Chains
existente sin mover sus controladores ni su lógica de negocio. El aspecto, la navegación, la
selección, la ordenación y las operaciones sobre fuentes de Chains no cambian. El adaptador
para plugins es `components/plugin-tree.tsx`; expone la misma presentación nativa, no los
datos nativos ni un controlador de Chains.

```ts
ctx.ui.mountTree(container, tree, { signal }): PluginWidgetHandle<PluginTreeProps>
```

`tree` es un objeto de configuración genérico. `PluginTreeProps` se refiere a propiedades de
TypeScript; no es la columna **Props** (recuento de proposiciones) de Chains. El widget no
abre nada: la selección de conocimiento, los diálogos y las superficies de sesión siguen
siendo API aparte.

Quien llama es responsable de la jerarquía y los datos, la búsqueda, la ordenación, las
acciones, las reglas de dominio para renombrar y mover, la política de selección, el
almacenamiento, los contenedores de scroll, la carga y la interfaz del estado vacío. Esto no
es un gestor de ficheros, ni una API de dominio de mazos o bibliotecas, ni un framework de
interfaz declarativa nuevo. No se añade un sistema de redimensionado de columnas ni de
cabecera fija. Aquí no se migra Flashcards ni ningún otro plugin de producto.

## Configuración controlada

- `PluginTreeProps`: `label` accesible y `rows` obligatorios; `header` principal y `columns`
  finales opcionales. `label` es solo un nombre accesible, nunca un título visible
  automático. El contenido principal ocupa el ancho restante.
- `PluginTreeRow`: `key`, `content` principal, y `cells`, `children`, `selection` y
  `disclosure` opcionales. Cada fila tiene una **clave de aparición única globalmente**,
  incluidas las filas bajo antecesores plegados. Se admite cualquier cadena, incluida `""`,
  siempre que sea única. La clave identifica esa aparición mostrada, con independencia de la
  entidad que representa: no hay campo `itemId` ni acoplamiento deducido entre apariciones
  duplicadas de una misma entidad.
- `selection`: `{ label, checked, indeterminate?, disabled?, onChange(checked) }`. Quien
  llama controla cada casilla de forma independiente. No se ofrece cascada de selección entre
  padres e hijos ni estado indeterminado derivado.
- `disclosure`: `{ label, expanded, onChange(expanded) }`. La expansión está controlada;
  publica el estado aceptado mediante `update`. Los hijos sin desplegable siempre son
  visibles. Un desplegable plegado desmonta el contenido descendiente y ejecuta su limpieza;
  al reabrirlo se vuelve a montar. Persiste los datos y borradores que quieras conservar en el
  estado del plugin, no en el DOM montado.
- `PluginTreeColumn`: `{ key, header, width, align? }`; las `cells` de las filas se indexan
  por las columnas configuradas. La alineación es `"left"` por defecto o `"right"`. Un ancho
  numérico son píxeles y debe ser finito y no negativo (**0 es válido**); una cadena que no
  sea solo espacios usa la semántica de ancho de CSS. El ancho no es un servicio de
  redimensionado ni de persistencia.

El contenido principal de filas y cabecera y el contenido de celdas y cabeceras finales
aceptan `PluginTreeContent`: `string | PluginUiContent`. Lo segundo es el HTMLElement o la
función de montaje con ámbito de señal existentes, con limpieza síncrona o asíncrona
opcional. El contenido enriquecido ocupa huecos **dentro de los marcos nativos fijos de fila,
cabecera y celda**; no puede sustituir el marcado de la fila, las casillas, los controles
desplegables ni su alineación. Las acciones pueden ser contenido propio del plugin; el host
no deduce acciones de fila a partir de los datos.

## Disposición e interacción

Si ninguna fila de la configuración tiene `selection`, incluidos los descendientes plegados,
se elimina el margen de las casillas. Cualquier selección reserva ese margen para **todas**
las filas. Una lista plana sin ramas ni desplegables no tiene margen de desplegable; la
jerarquía reserva un espacio alineado para el desplegable. Las posiciones nativas de las
guías son **19px sin selección** o **37px con selección**, más **36px por nivel de
profundidad**.

Los valores tipográficos nativos por defecto usan `font-ui`: las etiquetas principales son
`text-sm` (**12,5px**), peso **500**; los metadatos y cabeceras son `text-xs` (**11px**),
peso **400**. Las celdas de cabecera y cuerpo que llevan ancho usan las mismas métricas de
fuente, también para anchos CSS en `em`/`ch`; esto no garantiza la alineación posicional con
anchos restringidos. El contenido enriquecido puede sustituir sus propios estilos. Los
separadores finos nativos aparecen **solo entre grupos de nivel superior**: las filas
anidadas no llevan líneas y no hay separador tras el último grupo. Los selectores internos
de la raíz son detalles de implementación, no API de estilos.

**El ajuste de columnas, el ancho disponible y el scroll son responsabilidad de quien llama
en v1.** Si el contenedor no da cabida a los anchos finales configurados más la sangría
máxima de la jerarquía y el espacio de controles y prefijos, la disposición puede
desbordarse y las posiciones de las columnas de cabecera y cuerpo pueden descuadrarse aunque
se conserven los anchos declarados. Que las métricas de fuente coincidan no elimina este
límite. Proporciona un ancho suficiente o un ancho mínimo interior con un contenedor de scroll
horizontal propio, o elige menos columnas o más estrechas. El margen necesario depende de tu
jerarquía, tus controles, tus columnas y tu contenido principal; el host no aporta cálculo de
ancho mínimo, política de recorte ni motor de disposición adaptable. El comportamiento nativo
no cambia.

El widget reutiliza la **navegación por filas con flechas nativa de Chains existente**, no el
foco nativo con Tab: Arriba/Abajo se mueven entre hermanos; Derecha abre una rama cerrada y
entra en su primer hijo tras la actualización controlada, o entra en el primer hijo de una
rama abierta. Izquierda sigue la regla nativa de padre o plegar el padre (una raíz expandible
se pliega a sí misma). Espacio solo conmuta la casilla opcional del host de la fila activa
cuando está habilitada. Las entradas de texto del plugin, el contenido contenteditable y las
teclas ya gestionadas conservan su propia interacción.

Un adaptador fino local a la raíz usa el núcleo puro privado `components/tree-navigation.ts`,
extraído mecánicamente de `chain-navigation.ts`; las exportaciones nativas son alias suyos,
mientras el hook nativo, los metadatos y la política de eventos no cambian. Las raíces de
widgets anidadas navegan de forma independiente. Esto no añade autoenfoque, gestión de
Buscar, manejador global, API pública de controlador de teclado ni props nuevas. **La
política de Tab de toda la app no cambia en ningún contexto**: no se introduce ninguna
excepción para Tab ni promesa de foco del navegador con Tab nativo.

## Ciclo de vida y actualizaciones

Se aplica el contrato normal de widgets: `{ signal }` al final, `update(partialTree)`
superficial y `dispose()` idempotente. Sustituye los arrays `rows`/`columns` completos al
cambiarlos; las callbacks por sí solas no actualizan los valores controlados. La cancelación
de la señal del widget, la desactivación del plugin, quitar una fila, plegar y sustituir
contenido limpian los montajes afectados. Fijar `selection.disabled` desactiva esa casilla;
**no** desmonta el contenido de la fila. El contenido asíncrono debe respetar su señal de
montaje; la limpieza tardía sigue el ciclo de vida existente de `PluginUiContent`.

Mantén estables las identidades de las funciones de montaje entre actualizaciones cuando el
contenido deba seguir montado. Crear una función nueva en cada actualización sustituye ese
contenido y lo vuelve a montar; las claves de aparición estables no anulan los cambios de
identidad del contenido. Reabrir contenido plegado lo vuelve a montar aunque la identidad de
su función sea estable.

## Ejemplo: carpetas y ficheros propios del plugin

Dentro del `mount(container, signal)` de una vista de plugin, esto usa datos arbitrarios con
aspecto de ficheros, no un servicio de sistema de ficheros del host. Quien llama conserva la
expansión, la selección y un borrador. El envoltorio muestra un scroll horizontal propio de
quien llama y un mínimo interior ilustrativo de `32rem`; elige un margen suficiente para tus
propios datos, no es un requisito fijo del host.

```js
let expanded = true;
let checked = false;
let draft = "A plugin-owned note";
let treeHandle;

// Identidad de función estable; el borrador sobrevive al desmontaje/remontaje de los descendientes.
function noteContent(slot, mountSignal) {
  if (mountSignal.aborted) return;
  const field = document.createElement("input");
  field.setAttribute("aria-label", "Note draft");
  field.value = draft;
  const saveDraft = () => { draft = field.value; };
  field.addEventListener("input", saveDraft);
  slot.append(field);
  return () => {
    field.removeEventListener("input", saveDraft);
    field.remove();
  };
}

function rows() {
  return [{
    key: "folder-occurrence", content: "Notes", cells: { kind: "Folder" },
    disclosure: {
      label: "Expand Notes", expanded,
      onChange(value) {
        expanded = value;
        treeHandle.update({ rows: rows() });
      }
    },
    children: [{
      key: "note-occurrence", content: noteContent, cells: { kind: "File" },
      selection: {
        label: "Select note", checked,
        onChange(value) {
          checked = value;
          treeHandle.update({ rows: rows() });
        }
      }
    }]
  }];
}

const scroller = document.createElement("div");
scroller.style.overflowX = "auto";
const inner = document.createElement("div");
inner.style.minWidth = "32rem"; // Elección ilustrativa de quien llama, no un mínimo del host.
scroller.append(inner);
container.append(scroller);

treeHandle = ctx.ui.mountTree(inner, {
  label: "Plugin notes", header: "Name",
  columns: [{ key: "kind", header: "Kind", width: 72, align: "right" }],
  rows: rows()
}, { signal });
return () => {
  treeHandle.dispose();
  scroller.remove();
};
```

## Pruebas

Prueba los controles controlados y las claves de aparición, la conservación del contenido
entre actualizaciones, plegar y remontar, la limpieza tardía, el aislamiento del teclado en
contenido editable y widgets anidados, las regresiones de Chains nativo y la alineación de
cabecera y cuerpo cuando el ancho es suficiente. Las disposiciones sin restricciones
suficientes siguen siendo responsabilidad de quien llama, no una garantía de alineación.
