"use client";

/**
 * EL INICIO MÍNIMO (responsable, 2026-10-06 — el inicio sin grafo, segundo
 * intento): cuando el RENDERIZADO DEL GRAFO está desactivado (graph.rendering
 * en los ajustes), la vista principal del inicio es esta — deliberadamente
 * tranquila, deliberadamente mínima. El plan a la larga es la VISTA DE DATOS
 * como inicio; hasta que se diseñe y se construya, este es el provisional
 * que no pide nada nuevo: la MISMA burbuja de composer que ya flota en el
 * inicio (selector enseñar/practicar + píldora de elección — sin tocar), los
 * supervivientes del cromo del grafo en los MISMOS sitios donde los tiene la
 * vista del grafo (columna superior derecha: fila de acciones, píldora de
 * coste DEBAJO) y un resumen centrado y tranquilo de la base de conocimiento
 * en cifras. Sin sesiones recientes (de eso se encarga la barra lateral), sin
 * lienzo, sin una lista que se desplace bajo el composer.
 *
 * La TABLA DE CADENAS sigue detrás de su botón exactamente igual que en la
 * vista del grafo: el overlay estándar, sin cambios — este componente solo es
 * dueño del botón. El flujo de elección para practicar replica al pie de la
 * letra el contrato de GraphView (el inicio eleva el conjunto elegido; el
 * chip abre el overlay en modo de selección).
 */
import { useCallback, useEffect, useState } from "react";
import { ListTreeIcon } from "lucide-react";
import { ChainTableOverlay } from "@/components/chain-table.tsx";
import { GraphCostControl } from "@/components/graph-view.tsx";
import { NotesImportControl, NotesImportErrors, NotesImportNotices, useNotesImport } from "@/components/notes-import.tsx";
import { Hint } from "@/components/ui/hint";
import type { ChatSummary, GraphCostSummary, GraphSnapshot } from "@/src/core";

/** El resumen centrado y tranquilo — un cuerpo puro (props dentro, marcado
 * fuera) para que la batería de pruebas de render pueda fijarlo de forma
 * estática. Muy tranquilo por decisión del responsable: texto pequeño
 * atenuado, sin tarjetas, sin cromo. */
export function KnowledgeSummary({
	propositions,
	chains,
	teachSessions,
	practiceSessions,
	importedNotes,
}: {
	propositions: number;
	chains: number;
	teachSessions: number;
	practiceSessions: number;
	importedNotes: number;
}) {
	const empty =
		propositions === 0 && chains === 0 && teachSessions === 0 && practiceSessions === 0 && importedNotes === 0;
	return (
		<div data-testid="knowledge-summary" className="flex flex-col items-center text-center">
			{/* Ley de línea propia (responsable, 2026-10-06): cada recuento va en su
			propia fila — sin separadores de punto; los dos bloques (grafo, sesiones)
			se separan con una línea vacía; el RECUENTO de notas (nunca la lista de
			ficheros) va detrás de esa misma separación. */}
			<div className="flex flex-col gap-1">
				<p className="font-ui text-sm text-muted-foreground">
					{propositions} {propositions === 1 ? "proposition" : "propositions"}
				</p>
				<p className="font-ui text-sm text-muted-foreground">
					{chains} {chains === 1 ? "chain" : "chains"}
				</p>
			</div>
			<div className="h-4" aria-hidden="true" />
			<div className="flex flex-col gap-1">
				<p className="font-ui text-sm text-muted-foreground">
					{teachSessions} {teachSessions === 1 ? "teaching session" : "teaching sessions"}
				</p>
				<p className="font-ui text-sm text-muted-foreground">
					{practiceSessions} {practiceSessions === 1 ? "practice session" : "practice sessions"}
				</p>
			</div>
			<div className="h-4" aria-hidden="true" />
			<p className="font-ui text-sm text-muted-foreground">
				{importedNotes} {importedNotes === 1 ? "imported note" : "imported notes"}
			</p>
			{empty && (
				<div className="pt-2 font-ui text-xs text-muted-foreground/70">
					<p>Start a session to begin learning.</p>
					<p className="mt-1">Attach your material with the paperclip or drag and drop.</p>
				</div>
			)}
		</div>
	);
}

export function MinimalHome({
	chainSelectOpen = false,
	practiceSelection,
	onPracticeSelectionChange,
	onChainSelectClose,
}: {
	/** El conjunto elegido elevado activa el modo de selección del overlay
	 * (Done en lugar de la barrera de borrado); el chip del composer del inicio
	 * lo refleja. */
	chainSelectOpen?: boolean;
	practiceSelection?: ReadonlySet<string>;
	onPracticeSelectionChange?: (nodes: { id: string; name: string; statement: string }[]) => void;
	onChainSelectClose?: () => void;
}) {
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
	const [costs, setCosts] = useState<GraphCostSummary | null>(null);
	const [chats, setChats] = useState<ChatSummary[]>([]);
	const [chainsOpen, setChainsOpen] = useState(false);

	const readState = useCallback(() => {
		fetch("/api/graph")
			.then((res) => res.json() as Promise<GraphSnapshot>)
			.then(setSnapshot)
			.catch(() => {});
		fetch("/api/graph/costs")
			.then((res) => res.json() as Promise<GraphCostSummary>)
			.then(setCosts)
			.catch(() => {});
		fetch("/api/chats")
			.then((res) => res.json() as Promise<{ chats: ChatSummary[] }>)
			.then((body) => setChats(body.chats))
			.catch(() => {});
	}, []);
	useEffect(() => {
		readState();
		window.addEventListener("lh:graph-revision", readState);
		return () => window.removeEventListener("lh:graph-revision", readState);
	}, [readState]);

	// El chip de práctica abre la tabla en modo de selección (la ley de GraphView):
	// la intención de elegir levanta el overlay; Done/cerrar lo comunica hacia abajo.
	useEffect(() => {
		if (chainSelectOpen) setChainsOpen(true);
	}, [chainSelectOpen]);

	// Volver a pedir los datos incluso tras importaciones incompletas: las escrituras y el gasto anteriores siguen ahí.
	const notesImport = useNotesImport({ onFinish: readState });
	const { importing, onImportFiles } = notesImport;

	const teachSessions = chats.filter((c) => c.kind === "teach").length;
	const practiceSessions = chats.filter((c) => c.kind === "practice").length;

	return (
		<div className="relative h-full">
			{/* El resumen tranquilo — centrado, desplazado hacia arriba, lejos del composer. */}
			<div className="pointer-events-none flex h-full items-center justify-center pb-40">
				<KnowledgeSummary
					propositions={snapshot?.propositions.length ?? 0}
					chains={snapshot?.chains.length ?? 0}
					teachSessions={teachSessions}
					practiceSessions={practiceSessions}
					importedNotes={Object.keys(snapshot?.fileSources ?? {}).length}
				/>
			</div>

			{/* Los supervivientes del cromo en los sitios propios de la vista del grafo
			(responsable, 2026-10-06): la columna superior derecha — fila de acciones
			(Chains + Import, las mismas píldoras de la franja de 36px), la píldora de
			coste DEBAJO. La columna lleva lh-no-drag EXACTAMENTE igual que el cromo
			del grafo (la ley de la máscara por orden del DOM): sin ella la franja de
			arrastre se traga los clics en Electron — los botones arrastraban la
			ventana en lugar de pulsarse. La búsqueda de nodos y el engranaje de
			ajustes de render son cosas del lienzo y siguen fuera; Import SIEMPRE se
			renderiza (la ley de la entrada). */}
			<div className="lh-no-drag lh-wco-floating absolute right-2 top-2 z-10 flex max-w-[calc(100%-5.5rem)] flex-col items-end gap-2">
				<div className="flex min-w-0 items-start gap-2">
					<div className="graph-chrome-fade-in shrink-0 rounded-xl border bg-card/85 px-1 py-[3px] shadow-lg backdrop-blur">
						<Hint label="Every reasoning chain" side="bottom">
							<button
								type="button"
								onClick={() => setChainsOpen(true)}
								data-testid="open-chain-table"
								className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
							>
								<ListTreeIcon className="size-3" />
								Chains
							</button>
						</Hint>
					</div>
					<NotesImportControl importing={importing} onImportFiles={onImportFiles} />
				</div>
				<NotesImportErrors errors={notesImport.errors} />
				<NotesImportNotices notices={notesImport.notices} />
				{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
			</div>

			{/* La tabla de cadenas — el overlay ESTÁNDAR, sin cambios, detrás de su
			botón. ÚLTIMO HIJO DE LA RAÍZ, A PROPÓSITO (la ley de arrastre por orden
			del DOM de la vista del grafo): la resta de app-region se resuelve por
			orden del DOM, así que una superficie a sangre que cubre la franja de
			arrastre debe pintarse después de todo lo que cubre. */}
			<ChainTableOverlay
				open={chainsOpen}
				nodes={snapshot?.propositions ?? []}
				chains={snapshot?.chains ?? []}
				sessions={snapshot?.sessions ?? {}}
				fileSources={snapshot?.fileSources ?? {}}
				onClose={() => {
					setChainsOpen(false);
					onChainSelectClose?.();
				}}
				selectMode={chainSelectOpen}
				controlledSelection={practiceSelection}
				onSelectionChange={(ids) => {
					// Resuelve ids → nodos contra la instantánea viva; quien
					// llama tiene el conjunto elegido (recuento + semilla).
					const props = snapshot?.propositions ?? [];
					const picked: { id: string; name: string; statement: string }[] = [];
					for (const id of ids) {
						const n = props.find((node) => node.id === id);
						if (n) picked.push({ id: n.id, name: n.name, statement: n.statement });
					}
					onPracticeSelectionChange?.(picked);
				}}
			/>
		</div>
	);
}
