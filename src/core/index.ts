/**
 * LA API PÚBLICA DEL NÚCLEO — el único módulo que puede importar el armazón
 * (app/, components/). Todo lo que se exporta aquí es seguro para el
 * navegador: lógica pura + tipos, sin módulos integrados de node, sin fs, sin
 * red.
 *
 * Las superficies del lado del servidor (streaming del chat, lecturas de
 * stores) viven en cambio tras el barrel de src/server — la ley de
 * importación (eslint.config.mjs):
 *
 *   components/**  →  "@/src/core"        (este barrel, SOLO)
 *   app/**         →  "@/src/core" + "@/src/server"
 *
 * Los módulos del núcleo solo de servidor (emisión/derivación de
 * core/graph.ts) son puros pero necesitan que un llamador del servidor les
 * pase puertos de almacenamiento, así que a propósito NO se reexportan aquí —
 * el servidor los importa directamente. Los TIPOS DE PUERTO de almacenamiento
 * son solo tipos y seguros para el navegador, por eso se reexportan.
 */

export * from "./contracts.ts";
export { embedLearnerImage } from "./learner-image-svg.ts";
export * from "./ports.ts";
export * from "./chains.ts";
export * from "./source-organization.ts";
export * from "./source-selection.ts";
export * from "./source-label.ts";
export * from "./render-settings.ts";

export * from "./question-core.ts";
// El bus de eventos (arquitectura push, 2026-10-02): vocabulario + emit/subscribe
// para cada capa; el armazón del navegador consume los tipos + los nombres en tiempo
// de ejecución a través de este barrel (ley del armazón: núcleo puro solo vía @/src/core).
export * from "./events.ts";
// clusters.ts (Louvain) NO se reexporta a propósito: nada del armazón ejecuta
// detección de comunidades — la instantánea trae la partición del servidor.
// Dejarlo fuera mantiene las pesadas dependencias de clustering fuera del bundle
// del cliente (verificado el 2026-09-13: los chunks lo contenían mientras existía
// esta línea). La misma lógica que layout-settle.ts más abajo.
export * from "./layout.ts";
export * from "./plan-tree.ts";
export * from "./phases.ts";
export * from "./pending.ts";
export * from "./prompt-segments.ts";
export * from "./math-delims.ts";
// Oleada B (aprobada por el responsable el 2026-09-26): el registro nativo
// (LhMessage), el y el contrato de input-events — todo
// lógica pura, seguro para el navegador.
export * from "./native-messages.ts";
export { copyImmutableData } from "./immutable-data.ts";
export * from "./compaction.ts";
export * from "./input-events.ts";
export { parseFilePaths, quoteFilePath, filePathLabel, isDirectoryReference, directoryReferencePath } from "./file-paths.ts";
export type { FilePathPart } from "./file-paths.ts";
export * from "./citations.ts";
export { parseComposerTokens } from "./composer-tokens.ts";
export type { ComposerToken } from "./composer-tokens.ts";
// Oleada D (aprobada por el responsable el 2026-09-26): el modelo de vista del
// cliente — el canon de agrupación (un documento continuo del asistente, separadores de
// pasos) portado de la proyección del servidor ya eliminada al lado del cliente. Puro.
export * from "./view.ts";
export * from "./tool-parts.ts";
export * from "./answer-presentation.ts";
export * from "./prices.ts";
export * from "./context-usage.ts";
export type { ChatGPTStatus, ChatGPTControlBridge } from "./contracts/chatgpt.ts";
export { NATIVE_SUBSCRIPTIONS } from "./contracts/subscriptions.ts";
export type { NativeSubscriptionProviderId, NativeSubscriptionLogicalId, NativeSubscriptionStatus, NativeSubscriptionSnapshot, NativeSubscriptionScope, NativeSubscriptionControlBridge, SubscriptionInteraction, SubscriptionPrompt } from "./contracts/subscriptions.ts";
export * from "./cost-summary.ts";
export { CLAUDE_CODE_PROVIDER, CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeStatus } from "./contracts/claude-code.ts";
export * from "./fuzzy.ts";
// settings.ts + settings-resolution.ts (oleada de almacenamiento de ajustes, 2026-09-19):
// la forma/saneador del registro de ajustes del usuario (puro) y su vista totalmente
// resuelta. Seguros para el navegador — el panel de la oleada 4 los importa directamente.
export * from "./settings.ts";
export * from "./file-access.ts";
// themes.ts (oleada de temas, 2026-11-04): el vocabulario de temas de 12 colores, los
// preajustes y el adaptador tema → tokens CSS — puro, compartido por el layout, el
// provider, Ajustes y la API de temas.
export * from "./themes.ts";
export * from "./dictation.ts";
// graph-deletion.ts (oleada 6): todo el módulo es PURO pero dirigido por puertos de
// almacenamiento — el borrado solo SE EJECUTA en el servidor. El armazón necesita
// exactamente dos cosas solo de tipos: la unión ChatDeleteMode (el diseño de dos
// opciones del diálogo de borrado + el parámetro de DELETE) y la forma de las
// estadísticas que describe su línea de éxito; de ahí esta reexportación solo de tipos.
export type { ChatDeleteMode, ChatDeletionStats } from "./graph-deletion.ts";
export * from "./settings-resolution.ts";
export * from "./search.ts"; // puerto de búsqueda (oleada de búsqueda, 2026-09-20)
export * from "./session-find.ts";
export * from "./session-navigation.ts";
// auth-keys.ts (oleada de claves de autenticación, 2026-09-19): el catálogo curado de
// claves + reglas de forma + enmascarado — puro, seguro para el navegador (la página de
// autenticación se enlaza con las rutas /api/keys construidas sobre él).
export * from "./auth-keys.ts";
// keyboard.ts: el registro de atajos + normalización de combinaciones (puro, seguro para el navegador).
export * from "./keyboard.ts";
export * from "./plugin-shortcuts.ts";
export * from "./coverage.ts";
// session-markdown.ts (motor del 2026-09-27; primer consumidor el 2026-10-06): el
// ÚNICO formateador sesión→markdown — lo comparten la vista del extractor y la
// exportación de cara al usuario. Puro, seguro para el navegador.
export * from "./session-markdown.ts";
// side-chat.ts (conversaciones laterales compartidas): validación de la entrada de
// preguntas, búsqueda de hilos y el documento de lección del modelo lateral. Puro.
export * from "./side-chat.ts";
export * from "./plugins.ts";
export * from "./plugin-questions.ts";
export * from "./plugin-problems.ts";
export * from "./plugin-view-context.ts";
export * from "./plugin-submissions.ts";
export type * from "./plugin-ui.ts";
export type * from "./plugin-tree.ts";
export * from "./plugin-agents.ts";
