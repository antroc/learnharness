"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SurfaceRegion, usePageSurfaceBoundary, useSurfaceChromeStyle } from "./plugin-surfaces";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Composer } from "@/components/composer";
import { DictationBar, joinDictation, useDictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { SidebarToggle } from "@/components/sidebar";
import { SetupDialog } from "@/components/setup-dialog";
import { useModelSetup, selectedModelUnavailable, openModelPicker, ZeroKeysPill } from "@/components/setup-cta";
import { StatsBar } from "@/components/stats-bar";
import { ChainTableOverlay } from "@/components/chain-table.tsx";
import { ComposerActions, NodePickerControl } from "@/components/composer-actions";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SessionStarter } from "@/components/start-session";
import type { ChatSettings, GraphSnapshot } from "@/src/core";

/** El conjunto elegido del borrador (ronda 10 del responsable): la MISMA
 *  forma que eleva la barra de elección del inicio — nodos resueltos tal como
 *  los VIO el alumno en el momento de elegir. */
export type DraftPick = { id: string; name: string; statement: string };

/**
 * La vista de borrador sin sesión en /chat/new (responsable, 2026-09-13):
 * "+ New session" abre ESTO, nunca un registro creado — una sesión solo
 * llega a existir cuando el alumno envía el primer mensaje, y ese mensaje se
 * convierte en el título de la sesión (el contrato exacto de crear y luego
 * redirigir que estableció el composer del inicio). Visualmente idéntica a un
 * chat nuevo: la misma cabecera (título + chip de sondeo), el mismo estado
 * vacío, la misma burbuja de composer + dock de estadísticas. El control de
 * modelo del borrador se vincula a la ranura fuerte (el valor por defecto de
 * las sesiones nuevas); la sesión creada se sella a partir de ella en el
 * servidor (modelos por sesión, responsable 2026-09-28).
 */

const DOCK = "mx-auto w-full max-w-[46rem] px-4";

/**
 * Crea, entrega de forma segura el texto de apertura completo y devuelve un
 * destino corto /chat/<id>. Los fallos de almacenamiento/creación dejan
 * intacto el borrador de quien llama. Un iniciador por composer reutiliza una
 * sesión ya creada en un reintento sin cambios. El servidor sella los
 * settings al nacer; no hay PUT de settings.
 */
export async function startDraftSession(
	text: string,
	fetchLike: typeof fetch,
	mode?: "practice",
	picks?: readonly DraftPick[],
	starter = new SessionStarter(),
	settingsIdentity?: string,
): Promise<string | null> {
	const t = text.trim();
	if (!t) return null;
	// LAS ELECCIONES VIAJAN CON LA CREACIÓN (ronda 10 del responsable): un
	// borrador de práctica sembrado desde la barra de elección crea su sesión CON
	// el contexto del grafo — el mismo contrato que el envío de práctica del
	// inicio (el marcador con líneas [id] nombre: enunciado, el conjunto de verdad de la validación de objetivos).
	return starter.start(
		mode === "practice"
			? { title: t, kind: "practice", ...(picks && picks.length > 0 ? { graphContext: { propositions: picks } } : {}) }
			: { title: t },
		fetchLike,
		settingsIdentity,
	);
}

/** El armazón puro (sin router) — la frontera de las pruebas de render: la
 *  superficie visible de la vista de borrador, montada con las mismas piezas
 *  que muestra un chat nuevo. */
/* EL ENVÍO QUE PRIMERO TERMINA + EL FOCO AL ACABAR LA EJECUCIÓN viven en el
 * armazón (es dueño de la instancia de dictado); la verdad del texto se
 * queda en el padre, cuyo envío lee un espejo en REF — ver NewSession más
 * abajo. */
export function DraftShell({
	busy,
	text,
	onChange,
	onSend,
	startError = false,
	setupCta,
	mode = "teach",
	picks = [],
	onOpenPicker,
	onClearPicks,
	overlay,
}: {
	busy: boolean;
	text: string;
	onChange: (v: string) => void;
	onSend: () => void;
	startError?: boolean;
	/** El borrador de práctica (responsable, 2026-10-04): ?mode=practice — la
	 *  sesión creada lleva kind:"practice" y los textos cambian (abre el agente
	 *  de práctica; no hay sondeo). */
	mode?: "teach" | "practice";
	/** La CTA de primera ejecución (fragmento B de la oleada de arreglos): la
	 *  misma indicación "Set up your models" que lleva el inicio, renderizada
	 *  encima del armazón del borrador — la pasa NewSession, que es dueña del
	 *  estado de configuración y del SetupDialog. */
	setupCta?: ReactNode;
	/** LA BARRA DE ELECCIÓN (ronda 10 del responsable): la MISMA píldora que el
	 *  inicio lleva encima de su composer — "Pick nodes" discontinua cuando está
	 *  vacía, recuento + Clear cuando hay elección. La pantalla de borrador no
	 *  tiene un grafo detrás, así que el selector abre el overlay independiente
	 *  de la tabla de cadenas sobre los datos de una instantánea pedida (de la
	 *  que es dueña NewSession). */
	picks?: DraftPick[];
	onOpenPicker?: () => void;
	onClearPicks?: () => void;
	/** LA RANURA DEL SELECTOR (ronda 10b del responsable): el overlay de la
	 *  tabla de cadenas se aloja DENTRO del contenedor relativo de la columna de
	 *  contenido — la misma ley que en la vista del grafo (el overlay llena su
	 *  columna, nunca la barra lateral). Se pasa como nodo para que el estado de
	 *  elección se quede en NewSession. */
	overlay?: ReactNode;
}) {
	const controller = useOptionalInteractionLayers();
	const pathname = usePathname();
	const bodyRef = useRef<HTMLDivElement>(null);
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === "/chat/new", viewKey: "/chat/new", bodyRef });
	const chromeStyle = useSurfaceChromeStyle(surfaceTarget);
	// Dictado por voz (oleada STT, 2026-09-17): los finales se añaden al final
	// del texto del borrador (mediante el onChange del padre — ahí vive la
	// verdad); la tira vive en la ranura central de la barra de estadísticas.
	// Tab navega HACIA el composer (responsable, ronda de teclado 2026-10-06):
	// el único campo de texto de esta superficie — toda la cadena del ciclo.
	const cycleComposer = useCallback((): readonly HTMLElement[] =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-testid="composer"] [data-file-path-input]')),
		[]);
	useFieldCycle(cycleComposer);
	const dictation = useDictation({
		append: (t) => onChange(joinDictation(text, t)),
	});
	// Un dictado EN VIVO mantiene el composer enviable (ronda "no se pierde
	// nada", responsable 2026-10-01): el texto hablado se difiere en el búfer de
	// la ejecución — Enter debe llegar al envío que primero termina, no quedar
	// bloqueado por un textarea vacío. Si no se ha dicho nada, el envío no hace nada.
	const canSend = text.trim().length > 0 || dictation.active;
	/* TERMINA EL DICTADO PRIMERO (responsable, 2026-10-01): detén la ejecución,
	 * deja que los últimos finales lleguen a través de onChange y LUEGO llama al
	 * envío del padre — que lee su espejo en REF, así que el momento del
	 * re-render de React tras el await no puede comerse la cola dictada. */
	const handleSend = () => {
		if (dictation.active) {
			void dictation.finish().then(onSend);
			return;
		}
		onSend();
	};
	/* El final de la ejecución enfoca el composer (responsable, 2026-10-01):
	 * las manos están en el teclado desde la parada — solo en el flanco de
	 * bajada de `active`. */
	const composerInputRef = useRef<HTMLDivElement>(null);
	const dictationWasActiveRef = useRef(false);
	useEffect(() => {
		if (dictation.active) {
			dictationWasActiveRef.current = true;
		} else if (dictationWasActiveRef.current) {
			dictationWasActiveRef.current = false;
			if (isInteractionScopeEligible(composerInputRef.current, controller)) composerInputRef.current!.focus();
		}
	}, [dictation.active, controller]);
	return (
		/* SUPERFICIE DE CREACIÓN SIN CROMO (ronda 11 del responsable, 2026-10-05):
		 * los borradores se suman al registro del inicio — sin TopBar, sin título
		 * (el título con serifa siempre nombra una sesión; un borrador no tiene).
		 * El patrón probado del inicio al pie de la letra: una máscara de arrastre
		 * primero en el DOM, un botón flotante de reabrir (el único punto con
		 * pointer-events-auto) y el estado vacío que da la orientación. El selector
		 * de cadenas es entonces dueño de la parte superior de la columna
		 * exactamente como el de la vista del grafo — sin barras apiladas. */
		<div className="relative flex h-dvh">
			{/* Franja de arrastre de la ventana — deliberadamente PRIMERA en el DOM (la
			ley de la máscara: la resta de no-drag se resuelve por orden del DOM, así
			que todo control recortado más adelante en el árbol resta correctamente). */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<div className="flex min-w-0 flex-1 flex-col">
				<div ref={bodyRef} className="relative flex min-h-0 flex-1">
					{/* El patrón de pointer-events (953b22b): el envoltorio sticky es
					pointer-events-none para que nada aquí bloquee el área del estado
					vacío; la burbuja y la fila de estadísticas lo reactivan ellas mismas. */}
					<div className="pointer-events-none sticky bottom-0 mt-auto w-full">
						<Conversation className="h-full min-w-0 flex-1" initial="instant">
							<ConversationContent className="min-h-full gap-0 p-0">
								<ConversationEmptyState
									title={mode === "practice" ? "New practice session" : "New session"}
									description={
										mode === "practice"
											? "Pick nodes from your knowledge graph, describe what you want to practice, or bring your own problem."
											: "The teacher will open by probing what you already know."
									}
								/>
							</ConversationContent>
						</Conversation>
						<div className="h-24 bg-gradient-to-t from-background via-background/85 to-transparent" />
						<div className="bg-background pb-4">
							<div className={DOCK}>
								<ComposerActions
									picker={(picks.length > 0 || mode === "practice") && (
										<NodePickerControl count={picks.length} onOpen={onOpenPicker} onClear={onClearPicks} />
									)}
									setup={setupCta}
								/>
								{startError && <p role="alert" className="pointer-events-auto mb-2 text-sm text-destructive">{OPENING_PROMPT_FAILURE}</p>}
								<div data-attachment-composer="" className="pointer-events-auto overflow-hidden rounded-2xl border bg-card shadow-lg">
									<Composer
										busy={busy}
										value={text}
										onChange={onChange}
										onSend={handleSend}
										onStop={() => {}}
										canSend={canSend}
										inputRef={composerInputRef}
										autoFocus
										onEscape={dictation.active ? dictation.cancel : undefined}
										// La pregunta de apertura, la misma que la entrada de sesión nueva de la
										// vista del grafo (ronda de refinamiento del responsable, 2026-09-24) — aún
										// no ha empezado ninguna lección, así que el composer no debe parecer que
										// hay una en curso.
										placeholder={mode === "practice" ? "What do you want to practice?" : "What do you want to learn?"}
									/>
								</div>
								<StatsBar
									dictationSlot={<DictationBar dictation={dictation} />}
									turns={[]}
								/>
							</div>
						</div>
					</div>
					<SurfaceRegion target={surfaceTarget}>
						<div className="contents pointer-events-auto">{overlay}</div>
					</SurfaceRegion>
				</div>
			</div>
			{/* El botón flotante de reabrir — pointer-events-none salvo el propio
			botón (el patrón del inicio), pintado DESPUÉS de la columna del overlay
			para que nada de él bloquee el área del lienzo. */}
			<header style={chromeStyle} className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>
		</div>
	);
}

export function NewSession({ initialConfigured, mode = "teach" }: { initialConfigured: boolean; mode?: "teach" | "practice" }) {
	const router = useRouter();
	const [text, setText] = useState("");
	/* El ESPEJO del borrador (ronda "no se pierde nada", 2026-10-01): el envío
	 * que primero termina del armazón llama a ESTE envío tras volcar el dictado
	 * — que llegó mediante setState y puede que aún no se haya re-renderizado.
	 * El envío lee el espejo; cada escritura lo mantiene al día. */
	const textRef = useRef("");
	const applyText = (v: string) => {
		textRef.current = v;
		setText(v);
	};
	const [busy, setBusy] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef(new SessionStarter());
	const [startError, setStartError] = useState(false);
	// LA BARRA DE ELECCIÓN (ronda 10 del responsable): el conjunto elegido elevado
	// del borrador + la instantánea que lee el selector independiente de la tabla
	// de cadenas. Perezoso — el grafo se pide solo en la PRIMERA apertura y luego se reutiliza.
	const [picks, setPicks] = useState<DraftPick[]>([]);
	const picksRef = useRef<DraftPick[]>([]);
	const applyPicks = (next: DraftPick[]) => {
		picksRef.current = next;
		setPicks(next);
	};
	const [pickerOpen, setPickerOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
	const openPicker = () => {
		if (snapshot) {
			setPickerOpen(true);
			return;
		}
		void fetch("/api/graph")
			.then((r) => r.json() as Promise<GraphSnapshot>)
			.then((snap) => {
				setSnapshot(snap);
				setPickerOpen(true);
			})
			.catch(() => {
				/* un grafo inalcanzable deja el borrador usable — sin elecciones */
			});
	};

	// Barrera de primera ejecución (oleada de ranuras de modelo, responsable
	// 2026-09-20): el envío se DESVÍA al flujo de configuración mientras no hay
	// configuración — no hay valores por defecto para 33 proveedores, los chats
	// no pueden empezar. El borrador se queda en el textarea; Save guarda las
	// ranuras y nunca envía (decisión del responsable 2026-10-09) — el alumno envía el borrador.
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);

	const send = useCallback(() => {
		const draft = textRef.current.trim();
		if (!draft || startingRef.current) return;
		if (!configured) {
			setSetupOpen(true);
			return;
		}
		// Las guardas de CLAVES previas al envío (interludio del responsable, sin
		// chats huérfanos): comprobar ANTES de que startDraftSession cree el
		// registro — un primer envío rechazado dejaría si no un chat huérfano con
		// armazón de error en la barra lateral. Sin proveedores se abre la
		// configuración de conexión; una selección no disponible con otro proveedor
		// abre el selector Strong normal. La barrera de admisión del servidor sigue siendo el cinturón.
		if (zeroKeys) {
			setSetupOpen(true);
			return;
		}
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) {
			openModelPicker();
			return; // El alumno lo sustituye explícitamente y vuelve a enviar.
		}
		startingRef.current = true;
		setBusy(true);
		setStartError(false);
		void startDraftSession(draft, fetch, mode === "practice" ? "practice" : undefined, mode === "practice" ? picksRef.current : undefined,
			starterRef.current, JSON.stringify(catalog?.slots.strong))
			.then((target) => {
				if (target) router.push(target);
				else { startingRef.current = false; setBusy(false); }
			})
			.catch(() => {
				startingRef.current = false;
				setBusy(false);
				setStartError(true);
			});
	}, [router, configured, zeroKeys, catalog, mode]);

	return (
		<>
			<DraftShell
				busy={busy}
				startError={startError}
				text={text}
				onChange={applyText}
				onSend={send}
				mode={mode}
				picks={picks}
				onOpenPicker={openPicker}
				onClearPicks={() => applyPicks([])}
				overlay={
					// EL SELECTOR (ronda 10b del responsable): alojado DENTRO de la columna de
					// contenido — absolute inset-0 se resuelve al contenedor relativo de la
					// columna, el mismo confinamiento que le da la vista del grafo; nunca
					// encima de la barra lateral ni de los semáforos de la ventana.
					<ChainTableOverlay
						open={pickerOpen}
						nodes={snapshot?.propositions ?? []}
						chains={snapshot?.chains ?? []}
						sessions={snapshot?.sessions ?? {}}
						fileSources={snapshot?.fileSources ?? {}}
						onClose={() => setPickerOpen(false)}
						selectMode
						controlledSelection={new Set(picks.map((p) => p.id))}
						onSelectionChange={(ids) => {
							const byId = new Map((snapshot?.propositions ?? []).map((n) => [n.id, n]));
							const next: DraftPick[] = [];
							for (const id of ids) {
								const n = byId.get(id);
								if (n) next.push({ id: n.id, name: n.name, statement: n.statement });
							}
							applyPicks(next);
						}}
					/>
				}
				setupCta={
					zeroKeys ? (
						<ZeroKeysPill inline onOpen={() => setSetupOpen(true)} />
					) : (
						!configured && (
							<button
								type="button"
								data-testid="setup-cta"
								onClick={() => setSetupOpen(true)}
								className="rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
							>
								Set up your models
							</button>
						)
					)
				}
			/>
			{/* Configuración de primera ejecución: la superficie a la que llega el desvío
			del envío — la etapa 1 es la pantalla autónoma de la primera clave (oleada sin claves). */}
			<SetupDialog
				open={setupOpen}
				onClose={() => setSetupOpen(false)}
				onDone={() => {
					setSetupOpen(false);
					// Save solo guarda (decisión del responsable 2026-10-09): el borrador
					// espera en el composer; el alumno lo envía.
				}}
				/>
		</>
	);
}