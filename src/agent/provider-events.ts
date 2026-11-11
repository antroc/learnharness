/**
 * provider-events: el grabador del cable en bruto (propietario, 2026-10-04).
 *
 * El observador onProviderStreamEvent de pi-ai 1.0 se dispara con cada evento ANALIZADO del
 * stream del proveedor ANTES de que pi lo normalice: justo la capa donde vive nuestra clase de
 * incidentes por rarezas de los proveedores y donde nada más en la app puede mirar: GLM-flash
 * truncando los argumentos de las llamadas a herramientas a mitad del JSON (2026-09-25),
 * DeepSeek reiniciando los ids de las llamadas a herramientas en cada respuesta (2026-10-04, la
 * sesión de Lacan). Este módulo convierte ese observador en un artefacto inspeccionable.
 *
 * Activación (elección del propietario, 2026-10-04): solo variable de entorno:
 *   LH_PROVIDER_EVENTS=1 npm run dev
 * Desactivado por defecto: los eventos en bruto llevan los prompts completos (privacidad) y un
 * volumen ilimitado (disco). Sin superficie en la app; es una herramienta de depuración, no una
 * funcionalidad.
 *
 * Artefacto: un fichero JSONL por chat en
 *   data/debug/provider-events/<chatId>.jsonl
 * (data/ es espacio de trabajo desechable: sin sistema de retención). Cada línea:
 *   {"t":<epoch ms>,"ctx":"teacher|prober|job:<role>","provider":…,"model":…,"event":<raw>}
 * más marcas de ejecución {"note":…}. Un límite de bytes por fichero (LIMITADO a ~20 MB)
 * escribe una única marca de truncado y se detiene: un turno desbocado no debe llenar el disco.
 * El contenido de los eventos es propiedad del adaptador; un evento no serializable se degrada
 * a una nota con su tipo y nunca lanza (una excepción del observador no debe matar un stream).
 */

import * as fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

/** Bytes máximos del JSONL de cada chat antes de dejar de grabar (con una marca). */
const CAP_BYTES = 20 * 1024 * 1024;

/** Juntura para pruebas (el patrón toolTimeoutMs): reduce el límite para ejercitarlo. */
export const providerEventsCap = { current: CAP_BYTES };

/** Juntura para pruebas (el patrón toolTimeoutMs): redirige el directorio de salida. */
export const providerEventsDir = { current: path.join(PATHS.debug, "provider-events") };

/** La forma del modelo que recibe el observador (estructural: pi pasa Model). */
export interface ProviderEventModel {
	provider?: string;
	id?: string;
}

export type ProviderEventObserver = (data: unknown, model: ProviderEventModel) => void;

/** Contabilidad por fichero para que la marca del límite se escriba exactamente una vez. */
const files = new Map<string, { bytes: number; capped: boolean }>();

function fileFor(chatId: string): string {
	// los ids de chat los genera la app (chat_<base36>): se sanean por si algún futuro
	// esquema de ids metiera aquí caracteres problemáticos para las rutas.
	const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return path.join(/* turbopackIgnore: true */ providerEventsDir.current, `${safe}.jsonl`);
}

function writeLine(file: string, line: Record<string, unknown>): void {
	const state = files.get(file);
	if (state?.capped) return;
	const text = `${JSON.stringify({ t: Date.now(), ...line })}\n`;
	try {
		const before = state?.bytes ?? (fs.existsSync(file) ? fs.statSync(file).size : 0);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, text, "utf-8");
		const bytes = before + Buffer.byteLength(text);
		if (bytes > providerEventsCap.current) {
			files.set(file, { bytes, capped: true });
			fs.appendFileSync(file, `${JSON.stringify({ t: Date.now(), note: `cap ${providerEventsCap.current} bytes reached — recording stopped` })}\n`, "utf-8");
		} else {
			files.set(file, { bytes, capped: false });
		}
	} catch {
		// El grabador de depuración nunca debe tumbar una ejecución.
	}
}

/** Codifica de forma segura un evento propiedad del adaptador: JSON cuando colabora y una nota
 *  con el tipo cuando no (cargas cíclicas o con BigInt). */
function encodeEvent(data: unknown): unknown {
	try {
		JSON.stringify(data);
		return data;
	} catch {
		return { __nonSerializable: typeof data };
	}
}

/** True cuando la grabación está activada (se lee en cada llamada: activarla o desactivarla no
 *  requiere más reinicio que la construcción del agente del siguiente turno). */
export function providerEventsEnabled(): boolean {
	return !!process.env.LH_PROVIDER_EVENTS;
}

/**
 * El observador para una ejecución de agente, o undefined si está desactivado. Pasa el
 * resultado como onProviderStreamEvent del Agent (los dos sitios de construcción
 * —baseAgentOptions de teacher-agent y runSubagent de pi-run— lo construyen a partir de un
 * chatId que ya tienen).
 */
export function providerEventObserver(chatId: string, context: string): ProviderEventObserver | undefined {
	if (!providerEventsEnabled()) return undefined;
	return (data, model) => {
		writeLine(fileFor(chatId), {
			ctx: context,
			provider: model?.provider,
			model: model?.id,
			event: encodeEvent(data),
		});
	};
}

/** Una marca de ejecución (notas de inicio, fin o aborto) para que los eventos se correlacionen
 *  con el registro guardado; no hace nada si está desactivado. */
export function providerEventNote(chatId: string, context: string, text: string): void {
	if (!providerEventsEnabled()) return;
	writeLine(fileFor(chatId), { ctx: context, note: text });
}
