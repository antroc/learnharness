# Recuperación del contenido de herramientas para su visualización

Es una referencia para desarrolladores sobre la recuperación, solo a efectos de visualización, de defectos de escapado generados por el modelo; no es un sistema general de reparación de TeX.

## Límite

Los argumentos de las herramientas se decodifican según su forma, se convierten según el esquema, se validan y se limpian **antes** de presentarse. Después, `ToolContentResponse` aplica `repairMathForDisplay` y el renderizado Markdown normal. Las preguntas de enseñanza y de sondeo, las preguntas al alumno, las rememoraciones/explicaciones y los enunciados/soluciones de práctica comparten este camino; la prosa normal del asistente no.

La recuperación no debe cambiar los argumentos persistidos, la identidad de las opciones, el barajado, la corrección, las respuestas del alumno ni las futuras instantáneas de respuestas. Todo eso usa contenido derivado de la fuente y analizado según el esquema.

## Recuperación admitida

| Contenido | Comportamiento |
| --- | --- |
| Código literal | Copia literalmente los rangos fuente de CommonMark/del analizador matemático, incluidos bloques delimitados, sangría, citas y listas. No serializa un AST de sustitución. |
| Escapes del documento | Decodifica `\n` literales solo si hay indicios, como escapes de maquetación repetidos o TeX con escapado excesivo que los acompañe. Protege el código, las rutas reconocidas, los comentarios y los comandos/macros completos conocidos que empiezan por n, como `\nu` y `\nabla`. |
| Delimitación de bloques | Al recuperar la delimitación `$$`, la fórmula y el delimitador de cierre quedan en sus propias líneas. |
| Prefijos engullidos por JSON | En matemáticas, reconstruye carácter de control + palabra alfabética completa solo cuando nombra un comando de KaTeX conocido, como TAB + `ext` → `\text`. |
| Escapado excesivo de comandos | Recupera los comandos conocidos usando el contexto TeX original; no se inventan palabras desconocidas. Conserva los separadores de fila y comentarios nativos auténticos; los entornos con un escapado excesivo coherente establecen un factor para los comandos **y las filas**. |
| Porcentajes | Recupera escapes de porcentaje duplicados admitidos en expresiones numéricas, incluido al final de las matemáticas en bloque; conserva los comentarios y filas auténticos. No hay reparación general de porcentajes. |

La recuperación de prefijos en línea incluye LF físico + `u` → `\nu` y TAB + `o` → `\to`, sin límite de longitud de palabra. Las matemáticas en bloque conservan los LF/CRLF físicos como formato, pero pueden recuperar prefijos reconocidos que no sean saltos de línea. Los comandos bien escritos siguen siendo comandos; los espacios en blanco no relacionados no cambian.

Esta política se centra deliberadamente en las matemáticas típicas generadas por modelos: un espacio en blanco seguido de una variable puede formar de manera ambigua un comando. Que el análisis TeX tenga éxito no resuelve esa ambigüedad. Una protección rechaza los cambios parciales de comandos que introduzcan un fallo de análisis, pero un análisis correcto por sí solo no demuestra que se conserve el significado. El contenido desequilibrado o no admitido no se reescribe, en general, como matemáticas nuevas; no hay decodificadores específicos por idioma.

En las revelaciones etiquetadas de respuesta/Por qué, solo el primer párrafo directo va en línea con su etiqueta; los párrafos posteriores mantienen la maquetación normal.

## Respuestas históricas

`answerForPresentation` une los campos de visualización a las llamadas originales sin reescribir los hechos de la respuesta. Las etiquetas se vinculan mediante valores seleccionados no ambiguos, etiquetas exactas o recuperadas de la fuente, o el único par restante en una biyección completa. Las filas ambiguas conservan las instantáneas guardadas. El orden, los índices, los valores, los veredictos, la confianza, el texto del alumno y los descartes se mantienen intactos. No se hace ninguna migración.

## Verificación

- `tests/content-recovery.test.ts`: recuperación/conservación, código, filas y comentarios.
- `tests/tool-content-presentation.test.tsx`: corpus sintético, uniones históricas, ambigüedad.
- `tests/tool-content-interaction.test.tsx`: selección/envío/persistencia/revelación y párrafos.

`scripts/replay-tool-rendering-corpus.ts` puede reproducir sin conexión un corpus congelado suministrado aparte, comprobando los hashes y la conservación de fuente/renderizado/respuesta. La recopilación del corpus y las ejecuciones de diagnóstico más grandes no son requisitos previos de las pruebas unitarias. Las suites de Markdown, tarjetas, práctica, forma y corrección siguen siendo relevantes.
