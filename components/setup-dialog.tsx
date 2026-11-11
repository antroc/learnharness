"use client";
/**
 * El flujo de configuración de primera ejecución (oleada de ranuras de
 * modelo, 2026-09-20, diseño del responsable "A — CTA en el composer +
 * desvío del envío"): los chats no pueden empezar hasta que el usuario haya
 * elegido las tres ranuras de modelo — no hay valores por defecto para 33
 * proveedores. El dock de sesión nueva de la vista del grafo (el inicio de la
 * app, donde empiezan los chats) muestra una CTA "Set up your models"
 * mientras no hay configuración; enviar un tema — o enviar en /chat/new —
 * abre ESTE diálogo con el borrador conservado; Save guarda las ranuras — el
 * borrador ESPERA en el composer y el alumno lo envía él mismo (decisión del
 * responsable 2026-10-09: guardar los modelos nunca debe enviar el mensaje).
 *
 * POR ETAPAS SEGÚN DEPENDENCIA (responsable, 2026-09-20: "primero las
 * claves, luego los modelos — no tiene sentido presentar el selector de
 * modelos antes de que el usuario haya puesto una clave, porque entonces no
 * hay modelos que elegir"):
 *   Catálogo desconocido — carga neutra (o error/Retry), nunca una pantalla de claves.
 *   Etapa 1 — sin proveedor con clave ni selección guardada: una pantalla
 *     AUTÓNOMA de primera clave (oleada sin claves, responsable 2026-09-25):
 *     selector de proveedor + un input de clave + guardado vía
 *     PUT /api/keys/:id. El diálogo SIGUE MONTADO — guardar despacha la
 *     señal "keys", el efecto de petición se vuelve a ejecutar con ella y la
 *     etapa cambia sola a los selectores. Ya no hay ida y vuelta por
 *     Settings; el borrador vive en el estado de quien llama, intacto todo
 *     el tiempo.
 *   Etapa 2 — selectores Strong → Cheap → Vision sobre el catálogo FEDERADO
 *     (solo proveedores con clave), con la ranura de visión filtrada a los
 *     modelos que admiten imágenes, en el lenguaje de desplegables
 *     compartido de la app (ModelMenuList). Las selecciones desconectadas
 *     guardadas y las ediciones se conservan internamente en la etapa
 *     exclusiva de proveedores. Conectar con todas las ranuras ya guardadas
 *     cierra la configuración; si no, los selectores solo piden las ranuras
 *     que faltan. Las tres son obligatorias (responsable: sin saltar, sin
 *     valores por defecto); Save hace PUT de la sección models e informa con
 *     onDone(models).
 *
 * Se puede cerrar sin configurar (Esc/fondo/✕) — sigue siendo posible
 * navegar por la app; la BARRERA es el desvío del envío, no el diálogo. El
 * lenguaje visual del diálogo de ajustes: fondo atenuado, tarjeta con borde
 * rounded-md, título en CMU, z-50.
 */

import { useEffect, useRef, useState } from "react";
import { HostDialog } from "@/components/host-dialog";
import { useInteractionLayers } from "@/components/interaction-layers";
import type React from "react";
import { type ModelCatalogEntry, type ModelSlotName, type ModelsSettings, CUSTOM_PROVIDER } from "@/src/core";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList } from "@/components/settings/model-menu";
import { MenuShell } from "@/components/menu-shell";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { useModelCatalog } from "@/components/model-catalog";
import { savedSlotsConfigured } from "@/components/setup-cta";
import { Hint } from "@/components/ui/hint";
import { type ProviderKeyInfo, CUSTOM_PROVIDER_INFO, CustomEndpointSetup } from "@/components/settings/keys-section";
import { ProviderMenuList } from "@/components/settings/model-menu";
import { ChatGPTBackgroundAccess } from "@/components/settings/chatgpt-connection";
import { NativeSubscriptionBackgroundAccess, SubscriptionConnections } from "@/components/settings/subscription-connections";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";
import { ThinkingMenuList } from "@/components/settings/model-menu";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** La identidad de ranura de los selectores — el mismo lenguaje de lista
 *  que las filas de ranura de la sección Agent. */
const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "Prober, teacher" },
	cheap: { label: "Cheap", roster: "Researcher, demo builder, extractor, auditor" },
	vision: { label: "Vision", roster: "Visual maker + PDF reader" },
};
const SLOT_ORDER: readonly ModelSlotName[] = ["strong", "cheap", "vision"];

/** Los campos de la respuesta de GET /api/models que consume el flujo. */
interface ModelsBody {
	models: ModelCatalogEntry[];
	providers: { id: string; keyPresent: boolean }[];
	/** Las fijaciones RESUELTAS de los tres niveles (BYOK: NULL por cada nivel
	 *  sin valor) — el PRERRELLENO + las marcas "needed" (responsable,
	 *  2026-09-22): los niveles fijados se abren con su elección, los no fijados
	 *  llevan la marca. */
	slots?: Record<ModelSlotName, { model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null>;
}

/** Pura: en qué etapa se abre el flujo — sin proveedor con clave = primero
 *  las claves (el orden de dependencias del responsable). Exportada para las pruebas. */
export function setupStage(
	providers: { id: string; keyPresent: boolean }[] | null,
): "loading" | "keys" | "pickers" {
	if (providers === null) return "loading";
	return providers.some((p) => p.keyPresent) ? "pickers" : "keys";
}

type ModelSelection = Pick<ModelCatalogEntry, "provider" | "id">;

/** La identidad guardada es independiente de los metadatos seleccionables. Una fijación
 * desconectada sigue prerrellenando; solo el menú se limita al catálogo vivo. */
export function prefillFromSlots(
	models: ModelCatalogEntry[],
	slots: Record<ModelSlotName, { model: { provider: string; id: string } } | null> | undefined,
): Partial<Record<ModelSlotName, ModelSelection>> {
	const pre: Partial<Record<ModelSlotName, ModelSelection>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = slots?.[slot];
		const entry = pin?.model
			? models.find((m) => m.provider === pin.model!.provider && m.id === pin.model!.id)
			: undefined;
		if (pin?.model) pre[slot] = entry ?? pin.model;
	}
	return pre;
}

/** Prerrelleno del nivel (fragmento 2): un nivel fijado se abre con su nivel
 *  GUARDADO tal cual (Save lo acota en el servidor si la escalera caducó);
 *  si no, el nivel del orden para ese modelo — el que rellenaría una
 *  elección nueva (responsable: el único propósito del orden es la primera
 *  asignación). Exportada como pura para las pruebas. */
export function prefillLevelFromPin(
	entry: ModelCatalogEntry,
	pin: { thinkingLevel?: ThinkingLevel } | null | undefined,
): ThinkingLevel {
	return populateLevel(pin?.thinkingLevel, entry.supportedLevels);
}

/** El cuerpo puro de la etapa 1 — exportado para las fijaciones de SSR (el
 *  patrón de cuerpo de delete/settings). El envoltorio es dueño del estado +
 *  los efectos + el portal.
 *
 * La pantalla de primera clave (responsable, oleada sin claves): selector de
 * proveedor (el lenguaje de desplegables compartido de la app,
 * ProviderMenuList), un input para pegar, Save. Un guardado que da 400
 * mantiene la línea en línea (las barreras de forma de la sección de claves
 * escriben un texto de error para el usuario). */
export function SetupKeysBody({
	providers,
	provider,
	value,
	saving,
	error,
	menuOpen,
	onToggleMenu,
	onCloseMenu,
	onPick,
	onValue,
	onSave,
	menuAnchor,
	isCustom,
	onCustomSaved,
}: {
	/** La lista completa de proveedores (providers de GET /api/keys) — undefined
	 *  mientras se carga; el selector renderiza entonces un estado vacío honesto. */
	providers: ProviderKeyInfo[] | undefined;
	/** El proveedor elegido; null = el disparador del selector muestra "Pick a
	 *  provider…". */
	provider: ProviderKeyInfo | null;
	value: string;
	saving: boolean;
	error: string | null;
	menuOpen: boolean;
	onToggleMenu: () => void;
	onCloseMenu?: () => void;
	onPick: (p: ProviderKeyInfo) => void;
	onValue: (v: string) => void;
	onSave: () => void;
	/** El ancla del MenuShell — la conecta el envoltorio (su triggerRef). */
	menuAnchor: React.RefObject<HTMLDivElement | null>;
	/** El proveedor elegido es el endpoint personalizado: un campo de URL base se suma al
	 *  campo de la clave. Los tres son opcionales para que quien usa solo la clave (y las pruebas) no cambie. */
	isCustom?: boolean;
	onCustomSaved?: () => void;
}) {
	return (
		<div className="flex flex-col gap-3 px-6 py-5" data-testid="setup-stage-keys">
			<p className="text-xs text-muted-foreground">
				Choose your AI provider and paste its API key. You’ll pick your models next.
			</p>
			<div className="flex flex-col gap-2">
				<div ref={menuAnchor} className="relative max-w-96">
					<button
						type="button"
						aria-label="Provider"
						data-testid="setup-key-provider"
						aria-expanded={menuOpen}
						onClick={onToggleMenu}
						className="flex h-7 w-full items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50"
					>
						<span className="min-w-0 flex-1 truncate text-left">{provider ? provider.label : "Pick a provider…"}</span>
						<span aria-hidden className="text-muted-foreground">
							▾
						</span>
					</button>
					{menuOpen && (
						<MenuShell
							anchorRef={menuAnchor}
							testid="setup-key-provider-menu"
							onClose={() => { onCloseMenu?.(); return "closed"; }}
							preferredSide="down"
							align="left"
							menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
						>
							<ProviderMenuList providers={providers ?? []} onPick={onPick} />
						</MenuShell>
					)}
				</div>
				{provider && (isCustom ? <CustomEndpointSetup onSaved={onCustomSaved ?? onSave} /> : (
					<div className="flex max-w-96 flex-col gap-2">
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={value}
								onChange={(e) => onValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && value.trim()) onSave();
								}}
								placeholder="Paste key…"
								aria-label={`${provider.label} key`}
								data-testid="setup-key-input"
								disabled={saving}
								autoFocus
								className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
							/>
							<button
								type="button"
								onClick={onSave}
								disabled={saving || !value.trim()}
								data-testid="setup-key-save"
								className="shrink-0 rounded-sm border border-border bg-background px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving ? "Saving…" : "Save key"}
							</button>
						</div>
					</div>
				))}
				{error && (
					<p role="alert" data-testid="setup-key-error" className="text-xs text-error">
						{error}
					</p>
				)}
			</div>
			<div className="mt-2 border-t border-border/60 pt-4"><h3 className="mb-3 font-ui text-xs text-muted-foreground">Subscriptions</h3><SubscriptionConnections setup /></div>
		</div>
	);
}

function prefillLevels(body: ModelsBody | undefined): Partial<Record<ModelSlotName, ThinkingLevel>> {
	const levels: Partial<Record<ModelSlotName, ThinkingLevel>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = body?.slots?.[slot];
		const entry = body?.models.find((m) => m.provider === pin?.model.provider && m.id === pin.model.id);
		if (pin?.thinkingLevel !== undefined) levels[slot] = pin.thinkingLevel;
		else if (entry) levels[slot] = prefillLevelFromPin(entry, pin);
	}
	return levels;
}

interface SetupDialogProps {
	open: boolean;
	onClose: () => void;
	/** Guardar nunca envía el borrador de quien llama. */
	onDone: (models: ModelsSettings) => void;
}

export function SetupDialog(props: SetupDialogProps) {
	// Una apertura es dueña de su borrador. Sembrar la caché al montar evita un primer
	// fotograma con la pantalla de claves, y reabrir no puede reutilizar las ediciones de una apertura anterior.
	return props.open ? <OpenSetupDialog {...props} /> : null;
}

function OpenSetupDialog({ onClose, onDone }: SetupDialogProps) {
	const controller = useInteractionLayers();
	const { catalog, failed, refresh } = useModelCatalog();
	const providerStageSeen = useRef(false);
	const connectionCloseRequested = useRef(false);
	const [picked, setPicked] = useState(() => prefillFromSlots(catalog?.models ?? [], catalog?.slots));
	const [levels, setLevels] = useState(() => prefillLevels(catalog));
	const editedSlots = useRef(new Set<ModelSlotName>());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<{ slot: ModelSlotName; kind: "model" | "thinking" } | null>(null);
	// La pantalla de primera clave de la etapa 1 (oleada sin claves): la lista de proveedores,
	// el proveedor elegido + el valor pegado, su par ocupado/error y su propio
	// bit de menú abierto (la maquinaria de descarte de los menús de ranura también lo cubre —
	// ver la rama del testid del disparador más abajo).
	const [keyProviders, setKeyProviders] = useState<ProviderKeyInfo[] | undefined>(undefined);
	const [keyProvider, setKeyProvider] = useState<ProviderKeyInfo | null>(null);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keyMenuOpen, setKeyMenuOpen] = useState(false);
	// El envoltorio del disparador del selector de proveedores de la etapa 1 — el ancla del armazón compartido.
	// Los menús de ranura de la etapa 2 se anclan en cambio por anchorTestid — ver el
	// MenuShell de ranura más abajo para saber por qué ahí no puede funcionar una ref recién enganchada.
	const keyTriggerRef = useRef<HTMLDivElement>(null);

	// La señal de claves (oleada sin claves): la despachan los guardados/borrados de keys-section Y
	// el guardado de primera clave de ESTE diálogo; el efecto de petición de abajo
	// se vuelve a ejecutar con ella, así que guardar una clave amplía el catálogo. Las ranuras guardadas
	// incompletas avanzan a los selectores; las completas simplemente cierran la configuración.
	const [keysTick, setKeysTick] = useState(0);
	useSettingsSaved((section) => {
		if (section === "keys") setKeysTick((t) => t + 1);
	});

	useEffect(() => {
		let cancelled = false;
		fetch("/api/keys")
			.then((r) => r.json())
			.then((b: { providers?: ProviderKeyInfo[] }) => { if (!cancelled) setKeyProviders(b.providers ?? []); })
			.catch(() => { if (!cancelled) setKeyProviders([]); });
		return () => { cancelled = true; };
	}, [keysTick]);

	useEffect(() => {
		if (!catalog) return;
		const pre = prefillFromSlots(catalog.models, catalog.slots);
		const preLevels = prefillLevels(catalog);
		// Siempre se usan los metadatos frescos, pero una respuesta no puede reiniciar una
		// ranura editada, incluido un nivel elegido mientras la petición estaba pendiente.
		setPicked((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (pre[slot]) next[slot] = pre[slot]; else delete next[slot];
			}
			return next;
		});
		setLevels((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (preLevels[slot] !== undefined) next[slot] = preLevels[slot]; else delete next[slot];
			}
			return next;
		});
	}, [catalog]);

	const stage = setupStage(catalog?.providers ?? null);
	const closeAfterConnection = stage === "pickers" && providerStageSeen.current && savedSlotsConfigured(catalog?.slots);
	useEffect(() => {
		if (stage === "keys") providerStageSeen.current = true;
		if (closeAfterConnection && !connectionCloseRequested.current) {
			connectionCloseRequested.current = true;
			onClose(); // Recuperar la conexión no es guardar los ajustes de modelos.
		}
	}, [stage, closeAfterConnection, onClose]);

	// Mantén la política de punteros externos existente de la configuración; MenuShell y HostDialog
	// son dueños del Escape de hoja hacia arriba, también mientras un diálogo de conexión tapa la configuración.
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element)) return;
			const t = e.target;
			if (keyMenuOpen && controller.isElementEligible(document.querySelector('[data-testid="setup-key-provider-menu"]'))) {
				if (t.closest("[data-lh-menu]") || t.closest('[data-testid="setup-key-provider"]')) return;
				setKeyMenuOpen(false);
			}
			if (openMenu === null) return;
			const menuTestid = openMenu.kind === "model" ? `setup-menu-${openMenu.slot}` : `setup-thinking-menu-${openMenu.slot}`;
			if (!controller.isElementEligible(document.querySelector(`[data-testid="${menuTestid}"]`))) return;
			const triggerTestid =
				openMenu.kind === "model" ? `setup-trigger-${openMenu.slot}` : `setup-thinking-${openMenu.slot}`;
			if (t.closest("[data-lh-menu]") || t.closest(`[data-testid="${triggerTestid}"]`)) return;
			setOpenMenu(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [controller, openMenu, keyMenuOpen]);

	// No pintes brevemente los selectores de modelos entre una conexión con éxito y
	// el cierre de una configuración ya completa. Sin escrituras de modelo/thinking guardados.
	if (closeAfterConnection) return null;

	const allPicked = SLOT_ORDER.every((s) => picked[s]);

	/** El guardado de la etapa 1: PUT de la clave pegada, despacho de la señal
	 *  de claves y LIMPIEZA del campo de clave local. El catálogo fresco decide
	 *  si cerrar la recuperación o avanzar a las ranuras de modelo que faltan.
	 *  Los 400 de las barreras de forma mantienen su línea para el usuario en línea. */
	async function saveKey() {
		if (!keyProvider || keySaving) return;
		if (!keyValue.trim()) return;
		setKeySaving(true);
		setKeyError(null);
		const res = await fetch(`/api/keys/${encodeURIComponent(keyProvider.envVar)}`, {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ value: keyValue }),
					}).catch(() => null);
		setKeySaving(false);
		if (!res || !res.ok) {
			const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setKeyError(res ? (body?.error ?? `Save failed (${res.status})`) : "Save failed. Check your connection and try again.");
			return;
		}
		setKeyProvider(null);
		setKeyValue("");
		notifySettingsSaved("keys");
	}

	async function save() {
		if (!allPicked || saving) return;
		setSaving(true);
		setError(null);
		const models: ModelsSettings = {};
		for (const slot of SLOT_ORDER) {
			const level = levels[slot];
			models[slot] = {
				// Los controles avanzados quedan fuera de la configuración; nunca borres su elección guardada.
				...(catalog?.slots[slot]?.cacheRetention !== undefined ? { cacheRetention: catalog.slots[slot]!.cacheRetention } : {}),
				model: { provider: picked[slot]!.provider, id: picked[slot]!.id },
				...(level ? { thinkingLevel: level } : {}),
			};
		}
		const res = await fetch("/api/settings/models", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(models),
		}).catch(() => null);
		if (!res || !res.ok) {
			setSaving(false);
			setError(res ? `Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}` : "Save failed. Check your connection and try again.");
			return;
		}
		notifySettingsSaved("models");
		onDone(models);
	}

	const keysBody = <SetupKeysBody
		providers={keyProviders ? [...keyProviders, CUSTOM_PROVIDER_INFO] : undefined}
		provider={keyProvider}
		value={keyValue}
		saving={keySaving}
		error={keyError}
		menuOpen={keyMenuOpen}
		menuAnchor={keyTriggerRef}
		isCustom={keyProvider?.id === CUSTOM_PROVIDER.id}
		onCustomSaved={() => { setKeyProvider(null); notifySettingsSaved("keys"); }}
		onToggleMenu={() => setKeyMenuOpen((v) => !v)}
		onCloseMenu={() => setKeyMenuOpen(false)}
		onPick={(p) => { setKeyProvider(p); setKeyMenuOpen(false); setKeyError(null); }}
		onValue={setKeyValue}
		onSave={() => void saveKey()}
	/>;

	return <HostDialog open onClose={() => { onClose(); return "closed"; }} aria-label="Set up your models"
		backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-background/80", "data-testid": "setup-backdrop" }}
		frame={<div data-testid="setup-dialog"
			className="settings-dialog-pop flex max-h-[85vh] w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
			onClick={(e) => e.stopPropagation()} />}>
				<header className="flex h-15 shrink-0 items-center gap-3 border-b border-border px-5">
					<h2 className="font-title text-2xl tracking-tight">Set up your models</h2>
					<Hint label="Close" binding="escape" side="left">
<button
						type="button"
						aria-label="Close setup"
						data-testid="setup-close"
						onClick={onClose}
						className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
					>
						✕
					</button>
</Hint>
				</header>

				{failed && (
					<p role="alert" data-testid="setup-catalog-error" className="px-6 py-3 text-sm text-foreground">
						Model catalog could not be loaded. Check the connection and retry. <button type="button" data-testid="setup-retry" className="underline" onClick={refresh}>Retry</button>
					</p>
				)}
				{stage === "loading" ? (
					!failed && <p data-testid="setup-stage-loading" role="status" className="px-6 py-5 text-xs text-muted-foreground">Loading models…</p>
				) : stage === "keys" ? (
					<div className="flex flex-col px-6 py-5">{keysBody}</div>
				) : (
					<div className="flex flex-col gap-4 overflow-y-auto px-6 py-5" data-testid="setup-stage-pickers">
						<p className="text-xs text-muted-foreground">
							Pick the model for each tier. All three are required before chats can start.
						</p>
						{SLOT_ORDER.map((slot) => {
							const entry = picked[slot];
							const level = levels[slot];
							const metadata = catalog?.models.find((m) => m.id === entry?.id && m.provider === entry.provider);
							// Unos metadatos no disponibles no pueden borrar ni acotar una preferencia guardada.
							const levelsForEntry = metadata?.supportedLevels ?? (entry ? Object.keys(THINKING_LABEL) : []);
							const available = catalog?.models ?? (failed ? [] : undefined);
							const slotCatalog = slot === "vision"
								? available?.filter((m) => m.input.includes("image") || m.provider === CUSTOM_PROVIDER.id)
								: available;
							return (
								<div key={slot} data-testid={`setup-slot-${slot}`} className="flex flex-col gap-1.5">
									<span className="flex items-center gap-1.5">
										<span className="font-ui text-sm text-foreground">{SLOT_META[slot].label}</span>
										{!catalog?.slots?.[slot]?.model && !picked[slot] && (
											<span
												data-testid={`setup-needed-${slot}`}
												className="rounded-sm border border-border px-1 py-0.5 text-[10px] font-normal tracking-wide text-muted-foreground"
											>
												needed
											</span>
										)}
									</span>
									<span className="text-xs text-muted-foreground/70">{SLOT_META[slot].roster}</span>
									{slot !== "strong" && <><ChatGPTBackgroundAccess provider={entry?.provider} /><NativeSubscriptionBackgroundAccess provider={entry?.provider} /></>}
									<div className="flex items-center gap-2">
										<div className="relative flex-1">
											<Hint label={entry ? `${entry.provider}:${entry.id}` : "Pick a model…"}>
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} model`}
												data-testid={`setup-trigger-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "model"}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "model" ? null : { slot, kind: "model" })}
												className="flex h-7 min-w-40 w-full items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50"
											>
												<span className="min-w-0 flex-1 truncate">{entry ? prettyModel(entry.id) : "Pick a model…"}</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											</Hint>
											{/* Ancla por TESTID, no por ref (el patrón de la sección de ajustes):
											React engancha la ref de un elemento host DESPUÉS de que se ejecuten los
											efectos de layout de sus descendientes, así que una ref recién enganchada en
											este mismo commit (abrir el menú = la condición de la ref pasa a true) sigue
											siendo null cuando MenuShell mide — place() se rinde, el menú sigue
											invisible y solo un redimensionado de la ventana (que vuelve a ejecutar
											place()) lo muestra. querySelector en el momento de colocar no tiene ese
											riesgo de orden. Detectado en vivo por el responsable el 2026-10-09: todos
											los selectores de configuración se abrían muertos hasta redimensionar la ventana. */}
											{openMenu?.slot === slot && openMenu.kind === "model" && (
												<MenuShell
													anchorTestid={`setup-trigger-${slot}`}
													testid={`setup-menu-${slot}`}
													onClose={() => { setOpenMenu(null); return "closed"; }}
													preferredSide="down"
													align="left"
													menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
												>
													<ModelMenuList
														models={slotCatalog}
														effectiveId={entry?.id}
														effectiveProvider={entry?.provider}
														vision={slot === "vision"}
														onPick={(m) => {
															editedSlots.current.add(slot);
															setPicked((prev) => ({ ...prev, [slot]: m }));
															// Autorrelleno (fragmento 2, responsable: "rellenar
															// en todas partes"): sin nivel explícito → el
															// nivel del orden para la elección nueva; uno
															// explícito viaja tal cual (Save lo acota en el servidor).
															setLevels((prev) => ({
																...prev,
																[slot]: populateLevel(prev[slot], m.supportedLevels),
															}));
															setOpenMenu(null);
														}}
														footer={slotCatalog && slotCatalog.length === 0 && slot === "vision" ? "No image-capable models. Add a provider key with access to a vision model." : undefined}
													/>
												</MenuShell>
											)}
										</div>
										{/* Selector de thinking (fragmento 2): editable, prerrellenado a partir
										del orden para cada modelo elegido — sin modelo, no hay niveles. */}
										<div className="relative">
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} thinking`}
												data-testid={`setup-thinking-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "thinking"}
												disabled={!entry}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "thinking" ? null : { slot, kind: "thinking" })}
												className="flex h-7 w-24 items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
											>
												<span className="min-w-0 flex-1 truncate text-left">
													{entry ? (level ? THINKING_LABEL[level] ?? level : "…") : "—"}
												</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											{openMenu?.slot === slot && openMenu.kind === "thinking" && (
												<MenuShell
													anchorTestid={`setup-thinking-${slot}`}
													testid={`setup-thinking-menu-${slot}`}
													onClose={() => { setOpenMenu(null); return "closed"; }}
													preferredSide="down"
													align="left"
													menuClass="flex w-44 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
												>
													<ThinkingMenuList
														levels={levelsForEntry.map(String)}
														effectiveLevel={level}
														onPick={(lv) => {
															editedSlots.current.add(slot);
															setLevels((prev) => ({ ...prev, [slot]: lv as ThinkingLevel }));
															setOpenMenu(null);
														}}
													/>
												</MenuShell>
											)}
										</div>
									</div>
								</div>
							);
						})}
						<div className="flex items-center gap-3">
							<button
								type="button"
								data-testid="setup-save"
								disabled={!allPicked || saving}
								onClick={() => void save()}
								className="rounded-sm border border-border bg-background px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving ? "Saving…" : "Save models"}
							</button>
							{error && <p className="text-xs text-error">{error}</p>}
						</div>
					</div>
				)}
		</HostDialog>;
}
