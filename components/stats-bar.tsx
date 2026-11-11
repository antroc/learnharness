"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CLAUDE_CODE_PROVIDER, sessionCacheHitRate, subscriptionLabels, subscriptionLabel, type cliContextWindowOf, type SessionPricing, type TurnUsage } from "@/src/core";
import { formatTokens, formatUsd, planCostLabel, prettyModel } from "@/components/usage-format";
import { ModelControl, catalogLimits, useModelCatalog } from "@/components/model-picker";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";

export function formatContextMeasurement(tokens: number | null, limit: number | null): string {
	const numerator = tokens === null ? "?" : formatTokens(tokens);
	return limit === null ? numerator : `${numerator} / ${formatTokens(limit)}`;
}

/** Los alias de CLI no tienen un límite de catálogo global: solo la respuesta coincidente de
 * esta sesión puede aportar un denominador. Los demás proveedores conservan su join con el catálogo. */
export function contextLimitForModel(model: string | undefined, limits: ReadonlyMap<string, number> | undefined,
	cliWindow: ReturnType<typeof cliContextWindowOf> = null): number | null {
	if (!model) return null;
	if (model.startsWith(`${CLAUDE_CODE_PROVIDER}:`)) return cliWindow?.model === model ? cliWindow.tokens : null;
	return limits?.get(model) ?? null;
}

/**
 * La barra de estadísticas bajo el composer (observabilidad de la oleada 4):
 * la huella de dinero/contexto de la sesión como una fila discreta bajo el
 * composer — alineado a la IZQUIERDA: ventana de contexto + coste de la
 * sesión; alineado a la DERECHA: modelo + nivel de thinking. Hacer clic en el
 * lado izquierdo abre el popover de detalle por turno.
 *
 *  Las vistas previas al chat (inicio, /chat/new) NO renderizan lado izquierdo
 *  en absoluto (responsable, barrido de la oleada 7: el deslizador de
 *  presupuesto de contexto de conocimiento que vivía ahí murió con la
 *  inyección; un resumen "— · —" sobre un popover vacío es puro ruido) — el
 *  centro con la tira de dictado simplemente se ensancha.
 *
 * El gasto llega ya tarificado por el servidor a través del catálogo y la
 * calculadora de Pi. Un coste que falta se queda en "—", nunca un falso cero.
 * El contexto es una medición aparte de la conversación completada, nunca un
 * plegado del registro de dinero/resumidor ni una estimación de la
 * transcripción. Su denominador sigue al modelo seleccionado, del catálogo o
 * del informe de la CLI de la sesión; los cambios de modelo conservan el
 * numerador. Una compactación con éxito borra el numerador y cualquier
 * informe antiguo de la CLI.
 */
export function StatsBar({
	turns,
	contextTokens = null,
	cliContextWindow = null,
	pricing,
	dictationSlot,
	chatId,
	leadingSlot,
	onModelChange,
}: {
	turns: TurnUsage[];
	contextTokens?: number | null;
	cliContextWindow?: ReturnType<typeof cliContextWindowOf>;
	pricing?: SessionPricing;
	/** La sesión vinculada (modelos por sesión, responsable 2026-09-28):
	 *  presente en la barra dentro de la sesión — el control de modelo se
	 *  vincula al registro PROPIO DE LA SESIÓN; ausente en las superficies de
	 *  borrador, donde se vincula a la ranura fuerte (el valor por defecto de las
	 *  sesiones nuevas). */
	chatId?: string;
	/** La misma identidad efectiva de la que es dueño el control de modelo visible. */
	onModelChange?: (model: string | undefined) => void;
	/** La tira de dictado (oleada STT, 2026-09-17): el centro de la fila es
	 *  espacio muerto entre los datos de la sesión y el control de modelo — ahí
	 *  vive el botón del micrófono, y mientras se graba el medidor se despliega
	 *  para llenar el ancho que tenga la fila (colocación del responsable). */
	dictationSlot?: ReactNode;
	/** El borde IZQUIERDO de la fila (sesiones de práctica, 2026-10-04): el
	 *  conmutador enseñar | practicar del composer del inicio va aquí — antes de
	 *  los datos de la sesión (que no renderizan nada antes del chat en esa superficie). */
	leadingSlot?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [selectedModel, setSelectedModel] = useState<string | undefined>();
	const modelChanged = useCallback((model: string | undefined) => {
		setSelectedModel(model);
		onModelChange?.(model);
	}, [onModelChange]);
	// La misma disciplina de desplegable que el control de modelo (responsable, tratamiento df4433f,
	// ronda 1 de estadísticas): cierra con cualquier pointerdown fuera de la barra o con Escape.
	const barRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const popupLayer = usePopoverDismiss(barRef, open && !!(chatId || turns.length), () => setOpen(false), { layerRootRef: panelRef });
	// El selector informa de su selección efectiva. Las ventanas de la CLI tienen ámbito
	// de sesión; unos metadatos desconocidos siempre significan solo uso, nunca un máximo supuesto.
	const { catalog } = useModelCatalog();
	const limits = useMemo(() => (catalog ? catalogLimits(catalog) : undefined), [catalog]);
	const limit = contextLimitForModel(selectedModel, limits, cliContextWindow);
	const contextLabel = formatContextMeasurement(contextTokens, limit);
	const cacheHitRate = useMemo(() => sessionCacheHitRate({ turns }), [turns]);
	const { cost = 0, unpriced = turns.length, subscription = 0 } = pricing ?? {};
	// Coste honesto: muestra dólares solo cuando al menos un turno se ha tarificado;
	// si no, "—" (nunca un falso $0.0000).
	const pricedCount = turns.length - unpriced - subscription;
	const providers = pricing?.subscriptionProviders ?? subscriptionLabels(turns.map((turn) => turn.model));
	const cliBilled = turns.some((turn) => turn.model.startsWith(`${CLAUDE_CODE_PROVIDER}:`));
	const costLabel = planCostLabel(pricedCount > 0 ? cost : null, cliBilled ? [...providers, "CLI"] : providers);

	return (
		<div
			data-testid="stats-bar"
			// pointer-events-auto: el envoltorio sticky del composer es pointer-events-none
			// (para que su área de degradado transparente nunca bloquee el scroll) — esta fila
			// debe reactivar los eventos o todos sus controles estarán muertos (la oleada del
			// control de modelo lo detectó en vivo: los botones se renderizaban, los clics nunca llegaban).
			className="pointer-events-auto relative flex items-center justify-between gap-3 px-3 pt-2 text-xs text-muted-foreground"
		>
			{/* El botón de resumen + su popover: el popover se ancla a este
			envoltorio, CENTRADO sobre el propio botón (responsable, ronda 2 de
			estadísticas) — no sobre toda la fila de la barra, que lo dejaba
			extrañamente alineado. La ref de cierre exterior también se ancla AQUÍ
			(responsable, ronda 3): sobre toda la barra envolvía el control de modelo,
			así que hacer clic en modelo/thinking nunca contaba como exterior — la
			asimetría que observó el responsable. */}
			{/* La ranura inicial (2026-10-04): la superficie de control más a la
			izquierda — el conmutador de modo del composer del inicio. */}
			{leadingSlot}
			{/* El lado izquierdo: el resumen de datos de la sesión — solo una vez que
			existe una sesión (turnos). Antes del chat no renderiza nada (ver la cabecera). */}
			{(chatId || turns.length > 0) && (
			<div ref={barRef} className="relative">
				{/* Sin tooltip — las cifras se explican solas y el popover habla al hacer
			clic (responsable, ronda de sutileza 2026-09-25). */}
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				data-testid="stats-summary"
				className="flex items-center gap-1.5 tabular-nums transition-colors hover:text-foreground"
			>
				<span data-testid="stats-context">
					{contextLabel}
				</span>
				<span aria-hidden>·</span>
				<span data-testid="stats-cost">{costLabel}</span>
			</button>
				{open && (
					<div
						ref={panelRef}
						data-testid="stats-detail"
						style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }}
						className="absolute bottom-full left-1/2 mb-1.5 w-72 -translate-x-1/2 rounded-xl border bg-card p-3 text-xs shadow-xl"
					>
						<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Session stats
						</div>
						<div className="flex flex-col gap-1 text-muted-foreground">
							<div className="flex justify-between gap-2">
								<span>Context (last call)</span>
								<span className="tabular-nums text-card-foreground">
									{contextLabel}
								</span>
							</div>
							{selectedModel?.startsWith(`${CLAUDE_CODE_PROVIDER}:`) && (
								<p>Window reported by Claude Code; may be lower for auto-compaction.</p>
							)}
							<div className="flex justify-between gap-2">
								<span>{subscription ? "Usage" : "Total cost"}</span>
								<span className="tabular-nums text-card-foreground">{costLabel}</span>
							</div>
							{cacheHitRate !== null && (
								<div data-testid="stats-cache-hit-rate" className="flex justify-between gap-2">
									<span>Cache hit rate</span>
									<span className="tabular-nums text-card-foreground">{(cacheHitRate * 100).toFixed(1)}%</span>
								</div>
							)}
							{providers.includes("ChatGPT") && <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="underline underline-offset-2">Manage ChatGPT usage</a>}
							{unpriced > 0 && (
								<div className="flex justify-between gap-2">
									<span>Unpriced turns</span>
									<span className="tabular-nums text-card-foreground">{unpriced}</span>
								</div>
							)}
						</div>
						{turns.length > 0 && (
							<>
								<div className="mb-1 mt-2.5 border-t pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
									Turns
								</div>
								<ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
									{turns.map((turn, i) => {
										const c = pricing?.turnCosts[turn.id] ?? null;
										return (
											<li key={`${turn.messageId}-${i}`} className="flex items-center justify-between gap-2">
												<span className="truncate text-muted-foreground">
													#{i + 1} · {prettyModel(turn.model, true)}
												</span>
												<span className="flex shrink-0 items-center gap-2 tabular-nums text-card-foreground">
													<span className="text-muted-foreground">{turn.steps.length} steps</span>
													<span>{turn.model.startsWith(`${CLAUDE_CODE_PROVIDER}:`) ? "CLI" : subscriptionLabel(turn.model) ?? (c === null ? "—" : formatUsd(c))}</span>
												</span>
											</li>
										);
									})}
								</ul>
							</>
						)}
					</div>
				)}
			</div>
			)}
			{/* La ranura central: dictado (responsable, 2026-09-17). flex-1 deja que el
			medidor se expanda al ancho libre de la fila; justify-center mantiene
			visualmente centrado el botón de micrófono solitario en reposo. */}
			{dictationSlot && (
				<div className="flex min-w-0 flex-1 items-center justify-center">{dictationSlot}</div>
			)}
			{/* El control de modelo + thinking — un controlador para los agentes de
			conversación (sondeador/profesor); los `turns` del registro de arriba siguen
			sumando los modelos REALMENTE facturados, diga lo que diga el selector. */}
			<ModelControl chatId={chatId} onModelChange={modelChanged} />
		</div>
	);
}
