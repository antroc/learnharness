"use client";

import type { CompactionDetails } from "@/src/core";

/** Lo que lleva un divisor: el contenido completo de cara al modelo del marcador (la
 * cabecera [SESSION HISTORY COMPACTED] + el resumen) y sus detalles. El contenido NO se
 * renderiza a propósito (responsable, pulido de la versión 2026-10-06): el resumen de
 * compactación es fontanería de cara al modelo — quien quiera inspeccionarlo, que lea
 * los registros de su proveedor. Los divisores marcan DÓNDE cayó el corte y de qué
 * tamaño fue; no se abre nada. */
export interface CompactionDividerData {
	content: string;
	details: CompactionDetails;
}

/** El divisor del momento (ronda 14 del responsable): texto pequeño, mínimo y centrado
 * donde está ahora el usuario — el registro del mensaje de reintento (las clases
 * exactas de SystemLine), SIN regla horizontal. La nota discreta de la transcripción
 * de que el historial se acaba de resumir; el divisor de corte de abajo lleva la
 * frontera. Inerte desde el pulido de la versión 2026-10-06 — texto plano, sin
 * interacción. */
export function CompactionMomentDivider({ data: _data }: { data: CompactionDividerData }) {
	return (
		<div className="flex w-full items-center justify-center py-1">
			<span data-testid="compaction-divider" className="px-1.5 text-xs text-muted-foreground/70">
				Context compacted
			</span>
		</div>
	);
}

/** El divisor de corte (ronda 14 del responsable): el divisor MÁS LARGO en el corte
 * real de la compactación — la frontera donde termina el historial literal y empieza
 * la cola reciente conservada. La geometría de phase-divider (reglas punteadas + chip
 * centrado) para que se lea como un límite de la transcripción, no como un mensaje.
 * Inerte desde el pulido de la versión 2026-10-06 — el recuento de tokens se queda;
 * el resumen solo se puede inspeccionar en los registros del proveedor. */
export function CompactionCutDivider({ data }: { data: CompactionDividerData }) {
	const kTok = data.details.tokensBefore > 0 ? ` · ${Math.round(data.details.tokensBefore / 1000)}k tok` : "";
	return (
		<div data-testid="compaction-cut-divider" className="my-4 flex w-full items-center gap-3">
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
			<span className="rounded-full border border-border/80 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				History compacted{kTok}
			</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border/50" aria-hidden />
		</div>
	);
}
