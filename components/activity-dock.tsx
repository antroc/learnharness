"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIcon, BotIcon, FileTextIcon, PenToolIcon, PlayIcon, SearchIcon, SquareIcon, WaypointsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CallUsage, JobKind, JobRecord } from "@/src/core";
import { isModelsRefusal, isProviderKeyRefusal, subscriptionLabel, subscriptionLabels } from "@/src/core";
import { formatTokens, planCostLabel } from "@/components/usage-format";
import { useServerEvent, useServerResync } from "@/components/server-events";

/**
 * LA SECCIÓN DE AGENTES EN SEGUNDO PLANO (responsable, ronda de la barra lateral — la
 * sucesora del retirado dock flotante de abajo a la derecha): la franja inferior de
 * la BARRA LATERAL IZQUIERDA, una burbuja por cada proceso EN SEGUNDO PLANO en curso —
 * subagentes de sesión (research/demo/visual) y ejecuciones globales de extracción.
 * Los turnos de enseñanza NO están aquí a propósito: la sección existe para dar a los
 * procesos en segundo plano la observabilidad que el alumno no tiene de otro modo; un
 * turno de enseñanza en curso es completamente visible donde ocurre (decisión del
 * usuario, 2026-09).
 *
 * Datos: UNA sola fuente, GET /api/activity (tareas de TODOS los chats, unidas al
 * título, de la más antigua a la más reciente + ejecuciones de extracción), que se
 * pide cuando cambia la verdad (canal de eventos, S5) y se pliega en el cliente con
 * core/prices.ts. El coste se DEDUCE en el servidor mediante Pi; la línea de contexto
 * es la entrada+salida de la ÚLTIMA llamada al modelo frente al límite del modelo
 * (JobUsage.lastStep — contrato pendiente) — nunca una suma acumulada, que sería el
 * número equivocado. Los datos ausentes se renderizan como "—", nunca como cero (la
 * doctrina).
 *
 * Discreta y ambiental por diseño: sin animaciones de entrada, claves estables, las
 * actualizaciones caen en su sitio — los refrescos nunca parpadean. SIEMPRE presente
 * (responsable, ronda de la barra lateral): vacía significa VACÍA — la cabecera se
 * queda sola, nada se oculta; se llena y CRECE cuando hay procesos en curso (max-h +
 * scroll interno para que un montón nunca agobie la lista de sesiones). El estado
 * cerrado de la barra lateral significa que el alumno ha optado por no verla — sin
 * señal ambiental mientras está cerrada (decisión del usuario: invisibilidad hasta
 * que haga falta construir una historia de observabilidad más clara). Por burbuja:
 * icono del tipo, tiempo transcurrido, coste, línea de actividad y un botón explícito
 * de TERMINAR (POST /api/activity/abort — el backend de la oleada 4 está activo):
 * 404/409 significan que el proceso ya no existe (refrescar, sin error); los fallos
 * reales se degradan a un "Abort failed" en línea, nunca a un control muerto. El
 * detalle (contexto, modelo, pasos, enlace a la sesión) SE DESPLIEGA EN LÍNEA — la
 * sección hace scroll, así que un popover flotante se recortaría en sus bordes.
 */

// ─── Formas de red (copias seguras para el cliente de server/observability.ts) ────

/** JobUsage ampliado con el contrato pendiente de lastStep (la línea de contexto). */
interface FeedUsage extends NonNullable<JobRecord["usage"]> {
	lastStep?: CallUsage;
}

export interface FeedJob extends JobRecord {
	/** Estimación del servidor en tiempo de lectura; ausente en cargas de transporte antiguas. */
	costUsd?: number | null;
	title: string;
	usage?: FeedUsage;
	/** Límite del catálogo en vivo unido por el servidor (enmienda del responsable 2026-09-23)
	 * — null cuando el modelo no está en el catálogo de pi (sin línea de contexto). */
	contextLimit: number | null;
}

export interface FeedExtraction {
	/** Id de fila único (id de la fuente, o "src#i" para las tareas por fragmentos). */
	id: string;
	chatId: string;
	part?: { i: number; n: number };
	title: string;
	phase: string;
	startedAt: number;
}

export interface FeedPluginWorker {
	id: string;
	taskId: string;
	pluginId: string;
	definitionId: string;
	status: "queued" | "running";
	title: string;
	createdAt: string;
	updatedAt: string;
	activity?: string;
	model: { provider: string; id: string };
	usage?: FeedUsage;
	costUsd: number | null;
	contextLimit: number | null;
}

export interface ActivityFeed {
	jobs: FeedJob[];
	/** Opcional para cargas y consumidores antiguos; el servidor actual siempre lo envía. */
	pluginWorkers?: FeedPluginWorker[];
	extractions: FeedExtraction[];
}

const EMPTY_FEED: ActivityFeed = { jobs: [], pluginWorkers: [], extractions: [] };

// ─── La fuente de actividad (raíz de composición: el layout raíz) ─────────────────

const ActivityContext = createContext<{ feed: ActivityFeed; refresh: () => void }>({
	feed: EMPTY_FEED,
	refresh: () => {},
});

/**
 * LA FUENTE DE ACTIVIDAD, IMPULSADA POR PUSH (arquitectura S5, 2026-10-02): el sondeo
 * adaptativo está RETIRADO — el dock vuelve a pedir los datos justo cuando cambia la
 * verdad. Cada causa se anuncia en el canal de eventos: las transiciones de fase de
 * la extracción (activity-changed), las escrituras de tareas (jobs-changed — las
 * burbujas de tareas en curso) y la resincronización del canal (reconexión /
 * recuperación tras reiniciar en desarrollo) — más la única causa local del cliente
 * anterior al canal: la visibilidad, una pestaña que se vuelve visible pide los datos
 * al momento. Las peticiones anunciadas usan un debounce final de 250 ms (ráfagas de
 * fases de extracción); la resincronización y la visibilidad son inmediatas. Una
 * petición fallida conserva la última fuente (el dock nunca parpadea a vacío por un
 * corte momentáneo).
 */
export function ActivityProvider({ children }: { children: React.ReactNode }) {
	const [feed, setFeed] = useState<ActivityFeed>(EMPTY_FEED);
	const [nonce, setNonce] = useState(0);
	const refresh = useCallback(() => setNonce((n) => n + 1), []);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const res = await fetch("/api/activity");
				if (res.ok) {
					const data = (await res.json()) as Partial<ActivityFeed>;
					if (alive)
						setFeed({ jobs: data.jobs ?? [], pluginWorkers: data.pluginWorkers ?? [], extractions: data.extractions ?? [] });
				}
			} catch {
				// corte momentáneo del transporte: se conserva la última fuente y se vuelve a anunciar en el siguiente evento
			}
		})();
		return () => {
			alive = false;
		};
	}, [nonce]);

	// Anuncios → una petición final por ráfaga (la ley del debounce de S4).
	const scheduleAnnouncedFetch = () => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = undefined;
			refreshRef.current();
		}, 250);
	};
	useServerEvent("activity-changed", scheduleAnnouncedFetch);
	useServerEvent("jobs-changed", scheduleAnnouncedFetch);
	// Recuperación tras reconectar: los eventos perdidos mientras el canal estaba caído.
	useServerResync(() => refreshRef.current());

	// El empujón de visibilidad: al volver a la pestaña se piden los datos al momento —
	// todo lo perdido mientras estaba oculta llega de una vez.
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "visible") setNonce((n) => n + 1);
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	// El temporizador del debounce nunca sobrevive al proveedor.
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		},
		[],
	);

	return <ActivityContext.Provider value={{ feed, refresh }}>{children}</ActivityContext.Provider>;
}

/** La frontera de la fuente de actividad para el resto del shell: los datos del dock +
 * su empujón de refresco. Los empujadores que quedan son causas visibles en el cliente
 * (los botones de extraer/importar — extraction-coverage, graph-view); todas las causas
 * del servidor se anuncian ahora por sí mismas en el canal de eventos. */
export function useActivity(): { feed: ActivityFeed; refresh: () => void } {
	return useContext(ActivityContext);
}

// ─── Auxiliares puros de presentación (exportados para las pruebas) ──────────────

/** Una burbuja del dock: la vista unificada de una tarea o de una ejecución de extracción. */
export interface ActivityBlob {
	/** job.id, o el id de fila de la tarea de extracción (id de la fuente, o "src#i" para
	 * las tareas por fragmentos — único por fila, tareas por fragmento, responsable 2026-09-28). */
	id: string;
	process: "job" | "plugin-worker" | "extraction";
	/** Tipo de subagente para las tareas (las burbujas de extracción no tienen). */
	jobKind?: JobKind;
	/** Fase de extracción (extracting/auditing/merging/embedding); las tareas no tienen. */
	phase?: string;
	title: string;
	chatId?: string;
	/** Época en ms — las burbujas se ordenan de la más antigua a la más reciente y el tiempo transcurrido se cuenta desde aquí. */
	startedAt: number;
	/** Coste deducido en USD (jobCost) — null se renderiza como "—". */
	cost: number | null;
	/** Huella de la última llamada al modelo frente a su límite — null se renderiza como "—". */
	context: { used: number; limit: number } | null;
	/** La última línea de actividad legible (""). */
	activity: string;
	/** Id del modelo del subagente, cuando se informa del uso. */
	model?: string;
	/** Llamadas al modelo hechas hasta ahora, cuando se informa del uso. */
	steps?: number;
}

/** Fusiona la fuente en una lista de burbujas de la más antigua a la más reciente (el orden estable de las burbujas). */
export function toBlobs(feed: ActivityFeed): ActivityBlob[] {
	const blobs: ActivityBlob[] = feed.jobs.map((job) => {
		const usage = job.usage;
		let context: ActivityBlob["context"] = null;
		const lastStep = usage?.lastStep;
		// Enmienda del medidor de contexto (responsable 2026-09-23): el límite sale de la
		// FUENTE (unido por el servidor desde el catálogo en vivo de pi) — sin tabla en el
		// cliente. Límite null = sin línea de contexto (renderizar solo el uso le corresponde
		// a la forma de la burbuja — aquí la línea simplemente se oculta).
		const limit = job.contextLimit;
		if (usage && lastStep && limit !== null && lastStep.inputTokens !== undefined) {
			// La misma métrica que el medidor de la sesión (cuatro cubos normalizados — la
			// auditoría del medidor de contexto, responsable 2026-09-23): las cuatro direcciones.
			// El "input" del proveedor EXCLUYE cacheRead/cacheWrite, así que solo input+output
			// da una lectura disparatadamente baja en las tareas con mucha caché.
			context = {
				used:
					lastStep.inputTokens +
					(lastStep.outputTokens ?? 0) +
					(lastStep.cacheReadTokens ?? 0) +
					(lastStep.cacheWriteTokens ?? 0),
				limit,
			};
		}
		return {
			id: job.id,
			process: "job",
			jobKind: job.kind,
			title: job.kind === "plugin" ? job.plugin?.label || job.plugin?.toolName || "Plugin worker" : job.title,
			chatId: job.chatId,
			startedAt: Date.parse(job.createdAt) || 0,
			cost: job.costUsd ?? null,
			context,
			// BYOK (responsable, 2026-09-22): un rechazo es información, no un fallo —
			// la línea honesta que dejó el ejecutor ("failed") se lee como que falta
			// configuración, a juego con el tono discreto de la tarjeta de encargo. El gemelo
			// del rechazo por clave de proveedor (oleada de cero claves, 66dbea9 de Platform):
			// un modelo fijado cuya clave ha desaparecido se lee como que hace falta la
			// clave, con el mismo tono discreto.
			activity: isModelsRefusal(job.error)
				? "needs model setup"
				: isProviderKeyRefusal(job.error)
					? "needs a provider key"
					: (job.activity ?? ""),
			model: usage?.model,
			steps: usage?.steps,
		};
	});
	for (const task of feed.pluginWorkers ?? []) {
		const last = task.usage?.lastStep;
		blobs.push({
			id: task.id, process: "plugin-worker", jobKind: "plugin", title: task.title,
			startedAt: Date.parse(task.createdAt) || 0,
			cost: task.costUsd ?? null,
			context: task.contextLimit !== null && last?.inputTokens !== undefined
				? { used: last.inputTokens + (last.outputTokens ?? 0) + (last.cacheReadTokens ?? 0) + (last.cacheWriteTokens ?? 0), limit: task.contextLimit }
				: null,
			activity: task.activity ?? task.status,
			model: task.usage?.model ?? `${task.model.provider}:${task.model.id}`,
			steps: task.usage?.steps,
		});
	}
	for (const run of feed.extractions) {
		blobs.push({
			id: run.id,
			process: "extraction",
			phase: run.phase,
			title: run.title,
			chatId: run.chatId,
			startedAt: run.startedAt,
			cost: null, // las ejecuciones de extracción no van por el canal del dinero (v1)
			context: null,
			activity: "",
		});
	}
	blobs.sort((a, b) => a.startedAt - b.startedAt);
	return blobs;
}

/** Tiempo transcurrido como cadena compacta que avanza: 45s / 3m 04s / 1h 12m. */
export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ─── La sección (la franja inferior de la barra lateral) ──────────────────────────

/** Un latido de 1 s mientras la sección tiene contenido — las líneas de tiempo transcurrido avanzan. */
function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [active]);
	return now;
}

const KIND_ICON: Record<JobKind, typeof SearchIcon> = {
	research: SearchIcon,
	demo: PlayIcon,
	visual: PenToolIcon,
	pdf: FileTextIcon, // fuentes v0 — entrada forzada por el tipo (JobKind ganó "pdf")
	plugin: BotIcon,
};

/** Estados de aborto por id de burbuja: pendiente (lanzado) / fallido (sin backend). */
type AbortState = "pending" | "failed";

export function ActivitySection({ feed: feedProp }: { feed?: ActivityFeed }) {
	const ctx = useContext(ActivityContext);
	const feed = feedProp ?? ctx.feed;
	const refresh = ctx.refresh;
	const blobs = useMemo(() => toBlobs(feed), [feed]);
	const [openBlob, setOpenBlob] = useState<string | null>(null); // detalle, desplegado en línea
	const [abortStates, setAbortStates] = useState<Record<string, AbortState>>({});
	const now = useNow(blobs.length > 0);
	// Refs para manejadores de aborto estables (sin recrear closures en cada tick).
	const abortRef = useRef({ blobs, refresh, setAbortStates });
	abortRef.current = { blobs, refresh, setAbortStates };

	const totalCost = useMemo(() => {
		const priced = blobs.map((b) => b.cost).filter((c): c is number => c !== null);
		return priced.length === 0 ? null : priced.reduce((a, c) => a + c, 0);
	}, [blobs]);

	const abort = useCallback(async (blob: ActivityBlob) => {
		const { setAbortStates: set } = abortRef.current;
		set((s) => ({ ...s, [blob.id]: "pending" }));
		try {
			const res = await fetch("/api/activity/abort", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					kind: blob.process,
					// Las extracciones se abortan por id de FUENTE (chatId) — las filas por fragmentos
					// comparten una fuente y mueren juntas.
					id: blob.process === "extraction" ? blob.chatId : blob.id,
				}),
			});
			if (!res.ok) {
				// 404 not_found / 409 not_running: el proceso ya no existe —
				// el estado final deseado. Se refresca y se limpia; no hay nada que informar.
				if (res.status === 404 || res.status === 409) {
					abortRef.current.refresh();
					set((s) => {
						const { [blob.id]: _drop, ...rest } = s;
						return rest;
					});
					return;
				}
				throw new Error(String(res.status));
			}
			abortRef.current.refresh();
		} catch {
			set((s) => ({ ...s, [blob.id]: "failed" }));
		}
	}, []);

	// Piel nativa de la barra lateral (responsable, ronda de la barra lateral): parte de la
	// superficie de la barra, no una tarjeta flotante — el separador border-t coincide con
	// la línea del borde de la propia barra, la cabecera coincide con la etiqueta "Sessions"
	// y las filas, con el hover de las filas de sesión. Vacía significa vacía: la cabecera
	// se queda sola (el tramo del coste es contenido, no decoración).
	return (
		<section data-testid="activity-section" className="border-t border-border px-3 pb-3 pt-2">
			<div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground/70">
				<ActivityIcon className="size-3" />
				Background agents
				{blobs.length > 0 && (
					<span className="ml-auto tabular-nums" data-testid="activity-total-cost" title="Total running cost (inferred)">
						{planCostLabel(totalCost, subscriptionLabels(blobs.map((blob) => blob.model)))}
				</span>
				)}
			</div>
			{blobs.length > 0 && (
				<div className="flex max-h-[40dvh] flex-col gap-1 overflow-y-auto">
					{blobs.map((blob) => (
						<ActivityBlobRow
							key={blob.id}
							blob={blob}
							now={now}
							detailOpen={openBlob === blob.id}
							onToggleDetail={() => setOpenBlob((id) => (id === blob.id ? null : blob.id))}
							abortState={abortStates[blob.id]}
							onAbort={() => void abort(blob)}
						/>
					))}
			</div>
			)}
		</section>
	);
}

/** Una burbuja: icono + tiempo transcurrido + coste en la cara; clic → popover de detalle. */
function ActivityBlobRow({
	blob,
	now,
	detailOpen,
	onToggleDetail,
	abortState,
	onAbort,
}: {
	blob: ActivityBlob;
	now: number;
	detailOpen: boolean;
	onToggleDetail: () => void;
	abortState: AbortState | undefined;
	onAbort: () => void;
}) {
	const Icon = blob.process === "extraction" ? WaypointsIcon : (blob.jobKind && KIND_ICON[blob.jobKind]) || BotIcon;
	const label =
		blob.process === "extraction"
			? `Extraction — ${blob.phase ?? "running"}`
			: blob.jobKind === "research"
				? "Researcher"
				: blob.jobKind === "demo"
					? "Demo builder"
					: blob.jobKind === "visual"
						? "Figure maker"
						: blob.jobKind === "pdf"
							? "PDF reader"
							: blob.jobKind === "plugin"
								? "Plugin worker"
								: "Sub-agent";
	return (
		<div
			data-testid={`activity-blob-${blob.process}`}
			data-activity-id={blob.id}
			className="relative rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-accent"
		>
			<button
				type="button"
				onClick={onToggleDetail}
				aria-expanded={detailOpen}
				className="flex w-full items-center gap-2 pr-7 text-left"
			>
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-card-foreground">{blob.title}</span>
					{blob.activity ? (
						<span className="block truncate text-muted-foreground" title={blob.activity}>
							{blob.activity}
						</span>
					) : (
						<span className="block truncate text-muted-foreground/80">{label}</span>
					)}
				</span>
				<span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
					<span data-testid="activity-blob-cost">{planCostLabel(blob.cost, subscriptionLabel(blob.model))}</span>
					<span data-testid="activity-blob-elapsed">{formatElapsed(now - blob.startedAt)}</span>
				</span>
			</button>
			{/* El TERMINAR explícito siempre en la cara de la burbuja (ALCANCE) — el popover
			    es para el DETALLE, no para el control. Un aborto fallido bloquea el botón y
			    dice por qué; uno correcto simplemente hace que la burbuja desaparezca al refrescar. */}
			<button
				type="button"
				data-testid="activity-abort"
				onClick={onAbort}
				disabled={abortState !== undefined}
				title={abortState === "failed" ? "Abort failed — try again" : "End this background process"}
				aria-label={`End ${label} in ${blob.title}`}
				className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
			>
				<SquareIcon className="size-3" />
			</button>

			{detailOpen && (
				<div
					data-testid="activity-blob-detail"
					className="mt-1 flex flex-col gap-1 rounded-lg bg-accent/40 p-2 text-muted-foreground"
				>
					<div className="mb-1.5 flex items-center gap-2">
						<Icon className="size-3.5 text-muted-foreground" />
						<span className="font-medium">{label}</span>
						<span className="ml-auto tabular-nums text-muted-foreground">
							{formatElapsed(now - blob.startedAt)}
						</span>
					</div>
					<div className="flex flex-col gap-1 text-muted-foreground">
						<div className="truncate text-card-foreground" title={blob.title}>
							{blob.title}
						</div>
						{blob.activity && <div className="break-words">{blob.activity}</div>}
						<div className="flex justify-between gap-2">
							<span>Cost</span>
							<span className="tabular-nums text-card-foreground">
								{planCostLabel(blob.cost, subscriptionLabel(blob.model))}
							</span>
						</div>
						<div className="flex justify-between gap-2">
							<span>Context</span>
							<span className="tabular-nums text-card-foreground" data-testid="activity-blob-context">
								{blob.context === null
									? "—"
									: `${formatTokens(blob.context.used)} / ${formatTokens(blob.context.limit)}`}
							</span>
						</div>
						{blob.model && (
							<div className="flex justify-between gap-2">
								<span>Model</span>
								<span className="truncate text-card-foreground">{blob.model}</span>
							</div>
						)}
						{blob.steps !== undefined && (
							<div className="flex justify-between gap-2">
								<span>Steps</span>
								<span className="tabular-nums text-card-foreground">{blob.steps}</span>
							</div>
						)}
						{blob.chatId && (
							<a href={`/chat/${blob.chatId}`} className="text-primary hover:underline">
								Open session →
							</a>
						)}
					</div>
					<div className="mt-2 text-muted-foreground/80">
					{abortState === "failed" && "Abort failed — try again"}
					{abortState === "pending" && "Stopping…"}
				</div>
				</div>
			)}
		</div>
	);
}