/** El disco de inversión (ronda del responsable, 2026-10-07): el círculo
 * medio relleno que ES el disco deslizante del conmutador de inversión.
 * Hecho a mano porque Contrast de lucide deja su media luna sin rellenar
 * (fill="none" por defecto); lo detectó el responsable: el lado relleno debe
 * estar REALMENTE relleno. Misma geometría que la de lucide (círculo r10 +
 * media luna izquierda); la mitad lleva fill="currentColor". */
export function InvertDiscIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 18a6 6 0 0 0 0-12v12z" fill="currentColor" stroke="none" />
		</svg>
	);
}
