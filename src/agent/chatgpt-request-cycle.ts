/** Superficie de compatibilidad: ChatGPT conserva su ámbito y comportamiento mientras todas las conexiones
 * de suscripción comparten la misma máquina de estados de admisión de peticiones, neutral respecto al proveedor. */
export { SubscriptionRequestCycle as ChatGPTRequestCycle } from "./subscription-request-cycle.ts";
export type { AdmissionScope, NoDispatchKind, SubscriptionDispatchLifecycle as ChatGPTDispatchLifecycle } from "./subscription-request-cycle.ts";
