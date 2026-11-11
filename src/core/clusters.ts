/**
 * REGLAS DE PRESENTACIÓN DE LOS CLÚSTERES (visión §1). Desde la oleada 7, la
 * DETECCIÓN es un clustering por sesión de origen (core/session-clusters.ts;
 * el embedder semántico, su predecesor Louvain y el emparejador de etiquetas
 * por LLM están todos muertos: ahora las etiquetas son los nombres de las
 * sesiones). Lo que queda aquí es la única regla de presentación que
 * comparten la instantánea y el renderizador.
 *
 * Lógica pura segura en el navegador (sin módulos integrados de node ni fs).
 */

/** Las comunidades por debajo de este tamaño no se muestran ni reciben nombre;
 *  regla de presentación (decidida por el usuario 2026-09-13): una región del
 *  modelo del mundo necesita al menos tres proposiciones para merecer un
 *  contorno y una etiqueta. */
export const MIN_CLUSTER_SIZE = 3;