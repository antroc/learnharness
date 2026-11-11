# Historial de implementación de los plugins

Planes de implementación archivados y evidencia de los puntos de control de la rama de la
funcionalidad de plugins. Estos extractos conservan la redacción, las cifras y los límites
**del momento de la verificación**; las referencias a algo «sin commit», a trabajo de
producto en pausa o a la autoridad para publicar son históricas, no el estado actual. No son
el contrato público ni un veredicto actual sobre si se puede publicar. Puede que la evidencia
temporal en `/tmp/` ya no exista. Los destinos de los enlaces de los extractos se registran
como texto, no como navegación mantenida. Usa el [mapa actual del host](../plugin-architecture.md)
y la [guía de autoría](../plugin-authoring.md) para el comportamiento actual.


## Puntos de control de la implementación del host

Fuente: `docs/plugin-architecture.md` antes de la limpieza de la documentación.

## Incrementos de la implementación y validación

1. Host de paquetes y runtime, activación, estado de gestión, carga nativa de módulos externos.
2. Activación del frontend, superficies personalizadas de vista, ajustes y acciones, y puente
   de operaciones.
3. Lectores finos de datos de aprendizaje, catálogo e inferencia, y atribución del uso.
4. Agentes gestionados locales del plugin y recuperación de la interacción tras navegar o
   reiniciar.
5. Plugins de ejemplo y pruebas sin red, prueba de un plugin externo empaquetado.
6. Documentación y tipos de autoría, plantilla y skill para agentes de programación.
7. Contribuciones nativas aditivas al agente y superficies de renderizado compartidas.
8. Tareas de resultado validadas, adaptador nativo de herramientas en segundo plano y
   entrega y recuperación duraderas.
9. Carcasa de vista del host, colocación explícita de acciones, asistentes de interfaz
   controlados, páginas de ajustes dedicadas a los plugins y presentación compartida de
   resultados plegados.
10. Admisión compartida en el host de las peticiones de workers e integración de la actividad
    de workers independientes.
11. Control selector de conocimiento que reutiliza la interfaz existente del host de cadenas y
    organización de fuentes.
12. Base compartida para toda la app de diálogos, menús, ventanas emergentes y ámbitos de
    vista, e integración del selector de plugins como modal a toda la ventana.
13. Montaje estático de Markdown del host, solo con lo integrado y sin controles auxiliares.
14. Preguntas nativas de plugins acotadas y presentación de preguntas y editores limitada a
    su propietario.
15. Intercepción nativa de envíos, imágenes explícitas del alumno y superficies sobre el
    cuerpo de la sesión: implementado y verificado en `feature/plugin-architecture`, sin
    publicar, en el punto de control aparte de 3.869 pruebas de más abajo.
16. Pulido aprobado de la presentación de la interfaz y política del selector de conocimiento
    sensible al origen: **implementado y verificado, sin commit en
    `feature/plugin-architecture`, sin publicar**, en el punto de control aparte de 3.908
    pruebas de más abajo.
17. Valores por defecto del teclado para las preguntas de plugins del host, razonamiento
    compacto y recuperación tras navegar y de la lectura canónica: **implementado y
    verificado, sin commit en `feature/plugin-architecture`, sin publicar**, en el punto de
    control aparte de 3.965 pruebas. Los puntos de control de paridad nativa de 3.925 pruebas
    y de pulido de la interfaz de 3.908 pruebas siguen siendo evidencia histórica aparte.
18. Base compartida de presentación nativa de árboles y `mountTree` controlado para plugins:
    **implementado y verificado, sin commit en `feature/plugin-architecture` sobre
    `bdd0666`, sin publicar ni instalar**, en el punto de control aparte de
    4.021 pruebas / 568 baterías (destino histórico: `plugin-tree-contract.md#verification-checkpoint--2026-11-04`).
    No incluye ninguna migración de controladores nativos, lógica de negocio ni plugins de
    producto.
19. `openSurface(surface, { signal })` generalizado sobre el cuerpo de la página, compatible
    con destinos nativos explícitos: **implementado y verificado, sin commit sobre
    `8dd7409`**. Ver la sección 12 del contrato de extensiones de sesión (destino histórico: `plugin-session-extension-contract.md#12-generalized-page-body-surfaces--implemented-and-verified`).
    No se añade ningún método nuevo, ámbito de envío nativo, instalación ni publicación.
20. `gradeAnswer` genérico para preguntas de plugins aprobado por la persona, resultado
    genérico persistido y requisito de calificación v2 congelado en el planteamiento:
    contrato aprobado descrito arriba; los puntos de control anteriores no afirman ninguna
    verificación final de runtime, compilación, empaquetado ni publicación.

La validación incluye pruebas centradas en ciclo de vida, almacenamiento e interacción,
regresiones existentes de enseñanza y práctica, comprobación de tipos y lint, compilación de
producción y una prueba de humo del servidor empaquetado con directorios desechables de
alumno y autenticación. Estas comprobaciones no necesitan registros reales de usuarios ni
cuentas de proveedores. Las flashcards completas son la futura consumidora de referencia; la
cadencia de generación, el algoritmo de repaso, la política de fuentes y de borrado, los
prompts y el resto del comportamiento de producto requieren su propia especificación
aprobada.

### Nota de implementación de la interfaz: 2026-11-01

Este incremento documenta la API aprobada de carcasa del host y colocación explícita, los
widgets controlados y el preset del compositor, el dictado exclusivo hacia un destino
explícito, las páginas de ajustes dedicadas para plugins activados con montajes de esquema o
personalizados, y el resultado plegado por defecto al estilo de la investigación y los PDF,
con un asistente reutilizable de resultado con cuerpo enriquecido y un control explícito de
la presentación del renderizador como plegado, tarjeta o sin formato. Los ejemplos
hello-plugin, managed-agent y teaching-extension consumen ahora estas API públicas. Este
alcance no añade interfaz automática en la barra lateral, escrituras en los ajustes del
núcleo, un esquema general de interfaz ni un nuevo modelo de ejecución de workers. Las copias
de ejemplo ya instaladas no se sobrescriben.

### Valores por defecto de las preguntas y recuperación tras navegar: implementado y verificado

**Implementado y verificado, sin commit en `feature/plugin-architecture`, sin publicar.**
Alcance: Enter para enviar y Shift+Enter para nueva línea del host en los editores de
plugins y en el razonamiento del host, sustituciones explícitas opcionales del editor,
Mod+Enter reservado para Enviar, la pista nativa del pie y la etiqueta `Submit answer`, el
mínimo de 40px del razonamiento elegido por la persona en todas las variantes, y una
presentación y reconexión veraces de la sincronización canónica. No incluye cambios en la
calificación, los datos guardados, el filtrado de vacíos o espacios, la forma de la API
pública ni `ctx.ui`. Los puntos de control anteriores de paridad nativa de 3.925 pruebas y de
pulido de la interfaz de 3.908 pruebas siguen siendo evidencia histórica sin cambios, no una
prueba retroactiva de este delta. El registro normativo correspondiente es el punto de
control del contrato de valores nativos por defecto y reconexión (destino histórico: `plugin-question-contract.md#14-native-default-and-reconnection-checkpoint--2026-11-03`),
aparte de la evidencia histórica de colocación de tarjetas de la sección 13.

La reproducción en desarrollo previa a la corrección falló en **10/10 retornos de montaje de
predicción o comprobación pendientes, pese a que las 162 peticiones GET devolvieron 200**. La
limpieza de StrictMode invalidaba una lectura, la reconexión podía unirse a una tarea muerta
sin propietario y una ref de identidad permanente impedía una lectura de sustitución. La
recuperación usa ahora **propiedad de las tareas por generación de conexión** y una
**lectura de reconexión en un efecto con identidad estable**, conservando las barreras de
lectura obsoleta e identidad exacta, StrictMode y la configuración existente con Cache
Components desactivado. Un estado canónico desconocido o con fallo mantiene el contenido
guardado legible y un Reintentar genuino, no un falso «no disponible» ni un Descartar de
recuperación. Los últimos hallazgos P2 independientes sobre la transcripción actual y la
publicación inicial asíncrona se cerraron restaurando las guardas originales de propiedad del
borrador y conservando las puertas canónicas de admisión del editor y de envío. No quedan
hallazgos P1/P2 confirmados.

La verificación final pasó:

- **3.965 pruebas del host / 564 baterías**, con **cero fallos, cancelaciones u omisiones**;
  comprobación de tipos, lint, compilación de producción nueva y aislada y comprobaciones
  estrictas del SDK externo.
- **62 pruebas centradas en tarjetas y frontend** y **39 pruebas de núcleo y ciclo de
  vida**, más una ejecución anterior de **90 pruebas del núcleo de sesión**. Son ejecuciones
  centradas aparte, no totales que se sumen.
- Auditoría de privacidad: **96 manifiestos NFT / 277.497 entradas, cero coincidencias con
  raíces privadas**, con **410 ficheros fuente de producción idénticos byte a byte**.
- Prueba final completa del envío nativo más prueba de navegación en producción y
  desarrollo: **20 retornos y montajes sanos, diez por modo**, sin Reintentar, error, falso
  «no disponible» ni Descartar en los retornos sanos. Las GET retenidas mantuvieron
  correctamente Preparing. La navegación ordinaria en producción ya era sana antes de la
  corrección; esta evidencia final es distinta de esa línea base de ocho ciclos con GET
  retenidas.
- Enter en un editor de código de confianza envió una predicción; Enter en el razonamiento
  de confianza envió una comprobación de enseñanza. Shift+Enter insertó saltos de línea en
  ambos. Se conservaron el código exacto, la respuesta canónica y del modelo, y los canales de
  razonamiento de lectura y de la respuesta, y una desactivación nueva del backend ejercitó
  un descarte de recuperación genuino en lugar de un falso respaldo de sincronización.
- El razonamiento nativo vacío midió **40px con texto de 16px**; tres líneas crecieron a
  **76px**, con un **máximo de 192px**. El marco contenedor creció de **109,39 → 145,39px**.
- Sin errores de página, peticiones externas, llamadas al modelo provocadas por la navegación
  ni intentos de usar el micrófono en los flujos ejercitados. La carga nativa previa a la
  selección se mantuvo inmutable: **5.535 ficheros de runtime** y **los 130 ficheros de
  plugins** eran idénticos byte a byte.
- Las comprobaciones de producto pasaron **cinco pruebas unitarias y de catálogo** más el
  escenario real de navegador de componentes en Chrome; no amplían la API del host ni el
  contrato de calificación.

Evidencia final completa nativa: `/private/tmp/lh-coding-native-7HLV1v`. Identificadores de
las ejecuciones de navegación: producción **nav-oE0g2v**, desarrollo **nav-aHcEYr**.

Las guardas de composición se ejercitaron de forma sintética, no con un IME real del sistema
operativo. La reproducción del ciclo de vida de React Activity sigue siendo solo con fixtures,
no una afirmación de que esta app de Next active Cache Components/Activity (Cache Components
es false). Estos resultados no demuestran la grabación real con micrófono, la calidad ni los
derechos de un proveedor de pago, ni el comportamiento de un instalador firmado o de una
instalación en un perfil real. No implica ningún commit, push ni publicación.

### Estado del pulido de la interfaz: 2026-11-03

**Implementado y verificado, sin commit en `feature/plugin-architecture`, sin publicar.**
Este punto de control cubre los selectores autocontenidos de 11px, el marco solo de texto
del compositor estándar con los controles inferiores fuera de él, el compositor independiente
sin adornos, las explicaciones de la galería con el tamaño de lectura configurado y los
encabezados compactos de Ajustes, las paletas de botones conservadas, el manejo síncrono de
los deslizadores, las cabeceras, tooltips y desplegables de los workers de plugins, los
diálogos accesibles de plugins sin cabecera, las superficies sobre todo el cuerpo con fondos
atenuados u opacos y el selector sensible al origen. La corrección P2 final de la vinculación
de rutas por origen modal se revisó sin incidencias. Las correcciones de preguntas que se
mantienen aparte no se incluyen ni se aprueban en este punto de control. Los registros
históricos de más abajo no cambian.

Las puertas finales pasaron:

- **3.908 pruebas de la raíz / 564 baterías, cero fallos**, incluida la última nueva
  ejecución tras limpiar; comprobaciones de TypeScript de todo el proyecto, lint y diff.
- **17 pruebas del showcase**, tipos estrictos del SDK del showcase y compilación del
  showcase.
- Una **compilación de producción de Next 16.4.3** nueva y aislada y la selección de
  `build-server`, más un consumidor externo estricto del SDK seleccionado con
  **`skipLibCheck: false`**.
- Auditoría de privacidad: **96 manifiestos NFT / 277.329 entradas, cero coincidencias con
  raíces privadas**; los **410 ficheros de producción idénticos byte a byte** entre el
  código verificado y la carga.
- Pasó la prueba ampliada nativa empaquetada de **servidor Electron-Node / Chrome**, que
  registró **223 peticiones / 217 respuestas**, nueve capturas, cero peticiones de generación
  fuera del origen o prohibidas, peticiones de micrófono, WebSockets o errores de página. El
  único endpoint de proveedor usado fue el del catálogo **`GET /v1/models`**, no inferencia.
  Los ajustes, el grafo y el código del host no cambiaron. Se explicó con precisión una
  **`GET /api/graph/sources`** cancelada; las respuestas `404` del favicon ausente y `503` del
  token de dictado sin configurar son condiciones esperadas del fixture registradas, no un
  éxito inesperado ni una afirmación de consola limpia.

Las pruebas reales en el navegador incluyeron:

- Un arrastre continuo de confianza del deslizador **52 → 44 → 36 → 26 → 16**, usando el
  mismo nodo activado con **cero mutaciones de desactivación**; interfaz de modelo de 11px,
  tokens de lectura configurados, encabezados compactos y la fila de controles fuera del
  marco de texto.
- Las **12** combinaciones terminales de estado y presentación de workers, incluidos tooltips
  reales accesibles al pasar el ratón, cabeceras solo con icono o etiqueta, chevrones
  plegados y la X nativa de fallo.
- Nombres accesibles de diálogos y superficies sin cabecera, la X flotante atenuada que se
  queda fija mientras el contenido se desplaza, límites de todo el cuerpo y barras de
  desplazamiento en el borde exterior. El fondo atenuado midió **alfa 0,8 / desenfoque de
  8px**, frente al opaco **alfa 1 / sin desenfoque**.
- **11 casos de origen y geometría del selector**, interacción con la barra lateral,
  selección controlada conservada, caducidad de la ruta y conservación del DOM, el borrador y
  el propietario exacto de la superficie de origen. La comprobación real de impactos colocó el
  selector por encima del origen; Tab, Shift+Tab y Buscar de confianza no actuaron en los
  campos de origen cubiertos, el compositor nativo ni el Buscar de la sesión. Conservar el DOM
  y el propietario no es afirmar que todo origen entre regiones pase a ser `inert` en el DOM;
  las políticas existentes de inert de modales y superficies de sesión no cambian.
- Las superficies, menús, diálogos y Ajustes anidados conservaron el contenido y el estado,
  respetaron la propiedad de un único Escape y la devolución del foco elegible, y se limpiaron
  al navegar o desactivar el plugin.

Evidencia: `/private/tmp/lh-ui-showcase-native-ssfmL3/result.json` y sus nueve capturas.
Digest del host verificado: `e5ae5cf654326c8c9615d60e70ad753f92cefd09855c5921549034c36193867c`.
El frontend del showcase compilado e instalado, de **18.421 bytes**, coincidía con el digest
`d8140d04fbb174c97450b50cde1408528e236a94f1c12fb22b130c27c90c3daa`.

El orden programático inverso (una superficie más nueva encima de un selector ya abierto en
el panel principal) solo tiene **prueba de regresión de integración en el host**, no un flujo
de usuario visible en el navegador; no se inventó ningún control de producción oculto. Las
comprobaciones de los controles de ventana de Windows/Linux simulan la geometría CSS, no los
adornos físicos del sistema operativo. Estas comprobaciones no demuestran el comportamiento
real del micrófono o el IME, de un proveedor de pago, de un instalador firmado, de una
instalación en un perfil real, de una ventana completa de Electron ni del runtime en
Windows/Linux. El seguimiento anterior de la rueda sobre prosa nativa sigue sin resolver. Esta
verificación no registra ni autoriza ningún commit, push ni publicación.

### Punto de control de verificación de las extensiones de sesión nativas: 2026-11-02

El incremento nativo de envíos, imágenes y superficies pasó **3.869 pruebas / 564
baterías**, con **cero fallos u omisiones**, TypeScript de todo el proyecto, ESLint
(**cero errores**, solo el aviso de cabecera existente en `tests/source-name-ui`) y
comprobaciones de diff. Pasaron una compilación de producción de Next nueva y aislada y el
ensamblado independiente. Pasó un consumidor externo físico y estricto del SDK con
**`skipLibCheck: false`**. El rastreo de privacidad revisó **96 manifiestos NFT / 277.077
entradas** con **cero coincidencias con raíces privadas**; los **410 ficheros fuente de
producción** eran idénticos byte a byte, con **cero ficheros ausentes o distintos**. Este
incremento está implementado y verificado en `feature/plugin-architecture`, sin publicar.
Una ejecución nueva posterior volvió a pasar las **3.869 pruebas** completas, más **47
pruebas de flashcards**; estos resultados no amplían el contrato de extensiones del host ni
demuestran que el producto esté listo para publicarse. La persona autorizó por separado
hacer commit de todos los cambios y preparar la rama para que hiciera push una persona; no se
autoriza ningún push ni publicación por parte del agente. La evidencia histórica de **3.778
pruebas de preguntas** y de **3.681 pruebas de Markdown** de más abajo se conserva aparte.

El escenario final empaquetado de **servidor Electron-Node y Chrome** pasó **23 grupos de
aserciones**, con **cero errores de página**, **cero peticiones externas bloqueadas** y
**cero respuestas HTTP inesperadas**. Las pruebas reales de la API nueva incluyeron:

- Bytes de imagen reales de Canvas guardados y decodificados desde el `image_url` del
  proveedor, no adjuntos solo con metadatos; la actualización de la entrada pendiente
  habilitó el envío solo con imagen.
- Un interceptor que falló dejó el recuento de POST en **3 → 3**, el de aceptaciones en
  **0** y el borrador conservado. Una cadena JSON literal del plugin que contenía código
  conservó separados los canales de imagen de la respuesta, del razonamiento y de lectura.
- El reintento nativo del modelo dejó el recuento de hooks en **6 → 6**, sin volver a
  ejecutar las callbacks de aceptación. Un `problem` de práctica real aceptó razonamiento con
  texto vacío e imágenes a través de su marca y de la proyección al proveedor. Una ruta
  `.png` siguió siendo texto, no entrada de imagen.
- Límites, título y X exactos del cuerpo de la sesión, DOM de una superficie montada anidada,
  comportamiento de Ajustes y de un único Escape, y rechazo de destinos caducados al navegar.

La recalificación integrada tras el barajado determinista o la selección inicial pendiente,
y el respaldo ante el **409** de una reorientación real con el sistema ocupado con una sola
invocación del hook, tienen **prueba unitaria** centrada, no prueba en el navegador. La
integración encontró un duplicado P2 entre la vista previa en bruto y el canónico normalizado
antes de la confirmación. La corrección aprobada por la persona conserva las vistas previas
instantáneas, aplaza la adopción canónica mientras dura el POST propietario y después hace
una lectura canónica nueva ante éxito, rechazo o confirmación perdida, conservando los
borradores sin observadores supuestos. **Once regresiones causales permanentes** cubren la
corrección; la auditoría independiente del delta salió limpia.

Registro final del navegador: `/tmp/lh-session-browser-7.log`. Evidencia:
`/var/folders/3x/m0pk52v160jcprrhcb6qkd340000gn/T/lh-plugin-browser-evidence-8jOHFr/plugin-browser-evidence.json`.
Estas pruebas con fixtures y loopback no demuestran la calidad ni los derechos de un
proveedor real, la interacción real con el micrófono o el IME del sistema operativo, el
comportamiento de un instalador firmado, una ejecución en una ventana completa de Electron
ni el runtime en Windows/Linux. El seguimiento registrado anteriormente de la rueda sobre
prosa nativa en la arquitectura (destino histórico: `architecture.md#10-verification-seams`)
sigue sin resolver; este punto de control no afirma haberlo corregido. Los anclajes de
interfaz más amplios, los hooks de contexto y el envío nativo siguen aplazados.

### Punto de control de verificación de las preguntas de plugins: 2026-11-02

La implementación acotada v1 del host pasó **3.778 pruebas / 560 baterías**, con **cero
fallos u omisiones**, TypeScript global, ESLint (**cero errores**, un aviso de cabecera
preexistente en `tests/source-name-ui.test.tsx:27`) y comprobaciones de diff. Tras tres
correcciones P2, pasaron comprobaciones independientes de **201 del backend** y **126 del
frontend** más **tres reproducciones causales sin cambios**; no quedan hallazgos P1/P2
confirmados. Este incremento del host está implementado y verificado en
`feature/plugin-architecture`, sin publicar; el punto de control de migración `792671e` y el
**punto de control de Markdown de 3.681 pruebas** de más abajo siguen siendo evidencia
histórica aparte. Los dos productos siguen en pausa, sin añadir evaluación, formularios
genéricos ni alcance de instalador.

Pasaron una compilación de producción de Next nueva y aislada y el ensamblado del servidor.
El **consumidor externo estricto del SDK empaquetado** pasó con **skipLibCheck false**,
NodeNext, ES2022 y DOM, cubriendo definiciones y renderizadores de preguntas tipados, las
capacidades rechazadas de pendiente genérico y envío desde el frontend, el selector y
Markdown. El rastreo de privacidad revisó **96 manifiestos NFT / 275.228 entradas**, con
**cero coincidencias con raíces privadas**; los **401 ficheros fuente de producción** eran
idénticos byte a byte desde el checkout hasta el código aislado y la carga, sin ficheros
ausentes ni distintos. Las comprobaciones de la carga de documentos de autoría pasaron **11
pruebas**, incluido el destino del enlace al contrato de preguntas.

El navegador empaquetado usó un **servidor Electron-Node, el Chrome del sistema, un plugin
externo público y un simulador en loopback** aislados. Ejercitó un planteamiento de
predicción nativo con mezcla de inválidos y válidos, la adopción canónica del editor, la
respuesta literal más el razonamiento del host por separado y la revisión ordinaria del
profesor; plegado y selección de confianza, Tab, nueva línea y Mod+Enter; ReadingThinking y
revelado de la comprobación y el micrófono visible desactivado con showThinking a false; el
respaldo al desactivar el backend y el descarte nativo ligado a la identidad sin un turno
nuevo. También pasaron las aserciones existentes de Markdown, superposiciones, entrada
numérica nativa y admisión. CDP confirmó que **los tres streams SSE llegaron a `[DONE]`**; las
entradas terminales `ERR_ABORTED` correspondientes se explicaron con precisión para esos
streams completados, sin tratarlas como un éxito general del transporte. Hubo **cero errores
de página o peticiones fuera del origen** en el flujo ejercitado. La captura real con el
micrófono del sistema operativo y la interacción con el IME **no se afirman como pruebas en
el navegador**; las pruebas causales centradas cubren el STT final, el IME, la sustitución y
las rutas de propiedad relacionadas. Consulta el contrato de preguntas de referencia (destino
histórico: `plugin-question-contract.md`) para el alcance y los límites de la verificación.

Artefactos: `/tmp/lh-question-final-gates-Q7Hu4L/*-v3.log`;
`/tmp/lh-question-isolated-package-MH6M2n/build-v3.log`, `final-sdk-v3.log`,
`final-payload-audit.json` y `browser-v3-script-reading-field.log`; evidencia del navegador
`/var/folders/3x/m0pk52v160jcprrhcb6qkd340000gn/T/lh-plugin-browser-evidence-20Ls0y`.
Son pruebas con fixtures y de runtime, no garantías de calidad o derechos de un proveedor
real, de instalador firmado, de ventana completa de Electron ni del runtime en Windows/Linux.

### Verificación final del Markdown estático: 2026-11-02

Es el punto de control histórico de Markdown anterior a las preguntas, no la verificación de
las preguntas v1. La implementación aditiva de Markdown pasó **3.681 pruebas / 555
baterías**, **cuatro pruebas de ejemplos**, comprobaciones de TypeScript acotadas y completas,
lint completo (solo el aviso histórico de falta de cabecera) y comprobaciones de diff. La
revisión independiente P1/P2 no encontró nada; pasaron **107 pruebas centradas**. Pasaron una
compilación de producción nueva y aislada y el escenario completo del navegador empaquetado.
El consumidor estricto del SDK empaquetado compiló **sin `skipLibCheck`**, ejercitando el
nuevo montaje, la actualización y liberación y los errores de tipos esperados. Los **393
ficheros de producción** eran idénticos byte a byte entre el checkout, el código aislado y la
carga independiente; **96 trazas NFT / 273.716 entradas** contenían **cero coincidencias con
raíces privadas**.

Las comprobaciones reales de la API nueva en el navegador, tanto en una vista de plugin como
en un diálogo público, verificaron SVG de Mermaid, matemáticas, tokens resaltados, tablas,
destacados y una imagen local. Los contadores de bloques de código registrados por plugins no
cambiaron, no había controles auxiliares, y un Mermaid no válido mostró directamente su
encabezado y mensaje de error y su código. Las comprobaciones cubrieron retirar un diagrama
pendiente a texto normal, volver a actualizarlo a diagrama, la conservación de los centinelas
al abortar, liberar y volver a montar, la limpieza al navegar o desactivar y las
actualizaciones confirmadas de los ajustes de prosa. La navegación real a una pestaña nueva
llegó a la URL esperada dejando intacta la página original, sin un modal de seguridad de
enlaces; se corrigió el fixture para que coincidiera con el comportamiento de enlaces
existente del host, sin necesidad de corrección en producción ni de cambios en la API o la
experiencia de uso.

La misma ejecución empaquetada pasó las comprobaciones existentes del selector y de
renombrado, carpetas y arrastre de fuentes, padres anidados pintados o inert, Escape en
tooltips pasivos, conservación del `1e` nativo incompleto, canónicos `3.0 → 3` / `-5 → 12` y
regresiones de admisión. Los artefactos locales de empaquetado y del navegador están en
`/tmp/lh-markdown-isolated-package-6sHn16`, incluidos `browser-retest.log` y la evidencia del
navegador `lh-plugin-browser-evidence-bX4qCm`. Esto no demuestra el comportamiento de un
instalador firmado o notarizado, una ejecución en ventana completa de Electron, el runtime en
Windows/Linux ni la generación con un proveedor real. El punto de control de migración
`792671e` de **3.665 pruebas** de más abajo sigue siendo evidencia histórica aparte, no la
verificación de la API de Markdown posterior.

### Verificación final histórica de la interacción compartida: 2026-11-02

El contrato aprobado (destino histórico: `dialog-overlay-contract.md`) lo implementa la base
compartida de modales, menús y ventanas emergentes, teclado y ámbitos de vista, que sustituye
al coordinador provisional del selector con padre oculto y a la cancelación incondicional del
selector cuando había cualquier Ajustes abierto.

En el punto de control de migración `792671e`, la verificación del código pasó **3.665 / 3.665
pruebas en 555 baterías** con HOME, datos y autenticación nuevos, **cuatro pruebas de
ejemplos**, la compilación del consumidor estricto del SDK empaquetado **sin
`skipLibCheck`**, comprobación de tipos, ESLint (solo el aviso existente de falta de
cabecera) y comprobaciones de diff. La compilación final de producción aislada, incluidas las
últimas correcciones de tooltips, y la prueba de humo completa sin código fuente pasaron con
**el Node incluido en Electron y Chrome real**. La auditoría de privacidad de **96 trazas NFT /
273.464 entradas** encontró **cero raíces privadas**; los **392 ficheros de
app/components/src/lib** eran idénticos byte a byte desde el checkout hasta el código aislado
y la carga independiente.

La evidencia del navegador cubre el selector a toda la ventana, el renombrado de fuentes, la
creación de carpetas y el arrastre, los padres anidados pintados o inert y el retorno y los
enlaces profundos protegidos a la instancia única de Ajustes. Un tooltip pasivo Cerrar
propiedad de un modal se pintaba encima de Ajustes y, aun así, un único Escape cerró Ajustes;
del mismo modo, un tooltip de menú con el foco dejó que un único Escape cerrara solo el menú.
La inspección del viewport de edición nativo de Chromium demostró que el **`1e`** incompleto
visible se conservaba antes y después de Escape en Agente y Apariencia, sin escrituras no
válidas y sin necesidad de cambiar el tipo de entrada o el selector numérico ni de un
respaldo humano. También pasó la normalización canónica existente específica de cada campo
(**`3.0 → 3`** y **`-5 → 12`**). La regresión de admisión ejercitó **1 → 2 → 1**, la
reducción FIFO y en vivo y la cancelación con FIN desde el panel con **cero respuestas
simuladas completadas**, no generación con un proveedor de pago ni con un modelo real.

Artefactos locales: pruebas en `/tmp/lh-overlay-final-suite-kS7nJV`; registro del navegador
empaquetado `/tmp/lh-overlay-isolated-package-tq6SQm/final-browser.log`, evidencia
`evidence-A6JwY3`. Estos resultados no demuestran el comportamiento de un instalador firmado o
notarizado, una ejecución en ventana completa de Electron, el runtime en Windows/Linux ni la
inferencia con un proveedor real. Los puntos de control más antiguos de más abajo siguen
siendo evidencia histórica aparte; ninguno de ellos verifica la API posterior de Markdown
estático.

### Punto de control histórico del selector en vista ordinaria: 3.530 pruebas

El punto de control del selector en vista ordinaria pasó **3.530 pruebas**, comprobaciones en
un navegador real empaquetado que incluían el renombrado de fuentes, la creación de carpetas y
la organización por arrastre, las comprobaciones completas de admisión y la comprobación del
consumidor del SDK. Es evidencia histórica, no la verificación del selector modal actual a
toda la ventana ni de la migración de la interacción en toda la app.

El punto de control de trabajo en curso `2c44868`, pedido por la persona, registró **3.559
pruebas** antes de esta migración. Incluye el experimento provisional de primer plano y no es
la prueba final de la migración.

### Punto de control histórico de verificación de la admisión y la actividad de workers: 2026-11-01

El incremento de admisión y actividad pasó **3.513 pruebas / 552 baterías** con el ejecutor
de pruebas por defecto, más **cuatro pruebas aparte de la interfaz de ejemplos**,
comprobación de tipos y lint (cero errores; un aviso preexistente que ya estaba en HEAD).
Pasaron la compilación de producción de una copia aislada del código, el ensamblado de la
carga del servidor y la prueba de humo sin código fuente con el Node incluido en Electron y
Chrome local. El rastreo de centinelas privados inertes encontró **cero** centinelas
privados; la carga ensamblada no contenía registros privados.

El navegador ejercitó el control numérico real de Ajustes → Agente: **1 → 2 → 1**, con cada
valor guardado. Aparecieron tres tareas independientes de `ctx.workers` en Agentes en segundo
plano, sin enlaces a chats. La ejecución verificó el aumento en vivo y la admisión FIFO;
reducir el límite dejó en marcha dos peticiones activas. Las cancelaciones con FIN vaciaron el
recuento de activas **2 → 1 → 1 → 0**: la tercera petición se admitió después de que la
segunda cancelación liberara capacidad, y las tres tareas acabaron canceladas. El endpoint
simulado de OpenAI en loopback recibió **tres peticiones de protocolo retenidas**, con **cero
respuestas completadas**. No fue generación con un modelo real, ni una llamada a un proveedor
de pago, ni inferencia con una cuenta real. A diferencia de las comprobaciones históricas en
el navegador solo de renderizado de más abajo, esta comprobación de admisión sí envió esas
tres peticiones de protocolo simuladas locales.

Una reproducción P2 de un revisor confirmó que abortar en el momento de la construcción había
sustituido el uso nativo **7** por **0**. Fallaba antes de la corrección; después, la misma
reproducción pasó, conservando el uso nativo **7** y la identidad sin filtrar ningún permiso.
La prueba del bloqueo de auditoría de la canalización de extracción real también fallaba
antes de la corrección del que espera en medio cancelado y pasó después.

Artefactos locales de verificación (rutas temporales):

- Pruebas: `/tmp/lh-admission-verified-tests-bfXAdL/tests.log`.
- Empaquetado aislado: `/tmp/lh-admission-isolated-package-ovfxV0/final-package.log`.
- Evidencia del navegador: `/var/folders/3x/m0pk52v160jcprrhcb6qkd340000gn/T/lh-plugin-browser-evidence-dVX3ym`.

Estos resultados no demuestran el comportamiento de un instalador firmado o notarizado, una
ejecución en ventana completa de Electron, el runtime en Windows/Linux ni la inferencia con
un proveedor real.

### Verificación histórica de la implementación: hasta el punto de control `968ceaa`

Los resultados que siguen registran puntos de control anteriores, incluido el punto de
control de la interfaz `968ceaa`. Son evidencia histórica, **no la verificación del
incremento de admisión y actividad**; los resultados propios de ese incremento están
registrados arriba.

El incremento de la interfaz pasó **3.465 pruebas / 552 baterías** con el ejecutor de pruebas
por defecto, más las cuatro pruebas independientes de la interfaz de ejemplos, comprobación de
tipos y lint (cero errores; el mismo aviso existente de `source-name-ui`). Pasaron su
compilación de producción, la selección de la carga y la prueba de humo sin código fuente con
el Node incluido y Chrome. Las comprobaciones en el navegador cubren la tipografía exacta de
los títulos de sesión y de plugin, las colocaciones explícitas, el scroll por filas de la
barra lateral con más de diez botones, el scroll de la barra del grafo con la barra lateral
abierta o cerrada y el paso del puntero entre botones, el desbordamiento de la barra superior
accesible por teclado, el atajo controlado del compositor y del modelo, los diálogos, los
engranajes de ajustes de los plugins y las actualizaciones de esquema, los valores por defecto
de los renderizadores y la limpieza al desactivar. Un consumidor estricto de TypeScript
también compiló contra el SDK neutral respecto al framework que se generó.

La verificación final de la batería sacó a la luz un error de aislamiento de pruebas
preexistente: el barrido de recuperación de la prueba de herramientas en segundo plano podía
entregar una tarea pendiente de otro proceso de pruebas desde almacenes compartidos en disco.
Un HEAD limpio anterior a la interfaz lo reproducía; una traza de escrituras entre procesos
identificó la entrega ajena. Ahora esa prueba reserva almacenamiento privado antes de importar
los módulos de la aplicación y lo elimina al terminar. No se cambió ningún planificador ni
tiempo de espera de producción.

El punto de control inicial del host (antes de las contribuciones aditivas y los workers) pasó
**2.229 pruebas** (**468 baterías**, sin fallos ni omisiones), junto con `npm run typecheck`,
`npm run lint` y la compilación de producción de Next. `tests/plugin-integration.test.ts`
ejercita un backend externo nativo a través del host real, el adaptador de inferencia, el
bucle del Agent gestionado y el almacén local del plugin, incluida la entrada persistida tras
desactivar y volver a activar, las respuestas validadas, la publicación al terminar la
ejecución, los reintentos idempotentes y la atribución del uso.

El punto de control ampliado de instrucciones, herramientas, renderizadores y workers pasó
**2.342 pruebas** (**479 baterías**, sin fallos ni omisiones), comprobación de tipos, lint y
la compilación de producción. `tests/plugin-teaching-integration.test.ts` lleva el ejemplo
teaching-extension a través de la ejecución nativa de herramientas, el envío validado de
workers, la entrega aparte de resultados, la proyección y persistencia en la transcripción y
la contabilidad del uso, sin peticiones a proveedores. Las pruebas de workers y del puente
cubren la interrupción, los resultados duraderos de aceptar uno solo, la cancelación antes del
despacho, los fallos del formateador y la recuperación sin volver a ejecutar herramientas.

La integración con main **v0.4.1** (`e69e852`) pasó **3.410 pruebas / 546 baterías** sin
fallos ni omisiones, comprobación de tipos y lint (cero errores; un aviso existente en
`tests/source-name-ui.test.tsx`). También pasaron la compilación de producción, la selección
de la carga y la prueba de humo sin código fuente con Electron y Chrome. La fusión conserva
el ciclo de vida independiente de cálculo y entrega de main, las herramientas que conocen el
modelo, las puertas de proveedores y las capturas de diagnóstico por rol del núcleo con
nombre, junto con las contribuciones de plugins y los puntos de control esperados de los
workers nativos. Los workers de plugins sin ámbito no adquieren un rol de captura de
diagnóstico inventado.

La verificación del empaquetado reveló que Next 16.3.2 rastrea algunos productores de rutas
de runtime incluso sin lecturas de ficheros, y que la instrumentación no hereda las
exclusiones de rastreo a nivel de ruta. Ahora, unas exclusiones por expresión hechas solo con
comentarios mantienen las rutas modificables de datos, autenticación y depuración fuera de la
carga, conservando los prompts incluidos. Compilaciones desechables controladas comprobaron
centinelas independientes de chats, grafo, ajustes, tareas, sustituciones y autenticación;
`tests/runtime-path-tracing.test.ts` fija los límites de código identificados. La
integración con main además expuso al rastreo los datos de plugins instalados: los
directorios de runtime de plugins y servicios, los nombres de fichero del uso de inferencia,
los dos productores de directorios de tareas de recuperación y las rutas de captura en
segundo plano de main llevan ahora exclusiones por expresión. Compilaciones independientes de
copias inertes con Next 16.4.3 confirmaron que la unión del uso y **cada** unión de directorio
de tareas volvían a introducir por separado centinelas privados cuando se dejaban sin anotar;
en conjunto, las exclusiones los eliminaron conservando los prompts incluidos. Las
comprobaciones existentes de rechazo de datos y secretos en la carga de producción no cambian
y se ejecutan antes de ensamblar el SDK de plugins. Siguen dos avisos existentes de rastreo
amplio solo de rutas (el lanzamiento del navegador sin interfaz y la ruta de descarga de
PDF); no es una afirmación de compilación sin avisos.

Después de `node scripts/build-server.mjs`, pasó la comprobación ampliada sin código fuente
`node scripts/smoke-server.mjs --electron --isolated --browser`. Copia la carga independiente
fuera del checkout, rechaza las importaciones que se salgan de esa carga o del directorio de
plugins del fixture, arranca con el Node incluido en Electron y lleva Chrome local por la
activación en Ajustes, la navegación por la barra lateral, los módulos ES nativos y recursos
relativos, el RPC del backend, el desmontaje y remontaje de vistas y la desactivación. El
historial nativo sembrado también verifica los renderizadores compartidos de bloques
delimitados y de herramientas, la presentación posterior de resultados de workers y los
respaldos legibles en bruto tras la desactivación; esas comprobaciones en el navegador no
hacen llamadas al modelo. Todos los datos y la autenticación del fixture son desechables; la
inicialización del adaptador de proveedores es sin conexión. La evidencia del navegador
conserva el `503` esperado del dictado sin clave y el `404` del favicon ausente, aparte de los
fallos de plugins.

No son afirmaciones de una prueba de instalador firmado o notarizado, de una prueba en
ventana completa de Electron, de inferencia con una cuenta real ni de pruebas del runtime en
Windows/Linux. El comportamiento del fsync de directorios en Windows se prueba a través de la
juntura de plataforma y E/S inyectada del instalador; su limitación de recuperación
documentada sigue en pie. Este cambio no publica ninguna funcionalidad completa de
flashcards.


## Puntos de control de las preguntas de enseñanza

Fuente: `docs/plugin-question-contract.md` antes de la limpieza de la documentación.

## 11. Secuencia de implementación y verificación

1. Añadir los contratos públicos, la validación del registro, los lectores puros de instantáneas y respuestas y las pruebas de identidad.
2. Construir las herramientas de preguntas aceptadas por turno, el registro de planteamientos, la supresión y clasificación en el stream y la autoridad canónica asentada.
3. Añadir el envío, el descarte y la compatibilidad canónicos y la conciliación terminal; integrar los asistentes de pendientes, historial, modelo, despertar, fase y posición.
4. Añadir los registros del frontend limitados al propietario y los montajes hermanos de tarjeta, editor y respondida, la integración privada de teclado y foco y el enrutamiento del dictado del host.
5. Documentar la API y el ciclo de vida, añadir comprobaciones estrictas del consumidor del SDK y fixtures desechables, y hacer una revisión independiente.

Pruebas obligatorias:
- Planteamiento nativo validado frente a escritura fallida; lotes mixtos; todos los portadores de confirmación temporal; comportamiento ordinario e integrado sin cambios; metadatos eliminados de la entrada del modelo.
- Identidad exacta de la aparición, ID duplicados históricos, argumentos normalizados, autoridad del esquema congelado, significado de las referencias locales al incrustarse en la carga nativa, cadenas JSON finitas y literales y respuestas false/cero/null/vacías.
- Rechazo de envíos duplicados u obsoletos y de rodeos por rutas heredadas alternativas; escritura antes de la continuación; renderizadores no disponibles, desactivados, ausentes o fallidos; incompatibilidad explícita; sin cancelación automática ante cambios de revisión o número; cancelación o descarte silenciosos sin turno; los protocolos ilegibles con identidad insuficiente no deben provocar una cancelación supuesta.
- Evento global de asentamiento perdido, adopción canónica esperada, reintento solo de conciliación, autoridad de pendientes al recargar o reanudar.
- Estabilidad del editor controlado, plegado, montaje y liberación asíncronos, callbacks obsoletas, foco de campo, Tab/Enter/Escape al editar, atajos del host, IME y ámbitos cubiertos.
- Fragmentos finales de dictado antes de revelar o enviar, separación entre lectura y razonamiento, enrutamiento opcional a la respuesta, micrófono visible desactivado y sin escrituras en un compositor oculto.
- Prueba real en el navegador empaquetado mediante un plugin desechable y un proveedor simulado en loopback con turnos nativos; no hacen falta cuentas reales ni la implementación de un plugin de producto.
- Batería completa de pruebas y ejemplos, comprobación de tipos, lint y diff, consumidor estricto del SDK empaquetado, compilación de producción aislada, Electron/Chromium empaquetado, privacidad y rastreo y auditoría de los bytes de producción.

Conserva el incremento de Markdown verificado y las rutas de producto de los compañeros. La aprobación de la implementación por sí sola no autorizaba preparar ni hacer commit; después la persona autorizó hacer commit del punto de control de la rama de la funcionalidad. No implica ningún push, publicación ni reanudación del producto.

## 12. Punto de control de la implementación verificada: 2026-11-02

- **Pasaron 3.778 pruebas / 560 baterías**, sin fallos ni omisiones. Pasaron la comprobación de tipos de todo el proyecto y las comprobaciones de diff. ESLint no informó de errores y sí de un aviso preexistente de `<head>` en `source-name-ui`.
- La revisión independiente del backend y el núcleo no encontró P1/P2 confirmados. La revisión del frontend identificó tres defectos de orden y recuperación; se corrigieron todos, sus tres reproductores causales sin cambios pasaron y la ejecución final centrada en el frontend de 126 pruebas pasó sin más P1/P2 confirmados.
- Pasaron una compilación aislada de Next.js nueva y limpia de credenciales y la selección independiente. Un consumidor estricto aparte compiló el SDK seleccionado real con `skipLibCheck: false`, incluidos los registros de preguntas, las definiciones tipadas de carga y respuesta y las ranuras de renderizado, las API existentes de selector y Markdown, y comprobaciones negativas de las API excluidas.
- Los **96 manifiestos de rastreo / 275.228 entradas** tuvieron **cero coincidencias con raíces privadas**. Los **401 ficheros de producción** de `app`, `components`, `src` y `lib` eran idénticos byte a byte entre el código de trabajo, el código de la compilación aislada y la carga, sin copias ausentes ni discrepancias.
- El servidor empaquetado se ejecutó con el runtime de Node de Electron fuera del checkout y pasó la prueba de humo en vivo con Chrome con un plugin externo público y un proveedor simulado solo en loopback. Turnos nativos genuinos demostraron el planteamiento mixto de predicciones fallidas y correctas, la admisión canónica del editor, los espacios exactos de la respuesta y el razonamiento del host por separado, la revisión ordinaria del profesor, la conservación natural del plegado, el montaje y la selección, Tab y saltos de línea al editar y Mod+Enter del host, la lectura y revelado de la comprobación, un micrófono visible desactivado sin habilitar el dictado de la respuesta, el respaldo con el plugin desactivado y el descarte silencioso ligado a la aparición. También pasaron las comprobaciones existentes de Markdown, superposiciones, entrada numérica nativa y admisión.
- CDP capturó los tres streams de preguntas hasta `[DONE]`; solo se clasificaron como esperadas las cancelaciones terminales HTTP-200 que coincidían exactamente. No hubo errores de página ni peticiones fuera del origen. La entrega final del STT, el IME/229 y el comportamiento con renderizadores ausentes o sustituidos tienen cobertura causal centrada; no es una afirmación de captura real con micrófono ni de verificación del IME del sistema operativo.

Evidencia: `/tmp/lh-question-final-gates-Q7Hu4L/`; paquete aislado y registros de compilación, SDK, carga y navegador en `/tmp/lh-question-isolated-package-MH6M2n/`; capturas del navegador y `plugin-browser-evidence.json` en `/var/folders/3x/m0pk52v160jcprrhcb6qkd340000gn/T/lh-plugin-browser-evidence-20Ls0y/`.

Seguimiento observado, sin cambios: las ruedas hacia arriba de confianza sobre un envoltorio de prosa ordinario de la transcripción no movían la transcripción, mientras que sobre su margen en blanco sí lo hacían y plegaban el dock de forma natural. No se identificó ninguna superficie que reclamara la rueda intencionadamente; la causa, y si esto ya existía antes o depende del estado de la pregunta, siguen sin resolverse causalmente. La prueba en el navegador usa la interacción que funciona sobre el margen en blanco y no demuestra que todos los destinos de rueda de la transcripción se comporten correctamente.

## 13. Punto de control de paridad nativa de las tarjetas de preguntas: 2026-11-03

La persona aprobó una corrección acotada de la presentación tras revisar las preguntas de programación: marco nativo del campo de razonamiento pendiente; descarte solo de recuperación; razonamiento de lectura encima de la tarjeta enviada y razonamiento de la respuesta dentro. La persona rechazó explícitamente añadir reglas para omitir lo vacío o con solo espacios. Estos cambios están **implementados y verificados, sin commit en `feature/plugin-architecture`, sin publicar**. Las primitivas compartidas de `ctx.ui`, las API de plugins, los envoltorios guardados, la calificación, los manejadores de teclas del editor y el enrutamiento del dictado no cambian.

- **Pasaron 3.925 pruebas / 564 baterías**, sin fallos, cancelaciones ni omisiones. La ejecución centrada en el dock y la transcripción pasó **27 pruebas**, que cubren todas las rutas de recuperación, los estados sanos y de disponibilidad canónica, el estilo del marco nativo, el comportamiento conservado del teclado y las refs, los canales definidos vacíos o con espacios, la colocación y expansión nativas, los canales solo de imagen, el texto e imágenes combinados y el aislamiento de las ranuras de renderizado. Pasaron la comprobación de tipos, el lint y el diff de todo el proyecto; el lint solo tiene el aviso existente de `<head>` del fixture de pruebas.
- Pasaron una compilación de producción e independiente nueva y aislada y un consumidor estricto del SDK recién seleccionado (`skipLibCheck: false`). **96 manifiestos de rastreo / 277.413 entradas / cero coincidencias con raíces privadas**; **410 ficheros de producción** eran idénticos entre el código de trabajo, el código aislado y la carga. La revisión independiente de solo lectura no encontró P1/P2 confirmados en el delta de producción de tres ficheros.
- La prueba ampliada empaquetada del plugin público de programación pasó usando el runtime de Node de Electron y Chrome, datos desechables, el plugin de programación compilado sin cambios y un proveedor solo en loopback. Ahora **envía** de verdad una comprobación de enseñanza, en lugar de quedarse en el revelado. El código exacto, el razonamiento de lectura y el razonamiento de la respuesta se conservaron en el POST, en el resultado canónico y en la siguiente petición del profesor. Las comprobaciones del DOM nativo demostraron la lectura encima y abierta por defecto y el razonamiento de la respuesta dentro, con inCard y cerrado por defecto, y clics de confianza que mostraban el texto exacto. La conservación de vacíos y espacios definidos y la disposición de las imágenes tienen regresiones sin conexión aparte.
- Los campos pendientes coincidían con las clases nativas canónicas y con los estilos calculados de fondo y borde; las preguntas sanas no mostraban Descartar. Una segunda comprobación nueva usó una aparición única y después la desactivación del backend conservó las dos respuestas anteriores y mostró solo el descarte de recuperación. El descarte canceló solo esa comprobación pendiente sin otra respuesta, POST de chat, turno ni petición al proveedor. Se completaron las **cinco fases esperadas de petición y stream en loopback**; no hubo errores de página, peticiones fuera del origen ni intentos de usar el micrófono. La carga verificada se mantuvo idéntica byte a byte durante la prueba.

Evidencia: `/tmp/lh-question-cards-tests-final.log`, `/tmp/lh-question-cards-build.log`, `/tmp/lh-question-cards-sdk-strict.log`, `/tmp/lh-question-cards-isolated-package-NUCzsG/` y `/private/tmp/lh-coding-native-3tz94a/evidence.json` con capturas de pendiente, enviada y recuperación. No se afirma nada sobre un perfil de alumno real, un proveedor de pago, grabación con micrófono, IME del sistema operativo, ejecución de código, preparación ni commit. El seguimiento anterior de la rueda sobre la prosa queda fuera de esta corrección.

## 14. Punto de control de valores nativos por defecto y reconexión: 2026-11-03

El incremento posterior aprobado por la persona está **implementado y verificado, sin commit en `feature/plugin-architecture`, sin publicar**. Sustituye los valores por defecto anteriores de Enter para editar y nueva línea en el razonamiento del host y el mínimo del razonamiento del plugin dimensionado por fase, no la colocación conservada de los canales de razonamiento ni las reglas de vacíos o espacios definidos.

- Los valores por defecto del host dan ahora **Enter para enviar / Shift+Enter para nueva línea** tanto en los editores de respuesta de los plugins como en el razonamiento del host; Mod+Enter sigue reservado para el envío del host. Siguen siendo posibles las sustituciones explícitas opcionales de edición del plugin. El plugin de programación ya no sustituye el Enter simple; conserva el sangrado con Tab y Shift+Enter. El pie nativo dice `↵ submits · ⇧↵ newline` y `Submit answer`. El razonamiento tiene un **mínimo compacto de 40px en todas las variantes**, con crecimiento natural.
- El error de navegación del que se informó se reprodujo en un navegador desechable de **desarrollo de Next** en los **10 retornos o montajes de preguntas pendientes**, pese a **162 respuestas de sesión HTTP-200 correctas**. Fixtures reales de hooks y modelo de React identificaron la lectura invalidada por la limpieza, la eliminación de duplicados de tareas obsoletas con propietario nulo y la puerta de identidad de un solo uso conservada. La navegación ordinaria en producción previa a la corrección seguía sana; la reconexión de Activity se demuestra aparte con fixtures de React, sin atribuirla a la configuración actual de Next.
- La conciliación delimita ahora la propiedad de las tareas por generación de conexión además de por propietario consumidor. Un efecto de identidad estable inicia una sincronización nueva al reconectar. Las barreras canónicas de época y ticket y el Reintentar manual o ante fallo genuino siguen intactos; no se genera ningún turno de profesor de sustitución. La autoridad desconocida se muestra como en preparación, no como no disponibilidad confirmada ni como un estado de Descartar de recuperación desactivado.
- **Pasaron 3.965 pruebas / 564 baterías**, sin fallos, cancelaciones ni omisiones. La cobertura centrada en tarjetas y frontend pasó **62 pruebas**; las regresiones de ciclo de vida y núcleo demuestran además la repetición de StrictMode, Activity oculta o revelada, la sustitución con propietario nulo, el orden de éxitos y fallos obsoletos, los borradores conservados y el Reintentar de solo lectura ante un error real. Pasaron la comprobación de tipos, el lint, las comprobaciones de diff, una compilación de producción e independiente nueva y aislada y un consumidor estricto del SDK recién seleccionado (`skipLibCheck: false`). Siguen el aviso de lint existente de `<head>` del fixture de pruebas y dos avisos de compilación de rastreo dinámico del sistema de ficheros.
- La revisión de solo lectura detectó y cerró una regresión transitoria de la implementación: las comprobaciones de disponibilidad habían descartado finalizaciones legítimas de la transcripción del propietario actual y publicaciones iniciales asíncronas del editor. Se restauran las salvaguardas originales de propiedad de la entrega del borrador mientras la interacción del usuario sigue inactiva y el envío sigue condicionado canónicamente. Las pruebas causales cubren las dos ventanas temporales de la transcripción, el razonamiento del host, la primera publicación asíncrona, la conservación exactamente una vez, la ausencia de repeticiones o reversiones y el rechazo continuado de propietarios obsoletos o revocados. La revisión de cierre independiente no encontró P1/P2 confirmados pendientes. No es una verificación real del micrófono.
- La prueba final empaquetada pasó un **Enter simple real desde el código** para la predicción y un **Enter simple real desde el razonamiento del host** para enviar una comprobación de enseñanza, saltos de línea reales con Shift+Enter, sondeos sintéticos de las guardas de composición/229, datos exactos de respuesta, lectura y razonamiento multilínea en el envoltorio canónico y en la siguiente petición del profesor en loopback, colocación y valores por defecto nativos de la tarjeta respondida y la recuperación y el descarte silencioso nuevos con el plugin desactivado.
- La navegación final en el navegador en producción **y** en desarrollo pasó cada una **10 retornos o montajes sanos**, incluidos montajes con documento nuevo y lecturas canónicas retenidas: **sin clics en Reintentar, errores de sincronización falsos, estado falso de no disponible, Descartar en preguntas sanas ni peticiones al modelo provocadas por la navegación**. Las lecturas retenidas mostraron `Preparing question…`. Las entradas vacías midieron **40px de altura real** con el tamaño de prosa de fábrica de 16px; un razonamiento de tres líneas creció a **76px**, manteniendo un **máximo de 192px**; su marco creció de **109,39px a 145,39px**.
- La auditoría de la carga pasó **96 manifiestos de rastreo / 277.497 entradas / cero coincidencias con raíces privadas**, con **410 ficheros de producción idénticos byte a byte**. Las tres ejecuciones en el navegador conservaron el digest exacto aprobado del host; sus comparaciones byte a byte mantuvieron **5.535 ficheros de runtime** y los **130 ficheros instalados del plugin de programación**. No hubo errores de página, peticiones fuera del origen ni intentos de grabación.

Evidencia: Native completo `/private/tmp/lh-coding-native-7HLV1v/`; navegación en producción `/private/tmp/lh-coding-native-oE0g2v/`; navegación en desarrollo `/private/tmp/lh-coding-native-aHcEYr/`; puertas finales del host `/tmp/lh-question-defaults-final-{tests,types,lint,build}.log`; compilación aislada `/tmp/lh-question-defaults-final-isolated-package-kxuVdF/`. Usan perfiles desechables y un proveedor solo en loopback, no datos reales de alumnos, proveedores de pago, IME del sistema operativo ni ejecución de código del alumno. El paquete de programación se recompiló en `plugins/coding-questions/dist/coding-questions`; actualizar una copia instalada real es una acción aparte y no se hizo. No implica ninguna preparación, commit, push ni publicación.

## 15. Apertura continua de las preguntas: 2026-11-04

La persona aprobó una corrección acotada de la animación, solo en el host, después de que una investigación a nivel de fotograma reprodujera una primera apertura en dos fases. Está **implementada y verificada, sin commit en `feature/plugin-architecture`, sin publicar**. No incluye cambios en la API de plugins, el ciclo de vida del editor, los datos guardados, el teclado ni el dictado.

Antes de la corrección, las trazas de producción y desarrollo mostraban que el host medía un destino de altura de **211,78px** antes de que existiera el editor de código. El razonamiento ya estaba montado. Insertar el editor aumentaba la altura natural a **357,56px**, pero la animación obsoleta de altura fija recortaba todo el pie de **109,39px** hasta terminar y después saltaba unos **146px** en un único fotograma muestreado. Las reaperturas en caliente conservaban el editor y eran fluidas; el resaltado asíncrono se descartó por separado. Evidencia de la investigación: `/private/tmp/lh-coding-native-FNDJPu/` y `/private/tmp/lh-coding-native-hZnPXi/`.

Un controlador privado que solo gestiona la altura redirige ahora la misma animación de apertura en curso cuando las observaciones de la disposición posteriores a las restricciones detectan un cambio de la altura natural. Empieza desde la altura visible actual y consume solo el tiempo restante de la animación original en la **línea temporal del documento**, incluidos los inicios pendientes; no usa ningún tiempo de espera de reloj, retraso añadido ni reinicio con la duración completa. La medición temporal de la altura natural restaura exactamente la altura y la prioridad en línea anteriores y conserva los límites de CSS. Siguen intactos los cambios de altura existentes de 120ms, los fundidos de contenido de 160ms, la aparición inicial instantánea, el crecimiento ordinario sin animar al escribir, el comportamiento al cerrar, la política de reserva y los editores conservados. La limpieza libera solo la animación de altura propia y rechaza los observadores obsoletos en cola.

- **Pasaron 3.988 pruebas / 566 baterías**. La ejecución centrada en el dock pasó **42 pruebas**, incluidas temporización y geometría, redirecciones repetidas y tardías, inicios pendientes, no-ops con el mismo destino, límites y restauración de estilos, escritura y cierre sin cambios, propiedad de animaciones no relacionadas y limpieza de Activity y de observadores. Pasaron la comprobación de tipos, el lint, las comprobaciones de diff de todo el proyecto y una compilación de producción e independiente nueva y aislada; solo quedan los avisos existentes de lint y de rastreo.
- Pasó el consumo estricto del SDK seleccionado, incluido un renderizador de preguntas asíncrono sin callbacks de disponibilidad de teclado ni de animación y comprobaciones negativas de que los controles privados de transformación no son API públicas de plugins. La revisión independiente de solo lectura no encontró P1/P2 confirmados.
- La auditoría de privacidad y del código pasó **96 manifiestos de rastreo / 277.665 entradas / cero coincidencias con raíces privadas** y **411 ficheros de producción idénticos byte a byte**.
- Las trazas de fotogramas de producción y desarrollo pasaron la predicción en frío, el primer revelado de una comprobación y la reapertura en caliente. Las aperturas en frío redirigieron la **misma instancia de animación** a **357,56px**, conservando la altura visible a lo largo de cada redirección síncrona completa. El razonamiento se fue haciendo visible **44–64ms** después de crear la animación, antes de terminar. El antiguo salto final de unos **146px** pasó a ser una diferencia subpíxel de **0,016–0,031px**. Una redirección en desarrollo en curso consumió **33,314ms** y conservó **86,686ms**, con exactamente el mismo plazo en la línea temporal del documento antes y después; los inicios pendientes conservaron 120ms sin inventar un plazo de reloj.
- Las reaperturas en caliente conservaron las identidades del DOM tanto del editor como del razonamiento y no necesitaron redirección. Escribir con el código y el razonamiento ya asentados produjo **cero animaciones de altura**. Con un viewport de **540px**, el límite compartido existente se mantuvo en **392px**, con el desplazamiento correcto de todo el contenido.
- La regresión completa de cinco fases de Native, sin cambios, pasó Enter/Shift+Enter, las guardas sintéticas de composición, los canales exactos de respuesta y razonamiento, el historial y la recuperación nueva con el plugin desactivado. La navegación en producción y en desarrollo pasó cada una **10 retornos o montajes sanos**, sin Reintentar, falso no disponible ni Descartar en preguntas sanas. Las cinco ejecuciones conservaron el digest aprobado y la **carga de 5.537 ficheros**, con los **130 ficheros del plugin de programación** idénticos byte a byte al producto congelado. No hubo errores de página, peticiones fuera del origen ni intentos de grabación.

Evidencia final del navegador: apertura en producción `/private/tmp/lh-coding-native-7xTVux/`; apertura en desarrollo `/private/tmp/lh-coding-native-buhm3z/`; Native completo `/private/tmp/lh-coding-native-XlX2w6/`; navegación en producción `/private/tmp/lh-coding-native-GWerVN/`; navegación en desarrollo `/private/tmp/lh-coding-native-sPEMjv/`. Los directorios de apertura incluyen `opening-afterfix-summary.json`, trazas por fotograma, de mutaciones y de animaciones, y capturas; los cinco incluyen `final-byte-comparison.json`. Son pruebas con perfiles desechables y un proveedor en loopback, no comprobaciones reales de micrófono, IME del sistema operativo, proveedor de pago ni ejecución de código del alumno.

Puertas del host: `/tmp/lh-question-opening-{tests,types,lint,build,sdk}.log`; compilación aislada: `/tmp/lh-question-opening-isolated-package-vDB0QD/`. Sigue sin commit en `feature/plugin-architecture`, sin publicar. Esta corrección no autoriza ninguna instalación en un perfil real, preparación, commit ni push.


## Puntos de control de las extensiones de sesión

Fuente: `docs/plugin-session-extension-contract.md` antes de la limpieza de la documentación.

## 9. Secuencia de implementación y verificación

Implementado y verificado en esta secuencia:

1. Tipos compartidos de imágenes, envíos y superficies, validadores estrictos, asistentes de preparación inmutables, declaraciones del SDK y pruebas del contrato.
2. DTO, persistencia, interfaz y proyección al modelo de las imágenes nativas y admisión por el motor real, con pruebas de destino exacto y carreras asíncronas. Conservar las puertas existentes de preguntas y privacidad y la semántica de proveedores y suscripciones.
3. Registro del frontend y preparación ordenada, integración con formularios, dictado y calificación en bruto, disponibilidad de la entrada pendiente y manejo de borradores, cancelaciones y aceptaciones.
4. Límite y pila de superficies sobre el cuerpo de la sesión usando el almacén de interfaz y la infraestructura de interacción existentes.
5. Documentación, fixtures externos públicos y revisión independiente P1/P2. Corregir solo los hallazgos causales y añadir regresiones permanentes.
6. Pruebas completas, comprobación de tipos, lint y diff; consumidor estricto del SDK generado; compilación de producción e independiente aislada; auditoría de rastreo de la carga, raíces privadas y bytes del código; prueba de humo empaquetada con Electron/Chrome y simulador en loopback, sin proveedores de pago ni datos reales de alumnos.

Las pruebas causales obligatorias incluyen: una ruta no es una imagen; renderizado de usuario, razonamiento y respuesta solo con imagen; colocación separada de razonamiento y lectura; bytes nativos para el modelo, no imágenes solo con metadatos; rechazo explícito de modelos no compatibles; recalificación de la respuesta en bruto tras un barajado determinista; salida no válida de un hook; prioridad y composición; actualización de la disponibilidad pendiente; los fallos y cancelaciones conservan los borradores; dictado final antes de la captura; aparición, modelo, plugin o vista obsoletos; hooks que ignoran el aborto; una sola intercepción a lo largo de reintentos y respaldos con el sistema ocupado; el reintento del modelo reutiliza el contenido aceptado; sin callback de aceptación ante un rechazo; superficies montadas apiladas, límites correctos, un único Escape, devolución del foco, sin acciones en entradas cubiertas, Ajustes anidados, descarga y navegación limitadas al propietario y limpieza tardía.

La aprobación de la implementación por sí sola no autorizaba preparar ni hacer commit. Después la persona autorizó hacer commit del punto de control de la rama de la funcionalidad; aquí no se autoriza ningún push ni publicación.

## 10. Verificación de la implementación

Este incremento está implementado y verificado junto con el trabajo existente de Markdown y de preguntas acotadas en la rama de la funcionalidad. Las cifras históricas de verificación de esos incrementos anteriores son puntos de control aparte.

### Puertas finales

- Batería completa sin conexión: **3.869 pruebas en 564 baterías**, sin fallos, cancelaciones ni omisiones.
- TypeScript de todo el proyecto: pasó.
- ESLint de todo el proyecto: sin errores; solo el aviso preexistente de `<head>` en `tests/source-name-ui.test.tsx`.
- Comprobación de espacios del diff: pasó.
- Compilación de producción de Next.js nueva y aislada y compilación independiente seleccionada: pasó.
- Consumidor externo estricto del SDK recién generado: pasó con `skipLibCheck: false`, dependencias físicas aisladas, uso positivo de interceptores, imágenes y superficies y comprobaciones negativas de campos de solo lectura o protegidos y de la canalización del backend.
- Auditoría de la carga: **96 manifiestos de rastreo, 277.077 entradas, cero coincidencias con raíces privadas**. Los **410 ficheros de producción** coinciden byte a byte desde el árbol de trabajo hasta el código aislado y la carga independiente en bruto, sin ficheros ausentes ni distintos.
- Las revisiones independientes P1/P2 de solo lectura cubrieron los contratos y proyecciones compartidos, la admisión nativa en el servidor, el ciclo de vida del frontend y la calificación en bruto, las superficies y los deltas finales de normalización y apertura. No se informó de ningún hallazgo P1/P2 confirmado pendiente.

### Pruebas causales

Las regresiones permanentes sin conexión cubren la validación estructural y de bytes, el rechazo por modelo efectivo o por política de redimensionado, la aparición exacta y las carreras con el agente en vivo, la persistencia nativa y la proyección a la interfaz y al modelo, la recalificación integrada en bruto contra la pregunta barajada que se muestra, el material pendiente que aporta la selección inicial, los hooks ordenados inmutables, la captura final del dictado, la cancelación y las ediciones más nuevas, los cambios de modelo conocidos, el aislamiento de callbacks, el respaldo real ante el 409 de una reorientación con el sistema ocupado con una sola intercepción, y la preparación de apertura de un solo uso segura con StrictMode.

Durante la integración se reprodujo una carrera real de normalización previa a la confirmación: la adopción canónica solo de adición podía duplicar una vista previa optimista original de una imagen cuando el servidor la redimensionaba. La persona eligió la política acotada de aplazamiento de la sección 6. Su implementación tiene **11 regresiones permanentes**, incluidas confirmaciones rechazadas o perdidas, conciliaciones fallidas y carreras de ACK/GET antiguos retrasados; la revisión final del delta no encontró ningún problema P1/P2 confirmado.

La nueva prueba de humo empaquetada con Electron + Chrome pasó **23 grupos de aserciones** sobre el comportamiento de runtime existente y nuevo, con cero errores de página, peticiones externas bloqueadas o fallos HTTP inesperados. Las comprobaciones nuevas usaron un plugin externo ordinario y acciones nativas genuinas —no respuestas o resultados sembrados ni importaciones privadas del host— para demostrar que:

- Los bytes PNG del Canvas se guardan y llegan a peticiones `image_url` reales en loopback compatibles con OpenAI.
- Una intercepción fallida conserva el borrador nativo, no hace ningún POST (recuento **3 → 3**) y no notifica ninguna aceptación.
- La actualización de la entrada pendiente permite que un compositor nativo vacío envíe una interacción solo con imagen.
- Una respuesta literal de cadena JSON o código del plugin puede transformarse mientras las imágenes de la respuesta, del razonamiento y del razonamiento de lectura siguen siendo canales distintos propiedad del host en el historial y en las peticiones al modelo.
- Un fallo deliberado del modelo seguido de un Reintentar nativo reutiliza las imágenes aceptadas sin intercepción (**recuento de hooks 6 → 6**) ni repetición de la aceptación.
- Un problema de práctica nativo generado de verdad acepta razonamiento solo con imagen, guarda su marca nativa y envía los bytes de la imagen al modelo.
- Una ruta `.png` sigue presentándose como texto o ruta, nunca como una imagen inferida.
- Las superficies ocupan los límites reales pintados del cuerpo de la sesión, conservan el estado del DOM anidado, muestran el título y la X, quedan por debajo de los Ajustes globales, respetan el orden natural de un único Escape y hacen caducar los destinos opacos al navegar de forma nativa.

### Evidencia y límites

- Código aislado y carga: `/tmp/lh-session-isolated-package-0Vu03a/source`.
- Pruebas completas: `/tmp/lh-session-full-tests-final.log`.
- Compilación de producción e independiente: `/tmp/lh-session-build-final.log`.
- SDK estricto y auditoría de la carga: `/tmp/lh-session-isolated-package-0Vu03a/final-sdk.log` y `final-payload-audit.json`.
- Ejecución empaquetada que pasó: `/tmp/lh-session-browser-7.log`.
- JSON y capturas del navegador: `/var/folders/3x/m0pk52v160jcprrhcb6qkd340000gn/T/lh-plugin-browser-evidence-8jOHFr/` (`plugin-browser-evidence.json`).

La verificación usó almacenamiento temporal aislado y fixtures en loopback, no proveedores de pago ni datos reales de alumnos. Este incremento no afirma haber corregido el seguimiento anterior de la rueda sobre la prosa de la transcripción. Siguen aplazados colocaciones de interfaz más amplias, una API nativa de envío o reorientación, hooks de contexto del modelo y regiones adicionales de cobertura de superficies. Esta verificación no prepara, hace commit, push ni publica nada.

## 11. Verificación posterior del pulido de la interfaz: 2026-11-03

La modificación de la presentación aprobada por la persona está implementada y verificada en `feature/plugin-architecture`, **sin commit y sin publicar**. No cambia la intercepción de envíos, la calificación, la proyección de imágenes ni la autoridad nativa de las preguntas.

- Batería completa sin conexión: **3.908 pruebas / 564 baterías**, cero fallos, cancelaciones u omisiones. Pasaron TypeScript de todo el proyecto, ESLint (solo el aviso existente de `<head>` del fixture de pruebas) y las comprobaciones de espacios.
- UI Showcase: pasaron **17 pruebas**, las comprobaciones estrictas de tipos del SDK público y un bundle solo de frontend de **18.421 bytes**. Un consumidor aparte compiló contra el SDK recién seleccionado con `skipLibCheck: false`, incluidos los dos presets de fondo y comprobaciones negativas de destinos inventados, opacidad arbitraria y orígenes del selector de conocimiento elegidos por el plugin.
- Pasaron una compilación de producción nueva y aislada y la selección independiente. **96 manifiestos de rastreo / 277.329 entradas / cero coincidencias con raíces privadas**; los **410 ficheros de producción** coincidían byte a byte con el árbol de trabajo, el código aislado y la carga en bruto.
- La prueba ampliada empaquetada de Electron-Node/Chrome pasó con **223 peticiones / 217 respuestas**, cero eventos fuera del origen, de generación, de micrófono, de WebSocket o de error de página. Solo `GET /v1/models` llegó al catálogo en loopback; los ajustes, el conocimiento sintético y la carga del host aprobada no cambiaron. Una lectura de fuentes cancelada era esperable, con una explicación precisa.

Las pruebas nativas incluyen títulos de superposiciones solo accesibles, controles X flotantes fijados, desplazamiento en el borde exterior, contenido transparente del showcase, atenuado **alfa 0,8 / desenfoque de 8px** frente a opaco **alfa 1 / sin desenfoque**, superficies, menús, diálogos y Ajustes anidados, devolución del foco y limpieza al desactivar. También cubren los controles de modelo autocontenidos de 11px, la tipografía de lectura configurada, la disposición nativa del compositor estándar, el arrastre continuo del deslizador (**52 → 44 → 36 → 26 → 16**, mismo nodo activado, sin mutaciones de desactivación) y las doce combinaciones de estado y presentación de workers con tooltips Hint de la aplicación.

La API del selector de conocimiento, sin cambios, usa ahora la propiedad real de la invocación: los orígenes de página o de superficie de sesión obtienen una vista en el panel principal con barra lateral interactiva; los orígenes modales conservan un modal a todo el viewport. Once casos nativos de origen y geometría cubren configuraciones de la barra lateral, simulaciones del espacio libre de los controles nativos y la caducidad de la ruta. Un selector de modal global pertenece a su propietario o widget real, **no a una ruta de fondo no relacionada**; un hallazgo causal de la revisión en este punto se corrigió con regresiones de pendiente y abierto y se volvió a revisar de forma independiente. La conservación del origen cubierto se demuestra con la comprobación de impactos, el DOM, el borrador y el propietario sin cambios y el aislamiento de Tab, Shift+Tab y Buscar de confianza, no suponiendo que toda vista entre regiones ponga `inert` en el DOM. Las políticas existentes de inercia de modales y superficies de sesión siguen intactas. El orden programático inverso de superficie sobre selector es una prueba de integración del host, no un flujo visible en el navegador que se afirme.

Evidencia: `/tmp/lh-ui-polish-isolated-package-rPMHuU/source`, `/tmp/lh-ui-polish-tests-final.log`, `/tmp/lh-ui-polish-build.log`, `/tmp/lh-ui-polish-sdk-strict.log` y `/private/tmp/lh-ui-showcase-native-ssfmL3/result.json` con nueve capturas del viewport. Las auditorías independientes del código y del delta no informaron de P1/P2 confirmados pendientes. Las comprobaciones de Windows/Linux simulan la geometría CSS de los controles de ventana; no se afirma nada sobre los adornos físicos del sistema operativo, la captura real con micrófono, el IME del sistema operativo, los instaladores firmados, los proveedores de pago ni la instalación en un perfil real. Los cambios de interfaz propuestos aparte para las preguntas de programación no forman parte de este punto de control.

## 12. Superficies generalizadas sobre el cuerpo de la página: implementado y verificado

**Implementado y verificado, sin commit sobre `8dd7409` en `feature/plugin-architecture`; sin instalar ni publicar.** La sección 8 modificada añade `ctx.ui.openSurface(surface, { signal })` y conserva `openSurface(target, surface, { signal })` para apuntar con precisión a destinos nativos de envío o acción. No se añaden métodos ni props nuevos: la API de interfaz sigue teniendo **14 métodos**.

Captura el límite de la página activa una sola vez al invocarla: vistas de plugins, chat nativo, Inicio y Nuevo borrador. La cobertura del cuerpo de la página, el contenido cubierto que sigue montado, la caducidad al ocultar o abandonar la página, los diálogos y Ajustes siempre en primer plano y la propiedad de la página —no de quien abre el modal— son normativos en la sección 8. Se reutilizan la presentación existente sin cabecera con X flotante, los fondos, el ciclo de vida del contenido apilado y las capas del controlador de interacción y de vista. Los nombres de la implementación privada son `plugin-surface-targets.ts`, `plugin-surfaces.tsx` y `plugin-surface-shell.tsx`; no son importaciones públicas. No se introduce ningún gestor nuevo de superposiciones o ventanas, regla global de recorte ni persistencia. La captura nativa de envíos, los hooks y la exposición de tokens siguen limitados a su ámbito existente del chat nativo.

La familia **Surfaces** de UI Showcase tiene ahora un botón directo de la galería **Open surface** que usa la sobrecarga sin destino; se mantienen las demostraciones de la acción explícita en la barra superior nativa, el anidamiento, el fondo, el menú y el diálogo. La galería sigue teniendo **14 métodos / 12 familias**. Este punto de control es independiente de las pruebas anteriores de árbol, sesión y pulido de la interfaz e incluye la regresión de scroll de la cabecera de workers verificada antes.

### Puertas finales: 2026-11-04

- **4.045 pruebas del host / 568 baterías**, cero fallos; **78 pruebas de plugins** (47 de Flashcards, 5 de Coding Questions, 26 de UI Showcase).
- Pasaron las comprobaciones de TypeScript, ESLint y espacios de todo el proyecto; ESLint solo mantiene el aviso preexistente de `<head>` del fixture de pruebas.
- Pasaron una compilación de producción e independiente nueva y aislada y el consumidor estricto del SDK generado, incluidas las dos sobrecargas y comprobaciones negativas de enrutamiento inventado, modal y falta de señal.
- Auditoría de la carga: **96 manifiestos de rastreo / 278.337 entradas / cero coincidencias con raíces privadas**; **415 ficheros de producción** coinciden con el código y la carga, sin ficheros ausentes ni distintos.
- La revisión final independiente de solo lectura no informó de P1/P2 confirmados pendientes. Las regresiones permanentes cubren la apertura inmediata al montar la vista, la cobertura estable en las ramas de carga, error y no disponible del plugin, y un selector nativo del borrador que aparece realmente más tarde. Este último se queda dentro de la región compartida con los eventos de puntero restaurados localmente, sin una caja de disposición nueva ni cambios globales en las cadenas.

### Prueba en el navegador empaquetado

El punto de entrada literal `npm run test:native` terminó con **0** en `/private/tmp/lh-ui-showcase-native-knRqpm`, pasando **15 grupos de aserciones** con **29 capturas**:

- Invocación directa desde la galería y la demo existente de destino nativo explícito; comportamiento conservado de anidamiento, fondo, menú y diálogo, borradores cubiertos y devolución del foco.
- Siete variantes de página: grafo de Inicio y versión mínima, borradores de enseñanza y práctica, sesiones nativas asentadas de enseñanza y práctica y ruta de plugin. Límites exactos del cuerpo, controles cubiertos, barra lateral y adornos flotantes utilizables o barra superior nativa o del plugin, aborto al navegar, limpieza tardía una sola vez y callbacks y actualizaciones caducadas inertes.
- La búsqueda, el desplegable y la X del selector nativo del borrador usan clics de confianza y comprobaciones reales de impactos, tanto solos como de forma asíncrona encima de una superficie más antigua.
- Controles reales y visibles de un diálogo ordinario y de los Ajustes públicos de un plugin abren después superficies propiedad de la página. Los modales existentes siguen pintados y con el foco por encima de ellas; los dos puntos ocultos de campo y botón impactan en el modal o en su fondo, y Tab/Shift+Tab reales se quedan en el modal. Esto demuestra la política del host de impedir el comportamiento por defecto, sin cambios, y la contención, **no el recorrido nativo con Tab**. La protección del fondo del modal usa el contrato existente de ocultación ARIA, fondo y foco, no un nuevo requisito del atributo `inert`.

Seguridad final: cero errores de página, peticiones fuera del origen, peticiones de micrófono, WebSockets, POST de generación o de chat ni escrituras del navegador en el grafo. Los ajustes se restauraron exactamente y el hash del grafo sembrado no cambió. Se registró una lectura de fuentes del selector cancelada esperada; hubo **cero prefetches cancelados**. Las respuestas permitidas existentes fueron un 404 del favicon y 33 respuestas 503 del token STT en reposo. La verificación usó datos sintéticos desechables y un plugin de prueba de la API pública con huella aparte, nunca un perfil real ni un proveedor de pago.

Las ejecuciones completas anteriores `CMWNKt` y `Bh11JN` también pasaron los 15 grupos de interfaz, pero terminaron con 1 por un prefetch de Next cancelado en las nuevas etapas de la matriz de práctica nativa y enseñanza nativa. Esos fallos se conservan. La persona aprobó añadir **solo esas dos etapas observadas** al clasificador existente, manteniendo los requisitos de GET/fetch del mismo origen que no sean de API, cabeceras RSC/prefetch positivas, HTTP 200 coincidente en la misma etapa y `ERR_ABORTED`. El clasificador real pasó **25 comprobaciones positivas y negativas**; la ejecución correcta en el navegador no tuvo ningún prefetch cancelado y, por tanto, **no** ejercitó las ramas añadidas. No se ignora ningún fallo de API, de proveedor ni de una etapa arbitraria.

### Evidencia, bytes y límites

- Artefactos de Native: `knRqpm/{result.json,proof-summary.json,final-byte-comparison.json}` y capturas; informe consolidado `/tmp/lh-page-surfaces-bounded-guard-evidence.json`.
- Compilación del host: `/tmp/lh-page-surfaces-isolated-package-dRJrno/source/.next/standalone`; registros de las puertas `/tmp/lh-page-surfaces-final-{build,tests,types,lint}.log`; auditoría de la carga `/tmp/lh-page-surfaces-final-payload-audit.json`.
- Digest del host probado con Native: `5405def55db9712c5a5c8bf9eadb52540da6943dbe52dcaabb19307ac2668c33`; digest del producto: `a4493b43fa2883d9db7d4bbbe3fdaf630591e1adb1f37a07fcdbb03822bbb132`; digest del fixture de pruebas: `69ef0efb5eaacb4b2d87402c77743323bdb25131a561bac606f5884bc759a4b3`.
- Los **5.547 ficheros del host / 5 ficheros del producto** coincidían antes y después de la ejecución en el navegador, con cero entradas ausentes, sobrantes o distintas. Estos digests identifican las instantáneas probadas con Native; cualquier selección posterior solo de documentación debe conservar los bytes de runtime probados.

En esta prueba en el navegador no se ejercitaron los adornos físicos de la ventana de Electron, el micrófono o el IME reales del sistema operativo ni las transiciones de carga, error y no disponible de la página del plugin; las transiciones de rama tienen regresiones causales sin conexión. Este punto de control no autoriza ni realiza cambios de instalación, instalación en un perfil real, preparación, commit, push ni publicación.


## Punto de control del árbol compartido

Fuente: `docs/plugin-tree-contract.md` antes de la limpieza de la documentación.

## Punto de control de verificación: 2026-11-04

Implementado y verificado, **sin commit en `feature/plugin-architecture` sobre `bdd0666`,
sin publicar ni instalar**. Es independiente de todos los puntos de control anteriores.

- **4.021 pruebas de la raíz / 568 baterías / cero fallos**; pasaron la comprobación de
  tipos, el lint, una compilación de producción nueva y aislada y las comprobaciones
  estrictas del SDK empaquetado. Por separado, pasaron **69 pruebas de producto**: 47 de
  Flashcards, 5 de programación, 17 del showcase; no es una migración de producto.
- Auditoría de privacidad: **96 manifiestos NFT / 278.169 entradas**, cero coincidencias con
  raíces privadas; **415 ficheros de producción**, cero ficheros ausentes o discrepancias.
- Prueba nativa final: `/private/tmp/lh-tree-proof-native-4Z9LS1`, incluidos
  `proof-summary.json` y `result.json`; línea base:
  `/private/tmp/lh-tree-proof-native-YZurqn`. Los **ocho estados nativos** tuvieron una
  igualdad exacta de geometría y de estilos calculados, sin tolerancias; pasaron las flechas
  nativas y Espacio. Cuatro capturas eran idénticas píxel a píxel. También hubo otras
  variaciones de rasterizado entre repeticiones de la carga antigua: **no se afirma la
  identidad universal de píxeles**.
- Pasaron los montajes en una página pública, en un contenedor propiedad de quien llama y en
  un diálogo; los controles controlados y el aislamiento por clave de aparición no propagaron
  la selección en cascada. El contenido estable de `onDetails`/`onChange` conservó el DOM y
  los borradores tras actualizar etiquetas y reordenar columnas. Plegar y abortar, incluida
  la limpieza asíncrona tardía, limpiaron exactamente una vez por montaje. Pasaron las
  flechas, el foco diferido, el aislamiento de los editables, Espacio en botones de plugins,
  las raíces anidadas y el Tab global sin cambios.
- Los límites x/izquierdo/derecho de las columnas fueron exactos en todas las profundidades
  visibles para fixtures anchos y **estrechos válidos de 600px**. Los anchos relativos
  coincidían entre cabeceras y cuerpos: `10em` = 110px, `10ch` = 66px,
  `calc(8rem + 1px)` = 129px; los anchos en porcentaje se mantuvieron estables. Las
  etiquetas principales eran de 12,5px/500 y los metadatos de 11px/400. No es una promesa de
  que el contenido de los plugins coincida con todas las alturas de línea nativas.
- El **fixture sobrerrestringido de 460px se desplazó 27px**: demuestra el límite de anchura
  de quien llama aprobado explícitamente, **no un pase de alineación**. Los autores siguen
  siendo responsables de una anchura o anchura mínima suficiente, del desplazamiento o de usar
  menos columnas o más estrechas; no se añadió ningún motor adaptable.
- El digest de la carga previo a la selección de documentos era
  `75999544d91cb67ce6e68a69bfc0bda6b8dabdefdc7126b48361da139124894d`, sin cambios durante la
  prueba; los **5.545 ficheros de runtime** coincidían con su copia de origen sin
  diferencias. Los 5.537 ficheros de runtime de la línea base tampoco tenían diferencias con
  su propia copia de origen. Esto registra la carga ejercitada, no el digest de un artefacto
  posterior con los documentos seleccionados.
- Seguridad: cero errores de página, peticiones fuera del origen, intentos de usar el
  micrófono, llamadas de generación al modelo o WebSockets; los ajustes y el grafo del
  fixture no cambiaron.

No ejercitado: el montaje real en superficies de sesión, la grabación con micrófono, la
instalación en un perfil real ni la interfaz nativa de renombrar o arrastrar en el navegador
(pasaron las regresiones unitarias de renombrar y arrastrar). Es una prueba acotada, no una
afirmación manual sobre la experiencia de uso de toda la app. No se migró ningún plugin de
producto; de la verificación no se deriva ninguna instalación, preparación, commit, push ni
publicación.
