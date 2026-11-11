/**
 * Confirmación en el servidor del arrastre con física en vivo
 * (PUT /api/graph/positions). El renderizador del cliente templa un arrastre
 * hasta el reposo y hace PUT del nuevo estado de reposo; el servidor se fía de
 * él para los nodos que conoce y, si el grafo creció mientras el usuario
 * arrastraba (llegó una fusión), ejecuta UN asentamiento incremental
 * (settleGraphLayout) para que los nodos nuevos se integren en el encuadre que
 * el usuario acaba de colocar; las posiciones del cliente actúan como anclas,
 * nunca como algo que machacar.
 *
 * Todos los cuerpos se sanean: las coordenadas basura se acotan o se descartan,
 * los ids desconocidos se descartan y nada lanza.
 *
 * IDS CONOCIDOS = EL MUNDO DEL LIENZO (corrección del responsable, 2026-10-06;
 * el error de las salpicaduras): los nodos de la vista derivada, las
 * proposiciones almacenadas Y los nodos de implicación arg_ derivados. El
 * lienzo los persiste todos; quitar aquí los args purgaba sus entradas del
 * registro en cada confirmación de arrastre, así que cada montaje los volvía a
 * sembrar en un anillo gigante (el informe de «salpicados desde el centro»)
 * hasta que un arrastre los templaba de nuevo. Los ids arg_ son estables
 * (acuñados a partir del registro de cadenas), así que persistirlos es correcto.
 */
import type { Position } from "../core/contracts.ts";
import { deriveView, getGraph } from "../core/graph.ts";
import { settleGraphLayout } from "../core/layout-settle.ts";
import { stores } from "./stores.ts";

/** Máximo |x| o |y| aceptado: NaN/Infinity se acotan aquí, y lo absurdo también. */
const MAX_COORD = 1e6;

/**
 * Acepta el cuerpo en bruto del PUT (un Record de id → {x, y}) y devuelve las
 * posiciones saneadas que se persistieron de verdad (objeto vacío = no se
 * escribió nada, p. ej. un cuerpo sin ids conocidos; el llamante informa pero
 * nunca falla).
 */
export function commitPositions(input: unknown): Record<string, Position> {
	if (typeof input !== "object" || input === null) return {};
	const raw = input as Record<string, unknown>;

	// Solo los ids que existen de verdad en el mundo del lienzo: las proposiciones
	// almacenadas más los nodos de implicación arg_ DERIVADOS (deriveView del grafo
	// actual: la misma derivación que sirve la instantánea, así que los ids coinciden
	// por construcción).
	const known = new Set(deriveView(getGraph(stores.graphStore)).nodes.map((n) => n.id));

	const positions: Record<string, Position> = {};
	for (const [id, value] of Object.entries(raw)) {
		if (!known.has(id)) continue;
		if (typeof value !== "object" || value === null) continue;
		const { x, y } = value as Record<string, unknown>;
		if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))
			continue;
		positions[id] = {
			x: Math.min(Math.max(x, -MAX_COORD), MAX_COORD),
			y: Math.min(Math.max(y, -MAX_COORD), MAX_COORD),
		};
	}
	if (Object.keys(positions).length === 0) return {};

	stores.graphStore.writePositions(positions);

	// El grafo creció más allá de lo que conocía el cliente (llegó una fusión a mitad del
	// arrastre): se integran los nodos nuevos con el estado de reposo del cliente como
	// anclas. La prueba honesta: algún nodo de la vista ACTUAL falta en la carga del
	// cliente, sea proposición o arg_ (la antigua comparación de recuentos se rompió en
	// cuanto los args pasaron a ser persistibles).
	for (const id of known) {
		if (!(id in positions)) {
			settleGraphLayout(stores.graphStore);
			break;
		}
	}
	return positions;
}