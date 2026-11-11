"use client";

/**
 * LA TABLA DE CADENAS (overlay de cadenas; segunda ronda de ajustes del
 * responsable, 2026-09-29): todas las cadenas de razonamiento del grafo en
 * una única superficie A SANGRE — el desenfoque + el fondo translúcido SON
 * la superficie, sin tarjeta interior. La barra superior es LA TopBar
 * compartida (decisión de estandarización: un elemento, todas las
 * superficies — h-15, lh-drag con recortes, select-none, reapertura de la
 * barra lateral, margen para los semáforos; nació de que la barra hecha a
 * mano de este overlay rompía todas las reglas a la vez). El overlay (z-40)
 * tapa la cabecera flotante de Inicio mientras está abierto, así que el
 * propio SidebarToggle de la TopBar es la vía de reapertura.
 *
 * JERARQUÍA (tres niveles, un clic cada uno): GRUPO (la sesión de
 * nacimiento — un chat o un fichero de notas; una cadena vive donde nació
 * su CONCLUSIÓN, decisión del responsable) → CADENA DE RAZONAMIENTO →
 * ENUNCIADOS DE LAS PROPOSICIONES. Desplegar una cadena muestra
 * directamente el texto de los enunciados de sus miembros — los nombres
 * viven en la línea de la cadena, nunca dos veces; una cadena de un solo
 * miembro muestra su único enunciado con un clic. Todo empieza plegado. Una
 * sangría MARCADA lleva la estructura (decisión del responsable: cadenas
 * bien metidas bajo las carpetas, enunciados aún más) — las ÚNICAS líneas
 * son los separadores horizontales entre grupos (con ellos se quitaron las
 * líneas finas verticales de las columnas, decisión del responsable: «todo
 * lo demás queda mejor sin ellas»).
 *
 * LA LÍNEA DE LA CADENA: cada nombre de proposición es un CHIP con un
 * contorno tenue y la LÓGICA hace de conectiva (decisiones del responsable,
 * 2026-09-30): las premisas se unen con el Y LÓGICO de LaTeX (∧) y la
 * conclusión se separa con la IMPLICACIÓN de LaTeX (⟹) — `A ∧ B ⟹ C`,
 * nunca el engañoso `A → B → C`. Los glifos son renders REALES de KaTeX
 * (components/latex-glyph.tsx — el motor matemático de la app, nunca
 * SVG), DESTACADOS en el color de primer plano del tema (blanco), no en
 * gris apagado. Un chip solitario (sin premisas) no lleva glifo — se lee
 * como una proposición independiente; "(no premises)" sobrevive solo como
 * aria-label de la fila.
 *
 * ORDENACIÓN: las tres columnas se pueden ordenar (decisión del
 * responsable — «la coherencia es clave»): Name (A→Z), Props (las mayores
 * primero), Created (las más nuevas primero); el clic alterna asc/desc; un
 * chevron PEQUEÑO marca la cabecera activa. El orden afecta a las filas de
 * grupo Y a las cadenas que contienen.
 *
 * La SELECCIÓN nunca desplaza el diseño (decisión del responsable): una
 * barra flotante inferior — el patrón de Google Fotos — aparece solo
 * cuando hay algo seleccionado y muestra la entrada REAL de los agentes
 * (chainsForSelection sobre la selección plana de ids de nodo: una premisa
 * sin su conclusión cuenta como la cadena de un solo miembro en que se
 * convierte) + Clear. BORRAR (responsable, noche del 2026-09-29: «esta es
 * de verdad la vista en la que debería hacerse el borrado») va en la misma
 * barra, AISLADO en el extremo derecho — un divisor + el par destructivo
 * en rojo — y abre el MISMO diálogo de confirmación de muerte completa que
 * usa el lienzo (las selecciones múltiples listan sus nombres + el impacto
 * unido); con esto el overlay deja de ser de solo lectura: ahora es la
 * superficie de GESTIÓN del grafo. La búsqueda difusa (nombres, alias,
 * enunciados) filtra las cadenas agrupadas y desplegadas automáticamente
 * bajo sus grupos (los grupos sin coincidencias se ocultan; la vista
 * plegada vuelve al borrar la búsqueda).
 *
 * De solo lectura respecto al grafo.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	BookIcon,
	BookOpenIcon,
	FolderPlusIcon,
	Trash2Icon,
	ListTreeIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import { chainsForSelection, chainSourceDirectory, folderEntryCheck, toggleSourceEntries, formatChainLine, fuzzyScore, sourceFileLabel } from "@/src/core";
import type { GraphChain, GraphNode, SourceDirectory, SourceEntry, SourceFolder, SourceEntrySelection } from "@/src/core";
import { EditableSourceName, SourceDragRow, sourceNameMatches, SourceFolderTree, type OrganizationChange } from "./source-folder-tree";
import { chainRow, useChainNavigation } from "./chain-navigation";
import { useServerEvent, useServerResync } from "./server-events";
import { TopBar } from "@/components/top-bar";
import { InteractionLayerOwner, useInteractionLayer } from "./interaction-layers";
import { DeleteSourceDialog } from "@/components/delete-source-dialog";
import { LatexGlyph } from "@/components/latex-glyph";
import { TreeCell, TreeCheckbox, TreeDisclosure, TreeGuide, TreeHeader, TreeSelectionSpacer, TreeSeparator, treeBranchLayout, treeColumnLayout, treeRowLayout } from "./tree-presentation";

/** Las columnas ordenables (decisión del responsable: las tres — coherencia). */
export type ChainSortCol = "name" | "props" | "created";
export interface ChainSort {
	col: ChainSortCol;
	/** 1 = ascendente (A→Z, las más antiguas primero, las menores primero), -1 = descendente. */
	dir: 1 | -1;
}

/** Las cadenas de un grupo comparten el nacimiento de su conclusión (decisión
 *  del responsable). Este registro se monta en cada render a partir de las
 *  cadenas visibles. */
interface ClusterGroup {
	key: string;
	birth: string | null;
	label: string | null;
	kind: "chat" | "notes" | null;
	chains: ReturnType<typeof chainsForSelection>;
	nodeIds: string[];
	newestCreatedAt: string;
}

/** El cuerpo puro de la tabla — exportado para las fijaciones SSR (la
 *  disciplina de la batería de render). Todo el estado (consulta, orden,
 *  selección, despliegue) llega por props; el envoltorio del overlay de más
 *  abajo es su responsable. */
export function ChainTableBody({
	nodes,
	chains: storedChains,
	sessions,
	fileSources,
	query,
	onQuery,
	sort,
	onSort,
	selection,
	expandedClusters,
	expandedChains,
	onToggleCluster,
	onToggleChain,
	onToggleNodes,
	onClear,
	onDelete,
	onClose,
	selectMode,
	onSelect,
	directory: fullDirectory,
	onOrganizationChange,
	selectedFolders = new Set<string>(),
	selectedSources = new Set<string>(),
	onToggleSource = () => {},
	onToggleFolder = () => {},
	keyboardActive = true,
	sourceInventoryPending = false,
	pickerChrome = false,
}: {
	sourceInventoryPending?: boolean;
	pickerChrome?: boolean;
	keyboardActive?: boolean;
	directory?: SourceDirectory;
	onOrganizationChange?: OrganizationChange;
	selectedFolders?: ReadonlySet<string>;
	selectedSources?: ReadonlySet<string>;
	onToggleSource?: (id: string, next: boolean) => void;
	onToggleFolder?: (id: string, next: boolean) => void;
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	query: string;
	onQuery: (v: string) => void;
	sort: ChainSort;
	onSort: (col: ChainSortCol) => void;
	selection: ReadonlySet<string>;
	expandedClusters: ReadonlySet<string>;
	expandedChains: ReadonlySet<string>;
	onToggleCluster: (key: string) => void;
	onToggleChain: (id: string) => void;
	/** La selección es SIEMPRE un conjunto plano de ids de nodo — las casillas de
	 *  grupo, de cadena y de proposición suelta se reducen todas a esto. */
	onToggleNodes: (ids: string[], next: boolean) => void;
	onClear: () => void;
	/** Abre el diálogo de confirmación de muerte completa (responsable, noche del 2026-09-29). */
	onDelete: () => void;
	onClose: () => void;
	/** SELECCIÓN PARA PRÁCTICA (2026-10-04): la confirmación de la barra flotante
	 *  pasa a ser "Practice these" — sin la zona aislada de borrado; quien llama
	 *  decide en qué se convierte la selección. */
	selectMode?: boolean;
	onSelect?: () => void;
}) {
	const [creatingFolder, setCreatingFolder] = useState(false);
	const tableRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const navigation = useChainNavigation(tableRef, searchRef, keyboardActive);
	// Las búsquedas siguen desplegando por defecto orígenes/carpetas, pero los plegados
	// explícitos con teclado o puntero siguen vigentes hasta que cambie la búsqueda.
	const [searchFolds, setSearchFolds] = useState({ query, ids: new Set<string>() });
	useEffect(() => { setSearchFolds({ query, ids: new Set() }); }, [query]);
	const foldedClusters = searchFolds.query === query ? searchFolds.ids : new Set<string>();
	const toggleCluster = (id: string) => {
		if (!query.trim()) { onToggleCluster(id); return; }
		setSearchFolds((previous) => {
			const ids = new Set(previous.query === query ? previous.ids : []);
			if (ids.has(id)) ids.delete(id); else ids.add(id);
			return { query, ids };
		});
	};
	const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
	const directory = useMemo(() => fullDirectory && chainSourceDirectory(fullDirectory), [fullDirectory]);
	const hiddenSourceIds = useMemo(() => new Set(fullDirectory?.sources.filter((s) => s.chatKind === "practice").map((s) => s.id)), [fullDirectory]);
	const sourceRecords = useMemo(() => new Map(directory?.sources.map((s) => [s.id, s])), [directory]);
	const matchesSource = useCallback((birth: string) => sourceNameMatches(directory, birth,
		sourceRecords.get(birth)?.label ?? sessions[birth] ?? (fileSources[birth] === undefined ? null : sourceFileLabel(fileSources[birth])), query),
	[directory, sourceRecords, sessions, fileSources, query]);
	const chains = useMemo(() => chainsForSelection(nodes, storedChains), [nodes, storedChains]);
	// Filtra los grupos de origen, no los nodos globales: las premisas compartidas siguen
	// visibles en los grupos de enseñanza/notas. Conserva intactos la cabecera del grafo y el conjunto elegido.
	const sourceChains = useMemo(() => chains.filter((chain) =>
		!hiddenSourceIds.has(byId.get(chain.conclusion)?.provenance[0]?.chatId ?? "")), [chains, byId, hiddenSourceIds]);
	const searching = query.trim() !== "";
	const allSourceNodes = useMemo(() => {
		const membership = new Map<string, Set<string>>();
		for (const chain of sourceChains) {
			const birth = byId.get(chain.conclusion)?.provenance[0]?.chatId;
			if (!birth) continue;
			const members = membership.get(birth) ?? new Set<string>();
			for (const id of [...chain.premises, chain.conclusion]) members.add(id);
			membership.set(birth, members);
		}
		return membership;
	}, [sourceChains, byId]);

	// El filtro difuso: una cadena es visible cuando CUALQUIER miembro coincide por
	// nombre, alias o enunciado; las cadenas se ordenan por la mejor puntuación de sus miembros.
	const visibleChains = useMemo(() => {
		if (!searching) return sourceChains;
		const scored = sourceChains
			.map((chain) => {
				const birth = byId.get(chain.conclusion)?.provenance[0]?.chatId;
				let best: number | null = birth && matchesSource(birth) ? 0 : null;
				for (const id of [...chain.premises, chain.conclusion]) {
					const node = byId.get(id);
					if (!node) continue;
					const s = fuzzyScore(query, node.name, node.statement, ...node.aliases);
					if (s === null) continue;
					if (best === null || s > best) best = s;
				}
				return best === null ? null : { chain, best };
			})
			.filter((r): r is { chain: (typeof chains)[number]; best: number } => r !== null);
		return scored
			.sort((a, b) => b.best - a.best || (a.chain.id < b.chain.id ? -1 : 1))
			.map(({ chain }) => chain);
	}, [sourceChains, byId, query, searching, matchesSource]);

	// Agrupa las cadenas visibles por el nacimiento de su CONCLUSIÓN (decisión del responsable).
	// Los nacimientos sin etiqueta (procedencia perdida / nunca nombrada) forman un único grupo
	// honesto y atenuado, que va el último al ordenar por nombre.
	const groups = useMemo(() => {
		// Los tipos de sesión deben llegar antes de que puedan pintarse las filas de origen que solo tienen procedencia.
		if (sourceInventoryPending) return [];
		const map = new Map<string, ClusterGroup>();
		for (const source of directory?.sources ?? []) {
			if (searching && !matchesSource(source.id)) continue;
			map.set(source.id, { key: source.id, birth: source.id, label: source.label,
				kind: source.kind === "missing" ? null : source.kind, chains: [], nodeIds: [], newestCreatedAt: "" });
		}
		for (const chain of visibleChains) {
			const conclusion = byId.get(chain.conclusion);
			const birth = conclusion?.provenance[0]?.chatId ?? null;
			const key = birth ?? "\0unlabeled";
			let group = map.get(key);
			if (!group) {
				const label = birth === null ? null : (sourceRecords.get(birth)?.label ?? sessions[birth] ?? (fileSources[birth] === undefined ? null : sourceFileLabel(fileSources[birth])));
				const kind =
					birth === null ? null : sessions[birth] !== undefined ? "chat" : fileSources[birth] !== undefined ? "notes" : null;
				group = { key, birth, label, kind, chains: [], nodeIds: [], newestCreatedAt: "" };
				map.set(key, group);
			}
			group.chains.push(chain);
			for (const id of [...chain.premises, chain.conclusion]) {
				if (!group.nodeIds.includes(id)) group.nodeIds.push(id);
				const createdAt = byId.get(id)?.createdAt ?? "";
				if (createdAt > group.newestCreatedAt) group.newestCreatedAt = createdAt;
			}
		}
		const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
		const list = [...map.values()];
		// Los grupos que ya existen en el grafo conservan la fecha de su miembro más nuevo. Las filas que
		// solo están en el inventario recurren a las fechas del registro; una reimportación no debe rehacer fechas antiguas.
		for (const group of list) if (!group.newestCreatedAt && group.birth) group.newestCreatedAt = sourceRecords.get(group.birth)?.createdAt ?? "";
		// Ley de ordenación (decisión del responsable: las tres columnas ordenables — coherencia):
		// la columna activa ordena TANTO las filas de grupo como las cadenas que contienen; el nombre
		// es el desempate universal (asc). Los grupos sin etiqueta van los últimos al ordenar
		// por nombre (centinela ￿).
		const nameKey = (g: ClusterGroup) => g.label ?? "\uffff";
		const cmpName = (a: ClusterGroup, b: ClusterGroup) => collator.compare(nameKey(a), nameKey(b)) * (sort.col === "name" ? sort.dir : 1);
		const cmpProps = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.nodeIds.length - a.nodeIds.length : a.nodeIds.length - b.nodeIds.length;
		const cmpCreated = (a: ClusterGroup, b: ClusterGroup) =>
			sort.dir === -1 ? b.newestCreatedAt.localeCompare(a.newestCreatedAt) : a.newestCreatedAt.localeCompare(b.newestCreatedAt);
		list.sort((a, b) =>
			sort.col === "created" ? cmpCreated(a, b) || cmpName(a, b) : sort.col === "props" ? cmpProps(a, b) || cmpName(a, b) : cmpName(a, b),
		);
		for (const group of list) {
			const chainName = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.name ?? chain.conclusion;
			const chainSize = (chain: (typeof chains)[number]) => chain.premises.length + 1;
			const chainDate = (chain: (typeof chains)[number]) => byId.get(chain.conclusion)?.createdAt ?? "";
			const cName = (a: (typeof chains)[number], b: (typeof chains)[number]) => collator.compare(chainName(a), chainName(b)) * (sort.col === "name" ? sort.dir : 1);
			const cProps = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainSize(b) - chainSize(a) : chainSize(a) - chainSize(b);
			const cDate = (a: (typeof chains)[number], b: (typeof chains)[number]) =>
				sort.dir === -1 ? chainDate(b).localeCompare(chainDate(a)) : chainDate(a).localeCompare(chainDate(b));
			group.chains.sort((a, b) =>
				sort.col === "created" ? cDate(a, b) || cName(a, b) : sort.col === "props" ? cProps(a, b) || cName(a, b) : cName(a, b),
			);
		}
		return list;
	}, [visibleChains, byId, sessions, fileSources, sort, directory, sourceRecords, searching, matchesSource, sourceInventoryPending]);

	// La forma derivada bajo la barra flotante (la entrada REAL de los agentes).
	const derived = useMemo(() => {
		const selectedNodes = [...selection].map((id) => byId.get(id)).filter((n): n is GraphNode => n !== undefined);
		return chainsForSelection(selectedNodes, storedChains);
	}, [selection, byId, storedChains]);

	const fullySelectedFolders = directory ? new Set([...selectedFolders].filter((id) => folderEntryCheck(directory, id, { sources: selectedSources, folders: selectedFolders }).checked)) : selectedFolders;
	const nameOf = (id: string) => byId.get(id)?.name ?? id;
	const dateOf = (id: string) => byId.get(id)?.createdAt.slice(0, 10) ?? "";
	const dirIcon = (col: ChainSortCol) =>
		sort.col !== col ? null : sort.dir === 1 ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />;

	return (
		<div ref={tableRef} tabIndex={-1} data-testid="chain-table" className="relative flex h-full min-h-0 flex-col outline-none [&_[data-chain-nav-active=true]]:bg-accent/50 [&_[data-chain-nav-row]]:outline-none [&_[data-chain-nav-row]]:scroll-mt-8 [&_[data-chain-nav-row]]:scroll-mb-16">
			{/* LA barra superior compartida (decisión de estandarización): mecánica de
			arrastre, reapertura de la barra lateral, margen para los semáforos — el mismo
			elemento que en todas las superficies de chat. SIN TÍTULO (ronda 11 del
			responsable, 2026-10-05): el registro de título con serifa está RESERVADO —
			siempre nombra una sesión; la tabla de cadenas no nombra nada, así que su
			barra lleva solo recuentos + búsqueda + cerrar. Búsqueda y cerrar se recortan
			con lh-no-drag (la ley de la máscara: más tarde en el DOM). */}
			<TopBar sidebarToggle={!pickerChrome}>
				<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
					{chains.length} {chains.length === 1 ? "chain" : "chains"} · {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
				</span>
				{onOrganizationChange && <button type="button" aria-label="Add folder" data-testid="add-source-folder"
					onClick={() => setCreatingFolder(true)} className="lh-no-drag rounded-lg p-2 text-muted-foreground hover:bg-accent"><FolderPlusIcon className="size-4" /></button>}
				<div className="relative shrink-0">
					<SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						ref={searchRef}
						value={query}
						data-testid="chain-table-search"
						onChange={(e) => onQuery(e.target.value)}
						placeholder="Search nodes…"
						aria-label="Search nodes"
						spellCheck={false}
						className="lh-no-drag h-8 w-56 rounded-lg border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
					/>
				</div>
			<button
					type="button"
					data-testid="chain-table-close"
					onClick={onClose}
					aria-label="Close chains"
					className="lh-no-drag flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
			</TopBar>

			{/* La lista: SIN líneas por fila (decisión del responsable) — los ÚNICOS
			separadores horizontales están entre grupos; la ESCALERA DE ALINEACIÓN
			lleva la jerarquía (ronda 4 del responsable, «duplica la sangría»):
			escalones de dos columnas — cadenas en pl-12 alineadas con el icono de
			carpeta, enunciados en pl-21, donde iría el icono de una cadena).
			Las tres columnas se ordenan, con un chevron pequeño en la activa. */}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{/* La regla SUPERIOR (ronda 5 del responsable: la tabla va enmarcada — una
			línea bajo la cabecera, otra bajo el último grupo y líneas entre grupos). */}
				<TreeHeader sticky>
					<button
						type="button"
						data-testid="sort-name"
						onClick={() => onSort("name")}
						aria-sort={sort.col === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ grow: true, align: "left", className: "flex items-center gap-1 transition-colors hover:text-foreground" })}
					>
						Name {dirIcon("name")}
					</button>
					<button
						type="button"
						data-testid="sort-props"
						onClick={() => onSort("props")}
						aria-sort={sort.col === "props" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ widthClassName: "w-14", align: "right", className: "flex items-center justify-end gap-1 transition-colors hover:text-foreground" })}
					>
						Props {dirIcon("props")}
					</button>
					<button
						type="button"
						data-testid="sort-created"
						onClick={() => onSort("created")}
						aria-sort={sort.col === "created" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
						{...treeColumnLayout({ widthClassName: "w-20", align: "right", className: "flex items-center justify-end gap-1 transition-colors hover:text-foreground" })}
					>
						Created {dirIcon("created")}
					</button>
				</TreeHeader>

				{creatingFolder && onOrganizationChange && <div className="flex items-center px-3 py-2" data-testid="new-folder-row">
					<EditableSourceName name="" initiallyEditing onCancel={() => setCreatingFolder(false)}
						onSave={async (name) => {
						const id = await onOrganizationChange({ action: "create-folder", name, parentId: null });
						onQuery(""); if (id) navigation.focusRow(["folder", id]); setCreatingFolder(false);
					}} />
				</div>}
				{groups.length === 0 && (directory?.organization.folders.length ?? 0) === 0 && (
					<div data-testid="chain-table-nomatch" className="px-4 pt-3 text-xs text-muted-foreground">
						No matching chains.
					</div>
				)}

				<SourceFolderTree groups={groups} directory={directory} query={query} sort={sort} onAction={onOrganizationChange}
					sourceSelection={selectMode ? undefined : { sources: selectedSources, folders: selectedFolders }}
					expanded={expandedClusters} collapsedForSearch={foldedClusters} onToggleExpanded={toggleCluster} selection={selection} selectedFolders={selectedFolders}
					onToggleNodes={onToggleNodes} onToggleFolder={onToggleFolder} allowEmptySelection={!selectMode} allSourceNodes={allSourceNodes}
					renderSource={(group, depth) => {
					const open = searching ? !foldedClusters.has(group.key) : expandedClusters.has(group.key);
					const selectedCount = group.nodeIds.filter((id) => selection.has(id)).length;
					const empty = group.birth === null ? group.nodeIds.length === 0 : !allSourceNodes.get(group.birth)?.size;
					return (
						<div
							key={group.key}
							data-testid={`cluster-group-${group.key}`}
							// Las reglas horizontales (decisiones del responsable, rondas 2 y 5): entre
							// grupos Y bajo el último — la tabla queda enmarcada arriba (cabecera) y
							// abajo. Nunca en filas sueltas.
							{...treeBranchLayout({ depth, className: "border-b border-transparent", style: { marginLeft: depth * 36 } })}
						>
							{/* EL HILO DEL ÁRBOL (rondas 5–6 del responsable): una guía vertical en la
							columna de la flecha desplegable (centro a 37px: pl-3 + casilla 14 +
							hueco 4 + la mitad del desplegable de 14px), ACOTADA por los bordes
							inferiores de las casillas — empieza en el borde inferior de la casilla
							de la propia fila de grupo (top-[23px], que deja un hueco visible al trazo
							de la flecha, medido en vivo) y termina justo en el borde inferior de la
							ÚLTIMA casilla (bottom-[8px] = 9px desde la caja de borde menos la regla de 1px del grupo, medido). */}
							{open && group.chains.length > 0 && (
								<TreeGuide selectionColumn depth={0} data-testid={`cluster-thread-${group.key}`} />
							)}
							{/* La fila de grupo: cabecera del grupo de la sesión de nacimiento. */}
							<SourceDragRow {...chainRow(["source", group.key], depth, open)} kind="source" id={group.key} name={group.label ?? "unlabeled"} enabled={Boolean(onOrganizationChange && group.birth)} {...treeRowLayout()}>
								<RowCheckbox
									disabled={selectMode ? group.nodeIds.length === 0 : !directory?.sources.some((s) => s.id === group.birth)}
									checked={selectMode ? selectedCount === group.nodeIds.length && group.nodeIds.length > 0 : group.birth !== null && selectedSources.has(group.birth)}
									indeterminate={selectMode ? selectedCount > 0 && selectedCount < group.nodeIds.length : false}
									onToggle={(next) => { if (selectMode) onToggleNodes(group.nodeIds, next); else if (group.birth) onToggleSource(group.birth, next); }}
									testid={`cluster-checkbox-${group.key}`}
									label={selectMode ? `Select everything born in ${group.label ?? "unlabeled"}` : `Select source ${group.label ?? "unlabeled"}`}
								/>
								<Expander open={open} onClick={() => toggleCluster(group.key)} testid={`cluster-toggle-${group.key}`} label={`Expand cluster ${group.label ?? "unlabeled"}`} />
								<button type="button" data-source-icon data-testid={`source-icon-${group.key}`} aria-expanded={open} aria-label={`Expand source ${group.label ?? "unlabeled"}`}
									onClick={() => toggleCluster(group.key)} className={`flex h-5 w-3.5 shrink-0 items-center justify-center rounded ${empty ? "text-muted-foreground/60" : "text-muted-foreground"} transition-colors hover:bg-accent hover:text-foreground`}>
									{open ? <BookOpenIcon className="size-3.5 shrink-0" /> : <BookIcon className="size-3.5 shrink-0" />}
								</button>
								{onOrganizationChange && group.birth && group.kind !== null
									? <EditableSourceName name={group.label ?? ""} muted={empty} onSave={(name) => onOrganizationChange({ action: "rename-source", id: group.birth!, name })} />
									: <span className={`min-w-0 flex-1 truncate text-sm font-medium${empty ? " text-muted-foreground/60" : ""}`}>{group.label ?? <span className="text-muted-foreground/60">unlabeled</span>}</span>}
								{group.kind === "notes" && <span className="text-[11px] uppercase tracking-widest text-muted-foreground/60">notes</span>}
								<TreeCell widthClassName="w-14" align="right" className="text-xs tabular-nums text-muted-foreground">
									{group.nodeIds.length}
								</TreeCell>
								<TreeCell widthClassName="w-20" align="right" className="text-xs tabular-nums text-muted-foreground">
									{group.newestCreatedAt.slice(0, 10)}
								</TreeCell>
							</SourceDragRow>

							{/* Las filas de cadena — claramente sangradas bajo la carpeta
							(decisión del responsable); visibles solo cuando el grupo está abierto
							(la búsqueda despliega automáticamente). */}
							{open &&
								group.chains.map((chain) => {
									const memberIds = [...chain.premises, chain.conclusion];
									const chainOpen = expandedChains.has(chain.id);
									const selectedInChain = memberIds.filter((id) => selection.has(id)).length;
									return (
										<div key={chain.id} data-testid={`chain-block-${chain.id}`} {...treeBranchLayout()}>
												{/* El hilo propio de la cadena (rondas 5–6 del responsable): la misma
												ley de acotación un nivel más abajo — en la columna de la flecha de la
												cadena (centro a 73px), desde el borde inferior de la casilla de la fila
												de cadena (top-[22px]) hasta el de la ÚLTIMA fila de enunciado
												(bottom-[8px]) — anclas medidas en vivo. */}
												{chainOpen && memberIds.length > 0 && (
													<TreeGuide selectionColumn depth={1} variant="compact" data-testid={`chain-thread-${chain.id}`} />
												)}
											<div
												{...chainRow(["chain", group.key, chain.id], depth + 1, chainOpen)}
												data-testid={`chain-row-${chain.id}`}
												aria-label={formatChainLine(chain, Object.fromEntries([...byId.entries()].map(([id, n]) => [id, { name: n.name }])))}
												{...treeRowLayout({ depth: 1, variant: "compact" })}
											>
												{selectMode ? <RowCheckbox
													checked={selectedInChain === memberIds.length && memberIds.length > 0}
													indeterminate={selectedInChain > 0 && selectedInChain < memberIds.length}
													onToggle={(next) => onToggleNodes(memberIds, next)}
													testid={`chain-checkbox-${chain.id}`}
													label={`Select chain ${nameOf(chain.conclusion)}`}
												/> : <TreeSelectionSpacer />}
												<Expander open={chainOpen} onClick={() => onToggleChain(chain.id)} testid={`chain-toggle-${chain.id}`} label={`Expand chain ${nameOf(chain.conclusion)}`} />
												{/* La línea de la cadena: los nombres de las proposiciones como
												chips de contorno tenue. LA LÓGICA ES LA CARGA ÚTIL (decisiones del
												responsable, 2026-09-30): las premisas se unen con el Y LÓGICO de
												LaTeX (∧) y la conclusión se separa con la IMPLICACIÓN de LaTeX
												(⟹) — `A ∧ B ⟹ C`, nunca el engañoso `A → B → C` —; los glifos
												se renderizan con KaTeX (el motor matemático de la app),
												DESTACADOS en el color de primer plano del tema (blanco), no en
												el antiguo gris apagado. Un chip solitario se lee como una
												proposición independiente (sin ningún glifo); el aria-label de
												la fila conserva la forma en texto plano. */}
												<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1 text-[13px] leading-tight">
													{memberIds.map((id, i) => {
														const isConclusion = i === memberIds.length - 1;
														return (
															<span key={id} className="flex items-center">
																{i > 0 && (isConclusion ? (
																	<LatexGlyph
																		cmd="\implies"
																		testid={`chain-implies-${chain.id}`}
																		className="px-1.5 text-foreground"
																	/>
																) : (
																	<LatexGlyph
																		cmd="\land"
																		testid={`chain-and-${chain.id}-${i}`}
																		className="px-1.5 text-foreground"
																	/>
																))}
																<span
																	data-testid={`prop-chip-${id}`}
																	className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5"
																>
																	{nameOf(id)}
																</span>
															</span>
														);
													})}
												</span>
												<TreeCell widthClassName="w-14" align="right" className="text-xs tabular-nums text-muted-foreground">
													{memberIds.length}
												</TreeCell>
												<TreeCell widthClassName="w-20" align="right" className="text-xs tabular-nums text-muted-foreground">
													{dateOf(chain.conclusion)}
												</TreeCell>
											</div>

											{/* Las proposiciones — directamente el texto de su ENUNCIADO
											(decisión del responsable: los nombres viven en la línea; una
											cadena de un solo miembro muestra su enunciado con un clic). Filas
											SENCILLAS: la derivación ya está codificada en la línea de la
											cadena — aquí abajo no hay marcador de conclusión. La sangría más
											profunda. */}
											{chainOpen &&
												memberIds.map((id) => {
													const node = byId.get(id);
													if (!node) return null;
													return (
														<div
															key={id}
															{...chainRow(["prop", group.key, chain.id, id], depth + 2)}
															data-testid={`prop-row-${id}`}
															{...treeRowLayout({ depth: 2, variant: "detail" })}
														>
															{selectMode ? <RowCheckbox
																checked={selection.has(id)}
																onToggle={(next) => onToggleNodes([id], next)}
																testid={`prop-checkbox-${id}`}
																label={`Select node ${node.name}`}
															/> : <TreeSelectionSpacer />}
															<span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
																{node.statement}
															</span>
															<TreeCell widthClassName="w-14" />
															<TreeCell widthClassName="w-20" />
														</div>
													);
												})}
										</div>
									);
								})}
							<TreeSeparator data-testid={`source-separator-${group.key}`} outside inset={depth === 0 ? 0 : 1} />
						</div>
					);
				}} />
			</div>

			{/* La barra flotante de selección (decisión del responsable: nunca
			desplaza el diseño — el patrón de Google Fotos). Aparece solo cuando
			hay algo seleccionado; flota sobre el borde inferior de la tabla. */}
			{(selectMode ? selection.size > 0 : selectedSources.size > 0 || fullySelectedFolders.size > 0) && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-4">
					<div
						data-testid="chain-selection-bar"
						className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card py-2 pl-4 pr-2 shadow-lg"
					>
						<span data-testid="chain-selected-summary" className="text-xs font-medium">
							{selectMode ? <>{selection.size} {selection.size === 1 ? "node" : "nodes"} → {derived.length} {derived.length === 1 ? "chain" : "chains"}</>
								: <>{selectedSources.size} {selectedSources.size === 1 ? "source" : "sources"}{fullySelectedFolders.size > 0 && ` · ${fullySelectedFolders.size} ${fullySelectedFolders.size === 1 ? "folder" : "folders"}`}</>}
						</span>
						<button
							type="button"
							data-testid="chain-clear"
							onClick={onClear}
							className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							Clear
						</button>
						{selectMode ? (
							<button
								type="button"
								data-testid="chain-practice-done"
								onClick={onSelect}
								aria-label={`Done picking — ${selection.size} ${selection.size === 1 ? "proposition" : "propositions"} selected`}
								className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/80"
							>
								Done
							</button>
						) : (
							<>
							{/* La zona aislada de peligro (decisión del responsable): un
								divisor pone en cuarentena la acción destructiva en el extremo
								derecho de la barra — las acciones seguras y el interruptor de
								destrucción nunca se mezclan. El diálogo de confirmación de
								muerte completa recoge el clic por error. */}
							<span data-testid="chain-danger-divider" aria-hidden="true" className="h-4 w-px bg-border/70" />
							<button
								type="button"
								data-testid="chain-delete"
								onClick={onDelete}
								aria-label="Delete selected sources and folders"
								className="flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
							>
								<Trash2Icon aria-hidden="true" className="size-3.5" />
								Delete
							</button>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/** El chevron giratorio — plegado apunta a la derecha, desplegado gira hacia
 *  abajo (decisión del responsable: la indicación debe leerse en todas las
 *  filas desplegables). */
function Expander({ open, onClick, testid, label }: { open: boolean; onClick: () => void; testid: string; label: string }) {
	return <TreeDisclosure open={open} onClick={onClick} data-testid={testid} aria-label={label} />;
}

/** La casilla — marcada/indeterminada (cadenas/grupos parciales); la propiedad
 *  del DOM se fija mediante ref (React no expone `indeterminate`). */
function RowCheckbox({
	checked,
	disabled = false,
	indeterminate = false,
	onToggle,
	testid,
	label,
}: {
	checked: boolean;
	disabled?: boolean;
	indeterminate?: boolean;
	onToggle: (next: boolean) => void;
	testid: string;
	label: string;
}) {
	return (
		<TreeCheckbox disabled={disabled} checked={checked} indeterminate={indeterminate}
			data-testid={testid} aria-label={label} onChange={(e) => onToggle(e.target.checked)} />
	);
}

/** El envoltorio del overlay de la vista de grafo: es responsable de la
 *  consulta, el orden, la selección y el despliegue; se monta en posición
 *  ABSOLUTA DENTRO del área del grafo, a sangre (decisión del responsable:
 *  la superficie translúcida desenfocada ES el overlay — sin tarjeta
 *  interior). Esc y la X de la barra superior lo cierran (ya no queda un
 *  margen de fondo en el que hacer clic). De solo lectura respecto al grafo. */
export function ChainTableOverlay({
	open,
	nodes,
	chains: storedChains,
	sessions,
	fileSources,
	onClose,
	/** SELECCIÓN PARA PRÁCTICA (visión del responsable, 2026-10-04): la selección
	 *  es PERSISTENTE y pertenece a quien llama — cuando están estas props, la
	 *  tabla es CONTROLADA (cada marcar/limpiar/poda por borrado se comunica
	 *  hacia arriba de inmediato; el chip del lado del compositor lo refleja en
	 *  vivo). selectMode solo cambia la barra flotante: Done en lugar de la zona
	 *  aislada de borrado (borrar mientras se elige es pegarse un tiro en el pie). */
	selectMode,
	controlledSelection,
	onSelectionChange,
	keyboardActive = true,
	registerInteraction = true,
	pickerChrome = false,
}: {
	open: boolean;
	/** El selector de conocimiento del host tiene margen libre, pero no tiene acción de reabrir la barra lateral. */
	pickerChrome?: boolean;
	/** Un selector de conocimiento del host se registra una vez a través de su panel o de su envoltorio modal. */
	registerInteraction?: boolean;
	/** Propiedad interna del host; la práctica normal conserva el valor por defecto existente. */
	keyboardActive?: boolean;
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	onClose: () => void;
	selectMode?: boolean;
	controlledSelection?: ReadonlySet<string>;
	onSelectionChange?: (next: ReadonlySet<string>) => void;
}) {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<ChainSort>({ col: "name", dir: 1 });
	const [internalSelection, setInternalSelection] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedClusters, setExpandedClusters] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedChains, setExpandedChains] = useState<ReadonlySet<string>>(() => new Set());
	const [deletion, setDeletion] = useState<{ sources: SourceEntry[]; folders: SourceFolder[] } | null>(null);
	const deleteOpen = deletion !== null;
	const [directory, setDirectory] = useState<SourceDirectory>();
	const [directoryPending, setDirectoryPending] = useState(true);
	const visibleDirectory = useMemo(() => directory && chainSourceDirectory(directory), [directory]);
	const [directoryFailure, setDirectoryFailure] = useState("");
	const [entrySelection, setEntrySelection] = useState<SourceEntrySelection>(() => ({ sources: new Set(), folders: new Set() }));
	useEffect(() => {
		if (!visibleDirectory) return;
		setEntrySelection((previous) => {
			const sources = new Set([...previous.sources].filter((id) => visibleDirectory.sources.some((s) => s.id === id)));
			const folders = new Set([...previous.folders].filter((id) => visibleDirectory.organization.folders.some((f) => f.id === id)));
			return sources.size === previous.sources.size && folders.size === previous.folders.size ? previous : { sources, folders };
		});
	}, [visibleDirectory]);
	const requestVersion = useRef(0);
	const directoryOpening = useRef(0);
	const directoryRequest = useRef<AbortController | null>(null);
	const mutationTail = useRef<Promise<unknown>>(Promise.resolve());
	const readDirectory = useCallback(async () => {
		const version = ++requestVersion.current;
		directoryRequest.current?.abort();
		const request = new AbortController();
		directoryRequest.current = request;
		try {
			const response = await fetch("/api/graph/sources", { cache: "no-store", signal: request.signal });
			if (!response.ok) throw new Error("Could not read source organization.");
			const body = await response.json() as SourceDirectory;
			if (!request.signal.aborted && version === requestVersion.current) { setDirectory(body); setDirectoryPending(false); setDirectoryFailure(""); }
		} catch (error) { if (!request.signal.aborted && version === requestVersion.current) setDirectoryFailure(error instanceof Error ? error.message : String(error)); }
	}, []);
	useEffect(() => {
		if (open) void readDirectory();
		return () => {
			requestVersion.current++;
			directoryOpening.current++;
			directoryRequest.current?.abort();
			directoryRequest.current = null;
			// Conserva la organización en caché, pero exige tipos de origen nuevos en CADA apertura.
			setDirectoryPending(true);
		};
	}, [open, readDirectory]);
	useServerEvent("sources-changed", () => { if (open) void readDirectory(); });
	useServerEvent("chats-changed", () => { if (open) void readDirectory(); });
	useServerResync(() => { if (open) void readDirectory(); });
	const changeOrganization: OrganizationChange = (action) => {
		const opening = directoryOpening.current;
		// Serializa las ediciones de esta página e invalida las lecturas notificar-y-luego-leer más antiguas.
		const operation = mutationTail.current.catch(() => {}).then(async () => {
			try {
				const response = await fetch("/api/graph/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
				const body = await response.json();
				if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save source organization.");
				if (opening === directoryOpening.current) {
					requestVersion.current++;
					setDirectory(body as SourceDirectory); setDirectoryPending(false); setDirectoryFailure("");
				}
				if (action.action === "rename-source") {
					const entry = (body as SourceDirectory).sources.find((s) => s.id === action.id);
					window.dispatchEvent(new CustomEvent(entry?.kind === "chat" ? "lh:chat-renamed" : "lh:source-renamed", { detail: { id: action.id, title: action.name } }));
				}
				return typeof body.createdFolderId === "string" ? body.createdFolderId : undefined;
			} catch (error) { setDirectoryFailure(error instanceof Error ? error.message : String(error)); throw error; }
		});
		mutationTail.current = operation;
		return operation;
	};
	const selectedSources = new Set([...entrySelection.sources].filter((id) => visibleDirectory?.sources.some((s) => s.id === id)));
	const selectedFolders = new Set([...entrySelection.folders].filter((id) => directory?.organization.folders.some((f) => f.id === id)));
	const fullySelectedFolders = new Set([...selectedFolders].filter((id) => visibleDirectory && folderEntryCheck(visibleDirectory, id, { sources: selectedSources, folders: selectedFolders }).checked));
	const toggleEntries = (kind: "source" | "folder", id: string, checked: boolean) => {
		if (visibleDirectory) setEntrySelection((previous) => toggleSourceEntries(visibleDirectory, previous, kind, id, checked));
	};

	// Controlada cuando quien llama eleva la selección (el conjunto elegido de la
	// práctica); interna (no controlada) en otro caso — la del propio flujo de borrado.
	const selection = controlledSelection ?? internalSelection;
	const applySelection = (next: ReadonlySet<string>) => {
		if (onSelectionChange) onSelectionChange(next);
		else setInternalSelection(next);
	};

	const rootRef = useRef<HTMLDivElement>(null);
	const inheritedOwner = useContext(InteractionLayerOwner);
	const layer = useInteractionLayer({
		kind: "view", enabled: open && keyboardActive && registerInteraction, rootRef,
		onClose: () => { onClose(); return "closed"; },
	});

	if (!open) return null;

	const toggleNodes = (ids: string[], next: boolean) => {
		const s = new Set(selection);
		for (const id of ids) {
			if (next) s.add(id);
			else s.delete(id);
		}
		applySelection(s);
	};
	const toggleIn = (set: ReadonlySet<string>, id: string) => {
		const s = new Set(set);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		return s;
	};

	return (
		<InteractionLayerOwner.Provider value={registerInteraction && keyboardActive ? layer.id : inheritedOwner}>
			<div
				ref={rootRef}
				data-testid="chain-table-overlay"
				className="absolute inset-0 z-40 flex flex-col bg-background/80 backdrop-blur-sm"
				style={registerInteraction ? { zIndex: 100 + layer.order } : undefined}
			>
				{directoryFailure && <p role="alert" className="px-3 py-1 text-xs text-error">{directoryFailure}</p>}
				<ChainTableBody
					pickerChrome={pickerChrome}
					keyboardActive={keyboardActive && !deleteOpen}
					directory={directory}
					onOrganizationChange={directory ? changeOrganization : undefined}
					selectedFolders={selectedFolders}
					selectedSources={selectedSources}
					onToggleSource={(id, next) => toggleEntries("source", id, next)}
					onToggleFolder={(id, next) => toggleEntries("folder", id, next)}
					sourceInventoryPending={directoryPending}
					nodes={nodes}
					chains={storedChains}
					sessions={sessions}
					fileSources={fileSources}
					query={query}
					onQuery={setQuery}
					sort={sort}
					onSort={(col) =>
						setSort((prev) =>
							prev.col === col
								? { col, dir: prev.dir === 1 ? -1 : 1 }
								: { col, dir: col === "name" ? 1 : -1 },
						)
					}
					selection={selection}
					expandedClusters={expandedClusters}
					expandedChains={expandedChains}
					onToggleCluster={(key) => setExpandedClusters((prev) => toggleIn(prev, key))}
					onToggleChain={(id) => setExpandedChains((prev) => toggleIn(prev, id))}
					onToggleNodes={toggleNodes}
					onClear={() => { if (selectMode) applySelection(new Set()); else setEntrySelection({ sources: new Set(), folders: new Set() }); }}
					onDelete={() => setDeletion({
						sources: directory?.sources.filter((s) => selectedSources.has(s.id)) ?? [],
						folders: directory?.organization.folders.filter((f) => fullySelectedFolders.has(f.id)) ?? [],
					})}
					onClose={onClose}
					selectMode={selectMode}
					onSelect={onClose}
				/>
			</div>
			{!selectMode && <DeleteSourceDialog open={deleteOpen}
				sources={deletion?.sources ?? []}
				folders={deletion?.folders ?? []}
				onClose={() => setDeletion(null)}
				onDelete={(deleteSessions) => {
					const opening = directoryOpening.current;
					const operation = mutationTail.current.catch(() => {}).then(async () => {
						let graphRevision: number | undefined;
						try {
							const response = await fetch("/api/graph/sources", { method: "DELETE", headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ sourceIds: deletion?.sources.map((s) => s.id) ?? [], folderIds: deletion?.folders.map((f) => f.id) ?? [], deleteSessions }) });
							const body = await response.json();
							if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not delete sources.");
							graphRevision = body.graphRevision;
							if (opening === directoryOpening.current) {
								requestVersion.current++; setDirectory(body as SourceDirectory); setDirectoryPending(false); setDirectoryFailure("");
							}
							setEntrySelection({ sources: new Set(), folders: new Set() });
						} finally {
							// Una respuesta fallida puede venir después de escrituras parciales en disco.
							// Refresca el contenido del grafo además del directorio, en los dos modos de Inicio.
							void readDirectory();
							window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { graphRevision } }));
						}
					});
					mutationTail.current = operation; return operation;
				}}
			/>}
		</InteractionLayerOwner.Provider>
	);
}
