import { retryDrops } from "../core/input-events.ts";
import { cliContextWindowOf, type LhMessage } from "../core/native-messages.ts";
import { CLAUDE_CODE_API, CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";

export const SIDE_CONTEXT_BUDGET_ERROR = "New side-chat exchanges exceed the selected model's context budget. The tutor paused before sending this request. Completed work and all pending side exchanges have been kept. Retry to let normal compaction free older lesson history, or select a model with a larger context window.";

/** El catálogo de la CLI contiene valores provisionales, no capacidad. Se usa solo el último
 * informe de sesión genuino para la identidad seleccionada. Un Retry puede mirar más allá de
 * fallos locales reconocibles previos al despacho, pero nunca más allá de una respuesta real
 * sin metadatos ni de una frontera de compactación. Esto no cambia las estadísticas de la interfaz. */
export function sideContextWindow(messages: readonly LhMessage[], selected: { provider: string; id: string }, catalogWindow: number | undefined, retry: boolean): number | undefined {
	if (selected.provider !== CLAUDE_CODE_PROVIDER) return catalogWindow;
	const report = cliContextWindowOf(retry ? messages.filter((message) => !isLocalSideBudgetFailure(message, selected.id)) : messages);
	return report?.model === `${selected.provider}:${selected.id}` ? report.tokens : undefined;
}

/** Los fallos locales históricos no tienen un nuevo discriminador persistido. Se exige la
 * forma exacta del fallo del SDK, la identidad, una salida vacía y TODO el uso a cero; una
 * cadena de error que coincida no debe borrar por sí sola una respuesta del proveedor que podría ser real. */
function isLocalSideBudgetFailure(message: LhMessage, model: string): boolean {
	if (message.role !== "assistant" || message.provider !== CLAUDE_CODE_PROVIDER || message.api !== CLAUDE_CODE_API || message.model !== model ||
		message.stopReason !== "error" || message.errorMessage !== SIDE_CONTEXT_BUDGET_ERROR || message.responseId !== undefined || message.cliContextWindow !== undefined ||
		!message.content.every((block) => block.type === "text" && block.text === "")) return false;
	const usage = message.usage;
	return !!usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens].every((tokens) => tokens === 0) &&
		[usage.reasoning, usage.cacheWrite1h].every((tokens) => tokens === undefined || tokens === 0) &&
		Object.values(usage.cost ?? {}).every((cost) => cost === 0);
}

/** Solo un Retry local por presupuesto puede cruzar la compactación que hizo SU PROPIA
 * barrera de comprobación previa. La compactación anterior/externa y cualquier entrada
 * intermedia mantienen la política de rechazo existente. Los intentos fallidos se quedan en el historial nativo. */
export function sideBudgetRetryDrops(before: readonly LhMessage[], after: readonly LhMessage[]): Set<string> | undefined {
	let omitted: Set<string>;
	try { omitted = retryDrops([...before]); } catch { return undefined; }
	const latestFailure = before.findLast((message) => omitted.has(message.id));
	if (latestFailure?.role !== "assistant" || latestFailure.errorMessage !== SIDE_CONTEXT_BUDGET_ERROR) return undefined;
	if (after.length < before.length || before.some((message, index) => message.id !== after[index]?.id)) return undefined;
	if (!after.slice(before.length).every((message) => message.role === "custom" && message.customType === "compaction")) return undefined;
	return omitted;
}
