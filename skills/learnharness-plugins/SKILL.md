---
name: learnharness-plugins
description: Crea, inspecciona o depura plugins locales de confianza de LearnHarness con la API pública. Cubre vistas/acciones/ajustes, interfaz del host, preguntas de enseñanza, problemas de práctica, contexto de toda la sesión, intercepción de envíos e imágenes, superficies sobre el cuerpo de la página, renderizadores, conversión de documentos, lectores de datos de aprendizaje, llamadas a modelos, agentes gestionados, workers y ciclo de vida de los plugins.
---

# Autoría de plugins de LearnHarness

## Lee el contrato correspondiente

Empieza por la [guía de autoría y el mapa de la documentación](../../docs/plugin-authoring.md)
y usa después la [referencia completa de la API](../../docs/plugin-api/README.md) para las
firmas exactas, los miembros y los tipos de datos y eventos enlazados. Lee los contratos de
las funcionalidades relevantes para la tarea:

| Área | Referencia |
| --- | --- |
| Límites del host y mapa de la implementación | [Arquitectura](../../docs/plugin-architecture.md) |
| Preguntas de enseñanza, editores y calificación | [Contrato de preguntas](../../docs/plugin-question-contract.md) |
| Problemas de práctica, editores y procesamiento | [Contrato de problemas](../../docs/plugin-problem-contract.md) |
| Intercepción de envíos, imágenes y superficies | [Extensiones de sesión](../../docs/plugin-session-extension-contract.md) |
| Transcripción, presentación y borradores sin enviar (solo lectura) | [Contexto de vista](../../docs/plugin-view-context.md) |
| Presentación controlada de jerarquías | [Contrato de árbol](../../docs/plugin-tree-contract.md) |
| Propiedad de modales, menús, Escape y foco | [Contrato de interacción](../../docs/dialog-overlay-contract.md) |

En un checkout, los tipos públicos están en `src/core/`: `plugins.ts`, `plugin-ui.ts`,
`plugin-agents.ts`, `plugin-workers.ts`, `plugin-questions.ts`, `plugin-problems.ts`,
`plugin-submissions.ts`, `plugin-view-context.ts`, `plugin-tree.ts`.
Estas rutas son relativas al repositorio. Usa importaciones **solo de tipos**, nunca módulos
privados de runtime. Genera declaraciones portables con `node scripts/build-plugin-types.mjs`.
Sin checkout, descarga la skill de autoría completa desde **Ajustes → Plugins de la
comunidad → Descargar skill de autoría**. Mantén juntos su `SKILL.md` raíz, `docs/`,
`examples/` y `types/`, incluidas las `tools/` portables; usa el SDK incluido en lugar de
ejecutar los scripts de compilación del repositorio.
Lee `bundle.json` para conocer las versiones de la app, la API y el SDK que lo generaron.
La API v1 puede ganar capacidades: comprueba la compatibilidad real del host en lugar de
copiar un `minAppVersion` desfasado. Las distribuciones exportadas de Hello y de las recetas
exigen, por prudencia, la versión de la app que las generó; los manifiestos fuente canónicos
de los plugins oficiales no cambian. Para versiones de destino más antiguas hay que verificar
las capacidades.

## Elige un punto de partida

Empieza por [Hello](../../examples/plugins/hello-plugin/README.md) para el plugin más pequeño
de vista y ajustes. Las [rutas de lectura de ejemplos](../../docs/plugin-examples.md) llevan a
los proyectos fuente canónicos de UI Showcase, Drawing Pad, Coding Questions, Flashcards y
Rich Code Blocks incluidos en la skill. Úsalos como referencias reales de la API pública, no
como API privadas del host. Los ID de los proyectos del núcleo están reservados: no instales
copias sin modificar como plugins de la comunidad. La guía de ejemplos distingue los
requisitos de compilación independiente de las pruebas que dependen del checkout. Managed
Agent y Teaching Extension son recetas centradas, no los puntos de partida principales. Las
recetas que usan modelos pueden tener coste cuando se ejecutan explícitamente.

## Compila e instala

Es preferible desarrollar directamente en `<plugins-directory>/<plugin-id>/`: clona o crea
allí el proyecto, instala sus dependencias de compilación y ejecuta `npm run build`. Su salida
ya es el `dist/` instalado; no hace falta ningún paso de copia. El directorio aparece en
**Ajustes → Plugins de la comunidad**. La carpeta instalada debe coincidir con el ID del
manifiesto.

Para un espacio de trabajo externo, copia el instalador portable de la skill en el proyecto
del plugin y conecta `npm run install:local -- "<plugins-directory>"` como se describe en la
[guía de autoría](../../docs/plugin-authoring.md#desarrollar-fuera-del-directorio-de-plugins).
El comando compila antes de sustituir únicamente el `dist/` instalado y conserva el `data/`
contiguo. No hay autodetección del destino, configuración guardada, activación automática ni
reinicio. Los ejemplos incluidos que no requieren compilación se pueden copiar directamente;
no necesitan configurar npm.

## Salvaguardas

- Pregunta a la persona por el comportamiento del producto, los prompts, los valores por
  defecto, los algoritmos, la política de fuentes, la interfaz y las decisiones de borrado.
  La plataforma aporta mecanismos, no autoridad sobre el producto.
- Los plugins son código local de confianza, no un sandbox. No expongas nunca credenciales,
  no modifiques los registros de aprendizaje del núcleo, no importes componentes del host ni
  inyectes HTML del modelo sin sanear.
- La estructura de runtime de la comunidad es `<learning data>/plugins/<id>/dist/manifest.json`
  más los bundles y recursos. La configuración opcional de fuentes y compilación vive junto a
  `dist/`; el `data/` persistente es un directorio hermano. Compila directamente en `dist/`,
  no en `dist/<id>/`. Empaqueta el JavaScript; no hay `npm install` en el lado del host.
- Distribuye el contenido compilado en el `<id>/dist/` instalado, conservando los datos
  hermanos. La limpieza solo afecta al `dist/` generado, nunca al espacio de trabajo ni a los
  datos, y debe negarse a borrar si `dist/` es un enlace simbólico o hay un `dist/data/` mal
  colocado.
- El código del núcleo se carga directamente desde `core-plugins/<id>/` de la app; los
  registros modificables del núcleo están en `<learning data>/core-plugin-data/<id>/`. Usa
  siempre `ctx.directory`/`ctx.dataDirectory` y no deduzcas nunca rutas hermanas. El núcleo
  se actualiza con la app; ambos orígenes empiezan desactivados y conservan las elecciones
  explícitas. Los ID del núcleo están reservados; las copias de la comunidad se omiten con un
  diagnóstico, no sustituyen al original. Usa Ajustes → Plugins de la comunidad para las
  instalaciones y Ajustes → Plugins del núcleo para las funcionalidades incluidas.
  `plugins:build-core` prepara los cuatro paquetes seleccionados en el catálogo; nunca instala
  nada en los datos del alumno.
- Actualizar descubre paquetes y primeras compilaciones; los cambios en código ya admitido
  requieren reiniciar el servidor. No hay recarga en caliente, registro de desarrollo aparte
  ni respaldo con un manifiesto en la raíz.
- La activación del backend es por servidor; la del frontend, por ventana; los montajes de
  vistas y editores tienen vidas más cortas. Limita los widgets a las señales de montaje,
  limpia raíces de React, eventos y suscripciones, protege los `await` y publicaciones
  tardíos y evita efectos secundarios en el nivel superior del módulo.
- Las carcasas de vista del host gestionan la barra superior, el título y el engranaje.
  Registra las acciones antes de colocarlas explícitamente; registrar no crea interfaz
  automática. Las barras superiores requieren destinos explícitos de sesiones o de la propia
  vista. Los metadatos opcionales `shortcut` de una acción delimitan explícitamente la
  invocación (toda la app, la sesión o la propia vista) y una combinación de teclas por
  defecto opcional; la página Teclado existente gestiona la reasignación. Acepta
  `placement: "keyboard"` al habilitarlo. Usa `refreshActions()` para los predicados dinámicos
  propios del plugin; el ámbito y la combinación por defecto se fijan al registrar.
- Usa los asistentes controlados de `ctx.ui`, no importaciones privadas ni estilos que
  dependan del DOM. Devuelve los valores aceptados mediante actualizaciones superficiales del
  handle; sustituye por completo las props anidadas. Los controles de modelo y razonamiento
  no escriben en los ajustes del núcleo. Respeta las reglas del host sobre teclado, IME y
  foco, la propiedad del dictado y la de un único Escape. Los atajos declarativos de acciones
  no exponen eventos en bruto, no saltan por encima de diálogos o editores en primer plano ni
  registran atajos globales del sistema operativo.
- El `context.view` de la barra superior de una sesión es una instantánea nueva, separada y
  congelada de toda la sesión, que incluye los mensajes y la transcripción actuales, la
  presentación y los borradores publicados sin enviar. Úsala en lugar de un segundo parser o
  reordenación del historial o de inspeccionar el DOM privado. Las lecturas nunca vacían el
  dictado ni revelan, guardan, procesan o envían nada. Respeta los indicadores de revelación
  y disponibilidad en lo que se muestra al alumno; el historial inspeccionable no es prosa
  visible saneada.
- Las preguntas de enseñanza usan esquemas guardados y la ocurrencia exacta, y siguen el
  ciclo validar → calificar (opcional) → guardar → continuar. La calificación devuelve
  observaciones JSON finitas; el plugin decide cómo mostrarlas. Los problemas de práctica
  siguen validar → procesar (opcional) → guardar → continuar; solo el `conclude` existente
  del modelo los evalúa y cierra. No inventes nunca envoltorios nativos ni te saltes
  implementaciones no disponibles. Los valores de los editores personalizados deben publicar
  que están listos antes del envío.
- Los interceptores van en orden y fallan de forma cerrada conservando los borradores.
  Mantén `hasPendingInput` sin efectos secundarios; llama a `refreshSubmissions()` cuando
  cambie el estado externo. Consume solo el material capturado a través de un `onAccepted`
  confirmado; nunca en un reintento del modelo, un descarte o una aceptación supuesta tras
  perder la respuesta. Adjunta imágenes nativas explícitas, no rutas, URL ni base64 dentro del
  JSON de la respuesta. El razonamiento y las imágenes del host siguen siendo canales de
  renderizado separados.
- Las superficies capturan un límite de página o un destino opaco exacto; nunca persistas ni
  reconstruyas destinos ni los cambies tras un `await`. Solo cubren el cuerpo, caducan al
  navegar y quedan por debajo de Ajustes y los diálogos. Usa los montajes de contenido
  públicos y respeta la limpieza por generación.
- `ctx.documents.toMarkdown` acepta un File del navegador (PDF o UTF-8 estricto), no rutas ni
  subidas por el puente JSON. Está acotado y se cancela de forma cooperativa; no hace OCR,
  almacenamiento ni inferencia.
- La inferencia necesita un modelo disponible explícito y un propósito veraz (usuario o
  segundo plano). No hay respaldo silencioso de proveedor ni de clave. Las conversaciones
  gestionadas y los workers de resultados tienen semánticas distintas de ciclo de vida y de
  ID de petición; observar o navegar no cancela la ejecución. Desactivar o reiniciar
  interrumpe el trabajo sin terminar; la recuperación nunca vuelve a ejecutar herramientas
  arbitrarias.
- Las notificaciones son pistas en vivo, no registros duraderos: usa `onResync` junto con
  instantáneas actuales, y libera los observadores en lugar de sondear vistas ocultas.

## Prueba sin alterar la instalación

Comprueba los tipos, pruebas y compilación del plugin, la estructura de runtime, el
descubrimiento estando desactivado, la activación y limpieza, el reinicio y la conservación
de datos, las generaciones obsoletas y asíncronas y las rutas del ciclo de vida nativo que
realmente uses. Prueba a través de las API públicas y los controles reales del host, no con
importaciones de componentes privados en el plugin. Usa datos desechables y proveedores de
loopback cuando sea posible. El SDK portable, los fixtures de componentes y navegador, las
comprobaciones del runtime empaquetado y las pruebas con proveedores reales y sistema
operativo demuestran cosas distintas; indica esos límites. Compilar o instalar la app, los
cambios de versión, los commits, la selección de plugins y los cambios de distribución
requieren su propia autorización humana.
