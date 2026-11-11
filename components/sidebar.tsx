"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MenuShell } from "@/components/menu-shell";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import type { ChatDeleteMode, ThemeMode } from "@/src/core";
import { DumbbellIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { ActivitySection } from "@/components/activity-dock";
import { CoverageMenuBlock } from "@/components/extraction-coverage";
import { LhMark } from "@/components/lh-mark";
import { BrailleSpinner } from "@/components/braille-spinner";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { SettingsDialogProvider, useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fuzzyScore } from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { ChatListItem } from "@/src/core";
import { kbdEventForAction } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { PluginWidgets } from "@/components/plugins";
import { PluginSidebarActions } from "@/components/plugin-chrome";
import { HostContentRootContext, HostRouteLifetimeProvider } from "@/components/host-content-root";
import { isInteractionScopeEligible } from "@/components/plugin-input-focus";
import { InteractionLayersProvider, useInteractionLayers, useOptionalInteractionLayers } from "@/components/interaction-layers";

/**
 * Barra lateral conmutable — NO es un cajón modal: sin fondo, sin robar el
 * foco. Va en línea junto al contenido y puede quedarse abierta mientras se
 * trabaja en una sesión. El estado abierto persiste entre páginas (el
 * proveedor vive en el layout raíz) y entre recargas (localStorage).
 */

const STORAGE_KEY = "lh:sidebar-open";

/*
 * Comportamiento en ventana estrecha (responsable, 2026-09-17): por debajo de
 * SIDEBAR_AUTOCLOSE la barra lateral apretaría la página por debajo del
 * suelo de ventana de 640px (los dos números se componen: 640 + 288 de barra
 * = 928), así que se cierra sola — y se RESTAURA sola cuando la ventana
 * vuelve a ensancharse (elección del responsable: la barra vuelve a aparecer,
 * no hay que reabrirla a mano). Todo el comportamiento es una expresión:
 * rendered = pref && !narrow, donde pref es la elección persistida del
 * usuario. Los cierres manuales persisten y se quedan cerrados; el cierre
 * automático no toca la preferencia. Abrir la barra lateral en estrecho pide
 * al armazón de Electron que ensanche la ventana hasta el umbral
 * (window.lh.expandWindow, IPC en electron/main.cjs) — el listener de
 * redimensionado cambia `narrow` y la barra aparece. En el navegador normal
 * no hay ventana que ensanchar ni supresión — una pestaña estrecha abre la
 * barra lateral si el usuario lo pide.
 *
 * Refleja SIDEBAR_AUTOCLOSE de electron/main.cjs — mantenlos sincronizados.
 */
import type { ChatGPTControlBridge, NativeSubscriptionControlBridge } from "@/src/core";
import type { UpdateState } from "@/components/settings/update-settings.tsx";
import { FilePathDropZone } from "@/components/file-path-drop-zone";
const SIDEBAR_AUTOCLOSE = 928;

// Ámbito de módulo, protegido para SSR (el servidor no tiene navigator).
const IS_ELECTRON = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

declare global {
	interface Window {
		/** Puente de precarga (electron/preload.cjs) — solo en Electron, ausente en el navegador. */
		lh?: {
			/** SO anfitrión de solo lectura; determina el margen de los controles nativos. */
			platform?: string;
			/** Resuelve un File respaldado por el SO sin copiar/subir su contenido. */
			getPathForFile?: (file: File) => string;
			/** Elige una ruta de directorio original, sin leer su contenido. */
			chooseAttachmentFolder?: () => Promise<string | null>;
			/** El desarrollo de escritorio con Next externo usa las conexiones web del servidor. */
			subscriptionTransport?: "desktop" | "web";
			openSubscriptionBrowser?: (action: string) => Promise<void>;
			chatgpt?: ChatGPTControlBridge;
			subscriptions?: NativeSubscriptionControlBridge;
			expandWindow: () => void;
			/** El cromo nativo sigue el tema activo (oleada de temas): main fija
			 *  themeSource y vuelve a pintar el fondo / overlay de la ventana. */
			setAppearance?: (a: { mode: ThemeMode; background: string }) => void;
			/** La verdad del zoom (ronda 7 del responsable): se suscribe a los avisos "lh:zoom"; devuelve la baja. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Eventos de actualización observacionales y una instantánea para los suscriptores tardíos. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** La comprobación manual explícita también descarga y prepara las actualizaciones disponibles. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
		};
	}
}

const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
	open: false,
	toggle: () => {},
});

export function useSidebar() {
	return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		const bridge = window.lh?.chatgpt;
		if (!bridge) return;
		const off = bridge.onChange(() => notifySettingsSaved("keys"));
		notifySettingsSaved("keys"); // cubre los cambios que se perdieron antes de esta suscripción que dura lo que la raíz
		return off;
	}, []);
	// Empieza cerrada para que el primer render del servidor y del cliente coincidan (sin
	// desajuste de hidratación); el valor guardado se aplica tras montar.
	const [open, setOpen] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// Detección del armazón de Electron (cromo fusionado, 2026-09-17): activa el
		// CSS .lh-electron (app/globals.css) que convierte las franjas de cabecera
		// en la superficie de arrastre de la ventana. Solo tras montar — el HTML del
		// servidor y el primer render del cliente deben coincidir (sin desajuste de
		// hidratación), y en el navegador normal la clase nunca aparece.
		if (IS_ELECTRON) {
			document.documentElement.classList.add("lh-electron");
			document.documentElement.dataset.lhPlatform = window.lh?.platform ?? "";
		}

		// LA VERDAD DEL ZOOM (ronda 7 del responsable, 2026-10-05): ⌘±/⌘0 hacen zoom en la
		// interfaz (zoomFactor de Electron) mientras los semáforos nativos se quedan con
		// tamaño físico fijo — las longitudes CSS del margen se dividen por este factor
		// para que su tamaño RENDERIZADO nunca cambie. getZoom cubre la carrera del primer
		// pintado; cada cambio posterior llega como un aviso lh:zoom.
		const setZoomVar = (factor: number) =>
			document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		void window.lh?.getZoom?.().then(setZoomVar);

		const stored = localStorage.getItem(STORAGE_KEY);
		// Por defecto: abierta (la primera ejecución presenta la barra lateral).
		setOpen(stored === null ? true : stored === "1");
		setMounted(true);
		return () => off?.();
	}, []);

	// Cierre/restauración automáticos en ventana estrecha (ver la nota de SIDEBAR_AUTOCLOSE):
	// solo se dispara en redimensionados reales — una comparación booleana, sin trabajo de layout.
	// Tanto esto como el efecto de montaje llegan antes del primer pintado, así que una
	// ventana estrecha nunca muestra un destello de la barra abierta al cargar.
	useEffect(() => {
		if (!IS_ELECTRON) return; // las pestañas del navegador normal se abren libremente
		const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTOCLOSE);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggle = useCallback(() => {
		// Abrir en estrecho (cerrada automáticamente, o cerrada por el propio usuario
		// en estrecho): pide al armazón que ensanche hasta el umbral — el listener
		// de redimensionado cambia `narrow` y la barra aparece. La preferencia
		// persiste como cualquier otra apertura, así que un reinicio con ancho
		// estrecho se sigue restaurando solo al ensanchar.
		if (narrow && !open) {
			localStorage.setItem(STORAGE_KEY, "0");
			setOpen(true);
			window.lh?.expandWindow();
			return;
		}
		setOpen((v) => {
			localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
			return !v;
		});
	}, [narrow, open]);

	// ⌘B: el atajo global despacha kbdEventForAction("toggle-sidebar")
	// y el contexto responde exactamente a ese nombre — la grafía compartida
	// es el arreglo del fallo del interludio (el listener estaba en el nombre
	// previo a la convención, "lh:toggle-sidebar", mientras el despachador enviaba
	// "lh:kbd-toggle-sidebar", así que ⌘B no hacía nada en silencio; responsable
	// 2026-09-25).
	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	return (
		<SidebarContext.Provider value={{ open: open && !narrow, toggle }}>
			{/* transiciones condicionadas al montaje: sin destello de entrada deslizante al cargar la página */}
			<div className={cn("flex h-dvh", mounted && "[&_.sidebar-motion]:transition-[width,margin,opacity]")}>{children}</div>
		</SidebarContext.Provider>
	);
}

/** Botón de hamburguesa para las cabeceras de página — solo visible cuando la barra lateral está cerrada.
 *
 *  Responsable, ronda 6c: el botón SIEMPRE ESTÁ MONTADO y es dueño de una
 *  ranura cuyo ancho+margen se animan AL UNÍSONO con la transición de ancho
 *  de la propia barra lateral (la misma duration-200, la misma curva, ambas
 *  condicionadas al montaje) — antes se montaba/desmontaba en un solo
 *  fotograma, así que su huella de 48px (botón + hueco) aparecía de golpe y
 *  arrastraba el título y los chips de lado mientras la barra aún estaba a
 *  mitad del deslizamiento. Abierta, la ranura es exactamente cero (w-0
 *  -mr-3: ancho 0, el margen negativo anula el gap-3 de la cabecera), así
 *  que los layouts en reposo son idénticos píxel a píxel al antiguo render
 *  condicional. El icono se desvanece con la ranura y esta lo recorta al
 *  colapsar — sin saltos en ninguna dirección. */
export function SidebarToggle() {
	const { open, toggle } = useSidebar();
	return (
		<span
			className={cn(
				"sidebar-motion lh-no-drag relative flex h-9 shrink-0 overflow-hidden duration-200",
				open ? "w-0 -mr-3" : "w-9 mr-0 lh-closed-toggle",
			)}
		>
			<Hint label="Open sidebar" action="toggle-sidebar">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Open sidebar"
				aria-hidden={open}
				tabIndex={open ? -1 : 0}
				onClick={toggle}
				className={cn("sidebar-motion duration-200", open ? "pointer-events-none opacity-0" : "opacity-100")}
			>
				{/* Responsable, ronda 6: size-4, IGUAL que el glifo de cerrar — el botón
				no debe crecer cuando la barra lateral está cerrada (lo hacía: aquí era size-5).
				El aspecto pequeño es el estándar, en ambas direcciones. */}
				<PanelLeftOpenIcon className="size-4" />
			</Button>
			</Hint>
		</span>
	);
}

/**
 * El indicador de estado de la fila (responsable, ronda de color mínimo): el
 * spinner braille, SOLO mientras hay un turno de enseñanza en curso —
 * movimiento monocromo, el propio glifo de la terminal, que existe
 * exactamente lo que dura el trabajo y desaparece en el instante en que
 * acaba. Cualquier otro estado no renderiza NADA: las fases solo avanzan
 * (todas las sesiones terminan en Teaching — la fase como señal era
 * decoración, ahora retirada en toda la app), y pregunta-pendiente es el
 * estado de REPOSO dominante de las sesiones reales — un estado de reposo no
 * aporta nada al recorrer la lista, así que lo transmite el texto "Waiting
 * for input" de la línea de metadatos. Inactivo es la ausencia de señal, por
 * diseño.
 */
function SessionStatus({ busy }: { busy: boolean }) {
	if (!busy) return null;
	return <BrailleSpinner />;
}

/** "Hace cuánto" compacto: "just now", "5m ago", "3h ago", "2d ago", y luego
 *  una fecha sencilla. Cuánto tiempo lleva una sesión ESPERANDO importa más
 *  que una marca de tiempo absoluta. Pasada una semana la fecha se muestra en
 *  ISO (YYYY-MM-DD, con ceros a la izquierda) — el estándar internacional:
 *  inequívoca en cualquier configuración regional y ordenable (responsable,
 *  ronda 5 de tipografía; el antiguo M/D/YYYY era la convención de EE. UU.
 *  Un ajuste de configuración regional del usuario puede venir después —
 *  trivial, cambiar una función de formato). Pura — exportada para las pruebas. */
export function timeAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "just now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const date = new Date(iso);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/** La segunda línea de la fila: el estado cuando hay estado (esperando/trabajando);
 *  si no, solo hace cuánto. El recuento de mensajes se QUITÓ (responsable,
 *  ronda 5 de tipografía): no servía para ninguna decisión — estorbaba.
 *  messageCount sigue viajando en la carga de la API, así que volver a
 *  mostrarlo es un cambio de una línea si algún día se quiere. */
function sessionMeta(chat: ChatListItem): string {
	if (chat.compacting) return `Compacting context · ${timeAgo(chat.updatedAt)}`;
	if (chat.pendingQuestion) return `Waiting for input · ${timeAgo(chat.updatedAt)}`;
	if ((chat.kind ?? "teach") === "practice" && chat.pendingProblem) {
		return `Problem waiting · ${timeAgo(chat.updatedAt)}`;
	}
	if (chat.busy) return "Working…";
	return timeAgo(chat.updatedAt);
}

/**
 * Una fila de sesión: el spinner de estado (solo mientras trabaja), luego el
 * título + metadatos según el estado. Exportada para las pruebas de render —
 * función pura del elemento de la lista.
 */
export function SessionRow({
	chat,
	active,
	onOpen,
	kbdSelected = false,
	onContextMenu,
}: {
	chat: ChatListItem;
	active: boolean;
	onOpen: () => void;
	/** Resaltado del recorrido con teclado (oleada de atajos A: Alt+↑/↓ + Alt+Enter) —
	 *  visualmente distinto de la sesión activa, que sigue rellena. */
	kbdSelected?: boolean;
	/** El clic derecho abre el menú contextual (oleada 6: Rename / Delete). */
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			data-testid={kbdSelected ? "session-row-kbd" : "session-row"}
			className={cn(
				"relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
				active && "bg-accent",
				kbdSelected && !active && "bg-accent/60 ring-1 ring-border",
			)}
		>
			<SessionStatus busy={chat.busy || chat.compacting} />
			<span className="min-w-0 flex-1">
				{/* Los títulos son PALABRAS del alumno/profesor — Source Sans 3, la
				misma voz en la que se escribieron (todo input es lh-prose); la línea de
				metadatos de abajo sigue en JetBrains Mono (datos de máquina). Una sola
				regla, aplicada por fin también al selector (responsable, ronda de
				tipografía): mono = cromo, Source Sans = palabras humanas. */}
				<span className="block truncate font-prose text-(length:--lh-prose-size)">{chat.title}</span>
				<span className="block text-xs text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
			{/* La mancuerna va a la DERECHA DEL TODO (ronda 6 del responsable, 2026-10-05)
			— antes estaba a la izquierda del nombre; alineada a la derecha mantiene los
			títulos a ras de las filas de enseñanza y se lee más limpia. */}
			{(chat.kind ?? "teach") === "practice" && (
				<DumbbellIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-label="Practice session" />
			)}
		</button>
	);
}

/** La fila de renombrado en línea (oleada 6): la misma geometría que
 *  SessionRow, pero la línea del título pasa a ser un input de texto —
 *  selecciona todo al entrar (el clic significa "sustituir", la regla del
 *  renombrado de la cabecera), Enter/perder el foco confirma, Esc descarta.
 *  La línea de metadatos se queda para que la fila nunca cambie de altura a
 *  mitad de edición. */
export function RenameRow({ chat, onCommit, onCancel }: { chat: ChatListItem; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(chat.title);
	const interactions = useOptionalInteractionLayers();
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);
	return (
		<div
			data-testid="session-rename-row"
			className="relative mb-0.5 flex w-full items-center rounded-lg bg-accent px-3 py-2"
		>
			{/* NO SE MUEVE NADA (responsable, ronda de pulido): una fila inactiva no
			renderiza espaciador de estado (SessionStatus es null cuando no está
			ocupada), así que el título empieza en el propio px-3 de la fila — a 12px.
			La antigua fila de renombrado siempre llevaba un espaciador de 14px + hueco
			+ el borde y el relleno del input, dejando el texto a ~41px (y los
			metadatos con él). Aquí el input no tiene borde ni relleno y está
			exactamente en la x del título; el subrayado es la única señal de edición. */}
			<span className="flex min-w-0 w-full flex-col">
				<input
					ref={inputRef}
					value={draft}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={() => onCommit(draft)}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							if (interactions && !interactions.isElementEligible(e.currentTarget)) return;
							interactions?.claimEscape(e);
							e.stopPropagation(); // descartar, no también las cadenas de la barra lateral/el chat
							onCancel();
						}
					}}
					aria-label="Rename session"
					data-testid="session-rename-input"
					className="lh-input w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 text-foreground outline-none"
				/>
				<span className="block truncate text-xs text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
		</div>
	);
}

/** El filtro de tipo a tres bandas (sesiones de práctica, responsable
 *  2026-10-04): Teaching / All / Practice — un filtro en el cliente sobre la
 *  misma instantánea, persistido en localStorage, con All por defecto. */
export type SessionKindFilter = "teach" | "all" | "practice";
const KIND_FILTER_KEY = "lh:session-kind-filter";

function SessionsSidebar() {
	const interactions = useInteractionLayers();
	const { open, toggle } = useSidebar();
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<SessionKindFilter>("all");
	useEffect(() => {
		const stored = window.localStorage.getItem(KIND_FILTER_KEY);
		if (stored === "teach" || stored === "all" || stored === "practice") setKindFilter(stored);
	}, []);
	const setFilter = useCallback((f: SessionKindFilter) => {
		setKindFilter(f);
		window.localStorage.setItem(KIND_FILTER_KEY, f);
	}, []);
	const pathname = usePathname();
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();

	/* Sesión nueva (responsable, 2026-09-13): SIN POST — el botón abre la vista
	de borrador sin sesión; la sesión solo se crea cuando se envía el primer
	mensaje (y ese mensaje se convierte en su título). Búsqueda: un filtro en
	el cliente sobre la instantánea del sondeo — sin ida y vuelta al servidor. */
	const newSession = useCallback(() => {
		router.push("/chat/new");
	}, [router]);

	/* DIFUSA (ronda 8 del responsable, 2026-10-05): coincidencia de subsecuencia
	 * ordenada por fuzzyScore — el prefijo gana al límite de palabra, que gana a
	 * lo disperso. Una consulta vacía mantiene el orden natural de la lista
	 * (todas las puntuaciones son 0, la ordenación es estable). */
	const shown = useMemo(() => {
		const q = query.trim();
		let list = chats;
		if (list && kindFilter !== "all") {
			list = list.filter((c) => (c.kind ?? "teach") === kindFilter);
		}
		if (!list) return list;
		if (!q) return list;
		return list
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: (typeof list)[number]; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
	}, [chats, query, kindFilter]);

	const refreshInFlightRef = useRef(false);
	const refresh = useCallback(async () => {
		// Agrupación en vuelo (S6): las ráfagas de eventos pueden provocar varias
		// llamadas de refresco a la vez — una petición las sirve a todas; lo más nuevo
		// llega con la petición del siguiente evento.
		if (refreshInFlightRef.current) return;
		refreshInFlightRef.current = true;
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			const d = (await res.json()) as { chats: ChatListItem[] };
			setChats(d.chats);
		} catch {
			// un fallo transitorio conserva la última instantánea
			setChats((prev) => prev ?? []);
		} finally {
			refreshInFlightRef.current = false;
		}
	}, []);

	/* Propagación instantánea del renombrado (2026-09-17): las confirmaciones
	de renombrado de la cabecera del chat despachan lh:chat-renamed; parchea la
	instantánea en el sitio en vez de esperar al sondeo de 2,5s. */
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, title } : c)) : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, []);

	/* ESTADO DEL TURNO INSTANTÁNEO (responsable, ronda de la barra lateral
	2026-10-02): la sesión abierta difunde lh:turn-state en el instante en que
	empieza su turno (submitted — el cambio propio de la máquina optimista) y al
	asentarse — busy refleja la propia definición del servidor (isTurnRunning),
	así que el parche es exacto: el spinner aparece en el momento en que ocurre
	la acción, y se quita y se vuelve a pedir una vez al asentarse (el
	título/orden se mueven con los turnos). El canal de eventos es la red de
	seguridad para todo lo que solo sabe el servidor: otras ventanas, turnos de
	despertar en sesiones sin abrir. Un inicio en un chat que aún no está en la
	instantánea (una sesión recién creada) = un refresco inmediato en vez de un
	parche. */
	const chatsRef = useRef(chats);
	chatsRef.current = chats;
	useEffect(() => {
		const onTurnState = (e: Event) => {
			const { id, running } = (e as CustomEvent<{ id: string; running: boolean }>).detail;
			if (running) {
				if (chatsRef.current?.some((c) => c.id === id)) {
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: true } : c)) : prev));
				} else {
					void refresh(); // la sesión recién creada: aún no está en la instantánea
				}
				return;
			}
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: false } : c)) : prev));
			void refresh(); // asentamiento: la instantánea del servidor ya es fiel — tráela ahora
		};
		window.addEventListener("lh:turn-state", onTurnState);
		return () => window.removeEventListener("lh:turn-state", onTurnState);
	}, [refresh]);

	/* PUSH (arquitectura S6, 2026-10-02): el sondeo de 2,5s está RETIRADO — el
	último sondeo de red que quedaba en la app. La verdad de la lista llega como
	eventos: chats-changed (crear/renombrar/borrar — las escrituras que cambian
	la FORMA de la lista) y turn-started/turn-settled para TODOS los chats (sin
	filtrar: el turno de cualquier chat cambia busy/orden/fase en esta lista).
	Las peticiones anunciadas usan el antirrebote final de 250ms (la ley de
	S4/S5); la resincronización (reconexión / reinicio de desarrollo) es
	inmediata. lh:turn-state + lh:chat-renamed se quedan para lo INSTANTÁNEO
	en la misma pestaña — lo local gana a cualquier ida y vuelta. */
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const eventDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scheduleEventRefresh = () => {
		if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		eventDebounceRef.current = setTimeout(() => {
			eventDebounceRef.current = undefined;
			void refreshRef.current();
		}, 250);
	};
	useServerEvent("chats-changed", scheduleEventRefresh);
	useServerEvent("turn-started", scheduleEventRefresh);
	useServerEvent("turn-settled", scheduleEventRefresh);
	useServerEvent("compaction-changed", scheduleEventRefresh);
	useServerResync(() => void refreshRef.current());
	useEffect(
		() => () => {
			if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		},
		[],
	);

	/* ── Fronteras de teclado (oleada de atajos A, 2026-09-17; ronda del
	recorrido en la búsqueda 2026-10-10) ── ⌘⇧F enfoca el campo de búsqueda — y
	LA BÚSQUEDA ES DUEÑA DEL RECORRIDO: ↑/↓ recorren la lista filtrada (con
	vuelta — "ciclo"), Enter abre la fila recorrida, o la PRIMERA coincidencia
	cuando no se ha recorrido nada (responsable, 2026-10-10 — el patrón de
	apertura rápida: ⌘⇧F, escribir, Enter, listo). El ciclo global con
	Alt+↑/↓/↵ se RETIRÓ en esa misma ronda: apenas se usaba y se notaba lento.
	La selección es un índice de fila dentro de `shown`, así que el recorrido
	sigue lo que dejen la consulta + el filtro de tipo. Ratón y teclado
	conviven: pasar el ratón no reclama, un clic o una apertura borran la
	selección. */
	const [kbdIndex, setKbdIndex] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	/* ── Oleada 6, fragmento A: menú contextual + renombrado en línea + borrado ──
	Clic derecho en una fila de sesión → MenuShell: primero las dos acciones de
	gestión (decisión del responsable) y luego — bajo una línea fina — el
	bloque de cobertura de la extracción (rediseño fijado por el responsable el
	2026-09-24, orden refinado el 2026-09-24: Rename/Delete arriba, las cifras
	+ la indicación de Extract manual abajo). El ancla es la fila en la que se
	hizo clic derecho — asignada a una ref antes del cambio de estado para que
	el armazón la mida en su primera pasada (oculta). */
	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ChatListItem | null>(null);

	const openContext = (e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => {
		e.preventDefault(); // suprime el menú nativo
		ctxAnchorRef.current = e.currentTarget;
		setCtxChatId(chat.id);
	};

	// El contrato del menú (el de agent-section): cualquier pointerdown fuera del menú
	// o de su fila lo cierra; Esc se RECLAMA para que nunca aborte también un turno
	// ni pliegue la barra lateral. Hacer clic derecho en otra fila lo reancla: su
	// pointerdown cierra este menú y su contextmenu abre el siguiente.
	useEffect(() => {
		if (ctxChatId === null) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>('[data-testid="session-context-menu"]'))) return;
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (ctxAnchorRef.current?.contains(target)) return;
			setCtxChatId(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [ctxChatId, interactions]);

	// Renombrado en línea (decisión del responsable, oleada 6): la fila se cambia por un
	// input de texto; la confirmación usa la MISMA fontanería que el renombrado de la
	// cabecera — PUT del título y luego lh:chat-renamed parchea a todos los listeners (el
	// listener propio de esta barra lateral parchea la instantánea al instante; la cabecera de
	// un chat abierto también lo oye). Esc descarta; confirmar vacío descarta (las reglas de la cabecera).
	const commitRename = useCallback(async (id: string, next: string) => {
		setRenamingId(null);
		const t = next.trim();
		if (t === "") return;
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: t }),
			});
			if (!res.ok) throw new Error(`rename failed: ${res.status}`);
			window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id, title: t } }));
		} catch (err) {
			console.error("rename failed:", err); // conserva el título antiguo
		}
	}, []);

	// Borrado con éxito: parchea la lista al instante (el sondeo es la red de seguridad),
	// navega al inicio si la sesión abierta ha muerto (la vista del chat se desmonta —
	// los borradores mueren con ella, sin burbujas huérfanas) y anuncia la revisión
	// del grafo para que la vista del grafo vuelva a pedirlo (el borrado es el único escritor
	// que el sondeo de estado no puede ver — ninguna ejecución pasa nunca de algo a nada).
	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			if (pathname === `/chat/${id}`) router.push("/");
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
		},
		[pathname, router],
	);

	useEffect(() => {
		const onFocusSearch = () => {
			if (interactions.getActiveModal() || interactions.getTopLayer()?.kind === "popup") return;
			if (!open) toggle();
			// Un input recortado (overflow-hidden) sigue recibiendo el foco — la
			// entrada deslizante de la barra lateral no condiciona la pulsación.
			requestAnimationFrame(() => { if (isInteractionScopeEligible(searchRef.current, interactions)) searchRef.current?.focus(); });
		};
		window.addEventListener("lh:kbd-sessions-search", onFocusSearch);
		return () => window.removeEventListener("lh:kbd-sessions-search", onFocusSearch);
	}, [open, toggle, interactions]);

	// Mantén a la vista la fila seleccionada con el teclado (las filas son los únicos
	// botones del contenedor, así que el índice coincide).
	useEffect(() => {
		if (kbdIndex === null) return;
		listRef.current?.querySelectorAll("button")[kbdIndex]?.scrollIntoView({ block: "nearest" });
	}, [kbdIndex]);

	useEffect(() => {
		if (!open) return;
		void refresh();
		// Abrir + navegar vuelven a pedir; mientras está abierta, el canal de eventos se
		// encarga de la frescura (S6) — sin intervalos, nada permanente.
	}, [open, pathname, refresh]);

	return (
		<aside
			className={cn("sidebar-motion shrink-0 overflow-hidden duration-200", open ? "w-72" : "w-0")}
			aria-hidden={!open}
		>
			<div className="flex h-full w-72 flex-col border-r bg-background">
				{/* Marca LH — la cabecera del responsable; el botón de cerrar va en el borde.
				Cromo fusionado (2026-09-17): en Electron esta franja es la superficie de
				arrastre de la ventana y empieza después de los semáforos
				(.lh-lights-gutter); en el navegador esas clases son inertes. */}
				<div className="lh-drag lh-lights-gutter flex items-center justify-between px-4 py-3">
					{/* La marca del responsable (2026-09-17) sustituye al texto "LH" — sigue
					siendo el enlace al inicio, sigue centrada en vertical por el items-center
					de la franja. El .lh-lights-gutter de 92px la aparta de los semáforos con el
					propio margen de borde de estos como hueco. */}
					{/* El hover imita los botones fantasma de alternar (petición del responsable, 2026-09-17):
					la misma geometría de chip size-9, el mismo tratamiento hover:bg-accent. */}
					<Hint
						// Se mantiene (responsable, ronda de sutileza 2026-09-25) pero a la DERECHA
						// del logo, con su atajo real: ⌘G salta a la
						// vista del grafo (keyboard-shortcuts la enruta a "/",
						// el mismo destino que este logo).
						label="Home"
						action="jump-graph"
						side="right"
					>
						<Link
							href="/"
							aria-label="Home"
							className="lh-no-drag flex size-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
						>
							<LhMark className="size-6" />
						</Link>
					</Hint>
					<Hint label="Close sidebar" action="toggle-sidebar">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Close sidebar"
							onClick={toggle}
							className="lh-no-drag"
						>
							<PanelLeftCloseIcon className="size-4" />
						</Button>
					</Hint>
				</div>

				{/* Las puertas del núcleo siempre van delante de las colocaciones explícitas de plugins en la barra lateral. */}
				<PluginSidebarActions>
					<button
						type="button"
						data-testid="new-session"
						title="Teaching"
						onClick={() => void newSession()}
						className="flex min-w-0 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<PlusIcon className="size-3 shrink-0" />
						<span className="min-w-0 truncate">Teaching</span>
						<span className="sr-only">create a new teaching session</span>
					</button>
					<button
						type="button"
						data-testid="new-session-practice"
						title="Practice"
						onClick={() => router.push("/chat/new?mode=practice")}
						className="flex min-w-0 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DumbbellIcon className="size-3 shrink-0" />
						<span className="min-w-0 truncate">Practice</span>
						<span className="sr-only">create a new practice session</span>
					</button>
				</PluginSidebarActions>

				<div className="mx-3 mb-2 flex items-center gap-2">
					<span className="text-xs uppercase tracking-widest text-muted-foreground/70">Sessions</span>
					<Hint label="Search sessions" action="sessions-search" side="bottom">
					<span className="relative flex-1">
						<Input
							ref={searchRef}
							data-testid="session-search"
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								// La lista se reordena bajo la consulta en cada pulsación —
								// un índice de recorrido obsoleto apuntaría a la fila equivocada.
								setKbdIndex(null);
							}}
							// LA BÚSQUEDA ES DUEÑA DEL RECORRIDO (responsable, 2026-10-10 — el
							// sucesor del ciclo Alt+↑/↓/↵ retirado): ↑/↓ recorren las
							// filas filtradas (con vuelta), Enter abre la fila recorrida —
							// o la PRIMERA coincidencia cuando no se ha recorrido nada (el
							// patrón de apertura rápida) — y luego quita el foco (el foco vuelve a
							// la app según la ley de Enter; la consulta se queda para
							// volver a buscar). Esc sale de la búsqueda (responsable,
							// oleada de teclado): quita el foco para volver a lo normal, y reclama la
							// tecla para que la cadena de Esc de la ventana (dictado / abort)
							// no se dispare también.
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									if (!interactions.isElementEligible(e.currentTarget)) return;
									interactions.claimEscape(e);
									e.stopPropagation();
									e.currentTarget.blur();
									return;
								}
								// Las teclas con modificador pertenecen a la superficie (⇧↵, etc.).
								if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
								const n = shown?.length ?? 0;
								if (n === 0) return;
								if (e.key === "ArrowDown" || e.key === "ArrowUp") {
									// Se mueven las filas, no el cursor.
									e.preventDefault();
									const dir = e.key === "ArrowDown" ? 1 : -1;
									setKbdIndex((i) =>
										i === null || i >= n ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n,
										);
									return;
								}
								if (e.key === "Enter") {
									const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
									if (!target) return;
									e.preventDefault();
									router.push(`/chat/${target.id}`);
									setKbdIndex(null);
									e.currentTarget.blur();
								}
							}}
							placeholder="Search…"
							aria-label="Search sessions"
							className="h-6 rounded-sm border-border bg-background pl-6 text-xs placeholder:text-muted-foreground/60"
						/>
						<SearchIcon className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70" />
					</span>
					</Hint>
				</div>

				{/* El filtro a tres bandas, ENCABEZANDO LA LISTA (ronda 8b del responsable,
				2026-10-05 — movido debajo de la búsqueda): delimita lo que muestra la
				lista, así que va justo encima de ella como una fila de leyenda; la
				búsqueda sigue siendo el destino de memoria muscular de arriba. Orden:
				Teaching / Practice / All — primero los modos reales, "All" como vía de
				escape a la derecha, igual que los botones de crear de arriba.
				Persistido en el cliente. */}
				<div className="mx-3 flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="session-kind-filter">
					{(["teach", "practice", "all"] as const).map((f) => (
						<button
							key={f}
							type="button"
							data-testid={`kind-filter-${f}`}
							onClick={() => setFilter(f)}
							className={cn(
								"flex-1 rounded-sm px-2 py-1 text-[11px] uppercase tracking-wider transition-colors",
								kindFilter === f
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{f === "teach" ? "Teaching" : f === "all" ? "All" : "Practice"}
						</button>
					))}
				</div>

				<div ref={listRef} className="flex-1 overflow-y-auto p-2">
					{shown === null ? (
						<div className="px-2 py-4 text-xs text-muted-foreground">Loading…</div>
					) : shown.length === 0 ? (
						<div className="px-2 py-4 text-xs text-muted-foreground">
							{query.trim() ? "No sessions match." : "No sessions yet."}
						</div>
					) : (
						shown.map((c, i) =>
							renamingId === c.id ? (
								<RenameRow
									key={c.id}
									chat={c}
									onCommit={(next) => void commitRename(c.id, next)}
									onCancel={() => setRenamingId(null)}
								/>
							) : (
								<SessionRow
									key={c.id}
									chat={c}
									active={pathname === `/chat/${c.id}`}
									kbdSelected={i === kbdIndex}
									onOpen={() => {
										setKbdIndex(null);
										router.push(`/chat/${c.id}`);
									}}
									onContextMenu={(e) => openContext(e, c)}
								/>
							),
						)
					)}
				</div>

					{/* Agentes en segundo plano (responsable, ronda de la barra lateral): la
					sección está SIEMPRE aquí — vacía significa vacía (la cabecera sola); se
					rellena y crece cuando hay procesos en marcha. La lista de sesiones es
					flex-1, así que esto queda fijado abajo. Barra lateral cerrada = el
					alumno ha optado por no verlo (sin señal ambiental, decisión del usuario). */}
					<ActivitySection />

					{/* Entrada de ajustes (oleada de la app de ajustes): el mismo lenguaje de
					fila que New session — discreta, fijada abajo, abre el diálogo centrado
					(también mod+, en el registro de teclado). */}
					<div className="px-3 pb-3 pt-1">
						<Hint label="Settings" action="open-settings" side="right">
							<button
								type="button"
								onClick={() => openSettings()}
								data-testid="settings-entry"
								className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<SettingsIcon className="size-3" />
								Settings
							</button>
						</Hint>
					</div>
				</div>

				{/* El menú contextual (oleada 6 + el rediseño de la UX de extracción): el
				bloque de cobertura arriba y luego exactamente dos acciones de gestión
				(decisión del responsable — ni una más). MenuShell es dueño de la
				colocación/foco/recorrido con flechas; el efecto de descarte de arriba es
				dueño del contrato. */}
				{ctxChatId !== null && (
					<MenuShell onClose={() => { setCtxChatId(null); return "closed"; }}
						anchorRef={ctxAnchorRef}
						testid="session-context-menu"
						preferredSide="down"
						menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
					>
						{/* Primero las dos acciones de gestión y luego el bloque de extracción
						(ronda de refinamiento del responsable, 2026-09-24): Rename/Delete se quedan
						arriba, las cifras de cobertura + la indicación de Extract van bajo la
						línea fina — el bloque es información + una indicación con estado, las
						acciones encima de él. Se pide al abrir el menú (el bloque se monta CON
						el menú); 409 = inofensivo. No renderiza nada si la lectura falla. */}
						<button
							type="button"
							data-testid="ctx-rename"
							onClick={() => {
								setRenamingId(ctxChatId);
								setCtxChatId(null);
							}}
							className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
						>
							Rename
						</button>
						{/* Exportar como Markdown (responsable, pulido de la versión 2026-10-06): el
					debut de cara al usuario del motor session-markdown — descarga mediante un
					ancla del mismo origen; el Content-Disposition de la ruta da nombre al
					fichero. Va con las acciones de gestión, encima de Delete (la acción
					destructiva se queda la última — la ley de la barrera de peligro). */}
						<button
							type="button"
							data-testid="ctx-export-md"
							onClick={() => {
								const chatId = ctxChatId;
								setCtxChatId(null);
								const a = document.createElement("a");
								a.href = `/api/chats/${chatId}/markdown`;
								a.download = ""; // gana el nombre de fichero de la ruta
								document.body.appendChild(a);
								a.click();
								a.remove();
							}}
							className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
						>
							Export as Markdown…
						</button>
						<button
							type="button"
							data-testid="ctx-delete"
							onClick={() => {
								const target = chats?.find((c) => c.id === ctxChatId);
								if (target) setDeleting(target);
								setCtxChatId(null);
							}}
							className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						>
							Delete…
						</button>
						<div className="my-0.5 border-t border-border/60" aria-hidden="true" />
						<CoverageMenuBlock chatId={ctxChatId} />
					</MenuShell>
				)}

				{/* El diálogo de borrado con dos opciones (oleada 6) — lo pone en portal
				al body el propio componente; vive aquí por localidad del estado. */}
				<DeleteSessionDialog
					chat={deleting}
					onClose={() => setDeleting(null)}
					onDeleted={onDeleted}
				/>
			</aside>
	);
}

/** El marco de la app: barra lateral en línea + contenido. Se renderiza una vez en el layout raíz. */
export function AppShell({ children }: { children: React.ReactNode }) {
	const [contentRoot, setContentRoot] = useState<HTMLElement | null>(null);
	const pathname = usePathname();
	return (
		<HostRouteLifetimeProvider pathname={pathname}>
		<HostContentRootContext.Provider value={contentRoot}>
			<InteractionLayersProvider><SettingsDialogProvider>
				<SessionsSidebar />
				<FilePathDropZone className="relative isolate min-w-0 flex-1" onContentRoot={setContentRoot}>{children}</FilePathDropZone>
				{/* El único listener de keydown a nivel de documento (oleada de teclado A)
				— después del contenido en el árbol, pero está a nivel de ventana, así que el
				orden solo importa para los eventos que despacha, nunca para la prioridad en el DOM. */}
				<KeyboardShortcuts />
				<PluginWidgets />
			</SettingsDialogProvider></InteractionLayersProvider>
		</HostContentRootContext.Provider>
		</HostRouteLifetimeProvider>
	);
}
