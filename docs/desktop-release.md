# Compilaciones y versiones de escritorio

Esta es una referencia para mantenedores. Para la instalación y el uso normal, empieza por [Primeros pasos](getting-started.md).

## Plataformas y requisitos previos

| Plataforma | Runner de la versión | Paquetes | Actualización desde la app |
| --- | --- | --- | --- |
| macOS, Apple Silicon | `macos-26` arm64 | DMG + ZIP firmados/notarizados | ZIP mediante Squirrel.Mac |
| Windows, x64 | `windows-2025` | Instalador NSIS por usuario sin firmar | NSIS |
| Linux, x64 | `ubuntu-24.04` | AppImage + `.deb` | Sustitución del AppImage; `.deb` mediante dpkg/apt, con elevación si hace falta |

Windows puede mostrar avisos de SmartScreen o de editor desconocido. El AppImage es la descarga principal en Linux; las actualizaciones del `.deb` pueden pedir una contraseña de administrador. Ambos usan el mismo banner de descarga/reinicio. Los objetivos y la firma se definen en [`electron-builder.yml`](../electron-builder.yml); la CI y las versiones usan **Node 26**.

La compilación del icono de macOS requiere **macOS 26+ y Xcode 26+** para `build/icon.icon`. `actool` crea `Assets.car`; `after-pack.cjs` restaura el icns de respaldo a resolución completa. Windows/Linux usan iconos de diseño plano generados por `scripts/make-icons.mjs`. La identidad de escritorio en Linux es `learnharness.desktop`.

La barra de la app personalizada se mantiene en todas las plataformas. macOS tiene los «semáforos» a la izquierda y el menú del sistema; Windows/Linux usan el Window Controls Overlay nativo a la derecha y muestran el menú nativo con Alt.

## Cadena de compilación

Compila **en cada sistema operativo de destino**. Next rastrea los binarios nativos de la máquina en la que compila; un árbol standalone de macOS no sirve como contenido para Windows/Linux.

1. `npm ci`
2. Ejecuta las pruebas nativas del renderizador y del servicio de navegador en el Node de Electron:
   ```sh
   ELECTRON_RUN_AS_NODE=1 NODE_ENV=test npx electron --import tsx --test tests/pdf-native-render.test.ts tests/pdf-ops.test.ts tests/svg-native-render.test.ts tests/browser-service.test.ts
   ```
   Esta sintaxis de prefijo de entorno es para una shell POSIX; la CI usa Bash en todos los sistemas.
3. `npm run build`
4. `node scripts/smoke-provider-runtime.mjs` — comprueba el **rastreo recién generado antes de la curación**, incluida la inicialización nativa de proveedores y los contenidos de prueba, no un inicio de sesión ni una generación reales.
5. `node scripts/build-server.mjs` — copia los recursos estáticos, valida los recursos de prompts, rechaza fugas conocidas de datos/credenciales y elimina solo los instaladores antiguos y el Electron de desarrollo de la raíz standalone.
6. `node scripts/smoke-server.mjs --electron` — comprueba las dependencias del renderizador y de la demo, los proveedores, la contrapresión de gzip y el arranque HTTP standalone aislado bajo el Node de Electron.
7. Empaqueta con Electron Builder usando la política local o de versión correspondiente (ver más abajo).

La carcasa y el actualizador van en `app.asar`; el servidor y los renderizadores nativos van sin empaquetar como `extraResources`. Los recursos dinámicos de Pi/PDF/canvas/resvg/Photon se rastrean explícitamente en [`next.config.ts`](../next.config.ts). Mantén las exclusiones del rastreo acotadas: patrones amplios como `dist/**` o `data/**` pueden eliminar recursos de dependencias. Las protecciones de curación no sustituyen a inspeccionar un contenido que ha cambiado.

El flujo de versión también comprueba los proveedores desde el contenido **empaquetado** bajo el Node del host y el Electron empaquetado, y después ejercita el asistente de la demo con el Electron de la app (Xvfb en Linux). El arranque HTTP o la salida del catálogo por sí solos no prueban estas rutas de carga diferida.

`smoke-image-runtime.mjs` comprueba por separado el redimensionado sintético con Photon, en proceso y en worker, en la salida standalone. Acepta `--standalone <dir>` y `--runtime <binary>`; **actualmente no lo invocan los flujos de CI ni de versión**.

### Paquetes locales

`npm run desktop:dist` es la ruta local de **macOS firmado**, que usa el perfil de llavero `LH_NOTARY` y el `DEVELOPER_DIR` de Xcode. Limpia `dist` y `.next/standalone`, compila, comprueba el rastreo de proveedores recién generado, hace la curación, ejecuta el smoke del servidor bajo el **Node del host** y empaqueta. No ejecuta por sí mismo las comprobaciones con el Node de Electron ni las posteriores al empaquetado, ni el flujo de subida por etiqueta.

En Windows/Linux, haz los pasos 1–6 en ese sistema y después:

```sh
npx electron-builder --win --x64 --publish never    # Windows
npx electron-builder --linux --x64 --publish never # Linux
```

## Modos de CI y de versión

La [CI](../.github/workflows/ci.yml) ejecuta la comprobación de tipos, las pruebas y el lint en Ubuntu, además de comprobaciones standalone/nativas en macOS, Windows y Linux. Su job `macos-15` no compila el icono de la versión.

La [versión de escritorio](../.github/workflows/release.yml) tiene dos modos:

- **Lanzamiento manual:** instaladores de ensayo sin firmar, que se conservan como artefactos del flujo durante siete días. Sin secretos de firma, sin creación de versión y sin publicación. Se omite la notarización de macOS; no son instaladores de producción.
- **Etiqueta `v<versión de package.json>` coincidente:** comprobaciones, un job compartido de preparación del borrador, tres jobs de empaquetado/subida por sistema operativo y, por último, la verificación del borrador en solo lectura. Las versiones existentes ya publicadas o ambiguas hacen fallar la preparación; las ejecuciones sobre la misma ref se serializan en lugar de cancelar subidas. macOS debe firmar/notarizar. **El flujo nunca publica el borrador.**

### Verificación del borrador

[`scripts/verify-release.ts`](../scripts/verify-release.ts) se ejecuta después de todos los jobs de empaquetado. Exige un único borrador que coincida con `v<versión>` o con `<versión>` a secas, y rechaza cero o dos coincidencias, o una coincidencia ya publicada. Las coincidencias con la versión a secas generan un aviso, porque ejecuciones posteriores podrían repartir los recursos entre etiquetas.

El borrador debe contener **exactamente 11 recursos subidos y no vacíos**:

| Recursos | Propósito |
| --- | --- |
| `LearnHarness-<v>-arm64.dmg` + `.blockmap` | Instalador de macOS |
| `LearnHarness-<v>-arm64-mac.zip` + `.blockmap` | Actualizador de macOS |
| `LearnHarness-<v>-x64-setup.exe` + `.blockmap` | Instalador/actualizador de Windows |
| `LearnHarness-<v>-x86_64.AppImage` | AppImage de Linux |
| `LearnHarness-<v>-amd64.deb` | Paquete Debian |
| `latest-mac.yml`, `latest.yml`, `latest-linux.yml` | Feeds del actualizador |

Las versiones de los feeds, los conjuntos exactos de recursos referenciados, los nombres de fichero sin ruta, los tamaños y los campos heredados de ruta/hash deben coincidir; el ZIP de macOS debe ir primero. La falta de recursos, los recursos extra obsoletos, las rutas con travesía de directorios o URL, o las desviaciones en los nombres que genera el builder hacen fallar la validación. El validador no descarga ni calcula el hash de cada instalador; comprueba los metadatos del borrador y los feeds descargados.

El job de verificación necesita `contents: write` para listar borradores privados, pero solo hace operaciones GET. Su token se expone únicamente al listado de versiones y a la descarga de feeds, no a la instalación de dependencias ni a la validación sin conexión.

### Secretos de firma

Secretos de Actions del repositorio:

| Secreto | Propósito |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` de Developer ID Application en Base64, con la clave privada |
| `MAC_CSC_KEY_PASSWORD` | Contraseña del `.p12` |
| `APPLE_ID` | Apple ID para la notarización |
| `APPLE_APP_SPECIFIC_PASSWORD` | Contraseña específica de app |
| `APPLE_TEAM_ID` | ID del equipo de desarrollador de Apple |

El flujo asigna el certificado a `CSC_LINK`/`CSC_KEY_PASSWORD`; las credenciales de firma solo llegan al empaquetado, no a la compilación de Next. El `GITHUB_TOKEN` integrado proporciona un `GH_TOKEN` con alcance limitado; no hace falta un token de versión aparte. No hagas nunca commit de claves, certificados, contraseñas ni ficheros de secretos de entorno.

## Procedimiento de publicación

1. Acuerda el alcance y la versión, y completa las comprobaciones pertinentes y la aceptación funcional humana. Usa el lanzamiento manual si te sirven instaladores de ensayo; un ensayo sin firmar no demuestra la firma de macOS.
2. Actualiza las versiones del paquete y del lockfile, comprueba el código fuente previsto en main y sube la etiqueta coincidente autorizada. Verifica los secretos de firma antes del empaquetado de producción para macOS.
3. Espera a que terminen **todos los jobs de sistema operativo y Verify draft release**. Revisa la etiqueta, las notas, los 11 recursos y los feeds del único borrador. Diagnostica los fallos antes de reintentar. Volver a subir sustituye los recursos con el mismo nombre; los extras obsoletos siguen haciendo fallar. Borrar recursos o versiones es una modificación, no una verificación.
4. Si editas los metadatos del borrador, incluye el **`tag_name: "v<versión>"` canónico en cada PATCH de metadatos**, aunque solo cambies el título o el cuerpo; omitirlo ya ha restablecido etiquetas en el pasado. Vuelve a leer después la etiqueta, el estado de borrador y los recursos. Corregir una etiqueta no autoriza a borrar y volver a crear una versión.
5. El propietario comprueba la compilación empaquetada según haga falta y publica explícitamente el borrador completo. Confirma los instaladores y feeds públicos y los enlaces de la web; usa una versión anterior instalada para comprobar de verdad la ruta de actualización.

Los cambios en la carcasa, los módulos nativos, el empaquetado/actualizador o Electron justifican comprobaciones específicas por plataforma: instalar/abrir, controles de ventana/arrastre/zoom, configuración/reanudación, PDF/SVG y el asistente de la demo. Las comprobaciones con datos de prueba no demuestran el funcionamiento con cuentas reales ni la calidad de las lecciones. No repitas pruebas de funcionalidades ya aceptadas sin un riesgo concreto.

## Actualizaciones y aviso a la web

Las apps empaquetadas comprueban al arrancar y, por defecto, cada 24 horas; descargan automáticamente e instalan al salir o con Reiniciar. **Ajustes → General** ofrece las notas de la versión, comprobaciones manuales, el estado y las actualizaciones automáticas. Desactivar las comprobaciones automáticas no cancela las descargas ni las instalaciones preparadas; las comprobaciones manuales siguen descargando actualizaciones. Las compilaciones de desarrollo desactivan el actualizador. Los errores van a `userData/logs/main.log`; `LH_UPDATE_FEED` es una sustitución del feed genérico solo para pruebas.

Fuentes: [`electron/main.cjs`](../electron/main.cjs), [`preload.cjs`](../electron/preload.cjs), [`update-settings.tsx`](../components/settings/update-settings.tsx).

Tras publicar una versión estable, [`notify-website.yml`](../.github/workflows/notify-website.yml) envía la etiqueta a la web usando `WEBSITE_DISPATCH_TOKEN`. Los borradores y las preversiones no lo activan. Un HTTP 204 significa que la actualización de la web quedó en cola, no que se haya desplegado ni verificado públicamente.
