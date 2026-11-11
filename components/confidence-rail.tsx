import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { CONFIDENCE_STOPS } from "@/src/core";

/**
 * El RAÍL de confianza — el pintado del deslizador, compartido por dos
 * superficies para que nunca puedan divergir (responsable, 2026-10-01):
 *
 *   - el deslizador vivo del dock (question-dock) — un input range transparente
 *     va encima de este pintado, con disco y todo;
 *   - la tarjeta RESPONDIDA (ronda 6 del responsable) — el mismo raíl SIN disco,
 *     lo que por sí mismo comunica «esto es un registro, no un control».
 *
 * Ley de geometría: el raíl abarca el rango del CENTRO del tirador (metido medio
 * disco de 16px por cada lado), para que las posiciones 0/100 del dock queden
 * justo en los extremos. La tarjeta estática no tiene tirador, pero conserva la
 * forma idéntica.
 *
 * Ley de apilado: el fondo de la página como base, las marcas de las posiciones
 * SÓLIDAS como capas de fondo DEBAJO del relleno, y el propio relleno
 * TRANSPARENTE más allá del valor — así las marcas se ven solo en el lado vacío,
 * nunca encima del color. Las marcas se saltan 0 y 100 (los extremos del raíl ya
 * los indican).
 */

/** La rampa de seis pasos (decisión del responsable): 0 rojo → 100 esmeralda, indexada por posición. */
export const CONFIDENCE_COLORS: readonly string[] = [
	"#ef4444", // 0
	"#f97316", // 30
	"#eab308", // 50
	"#84cc16", // 70
	"#22c55e", // 90
	"#10b981", // 100
];

/** Las marcas de las posiciones: la tinta de primer plano al 35 % (el antiguo
 *  rgba(230,230,230,.35) fijo era el valor del primer plano oscuro). */
const RAIL_TICK = "color-mix(in oklab, var(--foreground) 35%, transparent)";

/** El pintado del raíl para un valor de posición (0–100). */
export function confidenceRailStyle(value: number): CSSProperties {
	const color = CONFIDENCE_COLORS[CONFIDENCE_STOPS.indexOf(value)] ?? CONFIDENCE_COLORS[2]!;
	return {
		backgroundColor: "var(--background)",
		backgroundImage: [
			`linear-gradient(90deg, ${color} 0%, ${color} ${value}%, transparent ${value}%, transparent 100%)`,
			...[30, 50, 70, 90].map(() => `linear-gradient(90deg, ${RAIL_TICK}, ${RAIL_TICK})`),
		].join(", "),
		backgroundSize: ["100% 100%", "1px 100%", "1px 100%", "1px 100%", "1px 100%"].join(", "),
		backgroundPosition: ["0 0", ...[30, 50, 70, 90].map((p) => `${p}% 0`)].join(", "),
		backgroundRepeat: "no-repeat",
	};
}

/** El raíl estático — el aspecto del deslizador, sin el disco. */
export function ConfidenceRail({ value, className }: { value: number; className?: string }) {
	return (
		<div
			aria-hidden
			data-testid="confidence-rail"
			className={cn("h-1.5 w-full rounded-full border border-border", className)}
			style={confidenceRailStyle(value)}
		/>
	);
}
