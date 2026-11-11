/**
 * La clave de variante del envoltorio del dock (el disparador de la
 * transformación de altura WAAPI, DockOverlay de components/chat.tsx). Siempre
 * que esta cadena CAMBIA entre renders, el envoltorio transforma su altura
 * (120 ms) y vuelve a reservar la cola de la transcripción; cuando no cambia,
 * los cambios de altura solo se miden (el crecimiento al escribir nunca se anima).
 *
 * El término expandido (el plegado: formulario completo ↔ barra fina) pertenece
 * a TODAS las variantes del dock — pregunta Y práctica. Durante dos meses la
 * clave dependió solo de `pending` (la llamada a herramienta de la pregunta),
 * que es null en las sesiones de práctica: el dock de práctica se plegaba y
 * desplegaba con un salto de altura INSTANTÁNEO mientras la enseñanza se
 * transformaba (informe del responsable 2026-10-06, «se abre y se cierra al
 * instante»). La propia máquina de plegado ya trataba la práctica como
 * propietaria del dock; ahora esta clave coincide.
 */
export function dockStateKey(mode: string, docked: boolean, expanded: boolean): string {
	return docked ? `${mode}:${expanded}` : `${mode}:-`;
}
