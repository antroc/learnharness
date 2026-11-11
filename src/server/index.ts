/**
 * LA SUPERFICIE DEL SERVIDOR: el único módulo de src (además del barrel del
 * núcleo) que app/ puede importar. Los route handlers y los componentes de
 * servidor pasan por aquí; nada bajo app/ toca src/store ni src/agent
 * directamente.
 */

export * from "./chat-handler.ts";
export * from "./events-stream.ts";
export * from "./chats.ts";
export * from "./graph.ts";
export * from "./source-organization.ts";
export * from "./source-deletion.ts";
export { NotesImportError } from "../agent/subagents/extraction.ts";
export { convertPdf } from "../agent/subagents/pdf-ops.ts";
export { joinPages } from "../agent/subagents/pdf-markdown.ts";
export * from "./commit-positions.ts";
export * from "./jobs.ts";
export { prepareSubmissionImages, prepareSubmissionImageChannels } from "./submission-images.ts";
export * from "./stores.ts";
export { refreshWorkerRequestAdmission } from "../agent/worker-request-admission.ts";
export { readRenderSettings, writeRenderSettings } from "../store/render-settings.ts";
// El registro de ajustes + las sustituciones de prompts (oleada de almacenamiento de ajustes,
// 2026-09-19). Los alias *Record mantienen explícito en las rutas de app/api/settings qué
// frontera tocan (el registro en bruto, no la vista práctica de la sección del chat).
export {
	readSettings as readSettingsRecord,
	writeSettings as writeSettingsRecord,
	settingsStore,
} from "../store/settings.ts";
export { promptOverrides } from "../store/prompt-overrides.ts";
export { themeStore } from "../store/themes.ts";
export { readThemeBoot, type ThemeBoot } from "./theme-boot.ts";
export { isValidSegmentPath } from "../core/prompt-segments.ts";
// El descubrimiento/resolución canónicos de segmentos viven en la capa del agente
// (la composición es asunto del agente); el barrel lo reexporta para las rutas;
// servidor→agente es la dirección legítima (precedente de chat-handler).
export { effectivePromptSegments, allSegmentPaths, readPromptOverride } from "../agent/prompt-segments.ts";

// La composición de autenticación/claves (oleada auth-keys, 2026-09-19): el catálogo
// curado de claves + el almacén que refleja el entorno tras GET/PUT/DELETE /api/keys.
// Importar este módulo ejecuta el relleno de huecos idempotente del arranque; todos los
// consumidores mantienen sus lecturas simples de process.env (esa frontera es la clave).
export * from "./keys.ts";
export * from "./search.ts";
export { authStore } from "../store/auth.ts";
export * from "./settings-body.ts";
export { fileAccessConfigurationError } from "./file-access.ts";
export * from "./turn-liveness.ts";
export * from "./turn-runs.ts";
export * from "./dismissal-park.ts";
export * from "./compaction.ts";
export { sideChats, createSideChatService, type SideChatService, type SideChatDeps, type SideStreamEvent } from "./side-chat.ts";
export { runPiTurn, piTurnResponse, type PiTurnHandle, type PiTurnSpec } from "./pi/ui-stream.ts";
export * from "./observability.ts";
export { abortPluginWorkerActivity } from "./plugin-worker-activity.ts";
export * from "./model-catalog.ts";
export { subscriptionControlsResponse, subscriptionBrowserResponse } from "./web-subscription-http.ts";
export { sessionCost } from "./pricing.ts";
export { initializePlugins, getPluginHost, getPluginAgentContributions, getPluginQuestionTypeResolver, pluginTransport } from "./plugins.ts";
export { createPluginDocumentRoute } from "./plugin-transport.ts";
export { pluginProblemAvailabilityOf, type ProblemTypeResolver } from "./plugin-problems.ts";
export { pluginQuestionAvailabilityOf, reconcilePluginQuestionCompatibility, preparePluginQuestionDismissal, type QuestionTypeResolver } from "./plugin-questions.ts";
export { claudeCodeInstallationResponse } from "./claude-code.ts";
// El módulo del endpoint personalizado (se registra en piModels() + sondea los modelos).
// Sin efectos secundarios al importar; la sincronización de arranque vive en stores.ts.
export * from "./custom-provider.ts";
export { customProviderGet, customProviderMutation } from "./custom-provider-http.ts";
