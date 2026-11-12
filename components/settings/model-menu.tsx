"use client";
/**
 * El menú de modelos (extraído el 2026-09-20 de model-picker.tsx, a petición
 * del responsable: los selects de rol de los ajustes del agente usan
 * EXACTAMENTE el mismo desplegable que el selector de modelo del chat; mismo
 * aspecto, misma maquinaria). La maquinaria de búsqueda difusa + recorrido
 * con flechas + elección con Enter vive aquí una sola vez; cada montaje solo
 * es dueño del armazón del popover (posicionamiento, clic fuera, Esc: el
 * control del chat se abre HACIA ARRIBA desde la barra inferior y las filas
 * de ajustes se abren HACIA ABAJO dentro del diálogo).
 *
 * La oleada de apariencia (2026-09-26) añadió el selector de fuente de
 * lectura sobre la misma maquinaria: FontMenuList (familias en vez de
 * modelos, más la fila DEFAULT que siempre se puede ofrecer y una entrada de
 * escape para una familia personalizada).
 *
 * Maquinaria de teclado (pulido del responsable, 2026-09-17): el foco SE
 * QUEDA en el campo de búsqueda; ↑/↓ recorren los resultados filtrados
 * (acotado, sin dar la vuelta) y Enter elige la fila recorrida (o el primer
 * resultado si no se ha recorrido nada). stopPropagation mantiene estas
 * teclas fuera de cualquier otro listener mientras el menú está abierto.
 */

import { useEffect, useRef, useState } from "react";
import type { ModelCatalogEntry } from "@/src/core";
import { CLAUDE_CODE_PROVIDER, CUSTOM_PROVIDER, fuzzyScore, subscriptionLabel } from "@/src/core";
import { formatTokens } from "@/components/usage-format";
import { SearchMenuList } from "./search-menu-list";

function priceLabel(cost: ModelCatalogEntry["cost"]): string {
	if (!cost) return "Unpriced";
	const fmt = (n: number) => `$${n < 1 ? n.toFixed(2).replace(/0$/, "") : n.toFixed(2)}`;
	return `${fmt(cost.input)}/${fmt(cost.output)}`;
}

/** El cuerpo del desplegable de modelos: búsqueda difusa + lista ordenada.
 * `models === undefined` es el estado de carga del catálogo; una lista de
 * resultados vacía tiene su propia línea discreta. */
export function ModelMenuList({
	models,
	effectiveId,
	effectiveProvider,
	onPick,
	footer,
	vision,
}: {
	/** El catálogo completo; undefined mientras carga. */
	models: ModelCatalogEntry[] | undefined;
	/** El id efectivo actual (la fila recibe el resaltado discreto). */
	effectiveId: string | undefined;
	/** El proveedor del id efectivo (oleada de ranuras de modelo: el catálogo
	 * federa varios proveedores y los ids pueden chocar entre ellos; el
	 * resaltado debe coincidir en AMBAS coordenadas o cae en la fila
	 * equivocada). */
	effectiveProvider?: string;
	/** Recibe la entrada elegida. */
	onPick: (entry: ModelCatalogEntry) => void;
	/** Nota discreta al pie de la lista (según el contexto). */
	footer?: string;
	/** Ranura de visión: solo se pueden elegir modelos que admiten imágenes,
	 * más todos los modelos de endpoints personalizados, cuya capacidad puede
	 * que el endpoint no informe. Los que admiten imágenes suben arriba. */
	vision?: boolean;
}) {
	// Ranura de visión: los integrados deben declarar entrada de imagen; los modelos de endpoints
	// personalizados siguen siendo elegibles (puede que el endpoint no informe la modalidad). Los que admiten
	// imágenes suben al principio de la lista.
	const visionItems = vision
		? models?.filter((m) => m.input.includes("image") || m.provider === CUSTOM_PROVIDER.id)
		: models;
	return (
		<>
			<SearchMenuList
				items={visionItems}
				itemKey={(m) => `${m.provider}/${m.id}`}
				searchTerms={(m) => [m.provider, m.id, m.name]}
				compare={(a, b) => a.id.localeCompare(b.id)}
				prioritize={vision ? (m) => m.input.includes("image") : undefined}
				isSelected={(m) => m.id === effectiveId && m.provider === (effectiveProvider ?? m.provider)}
				onPick={onPick}
				searchTestid="model-search"
				listTestid="model-list"
				optionTestid={(m) => `model-option-${m.id.replace(/[^a-z0-9-]/gi, "_")}`}
				placeholder="Search models…"
				loading="Loading models…"
				empty="No models match."
				renderItem={(m) => <>
					<span className="flex items-center justify-between gap-2">
						<span className="truncate text-card-foreground">{m.name}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground" title={m.provider === CLAUDE_CODE_PROVIDER ? "Billing is determined by your Claude Code configuration; LearnHarness does not estimate it." : subscriptionLabel(`${m.provider}:${m.id}`) ? "Subscription connection" : m.cost ? "USD per 1M tokens in/out" : "Price unavailable"}>
							{m.provider === CLAUDE_CODE_PROVIDER ? "CLI billing" : subscriptionLabel(`${m.provider}:${m.id}`) ?? priceLabel(m.cost)}
						</span>
					</span>
					<span className="flex items-center justify-between gap-2 text-muted-foreground">
						<span className="truncate">{subscriptionLabel(`${m.provider}:${m.id}`) ? `${subscriptionLabel(`${m.provider}:${m.id}`)} (subscription)` : m.provider} · {m.id}</span>
						<span className="shrink-0 tabular-nums">{m.contextWindow === null ? "—" : formatTokens(m.contextWindow)}</span>
					</span>
				</>}
			/>
			{footer && (
				<div className="mt-1 border-t px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

/** El cuerpo del desplegable de niveles de razonamiento: los niveles que
 * este modelo admite de verdad, con ✓ en el efectivo. Misma forma que el
 * del selector del chat. */
export function ThinkingMenuList({
	levels,
	effectiveLevel,
	onPick,
	empty,
	footer,
}: {
	levels: string[];
	effectiveLevel: string | undefined;
	onPick: (level: string) => void;
	/** Se muestra en lugar de la lista cuando no hay niveles. */
	empty?: string;
	footer?: string;
}) {
	return (
		<>
			{levels.length === 0 ? (
				<div className="px-2 py-3 text-center text-muted-foreground">{empty ?? "No thinking levels."}</div>
			) : (
				levels.map((level) => (
					<button
						key={level}
						type="button"
						data-testid={`thinking-option-${level}`}
						onClick={() => onPick(level)}
						className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted ${
							level === effectiveLevel ? "bg-muted/60 text-card-foreground" : "text-card-foreground"
						}`}
					>
						<span>{level}</span>
						{level === effectiveLevel && <span aria-hidden>✓</span>}
					</button>
				))
			)}
			{footer && (
				<div className="mt-1 border-t px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

/** El cuerpo del desplegable de selección de proveedor (pulido de la oleada
 * 5 de claves, 2026-09-21: el responsable quería que el control de añadir
 * proveedor siguiera el lenguaje de los desplegables de la app): la misma
 * maquinaria de búsqueda difusa + recorrido con flechas + Enter sobre la
 * tabla de proveedores de pi-ai. Las filas muestran la etiqueta del
 * proveedor y, a la derecha, su variable de entorno en mono discreta. */
export function ProviderMenuList({
	providers,
	onPick,
}: {
	providers: { id: string; envVar: string; label: string }[];
	onPick: (provider: { id: string; envVar: string; label: string }) => void;
}) {
	const [query, setQuery] = useState("");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const results = providers
		.map((p) => ({ p, s: fuzzyScore(query, p.id, p.envVar, p.label) }))
		.filter((r) => r.s !== null)
		.sort((a, b) => b.s! - a.s! || a.p.id.localeCompare(b.p.id))
		.map((r) => r.p);

	return (
		<>
			<input
				ref={searchRef}
				data-testid="provider-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setMenuIdx(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						if (results.length === 0) return;
						setMenuIdx((i) =>
							e.key === "ArrowDown"
								? Math.min((i ?? -1) + 1, results.length - 1)
								: Math.max((i ?? results.length) - 1, 0),
						);
					} else if (e.key === "Enter") {
						const chosen = results[menuIdx ?? 0];
						if (chosen) {
							e.preventDefault();
							e.stopPropagation();
							onPick(chosen);
						}
					}
				}}
				placeholder="Search providers…"
				className="lh-input mb-1.5 w-full rounded-lg border bg-background px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
			/>
			{results.length === 0 && (
				<div className="px-2 py-3 text-center text-muted-foreground">No providers match.</div>
			)}
			<ul ref={listRef} data-testid="provider-list" className="flex max-h-72 flex-col overflow-y-auto px-1">
				{results.map((p, i) => (
					<li key={p.id}>
						<button
							type="button"
							data-testid={`provider-option-${p.id.replace(/[^a-z0-9-]/gi, "_")}`}
							data-idx={i}
							onClick={() => onPick(p)}
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
								i === menuIdx ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
							}`}
						>
							<span className="truncate text-card-foreground">{p.label}</span>
							<span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.envVar}</span>
						</button>
					</li>
				))}
			</ul>
		</>
	);
}

/** El conjunto de filas del desplegable de fuente de lectura: la MISMA
 * maquinaria difusa + recorrido con flechas + Enter sobre familias de
 * fuentes (oleada de apariencia, 2026-09-26). La fila DEFAULT (null) es una
 * candidata como cualquier familia: coincide con consultas vacías y con
 * "source"/"sans"/"default", así que una lista sin filtrar se abre con el
 * valor por defecto primero y una lista filtrada lo quita honestamente:
 * Enter nunca puede elegir una fila que no esté en pantalla. Puro;
 * exportado para las pruebas. */
export function fontMenuResults(query: string, families: string[]): Array<string | null> {
	const scored = families
		.map((f) => ({ f, s: fuzzyScore(query, f) }))
		.filter((r) => r.s !== null)
		.sort((a, b) => b.s! - a.s! || a.f.localeCompare(b.f))
		.map((r) => r.f);
	// La identidad buscable de la fila por defecto: la familia de fábrica + la
	// palabra "default" (el sufijo con el que se renderiza).
	const defaultScore = fuzzyScore(query, "Source Sans 3", "default");
	if (query.trim() === "" || defaultScore !== null) return [null, ...scored];
	return scored;
}

/** La decisión de la fila de acción de familia personalizada (pura,
 * 2026-09-26): una consulta escrita que no coincide con NINGUNA familia se
 * convierte en la elección personalizada "Use '<query>'"; una familia que
 * coincide es mejor elección, así que la fila de acción solo existe cuando
 * no hay nada más que elegir. Exportada para las pruebas. */
export function customFamilyFor(query: string, families: string[]): string | null {
	const trimmed = query.trim();
	if (trimmed === "") return null;
	return fontMenuResults(query, families).length === 0 ? trimmed : null;
}

/** El cuerpo del desplegable de fuente de lectura: UN solo campo de
 * búsqueda (petición del responsable 2026-09-26: «¿por qué dos?»): la
 * maquinaria difusa filtra las familias y, cuando nada coincide, una fila de
 * acción "Use '<query>'" confirma el texto escrito como familia
 * personalizada; la antigua entrada personalizada aparte ya no existe, el
 * campo de búsqueda absorbió su función. `families === undefined` es el
 * estado de enumeración; la alternativa curada llega como familias simples
 * con un pie que lo dice honestamente. */
export function FontMenuList({
	families,
	effectiveFamily,
	onPick,
	footer,
}: {
	/** Familias de fuentes enumeradas (ya deduplicadas/ordenadas por el
	 * llamante); undefined mientras se ejecuta la enumeración. */
	families: string[] | undefined;
	/** La sustitución guardada (null = la Source Sans 3 de fábrica). */
	effectiveFamily: string | null;
	/** Recibe la elección: una cadena de familia, o null para el valor por defecto. */
	onPick: (family: string | null) => void;
	/** Nota discreta al pie de la lista. */
	footer?: string;
}) {
	const [query, setQuery] = useState("");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const results = fontMenuResults(query, families ?? []);
	// La fila de acción de familia personalizada: solo cuando una consulta escrita no coincide
	// con nada (una familia que coincide es mejor elección). Enter la elige.
	const customFamily = customFamilyFor(query, families ?? []);
	const walkable: Array<string | null> = customFamily !== null ? ["__custom__"] : results;

	return (
		<>
			<input
				ref={searchRef}
				data-testid="font-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setMenuIdx(null); // consulta nueva → el recorrido vuelve a empezar con Enter/↓
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						if (walkable.length === 0) return;
						setMenuIdx((i) =>
							e.key === "ArrowDown"
								? Math.min((i ?? -1) + 1, walkable.length - 1)
								: Math.max((i ?? walkable.length) - 1, 0),
						);
					} else if (e.key === "Enter") {
						const chosen = walkable[menuIdx ?? 0];
						if (chosen !== undefined) {
							e.preventDefault();
							e.stopPropagation();
							onPick(chosen === "__custom__" ? customFamily : chosen);
						}
					}
				}}
				placeholder="Search fonts…"
				className="lh-input mb-1.5 w-full rounded-lg border bg-background px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
			/>
			{!families && <div className="px-2 py-3 text-center text-muted-foreground">Loading fonts…</div>}
			<ul ref={listRef} data-testid="font-list" className="flex max-h-72 flex-col overflow-y-auto px-1">
				{families &&
					results.map((family, i) => {
						const isDefault = family === null;
						const effective = isDefault ? effectiveFamily === null : family === effectiveFamily;
						return (
							<li key={family ?? "__default"}>
								<button
									type="button"
									data-testid={isDefault ? "font-option-default" : `font-option-${family.replace(/[^a-z0-9-]/gi, "_")}`}
									data-idx={i}
									onClick={() => onPick(family)}
									className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
										i === menuIdx ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
									}${effective && i !== menuIdx ? " bg-muted/60" : ""}`}
								>
									<span className="truncate text-card-foreground">{family ?? "Source Sans 3"}</span>
									<span className="shrink-0 text-muted-foreground">{isDefault ? "default" : effective && <span aria-hidden>✓</span>}</span>
								</button>
							</li>
						);
					})}
				{families && customFamily !== null && (
					<li>
						<button
							type="button"
							data-testid="font-option-custom"
							data-idx={0}
							onClick={() => onPick(customFamily)}
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
								menuIdx === 0 ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
							}`}
						>
							<span className="truncate text-card-foreground">Use “{customFamily}”</span>
							<span className="shrink-0 text-muted-foreground">custom</span>
						</button>
					</li>
				)}
			</ul>
			{footer && <div className="px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>}
		</>
	);
}
