# Desarrollo

Para la configuración del producto, consulta [Primeros pasos](getting-started.md). Para los flujos del runtime, consulta [Arquitectura](architecture.md). Estas guías siguen [el código fuente del repositorio](README.md#sobre-esta-documentación).

## Configuración

La CI y las compilaciones de versiones usan **Node 26**. Usa el lockfile y un entorno de compilación nativa compatible:

```sh
npm ci
npm run plugins:setup  # genera los SDK locales e instala las dependencias bloqueadas de los plugins fuente
npm run dev            # normalmente http://localhost:3000
npm run desktop:dev    # Next dev + Electron en localhost:3000
```

`plugins:setup` prepara cada paquete fuente de `plugins/`: genera su `.sdk/` ignorado cuando hace falta y después ejecuta `npm ci`. Ejecútalo tras clonar desde cero y de nuevo después de cambios en la API pública o en el lockfile de un plugin. El typecheck y la compilación de la raíz incluyen las fuentes de los plugins, así que la CI usa la misma preparación. No compila los bundles de los plugins, no instala ni activa plugins en tu directorio de datos de aprendizaje ni rellena `core-plugins/`.

`npm run plugins:build-core` compila los cuatro ID de `core-plugins.json` y prepara paquetes completos propiedad de la aplicación en el directorio generado `core-plugins/<id>/`. `dev` y `build` lo ejecutan automáticamente; `desktop:dev`, `desktop:dist` y `dev:fresh` usan esos puntos de entrada. El código del núcleo se carga directamente desde ese directorio; reinicia el servidor tras editar o recompilar las fuentes (no hay recarga en caliente de plugins). No uses `next dev`/`next build` a pelo sin preparar antes los paquetes del núcleo. En una copia recién clonada hace falta `plugins:setup` antes de estos comandos.

`desktop:dev` espera a que el servidor de desarrollo responda por HTTP antes de abrir su ventana de Electron, incluida la preparación de los paquetes del núcleo y la compilación de la primera ruta. El arranque tiene un presupuesto total de 30 segundos; un servidor no disponible produce un error en el terminal/registro y una salida con fallo, mientras que las páginas de error de desarrollo de Next se siguen viendo con normalidad.

Para un plugin de la comunidad o de desarrollo, compílalo en su directorio fuente y sigue la [guía de instalación](plugin-authoring.md#empaquetado-e-instalación). Los directorios generados `core-plugins/`, el `dist/` de los plugins, `.sdk/` y `node_modules/` quedan fuera de Git. UI Showcase sigue siendo un ejemplo para desarrolladores, no un paquete del núcleo que se distribuya. No instales nunca un paquete de la comunidad con un ID reservado del núcleo.

Los datos del núcleo se guardan en `<datos de aprendizaje>/core-plugin-data/<id>/`; el código y los datos de la comunidad siguen en `<datos de aprendizaje>/plugins/<id>/{dist,data}/`. Todos los plugins recién descubiertos empiezan desactivados. El código del núcleo nunca se copia al directorio de datos de aprendizaje, y pasar a esta estructura no migra los datos de desarrollo antiguos.

No hace falta ninguna clave para abrir la interfaz. Configura las conexiones y las ranuras Potente/Barato/Visión antes de usar funciones que dependan de modelos; no hay modelos seleccionados de fábrica. OpenRouter es compatible, pero no obligatorio.

```sh
npm run build          # prepara los plugins del núcleo y después la compilación de producción/standalone de Next
npm start              # sirve la compilación de producción con Next
```

`npm run desktop:dist` es la vía local de empaquetado **firmado para macOS**, no un atajo portable sin firmar. Los requisitos previos y las instrucciones para Windows/Linux están en [Compilaciones y versiones de escritorio](desktop-release.md).

### Otros dispositivos de tu red

`npm run dev`, `npm start` y `desktop:dev` solo escuchan en `localhost`. El modo solo navegador **no tiene inicio de sesión**: cualquiera que pueda llegar al puerto puede leer todos los chats y ajustes, cambiar las claves guardadas e iniciar turnos del agente. Para abrirlo desde otro dispositivo en una red de confianza, añade al final una opción de host:

```sh
npm run dev -- -H 0.0.0.0     # después navega a http://<IP de esta máquina>:3000
```

La API acepta `localhost` y direcciones IP como nombre de host. Para usar cualquier otro nombre (`mymac.local`, un dominio de proxy inverso), inclúyelo en `LH_ALLOWED_HOSTS`. Las escrituras del navegador deben proceder del mismo origen que la página.

## Configuración de ajustes y entorno

Los ajustes no secretos son diferencias guardadas en `<raíz de datos>/settings.json`; los valores ausentes se resuelven mediante `src/core/settings.ts` y `settings-resolution.ts`. Los modelos y las personalizaciones por rol son ajustes, no variables de entorno. Las [personalizaciones de prompts](../src/agent/prompts/README.md) se guardan en `<raíz de datos>/prompts/` y requieren interruptores de activación explícitos.

| Variable | Propósito |
| --- | --- |
| `LH_DATA_DIR` | Chats, tareas, grafo, ajustes y prompts modificables; por defecto, `data/` del repositorio. |
| `LH_AUTH_FILE` | Claves y vinculación del endpoint personalizado; por defecto, `auth.json` en la raíz del repositorio, fuera de `data/`. |
| Variables de clave de API de proveedores | Opcionales; dependen del proveedor seleccionado. Los nombres de la interfaz están en `src/core/auth-keys.ts`. |
| `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `OLLAMA_API_KEY` | Adaptadores de búsqueda opcionales. Si no hay uno fijado en Ajustes, gana el primer motor con clave: Tavily → Brave → Exa → Firecrawl → Ollama. Un motor fijado necesita su propia clave; no hay recurso alternativo silencioso. La búsqueda de Ollama está alojada en ollama.com, no es un servidor de modelos local. La descarga de páginas es independiente; la investigación puede descargar URL conocidas sin clave de búsqueda. |
| `DEEPGRAM_API_KEY` | Emisión opcional de tokens para el dictado. |
| `CHROME_PATH` | Ejecutable de Chrome/Chromium de reserva para verificar las demostraciones; el asistente de navegador de Electron es el principal. No se descarga ningún Chromium adicional. |
| `LH_ALLOWED_HOSTS` | Modo solo navegador: nombres de host adicionales que acepta la API además de `localhost` y las direcciones IP. Separados por comas, sin distinguir mayúsculas, se ignora el puerto, sin comodines. |

El desarrollo normal con Next puede leer `.env.local`. Las claves reales del entorno tienen prioridad sobre las guardadas. La autenticación guardada es texto plano con permisos restrictivos, no un almacén cifrado. Electron empaquetado establece ubicaciones separadas de datos y autenticación en `userData`; no usa el perfil de desarrollo del repositorio.

Configuración y limitaciones específicas de cada proveedor: [Claude Code](claude-code.md), [endpoints personalizados](custom-providers.md), [contabilidad de contexto y costes](compaction-accounting.md).

### Conexiones por suscripción en web/desarrollo

`npm run dev` y `npm start` admiten el inicio de sesión en ChatGPT, GitHub Copilot y Grok. `desktop:dev` usa esas mismas conexiones del servidor de desarrollo; el escritorio empaquetado tiene un propietario de credenciales en el proceso principal y un transporte privado aparte. Las rutas de suscripción no recurren a la facturación por clave de API.

En web/desarrollo se escriben `chatgpt-credentials.json`, `github-copilot-credentials.json` y `xai-credentials.json` **junto a `LH_AUTH_FILE`**, en el repositorio por defecto, no en `data/` ni en un perfil global de Pi. Las exclusiones de Git y de la compilación cubren estos ficheros y sus temporales de escritura. La serialización de las renovaciones es local al proceso: usa un único servidor por directorio de credenciales.

El listener de retorno de ChatGPT es `127.0.0.1` en la **máquina del servidor**; completa el inicio de sesión en un navegador de esa máquina. Copilot y Grok usan códigos de dispositivo. Si se bloquea la pestaña de inicio de sesión del navegador que lo inicia, permítela; Electron en desarrollo abre las páginas del proveedor en el navegador del sistema. Los navegadores conectados comparten las credenciales del servidor, el consentimiento de uso en segundo plano, las claves y los datos de aprendizaje.

Esto es **desarrollo local o compartido de confianza**, no alojamiento multiusuario. Las comprobaciones de nombre de host y de mismo origen de la API bloquean el DNS rebinding y las escrituras entre sitios desde otras webs, pero no son autenticación de usuarios; tampoco lo son las acciones de apertura del navegador de corta duración, vinculadas al origen y de un solo uso. No expongas el servidor a usuarios no fiables ni a Internet sin una barrera de acceso independiente. No están implementados el aislamiento por usuario, el enrutamiento remoto del retorno de ChatGPT ni la importación de credenciales.

## Trabajo local seguro

Usa una raíz de datos desechable y un fichero de autenticación aparte que contenga `{}`:

```sh
LH_DATA_DIR=/ruta/absoluta/a/scratch/data \
LH_AUTH_FILE=/ruta/absoluta/a/scratch/auth.json \
npm run dev -- --port 3001
```

Estas variables aíslan los registros de la aplicación y las claves guardadas, **no todos los efectos externos**. Las claves del entorno siguen prevaleciendo; los ficheros de suscripción siguen al directorio de autenticación; Claude Code puede usar su perfil nativo. Las herramientas de ficheros tienen un acceso de lectura amplio con el usuario del servidor, sujeto a la [protección de rutas](architecture.md#acceso-a-ficheros-y-servicios-externos). Una raíz de datos de pruebas no es un sandbox del sistema de ficheros ni de credenciales. Usa fixtures sintéticos y proveedores simulados para las reproducciones automatizadas y evita ficheros personales o credenciales del entorno.

No hagas commit de `.env.local`, de credenciales ni de registros de aprendizaje. No copies un perfil personal en un fixture. Evita escritores independientes sobre perfiles reales; los scripts de inicialización y mantenimiento del almacén pueden modificar datos o invocar etapas de modelos. Revisa los scripts antes de usarlos. Consulta [almacenamiento y compatibilidad](architecture.md#almacenamiento-y-notificaciones) antes de cambiar formatos.

Lee la guía de Next instalada correspondiente en `node_modules/next/dist/docs/` antes de hacer cambios que afecten al framework. Las restricciones de importación están en `eslint.config.mjs`; no imponen todas las convenciones de arquitectura. El [mapa del código de la arquitectura](architecture.md#límites-del-código) y la [composición de prompts](../src/agent/prompts/README.md) identifican los principales puntos de entrada. Para plugins, empieza por el [mapa de autoría y capacidades](plugin-authoring.md), el [mapa de fuentes del host y su verificación](plugin-architecture.md), las plantillas de [`examples/plugins/`](../examples/plugins/) y las fuentes de funcionalidades de [`plugins/`](../plugins/).

## Depuración

- `LH_PROVIDER_EVENTS=1` guarda los eventos en bruto del proveedor en la raíz de datos seleccionada. Pueden contener contenido privado de las lecciones o del proveedor.
- `LH_BACKGROUND_CAPTURE=auditor` (o roles separados por comas, o `all`) captura las peticiones y resultados en segundo plano. Los roles son `researcher`, `demoBuilder`, `extractor`, `auditor`, `visualMaker` y `pdfReader`; la enseñanza y el sondeo en primer plano quedan excluidos.

Por ejemplo:

```sh
LH_BACKGROUND_CAPTURE=auditor npm run desktop:dev
```

La variable debe llegar al **servidor de Next**; reinicia un servidor existente para cambiarla. Las capturas están desactivadas por defecto y se escriben en `<raíz de datos>/debug/background-captures/<rol>-<ID de ejecución>.json`. Cada fichero conserva la última petición y la respuesta/error/resultados de herramientas, con la conversación previa incluida en esa petición y tiempos compactos por turno, no el cuerpo de todas las peticiones.

`request.format: provider` significa la carga útil saliente que expone el adaptador tras las restricciones de transporte de la aplicación; `context` significa la conversación que ve el modelo, no lo que viaja por HTTP (por ejemplo, en la CLI). Las capturas no activan el razonamiento ni recuperan el razonamiento que un proveedor no haya devuelto. No se registran las opciones de la petición ni las cabeceras de autenticación, se ocultan los campos de credenciales/cabeceras anidados reconocidos y, en POSIX, los ficheros solo son accesibles para su propietario. Aun así, contienen contenido privado de fuentes y del grafo, **no caducan automáticamente**, hay que revisarlas antes de compartirlas y borrarlas a mano cuando ya no se necesiten. Los errores de captura o serialización no hacen fallar a los workers.

Ante fallos del frontend, inspecciona la interfaz real, las peticiones, la consola y el estado. Un renderizado estático por sí solo no demuestra que una interacción funcione.

## Comprobaciones

```sh
npm test               # node:test mediante tsx; motores inyectados, fixtures, transportes simulados
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, incluidas las restricciones de importación
npm run build          # compilación de producción de Next
```

La suite no requiere modelos de pago ni inicios de sesión reales. Algunas pruebas usan ficheros temporales, procesos nativos o endpoints simulados locales: determinista no significa que todas las pruebas sean puras ni que no puedan ocupar un puerto de loopback. Revisa la preparación de una suite concreta antes de ejecutarla junto a una aplicación en marcha.

Los [fixtures dorados](../tests/fixtures/golden-data/README.md) ejercitan registros guardados a través de los caminos de producción. Mantén las expectativas de compatibilidad junto con los cambios de formato intencionados; no edites a mano el contenido de los fixtures para que pasen las pruebas. Las [pruebas de los lectores independientes de la skill](../tests/skills/README.md) se ejecutan por separado con Python y sin el runtime de la aplicación.

Hay controles de runtime adicionales con requisitos previos:

| Comprobación | Requisito previo / propósito |
| --- | --- |
| `node scripts/smoke-provider-runtime.mjs` | Compilación reciente; caminos de carga útil/runtime de proveedores trazados con fixtures. También se usa durante el empaquetado. |
| `node scripts/smoke-web-subscriptions.mjs` | Compilación, sin servidor de desarrollo en marcha; comprobaciones aisladas de conexiones sintéticas, con el tráfico externo bloqueado. Cambia y restaura brevemente el mtime de una fuente para ejercitar la recarga. |
| `node scripts/build-plugin-types.mjs` | Compila el SDK portable de plugins, solo de tipos, en `dist/plugin-sdk`. |
| `node scripts/build-server.mjs` y después `node scripts/smoke-server.mjs --isolated --browser` | Compilación reciente; ensambla y verifica una copia standalone sin fuentes, los backends de plugins instalados y la interfaz en el navegador. Añade `--electron` para el Node incluido en Electron; las comprobaciones de navegador requieren Chrome/Chromium local. |
| Otros `scripts/smoke-*.mjs` | Renderizadores standalone/nativos, workers de imágenes, asistente de demostraciones, compresión, rutas de ficheros, apertura. Lee cada script y la [guía de versiones](desktop-release.md) antes de ejecutarlo. |

Ejecuta comprobaciones proporcionadas al cambio. Los controles sin conexión demuestran los contratos ejercitados, no los derechos de uso reales ni la calidad de las lecciones generadas por el modelo.
