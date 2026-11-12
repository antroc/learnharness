## Este NO es el Next.js que conoces

Esta versión tiene cambios incompatibles: las API, las convenciones y la estructura de ficheros pueden diferir de tus datos de entrenamiento. Lee la guía correspondiente en `node_modules/next/dist/docs/` (resuelta desde el directorio de este fichero; en monorepos el paquete `next` puede no verse desde la raíz del repositorio) antes de escribir código. Haz caso de los avisos de obsolescencia.

`next dev` escribe y vuelve a añadir este bloque; compruébalo en `node_modules/next/dist/server/lib/generate-agent-files.js`. Quitarlo de un diff solo vuelve a crear el cambio sin confirmar; hacer commit de él junto con tu trabajo mantiene limpio el árbol.

# Nada de suposiciones

Toda la autoridad de diseño corresponde a la persona. **No supongas nunca una decisión de diseño o de implementación.** Si algo es ambiguo —nombres, comportamiento, formas de los datos, UX, valores por defecto, límites del alcance, redacción de los prompts—, DETENTE y pregunta con la herramienta de preguntas al usuario antes de seguir. Si estás «un poco inseguro», es que no estás seguro: pregunta. Una suposición equivocada sale mucho más cara que una pregunta. Pregunta pronto, de forma concreta y una sola cosa por llamada.

En concreto: primero investiga y planifica con rigor (haciendo al usuario las preguntas de diseño por el camino), consigue que apruebe el plan y solo entonces implementa. La implementación debe ser la ejecución mecánica de un plan aprobado, no una interpretación.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
