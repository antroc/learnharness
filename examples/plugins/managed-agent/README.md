# Ejemplo de agente gestionado

Copia este directorio en el directorio de plugins que se muestra en **Ajustes → Plugins de la comunidad**,
conservando la carpeta `managed-agent/` y su `dist/manifest.json` obligatorio. No hace falta
compilar nada. Actualiza y activa **Managed agent example**. Edita los ficheros de runtime en
`dist/` y reinicia LearnHarness después de cambiar código ya cargado. Conserva la carpeta
hermana `managed-agent/data/` al sustituir `dist/`; no distribuyas nunca esos datos
persistentes ni los pongas en `dist/data/`. Ábrelo mediante su acción explícita de la barra
lateral o del grafo. Registrar la vista por sí solo no la coloca en ningún sitio.

Es un pequeño ejemplo para desarrolladores, no una aplicación de demostración aparte. El
`mountStandardComposer` del host proporciona la selección controlada de modelo/razonamiento,
la entrada de texto y el dictado. Selecciona un modelo configurado (y el nivel de razonamiento,
si lo admite) y haz clic en **New conversation**. Esas elecciones se aplican a la conversación
nueva, no a una existente. Crear o abrir una conversación nunca ejecuta el agente. Solo
**Send**, **Run as background task** o responder a una pregunta pendiente inicia trabajo de
forma explícita. Las peticiones al modelo y el dictado pueden generar costes del proveedor
configurado; el trabajo en segundo plano también necesita el permiso de la conexión
configurada. Detener usa el compositor del host.

Prueba a pedirle al agente que haga una pregunta o que guarde una nota. Las preguntas
pendientes y la transcripción se mantienen a propósito como DOM sencillo propiedad del
plugin. Sal y vuelve a entrar para observar una ejecución en curso; desmontar la vista no
aborta la ejecución en el backend. Todos los widgets del host reciben el `{ signal }` de la
vista y se liberan al desmontarla.

El plugin controla su estado de borrador/modelo/razonamiento; los widgets no escriben valores
por defecto del host. El backend guarda las definiciones de modelo/razonamiento en su propio
`data/definitions.json` y las notas de demostración en `data/notes.jsonl`; el host guarda los
registros de agente propiedad del plugin separados de los chats de aprendizaje. No se escriben
datos de aprendizaje principales ni valores por defecto de los modelos. No hay ajustes
configurables ajenos ni ejecuciones automáticas.

Comprobación para mantenedores **desde una copia del repositorio de LearnHarness con sus
dependencias instaladas** (sin peticiones a proveedores; no es un comando que proporcione la
skill descargada):

```sh
node --test examples/plugins/example-ui.test.js
```
