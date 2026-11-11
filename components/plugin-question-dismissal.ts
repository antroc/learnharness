import { pendingPluginQuestionOf, pluginQuestionCallsOf, samePluginQuestionOccurrence, type PluginQuestionOccurrence, type LhMessage } from "@/src/core";

/** Identidad privada de la confirmación, capturada cuando se abre el diálogo existente. */
export interface PluginQuestionDismissalTarget {
	readonly occurrence: PluginQuestionOccurrence;
	readonly questionId?: string;
}
export function capturePluginQuestionDismissal(messages: readonly LhMessage[]): PluginQuestionDismissalTarget | null {
	const pending = pendingPluginQuestionOf(messages);
	const unreadable = pending ? undefined : pluginQuestionCallsOf(messages).find(call => call.status === "unreadable");
	const occurrence = pending?.occurrence ?? unreadable?.occurrence;
	if (!occurrence) return null;
	const annotation = unreadable?.annotation;
	const questionId = pending?.questionId ?? (annotation?.status === "unreadable" ? annotation.binding?.questionId ?? annotation.identity?.questionId : undefined);
	return Object.freeze({ occurrence: Object.freeze({ ...occurrence }), ...(questionId === undefined ? {} : { questionId }) });
}

/** Solo la misma pregunta canónica. Desengancha el envío local antiguo antes de que
 * la ruta silenciosa aparque y detenga a su responsable en el servidor; su rechazo
 * tardío no debe volver a pintar un error. Sin nueva petición de abort, respuesta,
 * cambio del borrador ni despertar del profesor. */
export function confirmPluginQuestionDismissal(target: PluginQuestionDismissalTarget, current: {
	canonicalMessages: readonly LhMessage[];
	reconciliation: "ready" | "syncing" | "failed";
	stop(): void;
	dismissPluginQuestion(occurrence: PluginQuestionOccurrence, questionId?: string): Promise<void>;
}): void {
	if (current.reconciliation !== "ready") return;
	const pending = capturePluginQuestionDismissal(current.canonicalMessages);
	if (!pending || pending.questionId !== target.questionId || !samePluginQuestionOccurrence(pending.occurrence, target.occurrence)) return;
	current.stop();
	void current.dismissPluginQuestion(target.occurrence, target.questionId);
}
