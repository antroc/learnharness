import type { AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * UNICIDAD DE LOS ID DE LLAMADA A HERRAMIENTA (arreglo aprobado por el responsable, 2026-10-04: el incidente
 * Lacan): algunos proveedores (DeepSeek vía OpenRouter, observado en vivo) devuelven
 * ids de llamada a herramienta que se reinician en cada respuesta (`call_0`, `call_1`, …), así que una
 * sesión de una llamada por turno llama `call_0` a TODAS las llamadas. Todo en esta
 * app se indexa por toolCallId (la unión llamada↔resultado del pliegue de la vista, la barrera de
 * pregunta pendiente, el enrutado de respuestas, la semilla para barajar opciones), así que los
 * duplicados entre turnos los corrompían todos a la vez: el pliegue aplicaba la respuesta del quiz
 * a la tarjeta de ASK, la pregunta de ask desaparecía, el orden se desbarajustaba.
 *
 * LA LEY: los ids se hacen únicos UNA vez, en el límite de la red: esta clase vive
 * dentro de runPiTurn, ve todos los AgentEvent antes que cualquier vista y aplica la
 * misma acuñación al asentar. El cliente, el registro persistido, el dock,
 * el flujo de respuesta y el contexto de proveedor del siguiente turno (reconstruido a partir del
 * registro) ven exactamente un mismo conjunto de ids únicos. El contexto de proveedor sigue
 * emparejado internamente (llamada y resultado se reescriben juntos), lo que aceptan las
 * API compatibles con OpenAI: el propio pi sintetiza ids para los proveedores
 * que no devuelven ninguno, así que unos ids arbitrarios pero emparejados ya son legales para el protocolo.
 * El historial NUNCA se reescribe: los mensajes del registro pasan sin tocar, y los
 * registros duplicados anteriores al arreglo se reparan en el pliegue (view.ts empareja los resultados
 * empezando por el más nuevo).
 *
 * ESQUEMA: un conjunto de vistos por chat (sembrado desde el registro al empezar el turno) más
 * tablas por mensaje. Los mensajes en streaming NO llevan id (los ids se estampan al
 * persistir), así que las tablas se indexan por IDENTIDAD DE OBJETO: el objeto del evento
 * message_end es idéntico por referencia al objeto de agent.state.messages
 * (verificado contra pi-agent-core), y un WeakMap une ambos. Se abre una tabla
 * nueva (época) en cada message_start del asistente; los objetos update/end
 * de ese mensaje se le adjuntan; las acuñaciones se reclaman una vez por mensaje, así que
 * el mismo id en un SEGUNDO mensaje del turno (un paso de reintento) recibe su propia
 * acuñación. Los ids que colisionan pasan a ser `${orig}~2`, `~3`, …, saltándose los usados.
 */

/** Recorre estructuralmente el contenido de cualquier mensaje buscando bloques de llamada a herramienta. */
function callBlocks(message: unknown): Array<{ id: string } & Record<string, unknown>> {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return [];
	return content.filter(
		(b): b is { id: string } & Record<string, unknown> =>
			(b as { type?: string } | null)?.type === "toolCall" && typeof (b as { id?: unknown }).id === "string",
	);
}

/** Los ids que cualquier consumidor puede haber visto ya: todos los ids de llamada y de resultado
 *  de una lista de mensajes (el registro del chat, incluidos sus duplicados heredados,
 *  que es justo la idea: la pertenencia es lo que dirige la acuñación). */
export function collectToolCallIds(messages: readonly unknown[]): string[] {
	const ids: string[] = [];
	for (const m of messages) {
		const role = (m as { role?: string }).role;
		if (role === "assistant") {
			for (const b of callBlocks(m)) ids.push(b.id);
		} else if (role === "toolResult") {
			const id = (m as { toolCallId?: unknown }).toolCallId;
			if (typeof id === "string") ids.push(id);
		}
	}
	return ids;
}

export class ToolCallIdUniquifier {
	private readonly seen = new Set<string>();
	/** objeto de mensaje del asistente → su tabla (origId → uniqueId). Débil: el
	 *  turno del agente muere al asentarse; nada de aquí lo sobrevive. */
	private readonly tables = new WeakMap<object, Map<string, string>>();
	/** La tabla del mensaje del asistente actual: se abre en su message_start,
	 *  la comparten sus objetos update/end, y es el ámbito de resolución de sus
	 *  eventos tool_execution (que se disparan después de su message_end pero antes
	 *  del siguiente message_start). */
	private epoch: Map<string, string> | null = null;

	constructor(usedIds: Iterable<string>) {
		for (const id of usedIds) this.seen.add(id);
	}

	/** Conserva `orig` si nunca se usó; si no, acuña un `${orig}~n` sin usar. */
	private claim(orig: string): string {
		if (!this.seen.has(orig)) {
			this.seen.add(orig);
			return orig;
		}
		for (let n = 2; ; n++) {
			const candidate = `${orig}~${n}`;
			if (!this.seen.has(candidate)) {
				this.seen.add(candidate);
				return candidate;
			}
		}
	}

	/** Registra + reescribe los bloques de llamada a herramienta de un mensaje (idempotente entre
	 *  los parciales repetidos de message_update). Devuelve un mensaje clonado
	 *  cuando cambió algún id; si no, el objeto original. */
	private remapMessageContent(message: unknown): unknown {
		if ((message as { role?: string }).role !== "assistant") return message;
		const blocks = callBlocks(message);
		if (blocks.length === 0) return message;

		// Adjuntar a la época actual salvo que este objeto ya tenga una tabla
		// (un update/end reemitido). Un evento de mensaje sin época abierta
		// (defensivo: un stream que se salta message_start) abre una.
		let table = this.tables.get(message as object);
		if (!table) {
			table = this.epoch ?? new Map();
			this.epoch = table;
			this.tables.set(message as object, table);
		} else {
			this.epoch = table;
		}

		let changed = false;
		const content = (message as { content: unknown[] }).content.map((block) => {
			if ((block as { type?: string }).type !== "toolCall") return block;
			const orig = (block as { id?: unknown }).id;
			if (typeof orig !== "string") return block;
			let mapped = table!.get(orig);
			if (mapped === undefined) {
				mapped = this.claim(orig);
				table!.set(orig, mapped);
			}
			if (mapped === orig) return block;
			changed = true;
			return { ...(block as object), id: mapped };
		});
		return changed ? { ...(message as object), content } : message;
	}

	/** Cada AgentEvent, con los ids hechos únicos. Estructural y total: las formas de
	 *  evento desconocidas pasan sin tocar. */
	event(event: AgentEvent): AgentEvent {
		switch (event.type) {
			case "message_start": {
				const e = event as { message: { role?: string } };
				// Un mensaje nuevo del asistente abre una época nueva: esto es lo que
				// impide que un id reintentado en un mensaje POSTERIOR reutilice la
				// acuñación del mensaje anterior.
				if (e.message?.role === "assistant") this.epoch = new Map();
				return this.remapEventMessage(event);
			}
			case "message_update":
			case "message_end":
				return this.remapEventMessage(event);
			case "tool_execution_start":
			case "tool_execution_update":
			case "tool_execution_end": {
				const { toolCallId } = event as { toolCallId: string };
				const mapped = this.epoch?.get(toolCallId) ?? toolCallId;
				if (mapped === toolCallId) return event;
				return { ...(event as object), toolCallId: mapped } as AgentEvent;
			}
			case "turn_end": {
				const e = event as { message: unknown; toolResults: Array<{ toolCallId?: string }> };
				const message = this.remapMessageContent(e.message);
				const table = this.epoch;
				const toolResults = table
					? e.toolResults.map((r) =>
							typeof r.toolCallId === "string" && table.has(r.toolCallId)
								? { ...r, toolCallId: table.get(r.toolCallId)! }
								: r,
						)
					: e.toolResults;
				return { ...(e as object), message, toolResults } as unknown as AgentEvent;
			}
			case "agent_end": {
				const e = event as { messages: unknown[] };
				return { ...(e as object), messages: this.remapSettled(e.messages) } as unknown as AgentEvent;
			}
			default:
				return event;
		}
	}

	private remapEventMessage(event: AgentEvent): AgentEvent {
		const e = event as { message: unknown };
		const remapped = this.remapMessageContent(e.message);
		if (remapped === e.message) return event;
		return { ...(event as object), message: remapped } as AgentEvent;
	}

	/** La frontera de asentamiento: el estado final del agente, reescrito con los ids que
	 *  la red ya mostró. Solo se reescriben los mensajes de ESTE turno (los
	 *  registrados por sus objetos de evento); el historial de turnos anteriores, incluidos
	 *  los registros heredados con ids duplicados, pasa literalmente. Los resultados de herramienta
	 *  se emparejan con el mensaje del asistente registrado más reciente (la propia
	 *  estructura del bucle: los resultados siguen a sus llamadas). */
	remapSettled(messages: readonly unknown[]): unknown[] {
		let scope: Map<string, string> | undefined;
		return messages.map((m) => {
			const role = (m as { role?: string }).role;
			if (role === "assistant") {
				const table = this.tables.get(m as object);
				if (!table) {
					// De un turno anterior o sin registrar: el historial nunca se reescribe.
					scope = undefined;
					return m;
				}
				scope = table;
				return this.remapMessageContent(m);
			}
			if (role === "toolResult") {
				const orig = (m as { toolCallId?: unknown }).toolCallId;
				if (scope && typeof orig === "string" && scope.has(orig)) {
					return { ...(m as object), toolCallId: scope.get(orig)! };
				}
				return m;
			}
			return m;
		});
	}
}
