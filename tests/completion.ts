/** Acota una señal real de finalización del fixture, no un número de vueltas del bucle
 * de eventos. Limpia siempre el perro guardián y conserva los fallos reales del fixture. */
export async function completedWithin<T>(completion: Promise<T>, description: string, timeoutMs = 10_000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			completion,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
