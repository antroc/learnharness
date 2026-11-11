# Problemas de práctica definidos por plugins — API v1 del host

Los **tipos de problema de práctica** personalizados comparten el ciclo de vida nativo de la
práctica; no son preguntas de enseñanza, ni un segundo ciclo de vida, ni una herramienta de
conclusión aparte, ni un sistema de evaluación nuevo. Esto describe el código fuente y la
build correspondientes. Comprueba la app de destino con el `bundle.json` de la skill
descargada; la API v1 por sí sola no identifica todas las capacidades disponibles. Los tipos
públicos están en `src/core/plugin-problems.ts` y en el SDK `learnharness-plugin-api`, que
solo contiene tipos.

## Ciclo de vida compartido

- Un backend registra una herramienta de planteamiento por tipo de problema. Se aporta
  **solo a los agentes de práctica**, sujeta a la admisión existente de colisiones de nombres
  de herramienta atómica por paquete.
- Los planteamientos nativos y de plugins comparten la misma barrera síncrona de un único
  problema activo y la misma validación de destinos del grafo. Los planteamientos fallidos o
  colgantes no activan ningún problema. Un planteamiento con acuse termina el turno, incluso
  en lotes mixtos de herramientas, y no implica continuación automática. Antes del acuse, la
  traza genérica plegable de la herramienta no cambia, de forma intencionada: sus argumentos
  desplegables pueden incluir la solución comprometida, igual que el razonamiento
  inspeccionable del agente. Los planteamientos aceptados usan la tarjeta de problema que solo
  muestra el enunciado.
- Todo planteamiento tiene `statement`, `mode: "recall" | "discrimination" | "composition"`,
  `target: string[]` opcional, `modelSolution: string` obligatorio y un `payload` definido
  por el plugin. Los campos comunes y sus descripciones para el modelo provienen del esquema
  nativo de la práctica.
- El host persiste el contrato del plugin aceptado en `details.pluginProblem` del acuse real
  del planteamiento. Es el contrato guardado, no una consulta al registro vivo ni un nombre
  de herramienta adivinado, lo que identifica los problemas de plugins históricos o activos.
  No hace falta un segundo libro de preguntas: a diferencia de los marcadores de posición de
  las preguntas de enseñanza, los acuses de práctica ya persisten.
- Un problema acepta varios envíos del alumno. Solo la herramienta existente **`conclude`**
  registra la evaluación final del modelo y lo cierra. La tarjeta de conclusión nativa revela
  el `modelSolution` comprometido en el planteamiento original; los plugins no aportan una
  herramienta de conclusión.
- El descarte normal de la práctica sigue disponible y es silencioso. Desactivar o quitar un
  plugin, que falte un renderizador o declarar un contrato incompatible **no** sustituye el
  problema por un editor de texto nativo ni pierde su solución comprometida. El envío no está
  disponible hasta que vuelvan implementaciones compatibles o el alumno lo descarte.

## Registro en el backend

```ts
import { Type } from "typebox";
import type { PluginBackendContext } from "learnharness-plugin-api";

export function activate(ctx: PluginBackendContext) {
  return ctx.registerProblemType({
    id: "example",
    label: "Example problem",
    contractVersion: 1,
    tool: {
      toolName: "example_problem",
      description: "Pose a practice problem using the example editor.",
    },
    problemSchema: Type.Object({ starter: Type.String() }),
    submissionSchema: Type.String(),
    validateProblem(context) { return undefined; },
    validateSubmission(context) { return undefined; },
    async processSubmission(context) {
      context.signal.throwIfAborted();
      // Ejecuta comprobaciones propias del plugin sobre context.submission y la entrada guardada.
      // Devuelve observaciones, no el sobre de resultado propiedad del host ni un veredicto.
      return { observedLength: context.submission.length };
    },
  });
}
```

`registerProblemType<Q extends TSchema, S extends TSchema>(definition)` devuelve una función
para anular el registro. La definición contiene:

- Obligatorios: `id` local estable, `label`, `contractVersion` entero seguro positivo, `tool`
  (`toolName`, `description`), `problemSchema` y `submissionSchema`.
- `incompatibleContractVersions: number[]` opcional; un problema guardado incompatible sigue
  activo pero no disponible. Una versión distinta que no figure en la lista tampoco está
  disponible.
- `validateProblem` y `validateSubmission` opcionales, síncronos y sin efectos secundarios,
  que devuelven `undefined`, `[]` o cadenas de error legibles. Una validación asíncrona o que
  devuelva un thenable no puede conceder la aceptación. Los esquemas siguen la misma política
  de JSON finito acotado y referencias locales que las preguntas de plugins. Ni la validación
  ni la admisión del esquema convierten ni recortan el valor.
- `processSubmission` opcional, síncrono o esperado, que devuelve **JSON finito**.

La validación del problema recibe `chatId`, `contractVersion` y la `input` común aceptada, de
solo lectura, incluido `input.payload` inferido del esquema. La validación del envío recibe
además `problemId` y `submission` inferido del esquema. El procesamiento añade
`thinking: string`, `images: PluginProblemSubmissionImages` opcional y `signal: AbortSignal`
propiedad del host. El JSON propio está separado y congelado; la señal viva en sí no está
congelada. No se proporciona controlador privado del turno, acceso al historial, API de
puntuación ni capacidad de concluir.

### Validar → procesar → guardar → continuar

El esquema guardado y los requisitos de refinamiento y procesamiento congelados en el
planteamiento gobiernan **cada** envío. Las implementaciones obligatorias deben estar
disponibles en la versión del contrato guardada. Los hooks nuevos no cambian con efecto
retroactivo los requisitos de un problema ya planteado.

El host valida de forma síncrona, captura la implementación exacta, espera al procesamiento
opcional, vuelve a comprobar la identidad y la activación canónicas del problema, guarda un
marcador del alumno e inicia una continuación de práctica normal. El marcador guarda por
separado `submission`, `thinking`, `images` opcional y `processing` opcional:

```ts
type PluginProblemProcessingOutcome =
  | { result: JsonValue }
  | { error: string };
```

`false`, `null`, cero y los resultados JSON o de cadena vacíos son observaciones válidas. Las
excepciones ordinarias, los rechazos o los valores devueltos que no son JSON se convierten en
`processing.error` sobre un envío **aceptado**. No son una marca de respuesta incorrecta ni un
motivo para concluir automáticamente. El modelo lee las observaciones guardadas junto con el
envío y el razonamiento. Las observaciones guardadas nunca se recalculan al proyectar el
historial, al remontar, al continuar ni al reintentar el modelo.

El procesamiento usa el propietario existente de la preparación del turno en línea, no una
tarea o cola en segundo plano ni otra petición al modelo. Se puede adjuntar y excluye turnos
y envíos en competencia. Una desconexión HTTP o una navegación no cancelan el trabajo
aceptado. Stop, desactivar el plugin o quitar exactamente ese registro cancelan su señal e
impiden un guardado tardío. La propiedad se mantiene hasta que la callback subyacente
termina de verdad: los plugins deben cooperar con la cancelación y encargarse de cualquier
límite de tiempo de ejecución. La elección de modelo y proveedor se captura para el envío
admitido; los cambios posteriores en el selector se aplican a la siguiente petición. Los POST
de problemas de plugins **no** se reenvían automáticamente tras un 409. Un reintento explícito
tras un fallo previo al guardado puede volver a ejecutar el procesamiento; no hay garantía de
exactamente una vez a través de un cierre inesperado.

## Registro en el frontend y dock nativo

`ctx.registerProblemRenderer(renderer)` tiene ámbito de propietario por ID de plugin e ID de
tipo estable, con `supportedContractVersions` explícito. Devuelve una función para anular el
registro.

```ts
import type { PluginProblemRenderer } from "learnharness-plugin-api";

const renderer: PluginProblemRenderer<{ starter: string }, string> = {
  id: "example",
  supportedContractVersions: [1],
  mountSubmissionEditor(container, context) {
    const input = document.createElement("textarea");
    input.value = context.submission.status === "empty"
      ? context.input.payload.starter : String(context.submission.value);
    container.append(input);
    const publish = () => context.onChange({ status: "ready", value: input.value });
    input.addEventListener("input", publish);
    publish();
    return {
      update(props) {
        input.readOnly = !props.active;
        if (props.submission.status !== "empty") input.value = String(props.submission.value);
      },
      focus() { input.focus(); },
      dispose() { input.removeEventListener("input", publish); },
    };
  },
  mountSubmitted(container, context) {
    container.textContent = context.submission;
    // context.processing opcional son datos de observación; muéstralos como prefieras.
    // context.headerContainer ?? container puede alojar un ctx.ui.mountBadge genérico.
  },
};
// Durante la activación del frontend: ctx.registerProblemRenderer(renderer).
```

Ambos montajes reciben la `input` guardada, `chatId`, `problemId`, `contractVersion` y una
`AbortSignal`. `mountSubmissionEditor` recibe además `active`, `submission` controlado y
`onChange`. El estado es `{status:"empty"}` o
`{status:"unready"|"ready",value:JsonValue}`. Un valor de editor listo es obligatorio aunque
un interceptor tenga entrada externa pendiente. El handle obligatorio tiene `update`, `focus`
y `dispose`; `handleKeyDown` y `appendTranscript` opcionales usan el mismo vocabulario de
handle de editor que las preguntas de enseñanza.

El dock de práctica nativo conserva su enunciado y después inserta el editor del plugin por
encima de **Your thinking**, con un único botón **Enviar**. Tras la aceptación, el valor del
editor se mantiene para revisiones posteriores; solo se borra el razonamiento que no haya
cambiado desde la captura. El editor y el borrador sobreviven a plegar y a un ciclo ocupado
de procesamiento y continuación. Los montajes asíncronos obsoletos, las callbacks, las
sustituciones de registro y la limpieza no pueden modificar una generación sucesora.

El comportamiento del teclado comparte las guardas existentes de propiedad, IME y capas de
los editores de plugins: las teclas gestionadas se quedan en el editor; Enter no gestionado
envía, Mayús+Enter es edición nativa, Tab recorre los campos del host y Escape no gestionado
pasa directamente del editor al razonamiento. El acorde reservado Ctrl/Cmd+Enter envía.
Escape fuera del editor conserva la precedencia nativa de la confirmación de descarte de la
práctica. El host sigue siendo responsable del dictado del razonamiento.

`mountSubmitted` es opcional y recibe la `submission` aceptada exacta y `processing`
opcional; el razonamiento y las imágenes siguen siendo canales de presentación del host. Su
`headerContainer` opcional de solo lectura es un sufijo en línea propiedad de la generación,
tras la etiqueta del host, que comparte su señal y su ciclo de vida de limpieza.
`footerContainer?: HTMLElement` opcional de solo lectura es un bloque propiedad de la
generación al final de la tarjeta del envío, después de las imágenes del envío y del
razonamiento del host. Comparte esa misma señal y ese ciclo de vida de limpieza. Úsalo para
la salida que deba ir debajo del razonamiento; no está disponible para
`mountSubmissionEditor`. No sustituyas nunca el encabezado ni el razonamiento del host, no
muevas el DOM circundante ni conserves ninguno de los dos huecos entre generaciones de
montaje. Si falta alguno de los huecos opcionales, monta su contenido en el cuerpo. Un fallo
de montaje síncrono o asíncrono, una sustitución, la repetición de StrictMode y el desmontaje
eliminan los tres huecos propiedad de la generación. Los fallos o la falta de renderizador
recurren a mostrar de forma legible el valor y las observaciones guardados; no borran el
historial ni inventan insignias de éxito o corrección.

## Imágenes e interceptores de envíos

Los envíos de práctica de plugins participan en la canalización de preparación existente:

```ts
// Extract<PluginSubmission, { type: "plugin-problem-submission" }>
{
  type: "plugin-problem-submission",
  submission: /* JSON finito */ "editor value",
  submissionImages: [],
  thinking: { text: "learner reasoning", images: [] },
}
```

El destino correspondiente tiene `channels: ["submission", "thinking"]` y
`problem: { problemId, occurrence, pluginId, typeId, contractVersion, label, statement }`. La
identidad sigue siendo del host. Los interceptores pueden transformar el valor o el
razonamiento o adjuntar imágenes, no cambiar el problema de destino. `onAccepted` solo se
dispara tras la aceptación canónica, de modo que un plugin de dibujo puede conservar los
trazos no enviados ante una cancelación o un rechazo y borrar solo el material aceptado. La
cancelación de un interceptor y una salida no válida conservan los borradores.

Los canales de imagen del transporte y del guardado son `images: { submission?, thinking? }`;
el razonamiento de lectura no se aplica. Las imágenes pasan por la admisión existente de
estructura, bytes/MIME, capacidad del modelo y redimensionado. Los bloques de imagen nativos
reales llegan al modelo junto al texto etiquetado; el base64 no se mete en el envío
estructurado ni en la cadena JSON que ve el modelo.

## Pruebas

Cubre los contratos guardados, el ciclo de vida, la barrera y la conclusión compartidos entre
lo nativo y los plugins, la revocación del registro, la propiedad y cancelación del
procesamiento y los envíos repetidos, las imágenes e interceptores, la limpieza y los
borradores del dock controlado, los huecos del renderizador y la inferencia del SDK portable.
Prueba el plugin en un perfil aislado de la app además de en fixtures de componentes. El
comportamiento nativo de la práctica con texto sigue siendo independiente.
