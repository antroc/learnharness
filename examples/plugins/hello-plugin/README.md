# Hello plugin

Copia este directorio en el directorio de plugins que se muestra en **Ajustes → Plugins de la comunidad**,
conservando la carpeta `hello-plugin/` y su `dist/manifest.json` obligatorio. No hace falta
compilar nada. Actualiza y activa **Hello plugin**. Edita los ficheros de runtime en `dist/` y
reinicia LearnHarness después de cambiar código ya cargado. Los datos persistentes, si se
añaden, van en la carpeta hermana `hello-plugin/data/`, nunca en `dist/data/`; consérvalos
al sustituir `dist/`. No se instala ni se activa nada automáticamente.

Este ejemplo mínimo, solo de frontend, registra una vista `hello` y una acción `open`
aparte. Las ubicaciones explícitas muestran la acción en la barra lateral, en el grafo y en
las barras superiores de las sesiones de enseñanza / práctica. Registrar una vista o una
acción por sí solo no añade ningún elemento a la interfaz.

Abre la vista y haz clic en **Say hello** para ver un botón propiedad del host y un diálogo
estándar con contenido DOM propiedad del plugin. Todos los widgets reciben el `{ signal }` de
la vista, así que cerrar la vista o desactivar el plugin los desmonta. El montaje de ajustes
personalizado es solo texto explicativo: no hay ajustes de esquema inventados, ni backend, ni
peticiones al modelo.
