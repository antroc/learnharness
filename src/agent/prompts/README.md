# Composición de los prompts

El runtime compone los prompts de los agentes **prober** (sondeo), **teacher** (profesor) y **practice** (práctica). La fuente de verdad es [`listSourceSegments` / `effectivePromptSegments`](../prompt-segments.ts); [`composeInstructions`](../teacher-agent.ts) selecciona el texto efectivo, recorta cada segmento, descarta los segmentos vacíos y los une con `\n\n---\n\n`. La documentación que no es un fragmento, como este README, nunca entra en el prompt.

## Orden de composición

| Agente | Segmentos, en orden |
|---|---|
| Sondeo | [`system-prompt.md`](../system-prompt.md) → fragmentos ordenados de `prober/` → fragmentos ordenados de `shared/` |
| Profesor | `system-prompt.md` → fragmentos ordenados de `teacher/` → fragmentos ordenados de `shared/` |
| Práctica | fragmentos ordenados de `practice/` → el apéndice compartido seleccionado que se describe más abajo; **sin base de enseñanza** |
| Preguntas laterales | [`side-chat/00-base.md`](side-chat/00-base.md) → `10-voice.md`, `15-accuracy.md`, `40-formatting.md` compartidos → el [`90-style.md`](side-chat/90-style.md) final, exclusivo de las preguntas laterales; lo compone [`src/agent/side-chat.ts`](../side-chat.ts), no el cargador de segmentos |

El descubrimiento de directorios solo acepta nombres de fichero que coincidan con `^\d+-[\w.-]+\.md$` y los ordena lexicográficamente por nombre. Mantén los prefijos numéricos con el mismo relleno cuando importe el orden. La base de enseñanza aporta el propósito y la filosofía del agente; las pautas de voz, exactitud, modelo mental, preguntas, confianza, ficheros y formato son fragmentos compartidos independientes. El método del profesor y su doctrina de planificación y enseñanza están en su propio directorio; la doctrina del sondeo está en `prober/`.

La base de las preguntas laterales no es un segmento editable (no aparece en Ajustes); su apéndice compartido respeta las personalizaciones activadas con las mismas claves que usan los demás agentes.

La práctica tiene su propia base y su propia doctrina. Su apéndice compartido está en una lista explícita de permitidos en el cargador: `10-voice.md`, `15-accuracy.md`, `16-mental-model.md`, `35-side-conversations.md` y `40-formatting.md`, en orden. Los demás fragmentos compartidos **no** entran automáticamente en la práctica. Añadir un fragmento compartido nuevo lo incluye en la composición del sondeo y del profesor, pero no en la de la práctica salvo que cambie la lista de permitidos.

## Personalizaciones y valores por defecto

Los ficheros fuente son las instrucciones por defecto. Los ficheros de personalización del usuario replican las claves de los segmentos bajo [`PROMPTS_OVERRIDE_DIR`](../../../config.ts), normalmente `data/prompts/` (se reubica con `LH_DATA_DIR`):

```text
system-prompt.md
prober/<fragment>.md
teacher/<fragment>.md
practice/<fragment>.md
shared/<fragment>.md
```

Una personalización solo es efectiva cuando **a la vez** su interruptor `settings.json` → `agent.prompts[segmentPath]` es `true` **y** su fichero se puede leer. Los interruptores ausentes o desactivados y los ficheros que faltan o no se pueden leer usan el texto fuente. La mera presencia del fichero no activa nada. Una personalización activada y vacía no aporta texto tras el recorte; no recurre al texto fuente.

El manejador normal de turnos pasa el mapa de interruptores resuelto, así que la composición lee el texto fuente/personalizado de nuevo para cada agente recién construido. Las llamadas que omiten `promptSwitches` usan las composiciones solo con el texto fuente, cacheadas al inicializar el módulo. Editar un fichero no reescribe las instrucciones de un agente que ya está en ejecución. No hay personalizaciones activadas de fábrica.

La lista de segmentos disponibles siempre sale del descubrimiento actual de los ficheros fuente. Una personalización de un segmento fuente eliminado deja de componerse, pero no se borra automáticamente del disco. Los segmentos compartidos usan la misma clave en todos los agentes que los incluyen. La gramática de las rutas se define en [`src/core/prompt-segments.ts`](../../core/prompt-segments.ts); el CRUD de las personalizaciones está en [`src/store/prompt-overrides.ts`](../../store/prompt-overrides.ts) y se expone mediante las rutas y la interfaz de prompts de los ajustes. El lector del lado del agente es independiente para que los agentes no importen adaptadores del almacén.

## Fases y contratos de las herramientas

- Las sesiones de enseñanza empiezan con el sondeo. Una llamada correcta a `probe_done` **con su resultado correspondiente** selecciona al profesor en los turnos siguientes; una llamada sin resultado o rechazada no. El profesor planifica y enseña con su propio registro de herramientas. La frontera plan → enseñanza que se muestra es la primera llamada etiquetada a `quiz`/`explain`, no simplemente `plan_init`.
- Las sesiones de práctica usan el prompt de práctica desde el primer turno. `problem` compromete una solución antes de plantear; `conclude` la revela. La doctrina exige una pausa tras la conclusión hasta que el alumno pase explícitamente al siguiente. Es un agente conversacional, no la antigua cadena de generación/evaluación de colecciones de problemas, ya retirada.
- Las instrucciones del prompt no sustituyen a la validación estructural. Por ejemplo, `plan_init` puede reescribir el mapa, y la pausa tras concluir es doctrina, no un resultado de ejecución que termine el turno. Lee el registro y los esquemas reales antes de describir un comportamiento como obligatorio.

Consulta [arquitectura](../../../docs/architecture.md#enseñanza-y-práctica) para las fases del runtime, las diferencias entre registros y la mecánica de las pausas, y [la metodología de enseñanza](../../../docs/teaching-methodology.md) para el método. Los workers en segundo plano y la extracción tienen sus propias instrucciones en sus módulos de implementación; este cargador no es un catálogo de todos los prompts de la aplicación.

## Editar fragmentos

- Pon la doctrina específica de un agente en el directorio de ese agente. Usa `shared/` solo para pautas adecuadas para todos los agentes que lo componen; revisa la lista explícita de permitidos de la práctica.
- Haz coincidir los nombres de las herramientas y los campos de entrada con los esquemas reales de `src/agent/tools.ts` y `src/agent/tools/`. Los agentes comparten historial, no conjuntos de herramientas idénticos: `probe`/`recall` del sondeo y `quiz`/`explain` del profesor difieren a propósito. No des a entender que una herramienta está disponible solo porque otra fase la use.
- Mantén conciso el texto que está siempre en el contexto. Evita duplicar la base, otros fragmentos, los esquemas de las herramientas o la documentación de referencia del runtime.
- Verifica el comportamiento de la composición y de las personalizaciones con `tests/prompt-overrides.test.ts` y las pruebas de flujo de los agentes cuando cambies el comportamiento del cargador. Los recursos de prompts deben seguir incluidos en el empaquetado standalone (`scripts/build-server.mjs`).
