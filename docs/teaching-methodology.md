# La teoría del aprendizaje y la enseñanza

*(Teoría del propietario, formulada el 2026-09-24. Este documento es la capa canónica de la teoría: los prompts del sistema son una compresión de él. Alcance: la teoría en sí y lo que exige a la implementación. No es una especificación de la implementación.)*

## 1. Dos estados de conocimiento

Una sesión está delimitada por dos estados:

- **Comprensión actual**: todo lo que el alumno tiene asentado en ese momento. Lo que un alumno *tiene asentado* es, por definición, lo que acepta como obviamente cierto. El estado actual es el conjunto de proposiciones asentadas: aceptadas, evidentes por sí mismas, seguras para construir sobre ellas.
- **Comprensión objetivo**: la meta de la sesión, lo que el alumno quiere tener asentado y aún no tiene. A menudo le cuesta formularlo; concretarlo forma parte de definirlo.

La fase de sondeo define ambos estados con precisión: acota la comprensión actual (qué está asentado y dónde termina) y concreta el objetivo. Después, la enseñanza lleva al alumno del primer estado al segundo.

## 2. Aprender es que el objetivo resulte obviamente cierto

La condición final de una sesión no es el recuerdo, ni ser capaz de responder preguntas, ni la cobertura: es que la **comprensión objetivo le resulte obviamente cierta** al alumno. La solidez de la comprensión se mide en evidencia por sí misma. Un hecho que se puede recitar pero que no resulta evidente no está aprendido; está memorizado, y los hechos memorizados se pudren. Un hecho que resulta obviamente cierto está asentado.

Este es también el mecanismo de la retención: el cerebro solo se compromete del todo con un hecho cuando es seguro fijarlo (nada más fundamental podría contradecirlo después) y cuando está conectado (sujeto en su sitio por sus relaciones, no por la repetición). Que algo resulte obviamente cierto *es* la experiencia sentida de que se cumplen ambas condiciones.

## 3. El clic: hechos sueltos que se condensan en generadores

El aprendizaje tiene un momento de recompensa característico, y no es la llegada del último hecho. El clic es lo que le ocurre al conocimiento que ya se tiene: hechos sueltos y aislados —que se saben ciertos, pero que se sostienen como «es así y punto», sin conexión— se condensan en una estructura generada por unos pocos hechos base. Cada nodo suelto que antes había que sostener por sí solo se ve ahora como consecuencia de algo más fundamental; el montón se convierte en una derivación. Saber por qué en lugar de saber que: la forma más sólida de comprensión y la prueba sentida más clara de que se ha construido estructura.

La condición final de la sesión (sección 2) es el estado final del mismo fenómeno: la comprensión objetivo no llega como otro hecho suelto, sino que se ve como consecuencia de la estructura, obvia porque la estructura la genera.

## 4. El conocimiento es estructura

La comprensión es un grafo: **proposiciones como nodos, conexiones como aristas**. Las conexiones entre hechos —y los pasos de razonamiento que llevan de un hecho a otro— son a su vez hechos: se pueden enunciar, examinar y asentar. En la mente del alumno, una proposición nueva que no se conecta con nada es frágil; una proposición encajada en una estructura se preserva sola. Toda la enseñanza consiste en construir esa estructura.

## 5. Enseñar = afirmar hechos en un orden, un paso de razonamiento cada vez

El acto atómico de la enseñanza es exponer al alumno a un hecho. Una lección entera es: **hechos, en el orden correcto, cada uno presentado de la forma más clara posible.**

El orden lo rige una sola regla: **avanzar un paso de razonamiento cada vez.** Se parte de lo que el alumno tiene asentado (obviamente cierto por definición; sección 1). Cada hecho nuevo se une a lo ya asentado mediante un *único* paso de razonamiento. Un único paso es lo bastante pequeño para comprenderse entero de una vez y, como se deduce de lo asentado, no solo se sigue lógicamente: llega como algo obviamente cierto en sí mismo.

De ahí se siguen dos consecuencias inmediatas:

- **Cada llegada es evidente por sí misma.** Cada paso amplía la estructura asentada con una conexión, así que el hecho nuevo hereda la obviedad de aquello en lo que se apoya. Toda la sesión es una cadena de pequeños momentos de «claro», que termina en el objetivo.
- **Los errores salen a la luz al instante.** Una laguna o una idea equivocada se revela en el momento en que se pisa, no tres nodos después, cuando ya está corrompido todo lo construido encima. Como el paso era pequeño, el fallo queda localizado con precisión; refuerza o repara el punto débil *antes de continuar*, y no construyas nunca sobre algo que todavía no se tenga por obviamente cierto.

## 6. Fundamentos

La mayoría de los hechos se derivan de lo asentado. Pero algunas proposiciones que la lección necesita no pueden derivarse de nada de lo que el alumno tiene asentado: necesitan **nodos fundamentales**, el fondo del árbol de dependencias. Un hecho fundamental tiene que aceptarse *tal cual*, y por eso los fundamentos deben ser **incondicionalmente ciertos**: lo bastante simples para aceptarlos sin más, sin salvedades ni matices.

Los fundamentos también pueden estar **motivados**: un problema, una pregunta o una condición que exija el hecho facilita aceptarlo. Motivar no es derivar —facilita la aceptación sin hacer que el hecho se siga—, pero es el mismo mecanismo de la obviedad: un hecho que responde a una pregunta que uno siente es más fácil de tener por evidente que uno que llega de la nada.

Derivación y fundamento son los dos movimientos de colocación: deriva cuando la lección puede llegar al hecho desde lo asentado; coloca un fundamento cuando no puede. (En los prompts del sistema son el Principio ii y el Principio i; los dos principios son la forma práctica de esta sección.)

## 7. El aprendizaje óptimo son dos optimizaciones independientes

### 7a. Reparto del esfuerzo: el esfuerzo del alumno va al material

El alumno tiene un esfuerzo mental finito por sesión. Optimiza su **proporción**, no su cantidad:

- **Maximiza** la fracción que va al contacto directo con el material, la instalación real de la comprensión: seguir pasos, responder comprobaciones, asentar los hechos nuevos.
- **Minimiza** todo lo que no sea instalación directa: la logística. Averiguar qué aprender, en qué orden y con qué fuente. Investigar, verificar datos, planificar, buscar recursos, juzgar la fiabilidad.

La idea *no* es reducir el esfuerzo del alumno: pelearse con el material es lo que hace que se fije. La idea es que todo ese esfuerzo vaya al material. El sistema absorbe la logística; el alumno nunca.

### 7b. El árbol mínimo: el grafo de dependencias más pequeño entre lo actual y el objetivo

La lección recorre una estructura de dependencias: hechos que requieren otros hechos. La optimización: **el árbol mínimo**, el conjunto más pequeño de proposiciones, con la menor profundidad de derivación, que lleva de la comprensión actual al objetivo.

- No se vuelve a enseñar nada de lo que el alumno ya tiene asentado: el sondeo poda esas ramas.
- No se enseña nada que quede fuera del camino al objetivo, por interesante que sea: la cobertura no es el objetivo.
- La ruta se busca al planificar, no se improvisa al enseñar. La planificación es el trabajo con más palanca de la sesión y merece pensarse de verdad; ahí se decide la calidad de la lección.

El plan que ve el alumno es una **vista de menor resolución** de este árbol: un mapa estructural de la lección a un nivel de abstracción grueso, no los pasos de razonamiento literales. Los nodos del plan no se corresponden uno a uno con los pasos de razonamiento ni con los turnos de enseñanza. El paso de razonamiento es la unidad fina que de verdad se recorre al enseñar; el árbol del plan es el paisaje que atraviesa. Ambos existen, a resoluciones distintas, a propósito.

## 8. Presentación: la forma más clara de cada paso

Cada paso de razonamiento debe presentarse de la forma óptima para su absorción: la más clara y mejor articulada, para que la instalación de la nueva comprensión sea lo más fluida posible y cada paso llegue como algo evidente.

El modo de presentación se elige **para cada paso**, como medio para la claridad, nunca como ritual:

- Algunos pasos se entienden mejor enunciados explícitamente. Las verdades incondicionales, por ejemplo, suelen funcionar mejor afirmadas sin rodeos como hechos («esto es cierto; acéptalo»).
- Casi todo el tejido conectivo funciona mejor entretejido en el flujo que anunciado. Una derivación que dice en voz alta «ahora estableceré X y luego lo conectaré con Y» obliga al alumno a procesar la *coreografía de la lección* en lugar del material: logística que la teoría dice que hay que eliminar. El razonamiento debe sostenerse solo: prosa fluida en la que el hecho siguiente llega como la consecuencia obvia del anterior.
- El fallo que esto corrige no es la explicitud, sino la **verbosidad**: escenificar el método (segmentos etiquetados, estructura repetida, metanarración) en lugar de hacer el trabajo. Cada frase o instala comprensión o es sobrecarga; la sobrecarga tiene que ganarse su sitio.

La explicitud es una herramienta. La presentación de un paso se mide con una sola pregunta: *¿maximiza esto la absorción del alumno?*

## 9. Comprobaciones: después de cada paso de razonamiento

Cada paso de razonamiento termina con una comprobación: una pregunta evaluada que verifica que el paso ha calado de verdad. No es burocracia; es el mecanismo de detección de errores de la sección 5: un paso que no ha calado se encuentra en el momento en que se pisa, la comprobación lo localiza con precisión y se refuerza antes de construir nada encima.

La cadencia también marca el ritmo de la sesión: cada comprobación detiene la lección hasta la respuesta del alumno, así que la enseñanza avanza con el ritmo paso → comprobación → reparar-o-continuar. *(Decisión cerrada, 2026-09-24: una comprobación por paso de razonamiento. Si en la práctica el ritmo resulta desagradable, se revisará, pero por defecto es en cada paso.)*

## 10. Lo que esto exige a la implementación

Criterios que la teoría establece para el sistema (no la especificación; la especificación se deriva de la teoría):

1. **El sondeo debe producir estados precisos.** Los dos estados de conocimiento —lo asentado con sus límites y un objetivo concreto—, o no se puede trazar el árbol mínimo. El sondeo no es una formalidad; su precisión es el techo de la calidad de la planificación.
2. **La planificación debe ser trabajo de verdad.** El árbol mínimo se busca, no se adivina: delimitar el campo, encontrar de qué depende realmente el objetivo, podar lo asentado, elegir la ruta. El artefacto del plan que se muestra al alumno es la vista gruesa (sección 7b); su calidad es la prueba visible de esa búsqueda.
3. **La enseñanza avanza en pasos únicos, comprobados uno a uno.** Un paso de razonamiento cada vez, con la llegada de cada uno verificada (sección 9) y reparada antes de continuar. Nunca lecciones magistrales de varios pasos seguidas de una sola comprobación; nunca construir sobre un paso sin comprobar.
4. **La resolución del árbol del plan no debe filtrarse a la lección.** Los nodos del plan son hitos estructurales, no segmentos de la lección. La lección no se divide en capítulos «Nodo N»: el plan es el mapa, no la carretera.
5. **La exposición es eficiente por defecto.** Sin metanarración del método, sin segmentos etiquetados porque sí, sin repetir una estructura que el alumno ya ve. Explicitud solo donde sirva a la absorción (sección 8).
6. **La logística es cosa del sistema.** Investigar, verificar datos, planificar, ordenar, buscar fuentes: nada de eso es problema del alumno (sección 7a). El agente lo hace al margen o lo absorbe en silencio; el esfuerzo del alumno se dedica solo al material.
