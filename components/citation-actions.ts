import { Quote } from "lucide-react";
import { CITATION_MAX_TEXT_LENGTH, serializeCitation, type TutorCitation } from "@/src/core";
import { INSERT_CITATION_EVENT, type CitationInsertedRange, type InsertCitationDetail } from "./path-input";
import type { SelectionAction } from "./selection-toolbar";

/** Un chip de cita del compositor cuyo comentario se está editando. `fresh` marca uno
 * recién insertado: Cancelar lo elimina junto con los espacios que añadió. */
export interface CitationEditTarget {
	citation: TutorCitation;
	link: string;
	start: number;
	host?: HTMLElement;
	/** Anfitrión editable exacto: también admite el razonamiento de lectura, pregunta o práctica. */
	input?: HTMLElement;
	fresh?: CitationInsertedRange;
}

/** El botón Cite de la barra de herramientas: cita la selección en el compositor y
 * abre el editor de comentarios sobre el chip nuevo. */
export function createCiteAction({ chatId, composer, openEditor }: {
	chatId: string;
	/** La raíz editable prevista: el compositor o el campo de razonamiento activo. */
	composer: () => HTMLElement | null;
	openEditor: (target: CitationEditTarget) => void;
}): SelectionAction {
	return {
		id: "cite",
		label: "Cite",
		ariaLabel: "Cite selection in your input",
		icon: Quote,
		disabledLabel: (capture) => (capture.selector.text.length > CITATION_MAX_TEXT_LENGTH ? "Shorten selection" : null),
		visible: () => composer() !== null,
		onSelect: (capture) => {
			const root = composer();
			if (!root) return false;
			const citation: TutorCitation = { version: 1, chatId, messageId: capture.messageId, ...capture.selector };
			const link = serializeCitation(citation);
			const detail: InsertCitationDetail = {
				link,
				onInserted: (fresh) => openEditor({ citation, link, start: fresh.start, fresh, input: root }),
			};
			const View = root.ownerDocument.defaultView;
			root.dispatchEvent(new (View?.CustomEvent ?? CustomEvent)(INSERT_CITATION_EVENT, { detail }));
			return true;
		},
	};
}
