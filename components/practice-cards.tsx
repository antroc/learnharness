"use client";

import { ToolContentResponse } from "@/components/ai-elements/message";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ArtifactPartProps } from "@/src/core";

/**
 * Las tarjetas de práctica de la transcripción (sesiones de práctica, diseño
 * del responsable 2026-10-04): tres registros tranquilos en el flujo —
 *
 * - ProblemCard — un problema planteado: el enunciado, compacto y
 *   desplegable (como todas las tarjetas de aquí; el dock es la superficie de
 *   trabajo, esto es el registro). El compromiso NUNCA se renderiza — solo
 *   el enunciado de la llamada.
 * - ConcludeCard — la conclusión: insignia de resultado + veredicto + la
 *   revelación (la solución comprometida, mostrada cuando acaba el problema).
 *   Una síntesis de descarte (outcome:"dismissed") se renderiza como una
 *   única línea atenuada.
 * - ThinkingCard — el envío propio del alumno, del lado del usuario: el
 *   registro es el de los dos botones (Nudge = traza de trabajo, Commit =
 *   respuesta). El ThinkingBlock UNIFICADO (ronda del responsable
 *   2026-10-05): el lenguaje de bloque de cita del quiz en un armazón leve
 *   del lado del usuario, nunca plegable.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ThinkingBlock } from "@/components/thinking-block";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import { useInteractionLayers } from "@/components/interaction-layers";

/* NOMBRES DE LOS OBJETIVOS (ronda 17 del responsable, 2026-10-06): los
 * objetivos se normalizan a ids de nodo opacos en la frontera del registro
 * (ronda 9 del responsable — la traza de dominio agrupa por ellos), así que
 * el cajón resuelve los nombres al renderizar. Una petición perezosa y en
 * caché de módulo de la vista del grafo (el mapa id → nombre ocupa unos
 * pocos KB); los fallos degradan a ids en bruto — la observabilidad nunca
 * rompe la tarjeta. */
let nodeNameMapPromise: Promise<Record<string, string>> | null = null;
function nodeNameMap(): Promise<Record<string, string>> {
	nodeNameMapPromise ??= fetch("/api/graph")
		.then((r) => (r.ok ? r.json() : { nodes: [] }))
		.then((g: { nodes?: Array<{ id?: unknown; name?: unknown }> }) =>
			Object.fromEntries(
				(g.nodes ?? [])
					.filter((n) => typeof n.id === "string")
					.map((n) => [n.id as string, typeof n.name === "string" ? (n.name as string) : (n.id as string)]),
			),
		)
		.catch(() => ({}));
	return nodeNameMapPromise;
}

/** Los details del marcador de thinking de práctica (native-messages.ts). */
export interface PracticeThinkingData {
	problemCallId: string;
	/** Los registros heredados (anteriores al 2026-10-05) llevan el antiguo indicador de dos carriles; se ignora. */
	commit?: boolean;
	text: string;
	images?: readonly Readonly<import("@earendil-works/pi-ai").ImageContent>[];
}

export function ProblemCard({ part }: ArtifactPartProps) {
	// Siempre abierta, sin chevron (ronda del responsable, 2026-10-05): el registro ES
	// el enunciado — la misma disciplina de contenedor + antetítulo que la tarjeta
	// respondida y el dock (que refleja esto en el Slice D). El compromiso nunca
	// se renderiza — solo el enunciado de la llamada.
	const input = (part.input ?? {}) as { statement?: string };
	const statement = typeof input.statement === "string" ? input.statement : "";
	return (
		<div data-testid="problem-card" className="lh-card-enter my-1 rounded-xl border bg-card p-4">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
			<div className="lh-prose text-[15px]">
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}

const OUTCOME_LABEL: Record<string, string> = {
	solved: "Solved",
	solvedWithHints: "Solved with hints",
	movedOn: "Moved on",
	surrendered: "Surrendered",
	dismissed: "Dismissed",
};

/* Los chips de resultado (ronda 3 del responsable, 2026-10-05): el registro
 * EXACTO de las burbujas de correcto/incorrecto de las tarjetas del quiz.
 * Colores por resultado — resuelto en verde (el gemelo de "correcto"),
 * resuelto con pistas en ámbar (éxito con coste), rendido en rojo (el
 * problema pudo con el alumno), pasado a otro atenuado (decisión del agente,
 * no un veredicto en su contra). */
const OUTCOME_COLOR: Record<string, string | undefined> = {
	solved: "var(--lh-success)",
	solvedWithHints: "var(--lh-warning)",
	surrendered: "var(--lh-error)",
};

export function ConcludeCard({ part }: ArtifactPartProps) {
	// La conclusión rediseñada (ronda del responsable, 2026-10-05): la SOLUCIÓN es
	// la protagonista — la modelSolution comprometida al plantear (part.reveal, el
	// join de la frontera de la vista), mostrada al pie de la letra, nunca reescrita.
	// El veredicto va debajo en el registro de explicación del quiz (pequeño, atenuado, discreto).
	// Nada plegable. Las entradas heredadas (registros anteriores al adelgazamiento) que
	// llevan su propio solutionReveal recurren a él.
	const input = (part.input ?? {}) as { outcome?: string; verdict?: string; solutionReveal?: string };
	const outcome = typeof input.outcome === "string" ? input.outcome : "";
	const verdict = typeof input.verdict === "string" ? input.verdict : "";
	const reveal =
		typeof part.reveal === "string" ? part.reveal : typeof input.solutionReveal === "string" ? input.solutionReveal : "";

	// La síntesis de descarte: sin veredicto, sin revelación — una línea atenuada (el
	// alumno hizo clic; el registro solo necesita el hecho).
	if (outcome === "dismissed") {
		return (
			<div data-testid="conclude-card" className="my-1 px-1 text-sm text-muted-foreground/70">
				Problem dismissed.
			</div>
		);
	}

	return (
		<div data-testid="conclude-card" className="lh-card-enter relative my-1 rounded-xl border bg-card p-4">
			{/* La fila de cabecera (ronda 3 del responsable, 2026-10-05): antetítulo
			'Concluded' sencillo + el resultado en el registro EXACTO de chip de las
			tarjetas del quiz — se acabaron dos encabezados del mismo peso apilados. */}
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Concluded
				{(OUTCOME_LABEL[outcome] ?? "") !== "" && outcome !== "dismissed" && (
					<StatusBadge text={OUTCOME_LABEL[outcome] ?? ""} color={OUTCOME_COLOR[outcome]} />
				)}
			</div>
			{/* El veredicto — prosa sencilla bajo la cabecera, sin etiqueta 'Verdict:'
			(ronda 3 del responsable): el mismo registro tranquilo al 50% que las explicaciones del quiz. */}
			{verdict.length > 0 && (
				<div className="text-sm text-foreground/50">
					<ToolContentResponse>{verdict}</ToolContentResponse>
				</div>
			)}
			{/* Luego el divisor y luego la solución modelo etiquetada (Slice G: la
			protagonista es el compromiso del planteamiento, al pie de la letra). */}
			{reveal.length > 0 && (
				<>
					<div className="my-3 border-t" />
					<div>
						<div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Model solution</div>
						<div className="lh-prose text-[15px]">
							<ToolContentResponse>{reveal}</ToolContentResponse>
						</div>
					</div>
				</>
			)}
			<MetadataPopover
				concludeInput={input}
				problemInput={(part.problemInput ?? {}) as { mode?: unknown; target?: unknown }}
			/>
		</div>
	);
}

/* EL POPOVER DE METADATOS (refinamiento de la ronda 17 del responsable,
 * 2026-10-06 — transparencia total): un disparador METADATA discreto al
 * final de la tarjeta de conclusión (sin divisor — simplemente está ahí);
 * el clic abre el registro de recuadro informativo de las tarjetas de nodo
 * de la vista del grafo (rounded-xl border bg-card p-4 shadow-lg, abriéndose
 * DEBAJO del disparador — siempre); cualquier scroll o clic fuera lo cierra
 * (además de Esc, reclamado de la cadena por capas según la ley de los
 * popovers). Muestra todos los campos que el agente rellenó tanto en la
 * llamada del problema (modo, objetivos — nombres resueltos de forma
 * perezosa) como en la de conclusión (resultado, peldaño, clase de fallo,
 * reevaluación). El enunciado y la modelSolution quedan fuera — son la
 * tarjeta visible. Los datos conservan el registro PEQUEÑO original (filas
 * text-xs, valores monoespaciados — corrección del responsable: la pasada a
 * 15px era demasiado grande); el disparador iguala el tamaño del antetítulo;
 * la caja se abre DEBAJO del disparador, siempre. */
function MetadataPopover({
	concludeInput,
	problemInput,
}: {
	concludeInput: { outcome?: string; rung?: unknown; missClass?: unknown; retest?: unknown };
	problemInput: { mode?: unknown; target?: unknown };
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const interactions = useInteractionLayers();
	// El ancla del portal (arreglo del responsable, 2026-10-06): la caja se coloca a
	// partir del rect del disparador en el viewport EN EL MOMENTO DE ABRIR — cualquier
	// scroll cierra la caja, así que no hay nada que seguir.
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
	const [names, setNames] = useState<Record<string, string> | null>(null);
	const targets = Array.isArray(problemInput.target)
		? problemInput.target.filter((t): t is string => typeof t === "string")
		: [];
	// Resuelve nombres solo cuando hay algo que resolver.
	useEffect(() => {
		if (!open || targets.length === 0 || names) return;
		let alive = true;
		void nodeNameMap().then((m) => {
			if (alive) setNames(m);
		});
		return () => {
			alive = false;
		};
	}, [open, targets.length, names]);

	const popupLayer = usePopoverDismiss(rootRef, open, () => setOpen(false), { layerRootRef: panelRef });
	// CUALQUIER scroll lo cierra (ley del responsable): en fase de captura, para que cuente
	// todo elemento con scroll del árbol — incluido el propio scroll de la transcripción.
	useEffect(() => {
		if (!open) return;
		const close = () => { if (interactions.isElementEligible(panelRef.current)) setOpen(false); };
		window.addEventListener("scroll", close, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", close, { capture: true });
	}, [open, interactions]);

	const mode = typeof problemInput.mode === "string" ? problemInput.mode : "";
	const rung = typeof concludeInput.rung === "string" ? concludeInput.rung : "";
	const miss = typeof concludeInput.missClass === "string" ? concludeInput.missClass : "";
	const retest = typeof concludeInput.retest === "boolean" ? concludeInput.retest : undefined;
	const outcome = typeof concludeInput.outcome === "string" ? concludeInput.outcome : "";
	if (!mode && targets.length === 0 && !rung && !miss && retest === undefined) return null;

	return (
		<div ref={rootRef} className="relative mt-3">
			<button
				type="button"
				data-testid="metadata-toggle"
				ref={triggerRef}
				onClick={() => {
					setOpen((v) => {
						if (v) return false;
						const r = triggerRef.current?.getBoundingClientRect();
						if (r) {
							// Debajo del disparador, siempre; acotada para que la caja de 320px
							// nunca salga por el borde derecho del viewport.
							const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
							setAnchor({ top: r.bottom + 8, left });
						}
						return true;
					});
				}}
				aria-expanded={open}
				className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
			>
				Metadata
			</button>
			{open &&
				anchor &&
				createPortal(
					<div
						ref={panelRef}
						data-testid="metadata-box"
						// EN PORTAL AL BODY (arreglo del responsable, 2026-10-06): las cajas
						// MessageContent de la transcripción llevan overflow-hidden — un hijo con
						// posición absoluta se recorta en el borde de su propio bloque de mensaje (el
						// fallo del corte). Un portal en posición fija queda encima de
						// TODO, la ley de los diálogos. Registro de recuadro informativo de las tarjetas de nodo;
						// se abre DEBAJO del disparador — siempre.
						style={{ position: "fixed", top: anchor.top, left: anchor.left, zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }}
						className="w-80 max-w-[calc(100vw-1rem)] rounded-xl border bg-card p-4 text-left shadow-lg"
					>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						<dt className="text-muted-foreground">Mode</dt>
						<dd className="font-mono">{mode || "—"}</dd>
						<dt className="text-muted-foreground">Targets</dt>
						<dd className="font-mono">
							{targets.length === 0 ? (
								"untagged"
							) : (
								<span>
									{targets.map((t, i) => (
										<span key={t}>
											{i > 0 && ", "}
											{names?.[t] ?? t}
										</span>
									))}
								</span>
							)}
						</dd>
						<dt className="text-muted-foreground">Outcome</dt>
						<dd className="font-mono">{outcome || "—"}</dd>
						<dt className="text-muted-foreground">Hint rung</dt>
						<dd className="font-mono">{rung || "none"}</dd>
						<dt className="text-muted-foreground">Miss class</dt>
						<dd className="font-mono">{miss || "none"}</dd>
						<dt className="text-muted-foreground">Retest</dt>
						<dd className="font-mono">{retest === undefined ? "—" : retest ? "yes" : "no"}</dd>
					</dl>
					</div>,
					interactions.getPortalContainer(triggerRef.current)!,
				)}
		</div>
	);
}

export function ThinkingCard({ data }: { data: PracticeThinkingData }) {
	// La fila unificada (rondas del responsable, 2026-10-05): un estilo, una etiqueta —
	// bloque de cita en cursiva al 50% al desplegar. El indicador commit de los registros
	// heredados no se lee a propósito (ahora hay un solo carril). Una fila de TRANSCRIPCIÓN
	// (ronda del responsable, 2026-10-07): franja a todo el ancho + raíl, llegando desplegada.
	return <ThinkingBlock testId="thinking-card" label="YOUR THINKING" text={data.text} images={data.images} defaultOpen />;
}
