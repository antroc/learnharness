# Claude Code

LearnHarness puede usar una **CLI de Claude Code** instalada externamente como proveedor de modelos. Esto es independiente de la API de Anthropic y de las conexiones por suscripción integradas. La CLI se encarga de la autenticación, el enrutamiento, el acceso a los modelos y la facturación; LearnHarness **no** garantiza un uso exclusivo de la suscripción.

## Configuración

1. [Instala y autentica Claude Code](https://code.claude.com/docs/en/setup) fuera de LearnHarness, en **la máquina que ejecuta el servidor de LearnHarness** y con su usuario del sistema operativo. No hace falta ningún proceso de la CLI ejecutándose de forma permanente.
2. Haz que el ejecutable pueda encontrarse en el `PATH` de ese servidor o en una ubicación de instalación habitual de usuario o nativa. En Windows se necesita un `claude.exe` ejecutable directamente; un `claude.cmd` por sí solo no sirve. Los entornos de arranque del escritorio pueden diferir de los terminales.
3. Activa **Ajustes → Proveedores → CLI externa → Claude Code**. Esta activación para toda la aplicación está **desactivada por defecto**. Usa **Comprobar de nuevo** para actualizar el estado de la instalación.
4. Selecciona un modelo de Claude Code: `opus`, `sonnet` o `haiku`. Son alias de la CLI, no versiones subyacentes fijas.

La versión mínima es la **2.1.259** ([contrato](../src/core/contracts/claude-code.ts)). La comprobación solo ejecuta `--version`, no la autenticación ni la inferencia. Cada proceso de modelo nuevo vuelve a comprobarlo y rechaza las versiones antiguas o no verificables. Superarla no demuestra el acceso a la cuenta, la cuota, el método de facturación ni la compatibilidad completa del protocolo.

La instalación, la actualización, el inicio de sesión y el cambio de cuenta de la CLI se hacen fuera. LearnHarness no tiene ningún control del estado de la cuenta de la CLI ni de reautenticación. Desactivar la opción bloquea las peticiones futuras sin reescribir la selección de modelos ni cerrar la sesión de la CLI; no interrumpe un turno ya admitido. Para el trabajo en curso, usa la cancelación normal.

## Qué pasa por la CLI

LearnHarness mantiene el control de su bucle de agente, sus herramientas, sus preguntas, el historial guardado y las tareas. Proporciona los prompts, el historial relevante y los resultados de las herramientas al servicio configurado en la CLI.

El lanzador elimina las credenciales inyectadas **únicamente por el almacén de claves de LearnHarness**. Las credenciales originales del entorno de arranque, la autenticación nativa de la CLI y el enrutamiento siguen disponibles y pueden afectar a la facturación. LearnHarness no copia sus claves de API guardadas en este proveedor.

Cada proceso hijo se ejecuta sin shell en un directorio de trabajo temporal vacío. LearnHarness desactiva las herramientas integradas, los hooks, los comandos de barra, la persistencia de sesiones de la CLI y las solicitudes de permiso, y expone sus propias herramientas declaradas mediante un puente MCP de loopback protegido por token. La intención de herramienta transmitida en streaming no basta: la ejecución exige una petición MCP autenticada cuya identidad única, nombre y argumentos coincidan con el stream. No hay alternativa basada solo en stdout.

Son límites de integración, **no un sandbox del sistema operativo ni una certificación de las políticas del proveedor**. Los ajustes y la autenticación del usuario siguen disponibles. Los ajustes gestionados siguen teniendo prioridad donde la CLI los define. El stderr de la CLI, acotado, se registra al cerrarse el proceso, así que los registros del servidor pueden contener diagnósticos de la CLI.

### Carga de instrucciones

LearnHarness fuerza `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` en el entorno del proceso hijo **y** en los ajustes en línea, y fija `outputStyle: default`. Por lo demás, los ajustes de autenticación y enrutamiento del usuario siguen disponibles. El interruptor de memoria documentado de la CLI excluye las instrucciones `CLAUDE.md` de usuario, de proyecto y de políticas gestionadas, sus importaciones y reglas, y la memoria automática; no elimina los ajustes gestionados.

Estos controles dependen de que la CLI los respete. El aislamiento de instrucciones en la versión mínima aceptada, la **2.1.259, no se ha verificado en ejecución**. La documentación oficial no establece la primera versión compatible del interruptor ni el orden exacto de evaluación al arrancar; los ajustes gestionados pueden prevalecer sobre los ajustes en línea. No es una garantía frente a todos los canales de instrucciones de plugins ni frente al contexto de cuenta que añada la CLI.

Referencias oficiales: [interruptor de memoria](https://code.claude.com/docs/en/env-vars#variables), [ficheros de instrucciones gestionados](https://code.claude.com/docs/en/memory#deploy-organization-wide-claude-md), [precedencia de los ajustes](https://code.claude.com/docs/en/settings#settings-precedence) y [valores de entorno de los ajustes](https://code.claude.com/docs/en/settings-reference#env).

## Preguntas, reutilización y cancelación

La transcripción persistida de LearnHarness —no una sesión guardada de la CLI— es la que manda. Normalmente, un proceso hijo termina tras su respuesta final. Puede seguir vivo mientras las herramientas esperan resultados, incluida una pregunta al alumno, y reanudarse solo para el mismo propietario/sesión y con historial, herramientas, modelo, prompt, esfuerzo y entorno compatibles.

Los procesos hijo retenidos caducan tras **10 minutos** de inactividad. El tiempo de espera MCP de la CLI es de **30 minutos**, lo que da margen en lugar de ser un plazo general del modelo. Si no queda ningún proceso hijo apto tras un tiempo de espera, un reinicio o un cambio de configuración, la siguiente llamada empieza de cero y reproduce el historial activo como texto etiquetado de usuario/asistente/herramienta, conservando las imágenes del usuario y de las herramientas. No es el `--resume` de la CLI ni una restauración exacta de los roles nativos o del razonamiento. Los fallos de compatibilidad admitidos se notifican, no se ocultan en silencio con la reproducción.

Abortar termina el proceso hijo y el stream activo. Cancelar una petición de herramienta encolada impide que se admita después, pero no puede deshacer el trabajo ya admitido. La salida normal, el fallo, el aborto y la caducidad por inactividad cierran las llamadas y los listeners del puente y eliminan los directorios temporales, escalando la terminación del proceso si es necesario. La limpieza no está garantizada tras un fallo del sistema operativo o una terminación forzada del servidor.

## Uso y resolución de problemas

Los tokens proceden del uso que informa el stream de la CLI, incluidos los recuentos de caché. Una consulta local a la CLI, hecha en la medida de lo posible, puede informar de un presupuesto de contexto efectivo; puede ser menor que la ventana nominal del modelo debido a la autocompactación de la CLI. Si faltan metadatos, el máximo queda como desconocido, no se adivina.

Los costes en dólares quedan **sin precio** y los menús indican **facturación de la CLI**. LearnHarness no importa los totales en dólares de las líneas de resultado correctas de la CLI; las tarifas internas a cero son marcadores, no inferencia gratuita. Comprueba los cargos reales y los derechos de uso por tu cuenta. Consulta [contabilidad](compaction-accounting.md).

| Síntoma | Qué comprobar |
| --- | --- |
| El modelo no aparece o no está disponible | Activa la opción; comprueba que el ejecutable se encuentra con el usuario/entorno del sistema operativo del servidor. |
| No encontrado, sin comprobar o requiere actualización | Repara o actualiza el ejecutable externo y pulsa **Comprobar de nuevo**. La sonda de versión, acotada, agota el tiempo a los cinco segundos. |
| Cumple el mínimo pero las peticiones fallan | Comprueba fuera la autenticación nativa, el enrutamiento, el acceso al modelo y la cuota. |
| Error de identidad/admisión MCP | Investiga la compatibilidad de la CLI instalada; no esquives las comprobaciones de admisión del puente. |
| Una respuesta inicia un proceso nuevo | Es lo esperado tras la caducidad por inactividad, un reinicio o una validación de reutilización fallida. |
| Sin máximo de contexto ni estimación en dólares | Faltan metadatos de presupuesto o la facturación la controla la CLI; no significa uso cero. |

## Puntos de entrada para mantenedores

[`src/agent/claude-code/`](../src/agent/claude-code/) contiene el descubrimiento y lanzamiento, la adaptación del stream, la admisión MCP, la reutilización, la reproducción y el sondeo de la ventana de contexto. El motor se registra en [`models.ts`](../src/agent/models.ts); la procedencia de las credenciales está en [`auth-env.ts`](../src/core/auth-env.ts). El estado de los ajustes lo expone [`server/claude-code.ts`](../src/server/claude-code.ts).

Las suites `tests/claude-code-*.test.*` usan procesos de CLI y peticiones MCP sintéticos. Cubren los contratos del adaptador, no la idoneidad de una cuenta real, la aprobación del proveedor, la facturación ni la calidad de las lecciones.
