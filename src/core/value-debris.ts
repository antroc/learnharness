/**
 * LIMPIEZA DE RESTOS EN LOS VALORES DEL MODELO (responsable, 2026-10-09 — el
 * incidente whitehead): glm-5.3 emitió `correctAnswer: [":parmenides"]` — el valor de
 * la opción con los DOS PUNTOS de clave-valor de JSON pegados — en cuatro llamadas a
 * quiz rechazadas (y `type: "\"predict\""` — el literal con las COMILLAS incluidas —
 * en un bucle mortal de diez reintentos; ver tools/heal.ts para esa mitad). Los
 * campos de pertenencia (correctAnswer frente a los valores de las opciones, el tipo
 * de quiz frente al par de literales, los objetivos de práctica frente a los ids de
 * las proposiciones) los copia el modelo de su propio contexto, y la copia arrastra
 * la sintaxis de alrededor: dos puntos, comillas, comillas invertidas, espacios.
 *
 * LA FRONTERA: se limpia en cada comparación de PERTENENCIA — nunca en texto libre
 * (los enunciados, las preguntas y las explicaciones pueden llevar legítimamente
 * cualquiera de estos caracteres). Puro + seguro para el navegador: lo comparten la
 * frontera de la llamada (quizInputProblems), el análisis de visualización
 * (tool-parts) y la corrección (question-dock) — los tres consumidores que la ley de
 * tool-parts mantiene sincronizados. Idempotente por construcción.
 */

/** Quita los restos de sintaxis copiada que un modelo pega a un valor de pertenencia:
 * cualquier secuencia de espacios, dos puntos, comillas dobles/simples y comillas
 * invertidas que lo rodee, en cualquier combinación (`":value"`, `: value`,
 * `` `value` ``). El interior no se toca. */
export function stripModelValueDebris(value: string): string {
	return value.replace(/^[\s:."'`]+/, "").replace(/[\s:."'`]+$/, "");
}
