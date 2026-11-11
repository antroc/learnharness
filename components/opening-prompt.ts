/**
 * Traspaso en la misma pestaña del texto de apertura completo de una sesión
 * nueva. Nunca pongas el mensaje en la URL de navegación: las cargas largas
 * en la query pueden rechazarse antes de que cargue la página del chat. El
 * almacenamiento es obligatorio para la entrega automática, no un efecto
 * secundario opcional y de mejor esfuerzo de salir del borrador de origen.
 */
export const OPENING_PROMPT_FAILURE = "Couldn’t open the session. Your message is still here. Try sending again.";

export interface OpeningPrompt {
	text: string;
	/** Se escribe ANTES de enviar. Un montaje posterior restaura un borrador, nunca vuelve a publicarlo. */
	attempted: boolean;
}

const keyFor = (id: string) => `lh.openingPrompt.${id}`;

export function stashOpeningPrompt(id: string, text: string, attempted = false): boolean {
	try {
		const value = JSON.stringify({ text, attempted } satisfies OpeningPrompt);
		// Captura tanto el getter del almacenamiento como sus métodos (errores de cuota/seguridad).
		const storage = globalThis.sessionStorage;
		storage.setItem(keyFor(id), value);
		return storage.getItem(keyFor(id)) === value;
	} catch {
		return false;
	}
}

export function readOpeningPromptEntry(id: string): OpeningPrompt | undefined {
	try {
		const value = globalThis.sessionStorage.getItem(keyFor(id));
		if (!value) return undefined;
		try {
			const entry: unknown = JSON.parse(value);
			if (entry && typeof entry === "object" && "text" in entry && typeof entry.text === "string" &&
				entry.text.length > 0 && "attempted" in entry && typeof entry.attempted === "boolean") {
				return { text: entry.text, attempted: entry.attempted };
			}
		} catch { /* Los alijos antiguos de texto en bruto no prueban que el envío nunca empezara. */ }
		return { text: value, attempted: true };
	} catch {
		return undefined;
	}
}

export function readOpeningPrompt(id: string): string | undefined {
	return readOpeningPromptEntry(id)?.text;
}

export function clearOpeningPrompt(id: string): boolean {
	try {
		globalThis.sessionStorage.removeItem(keyFor(id));
		return true;
	} catch {
		// La conversación/acuse canónicos siguen siendo la verdad. Un montaje posterior
		// con conversación real puede volver a intentar la limpieza; nunca la hagas fallar.
		return false;
	}
}
