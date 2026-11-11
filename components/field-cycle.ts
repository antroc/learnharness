"use client";

import { useEffect } from "react";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";

/**
 * TAB RECORRE LOS CAMPOS DE TEXTO DE LA SUPERFICIE ACTIVA (responsable, ronda de
 * teclado 2026-10-06): solo hacia delante, dando la vuelta; Tab desde fuera de la
 * cadena enfoca el PRIMER campo — «navegar hacia dentro». Shift+Tab NO es nuestro
 * (es del ciclo global del nivel de razonamiento — decisión del responsable en la
 * misma ronda), así que no hay marcha atrás; la cadena da la vuelta.
 *
 * El evento (no un puente por props): el manejador global de Tab despacha
 * `lh:kbd-cycle-fields` y cada superficie con compositor responde con su propia
 * cadena, recogida del DOM vivo en el momento del evento — los campos se montan y
 * desmontan con los docks, así que una consulta gana a unas refs obsoletas. El
 * propio reclamo de Tab del dock de quiz (filas ↔ razonamiento, mientras una
 * pregunta con opciones está desplegada) detiene la propagación a nivel de
 * documento, así que este hook solo oye Tab en superficies SIN un reclamo activo
 * — sin doble acción.
 */
export function useFieldCycle(fields: () => readonly HTMLElement[]) {
	const controller = useOptionalInteractionLayers();
	useEffect(() => {
		const onCycle = () => {
			const list = fields().filter((el) => isInteractionScopeEligible(el, controller));
			if (list.length === 0) return;
			const active = document.activeElement;
			const idx = active ? list.findIndex((el) => el === active || el.contains(active)) : -1;
			if (idx < 0) {
				list[0]!.focus();
				return;
			}
			list[(idx + 1) % list.length]!.focus();
		};
		window.addEventListener("lh:kbd-cycle-fields", onCycle);
		return () => window.removeEventListener("lh:kbd-cycle-fields", onCycle);
	}, [fields, controller]);
}
