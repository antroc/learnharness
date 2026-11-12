"use client";
/**
 * EL DIÁLOGO DE AJUSTES (oleada de la app de ajustes, 2026-09-20): la página
 * de ajustes ligeros se graduó a la superficie diseñada: un modal centrado
 * sobre todo, con navegación de secciones a la izquierda + una única columna
 * de contenido con desplazamiento.
 *
 * Decisiones del responsable en esta oleada:
 * - Diálogo, no página: se abre sobre la pantalla en la que estés (la
 *   recompensa: las ediciones de apariencia cambian el estilo del chat EN
 *   VIVO detrás del diálogo). Escape, el fondo y ✕ lo cierran. Solo modal:
 *   /settings redirige, así que nada enlaza a una superficie muerta.
 * - Navegación de secciones a la izquierda con la tipografía mono de la
 *   interfaz de la app, con pequeños iconos decorativos de Lucide para las
 *   secciones integradas; activa = bg-accent. Los iconos heredan el color
 *   de la fila, sin paleta propia.
 * - El diálogo es agnóstico de la superficie por construcción: las secciones
 *   solo hablan con /api/settings* y localStorage, así que este armazón se
 *   puede volver a montar como una verdadera ventana del SO en la ronda de
 *   Electron casi sin cambios.
 *
 * El registro + la única frontera `write` se trasladaron aquí desde la
 * página ligera: una única instancia del registro para todo el diálogo, las
 * secciones escriben a través de ella y cambiar de sección nunca vuelve a
 * pedir nada.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";
import { BotIcon, KeyIcon, KeyboardIcon, PaletteIcon, PlugIcon, PuzzleIcon, SettingsIcon, WaypointsIcon, type LucideIcon } from "lucide-react";
import { HostDialog } from "@/components/host-dialog";
import { useInteractionLayers, type CloseOutcome } from "@/components/interaction-layers";
import {
	CURRENT_SETTINGS_VERSION,
	type AgentSettings,
	type AppearanceSettings,
	type CompactionSettings,
	type GraphSettings,
	type UserSettings,
} from "@/src/core";
import { useAppearance } from "./appearance.tsx";
import { SettingsSection } from "./controls.tsx";
import { UpdateSettings } from "./update-settings.tsx";
import { AgentSection } from "./agent-section.tsx";
import type { ModelsSettings } from "@/src/core";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/components/menu-shell";
import { notifySettingsSaved } from "@/components/settings-signal";
import { KeysSection } from "./keys-section.tsx";
import { Hint } from "@/components/ui/hint";
import { AppearanceSection, GraphSection } from "./appearance-section.tsx";
import { KeyboardSection } from "./keyboard-section.tsx";
import { PluginsSection } from "./plugins-section.tsx";
import { PluginSettingsPage } from "./plugin-settings-page.tsx";
import { usePlugins } from "@/components/plugins";
import { ChatGPTUIProvider } from "./chatgpt-connection.tsx";
import { NativeSubscriptionUIProvider } from "./subscription-connections.tsx";

/** Responsable (2026-09-20): las pistas tienen que ganarse su sitio; fuera
 * la prosa que explica la mecánica; solo se queda la nota del teclado (la
 * ubicación del almacenamiento es una pregunta real de los usuarios). */
const SECTIONS = [
	{ id: "keys", label: "Providers", icon: KeyIcon },
	{ id: "agent", label: "Agent", icon: BotIcon },
	{ id: "appearance", label: "Appearance", icon: PaletteIcon },
	{ id: "graph", label: "Graph", icon: WaypointsIcon },
	{ id: "keyboard", label: "Keyboard", icon: KeyboardIcon, hint: "Stored on this device" },
	{ id: "general", label: "General", icon: SettingsIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"] | "plugins" | "core-plugins" | `plugin:${string}`;

/** `open(section?, row?)`: la FILA opcional enlaza directamente a la sección
 * Keys con esa fila desplegada (oleada de cero claves: el clic del error de
 * dictado llega a la fila de Deepgram). `row` es el ID DE LA CLAVE (el
 * nombre de la variable de entorno, p. ej. DEEPGRAM_API_KEY: el estado
 * openRow de KeysSection), no el testid de la fila. */
const DialogContext = createContext<{ open: (section?: string, row?: string) => void }>({ open: () => {} });
// La autoridad pertenece al host persistente de Settings, no a un campo concreto ni a
// una vida de apertura/cierre: una respuesta tardía no debe deshacer un ACK más reciente.
interface SettingsWriteOrder {
	issued: number;
	acknowledged: number;
	record?: UserSettings;
	fileAccessError?: string | null;
	listeners: Set<(record: UserSettings, fileAccessError: string | null) => void>;
}
const WriteOrderContext = createContext<RefObject<SettingsWriteOrder> | null>(null);

/** Montaje a nivel de AppShell: la fila de la barra lateral y el atajo mod+,
 * llaman a esto. `open(section)` abre el diálogo en una sección concreta (el
 * flujo de configuración del primer uso enlaza directamente a Keys cuando
 * aún no existe ninguna clave de proveedor). */
export function SettingsDialogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const interactions = useInteractionLayers();
	const layerId = useId();
	const writeOrder = useRef<SettingsWriteOrder>({ issued: 0, acknowledged: 0, listeners: new Set() });
	const [show, setShow] = useState(false);
	const [landOn, setLandOn] = useState<SectionId>("keys");
	const [landOnRow, setLandOnRow] = useState<string | null>(null);
	const [navigationRequest, setNavigationRequest] = useState(0);
	const open = useCallback((section?: string, row?: string) => {
		// Volver a este singleton es una petición acotada, no un pop forzado.
		// Las capas controladas pueden aceptar el cierre antes de que React lo confirme.
		if (interactions.getLayer(layerId) && interactions.popTo(layerId) !== "closed") return;
		interactions.invalidateOpening();
		setNavigationRequest(request => request + 1);
		setLandOn(section ? section as SectionId : "keys");
		setLandOnRow(row ?? null);
		setShow(true);
	}, [interactions, layerId]);
	const close = useCallback((): CloseOutcome => { setShow(false); return "closed"; }, []);
	useEffect(() => window.lh?.onOpenSettings?.((section) => open(section)), [open]);
	useEffect(() => {
		const onPluginSettings = (event: Event) => {
			const pluginId: unknown = (event as CustomEvent<unknown>).detail;
			if (typeof pluginId === "string") open(`plugin:${pluginId}`);
		};
		window.addEventListener("lh:open-plugin-settings", onPluginSettings);
		return () => window.removeEventListener("lh:open-plugin-settings", onPluginSettings);
	}, [open]);
	return (
		<ChatGPTUIProvider><NativeSubscriptionUIProvider><WriteOrderContext.Provider value={writeOrder}><DialogContext.Provider value={{ open }}>
			{children}
			{show && (
				<SettingsDialog onClose={close} initialSection={landOn} initialRow={landOnRow} navigationRequest={navigationRequest} layerId={layerId} />
			)}
		</DialogContext.Provider></WriteOrderContext.Provider></NativeSubscriptionUIProvider></ChatGPTUIProvider>
	);
}

export function useSettingsDialog() {
	return useContext(DialogContext);
}

function SettingsDialog({
	onClose,
	initialSection,
	initialRow,
	navigationRequest,
	layerId,
}: {
	onClose: () => CloseOutcome;
	initialSection: SectionId;
	navigationRequest: number;
	layerId: string;
	/** La fila de la sección keys que se despliega (ver DialogContext arriba). */
	initialRow: string | null;
}) {
	// Conserva el marco visual original y el fondo atenuado simple. El límite
	// compartido sin transformar contiene también los menús en portal de este modal.
	return <SettingsDialogBody onClose={onClose} initialSection={initialSection}
		initialRow={initialRow} navigationRequest={navigationRequest}
		renderFrame={frame => <HostDialog open layerId={layerId} ownerId={null}
			onClose={onClose} frame={frame} aria-label="Settings"
			backdropProps={{
				className: "fixed inset-0 z-50 flex items-center justify-center bg-background/80",
				"data-testid": "settings-backdrop",
			}}>{frame.props.children}</HostDialog>} />;
}

/** El diálogo sin el portal/fondo: el marco comprobable en SSR (los portales
 * no renderizan nada con renderToStaticMarkup). */
export function SettingsDialogBody({
	onClose,
	initialSection = "keys",
	initialRow = null,
	navigationRequest = 0,
	renderFrame,
}: {
	onClose: () => void;
	/** El tiempo de ejecución aporta el armazón modal compartido; el SSR independiente conserva el marco. */
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
	initialSection?: SectionId;
	/** Las aperturas repetidas deben redirigir aunque la sección pedida no cambie. */
	navigationRequest?: number;
	/** La fila de keys que se despliega al llegar (null = ninguna). Las
	 * redirecciones con el diálogo abierto la siguen exactamente igual que a
	 * initialSection, más abajo. */
	initialRow?: string | null;
}) {
	const { onAppearanceChange } = useAppearance();
	const inheritedWriteOrder = useContext(WriteOrderContext);
	const standaloneWriteOrder = useRef<SettingsWriteOrder>({ issued: 0, acknowledged: 0, listeners: new Set() });
	const writeOrder = inheritedWriteOrder ?? standaloneWriteOrder;
	const { snapshot } = usePlugins();
	const [record, setRecord] = useState<UserSettings | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
	const [fileAccessError, setFileAccessError] = useState<string | null>(null);
	// Recuento de MenuShell abiertos: controla el bloqueo de desplazamiento de la columna de contenido.
	const [openMenus, setOpenMenus] = useState(0);
	const contentRef = useRef<HTMLDivElement | null>(null);
	// Bloqueo del desplazamiento (oleada de arreglos, decisión del responsable: la barra PUEDE quedarse,
	// NO debe haber desplazamiento, nada puede moverse): la columna de contenido
	// mantiene overflow-y-auto —la barra de desplazamiento y todas las anchuras se quedan exactamente
	// como están— y, mientras haya algún MenuShell abierto, unos listeners no pasivos de wheel +
	// touchmove en la columna hacen preventDefault. React engancha los eventos
	// sintéticos de rueda/táctiles de forma pasiva en la raíz, así que esto necesita la
	// frontera de ref con listener nativo.
	useEffect(() => {
		const el = contentRef.current;
		if (!el || openMenus === 0) return;
		const block = (e: Event) => e.preventDefault();
		el.addEventListener("wheel", block, { passive: false });
		el.addEventListener("touchmove", block, { passive: false });
		return () => {
			el.removeEventListener("wheel", block);
			el.removeEventListener("touchmove", block);
		};
	}, [openMenus]);

	useEffect(() => {
		const onOpen = () => setOpenMenus((n) => n + 1);
		const onClose = () => setOpenMenus((n) => Math.max(0, n - 1));
		window.addEventListener(MENU_OPEN_EVENT, onOpen);
		window.addEventListener(MENU_CLOSE_EVENT, onClose);
		return () => {
			window.removeEventListener(MENU_OPEN_EVENT, onOpen);
			window.removeEventListener(MENU_CLOSE_EVENT, onClose);
		};
	}, []);
	const [active, setActive] = useState<SectionId>(initialSection);
	// Un enlace directo lanzado con el diálogo YA abierto (lo estrenó el enlace
	// "Add a provider key first…" del selector de embeddings de la oleada 6; el
	// selector murió con la oleada 7, pero el mecanismo es general) cambia
	// initialSection bajo nuestros pies: hay que seguirlo o el enlace no hace
	// nada en silencio.
	useEffect(() => {
		setActive(initialSection);
	}, [initialSection, navigationRequest]);

	const enabledPlugins = snapshot.plugins.filter(plugin => plugin.info.enabled);
	const activePluginId = active.startsWith("plugin:") ? active.slice("plugin:".length) : null;
	const activePlugin = enabledPlugins.find(plugin => plugin.info.id === activePluginId);
	// Mantiene pendiente un enlace directo mientras carga el descubrimiento. Cuando se asienta,
	// los destinos desactivados/desinstalados vuelven a la gestión, nunca a un DOM obsoleto.
	const missingPlugin = activePluginId !== null && !activePlugin && !snapshot.loading;
	const management = snapshot.plugins.find(plugin => plugin.info.id === activePluginId)?.info.origin === "core" ? "core-plugins" : "plugins";
	useEffect(() => {
		if (missingPlugin) setActive(management);
	}, [missingPlugin, management]);
	const selected = missingPlugin ? management : active;
	const navSections: { id: SectionId; label: string; icon?: LucideIcon }[] = [
		...SECTIONS,
		{ id: "core-plugins", label: "Core plugins", icon: PlugIcon },
		{ id: "plugins", label: "Community plugins", icon: PuzzleIcon },
		...enabledPlugins.map(plugin => ({ id: `plugin:${plugin.info.id}` as const, label: plugin.info.manifest?.name ?? plugin.info.id })),
	];

	// Un guardado puede terminar después de que se cierre su diálogo original. Publica su
	// instantánea confirmada en la instancia de Settings que esté montada ahora.
	useEffect(() => {
		const authority = writeOrder.current;
		const apply = (record: UserSettings, fileAccessError: string | null) => {
			setRecord(record);
			setFileAccessError(fileAccessError);
		};
		authority.listeners.add(apply);
		return () => { authority.listeners.delete(apply); };
	}, [writeOrder]);

	// Una petición por cada montaje del diálogo. 200 {settings: null} es el PRIMER ARRANQUE.
	// Un GET iniciado antes de un guardado confirmado más reciente no puede deshacerlo.
	useEffect(() => {
		const authority = writeOrder.current;
		const acknowledgedAtRead = authority.acknowledged;
		let alive = true;
		const applyLoaded = (loaded: UserSettings | null, fileAccessError: string | null = null) => {
			if (!alive) return;
			const unchanged = authority.acknowledged === acknowledgedAtRead;
			setRecord(unchanged ? loaded : authority.record ?? loaded);
			setFileAccessError(unchanged ? fileAccessError : authority.fileAccessError ?? null);
		};
		fetch("/api/settings")
			.then((r) =>
				r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)),
			)
			.then((body: { settings: UserSettings | null; fileAccessError?: string }) =>
				applyLoaded(body.settings ?? { version: CURRENT_SETTINGS_VERSION }, body.fileAccessError ?? null),
			)
			.catch(() => applyLoaded(null));
		return () => { alive = false; };
	}, [writeOrder]);

	/** UN único escritor para todo el diálogo: hace PUT de la sección completa,
	 * mantiene sincronizado el espejo del registro y muestra en línea los
	 * errores de la ruta (un 400 es un error de esquema detectado por la
	 * superficie de validación). */
	const write = useCallback(
		async (
			section: "general" | "agent" | "models" | "appearance" | "graph" | "compaction",
			body: object,
		): Promise<boolean> => {
			const ticket = ++writeOrder.current.issued;
			setError(null);
			try {
				const res = await fetch(`/api/settings/${section}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const detail = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					if (ticket === writeOrder.current.issued) setError(`${section}: ${detail.error ?? res.status}`);
					return false;
				}
				// Solo el registro confirmado es canónico: nunca se sustituye por el cuerpo de la
				// petición, ni siquiera cuando la normalización deja el valor antiguo.
				const reply = (await res.json().catch(() => null)) as { settings?: UserSettings; fileAccessError?: string } | null;
				const stored = reply?.settings;
				if (!stored || typeof stored !== "object" || Array.isArray(stored) || stored.version !== 1 ||
					!stored[section] || typeof stored[section] !== "object" || Array.isArray(stored[section])) {
					if (ticket === writeOrder.current.issued) setError(`${section}: Could not confirm saved settings. Your input has been kept.`);
					return false;
				}
				if (ticket >= writeOrder.current.acknowledged) {
					writeOrder.current.acknowledged = ticket;
					writeOrder.current.record = stored;
					writeOrder.current.fileAccessError = reply?.fileAccessError ?? null;
					for (const apply of writeOrder.current.listeners) apply(stored, writeOrder.current.fileAccessError);
					// Cada respuesta aceptada es un registro canónico completo, incluida la
					// apariencia guardada por una petición de sección anterior aún pendiente.
					onAppearanceChange(stored.appearance);
				}
				notifySettingsSaved(section);
				return true;
			} catch (error) {
				if (ticket === writeOrder.current.issued) setError(`${section}: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}
		},
		[onAppearanceChange, writeOrder],
	);

	const frame = (
		<div
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			data-testid="settings-dialog"
			className="settings-dialog-pop flex h-[620px] max-h-[85vh] w-[920px] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
			onClick={(e) => e.stopPropagation()}
		>
			{/* Cabecera: el lenguaje discreto de títulos CMU de la app. */}
			<header className="flex h-15 shrink-0 items-center gap-3 border-b border-border px-5">
				<h2 className="font-title text-2xl tracking-tight">Settings</h2>
				<Hint
						// Esc cierra a través del dueño compartido de las interacciones.
						label="Close"
						binding="escape"
						side="left"
					>
						<button
					type="button"
					aria-label="Close settings"
					data-testid="settings-close"
					className="ml-auto size-7 rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onClick={onClose}
				>
					<svg
						viewBox="0 0 16 16"
						className="mx-auto size-3.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
					</Hint>
			</header>

			<div className="flex min-h-0 flex-1">
				{/* Navegación izquierda: etiquetas mono e iconos decorativos que heredan
					    el tema; activa = bg-accent. */}
				<nav
					aria-label="Settings sections"
					data-testid="settings-nav"
					className="flex min-h-0 w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2"
				>
					{navSections.map((s, index) => (
						<div key={s.id} className="shrink-0">
							{index === SECTIONS.length && <hr className="my-2 border-border" />}
							<button
								type="button"
								data-testid={`settings-nav-${s.id}`}
								aria-current={selected === s.id}
								className={`flex w-full items-center gap-2 break-words rounded-sm px-3 py-1.5 text-left font-ui text-sm transition-colors ${
									selected === s.id
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:bg-accent hover:text-foreground"
								}`}
								onClick={() => setActive(s.id)}
							>
								{s.icon && <s.icon aria-hidden="true" focusable="false" className="size-3.5 shrink-0" />}
								<span className="min-w-0">{s.label}</span>
							</button>
							{s.id === "plugins" && <hr className="my-2 border-border" />}
						</div>
					))}
				</nav>

				{/* Columna de contenido: una sección cada vez; esta se desplaza y se
				    BLOQUEA mientras haya algún MenuShell abierto (decisión del
				    responsable: no se desplaza con un desplegable abierto; MenuShell
				    anuncia la apertura/cierre y el recuento mantiene honesto el
				    solapamiento). El bloqueo intercepta la rueda/el táctil en vez de
				    ocultar la barra de desplazamiento: nada puede moverse al activarse. */}
				<div
					ref={contentRef}
					className="min-w-0 flex-1 overflow-y-auto"
					data-testid="settings-content"
				>
					{error && !activePluginId && selected !== "plugins" && selected !== "core-plugins" && (
						<p
							role="alert"
							className="m-4 rounded-sm border border-error/40 px-3 py-2 text-xs text-error"
							data-testid="settings-error"
						>
							{error}
						</p>
					)}
					{selected === "plugins" || selected === "core-plugins" ? <PluginsSection origin={selected === "core-plugins" ? "core" : "community"} onOpenSettings={pluginId => setActive(`plugin:${pluginId}`)} />
						: activePlugin ? <PluginSettingsPage key={`${activePlugin.info.id}/${activePlugin.info.revision}`} plugin={activePlugin} />
							: activePluginId !== null ? <p role="status" className="px-6 py-5 text-xs text-muted-foreground">Loading plugins…</p>
								: record === undefined ? (
						<p className="px-6 py-5 text-xs text-muted-foreground/70">
							Loading settings…
						</p>
					) : record === null ? (
						<p className="px-6 py-5 text-xs text-muted-foreground/70">
							Settings could not be loaded — refresh to retry.
						</p>
					) : (
						<div>
							{active === "general" && (
								<SettingsSection
									title="General"
									testid="section-general"
								>
									<UpdateSettings
										autoUpdate={record.general?.autoUpdate ?? true}
										onAutoUpdateChange={(on) =>
											void write("general", { ...record.general, autoUpdate: on })
										}
									/>
								</SettingsSection>
							)}
							{active === "keys" && (
								<SettingsSection title="Providers" testid="section-keys">
									<KeysSection initialRow={initialRow ?? undefined} />
								</SettingsSection>
							)}
							{active === "agent" && (
								<SettingsSection
									title="Agent"
									testid="section-agent"
								>
									<AgentSection
										agent={record.agent}
										fileAccessError={fileAccessError}
										models={record.models}
										graph={record.graph}
										compaction={record.compaction}
										onModelsChange={(next: ModelsSettings) =>
											void write("models", next)
										}
										onSectionChange={(next: AgentSettings) =>
											write("agent", next)
										}
										onCompactionChange={(next: CompactionSettings) =>
											write("compaction", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection
									title="Appearance"
									testid="section-appearance"
								>
									<AppearanceSection
										appearance={record.appearance}
										onSectionChange={(next: AppearanceSettings) =>
											write("appearance", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "graph" && (
								<SettingsSection
									title="Graph"
									testid="section-graph"
								>
									<GraphSection
										graph={record.graph}
										onSectionChange={(next: GraphSettings) =>
											write("graph", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "keyboard" && (
								<SettingsSection
									title="Keyboard"
									hint="Stored on this device"
									testid="section-keyboard"
								>
									<KeyboardSection />
								</SettingsSection>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
	return renderFrame ? renderFrame(frame) : frame;
}
