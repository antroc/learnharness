<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>Un arnés de agentes para aprender.</strong></p>

<p align="center">
  <a href="https://learnharness.ai">Descargar</a> ·
  <a href="#cómo-funciona">Cómo funciona</a> ·
  <a href="docs/README.md">Documentación</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Incidencias</a> ·
  <a href="https://discord.gg/5tCHHQEB2e">Discord</a>
</p>

LearnHarness usa agentes de IA para planificar e impartir lecciones que te llevan desde lo que entiendes ahora hasta tu objetivo. Construye una imagen detallada de lo que entiendes y de cómo razonas, y esa imagen se actualiza a medida que aprendes.

En lugar de limitarse a darte una explicación, usa tus respuestas y tu forma de pensar para decidir qué necesitas a continuación. La enseñanza construye la comprensión paso a paso, un razonamiento cada vez. La práctica la hace utilizable. Un grafo de conocimiento persistente la conserva de una sesión a otra.

![Sesión de enseñanza de LearnHarness](docs/assets/teaching-session.png)

## Cómo funciona

1. **Medir.** Antes de enseñar, el agente averigua hasta dónde llega tu comprensión en cada parte de la que depende la lección. Tus respuestas, tu grado de confianza y tu razonamiento le indican por dónde empezar.
2. **Planificar.** Elabora un mapa de dependencias desde ese punto de partida hasta tu objetivo. Puedes ver el plan, y la lección se adapta cuando tu comprensión resulta ser distinta de la prevista.
3. **Enseñar.** Cada paso se apoya en algo que ya entiendes. Haces una predicción, recibes una explicación y compruebas lo que has entendido. Las confusiones se corrigen antes de construir nada encima. El objetivo es que la meta te parezca evidentemente cierta, no solo familiar.
4. **Practicar.** Sesiones aparte plantean problemas variados que exigen que el conocimiento adecuado te venga a la cabeza sin que nadie lo nombre antes. Los problemas y las pistas se adaptan a tu razonamiento.

**Piensa en voz alta.** Los campos de razonamiento te permiten explicar con tus propias palabras tu razonamiento, tus dudas y tus reacciones. Así el agente obtiene una imagen detallada y no un simple registro de aciertos y fallos. Puedes escribir o usar el dictado.

**Trae tus ficheros.** En la aplicación de escritorio, adjunta PDF, fotos o cualquier otro fichero con el clip, o arrástralos. El fichero se queda donde está: el mensaje lleva su ruta y el agente lo lee desde allí.

El agente también puede investigar preguntas en segundo plano, crear explicaciones visuales, mostrar tus propias imágenes en la lección y anotarlas con flechas y etiquetas, y construir demostraciones interactivas.

## Conocimiento que se acumula

Lo que se te enseña se acumula en forma de proposiciones y cadenas de razonamiento: afirmaciones concretas y las premisas que llevan a ellas. El grafo muestra esta estructura, con enlaces a las sesiones de origen. También puedes importar notas.

Las futuras sesiones de enseñanza pueden leer el grafo en lugar de empezar de cero. Las sesiones de práctica pueden sacar su material de él. Guarda las ideas y sus conexiones, no valoraciones de tu capacidad.

![Grafo de conocimiento de LearnHarness](docs/assets/knowledge-graph.png)

## Descarga y primeros pasos

**[Descarga desde learnharness.ai](https://learnharness.ai)** · [Versiones en GitHub](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** DMG firmado y notarizado. Arrastra la aplicación a Aplicaciones.
- **Windows (x64):** ejecuta el instalador. De momento no está firmado; Windows puede mostrar un aviso de «editor desconocido» o de SmartScreen.
- **Linux (x64):** haz ejecutable el AppImage y ábrelo, o instala el `.deb` de Debian/Ubuntu.

Elige tus modelos y empieza una sesión con lo que quieras entender. Puedes usar claves de API de los proveedores, las conexiones por suscripción compatibles en la aplicación de escritorio, una [CLI de Claude Code](docs/claude-code.md) instalada o un [endpoint personalizado compatible con OpenAI](docs/custom-providers.md), incluido un servidor de modelos local. El dictado y la búsqueda web, ambos opcionales, usan claves de servicio aparte. La investigación web puede usar una clave de Tavily, Brave, Exa, Firecrawl u Ollama en Ajustes → Proveedores → Búsqueda. La búsqueda de Ollama usa su servicio alojado, no un servidor de modelos local.

Consulta [Primeros pasos](docs/getting-started.md) para la configuración de modelos, el dictado, los ficheros y la importación de notas, y [contexto, caché y costes](docs/compaction-accounting.md) para las preferencias avanzadas de caché.

Las tres plataformas admiten actualizaciones desde la propia aplicación.

## Tus claves, tus datos

- **Tus claves y tus modelos.** Sin suscripción ni recargo de LearnHarness. La facturación depende de tu proveedor, de la configuración de la CLI, de tu suscripción o de tu instalación local. El contador de coste en vivo estima los costes conocidos de API, no los cargos de suscripciones, CLI o endpoints personalizados.
- **Almacenamiento local.** Tus chats, tu grafo, tus ajustes y tus claves de API se guardan en tu máquina. Los registros de aprendizaje son ficheros de texto plano que puedes inspeccionar.
- **Servicios externos.** Los modelos se ejecutan a través de los proveedores que configures. Las peticiones a los modelos envían el contexto necesario para la tarea; la investigación web y el dictado también contactan con servicios externos. Almacenamiento local no significa procesamiento sin conexión.
- **Comportamiento inspeccionable.** Los prompts de sistema son visibles y editables. La aplicación es de código abierto con licencia AGPL-3.0.

## Desarrollo y soporte

```bash
npm ci
npm run plugins:setup
npm run dev        # http://localhost:3000
npm test           # fixtures y proveedores simulados
```

Consulta el [índice de la documentación](docs/README.md) para ver todas las guías, [desarrollo](docs/development.md) para la configuración y las comprobaciones, [arquitectura](docs/architecture.md) para el runtime, los [atajos de teclado](docs/keyboard.md), [temas](docs/themes.md) para el formato de los ficheros de tema y [compilaciones y versiones de escritorio](docs/desktop-release.md).

Para plugins locales de confianza, empieza por la [guía de autoría y el mapa de capacidades](docs/plugin-authoring.md). Enlaza los contratos de preguntas, problemas de práctica, envíos, contexto de vista e interfaz. Usa [`examples/plugins/`](examples/plugins/) para plantillas pequeñas ejecutables, [`plugins/`](plugins/) para los proyectos fuente de funcionalidades y la [arquitectura del host](docs/plugin-architecture.md) para los detalles internos.

Preguntas, informes de errores y peticiones de funcionalidades: [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues).

Vulnerabilidades de seguridad: infórmalas de forma privada como se describe en [SECURITY.md](SECURITY.md), no en incidencias públicas.

## Licencia

[AGPL-3.0](LICENSE)

La aplicación es gratuita y abierta para siempre. Si alguna vez cobramos por algo, será por comodidad —claves gestionadas, alojamiento—, nunca por funcionalidades que puedas ejecutar en local.
