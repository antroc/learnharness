# Cómo contribuir a LearnHarness

Son bienvenidos los informes de errores, las correcciones acotadas, la documentación, las revisiones y las pruebas. LearnHarness es un proyecto dirigido por sus mantenedores con una experiencia de aprendizaje central deliberada.

## Dirección del proyecto

Comenta con los mantenedores **antes de implementar** cualquier cambio relevante en la visión del proyecto, la metodología de enseñanza, el comportamiento del agente, la arquitectura central o los flujos de trabajo principales. Las funcionalidades nuevas, las integraciones y los cambios en el formato de almacenamiento también requieren hablarlo antes.

Una corrección restablece el comportamiento previsto; cambiar cuál debería ser ese comportamiento es una propuesta de diseño. Si ese comportamiento no está claro, coméntalo primero. Una corrección que exija cambios importantes de arquitectura o de almacenamiento también necesita un acuerdo sobre el enfoque.

Los plugins son el lugar previsto para las capacidades opcionales que no pertenecen al núcleo. La infraestructura de plugins aún está en desarrollo, así que plantea el caso de uso en vez de dar por hecho que existe un punto de extensión estable.

## Antes de empezar

Revisa las incidencias, los PR y el [tablero de trabajo público](https://github.com/users/amosblomqvist/projects/2) en busca de trabajo relacionado. **In progress** (en curso) significa que alguien ya está trabajando en el problema; coordínate antes de empezar una implementación paralela. Que algo esté en el tablero no supone, por sí solo, que se haya acordado implementar una propuesta.

- [Issues](https://github.com/amosblomqvist/learnharness/issues): errores concretos y trabajo de implementación acordado.
- [Discussions](https://github.com/amosblomqvist/learnharness/discussions): ideas de funcionalidades y propuestas de diseño de cierto calado. Explica el problema, el comportamiento propuesto y las alternativas relevantes.
- [Discord](https://discord.gg/5tCHHQEB2e): preguntas rápidas y conversación. Deja constancia en GitHub de las propuestas y decisiones que impliquen acciones, para que otros puedan encontrar el contexto.

## Pull requests

**Centra cada PR en un único problema coherente.** Incluye las pruebas y la documentación necesarias para ese cambio, pero deja para PR independientes las correcciones no relacionadas, las refactorizaciones, las actualizaciones de dependencias y los cambios de formato. Sigue la arquitectura y las convenciones existentes.

Usa un **lenguaje claro, preciso y conciso**. Explica:

- El problema, con un enlace a la incidencia o discusión correspondiente si existe.
- Qué ha cambiado y por qué resuelve el problema.
- Cómo lo has verificado, incluidas las limitaciones importantes y lo que no se ha probado.

Evita la jerga innecesaria, el texto de relleno extenso y las afirmaciones sin respaldo. Distingue el comportamiento observado de las hipótesis.

Valoramos las contribuciones por sus resultados, no por las herramientas usadas para producirlas. Las contribuciones asistidas por IA y las escritas a mano siguen los mismos estándares; no es obligatorio declarar el uso de IA. Eres responsable de la exactitud de la descripción, la implementación, las pruebas y la documentación.

### Verificación

Ejecuta las comprobaciones pertinentes y añade cobertura de regresión cuando sea útil. Describe brevemente lo que has probado realmente y cualquier limitación importante; por ejemplo, si has usado un proveedor real o respuestas simuladas.

Consulta la [guía de desarrollo](docs/development.md) para la configuración y los comandos de comprobación, y la [referencia de arquitectura](docs/architecture.md) para los límites del runtime.

## Informes de errores

Indica la versión de la aplicación y el entorno relevante, qué hiciste, qué esperabas y qué ocurrió. Añade el proveedor/modelo cuando proceda y, si es posible, un ejemplo mínimo, una captura de pantalla o un error con los datos sensibles ocultos. Indica si el problema se repite y cualquier solución provisional que hayas encontrado. No hace falta que conozcas la causa raíz.

No publiques credenciales, tokens, registros de aprendizaje privados ni materiales de curso privados, ni los uses como fixtures de prueba. Es preferible usar ejemplos sintéticos o que se puedan compartir.

## Revisión y reconocimiento

Los mantenedores deciden la dirección del proyecto y qué se acepta. La revisión puede dar lugar a modificaciones, a reducir el alcance, a más discusión o a la decisión de no seguir adelante. Que las pruebas pasen no demuestra, por sí solo, que un comportamiento propuesto tenga cabida en el producto.

Cuando conviene, partimos de las implementaciones de quienes contribuyen y trabajamos las revisiones con sus autores. Podemos integrar una contribución con cambios de remate conservando la autoría y el reconocimiento adecuado; adoptar parte de un PR no supone aceptar la propuesta completa.

Un PR no garantiza su aceptación ni su inclusión en una versión concreta. Integrar y publicar son pasos distintos; consulta el [tablero de trabajo](https://github.com/users/amosblomqvist/projects/2) y las [versiones](https://github.com/amosblomqvist/learnharness/releases) para conocer el estado actual.

**¿Te interesa contribuir con regularidad?** Si quieres ayudar a mantener LearnHarness, revisar y rematar correcciones o apoyar a otras personas que contribuyen, escríbeme a [contribute@learnharness.ai](mailto:contribute@learnharness.ai). Cuéntame un poco sobre tus intereses y cómo te gustaría ayudar.

LearnHarness se distribuye con licencia [AGPL-3.0](LICENSE).
