import { cn } from "@/lib/utils";

/**
 * EL SPINNER BRAILLE (responsable, ronda de color mínimo): el único indicador de
 * estado de trabajo, en el propio lenguaje de glifos del terminal. Función pura + CSS
 * — sin temporizador de fotogramas en JS ni re-render de React por fotograma; cada
 * fotograma es un <g> diminuto cuya opacidad anima el compositor, así que cuesta menos
 * que el antiguo punto que respiraba (que animaba la opacidad Y la transformación).
 *
 * Geometría: la clásica secuencia de cli-spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 10 fotogramas, 80 ms
 * cada uno — ciclo de 800 ms) como mapas de bits EXACTOS de puntos en una celda braille
 * de 2×4 (puntos 1-3 = columna izquierda, 4-6 = derecha). Unos keyframes compartidos
 * (.braille-frame de globals.css) mantienen visible cada fotograma durante su 10 %; los
 * fotogramas se escalonan con animation-delay positivos, así que el fotograma 0 va
 * delante desde el primer pintado.
 *
 * Alternativa estática (SSR antes de hidratar, prefers-reduced-motion, impresión): se
 * muestra el fotograma 0 (⠋) — un glifo legible, no un hueco. Aquí el movimiento es
 * honesto: solo existe mientras hay un turno en curso y desaparece en cuanto termina.
 */
const FRAMES: ReadonlyArray<{ dots: ReadonlyArray<readonly [number, number]> }> = [
	{ dots: [[1, 1], [1, 3], [3, 1]] },
	{ dots: [[1, 1], [3, 1], [3, 3]] },
	{ dots: [[1, 1], [3, 1], [3, 3], [3, 5]] },
	{ dots: [[3, 1], [3, 3], [3, 5]] },
	{ dots: [[1, 5], [3, 1], [3, 3], [3, 5]] },
	{ dots: [[1, 5], [3, 3], [3, 5]] },
	{ dots: [[1, 3], [1, 5], [3, 5]] },
	{ dots: [[1, 1], [1, 3], [1, 5], [3, 5]] },
	{ dots: [[1, 1], [1, 3], [1, 5]] },
	{ dots: [[1, 1], [1, 3], [1, 5], [3, 1]] },
];

/** Las constantes de la animación (iguales que .braille-frame de globals.css). */
export const SPINNER_FRAME_MS = 80;
export const SPINNER_FRAMES = FRAMES.length;

export function BrailleSpinner({
	className,
	label = "Working",
}: {
	/** Clases de tamaño y posición; la altura determina la escala (el ancho es la proporción 1:2 de la celda). */
	className?: string;
	/** El nombre accesible del estado que anuncia este spinner. */
	label?: string;
}) {
	return (
		<svg
			viewBox="0 0 4 8"
			data-testid="braille-spinner"
			role="status"
			aria-label={label}
			className={cn("h-3 w-auto shrink-0 text-foreground", className)}
		>
			{FRAMES.map((frame, k) => (
				<g
					key={k}
					className="braille-frame"
					data-frame={k}
					style={{ animationDelay: `${k * SPINNER_FRAME_MS}ms` }}
				>
					{frame.dots.map(([cx, cy]) => (
						<circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={0.8} className="fill-current" />
					))}
				</g>
			))}
		</svg>
	);
}
