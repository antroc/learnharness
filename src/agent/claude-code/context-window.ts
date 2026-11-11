import { randomUUID } from "node:crypto";

const INITIALIZE_TIMEOUT_MS = 5_000;

/** Una consulta de control de la CLI, local y de mejor esfuerzo. El contrato del cable coincide con el
 * código del SDK oficial 0.3.259; esto no importa ni ejecuta el SDK.
 * El resumen evita a propósito las peticiones de recuento de tokens del modo completo por defecto.
 * El maxTokens de la CLI es un presupuesto efectivo o de compactación automática, no un máximo nominal del modelo. */
export class ContextWindowProbe {
	private readonly initializeId = randomUUID();
	private summaryId: string | undefined;
	private initialized = false;
	private timer: NodeJS.Timeout | undefined;
	private ready = false;
	private closed = false;

	constructor(
		private readonly write: (line: string) => void,
		private readonly sendPrompt: () => void,
		private readonly onWindow: (tokens: number) => void,
	) {}

	start(): void {
		this.timer = setTimeout(() => this.proceed(false), INITIALIZE_TIMEOUT_MS);
		this.timer.unref();
		this.request(this.initializeId, { subtype: "initialize" });
	}

	/** Consume las respuestas de control aparte de la salida del modelo y las herramientas, incluidas
	 * las respuestas tardías o ajenas mientras una herramienta de pregunta nativa ya está esperando. */
	handle(value: unknown): boolean {
		if (!value || typeof value !== "object" || !("type" in value) || value.type !== "control_response") return false;
		if (this.closed || !("response" in value) || !value.response || typeof value.response !== "object") return true;
		const response = value.response as Record<string, unknown>;
		if (response.request_id === this.initializeId) this.proceed(response.subtype === "success");
		else if (this.summaryId && response.request_id === this.summaryId) {
			this.summaryId = undefined;
			if (response.subtype !== "success") return true;
			const body = response.response as Record<string, unknown> | undefined;
			const tokens = body?.maxTokens;
			if (typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens > 0) this.onWindow(tokens);
		}
		return true;
	}

	/** Reintenta cuando la CLI ha empezado una respuesta del modelo: el protocolo no garantiza
	 * los metadatos previos al primer turno. La actualización también sigue a respuestas posteriores
	 * dentro del mismo proceso retenido, sin abrir un segundo proceso. */
	refresh(): void {
		if (!this.initialized || this.closed) return;
		this.summaryId = randomUUID();
		this.request(this.summaryId, { subtype: "get_context_usage", detail: "summary" });
	}

	close(): void { this.closed = true; clearTimeout(this.timer); }

	private proceed(query: boolean): void {
		if (this.ready || this.closed) return;
		this.ready = true;
		clearTimeout(this.timer);
		this.initialized = query;
		if (query) this.refresh();
		// Nunca esperes a los metadatos para ejecutar la petición real del usuario. Si no hay soporte,
		// no hay respuesta o los metadatos están mal formados, la ventana simplemente queda desconocida.
		this.sendPrompt();
	}

	private request(id: string, request: Record<string, string>): void {
		this.write(JSON.stringify({ type: "control_request", request_id: id, request }));
	}
}
