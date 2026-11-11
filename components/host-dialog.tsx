"use client";

import {
	cloneElement, useCallback, useLayoutEffect, useRef, useState,
	type HTMLAttributes, type ReactElement, type ReactNode, type Ref, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { RemoveScroll } from "react-remove-scroll";
import { useBackdropDismiss } from "./backdrop-dismiss";
import {
	InteractionLayerOwner, isInteractionElementVisible, useInteractionLayer, useInteractionLayers,
	type CloseOutcome, type CloseReason, type LayerId, type OpeningLease,
} from "./interaction-layers";

/** Rangos de pintado declarativos compartidos, nunca constantes de primer plano por diálogo. */
export const INTERACTION_LAYER_Z_BASE = 100;
type FrameProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> };
export interface HostDialogProps {
	open: boolean;
	onClose: (reason: CloseReason) => CloseOutcome | void;
	layerId?: LayerId;
	ownerId?: LayerId | null;
	openingLease?: OpeningLease;
	initialFocusRef?: RefObject<HTMLElement | null>;
	headingRef?: RefObject<HTMLElement | null>;
	/** Raíz visual existente: se conservan las clases, los estilos, la ref y los ids de prueba. */
	frame?: ReactElement<FrameProps>;
	backdropProps?: HTMLAttributes<HTMLDivElement> & { "data-testid"?: string };
	"aria-label"?: string;
	"aria-labelledby"?: string;
	"aria-describedby"?: string;
	children: ReactNode;
}

/** Los renders cerrados independientes/SSR son seguros a propósito sin proveedor. */
export function HostDialog(props: HostDialogProps) {
	return props.open && (!props.openingLease || props.openingLease.owns()) ? <OpenHostDialog {...props} /> : null;
}

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
	if (typeof ref === "function") return ref(node);
	if (ref) ref.current = node;
}

function OpenHostDialog({
	onClose, layerId, ownerId, openingLease, initialFocusRef, headingRef,
	frame = <div />, backdropProps = {}, children, ...labels
}: HostDialogProps) {
	const controller = useInteractionLayers();
	const boundaryRef = useRef<HTMLDivElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const visualRef = useRef<HTMLElement | null>(null);
	const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const focusedRef = useRef(false);
	const focusAuthorityRef = useRef({ active: false, order: 0 });
	const focusInitial = useCallback(() => {
		const root = boundaryRef.current;
		if (!root || controller.getActiveModal()?.rootRef.current !== root) return;
		const explicit = initialFocusRef?.current;
		if (controller.isElementEligible(explicit ?? null)) {
			explicit!.focus({ preventScroll: true });
			return;
		}
		const visual = visualRef.current ?? root;
		const fields = visual.querySelectorAll<HTMLElement>(
			"input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input[type='password'], input[type='number'], textarea, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']",
		);
		for (const field of fields) {
			if (field.matches("[readonly], [aria-readonly='true']") || !controller.isElementEligible(field)) continue;
			field.focus({ preventScroll: true });
			return;
		}
		const heading = headingRef?.current ?? visual.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']");
		if (heading && isInteractionElementVisible(heading)) {
			if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
			heading.focus({ preventScroll: true });
		} else root.focus({ preventScroll: true });
	}, [controller, initialFocusRef, headingRef]);
	const layer = useInteractionLayer({
		id: layerId, kind: "modal", enabled: !!portalTarget,
		ownerId, rootRef: boundaryRef, portalRef: popupRef, onClose, focusInitial, openingLease,
	});
	const backdropGesture = useBackdropDismiss(() => {
		if (controller.isLayerEligible(layer.id)) controller.requestClose(layer.id, "backdrop");
	});

	useLayoutEffect(() => {
		const active = document.activeElement;
		openerRef.current = active instanceof HTMLElement ? active : null;
		setPortalTarget(document.body);
	}, []);

	useLayoutEffect(() => {
		if (!layer.active || !boundaryRef.current) return;
		return hideOthers(boundaryRef.current);
	}, [layer.active]);

	useLayoutEffect(() => {
		if (!layer.active || focusedRef.current) return;
		focusedRef.current = true;
		// El autofocus explícito existente sigue siendo una elección de foco explícita aprobada.
		if (!boundaryRef.current?.contains(document.activeElement)) focusInitial();
	}, [layer.active, focusInitial]);

	useLayoutEffect(() => {
		focusAuthorityRef.current = { active: layer.active, order: layer.order };
	});
	useLayoutEffect(() => () => {
		// La limpieza del registro se ejecuta primero. Los padres depuestos nunca adquieren
		// autoridad de retorno; un modal más nuevo también revoca un ticket de cierre antiguo.
		const authority = focusAuthorityRef.current;
		if (!authority.active || (controller.getActiveModal()?.order ?? 0) > authority.order) return;
		const generation = controller.getGeneration();
		const focusRevision = controller.getFocusRevision();
		const opener = openerRef.current;
		setTimeout(() => { controller.restoreFocus(opener, generation, focusRevision, openingLease); }, 0);
	}, [controller, openingLease]);

	const originalRef = frame.props.ref;
	const frameRef = useCallback((node: HTMLElement | null) => {
		visualRef.current = node;
		return assignRef(originalRef, node);
	}, [originalRef]);
	if (!portalTarget || (openingLease && !openingLease.owns())) return null;
	const visual = cloneElement(frame, {
		ref: frameRef,
		// El límite semántico incluye los portales de las ventanas emergentes; el marco visual puede
		// transformar/recortar libremente sin cambiar la geometría fija de los menús en el viewport.
		role: undefined,
		"aria-modal": undefined,
	}, children);
	const gestureKeys = Object.keys(backdropGesture) as (keyof typeof backdropGesture)[];
	const composedBackdrop = { ...backdropProps };
	for (const key of gestureKeys) {
		const caller = backdropProps[key];
		const shared = backdropGesture[key];
		Object.assign(composedBackdrop, { [key]: (event: never) => { caller?.(event); shared(event); } });
	}
	return createPortal(
		<InteractionLayerOwner.Provider value={layer.id}>
			<RemoveScroll enabled={layer.active} forwardProps>
				<FocusScope asChild loop={false} trapped={layer.active}
					onMountAutoFocus={event => { event.preventDefault(); }}
					onUnmountAutoFocus={event => { event.preventDefault(); }}>
					<div ref={boundaryRef} role="dialog" tabIndex={-1}
						aria-modal={layer.active || undefined}
						aria-label={labels["aria-label"] ?? frame.props["aria-label"]}
						aria-labelledby={labels["aria-labelledby"] ?? frame.props["aria-labelledby"]}
						aria-describedby={labels["aria-describedby"] ?? frame.props["aria-describedby"]}
						aria-hidden={!layer.active || undefined} inert={!layer.active}
						data-interaction-layer={layer.id}
						style={{ position: "fixed", inset: 0, zIndex: INTERACTION_LAYER_Z_BASE + layer.order }}>
						{/* Los contextos de apilado locales evitan que las clases z-index del fondo/marco
						de quien llama tapen su anfitrión de ventanas emergentes propio. El aislamiento no
						transforma, no recorta ni establece un contenedor de posición fija. */}
						<div style={{ isolation: "isolate" }}><div {...composedBackdrop}>{visual}</div></div>
						<div ref={popupRef} data-interaction-popup-host={layer.id} style={{ isolation: "isolate" }} />
					</div>
				</FocusScope>
			</RemoveScroll>
		</InteractionLayerOwner.Provider>,
		portalTarget,
	);
}
