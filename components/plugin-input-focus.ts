"use client";

import { isInteractionElementVisible, type InteractionLayersController } from "./interaction-layers";

const FOREGROUND_ROOTS = '[data-lh-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [data-testid="cheat-sheet"], [data-testid="chain-table-overlay"], [data-testid="mermaid-overlay"], [data-testid="plan-popup"]';

/** Los fixtures independientes heredados no tienen proveedor. Nunca crees un segundo store. */
export function hasLegacyInteractionForeground(doc: Document, scope?: HTMLElement | null): boolean {
	return Array.from(doc.querySelectorAll<HTMLElement>(FOREGROUND_ROOTS)).some(element => {
		if (element.contains(scope ?? null) || element.getAttribute("data-state") === "closed") return false;
		if (!isInteractionElementVisible(element)) return false;
		const style = doc.defaultView?.getComputedStyle?.(element) ?? element.style;
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	});
}

/** Ámbito de comandos estricto: los campos tapados/ocultos nunca reciben Find, Enter ni Tab. */
export function isInteractionScopeEligible(scope: HTMLElement | null, controller?: InteractionLayersController | null): boolean {
	if (!isInteractionElementVisible(scope)) return false;
	if (!controller) return !hasLegacyInteractionForeground(scope.ownerDocument, scope);
	if (!controller.isElementEligible(scope)) return false;
	const foreground = controller.getTopLayer();
	// Las vistas de contenido conservan el acceso del puntero a la barra lateral, pero son dueñas de las teclas del área de contenido.
	if (foreground?.kind === "view") {
		const owner = controller.ownerOf(scope);
		if (!owner || !controller.belongsTo(owner.id, foreground.id)) return false;
	}
	return true;
}

/** SOLO los comandos de modelo/thinking pueden dirigirse al origen de su propia ventana emergente. */
export function isInputShortcutScopeEligible(scope: HTMLElement | null, controller?: InteractionLayersController | null): boolean {
	return isInteractionScopeEligible(scope, controller) || !!controller?.isPopupOrigin(scope);
}

/** Solo el control de plugin que tiene el foco en ese momento puede reclamar estos atajos.
 * Montar un widget sin más nunca cambia la alternativa del núcleo. */
export type PluginInputShortcut = "toggle-dictation" | "open-model-picker" | "cycle-thinking";
export type PluginInputFocusHandlers = {
	toggleDictation?: () => void;
	cycleModel?: () => void;
	cycleThinking?: () => void;
};

const claims = new Map<HTMLElement, PluginInputFocusHandlers>();

export function claimPluginInputFocus(root: HTMLElement, handlers: PluginInputFocusHandlers): () => void {
	claims.set(root, handlers);
	return () => {
		if (claims.get(root) === handlers) claims.delete(root);
	};
}

export function dispatchFocusedPluginShortcut(action: string, controller?: InteractionLayersController | null): boolean {
	const keys: Partial<Record<string, keyof PluginInputFocusHandlers>> = {
		"toggle-dictation": "toggleDictation",
		"open-model-picker": "cycleModel",
		"cycle-thinking": "cycleThinking",
	};
	const key = Object.hasOwn(keys, action) ? keys[action] : undefined;
	if (!key || typeof document === "undefined") return false;
	const focused = document.activeElement;
	if (!focused) return false;
	const popupOriginAction = action === "open-model-picker" || action === "cycle-thinking";
	const eligible = (root: HTMLElement) => popupOriginAction
		? isInputShortcutScopeEligible(root, controller)
		: isInteractionScopeEligible(root, controller);
	// Recorre hacia fuera para que un control independiente anidado en un predefinido sea
	// dueño de su propia acción coincidente, mientras el predefinido aporta las demás acciones.
	for (let node: Element | null = focused; node; node = node.parentElement) {
		const root = node as HTMLElement;
		const handler = claims.get(root)?.[key];
		if (handler && eligible(root)) {
			handler();
			return true;
		}
	}
	// El foco de una ventana emergente en portal está fuera del DOM del widget. Resuelve solo
	// el perfil de su propio origen, nunca un control montado del núcleo/en segundo plano.
	if (popupOriginAction && controller) {
		const origins = [...claims.keys()].filter(root => controller.isPopupOrigin(root));
		origins.sort((a, b) => a.contains(b) ? 1 : b.contains(a) ? -1 : 0);
		for (const root of origins) {
			const handler = claims.get(root)?.[key];
			if (handler) { handler(); return true; }
		}
	}
	return false;
}
