/** Límite sobre el cuerpo real, independiente de un Content-Length ausente o poco fiable. */
export class FormBodyLimitError extends Error {}

/** Se almacena en búfer antes del análisis multipart: las subidas mal
 * formadas/truncadas nunca producen un formulario parcial. La cancelación
 * opcional interrumpe incluso un reader.read() bloqueado. */
export async function readBoundedFormData(request: Request, maxBytes: number, signal?: AbortSignal): Promise<FormData> {
	signal?.throwIfAborted();
	if (Number(request.headers.get("content-length")) > maxBytes) {
		void request.body?.cancel().catch(() => undefined);
		throw new FormBodyLimitError();
	}
	const reader = request.body?.getReader();
	if (!reader) throw new SyntaxError("Missing import body");
	const cancel = () => { void reader.cancel().catch(() => undefined); };
	signal?.addEventListener("abort", cancel, { once: true });
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		signal?.throwIfAborted();
		for (;;) {
			const { done, value } = await reader.read();
			signal?.throwIfAborted();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) throw new FormBodyLimitError();
			chunks.push(value);
		}
		const body = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
		signal?.throwIfAborted();
		return form;
	} finally {
		signal?.removeEventListener("abort", cancel);
		// No esperes a que termine el otro consumidor de un tee antes de rechazar una subida.
		cancel();
		reader.releaseLock();
	}
}
