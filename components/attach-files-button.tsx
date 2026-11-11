"use client";

import { cloneElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PaperclipIcon } from "lucide-react";
import { directoryReferencePath, quoteFilePath } from "@/src/core";
import { Hint } from "@/components/ui/hint";
import { INSERT_FILE_PATHS_EVENT } from "@/components/path-input";
import { BROWSER_NOTICE } from "@/components/file-path-drop-zone";
import { InteractionLayerOwner, useInteractionLayer, useInteractionLayers, useOptionalInteractionLayers } from "./interaction-layers";
import { INTERACTION_LAYER_Z_BASE } from "./host-dialog";
import { isInteractionScopeEligible } from "./plugin-input-focus";

/** Ficheros elegidos → las rutas con raíz que un editor convierte en chips (issue
 * #285), mediante el puente de escritorio. La misma regla de validez que al soltar: un
 * fichero sin una ruta utilizable se omite, nunca se adivina. */
export function pathsForFiles(files: Iterable<File>, resolve: (file: File) => string): { paths: string[]; skipped: number } {
	const paths: string[] = [];
	let skipped = 0;
	for (const file of files) {
		try {
			const path = resolve(file);
			quoteFilePath(path);
			paths.push(path);
		} catch { skipped++; }
	}
	return { paths, skipped };
}

/** Se centra sobre el clip, pero dejando libre todo el compositor visible, no solo su
 * botón alineado abajo. Se acota en horizontal y se desplaza por encima del dock. */
export function attachmentPopupPlacement(button: { left: number; right: number }, composer: { top: number }, popupWidth: number, viewport: { width: number; height: number }) {
	const edge = 8;
	const gap = 4;
	const maxWidth = Math.max(0, viewport.width - edge * 2);
	const width = Math.min(popupWidth, maxWidth);
	return {
		left: Math.max(edge, Math.min((button.left + button.right - width) / 2, viewport.width - edge - width)),
		bottom: viewport.height - composer.top + gap,
		maxWidth,
		maxHeight: Math.max(0, Math.min(viewport.height * 0.6, composer.top - gap - edge)),
	};
}

const noSubscribe = () => () => {};
/** El puente es fijo durante toda la vida de la ventana; el render del servidor
 * siempre es el caso del navegador, así que la hidratación nunca discrepa. */
function useDesktopPaths(): boolean {
	return useSyncExternalStore(noSubscribe, () => Boolean(window.lh?.getPathForFile), () => false);
}

/** El menú de elección se encarga de Escape con la misma ley de capas que MenuShell,
 * conservando su geometría específica del clip y del compositor. Se monta aparte para
 * que un botón cerrado siga siendo seguro en renders independientes o estáticos. Los
 * avisos son pasivos. */
function AttachmentPopup({ anchorRef, rootRef, open, close, children }: {
	anchorRef: RefObject<HTMLButtonElement | null>; rootRef: RefObject<HTMLDivElement | null>;
	open: boolean; close(): void; children: ReactElement<{ style?: CSSProperties }>;
}) {
	const controller = useInteractionLayers();
	const owner = controller.ownerOf(anchorRef.current);
	const layer = useInteractionLayer({ kind: "popup", enabled: open, rootRef, anchorRef, ownerId: owner?.id,
		onClose: reason => {
			close();
			if (reason === "escape" && controller.isPopupOrigin(anchorRef.current)) anchorRef.current?.focus();
			return "closed";
		},
	});
	const portal = controller.getPortalContainer(anchorRef.current, owner?.id);
	if (!portal) return null;
	return createPortal(<InteractionLayerOwner.Provider value={open ? layer.id : owner?.id ?? null}>
		{cloneElement(children, { style: { ...children.props.style, zIndex: INTERACTION_LAYER_Z_BASE + (open ? layer.order : owner?.order ?? 0) } })}
	</InteractionLayerOwner.Provider>, portal);
}

/**
 * El botón de adjuntar (issue #285): el gemelo del selector de soltar un fichero — los
 * ficheros se quedan donde están y solo sus rutas entre comillas entran en el
 * borrador, en el cursor de `editorRef` (una raíz PathInput). Cualquier tipo de
 * fichero; el agente lee lo que puede. Solo escritorio: un File del navegador no tiene
 * ruta local, así que ahí el botón lo explica en su lugar (el aviso de la zona de
 * soltar). La elección nativa de carpeta, aparte, devuelve el propio directorio,
 * incluido uno vacío. aria-disabled, no disabled, para que el tooltip siga mostrándose.
 */
export function AttachFilesButton({ editorRef }: { editorRef: React.RefObject<HTMLDivElement | null> }) {
	const controller = useOptionalInteractionLayers();
	const pickerRef = useRef<HTMLInputElement>(null);
	const desktop = useDesktopPaths();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const choosingFolder = useRef(false);
	const [open, setOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [placement, setPlacement] = useState<ReturnType<typeof attachmentPopupPlacement> | null>(null);
	const positioned = placement !== null;
	// Como MenuShell, se hace portal a body con una colocación limitada al viewport y reanclada.
	// Los docks de producción del chat y de nueva sesión recortan a sus hijos a propósito.
	// El foco del aviso se mantiene pasivo; solo el menú de elección toma el foco del teclado.
	useLayoutEffect(() => {
		if (!open && !notice) { setPlacement(null); return; }
		const button = buttonRef.current;
		const popup = popupRef.current;
		if (!button || !popup) return;
		const composer = button.closest<HTMLElement>("[data-attachment-composer]") ?? button;
		const place = () => {
			setPlacement(attachmentPopupPlacement(button.getBoundingClientRect(), composer.getBoundingClientRect(),
				popup.getBoundingClientRect().width, { width: window.innerWidth, height: window.innerHeight }));
		};
		place();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
		observer?.observe(composer);
		observer?.observe(popup);
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => { observer?.disconnect(); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
	}, [open, notice]);
	useEffect(() => { if (open && positioned && isInteractionScopeEligible(popupRef.current, controller)) popupRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [open, positioned, controller]);
	useEffect(() => {
		if (!open && !notice) return;
		const dismissOutside = (event: PointerEvent) => {
			if (isInteractionScopeEligible(popupRef.current, controller) && event.target instanceof Node && !popupRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) {
				setOpen(false); setNotice("");
			}
		};
		document.addEventListener("pointerdown", dismissOutside);
		return () => document.removeEventListener("pointerdown", dismissOutside);
	}, [open, notice, controller]);
	const chooseFolder = async () => {
		if (choosingFolder.current) return;
		const editor = editorRef.current;
		const choose = window.lh?.chooseAttachmentFolder;
		setOpen(false);
		setNotice("");
		if (!choose) { setNotice(BROWSER_NOTICE); return; }
		choosingFolder.current = true;
		try {
			const chosen = await choose();
			if (chosen === null) return; // La cancelación nativa deja el borrador intacto.
			const path = directoryReferencePath(chosen);
			if (editor?.isConnected && editor === editorRef.current) editor.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: [path] }));
		} catch { setNotice("Could not choose a folder. Try again."); }
		finally { choosingFolder.current = false; }
	};
	return (
		<div className="relative shrink-0"
			onBlur={(event) => { if (isInteractionScopeEligible(popupRef.current ?? buttonRef.current, controller) && !event.currentTarget.contains(event.relatedTarget) && !popupRef.current?.contains(event.relatedTarget)) setOpen(false); }}>
			<input
				ref={pickerRef}
				type="file"
				multiple
				hidden
				data-testid="attach-files-input"
				onChange={(e) => {
					const resolve = window.lh?.getPathForFile;
					const { paths } = resolve ? pathsForFiles(Array.from(e.currentTarget.files ?? []), resolve) : { paths: [] };
					if (paths.length > 0) editorRef.current?.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: paths }));
					e.currentTarget.value = ""; // permite volver a elegir el mismo fichero
				}}
			/>
			<Hint label={desktop ? "Attach files or a folder" : BROWSER_NOTICE}>
				<button
					ref={buttonRef}
					type="button"
					aria-label="Attach files"
					aria-disabled={!desktop}
					aria-haspopup="menu"
					aria-expanded={open}
					data-testid="attach-files"
					onClick={() => { if (desktop) { setNotice(""); setOpen(!open); } }}
					className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
				>
					<PaperclipIcon className="size-4" />
				</button>
			</Hint>
			{(open || notice) && <AttachmentPopup anchorRef={buttonRef} rootRef={popupRef} open={open} close={() => setOpen(false)}><div ref={popupRef} role={open ? "menu" : "status"}
				aria-label={open ? "Attach files or a folder" : undefined}
				data-testid="attachment-popup"
				style={{ position: "fixed", zIndex: 60, ...(placement ?? { left: 0, top: 0, visibility: "hidden" }), overflowY: "auto" }}
				className={open ? "w-max rounded-lg border bg-card p-1 shadow-lg" : "w-64 rounded-lg border bg-card p-2 text-xs text-muted-foreground shadow-lg"}
				onKeyDown={(event) => {
					const buttons = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
					const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
					const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
					if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
				}}>
				{open ? <>
					<button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
						onClick={() => { setOpen(false); pickerRef.current?.click(); }}>Files</button>
					<button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
						onClick={() => { void chooseFolder(); }}>Folder</button>
				</> : notice}
			</div></AttachmentPopup>}
		</div>
	);
}
