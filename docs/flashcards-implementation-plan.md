# Tarjetas de memoria: implementación nativa primero

**Autorizado:** empezar la implementación. Mantenerlo sencillo; en la v1 no hay exportación/importación de Anki, dependencias, recursos, conversión ni trabajo de compatibilidad. El borrador exhaustivo anterior queda sustituido.

## Paquete pequeño, servicios del host existentes

El código fuente está en `plugins/flashcards/`, con su propio manifiesto de compilación y lockfile. Compila una carpeta `flashcards` normal e instalable; no instales encima del plugin o los datos activos de la persona ni cambies las dependencias raíz de la aplicación.

- **Almacén local:** una única instantánea JSON versionada en `ctx.dataDirectory`, escrita por sustitución atómica. Contiene mazos, colecciones de proposiciones/pistas, calendarios, historial de repaso y progreso de generación. Sin servicio de base de datos, sin un framework genérico de repositorio y sin API adicional del host.
- **Biblioteca:** mazos por defecto planos basados en las fuentes, pertenencias personalizadas opcionales, búsqueda, edición/borrado de pistas y Archivar. Las pertenencias compartidas referencian una única colección/calendario por proposición. Conserva al menos una pertenencia; borrar un mazo nunca borra tarjetas ni progreso.
- **Generación:** usa el selector de conocimiento real del host, lee las proposiciones públicas del grafo y sus cadenas inmediatas, incluye las pistas existentes/borradas y agrupa la entrada en fragmentos configurables de unos 4.000 tokens. Envía tareas `ctx.workers` independientes y validadas a través de la admisión del host. Sigue la ranura barata actual salvo que se personalice. Un lote activo, sin reintentos ni repeticiones automáticas del modelo. Los fragmentos correctos se aplican de forma independiente. La navegación no cancela el trabajo aceptado.
- **Repaso:** pensar → revelar → Again/Hard/Good/Easy. Una pequeña adaptación de FSRS-6 con atribución, parámetros publicados, retención del 90 %, aprendizaje 1m/10m y reaprendizaje 10m. Programa las proposiciones, pondera las pistas según el último resultado y mantén la misma pista durante el aprendizaje/reaprendizaje. Límite diario de nuevas inicialmente de 20 por mazo; el trabajo pendiente no tiene tope. La introducción cuenta en todas las pertenencias actuales, pero solo el mazo que se estudia o que admite controla la admisión.
- **Renderizado/ajustes:** usa `mountMarkdown`, botones/diálogos/selectores/ajustes controlados por el host y una limpieza con ámbito. Sin importaciones de componentes privados, sin un parser de Markdown duplicado y sin infraestructura de workers local del plugin.

## Protecciones prácticas, no otra plataforma

Valida las entradas del backend; conserva los borradores de edición fallidos. Evalúa solo los tickets de repaso actuales y ya revelados; haz que las valoraciones aceptadas y el despacho de tareas del modelo sean idempotentes. Mantén los marcadores de cancelación/aplicación en la misma instantánea local. Concilia los resultados aceptados tras un reinicio sin hacer una nueva llamada al modelo. Usa errores explícitos en lugar de truncar el contexto en silencio, recurrir a modelos alternativos o restablecer los datos.

Usa inicialmente intervalos de FSRS deterministas (el valor por defecto de referencia sin fuzz). Los días de estudio locales empiezan inicialmente a las 04:00; los pasos dentro del día usan los minutos realmente transcurridos. Las ecuaciones publicadas siguen probándose contra la referencia; el comportamiento local de la cola y el calendario es un adaptador, no una afirmación de que la programación sea idéntica a la de Anki.

## Aprendizaje sobre la infraestructura

Este plugin es un consumidor de referencia de una API que todavía evoluciona. Informa a la persona de la fontanería excesiva, los rodeos incómodos o las capacidades que falten, en concreto, en lugar de ocultarlos tras un framework propio.

Limitación conocida: el lector público del grafo expone los títulos y las rutas de las fuentes, pero no los nombres visibles personalizados de las fuentes importadas que usa el selector del host. Las etiquetas iniciales de los mazos pueden usar esos títulos públicos/nombres base y siguen siendo editables. Nada de rodeos a través del almacén privado.

## Verificación y entrega

Ejecuta pruebas nativas específicas de generación, persistencia, programación, pertenencias compartidas, repaso, cancelación y recuperación. Compila el paquete externo y ejercita su interfaz en un entorno de app/navegador desechable. Simula el transporte del modelo; no llames a proveedores de pago ni toques datos de aprendizaje reales. Informa con honestidad de los resultados observados y de las carencias que queden. Sin instalación automática, sin ediciones en la raíz del host, sin commit, push ni publicación.
