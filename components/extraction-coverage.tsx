"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActivity } from "@/components/activity-dock";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import { useSettingsSaved } from "@/components/settings-signal";
import { formatTokens } from "@/components/usage-format";
import { Hint } from "@/components/ui/hint";
import { timeAgo } from "@/components/sidebar";
import { resolveSettings } from "@/src/core";

/**
 * Las superficies de cobertura de la extracción (rediseño de la UX de
 * extracción, despacho fijado por el responsable 2026-09-24): el medidor de
 * anillo en la barra superior del chat y el bloque de cobertura en el menú
 * contextual de la sesión de la barra lateral — los dos sustitutos del panel de
 * cobertura de la vista de grafo (components/graph-coverage.tsx, retirado con
 * esta oleada). La cobertura es la MISMA derivación, con ámbito de una sesión:
 * GET /api/chats/[id] ahora lleva `coverage` (eed4b4e de Platform).
 *
 * El anillo se llena con uncoveredTokens / extractionChunkTokens — el
 * presupuesto de fragmento que fija el ajuste del umbral (Graph ▸
 * extractionChunkTokens): el medidor es «lo cerca que está esta sesión de lanzar
 * su siguiente ejecución de extracción». Se VACÍA a medida que una ejecución
 * pliega (la cobertura se vuelve a derivar en cada petición), late mientras hay
 * una ejecución en curso y desaparece del todo cuando el grafo está desactivado
 * (el interruptor general significa que no hay extracción, así que no hay medidor).
 *
 * La indicación manual sigue siendo POST /api/graph/coverage/extract {chatId}
 * (409 = ya en ejecución, BENIGNO — el disparador se nos adelantó; la frontera
 * de empujón del sitio de inicio del dock refresca en cualquier caso).
 */

/** Espejo, seguro para el cliente, del SessionCoverage del servidor (src/server/chats.ts
 *  — el bloque `coverage` de GET /api/chats/[id]). */
export interface SessionCoverage {
	totalMessages: number;
	coveredCount: number;
	uncoveredCount: number;
	coveredTokens: number;
	uncoveredTokens: number;
	running: boolean;
	lastFoldedAt: string | null;
}

/** La lectura de cobertura de una sesión — null si falla el transporte o hay un 404
 *  (quienes llaman no renderizan nada en vez de un cero falso; la doctrina del render honesto). */
async function fetchCoverage(chatId: string): Promise<SessionCoverage | null> {
	try {
		const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
		if (!res.ok) return null;
		const body = (await res.json()) as { coverage?: SessionCoverage | null };
		return body.coverage ?? null;
	} catch {
		return null;
	}
}

/** El denominador + la visibilidad del anillo, resueltos con el MISMO resolutor
 *  del núcleo que usan los ajustes efectivos del servidor (arreglo, 2026-10-02):
 *  el medidor usa como denominador exactamente el número que espera el disparador
 *  de la extracción — la antigua alternativa `?? 4096` hecha a mano se apartó del
 *  valor de fábrica (8192) y el anillo se llenaba a la mitad de la verdad. Null si
 *  falla la lectura → no hay anillo. */
export interface GraphRead {
	enabled: boolean;
	chunkTokens: number;
}

/** Exportada para la fijación de render (el precedente de ringFill): resuelve el
 *  delta de ajustes en bruto en la sección del grafo fiel a los valores de fábrica. */
export async function fetchGraphRead(): Promise<GraphRead | null> {
	try {
		const res = await fetch("/api/settings");
		if (!res.ok) return null;
		const body = (await res.json()) as { settings?: Parameters<typeof resolveSettings>[0] };
		const graph = resolveSettings(body.settings ?? null).graph;
		return { enabled: graph.enabled, chunkTokens: graph.extractionChunkTokens };
	} catch {
		return null;
	}
}

/** La frontera de la extracción manual, compartida por las dos superficies. El
 *  409 es BENIGNO (la ejecución ya está en curso) — devuelve "running" para que
 *  quien llama pase al estado optimista/en ejecución en vez de a un error.
 *  Devuelve false solo ante un fallo real, en el que quien llama revierte. */
async function requestExtract(chatId: string): Promise<boolean> {
	try {
		const res = await fetch("/api/graph/coverage/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chatId }),
		});
		if (!res.ok && res.status !== 409) return false;
		return true; // 202 iniciada, o 409 ya en ejecución — ambos "running"
	} catch {
		return false;
	}
}

// ─── El bloque de cobertura del menú contextual de la barra lateral ─────────

/**
 * El bloque informativo al final del menú contextual de la sesión (rediseño
 * fijado por el responsable): lo que el extractor aún no ha cubierto, más la
 * indicación manual Extract — separada visualmente de Rename/Delete de debajo
 * (esas siguen siendo las dos acciones de gestión de la sesión). Se lee AL ABRIR
 * EL MENÚ (el bloque se monta con el menú — bajo demanda, nunca de antemano) y se
 * sondea cada 2 s mientras hay una ejecución en curso, para que las cifras se
 * asienten en vivo. Sin cobertura (la lectura falló, 404): el bloque entero no
 * renderiza nada — nada de ceros falsos.
 */
export function CoverageMenuBlock({ chatId }: { chatId: string }) {
	const refreshActivity = useActivity().refresh;
	const [coverage, setCoverage] = useState<SessionCoverage | null>(null);
	const [extracting, setExtracting] = useState(false); // optimista hasta que el servidor diga running
	const lastUncoveredRef = useRef<number | null>(null);

	const load = useCallback(async () => {
		const next = await fetchCoverage(chatId);
		if (next === null) return;
		// El estado optimista se retira en cuanto el servidor dice running, o
		// en cuanto el plegado movió la cobertura (la ejecución terminó).
		if (
			next.running ||
			(lastUncoveredRef.current !== null && next.uncoveredTokens !== lastUncoveredRef.current)
		) {
			setExtracting(false);
		}
		lastUncoveredRef.current = next.uncoveredTokens;
		setCoverage(next);
	}, [chatId]);

	// AL ABRIR EL MENÚ (el bloque se monta con el menú — bajo demanda, nunca
	// de antemano): una lectura; después, mientras se ejecuta, toma el relevo el sondeo de 2 s de abajo.
	useEffect(() => {
		lastUncoveredRef.current = null;
		setExtracting(false);
		void load();
	}, [load]);

	// Mientras hay una ejecución en curso, el bloque sondea cada 2 s (la cadencia del
	// antiguo panel cuando estaba abierto, limitada al estado de ejecución) — las cifras
	// se asientan en vivo y el bloque termina en "fully extracted".
	// ACEPTADO POR DISEÑO (responsable, 2026-10-02): el anillo se vacía por plegado,
	// y el canal de eventos va por fase — esa diferencia de granularidad es la razón de que
	// se mantenga este sondeo acotado, con ámbito de la ejecución.
	useEffect(() => {
		if (coverage?.running !== true && !extracting) return;
		const timer = setInterval(() => void load(), 2000);
		return () => clearInterval(timer);
	}, [load, coverage?.running, extracting]);

	if (coverage === null) return null;

	const onExtract = async () => {
		setExtracting(true);
		// El empujón del sitio de inicio del dock (el 202 registra la ejecución antes de la
		// respuesta; un 409 significa que ya hay una en curso) — refresca para que la
		// ejecución aparezca enseguida en cualquier caso.
		refreshActivity();
		const started = await requestExtract(chatId);
		if (!started) setExtracting(false);
		void load();
	};
	return (
		<CoverageMenuBody
			coverage={coverage}
			extracting={extracting}
			onExtract={() => void onExtract()}
		/>
	);
}

/** El núcleo de presentación del bloque (exportado para las pruebas de render
 *  estático): las cifras, el latido de ejecución y la indicación Extract con su
 *  estado optimista "Running". */
export function CoverageMenuBody({
	coverage,
	extracting,
	onExtract,
}: {
	coverage: SessionCoverage;
	/** Clic pendiente (optimista) hasta que el servidor diga running. */
	extracting: boolean;
	onExtract: () => void;
}) {
	const busy = coverage.running || extracting;
	const complete = coverage.uncoveredTokens === 0 && coverage.uncoveredCount === 0;
	return (
		<div data-testid="ctx-coverage" className="flex flex-col gap-1 px-2.5 pt-1 pb-2">
			{busy ? (
				<span className="flex items-center gap-1.5 text-muted-foreground" data-testid="ctx-coverage-running">
					<span className="size-1.5 animate-pulse rounded-full bg-foreground/70" aria-hidden />
					extracting…
				</span>
			) : complete ? (
				<span className="text-muted-foreground">fully extracted</span>
			) : (
				<span className="flex flex-col">
					<span className="tabular-nums text-foreground">
						{formatTokens(coverage.uncoveredTokens)} tok uncovered
					</span>
					<span className="tabular-nums text-muted-foreground">
						{coverage.uncoveredCount} message{coverage.uncoveredCount === 1 ? "" : "s"} unextracted
					</span>
				</span>
			)}
			<button
				type="button"
				data-testid="ctx-extract"
				onClick={onExtract}
				disabled={busy || complete}
				className="flex items-center justify-center rounded-lg border px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
			>
				{busy ? "Running" : "Extract"}
			</button>
		</div>
	);
}

// ─── El medidor de anillo de la barra superior del chat ─────────────────────

/** La geometría del dónut (pura, exportada para las pruebas): la fracción de
 *  relleno sin cubrir/fragmento, acotada a [0,1] — en 1 se lanza la siguiente ejecución. */
export function ringFill(uncoveredTokens: number, chunkTokens: number): number {
	if (!(chunkTokens > 0)) return 0;
	return Math.min(1, Math.max(0, uncoveredTokens / chunkTokens));
}

/**
 * El medidor de anillo (fijado por el responsable: «un dónut junto al
 * PhaseChip»): lo cerca que está esta sesión de su siguiente ejecución de
 * extracción. Clic → las cifras exactas (tokens cubiertos/sin cubrir, mensajes,
 * el umbral, el último plegado). Desaparece del todo mientras el grafo está
 * desactivado o antes de la primera lectura correcta. Mientras hay una ejecución
 * en curso, el anillo LATE (decisión visual de quien implementó, según el
 * despacho — el movimiento es la señal de estado honesta en el registro
 * discreto de esta app; nada de cromo nuevo).
 *
 * Cadenas de refresco: montaje + `refreshKey` (la vista de chat lo incrementa al
 * asentarse el turno, aprovechando las cadenas de relectura existentes) + un
 * sondeo de 2 s mientras se ejecuta (se reinicia a medida que el plegado vacía la
 * cobertura) + la señal de ajustes (el umbral/interruptor general se vuelven a
 * leer en vivo).
 */
export function CoverageRing({ chatId, refreshKey = 0 }: { chatId: string; refreshKey?: number }) {
	const [graph, setGraph] = useState<GraphRead | null>(null);
	const [coverage, setCoverage] = useState<SessionCoverage | null>(null);
	const [open, setOpen] = useState(false);
	const [nonce, setNonce] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const popupLayer = usePopoverDismiss(rootRef, open && graph !== null && graph.enabled && coverage !== null, () => setOpen(false), { layerRootRef: panelRef });

	// La cadena de actividad/refresco (la frontera del despacho): las ejecuciones pueden dispararse desde
	// OTRAS superficies (el Extract del menú de la barra lateral, el proceso del turno, otra
	// pestaña) — ningún incremento al asentarse un turno se las anuncia a esta página. El feed
	// del dock sí lo sabe; una ejecución de ESTA sesión que aparece o se asienta en él
	// vuelve a leer la cobertura (la misma transición a ejecuciones vacías que usa la vista de grafo).
	const feed = useActivity().feed;
	const runHere = feed.extractions.some((run) => run.chatId === chatId);

	useSettingsSaved((section) => {
		if (section === "graph") setNonce((n) => n + 1);
	});

	useEffect(() => {
		let alive = true;
		void fetchGraphRead().then((g) => alive && setGraph(g));
		return () => {
			alive = false;
		};
	}, [nonce]);

	useEffect(() => {
		let alive = true;
		void fetchCoverage(chatId).then((c) => alive && setCoverage(c));
		return () => {
			alive = false;
		};
	}, [chatId, refreshKey, nonce, runHere]);

	// Mientras hay una ejecución en curso: sondea cada 2 s para que el anillo se VACÍE a medida que
	// llegan los plegados y se asiente en cero cuando termine la ejecución (el requisito de
	// «reiniciar al terminar» — la cobertura se vuelve a derivar en cada petición).
	// ACEPTADO POR DISEÑO (responsable, 2026-10-02): el anillo se vacía por plegado,
	// y el canal de eventos va por fase — esa diferencia de granularidad es la razón de que
	// se mantenga este sondeo acotado, con ámbito de la ejecución.
	useEffect(() => {
		if (coverage?.running !== true) return;
		const timer = setInterval(() => {
			void fetchCoverage(chatId).then((c) => {
				if (c !== null) setCoverage(c);
			});
		}, 2000);
		return () => clearInterval(timer);
	}, [chatId, coverage?.running]);

	// Desaparece del todo cuando el grafo está desactivado, o antes de la primera lectura
	// honesta (nada de ceros falsos — la doctrina).
	if (graph === null || !graph.enabled || coverage === null) return null;

	const fill = ringFill(coverage.uncoveredTokens, graph.chunkTokens);
	return (
		<div ref={rootRef} className="lh-no-drag relative shrink-0">
			<Hint
				// Recortado (responsable, ronda de sutileza 2026-09-25).
				label="How much of this session isn't mapped yet"
				side="bottom"
			>
				<button
					type="button"
					data-testid="coverage-ring"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className="relative flex size-5 cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
				>
					{/* El dónut: pista + relleno. Todo el anillo late mientras hay una ejecución
					en curso (movimiento = la señal de estado de trabajo). */}
					<CoverageRingGlyph fill={fill} running={coverage.running} />
				</button>
			</Hint>
			{open && (
				<div
					ref={panelRef}
					data-testid="coverage-ring-popover"
					style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }}
					className="absolute top-full right-0 mt-1.5 w-64 rounded-xl border bg-card p-3 text-xs shadow-xl"
				>
					<CoverageRingDetail coverage={coverage} chunkTokens={graph.chunkTokens} />
				</div>
			)}
		</div>
	);
}

/** El propio dónut (exportado para las pruebas de render estático): una pista de
 *  línea fina más el arco de relleno — sin cubrir/fragmento de la circunferencia,
 *  empezando a las 12 en punto. Todo el anillo late mientras hay una ejecución en curso. */
export function CoverageRingGlyph({ fill, running }: { fill: number; running: boolean }) {
	const C = 2 * Math.PI * 6; // r=6 en el viewBox de 16px
	return (
		<svg
			viewBox="0 0 16 16"
			className={running ? "size-full animate-pulse" : "size-full"}
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-border" />
			<circle
				cx="8"
				cy="8"
				r="6"
				fill="none"
				strokeWidth="2.5"
				className="stroke-foreground/70"
				strokeDasharray={`${fill * C} ${C}`}
				strokeLinecap="round"
				transform="rotate(-90 8 8)"
			/>
		</svg>
	);
}

/** El cuerpo de la ventana emergente (exportado para las pruebas de render
 *  estático): las cifras exactas — tokens cubiertos/sin cubrir, cobertura de
 *  mensajes, el umbral, la antigüedad del último plegado. */
export function CoverageRingDetail({ coverage, chunkTokens }: { coverage: SessionCoverage; chunkTokens: number }) {
	return (
		<>
			<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Extraction coverage
			</div>
			<div className="flex flex-col gap-1 text-muted-foreground">
				<div className="flex justify-between gap-2">
					<span>Uncovered</span>
					<span className="tabular-nums text-card-foreground">
						{formatTokens(coverage.uncoveredTokens)} tokens
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span>Covered</span>
					<span className="tabular-nums text-card-foreground">
						{formatTokens(coverage.coveredTokens)} tokens
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span>Messages</span>
					<span className="tabular-nums text-card-foreground">
						{coverage.coveredCount} / {coverage.totalMessages}
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span>Chunk threshold</span>
					<span className="tabular-nums text-card-foreground">
						{formatTokens(chunkTokens)} tokens
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span>Last extraction</span>
					<span className="tabular-nums text-card-foreground">
						{coverage.lastFoldedAt ? timeAgo(coverage.lastFoldedAt) : "—"}
					</span>
				</div>
				{coverage.running && (
					<div className="flex justify-between gap-2" data-testid="coverage-ring-running">
						<span>Status</span>
						<span className="text-card-foreground">extracting…</span>
					</div>
				)}
			</div>
		</>
	);
}