# Contexto, caché y costes

Haz clic en la fila de contexto/coste que hay bajo el compositor para abrir **Estadísticas de la sesión**. La medida del contexto, la tasa de aciertos de caché y la estimación en dólares responden a preguntas distintas; ninguna es una factura del proveedor ni una garantía sobre la siguiente petición.

## Medidor de la conversación

El numerador son los tokens nativos de Pi de **entrada + salida + lectura de caché + escritura en caché** de la última respuesta completada de la conversación que cumpla los requisitos. El razonamiento ya está incluido en la salida. Las actualizaciones parciales, los errores, las interrupciones, los recuentos no válidos y los usos con todo a cero no sustituyen a la última medida. El uso del resumidor nunca alimenta este medidor.

El denominador sigue el límite del catálogo para el modelo seleccionado. Los modelos personalizados usan su presupuesto fijado/informado/de respaldo. Claude Code usa en cambio un presupuesto efectivo válido informado por la CLI para el modelo coincidente de esta sesión, que puede ser menor por la compactación automática de la CLI. Los límites que faltan se quedan como desconocidos, no se inventan.

Cambiar de modelo mantiene el numerador, pero no toma prestado el presupuesto de la CLI de otro modelo. Una compactación correcta invalida las medidas anteriores: se muestra `? / máximo` hasta que llega una nueva respuesta que cumpla los requisitos; los metadatos del presupuesto de la CLI también se invalidan.

### Tasa de aciertos de caché observada

Las Estadísticas de la sesión expandidas muestran la **Tasa de aciertos de caché** solo cuando se han registrado lecturas de caché positivas y las entradas son válidas. Es una proporción de toda la sesión, ponderada por tokens del prompt, no una media de los porcentajes de cada llamada:

```text
sum(cache read) / sum(fresh input + cache read + cache write)
```

La salida queda excluida; las escrituras de una hora son un subconjunto de las escrituras y no se cuentan dos veces. La falta de recuentos de caché significa que no se ha registrado reutilización, no que se hayan demostrado fallos. Esto describe el uso observado, no si la caché está caliente, ni aciertos futuros, ni ahorros, ni la duración de la retención. Consulta [`sessionCacheHitRate`](../src/core/prices.ts).

## Retención de la caché de prompts

En **Ajustes → Agente → Modelos → Mostrar ajustes avanzados**, cada ranura Potente/Barato/Visión tiene un desplegable **Caché**. Ocultar los ajustes avanzados no lo restablece.

| Opción | Comportamiento de la petición |
| --- | --- |
| Predeterminado de Pi | Deja `cacheRetention` sin definir y conserva el comportamiento de Pi, incluido `PI_CACHE_RETENTION=long` donde se respete. |
| No solicitar caché | Pasa la preferencia `none` de Pi; los proveedores pueden seguir cacheando automáticamente. |
| Retención corta | Pasa la preferencia `short` de Pi. |
| Retención larga | Pasa la preferencia `long` de Pi; las escrituras en caché pueden costar más. |

Son **preferencias que dependen del proveedor**, no promesas de una duración fija ni de aciertos de caché. Algunos adaptadores las ignoran, los transportes por suscripción pueden omitirlas y los endpoints personalizados pueden rechazar parámetros no admitidos. LearnHarness no reintenta con otra preferencia.

Las sesiones heredan la preferencia de retención de Potente y conservan sus propias elecciones de modelo. Los roles en segundo plano heredan la preferencia de la ranura que tengan asignada, incluso con un modelo personalizado; el resumen usa la preferencia de la conversación. Los cambios se aplican en la siguiente petición al modelo, también dentro de un bucle existente, sin alterar una llamada en curso ni lanzar llamadas de precalentamiento. Las elecciones explícitas prevalecen sobre la preferencia de retención del entorno de Pi; Predeterminado de Pi elimina la elección explícita.

En las rutas de Anthropic compatibles, Corta/Larga equivalen a cinco minutos/una hora, y las escrituras en caché cuestan 1,25×/2× la entrada normal; las lecturas usan el precio rebajado de lectura de caché. Una retención más larga puede ayudar cuando hay pausas, pero cuesta más en una sola llamada o en una tarea corta. Otros proveedores funcionan de otra manera. Consulta la [caché de Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) y la [caché de OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) para ver las equivalencias y los precios actuales.

## Gasto

El servidor usa el catálogo de Pi AI y su `calculateCost` público; el navegador recibe estimaciones derivadas, no una tabla de tarifas aparte. Las actualizaciones del catálogo pueden recalcular el precio del historial sin modificar el uso guardado.

| Ruta | Significado |
| --- | --- |
| Proveedores de API | Estimaciones en dólares cuando están disponibles el modelo del catálogo y el detalle de uso necesario. |
| Conexiones por suscripción integradas | Uso del plan etiquetado mediante ID de proveedor lógicos explícitos, no dólares de API. |
| [Claude Code](claude-code.md) | Se conservan los tokens de la CLI; los costes en dólares quedan sin precio. No se importan los totales en dólares de la línea de resultado de la CLI; el enrutamiento y la facturación son cosa de la CLI. |
| [Endpoints personalizados/locales](custom-providers.md) | Se conservan los tokens; costes desconocidos/sin precio, no 0 $. No hay editor de tarifas. |

Las sesiones mixtas suman las estimaciones de API conocidas y conservan las etiquetas de suscripción/CLI. Los turnos sin precio siguen sin precio, no son gratis. El gasto del resumidor se cuenta con las mismas reglas, pero no alimenta el medidor de la conversación.

Los recuentos de entrada guardados son **entrada nueva** normalizada por Pi, separada de los apartados de caché; no restes otra vez las lecturas cacheadas. Los registros antiguos a los que les falta el desglose de retención de las escrituras en caché, o las tareas de varias llamadas con precio por tramos a las que les falta el detalle por llamada, siguen sin precio cuando ese detalle podría cambiar el resultado. No se reconstruyen a partir de agregados. Las tareas históricas con tarifa plana pueden seguir teniendo precio si los recuentos bastan.

## Compactación y referencias para mantenedores

La compactación resume el contexto antiguo para las peticiones futuras; los mensajes originales siguen guardados. La estimación de la siguiente petición es independiente de la medida de la última llamada que se muestra: se ancla en el uso informado, estima los mensajes posteriores y recurre a heurísticas sobre la transcripción activa y el prompt del sistema. El disparador es el menor entre el umbral configurado y la ventana del catálogo menos la reserva. Si la ventana del catálogo es desconocida, se usa solo el umbral configurado; los metadatos de visualización de la CLI no cambian ese disparador.

[`src/core/compaction.ts`](../src/core/compaction.ts) adapta la selección del punto de corte y las heurísticas de tamaño por defecto de **@earendil-works/pi-coding-agent 1.4.0**, sin depender del agente de programación. Recorre hacia atrás hasta una **cola conservada de unos 20.000 tokens**, eligiendo un límite válido entre usuario y asistente y conservando las llamadas anteriores cuando los resultados finales las necesitan. El texto, el razonamiento, los nombres de herramientas y los argumentos se miden como caracteres ÷ 4; las imágenes reciben una asignación fija de 1.200 tokens. Los mensajes completos pueden pasarse; no es una garantía de tamaño exacta, y las firmas cifradas no se miden ni se eliminan.

LearnHarness mantiene su propio prompt de resumen educativo, la continuidad del plan, la planificación de tareas, la autorización y la persistencia. Un corte que no descarta historial no genera resumen. Las peticiones incluyen una vez el último resumen y después la transcripción conservada; los resúmenes posteriores reciben una vez el resumen anterior más el material que acaba de quedar superado. Los puntos de corte sin resolver mantienen el respaldo existente con el historial completo. Los resúmenes que agotan el límite de salida (`length`) fallan en lugar de guardar como punto de control una salida incompleta.

### Estimaciones opcionales que tienen en cuenta el razonamiento (solo OpenAI Responses)

En **Ajustes → Agente → Contexto**, justo debajo del umbral de compactación,
**Incluir el razonamiento en las estimaciones de tokens (solo OpenAI Responses)**
activa una extensión de la heurística nativa que tiene en cuenta el razonamiento.
Está **desactivada** por defecto, también en los ajustes existentes sin
`compaction.includeReasoning`. Los cambios se aplican a las comprobaciones de
compactación futuras, no a una compactación en curso, y no vuelven a cortar los
resúmenes existentes.

La heurística de contenido legible puede quedarse muy corta con una cola
conservada que contenga razonamiento opaco, aunque el uso del proveedor dispare
correctamente la compactación. Con la opción activada, el uso de salida guardado
a nivel de respuesta proporciona un **mínimo** para la estimación del contenido
legible en las respuestas del asistente que:

- usan `openai-responses` y coinciden con la API, el proveedor y el ID del modelo seleccionado;
- contienen al menos un bloque de razonamiento con un `thinkingSignature` no
  vacío, aunque el razonamiento legible esté vacío;
- tienen un uso de salida válido, positivo y entero seguro, y no han terminado
  con error ni se han interrumpido.

El uso de salida ya incluye el razonamiento: se cuenta **una vez por respuesta**,
no por bloque de razonamiento, y no se suma a la estimación legible. El estimador
nunca convierte la longitud del texto cifrado en tokens ni usa la entrada o el
total de todo el contexto como tamaño de un mensaje. Los demás modelos, las demás
API (incluida la ruta Chat Completions de OpenRouter), los mensajes sin firma y
las lecturas de salida inutilizables mantienen la heurística original.

La opción afecta a la selección del punto de corte de la cola conservada y a las
estimaciones de la siguiente petición, tanto en la comprobación al inicio del
turno como en la comprobación de cierre en segundo plano, incluido el respaldo
justo después de que una compactación invalide el ancla anterior de uso del
proveedor. Por lo demás, las anclas de uso informadas por el proveedor no cambian.
El uso de salida guardado es una aproximación del tamaño al reproducir, no una
medida exacta de la siguiente petición: ningún modo garantiza una cola medida de
20k. El umbral, el presupuesto de la cola reciente y las reglas de límites entre
asistente, herramienta y pregunta no cambian.

Esta opción **no** añade el texto del razonamiento a la entrada del resumidor, ni
elimina firmas, ni reescribe el historial guardado, ni cambia el medidor de la
conversación. Cobertura de regresión: [contabilidad del razonamiento](../tests/compaction-reasoning.test.ts),
[ambos puntos de entrada del servicio y una comparación activada/desactivada sobre una instantánea idéntica](../tests/compaction-service.test.ts),
[persistencia y valores por defecto de los ajustes](../tests/settings-store.test.ts) y
[el interruptor de Ajustes](../tests/render-settings.test.tsx). La comparación usa
un resumen sintético fijo y un uso guardado; no mide la entrada real del proveedor.

### Referencias de implementación

Implementación: [`server/compaction.ts`](../src/server/compaction.ts), [`context-usage.ts`](../src/core/context-usage.ts), [`server/pricing.ts`](../src/server/pricing.ts). Regresiones: `compaction-native-parity`, `context-usage`, `pricing-native-parity`, `subscription-usage` y `session-cache-hit-rate` en `tests/`, además de las suites de la CLI y de proveedores personalizados.

## Atribución del código de origen

La adaptación del punto de corte y del estimador parte de código con licencia MIT
de `@earendil-works/pi-coding-agent` 1.4.0, cuyo autor es Mario Zechner (según los
metadatos del paquete publicado). El SHA-256 del `dist/core/compaction/compaction.js`
inspeccionado es
`f51e78ef1da66b5803fc91e185f07b968f8f989ab9326b7744958416aad3f6f6`.

MIT License

Copyright (c) Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
