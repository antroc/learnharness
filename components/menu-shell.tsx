"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { INTERACTION_LAYER_Z_BASE } from "./host-dialog";
import { InteractionLayerOwner, useInteractionLayer, useInteractionLayers, type CloseOutcome, type CloseReason } from "./interaction-layers";

/**
 * EL armazón de menú compartido (estandarización de menús, fragmento B de la
 * oleada de arreglos): un único cuerpo de colocación para los menús
 * desplegables de la app — en portal dentro del host de ventanas emergentes
 * sin recorte del modal propietario (o document.body), anclado en posición
 * fija al rect del disparador y limitado al viewport. La responsabilidad de
 * Escape es compartida; cada sitio aporta su resultado de cierre y conserva
 * su propia política de punteros externos.
 *
 *  - Lado: cada sitio declara su lado preferido — el composer abre HACIA
 *    ARRIBA (su control está al pie de la pantalla), las filas de ajustes
 *    abren HACIA ABAJO; el armazón voltea cuando el lado preferido no puede
 *    mostrar el contenido del menú y el otro lado tiene más sitio (el
 *    comportamiento de ajuste honesto de los popovers del grafo, generalizado).
 *  - Tope: max-height = min(60vh, el sitio disponible en el lado elegido); el
 *    menú se desplaza por dentro en vez de estirar la página o salirse del
 *    viewport (el patrón max-h-[60vh] de graph-view).
 *  - Recolocación: scroll en fase de captura + redimensionado de la ventana —
 *    la disciplina de los menús de ajustes (incluido el scroll del contenido
 *    interior del diálogo de ajustes).
 *
 * Sitios (primero los menús de modelo, responsable 2026-09-22; los popovers
 * del grafo y el popover de resumen de la barra de estadísticas siguen siendo
 * a medida — las fronteras quedan abiertas para adoptarlos más adelante): los
 * menús de ranura y de motor de búsqueda de la sección Agent de ajustes, el
 * menú Add-provider de la sección Keys, los menús de modelo/thinking del
 * composer (model-picker.tsx) y los selectores de ranura del SetupDialog —
 * sacando ESOS en portal fuera del marco overflow-hidden del diálogo para que
 * sobresalgan de él exactamente igual que los menús de ajustes (responsable,
 * fragmento B, punto 7).
 *
 * SSR: los menús solo se montan en el cliente mientras están abiertos; la
 * pasada oculta de medición de abajo es el único render previo a la
 * colocación, así que un render de servidor nunca emite un menú posicionado.
 */

const GAP = 4; // borde del ancla → menú (los 4px asentados de los armazones a medida)
const EDGE = 8; // suelo del viewport en el que el menú nunca entra
const CAP_VH = 0.6; // 60vh — el tope del patrón del grafo
const MIN_USABLE = 96; // suelo: un tope más bajo es una rendija inservible; el
// tope entonces desborda el borde en vez de aplastar el menú

/** Un MenuShell montado = un desplegable abierto (oleada de arreglos,
 *  decisión del responsable: la columna de contenido del diálogo de ajustes
 *  se bloquea mientras haya algún menú desplegado — nada de scroll bajo un
 *  desplegable). El armazón sigue siendo solo de colocación: se limita a
 *  ANUNCIARLO, y las superficies deciden qué hacer con ello (el diálogo de
 *  ajustes se bloquea; lo que no se pueda bloquear conserva la alternativa
 *  de recolocar al hacer scroll de más abajo). Basado en recuento: los menús
 *  solapados se abren/cierran en cualquier orden y la contabilidad sigue
 *  cuadrando. */
export const MENU_OPEN_EVENT = "lh:menu-open";
export const MENU_CLOSE_EVENT = "lh:menu-close";

export type MenuSide = "up" | "down";
export type MenuAlign = "left" | "right";

/** Una decisión de colocación. `style` es la carga de posición fija; el lado
 *  vuelve con ella para la comprobación del volteo en las pruebas. */
export interface MenuPlacement {
	side: MenuSide;
	style: Record<string, string | number>;
	maxHeight: number;
}

/** Pura: la decisión de colocación — rect anclado + viewport + la altura
 *  SIN TOPE del contenido del menú (scrollHeight, para que las recolocaciones
 *  tras filtrar con una búsqueda vuelvan a medir con honestidad) → lado,
 *  estilo fijo, tope. Regla de volteo: quedarse en el lado preferido salvo
 *  que no pueda mostrar todo el contenido Y el otro lado tenga más sitio. El
 *  tope siempre mantiene el menú dentro del sitio de su lado cuando lo hay;
 *  el suelo lo mantiene usable cuando no lo hay. */
export function computeMenuPlacement(
	rect: { top: number; bottom: number; left: number; right: number },
	viewport: { width: number; height: number },
	contentHeight: number,
	preferredSide: MenuSide,
	align: MenuAlign,
): MenuPlacement {
	const availDown = viewport.height - EDGE - (rect.bottom + GAP);
	const availUp = rect.top - GAP - EDGE;
	// contentHeight ≤ 0 (aún no se ha medido nada) mantiene el lado preferido —
	// la primera pasada oculta vuelve a medir y decide con números reales.
	let side = preferredSide;
	if (contentHeight > 0) {
		const preferredAvail = preferredSide === "down" ? availDown : availUp;
		const otherAvail = preferredSide === "down" ? availUp : availDown;
		if (contentHeight > preferredAvail && otherAvail > preferredAvail) {
			side = preferredSide === "down" ? "up" : "down";
		}
	}
	const avail = side === "down" ? availDown : availUp;
	const maxHeight = Math.max(MIN_USABLE, Math.min(CAP_VH * viewport.height, avail));
	const horizontal: Record<string, number> =
		align === "right" ? { right: viewport.width - rect.right } : { left: rect.left };
	const vertical: Record<string, number> =
		side === "down" ? { top: rect.bottom + GAP } : { bottom: viewport.height - rect.top + GAP };
	return { side, style: { ...horizontal, ...vertical }, maxHeight };
}

type AnchorRect = { top: number; bottom: number; left: number; right: number };

/** El rect contra el que se coloca un menú: un ancla virtual (un rango de
 *  texto) gana cuando produce uno; si no, la frontera del elemento. */
export function menuAnchorRect(
	{ getAnchorRect, anchorRef, anchorTestid }: { getAnchorRect?: () => AnchorRect | null; anchorRef?: RefObject<HTMLElement | null>; anchorTestid?: string },
	doc: Pick<Document, "querySelector">,
): AnchorRect | null {
	const virtual = getAnchorRect?.();
	if (virtual) return virtual;
	const element = anchorRef ? anchorRef.current : anchorTestid !== undefined ? doc.querySelector(`[data-testid="${anchorTestid}"]`) : null;
	return element?.getBoundingClientRect() ?? null;
}

/** El armazón compartido. Una sola frontera de ancla: pasa `anchorRef` (una
 *  ref a un elemento vivo) o `anchorTestid` (el patrón de la sección de
 *  ajustes — el disparador se consulta por testid al colocar);
 *  `getAnchorRect` añade un ancla virtual (p. ej. la última línea del texto
 *  citado) que gana siempre que produce un rect. */
export function MenuShell({
	anchorRef,
	anchorTestid,
	getAnchorRect,
	testid,
	preferredSide,
	align = "right",
	menuClass,
	children,
	onClose,
	ownerId,
}: {
	anchorRef?: RefObject<HTMLElement | null>;
	anchorTestid?: string;
	getAnchorRect?: () => AnchorRect | null;
	/** El testid propio del cuerpo del menú (los sitios lo comprueban). */
	testid: string;
	/** Hacia qué lado abre el menú desde el ancla cuando caben ambos lados. */
	preferredSide: MenuSide;
	/** De qué borde del ancla toma el menú su posición horizontal. */
	align?: MenuAlign;
	/** Las clases del cuerpo del menú: ancho, borde, fondo, relleno, texto — el
	 *  armazón añade la posición, el z-index, el tope de altura y el scroll. */
	menuClass: string;
	children: ReactNode;
	onClose?: (reason: CloseReason) => CloseOutcome | void;
	ownerId?: string;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [placed, setPlaced] = useState<MenuPlacement | null>(null);
	const focusedOnceRef = useRef(false);
	const controller = useInteractionLayers();
	const anchor = () => {
		if (anchorRef) return anchorRef.current;
		if (anchorTestid !== undefined && typeof document !== "undefined") return document.querySelector(`[data-testid="${anchorTestid}"]`);
		return null;
	};
	const resolvedAnchorRef = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => { resolvedAnchorRef.current = anchor() as HTMLElement | null; });
	const originOwner = controller.ownerOf(anchor());
	const layer = useInteractionLayer({ kind: "popup", enabled: true, rootRef: menuRef, anchorRef: anchorRef ?? resolvedAnchorRef, ownerId: ownerId ?? originOwner?.id, onClose });
	const portal = controller.getPortalContainer(anchor(), ownerId ?? originOwner?.id);

	// Anuncia apertura↔cierre a las superficies bloqueables (ver MENU_OPEN_EVENT).
	useEffect(() => {
		window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT));
		return () => {
			window.dispatchEvent(new CustomEvent(MENU_CLOSE_EVENT));
		};
	}, []);

	// Foco al abrir (responsable, oleada de arreglos): los menús con búsqueda
	// llevan el foco A la búsqueda; los que no la tienen lo dejan en el cuerpo
	// (tabIndex -1 más abajo) para que la máquina de flechas tenga hogar. Solo
	// una vez — las recolocaciones (scroll/redimensionado) nunca deben robar el
	// foco a mitad de recorrido. El foco al montar de las propias listas ocurre
	// durante la pasada oculta de medición, donde focus() falla en silencio (los
	// subárboles visibility: hidden no admiten foco) — esta frontera es la que de verdad lo coloca.
	useEffect(() => {
		if (placed === null || focusedOnceRef.current || !layer.isTop) return;
		focusedOnceRef.current = true;
		const el = menuRef.current;
		if (!el) return;
		const input = el.querySelector<HTMLElement>("input, textarea");
		(input ?? el).focus();
	}, [placed, layer.isTop]);

	// La máquina de flechas estándar para los menús SIN búsqueda (responsable:
	// con un desplegable abierto, las flechas recorren las opciones y nunca
	// desplazan la pantalla): ArrowDown/Up mueven el foco del DOM entre los
	// botones de opción CON vuelta, Home/End van a los extremos; Enter activa
	// el botón enfocado de forma nativa. Los menús con búsqueda gestionan sus
	// flechas dentro del input (su máquina de recorrido acotado, 2026-09-17) —
	// esos eventos nunca suben hasta aquí, y la guarda de input/textarea es una red de seguridad.
	const onBodyKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (!controller.isElementEligible(menuRef.current)) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		const { key } = e;
		if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
		const buttons = Array.from(
			menuRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
		);
		if (buttons.length === 0) return;
		e.preventDefault();
		if (key === "Home") {
			buttons[0]?.focus();
			return;
		}
		if (key === "End") {
			buttons[buttons.length - 1]?.focus();
			return;
		}
		const delta = key === "ArrowDown" ? 1 : -1;
		const idx = buttons.findIndex((b) => b === document.activeElement);
		// Desde el cuerpo (aún nada enfocado): ArrowDown entra por la PRIMERA
		// opción, ArrowUp por la última — la convención del select nativo.
		const base = idx === -1 ? (delta > 0 ? -1 : 0) : idx;
		const next = (base + delta + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	// Se lee a través de una ref para que un callback nuevo en cada render nunca vuelva a ejecutar la colocación.
	const getAnchorRectRef = useRef(getAnchorRect);
	getAnchorRectRef.current = getAnchorRect;

	// Medir + (re)colocar: al montar, y luego en cada scroll en fase de captura
	// y en cada redimensionado (limitado con rAF). scrollHeight mantiene honesta
	// la decisión de volteo cuando el contenido cambia de forma (una búsqueda que filtra la lista).
	useLayoutEffect(() => {
		let raf = 0;
		const place = () => {
			const rect = menuAnchorRect({ getAnchorRect: getAnchorRectRef.current, anchorRef, anchorTestid }, document);
			if (!rect || !menuRef.current) return;
			const p = computeMenuPlacement(
				rect,
				{ width: window.innerWidth, height: window.innerHeight },
				menuRef.current.scrollHeight,
				preferredSide,
				align,
			);
			setPlaced(p);
		};
		place();
		const rePlace = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(place);
		};
		window.addEventListener("scroll", rePlace, true);
		window.addEventListener("resize", rePlace);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", rePlace, true);
			window.removeEventListener("resize", rePlace);
		};
	}, [anchorRef, anchorTestid, preferredSide, align]);

	// Primera pasada: montado oculto en la esquina superior izquierda del
	// viewport para que el efecto de layout mida la altura real del contenido
	// antes de que se vea nada. El menú se posiciona UNA vez y luego solo se reancla — sin parpadeo.
	if (!portal) return null;
	if (placed === null) {
		return createPortal(
			<InteractionLayerOwner.Provider value={layer.id}><div
				ref={menuRef}
				data-testid={testid}
				data-lh-menu=""
				style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
				className={menuClass}
			>
				{children}
			</div></InteractionLayerOwner.Provider>,
			portal,
		);
	}
	return createPortal(
		<InteractionLayerOwner.Provider value={layer.id}><div
			ref={menuRef}
			data-testid={testid}
			data-lh-menu=""
			tabIndex={-1}
			onKeyDown={onBodyKeyDown}
			style={{ position: "fixed", zIndex: INTERACTION_LAYER_Z_BASE + layer.order, ...placed.style, maxHeight: placed.maxHeight, overflowY: "auto" }}
			// El cuerpo es el hogar del foco de la máquina de flechas (los menús sin
			// input dejan aquí el foco al abrir) — el foco SE QUEDA, pero el anillo azul
			// por defecto del navegador a su alrededor no debe dibujarse (responsable,
			// ronda de pulido). El recorrido con flechas mueve el foco del DOM a los
			// botones, que tienen su propio hover/resaltado; el anillo es puro ruido.
			className={`${menuClass} outline-none`}
		>
			{children}
		</div></InteractionLayerOwner.Provider>,
		portal,
	);
}