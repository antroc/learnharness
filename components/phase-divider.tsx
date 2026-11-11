import type { Phase3 } from "@/src/core";

/**
 * La presentación de fases dentro de la sesión (responsable, ronda de color
 * mínimo — ahora monocromo): el chip de la cabecera junto al título de la
 * sesión, y la regla de límite punteada que dibuja la transcripción donde la
 * sesión pasa a una fase nueva. El COLOR de fase está retirado en toda la app
 * (las fases solo avanzan, así que el color como señal era decoración); el
 * texto de la etiqueta transmite la fase, y la antigua ranura del punto del
 * chip se reutiliza para el spinner braille mientras hay un turno en curso —
 * el movimiento es la señal de estado honesta. Sustituye al antiguo divisor
 * de plan en línea (registro de artefactos): el límite es una frontera a
 * nivel de MENSAJE, así que chat.tsx lo renderiza en el mensaje donde cambia
 * la fase, no dentro de una parte de herramienta.
 *
 * Registro tranquilo (como el antiguo divisor): reglas finas, chips
 * pequeños — nunca un banner. El sondeo nunca renderiza un divisor: las
 * fases solo avanzan, así que el sondeo es el inicio de la transcripción y
 * "Planning"/"Teaching" son las dos fronteras visibles.
 *
 * Responsable, ronda 2 de color mínimo: el chip es SOLO ETIQUETA, a
 * propósito — aquí se probó un spinner de estado de trabajo y se rechazó: la
 * curva de la píldora y la celda cuadrada del braille se peleaban por el
 * espacio, y la superficie del chat ya muestra el trabajo en curso (brillo
 * de thinking, el dock). El chip indica la fase; el estado de trabajo es el
 * spinner de la fila de la barra lateral.
 */

/** Etiquetas del chip de cabecera: las fases tal como las entiende el alumno. */
const CHIP_LABEL: Record<Phase3, string> = {
	probe: "Probing",
	plan: "Planning",
	teach: "Teaching",
};

/** La etiqueta de la cabecera: la fase como una etiqueta plana y tranquila
 *  (responsable, rediseño de la UX de extracción 2026-09-24 — la ronda
 *  QUITA-PÍLDORAS): sin borde, sin cromo de píldora, sin relleno — el chip de
 *  Plan es ahora lo único con forma de botón en la barra superior. Sigue
 *  siendo pura decoración (petición del responsable, 2026-09-17): sin
 *  tooltip, no seleccionable, sin ninguna interacción — sin eventos de
 *  puntero en absoluto, así que forma parte de la superficie de arrastre en
 *  lugar de ser un destino recortado. */
export function PhaseChip({ phase }: { phase: Phase3 }) {
	return (
		<span
			data-testid="phase-chip"
			data-phase={phase}
			aria-hidden="true"
			className="pointer-events-none flex shrink-0 select-none items-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
		>
			{CHIP_LABEL[phase]}
		</span>
	);
}

/**
 * El límite de la transcripción: una regla punteada monocroma en el mensaje
 * donde la sesión entra en `phase` (responsable, ronda de color mínimo — la
 * etiqueta transmite la transición; el color de fase nunca lo hizo). La
 * frontera del plan lleva su recuento de nodos ("Plan · 4 nodes"); la
 * enseñanza es solo la etiqueta. Null para el sondeo (defensivo — el
 * plegado nunca emite una transición de sondeo después del inicio).
 */
export function PhaseDivider({ phase, nodeCount }: { phase: Phase3; nodeCount?: number }) {
	if (phase === "probe") return null;
	const label =
		phase === "plan" && nodeCount
			? `Plan · ${nodeCount} node${nodeCount === 1 ? "" : "s"}`
			: CHIP_LABEL[phase];
	return (
		<div className="my-4 flex w-full items-center gap-3" data-testid={`phase-divider-${phase}`}>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
			<span className="rounded-full border border-border/80 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
		</div>
	);
}

/**
 * El recuento de nodos para una frontera de plan: la primera salida de árbol
 * plan-op del mensaje que lleva la frontera (el plan_init que hizo cambiar la
 * fase). Corte estructural de un mensaje de interfaz, con la misma forma de
 * formas que core/phases.ts.
 */
export function planNodeCount(
	message: { parts: ReadonlyArray<{ type: string; state?: string; output?: unknown; [k: string]: unknown }> },
): number | undefined {
	for (const part of message.parts) {
		if (!part.type.startsWith("tool-plan_") || part.state !== "output-available") continue;
		const tree = (part.output as { tree?: { nodes?: unknown[] } } | undefined)?.tree;
		if (tree && Array.isArray(tree.nodes) && tree.nodes.length > 0) return tree.nodes.length;
	}
	return undefined;
}
