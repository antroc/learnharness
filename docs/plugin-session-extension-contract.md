# Extensiones de sesión: envíos, imágenes y superficies del cuerpo de página

Contrato actual de la API v1 para el código fuente y la build correspondientes; usa
documentación y tipos que correspondan a la app de destino. Usa el `bundle.json` de la skill
descargada para identificar la app; la API v1 por sí sola no identifica todas las
capacidades disponibles. Los tipos exactos están en `src/core/plugin-submissions.ts` y
`plugin-ui.ts`. Los envíos de práctica personalizados siguen además el
[contrato de problemas](plugin-problem-contract.md).

## 1. Límite

Los interceptores del frontend preparan el contenido real del alumno; no aportan métodos
nativos de envío o reorientación, agentes mutables, registro de hooks en el backend ni
eventos genéricos de contexto del modelo. Las colocaciones de acciones existentes lanzan la
interfaz. Solo los datos de imagen nativos explícitos son una imagen: las rutas conservan su
comportamiento ordinario de texto o adjunto. No hay almacén de imágenes, ni importador
nativo de selector de ficheros, portapapeles o arrastre, ni formato de dibujo editable, ni
servicio nuevo de exportación de recursos.

El host es responsable del enrutado, las apariciones exactas, la calificación integrada
derivada, la aceptación y la capacidad del modelo. Los plugins son responsables de la
entrada externa, las transformaciones intencionadas, la interfaz y la persistencia. Las
superficies cubren cuerpos de página, no regiones arbitrarias; no se ofrece cobertura solo de
la transcripción ni suspensión y restauración de la navegación.

## 2. Contenido del alumno

`PluginSubmissionContent` es `{text: string, images: readonly ImageContent[]}`. Las imágenes
son bloques nativos de Pi `{type:"image",data:<base64>,mimeType:<string>}`. El texto precede
a las imágenes; no se promete intercalado arbitrario.

`PluginSubmission` es una unión discriminada de solo lectura:

| `type` | Canales mutables del alumno |
| --- | --- |
| `text` | `content` (enviar o reorientar es cosa de la entrega del host) |
| `thinking` | `content` sobre un problema de práctica nativo capturado |
| `answer` | `answer: PluginBuiltinSubmissionAnswer`, `thinking`, `readingThinking` |
| `plugin-question-answer` | `answer` JSON, `answerImages`, `thinking`, `readingThinking` |
| `plugin-problem-submission` | `submission` JSON, `submissionImages`, `thinking` |

`PluginBuiltinSubmissionAnswer` contiene `dontKnow` opcional, `values` estables de las
opciones (no índices de presentación), `other`, `text`, `confidence` y además `images`. El
razonamiento va aparte. La corrección, los compromisos, las marcas de tiempo, las
identidades, las instantáneas de preguntas y los sobres de resultado nativos nunca son
entrada mutable del alumno. Conserva el JSON finito y las cadenas en bruto sin coerción,
recorte ni filtrado por veracidad.

## 3. Destinos y contexto

`PluginSubmissionTarget` es el destino de solo lectura que produce el host y comparte el
`type` de la entrada: `sessionId`, `sessionKind`, los `channels` aplicables, `surfaceTarget`
opaco y los datos de la variante:

| Destino | Datos adicionales |
| --- | --- |
| `text` | `channels:["content"]` |
| `thinking` | `problem:{occurrence,statement}`, `channels:["content"]` |
| `answer` | `ClientQuestion` visible para el alumno más `occurrence`, `questionType` opcional y las opciones y valores estables realmente mostrados; canales aplicables de respuesta, razonamiento y lectura |
| `plugin-question-answer` | `question:{questionId,occurrence,pluginId,typeId,contractVersion,label,variant,showThinking}`; canales aplicables de respuesta, razonamiento y lectura |
| `plugin-problem-submission` | `problem:{problemId,occurrence,pluginId,typeId,contractVersion,label,statement}`; `channels:["submission","thinking"]` |

`PluginSubmissionOccurrence` es exactamente `{messageId,contentIndex,toolCallId,toolName}`.
`PluginSubmissionChannel` incluye content, answer, submission, thinking y readingThinking.
La presentación integrada visible para el alumno no tiene claves de calificación. La
presentación de plugins no promete una sanitización genérica de cargas útiles arbitrarias de
plugins.

`PluginSubmissionContext` añade `messages` separados, de solo lectura en profundidad y
congelados, la `signal` de la preparación y `onAccepted(callback)`. Los mensajes son el
historial nativo completo actual del navegador, incluido contenido posiblemente en streaming
o aún no duradero, no texto renderizado ni una garantía de persistencia canónica. El
historial completo es visibilidad para plugins de confianza, no un límite de secreto. Las
señales y los destinos opacos son referencias vivas del host, no JSON para persistir o
clonar.

`onAccepted` observa la aceptación de la API con acuse de este intento, con independencia de
que el modelo tenga éxito después. Es en vivo y de mejor esfuerzo, no repetición duradera ni
entrega exactamente una vez. Un acuse perdido nunca la dispara ni autoriza a borrar entrada
externa. Los errores de la callback notifican un error del plugin, no el fallo de un envío
aceptado. Toma una instantánea de las callbacks elegibles antes de la entrega, invócalas sin
bloquear el consumo del stream nativo en observadores asíncronos y continúa aunque falle un
observador concreto. Los registros tardíos y las callbacks de propietarios cancelados no se
ejecutan.

## 4. Registro y orden

```ts
interface PluginSubmissionInterceptor {
  id: string;
  priority?: number;
  hasPendingInput?(target: PluginSubmissionTarget): boolean;
  intercept(input: PluginSubmission, context: PluginSubmissionContext):
    PluginSubmission | null | void | Promise<PluginSubmission | null | void>;
}
// Contexto del frontend:
registerSubmissionInterceptor(definition: PluginSubmissionInterceptor): () => void;
refreshSubmissions(): void;
```

Los ID son identificadores en minúsculas con guiones, únicos por activación. La prioridad es
un entero finito, 0 por defecto; primero la más alta y después por ID de plugin e ID de
interceptor. Captura el conjunto ordenado de hooks una vez por intento; los hooks posteriores
ven la salida de los anteriores. `undefined` deja pasar, una sustitución del mismo tipo
transforma y `null` cancela sin enviar. Las excepciones, los rechazos y las salidas no
válidas fallan en cerrado. Valida, clona y congela las sustituciones antes de seguir; una
mutación tardía no puede alterar las cargas útiles.

`hasPendingInput` es síncrono y sin efectos secundarios. Llama a `refreshSubmissions()`
cuando cambie el estado externo. Verdadero habilita la preparación, no la validez final: las
respuestas integradas pueden prepararse antes de que exista la selección o el texto nativos,
pero las preguntas y problemas personalizados siguen exigiendo un valor actual de editor
listo. Los adjuntos solo de contexto no necesitan anunciar disponibilidad nativa. Las
excepciones del predicado notifican errores y no aportan disponibilidad. Anular el registro
o descargar un interceptor capturado cancela la preparación, no lo omite en silencio; los
registros nuevos se suman al siguiente intento.

## 5. Preparación, aceptación y reintentos

Un único ejecutor cubre los mensajes normales, contextuales y de apertura, las
reorientaciones mientras está ocupado, las respuestas integradas y personalizadas y los envíos
de práctica nativos y personalizados:

1. Captura la vista y la aparición nativas y reserva un intento **antes de cualquier
   `await`**.
2. Termina la publicación del dictado o del editor del destino original. Vuelve a comprobar
   la identidad; captura la entrada final del alumno, el borrador del formulario y el
   historial de solo lectura. Nunca cambies de destino tras un `await`.
3. Mantén la preparación separada de la entrega; conserva los borradores visibles y evita
   duplicados.
4. Ejecuta los interceptores ordenados en serie y valida cada salida.
5. Vuelve a comprobar la instancia, la aparición, la disponibilidad y la propiedad del
   plugin. Reconstruye las respuestas integradas derivadas mediante la calificación nativa con
   los datos capturados de la pregunta renderizada, no con campos aportados por el plugin.
6. Crea la vista optimista a partir del contenido preparado; usa la entrega existente por
   POST, admisión o reorientación.
7. Notifica una vez la aceptación con acuse, incluido el recurso interno de reorientación;
   libera la concesión de preparación y entrega con el acuse o el rechazo, **no** al terminar
   el stream del modelo. Pueden prepararse nuevas reorientaciones mientras el trabajo
   aceptado antes sigue en streaming.

La preparación es silenciosa: no se renderiza ninguna fila de progreso, etiqueta, indicador
de carga ni control de Cancelar la preparación. Se mantienen los estados existentes de envío
desactivado y los errores de preparación. La cancelación interna previa al POST (por ejemplo,
al liberar la vista o anular el registro de un interceptor) ignora los resultados tardíos de
los hooks, conserva los borradores y el texto dictado final, y funciona aunque un hook ignore
su señal. Cuando no se capturó ningún interceptor, no se reserva ninguna instantánea del
historial; la validación de la carga útil, la captura del destino, la reserva y las
comprobaciones de elegibilidad se siguen ejecutando. Con interceptores, la instantánea
completa, separada y congelada del historial se captura antes del primer hook, en el mismo
límite de preparación, y la comparten los hooks ordenados. Un fallo usa
`Could not prepare submission ({plugin name}): {message}. Your input has been kept.`
Una vez empieza el POST, se mantiene la semántica nativa de entrega aceptada y cancelación del
turno; la cancelación de la preparación ya no se aplica. Borra solo las revisiones del
borrador capturadas en límites confirmados; las ediciones más nuevas se mantienen. El host
nunca borra material privado del plugin: lo hace su observador de aceptación.

- Reintentar o Continuar del modelo, el reintento por pregunta mal formada, el Siguiente que
  solo es de control y el descarte silencioso no interceptan contenido. Enviar un formulario
  restaurado no aceptado es un intento nuevo.
- El reenvío tras un rechazo por ocupado y el recurso de reorientación a envío reutilizan el
  contenido preparado y los observadores.
- Un acuse perdido requiere conciliación canónica y guardas de pregunta exacta, no borrados
  adivinados ni la invención automática de otro envío. Un envío explícito posterior es nuevo;
  no se añade deduplicación global ni transacción exactamente una vez.
- Entre problemas, un texto vacío con contenido de plugin pendiente es un envío, no un
  Siguiente solo de control.

## 6. Validación y autoridad del host

Captura de forma privada el `QuestionData` nativo con su barajado y su calificación resuelta
reales. Combina el dictado final y los campos de lectura antes de los hooks; después valida
tipos, confianza finita, valores conocidos y únicos, cardinalidad y combinaciones, contenido
con sentido y aplicabilidad de los canales. Rechaza las selecciones desconocidas o
duplicadas en lugar de descartarlas. Conserva el redondeo y el acotado legítimos existentes
de la confianza. Construye las respuestas derivadas con el `buildAnswer` existente contra esa
misma pregunta capturada. Esto es un recálculo en el frontend, no una migración de la
calificación integrada a HTTP.

Las respuestas de texto integradas necesitan texto o imágenes de respuesta; las imágenes de
razonamiento o lectura no bastan. Las respuestas de selección necesitan una selección final,
Otro o dontKnow válidos (que puede aportar un hook). El JSON de los plugins sigue las
comprobaciones canónicas de esquema guardado, refinamiento, disponibilidad y aparición.

La aplicabilidad de respuesta y razonamiento integrados sigue los campos nativos; la de
lectura sigue la política existente de revelación y fase. Las preguntas de plugins siempre
tienen contenido de respuesta, razonamiento solo con `showThinking` y lectura solo en las
comprobaciones de enseñanza. Los DTO públicos tienen vacíos los canales no aplicables; el
texto o las imágenes inyectados no vacíos se rechazan. El transporte y los sobres omiten los
canales no aplicables, conservando la distinción entre ausencia y presencia. Los envíos de
práctica personalizados tienen submission y thinking, no readingThinking.

## 7. Imágenes, transporte y admisión por el modelo

Usa campos de imagen nativos opcionales y aditivos junto a las cadenas existentes; los
registros antiguos se reproducen sin migración. Las entradas de texto, reorientación y
razonamiento nativo llevan `images` opcionales; las respuestas integradas y de plugins llevan
imágenes por canal; la práctica personalizada lleva imágenes de envío y de razonamiento. Los
arrays vacíos se omiten al escribir. Las cadenas siguen siendo la única autoridad de texto de
cada canal. Las peticiones nuevas de la interfaz integrada y de razonamiento incluyen la
aparición exacta; las peticiones nuevas con imágenes exigen ese vínculo, mientras que los
llamantes antiguos sin imágenes siguen siendo compatibles. Vuelve a comprobar el destino
canónico tras los `await` del servidor.

Exige bloques de imagen nativos base64 no vacíos, no File, Blob, URL ni cadenas de ruta. Se
aceptan solo PNG, JPEG, WebP y GIF, comprobando los bytes contra el MIME. Reutiliza la
política real de redimensionado del modelo (valores por defecto existentes: caja de 2000×2000
y 4,5 MiB de carga base64 procesada por imagen). Persiste los bytes aceptados normalizados
para el historial y el modelo; los originales y los dibujos editables siguen siendo del
plugin. No se añade ningún ajuste ni almacén nuevo de número arbitrario de imágenes. Un fallo
del procesador rechaza el envío, no da un éxito sin la imagen ni pistas sintéticas para el
alumno.

Las previsualizaciones optimistas siguen siendo inmediatas. Aplaza la adopción canónica
mientras su POST con imágenes no se haya resuelto, para evitar previsualizaciones duplicadas
normalizadas y originales. Cuando se resuelve la entrega, descarta las instantáneas aplazadas
y concilia de nuevo, incluidos el rechazo y el acuse perdido. Retira solo las entradas
provisionales de ese intento; conserva los borradores y la entrada externa y nunca deduzcas
la aceptación a partir de la conciliación.

| Canal | Ubicación guardada y en la interfaz | Ubicación para el modelo |
| --- | --- | --- |
| Mensaje / reorientación | Bloques de imagen nativos del usuario | Imágenes nativas del usuario |
| Razonamiento de práctica nativo | Detalles del marcador / bloque de razonamiento | Texto etiquetado + imágenes nativas |
| Respuesta a pregunta integrada o personalizada | Contenedor de respuesta del host | Resultado nativo de la herramienta de respuesta |
| Razonamiento / lectura de la pregunta | Contenedores de razonamiento del host separados | Secciones etiquetadas por separado en el resultado de la herramienta |
| Envío / razonamiento de práctica personalizada | Detalles del marcador / tarjeta enviada y razonamiento | Envío y razonamiento etiquetados + imágenes nativas |

Los bytes para el modelo deben ser contenido de imagen nativo, nunca solo metadatos ni base64
dentro del JSON de la respuesta. El orden de los canales en el resultado de una pregunta es
respuesta, razonamiento y razonamiento de lectura. Las imágenes enviadas compartidas son
miniaturas centradas, acotadas en ambas dimensiones por cinco líneas de la prosa configurada
de la sesión, sin recorte ni ampliación ni atenuación con el texto de razonamiento. Al hacer
clic se abren los mismos bytes aceptados en el visor de figuras existente de la sesión, con
ajuste, desplazamiento y zoom y cierre con Escape o X; sin visor de sesión, la
previsualización no es interactiva. Las imágenes de razonamiento quedan dentro de su
desplegable de razonamiento. Los canales que solo tienen imagen siguen visibles, con la
etiqueta `Submitted image`; el texto usa PathText/Markdown normal. Las imágenes del host
quedan fuera de los huecos de renderizado propiedad de los plugins.

Resuelve el **motor de despacho efectivo real**, no un resolutor de proveedores paralelo. La
admisión de un turno nuevo o de solo guardar vuelve a comprobar el destino canónico y la
política efectiva de modelo y redimensionado tras la comprobación previa esperada; no hay
ningún `await` entre medias antes de la escritura o reclamación de la aceptación. La
construcción del agente usa ese motor comprobado. Las reorientaciones mientras está ocupado
capturan la identidad y el modelo del agente vivo, no ajustes futuros de la sesión, y los
verifican de forma síncrona en el traspaso. El recurso tras una ejecución terminada prepara
contra el siguiente motor sin volver a interceptar; los destinos cambiados o sustituidos se
rechazan por obsoletos en lugar de redirigirse en silencio.

Los motores solo de texto rechazan imágenes nuevas. Los endpoints personalizados conservan la
política actual de transporte por intento; un rechazo remoto es un fallo del proveedor. Los
marcadores de omisión por cambio de modelo en el historial, el transporte de
ChatGPT/suscripción/CLI de Claude y el orden texto antes que imágenes de la CLI siguen siendo
nativos. Las reorientaciones aparcadas conservan las concesiones existentes de solo memoria:
la aceptación con acuse puede notificarse, pero no se garantiza historial duradero ni una
notificación reproducible.

## 8. Contrato público de superficies

```ts
interface PluginSurfaceProps {
  title: string; // Nombre accesible, no un encabezado visible del host.
  background?: "dimmed" | "opaque";
  content: PluginUiContent;
  onClose?: () => void | Promise<void>;
}
openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
openSurface(target: PluginSurfaceTarget, props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
```

`PluginSurfaceTarget` es una identidad opaca del host, no DOM, ni un ID de sesión persistido,
ni un token serializable para el backend. El contexto nativo de acciones y envíos lo expone.
La invocación sin destino captura el límite de la página activa **una vez y de forma
síncrona** (vistas de plugins, chat, Inicio, Nuevo borrador), no una página posterior tras
los `await`. Los destinos explícitos identifican una vista nativa montada de enseñanza o
práctica. Los límites vivos que faltan o han caducado lanzan
`Surface target is no longer active`; volver a la misma sesión nunca revive un token. Las
señales ya canceladas devuelven handles inertes antes de resolver el límite. Vuelve a
comprobar la caducidad al confirmar el montaje; una caducidad tardía libera y notifica.

La cobertura es solo el cuerpo de la página. Las barras superiores y la lateral siguen
utilizables; Inicio y Nuevo borrador conservan el conmutador flotante de la barra lateral y
el marco de la ventana, mientras el grafo y el compositor del cuerpo siguen montados pero
inactivos. Las superficies se apilan y conservan el DOM, el estado y el pintado cubiertos.
Solo el contenido elegible en primer plano recibe la interacción del cuerpo. Los hermanos
ordinarios no son dueños del ciclo de vida de los demás: quitar una superficie de plugin
inferior no debe quitar la superficie en primer plano de otro plugin. Las señales de quien
llama pueden vincular ciclos de vida de forma intencionada.

Salir u ocultar la página propietaria, descargar, la cancelación por parte de quien llama o
la liberación desmontan el ámbito; volver a entrar crea un límite nuevo. No hay suspensión y
restauración ni inyección en un padre arbitrario del DOM. El contenido ocupa el ancho y alto
disponibles; la sustitución controlada libera cada montaje antiguo exactamente una vez,
incluida la limpieza asíncrona tardía. Las capas de vista existentes son responsables del
orden, el pintado y el enrutado de la entrada cubierta, no otro registro de modales u
overlays ni un bloqueo de scroll del viewport.

Los diálogos y los Ajustes siempre quedan delante, aunque una superficie se abra desde su
contenido. Esa superficie pertenece a la página, no al modal que la abre; no puede heredar la
elegibilidad de foco o Escape del modal. Si el diálogo se cierra y la señal sigue viva, la
superficie puede aparecer. No despaches envío, Tab ni dictado a entradas cubiertas. Cerrar o
descargar un plugin solo quita sus superficies; los Ajustes globales no pasan a ser
propiedad de una superficie solo por pintarse encima de ella.

Al entrar se conserva el foco elegible existente o recordado, después una marca
`data-plugin-initial-focus` enfocable, visible y montada de forma síncrona, y después campos
editables, encabezados o el marco. No hay reintento asíncrono ni autoenfoque al actualizar.
Sin destinos de contenido, enfoca el marco pintado y etiquetado, no su X flotante ni un
envoltorio que no se renderiza. Los montajes tardíos no pueden robar el foco a capas más
nuevas. Al cerrar, restaura el elemento que la abrió si es elegible y no está cubierto; si
no, el destino recordado o de entrada de la región superviviente. La liberación cubierta o la
caducidad de la página no pueden robar el foco ni restaurarlo en DOM que ya no existe. No se
añade una trampa de foco que abarque la barra superior y la lateral expuestas.

Los títulos son solo accesibles. Una X discreta fijada flota sobre el contenido sin fila de
cabecera ni relleno para la barra de scroll. Los plugins son responsables de los encabezados
y acciones visibles. `dimmed` (por defecto) usa el tinte y el desenfoque nativos; `opaque` es
un fondo sólido sin desenfoque; los valores no válidos se rechazan al montar o actualizar.
Los diálogos comparten la presentación sin cabecera y con X dentro de los límites de su modal.
`onClose` es una notificación, no un veto asíncrono. La cancelación o la liberación
programática siguen la limpieza normal del handle. La propiedad compartida de Escape y del
foco sigue el [contrato de interacción](dialog-overlay-contract.md).

## 9. Pruebas

Cubre el orden y las transformaciones inmutables, la disponibilidad, la publicación final del
habla, la aparición, el modelo, la vista o el registro obsoletos, la cancelación que conserva
los borradores, la intercepción única en el recurso por ocupado, la incertidumbre del acuse,
los bytes de imagen nativos en los canales de interfaz y modelo, y los motores no admitidos.
Las comprobaciones de superficies incluyen límites exactos, estado cubierto conservado,
propiedad de un único Escape, devolución del foco, caducidad de la página, orden de los
modales, limpieza con ámbito de propietario y montajes tardíos. Usa almacenamiento aislado y
proveedores controlados al probar el plugin en la app.
