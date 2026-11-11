"use client";

/**
 * Atajos de teclado — alternativa en el burbujeo de window y despacho del
 * registro. Las capas de interacción compartidas son responsables de las
 * instantáneas tempranas de eventos y del cierre:
 *
 * - Tab está MUERTO: la navegación del foco con Tab del navegador se abandona
 *   por decisión del responsable (2026-09-17). La captura del proveedor evita
 *   los comportamientos nativos sin detener los manejadores de las hojas. Los
 *   recorridos explícitos de campos/filas y de razonamiento siguen con su ámbito.
 * - Escape solo llega a la cancelación del dictado / el aborto del turno si
 *   ninguna capa original ni ningún editor hoja lo reclamó. Cerrar una capa
 *   nunca expone esta alternativa a la misma tecla física.
 * - Las acciones globales despachan eventos de window lh:kbd-<acción>; las
 *   superficies montadas escuchan (el patrón de lh:chat-renamed). Una
 *   superficie que no está montada simplemente no escucha — un F2 en la vista
 *   de grafo es una operación nula, no un error. Las acciones viven en
 *   src/core/keyboard.ts (registro + sustituciones persistidas), LA tabla que
 *   el hito de los ajustes renderizará como su editor.
 *
 * Los oyentes se enganchan a nivel de WINDOW (la última parada del burbujeo),
 * así que todos los manejadores a nivel de componente — el propio Esc de las
 * ventanas emergentes, el Esc del compositor — reciben antes el evento y pueden
 * reclamarlo con stopPropagation.
 */

import { useEffect, useId, useRef, useState } from "react";
import { HostDialog } from "@/components/host-dialog";
import { useOptionalInteractionLayers } from "@/components/interaction-layers";
import { useRouter } from "next/navigation";
import {
	actionForBinding,
	bindingForAction,
	eventBinding,
	formatBinding,
	isTypingSurface,
	kbdEventForAction,
	KEYBOARD_ACTIONS,
} from "@/src/core";
import { pluginQuestionKeySuppressed, composingQuestionKey } from "./plugin-question-keys";
import { isDictationActive } from "@/components/dictation";
import { dispatchFocusedPluginShortcut, hasLegacyInteractionForeground, isInteractionScopeEligible } from "@/components/plugin-input-focus";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { usePlugins } from "./plugins";
import { dispatchPluginActionShortcut, pluginShortcutScopeLabel, usePluginShortcutRows } from "./plugin-shortcuts";

// Se reexporta para la fijación del contrato (tests/keyboard-toggle-sidebar.test.ts):
// el despachador compone los nombres de evento con EL único auxiliar — una segunda
// forma de escribirlo aquí fue como ocurrió el fallo de ⌘B.
export { kbdEventForAction };

export function KeyboardShortcuts() {
	const router = useRouter();
	const [cheatOpen, setCheatOpen] = useState(false);
	const { open: openSettings } = useSettingsDialog();
	const controller = useOptionalInteractionLayers();
	const { manager } = usePlugins();

	// El estado del router + la chuleta + los ajustes, dentro de una ref para que el oyente
	// de keydown (enganchado una vez) nunca quede obsoleto.
	const handlersRef = useRef<{
		router: ReturnType<typeof useRouter>;
		setCheatOpen: (v: boolean) => void;
		openSettings: () => void;
	}>({ router, setCheatOpen, openSettings });
	handlersRef.current = { router, setCheatOpen, openSettings };

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (pluginQuestionKeySuppressed(e) || composingQuestionKey(e)) return;
			// La captura del proveedor ya suprimió el Tab nativo sin detener la
			// propagación al destino. Se conserva la antigua alternativa del fixture sin proveedor.
			if (e.key === "Tab") {
				if (!controller) e.preventDefault();
				if (e.shiftKey) {
					if (!dispatchFocusedPluginShortcut("cycle-thinking", controller))
						window.dispatchEvent(new CustomEvent("lh:kbd-cycle-thinking"));
				}
				// Tab sin más recorre los campos de texto de la superficie activa (responsable,
				// ronda de teclado 2026-10-06) — solo hacia delante, dando la vuelta; cada
				// página con compositor responde con su propia cadena. El reclamo
				// filas↔razonamiento del dock de quiz detiene la propagación a nivel de
				// documento, así que un Tab reclamado nunca llega a este despacho.
				else if (!e.metaKey && !e.ctrlKey && !e.altKey)
					window.dispatchEvent(new CustomEvent("lh:kbd-cycle-fields"));
				return;
			}

			if (e.key === "Escape") {
				// El proveedor hace las instantáneas antes que los manejadores de las hojas. Un propietario
				// original cerrado/bloqueado nunca expone esta alternativa al mismo evento.
				if (e.defaultPrevented || (controller ? controller.isEscapeOwned(e) : hasLegacyInteractionForeground(document))) return;
				// LA LEY DE UN SOLO ESC (responsable, ronda de teclado 2026-10-06): un
				// Esc, una acción, en la capa activa más alta. Los manejadores a nivel de campo
				// reclaman en su elemento (foco en un campo: la acción del
				// campo); cada capa EXPUESTA (ventanas emergentes, plan,
				// overlays, diálogos) reclama a nivel de DOCUMENTO, que
				// se dispara antes que este oyente de window — así que llegar aquí significa
				// que NO hay nada expuesto y ningún campo tiene el foco. Esta cadena es
				// la alternativa, de abajo arriba: el dictado (una captura viva, no una
				// superficie — sobrevive al Esc que cierra un plan o un overlay),
				// luego abortar el turno (un turno del servidor no tiene ninguna petición del cliente
				// que abortar — la frontera de aborto de Chat decide qué se puede
				// detener honestamente, por capas mediante escAbortTarget).
				if (isDictationActive()) {
					e.preventDefault();
					window.dispatchEvent(new CustomEvent("lh:kbd-cancel-dictation"));
					return;
				}
				window.dispatchEvent(new CustomEvent("lh:kbd-abort-turn"));
				return;
			}

			// ── Despacho del registro. Los editores hoja/la reasignación conservan sus reclamos.
			if (e.defaultPrevented) return;
			const action = actionForBinding(eventBinding(e));
			if (!action) { dispatchPluginActionShortcut(e, manager, controller); return; }

			// La guarda de entrada: dentro de una superficie de escritura solo se disparan las combinaciones
			// con mod/alt (nunca escriben un carácter). Las teclas sueltas — "?" incluida —
			// pasan para que el campo se las quede. Tab ya volvió más arriba.
			if (isTypingSurface(e) && !(e.metaKey || e.ctrlKey || e.altKey)) return;

			// Despacho: los comandos globales que son nuestros se ejecutan aquí; los comandos de superficie
			// van en el evento de window para que los atrape la superficie montada.
			switch (action) {
				case "new-session":
					handlersRef.current.router.push("/chat/new");
					break;
				case "open-settings":
					// Oleada de la app de ajustes: el diálogo es la superficie, la URL ha
					// desaparecido — /settings redirige al envoltorio de borrador.
					handlersRef.current.openSettings();
					break;
				case "jump-graph":
					handlersRef.current.router.push("/");
					break;
				case "cheat-sheet":
					handlersRef.current.setCheatOpen(true);
					break;
				case "toggle-question-thread":
					// La vista de chat es la responsable (solo mientras espera una pregunta); reclama la
					// combinación para que el propio ⌘J de una pestaña del navegador (Descargas) nunca se dispare también.
					e.preventDefault();
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
					break;
				case "find":
					// La superficie montada es responsable de Find (texto de la sesión / nodos del grafo).
					// Reclama Mod+F para que el buscador de toda la ventana de Chromium no pueda abrirse también.
					e.preventDefault();
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
					break;
				default:
					if (dispatchFocusedPluginShortcut(action, controller)) break;
					// El dictado del núcleo es un servicio de la página de fondo, no un comando
					// modal. Un plugin en primer plano recibe arriba su reclamo enfocado.
					if (action === "toggle-dictation" && !isInteractionScopeEligible(document.body, controller)) break;
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [controller, manager]);

	return <CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />;
}

/** El overlay de ? — el registro renderizado como una tabla (agrupada por ámbito).
 *  Hasta que el hito de los ajustes traiga un editor, así es como los atajos
 *  siguen pudiéndose descubrir. */
function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const headingId = useId();
	const { rows: pluginRows } = usePluginShortcutRows();
	const scopes = ["global", "chat", "graph"] as const;
	const scopeLabels: Record<(typeof scopes)[number], string> = {
		global: "Global",
		chat: "Chat",
		graph: "Graph view",
	};
	return (
		<HostDialog open={open} onClose={() => { onClose(); return "closed"; }} aria-labelledby={headingId}
			backdropProps={{
				"data-testid": "cheat-sheet",
				className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50",
			}}
			frame={<div
				className="max-h-[80vh] w-full max-w-[36rem] overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			/>}
		>
				<div className="mb-4 flex items-baseline justify-between">
					<span id={headingId} role="heading" aria-level={2} className="text-sm font-medium text-card-foreground">Keyboard shortcuts</span>
					<span className="text-xs text-muted-foreground">Esc to close</span>
				</div>
				{scopes.map((scope) => {
					const actions = KEYBOARD_ACTIONS.filter((a) => a.scope === scope);
					if (actions.length === 0) return null;
					return (
						<div key={scope} className="mb-4">
							<div className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground/70">
								{scopeLabels[scope]}
							</div>
							<div className="flex flex-col gap-1">
								{actions.map((a) => (
									<div key={a.id} className="flex items-center justify-between gap-4 text-sm">
										<span className="text-muted-foreground">{a.label}</span>
										<kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-card-foreground">
											{formatBinding(bindingForAction(a.id))}
										</kbd>
									</div>
								))}
							</div>
						</div>
					);
				})}
				{[...new Set(pluginRows.map(row => row.pluginId))].map(pluginId => <div key={pluginId} className="mb-4" data-testid={`kbd-cheat-plugin-${pluginId}`}>
					<div className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground/70">{pluginRows.find(row => row.pluginId === pluginId)!.pluginName}</div>
					{pluginRows.filter(row => row.pluginId === pluginId).map(row => <div key={row.id} className="mb-1 text-sm">
						<div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{row.name}</span><kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-card-foreground">{row.binding ? formatBinding(row.binding) : "Unbound"}</kbd></div>
						<div className="text-xs text-muted-foreground/70">{pluginShortcutScopeLabel(row)}{row.reason ? ` · Inactive: ${row.reason}` : ""}</div>
					</div>)}
				</div>)}
		</HostDialog>
	);
}
