/**
 * LA TABLA DE CADENAS: fijaciones de render SSR (la disciplina de la batería de
 * render: cuerpos puros, renderToStaticMarkup, testids). El rediseño del
 * responsable (2026-09-29 por la tarde): tabla a sangre (el desenfoque + la
 * translucidez SON la superficie), jerarquía grupo → cadena → enunciado (una
 * cadena vive en el grupo de nacimiento de su CONCLUSIÓN; desplegar una cadena
 * muestra los enunciados directamente: los nombres viven en la línea, nunca dos
 * veces), ETIQUETAS de proposición + conectivas LaTeX ∧/⟹ (las premisas se unen
 * con conjunción, la conclusión se separa con implicación: KaTeX REAL
 * renderizado, blanco destacado; una etiqueta sola = una proposición
 * independiente; la anotación "(no premises)" ha muerto), chevrones que giran,
 * iconos de carpeta/waypoints, una barra de selección flotante abajo que nunca
 * desplaza el layout y una búsqueda difusa que despliega solos los grupos que
 * coinciden.
 *
 * RONDA 2 (refinamientos del responsable, 2026-09-29 tarde): la barra superior es
 * LA TopBar compartida (h-15, lh-drag + select-none, reapertura de la barra
 * lateral, tamaño de título estándar); una sangría DESTACADA lleva la jerarquía:
 * las ÚNICAS líneas que quedan son los separadores entre grupos (desaparecen las
 * líneas finas verticales de columna y las líneas por fila); las filas de
 * enunciado son SIMPLES (sin marcador de conclusión); LAS TRES columnas se
 * ordenan (también Props, por coherencia) con un chevron PEQUEÑO en la cabecera activa.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
const renderToStaticMarkup = (node: React.ReactNode) => renderMarkup(<InteractionLayersProvider>{node}</InteractionLayersProvider>);
import { describe, it } from "node:test";
import { ChainTableBody, ChainTableOverlay } from "../components/chain-table.tsx";
import type { ChainSort } from "../components/chain-table.tsx";
import type { GraphChain, GraphNode } from "../src/core/contracts.ts";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { TreeCell, TreeCheckbox, TreeDisclosure, TreeGuide, TreeHeader, TreeRow, treeRowLayout } from "../components/tree-presentation.tsx";

/** El grafo de la fixture: dos cadenas de follows + una independiente:
 *  a → c1 ← b  (cadena uno, conclusión nacida en chat1), d → e (cadena dos,
 *  conclusión nacida en notes1), solo (singleton nacido en chat1). b nace en
 *  chat2: un nacimiento solo de PREMISA: ninguna cadena concluye allí, así que
 *  chat2 nunca aparece como grupo (la ley del grupo de la conclusión). */
function node(id: string, name: string, statement: string, chatId: string | null): GraphNode {
	return {
		id,
		name,
		statement,
		aliases: [] as string[],
		state: "new",
		createdAt: "2026-09-20T10:00:00.000Z",
		provenance: chatId === null ? [] : [{ chatId, messageId: `m_${id}` }],
	} as unknown as GraphNode;
}

const NODES: GraphNode[] = [
	node("a", "Premise one", "Statement A.", "chat1"),
	node("b", "Premise two", "Statement B.", "chat2"),
	node("c1", "Conclusion", "Statement C.", "chat1"),
	node("d", "Support", "Statement D.", null),
	node("e", "Follow-up", "Statement E with keyword zebra.", "notes1"),
	node("solo", "Standalone", "Statement S.", "chat1"),
	node("orphan", "Orphan", "Statement O.", null),
];

const CHAINS: GraphChain[] = [
	{ id: "c1", premises: ["a", "b"], conclusion: "c1", provenance: [], createdAt: "2026-09-20T10:00:00.000Z" },
	{ id: "e", premises: ["d"], conclusion: "e", provenance: [], createdAt: "2026-09-20T10:00:00.000Z" },
];

const BASE = {
	nodes: NODES,
	chains: CHAINS,
	sessions: { chat1: "Ethics lesson", chat2: "Second chat" },
	fileSources: { notes1: "notes/raw/ethics.md" },
	query: "",
	onQuery: () => {},
	sort: { col: "name", dir: 1 } as ChainSort,
	onSort: () => {},
	selection: new Set<string>(),
	selectedSources: new Set<string>(),
	selectMode: false,
	expandedClusters: new Set<string>(),
	expandedChains: new Set<string>(),
	onToggleCluster: () => {},
	onToggleChain: () => {},
	onToggleNodes: () => {},
	onClear: () => {},
	onGenerate: () => {},
	onDelete: () => {},
	onClose: () => {},
};

function render(props: Partial<typeof BASE> = {}) {
	return renderToStaticMarkup(React.createElement(ChainTableBody, { ...BASE, ...props }));
}

describe("shared tree presentation", () => {
	it("collapses an absent selection gutter and offsets guides consistently at every depth", () => {
		for (const depth of [0, 1, 2, 4]) {
			for (const selectionColumn of [false, true]) {
				const html = renderToStaticMarkup(<TreeRow depth={depth} selectionColumn={selectionColumn}
					disclosure={<TreeDisclosure open={false} aria-label="Expand occurrence" />}>
					<strong>Custom <em>primary content</em></strong>
					<TreeGuide depth={depth} selectionColumn={selectionColumn} />
				</TreeRow>);
				assert.equal(html.includes('aria-hidden="true" class="size-3.5 shrink-0"'), selectionColumn);
				assert.match(html, new RegExp(`style="left:${(selectionColumn ? 37 : 19) + depth * 36}px"`));
				assert.match(html, /<strong>Custom <em>primary content<\/em><\/strong>/);
				assert.equal((html.match(/aria-label="Expand occurrence"/g) ?? []).length, 1);
			}
		}
	});

	it("keeps percentage-cell content boxes constant and indents before every optional control combination", () => {
		for (const variant of ["branch", "compact", "detail"] as const) {
			const gap = variant === "detail" ? 8 : 4;
			for (const depth of [0, 1, 2, 4]) {
				for (const selectionColumn of [false, true]) {
					for (const suppliedSelection of [false, true]) {
						for (const disclosure of [false, true]) {
							const { document } = parseHTML(renderToStaticMarkup(<>
								<TreeHeader data-testid="width-header">
									<TreeCell grow>Header</TreeCell>
									<TreeCell data-column="percent" style={{ width: "25%" }} />
									<TreeCell data-column="zero" style={{ width: 0 }} />
								</TreeHeader>
								<TreeRow data-testid="width-row" depth={depth} variant={variant} selectionColumn={selectionColumn}
									selection={suppliedSelection ? <TreeCheckbox checked readOnly aria-label="Select" /> : undefined}
									disclosure={disclosure ? <TreeDisclosure open={false} aria-label="Expand" /> : undefined}
									trailing={<>
										<TreeCell data-column="percent" style={{ width: "25%" }} />
										<TreeCell data-column="zero" style={{ width: 0 }} />
									</>}>Primary</TreeRow>
							</>));
							const row = document.querySelector<HTMLElement>('[data-testid="width-row"]')!;
							const header = document.querySelector<HTMLElement>('[data-testid="width-header"]')!;
							// El mismo relleno horizontal a cualquier profundidad mantiene los anchos CSS en
							// porcentaje basados en W - 24, nunca en W - 24 - depth * 36.
							assert.equal(row.className, treeRowLayout({ depth: 0, variant }).className);
							assert.ok(row.classList.contains("px-3") && header.classList.contains("px-3"));
							assert.ok(!row.style.paddingLeft && !row.style.paddingRight);
							for (const column of ["percent", "zero"]) {
								assert.equal(row.querySelector<HTMLElement>(`[data-column="${column}"]`)!.style.width,
									header.querySelector<HTMLElement>(`[data-column="${column}"]`)!.style.width);
							}
							const children = Array.from(row.children);
							if (depth > 0) {
								const indent = children.shift() as HTMLElement;
								assert.equal(indent.tagName, "SPAN");
								assert.equal(indent.getAttribute("aria-hidden"), "true");
								assert.equal(indent.className, "shrink-0");
								assert.equal(Number.parseFloat(indent.style.width) + gap, depth * 36);
								assert.ok(Number.parseFloat(indent.style.width) > 0);
							}
							if (selectionColumn) {
								const selection = children.shift()!;
								assert.equal(selection.tagName, suppliedSelection ? "INPUT" : "SPAN");
								assert.ok(selection.classList.contains("size-3.5"));
							}
							if (disclosure) assert.equal(children.shift()!.getAttribute("aria-label"), "Expand");
							assert.equal(children.shift()!.textContent, "Primary");
							assert.deepEqual(children.map(child => child.getAttribute("data-column")), ["percent", "zero"]);
						}
					}
				}
			}
		}
	});

	it("shares native row geometry without adding DOM and preserves arbitrary row attributes", () => {
		assert.equal(treeRowLayout({ depth: 1, variant: "compact" }).className, "flex items-center gap-1 py-1 pl-12 pr-3");
		assert.equal(treeRowLayout({ depth: 2, variant: "detail" }).className, "flex items-start gap-2 py-1 pl-21 pr-3");
		assert.equal(treeRowLayout({ depth: 4 }).style?.paddingLeft, 156);
		const html = renderToStaticMarkup(<div data-chain-nav-row='["occurrence","a"]' tabIndex={-1} draggable {...treeRowLayout()} />);
		assert.equal((html.match(/<div/g) ?? []).length, 1);
		assert.match(html, /data-chain-nav-row="\[&quot;occurrence&quot;,&quot;a&quot;\]"/);
		assert.match(html, /tabindex="-1"/);
		assert.match(html, /draggable="true"/);
	});

	it("keeps native disclosure styles distinct and makes sticky headers explicit", () => {
		const plain = renderToStaticMarkup(<TreeDisclosure plain open aria-label="Folder" />);
		const animated = renderToStaticMarkup(<TreeDisclosure open aria-label="Chain" />);
		assert.doesNotMatch(plain, /rounded|transition-|hover:/);
		assert.match(plain, /rotate-90/);
		assert.match(animated, /rounded/);
		assert.match(animated, /transition-transform rotate-90/);
		assert.doesNotMatch(renderToStaticMarkup(<TreeHeader />), /sticky/);
		assert.match(renderToStaticMarkup(<TreeHeader sticky />), /sticky top-0 z-10/);
	});

	it("preserves optional aligned cells, including empty reserved columns", () => {
		const html = renderToStaticMarkup(<TreeRow selectionColumn={false} trailing={<>
			<TreeCell widthClassName="w-14" align="right">42</TreeCell>
			<TreeCell widthClassName="w-20" />
		</>}>Primary</TreeRow>);
		assert.match(html, /class="w-14 shrink-0 text-right">42<\/span>/);
		assert.match(html, /class="w-20 shrink-0"><\/span>/);
		assert.doesNotMatch(html, /type="checkbox"|aria-expanded=/);
	});
});

describe("ChainTableBody — clusters (the outermost layer)", () => {
	it("collapsed by default: cluster rows render, chain rows do not", () => {
		const html = render();
		assert.ok(html.includes('data-testid="cluster-group-chat1"'), "the chat cluster");
		assert.ok(html.includes('data-testid="cluster-group-notes1"'), "the notes cluster");
		assert.ok(html.includes("Ethics lesson"), "chat label");
		assert.ok(html.includes("ethics"), "exact basename minus extension");
		assert.ok(!html.includes("notes/raw/ethics.md"), "import path is not a display name");
		assert.ok(html.includes("lucide-book"), "the closed book icon");
		assert.ok(!html.includes('data-testid="chain-row-c1"'), "no chain row when collapsed");
		assert.ok(!html.includes("Premise one"), "no chips when collapsed");
	});

	it("a premise-only birth never becomes a group — chains live in their CONCLUSION's cluster", () => {
		const html = render();
		assert.ok(!html.includes("cluster-group-chat2"), "chat2 births only a premise");
		assert.ok(!html.includes("Second chat"), "its label never renders");
	});

	it("an unnameable CONCLUSION birth forms one honest muted unlabeled group", () => {
		const html = render();
		assert.ok(html.includes("unlabeled"), "the muted label");
		// orphan (birth null) concluye su propia cadena singleton → el grupo existe;
		// d (también birth null) es premisa de e y nunca forma uno
		assert.ok(html.includes('data-testid="chain-row-orphan"') === false, "collapsed, like every group");
	});

	it("cluster rows carry checkbox + counts + newest date; notes kind marked", () => {
		const html = render();
		assert.ok(html.includes('data-testid="cluster-checkbox-chat1"'));
		// chat1: cadenas c1 (a, b, c1) + solo (solo) → 4 ids de miembros
		assert.ok(html.includes(">4</span>"), "chat1's proposition count");
		assert.ok(html.includes("2026-09-20"), "the newest-member date");
		assert.ok(html.includes(">notes</span>"), "the notes kind tag");
	});
});

describe("ChainTableBody — THE shared TopBar + the lines law (owner, round 2)", () => {
	it("the body renders the standardized top bar: h-15, lh-drag, select-none, NO title (serif = session name, always), close X", () => {
		const html = render();
		assert.ok(html.includes("lh-drag"), "the window-drag band");
		assert.ok(html.includes("select-none"), "dragging never highlights the bar");
		assert.ok(html.includes("h-15"), "the standard height");
		assert.ok(!html.includes(">Chains<"), "NO title (owner round 11): the serif register always names a session");
		assert.ok(html.includes("chain"), "the counts remain");
		assert.ok(html.includes('data-testid="chain-table-close"'), "the close X");
		assert.ok(html.includes('data-testid="chain-table-search"'), "the search input");
	});

	it("the table is FRAMED: header rule + rules between groups + rule under the last group; rows stay lineless (owner round 5)", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		// ahora todos los envoltorios de grupo llevan la raya: entre grupos Y bajo
		// el último; la cabecera lleva la raya SUPERIOR
		const sep = html.split("border-b border-border/60").length - 1;
		assert.ok(sep >= 4, "header + 3 group rules");
		// las filas de cadena en sí NO llevan borde: toda su lista de clases es
		// la ley de la escalera (pl-12 = alineada con el icono de CARPETA del grupo);
		// el border-border/70 de los contornos de las etiquetas es un contorno, no una línea de fila
		assert.ok(html.includes('class="flex items-center gap-1 py-1 pl-12 pr-3"'), "the chain row: staircase indent, no border");
	});

	it("TREE THREADS: open folders/chains drop a vertical guide from their expander arrow down the children's edge (owner round 5)", () => {
		const collapsed = render();
		assert.ok(!collapsed.includes("cluster-thread-"), "no thread while collapsed");
		const open = render({ expandedClusters: new Set(["chat1"]), expandedChains: new Set(["c1"]) });
		assert.ok(open.includes('data-testid="cluster-thread-chat1"'), "the cluster thread");
		assert.ok(open.includes('data-testid="chain-thread-c1"'), "the chain thread");
		// las columnas: la flecha del grupo está a 37px y la de la cadena a 73px
		assert.match(open, /data-testid="cluster-thread-chat1"[^>]*style="left:37px"/, "thread at the cluster arrow's column");
		assert.match(open, /data-testid="chain-thread-c1"[^>]*style="left:73px"/, "thread at the chain arrow's column");
		// la LEY DEL CORCHETE (ronda 6 del responsable): cada hilo va del borde inferior de la
		// casilla de su fila padre (con un hueco visible bajo el trazo de la flecha)
		// al borde inferior de la casilla de la ÚLTIMA fila hija: anclas medidas en vivo
		assert.match(open, /data-testid="cluster-thread-chat1"[^>]*bottom-\[8px\][^>]*top-\[23px\][^>]*style="left:37px"/, "cluster thread bracketed by checkbox bottoms");
		assert.ok(open.includes("top-[22px]") && open.includes("bottom-[8px]"), "chain thread bracketed by checkbox bottoms");
	});
});

describe("ChainTableBody — chain rows (chips + connectors)", () => {
	it("names render as outlined chips; premises join by ∧, the conclusion by ⟹ — REAL KaTeX glyphs in the foreground", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('data-testid="chain-row-c1"'));
		assert.ok(html.includes('data-testid="prop-chip-a"'), "premise chip");
		assert.ok(html.includes('data-testid="prop-chip-c1"'), "conclusion chip");
		assert.ok(html.includes("Premise one"), "chip text");
		// las conectivas (decisión del responsable, 2026-09-30): premisas ∧, conclusión
		// ⟹: renderizadas con KaTeX (está la clase katex), en primer plano DESTACADO
		assert.ok(html.includes('data-testid="chain-and-c1-1"'), "the land between premises");
		assert.ok(html.includes('data-testid="chain-implies-c1"'), "the implication before the conclusion");
		const and = html.match(/data-testid="chain-and-c1-1"[^>]*>/)?.[0] ?? "";
		assert.match(and, /text-foreground/, "prominent — the theme's white, not dim gray");
		assert.ok(html.includes("katex"), "a REAL KaTeX render, not a unicode arrow");
		// la flecha antigua ha muerto como conector VISIBLE: solo sobrevive en
		// el aria-label de la fila (formatChainLine, la forma en texto plano)
		assert.doesNotMatch(html, />\s*→\s*</, "no textual arrow connector remains");
		// decisión del responsable (ronda 3): los iconos waypoints de cadena HAN DESAPARECIDO:
		// las etiquetas + conectores ya se leen como cadenas; solo las carpetas conservan icono
		assert.ok(!html.includes("lucide-waypoints"), "no chain icon");
	});

	it("a singleton renders ONE lonely chip, no connector; the annotation survives only for screen readers", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('data-testid="chain-row-solo"'));
		assert.ok(html.includes('data-testid="prop-chip-solo"'));
		assert.ok(!html.includes('data-testid="chain-arrow-solo-1"'), "no connector on a singleton");
		// la línea visible es solo la etiqueta; "(no premises)" existe ÚNICAMENTE como el
		// aria-label de la fila (la línea de accesibilidad): exactamente una aparición
		assert.equal(html.split("no premises").length - 1, 1, "aria-label only, never visible text");
		assert.ok(html.includes('aria-label="Standalone (no premises)"'));
	});

	it("the row carries the one-line derivation as its aria-label (core formatChainLine)", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('aria-label="Premise one, Premise two → Conclusion"'));
	});

	it("expanding a chain reveals member STATEMENTS directly — PLAIN rows, no conclusion marker (owner, round 2)", () => {
		const html = render({
			expandedClusters: new Set(["chat1"]),
			expandedChains: new Set(["c1"]),
		});
		assert.ok(html.includes('data-testid="prop-row-a"'), "premise statement row");
		assert.ok(html.includes("Statement A."), "the statement text, one click deep");
		assert.ok(html.includes("Statement C."), "the conclusion statement");
		// decisión del responsable: la derivación ya está codificada en la línea de la cadena:
		// aquí abajo no hay marcador de conclusión
		assert.ok(!html.includes("prop-conclusion"), "no conclusion marker anywhere");
		// LA ESCALERA DE ALINEACIÓN (decisión del responsable, ronda 4: «duplica la
		// sangría»): la casilla de cada nivel queda bajo la ranura del ICONO de su padre,
		// DOS columnas (36px) más allá de la suya. Cada columna mide 18px:
		// grupos pl-3 (12) → cadenas pl-12 (48 = el icono de carpeta) →
		// enunciados pl-21 (84 = donde IRÍA un icono de cadena)
		assert.ok(html.includes("pl-21"), "statements at the would-be chain-icon column");
		assert.ok(html.includes("pl-12"), "chains aligned with the folder icon");
		assert.ok(html.includes("h-5 w-3.5"), "the expander shares the checkbox's 14px width");
	});
});

describe("ChainTableBody — the sortable table headers", () => {
	it("ALL THREE columns are sort controls with aria-sort (owner: consistency is key)", () => {
		const html = render();
		assert.ok(html.includes('data-testid="sort-name"'));
		assert.ok(html.includes('data-testid="sort-props"'));
		assert.ok(html.includes('data-testid="sort-created"'));
		assert.ok(html.includes('aria-sort="ascending"'), "default name A→Z");
		// el chevron pequeño (lucide size-3) marca solo la cabecera ACTIVA:
		// nada de triángulos de texto gigantes (responsable, ronda 2)
		assert.ok(html.includes('lucide-chevron-up size-3'), "small up chevron on active name");
		assert.ok(html.includes('lucide-chevron-down') === false, "no down chevron while ascending");
	});

	it("descending state shows on the active header only", () => {
		const html = render({ sort: { col: "created", dir: -1 } });
		assert.ok(html.includes('data-testid="sort-created"'));
		assert.ok(html.includes('aria-sort="descending"'));
		assert.ok(html.includes('aria-sort="none"'), "the inactive column");
		assert.ok(html.includes('lucide-chevron-down size-3'), "small down chevron");
	});

	it("Props sort orders cluster rows AND chains within (largest-first by default)", () => {
		const html = render({ sort: { col: "props", dir: 1 }, expandedClusters: new Set(["chat1"]) }); // ascendente: primero el más pequeño
		const unlabeled = html.indexOf("cluster-group-\0unlabeled");
		const notes = html.indexOf('data-testid="cluster-group-notes1"');
		const chat = html.indexOf('data-testid="cluster-group-chat1"');
		assert.ok(unlabeled > 0 && notes > 0 && chat > 0, "all three groups render");
		assert.ok(unlabeled < notes && notes < chat, "1 < 2 < 4 member ids ascending");
		// dentro de chat1: el singleton (1) se ordena antes que la cadena de tres miembros
		const soloRow = html.indexOf('data-testid="chain-row-solo"');
		const c1Row = html.indexOf('data-testid="chain-row-c1"');
		assert.ok(soloRow > 0 && c1Row > 0 && soloRow < c1Row, "chain sizes ascending within the cluster");
	});
});

describe("ChainTableBody — the floating selection bar (never shifts layout)", () => {
	it("absent when nothing is selected", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(!html.includes('data-testid="chain-selection-bar"'));
	});

	it("counts selected sources with Clear and a fenced source-only Delete", () => {
		const html = render({ selectedSources: new Set(["chat1", "notes1"]) });
		assert.ok(html.includes('data-testid="chain-selection-bar"'));
		assert.ok(html.includes('data-testid="chain-selected-summary"'));
		assert.ok(html.includes("2 sources"));
		assert.ok(html.includes('data-testid="chain-clear"'));
		// La valla de peligro (responsable, 2026-09-29 por la noche): un divisor aísla
		// la acción destructiva en el extremo derecho de la barra, en rojo + icono de papelera,
		// y abre una confirmación de la aportación de la fuente, no un borrado global de nodos.
		assert.ok(html.includes('data-testid="chain-danger-divider"'));
		const del = html.match(/<button[^>]*data-testid="chain-delete"[^>]*>/)?.[0] ?? "";
		assert.match(del, /border-destructive\/50/); // el par destructivo
		assert.match(del, /aria-label="Delete selected sources and folders"/);
		assert.ok(html.includes("lucide-trash-2"), "the trash icon");
		// la valla va antes de Delete en el DOM (extremo derecho de la barra)
		assert.ok(html.indexOf('chain-danger-divider"') < html.indexOf('chain-delete"'));
	});

	it("Delete and practice Done have matching top/bottom/right pill insets and fully rounded contours", () => {
		for (const [selectMode, action] of [[false, "chain-delete"], [true, "chain-practice-done"]] as const) {
			const html = render({ selectMode, selectedSources: new Set(["chat1"]), selection: new Set(["a"]) });
			const bar = html.match(/<div[^>]*data-testid="chain-selection-bar"[^>]*>/)?.[0] ?? "";
			const button = html.match(new RegExp(`<button[^>]*data-testid="${action}"[^>]*>`))?.[0] ?? "";
			assert.match(bar, /rounded-full/); assert.match(button, /rounded-full/);
			assert.match(bar, /py-2 pl-4 pr-2/, "keep text inset, match right inset to the vertical inset");
			assert.equal(bar.includes(" px-4 "), false);
		}
	});

	it("the Delete rides ONLY with a selection — no bar, no kill switch", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(!html.includes('data-testid="chain-delete"'));
		assert.ok(!html.includes('data-testid="chain-danger-divider"'));
	});

	it("a premise WITHOUT its conclusion derives as the singleton it becomes", () => {
		const html = render({ selectMode: true, selection: new Set(["a", "d"]) });
		assert.ok(html.includes("2 nodes → 2 chains"), "no follows-edge survives inside the selection");
	});
});

describe("ChainTableBody — the fuzzy search (grouped + auto-expand)", () => {
	it("matching clusters auto-expand to reveal their chains; others hide; the bar is unaffected", () => {
		const aliased = NODES.map((n) => (n.id === "b" ? { ...n, aliases: ["zebra alias"] } : n));
		const html = render({
			nodes: aliased,
			selectMode: true,
			query: "zebra",
			selection: new Set(["a", "b", "c1"]), // la selección abarca LAS DOS cadenas
		});
		// coincidencias de zebra: cadena e (enunciado) + cadena c1 (alias en b)
		assert.ok(html.includes('data-testid="chain-row-c1"'), "auto-expanded cluster reveals the chain");
		assert.ok(html.includes('data-testid="chain-row-e"'), "statement match");
		assert.ok(!html.includes('data-testid="chain-row-solo"'), "non-matching chain hidden");
		assert.ok(!html.includes("cluster-group-notes1") === false, "notes1 still renders (it has a match)");
		assert.ok(!html.includes("Ethics lesson") === false, "chat1 still renders (it has a match)");
		// la barra flotante nunca se filtra por la búsqueda
		assert.ok(html.includes("3 nodes → 1 chain"));
	});

	it("no matches: the honest empty line", () => {
		const html = render({ query: "qqqq" });
		assert.ok(html.includes('data-testid="chain-table-nomatch"'));
		assert.ok(html.includes("No matching chains."));
	});
});

describe("ChainTableOverlay — the lifted practice pick (owner vision, 2026-10-04)", () => {
	function overlay(extra: Record<string, unknown> = {}) {
		return renderToStaticMarkup(
			React.createElement(ServerEventsProvider, { children: React.createElement(ChainTableOverlay, {
				open: true,
				nodes: NODES,
				chains: CHAINS,
				sessions: { chat1: "Ethics lesson", chat2: "Follow-up", notes1: "Notes" },
				fileSources: {},
				onClose: () => {},
				...extra,
			} as never) }),
		);
	}

	it("CONTROLLED selection renders the caller's set — the bar counts it live", () => {
		const html = overlay({ selectMode: true, controlledSelection: new Set(["a", "b", "c1"]) });
		assert.ok(html.includes("3 nodes → 1 chain"), "the bar reflects the lifted set, not internal state");
	});

	it("select mode: Done replaces the delete fence — no way to delete while picking", () => {
		const html = overlay({
			selectMode: true,
			controlledSelection: new Set(["a", "b"]),
		});
		assert.ok(html.includes('data-testid="chain-practice-done"'));
		assert.ok(html.includes("Done"));
		assert.ok(!html.includes('data-testid="chain-delete"'), "no delete while picking");
		assert.ok(!html.includes('data-testid="chain-danger-divider"'));
	});

	it("browse mode cannot accidentally delete a lifted graph-node selection", () => {
		const html = overlay({ controlledSelection: new Set(["a"]) });
		assert.ok(!html.includes('data-testid="chain-delete"'));
		assert.ok(!html.includes('data-testid="chain-practice-done"'));
	});
});
