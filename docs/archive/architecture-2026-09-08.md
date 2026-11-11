# ⚠️ ARCHIVADO: sustituido el 2026-09-18. Lee [`docs/architecture.md`](../architecture.md) en su lugar.

[Índice del archivo](README.md) · Las notas históricas que siguen describen su propia época, no el runtime actual.

Esta es la especificación de arquitectura anterior a la auditoría (mantenida hasta el 2026-09-08). Se sustituyó después de que una auditoría completa del código comprobara que se había desviado del sistema tal como estaba construido; se conserva solo como historia: **no te fíes de ella como especificación ni la actualices**.

Desfasado conocido en esta copia: el `contracts.ts` único (ahora son seis ficheros por dominio), el disparador de extracción `everyNQuizAnswers` (ahora cobertura por tokens), el contexto del grafo con puntos calientes + vecindario a 1 salto (ahora top-K semántico), el renderizado con sigma.js + forceAtlas2 (ahora un renderizador Canvas 2D hecho a mano + d3-force), el clustering de Louvain (ahora clustering aglomerativo basado en embeddings), las pruebas con `MockLanguageModelV4` (ahora el proveedor falso de pi-ai), la lista de tres ficheros de almacenamiento (ahora cinco adaptadores) y funcionalidades «aplazadas a propósito» que ya se han publicado (dictado, importación de notas, embeddings, clústeres, ajustes del modelo). El apéndice de historial de decisiones de la especificación actual registra cada sustitución.

---

# Learning Harness: arquitectura

Estado: **la especificación canónica de la arquitectura objetivo**; describe el sistema tal como está construido (tras el giro, etapas 1–5 de la refactorización completadas). El documento del andamiaje v0 anterior al giro (basado en pi, Fastify/Vite) está en el historial de git; el razonamiento de producto está en [`docs/vision.md`](vision.md); la estructura fichero a fichero está en el README.

**Qué es.** Una app de aprendizaje independiente en Next.js: el conocimiento del alumno se acumula en un único grafo de conocimiento persistente entre sesiones, construido a partir de sesiones de tutoría en las que un agente profesor escribe un árbol de dependencias formal y visible (el árbol del plan) y verifica la comprensión con preguntas estructuradas. El grafo es la página de inicio; la sesión es el aula; todo lo demás está al servicio de esas dos.

**Principios de diseño, por orden de prioridad:**

1. **Máximo control.** Cada arista de dependencia es explícita y se comprueba automáticamente. Nada accede de lado por comodidad.
2. **Facilidad de edición.** Un worker puede rastrear cualquier comportamiento hasta un único fichero. Las capas se nombran por su responsabilidad, no por accidentes del framework.
3. **Cero deuda técnica.** La forma que ves es la forma que se ejecuta. Las rutas obsoletas se borran, no se aparcan.
4. **Arquitectura cristalina.** Un fichero de contratos, una raíz de composición, un escritor por almacén, una juntura de disparo. Cuando una regla puede ser una regla de lint, lo es.

---

## 1. Las capas

Las flechas de dependencia apuntan **solo hacia abajo**. Cada capa puede importar el barrel del núcleo; nada puede saltarse un límite por comodidad.

```
┌──────────────────────────────────────────────────────────────────────┐
│ CARCASA  app/          manejadores de rutas de Next.js (transporte)  │
│          components/   interfaz de sesión + inicio (solo renderiza)  │
├──────────────────────────────────────────────────────────────────────┤
│ SERVIDOR src/server    composición fina, cero lógica de negocio:     │
│                        chat-handler (raíz de composición del turno), │
│                        turn-service (las junturas del turno),        │
│                        stores.ts (LA raíz de composición), puntos    │
│                        de entrada de las rutas                       │
├──────────────────────────────────────────────────────────────────────┤
│ AGENTE   src/agent     el profesor + subagentes: bucles de LLM,      │
│                        superficies de herramientas, prompts. Las     │
│                        dependencias llegan por factorías/closures,   │
│                        nunca se importan desde abajo                 │
├──────────────────────────────────────────────────────────────────────┤
│ NÚCLEO   src/core      dominio puro: contracts.ts (EL esquema),      │
│                        ports.ts, plan-tree, question-core, fusión    │
│                        + derivación del grafo, graph-context,        │
│                        fases, pendientes, delimitadores matemáticos. │
│                        Sin E/S, nunca                                │
├──────────────────────────────────────────────────────────────────────┤
│ ALMACÉN  src/store     adaptadores fs: chats · registros del grafo   │
│                        · tareas. Los ÚNICOS módulos que tocan        │
│                        data/. Implementan los puertos del núcleo;    │
│                        nada los implementa a ellos                   │
└──────────────────────────────────────────────────────────────────────┘
```

**La ley de importaciones** (`eslint.config.mjs`, cuatro zonas comprobadas automáticamente; una infracción hace fallar el lint, y se verificó que cada zona salta):

| Zona | Puede importar | Motivo |
|---|---|---|
| `components/**` | solo `@/src/core` (el barrel) | La interfaz renderiza datos del dominio; nunca ejecuta lógica del dominio ni toca E/S |
| `app/**` | `@/src/core` + `@/src/server` (los barrels) | Los manejadores de rutas son transporte; delegan en los puntos de entrada del servidor |
| `src/core/**` | nada por debajo de sí mismo (nunca `agent`/`server`/`store`) | El núcleo es puro; los adaptadores implementan sus puertos, nunca al revés |
| `src/agent/**` | nunca `server`/`store` | La capa de agente recibe sus dependencias (puertos de almacenamiento, cableado) mediante factorías/closures desde el servidor |

Dos reglas son solo documentales a propósito: `src/server/stores.ts` es el único módulo del servidor que puede importar adaptadores (el `except` del plugin de ESLint no puede expresar limpiamente «todos menos uno»), y `src/core/graph.ts` + `graph-context.ts` quedan fuera del barrel del núcleo para que el barrel siga siendo seguro para el navegador (sus tipos se exportan en el barrel a través de `ports.ts`/`contracts.ts`).

---

## 2. Puertos, adaptadores y raíces de composición

El almacenamiento son **puertos semánticos por entidad**, nunca una interfaz genérica única: `ChatStore`, `GraphStore`, `JobStore` (`src/core/ports.ts`, solo tipos). Los adaptadores fs (`src/store/{chats,graph,jobs}.ts`) los implementan y contienen persistencia y nada más.

- **`src/server/stores.ts` es LA raíz de composición del almacenamiento**: instancia los adaptadores y pasa los objetos de puerto a todo lo demás (módulos del servidor, el ejecutor de tareas, la canalización de extracción, las herramientas del agente). Es el único sitio donde se vuelve a tomar una decisión de almacenamiento (JSON frente a SQLite, local frente a remoto).
- **`src/server/chat-handler.ts` es LA raíz de composición de un turno**: conecta los almacenes, el ejecutor de tareas, las herramientas del profesor y los servicios del turno con la respuesta en streaming del SDK. Toda la lógica vive detrás de las junturas a las que llama.
- La capa de agente tiene las dependencias invertidas en todo momento: `createJobRunner({ chatStore, jobStore, deliver })` (la juntura `deliver` pasa las reorientaciones a la canalización de despertar), `createExtractionPipeline({ chatStore, graphStore, extractor?, auditor? })`, `createTeacherTools({ chatId, chatStore, jobStore, spawn })`, `createTeacherAgent(model?, tools?, graphContext?)`. Las pruebas inyectan los mismos puertos que conecta producción.

---

## 3. El grafo de conocimiento: dos canales, un escritor

**La canalización de extracción es el único escritor del grafo.** Nada más añade a `data/graph/*.jsonl`: ni el profesor, ni el servidor, ni un script de migración.

```
registro del chat ──▶ EXTRACTOR (LLM) ──▶ AUDITOR (LLM) ──▶ FUSIONADOR (núcleo, determinista) ──▶ registros
                       propone             verifica            aplica
```

**Ciego al árbol y a posteriori** (rediseño del 2026-09-02, docs/vision.md §1): el extractor lee SOLO la transcripción —nunca el árbol del plan de la sesión— y propone proposiciones libres (enunciados verdaderos con descripción, sin errores conceptuales: un error conceptual se enuncia como su corrección verdadera), aristas `follows`/`supports`, notas de comprensión por proposición y procedencia con granularidad de mensaje. Cada nodo es un hecho objetivo sobre el mundo; la relación del alumno con él vive por completo en el registro de eventos.

**Reparto de la confianza** (la regla central de la canalización): las etapas de LLM aportan solo juicio —*qué se aprendió*, *qué se sigue de qué o qué apoya qué*, *qué proposición evaluó cada quiz* (a posteriori, contra toda la transcripción) y, en el caso del auditor, la *identidad*: si una proposición ES un nodo ya existente del grafo (enlazar o crear)—. Todo lo que el modelo podría copiar mal en silencio —tipos de evento (`correct` / `miss` / `dont-know`), marcas temporales, referencias de idempotencia, notas, puntos de procedencia— lo reconstruye de forma determinista el fusionador a partir de las partes de herramienta de la transcripción. El extractor aporta citas textuales como evidencia; el auditor (que ve la salida del extractor MÁS el grafo actual) descarta todo lo que no esté respaldado, registra cada descarte y marca cada proposición superviviente con su veredicto de identidad (`linkTo`). Conservador en todo: mejor duplicados que fusiones erróneas, mejor descartar que inventar.

**Invariantes del fusionador** (`src/core/graph.ts`, `mergeFindings`): idempotente e incremental. La identidad sale únicamente del veredicto `linkTo` del auditor (validado contra el registro; nunca por coincidencia de cadenas); una línea de correspondencia por (chat, sourceId) como rastro de auditoría del veredicto (lo que además hace idempotente volver a fusionar el mismo chat); añadidos por enlace: una proposición enlazada añade una línea de nodo cuyas formulaciones se suman a los `aliases` del nodo y cuya procedencia se une (las lecturas fusionan por id); eliminación de aristas duplicadas por `(from, to, type)` ya afirmada por este chat, con procedencia por mensaje; eliminación de eventos duplicados por referencia limitada al chat (toolCallId del quiz, `obs:<sourceId>` para las observaciones de comprensión); y un punto de control en sessions.jsonl (`foldedAt`) que marca qué turnos se han procesado. Un fallo en cualquier punto anterior al fusionador no registra ningún punto de control; el siguiente disparo vuelve a ejecutarlo.

**El disparador es provisional (v1) y está aislado en UNA juntura.** `src/server/turn-service.ts` (`triggerExtraction`) cuenta los quizzes respondidos que aún no están en el registro (`pendingQuizAnswers`, núcleo) y lanza la canalización de forma asíncrona en cuanto un chat supera `EXTRACTION.everyNQuizAnswers` (3 por defecto, config.ts), con una sola ejecución a la vez por chat. La canalización no depende del disparador: cuando llegue un mecanismo mejor (fin de sesión, inactividad, vaciado explícito), solo cambia esta juntura.

**El canal de lectura es pura derivación.** `GET /api/graph` lee los registros (`graphSnapshot`: aristas fusionadas, estados de nodo derivados, procedencia de la sesión); la vista de inicio nunca dispara una escritura. Al empezar la sesión, `buildGraphContext` renderiza el grafo derivado en un bloque Markdown compacto que se añade a las instrucciones del profesor (el grafo entero mientras sea pequeño; puntos calientes diagnósticos + vecindario a 1 salto a partir de 150 nodos); esto es lo que hace que el sondeo sea preciso y que la personalización se acumule. «Guarda eventos, deriva el estado»: los estados de los nodos siempre se recalculan a partir del registro, nunca se guardan.

---

## 4. La sesión (un turno del chat)

`handleChatRequest` no depende del framework (`Request`/`Response` normales), así que las pruebas lo controlan con un modelo simulado guionizado. El turno se compone de:

1. **`buildTeacherContext`**: el canal de lectura del grafo (se actualiza solo y contiene los fallos: un error de lectura nunca tumba la lección).
2. **`persistTurn`**: la escritura canónica del estado: los mensajes del cliente y del agente se guardan en cada final, incluidos los abortos (la transcripción parcial es lo que hace gratis reanudar a mitad de una pregunta).
3. **Las herramientas de tareas se ejecutan en el servidor con confirmación y reorientación**: las llamadas `research`/`demo`/`visual` se resuelven de inmediato a mitad del turno con una confirmación que no espera respuesta (el profesor sigue enseñando); `spawn(job, input)` lanza el ejecutor en segundo plano. Al terminar, el ejecutor construye un **mensaje de reorientación** (un `UIMessage` con rol de usuario con una parte de texto —el canal dirigido al modelo— y una parte `data-subagent-artifact`, que la conversión del proveedor descarta) y lo pasa a la **canalización de despertar** (`src/server/jobs.ts`: cola serializada por chat en `globalThis`, espera a que no haya turno en curso ni quiz pendiente, lanza un turno del profesor en el servidor a través del adaptador `setTurnRunner` del chat-handler, reintento ante 409, idempotente por jobId). El estado de la tarea solo pasa a done/error después de guardar el turno de despertar. El cliente adopta el turno de despertar mediante la maquinaria existente `turnInFlight` (brillo de ocupado + bloqueo del compositor, igual que al volver a mitad de un turno) y renderiza la reorientación como un artefacto, nunca como una burbuja.
4. **`triggerExtraction`**: el canal de escritura del grafo (§3).

Cada servicio es una juntura con nombre que contiene sus errores y recibe dependencias explícitas; los fallos registran una línea `[chat <id>]` y nunca tocan la respuesta. Cambiar cualquiera de ellos (p. ej. el disparador) no toca nada más.

**El árbol formal del plan**: el profesor escribe el mapa de dependencias de la sesión con herramientas validadas por esquema (`plan_init` … `plan_mark_done`); el árbol se guarda en el registro del chat y el panel del árbol se renderiza a partir de la última salida de las herramientas del plan: un objeto, dos caras. **Las herramientas de preguntas del lado del cliente** (`quiz`, `ask_user_question`) no tienen ejecución en el servidor: la llamada llega en streaming al navegador, el alumno responde en el dock, el cliente califica con `question-core` y devuelve el veredicto con `addToolOutput`, que dispara la continuación.

---

## 5. Observabilidad (mínima, por decisión)

Los frameworks de logging estructurado se aplazan; la base es una línea de log por evento en las junturas, etiquetada para correlacionar: `[chat <id>]` en los servicios del turno, `[extraction <id>]` en la canalización (estadísticas de fusión, descartes de la auditoría), `[job <id>]` en los ejecutores, `[graph]` en las lecturas del grafo en el servidor. Cuando llegue el logging estructurado (JSON al estilo de pino con `{chatId, jobId, toolCallId}`), irá detrás de estas junturas, sin cambiar ningún punto de llamada.

---

## 6. Pruebas

Todo determinista, sin red: los modelos se inyectan (`MockLanguageModelV4`), el almacenamiento usa los mismos adaptadores fs que conecta producción (las pruebas se encargan de hacer copia de seguridad y vaciar los registros que tocan) y la lógica pura recibe implementaciones de puertos en memoria. Cuatro estratos: unidades puras del núcleo; flujos del servidor controlados a través de `handleChatRequest` con modelos guionizados; bucles de subagentes (investigador, constructor de demos, creador de visuales y la canalización de extracción de extremo a extremo: descartes de auditoría, que un fallo no registre puntos de control, una sola ejecución a la vez); y pruebas de renderizado mediante el renderizado de React en el servidor. Puertas en cada cambio: `tsc` limpio, todas las pruebas, `eslint` limpio, `next build` limpio.

---

## 7. Aplazado a propósito (enlaces)

Arbitraje de fusiones difusas o por embeddings, rúbrica de calibración, arranque retroactivo de las sesiones de la prueba de concepto (visión §1, consolidación); dictado, rediseño de la presentación para que no parezca un chat, progresión con puertas, repetición espaciada (visión §2/§4, hoja de ruta). SQLite u otros cambios de almacenamiento se enchufan detrás de los puertos (§2). El mecanismo de disparo más allá del umbral de quizzes de la v1 (§3). Cuando llegue cualquiera de estas cosas, este documento cambia con el commit que la trae: describe el sistema, no una intención.
