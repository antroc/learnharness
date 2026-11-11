# Modelos personalizados y locales

LearnHarness admite **un endpoint personalizado compatible con OpenAI con varios modelos**, incluido un servidor de modelos local. La configuración y la interfaz parten del PR #62 de Daniel Buckner y Abhishek Thakur. Pi se encarga de la inferencia, la conversión de mensajes, las herramientas, el streaming y el esfuerzo de razonamiento. [Claude Code](claude-code.md) es un proveedor aparte.

## Conectar

1. Abre **Ajustes → Proveedores → + Añadir un proveedor → Endpoint personalizado**, o usa el selector de proveedor del primer arranque.
2. Introduce la URL base completa de la API, por ejemplo `http://localhost:11434/v1`. LearnHarness **no añade `/v1`**. Se admiten HTTP/HTTPS y direcciones de red privada; se rechazan las credenciales incrustadas, las cadenas de consulta, los fragmentos y las redirecciones durante el descubrimiento.
3. Elige **Sin clave** o **Clave de API**. Sin clave ignora las claves personalizadas guardadas o del entorno. Clave de API usa `CUSTOM_OPENAI_API_KEY`; un valor real del entorno prevalece sobre un valor guardado, y el editor indica cuándo la clave procede del entorno.
4. Opcionalmente, introduce identificadores de modelo, separados por comas o espacios, para servidores en los que el descubrimiento de modelos no funcione.
5. Pulsa **Conectar** y selecciona los modelos Potente, Barato y Visión.

Una clave queda vinculada a la URL canónica del endpoint y al modo de autenticación. Cambiar la URL exige una nueva clave efectiva o el consentimiento explícito para reutilizarla; nunca se reenvía en silencio. Borrar la autenticación selecciona Sin clave. Usa este editor —no la gestión genérica de claves— para cambiar las credenciales personalizadas.

Conectar hace la petición `GET <base>/models`; los metadatos informados prevalecen sobre los identificadores introducidos duplicados. Un fallo no fatal del descubrimiento puede recurrir a los identificadores introducidos. Con la misma URL, este recurso conserva la instantánea de modelos y los valores fijados anteriores; una URL distinta empieza su propia instantánea. **Los errores 401/403, las redirecciones y los excesos de tamaño de respuesta o de número de modelos fallan aunque haya identificadores introducidos.** Una conexión fallida sin recurso alternativo deja la configuración sin cambios.

El descubrimiento no es una comprobación continua de salud ni de capacidades. LearnHarness no instala un backend, no descarga modelos ni hace OAuth con endpoints personalizados.

## Presupuestos y razonamiento

Edita sin conexión los valores fijados de cada modelo:

| Ajuste | Resolución |
| --- | --- |
| Presupuesto de contexto | Valor fijado por el usuario → límite informado → **8192 por defecto** |
| Salida máxima | Valor fijado por el usuario → límite informado → **4096 por defecto** |
| Soporte de razonamiento | Declaración del usuario → soporte informado |

Se aceptan valores fijados de tokens enteros positivos, incluidos límites de salida pequeños; dejarlo en blanco elimina el valor fijado. El editor indica qué valores son informados, por defecto o fijados. **Son presupuestos para las peticiones y la compactación, no órdenes para cambiar el tamaño del contexto del backend.** Configura el servidor por separado y haz que coincida con sus límites activos. Al reconectar, los valores fijados solo se depuran para quedarse con los identificadores de modelo resultantes.

El soporte de razonamiento declara una capacidad; no activa su ejecución. El selector normal de esfuerzo de Pi sigue disponible, pero **Desactivado puede no desactivar el razonamiento por defecto de un backend**. No hay inferencia a partir del nombre del modelo, ni preajuste de Ollama, ni editor de mapa de razonamiento/compatibilidad, ni editor de cabeceras no estándar.

## Imágenes

Todos los modelos personalizados se pueden seleccionar como Visión; los que informan de que admiten imágenes aparecen primero. Elige un backend que entienda imágenes de verdad.

Toda petición con imágenes al motor personalizado intenta entregarlas aunque el descubrimiento no indicara soporte de imágenes. Esto incluye lecturas de ficheros, páginas de PDF y vistas previas visuales. Una autorización del modelo local a la petición permite a Pi codificar imágenes sin cambiar lo que el catálogo declara sobre sus capacidades. Los servidores que solo admiten texto pueden rechazarlas; los errores se muestran sin recurrir en silencio a solo texto. Las pruebas de entrega de la carga útil no demuestran la calidad con imágenes de un modelo real.

## Edición, credenciales y recuperación

La configuración no secreta se guarda en `settings.json.customProvider`; las claves guardadas y una vinculación interna están en `auth.json`. La autorización exige que coincidan los identificadores de vinculación, la URL y el modo. Un fallo entre las escrituras de autenticación y de ajustes deja el proveedor desactivado en lugar de enviar una clave a un endpoint que no corresponde. Sin clave también necesita una vinculación no secreta válida, pero nunca resuelve una clave. Si falta el almacenamiento privado, se puede inicializar; un almacenamiento mal formado o ilegible falla de forma segura sin sobrescribirse.

Si la autorización se interrumpe, recarga y vuelve a conectar explícitamente. Una clave del entorno que cambia de endpoint no autoriza una clave guardada que quede oculta para esa nueva URL. Desconectar impide que una clave latente del entorno reactive el proveedor. Son protecciones frente a fallos y reinicios, no una garantía transaccional frente a cortes de corriente/fsync.

Los guardados obsoletos del editor devuelven **409**: recarga y vuelve a intentarlo. Las modificaciones conservan los cambios de ajustes no relacionados; las ediciones fallidas no se dan por correctas. Cada nueva operación de modelo resuelve el endpoint, las credenciales, los límites y el esfuerzo vigentes; las peticiones en curso mantienen su configuración. Desconectar o quitar un modelo no reasigna las selecciones guardadas ni reescribe el historial.

Los límites del descubrimiento son **15 segundos**, **8 MiB** y **10.000 modelos**; los cuerpos de configuración están limitados a **64 KiB**. Las comprobaciones de capacidad del escritorio y de mismo origen del navegador no son autenticación multiusuario.

## Precios y configuraciones de desarrollo antiguas

Los precios son **desconocidos/sin precio**, no 0 $, incluso con un servidor local. Las tarifas internas a cero son marcadores que exige Pi; no hay editor de tarifas. Consulta [contabilidad](compaction-accounting.md).

La configuración anterior `models.json`, que nunca llegó a publicarse, no se lee ni se migra. Los perfiles de desarrollo antiguos necesitan configurar el endpoint de forma explícita, reconectar y volver a seleccionar los modelos; los ficheros y el historial no se borran ni se reasignan en silencio.

## Puntos de entrada para mantenedores

- [`server/custom-provider.ts`](../src/server/custom-provider.ts): descubrimiento y registro; [`custom-provider-http.ts`](../src/server/custom-provider-http.ts): revisiones HTTP y límites de las modificaciones.
- [`custom-provider-auth.ts`](../src/server/custom-provider-auth.ts) y el [contrato de vinculación](../src/core/custom-provider-auth.ts): autorización de credenciales y comportamiento al reiniciar.
- [`agent/models.ts`](../src/agent/models.ts): resolución del motor por operación y autorización de imágenes.

`tests/custom-provider-*.test.*` cubre endpoints simulados, fallos de vinculación y reinicio, edición concurrente, interfaz y entrega de la carga útil; no la instalación del backend ni las capacidades de modelos reales.
