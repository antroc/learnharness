/**
 * Contratos compartidos — la única fuente de verdad contra la que programa
 * cada componente.
 *
 * Divididos por dominio (src/core/contracts/): plan.ts (el árbol del plan de
 * la sesión), graph.ts (el grafo global de conocimiento + su proceso de
 * extracción), chat.ts (registros de sesión + puntos de extensión de la
 * interfaz), jobs.ts (el protocolo asíncrono de subagentes),  Cada fichero de
 * dominio pertenece por completo a su flujo de trabajo; los cambios de
 * esquema en un dominio que no es tuyo pasan por master. Este barrel mantiene
 * sin cambios todas las rutas de importación existentes ("@/src/core" y
 * "./contracts.ts").
 */

export * from "./contracts/plan.ts";
export * from "./contracts/graph.ts";
export * from "./contracts/chat.ts";
export * from "./contracts/jobs.ts";
export * from "./contracts/probe.ts";
export * from "./contracts/models.ts";
