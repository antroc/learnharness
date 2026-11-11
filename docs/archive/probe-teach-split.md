# La separación de agentes sondeo→enseñanza y la semántica del movimiento por el plan

> **Registro de diseño histórico, no documentación de la implementación actual.**
> Las decisiones originales que siguen pueden haberse sustituido o no haberse implementado.
> Consulta [Arquitectura](../architecture.md) y [Desarrollo](../development.md) para la
> estructura actual de los agentes y las pautas de desarrollo, o el [índice del archivo](README.md)
> para el contexto.

Entendimiento compartido alcanzado el 2026-09-11 (usuario + sesión maestra). Es el
registro de la convergencia: el diseño decidido, con su razonamiento. No es una lista de
tareas; las oleadas de implementación se planifican a partir de él.

---

## 1. Dos agentes, una conversación

El sondeo y la enseñanza son estructuralmente tan distintos que tienen **agentes
separados**: prompts de sistema separados y conjuntos de herramientas separados, cada uno
completamente desarrollado y centrado sobre todo en su propia fase. La separación consigue
una mayor alineación con las instrucciones de sistema: ningún agente carga con el volumen de
la otra fase (ninguno necesita los detalles; cada uno recibe solo un breve resumen de la
filosofía del otro para que compartan una visión del proceso completo).

- **El sondeador** lleva la fase de sondeo: quiz + ask_user_question + `probe_done`. Su
  quiz es una *herramienta distinta* (con otro esquema: **sin ningún campo `nodeId`**) con el
  mismo nombre, para que al modelo nunca se le muestre un campo que no debe usar. Sin
  herramientas de plan, sin tareas, sin demos.
- **El profesor** lleva todo desde la planificación en adelante: conjunto completo de
  herramientas (quiz de enseñanza con nodeId, plan_init, tareas, demos). Se construye en
  cuanto la transcripción contiene un `probe_done` concluido: una llamada del asistente que no
  ha fallado ni se ha abortado, seguida de un resultado de herramienta correcto que coincide
  con ella.
- **El cambio ocurre entre el sondeo y la planificación**: la fase de planificación necesita
  saber a fondo cómo se enseña, así que el agente profesor empieza en la planificación.
- **Comparten el historial de mensajes.** Sin empezar de cero: el historial guarda matices
  que un resumen de evaluación perdería. Las partes de herramienta del historial son
  contenido, no esquemas vivos: el profesor lee las llamadas de quiz del sondeador como
  conversación pasada; la única herramienta ajena (`probe_done`) se lee como una acción
  pasada concluida, e incluso una hipotética nueva llamada se degrada a un error de
  herramienta devuelto (la doctrina de devolver al agente).
- **Invisible para el usuario**: el mismo chat, el mismo registro, la misma interfaz. Los
  agentes se construyen en cada petición desde la misma raíz de composición; «qué agente» es
  una rama de construcción, no un traspaso.

## 2. `probe_done`: la herramienta de la juntura

El sondeador concluye explícitamente:

- **Herramienta del lado del servidor.** Entrada: la evaluación del alumno. Salida: ok/error.
- **Se niega mientras haya una pregunta abierta** («resuelve antes la pregunta abierta»):
  la misma doctrina que la validación de nodeId.
- **Se niega a una segunda conclusión** (idempotente: el sondeo concluye una sola vez).
  Concluir requiere un resultado posterior de `probe_done` que coincida con el ID y el nombre
  de herramienta de la llamada. La generación que hizo la llamada no debe haber fallado ni
  haberse abortado; el resultado no debe ser `isError` ni contener explícitamente
  `details.ok:false`. Las confirmaciones limpias sin un `ok:true` explícito siguen siendo
  válidas. Las llamadas sueltas, sin pareja, con error o rechazadas mantienen el sondeo
  abierto; esta regla de detección nunca borra ni vuelve a ejecutar los intentos guardados.
- La evaluación es la entrada de la llamada a herramienta, así que llega al alumno en
  streaming y queda guardada en la transcripción gracias al propio resultado de la
  herramienta. Una tarjeta o visor de evaluación dedicado llegará más adelante (interfaz).
- **Forma de la evaluación (v1, a refinar): una lista de hebras de dependencia + una lectura
  libre de dónde está el límite del alumno en cada una.** El sondeo ya era una búsqueda
  binaria por cada hebra de la que depende la lección; la evaluación formaliza justo eso.
  Resumen general opcional.
- **Efecto secundario: pone en cola el traspaso.** Cuando termina el turno del sondeador, la
  canalización de despertar (la misma maquinaria que entrega los resultados de los subagentes
  y las reorientaciones por aborto) lanza un turno del lado del servidor con una
  reorientación de traspaso: se construye el profesor (probe_done ha concluido con éxito) y
  este escribe el plan. El alumno vive la evaluación → plan como un flujo continuo. Si el
  despertar se pierde (ventana de caída), el siguiente mensaje del cliente igualmente
  construye el profesor: la transcripción es la fuente de verdad.

## 3. Semántica de `nodeId`: posición, no finalización

El contrato antiguo interpretaba una respuesta *correcta* a una comprobación etiquetada como
«nodo hecho». Es la señal equivocada y queda **abolida**. El contrato nuevo:

> **`nodeId` en un quiz significa: «esta pregunta trata de este nodo».**
> Nada más. Es una señal de posición, nunca de finalización.

- **Nodo actual = el nodo al que se refiere la llamada de quiz etiquetada más reciente** (la
  llamada, no el resultado: cuenta cualquier estado).
- **Visitados = todos los nodos que aparecieron en una llamada de quiz etiquetada anterior.**
  Persistente y monótono. **No hay registro de hechos ni contabilidad de hechos de ningún
  tipo**: todo se infiere del historial de la sesión. El árbol guardado solo contiene la
  estructura (el protocolo de escribir una vez llevado hasta el final: `currentNodeId` y
  `doneNodeIds` se eliminan del árbol).
- **Un nodo abarca de forma natural varios turnos y varias comprobaciones.** Varias preguntas
  pueden etiquetar el mismo nodo y el mapa no se mueve. Que el profesor pase a un nodo nuevo
  *es* su juicio de que el anterior ha terminado, sea cual sea el resultado de cada
  comprobación (una comprobación fallida seguida de una nueva explicación y de pasar al
  siguiente sigue siendo un nodo visitado).
- **Las comprobaciones fallidas no mueven nada.** Los resultados ya no intervienen en la
  derivación en absoluto.
- **Las comprobaciones sin etiquetar ya no existen** (decisión del propietario del
  2026-09-26): `nodeId` es obligatorio en el esquema del quiz de enseñanza; una llamada sin
  etiquetar se rechaza en el límite y el modelo lo reintenta etiquetado. Las comprobaciones
  fuera del mapa (comprobaciones rápidas de comprensión que no encajan en un nodo) pasan por
  ask_user_question. El mapa ya no puede volver a congelarse por perder una señal de
  etiquetado.
- **Sin nodo actual de respaldo.** Antes de la primera comprobación etiquetada no hay nodo
  actual. Nada de suposiciones derivadas de los prerrequisitos.
- Los id presentes pero no válidos se siguen rechazando en el límite de la llamada
  (validación existente, reintento devolviendo al agente).
- Visualización: el nodo actual recibe un resaltado especial; los nodos visitados se ven (no
  en gris); los próximos se muestran en gris. «Dónde hemos estado, dónde estamos».

## 4. Fases: eventos explícitos, sin derivar la ocupación

La cadena de fases está **dirigida por eventos**:

**sondeo (sondeador)** — `probe_done` → **planificación (profesor)** — la primera llamada de
quiz etiquetada con `nodeId` → **enseñanza (profesor)**

- La juntura rota derivada de la ocupación (fase del árbol a través de un `currentNodeId` que
  nada asignaba nunca: el error de quedarse atascado en el plan) se **sustituye, no se
  parchea**.
- La puerta de veredicto ha MUERTO (decisión del propietario del 2026-09-26, eliminada al
  simplificar): presentar el plan termina el turno del profesor, y el siguiente mensaje del
  alumno es una respuesta natural: una petición de cambio (revisar, volver a presentar,
  terminar de nuevo el turno) o el visto bueno. La juntura plan→enseñanza se **infiere**: la
  primera llamada de quiz etiquetada con un `nodeId` (una pregunta SOBRE un nodo del plan; los
  quizzes de sondeo no llevan nodeId) es donde empieza la enseñanza. El pliegue de fases
  (`phaseAt3`) avanza ahí, el separador de enseñanza se renderiza antes de todo ese bloque
  del asistente y el indicador de fase en vivo puede ir con retraso hasta que se plantee la
  pregunta del primer nodo (aceptado por el propietario). Las reescrituras de `plan_init` a
  mitad de lección no necesitan ninguna puerta.
- La fase del selector de sesiones se deriva de la transcripción de la misma forma.

## 5. Sin contexto del grafo global en las sesiones (por ahora)

Los dos agentes funcionan de forma **completamente independiente**: no se inyecta el grafo
de conocimiento en ninguno de los dos prompts. La idea del grafo como contexto de la sesión
(W8) queda archivada hasta que haya un diseño meditado de qué debería aportar realmente. El
grafo de conocimiento global sigue siendo lo que construye la canalización de extracción;
nada en los prompts de las lecciones lo lee.

## 6. La interfaz del plan: ventana persistente con el DAG (dirección)

El enfoque de bloques inyectados queda sustituido: el plan debería vivir en una **ventana
persistente con el DAG** en la vista de la conversación (como el dock de procesos en segundo
plano): siempre presente, con zoom sobre el nodo actual y moviéndose sola a medida que avanza
la lección; al hacer clic → plan completo (la ventana emergente existente se conserva como
vista ampliada). La disposición y el diseño exactos se refinan en la sesión de interfaz.

La ventana ya FUNCIONA (llegó el 2026-09-11, un día después del diseño): abajo a la
izquierda, viewBox con zoom 2:1 centrado en el nodo actual, limitado a la disposición; al
hacer clic abre la ventana emergente. El bloque completo del plan también se sigue
renderizando en el flujo al escribir el plan (el momento de la presentación; el bloque va
justo después de la llamada a `plan_init`) como segundo punto de entrada a la ventana
emergente. La maquinaria de bloques de vecindario (fragmentos congelados) se retira: las
instantáneas no pueden representar un movimiento derivado en vivo.

## 7. Aplazado / oleadas posteriores (diseñado, no para ahora)

- ~~**Interfaz de aceptar el plan**~~: llegó el 2026-09-11 y se **eliminó el 2026-09-26** (la
  muerte del veredicto): la juntura se infiere de la primera llamada de quiz etiquetada con
  `nodeId` (ver §4).
- **Visor de la evaluación**: las evaluaciones por hebra mostradas al alumno como una
  tarjeta en condiciones (los datos ya están guardados en la transcripción; mientras tanto, la
  tarjeta sencilla v1 de probe-done muestra la evaluación).
- **Control del modelo y del razonamiento**: ahora mismo fijo por rol en `MODELS` de
  `config.ts`. La separación da de forma natural las entradas `MODELS.prober` /
  `MODELS.teacher`; el control en tiempo de ejecución viene después.
- **Contexto del grafo, bien diseñado**: qué debería aportar el grafo global a las sesiones
  (§5).

## 8. Sin compatibilidad hacia atrás, nunca

Las sesiones heredadas no se admiten. En los giros importantes se borran los datos de
prueba y se vuelven a generar con pruebas nuevas. Nada de capas de compatibilidad, ni
respaldos con marcas heredadas, ni migración de árboles antiguos. `probe_done` es la única
clave para construir el profesor; las sesiones sin él son sesiones del sondeador (los datos
heredados muertos son basura que se borra, no algo que haya que acomodar).

---

## Contexto del diagnóstico (por qué este giro)

La ronda de pruebas con usuario del 2026-09-11 (sesiones sobre Nietzsche y Lacan, GLM con
esfuerzo mínimo) puso de manifiesto que: (1) el profesor nunca etiquetaba `nodeId`: todos los
quizzes de ambas sesiones iban sin etiquetar, así que nunca se derivaba nada; (2) el sistema
de fases no podía salir de «plan» por su estructura: `phaseOfTree` leía `currentNodeId`, que
el protocolo de escribir una vez nunca asigna, así que ninguna sesión podía llegar a
«enseñanza»; (3) con un «hecho» derivado de los resultados, una sola comprobación superada
habría dado por terminado un nodo de forma errónea. Se espera que los problemas de
cumplimiento del modelo (comprobaciones sin etiquetar, correctAnswer en texto libre) se
reduzcan con presupuestos de razonamiento mayores y control del modelo en tiempo de
ejecución, pero primero la *semántica* tenía que ser correcta. Los errores del modelo son
buen material de prueba: ejercitan los bucles de validación que devuelven al agente.
