import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeArrivalExpanded, revealArrival, shouldStampGeometryMute } from "../components/chat.tsx";

/**
 * Estados de llegada de las preguntas de enseñanza (decisión del responsable,
 * ronda de honestidad del scroll 2026-09-25). Se aplican DURANTE EL RENDER antes
 * de la primera pintura: el fallo era el expanded=true obsoleto que dejaba la
 * pregunta anterior, que pintaba un fotograma de la pregunta abierta: el dock se
 * medía alto, reservaba esa altura para siempre (la inmunidad del plegado
 * rechazaba devolverla) y la transcripción hacía scroll como si la pregunta
 * plegada se hubiera abierto.
 */
/**
 * La regla de crecimiento del silencio de geometría (ronda del parpadeo,
 * 2026-09-26): el CRECIMIENTO de la reserva mientras hay una pregunta pendiente
 * es el dock estirándose (el volcado del dictado que mete muchas líneas
 * dictadas de golpe, reproducido d≈152 > COLLAPSE_DIST): la recuperación del
 * scroll del espaciador no debe leerse como que el alumno se va. Las
 * reducciones son la propia devolución del plegado y nunca ponen sello.
 */
describe("shouldStampGeometryMute — when a block resize is our own stretch", () => {
	it("growth while a question is pending stamps (dictation flush, arrival stretch)", () => {
		assert.equal(shouldStampGeometryMute(545, 393, true), true);
	});

	it("sub-pixel growth does not stamp (rounding noise)", () => {
		assert.equal(shouldStampGeometryMute(394, 393, true), false);
	});

	it("shrink never stamps — the fold's own morph must not self-mute the re-expand", () => {
		assert.equal(shouldStampGeometryMute(40, 545, true), false);
	});

	it("no growth stamps without a pending question (composer life)", () => {
		assert.equal(shouldStampGeometryMute(545, 393, false), false);
	});
});

describe("revealArrival — how a teach question lands", () => {
	it("fresh arrival after the composer: collapsed behind the reveal button", () => {
		assert.deepEqual(revealArrival(false), { expanded: false, revealed: false });
	});

	it("queued behind another question: open — the reading already happened", () => {
		assert.deepEqual(revealArrival(true), { expanded: true, revealed: true });
	});
});

/**
 * Estado de llegada de las preguntas de sondeo (ronda del parpadeo,
 * 2026-09-26): abierta sii el alumno está siguiendo abajo del todo; con scroll
 * hacia arriba en el historial → llega como barra plegada, decidido DURANTE EL
 * RENDER (el antiguo efecto tras la pintura pintaba antes un fotograma abierto obsoleto).
 */
describe("probeArrivalExpanded — how a probe question lands", () => {
	it("at the bottom following along: open", () => {
		assert.equal(probeArrivalExpanded(true), true);
	});

	it("scrolled up in history: arrive already-collapsed (owner ruling)", () => {
		assert.equal(probeArrivalExpanded(false), false);
	});
});