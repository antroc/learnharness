# Primera versión (0.3.0): lista de pulido + la cuestión del bloqueo

> **Notas de planificación históricas (2026-10-06), no la lista de comprobación actual de
> publicación.** Las ideas y los estados originales de más abajo pueden haber quedado
> sustituidos o sin implementar.
> Consulta [Compilaciones y versiones de escritorio](../desktop-release.md) para el
> procedimiento de publicación actual, y [Arquitectura](../architecture.md) /
> [Desarrollo](../development.md) para el sistema y la guía de desarrollo actuales. Consulta
> también el [índice del archivo](README.md).

Empezado el 2026-10-06, ronda de volcado de ideas del propietario. Prioridad 1: todo lo demás (niveles de evaluación → docs/vision-assessment.md) va después. Los puntos se recogen tal como se dijeron; las decisiones de diseño que contienen están **sin decidir** salvo que se indique.

## Puntos de pulido (lista del propietario, 2026-10-06)

1. **Interruptor del render del grafo, separado del flujo de extracción.**
   Hoy el interruptor de activar/desactivar el grafo activa o desactiva la extracción. Se
   quieren dos interruptores: uno para el *flujo* (con un nombre que diga lo que hace) y
   otro para el *render* ("grafo activado/desactivado" = la vista del grafo se representa o
   no). Los datos, el modelo de cadenas y la extracción siguen funcionando con el render
   desactivado.
   - Abierto: **¿cuál es la vista de inicio cuando el render del grafo está desactivado?**
     Debe conservar el botón de importar notas, el botón de la vista de cadenas y el
     indicador de coste del flujo del grafo. Candidata planteada y no rechazada: la vista de
     cadenas (la tabla de cadenas ya es una presentación completa, sin grafo, de las
     proposiciones + las cadenas). Se planteó y se rechazó un "DAG gigante". Sin decidir.
2. **Navegación con teclado para las preguntas**: los botones de flecha (pregunta
   siguiente/anterior) ahora solo funcionan con clic; convertirlos en atajos de teclado
   reales, con atajos de VIM (j/k o similar) como objetivo. Quizá reasignables, quizá no;
   sin decidir.
3. **Nombres de las sesiones.** Usar el primer mensaje como nombre no queda limpio (el
   primer mensaje siempre es largo). Al propietario no le gustan los nombres generados por
   un LLM. Se consideró una ventana emergente para poner nombre tras el primer envío;
   posiblemente molesta; sin decidir. (Hecho: el título de la barra superior ya permite
   renombrar con un clic; lo que se haga debe ser coherente con ello).
4. **Exportar sesiones como markdown**: probablemente una acción del menú contextual de una
   sesión en la barra lateral. (Hecho: core/session-markdown.ts ya representa sesiones
   completas en markdown para la extracción; la serialización existe).
5. **Exportar las cadenas de razonamiento / el grafo**: formato sin decidir (JSON es el
   candidato obvio: servir la instantánea del grafo). Ubicación sin decidir.
6. **Ajuste de los valores por defecto del grafo**: los valores actuales no son ideales;
   menor.
7. **Diálogo de resumen de la compactación**: cubre toda la pantalla y no queda bien; Esc
   muestra una pregunta de descarte en lugar de simplemente cerrar. Norma establecida:
   **Esc siempre actúa sobre el elemento actual en pantalla.**
8. **Auditoría general del teclado**: todo debe funcionar desde el teclado; algunas cosas
   menores no lo hacen. Los ejemplos se enumerarán en la ronda.

## ¿Qué cambia en el desarrollo al "publicar"? (la cuestión del bloqueo)

Postura acordada el 2026-10-06: publicar significa que **los datos de usuario en disco
adquieren obligaciones de compatibilidad**: después de la 0.3.0, los cambios del esquema
persistente son migraciones con lecturas tolerantes, no ediciones libres más borrar tus
datos de desarrollo. Nada queda congelado para siempre; cambia la disciplina.

Superficies persistentes (el conjunto de obligaciones):
- `data/chats/*.json`: ChatRecord: mensajes (formas de comunicación de pi-ai: bloques de
  razonamiento, toolCalls, uso), turnos, kind, graphContext. El bloqueo más profundo, y
  acoplado a la serialización de la biblioteca pi-ai (tras la publicación, actualizar pi-ai
  pasa a ser un evento de migración).
- `data/graph/`: nodes.jsonl, chains.jsonl, coverage.jsonl, sources.json,
  sessions.jsonl (libros de solo añadir), positions.json, render-settings.json.
- `data/settings.json` (modelos, interruptores, compactación…), `auth.json` (claves BYOK).
- localStorage del cliente (cámara, filtros, zoom, filtro de tipo).
- `data/jobs/`: se trata como temporal, sin obligación.

Huecos conocidos que cerrar *antes* de publicar (propuestas, sin decidir):
- **No hay schemaVersion en ningún sitio.** Barato ahora, fundamental después: marcar
  ChatRecord, los ajustes y los libros con una versión al escribir; los lectores tratan la
  ausencia como la versión actual. Esto es lo que hace indoloras las migraciones
  posteriores.
- **Fijar las versiones exactas de pi-ai/pi-agent-core** para que las formas de los
  registros solo cambien de forma deliberada.
- Ingeniería de publicación fuera del código: la firma y la notarización esperan a la
  inscripción en Apple Developer (hoy el DMG no está firmado); no hay actualizador
  automático (la descarga manual es aceptable para la 0.3.0 si se indica); la ubicación de
  los datos en la app empaquetada ya es correcta (LH_DATA_DIR → userData).
