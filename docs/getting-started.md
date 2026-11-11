# Primeros pasos

Descarga LearnHarness desde [learnharness.ai](https://learnharness.ai) o desde [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases). Para ejecutarlo desde el código fuente, consulta [Desarrollo](development.md).

## Conectar modelos

Abre **Ajustes → Proveedores** y configura una conexión:

- **Claves de API de proveedores:** usa tu propia cuenta y paga las tarifas de ese proveedor.
- **Conexiones por suscripción:** ChatGPT, GitHub Copilot y Grok usan sus respectivos flujos de inicio de sesión y los límites de cada cuenta. No recurren en silencio a la facturación por clave de API.
- **[Claude Code](claude-code.md):** usa una CLI instalada y autenticada por separado. Su propia configuración controla el enrutamiento y la facturación; no es una garantía de uso exclusivo de la suscripción.
- **[Endpoint personalizado](custom-providers.md):** conecta un servidor compatible con OpenAI, incluido un servidor de modelos local. LearnHarness no instala ni descarga modelos.

Elige los modelos **Potente**, **Barato** y **Visión** en Ajustes. No hay modelos seleccionados de fábrica. Las sesiones nuevas empiezan con el Potente; los roles en segundo plano usan las ranuras que tengan asignadas o sus personalizaciones por rol. Un modelo seleccionado dentro de una sesión existente pertenece a esa sesión y no cambia la elección de los roles en segundo plano.

La búsqueda web opcional admite Tavily, Brave, Exa, Firecrawl y la búsqueda alojada de Ollama; configura una clave para el motor que quieras usar. La investigación puede seguir descargando URL conocidas sin clave de búsqueda. El dictado tiene su propia clave de servicio, que se explica más abajo.

## Empezar una sesión

Elige **Enseñar** y describe lo que quieres entender. El agente sondea tu punto de partida, presenta un plan y enseña mediante explicaciones y comprobaciones. Responde con naturalidad para aceptar o modificar el plan.

Usa los campos de razonamiento para explicar tu razonamiento, tu incertidumbre o tu reacción, no solo la respuesta elegida. Puedes escribir o dictar. Tu grado de confianza lo declaras tú; no es una evaluación independiente.

Elige **Practicar** para resolver problemas en lugar de seguir una lección. Empieza a partir de material seleccionado del grafo o describe el material directamente. Envía tu razonamiento a medida que trabajas; la solución comprometida del modelo se revela cuando el problema concluye. Usa **Siguiente problema** cuando quieras continuar.

Las sesiones se guardan en local, incluidos los mensajes anteriores cuando se compacta el contexto. La [guía de teclado](keyboard.md) explica el envío, el foco, los controles de las preguntas y la cancelación.

## Dictado

1. Crea una [clave de API de Deepgram](https://console.deepgram.com/) con el **rol Member o superior**, necesario para [emitir tokens de corta duración](https://developers.deepgram.com/reference/auth/tokens/grant).
2. Añádela en **Ajustes → Proveedores → Dictado** y elige el idioma debajo de la clave. **Multilingüe** admite el reconocimiento automático y el habla con varios idiomas mezclados.
3. Usa el micrófono o **Mod+D** para empezar y parar. Revisa el texto antes de enviarlo. **Cancelar con Esc descarta la transcripción pendiente**; para conservarla, detén el dictado de la forma normal.

El audio se envía en streaming desde tu navegador directamente a Deepgram con un token de corta duración. Un error `403 Insufficient permissions` al obtener ese token puede significar que el rol de la clave es insuficiente.

## Usar ficheros locales en una sesión

En la aplicación de escritorio, usa la opción **Ficheros** o **Carpeta** del clip, o arrastra ficheros/carpetas al área de contenido, para insertar sus rutas locales. Ficheros admite cualquier tipo de fichero y selecciones múltiples; Carpeta adjunta la ruta de un directorio, aunque esté vacío, sin expandir ni leer su contenido. A las carpetas conocidas recién elegidas o arrastradas se les añade un separador de directorio final para que su icono de carpeta se conserve en los mensajes guardados y al recargar; los ficheros no cambian. Las rutas antiguas sin marcar no se clasifican a posteriori. A partir de ahí, el agente puede localizar y leer contenido compatible en la máquina que ejecuta LearnHarness, dentro de las protecciones de acceso a ficheros existentes; adjuntar una ruta no concede permisos. **No es una subida**: los originales se quedan donde están. Los navegadores normales no pueden exponer estas rutas locales mediante el selector ni el arrastrar y soltar; en su lugar, puedes pegar una ruta completa.

El profesor puede mostrar una imagen rasterizada local o pedir un elemento visual anotado basado en ella. Las imágenes mostradas/anotadas se guardan como instantáneas propiedad de la sesión, de modo que esos resultados guardados ya no dependen del fichero original. Esto no crea instantáneas de todos los ficheros adjuntos. Las pruebas de regresión sin conexión cubren el comportamiento de las instantáneas y de la carga útil, no la calidad de las anotaciones generadas por el modelo.

Las herramientas de ficheros son de solo lectura, pero tienen un acceso amplio al sistema de ficheros con el usuario del servidor; no están limitadas a una carpeta seleccionada. La protección de rutas sensibles bloquea ubicaciones conocidas de credenciales y datos privados, no todo el contenido sensible. Revisa lo que pones a su alcance: el contenido de los ficheros que lee un agente puede enviarse al proveedor de modelos configurado. Consulta los [límites del acceso a ficheros](architecture.md#acceso-a-ficheros-y-servicios-externos).

## Extraer al grafo

Para las lecciones, es mejor adjuntar el material a una sesión. Usa el selector **Extraer ficheros… → Ficheros** o **Carpeta** del grafo para Markdown, texto plano o PDF. Es un flujo de importación aparte, distinto de las rutas adjuntas de la sesión. Extraer ficheros acepta `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.adoc`, `.tex` y `.pdf` (en mayúsculas o minúsculas); las demás extensiones se rechazan con un mensaje breve. Cada fichero compatible se sube para procesarlo; las carpetas organizan las fuentes importadas.

- Los ficheros están limitados a **25 MiB cada uno**. Las importaciones se encolan de forma independiente, con hasta tres ficheros en curso a la vez.
- Dentro de las extensiones aceptadas, los PDF se reconocen por su cabecera `%PDF-` y se convierten en local, sin OCR. Las páginas que solo contienen imágenes se omiten y se cuentan; el texto de los escaneos puede ser impreciso. Revisa los avisos de la importación.
- Los demás ficheros se leen como UTF-8. Un byte cero en los primeros 8 KiB provoca el rechazo antes de registrar la fuente o de llamar al modelo. Esto detecta muchos ficheros binarios renombrados a `.txt`, pero no es una detección completa de binarios; el texto en UTF-16 no se decodifica correctamente y a menudo se rechaza. Guarda el texto como UTF-8.
- Después, el texto importado pasa por una extracción de proposiciones/cadenas basada en el modelo. La conversión local de PDF no hace que toda la importación funcione sin conexión.
- Los fragmentos completados sobreviven a los fallos posteriores. Reintentar es una acción explícita y vuelve a procesar el fichero; el contenido que no ha cambiado no se omite automáticamente. La cola de ficheros no sobrevive a una recarga de la página.

El grafo guarda proposiciones y cadenas de razonamiento con su procedencia, **no puntuaciones de dominio**. Que una proposición esté presente no demuestra que la hayas entendido o retenido. La extracción automática desde las sesiones se puede desactivar con independencia de la representación del grafo.

## Datos, privacidad y uso

Los chats, los registros del grafo, los ajustes y las credenciales se guardan en tu máquina. En la aplicación de escritorio empaquetada, los datos suelen estar en:

| Sistema operativo | Carpeta de datos de aprendizaje |
| --- | --- |
| macOS | `~/Library/Application Support/LearnHarness/data` |
| Windows | `%APPDATA%\LearnHarness\data` |
| Linux | `$XDG_CONFIG_HOME/LearnHarness/data`, o `~/.config/LearnHarness/data` |

Los ficheros de claves de API están junto a `data`, no dentro. Son texto plano con permisos de fichero restrictivos, no un almacén cifrado. Mantén privados los perfiles completos; no compartas ficheros de credenciales ni capturas de depuración sin filtrar en los informes de errores.

**Almacenamiento local no significa procesamiento exclusivamente local.** Los modelos configurados, los servicios de suscripción/CLI, la investigación web y el dictado pueden recibir contenido. Un modelo personalizado local es una opción de configuración aparte, no una garantía de funcionamiento sin conexión para los demás servicios activados.

Haz clic en la fila de contexto/coste que hay bajo el compositor para ver las estadísticas de la sesión. Las cifras en dólares estiman los costes conocidos de API; el uso de suscripciones, CLI y endpoints personalizados no se trata como gratuito. Consulta [contexto, caché y costes](compaction-accounting.md) para más detalles.

Las aplicaciones empaquetadas admiten actualizaciones en **Ajustes → General**. Las compilaciones de desarrollo no ejecutan el actualizador. Informa de los problemas a través de [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues), con los pasos para reproducirlos y la versión de la aplicación y del sistema operativo, en lugar de registros de aprendizaje privados o claves.
