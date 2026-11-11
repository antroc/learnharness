import type { PluginQuestionEditorKey } from "../src/core/index.ts";

// Frontera privada del host, a propósito no un SDK público de teclado/ámbito de campos.
const claimed = new WeakSet<object>();
const composing = new WeakSet<object>();
interface EditorKeyOwner {
	eligible(key: string): boolean;
	contains(target: EventTarget | null): boolean;
	key(key: PluginQuestionEditorKey): "handled" | "pass";
	submit(): void;
	cycle(key: "Tab" | "Escape"): void;
}
let owner: EditorKeyOwner | null = null;
export function ownPluginQuestionKeys(next: EditorKeyOwner): () => void {
	owner = next;
	return () => { if (owner === next) owner = null; };
}
export function pluginQuestionKeySuppressed(event: { nativeEvent?: object } | object): boolean {
	const native = (event as { nativeEvent?: object }).nativeEvent ?? event;
	return claimed.has(native) || composing.has(native);
}
export function composingQuestionKey(event: { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } }): boolean {
	const native = event.nativeEvent ?? event;
	return native.isComposing === true || native.keyCode === 229;
}
/** Se llama después de tomar la instantánea de la responsabilidad de Escape, antes de impedir el Tab nativo. */
export function capturePluginQuestionKey(event: KeyboardEvent): void {
	if (composingQuestionKey(event)) { composing.add(event); return; }
	const current = owner;
	if (!current?.eligible(event.key)) return;
	const claim = () => { claimed.add(event); event.preventDefault(); };
	// El envío reservado del host funciona incluso en un subárbol arbitrario de editor de plugin.
	if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) { claim(); current.submit(); return; }
	if (!current.contains(event.target)) {
		if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { claim(); current.cycle("Tab"); }
		return;
	}
	if (event.metaKey || event.ctrlKey || event.altKey || (event.shiftKey && (event.key === "Tab" || event.key === "Escape"))) return;
	const key = event.key === "Enter" && event.shiftKey ? "Shift+Enter" : event.key;
	if (key !== "Tab" && key !== "Enter" && key !== "Shift+Enter" && key !== "Escape") return;
	if (current.key(key) === "handled") { claim(); return; }
	if (key === "Tab" || key === "Escape") { claim(); current.cycle(key); }
	// Un hook ausente o "pass" delega en los valores por defecto nativos del host: Enter
	// envía, Shift+Enter mantiene la edición nativa sin un segundo envío del host.
	if (key === "Enter") { claim(); current.submit(); }
	if (key === "Shift+Enter") claimed.add(event);
}
