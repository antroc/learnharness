/** Difiere la preparación de la apertura hasta que su efecto propietario y el límite
 * nativo se hayan confirmado. La limpieza puede retirar una preparación aún no
 * iniciada; esto nunca reintenta un envío cuya finalización/hooks ya han empezado. */
export function scheduleOpeningSubmission(isCurrent: () => boolean, start: () => void): () => void {
	let live = true;
	queueMicrotask(() => { if (live && isCurrent()) start(); });
	return () => { live = false; };
}
