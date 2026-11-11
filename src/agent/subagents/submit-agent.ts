/**
 * runSubmitAgent: la frontera compartida del agente de un solo submit
 * (movida tal cual desde extraction.ts): una llamada submit validada con
 * TypeBox es todo el entregable (un agente pi solo para que el modelo pueda
 * reintentar una llamada que no cumple el esquema). El valor enviado se
 * captura en la frontera de execute, que solo se dispara con una llamada que
 * cumple el esquema; el relleno ?? (los antiguos valores por defecto de zod)
 * se aplica en la captura.
 */

import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import { invalidInputResult, toToolResult } from "../tool-execute.ts";
import type { ModelRole } from "../../../config.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import { healToolRecord } from "../tools/heal.ts";
import { healEncodedArguments } from "../../core/argument-heal.ts";

// ── la reparación de cadenas de los modelos débiles (responsable, 2026-09-28;
// movida aquí desde extraction.ts con el rediseño consciente del resumen, 2026-09-30;
// la reparación es una medicina del formato de red que comparten todos los agentes de submit) ──
//
// Prueba en los registros de OpenRouter: los modelos débiles, con una carga de submit
// grande, a menudo emiten un array entero como UNA CADENA JSON en lugar de un array
// nativo ("propositions.0: must be object"). pi-agent-core ejecuta `prepareArguments`
// ANTES de la validación de TypeBox: el punto de adaptación autorizado (la misma
// doctrina que restoreMathEscapes en la frontera de visualización: reparar el
// comportamiento de red de los modelos débiles, no castigarlo con un reintento). De
// mejor esfuerzo: solo se repara una cadena que se analiza como array; todo lo demás
// pasa sin tocar y falla la validación exactamente igual que antes.
export function healStringifiedArrays(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
	for (const key of ["propositions", "chains"]) {
		const v = out[key];
		if (typeof v !== "string" || v.trim().length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(v);
			if (Array.isArray(parsed)) out[key] = parsed;
		} catch {
			// no es un stringify limpio (p. ej., truncado): se deja para la validación
		}
	}
	return out;
}

export async function runSubmitAgent<T>(opts: {
	role: ModelRole;
	toolName: string;
	toolDescription: string;
	parameters: TSchema;
	/** Tolerancia con los modelos débiles: los antiguos `.default()` de zod,
	 *  aplicados a la entrada en bruto que cumple el esquema en la frontera de submit. */
	fill: (input: any) => T;
	systemPrompt: string;
	prompt: string;
	engine: PiEngine | undefined;
	signal: AbortSignal | undefined;
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void;
	neverSubmitted: string;
	/** Herramientas extra junto a la llamada submit (el conjunto de exploración
	 *  del grafo del auditor, 2026-09-27): un pequeño bucle agéntico en lugar de un simple reintento. */
	extraTools?: Record<string, AgentTool<any>>;
	/** Presupuesto de turnos del bucle (4 por defecto = solo reintentos; el
	 *  auditor ejecuta en cambio un bucle de exploración: 16). */
	maxTurns?: number;
	/** Depuración: clave de grabación de eventos en bruto del proveedor (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
	/** Reparación de argumentos de los modelos débiles en la frontera
	 *  prepareArguments de pi (se ejecuta ANTES de la validación de TypeBox: el
	 *  punto de adaptación autorizado). Identidad por defecto; extraction conecta
	 *  aquí healStringifiedArrays. */
	prepareArguments?: (args: unknown) => unknown;
	/** Validación semántica en la frontera de submit: el valor cumple el esquema
	 *  pero puede incumplir una LEY DEL PROCESO (cobertura, igualdad de eco).
	 *  Devolver una cadena de problema produce un resultado isError
	 *  (invalidInputResult) → el modelo reintenta dentro de maxTurns. null = aceptar. */
	validate?: (value: T) => string | null;
}): Promise<T> {
	let submitted: T | undefined;
	const result = await runSubagent(
		[
			// healToolRecord (responsable, 2026-10-09): la reparación estándar de argumentos
		// sobre las herramientas extra (el conjunto del grafo del auditor), igual que en
		// cualquier registro.
		...(opts.extraTools ? Object.values(healToolRecord(opts.extraTools)) : []),
			{
				name: opts.toolName,
				label: opts.toolName,
				description: opts.toolDescription,
				parameters: opts.parameters,
				prepareArguments: (args) =>
					// La reparación estándar se compone DESPUÉS de la adaptación del llamante (la
					// generalización de whitehead, 2026-10-09); healStringifiedArrays de extraction
					// sigue siendo la pasada interior.
					healEncodedArguments(
						opts.prepareArguments ? opts.prepareArguments(args) : args,
						opts.parameters,
					) as never,
				execute: async (_toolCallId, input) => {
					const value = opts.fill(input);
					const problem = opts.validate?.(value) ?? null;
					if (problem) return invalidInputResult(opts.toolName, [problem]);
					submitted = value;
					return toToolResult(submitted);
				},
			} satisfies AgentTool<any>,
		],
		{
			role: opts.role,
			engine: opts.engine,
			systemPrompt: opts.systemPrompt,
			prompt: opts.prompt,
			maxTurns: opts.maxTurns ?? 4,
			abortSignal: opts.signal,
			chatId: opts.chatId,
			onAssistantMessage: (message, step) =>
				opts.onStep(
					message.usage,
					// Sello con proveedor (oleada de ranuras de modelo, 2026-09-20): pi indica el
					// id a secas; los sellos de uso llevan proveedor:id para coincidir con las
					// claves uniformes de la tabla de precios.
					`${message.provider}:${message.model}`,
					step,
					message.stopReason,
					message.content.filter((c) => c.type === "toolCall").map((c) => (c as { name: string }).name).join(", ") || "(none)",
				),
			shouldStop: (_message, toolResults) => toolResults.some((r) => r.toolName === opts.toolName && !r.isError),
		},
	);
	void result;
	if (!submitted) throw new Error(opts.neverSubmitted);
	return submitted;
}
