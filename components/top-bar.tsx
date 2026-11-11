"use client";

/**
 * LA BARRA SUPERIOR (decisión de estandarización del responsable,
 * 2026-09-29): un elemento, todas las superficies — siempre la misma
 * mecánica. Nació del incidente del overlay de cadenas: su barra hecha a
 * mano rompía todas las reglas a la vez (altura incorrecta, tamaño de
 * título incorrecto, no-drag en toda la barra, así que los arrastres de la
 * ventana caían en la selección de texto, sin reabrir la barra lateral,
 * semáforos encima del contenido). La ley: siempre que una superficie tenga
 * barra superior, renderiza ESTE componente — nunca una cabecera a medida.
 *
 * Mecánica incorporada (el patrón probado de la barra de la sesión del chat):
 * - h-15 (60px) — igual que la franja de la marca de la barra lateral, una
 *   línea de borde.
 * - lh-drag — la franja de arrastre de la ventana. Los hijos interactivos
 *   NATIVOS (button/input/a/…) se recortan AUTOMÁTICAMENTE con la regla de
 *   recorte automático de globals.css (decisión de estandarización del
 *   responsable, noche del 2026-09-29) — "arrastrable en cualquier sitio que
 *   no sea un elemento pulsable" es estructural, no disciplina hijo a hijo;
 *   el lh-no-drag manual es solo para elementos pulsables no nativos
 *   (spans/divs con onClick).
 * - select-none — arrastrar nunca resalta el título.
 * - SidebarToggle PRIMERO — reabre la barra lateral cuando está cerrada, con
 *   su margen para los semáforos de Electron (lh-closed-toggle). Los
 *   selectores de conocimiento del host omiten la acción y reservan solo el
 *   margen nativo que se solapa.
 * - border-b border-border px-3, ritmo gap-3.
 *
 * Quien lo usa aporta el título (font-title text-3xl tracking-tight) y los
 * controles del lado derecho. LA LEY DEL TÍTULO (ronda 11 del responsable,
 * 2026-10-05): el título con serifa nombra una sesión o una vista de plugin
 * registrada (decisión sobre la interfaz de plugins, 2026-11-01); las
 * superficies de creación sin cromo (inicio, ambos borradores de /chat/new)
 * y la tabla de cadenas NO renderizan título. `drag={false}` es la única vía
 * de escape — el modo de renombrado del chat (app-region:drag se comería el
 * mousedown que sale del input; petición del responsable).
 *
 * EL GEMELO PARA OVERLAYS DE LA LEY DE LA MÁSCARA (responsable, noche del
 * 2026-09-29): la resta de app-region se resuelve por orden del DOM, no por
 * z-index — una superficie que contiene una TopBar y TAPA otro contenido (un
 * overlay a sangre) debe ser el ÚLTIMO hijo de su contenedor, o los
 * elementos no-drag posteriores abren zonas muertas en la barra (el fallo
 * del overlay de cadenas: la columna no-drag del cromo del grafo anulaba el
 * arrastre sobre la zona de recuentos/búsqueda/cerrar).
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { SidebarToggle } from "@/components/sidebar";

export function TopBar({
	drag = true,
	onMouseDown,
	children,
	sidebarToggle = true,
}: {
	drag?: boolean;
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	children?: ReactNode;
	/** Cromo del selector del host: margen nativo sin cambiar el estado de la barra lateral. */
	sidebarToggle?: boolean;
}) {
	const header = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		if (sidebarToggle || !header.current) return;
		const element = header.current;
		let previous: number | undefined;
		const measure = () => {
			const left = element.getBoundingClientRect().left;
			if (left === previous) return;
			previous = left;
			element.style.setProperty("--lh-header-left", `${left}px`);
		};
		measure();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		observer?.observe(element);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		const offZoom = window.lh?.onZoom?.(measure);
		return () => {
			observer?.disconnect(); offZoom?.();
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [sidebarToggle]);
	return (
		<header
			ref={header}
			onMouseDown={onMouseDown}
			className={`${drag ? "lh-drag " : ""}${sidebarToggle ? "" : "lh-native-window-clearance "}lh-wco-gutter flex h-15 select-none items-center gap-3 border-b border-border px-3`}
		>
			{sidebarToggle && <SidebarToggle />}
			{children}
		</header>
	);
}
