"use client";

import type { LhViewPart, PluginBackgroundMeta, PluginBackgroundResult } from "@/src/core";
import { PluginToolRenderer } from "@/components/plugin-renderers";
import { PluginWorkerResultSurface } from "@/components/plugin-worker-result";
import { MessageResponse } from "@/components/ai-elements/message";
import { usePlugins } from "@/components/plugins";

/** Un marcador posterior no es un resultado nativo de herramienta: la llamada
 * original conserva su acuse. Conserva los datos explícitos (incluidos null/false)
 * en vez de tratarlos como ausentes. */
export function pluginBackgroundPart(result: PluginBackgroundResult, toolCallId: string): LhViewPart & { background: PluginBackgroundMeta } {
	return {
		type: `tool-${result.toolName}`,
		toolCallId,
		input: result.input,
		state: result.outcome.status === "succeeded" ? "output-available" : "output-error",
		output: Object.hasOwn(result, "data") ? result.data : result.outcome,
		...(result.outcome.status !== "succeeded" ? { errorText: result.outcome.error.message } : {}),
		background: { pluginId: result.pluginId, taskId: result.outcome.id, status: result.outcome.status },
	};
}

/** La presentación persistida sigue siendo legible sin ningún plugin instalado
 * o activado. Solo el cuerpo es extensible: la identidad/estado y los errores
 * del formateador siguen siendo del host. */
export function PluginWorkerCard({ result, toolCallId }: { result: PluginBackgroundResult; toolCallId: string }) {
	const { snapshot } = usePlugins();
	const registration = snapshot.toolRenderers.find(entry => entry.renderer.toolName === result.toolName);
	const presentation = registration?.renderer.backgroundPresentation ?? "collapsed";
	const part = pluginBackgroundPart(result, toolCallId);
	const fallback = (
		<div data-testid="plugin-worker-fallback" className="space-y-2 text-sm">
			<div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0"><MessageResponse>{result.text}</MessageResponse></div>
			<details className="text-xs text-muted-foreground">
				<summary className="cursor-pointer">Task details</summary>
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify({
					input: result.input,
					outcome: result.outcome,
					...(Object.hasOwn(result, "data") ? { data: result.data } : {}),
				}, null, 2)}</pre>
			</details>
		</div>
	);
	return (
		<section data-testid="plugin-worker-card" className="space-y-2">
			{result.formatError && <p role="alert" className="text-xs text-destructive">Result formatting failed: {result.formatError}</p>}
			<PluginWorkerResultSurface label={result.toolName} status={result.outcome.status} text={result.text} presentation={presentation}>
				<PluginToolRenderer part={part} fallback={fallback} />
			</PluginWorkerResultSurface>
		</section>
	);
}
