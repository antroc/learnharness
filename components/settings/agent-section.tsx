"use client";
/**
 * La sección Agent (oleada de la app de ajustes): las TRES RANURAS DE MODELO,
 * los conmutadores de herramientas + la preferencia de motor de búsqueda, y
 * los interruptores de sustitución de prompts; tres GRUPOS (responsable,
 * 2026-09-20: separación clara — Models / Tools / System prompts).
 *
 * Ranuras de modelo (oleada de ranuras de modelo, 2026-09-20, decisión del
 * responsable: SOLO RANURAS; las seis filas por rol desaparecieron; las
 * sustituciones por rol siguen en el esquema para una futura superficie
 * avanzada): Strong = Prober + Teacher, Cheap = los cinco roles de carga,
 * Vision = Visual maker + PDF reader. Cada fila de ranura lleva el
 * desplegable compartido (búsqueda difusa, recorrido con flechas, Enter para
 * elegir; ModelMenuList/ThinkingMenuList de ./model-menu.tsx) sobre el
 * catálogo FEDERADO (/api/models solo sirve proveedores con clave, recién
 * calculado en cada llamada: guardar una clave en Keys amplía al instante
 * este selector). La ranura de visión filtra a modelos que admiten imágenes
 * (Model.input). Las ranuras viven en la sección de ajustes `models` (PUT
 * /api/settings/models; las fijaciones de ranura son del motor, no por
 * chat); el resto de la sección escribe la sección `agent` como antes.
 * Resolución por nivel: sustitución de la ranura → fijación de fábrica (los
 * `slots` de GET /api/models; resueltos, no pueden desviarse de lo que se
 * ejecuta). La fila Default borra la sustitución de la ranura; un id
 * guardado sigue VISIBLE aunque la clave de su proveedor haya caducado y
 * haya salido del catálogo: un disparador que mostrara "Default" sobre una
 * sustitución activa mentiría sobre el registro.
 *
 * Motor de búsqueda (oleada de búsqueda, 2026-09-20, responsable: sin valor
 * por defecto; un motor está activo si y solo si su clave está presente; con
 * clave, el motor se activa SOLO, y la elección explícita es solo una
 * preferencia entre motores activos): una fila del grupo Tools, con el mismo
 * aspecto de menú compartido y la línea de motivo en directo de /api/search.
 * Sin ninguna clave de motor → toda la fila se atenúa (una elección sin
 * clave solo BLOQUEARÍA la activación automática de otro motor).
 *
 * Tools: la lista definitiva del responsable (2026-09-19): research, demo,
 * visual, pdf. Clave ausente = activada en el esquema; la UI escribe
 * booleanos explícitos para las cuatro (más fácil de razonar y equivalente
 * tras el saneado).
 *
 * Prompts: los segmentos de GET /api/settings/prompts — Teacher, Prober,
 * Practice y Shared el ÚLTIMO. El servidor devuelve los segmentos reales de
 * cada agente, incluido su subconjunto compartido; sectionedSegments
 * deduplica los fragmentos compartidos y deriva el uso de cada fragmento de
 * su pertenencia a esas listas. Las decisiones sobre las filas: solo el
 * CONMUTADOR se atenúa cuando no hay fichero de sustitución (el nombre del
 * fichero siempre va con contraste completo); NO hay línea de descripción
 * cuando no hay sustitución (el estado vacío es limpio: conmutador +
 * nombre); el indicador ("Your version is saved") aparece SOLO cuando existe
 * una sustitución. El interruptor requiere un FICHERO de sustitución
 * (impuesto por la ruta), así que un conmutador sin fichero está
 * desactivado. La vista de segmentos vuelve a leer con la señal
 * 'lh:settings-saved' de la sección agent: los indicadores enabled de la
 * vista derivan de los interruptores del registro, y el fallo de eco de
 * estado del 2026-09-26 era justo la falta de este lector (el conmutador
 * pintaba su estado antiguo hasta que un remontaje volvía a pedirlo).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CacheRetention } from "@earendil-works/pi-ai";
import { CacheRetentionMenu, cacheRetentionLabel } from "./cache-retention-menu.tsx";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { useSettingsSaved } from "@/components/settings-signal";
import { defaultOrderLevel, populateLevel } from "@/components/thinking-default";
import { useModelCatalog } from "@/components/model-catalog";
import { Hint } from "@/components/ui/hint";
import type React from "react";
import {
	COMPACTION_THRESHOLD_FLOOR,
	MODEL_SLOTS,
	SEARCH_ENGINES,
	resolveSettings,
	isFileAccessFolder,
	type AgentSettings,
	type CompactionSettings,
	type GraphSettings,
	type ModelSlotName,
	type ModelsSettings,
	type SearchEngineId,
} from "@/src/core";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { prettyModel } from "@/components/usage-format";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, SettingsMenuTrigger, Toggle, CommitInput } from "./controls.tsx";
import { ModelMenuList, ThinkingMenuList } from "./model-menu";
import { ChatGPTBackgroundAccess } from "./chatgpt-connection";
import { NativeSubscriptionBackgroundAccess } from "./subscription-connections";

/** La identidad visible de una ranura: la plantilla del nivel como pista de
 * la fila viaja con el valor por defecto resuelto (responsable: la pista
 * SIEMPRE nombra el valor por defecto). */
const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "The main model for your sessions" },
	cheap: { label: "Cheap", roster: "The assistants that research, build demos, and grade your work" },
	vision: { label: "Vision", roster: "The assistants that draw and read PDFs" },
};

/** La lista definitiva de herramientas conmutables del responsable
 * (confírmalo con el usuario antes de cambiarla; el hilo de Teacher lo
 * decidió el 2026-09-19). */
export const TOGGLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** SegmentInfo tal como lo devuelve GET /api/settings/prompts. */
interface SegmentInfo {
	path: string;
	sourceText: string;
	overrideText: string | null;
	enabled: boolean;
	shared: boolean;
}

type PromptView = Record<"teacher" | "prober" | "practice", SegmentInfo[]>;
type PromptRow = SegmentInfo & { usageHint?: string };

/** Composición: se conmuta una herramienta y el resto de la sección se
 * conserva tal cual. Puro; exportado para las pruebas. */
export function composeTool(agent: AgentSettings | undefined, id: string, on: boolean): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, [id]: on } };
}

/** Una entrada de carpeta de acceso a ficheros que el servidor aceptará:
 * absoluta (POSIX o unidad/UNC de Windows) o anclada en "~". Puro; exportado
 * para las pruebas. */
export function isFolderEntry(folder: string): boolean { return isFileAccessFolder(folder); }

/** El interruptor cambia SOLO la restricción; nunca descarta las carpetas guardadas. */
export function composeFileRestriction(agent: AgentSettings | undefined, restricted: boolean): AgentSettings {
	return { ...agent, fileAccess: { restricted, folders: agent?.fileAccess?.folders ?? [] } };
}

/** Composición: añade una carpeta permitida (recortada; los duplicados y las
 * entradas no válidas no hacen nada). Puro; exportado para las pruebas. */
export function composeAddFolder(agent: AgentSettings | undefined, folder: string): AgentSettings {
	const next = folder.trim();
	const folders = agent?.fileAccess?.folders ?? [];
	const restricted = agent?.fileAccess?.restricted ?? false;
	if (!isFolderEntry(next) || folders.includes(next)) return { ...agent, fileAccess: { restricted, folders } };
	return { ...agent, fileAccess: { restricted, folders: [...folders, next] } };
}

/** Quitar la última carpeta NUNCA cambia el interruptor de restricción. */
export function composeRemoveFolder(agent: AgentSettings | undefined, folder: string): AgentSettings {
	return { ...agent, fileAccess: { restricted: agent?.fileAccess?.restricted ?? false, folders: (agent?.fileAccess?.folders ?? []).filter((f) => f !== folder) } };
}

/** Analiza el borrador numérico y compone la sección agent COMPLETA. Vacío
 * elimina la sustitución; una entrada no válida nunca escribe, redondea ni
 * acota. Puro; exportado para las pruebas. */
export function composeWorkerRequestConcurrency(
	agent: AgentSettings | undefined,
	value: string,
): { ok: true; settings: AgentSettings } | { ok: false; error: string } {
	const next = { ...agent };
	const draft = value.trim();
	if (draft === "") {
		delete next.workerRequestConcurrency;
		return { ok: true, settings: next };
	}
	const invalid = { ok: false as const, error: "Enter a positive, safely representable whole number." };
	const concurrency = Number(draft);
	if (!Number.isSafeInteger(concurrency) || concurrency <= 0) return invalid;
	// Conserva la sintaxis nativa decimal/exponencial, pero comprueba los dígitos fraccionarios
	// ANTES de aceptar el resultado de Number: p. ej., 8.0000000000000001 se redondea a 8.
	// Los ceros finales del coeficiente cancelan exactamente las posiciones decimales negativas;
	// esto no necesita aritmética de precisión arbitraria ni potencias sin límite.
	const decimal = draft.match(/^\+?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
	if (!decimal) return invalid;
	const mantissa = decimal[1]!;
	const fractionalPlaces = mantissa.split(".")[1]?.length ?? 0;
	const coefficient = mantissa.replace(".", "");
	const trailingZeroes = coefficient.length - coefficient.replace(/0+$/, "").length;
	if (Number(decimal[2] ?? 0) - fractionalPlaces + trailingZeroes < 0) return invalid;
	next.workerRequestConcurrency = concurrency;
	return { ok: true, settings: next };
}

/** La mecánica de las preguntas (responsable 2026-09-27): un control
 * segmentado, no un conmutador; siempre hay exactamente una mecánica activa.
 * `explain: true` activa el recuerdo libre (entra explain, sale quiz);
 * cualquier otra cosa es opción múltiple. `quiz` nunca se escribe (lo
 * gestiona la mecánica; ver quizMechanics en agent/tools.ts). Puro;
 * exportado para las pruebas. */
export function composeQuizMechanics(agent: AgentSettings | undefined, mechanics: "choice" | "free"): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, explain: mechanics === "free" } };
}

/** Compone el conmutador de herramientas de grafo del sondeador (oleada 7):
 * su propia clave en la sección agent, nunca en el mapa de conmutadores de
 * herramientas (decisión del responsable). Ausente = ACTIVADO (la disciplina
 * de los conmutadores); la escritura es explícita en ambos casos, así que un
 * registro con un desactivado explícito sigue visible tal como se guardó.
 * Puro; exportado para las pruebas. */
export function composeGraphTools(agent: AgentSettings | undefined, on: boolean): AgentSettings {
	return { ...agent, graphTools: { enabled: on } };
}

/** Composición: la sustitución de modelo/razonamiento de una ranura. Modelo
 * vacío = sustitución ausente (Default: recurre a la fijación de fábrica);
 * razonamiento vacío = el nivel conserva su presupuesto de razonamiento
 * resuelto. Independencia por campo, igual que ModelSlot en el esquema.
 * Puro; exportado para las pruebas. */
export function composeSlotModel(
	models: ModelsSettings | undefined,
	slot: ModelSlotName,
	provider: string,
	id: string,
	thinking: string,
): ModelsSettings {
	const prev = models?.[slot];
	const next = { ...models };
	if (!provider && !id && !thinking) {
		delete next[slot];
		return next;
	}
	next[slot] = {
		...(prev?.cacheRetention !== undefined ? { cacheRetention: prev.cacheRetention } : {}),
		...(provider && id ? { model: { provider, id } } : prev?.model ? { model: prev.model } : {}),
		...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
	};
	return next;
}

/** La retención es solo de ranura; elegir el valor por defecto de Pi elimina el campo por completo. */
export function composeSlotCacheRetention(models: ModelsSettings | undefined, slot: ModelSlotName, value: CacheRetention | undefined): ModelsSettings {
	const next = { ...models?.[slot] };
	if (value === undefined) delete next.cacheRetention;
	else next.cacheRetention = value;
	return { ...models, [slot]: next };
}

/** Composición: la preferencia de motor de búsqueda. null = se ELIMINA la
 * fijación explícita (toma el relevo la activación automática, el estado de
 * reposo del esquema). Puro; exportado para las pruebas. */
export function composeSearchEngine(
	agent: AgentSettings | undefined,
	engine: SearchEngineId | null,
): AgentSettings {
	if (engine === null) {
		if (!agent?.search) return { ...agent };
		const { search: _drop, ...rest } = agent;
		return { ...rest } as AgentSettings;
	}
	return { ...agent, search: { engine } };
}

/** El indicador bajo una fila cuya sustitución ES la versión en uso
 * (decisión del responsable, afinada el 2026-09-26: el texto pequeño dice
 * QUÉ VERSIÓN ESTÁ EN USO —"Your version is in use" cuando el interruptor
 * está activado, y NADA cuando se compone la versión por defecto, aunque
 * haya una sustitución guardada sin usar en el disco—. Así se entiende qué
 * significa el interruptor: controla visiblemente esta línea). Exportado
 * para la fijación. */
export const PROMPT_IN_USE_HINT = "Your version is in use";

/** Secciones de prompts en orden de presentación; Shared va deduplicada y al final. */
export interface PromptSection {
	id: keyof PromptView | "shared";
	label: string;
	segments: PromptRow[];
}

/** Mantiene el orden de ensamblado propio de cada agente y después lista
 * una sola vez los fragmentos compartidos. El uso se deriva de la
 * pertenencia real por agente que da la API, nunca de una segunda copia de
 * la lista de fragmentos compartidos de Practice del tiempo de ejecución.
 * Puro; exportado para las pruebas. */
export function sectionedSegments(view: PromptView): PromptSection[] {
	const agents = [
		{ id: "teacher", label: "Teacher" },
		{ id: "prober", label: "Prober" },
		{ id: "practice", label: "Practice" },
	] as const;
	const shared = new Map<string, SegmentInfo>();
	for (const { id } of agents) {
		for (const segment of view[id]) {
			if (segment.shared && !shared.has(segment.path)) shared.set(segment.path, segment);
		}
	}
	return [
		...agents.map(({ id, label }) => ({ id, label, segments: view[id].filter((s) => !s.shared) })),
		{
			id: "shared",
			label: "Shared",
			segments: [...shared.values()].map((segment) => {
				const users = agents.filter(({ id }) => view[id].some((s) => s.path === segment.path)).map(({ label }) => label);
				const usage = users.length > 1 ? `${users.slice(0, -1).join(", ")} and ${users.at(-1)}` : users[0];
				return { ...segment, usageHint: `Used by ${usage}` };
			}),
		},
	];
}

/** Composición: un interruptor de prompt. on = true explícito; off = clave
 * ELIMINADA (ausente = off es el estado de reposo del esquema; un false
 * explícito es lo mismo pero con más ruido). Puro; pruebas. */
export function composePromptSwitch(agent: AgentSettings | undefined, path: string, on: boolean): AgentSettings {
	const prompts = { ...agent?.prompts };
	if (on) prompts[path] = true;
	else delete prompts[path];
	return { ...agent, prompts };
}

/** El aspecto del select plegado (responsable: «el aspecto del menú plegado
 * está bien»); ahora es un botón que abre el desplegable compartido del
 * selector de modelos. */
function MenuTrigger({
	value,
	emptyLabel,
	ariaLabel,
	testid,
	open,
	onClick,
	widthClass,
	disabled,
	hint,
}: {
	value: string;
	hint?: string;
	/** Lo que muestra el disparador cuando no hay sustitución ("Default"). */
	emptyLabel: string;
	ariaLabel: string;
	testid: string;
	open: boolean;
	onClick: () => void;
	/** Responsable (2026-09-20): el disparador de razonamiento tiene una anchura
	 * FIJA, la que necesita el estado Default (los valores que lo cambiaban a
	 * mitad de edición desplazaban la fila); el disparador de modelo toma esa
	 * misma anchura como MÍNIMO, porque sus valores sí varían de longitud. */
	widthClass: string;
	/** El estado de búsqueda sin clave atenúa toda la fila; el disparador lo sigue. */
	disabled?: boolean;
}) {
	const button = (
		<SettingsMenuTrigger
			value={value || emptyLabel}
			aria-label={ariaLabel}
			aria-expanded={open}
			data-testid={testid}
			onClick={() => {
				if (!disabled) onClick();
			}}
			unavailable={disabled}
			className={widthClass}
		/>
	);
	return hint ? <Hint label={hint}>{button}</Hint> : button;
}

/* Todos los desplegables de la sección montan el MenuShell compartido
 * (oleada de arreglos, fragmento B): en un portal a document.body, anclados
 * de forma fija al disparador abierto por testid (el patrón de una sola ref
 * de la sección), abriéndose HACIA ABAJO con el tope de viewport y el volteo
 * automático del armazón. data-lh-menu va en el armazón: la marca de
 * exención del contrato de clic fuera. */

export function AgentSection({
	agent,
	fileAccessError,
	models,
	graph,
	compaction,
	onSectionChange,
	onModelsChange,
	onCompactionChange,
}: {
	agent: AgentSettings | undefined;
	fileAccessError?: string | null;
	/** La sección `models` (fijaciones de ranura; del motor, PUT /api/settings/models). */
	models: ModelsSettings | undefined;
	/** La sección `graph`, aquí SOLO DE LECTURA: la fila graphTools compone su
	 * interruptor general (graph.enabled desactivado atenúa y desactiva la
	 * fila; la barrera efectiva está en el servidor, recalculada en cada turno). */
	graph: GraphSettings | undefined;
	/** La sección `compaction`, con su propio PUT (el umbral es comportamiento
	 * del motor, no una clave de la sección agent; ronda 14 del responsable,
	 * pestaña Agent). */
	compaction: CompactionSettings | undefined;
	/** Escribe la sección agent COMPLETA compuesta (disciplina de PUT que sustituye). */
	onSectionChange: (next: AgentSettings) => boolean | Promise<boolean>;
	/** Escribe la sección models compuesta (ranuras; disciplina de PUT que sustituye). */
	onModelsChange: (next: ModelsSettings) => void;
	/** Escribe la sección compaction completa (disciplina de PUT que sustituye). */
	onCompactionChange: (next: CompactionSettings) => boolean | Promise<boolean>;
}) {
	const { catalog: body, failed: catalogFailed, refresh: refreshCatalog } = useModelCatalog();
	const catalog = body?.models;
	const slots = body?.slots;
	/** El estado de búsqueda en directo (/api/search): la línea de motivo de la fila. */
	const [folderInput, setFolderInput] = useState("");
	const [folderError, setFolderError] = useState<string | null>(null);
	const [search, setSearch] = useState<{ available: boolean; engine: string | null; reason: string } | null>(null);
	/** Qué motores de búsqueda tienen clave (/api/keys): el estado sin claves en
	 * ninguna parte atenúa la fila; las marcas por motor van en las filas del menú. */
	const [engineKeys, setEngineKeys] = useState<Partial<Record<SearchEngineId, boolean>>>({});
	const [prompts, setPrompts] = useState<PromptView | null>(null);
	const [openSegment, setOpenSegment] = useState<string | null>(null);
	const [segmentDraft, setSegmentDraft] = useState<Record<string, string>>({});
	const [segmentStatus, setSegmentStatus] = useState<string | null>(null);
	/** Un único desplegable abierto para toda la sección: qué ranura (o la fila
	 * de búsqueda) y de qué tipo. */
	const [openMenu, setOpenMenu] = useState<{ target: ModelSlotName | "search"; kind: "model" | "thinking" | "engine" | "cache" } | null>(null);
	const [advancedModels, setAdvancedModels] = useState(false);
	const [workerConcurrencyError, setWorkerConcurrencyError] = useState<string | null>(null);
	const menuAnchorRef = useRef<HTMLSpanElement>(null);
	const interactions = useInteractionLayers();

	const refreshSearch = () =>
		fetch("/api/search")
			.then((r) => r.json())
			.then((body: { available: boolean; engine: string | null; reason: string }) => setSearch(body))
			.catch(() => setSearch(null));

	/** Vuelve a leer la vista de segmentos de prompt: la frontera de la señal
	 * para el arreglo del eco de estado del 2026-09-26. Los indicadores
	 * `enabled` de la vista DERIVAN de los interruptores de agent del registro
	 * de ajustes (la verdad del conmutador vive aquí, no en la prop `agent`),
	 * así que una escritura de la sección agent debe volver a leerla o el
	 * conmutador sigue pintando su estado previo a la escritura hasta un
	 * remontaje. Conserva la última vista buena si la relectura falla (la
	 * petición del montaje inicial, más abajo, es dueña del estado de carga/null). */
	const readPrompts = useCallback(() => {
		fetch("/api/settings/prompts")
			.then((r) => r.json())
			.then((body: PromptView) => setPrompts(body))
			.catch(() => {});
	}, []);

	// El catálogo compartido siembra el primer fotograma y se refresca en cada montaje y
	// con cada señal de keys/models. Las props de ajustes siguen siendo dueñas de las selecciones/niveles guardados.
	useSettingsSaved((section) => {
		// LA causa raíz del eco de estado: los interruptores de prompt escriben a través
		// de la sección agent, pero esta vista (la verdad de los conmutadores) nunca volvía a leer:
		// a la ley de settings-saved (todo lector vuelve a leer) le faltaba este
		// lector.
		if (section === "agent") readPrompts();
	});

	useEffect(() => {
		fetch("/api/settings/prompts")
			.then((r) => r.json())
			.then((body: PromptView) => setPrompts(body))
			.catch(() => setPrompts(null));
		fetch("/api/keys")
			.then((r) => r.json())
			.then((body: { keys: { id: string; present: boolean }[] }) => {
				const present: Partial<Record<SearchEngineId, boolean>> = {};
				for (const { id, envVar } of SEARCH_ENGINES) {
					present[id] = body.keys.some((k) => k.id === envVar && k.present);
				}
				setEngineKeys(present);
			})
			.catch(() => {});
	}, []);

	// La línea de motivo vuelve a leer /api/search DESPUÉS de que llegue una escritura de motor:
	// la escritura actualiza la prop `agent` (el espejo del registro del diálogo), así que
	// usar la fijación como clave evita la carrera en la que la petición ganaba al PUT y
	// la pista contradecía al disparador bajo el que está.
	useEffect(() => {
		refreshSearch();
	}, [agent?.search?.engine]);

	// El contrato del desplegable (el del selector de modelo del chat, reflejado): cualquier
	// clic fuera del menú abierto —o un Esc— lo cierra. El Esc se RECLAMA
	// con stopPropagation para que el diálogo de ajustes de detrás NO se cierre
	// también. Un pointerdown en el fondo se deja al diálogo (su propio
	// clic lo cierra todo); un clic dentro del diálogo solo nos cierra a nosotros.
	useEffect(() => {
		if (openMenu === null) return;
		const onPointerDown = (e: PointerEvent) => {
			const testid = openMenu.target === "search" ? "search-engine-menu" : `slot-${openMenu.kind}-menu-${openMenu.target}`;
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>(`[data-testid="${testid}"]`))) return;
			const target = e.target as Node;
			if (menuAnchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (target instanceof Element && target.closest('[role="dialog"]')) {
				setOpenMenu(null);
			}
			// si no: fuera del diálogo; lo gestiona el propio cierre del diálogo.
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [openMenu, interactions]);

	async function saveSegment(path: string, text: string) {
		setSegmentStatus(null);
		const res = await fetch(`/api/settings/prompts/${path}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
		});
		if (!res.ok) {
			setSegmentStatus(`Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
			return;
		}
		readPrompts();
		setSegmentStatus("Saved");
		// Activación automática (decisión del responsable, afinada el 2026-09-26): escribir una sustitución y
		// ponerla a trabajar son UNA sola acción; guardar con el interruptor apagado era
		// la trampa de «hizo algo y no cambió nada» (el prompt compuesto
		// seguía siendo el de por defecto). Ahora el fichero existe, así que el interruptor ON que
		// exige la validación de la sección agent es legal; el orden (fichero, luego
		// interruptor) es el seguro. Guardar una edición con el interruptor ya activado pasa
		// sin más: la escritura del interruptor es idempotente a nivel de registro.
		if (agent?.prompts?.[path] !== true) {
			onSectionChange(composePromptSwitch(agent, path, true));
		}
	}

	async function deleteSegment(path: string) {
		setSegmentStatus(null);
		const res = await fetch(`/api/settings/prompts/${path}`, { method: "DELETE" });
		if (!res.ok) {
			setSegmentStatus(`Delete failed: ${res.status}`);
			return;
		}
		// Desactivación automática, el reflejo de la activación automática al guardar: borrar el fichero con
		// el interruptor activado dejaría huérfano un interruptor ON del registro (la validación de la
		// sección agent respondería 400 a todas las escrituras posteriores mientras el conmutador de la UI ya
		// no puede llegar a la salida de emergencia de OFF: la trampa encontrada en la verificación en vivo del
		// 2026-09-26). Componer aquí el OFF mantiene limpio el registro.
		if (agent?.prompts?.[path] === true) {
			onSectionChange(composePromptSwitch(agent, path, false));
		}
		readPrompts();
		setSegmentStatus("Deleted");
	}

		/** La fila del menú de motores de búsqueda: etiqueta + la discreta marca de clave activa. */
	const engineOption = (
		id: SearchEngineId | "auto",
		label: string,
		active: boolean,
		live: boolean | null,
		onPick: () => void,
	) => (
		<button
			key={id}
			type="button"
			data-testid={`engine-option-${id}`}
			onClick={onPick}
			className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted ${
				active ? "bg-muted/60 text-card-foreground" : "text-card-foreground"
			}`}
		>
			<span>{label}</span>
			<span className="text-muted-foreground">
				{live === null ? (active && <span aria-hidden>✓</span>) : live ? <span aria-hidden>✓ key</span> : <span aria-hidden>· no key</span>}
			</span>
		</button>
	);

	const segmentRow = (info: PromptRow) => {
		const fileExists = info.overrideText !== null;
		const open = openSegment === info.path;
		// La indicación de guardar (decisión del responsable, afinada el 2026-09-26): solo se puede
		// pulsar cuando hay algo que guardar, es decir, cuando el borrador difiere de
		// lo que hay en disco. Un editor sin cambios muestra un Save atenuado e inerte
		// (el botón siempre activo era la mitad de la queja de «no parece que haga
		// nada»).
		const draft = segmentDraft[info.path] ?? info.overrideText ?? "";
		const dirty = draft !== (info.overrideText ?? "");
		return (
			<div key={info.path} data-testid={`prompt-segment-${info.path}`}>
				<SettingsRow
					label={info.path}
					// Decisiones de la revisión general (2026-09-26, afinadas): el texto pequeño
					// dice QUÉ VERSIÓN ESTÁ EN USO: nada cuando se compone la
					// versión por defecto (aunque haya una sustitución guardada sin
					// usar en el disco), "Your version is in use" cuando el
					// interruptor está activado. El significado del interruptor se entiende
					// gracias a esta línea.
					hint={[info.usageHint, info.enabled ? PROMPT_IN_USE_HINT : undefined].filter(Boolean).join(" · ") || undefined}
					testid={`prompt-row-${info.path}`}
				>
					{/* Decisión sobre el atenuado: SOLO el conmutador se atenúa sin
					    fichero de sustitución; el nombre del fichero de arriba sigue con
					    contraste completo (el atenuado de toda la fila está descartado). */}
					<span className={fileExists ? undefined : "opacity-40"}>
						<Toggle
							checked={info.enabled}
							disabled={!fileExists}
							label={`prompt ${info.path}`}
							onChange={(on) => onSectionChange(composePromptSwitch(agent, info.path, on))}
						/>
					</span>
				</SettingsRow>
				<button
					type="button"
					onClick={() => {
						setOpenSegment(open ? null : info.path);
						setSegmentStatus(null);
					}}
					className="text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
				>
					{open ? "Hide text" : "Show text"}
				</button>
				{open && (
					<div className="mt-1 flex flex-col gap-2">
						<div>
							<p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">Source</p>
							<textarea
								readOnly
								value={info.sourceText}
								aria-label="The original instructions"
								className="h-24 w-full resize-y rounded-sm border border-border bg-muted p-2 font-ui text-xs text-muted-foreground"
							/>
						</div>
						<div>
							<p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">Override</p>
							<textarea
								value={segmentDraft[info.path] ?? info.overrideText ?? ""}
								onChange={(e) => setSegmentDraft({ ...segmentDraft, [info.path]: e.target.value })}
								aria-label="Your version of the instructions"
								placeholder="Add your own instructions…"
								className="h-24 w-full resize-y rounded-sm border border-border bg-background p-2 font-ui text-xs text-foreground outline-none"
							/>
						</div>
						<div className="flex items-center gap-3">
							<button
								type="button"
								disabled={!dirty}
								onClick={() => void saveSegment(info.path, segmentDraft[info.path] ?? "")}
								className={
									dirty
										? "text-xs text-foreground underline-offset-2 hover:underline"
										: "cursor-not-allowed text-xs text-muted-foreground/40 underline-offset-2"
								}
							>
								Save
							</button>
							{fileExists && (
								<button
									type="button"
									onClick={() => void deleteSegment(info.path)}
									className="text-xs text-muted-foreground/70 underline-offset-2 hover:text-error hover:underline"
								>
									Delete
								</button>
							)}
							{/* La confirmación discreta en línea, junto a la acción, no la
							    antigua línea que repetía la ruta al pie de la sección (texto de
							    producción: sin rutas de fichero en los estados que ve el usuario).
							    Solo hay un editor abierto a la vez (openSegment), así que un único
							    estado compartido se lee sin ambigüedad. */}
							{segmentStatus && (
								<p className="text-xs text-muted-foreground/70" data-testid="segment-status">
									{segmentStatus}
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		);
	};



	// Se resuelve con el MISMO resolvedor del núcleo que usan los ajustes efectivos
	// del servidor (el precedente de GraphSection): la pista y el texto provisional
	// indican exactamente el número que espera el disparador.
	const resolvedAgent = resolveSettings(agent === undefined ? null : { version: 1, agent }).agent;
	const resolvedCompaction = resolveSettings(
		compaction === undefined ? null : { version: 1, compaction },
	).compaction;

	return (
		<>
			<SettingsGroup label="Models" testid="group-models">
				<button
					type="button"
					data-testid="models-advanced"
					aria-expanded={advancedModels}
					onClick={() => { setAdvancedModels(!advancedModels); setOpenMenu(null); }}
					className="mb-1 self-start text-xs text-muted-foreground hover:text-foreground"
				>{advancedModels ? "Hide advanced settings" : "Show advanced settings"}</button>
				{catalogFailed && <p role="alert" className="text-xs text-error">Model catalog could not be loaded. Check the connection and retry. <button type="button" className="underline" onClick={refreshCatalog}>Retry</button></p>}
				{MODEL_SLOTS.map((slot) => {
					const override = models?.[slot];
					const modelId = override?.model?.id ?? "";
					const provider = override?.model?.provider ?? "";
					const thinking = override?.thinkingLevel ?? "";
					// La fijación resuelta del nivel ahora es solo maquinaria (responsable, oleada
					// de arreglos): la UI nunca nombra la alternativa de fábrica —la pista
					// lleva la plantilla, los disparadores muestran "—" si no hay elección—, pero
					// la fijación sigue rigiendo la LISTA de niveles de razonamiento cuando ninguna sustitución
					// nombra un modelo del que leer los niveles.
					const pin = slots?.[slot];
					// El modelo cuyos niveles rigen la lista de razonamiento: la
					// sustitución o, si no, la fijación resuelta (cuando está en el catálogo
					// federado); la escalera estándar como última alternativa.
					const coord = override?.model ?? pin?.model;
					const chosen = coord ? catalog?.find((m) => m.id === coord.id && m.provider === coord.provider) : undefined;
					const levels = chosen ? chosen.supportedLevels : THINKING_LEVELS;
					const thisMenuOpen = openMenu?.target === slot ? openMenu.kind : null;
					return (
						<SettingsRow
							key={slot}
							label={SLOT_META[slot].label}
							hint={SLOT_META[slot].roster}
							testid={`slot-row-${slot}`}
						>
							{/* El ancla del contrato de clic fuera es el span que
							    contiene AMBOS disparadores del menú abierto. */}
							<span
								ref={thisMenuOpen ? menuAnchorRef : undefined}
								className={`relative flex items-center gap-2 ${advancedModels ? "shrink-0" : ""}`}
							>
								{slot !== "strong" && <><ChatGPTBackgroundAccess provider={coord?.provider} /><NativeSubscriptionBackgroundAccess provider={coord?.provider} /></>}
								<MenuTrigger
									value={modelId ? prettyModel(modelId) : ""}
									hint={modelId ? `${provider}:${modelId}` : undefined}
									emptyLabel="—"
									ariaLabel={`${SLOT_META[slot].label} model`}
									testid={`slot-model-${slot}`}
									open={thisMenuOpen === "model"}
									onClick={() => setOpenMenu(thisMenuOpen === "model" ? null : { target: slot, kind: "model" })}
									widthClass="min-w-20"
								/>
								<MenuTrigger
									// Presentación heredada (fragmento 2, punto 4): sin nivel guardado + un modelo
									// conocido → el nivel RESUELTO (el primero admitido según el orden;
									// lo que ejecuta la construcción del motor). Solo de presentación hasta que una elección escribe.
									value={thinking || (chosen ? defaultOrderLevel(levels) : "")}
									emptyLabel="—"
									ariaLabel={`${SLOT_META[slot].label} thinking`}
									testid={`slot-thinking-${slot}`}
									open={thisMenuOpen === "thinking"}
									onClick={() => setOpenMenu(thisMenuOpen === "thinking" ? null : { target: slot, kind: "thinking" })}
									widthClass="w-20"
								/>
								{advancedModels && <MenuTrigger
									value={cacheRetentionLabel(override?.cacheRetention)}
									emptyLabel="Cache: default"
									ariaLabel={`${SLOT_META[slot].label} cache retention`}
									testid={`slot-cache-${slot}`}
									open={thisMenuOpen === "cache"}
									disabled={!override?.model}
									onClick={() => setOpenMenu(thisMenuOpen === "cache" ? null : { target: slot, kind: "cache" })}
									widthClass="w-40"
								/>}
								{advancedModels && thisMenuOpen === "cache" && <MenuShell
									preferredSide="down"
									anchorTestid={`slot-cache-${slot}`}
									testid={`slot-cache-menu-${slot}`}
									onClose={() => { setOpenMenu(null); return "closed"; }}
									menuClass="flex w-80 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
								>
									<CacheRetentionMenu value={override?.cacheRetention} onPick={(value) => {
										onModelsChange(composeSlotCacheRetention(models, slot, value));
										setOpenMenu(null);
									}} />
								</MenuShell>}
								{thisMenuOpen === "model" && (
									<MenuShell
										preferredSide="down"
											anchorTestid={`slot-model-${slot}`}
										testid={`slot-model-menu-${slot}`}
										onClose={() => { setOpenMenu(null); return "closed"; }}
										menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
									>
										<ModelMenuList
											models={catalog ?? undefined}
											effectiveId={modelId}
											effectiveProvider={provider}
											vision={slot === "vision"}
											onPick={(entry) => {
												// Autorrelleno (fragmento 2, responsable: «rellenar en todas partes»): la
												// elección nueva escribe un nivel; el guardado viaja tal cual
												// (la escritura lo acota en el servidor) o, si no, el nivel según el orden.
												const next = populateLevel(thinking || undefined, entry.supportedLevels);
												onModelsChange(composeSlotModel(models, slot, entry.provider, entry.id, next));
												setOpenMenu(null);
											}}
											footer={
												catalog && catalog.length === 0
													? "No models — add a provider key in Keys"
													: "Runs every agent of this tier"
											}
										/>
									</MenuShell>
								)}
								{thisMenuOpen === "thinking" && (
									<MenuShell
										preferredSide="down"
											anchorTestid={`slot-thinking-${slot}`}
										testid={`slot-thinking-menu-${slot}`}
										onClose={() => { setOpenMenu(null); return "closed"; }}
										menuClass="flex w-44 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
									>
										<ThinkingMenuList
											levels={levels.map(String)}
											// La ✓ se coloca en el nivel RESUELTO para los registros heredados sin valor;
											// el mismo que muestra el disparador.
											effectiveLevel={thinking || (chosen ? defaultOrderLevel(levels) : undefined)}
											onPick={(level) => {
												onModelsChange(composeSlotModel(models, slot, provider, modelId, level));
												setOpenMenu(null);
											}}
										/>
									</MenuShell>
								)}
							</span>
						</SettingsRow>
					);
				})}
				<SettingsRow
					label="Concurrent worker requests"
					hint="Maximum simultaneous background-worker model requests. Direct conversations are not limited."
					testid="worker-request-concurrency-row"
				>
					<div
						className="flex flex-col items-end gap-1"
						onChangeCapture={() => setWorkerConcurrencyError(null)}
						onBlurCapture={(event) => {
							// Los navegadores exponen una entrada numérica incompleta (p. ej. "1e")
							// como valor vacío. Es NO VÁLIDA, no un restablecimiento en blanco.
							if (event.target instanceof HTMLInputElement && event.target.validity.badInput) {
								event.stopPropagation();
								setWorkerConcurrencyError("Enter a positive, safely representable whole number.");
							}
						}}
					>
						<CommitInput
							type="number"
							min={1}
							step={1}
							value={String(agent?.workerRequestConcurrency ?? "")}
							placeholder={String(resolvedAgent.workerRequestConcurrency)}
							ariaLabel="Concurrent worker requests"
							testid="input-worker-request-concurrency"
							onCommit={(value) => {
								const next = composeWorkerRequestConcurrency(agent, value);
								setWorkerConcurrencyError(next.ok ? null : next.error);
								return next.ok ? onSectionChange(next.settings) : false;
							}}
						/>
						{workerConcurrencyError && <p role="alert" className="text-xs text-error">{workerConcurrencyError}</p>}
					</div>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="Tools" testid="group-tools">
				{/* Las herramientas de grafo del sondeador (oleada 7, decisión del
				    responsable 2026-09-23): PRIMERA fila del grupo; su tema es el mapa
				    y su mecanismo es una capacidad del agente, así que vive en Tools
				    pero NO en la lista de conmutadores de herramientas. Tiene su propia
				    clave en la sección agent (agent.graphTools) y la disciplina de pista
				    de la fila de búsqueda: una línea más pequeña debajo que explica qué
				    es: conecta el conocimiento de sesiones anteriores con las nuevas. */}
				{(() => {
					const graphOn = graph?.enabled ?? true;
					return (
						<SettingsRow
							label="Graph tools"
							hint={graphOn ? "Lets the tutor consult your knowledge map between sessions" : "Graph is disabled"}
							testid="graph-tools-row"
							dimmed={!graphOn}
						>
							<Toggle
								checked={agent?.graphTools?.enabled ?? true}
								disabled={!graphOn}
								label="graph tools"
								onChange={(on) => onSectionChange(composeGraphTools(agent, on))}
							/>
						</SettingsRow>
					);
				})()}
				{/* La mecánica de las preguntas (responsable 2026-09-27): segmentada;
				    siempre está activa exactamente una de Multiple choice / Free recall;
				    la elección cambia qué herramienta de preguntas llevan AMBOS agentes
				    (comprobaciones del sondeador + comprobaciones de la enseñanza). Se
				    persiste como agent.tools.explain; ausente = Multiple choice. */}
				{(() => {
					const free = agent?.tools?.explain === true;
					return (
						<SettingsRow
							label="Quizzing"
							hint="How both tutors check your understanding"
							testid="quiz-mechanics-row"
						>
							<div
								role="radiogroup"
								aria-label="Quizzing mechanics"
								className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5"
								>
								{(["choice", "free"] as const).map((m) => {
									const active = m === "free" ? free : !free;
									return (
										<button
											key={m}
											type="button"
											role="radio"
											aria-checked={active}
											data-testid={`quiz-mechanics-${m}`}
											onClick={() => onSectionChange(composeQuizMechanics(agent, m))}
											className={cn(
												"h-8 rounded-md px-3 text-sm font-medium transition-colors",
												active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
											)}
										>
											{m === "choice" ? "Multiple choice" : "Free recall"}
										</button>
									);
								})}
							</div>
						</SettingsRow>
					);
				})()}
				{TOGGLE_TOOLS.map((id) => (
					<SettingsRow
						key={id}
						label={`Tool · ${id}`}
						testid={`tool-row-${id}`}
					>
						<Toggle
							checked={agent?.tools?.[id] ?? true}
							label={`tool ${id}`}
							onChange={(on) => onSectionChange(composeTool(agent, id, on))}
						/>
					</SettingsRow>
				))}
				{(() => {
					const folders = agent?.fileAccess?.folders ?? [];
					const restricted = Boolean(fileAccessError) || agent?.fileAccess?.restricted === true;
					const effectiveAgent = fileAccessError ? { ...agent, fileAccess: { restricted: true, folders } } : agent;
					const addFolder = () => {
						const next = folderInput.trim();
						if (!isFolderEntry(next)) { setFolderError("Enter an absolute path or ~/folder."); return; }
						if (!folders.includes(next)) onSectionChange(composeAddFolder(effectiveAgent, next));
						setFolderInput("");
						setFolderError(null);
					};
					return (
						<div data-testid="file-access-row" className="flex flex-col gap-2">
							<SettingsRow label="File access" hint={!restricted
								? "Broad local source access, except protected locations"
								: folders.length ? "Only listed folders and subfolders."
									: "Restricted: no folders allowed. Add a folder to enable access."}>
								<div className="flex items-center gap-2 text-xs">
									<span>Restrict to listed folders</span>
									<Toggle checked={restricted} label="Restrict to listed folders" onChange={(on) => onSectionChange(composeFileRestriction(effectiveAgent, on))} />
								</div>
							</SettingsRow>
							{fileAccessError && <p role="alert" data-testid="file-access-config-error" className="text-xs text-error">{fileAccessError}</p>}
							<div className="flex gap-2 pl-3">
								<input value={folderInput} aria-label="Allowed folder path" data-testid="file-access-add" placeholder="Absolute path or ~/folder"
									onChange={(event) => { setFolderInput(event.target.value); setFolderError(null); }}
									onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addFolder(); } }}
									className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 font-ui text-xs" />
								<button type="button" data-testid="file-access-add-button" disabled={!folderInput.trim()} onClick={addFolder} className="rounded-sm border border-border px-2 text-xs disabled:opacity-40">Add folder</button>
							</div>
							{folderError && <p role="alert" data-testid="file-access-input-error" className="pl-3 text-xs text-error">{folderError}</p>}
							{folders.map((folder) => (
								<div key={folder} data-testid="file-access-folder" className="flex items-center justify-between gap-4 pl-3 text-xs">
									<span title={folder} className="min-w-0 truncate font-ui text-muted-foreground">{folder}</span>
									<button type="button" aria-label={`Remove ${folder}`} data-testid="file-access-remove"
										onClick={() => onSectionChange(composeRemoveFolder(effectiveAgent, folder))}
										className="rounded-sm px-1.5 text-muted-foreground hover:text-foreground">Remove</button>
								</div>
							))}
						</div>
					);
				})()}
				{(() => {
					const engine = agent?.search?.engine ?? null;
					const anyKey = SEARCH_ENGINES.some(({ id }) => engineKeys[id] === true);
					const open = openMenu?.target === "search";
					return (
						<SettingsRow
							label="Search engine"
							hint={search?.reason ?? undefined}
							testid="search-engine-row"
							dimmed={!anyKey}
						>
							<span ref={open ? menuAnchorRef : undefined} className="relative flex items-center gap-2">
								<MenuTrigger
									value={SEARCH_ENGINES.find(({ id }) => id === engine)?.label ?? ""}
									emptyLabel="Automatic"
									ariaLabel="Search engine"
									testid="search-engine-trigger"
									open={open}
									onClick={() => setOpenMenu(open ? null : { target: "search", kind: "engine" })}
									widthClass="min-w-20"
									disabled={!anyKey}
								/>
								{open && (
									<MenuShell
										preferredSide="down"
											anchorTestid="search-engine-trigger"
										testid="search-engine-menu"
										onClose={() => { setOpenMenu(null); return "closed"; }}
										menuClass="flex w-44 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
									>
										{engineOption("auto", "Automatic", engine === null, null, () => {
											onSectionChange(composeSearchEngine(agent, null));
											setOpenMenu(null);
										})}
										{SEARCH_ENGINES.map(({ id, label }) =>
											engineOption(id, label, engine === id, engineKeys[id] ?? false, () => {
												onSectionChange(composeSearchEngine(agent, id));
												setOpenMenu(null);
											}),
										)}
									</MenuShell>
								)}
							</span>
						</SettingsRow>
					);
				})()}
			</SettingsGroup>

			<SettingsGroup label="Context" testid="group-context">
				<SettingsRow
					label="Compaction threshold"
					hint={`${resolvedCompaction.thresholdTokens} tok`}
					testid="compaction-row-threshold"
				>
					<CommitInput
						type="number"
						value={String(compaction?.thresholdTokens ?? "")}
						placeholder={String(resolvedCompaction.thresholdTokens)}
						ariaLabel="compaction threshold"
						testid="input-compaction-threshold"
						onCommit={(v) => {
							// Vacío = valor de fábrica (la disciplina de la fila del presupuesto):
							// para los números, la ausencia es el «sin valor».
							if (v === "") {
								return onCompactionChange({ ...compaction, thresholdTokens: undefined });
							}
							const n = Number(v);
							if (!Number.isFinite(n) || n <= 0) return false; // entrada errónea: no se escribe
							// Refleja el suelo del servidor (anti-agitación: cada compactación
							// conserva una cola de ~20k tokens); sin techo: el disparador efectivo
							// es de todos modos min(threshold, contextWindow − 16k).
							return onCompactionChange({
								...compaction,
								thresholdTokens: Math.max(COMPACTION_THRESHOLD_FLOOR, Math.round(n)),
							});
						}}
					/>
				</SettingsRow>
				<SettingsRow
					label="Include reasoning in token estimates (OpenAI Responses only)"
					hint="Use saved output-token usage to account for replayed reasoning on matching OpenAI Responses models. Off uses the original text-based estimate."
					testid="compaction-row-reasoning"
				>
					<Toggle
						label="Include reasoning in token estimates (OpenAI Responses only)"
						checked={resolvedCompaction.includeReasoning}
						onChange={(includeReasoning) => onCompactionChange({ ...compaction, includeReasoning })}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="System prompts" testid="group-prompts">
				{prompts === null ? (
					<p className="text-xs text-muted-foreground/70">Loading prompt segments…</p>
				) : (
					<div className="flex flex-col gap-4">
						{/* Teacher, Prober, Practice, Shared: los fragmentos compartidos una sola
						    vez, y la sección propia de cada agente en el orden de ensamblado del prompt. */}
						{sectionedSegments(prompts).map((section) => (
							<div key={section.id} data-testid={`prompt-section-${section.id}`}>
								<p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">
									{section.label}
								</p>
								<div className="flex flex-col gap-2">
									{section.segments.map((info) => segmentRow(info))}
								</div>
							</div>
						))}
					</div>
				)}
			</SettingsGroup>
		</>
	);
}
