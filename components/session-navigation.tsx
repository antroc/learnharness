"use client";

import { useCallback, useEffect, useRef } from "react";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";
import { messageAnchorId, messageIdFromHash } from "@/src/core";

export type SessionScrollContext = Pick<StickToBottomContext, "scrollRef" | "stopScroll">;

/** Desplaza solo los contenedores propios de la sesión (incluidas las áreas altas de
 * pregunta/código), nunca la barra lateral/el cromo. Primero se mueven los contenedores
 * internos y luego la transcripción principal. stopScroll suelta la animación de
 * pegado al fondo ANTES de saltar. */
export function scrollSessionTarget(target: Range | HTMLElement, scope: HTMLElement, context: SessionScrollContext | null): void {
	const node = "startContainer" in target ? target.startContainer : target;
	const main = context?.scrollRef.current;
	if (main?.contains(node)) context!.stopScroll();
	for (let element = node.parentElement; element && scope.contains(element); element = element.parentElement) {
		const view = element.ownerDocument.defaultView;
		const style = typeof view?.getComputedStyle === "function" ? view.getComputedStyle(element) : null;
		if (element !== main && (!style || !/(auto|scroll)/.test(style.overflowY) || element.scrollHeight <= element.clientHeight)) continue;
		const rect = target.getBoundingClientRect();
		const container = element.getBoundingClientRect();
		element.scrollTo({ top: element.scrollTop + rect.top - container.top - 16, behavior: "instant" });
	}
}

/** React es dueño del marcado de los mensajes; este controlador no añade mensajes ni
 * contenido. La llegada en una carga completa es el scroll al hash del propio navegador;
 * este vigilante se encarga de las llegadas SPA (enlaces del grafo) y de los cambios de
 * hash posteriores. La ruta de montaje sondea a intervalos cortos A PROPÓSITO: la ref
 * del elemento con scroll de la transcripción la engancha un HERMANO POSTERIOR
 * (StickToBottom.Content), los órdenes de hidratación varían y un rAF encadenado por
 * fotogramas resultó cancelable a mitad de vuelo en desarrollo (el informe del
 * responsable de que todo enlace acababa abajo, 2026-10-13) — un tic síncrono que
 * reintenta hasta que existen ambos elementos no tiene ventana de cancelación. */
export function SessionMessageNavigation() {
	const context = useStickToBottomContext();
	// ABSORBE LOS CAMBIOS DE IDENTIDAD (el heisenbug del 2026-10-13): use-stick-to-bottom
	// recrea stopScroll (y por tanto este contexto) mientras se asienta su scroll
	// inicial. Leerlo a través de una ref mantiene ESTABLE la identidad de `jump`, así que
	// los efectos de abajo se ejecutan una vez — una limpieza provocada por el cambio de
	// dependencias cancelaba el salto en cola o quitaba el destello a mitad de vuelo, que es
	// justo el informe del responsable de que todo enlace acababa abajo (solo se reproducía
	// SIN logging de depuración que alterase los tiempos).
	const contextRef = useRef(context);
	contextRef.current = context;
	const lastJump = useRef<{ hash: string; target: HTMLElement } | null>(null);
	const flash = useRef<{ target: HTMLElement; timer: number } | null>(null);
	const clearFlash = useCallback(() => {
		if (!flash.current) return;
		window.clearTimeout(flash.current.timer);
		flash.current.target.classList.remove("lh-source-highlight");
		flash.current = null;
	}, []);
	/** Llegada síncrona: suelta el bloqueo de seguir el fondo, desplaza todos los
	 * contenedores de la sesión para que el pasaje quede cerca de arriba y lo hace
	 * destellar. Devuelve true cuando ya se ha saltado (ahora) a este hash. */
	const jump = useCallback((): boolean => {
		const { scrollRef, stopScroll } = contextRef.current;
		const hash = window.location.hash;
		const messageId = messageIdFromHash(hash);
		const main = scrollRef.current;
		const target = messageId ? document.getElementById(messageAnchorId(messageId)) : null;
		if (!main || !target || !main.contains(target)) return false;
		if (lastJump.current?.hash === hash && lastJump.current.target === target) return true;
		stopScroll();
		scrollSessionTarget(target, main, { scrollRef, stopScroll });
		clearFlash();
		target.classList.add("lh-source-highlight");
		flash.current = { target, timer: window.setTimeout(clearFlash, 2_000) };
		lastJump.current = { hash, target };
		return true;
	}, [clearFlash]);

	// Llegada al montar (un enlace del grafo abrió esta sesión, o una carga completa
	// trajo el hash): reintenta a intervalos cortos hasta que existan tanto el elemento
	// con scroll como el ancla, y luego para. El perro guardián de ~4s cubre un ancla que
	// nunca llega (un mensaje borrado) — la sesión simplemente se abre donde se abra.
	useEffect(() => {
		if (!window.location.hash) return;
		let ticks = 0;
		const id = window.setInterval(() => {
			// Sigue vigilando DESPUÉS del primer éxito: la hidratación / la adopción del registro
			// puede SUSTITUIR el nodo al que se acaba de saltar (observado en cargas en frío de
			// desarrollo, 2026-10-13) — jump() vuelve a apuntar al nodo nuevo y lo hace
			// destellar de nuevo, mientras que los tics en estado estable no hacen nada gracias a la
			// guarda lastJump. El perro guardián de ~20s cubre una compilación en frío (se observó
			// un volcado SSR de 6,8s) o una primera carga lenta; un ancla de mensaje borrado
			// se rinde y la sesión se abre tal cual.
			if (++ticks > 300) window.clearInterval(id);
			else jump();
		}, 64);
		return () => window.clearInterval(id);
	}, [jump]);

	useEffect(() => {
		const onHash = () => {
			lastJump.current = null;
			clearFlash();
			jump();
		};
		window.addEventListener("hashchange", onHash);
		window.addEventListener("popstate", onHash);
		// La limpieza quita SOLO LOS LISTENERS: nunca clearFlash/lastJump aquí — una
	// reejecución por cambio de dependencias no debe quitar un destello vivo (ver la nota de arriba).
		return () => {
			window.removeEventListener("hashchange", onHash);
			window.removeEventListener("popstate", onHash);
		};
	}, [jump, clearFlash]);
	return null;
}
