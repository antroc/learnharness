# El cambio al motor pi: registro de diseño

> **Registro de diseño histórico, no documentación del runtime actual.**
> El estado y el diseño originales que siguen pueden haberse sustituido o no haberse
> implementado. Consulta [Arquitectura](../architecture.md) y [Desarrollo](../development.md)
> para el runtime actual de Pi y las pautas de desarrollo, o el [índice del archivo](README.md)
> para el contexto.

Fecha: 2026-09-12. Estado: PLANIFICADO (hechos verificados, a la espera de luz verde).

Decisión (usuario, 2026-09-12): cambiar el motor de agentes del servidor (banda B) y el
puente al stream de la interfaz (banda C) del Vercel AI SDK a **@earendil-works/pi-ai**
(capa de proveedores, catálogo y streaming) + **@earendil-works/pi-agent-core** (bucle del
agente). El cliente (banda D: `useChat`, transporte, kit de interfaz) **se queda** en el AI
SDK. El contrato de la transcripción (banda A: registros con forma de UIMessage,
`TeacherUIMessage`) **se queda** tal cual. Los controles de modelo y razonamiento llegan
después del cambio, y la arquitectura que sigue está pensada para que salgan de forma natural
del catálogo de pi.

Motivación: la ambigüedad del SDK nos ha costado caro una y otra vez (convenciones de las
partes de datos, reglas de fusión de UIMessage, rutas de reintento, agrupación de
continuaciones: todo requirió investigación forense para entenderlo). Las capas de pi son
mínimas y el usuario las conoce a fondo. Tras este cambio, cada pieza de la canalización del
turno es nuestra o de pi, y se entiende por completo.

Hechos verificados de los paquetes (los tres exploradores + el registro de npm):
- `@earendil-works/pi-ai` + `pi-agent-core`, última versión **0.85.1**, MIT, solo ESM,
  Node `>=22.19.0` (el desarrollo local usa la 26.7, sin problema; la oleada de Electron debe
  publicarse con ≥22). Instalaciones normales desde el registro, sin copiar el código. El
  prototipo antiguo (/Volumes/T7/code/learning-system) funcionaba sin problemas con la 0.84.2
  y el mismo cableado.
- pi-ai = solo proveedores, catálogo y streaming: `createModels()`, `models.streamSimple`,
  `calculateCost`, `getSupportedThinkingLevels`, `validateToolArguments`. **Sin bucle de
  agente, sin zod, sin React, sin SSE.**
- pi-agent-core = el bucle: `Agent` (steer/followUp/abort/subscribe), `agentLoop`,
  `AgentTool` (execute + `terminate`), validación con JSON Schema que acepta JSON Schema
  normal (la salida de `z.toJSONSchema` de zod funciona, con coerción; verificado en
  `validation.js:285`).

## 1. Arquitectura del motor: Agent sin estado por turno, el registro es la verdad

**El registro sigue siendo la fuente de verdad.** Cada turno construye un `Agent` *nuevo* a
partir del registro de UIMessage guardado mediante nuestro adaptador `convertToLlm`, lo
ejecuta, guarda las partes resultantes de vuelta en el registro y descarta el Agent. Las colas
`steer()`/`followUp()` de pi están **en memoria** (arrays normales en la instancia) y mueren
con el proceso: son para un agente *mantenido vivo* (pi-coding-agent mantiene un Agent durante
toda la vida de la sesión). La arquitectura de lh es la contraria: turnos limitados a la
petición HTTP, canalización de despertar duradera, persistencia con escritura anticipada,
guarda de un solo turno con 409. Todo eso se queda exactamente como está.

En concreto, por cada POST a `/api/chat`:
1. `beginTurn` / guarda 409 / persistencia con escritura anticipada (sin cambios,
   `chat-handler.ts`).
2. Agrupación con `claimSteers` (sin cambios: los mensajes de despertar del servidor se
   añaden al registro *antes* del turno, que es lo que ya ocurre).
3. Construir `initialState.messages` = `recordToPiMessages(record)` (§4).
4. `new Agent({ initialState, streamFn, convertToLlm, getApiKey, tools })`.
5. Ejecutar hasta terminar (el bucle se detiene porque las herramientas de preguntas terminan
   antes, ver §2; si no, lo terminan los stopReason `stop`/`length`).
6. El puente (§3) emite chunks SSE mientras se ejecuta; los eventos se recogen para el uso.
7. Equivalente de `onFinish`: `persistTurn` (empalme del bloque del plan, sin cambios),
   `appendTurnUsage`, `triggerExtraction`, `endTurn` (todo sin cambios).

Lo que **no** adoptamos a propósito:
- Agents mantenidos vivos entre peticiones (se pierden las garantías de durabilidad y cambia el
  modelo de 409/un solo escritor).
- La inyección de reorientaciones dentro del bucle de pi (reorientaciones a mitad de turno):
  hoy un despertar espera a que termine el turno en curso (claimSteers en el límite de la
  petición). La inyección en el bucle mediante `getSteeringMessages` es una posible mejora
  futura, anotada en §8; no entra en este cambio.
- La maquinaria de sesiones JSONL de pi (`harness/session/jsonl`): nuestro almacén de
  registros ya cumple ese papel.

## 2. El patrón quiz/ask: el corazón del cambio

Se encontraron tres formas entre el propio pi y el prototipo; lh necesita una tercera
variante porque sus herramientas de preguntas **las responde el cliente** y están limitadas
al turno:

- El `ask_question` propio de pi (extensión interactive-subagents): execute escribe un fichero
  auxiliar y vuelve; la *capa de sesión* orquesta la respuesta como un mensaje futuro. Encaja
  con un subagente mantenido vivo, no con nuestro modelo de turnos.
- El plan del prototipo: **execute bloqueante** que espera al alumno, con el veredicto
  calificado como resultado. Encaja con una TUI, no con HTTP: mantendría un POST abierto los
  minutos que tarde el alumno en responder.

**La variante de lh (el diseño):** las herramientas de preguntas (`quiz`,
`ask_user_question`) son `AgentTool` cuyo `execute()` vuelve *de inmediato* con un resultado
sintético:

```ts
execute: async () => ({
  content: [{ type: "text",
    text: "Question posed to the learner. Turn ends here; the answer arrives as this call's result next turn." }],
})
```

- **El mecanismo de parada es el hook `shouldStopAfterTurn`, no `terminate`.** (Verificado en
  `agent-loop.js`: terminate vive en el *resultado*, solo se dispara después de ejecutar el
  lote y solo cuando *todos* los resultados del lote lo activan; así que un lote
  quiz+research NO se detendría y el modelo seguiría enseñando más allá del quiz. Además,
  `terminate` está pensado para herramientas finales de un flujo de trabajo, no para pausar a
  la espera de entrada; no le damos otro uso.) El hook de nuestro envoltorio: *¿contenía el
  mensaje del asistente completado en este turno una llamada a una herramienta de preguntas?
  → devolver true → el bucle se detiene antes de cualquier otra llamada al modelo.*
  Determinista para cualquier forma de lote; las herramientas del servidor llamadas en el
  mismo lote (research, etc.) siguen ejecutándose y emitiendo antes sus resultados, igual que
  el comportamiento actual del SDK, en el que una llamada a herramienta del cliente termina el
  turno.
- El resultado sintético existe solo porque el bucle de pi exige un resultado para cada
  llamada ejecutada para asentarse en un estado terminal limpio **dentro de ese turno**.
  *Nunca se guarda*: nuestro registro conserva la parte de herramienta **sin salida** hasta
  que el cliente responde, exactamente como hoy. El contexto en memoria de la ejecución
  muerta (marcador incluido) se descarta; la respuesta del alumno se adjunta al *registro*, y
  el Agent nuevo del siguiente turno ve la llamada respondida como un resultado de herramienta
  normal a través del adaptador (§4).
- La respuesta del alumno (dock → `addToolOutput` → siguiente POST con la transcripción
  modificada) vuelve a entrar por `recordToPiMessages`: la parte de herramienta respondida se
  convierte en un `ToolResultMessage` con el `toolCallId` original, así que el modelo ve la
  respuesta como el resultado de la herramienta. Es justo lo que documenta `continue()` de pi
  ("last message must be a user or tool-result message"); solo que lo alimentamos a través de
  nuestro propio registro en lugar de un Agent mantenido vivo.
- **La validación de lo que escribe el modelo sigue siendo zod y sigue siendo nuestra.** La
  salida de `z.toJSONSchema` pasa a ser los `parameters` de la herramienta (pi valida la
  estructura y hace coerción), pero nuestras reglas entre campos de `superRefine`
  (correctAnswer∈options, la redacción corregida dos veces) no sobreviven a JSON Schema. Así
  que el envoltorio ejecuta él mismo el esquema zod en el momento de la llamada, antes de la
  ejecución: si falla, devuelve el error del mismo modo que lo hace la validación propia de
  pi, como un `ToolResultMessage` de error que el modelo ve y contra el que reintenta
  (verificado: es la ruta nativa de autocorrección de pi, catch de `prepareToolCall` →
  `createErrorToolResult`). La misma semántica que el `InvalidToolInputError` actual.
- **Llamadas a preguntas colgadas** (un turno abortado a mitad que deja un quiz sin
  responder, o una llamada al LLM abortada; pi rescata el mensaje parcial del asistente con
  stopReason `aborted`): `recordToPiMessages` debe sintetizar un `ToolResultMessage` ("The
  question was interrupted") para cualquier toolCall sin resultado *antes* de la llamada al
  LLM, o los proveedores rechazan la petición. Es un invariante estricto del adaptador,
  cubierto por pruebas.

## 3. El puente: AgentEvents de pi → SSE de UIMessageChunk

Tenemos nuestro propio `src/server/ui-stream-bridge.ts` de unas 200 líneas que sustituye a
`createAgentUIStreamResponse`. Formato en el cable (verificado en el código del SDK):

- Respuesta: `text/event-stream`, chunks como JSON plano
  `data: {"type":"text-delta","id":"…","delta":"…"}\n\n`, terminados con `data: [DONE]\n\n`.
  Las cabeceras de Vercel no son necesarias (el cliente las ignora); enviamos de todas formas
  `content-type` + `cache-control: no-cache`.
- Cada chunk se valida con zod en el cliente (looseObjects); los campos obligatorios mal
  formados ponen el chat en estado de error. Nuestra construcción de chunks está tipada y
  probada con pruebas unitarias contra las formas de `uiMessageChunkSchema`.

Correspondencia de eventos (evento de pi → chunk(s)):
- `agent_start`/`turn_start` → `start` (ver la regla del id) + `start-step`.
- `message_update` con eventos de texto de pi: `text_start/delta/end` →
  `text-start`/`text-delta`/`text-end` (id estable por bloque, p. ej. `${messageId}-t${n}`).
- eventos de razonamiento → `reasoning-start`/`reasoning-delta`/`reasoning-end`.
- `toolcall_start/delta/end` → `tool-input-start`/`tool-input-delta` (opcional; es seguro
  saltarse los deltas y emitir solo `tool-input-available` al final: ruta limpia
  verificada)/`tool-input-available` (estado de la parte `input-available`, nombre estático
  `tool-${toolName}`).
- `tool_execution_start/end` (solo herramientas ejecutadas en el servidor: research, demo,
  visual, plan_init, probe_done) → `tool-output-available` con el resultado serializado.
  **Nunca** emitas salidas para las herramientas de preguntas (son del cliente; emitir para un
  callId desconocido lanza una excepción en el cliente → estado de error).
- `tool_execution_end` con resultados de error de validación → el mismo
  `tool-output-available` (contenido del error), igual que el comportamiento actual.
- `message_end` → recoger el uso (§5); `turn_end` → `finish-step`.
- `agent_end` → `finish {finishReason}`: envíalo siempre (alimenta la fidelidad de
  `onFinish`); `stop`/`length` se corresponden de forma natural.
- Errores a mitad de la ejecución: emitir `error {errorText}` (no termina el stream; el
  cliente lo convierte en estado de error) y después cerrar. Mostrar sin ocultar los mensajes
  de validación y de herramienta desconocida, como hoy.
- **Regla del id de continuación (la crítica, sacada del código del cliente
  `makeRequest`/`createStreamingUIMessageState`):** si el último mensaje de la transcripción es
  un mensaje del *asistente*, el estado de streaming del cliente empieza como un clon de él y
  el stream debe continuar ese mensaje, así que `start` lleva `messageId` = id del último
  mensaje del asistente. Si no (turno nuevo), un id nuevo generado por el servidor. Incumplir
  esto duplica todas las partes del mensaje anterior del asistente (tarjeta de pregunta dos
  veces, toolCallIds duplicados).
- **Abortar:** el botón Detener del cliente aborta el fetch → se dispara `request.signal` de
  Node. El puente está suscrito: `agent.abort()`, la ruta de rescate guarda lo parcial (pi
  conserva lo parcial con stopReason `aborted`), la misma persistencia de isAborted que hoy.
  Los abortos de tareas y de extracción (`abortJob`, `abortExtraction`) llaman a
  `agent.abort()` en sus ejecuciones registradas; la señal llega hasta `streamFn` y a todos
  los `execute()`, verificado.

## 4. El adaptador del registro: `recordToPiMessages` y formas de los mensajes

`convertToLlm` (nuestro) convierte los UIMessage del registro → `Message[]` de pi:
- mensaje de texto del usuario → `UserMessage {role:"user", content, timestamp}`. Las partes
  de datos (`data-plan-accepted`, `data-plan-block`) se descartan (solo son de interfaz),
  exactamente como hace hoy `convertToModelMessages`.
- mensaje del asistente → `AssistantMessage {role:"assistant", content:[…]}`: partes de texto
  → bloques de texto; partes de razonamiento → bloques de thinking (+ `thinkingSignature`
  guardado en el registro para reanudar con Anthropic); partes de herramienta →
  `ToolCall {id, name, arguments, thoughtSignature?}`.
- parte de herramienta respondida → después de su mensaje del asistente, un
  `ToolResultMessage {role:"toolResult", toolCallId, toolName, content, isError?, timestamp}`
  construido a partir de la salida de la parte. Las salidas de las herramientas de preguntas
  pasan a ser contenido de texto normal (el contenido del veredicto calificado, tal como lo ve
  hoy el modelo).
- toolCall de pregunta sin responder → resultado de interrupción sintetizado (§2).
- `data-plan-accepted` en un mensaje del usuario → el texto "The plan is accepted — begin
  teaching." va con el mensaje (hoy: parte `data-plan-accepted` + la parte de texto; el
  modelo solo veía el texto: idéntico).
- La juntura sondeador/profesor no cambia: la rama del profesor sigue dependiendo de la parte
  `tool-probe_done` de la transcripción; ambos agentes se construyen en cada turno a partir
  del mismo registro.

El formato del registro en sí **no** cambia en esta oleada (la banda A no se toca); el
soporte de thinkingSignature se añade al esquema de las partes como un único campo opcional
nuevo (solo se usa cuando un proveedor devuelve razonamiento firmado).

## 5. Uso, coste y el catálogo de modelos

- Uso: suscribirse a los eventos `message_end`/`turn_end` →
  `AssistantMessage.usage {input, output, cacheRead, cacheWrite, reasoning?, totalTokens, cost}`
  → convertido a nuestros contratos `CallUsage`/`TurnUsage` (solo cambian nombres de campos:
  `reasoningTokens` → `reasoning`, etc.). La barra de estadísticas y el dock de actividad no se
  tocan.
- Coste: el `Usage.cost` de pi llega ya calculado mediante `calculateCost` (por tramos).
  **Esta oleada mantiene `core/prices.ts`** (agregaciones probadas, tabla de OpenRouter
  sincronizada): sin cambio de comportamiento. Sustituir prices.ts por el coste del catálogo de
  pi queda anotado como limpieza para la oleada de control del modelo, en la que el catálogo
  pasa a ser crítico de todas formas.
- Catálogo: `createModels()` + `openrouterProvider()`; nuestro conjunto de trabajo
  (`z-ai/glm-5.3-flash`) se **registra por programa** (id, proveedor, api,
  coste/contextWindow/thinkingLevelMap a partir de nuestros datos) porque no está en el
  catálogo estático de pi (verificado; está en la capa de pi.dev, pero no asumimos una
  dependencia de pi.dev en tiempo de ejecución). `getApiKey: provider → key` desde el entorno
  (`OPENROUTER_API_KEY`) por ahora; la oleada siguiente cambia el origen a `data/auth.json`
  sin tocar esta juntura.

## 6. Subagentes

Los cinco subagentes (ejecutor de investigación, constructor de demos, creador de visuales,
extractor, auditor) pasan de bucles `generateText`/ToolLoopAgent hechos a mano a `new Agent`
o `agentLoop` con el mismo cableado de tools+streamFn. Las señales de aborto llegan hasta
ellos (el tercer argumento de `execute`), el uso se agrega a partir de los mismos eventos y
`calculateCost` está disponible para el coste por etapa. Trabajo mecánico; la superficie más
grande es el bucle por etapas del extractor.

## 7. Arnés de pruebas

`MockLanguageModelV4` (23 sitios) se sustituye por falsos guionizados del lado de pi:
- Nivel del motor: un `streamFn` falso que produce secuencias guionizadas de
  `AssistantMessageEvent` (texto, llamadas a herramientas, terminal); la forma de iterador
  asíncrono es más sencilla que la del SDK.
- Nivel del puente: pruebas de chunks de referencia que comprueban nuestra salida SSE contra
  las formas de chunk verificadas (regla del id de continuación, rutas de terminación,
  síntesis de colgados, rescate al abortar).
- Nivel del adaptador: idas y vueltas de `recordToPiMessages` (respuestas, partes de datos,
  quizzes abortados, plan aceptado).

## 8. Oleadas, puertas y elementos aplazados

Una única oleada atómica (el motor no se puede publicar a medio cambiar): dependencias +
`serverExternalPackages` de Next para pi-ai/pi-agent-core → adaptadores (§4) → adaptación de
las herramientas (§2, se mantiene zod) → puente (§3) → recableado del chat-handler →
subagentes (§6) → adaptación de las pruebas (§7) → puertas (tsc, batería completa, lint,
compilación) → **datos borrados en el giro** (doctrina; el formato del registro no cambia, así
que el borrado es doctrina, no necesidad) → prueba de humo en vivo con GLM: flujo completo
sondeo→evaluación→traspaso→plan→veredicto→enseñanza más las rutas de aborto (abortar una
pregunta a mitad del stream, abortar una tarea, abortar la extracción), cero errores de
consola, uso correcto en la barra de estadísticas.

Aplazado (explícitamente): inyección de reorientaciones dentro del bucle (despertares a mitad
de turno); migración de prices.ts al coste del catálogo de pi; decisiones sobre la propiedad
de la banda del cliente (banda D); autenticación con varios proveedores más allá de
OpenRouter (las junturas `getApiKey`/catálogo de arriba son toda la preparación);
actualización de la capa de pi.dev.

## 9. Avisos abiertos que pasan a la implementación

- Los `id` de chunk de los bloques de texto y razonamiento deben ser únicos por mensaje y
  estables entre turnos de continuación (el cliente lanza una excepción ante un delta para un
  id inactivo).
- `tool-input-available` exige `input` como valor JSON; pi da los argumentos ya analizados al
  final de toolcall.
- Contabilidad de pasos: el `turn` de pi ≈ el `step` del SDK; nuestros límites por paso deben
  mantener las partes `step-start` donde las esperan el empalme del bloque del plan y las
  líneas temporales de fases (el empalme depende de las partes tool-plan_init: no le afecta).
- Next no debe empaquetar las dependencias de proveedores de pi-ai (SDK de AWS y Google) en
  los bundles de las rutas: `serverExternalPackages`.
- pi-agent-core admite una sola ejecución por Agent (`prompt()` lanza una excepción si ya está
  activo): un Agent nuevo por turno lo evita por completo (y encaja con nuestra guarda de un
  solo escritor por turno).
