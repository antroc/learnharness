# Skill de autoría de plugins de LearnHarness

Esta es la **skill completa**, no solo sus instrucciones de `SKILL.md`. La carpeta
`learnharness-plugins/` descargada contiene documentación Markdown indexada, una referencia
completa de la API, los proyectos fuente canónicos de los plugins oficiales, Hello y
recetas centradas sin compilación, y el SDK público de la API solo de tipos. No hace falta
clonar el repositorio ni conexión a internet para leer los materiales o probar el plugin
Hello. Los ejemplos que usan modelos requieren tu conexión configurada y pueden tener coste
cuando se ejecutan explícitamente.

## Dásela a tu agente de programación

1. En LearnHarness, abre **Ajustes → Plugins de la comunidad → Descargar skill de autoría**.
2. Extrae el ZIP en algún sitio con permiso de escritura. Conserva la carpeta
   `learnharness-plugins/` completa.
3. Dale a tu agente de programación la ruta de la carpeta y esta instrucción:

   > Lee `/path/to/learnharness-plugins/SKILL.md`. Usa la documentación, los ejemplos y
   > los tipos de la API incluidos para ayudarme a crear un plugin de LearnHarness.
   > Pregúntame por el comportamiento del producto antes de implementarlo.

Empieza por [las instrucciones de la skill](SKILL.md) y después por el mapa de la
documentación de la guía de autoría. Enlaza la referencia completa de la API, las guías por
tarea y las rutas de lectura de los ejemplos de código. Para que la skill se descubra
automáticamente, pon la **carpeta completa** en el directorio de skills que admita tu
agente de programación, siguiendo su documentación. Cada agente usa ubicaciones de proyecto
o globales distintas y puede requerir una recarga o una activación explícita. LearnHarness
no elige ninguna ubicación ni instala ni configura ningún agente. Si el agente no tiene
función de skills, la instrucción explícita con la ruta del fichero sigue funcionando.
Copiar solo `SKILL.md` rompe el acceso a sus materiales de apoyo.

Los ejemplos extraídos son material de autoría, no plugins ya instalados.
Hello y las recetas centradas incluyen paquetes compilados que puedes copiar en el
directorio de plugins con permiso de escritura. Los proyectos oficiales son referencias de
código fuente; cuatro tienen IDs reservados del núcleo y no pueden instalarse como copias
de la comunidad sin cambios. Sigue la guía de ejemplos; no instales la carpeta completa de
la skill como un plugin de LearnHarness.

## Compatibilidad

Lee `bundle.json` para conocer la **versión de la app** que lo produjo, la **versión de la
API de plugins** y la **versión del paquete del SDK**. Son números de versión distintos. La
API v1 puede ganar capacidades sin cambiar su número; usa la documentación y los tipos de la
app a la que te diriges, en lugar de suponer que todo host con la API v1 tiene todas las
funciones.

Los manifiestos de distribución exportados de Hello y de las recetas exigen, por prudencia,
al menos la versión de la app que los produjo. Los manifiestos de las referencias de código
oficiales se conservan sin cambios; usa la versión productora para identificar la API
correspondiente en lugar de tratar esos manifiestos como garantías de compatibilidad
independientes. Para tu propio plugin, elige un `minAppVersion` más antiguo solo tras
comprobar que la app antigua ofrece todas las capacidades que usas. Tras actualizar la app,
descarga una skill nueva que coincida cuando quieras usar API nuevas. Este paquete no
promete compatibilidad hacia delante ni cambia las reglas de compatibilidad del host.

## Qué incluye

- `SKILL.md`: punto de entrada para el agente de programación y salvaguardas.
- `docs/`: la guía de autoría canónica y el mapa de la documentación, los contratos de
  funcionalidades, las rutas de lectura de los ejemplos y la arquitectura del host.
- `docs/plugin-api/`: Markdown generado e indexado de toda la API pública y de los tipos de
  apoyo locales a los que hace referencia. No hace falta ningún sitio web ni servicio de red.
- `tools/install-plugin-local.mjs`: un helper sin dependencias para instalar fuera del
  espacio de trabajo. La guía de autoría documenta el comando npm con ruta explícita.
- `examples/plugins/`: Hello como punto de partida; Managed Agent y Teaching Extension como
  recetas centradas con distribuciones sin compilación.
- `plugins/`: los proyectos fuente reales de Flashcards, Coding Questions, Drawing Pad,
  Rich Code Blocks y UI Showcase, incluidas la configuración de compilación, las pruebas y
  las licencias. Se excluyen las compilaciones generadas, las dependencias, las copias
  locales del SDK y los datos de alumnos.
- `types/`: el paquete local solo de tipos `learnharness-plugin-api`. No tiene
  exportaciones en tiempo de ejecución; los proyectos TypeScript deben proporcionar sus
  dependencias *peer* declaradas durante el desarrollo. La app nunca instala dependencias
  para un plugin.
- `bundle.json`: información de versiones de estos materiales exactos.
- `LICENSE`: la licencia AGPL existente de LearnHarness, que también cubre el código de los
  ejemplos.

Mantén juntos estos directorios. Las dependencias de compilación no se incluyen. Algunas
pruebas de los proyectos fuente incluidos requieren una copia del repositorio de
LearnHarness o un host aportado explícitamente; los README de los proyectos señalan esos
límites. Compilar plugins, instalar dependencias, configurar el agente de programación y
cualquier trabajo de pago o con modelos siguen siendo acciones separadas bajo tu control.
