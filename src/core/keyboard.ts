/**
 * Atajos de teclado (oleada de atajos, 2026-09-17) — la única fuente de
 * verdad de todas las acciones de la app que tienen combinación. Este módulo
 * es PURO (sin React, sin acceso a window en el ámbito del módulo salvo en los
 * auxiliares protegidos), así que puede mostrar una chuleta, reconocer
 * eventos y — en el hito de ajustes — gobernar un mapa de teclas editable por
 * el usuario sin tocar ningún componente.
 *
 * Diseño (plan aprobado por el responsable):
 * - Tab está MUERTO: se abandona por completo la navegación del foco con Tab
 *   del navegador. Tab no hace nada; solo Shift+Tab cambia el nivel de
 *   razonamiento.
 * - Esc es un descarte por capas: el popover superior (cada popover hace
 *   stopPropagation de su propio Esc) → parar el dictado → abortar el turno
 *   en curso.
 * - El mapa de teclas persiste las modificaciones en localStorage
 *   (`lh:keymap`, solo las modificaciones) fusionadas sobre DEFAULT_BINDINGS —
 *   la oleada de ajustes añade el editor.
 *
 * Las cadenas de combinación están normalizadas y son multiplataforma:
 *   "mod+d"    — mod = ⌘ en macOS, Ctrl en los demás (ambas se aceptan en vivo)
 *   "shift+tab", "alt+arrowdown", "mod+shift+f", "?", "f2", "escape"
 * El orden es fijo: mod, alt, shift y luego la tecla.
 */

export type KeyAction =
	| "toggle-dictation"
	| "open-model-picker"
	| "cycle-thinking"
	| "toggle-sidebar"
	| "sessions-search"
	| "jump-graph"
	| "new-session"
	| "rename-session"
	| "cheat-sheet"
	| "find"
	| "question-focus"
	| "question-next-row"
	| "question-prev-row"
	| "question-pick-row"
	| "question-submit"
	| "open-settings"
	| "toggle-user-thinking"
	| "toggle-question-thread";

/** Dónde agrupa la chuleta una acción (solo visualización — el despacho es
 *  global; una frontera que no está montada simplemente no hace nada). */
export type KeyScope = "global" | "chat" | "graph";

export interface KeyActionDef {
	id: KeyAction;
	/** Etiqueta de la chuleta. */
	label: string;
	scope: KeyScope;
	binding: string;
	/** Solo visualización (chuleta) — teclas contextuales que posee una
	 *  SUPERFICIE (la máquina de filas del dock de preguntas); nunca se
	 *  despachan desde el registro, así que no pueden filtrarse a páginas
	 *  donde la superficie no está montada. */
	displayOnly?: boolean;
}

export const KEYBOARD_ACTIONS: readonly KeyActionDef[] = [
	{ id: "toggle-dictation", label: "Toggle dictation", scope: "global", binding: "mod+d" },
	{ id: "open-settings", label: "Open settings", scope: "global", binding: "mod+," },
	{ id: "open-model-picker", label: "Model selector", scope: "global", binding: "mod+k" },
	{ id: "cycle-thinking", label: "Cycle thinking level", scope: "global", binding: "shift+tab" },
	{ id: "toggle-sidebar", label: "Toggle sessions sidebar", scope: "global", binding: "mod+b" },
	{ id: "sessions-search", label: "Search sessions", scope: "global", binding: "mod+shift+f" },
	// (El ciclo de sesiones con Alt+↑/↓/↵ se RETIRÓ, responsable 2026-10-10: apenas se
	// usaba y parecía lento. La navegación entre sesiones vive ahora EN la búsqueda — ↑/↓
	// recorren la lista filtrada, Enter abre (la primera coincidencia si no se recorrió
	// nada) — consulta el campo de búsqueda de sidebar.tsx.)
	{ id: "jump-graph", label: "Graph view", scope: "global", binding: "mod+g" },
	{ id: "new-session", label: "New session", scope: "global", binding: "mod+n" },
	{ id: "rename-session", label: "Rename session", scope: "chat", binding: "f2" },
	{ id: "toggle-user-thinking", label: "Toggle all your thinking", scope: "chat", binding: "mod+t" },
	{ id: "toggle-question-thread", label: "Question · ask for a nudge (side thread)", scope: "chat", binding: "mod+j" },
	// Mod+F depende de la superficie: la búsqueda de nodos del grafo y Buscar en el texto
	// de la sesión comparten una acción/combinación. Solo escucha la superficie montada.
	{ id: "find", label: "Find", scope: "global", binding: "mod+f" },
	{ id: "cheat-sheet", label: "Shortcut cheat sheet", scope: "global", binding: "?" },
	// La máquina de filas del dock de preguntas (oleada B) — displayOnly: el dock posee
	// las teclas mientras hay una pregunta desplegada; el registro nunca las despacha,
	// así que las flechas solas quedan libres en todas las demás partes.
	{ id: "question-focus", label: "Question · focus thinking ↔ rows", scope: "chat", binding: "tab", displayOnly: true },
	// (Las entradas del menú de modelos — «recorrer resultados» ↑/↓, «elegir resultado» ↵ —
	// se QUITARON, responsable 2026-10-10: navegación obvia de un menú en el campo, nunca
	// despachadas ni reasignables — no son material de ajustes. La máquina de flechas
	// propia del menú (menu-shell.tsx) no cambia.)
	{ id: "question-next-row", label: "Question · next row", scope: "chat", binding: "arrowdown", displayOnly: true },
	{ id: "question-prev-row", label: "Question · previous row", scope: "chat", binding: "arrowup", displayOnly: true },
	{ id: "question-pick-row", label: "Question · pick row", scope: "chat", binding: "space", displayOnly: true },
	{ id: "question-submit", label: "Question · submit", scope: "chat", binding: "enter", displayOnly: true },
];

export type KeymapAction = KeyAction | `plugin:${string}:${string}`;
export type KeymapOverrides = Partial<Record<KeymapAction, string>>;
export const KEYMAP_CHANGED_EVENT = "lh:keymap-changed";
const STORAGE_KEY = "lh:keymap";

/** Modificaciones en localStorage ({actionId: binding}) — se leen una vez por
 *  instancia del módulo; el editor de ajustes escribirá esta clave. Protegido:
 *  tanto el SSR como un almacén corrupto/ausente recurren a los valores por
 *  defecto. */
export function loadOverrides(): KeymapOverrides {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as KeymapOverrides;
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		/* almacén corrupto = valores por defecto */
	}
	return {};
}

/** Escribe el mapa completo de modificaciones ({actionId: binding}) — la
 *  persistencia de reasignar/restablecer del editor de ajustes. Protegido: en
 *  SSR no hace nada. Un mapa vacío borra el almacén entero (todo por
 *  defecto). */
export function saveOverrides(overrides: KeymapOverrides): void {
	if (typeof window === "undefined") return;
	try {
		if (Object.keys(overrides).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* almacenamiento no disponible = las modificaciones no persisten, los valores por defecto siguen funcionando */
	}
	window.dispatchEvent?.(new window.Event(KEYMAP_CHANGED_EVENT));
}

/** El mapa de teclas vivo: los valores por defecto con las modificaciones del usuario aplicadas. */
export function effectiveKeymap(): Map<string, KeyAction> {
	const overrides = loadOverrides();
	const map = new Map<string, KeyAction>();
	for (const def of KEYBOARD_ACTIONS) {
		if (def.displayOnly) continue; // propias de una superficie, nunca se despachan
		const binding = overrides[def.id] ?? def.binding;
		if (typeof binding === "string" && binding) map.set(binding, def.id);
	}
	return map;
}

/** Qué acción dispara una combinación normalizada, si alguna (teniendo en cuenta las modificaciones). */
export function actionForBinding(binding: string): KeyAction | undefined {
	return effectiveKeymap().get(binding);
}

/** La combinación efectiva (con modificaciones) de una acción — para mostrar. */
export function bindingForAction(id: KeyAction): string {
	const overrides = loadOverrides();
	const def = KEYBOARD_ACTIONS.find((a) => a.id === id);
	if (!def) return "";
	return overrides[id] ?? def.binding;
}

/**
 * Normaliza un KeyboardEvent a una cadena de combinación canónica. Reglas:
 * - mod coincide TANTO con meta (⌘) como con ctrl — Ctrl+K también funciona
 *   en un teclado de Mac.
 * - una tecla imprimible ("?") incorpora su shift: "shift+/?" se reduce a "?".
 * - con mod o alt pulsados, un único carácter no ASCII recurre a su posición
 *   física A–Z/coma (Ctrl+"л" en ruso → mod+k). Los caracteres ASCII siguen
 *   usando `key`, incluidas las distribuciones AZERTY/Dvorak.
 */
export function eventBinding(e: KeyboardEvent): string {
	const mod = e.metaKey || e.ctrlKey;
	// Una tecla imprimible sola incorpora su shift en el carácter ("?" y no "shift+/"),
	// así que se devuelve sola. Con un modificador real de por medio, shift es explícito
	// (⌘⇧F = "mod+shift+f"); las teclas no imprimibles (Tab, flechas) siempre
	// conservan su shift (Shift+Tab = "shift+tab").
	if (e.key.length === 1 && !mod && !e.altKey) return e.key.toLowerCase();
	const mods: string[] = [];
	if (mod) mods.push("mod");
	if (e.altKey) mods.push("alt");
	if (e.shiftKey) mods.push("shift");
	return [...mods, modifiedKey(e)].join("+");
}

/** La parte de tecla de una combinación con modificadores. Una `key` no ASCII
 *  (la letra propia de la distribución) recurre a `code` — KeyK → "k",
 *  Comma → "," — las únicas teclas que el registro asigna por carácter. */
function modifiedKey(e: KeyboardEvent): string {
	const key = e.key.toLowerCase();
	// Se inspecciona el carácter informado: pasarlo a minúsculas puede expandirlo (İ → i̇).
	if (e.key.length !== 1 || e.key <= "\x7f" || !(e.metaKey || e.ctrlKey || e.altKey)) return key;
	if (e.code === "Comma") return ",";
	const letter = /^Key([A-Z])$/.exec(e.code);
	return letter?.[1] ? letter[1].toLowerCase() : key;
}

/** El nombre del evento de window con el que una acción del registro se
 *  despacha/responde — la ÚNICA grafía que comparten el despachador
 *  (keyboard-shortcuts) y cada listener de superficie. Nació del fallo de ⌘B
 *  (interludio del responsable, 2026-09-25): la barra lateral escuchaba el
 *  nombre anterior a la convención "lh:toggle-sidebar" mientras el
 *  despachador enviaba "lh:kbd-toggle-sidebar", así que ⌘B no hacía nada en
 *  silencio. Con ambos lados componiendo a través de este auxiliar, el
 *  desajuste es estructuralmente imposible.
 */
export function kbdEventForAction(action: KeyAction): string {
	return `lh:kbd-${action}`;
}

/** True cuando el evento cae en una superficie de escritura (input, textarea
 *  o un contentEditable). Dentro de una, solo pueden dispararse combinaciones
 *  con mod/alt (y Tab, que no escribe nada) — las teclas solas pertenecen al
 *  campo (escritura, cursor). */
export function isTypingSurface(e: KeyboardEvent): boolean {
	const target = e.target as HTMLElement | null;
	if (!target) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return target.isContentEditable;
}

/** Estilo de macOS para mostrar combinaciones ("⌘D", "⇧⇥", "⌥↑"). */
export const IS_MAC =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

const MOD_GLYPH = IS_MAC ? "⌘" : "Ctrl+";
const ALT_GLYPH = IS_MAC ? "⌥" : "Alt+";
const SHIFT_GLYPH = IS_MAC ? "⇧" : "Shift+";

const KEY_GLYPH: Record<string, string> = {
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
	enter: "↵",
	tab: "⇥",
	escape: "Esc",
	space: "Space",
	" ": "Space",
};

/** Formatea una combinación para mostrarla: "mod+shift+f" → "⌘⇧F". */
export function formatBinding(binding: string): string {
	const parts = binding.split("+");
	const key = parts.pop()!; // la última parte siempre es la tecla
	const glyphs: string[] = [];
	for (const part of parts) {
		if (part === "mod") glyphs.push(MOD_GLYPH);
		else if (part === "alt") glyphs.push(ALT_GLYPH);
		else if (part === "shift") glyphs.push(SHIFT_GLYPH);
	}
	const keyGlyph = KEY_GLYPH[key] ?? key.toUpperCase();
	return glyphs.join("") + keyGlyph;
}
