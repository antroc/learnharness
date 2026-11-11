/**
 * Puntuación de búsqueda difusa (oleada de control de modelos, 2026-09-12) —
 * el patrón del selector `/model` de pi: tokens separados por espacios, cada
 * token debe coincidir con ALGÚN campo (subcadena sin distinguir mayúsculas),
 * ordenados para que las coincidencias exactas de campo ganen a los prefijos y
 * estos a las subcadenas enterradas. Núcleo puro; el selector ordena por
 * puntuación.
 */

/** Puntúa un candidato, o null cuando algún token no coincide con ningún
 *  campo. Más alto es mejor; los empates se resuelven de forma natural por el
 *  orden de la lista (ordenación estable).
 *
 *  Puntos por token: igualdad exacta de campo 100 · el campo empieza por 60 ·
 *  subcadena 30 menos una penalización por profundidad (ganan los hallazgos
 *  más tempranos). La contigüidad de la consulta entera en un campo suma +50
 *  (la consulta "glm flash" frente al id "z-ai/glm-5.3-flash" pierde ante un
 *  modelo cuyo id contiene "glm flash" literal — como debe ser). */
export function fuzzyScore(query: string, ...fields: string[]): number | null {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return 0;
	const hay = fields.map((f) => f.toLowerCase());

	let total = 0;
	for (const token of tokens) {
		let best = -1;
		for (const f of hay) {
			if (f === token) best = Math.max(best, 100);
			else if (f.startsWith(token)) best = Math.max(best, 60);
			else {
				const at = f.indexOf(token);
				if (at !== -1) best = Math.max(best, 30 - Math.min(at, 27));
			}
		}
		if (best < 0) return null;
		total += best;
	}
	const joined = tokens.join(" ");
	if (hay.some((f) => f.includes(joined))) total += 50;
	return total;
}