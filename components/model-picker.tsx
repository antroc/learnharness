"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSettings, ModelCatalogEntry, ModelCatalogResponse, ModelsSettings, UserSettings } from "@/src/core";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList, ThinkingMenuList } from "@/components/settings/model-menu";
import { composeSlotModel } from "@/components/settings/agent-section";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { isInputShortcutScopeEligible } from "@/components/plugin-input-focus";
import { ModelPickerPill } from "@/components/model-picker-pill";
import { Hint } from "@/components/ui/hint";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { useModelCatalog } from "@/components/model-catalog";
export { useModelCatalog } from "@/components/model-catalog";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";

/** provider:id → contextWindow conocido sobre el catálogo en caché, reflejo
 * del join catalogContextLimits del servidor. Los alias de CLI no tienen un
 * denominador global: la barra de estadísticas usa en su lugar el informe
 * real de la CLI de esa sesión. Los límites que faltan siempre se muestran
 * solo como uso, sin una alternativa fijada en el código. */
export function catalogLimits(catalog: Pick<ModelCatalogResponse, "models">): Map<string, number> {
	return new Map(catalog.models.flatMap((m) => m.contextWindow === null ? [] : [[`${m.provider}:${m.id}`, m.contextWindow] as const]));
}

/**
 * EL CONTROL DEL MODELO DE CONVERSACIÓN — de doble vínculo (responsable,
 * modelos por sesión, 2026-09-28). CON un chatId (la barra de estadísticas
 * dentro de la sesión): las píldoras se vinculan al registro PROPIO DE LA
 * SESIÓN — lee GET /api/chats/:id (su campo settings; un registro heredado
 * sin sello recurre a lo que muestra la ranura fuerte, exactamente lo que
 * resuelve el motor) y escribe PUT /api/chats/:id/settings (validado y con
 * el nivel acotado en el servidor). La sesión es dueña de su modelo y su
 * nivel de thinking desde el nacimiento; la ranura fuerte ya nunca la alcanza.
 *
 * SIN chatId (las superficies de borrador — inicio + /chat/new): las
 * píldoras se vinculan a la RANURA FUERTE (lee la sección models en bruto,
 * GET /api/settings; escribe PUT /api/settings/models mediante
 * composeSlotModel — la misma frontera en la que escriben la sección Agent
 * de ajustes y el SetupDialog): elegir ahí ES cambiar el valor por defecto de
 * las sesiones nuevas. Sin elegir se lee "—" (el lenguaje sin alternativa de
 * fábrica: la interfaz nunca presenta un modelo por defecto).
 */
export function ModelControl({ chatId, onModelChange }: { chatId?: string; onModelChange?: (model: string | undefined) => void }) {
	const { catalog, refresh } = useModelCatalog();
	const [models, setModels] = useState<ModelsSettings | undefined>();
	// Una lectura correcta sin settings es una sesión heredada; undefined
	// significa que aún no se conoce ningún registro de sesión, no permiso para heredar Strong.
	const [session, setSession] = useState<{ settings?: ChatSettings }>();
	const [open, setOpen] = useState<"model" | "thinking" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const interactions = useInteractionLayers();

	// La lectura del registro — TANTO el montaje como la señal entre superficies
	// llegan aquí (oleada de arreglos: la escritura de modelos de otra superficie
	// se vuelve a leer en la píldora en vivo; las escrituras propias también
	// avisan, y volver a pedir es idempotente). Doble vínculo: el modo chat lee
	// TANTO el registro de la sesión (la fuente de verdad) como la sección models
	// (la alternativa de visualización para una sesión heredada sin sello —
	// exactamente lo que resuelve el motor); el modo borrador lee solo la sección models.
	const readRecord = useCallback(() => {
		if (chatId) {
			fetch(`/api/chats/${chatId}`)
				.then((r) => { if (!r.ok) throw new Error(`session read failed: ${r.status}`); return r.json() as Promise<{ settings?: ChatSettings }>; })
				.then((body) => setSession({ settings: body.settings }))
				.catch(() => {
					/* la misma postura de solo lectura que un fallo de la sección models */
				});
		}
		fetch("/api/settings")
			.then((r) => r.json() as Promise<{ settings: { models?: ModelsSettings } | null }>)
			.then((body) => setModels(body.settings?.models ?? undefined))
			.catch(() => {
				/* si falla la petición del registro, el control queda en solo lectura
				(disparadores "—", menús cerrados) — la misma postura que un fallo
				del catálogo */
			});
	}, [chatId]);

	useEffect(() => {
		readRecord();
	}, [readRecord]);

	useSettingsSaved((section) => {
		if (section === "models") readRecord();
	});

	// Verdad de doble vínculo: el modo chat muestra el registro propio de la
	// sesión, y recurre a Strong solo en una sesión heredada sin sello leída con
	// éxito — EXACTAMENTE lo que ejecuta resolveConversationSpec. Una lectura del
	// registro sin resolver o fallida no debe presentar una preferencia global
	// provisional como identidad de esta sesión (tampoco ante la guarda de Send).
	// El modo borrador es la propia ranura fuerte.
	const strong = models?.strong;
	const override: ChatSettings | undefined = chatId
		? session ? {
				model: session.settings?.model ?? strong?.model,
				thinkingLevel: session.settings?.thinkingLevel ?? strong?.thinkingLevel,
			} : undefined
		: strong;
	const effectiveId = override?.model?.id;
	const effectiveProvider = override?.model?.provider;
	useEffect(() => {
		onModelChange?.(effectiveProvider && effectiveId ? `${effectiveProvider}:${effectiveId}` : undefined);
	}, [effectiveProvider, effectiveId, onModelChange]);
	const storedLevel = override?.thinkingLevel;
	const entry = catalog?.models.find(
		(m) => m.id === effectiveId && m.provider === effectiveProvider,
	);
	const levels = entry?.supportedLevels ?? [];
	// Visualización heredada (fragmento 2, punto 4, responsable): un registro con
	// modelo pero sin nivel guardado muestra el nivel RESUELTO — el primero
	// admitido del orden — porque es exactamente lo que ejecutaría el motor. Solo
	// visual: el registro sigue sin valor hasta que una elección nueva lo rellena.
	const effectiveLevel = storedLevel ?? (entry ? defaultOrderLevel(levels) : undefined);

	// El contrato intuitivo del desplegable (responsable, ronda 1 del control de
	// estadísticas): cualquier clic fuera del menú abierto — o pulsar Esc — lo
	// cierra. La propia superficie del menú lo mantiene abierto: los botones de
	// alternar viven dentro del contenedor, y el CUERPO del menú vive en un portal
	// en document.body (MenuShell) — nunca es descendiente del contenedor, así
	// que sus filas se recortan mediante [data-lh-menu] (la disciplina de las
	// secciones de ajustes; sin ella, el pointerdown de una fila cuenta como
	// externo y se come la elección — detectado en vivo en la oleada de arreglos, roto desde la migración a MenuShell).
	useEffect(() => {
		if (open === null) return;
		const onPointerDown = (e: PointerEvent) => {
			const popup = interactions.getTopLayer();
			if (popup?.kind !== "popup" || !containerRef.current?.contains(popup.anchorRef?.current ?? null) || !interactions.isElementEligible(popup.rootRef.current)) return;
			const t = e.target as Element;
			if (t instanceof Element && t.closest("[data-lh-menu]")) return;
			if (containerRef.current && !containerRef.current.contains(t)) {
				setOpen(null);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open, interactions]);

	// Una sola frontera de escritura: composeSlotModel conserva las ranuras
	// hermanas cheap/vision (disciplina de sustituir la sección entera) y la
	// independencia por campo de model + thinkingLevel dentro de la ranura fuerte.
	const save = useCallback(
		async (next: ModelsSettings) => {
			setError(null);
			try {
				const res = await fetch("/api/settings/models", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(next),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					setError(body.error ?? `settings rejected (${res.status})`);
					return;
				}
				// Verdad del servidor, nunca el cuerpo de la petición (oleada de arreglos):
				// una elección que lleva un nivel no admitido llega ACOTADA al registro
				// — la píldora debe mostrar el valor guardado en esta interacción.
				const stored = (
					(await res.json().catch(() => null)) as { settings?: UserSettings } | null
				)?.settings?.models;
				setModels(stored ?? next);
				setOpen(null);
				notifySettingsSaved("models");
			} catch {
				setError("Could not reach the server — try again.");
			}
		},
		[],
	);

	// La frontera de escritura de la sesión (modo chat): PUT a la ruta de
	// settings por chat — validado y con el nivel acotado en el servidor; la
	// respuesta es la verdad guardada (una elección con un nivel no admitido
	// llega ACOTADA — la píldora muestra el valor guardado). Sin
	// notifySettingsSaved: la escritura toca el registro de una sesión, no las ranuras — ninguna otra superficie lo lee.
	const saveChat = useCallback(
		async (next: ChatSettings) => {
			setError(null);
			try {
				const res = await fetch(`/api/chats/${chatId}/settings`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(next),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					setError(body.error ?? `settings rejected (${res.status})`);
					return;
				}
				const stored = (await res.json().catch(() => null)) as { settings?: ChatSettings } | null;
				setSession({ settings: stored?.settings ?? next });
				setOpen(null);
			} catch {
				setError("Could not reach the server — try again.");
			}
		},
		[chatId],
	);

	// Una sola frontera de aplicación sobre ambas rutas de escritura: una
	// elección nombra provider + id + nivel; el modo chat escribe el registro
	// propio de la sesión (cualquier elección lo fija), el modo borrador compone
	// la ranura fuerte (hermanas conservadas, disciplina de sustituir la sección entera).
	const apply = useCallback(
		(provider: string, id: string, level: ThinkingLevel | undefined) => {
			if (chatId) {
				void saveChat({ model: { provider, id }, thinkingLevel: level });
			} else {
				// La convención de cadena vacía de composeSlotModel: sin nivel = sin valor.
				void save(composeSlotModel(models, "strong", provider, id, level ?? ""));
			}
		},
		[chatId, models, save, saveChat],
	);

	// Fronteras de atajos (oleada de teclado A): ⌘K abre el menú de modelos (la
	// convención universal de comandos); Shift+Tab recorre el nivel de thinking
	// hacia arriba por la escalera (con vuelta) — la sustitución que eligió el
	// responsable para el foco por tabulador del navegador. Ambos funcionan desde cualquier foco, incluso a mitad de escribir.
	useEffect(() => {
		const onOpenPicker = () => {
			if (!isInputShortcutScopeEligible(containerRef.current, interactions)) return;
			setOpen("model");
			setError(null);
			refresh(); // los cambios de claves a mitad de sesión amplían el menú (arreglo de caché)
		};
		window.addEventListener("lh:kbd-open-model-picker", onOpenPicker);
		return () => window.removeEventListener("lh:kbd-open-model-picker", onOpenPicker);
	}, [refresh, interactions]);

	useEffect(() => {
		const onCycleThinking = () => {
			if (!isInputShortcutScopeEligible(containerRef.current, interactions)) return;
			if (levels.length === 0) return;
			const idx = effectiveLevel === undefined ? -1 : levels.indexOf(effectiveLevel);
			const next = levels[(idx + 1) % levels.length];
			if (next === undefined) return;
			apply(effectiveProvider ?? "", effectiveId ?? "", next);
		};
		window.addEventListener("lh:kbd-cycle-thinking", onCycleThinking);
		return () => window.removeEventListener("lh:kbd-cycle-thinking", onCycleThinking);
	}, [levels, effectiveLevel, effectiveProvider, effectiveId, apply, interactions]);

	// Seleccionar un modelo (clic y Enter comparten una ruta): conservar el
	// nivel de thinking solo cuando el nuevo modelo lo admite — si no, se
	// descarta (arrastrarlo daría un 400 en la barrera de catálogo del servidor).
	const pickModel = (m: ModelCatalogEntry) => {
		// Autorrelleno (fragmento 2, responsable: "rellenar en todas partes"): una
		// elección nueva SIEMPRE escribe un nivel — el GUARDADO va tal cual (la
		// escritura lo acota en el servidor cuando el nuevo modelo no lo admite; la
		// señal vuelve a leer y se muestra la verdad acotada), y un registro sin
		// nivel guardado rellena el nivel del orden. El estado sin valor nunca puede
		// volver a entrar por esta puerta. (El nivel DERIVADO que se muestra nunca
		// viaja — pertenece al modelo VIEJO; el nivel de la elección nueva sale de
		// la propia escalera del modelo nuevo.)
		const nextLevel = populateLevel(storedLevel, m.supportedLevels);
		apply(m.provider, m.id, nextLevel);
	};

	// Stale-while-revalidate también al abrir a mano (⌘K cubre la ruta del
	// teclado de arriba): la lista en caché se muestra al instante y la
	// federación fresca la sustituye cuando llega.
	const openMenu = (kind: "model" | "thinking") => {
		setOpen((o) => (o === kind ? null : kind));
		setError(null);
		if (kind === "model") refresh();
	};

	return (
		<div ref={containerRef} className="relative flex items-center gap-1.5" data-testid="model-control">
			<Hint
				label={effectiveId ? `${effectiveProvider ? `${effectiveProvider}:` : ""}${effectiveId}` : "Model selector"}
				action="open-model-picker"
				side="bottom"
			>
				<ModelPickerPill
					data-testid="stats-model"
					onClick={() => openMenu("model")}
					aria-expanded={open === "model"}
				>{effectiveId ? prettyModel(effectiveId) : "—"}</ModelPickerPill>
			</Hint>
			<Hint
				// "Thinking" + su atajo real a través del registro (interludio del
				// responsable, 2026-09-25): ⇧⇥ recorre el nivel, así que "Thinking (⇧⇥)" —
				// se reasigna en vivo como todo sufijo Hint.
				label="Thinking"
				action="cycle-thinking"
				side="bottom"
			>
				<ModelPickerPill
					data-testid="stats-thinking"
					onClick={() => {
						if (entry === undefined) return;
						openMenu("thinking");
					}}
					aria-expanded={open === "thinking"}
				>{effectiveLevel === undefined ? "—" : (THINKING_LABEL[effectiveLevel] ?? effectiveLevel)}</ModelPickerPill>
			</Hint>

			{/* El cuerpo de desplegable compartido (extraído el 2026-09-20): los
			selects de ranura de los ajustes del agente y el diálogo de configuración
			usan exactamente el mismo. */}
			{open === "model" && (
				<MenuShell
					anchorRef={containerRef}
					testid="model-menu" onClose={() => { setOpen(null); return "closed"; }}
					preferredSide="up"
					menuClass="flex w-[22rem] flex-col rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					{error && <div className="mb-1.5 text-destructive">{error}</div>}
					<ModelMenuList
						models={catalog?.models}
						effectiveId={effectiveId}
						effectiveProvider={effectiveProvider}
						onPick={pickModel}
						footer={
							catalog && catalog.models.length === 0
								? "No models — add a provider key in Keys"
								: chatId
									? "This session's model"
									: "Strong tier — the default for new sessions"
						}
					/>
				</MenuShell>
			)}

			{open === "thinking" && (
				<MenuShell
					anchorRef={containerRef}
					testid="thinking-menu" onClose={() => { setOpen(null); return "closed"; }}
					preferredSide="up"
					menuClass="flex w-44 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<ThinkingMenuList
						levels={catalog ? levels : []}
						effectiveLevel={effectiveLevel}
						onPick={(level) => apply(effectiveProvider ?? "", effectiveId ?? "", level as ThinkingLevel)}
						empty={catalog ? (effectiveId ? `${prettyModel(effectiveId)} has no thinking levels.` : "Pick a model first.") : "Loading…"}
						footer="Levels this model actually supports"
					/>
					{error && <div className="mt-1 text-destructive">{error}</div>}
				</MenuShell>
			)}
		</div>
	);
}