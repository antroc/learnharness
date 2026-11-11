# Learning Harness: visión y planes

> **Registro de diseño histórico, no documentación de la implementación actual.**
> Las decisiones y planes originales que siguen pueden haberse sustituido o no haberse
> implementado. Consulta [Arquitectura](../architecture.md) y [Desarrollo](../development.md)
> para el sistema actual y las pautas de desarrollo, o el [índice del archivo](README.md) para
> el contexto.

Documento vivo. Empezado el 2026-08-22; recoge la visión actual y todas las decisiones acordadas. Modifícalo a medida que las cosas evolucionen.

Marco general: el modelo de aprendizaje en tres partes y la dirección de extensibilidad y plugins están en `vision-extensibility.md` (2026-10-02; ese documento histórico al que se hace referencia no está en este repositorio).

Precedentes: `knowledge graph design.md` en el vault de Obsidian (ideación del 2025-08-20); era el documento canónico del modelo epistémico; el rediseño de la teoría de nodos y de la construcción del 2026-09-02 en §1 lo modifica aún más (sin nodos de errores conceptuales, `follows`/`supports`, sin eventos de enseñado, procedencia con granularidad de mensaje). Este documento registra lo que las decisiones de hoy **modifican** de él y añade las capas de experiencia de sesión y de presentación que el documento original dejó para más adelante.

---

## 1. El grafo de conocimiento: la pieza central

Todo lo que aprende el alumno se acumula en un único grafo persistente y transversal a los dominios. Es la página de inicio de la app y el corazón del sistema: la estructura crece de forma visible con el tiempo, y los datos permiten ampliar la frontera, consultas de qué viene después, reparaciones y valor de desbloqueo (según el documento de diseño original).

**Teoría de nodos y construcción rediseñadas el 2026-09-02**: las subsecciones que siguen, desde «Qué es el grafo» hasta «La comprensión se deriva», son la filosofía actual y sustituyen en parte el modelo epistémico del documento de diseño original y también la decisión de construcción por emisión en vivo del 2026-08-22 (ver la tabla de modificaciones).

### Requisito crítico: actualizaciones frecuentes

El grafo se actualiza **de forma continua, no por sesión**. Un alumno que responde unas cuantas preguntas y se va sin «terminar» una sesión debe ver igualmente algo nuevo en la página de inicio. Las sesiones parciales aportan valor. Lo cumple el mecanismo de puntos de control de la canalización de extracción en segundo plano (se procesa al ir al inicio o en reposo, nunca dos veces los mismos turnos), no la emisión en vivo.

### Qué es el grafo: teoría de nodos (DECIDIDO 2026-09-02)

El grafo global es un **modelo objetivo del mundo de los dominios con los que se ha encontrado el alumno**: los hechos, su estructura (qué se sigue de qué o qué se apoya en qué) y, inferido de esa estructura más el registro de eventos, el estado de la comprensión del alumno. Nunca se guarda **en** el grafo nada relativo al alumno o a la sesión; la comprensión se **infiere, nunca se codifica**.

- **Cada nodo es una proposición verdadera.** Redactada de forma objetiva, en forma mínima tal como existe respecto a su contexto. La verdad es relativa al contexto y no pasa nada: «La gravedad es una fuerza» y «La gravedad no es una fuerza» conviven como nodos, cada uno verdadero en su contexto (mecánica clásica frente a relatividad general), con **el subgrafo circundante como contexto**. Sin campo de contexto ni autocontención pedante de los hechos.
- **Esquema del nodo:** `name`: una etiqueta muy corta para el nodo, un identificador compacto como la entrada de un glosario («Voluntad de poder», «Teoría del mandato divino»): lo que muestra el grafo de un vistazo. Solo de presentación: no es única, no es una clave de identidad, nunca es precisa. Se fija al crearla; volver a encontrarla nunca la cambia. `statement`: la proposición con toda su precisión (el ancla de identidad; se muestra en la tarjeta de detalle). `aliases`: las formulaciones textuales que usaron las sesiones (claves de fusión + rastro de auditoría). **No hay `kind`** ni **`description`** (modificación del 2026-09-08: con datos reales, las etiquetas de frase completa en el lienzo resultaron inviables: etiquetas de diez líneas, texto superpuesto ilegible. La etiqueta es el nombre; la precisión está a una interacción de distancia, en el enunciado).
- **Los errores conceptuales no son una categoría de nodo.** Un mito entra en el grafo como su corrección verdadera («La afirmación del 10 % del cerebro es un mito»); que el alumno sostenga la idea equivocada vive por completo en el registro de eventos. El error es cosa del alumno, y el alumno vive en el registro.

### Aristas (DECIDIDO 2026-09-02)

Dos tipos, sin escalares, sin fuerza codificada; ser prerrequisito es un espectro y nos negamos a propósito a formalizar ese espectro:

- **`follows`**: `A → B`: B es *derivable* de A (A es una premisa de B). Si C se sigue tanto de A como de B, existen `A → C` y `B → C`; los requisitos conjuntos son simplemente aristas hermanas.
- **`supports`**: `A → B`: A *fundamenta o justifica* B sin implicarlo.

La fuerza o profundidad de las dependencias se **deriva en el momento de la lectura** a partir de la topología (cadenas, corroboración), nunca se guarda; es la entrada que consumirá el futuro modelo de comprensión.

### Procedencia: granularidad de mensaje (DECIDIDO 2026-09-02)

Cada nodo registra cada **punto (chat, mensaje)** en que apareció; cada arista registra cada mensaje que la afirmó. Con enlaces profundos a los puntos exactos de la transcripción: el rastro de auditoría de la derivación es una funcionalidad de primera clase, no un subproducto.

### Construcción: extracción libre, totalmente desacoplada de las sesiones (DECIDIDO 2026-09-02; sustituye a la emisión en vivo)

*Cobertura cerrada el 2026-09-15; ver `vision-extraction-coverage.md`: el mensaje es la unidad de cobertura (un registro de huellas cubiertas por chat), las ejecuciones son lotes con presupuesto de tokens de los mensajes sin cubrir más antiguos y el disparador es que los tokens sin cubrir alcancen un presupuesto de bloque (sustituye a everyNQuizAnswers: las sesiones sin quizzes también se extraen).*

**Segunda modificación, que revierte la decisión de emisión en vivo del 2026-08-22.** El árbol del plan de la sesión es el andamiaje del profesor para la experiencia de la sesión (§2); el grafo global no depende de él, ni estructuralmente ni de ninguna otra forma. Lo que formaliza el profesor es relativo a la sesión; el grafo no debe heredar esas decisiones. (La postura a posteriori del documento de diseño original era la correcta, después de todo.)

Tres etapas, una canalización, el único escritor del grafo:

- **Extractor (LLM): ámbito de una sola fuente.** Ve SOLO el texto de origen: una transcripción de sesión (ciega al árbol, con ids de mensaje) o notas en bruto (el segundo prompt de la puerta de entrada, arriba). Informa libremente, con evidencia textual: proposiciones de cualquier parte de la sesión (un paso de razonamiento cada una; la prosa cuenta tanto como cualquier cosa que haya formalizado el profesor), aristas tal como las articula la transcripción, procedencia con granularidad de mensaje, atribución retroactiva de quizzes y, por cada proposición, un **nivel de comprensión**: con qué firmeza aceptó o entendió el alumno la proposición en esta sesión, en una escala CERRADA de palabras con nombre (`solid` / `shaky` / `accepted` / `resisted` / `not yet engaged`; 2026-09-08: impuesta por el esquema: exactamente una palabra, sin números ni justificaciones, que se descartan en lugar de guardarse). Los niveles son datos para el futuro modelo de estado; cómo se tratarán está por decidir.
- **Auditor (LLM): ámbito del grafo global.** Ve la salida del extractor Y el grafo existente. Dos trabajos: la red de fidelidad (cada candidato se verifica contra la evidencia textual; sin cambios) y el **juicio de identidad**: enlazar cada proposición con un nodo existente (registrando la formulación de la sesión como alias) o crearla nueva. Conservador: mejor duplicados que fusiones erróneas.
- **Fusionador (determinista).** Escrituras solo de adición en el registro; los tipos y referencias de los eventos de quiz se reconstruyen mecánicamente a partir de las partes de herramienta de quiz. Todo juicio lo hace un LLM; todo lo mecánico sigue siendo código.

**Registro de eventos (modificado):** los resultados de los quizzes se reconstruyen de forma determinista a partir de las partes de herramienta de quiz (correcto / fallo / no lo sé, más la nota del alumno). **No hay evento `taught`**: no se marcan cosas como hechas. Los niveles de comprensión por proposición del extractor se suman al registro como observaciones limitadas a la sesión (una palabra de la escala cerrada por nodo y sesión). La identidad ya no es coincidencia exacta de cadenas: es el juicio del auditor, con los alias como registro de las formulaciones.

### La puerta de entrada agnóstica del formato: importación de notas (DECIDIDO 2026-09-13)

La misma canalización de tres etapas (extractor → auditor → fusionador) se ejecuta sobre
**notas personales en bruto en formatos arbitrarios**: un vault de Obsidian, Markdown
normal, cualquier cosa textual. El extractor es ciego al formato por construcción (siempre
vio texto renderizado, nunca el JSON de ChatRecord), así que la vía de las notas solo
necesita un segundo prompt de extractor (extracción de propósito general; la palabra de
comprensión juzga el dominio del **autor** a partir de sus propios comentarios) y una
abstracción de fuente: cada fichero importado pasa a ser un registro `NotesSource` (id
determinista a partir del hash de la ruta: reimportar es idempotente), que desempeña el papel
de `chatId` en las correspondencias, los puntos de control y los eventos de observación.

Aristas decididas:

- **Sin dar forma de sesión.** Las notas nunca se fuerzan a transcripciones de
  profesor/alumno; los resultados de quizzes dentro de las notas solo aparecen a través de
  las observaciones de comprensión del extractor (la reconstrucción determinista de eventos de
  quiz es una funcionalidad de la canalización de sesiones: necesita partes de herramienta de
  quiz estructuradas).
- **Procedencia estática.** Los nodos importados muestran la ruta del fichero en la lista de
  sesiones como una entrada estática, nunca como un enlace. Los niveles de evaluación de la
  comprensión se aplican a las notas personales igual que a las sesiones.
- **El mismo registro de una sola ejecución a la vez y la misma observabilidad** que las
  ejecuciones de sesiones: estado en vivo, contabilidad de uso por etapa, aborto real. Una
  instancia de la canalización, dos puertas de entrada (sesiones disparadas por quizzes;
  POST /api/graph/import).

### La comprensión se deriva (modificado 2026-09-02)

Conocido frente a entendido, el registro de eventos como fuente de verdad, el estado derivado recalculado al leer: heredado del documento de diseño en espíritu. El propio modelo de estado es ahora una discusión de diseño explícita: **los estados de los nodos deberían ser independientes de la sesión y calcularse a partir de la profundidad y la fuerza de las dependencias** (la topología `follows`/`supports`) más los eventos de quiz y las notas de comprensión. Ese rediseño está pendiente de ideación; la derivación transitoria de cinco clases (enseñado / conocido / fallado / no lo sé / candidato) se **eliminó** (2026-09-08): la vista del grafo muestra nodos neutros en cuanto al estado hasta que se diseñe el modelo de estado. La rúbrica de calibración anclada sigue aparcada hasta tener datos reales.

### Clústeres: regiones del modelo del mundo (DECIDIDO 2026-09-13, ideación)

Cuando el grafo se llena, el lienzo necesita una estructura legible de un vistazo: **clústeres**, regiones objetivas del modelo del mundo (dominios como «psicoanálisis lacaniano» o «fotosíntesis»), descubiertas mediante **detección de comunidades** sobre las aristas `follows`/`supports`. Una comunidad = nodos mucho más conectados entre sí que con el resto (modularidad). Todo sobre ellos se **infiere por completo de los datos del grafo**: la canalización de extracción y auditoría nunca sabe que existen los clústeres.

- **Algoritmo: Louvain (maximización de la modularidad), con semilla para que sea determinista.** Disponible en nuestro stack a través del ecosistema de graphology, casi lineal, escala muy por encima de nuestros tamaños. El determinismo da reproducibilidad (mismo grafo → mismos clústeres); la elección de semilla/graphology también deja abierto el camino de mejora: el dendrograma de Louvain contiene **jerarquía** («matemáticas ⊃ cálculo diferencial ⊃ regla de la cadena» está un nivel más abajo), que a propósito NO se construye ahora (los clústeres multiescala siguen aparcados). Descartados: Leiden (mejores garantías de resolución, sin versión en JS), Infomap (fuerte en heurística, más pesado, peor soporte en JS), Girvan–Newman (O(n³)), propagación de etiquetas (inestable), espectral (hay que darle k).
- **Estructura, no disposición.** Los clústeres son una función pura de las *aristas*, nunca de la disposición visual. La disposición dirigida por fuerzas ya coloca juntos los nodos estructuralmente cercanos, así que las envolventes de los clústeres se verán contiguas; pero la identidad de un clúster no debe heredar la dependencia de la semilla ni la deriva de la disposición.
- **Derivados, en caché, actualizados solos.** Los clústeres se recalculan cuando cambia el registro, en una caché ligada a una marca de versión del grafo: la misma doctrina que los estados y las fuerzas: derivados, nunca guardados, nada mantenido a mano.
- **Significado limitado por tamaño.** Solo las comunidades de ≥ ~3 nodos se muestran como clústeres (umbral ajustable con datos reales): una mancha visible siempre significa «un dominio real»; los nodos sueltos y las comunidades diminutas se quedan sin más.
- **Nombre: una llamada barata al LLM por cada clúster nuevo o cambiado**: una sola llamada (sin bucle de agente) con los nombres y enunciados de los miembros, que produce una etiqueta corta de dominio. Nunca forma parte de la extracción; es una juntura aparte, con caché.
- **Persistencia de las etiquetas: la regla de supervivencia del núcleo.** Cada registro de etiquetado (solo de adición, como todo lo que guardamos) almacena la etiqueta Y el conjunto de miembros con el que se produjo (el **núcleo**). Una comunidad recalculada **conserva** su etiqueta mientras ≥ la mitad de sus miembros procedan de ese núcleo; cuando son menos de la mitad, se **reetiqueta** con todos los nodos actuales (se añade un registro nuevo; los antiguos se quedan como historia: un rastro de auditoría de cómo se fueron nombrando los dominios). Un único sucesor: en divisiones y fusiones hereda la comunidad con mayor solapamiento y las demás reciben etiquetados nuevos; un núcleo sin sucesor de ≥50 % simplemente no tiene heredero vivo. El color del clúster va ligado al registro de etiquetado: el color sobrevive exactamente lo mismo que la etiqueta.
- **Renderizado: manchas luminosas detrás de todo.** Un contorno discontinuo rodea la envolvente del clúster; el relleno es difuminado, de baja opacidad, y está *detrás* de todo el grafo (las aristas y los nodos flotan por encima, así que el difuminado nubla de forma natural el espacio entre clústeres). Un tono estable por clúster. **Las etiquetas de los clústeres dependen inversamente** del intervalo existente de la relación de cámara: con poco zoom = **vista de dominios** (etiquetas de clúster visibles, de nodo ocultas), con mucho zoom = **vista de proposiciones** (etiquetas de nodo visibles, de clúster atenuadas): una transición simétrica entre las dos vistas de un mismo lienzo.
- **Geometría del contorno: calculada al dibujar, nunca guardada**: una función pura de las posiciones de los miembros. Es la restricción que impide que una futura física o nodos en movimiento (probablemente no se implementarán pronto) invaliden nada: envolvente convexa + margen + esquinas redondeadas es barato en cada fotograma; las envolventes orgánicas tipo metaball son de la misma familia. Secundario hasta entonces.
- **Las aristas entre clústeres siguen visibles.** Los puentes entre dominios tienen significado (la voluntad de poder de Nietzsche *se sigue* de la voluntad de Schopenhauer): son de las lecturas más informativas de la vista con clústeres, no ruido.
- **Riesgo, con honestidad: la dispersión.** La detección de comunidades necesita contraste de densidad, y el grafo real actual es escaso; el benchmark sintético de 2.000 nodos (pregunta abierta 1) es la validación *principal* de la calidad del clustering, no solo de la velocidad de disposición y renderizado.

### Renderizado (DECIDIDO, informe de investigación del 2026-08-22)

**Ajustes de renderizado (2026-09-13):** cuatro controles básicos en la vista del grafo: tamaño de los nodos, grosor de las aristas, longitud de las puntas de flecha y **el control de nivel de zoom** (el umbral de visibilidad de las etiquetas; 1× = zoom de ajuste), guardados por navegador. El control de zoom es a propósito EL único mando de zoom: las etiquetas de los clústeres dependen inversamente de él en el mismo intervalo de transición (implementado: las etiquetas de los nodos se desvanecen a lo largo del intervalo mientras aparecen las de los clústeres; nunca coexisten). Cambiar los ajustes solo reconstruye el renderizador: las posiciones de la disposición y la cámara nunca se mueven. (Los controles de longitud de aristas y espaciado quedan aparcados a propósito hasta que exista un diseño de espaciado que tenga en cuenta los clústeres.)

- **Biblioteca: sigma.js v3 + graphology + graphology-layout-forceatlas2.** ~40 KB comprimidos en total: la mitad que vis-network, un tercio que cytoscape, muy por debajo de react-force-graph (~250 KB de dependencias) y de cosmos.gl (stack de luma.gl).
- **Disposición: ejecutar de forma síncrona y congelar.** `forceAtlas2.assign(graph, { iterations: 100, settings: inferSettings(graph) })` se ejecuta una vez, escribe x/y y nunca arranca ningún bucle de animación: uso de CPU en reposo casi nulo (sigma solo vuelve a dibujar ante eventos de cámara o del grafo). <150 ms con cientos de nodos; con ~2.000, activar `barnesHutOptimize`, después el Web Worker incluido y después posiciones en caché en el servidor, en ese orden, y solo si la latencia molesta.
- **Etiquetas según el zoom:** el `labelRenderedSizeThreshold` de sigma reproduce exactamente el «umbral de atenuación del texto» de Obsidian.
- **Desplazamiento y zoom** incluidos; eventos de hover y clic (`enterNode`, `clickNode`) gratis. Aristas con tipo: `EdgeArrowProgram` y/o dos colores de arista para `follows` frente a `supports`.
- **Integración con React:** un envoltorio fino de ~40 líneas con `useEffect` (sigma es imperativo; `@react-sigma/core` existe pero es opcional).
- **Las tripas de Obsidian (confirmadas por la investigación):** renderizador **WebGL** de PixiJS (con respaldo en canvas), una simulación propia al estilo de d3-force (sus cuatro deslizadores de fuerzas corresponden 1:1 con primitivas de d3-force), atenuación de etiquetas según el zoom, asentamiento por decaimiento de alfa. El stack elegido reproduce esa sensación con una biblioteca documentada y mantenida.
- Descartados: vis-network / cytoscape.js (Canvas 2D, 3× de tamaño de bundle, funciones de edición que no necesitamos), react-force-graph-2d (la mejor API de congelación pero el árbol de dependencias más pesado; su fuerte es la simulación *animada*, que explícitamente no queremos), cosmos.gl (fuerzas en GPU: excesivo por debajo de ~10.000 nodos).
- Validación previa a la implementación (barata): benchmark sintético de 2.000 nodos para confirmar el tiempo de disposición y la fluidez del renderizado antes de comprometerse.
- La física es **solo para colocar**: sin arrastrar, sin deslizadores, sin interacciones de edición. Solo desplazamiento + zoom.

### El grafo como contexto de la sesión (DECIDIDO 2026-08-22)

*Problema de selección V1 cerrado el 2026-09-14; ver `vision-context-injection.md`: top-K por cercanía semántica con un presupuesto de tokens por sesión, entregado como reorientación. Las estrategias de vecindario estructural y de puntos calientes diagnósticos que siguen quedan aparcadas.*

Cada sesión empieza con el grafo de conocimiento del alumno como contexto base para el profesor. Es lo que hace que el sondeo sea *preciso*: las preguntas de sondeo pueden apuntar a sutilezas y matices en el límite de lo que el alumno domina realmente, en lugar de redescubrirlo desde cero en cada sesión. La personalización se acumula entre sesiones.

**El problema de selección (abierto):** con el tiempo, el grafo entero puede ser demasiado contexto, y relevancia pedagógica ≠ cercanía semántica. Lo que importa para un tema nuevo: (a) su **vecindario estructural**: el subárbol de aristas `follows` sobre el que se apoya el tema, sea cual sea su parecido superficial; (b) **puntos calientes diagnósticos**: nodos que el registro marca como inestables / mal entendidos / con errores conceptuales, en cualquier parte del grafo (un error conceptual vivo —eventos que muestran que el alumno entiende mal un nodo— siempre es contexto relevante); (c) la franja de la frontera cercana al tema. Estrategias candidatas, a ajustar con datos reales: el grafo entero mientras sea pequeño; vecindario estructural a k saltos alrededor de los nodos del tema; porciones guiadas por el registro (primero lo débil, con errores conceptuales o suelto); una pasada de enrutamiento barata que elija subárboles según el tema de la sesión.

### Página de inicio

La vista del grafo sustituye al marcador de posición actual. v1: todos los nodos de todas las sesiones, desplazamiento y zoom, etiquetas según el zoom, nodos neutros en cuanto al estado (ver «La comprensión se deriva») y, cuando se implementen, manchas luminosas de clústeres con envolventes discontinuas detrás del grafo, con dominio↔proposición como las dos vistas que dependen del zoom (ver «Clústeres»). Al hacer clic en un nodo → los puntos exactos (sesión, mensaje) en los que apareció (procedencia con granularidad de mensaje, con enlace profundo). Todo lo más rico (brillo de la frontera, mapa de deterioro, radio de impacto) llega cuando exista el modelo de estado.

---

## 2. La experiencia de la sesión: no un chat genérico

Objetivo: una sesión de aprendizaje debe verse y sentirse estructuralmente distinta de una conversación de ChatGPT o Claude. Lo que marca la diferencia es convertir el **árbol de dependencias** de la sesión en un objeto formal, visible y editable por el agente, en lugar de un boceto de mermaid desechable.

### El árbol formal del plan (DECIDIDO)

- El agente escribe el árbol con **herramientas estructuradas** (`add_node`, `add_edge`, `reparent`, `remove_node`, `set_current`, …), validadas por esquema, con identidad estable de los nodos entre ediciones. Se descartó el texto de mermaid como fuente de verdad: las ediciones serían cirugía de texto y la identidad derivaría.
- El agente puede editar el árbol a mitad de la sesión por iniciativa propia (desviarse cuando el alumno pregunta algo que merece explorarse, profundizar, podar): ese poder es explícito.
- El árbol es **solo andamiaje de la sesión**: el grafo global se construye mediante una extracción libre a posteriori que es ciega al árbol a propósito (§1, construcción). Nada estructural pasa del árbol al grafo.
- **«Dónde estamos»** se registra como estado estructurado (una herramienta `set_current`), no se infiere de la transcripción.
- **Mermaid sobrevive solo para diagramas de lección puntuales** (flujos, ciclos, comparaciones) que no son el árbol del plan, y al profesor se le **anima explícitamente a hacer diagramas libremente en las explicaciones**; los diagramas son salida de enseñanza de primera clase, no decoración. Su calidad de renderizado debe mejorar (presentación integrada, zoom y desplazamiento que funcionen; el renderizado actual, con aspecto de bloque de código, es inaceptable), pero ahora es una cuestión periférica.

### Dos fases, claramente separadas (DECIDIDO)

- **Sondeo** y **enseñanza** son las dos fases reales; planificar no es una fase, solo un momento (quizá un pequeño indicador).
- El agente señala la transición sondeo→enseñanza con una marca estructurada → **separador visible en la transcripción**.
- **Las preguntas de la fase de sondeo se abren solas** (como ahora: son la sustancia del sondeo).
- **Las preguntas de comprobación de la fase de enseñanza empiezan plegadas** tras un botón de revelar "Check your understanding". Motivo: una pregunta que salta a mitad de la lección presiona al alumno para responder de inmediato; el alumno debería leer primero la explicación y abrir la comprobación cuando esté listo.

### Demos interactivas: artefactos escritos por el profesor (DIRECCIÓN DECIDIDA)

El runtime de demos más general y capaz es el que ya publicamos: **la propia plataforma web.**

- **Un único formato: un documento HTML/JS autocontenido en un solo fichero**, producido por una herramienta `demo` (del lado del cliente, como quiz/ask) y renderizado en línea en la transcripción dentro de un **iframe aislado** (`sandbox="allow-scripts"`, sin mismo origen → sin acceso al almacenamiento, las cookies ni el DOM de la app). JS sin frameworks + Canvas 2D + SVG cubre la inmensa mayoría de las demos de enseñanza (gráficas de funciones, simulaciones, animaciones, barridos de parámetros); se permiten importaciones desde CDN para lo más pesado (gana la generalidad: es la propia máquina del alumno y el código lo escribió el profesor).
- **El contrato importa más que la tecnología:** (a) un pequeño script puente inyectado automáticamente: ResizeObserver → postMessage → el padre ajusta el tamaño del iframe; (b) captura de `window.onerror` enviada al padre → chip de error en la demo → el alumno (o el flujo automático) devuelve el error al profesor, que la corrige y vuelve a emitir la demo. El bucle de corrección es donde surge la calidad de los Artifacts. (c) Volver a llamar a la herramienta = una nueva versión del artefacto.
- **La persistencia sale gratis:** el HTML vive en la parte de herramienta del mensaje, así que las demos se vuelven a renderizar al recargar la sesión.
- **Python: aplazado.** Pyodide (CPython en WASM; numpy funciona; matplotlib renderiza figuras estáticas) es la única vía sin servidor: pesada (descarga diferida de 10–20 MB) y mala para la interactividad (vuelve a renderizar orientado a imágenes estáticas). Revisar cuando una sesión necesite de verdad cálculo al nivel de numpy. **Python en el servidor: descartado** (infraestructura de sandbox, portabilidad).
- El prompt de sistema debería empujar hacia las demos igual que empuja hacia los diagramas: *si el concepto es dinámico —un parámetro que barrer, un proceso que animar, una distribución que muestrear—, construye el instrumento, no lo describas.*

### Notas, pensar en voz alta y dictado (DIRECCIÓN DECIDIDA; se construye más adelante)

El campo de notas no es una entrada auxiliar: es el canal en el que el alumno **razona en voz alta**. La lección debería evolucionar a partir de él: al profesor se le pide que provoque que el alumno se explaye ("talk me through your reasoning"), que haga referencia más tarde a las propias palabras del alumno, y las notas alimentan el grafo como eventos diagnósticos (según el documento de diseño: las notas son oro para la calibración). Las notas reciben un tratamiento más destacado en la interfaz.

**El dictado es un requisito, no un lujo**: explayarse significa hablar, no teclear. Lo que exige en la web:
1. **Captura:** `getUserMedia` + AudioWorklet → PCM lineal de 16 bits a 16 kHz (nativo del navegador; sustituye al sox/`rec` de la extensión de pi).
2. **Transporte + transcripción:** la receta probada de la extensión `dictate` de pi se traslada directamente: streaming de Deepgram (`nova-3`, `smart_format`, `punctuate`, `endpointing=300`), resultados finales por enunciado. Arquitectura: una ruta del servidor emite un **token de Deepgram de vida corta** y el navegador se conecta directamente al WSS de Deepgram (la clave de API nunca llega al cliente). Whisper en el dispositivo (transformers.js/WebGPU) es la alternativa privada y sin conexión; aplazada salvo que Deepgram decepcione.
3. **Experiencia de uso:** botón de micrófono en la burbuja del compositor; medidor de nivel en vivo (AnalyserNode: los visuales reactivos de la extensión de pi rehechos para la web); la transcripción cae en el área de texto o el campo, editable antes de enviar; Escape cancela; **un dictado terminado nunca se pierde** (lecciones de experiencia de uso aprendidas a pulso en la extensión de pi).

### No es un chat: el principio de presentación (dirección, 2026-08-22; PRIORIDAD BAJA)

Una sesión es funcionalmente una conversación: el alumno habla, razona y reorienta constantemente; ese flujo en dos sentidos es *como mejor funciona*. Pero nunca debe **presentarse** como un chat. Olvídate por completo de la interfaz de chat. La resolución de esta paradoja:

**Asimetría de artefactos.** En un chat, las dos partes producen el mismo objeto (mensajes) en el mismo carril; eso es lo que hace que *parezca* un chat. En una lección, las dos partes producen cosas fundamentalmente distintas:

- **El profesor escribe el documento.** Prosa, secciones, diagramas, demos, comprobaciones: la salida del profesor es estructural; se convierte en el propio artefacto de la lección. El profesor no «envía mensajes»; *escribe la lección*. (La pizarra.)
- **El alumno escribe en los márgenes.** Respuestas, preguntas, razonamientos, explayamientos: contribuciones ancladas a puntos del documento. (El turno de palabra / la voz.) *(Modificado más abajo: tarjetas de intervención intactas en la columna vertebral; los márgenes pasan a ser una vista, no almacenamiento.)*

Dos instrumentos distintos, no dos teclados idénticos. Consecuencias:

- **Mueren las burbujas.** El texto del profesor se renderiza con tipografía de documento (encabezados, prosa, bloques a todo el ancho). El texto del alumno se renderiza como bloques de anotación (tarjetas de nota con borde, citas ancladas), nunca como burbujas alineadas a la derecha.
- **La unidad es el bloque, no el mensaje.** Secciones, párrafos, diagramas, demos, comprobaciones, recuadros de preguntas y respuestas, notas al margen.
- **La cronología cede ante la estructura.** *(Modificado más abajo: una única columna vertebral cronológica; la estructura entra mediante bloques con tipo y la capa de enlaces, no recolocando.)*
- **Las preguntas y respuestas se convierten en mobiliario del documento.** Una pregunta del alumno se renderiza como una tarjeta citada con la respuesta del profesor como prosa debajo: un recuadro de «pregunta del lector» de libro de texto, no un par de turnos.
- **El compositor se convierte en un campo de respuesta.** La misma burbuja flotante, replanteada: lo que produce cae como una anotación anclada a la posición actual, no como la siguiente burbuja de un flujo.
- Lo que se queda: los turnos por debajo; el LLM sigue viendo una conversación. Es un cambio de la **capa de presentación**, no del modelo de interacción.

Referencias: las anotaciones al margen de los libros de texto, las anotaciones de Hypothesis/Genius, los notebooks de Observable (un documento de celdas vivas), el seminario con pizarra y turno de palabra. El vocabulario importa: son **sesiones/lecciones**, nunca «chats».

### Refinamiento: la columna vertebral y la intervención (2026-08-22, tras recibir comentarios)

El modelo de márgenes de arriba tiene dos defectos reales, detectados en la revisión: (a) **colocación**: cuando un alumno envía un gran bloque explayándose con preguntas sobre muchas cosas distintas, llevar cada fragmento al ancla correcta exige un paso poco fiable de dividir y enrutar; (b) **acuse y cronología**: repartir el bloque del alumno por los márgenes significa que pulsa enviar y *no pasa nada visible*, y se pierde el cuándo y el qué de su propia aportación. Además, el valor de una sesión está sobre todo **en el momento**: las sesiones pasadas casi nunca se revisan, así que optimizar para el artefacto relegible fue una prioridad equivocada (y la exportación a HTML pierde prioridad).

El modelo evolucionado mantiene lo que mata al chat (la asimetría) y abandona la recolocación:

- **Una única columna vertebral cronológica.** Todo se renderiza en orden temporal en la frontera. El bloque del alumno se queda **intacto, visible y con marca de tiempo**, siempre.
- **El bloque del alumno es una tarjeta de «intervención», no una burbuja.** Una especie de bloque distinta: a todo el ancho, tintada, con una regla a la izquierda y el antetítulo `You · 3:41 PM` (insignia de micrófono si se dictó). Nunca alineada a la derecha, nunca una burbuja. La sensación de chat muere por **la asimetría de tipos y la tipografía de documento**, no recolocando las palabras del alumno.
- **La respuesta del profesor es contenido tejido en el documento.** Un explayamiento con varias preguntas recibe un **interludio de preguntas y respuestas**: el profesor cita cada fragmento y responde en prosa debajo (los LLM son buenísimos de forma natural en citar y luego responder: contextualidad sin mover el texto del alumno). El momento de enviar tiene recompensa estructural: el árbol puede actualizarse visiblemente (nodos de desvío) y después el interludio se escribe solo.
- **El anclaje sobrevive como una capa de enlaces, nunca como recolocación.** Cuando una pregunta se refiere claramente a un pasaje anterior, se adjunta un enlace profundo (y un enlace de vuelta en el pasaje: «preguntado aquí ↩»). Más adelante, el margen o el panel pueden *mostrar* «preguntas asociadas a este nodo» como una **vista** calculada: una lente, no almacenamiento. Sin dispersión; cronología intacta; la ayuda para repasar se conserva como subproducto.

### Identidad estructural: en qué se diferencia una sesión de un chat (ideación, 2026-08-22)

Un chat tiene dos tipos de burbuja, amnesia en cada mensaje y ningún estado. Lo que el medio nos permite hacer en su lugar, primero los candidatos más fuertes:

1. **La transcripción se convierte en el documento de la lección.** No una lista plana de mensajes: un documento **dividido en secciones por nodo del árbol**, escrito en vivo: cada sección encabezada por su nodo, plegable, con la sección actual resaltada. El artefacto que se produce es un capítulo de libro de texto generado, no un registro de chat. Navegar por el árbol navega por el documento. *(La mayor ruptura individual con la experiencia con forma de chat.)*
2. **Progresión con puertas.** Las comprobaciones son puertas, no chat: demostrar comprensión es lo que hace avanzar el árbol; los nodos se completan visiblemente, los siguientes se desbloquean y, en las bifurcaciones, **el alumno elige la rama** («dos caminos desde aquí: elige»). ChatGPT nunca pone puertas a nada.
3. **Bloques con tipo y una gramática visual distinta.** Enseñanza / comprobación / demo / diagrama / razonamiento del alumno / preguntas y respuestas: seis tipos de bloque con seis aspectos, frente a las dos burbujas del chat.
4. **Estado de la sesión siempre visible.** Una franja fina persistente: nodo actual, fase, lo que se ha establecido hasta ahora en esta sesión, los prerrequisitos del nodo actual. La superficie contra la amnesia.
5. **Las sesiones empiezan con recuperación.** Una tarjeta de recuerdo de 60 segundos sacada del registro de eventos («la última vez, sobre X…») antes de nada nuevo: semilla de repetición espaciada; cada sesión empieza con práctica de recuperación, no con una caja en blanco.
6. **La sesión se compila en un artefacto duradero.** Una página de lección relegible (secciones, tus notas, tus resultados, tus demos); con el tiempo, los nodos del grafo enlazan de vuelta a la sección que los enseñó. Los registros de chat son de solo escritura; esto es un libro de texto personal que crece.
7. **Las ediciones del árbol son eventos visibles.** Cuando el profesor reestructura a mitad de la sesión (desvío, profundización, poda), el cambio se ve: el mapa que evoluciona a la vista refuerza que esto es un viaje, no un hilo.

Se evita explícitamente: la gamificación (XP, rachas, confeti). La estructura es epistémica, no skinneriana.

### Vista persistente del árbol (DECIDIDO)

- **Panel plegable a la derecha** en la interfaz de la sesión: el árbol entero, en todo momento, con una separación visual clara entre nodos y estados (hecho / actual / siguiente / pendiente), plegable a una franja fina.
- Este panel y las herramientas del agente comparten los mismos datos subyacentes: el árbol es un objeto con dos caras (el agente lo edita, la interfaz lo renderiza).

---

## 2.5 Arquitectura de subagentes (DECIDIDO 2026-08-22)

La ventana de contexto y la atención del profesor son valiosas: tiene que llevar la lección y manejar las herramientas del árbol del plan. **El trabajo mecánico, caro en tokens y caro en tiempo se externaliza a subagentes en segundo plano.** Normas de la casa:

- **Asíncrono, siempre.** Los subagentes se ejecutan en segundo plano y nunca bloquean la lección. La interfaz muestra **indicadores de actividad** en vivo: lo que está haciendo ahora mismo cada agente en ejecución (llamada a herramienta actual + argumentos), no su sesión completa. Workers sin interfaz con un flujo de estado.
- **Los subagentes verifican; nunca lo hacen a la primera sin comprobar.** Esta es la asimetría que hace que merezca la pena externalizar:
  - **Constructor de demos**: construye demos interactivas (los artefactos de §2) y **prueba que el código se ejecuta de verdad** (ejecución sin interfaz) antes de que nada llegue a la sesión. Ninguna demo se hace a la primera en vivo.
  - **Creador de visuales** (SVG y otros visuales precisos): renderiza, **mira el resultado** e itera hasta que es correcto. Adaptación directa del agente `svg-maker` de la prueba de concepto del vault (`.pi/agents/svg-maker.md`: `write_svg` / `edit_svg` / `render_svg` + la única regla que importa: verificar mirando).
  - **Mermaid no necesita subagente**: el profesor escribe mermaid en línea; los LLM lo hacen bien y su modo de fallo se ve de un vistazo.
- **Investigador (verificación de hechos)**: una herramienta a la que llama el profesor para comprobar hechos e información. Otro bucle de agente solo con `web_search` + `web_fetch`. Adaptación directa de dos piezas probadas: las extensiones `web-search` / `web-fetch` de pi (`~/.pi/agent/extensions/`) y el prompt de sistema del investigador (`~/.pi/agent/extensions/interactive-subagents/agents/researcher.md`: dividir en facetas → búsquedas desde ángulos variados → descargar las fuentes primarias principales → sintetizar un informe autónomo y con fuentes).
- **Forma de la implementación (Next.js):** bucles de agente en segundo plano en el servidor, eventos de estado enviados en streaming al cliente para los indicadores; los resultados vuelven al profesor como salidas de herramienta (artefacto + resumen), manteniendo fuera del contexto del profesor el ruido de búsquedas y renderizados.

---

## 3. Capa de presentación (anotado, aún sin programar)

**Contrato actual para escribir matemáticas (2026-10-12):** `$...$` estándar en línea y `$$...$$` en líneas separadas para mostrar en bloque. Sustituye a la regla de abajo del dólar solo para moneda; el contenido bien formado con delimitadores de barra invertida sigue siendo legible. La restauración existente de escapados JSON también reconoce los nuevos delimitadores, con sus reglas de recuperación sin cambios. Se aplazan más ejemplos, la validación de las matemáticas, las reparaciones de escapados excesivos y el rediseño del transporte. Las decisiones originales de W3 que siguen son históricas.

- **Delimitadores de LaTeX: pasar a la convención de ChatGPT.** Matemáticas en línea `\(...\)`, en bloque `\[...\]`. El `$` suelto se retira de las matemáticas y se reserva para la moneda (acabando para siempre con el peligro del signo del dólar, tanto en la salida del profesor como, más adelante, en la entrada del usuario). Vía técnica: preprocesar `\(...\)`/`\[...\]` → forma compatible con remark-math (o una extensión de micromark dedicada), más una actualización del prompt de sistema. El contrato antiguo de `$`/`$$` muere con este cambio.
- **Error de saltos de línea:** el texto de la lección pierde los saltos de línea simples (la semántica de Markdown los colapsa; corrección probable: `remark-breaks`, o disciplina de líneas en blanco en el prompt; verificar y corregir).
- **Formato del contenido de la lección:** presentación más rica y estructurada de los bloques de enseñanza (encabezados, destacados, ejemplos resueltos); dirección anotada, detalles por decidir.
- **APARCADO (largo plazo):** un editor rudimentario de LaTeX / vista previa en vivo en el compositor para que el alumno pueda enviar matemáticas con formato.

---

## 4. Hoja de ruta (ordenada por dependencias)

1. **Herramientas del árbol del plan + estado de la sesión**: herramientas estructuradas, árbol guardado en el almacén de chats, seguimiento con `set_current`. (Todo lo demás depende de esto.) **✅ Oleada 1 (W1): 8 herramientas validadas como DAG, fragmento de prompt, verificado en vivo (plan_init + set_current en una sesión real).**
2. **Grafo global básico + vista de inicio**: emisión en vivo desde las herramientas del árbol a un almacén del grafo, fusión por unión ingenua, la página de inicio lo renderiza con el renderizador ligero elegido. *Es el hito de «ver aparecer algo incluso desde una sesión parcial».* **✅ Oleada 2 (W4): registros JSONL, emisión idempotente, vista de inicio con sigma.js + forceAtlas2, puesta al día con foldStaleChats. Verificado en vivo.**
3. **Separación de fases**: marca de sondeo/enseñanza, separador en la transcripción, comprobaciones de la fase de enseñanza plegadas. **✅ Oleada 2 (W5): phaseAt desde el primer plan_init, separador "Teaching · N nodes", barra de invitación + revelado. Verificado en vivo.**
4. **Vista del árbol en el panel derecho**: persistente, con resaltado de la posición actual. **✅ Oleada 3 (W7): orden topológico, hecho/actual/siguiente/pendiente, cabecera de progreso, plegado a barra lateral persistente. Verificado en vivo.**
5. **Consolidación en segundo plano → canalización de extracción libre**: arbitraje de fusiones, calibración, aristas solo a partir de la prosa. **◐ La oleada 3 (W8, ligera) publicó la fusión por coincidencia exacta y por alias + la inyección del grafo como contexto. Dirección sustituida (2026-09-02): la canalización pasa a ser una extracción libre a posteriori (extractor solo de la sesión → auditor con juicio de identidad sobre el grafo global → fusionador determinista), ciega al árbol, con procedencia por mensaje, sin eventos de enseñado y con notas de comprensión por proposición. Lo siguiente es una implementación mínima de la filosofía de §1.**
6. **Capacidad de demos**: el contrato del artefacto `demo` (iframe aislado, bucle de corrección de errores) + el **subagente constructor de demos** que prueba el código antes de entregarlo (§2.5). Mucho valor; encaja en cualquier momento después del paso 1. **✅ Oleada 2 (W6): herramientas de demo y visual, constructores que verifican (Chrome sin interfaz), tarjeta de demo aislada, tarjeta SVG. Verificado en vivo (el visual necesita un LH_VISUAL_MODEL con visión).**
6b. **Herramienta de investigación**: verificación de hechos para el profesor (§2.5); adaptación barata de piezas probadas de pi. **✅ Oleada 1 (W2): protocolo de tareas asíncronas, tarjeta de actividad en vivo, informe con fuentes, continuación del profesor. Verificado en vivo.**
7. **Correcciones de presentación**: delimitadores de LaTeX, saltos de línea, integración de mermaid. **✅ Oleada 1 (W3): contrato \(…\)/\[…\] ($ literal para siempre), remark-breaks, mermaid oscuro + interfaz de streamdown con estilos. Verificado en vivo.**
8. **Candidatos de identidad estructural** (de la ideación de §2, pendientes de selección): transcripción como documento de lección por secciones, progresión con puertas, bloques con tipo, franja de estado de la sesión.
9. **Más adelante:** dictado (emisión de tokens de Deepgram + captura con AudioWorklet), ampliación de la frontera + consultas de qué viene después (territorio nuevo / reparaciones / conversiones), repetición espaciada sobre el registro de eventos, ejercicios de práctica, Electron.

---

## 5. Preguntas abiertas

1. ~~Biblioteca de renderizado del grafo + arquitectura de disposición~~: **decidido el 2026-08-22: sigma.js + forceatlas2, ejecutar y congelar** (ver §1). Pendiente: ejecutar el benchmark sintético de 2.000 nodos antes de implementar.
2. ~~Temas que se solapan entre sesiones~~: resuelto por el modelo del 2026-09-02: la identidad es el juicio del auditor (enlazar o crear, con los alias como formulaciones); los duplicados son aceptables y corregibles, las fusiones erróneas no.
3. ~~Preguntas de sondeo cuando aún no existe árbol~~: resuelto por la extracción libre: la atribución de quizzes es retroactiva contra toda la transcripción (juicio del extractor, verificado por el auditor), sin depender en absoluto del árbol.
4. Interacciones del grafo de inicio v1 más allá del desplazamiento y el zoom (¿clic en un nodo → lista de sesiones? Se presupone que sí y que es barato).
5. Frecuencia de los desajustes de granularidad (relaciones del tipo `subsumes`): según el documento original, la miden los datos, no se resuelve de antemano.
6. Semántica de agregación de la comprensión (mínimo / media / dos niveles): ajustar con datos reales, según el documento original.
7. Detalles visuales de los clústeres: estética del contorno (envolvente convexa frente a orgánica), colocación y tipografía de las etiquetas, paleta; decidir durante las pruebas visuales con manchas reales (§1, Clústeres; teoría DECIDIDA el 2026-09-13).
8. Umbral de tamaño de los clústeres (~3): ajustar con el benchmark sintético + datos reales (§1, Clústeres).

---

## Modificaciones al documento de diseño del vault (2025-08-20): resumen

| Original | Ahora |
|---|---|
| El profesor nunca se modifica; el grafo se construye a posteriori | A posteriori de nuevo (2026-09-02): extracción libre, totalmente desacoplada del formalismo de la sesión; la reversión de emisión en vivo del 2026-08-22 queda a su vez revertida |
| Nodos de errores conceptuales como estructura de primera clase | Sin `kind` de nodo: cada nodo es una proposición verdadera; los errores conceptuales entran como correcciones verdaderas y el error vive en el registro de eventos |
| Aristas `requires` | `follows` / `supports`: derivabilidad frente a fundamentación; la fuerza se deriva al leer, nunca se guarda |
| Eventos `taught` (marcar cosas como hechas) | Eliminados; en su lugar, el extractor registra notas de comprensión por proposición (escala de palabras con nombre) como observaciones limitadas a la sesión |
| Escala de comprensión estandarizada (2026-09-08) | La nota pasa a ser una escala cerrada de cinco palabras (`solid`/`shaky`/`accepted`/`resisted`/`not yet engaged`), impuesta por el esquema de extracción: sin números ni prosa; las justificaciones del agente se descartan |
| Procedencia de nodos y aristas por chat | Procedencia por mensaje (chat, mensaje) en nodos y aristas: los puntos exactos de derivación |
| `name` + `statement` en los nodos | `statement` (proposición mínima, la etiqueta que se renderiza) + `description` (desarrollo obligatorio) + `aliases` (formulaciones textuales) |
| `statement` + `description` (2026-09-02) | `name` (etiqueta muy corta, el identificador que se renderiza) + `statement` (precisión completa, ancla de identidad, tarjeta de detalle); `description` eliminado: las etiquetas de frase completa en el lienzo saturaban el grafo (2026-09-08, al ver datos extraídos reales) |
| Actualizaciones por sesión completada | Continuas; las sesiones parciales aportan valor |
| DAG de mermaid como artefacto del plan | Herramientas estructuradas como fuente de verdad; mermaid solo para diagramas puntuales |
| Interfaz aplazada, «no importante» | La interfaz existe (Next.js, v3.4); la vista del grafo es la página de inicio de la app |
| pi como dependencia central | pi eliminado; el arnés es Next.js independiente + Vercel AI SDK |
