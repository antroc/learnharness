"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SurfaceRegion, usePageSurfaceBoundary, useSurfaceChromeStyle } from "./plugin-surfaces";
import { CornerDownLeftIcon, DumbbellIcon } from "lucide-react";
import { GraphView } from "@/components/graph-view";
import { MinimalHome } from "@/components/minimal-home";
import { SetupDialog } from "@/components/setup-dialog";
import { ComposerActions, NodePickerControl } from "@/components/composer-actions";
import { useModelSetup, selectedModelUnavailable, openModelPicker, ZeroKeysPill } from "@/components/setup-cta";
import { DictationBar, joinDictation, useDictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { SidebarToggle } from "@/components/sidebar";
import { StatsBar } from "@/components/stats-bar";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { PathInput } from "@/components/path-input";
import { AttachFilesButton } from "@/components/attach-files-button";
import { SessionStarter } from "@/components/start-session";
import type { TurnUsage } from "@/src/core";

/**
 * Inicio — el grafo de conocimiento es la vista principal, a sangre de borde a
 * borde (responsable, ronda 1 de la vista de grafo): el lienzo ocupa toda la
 * columna y pasa por debajo de la cabecera y del dock de nueva sesión, que flotan
 * los dos encima sin velos de degradado. Las sesiones viven en la barra lateral
 * conmutable.
 */
export function Home({
	initialConfigured,
	rendering = true,
}: {
	initialConfigured: boolean;
	/** RENDERIZADO DEL GRAFO desactivado (responsable, 2026-10-06): la vista
	 * principal de Inicio es la vista de cadenas, no el lienzo. Se lee en el servidor
	 * en cada navegación — cambiar el ajuste se aplica en la siguiente visita a Inicio. */
	rendering?: boolean;
}) {
	const controller = useOptionalInteractionLayers();
	const router = useRouter();
	const pathname = usePathname();
	const bodyRef = useRef<HTMLDivElement>(null);
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === "/", viewKey: "/", bodyRef });
	const chromeStyle = useSurfaceChromeStyle(surfaceTarget);
	const [topic, setTopic] = useState("");
	/* El ESPEJO del tema (ronda de «nada se pierde», 2026-10-01 — la misma mecánica
	 * que el compositor del chat, decisión de coherencia del responsable): un volcado
	 * del dictado llega mediante setState, invisible para un closure que esperó
	 * durante `await finish()`. Se mantiene al día en cada escritura. */
	const topicRef = useRef("");
	// Barrera de la primera ejecución (oleada de ranuras de modelo, responsable 2026-09-20): los chats no pueden
	// empezar hasta que el usuario elige las tres ranuras — no hay valores por defecto para
	// 33 proveedores. El dock muestra la llamada a la acción mientras no está configurado; enviar
	// un tema abre el diálogo de configuración CONSERVANDO EL BORRADOR (Save
	// solo guarda las ranuras; el alumno envía el mensaje él mismo).
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	// Dictado por voz (oleada STT, 2026-09-17): los finales se añaden al final del
	// borrador del tema; la tira vive en la ranura central de la barra de estadísticas.
	const dictation = useDictation({
		// Primero la ref: la unión lee el espejo, para que el envío que se reanuda tras
		// `await finish()` vea la cola dictada.
		append: (t) => {
			const v = joinDictation(topicRef.current, t);
			topicRef.current = v;
			setTopic(v);
		},
	});
	const [busy, setBusy] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef(new SessionStarter());
	const [startError, setStartError] = useState(false);
	/* El fin de la ejecución enfoca el campo del tema (responsable, 2026-10-01): las
	 * manos están en el teclado por la parada. Solo en el flanco de bajada; el único
	 * destino de dictado de esta superficie ES este textarea, así que no hace falta distinguir casos. */
	const topicInputRef = useRef<HTMLDivElement>(null);
	// Tab navega HACIA DENTRO del compositor del tema (responsable, ronda de teclado
	// 2026-10-06): el único campo de texto de esta superficie — y el compositor de
	// Inicio es su PROPIO textarea, no el componente Composer compartido,
	// así que la cadena es la propia ref (la prueba de humo detectó un selector que
	// aquí no coincidía con nada).
	const cycleTopicField = useCallback(
		(): readonly HTMLElement[] => (topicInputRef.current ? [topicInputRef.current] : []),
		[],
	);
	useFieldCycle(cycleTopicField);
	const dictationWasActiveRef = useRef(false);
	useEffect(() => {
		if (dictation.active) {
			dictationWasActiveRef.current = true;
		} else if (dictationWasActiveRef.current) {
			dictationWasActiveRef.current = false;
			if (isInteractionScopeEligible(topicInputRef.current, controller)) topicInputRef.current!.focus();
		}
	}, [dictation.active, controller]);

	/* MODO PRÁCTICA (responsable, 2026-10-04): el conmutador enseñanza |
	 *  práctica del compositor del grafo — la práctica crea una sesión kind:"practice"
	 *  y puede llevar proposiciones elegidas en la tabla de cadenas (el chip encima
	 *  del compositor abre el selector; lo elegido siembra el prompt inicial).
	 *  No impone ningún formato de entrada — lo elegido es una comodidad. */
	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [practiceProps, setPracticeProps] = useState<{ id: string; name: string; statement: string }[]>([]);
	const [chainSelectOpen, setChainSelectOpen] = useState(false);
	// La tabla de cadenas está CONTROLADA por este conjunto de ids (la elección elevada).
	const pickedIds = useMemo(() => new Set(practiceProps.map((p) => p.id)), [practiceProps]);

	/* PRIMERO TERMINA EL DICTADO (responsable, 2026-10-01): Enter puede llegar con
	 * una ejecución viva y el tema aún aplazado en el búfer de la ejecución — detén la
	 * ejecución, deja que lleguen los últimos finales, DESPUÉS lee el espejo de la REF
	 * (no el closure del estado) y ejecuta. También se aplica antes de las guardas de
	 * configuración/clave, para que un borrador interceptado sea el completo. */
	const start = () => {
		if (!dictation.active) {
			void begin();
			return;
		}
		void dictation.finish().then(() => begin());
	};
	const begin = async () => {
		const t = topicRef.current.trim();
		if (!t || startingRef.current) return;
		// Sin configurar: el envío se INTERCEPTA hacia el flujo de configuración (el borrador
		// se queda en el textarea; el alumno lo envía después de Save).
		if (!configured) {
			setSetupOpen(true);
			return;
		}
		// Las guardas de CLAVE previas al envío (interludio del responsable, sin chats huérfanos): el
		// caso de los modelos se protege ANTES de la creación; los casos de clave también deben hacerlo — un
		// primer envío rechazado dejaría si no un chat huérfano con el envoltorio de error
		// en la barra lateral (el 503 llega solo después de que POST /api/chats
		// ya creara el registro). Sin proveedores se abre la configuración de la conexión;
		// una selección no disponible habiendo otro proveedor abre su selector
		// normal. La barrera de admisión del servidor sigue siendo el cinturón.
		if (zeroKeys) {
			setSetupOpen(true);
			return;
		}
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) {
			openModelPicker();
			return; // Conserva el borrador y no crees nunca una sesión huérfana.
		}
		startingRef.current = true;
		setBusy(true);
		setStartError(false);
		try {
			// El contexto del mapa (responsable, 2026-10-04): lo elegido en CUALQUIERA de los dos modos viaja
			// con la CREACIÓN como graphContext — el servidor escribe un marcador
			// de contexto del grafo como message[0] (un mensaje personalizado aparte,
			// antes del primer mensaje de usuario del alumno, con las proposiciones + las
			// cadenas entre ellas); el prompt sigue siendo las palabras del propio alumno.
			const target = await starterRef.current.start({
				title: t,
				...(mode === "practice" ? { kind: "practice" } : {}),
				...(practiceProps.length > 0 ? { graphContext: { propositions: practiceProps } } : {}),
			}, fetch, JSON.stringify(catalog?.slots.strong));
			router.push(target);
		} catch {
			startingRef.current = false;
			setBusy(false);
			setStartError(true);
		}
	};

	return (
		<div className="relative h-dvh">
			{/* Franja de arrastre de la ventana (cromo fusionado, responsable 2026-09-17): un
			elemento de máscara dedicado, a propósito el PRIMERO en el DOM. La máscara de
			app-region de Electron se resuelve por orden en el DOM — un elemento no-drag solo
			resta las regiones de arrastre que aparecieron ANTES en el árbol —, no por
			z-index, así que la antigua región de arrastre en línea de la cabecera (después de
			<main>) se volvía a añadir encima del recorte de la fila de cromo del grafo y los
			botones arrastraban la ventana. Al ir primero, cada control recortado (fila de
			cromo, tarjeta de detalle del nodo, el conmutador) viene después y resta bien.
			Máscara pura: nunca necesita recibir eventos — la máscara enruta los píxeles. */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />

			{/* La vista principal — a sangre (responsable, ronda 1 de la vista de grafo): sin
			relleno por ningún lado; va de la barra lateral al borde derecho
			y de abajo arriba, por debajo de todo lo demás. Con el
			renderizado DESACTIVADO (graph.rendering, responsable 2026-10-06) es el
			INICIO MÍNIMO — un discreto resumen de la base de conocimiento + lo que sobrevive
			del cromo del grafo; los datos, la extracción y el flujo de elección no se
			tocan, y la tabla de cadenas sigue detrás de su botón. */}
			<div ref={bodyRef} className="absolute inset-0">
			<main className="absolute inset-0">
				{rendering ? (
					<GraphView
						chainSelectOpen={chainSelectOpen}
						practiceSelection={pickedIds}
						onPracticeSelectionChange={setPracticeProps}
						onChainSelectClose={() => setChainSelectOpen(false)}
					/>
				) : (
					<MinimalHome
						chainSelectOpen={chainSelectOpen}
						practiceSelection={pickedIds}
						onPracticeSelectionChange={setPracticeProps}
						onChainSelectClose={() => setChainSelectOpen(false)}
					/>
				)}
			</main>


			{/* Nueva sesión — la misma burbuja flotante que el compositor del chat, acoplada
			ENCIMA del grafo (sin degradado: el grafo pasa limpio por debajo hasta el
			borde inferior). Coincide con la geometría del DOCK de chat.tsx (max-w-[46rem]
			px-4), para que nada se mueva cuando empieza una sesión (responsable). */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5">
				<div className="pointer-events-auto mx-auto w-full max-w-[46rem] px-4">
					{/* La barra de elección (visión del responsable, 2026-10-04): la selección de la
					tabla de cadenas es PERSISTENTE — las proposiciones
					elegidas se muestran aquí como un recuento + Clear en CUALQUIERA de los dos
					modos (sobrevive a los cambios de modo; solo un envío de
					práctica la consume). El modo práctica sin nada elegido
					muestra la PISTA de elección para que la indicación se pueda descubrir;
					el modo enseñanza sin nada elegido no renderiza nada. */}
					<ComposerActions
						picker={(practiceProps.length > 0 || mode === "practice") && (
							<NodePickerControl
								count={practiceProps.length}
								onOpen={() => setChainSelectOpen(true)}
								onClear={() => setPracticeProps([])}
							/>
						)}
						setup={zeroKeys ? (
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
						)}
					/>
					{startError && <p role="alert" className="mb-2 text-sm text-destructive">{OPENING_PROMPT_FAILURE}</p>}
					<form
						data-attachment-composer=""
						className="flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 shadow-lg"
					onSubmit={(e) => {
						e.preventDefault();
						void start();
					}}
				>
					<PathInput
						ref={topicInputRef}
						value={topic}
						onValueChange={(value) => {
							topicRef.current = value;
							setTopic(value);
						}}
						defaultDropTarget
						onKeyDown={(e) => {
							if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
							// Esc termina el dictado (las decisiones del dictado: otro clic o
							// Esc) — stopPropagation lo reclama (oleada A de teclado) para que
							// la cadena de window no aborte también un turno.
							if (e.key === "Escape" && dictation.active) {
								controller?.claimEscape(e);
								e.preventDefault();
								e.stopPropagation();
								dictation.cancel();
								return;
							}
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void start();
							}
						}}
						placeholder={mode === "practice" ? "What do you want to practice?" : "What do you want to learn?"}
						autoFocus
						className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
					/>
					<AttachFilesButton editorRef={topicInputRef} />
					{/* Sin tooltip en el cuadrado de inicio — el glifo ↵ es la
					indicación (responsable, ronda de sutileza 2026-09-25). */}
					<button
						type="submit"
						aria-label="Start session"
						disabled={(!topic.trim() && !dictation.active) || busy}
						className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40"
					>
						<CornerDownLeftIcon className="size-5" />
					</button>
					</form>
					{/* Igual que la barra de estadísticas bajo el compositor de la vista de chat (responsable) — aún
					no hay sesión, así que el lado IZQUIERDO no renderiza nada (barrido de la oleada 7)
					mientras que el DERECHO conserva el control de la ranura Strong (oleada de arreglos: las
					píldoras escriben /api/settings/models). */}
					<StatsBar
						dictationSlot={<DictationBar dictation={dictation} />}
						turns={[] as TurnUsage[]}
						leadingSlot={
							<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="home-mode-switch">
								{(["teach", "practice"] as const).map((m) => (
									<button
										key={m}
										type="button"
										data-testid={`home-mode-${m}`}
										onClick={() => setMode(m)}
										className={
											"flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider transition-colors " +
											(mode === m
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:text-foreground")
										}
									>
										{m === "practice" ? <DumbbellIcon aria-hidden="true" className="size-3" /> : null}
										{m === "teach" ? "Teach" : "Practice"}
									</button>
								))}
							</div>
						}
					/>
				</div>
			</div>

			<SurfaceRegion target={surfaceTarget} />
			</div>
			{/* El cromo flotante del host queda fuera de la cobertura del contenido de la
			página, después de la región, con el mismo rango de superficie propia. La máscara de
			arrastre sigue la primera para que los controles posteriores conserven sus recortes no-drag de Electron. */}
			<header style={chromeStyle} className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>

			{/* Configuración de la primera ejecución (sin configurar): el destino de la llamada a
			la acción y la superficie a la que llega la intercepción del envío — la fase 1 es la
			pantalla autónoma de la primera clave (oleada de cero claves); Save nunca envía — el
			borrador se queda para que lo envíe el alumno (responsable 2026-10-09). */}
			<SetupDialog
				open={setupOpen}
				onClose={() => setSetupOpen(false)}
				onDone={() => {
					setSetupOpen(false);
					// Save solo guarda: el borrador espera en el compositor.
				}}
				/>
		</div>
	);
}
