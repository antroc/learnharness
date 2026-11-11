"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface DockHeightMeasurements {
	columnHeight: number;
	/** Relleno de la barra de estadísticas/herramientas y del bloque, fuera del viewport con scroll. */
	outsideHeight: number;
	/** Todo lo que hay en el viewport salvo el contenedor animado. */
	beforeShellHeight: number;
	shellBorderHeight: number;
	/** Altura natural del contenido, no la altura animada/limitada del contenedor. */
	contentHeight: number;
	/** Null cuando está plegado, en modo chat o mostrando una entrada mal formada. */
	questionHeight: number | null;
	questionPaddingHeight: number;
}

export function dockHeightBudget(m: DockHeightMeasurements) {
	const available = Math.max(m.columnHeight - 32, 0);
	const viewportMaxHeight = Math.max(available - m.outsideHeight, 0);
	const shellMaxHeight = Math.max(viewportMaxHeight - m.beforeShellHeight, 0);
	const naturalHeight = m.beforeShellHeight + m.shellBorderHeight + m.contentHeight;
	const questionMaxHeight = m.questionHeight === null
		? null
		: Math.max(viewportMaxHeight - (naturalHeight - m.questionHeight), 0);
	// Un límite menor que el relleno de la pregunta no deja viewport para el contenido.
	// Se quita a propósito el límite de la pregunta y se desplaza todo el contenido;
	// no confundas un cero medido con un valor CSS de reserva sin medir.
	const scrollWholeContent = questionMaxHeight === null
		? naturalHeight > viewportMaxHeight
		: questionMaxHeight <= m.questionPaddingHeight;
	return { viewportMaxHeight, shellMaxHeight, questionMaxHeight, scrollWholeContent };
}

interface DockHeightElements {
	column: HTMLElement;
	block: HTMLElement;
	viewport: HTMLElement;
	body: HTMLElement;
	shell: HTMLElement;
	content: HTMLElement;
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

/** Lee la geometría natural antes de escribir ninguna restricción. Anula la altura
 * animada del contenedor en ambas medidas del ancestro y sustitúyela por su
 * contenido y bordes naturales. Sigue siendo válido durante una transformación de
 * altura con WAAPI y cuando el viewport exterior ya está limitado. */
export function syncDockHeight(elements: DockHeightElements, expanded: boolean) {
	const { column, block, viewport, body, shell, content } = elements;
	// QuestionDock mantiene un formulario maquetado dentro de un envoltorio invisible h-0;
	// PracticeDock elimina su formulario. Ningún formulario oculto cuenta para la altura.
	const question = expanded ? content.querySelector<HTMLElement>("[data-dock-scroll-area]") : null;
	const height = (el: HTMLElement) => el.getBoundingClientRect().height;
	const shellStyle = getComputedStyle(shell);
	const questionStyle = question ? getComputedStyle(question) : null;
	const budget = dockHeightBudget({
		columnHeight: column.clientHeight,
		outsideHeight: Math.max(height(block) - height(viewport), 0),
		beforeShellHeight: Math.max(height(body) - height(shell), 0),
		shellBorderHeight: pixels(shellStyle.borderTopWidth) + pixels(shellStyle.borderBottomWidth),
		contentHeight: height(content),
		questionHeight: question ? height(question) : null,
		questionPaddingHeight: questionStyle
			? pixels(questionStyle.paddingTop) + pixels(questionStyle.paddingBottom)
			: 0,
	});
	if (budget.questionMaxHeight === null) block.style.removeProperty("--dock-max-h");
	else block.style.setProperty("--dock-max-h", budget.scrollWholeContent ? "none" : `${budget.questionMaxHeight}px`);
	viewport.style.maxHeight = `${budget.viewportMaxHeight}px`;
	// El desbordamiento es visible en las maquetaciones normales: conserva intacta la sombra del contenedor.
	// La barra de estadísticas/modelo es un hermano, nunca está dentro de esta caja de desbordamiento.
	viewport.style.overflowY = budget.scrollWholeContent ? "auto" : "visible";
	// Limita también las alturas iniciales animadas, para que una variante alta anterior no
	// se pinte por encima de la columna mientras se transforma en una maquetación restringida.
	shell.style.maxHeight = budget.scrollWholeContent ? "none" : `${budget.shellMaxHeight}px`;
	return budget;
}

interface DockHeightRefs {
	scrollRef: RefObject<HTMLElement | null>;
	blockRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
	bodyRef: RefObject<HTMLDivElement | null>;
	shellRef: RefObject<HTMLDivElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
}

export function useDockHeight({
	scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef,
	expanded, enabled, mode, onScrollbarInset, onHeight, onLayout,
}: DockHeightRefs & {
	expanded: boolean;
	enabled: boolean;
	/** Vuelve a conectar los observadores cuando cambia el nodo de contenido/área de scroll con clave. */
	mode: string;
	onScrollbarInset: (inset: number) => void;
	/** Altura visible estable del bloque, pasada por la política de reserva existente. */
	onHeight: (height: number) => void;
	/** Las restricciones se aplican antes de notificar a una transformación de apertura activa. */
	onLayout?: () => void;
}) {
	const measure = useCallback(() => {
		const column = scrollRef.current;
		const block = blockRef.current;
		const viewport = viewportRef.current;
		const body = bodyRef.current;
		const shell = shellRef.current;
		const content = contentRef.current;
		if (!column || !block || !viewport || !body || !shell || !content) return;
		onScrollbarInset(Math.round((column.offsetWidth - column.clientWidth) / 2));
		if (enabled) syncDockHeight({ column, block, viewport, body, shell, content }, expanded);
		else {
			block.style.removeProperty("--dock-max-h");
			viewport.style.removeProperty("max-height");
			viewport.style.removeProperty("overflow-y");
			shell.style.removeProperty("max-height");
		}
		onLayout?.();
		// ResizeObserver se ejecuta incluso cuando solo ha cambiado un campo hijo y React
		// no ha vuelto a renderizar DockOverlay. Mantén actualizada su reserva del transcript,
		// pero no informes nunca de una altura a mitad de transformación.
		if (shell.getAnimations().length === 0) onHeight(block.getBoundingClientRect().height);
	}, [scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef, expanded, enabled, onScrollbarInset, onHeight, onLayout]);

	// Las restricciones imperativas se aplican antes de que el layout effect posterior del overlay
	// mida su objetivo/reserva de transformación, y antes del pintado (incluida la revelación).
	useIsoLayoutEffect(measure);
	useIsoLayoutEffect(() => {
		// Ignora las entregas ya encoladas tras sustituir la variante o limpiar Activity:
		// los observadores antiguos nunca deben redirigir una animación de altura más reciente.
		let active = true;
		const observedMeasure = () => { if (active) measure(); };
		const observer = new ResizeObserver(observedMeasure);
		for (const el of [scrollRef.current, blockRef.current, viewportRef.current, bodyRef.current, contentRef.current]) {
			if (el) observer.observe(el);
		}
		const question = expanded ? contentRef.current?.querySelector("[data-dock-scroll-area]") : null;
		if (question) observer.observe(question);
		window.addEventListener("resize", observedMeasure);
		return () => {
			active = false;
			observer.disconnect();
			window.removeEventListener("resize", observedMeasure);
		};
	}, [measure, mode, expanded, scrollRef, blockRef, viewportRef, bodyRef, contentRef]);
}

/** El overlay y el transcript son hermanos. Mantén el scroll nativo en un contenedor
 * con scroll real (incluido el viewport de ventana corta) y reenvía solo al llegar
 * a su borde. Las cajas overflow:hidden/visible no pueden consumir la rueda. */
export function forwardDockWheel(event: WheelEvent, root: HTMLElement, transcript: HTMLElement) {
	if (event.deltaY === 0) return;
	for (let n = event.target as HTMLElement | null; n && n !== root; n = n.parentElement) {
		if (!(n instanceof HTMLElement) || !/^(auto|scroll)$/.test(getComputedStyle(n).overflowY)) continue;
		if (n.scrollHeight - n.clientHeight < 2) continue;
		if (event.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop < n.scrollHeight - n.clientHeight - 0.5) return;
	}
	event.preventDefault();
	transcript.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? transcript.clientHeight : 1);
}
