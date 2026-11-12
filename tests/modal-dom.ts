import type { parseHTML } from "linkedom";

/** API del navegador que usan las primitivas modales de bajo nivel y que no existen en linkedom.
 * El foco es observable sin introducir la navegación con Tab del navegador. */
export function installModalDom(dom: ReturnType<typeof parseHTML>) {
	let active: Element | null = dom.document.body;
	const activeDescriptor = Object.getOwnPropertyDescriptor(dom.document, "activeElement");
	Object.defineProperty(dom.document, "activeElement", { configurable: true, get: () => active });
	const prototype = dom.window.HTMLElement.prototype;
	const originalFocus = prototype.focus, originalSetAttribute = prototype.setAttribute;
	const legacyEvents = ["attachEvent", "detachEvent"].map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)] as const);
	// React se importa antes de que exista este DOM sintético, así que su alternativa
	// antigua de eventos de entrada solo está activa en estas pruebas de Node.
	Object.assign(prototype, { attachEvent() {}, detachEvent() {} });
	prototype.focus = function () {
		// El foco nativo rechaza los destinos inertes/ocultos/deshabilitados. En particular,
		// el listener de foco de un padre cubierto que aún se está limpiando no puede quitarle
		// el foco a su hijo recién montado en el mismo commit.
		if (this.closest("[inert], [hidden]") || this.matches(":disabled")) return;
		active = this;
		this.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
	};
	// Chromium normaliza los nombres de los atributos HTML; si no, linkedom conserva
	// las mayúsculas ariaHidden de React y vuelve inexactas las comprobaciones de visibilidad.
	prototype.setAttribute = function (name: string, value: string) { originalSetAttribute.call(this, name.toLowerCase(), value); };
	const style = (element: HTMLElement) => ({
		display: element.style.display || "block", visibility: element.style.visibility || "visible",
		position: element.style.position || "static", overflow: element.style.overflow || "visible",
		paddingLeft: "0px", paddingRight: "0px", marginLeft: "0px", marginRight: "0px", borderLeftWidth: "0px", borderRightWidth: "0px",
	});
	const globals = {
		Node: dom.window.Node, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
		MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
		NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 }, getComputedStyle: style,
		requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
		cancelAnimationFrame: (id: number) => clearTimeout(id),
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	Object.assign(dom.window, { getComputedStyle: style, innerWidth: 1280, innerHeight: 800 });
	return () => {
		prototype.focus = originalFocus; prototype.setAttribute = originalSetAttribute;
		for (const [key, descriptor] of legacyEvents) {
			if (descriptor) Object.defineProperty(prototype, key, descriptor);
			else Reflect.deleteProperty(prototype, key);
		}
		if (activeDescriptor) Object.defineProperty(dom.document, "activeElement", activeDescriptor);
		else Reflect.deleteProperty(dom.document, "activeElement");
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	};
}
