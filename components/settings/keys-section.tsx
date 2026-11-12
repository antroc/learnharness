"use client";
/**
 * La sección Keys (pulido de la oleada 5, 2026-09-21; diseño del
 * responsable): una tabla clave-valor MÍNIMA. Proveedor a la izquierda,
 * clave enmascarada a la derecha, sin pistas de descripción (ocupaban
 * demasiado), y el enlace "Get a key ↗" como invitado diminuto y atenuado.
 * Al hacer clic en una fila escribible se despliega debajo un campo para
 * pegar + Save (+ Delete para un valor que viene del fichero); Esc o un
 * segundo clic lo vuelven a plegar. El control de añadir proveedor es la
 * ÚLTIMA FILA de la tabla y usa el aspecto de desplegable compartido de la
 * app (ProviderMenuList: búsqueda difusa sobre los 33 proveedores de pi-ai).
 *
 * Decisiones del responsable incorporadas:
 *  - Las filas que pertenecen al entorno (una variable de entorno real es
 *    dueña del nombre: .env.local en desarrollo o el entorno de arranque) se
 *    renderizan SOLO LECTURA + atenuadas, sin campo para pegar: un cuadro de
 *    pegado en una clave que la UI no puede activar induciría a error.
 *  - OpenRouter NO es especial: un proveedor más entre 33; una fila solo si
 *    está guardada y, si no, vive en el desplegable de añadir como todos.
 *  - Providers agrupa las claves de API, las suscripciones, el dictado y la
 *    búsqueda. Las variables desconocidas siguen enmascaradas/solo lectura al
 *    final de Model API keys.
 *
 * API: GET /api/keys (estados enmascarados + el array de proveedores), PUT
 * /api/keys/:id (los 400 con barrera de forma aparecen en línea), DELETE.
 * Los guardados surten efecto de inmediato. El texto en claro nunca vuelve
 * del almacén.
 */

import { useEffect, useRef, useState } from "react";
import {
	AUTH_KEYS,
	CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW,
	CUSTOM_MODEL_DEFAULT_MAX_TOKENS,
	CUSTOM_PROVIDER,
	normalizeBaseUrl,
	type AuthKeyStatus,
	type CustomModel,
	type CustomModelOverride,
} from "@/src/core";
import { SettingsGroup } from "./controls.tsx";
import { SubscriptionConnections } from "./subscription-connections.tsx";
import { ClaudeCodeInstallationStatus } from "./claude-code-status.tsx";
import { ProviderMenuList } from "./model-menu.tsx";
import { useInteractionLayer, useInteractionLayers, useOptionalInteractionLayers } from "@/components/interaction-layers";
import { isInteractionScopeEligible } from "@/components/plugin-input-focus";
import { MenuShell } from "@/components/menu-shell";
import { notifySettingsSaved } from "@/components/settings-signal";
import { DictationLanguageSetting } from "@/components/dictation-language";

/** Un proveedor de pi-ai con autenticación simple por clave de API (la
 * frontera de Platform; derivada de la propia tabla de claves de entorno de
 * pi-ai: no puede haber deriva). */
export interface ProviderKeyInfo {
	id: string;
	envVar: string;
	label: string;
}

interface KeysResponse {
	keys: AuthKeyStatus[];
	providers?: ProviderKeyInfo[];
}

/** El estado no secreto del endpoint personalizado (GET /api/custom-provider). */
interface CustomStatus {
	keyReuseRequired: boolean;
	revision: string;
	authMode: "keyless" | "apiKey";
	keySource: "env" | "file" | "none";
	baseUrl: string;
	models: CustomModel[];
	/** Fijaciones del usuario por id de modelo (contexto / salida máxima / razonamiento). */
	overrides: Record<string, CustomModelOverride>;
	manualModels: string[];
	keyPresent: boolean;
}

async function readCustomStatus(inspectKey = false): Promise<CustomStatus> {
	const response = await fetch(`/api/custom-provider${inspectKey ? "?authMode=apiKey" : ""}`);
	if (!response.ok) throw new Error("Unable to load custom configuration.");
	const cp = await response.json() as Partial<CustomStatus>;
	return { keyReuseRequired: Boolean(cp.keyReuseRequired), revision: response.headers.get("etag") ?? "", authMode: cp.authMode ?? "keyless", keySource: cp.keySource ?? "none", baseUrl: cp.baseUrl ?? "", models: cp.models ?? [], overrides: cp.overrides ?? {}, manualModels: cp.manualModels ?? [], keyPresent: Boolean(cp.keyPresent) };
}

/** El grupo curado de herramientas, fijado por id (el catálogo es dueño del
 * texto; estos ids son el contrato). Derivado del catálogo (oleada de
 * búsqueda, 2026-09-20: se retiró la pareja de Google CSE y se unieron
 * Tavily + Brave); la sección ya no puede desviarse de core/auth-keys.ts. */
const TOOL_IDS = AUTH_KEYS.map((k) => k.id) as readonly string[];

/** La entrada sintética de añadir proveedor del endpoint personalizado (solo se ofrece mientras no está configurado). */
export const CUSTOM_PROVIDER_INFO: ProviderKeyInfo = {
	id: CUSTOM_PROVIDER.id,
	envVar: CUSTOM_PROVIDER.envVar,
	label: CUSTOM_PROVIDER.label,
};

/** La clasificación que determina los grupos de la tabla. Puro; exportado
 * para las pruebas. OpenRouter ya no está fijado (decisión del responsable
 * en la oleada 5): sin síntesis, sin fila especial; pasa por la misma
 * clasificación de proveedores. */
export function classifyKeys(
	statuses: readonly AuthKeyStatus[],
	providers: readonly ProviderKeyInfo[] | undefined,
): {
	/** Claves de proveedor guardadas (entorno o fichero), en el orden del GET. */
	providerRows: AuthKeyStatus[];
	/** Las filas curadas de herramientas (sintetizadas si faltan; siempre se
	 * muestran porque llevan los enlaces a la documentación que necesita un
	 * primer arranque). */
	toolRows: AuthKeyStatus[];
	/** Variables desconocidas del fichero: se conservan, solo lectura. */
	unknownRows: AuthKeyStatus[];
	/** Proveedores sin clave guardada: las opciones del desplegable de añadir. */
	addable: ProviderKeyInfo[];
} {
	const byId = new Map(statuses.map((s) => [s.id, s]));
	const isTool = (id: string) => (TOOL_IDS as readonly string[]).includes(id);
	const providerEnv = new Set((providers ?? []).map((p) => p.envVar));
	const synth = (id: string): AuthKeyStatus => ({
		id,
		info: null,
		present: false,
		masked: null,
		source: "none",
		shadowedByEnv: false,
	});
	const providerRows: AuthKeyStatus[] = [];
	const unknownRows: AuthKeyStatus[] = [];
	for (const s of statuses) {
		if (isTool(s.id)) continue;
		// La clave del endpoint personalizado tiene su PROPIO sitio (la sección Custom
		// endpoint), así que nunca aparece aquí: ni como fila de proveedor ni como
		// «otra variable guardada».
		if (s.id === CUSTOM_PROVIDER.envVar) continue;
		if (providerEnv.has(s.id) || (!s.info && providers === undefined)) providerRows.push(s);
		else if (!s.info) unknownRows.push(s);
		// (catálogos anteriores al interludio: un estado curado pero sin clasificar sigue
		// renderizándose como fila de proveedor para que no desaparezca nada)
		else providerRows.push(s);
	}
	return {
		providerRows,
		toolRows: TOOL_IDS.map((id) => byId.get(id) ?? synth(id)),
		unknownRows,
		addable: (providers ?? []).filter((p) => !byId.has(p.envVar)),
	};
}

/** Una fila de clave nombra su credencial, no el proveedor que salga
 * primero al ordenar. Pi expone Zen y Go por separado, pero ambos leen
 * OPENCODE_API_KEY. */
export function providerKeyLabel(id: string, providers: readonly ProviderKeyInfo[] | undefined): string | undefined {
	const matches = providers?.filter((p) => p.envVar === id);
	if (matches?.some((p) => p.id === "opencode") && matches.some((p) => p.id === "opencode-go")) return "OpenCode (Zen / Go)";
	return matches?.[0]?.label;
}

/** La línea de estado mínima, p. ej. "…ab12 · 64 chars" (" · env" marca un
 * valor que pertenece al entorno; la fila es entonces de solo lectura). Puro. */
export function keyStatusLine(status: AuthKeyStatus): string {
	if (!status.present || !status.masked) return "not set";
	const tail = status.masked.replace(/ \((\d+) chars\)$/, "");
	const chars = status.masked.match(/\((\d+) chars\)$/)?.[1] ?? "?";
	return `${tail} · ${chars}${status.source === "env" ? " · env" : ""}`;
}

/** Una fila de la tabla: etiqueta a la izquierda, enlace diminuto a la
 * documentación + estado a la derecha. Las filas escribibles despliegan un
 * editor debajo al hacer clic (interacción del responsable); las que
 * pertenecen al entorno van atenuadas y de solo lectura (un cuadro de pegado
 * ahí induciría a error). */
function KeyTableRow({
	label,
	docsUrl,
	status,
	expanded,
	onToggle,
	onSave,
	onDelete,
	onCancel,
	testid,
}: {
	label: string;
	/** El destino de "Get a key ↗"; las claves curadas llevan uno. */
	docsUrl?: string;
	status: AuthKeyStatus;
	expanded: boolean;
	onToggle: () => void;
	onSave: (value: string) => Promise<string | null>;
	onDelete?: () => Promise<void>;
	/** Pliega el editor (responsable, oleada de arreglos: la SALIDA de una
	 * petición de pegado debe ser visible; Cancel junto a Save/Delete, no solo Esc). */
	onCancel: () => void;
	testid: string;
}) {
	const envOwned = status.source === "env";
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function save() {
		if (!value.trim() || busy) return;
		setBusy(true);
		setError(null);
		const err = await onSave(value);
		if (err) setError(err);
		else setValue("");
		setBusy(false);
	}

	// Edición EN LÍNEA (responsable, oleada de arreglos: «escribir las claves en línea, más
	// como una tabla»): la fila desplegada se convierte en el propio editor —etiqueta
	// a la izquierda, el campo de pegado ocupando el centro, Save | Cancel (| Delete)
	// a la derecha— en vez de una segunda línea debajo de la fila.
	if (expanded && !envOwned) {
		return (
			<div data-testid={testid}>
				<div className="flex items-center gap-2 rounded-sm px-1 py-1.5" data-testid={`${testid}-editor`}>
					<span className="shrink-0 font-ui text-xs text-foreground">{label}</span>
					<input
						type="text"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void save();
						}}
						placeholder="Paste key…"
						aria-label={`${label} key`}
						data-testid={`${testid}-input`}
						disabled={busy}
						autoFocus
						className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
					/>
					<button
						type="button"
						onClick={() => void save()}
						disabled={busy || !value.trim()}
						data-testid={`${testid}-save`}
						className="shrink-0 text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
					>
						Save
					</button>
					<button
						type="button"
						onClick={onCancel}
						disabled={busy}
						data-testid={`${testid}-cancel`}
						className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
					>
						Cancel
					</button>
					{status.present && status.source === "file" && onDelete && (
						<button
							type="button"
							onClick={() => void onDelete()}
							disabled={busy}
							data-testid={`${testid}-delete`}
							className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-error hover:underline"
						>
							Delete
						</button>
					)}
				</div>
				{error && (
					<p role="alert" data-testid={`${testid}-error`} className="px-1 text-xs text-error">
						{error}
					</p>
				)}
			</div>
		);
	}

	return (
		<div data-testid={testid} className={envOwned ? "opacity-40" : undefined}>
			<button
				type="button"
				aria-expanded={expanded}
				data-testid={`${testid}-row`}
				onClick={() => !envOwned && onToggle()}
				className={`flex w-full items-center justify-between gap-3 rounded-sm px-1 py-1.5 text-left ${
					envOwned ? "cursor-default" : "cursor-pointer transition-colors hover:bg-accent/50"
				}`}
			>
				<span className="font-ui text-xs text-foreground">{label}</span>
				<span className="flex items-center gap-2">
					{docsUrl && (
						<a
							href={docsUrl}
							target="_blank"
							rel="noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="text-[10px] text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
						>
							key ↗
						</a>
					)}
					<span data-testid={`${testid}-status`} className="font-mono text-[11px] text-muted-foreground">
						{keyStatusLine(status)}
					</span>
				</span>
			</button>
			{error && (
				<p role="alert" data-testid={`${testid}-error`} className="pl-6 text-xs text-error">
					{error}
				</p>
			)}
		</div>
	);
}

/** El control de añadir proveedor: la última fila de la tabla, con el
 * aspecto de desplegable compartido de la app (menú en portal, la
 * maquinaria de búsqueda + recorrido con flechas). */
function AddProviderRow({
	addable,
	onPick,
}: {
	addable: ProviderKeyInfo[];
	onPick: (p: ProviderKeyInfo) => void;
}) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLDivElement>(null);
	const interactions = useInteractionLayers();

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>('[data-testid="add-provider-menu"]'))) return;
			const target = e.target as Node;
			if (anchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (target instanceof Element && target.closest('[role="dialog"]')) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, interactions]);

	return (
		<div ref={anchorRef} className="relative">
			<button
				type="button"
				aria-expanded={open}
				data-testid="add-provider"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-3 rounded-sm px-1 py-1.5 text-left font-ui text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
			>
				<span>+ Add a provider</span>
				{addable.length > 0 && <span className="font-mono text-[11px]">{addable.length}</span>}
			</button>
			{open && (
				<MenuShell
					anchorRef={anchorRef}
					testid="add-provider-menu"
					onClose={() => { setOpen(false); return "closed"; }}
					preferredSide="down"
					menuClass="flex w-72 flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
				>
					{/* Cerrar al elegir (responsable, oleada de arreglos): elegir un
					    proveedor termina el desplegable; la fila de pegado es el siguiente paso. */}
					<ProviderMenuList
						providers={addable}
						onPick={(p) => {
							setOpen(false);
							onPick(p);
						}}
					/>
				</MenuShell>
			)}
		</div>
	);
}

export function KeysSection({
	/** Una fila enlazada directamente que se despliega al llegar (oleada de
	 * cero claves): el clic del error de dictado llega aquí con
	 * DEEPGRAM_API_KEY. También se sigue con el componente montado: el patrón
	 * de redirigir con el diálogo de ajustes abierto. undefined = nada sembrado. */
	initialRow,
}: {
	initialRow?: string;
}) {
	const [statuses, setStatuses] = useState<AuthKeyStatus[] | null>(null);
	const [providers, setProviders] = useState<ProviderKeyInfo[] | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	/** La fila desplegada (su id); null = todas plegadas. La siembra el enlace
	 * directo (initialRow) y se vuelve a seguir cuando este redirige. */
	const [openRow, setOpenRow] = useState<string | null>(initialRow ?? null);
	/** El editor de pegado para un destino recién elegido en añadir proveedor. */
	const [adding, setAdding] = useState<ProviderKeyInfo | null>(null);
	// Solo se cachean los proveedores abiertos antes. Escape pliega sus editores
	// sin destruir los borradores; Save/Cancel explícitos siguen descartándolos.
	const [addingEditors, setAddingEditors] = useState<ProviderKeyInfo[]>([]);
	const [addError, setAddError] = useState<string | null>(null);
	/** El estado del endpoint personalizado + si su editor de conexión está abierto. */
	const [custom, setCustom] = useState<CustomStatus | null>(null);
	const [addingCustom, setAddingCustom] = useState(false);
	const [customEditorMounted, setCustomEditorMounted] = useState(false);
	const editorScopeRef = useRef<HTMLDivElement>(null);
	useInteractionLayer({
		kind: "view", rootRef: editorScopeRef,
		enabled: openRow !== null || adding !== null || addingCustom,
		onClose: () => {
			setOpenRow(null);
			setAdding(null);
			setAddingCustom(false);
			return "closed";
		},
	});
	const discardCustomEditor = () => { setAddingCustom(false); setCustomEditorMounted(false); };
	const discardProviderEditor = (id: string) => {
		setAdding(null);
		setAddingEditors(editors => editors.filter(provider => provider.id !== id));
	};

	const reload = async () => {
		try {
			const body = (await fetch("/api/keys").then((r) => r.json())) as KeysResponse;
			setStatuses(body.keys ?? []);
			if (body.providers) setProviders(body.providers);
		} catch {
			setStatuses([]);
		} finally {
			setLoading(false);
		}
		// Con el mejor esfuerzo e independiente: el estado del endpoint personalizado nunca debe
		// dejar en blanco la lista de claves de proveedor de arriba si su petición falla.
		try {
			setCustom(await readCustomStatus());
		} catch {
			/* estado personalizado no disponible: se deja sin valor */
		}
	};

	useEffect(() => {
		void reload();
	}, []);

	// El seguimiento del enlace directo: una redirección con la sección abierta (el
	// mismo patrón con el diálogo abierto que usa la navegación de secciones) despliega la
	// fila nombrada; un montaje nuevo la siembra mediante el inicializador de useState.
	useEffect(() => {
		if (initialRow !== undefined) setOpenRow(initialRow);
	}, [initialRow]);

	async function saveKey(id: string, value: string): Promise<string | null> {
		const res = await fetch(`/api/keys/${id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ value }),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			return body.error ?? `Save failed (${res.status})`;
		}
		await reload();
		// La señal de claves entre superficies (oleada de cero claves): la píldora de cero claves,
		// el avance de etapa del diálogo de configuración y cualquier otro lector de claves se enteran
		// de que ha llegado una clave, también de los borrados (ver deleteKey más abajo).
		notifySettingsSaved("keys");
		return null;
	}

	async function deleteKey(id: string): Promise<void> {
		await fetch(`/api/keys/${id}`, { method: "DELETE" }).catch(() => undefined);
		await reload();
		notifySettingsSaved("keys");
	}

	/** Olvida el endpoint personalizado (configuración + clave en el servidor),
	 * con el mismo ritmo que deleteKey: lanzar, volver a leer y difundir para
	 * que el catálogo se reduzca en todas partes. */
	async function disconnectCustom(revision: string): Promise<string | null> {
		const res = await fetch("/api/custom-provider", { method: "DELETE", headers: { "content-type": "application/json", "if-match": revision }, body: JSON.stringify({}) }).catch(() => null);
		if (!res?.ok) return res ? ((await res.json().catch(() => ({}))).error ?? "Disconnect failed.") : "Disconnect failed. Check your connection.";
		discardCustomEditor();
		await reload();
		notifySettingsSaved("keys");
		return null;
	}

	if (loading || statuses === null) {
		return <p className="px-6 py-5 text-xs text-muted-foreground/70">Loading keys…</p>;
	}

	const { providerRows, toolRows, unknownRows, addable } = classifyKeys(statuses, providers);

	async function saveNewProvider(p: ProviderKeyInfo, value: string) {
		const err = await saveKey(p.envVar, value);
		if (err) setAddError(err);
		else {
			discardProviderEditor(p.id);
			setAddError(null);
		}
	}

	return (
		<div ref={editorScopeRef} className="contents">
			<SettingsGroup label="Model API keys" testid="group-provider-keys">
				{providerRows.map((status) => (
					<KeyTableRow
						key={status.id}
						label={providerKeyLabel(status.id, providers) ?? status.info?.label ?? status.id}
						docsUrl={status.info?.docsUrl}
						status={status}
						expanded={openRow === status.id}
						onToggle={() => setOpenRow(openRow === status.id ? null : status.id)}
						onSave={async (v) => {
							const err = await saveKey(status.id, v);
							if (!err) setOpenRow(null); // plegar si tiene éxito: estado de reposo
							return err;
						}}
						onCancel={() => setOpenRow(null)}
						onDelete={() => deleteKey(status.id)}
						testid={`key-${status.id.toLowerCase()}`}
					/>
				))}
				{custom?.baseUrl && (
					<CustomEndpointRow
						status={custom}
						expanded={addingCustom}
						onToggle={() => { setCustomEditorMounted(true); setAddingCustom((v) => !v); }}
					/>
				)}
				{customEditorMounted && (
					<div hidden={!addingCustom} inert={!addingCustom} style={{ display: addingCustom ? undefined : "none" }}>
					<CustomEndpointEditor
						active={addingCustom}
						revision0={custom?.revision ?? ""}
						authMode0={custom?.authMode ?? "keyless"}
						keySource0={custom?.keySource ?? "none"}
						keyReuseRequired0={custom?.keyReuseRequired ?? false}
						onReload={async () => { await reload(); discardCustomEditor(); }}
						baseUrl0={custom?.baseUrl ?? ""}
						keyPresent={custom?.keyPresent ?? false}
						models={custom?.models ?? []}
						overrides={custom?.overrides ?? {}}
						manualModels0={custom?.manualModels ?? []}
						onSaved={async () => {
							discardCustomEditor();
							await reload();
							notifySettingsSaved("keys");
						}}
						onPinsSaved={async () => {
							await reload();
							notifySettingsSaved("keys");
						}}
						onDelete={disconnectCustom}
						onCancel={discardCustomEditor}
					/>
					</div>
				)}
				{providers !== undefined && (
					<AddProviderRow
						addable={custom?.baseUrl ? addable : [...addable, CUSTOM_PROVIDER_INFO]}
						onPick={(p) => {
							setAddError(null);
							if (p.id === CUSTOM_PROVIDER.id) {
								setAdding(null);
								setCustomEditorMounted(true);
								setAddingCustom(true);
							} else {
								setAddingCustom(false);
								setAddingEditors(editors => editors.some(provider => provider.id === p.id) ? editors : [...editors, p]);
								setAdding(p);
							}
						}}
					/>
				)}
				{addingEditors.map(provider => (
					<div key={provider.id} hidden={adding?.id !== provider.id} inert={adding?.id !== provider.id}
						style={{ display: adding?.id === provider.id ? undefined : "none" }}
						className="flex items-center gap-2 rounded-sm px-1 py-1.5" data-testid={`key-${provider.id}-editor`}>
						<span className="shrink-0 font-ui text-xs text-foreground">{provider.label}</span>
						<AddProviderEditor provider={provider} active={adding?.id === provider.id} onSave={(v) => void saveNewProvider(provider, v)} onCancel={() => discardProviderEditor(provider.id)} error={addError} />
					</div>
				))}
				{unknownRows.length > 0 && <div data-testid="group-unknown-keys">
					{unknownRows.map((status) => <div key={status.id} data-testid={`unknown-${status.id}`} className="flex items-center justify-between gap-3 px-1 py-1.5 opacity-40">
						<span className="font-mono text-xs text-foreground">{status.id}</span>
						<span className="font-mono text-[11px] text-muted-foreground">{status.masked}</span>
					</div>)}
				</div>}
			</SettingsGroup>

			<SettingsGroup label="Subscriptions" testid="group-subscriptions">
				<SubscriptionConnections />
			</SettingsGroup>

			<SettingsGroup label="External CLI" testid="group-external-cli">
				<ClaudeCodeInstallationStatus />
			</SettingsGroup>

			{(["Dictation", "Search"] as const).map((label) => <SettingsGroup key={label} label={label} testid={label === "Dictation" ? "group-dictation" : "group-search"}>
				{toolRows.filter((status) => label === "Dictation" ? status.id === "DEEPGRAM_API_KEY" : status.id !== "DEEPGRAM_API_KEY").map((status) => (
					<KeyTableRow
						key={status.id}
						label={status.info?.label ?? status.id}
						docsUrl={status.info?.docsUrl}
						status={status}
						expanded={openRow === status.id}
						onToggle={() => setOpenRow(openRow === status.id ? null : status.id)}
						onSave={async (v) => {
							const err = await saveKey(status.id, v);
							if (!err) setOpenRow(null);
							return err;
						}}
						onCancel={() => setOpenRow(null)}
						onDelete={() => deleteKey(status.id)}
						testid={`key-${status.id.toLowerCase()}`}
					/>
				))}
				{label === "Dictation" && <>
					<DictationLanguageSetting />
					<p data-testid="dictation-setup-hint" className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
						Create a <a
							href="https://console.deepgram.com/"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2 hover:text-foreground"
						>Deepgram API key</a> with the Member role or higher, then add it above.
					</p>
				</>}
			</SettingsGroup>)}

		</div>
	);
}

/** El campo de pegado para un proveedor elegido en el desplegable de añadir;
 * se renderiza bajo la fila de añadir hasta que se guarda o se cancela. */
function AddProviderEditor({
	provider,
	active,
	onSave,
	onCancel,
	error,
}: {
	provider: ProviderKeyInfo;
	active: boolean;
	onSave: (value: string) => void;
	onCancel: () => void;
	error: string | null;
}) {
	const [value, setValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const interactions = useInteractionLayers();
	useEffect(() => {
		if (active && isInteractionScopeEligible(inputRef.current, interactions)) inputRef.current?.focus();
	}, [active, interactions]);
	return (
		<>
			<input
				ref={inputRef}
				type="text"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && value.trim()) onSave(value);
				}}
				placeholder="Paste key…"
				aria-label={`${provider.label} key`}
				data-testid={`key-${provider.id}-input`}
				autoFocus={active}
				className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
			/>
			<button
				type="button"
				onClick={() => value.trim() && onSave(value)}
				disabled={!value.trim()}
				data-testid={`key-${provider.id}-save`}
				className="shrink-0 text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
			>
				Save
			</button>
			<button
				type="button"
				onClick={onCancel}
				data-testid={`key-${provider.id}-cancel`}
				className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
			>
				Cancel
			</button>
			{error && (
				<p role="alert" className="w-full pl-0 text-xs text-error" data-testid={`key-${provider.id}-error`}>
					{error}
				</p>
			)}
		</>
	);
}

/** Un único editor donante para la primera configuración y para Settings;
 * la configuración omite la fijación sin conexión y los controles de
 * desconexión, mientras que la autenticación, las revisiones y los ids
 * manuales son idénticos. */
export function CustomEndpointSetup({ onSaved }: { onSaved: () => void | Promise<void> }) {
	const [status, setStatus] = useState<CustomStatus | null>(null);
	const [error, setError] = useState(false);
	async function reload() {
		try { setStatus(await readCustomStatus()); setError(false); }
		catch { setError(true); }
	}
	useEffect(() => { void reload(); }, []);
	if (!status || error) return <div className="text-xs">{error ? "Unable to load custom configuration." : "Loading custom configuration…"}{error && <button onClick={() => void reload()}>Retry</button>}</div>;
	return <CustomEndpointEditor key={status.revision} setup revision0={status.revision} authMode0={status.authMode} keySource0={status.keySource} keyReuseRequired0={status.keyReuseRequired} baseUrl0={status.baseUrl} keyPresent={status.keyPresent} models={status.models} overrides={status.overrides} manualModels0={status.manualModels} onSaved={onSaved} onPinsSaved={reload} onReload={reload} onCancel={reload} />;
}

/** La fila de estado del endpoint personalizado (se muestra una vez configurado); al hacer clic se vuelve a abrir el editor. */
function CustomEndpointRow({
	status,
	expanded,
	onToggle,
}: {
	status: CustomStatus;
	expanded: boolean;
	onToggle: () => void;
}) {
	const count = status.models.length;
	const line = `${status.baseUrl} · ${count} model${count === 1 ? "" : "s"} · ${status.authMode === "keyless" ? "keyless" : status.keyPresent ? "API key" : "API key missing"}`;
	return (
		<div data-testid="custom-endpoint-row">
			<button
				type="button"
				data-testid="custom-endpoint-row-btn"
				aria-expanded={expanded}
				onClick={onToggle}
				className="flex w-full items-center justify-between gap-3 rounded-sm px-1 py-1.5 text-left cursor-pointer transition-colors hover:bg-accent/50"
			>
				<span className="font-ui text-xs text-foreground">Custom endpoint</span>
				<span data-testid="custom-endpoint-status" className="max-w-[60%] truncate font-mono text-[11px] text-muted-foreground">
					{line}
				</span>
			</button>
		</div>
	);
}

/** El estado de entrada en bruto de una fila de fijación: "" significa «sin
 * fijación»: decide el valor propio del endpoint y, después, el valor por
 * defecto compilado. `reasoning` tiene tres estados. */
interface PinDraft {
	context: string;
	maxTokens: string;
	reasoning: "" | "on" | "off";
}

const pinDraft = (pin: CustomModelOverride | undefined): PinDraft => ({
	context: pin?.context === undefined ? "" : String(pin.context),
	maxTokens: pin?.maxTokens === undefined ? "" : String(pin.maxTokens),
	reasoning: pin?.reasoning === undefined ? "" : pin.reasoning ? "on" : "off",
});

/** Una fila de borrador por cada modelo descubierto, sembrada a partir de las fijaciones guardadas. */
function draftsFor(
	models: readonly CustomModel[],
	overrides: Record<string, CustomModelOverride>,
): Record<string, PinDraft> {
	return Object.fromEntries(models.map((m) => [m.id, pinDraft(overrides[m.id])]));
}

/** Borradores → la carga del PATCH (sustituye entero): un campo en blanco
 * no envía nada y un modelo totalmente en blanco queda ausente, que ES el
 * quitar la fijación. */
function pinsPayload(drafts: Record<string, PinDraft>): Record<string, CustomModelOverride> {
	const out: Record<string, CustomModelOverride> = {};
	for (const [id, d] of Object.entries(drafts)) {
		const pin: CustomModelOverride = {};
		if (d.context.trim()) pin.context = Number(d.context);
		if (d.maxTokens.trim()) pin.maxTokens = Number(d.maxTokens);
		if (d.reasoning !== "") pin.reasoning = d.reasoning === "on";
		if (Object.keys(pin).length) Object.defineProperty(out, id, { value: pin, enumerable: true });
	}
	return out;
}

/** Los testids deben sobrevivir a ids con barras, dos puntos y puntos. */
const pinTestid = (prefix: string, id: string) => `${prefix}-${id.replace(/[^a-z0-9-]/gi, "_")}`;

/** El editor de conexión del endpoint personalizado: URL base + clave → POST
 * /api/custom-provider (validar + descubrir + registrar), y el formulario de
 * límites por modelo → PATCH (fijaciones, sin sondeo, así que funciona con
 * el servidor local apagado). La capacidad de imagen se detecta
 * automáticamente. */
function CustomEndpointEditor({
	setup = false,
	active = true,
	revision0, authMode0, keySource0, keyReuseRequired0, onReload,
	baseUrl0,
	keyPresent: initialKeyPresent,
	models,
	overrides,
	manualModels0,
	onSaved,
	onPinsSaved,
	onCancel,
	onDelete,
}: {
	setup?: boolean;
	active?: boolean;
	revision0: string;
	authMode0: "keyless" | "apiKey";
	keySource0: "env" | "file" | "none";
	keyReuseRequired0: boolean;
	onReload: () => void | Promise<void>;
	baseUrl0: string;
	keyPresent: boolean;
	/** Los modelos descubiertos: una fila de límites por cada uno. */
	models: readonly CustomModel[];
	/** Sus fijaciones de usuario guardadas. */
	overrides: Record<string, CustomModelOverride>;
	manualModels0: readonly string[];
	onSaved: () => void | Promise<void>;
	/** Fijaciones guardadas: el editor sigue abierto (es un formulario, no una conexión). */
	onPinsSaved: () => void | Promise<void>;
	onCancel: () => void;
	onDelete?: (revision: string) => Promise<string | null>;
}) {
	const baseUrlRef = useRef<HTMLInputElement>(null);
	const interactions = useOptionalInteractionLayers();
	useEffect(() => {
		if (active && isInteractionScopeEligible(baseUrlRef.current, interactions)) baseUrlRef.current?.focus();
	}, [active, interactions]);
	const [revision, setRevision] = useState(revision0);
	const [authMode, setAuthMode] = useState(authMode0);
	const [keySource, setKeySource] = useState(keySource0);
	const [keyPresent, setKeyPresent] = useState(initialKeyPresent);
	const [keyReuseRequired, setKeyReuseRequired] = useState(keyReuseRequired0);
	const [authLoading, setAuthLoading] = useState(false);
	const [reuseKey, setReuseKey] = useState(false);
	useEffect(() => {
		if (authMode !== "apiKey") return;
		let cancelled = false;
		setAuthLoading(true);
		readCustomStatus(true).then((status) => {
			if (cancelled) return;
			setKeySource(status.keySource);
			setKeyPresent(status.keyPresent);
			setKeyReuseRequired(status.keyReuseRequired);
			if (status.keySource === "env") setKey("");
		}).catch(() => { if (!cancelled) setError("Unable to inspect effective key. Reload configuration and retry."); })
			.finally(() => { if (!cancelled) setAuthLoading(false); });
		return () => { cancelled = true; };
	}, [authMode]);
	const [baseUrl, setBaseUrl] = useState(baseUrl0);
	const [key, setKey] = useState("");
	const [keyTouched, setKeyTouched] = useState(false);
	const [manualModels, setManualModels] = useState(manualModels0.join(", "));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// El formulario de límites: borradores editados sobre las fijaciones guardadas, más la última
	// carga guardada como referencia de cambios (lo que se guarda es el eco del servidor).
	const [drafts, setDrafts] = useState<Record<string, PinDraft>>(() => draftsFor(models, overrides));
	const [baseline, setBaseline] = useState(() => JSON.stringify(pinsPayload(draftsFor(models, overrides))));
	const [pinsBusy, setPinsBusy] = useState(false);
	const [pinsError, setPinsError] = useState<string | null>(null);
	const changedTarget = normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(baseUrl0);
	const canConnect = Boolean(baseUrl.trim()) && (authMode === "keyless" || (!authLoading && ((Boolean(key.trim()) && keySource !== "env") || (keyPresent && (!(changedTarget || keyReuseRequired) || reuseKey)))));

	const draftOf = (m: CustomModel): PinDraft => drafts[m.id] ?? pinDraft(overrides[m.id]);
	const setDraft = (m: CustomModel, patch: Partial<PinDraft>) =>
		setDrafts((prev) => ({ ...prev, [m.id]: { ...draftOf(m), ...patch } }));
	const current = Object.fromEntries(models.map((m) => [m.id, draftOf(m)])) as Record<string, PinDraft>;
	const dirty = JSON.stringify(pinsPayload(current)) !== baseline;

	async function savePins() {
		if (pinsBusy || busy || !dirty) return;
		setPinsBusy(true);
		setPinsError(null);
		const res = await fetch("/api/custom-provider", {
			method: "PATCH",
			headers: { "content-type": "application/json", "if-match": revision },
			body: JSON.stringify({ overrides: pinsPayload(current) }),
		}).catch(() => null);
		if (!res || !res.ok) {
			const b = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setPinsError(res ? (b?.error ?? `Save failed (${res.status})`) : "Save failed. Check your connection.");
			setPinsBusy(false);
			return;
		}
		setRevision(res.headers.get("etag") ?? revision);
		// El mapa guardado del servidor es la verdad: se refleja de vuelta.
		const body = (await res.json().catch(() => null)) as { overrides?: Record<string, CustomModelOverride> } | null;
		const next = draftsFor(models, body?.overrides ?? pinsPayload(current));
		setDrafts(next);
		setBaseline(JSON.stringify(pinsPayload(next)));
		await onPinsSaved();
		setPinsBusy(false);
	}

	async function save() {
		if (busy || pinsBusy || !canConnect) return;
		setBusy(true);
		setError(null);
		const res = await fetch("/api/custom-provider", {
			method: "POST",
			headers: { "content-type": "application/json", "if-match": revision },
			body: JSON.stringify({ baseUrl, authMode, reuseKey, manualModels, ...(authMode === "apiKey" && keyTouched && key.trim() && keySource !== "env" ? { key } : {}) }),
		}).catch(() => null);
		if (!res || !res.ok) {
			const b = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setError(res ? (b?.error ?? `Connect failed (${res.status})`) : "Connect failed. Check your connection.");
			setBusy(false);
			return;
		}
		await onSaved();
		setBusy(false);
	}

	return (
		<div data-testid="custom-endpoint-editor" className="flex flex-col gap-2 rounded-sm px-1 py-1.5">
			<div className="flex items-center gap-2">
				<span className="shrink-0 font-ui text-xs text-foreground">Custom endpoint</span>
				<input
					ref={baseUrlRef}
					type="text"
					value={baseUrl}
					onChange={(e) => setBaseUrl(e.target.value)}
					placeholder="Base URL, e.g. http://localhost:11434/v1"
					aria-label="Custom endpoint base URL"
					data-testid="custom-baseurl-input"
					disabled={busy}
					autoFocus={active}
					className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
				/>
			</div>
			<input
				type="text"
				value={manualModels}
				onChange={(e) => setManualModels(e.target.value)}
				placeholder="Model IDs, comma-separated — optional, needed when the endpoint has no /models list"
				aria-label="Custom endpoint model IDs"
				data-testid="custom-models-input"
				disabled={busy}
				className="h-7 min-w-0 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
			/>
			<label className="flex items-center gap-2 text-xs">Authentication
				<select aria-label="Custom endpoint authentication" data-testid="custom-auth-mode" value={authMode} disabled={busy || pinsBusy} onChange={(e) => { setAuthMode(e.target.value as "keyless" | "apiKey"); setReuseKey(false); }}>
					<option value="keyless">Keyless</option><option value="apiKey">API key</option>
				</select>
			</label>
			{authMode === "apiKey" && keySource === "env" && <p className="text-[11px] text-muted-foreground" data-testid="custom-env-owned">Environment supplies the effective key. Change the environment to replace it.</p>}
			{authMode === "apiKey" && keyPresent && (changedTarget || keyReuseRequired) && <label className="text-[11px]"><input type="checkbox" data-testid="custom-reuse-key" checked={reuseKey} onChange={(e) => setReuseKey(e.target.checked)} /> Allow reuse of the effective existing key for this URL</label>}
			<div className="flex items-center gap-2">
				{authMode === "apiKey" && <input
					type="password"
					value={key}
					onChange={(e) => {
						setKey(e.target.value);
						setKeyTouched(true);
						if (!e.target.value.trim()) setAuthMode("keyless");
					}}
					placeholder={keyPresent ? "Leave blank to keep effective key" : "API key"}
					aria-label="Custom endpoint API key"
					data-testid="custom-key-input"
					disabled={busy || pinsBusy || keySource === "env"}
					className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
				/>}
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || pinsBusy || !canConnect}
					data-testid="custom-save"
					className="shrink-0 text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
				>
					{busy ? "Connecting…" : "Connect"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					data-testid="custom-cancel"
					className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
				>
					Cancel
				</button>
				{/* Disconnect va junto a Connect, exactamente como el Delete de las filas
				    de claves guardadas: texto discreto, un clic, sin confirmación, y solo
				    cuando SÍ hay un endpoint (uno recién añadido no tiene nada que borrar). */}
				{onDelete && baseUrl0.trim() && (
					<button
						type="button"
						onClick={async () => { setBusy(true); const err = await onDelete(revision); if (err) setError(err); setBusy(false); }}
						disabled={busy || pinsBusy}
						data-testid="custom-delete"
						className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-error hover:underline"
					>
						Disconnect
					</button>
				)}
			</div>
			{!setup && models.length > 0 && (
				<div className="flex flex-col gap-1" data-testid="custom-pins">
					<div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
						{models.map((m) => {
							const d = draftOf(m);
							return (
								<div key={m.id} className="flex items-center gap-2" data-testid={pinTestid("custom-pin-row", m.id)}>
									<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={m.id}>
										{m.id}
										<span className="block text-[10px] text-muted-foreground">Context: {d.context.trim() ? "user pin" : m.context ? `reported ${m.context}` : `fallback ${CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW}`} · Output: {d.maxTokens.trim() ? "user pin" : m.maxTokens ? `reported ${m.maxTokens}` : `fallback ${CUSTOM_MODEL_DEFAULT_MAX_TOKENS}`}</span>
									</span>
									<input
										type="text"
										inputMode="numeric"
										value={d.context}
										onChange={(e) => setDraft(m, { context: e.target.value })}
										placeholder={String(m.context ?? CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW)}
										aria-label={`${m.id} context window in tokens`}
										data-testid={pinTestid("custom-pin-context", m.id)}
										disabled={pinsBusy}
										className="h-7 w-20 shrink-0 rounded-sm border border-border bg-background px-1.5 text-right font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
									/>
									<input
										type="text"
										inputMode="numeric"
										value={d.maxTokens}
										onChange={(e) => setDraft(m, { maxTokens: e.target.value })}
										placeholder={String(m.maxTokens ?? CUSTOM_MODEL_DEFAULT_MAX_TOKENS)}
										aria-label={`${m.id} max output tokens`}
										data-testid={pinTestid("custom-pin-maxtokens", m.id)}
										disabled={pinsBusy}
										className="h-7 w-20 shrink-0 rounded-sm border border-border bg-background px-1.5 text-right font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
									/>
									<select
										value={d.reasoning}
										onChange={(e) => setDraft(m, { reasoning: e.target.value as PinDraft["reasoning"] })}
										aria-label={`${m.id} reasoning effort support`}
										data-testid={pinTestid("custom-pin-reasoning", m.id)}
										disabled={pinsBusy}
										className="h-7 shrink-0 rounded-sm border border-border bg-background px-1 font-ui text-[11px] text-foreground outline-none focus:border-muted-foreground/50"
									>
										<option value="">Reasoning effort: Use reported</option>
										<option value="on">Reasoning effort: Supported</option>
										<option value="off">Reasoning effort: Not supported</option>
									</select>
								</div>
							);
						})}
					</div>
					<div className="flex items-center gap-2">
						{pinsError && (
							<p role="alert" data-testid="custom-pins-error" className="text-[11px] text-error">
								{pinsError}
							</p>
						)}
						<button
							type="button"
							onClick={() => void savePins()}
							disabled={pinsBusy || !dirty}
							data-testid="custom-pins-save"
							className="ml-auto shrink-0 text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
						>
							{pinsBusy ? "Saving…" : "Save limits"}
						</button>
					</div>
				</div>
			)}
			<div className="flex flex-col gap-1 text-[11px] text-muted-foreground" data-testid="custom-help">
				{!setup && models.length > 0 && <p data-testid="custom-budget-help">Budget pins do not resize backend context. Blank uses reported limits, then fallback (8192 context / 4096 output). Custom pricing is unknown.</p>}
				<p data-testid="custom-reasoning-help">Reasoning support is a capability declaration. The effort picker’s Off may not disable a custom backend’s default thinking.</p>
			</div>
			{(error || pinsError) && <button type="button" data-testid="custom-reload" onClick={() => void onReload()} className="text-left text-xs underline">Reload configuration</button>}
			{error && (
				<p role="alert" data-testid="custom-error" className="text-xs text-error">
					{error}
				</p>
			)}
		</div>
	);
}
