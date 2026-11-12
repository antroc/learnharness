"use client"

import * as React from "react"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { bindingForAction, formatBinding, type KeyAction } from "@/src/core"

/**
 * La composición de tooltips para los controles de icono y de píldora
 * (oleada de tooltips, responsable 2026-09-25; ronda de sutileza del mismo
 * día). El tooltip pasivo con estilo lleva la etiqueta, con el atajo del
 * control añadido entre paréntesis cuando lo tiene ("Dictate (⌘D)"); la
 * decisión del responsable: el sufijo con raya dejaba demasiado aire.
 *
 * La combinación tiene en cuenta las sustituciones: pasa `action` para los
 * atajos del registro (una reasignación del usuario en Ajustes → Keyboard
 * cambia el sufijo en vivo), o `binding` para las teclas propias de una
 * superficie sin entrada en el registro ("escape" para cerrar un diálogo,
 * "enter" para enviar un formulario).
 *
 * children debe ser un único elemento que admita una ref (TooltipTrigger
 * asChild se fusiona con él: sin DOM envoltorio ni desplazamiento del layout).
 */

interface HintProps {
	label: string
	/** Acción del registro cuya combinación EN VIVO se muestra (tiene en cuenta las sustituciones). */
	action?: KeyAction
	/** Combinación propia de la superficie ("escape", "enter"): teclas que el
	 * registro no despacha a propósito (Esc cierra el propio diálogo; Enter
	 * envía el formulario al que pertenece el botón). */
	binding?: string
	side?: "top" | "bottom" | "left" | "right"
	children: React.ReactElement
}

/** La composición en sí, pura: "Dictate" + ⌘D → "Dictate (⌘D)". Exportada
 * para las fijaciones del mecanismo (tests/tooltip-mechanism.test.tsx). */
export function hintText(label: string, action?: KeyAction, binding?: string): string {
	const live = action
		? formatBinding(bindingForAction(action))
		: binding
			? formatBinding(binding)
			: ""
	return live ? `${label} (${live})` : label
}

export function Hint({ label, action, binding, side = "top", children }: HintProps) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent side={side}>{hintText(label, action, binding)}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}