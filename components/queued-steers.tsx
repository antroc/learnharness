/**
 * EL INDICADOR DE REORIENTACIONES EN COLA (especificación del responsable
 * 2026-10-03): las reorientaciones enviadas pero aún no vaciadas se
 * renderizan como líneas únicas discretas ENCIMA del armazón del composer —
 * alineadas a la derecha hasta donde empieza el redondeo de la esquina del
 * armazón, truncadas con puntos suspensivos, sin fondo, sin contenedor, más o
 * menos a media opacidad. Visibles pero muy discretas; el layout se ajustará
 * más adelante.
 *
 * Una línea muere en el instante en que su tarjeta llega a la transcripción:
 * los eventos de mensaje literales del vaciado insertan o actualizan la
 * tarjeta real del usuario por el id generado en el cliente, y
 * visibleQueuedSteers (session-core, pura) filtra la cola contra los ids de
 * los mensajes. Una reorientación aparcada en el servidor (varada tras una
 * pregunta) conserva su línea — un honesto "esperando a la siguiente
 * ejecución".
 */
export interface QueuedSteerLine {
	id: string;
	text: string;
}

/** El cuerpo puro (fijable en SSR): una línea truncada alineada a la derecha
 *  por cada reorientación en cola, apiladas. */
export function QueuedSteersBody({ steers }: { steers: QueuedSteerLine[] }) {
	if (steers.length === 0) return null;
	return (
		<div className="flex flex-col items-end gap-0.5 pb-1 pr-4" data-testid="queued-steers">
			{steers.map((s) => (
				<span
					key={s.id}
					title={s.text}
					className="block max-w-[240px] truncate font-ui text-[11px] text-muted-foreground/60"
				>
					{s.text}
				</span>
			))}
		</div>
	);
}
