# Flashcards: visión del producto

**Estado:** la persona ha autorizado una implementación nativa primero. Mantén la v1 sencilla: un único paquete de plugin autocontenido con almacén local, generación, biblioteca y repaso espaciado. Sin integración con Anki. El plugin es además un consumidor de referencia para mejorar la API del host, que sigue evolucionando: informa del trabajo de integración incómodo, chapucero o desproporcionado en lugar de construir un apaño.

## Por qué esto encaja en LearnHarness

LearnHarness busca maximizar la comprensión real y utilizable por unidad de esfuerzo mental. No se trata de quitarle al alumno la lucha con el material, sino de quitarle la logística que la rodea.

La enseñanza y el recuerdo resuelven problemas distintos. Un alumno puede seguir una lección, entender su razonamiento y aun así no lograr traer a la mente el hecho relevante más adelante. Eso no hace que la comprensión sea falsa. Entender una proposición y tenerla disponible en las situaciones en que es útil son logros distintos.

El recuerdo funciona con pistas: rasgos de una situación que traen algo a la mente. La enseñanza da al principio a una proposición un conjunto estrecho de pistas, muy ligado a la lección. La práctica amplía y refuerza ese conjunto.

Las flashcards aportan una parte deliberadamente pequeña de ese proceso de consolidación: recuerdo de hechos nativo y espaciado, a partir de las proposiciones que ya están representadas en LearnHarness. No sustituyen a la enseñanza, a la práctica de razonamiento ni a las sesiones de práctica adaptativa existentes. Tampoco recordar una respuesta demuestra que el alumno entienda el razonamiento que hay debajo.

La experiencia nativa es el producto. La exportación e importación de Anki se aplaza por completo; nada de ello entra en la versión uno.

## El modelo central: proposición, pista, tarjeta

La jerarquía es:

> Mazo (basado en la fuente por defecto) → Proposición → Pista/tarjeta

La proposición es el objetivo de conocimiento. Cada pista es una situación o exigencia distinta que debería traer esa proposición a la mente. Cada pista corresponde a su propia flashcard, con solo dos campos de contenido: **pregunta** y **respuesta**.

Ambos campos admiten el renderizado enriquecido integrado estándar de la app: Markdown, notación matemática, bloques de código con resaltado de sintaxis, tablas, avisos destacados, diagramas Mermaid y tipografía normal. La canalización compartida del host rechaza las URL de imágenes en Markdown; las tarjetas nativas de artefactos de imagen y SVG son otra cosa. Dos campos no significa campos solo de texto plano. Reutiliza la pila de renderizado del host a través de su montaje de Markdown estático admitido en lugar de copiar componentes privados, empaquetar otro renderizador nativo o disfrazar las flashcards de widgets de resultados de workers.

El renderizador compartido aprobado muestra contenido estático sin controles auxiliares de copiar, descargar, reintentar, expandir, zoom o desplegar, y sin widgets de bloques de código registrados por plugins. Los enlaces ordinarios conservan su comportamiento normal. La implementación del host está verificada y expone un montaje general de Markdown estático con actualización y liberación estándar y cancelación por montaje. El renderizado de preguntas y respuestas usa ese contrato público.

No es una única tarjeta cuya pregunta cambia de forma al azar. Las distintas pistas son tarjetas separadas para que se puedan distinguir sus resultados de repaso. Comparten una proposición, no una identidad.

El principio de generación es:

> Busca razones distintas por las que la proposición tendría que venir a la mente, no simplemente formas distintas de preguntar por ella.

Parafrasear una pregunta no crea por sí solo una pista nueva útil. A la inversa, una respuesta no tiene por qué repetir la proposición al pie de la letra: debe responder con precisión a la pregunta concreta mientras ejercita esa proposición.

No hay una cuota fija de tarjetas por proposición ni una taxonomía obligatoria de pistas. Algunas proposiciones merecen varias pistas útiles; otras, menos. Cuando las tarjetas existentes ya cubren las pistas útiles, generar cero tarjetas adicionales es un resultado válido.

## Límite de la primera versión: recuerdo de hechos

La versión uno ejercita **una proposición cada vez** mediante tarjetas concisas de pregunta y respuesta.

No introduce tarjetas de cadenas de razonamiento, ejercicios de derivación en varios pasos, tarjetas de construcción de secuencias ni problemas calificados por un agente. Esas posibilidades no se descartan para siempre; quedan fuera de esta primera versión.

Las cadenas de razonamiento siguen importando. El generador puede ver el contexto de razonamiento alrededor de una proposición para entender su significado, sus supuestos y sus usos. Las premisas de una cadena son suficientes en conjunto: el contexto no debe convertir “A y B implican C” en la afirmación falsa “A por sí sola implica C”.

La distinción es intencionada: el razonamiento informa de qué tarjetas de recuerdo de hechos tienen sentido sin convertir la interacción de repaso en una lección de razonamiento.

## Una biblioteca organizada en torno al conocimiento existente

La biblioteca debería sentirse como la vista de cadenas de razonamiento: una jerarquía compacta, desplegable y parecida a carpetas, en lugar de un montón plano de tarjetas sin relación. La versión uno usa **mazos planos, sin submazos**. Cada mazo se despliega en proposiciones y cada proposición se despliega en sus pistas/tarjetas.

Los mazos por defecto corresponden a las fuentes de enseñanza: sesiones de enseñanza o notas importadas. El mazo inicial de una proposición lo determina su fuente de nacimiento, la primera fuente de procedencia que sobrevive y que usa la agrupación por regiones del grafo. Varias generaciones desde la misma fuente se acumulan en el mazo de esa fuente en lugar de crear mazos por generación.

Los mazos son **colecciones de referencias, no propietarios exclusivos**. Una proposición puede pertenecer a varios mazos, pero sigue teniendo exactamente una colección de pistas, un estado de FSRS y un historial de repasos. Repasarla o editarla desde un mazo afecta al mismo registro que se ve desde todos los demás mazos. La identidad de la proposición del grafo sigue siendo el ancla; la pertenencia nunca crea una copia.

El alumno puede crear mazos personalizados y añadir o quitar pertenencias de proposiciones, lo que permite dividir una fuente de notas grande en colecciones de estudio útiles o combinar varias fuentes pequeñas. Cada proposición debe conservar al menos una pertenencia a un mazo. Quitar su última pertenencia, también al borrar un mazo, exige elegir otro mazo; borrar una colección no borra sus tarjetas, su calendario ni su historial. En la versión uno no hay un mazo automático “Unfiled” (sin clasificar). Estas acciones no reescriben la procedencia de las fuentes de enseñanza ni reorganizan el grafo del núcleo. El árbol de mazos y biblioteca pertenece al plugin; una API general de árboles del host no forma parte del alcance elegido.

Este diseño basado en fuentes y con pertenencia compartida sustituye al plan anterior de mazos creados por cada generación, propiedad exclusiva, movimientos automáticos y mazos anidados. El Anki estándar tiene propiedad de las tarjetas por un único mazo, así que la pertenencia compartida es una extensión nativa intencionada, no una pretensión de tener la misma semántica de mazos que Anki.

El alumno puede editar y borrar tarjetas generadas en la biblioteca. La generación no requiere una fase aparte de aprobación de borradores: las incorporaciones correctas están disponibles para repasar de inmediato.

El plugin se llama **Flashcards**, con ID de plugin `flashcards`.

Ser un plugin oficial no hace que sus dependencias sean de toda la aplicación. Las dependencias de funcionalidades de terceros van en el manifiesto de paquete y el lockfile propios del plugin y se empaquetan con su distribución, no se añaden a las dependencias raíz de LearnHarness ni se instalan en la app en tiempo de ejecución. Las capacidades de runtime del host y las API públicas admitidas siguen siendo el límite.

## La generación es explícita, contextual y aditiva

El alumno decide qué entra en el sistema de flashcards. La versión uno no tiene generación automática al terminar una sesión de enseñanza o al aparecer contenido en el grafo.

La selección de proposiciones y cadenas de razonamiento reutiliza la **vista real de cadenas del host**, en lugar de una nueva implementación de selector dentro de Flashcards. La interacción debería imitar la burbuja de selección de una práctica nueva: abrir el selector a vista completa, seleccionar conocimiento y cerrarlo conservando la selección en el flujo del plugin. No tiene por qué estar incrustada entre otros controles del plugin ni heredar la selección actual del lienzo del grafo.

Se quieren, y pueden seguir disponibles, el cambio de nombre de fuentes, la creación de carpetas y el arrastre existentes en esa vista del host. Son acciones intencionadas de gestión de fuentes del host, distintas de los movimientos de mazos propios del plugin. A la experiencia de selección compartida se accede mediante una capacidad de interfaz admitida del host; Flashcards no debe importar ni copiar componentes privados del host.

La generación recibe las proposiciones seleccionadas, su vecindario inmediato de cadenas de razonamiento y las tarjetas existentes para esos objetivos. Incluye todas las cadenas que afecten directamente a un objetivo y conserva todas las premisas y la conclusión de cada cadena. En la versión uno, no expandas el grafo de forma recursiva ni incluyas transcripciones completas de enseñanza. Las tarjetas existentes son un contexto importante: la tarea es encontrar pistas útiles que falten, no regenerar desde cero la colección de una proposición.

La primera generación asigna una proposición al mazo de su fuente de nacimiento. Las generaciones repetidas añaden in situ las pistas útiles que falten; no crean un mazo nuevo, no mueven la proposición ni cambian sus pertenencias existentes.

La generación repetida conserva las ediciones manuales, las tarjetas existentes, el historial de repasos y el calendario de la proposición. Añade las tarjetas útiles que falten en lugar de sustituir lo que ya hay. El momento exacto de creación de los mazos de fuente necesarios al principio, incluidos los resultados con cero tarjetas y los fragmentos fallidos, sigue siendo una decisión del plan de implementación.

La generación sigue la **ranura de modelo barato** actual de LearnHarness salvo que el alumno haya configurado explícitamente una sustitución de modelo y razonamiento específica del plugin. Borrar la sustitución vuelve a seguir la ranura. La ranura se resuelve al empezar la generación, no se copia de forma permanente en los ajustes del plugin. Un modelo no disponible o sin configurar produce un error explícito, no un recurso silencioso a otro.

El worker debe poder reparar un envío no válido en la misma conversación. Una validación de salida fallida es información para corregir, no un motivo para descartar el contexto y empezar de nuevo. Las ejecuciones están acotadas, y no conseguir un resultado aceptado no debe presentarse como una generación correcta.

Las selecciones grandes se dividen en fragmentos configurables, con un objetivo inicial de **4.000 tokens de entrada estimados**. El presupuesto se refiere al contexto de generación ensamblado, incluidos el razonamiento y las tarjetas existentes, no solo a los enunciados de las proposiciones. Cada proposición tiene un único fragmento propietario; su trabajo no se reparte entre workers en competencia. Los fragmentos independientes pueden ejecutarse en paralelo mediante la ejecución de workers gestionada por el host y la admisión compartida de peticiones.

Si el contexto completo necesario de una proposición no cabe en el presupuesto configurado, la comprobación previa lo indica explícitamente antes de empezar la generación. El alumno puede aumentar el presupuesto o reducir la selección. No descartes premisas en silencio, no omitas objetivos ni recortes tarjetas existentes para que la petición quepa.

La versión uno permite **un único lote de generación activo a la vez**, con los fragmentos independientes de ese lote ejecutándose en paralelo. Mientras el lote está activo, cualquier otra petición de generación se bloquea explícitamente en lugar de crear trabajo superpuesto.

Los fragmentos correctos se aceptan de forma independiente y sus tarjetas pasan a estar disponibles sin esperar al lote completo. Un fallo en otro fragmento no descarta el trabajo aceptado. La cancelación detiene nuevas incorporaciones sin quitar las tarjetas ya aceptadas, y un lote con fallos se muestra visiblemente como parcial en lugar de informarse como correcto.

El empaquetado exacto, los límites y el comportamiento de los reintentos siguen requiriendo un plan de implementación. La visión no implica paralelismo ilimitado, un sistema de admisión local al plugin que compita con el del host ni la repetición automática del trabajo interrumpido.

## Repaso: una pista, un calendario por proposición

Un repaso presenta **una pista/tarjeta de una proposición**, no todas sus pistas seguidas.

La interacción es intencionadamente familiar y sencilla:

1. Lee la pregunta e intenta recordar.
2. Revela la respuesta.
3. Autocalifícate con **Again**, **Hard**, **Good** o **Easy**.

En esta primera versión no hay campo de razonamiento, exigencia de escribir la respuesta ni evaluación por un agente. Es una interacción deliberadamente más estrecha que las sesiones de enseñanza y práctica adaptativa de LearnHarness.

Las introducciones nuevas se dosifican con un límite diario ajustable **por mazo**, al principio **20 proposiciones no repasadas antes por mazo y día**. Esto sustituye al límite anterior de introducciones para todo el plugin. Los repasos vencidos no tienen tope, incluidas las repeticiones de aprendizaje y reaprendizaje. El recuento de introducciones es por proposición, no por pista ni por presentación; no limita la generación de tarjetas, la navegación por la biblioteca ni el aprendizaje en otras partes de LearnHarness. Una proposición compartida se introduce una sola vez en total, y esa primera introducción cuenta en **todos los mazos que la contienen**, con independencia del mazo usado para el repaso. No vuelve a ser nueva al encontrarla a través de otro mazo. Solo el mazo que se está estudiando controla la admisión de una proposición nueva. Un cupo lleno o a cero en otro mazo que la contenga no bloquea esa introducción, pero la introducción sigue contando allí; por tanto, el recuento de un mazo puede superar su límite por repasos hechos desde otros mazos.

El repaso normal atiende las obligaciones existentes antes que las introducciones nuevas: primero los pasos de aprendizaje y reaprendizaje listos, después los repasos vencidos y después las proposiciones nuevas hasta el límite del mazo aplicable. Por tanto, una gran acumulación de vencidos tiene prioridad sobre el material nuevo.

El alumno puede repasar toda la biblioteca o restringir el repaso programado a mazos o proposiciones seleccionados. Filtrar no crea estados de planificación separados ni convierte el repaso en un modo anticipado o de empollar.

En la versión uno no hay submazos ni límites de mazos padre. Añadir más adelante una organización anidada no tendría por qué duplicar proposiciones ni reiniciar sus calendarios; su comportamiento de límites necesitaría un diseño propio.

La planificación usa **FSRS**, con un estado de planificación por **proposición**, no por pista. La calificación actualiza el calendario de esa proposición. Así se evita tratar cada pista nueva como un hecho completamente aparte con su propia obligación de repaso independiente.

La referencia de algoritmo elegida es **FSRS-6**, fijada a la implementación publicada `ts-fsrs@5.2.3`. El planificador se implementará sin una dependencia de planificación en tiempo de ejecución, conservando la atribución MIT de la referencia. La versión uno usa los parámetros por defecto publicados; la optimización personalizada de parámetros se aplaza. El historial de repasos se conserva con independencia de esa decisión.

La retención deseada es un único ajuste para todo el plugin, al principio del **90 %**, en lugar de un objetivo o preajuste aparte para cada tema. Objetivos más altos cambian repasos más frecuentes por una retención esperada mayor.

El repaso a corto plazo usa pasos de aprendizaje y reaprendizaje al estilo de Anki, al principio **1 minuto y después 10 minutos** para las proposiciones nuevas y **10 minutos** tras un fallo. Estos pasos se pueden editar en los ajustes del plugin; la versión uno no depende del modo experimental de FSRS sin pasos para todos los intervalos a corto plazo.

Es una adaptación de la planificación al estilo de Anki, no una pretensión de comportarse igual que Anki. El Anki estándar planifica las tarjetas de forma independiente. Aquí se planifica una proposición mientras puede variar la pista usada para ponerla a prueba. Por tanto, un acierto con una pista no demuestra que todas las pistas de esa proposición sean igual de sólidas, y las predicciones de retención del planificador estándar no son una garantía para esta configuración adaptada.

## Elegir la pista es un problema distinto de planificar

Cuando una proposición vence, el plugin elige cuál de sus pistas presentar.

La elección mezcla pistas sin probar y pistas ya repasadas. Las pistas sin probar necesitan oportunidades de ejercitarse; deben favorecerse las pistas repasadas más débiles; las más sólidas deben seguir siendo elegibles. Favorecer las pistas más débiles significa **elección ponderada**, no elegir siempre la más débil.

Los resultados por pista se conservan para informar esta elección, aunque el estado de FSRS sea de la proposición. La separación es fundamental:

- La proposición es el objetivo de conocimiento y la unidad de planificación.
- La pista/tarjeta aporta una ruta de recuperación y tiene sus propios resultados observados.
- El historial de repasos registra lo que realmente se mostró y cómo se calificó.

La regla de elección de la versión uno usa la calificación más reciente de cada pista repasada, con pesos relativos **Again 4, Hard 3, Good 2, Easy 1**, y **3 para una pista sin probar**. Así, una pista puede recuperarse de un fallo antiguo en lugar de quedar penalizada para siempre por él. El historial completo de repasos se sigue conservando. Son heurísticas de elección explícitas y sencillas, no parámetros de FSRS ni una pretensión de ponderación óptima.

Las repeticiones de aprendizaje y reaprendizaje mantienen la misma pista hasta que la proposición vuelve al repaso normal. Para el siguiente repaso normal se hace una elección ponderada nueva. Así, una reparación inmediata se centra en la ruta de recuperación que necesitaba trabajo en lugar de cambiar a otra.

## Mantener separados el conocimiento y la evidencia sobre el alumno

El grafo de LearnHarness es una representación objetiva de las proposiciones y sus relaciones de razonamiento. Que algo esté en ese grafo no es evidencia de que el alumno pueda recordar una proposición ni de que la domine.

El plugin lee ese conocimiento y guarda aparte sus tarjetas, su estado de planificación y su historial de repasos. No escribe valores de dominio, dificultad del alumno ni resultados de repasos en el grafo del núcleo. Crear una tarjeta no crea evidencia de aprendizaje.

La relación tampoco es destructiva. Si el ID de proposición de una tarjeta ya no se encuentra en el grafo, sus tarjetas pasan a una sección **Archive** fuera del repaso normal. El plugin conserva su propio contenido, las instantáneas de las proposiciones y el historial. Borrar datos del grafo nunca borra en silencio datos propios del plugin.

Borrar solo una cadena de razonamiento no archiva tarjetas si la proposición sigue existiendo. Si se borra una fuente original pero la proposición sobrevive gracias a otra procedencia, conserva sus pertenencias a mazos existentes y mantén el mazo de la fuente antigua con su etiqueta guardada. No sigas automáticamente la fuente de nacimiento reasignada por el grafo ni reorganices las colecciones personalizadas. La proposición viva sigue siendo elegible para repasar. Quedan por decidir los detalles de presentación y restauración del Archive.

## Integración con Anki aplazada

La persona ha eliminado toda integración con Anki de la v1. No hay interfaz de exportación o importación, biblioteca de empaquetado, recurso SQLite WASM, conversor ni requisitos de verificación específicos de Anki. Vuelve a plantear la integración solo si se pide después de que el plugin nativo resulte útil.

## Qué debería hacer posible esta primera versión

El alumno puede seleccionar el conocimiento que le importa, generar pistas de recuperación de hechos realmente distintas sin gestionar prompts y mantener esas pistas en una jerarquía familiar. Puede volver para una sesión de repaso espaciado sencilla sin una llamada al modelo en cada respuesta. Su trabajo sigue siendo nativo de LearnHarness, sin depender de la integración con otra aplicación.

El criterio de éxito es la disponibilidad útil de los hechos conocidos, no el número de tarjetas, las paráfrasis duplicadas ni una etiqueta de dominio deducida del grafo. El plugin debería emplear el esfuerzo del alumno en intentar recordar y mantener todo lo que rodea esa interacción lo más austero posible.

## Notas de implementación

La persona autorizó empezar la implementación en lugar de seguir planificando de forma exhaustiva. Usa una implementación nativa sencilla; plantea a la persona las nuevas ambigüedades importantes o la fricción real de infraestructura a medida que surjan. El borrador detallado anterior no es una aprobación general de la maquinaria que proponía. La siguiente lista histórica es contexto, no un requisito previo para seguir planificando:

- **Política de planificación:** límites de los ajustes de retención y pasos y comportamiento al cambiarlos; aleatorización de intervalos y comportamiento en el cambio de día; orden dentro de las colas de vencidas y nuevas; cambios de pertenencia tras una introducción y repaso de toda la biblioteca o de varios mazos.
- **Contrato de generación:** prompt exacto y esquema del resultado; estimación de tokens y empaquetado; presupuestos de salida y reparación y límites de tareas.
- **Ciclo de vida de los lotes:** reintentos, trabajo interrumpido, interacciones detalladas de progreso y cancelación, y momento de creación de los mazos de fuente necesarios al principio. La admisión compartida de peticiones la aporta el host, no un ajuste de concurrencia aparte del plugin.
- **Interfaz del producto:** disposiciones y controles concretos propios del plugin para mazos, biblioteca y repaso; controles para nombrar y borrar mazos personalizados y editar pertenencias; edición y borrado de tarjetas; restauración del archivo; y presentación del progreso y los errores. Usa el renderizador de Markdown compartido verificado para el contenido de las tarjetas.
- **Entrega:** ubicación del código, la build y la distribución del plugin y un plan coherente de implementación y verificación.

Resolver estas cuestiones debe conservar las distinciones que motivan el plugin: comprensión frente a disponibilidad, proposiciones frente a pistas, planificación frente a elección de pistas, conocimiento objetivo frente a evidencia sobre el alumno, y funcionalidad del producto frente a maquinaria de integración innecesaria.

## Fundamentos conceptuales

Esta visión aplica la distinción entre enseñanza, práctica y modelo del mundo formulada en *How I Learn Difficult Things With AI* y *The learning harness — canonical articulation* (2026-10-05), ambos de la persona, junto con las decisiones de producto directas posteriores para Flashcards. Es intencionadamente más estrecha que la dirección más amplia de evaluación y práctica adaptativa descrita allí.
