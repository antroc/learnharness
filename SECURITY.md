# Política de seguridad

LearnHarness guarda en tu máquina claves de API, tokens de inicio de sesión, chats y registros de aprendizaje, y su agente lee ficheros y descarga contenido web en tu nombre. Si encuentras una forma de abusar de cualquiera de esas cosas, avísanos en privado para que pueda publicarse una corrección antes de que los detalles sean públicos.

## Cómo informar de una vulnerabilidad

**No abras una incidencia, un pull request ni una publicación en Discord públicos para un problema de seguridad.**

Infórmalo mediante el sistema privado de notificación de vulnerabilidades de GitHub:
[Security → Report a vulnerability](https://github.com/amosblomqvist/learnharness/security/advisories/new).

Si esa página no está disponible, escribe a un mantenedor en [Discord](https://discord.gg/5tCHHQEB2e) y pide un canal privado. No incluyas ningún detalle en ese primer mensaje.

Un informe útil incluye:

- la versión de LearnHarness y tu sistema operativo;
- qué puede hacer un atacante y qué necesita previamente (una página web que lea el agente, un fichero que abra el alumno, acceso a la red, etc.);
- los pasos para reproducirlo o una prueba de concepto;
- cualquier corrección o mitigación que se te ocurra.

## Qué esperar

Son objetivos, no garantías:

| Paso | Objetivo |
| --- | --- |
| Acusar recibo de tu informe | en un plazo de 7 días |
| Evaluación inicial (confirmado o no, gravedad) | en un plazo de 14 días |
| Corrección publicada y aviso de seguridad publicado | en un plazo de 90 días desde el informe |

La corrección se desarrolla en privado en un aviso de seguridad de GitHub. Te mantendremos informado, acordaremos contigo una fecha de divulgación y te reconoceremos en el aviso publicado, salvo que prefieras permanecer en el anonimato. Se puede solicitar un CVE a través de GitHub cuando esté justificado.

## Versiones con soporte

Solo la última versión recibe correcciones de seguridad. La aplicación de escritorio se actualiza sola, así que las correcciones llegan a los usuarios mediante una nueva versión. Si la ejecutas desde el código fuente, actualiza a la última `main` o a la última etiqueta de versión.

## Alcance

Dentro del alcance:

- la aplicación de escritorio (carcasa de Electron, ventana e IPC);
- el servidor de API local, tanto si lo inicia la aplicación de escritorio como si se ejecuta desde el código fuente;
- el agente y sus herramientas, incluida la inyección de prompts desde páginas web, PDF u otro contenido que lleve a leer, modificar o enviar tus datos;
- el contenido renderizado, como demostraciones, figuras y markdown;
- el proceso de actualización y publicación de versiones.

Fuera del alcance:

- los ataques que ya requieren ejecutar código como tu usuario del sistema operativo;
- los errores en los propios proveedores de modelos o servicios de terceros (comunícalos al proveedor);
- la salida de escáneres automáticos sin un impacto demostrado en LearnHarness.
