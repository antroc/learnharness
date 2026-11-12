/**
 * LA SUPERFICIE DE PRÁCTICA: fijaciones de render SSR (la disciplina de la
 * batería de render: cuerpos puros, renderToStaticMarkup, testids). El dock (el
 * problema activo sustituye al compositor: el enunciado arriba y el campo
 * "Your thinking" debajo con UN SOLO Enviar (Enter envía, Shift+Enter es un salto
 * de línea)), las tarjetas de la transcripción (el enunciado compacto y
 * desplegable del problema: el compromiso NUNCA se renderiza; el resultado +
 * veredicto + revelación de la conclusión; las tarjetas de registro del
 * razonamiento del alumno) y la proyección de vista (la parte de datos del
 * marcador de razonamiento; el silencio del descarte).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderWithInteractionLayers as renderToStaticMarkup } from "./interaction-layer-render.tsx";
import { describe, it } from "node:test";

import { PracticeDock } from "../components/practice-dock.tsx";
import { ConcludeCard, ProblemCard, ThinkingCard } from "../components/practice-cards.tsx";
import { GraphContextCard } from "../components/graph-context-card.tsx";
import { newGraphContextMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import type { ArtifactPartProps } from "../src/core";
import {
	newThinkingMessage,
	PRACTICE_PROBLEM_TOOL,
	type LhMessage,
} from "../src/core/native-messages.ts";

const part = (over: Partial<ArtifactPartProps["part"]>): ArtifactPartProps["part"] => ({
	type: "tool-problem",
	state: "input-available",
	toolCallId: "call_p1",
	...over,
});

// ── el dock ──────────────────────────────────────────────────────────────────

describe("PracticeDock", () => {
	it("expanded: statement renders, the two lanes sit in the thinking field", () => {
		const html = renderToStaticMarkup(
			<PracticeDock
				problemCallId="call_p1"
				input={{ statement: "Show that the sum is even." }}
				expanded={true}
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.match(html, /Show that the sum is even\./);
		// El antetítulo 'Problem' (ronda del responsable, 2026-10-05): la fila de etiqueta de
		// las tarjetas de quiz, replicada: el dock y la tarjeta de la transcripción se leen igual.
		assert.match(html, /Problem/);
		// El tope medido de la columna (el antiguo 40vh fijo es solo la alternativa).
		assert.match(html, /--dock-max-h/);
		assert.match(html, /YOUR THINKING/);
		assert.match(html, /data-testid="practice-send"/);
		assert.ok(!html.includes("practice-nudge") && !html.includes("practice-commit"), "the two-lane buttons are gone");
		// Los botones llevan su carril en la barrera de desactivación; los dos empiezan
		// desactivados (campo vacío).
		assert.match(html, /disabled/);
	});

	it("collapsed: the slim bar carries the statement excerpt", () => {
		const html = renderToStaticMarkup(
			<PracticeDock
				problemCallId="call_p1"
				input={{ statement: "Show that the sum is even." }}
				expanded={false}
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.match(html, /data-testid="practice-dock-bar"/);
		assert.match(html, /Show that the sum is even\./);
	});
});

// ── las tarjetas de la transcripción ─────────────────────────────────────────

describe("the practice transcript cards", () => {
	it("ProblemCard: ALWAYS OPEN, the 'Problem' eyebrow + the statement — the commitment NEVER renders", () => {
		const html = renderToStaticMarkup(
			<ProblemCard
				part={part({
					input: {
						statement: "Prove the parity claim.",
						mode: "recall",
						modelSolution: "Pair them.",
					},
				})}
			/>,
		);
		assert.match(html, /data-testid="problem-card"/);
		assert.match(html, /Problem/);
		assert.match(html, /Prove the parity claim\./);
		assert.doesNotMatch(html, /Pair them\./, "the commitment stays hidden");
		// Sin chevron ni barra plegada (ronda del responsable, 2026-10-05).
		assert.doesNotMatch(html, /lucide-chevron|<button/, "nothing collapsible");
	});

	it("ConcludeCard: the SOLUTION is the hero (the pose's modelSolution via part.reveal); the verdict rides below, low-key", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solvedWithHints", verdict: "The pairing came after R2." },
					reveal: "Pair them; each pair is even.",
				})}
			/>,
		);
		assert.match(html, /data-testid="conclude-card"/);
		assert.match(html, /Solved with hints/);
		assert.match(html, /Pair them; each pair is even\./, "the committed solution, verbatim");
		assert.match(html, /Concluded/); // el antetítulo simple (ronda 3 del responsable)
		assert.match(html, /Solved/); // el resultado va en la etiqueta del quiz
		assert.match(html, /Model solution/); // el protagonista etiquetado tras el divisor
		assert.ok(html.indexOf("Solved") < html.indexOf("Model solution"), "chip at the top");
		assert.match(html, /The pairing came after R2\./);
		// PRIMERO EL VEREDICTO (ronda 3 del responsable): veredicto bajo la fila de cabecera, luego
		// el divisor y luego la solución modelo etiquetada.
		assert.ok(html.indexOf("The pairing came after R2.") < html.indexOf("Pair them; each pair is even."));
		assert.doesNotMatch(html, /<button/, "nothing collapsible");
	});

	it("ConcludeCard: legacy records fall back to their own solutionReveal", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solved", verdict: "Clean.", solutionReveal: "Pair them; each pair is even." },
				})}
			/>,
		);
		assert.match(html, /Pair them; each pair is even\./);
	});

	it("ConcludeCard: THE METADATA POPOVER (owner round 17 refinement) — quiet trigger at the bottom, box hidden until clicked", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solvedWithHints", verdict: "v", rung: "R2", missClass: "cue", retest: true },
					problemInput: { mode: "discrimination", target: ["n_abc"] },
					reveal: "The solution.",
				})}
			/>,
		);
		assert.ok(html.includes('data-testid="metadata-toggle"'), "the trigger row");
		assert.match(html, /Metadata/, "the label (CSS renders it mono-caps)");
		assert.ok(!html.includes('data-testid="metadata-box"'), "the info box is CLOSED until clicked — no rows in the markup");
		assert.ok(!html.includes("border-t \"/>"), "no separate divider — the trigger just sits at the bottom");
		// La cara abierta (filas de recuadro informativo a los 15px de la solución modelo) es un
		// plegado useState del cliente: el render estático no puede hacer clic; la forma de los
		// datos de las filas la fija la prueba de unión de vista de practice-record.
	});

	it("ConcludeCard: no metadata trigger when the calls filled nothing beyond the visible card", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "dismissed" } })} />,
		);
		assert.ok(!html.includes("metadata-"), "the dismissal line carries no trigger");
		const legacy = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "solved" }, reveal: "s" })} />,
		);
		assert.ok(!legacy.includes("metadata-"), "empty problemInput + bare outcome: nothing to reveal");
	});

	it("ConcludeCard: the dismissal synthesis is one muted line — no reveal card", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "dismissed" } })} />,
		);
		assert.match(html, /Problem dismissed\./);
		assert.doesNotMatch(html, /The solution/);
	});

	it("ThinkingCard: one label, right side, expanded arrival (owner round, 2026-10-07)", () => {
		const trace = renderToStaticMarkup(<ThinkingCard data={{ problemCallId: "c", commit: false, text: "stuck at step two" }} />);
		assert.match(trace, /YOUR THINKING/);
		// Las filas de la transcripción llegan DESPLEGADAS (claramente enviadas) como
		// franjas a todo el ancho del color de tarjeta con el raíl de 6px (el documento,
		// todo dentro: segunda ronda del responsable, 2026-10-07).
		assert.match(trace, /aria-expanded="true"/);
		assert.ok(trace.includes("stuck at step two"), "the text is visible on arrival");
		assert.ok(trace.includes("bg-card"), "the card-color band");
		assert.ok(trace.includes("border-l-[calc(3ch-14px)]"), "narrow rail inside the 3ch inset");
		const legacy = renderToStaticMarkup(<ThinkingCard data={{ problemCallId: "c", commit: true, text: "It is 42." }} />);
		assert.match(legacy, /YOUR THINKING/);
		assert.doesNotMatch(legacy, /Your solution/);
	});
});

// ── la proyección de vista ───────────────────────────────────────────────────

describe("the practice view projection", () => {
	it("the thinking marker projects as a user-side data part (register in details)", () => {
		const marker = newThinkingMessage("call_p1", "It is 42.");
		const view = projectView([marker as LhMessage]);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		const dataPart = view[0]!.parts[0]!;
		assert.equal(dataPart.type, "data-practice-thinking");
		assert.deepEqual(dataPart.data, { problemCallId: "call_p1", text: "It is 42." });
	});

	it("the problem pose's ack keeps the part input-available (the dock's mount)", () => {
		// Llamada de planteamiento + resultado de acuse (details: null: la bifurcación del provisional).
		const messages = [
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call_p1", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "S." } }],
			},
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call_p1",
				toolName: PRACTICE_PROBLEM_TOOL,
				content: [{ type: "text", text: "Problem posed" }],
				details: null,
				isError: false,
			},
		] as unknown as LhMessage[];
		const view = projectView(messages);
		const toolPart = view[0]!.parts.find((p) => p.type === `tool-${PRACTICE_PROBLEM_TOOL}`)!;
		assert.equal(toolPart.state, "input-available");
	});
});

// ── la tarjeta de contexto del grafo (elección del mapa de una sesión; plegada por defecto) ─

describe("GraphContextCard", () => {
	it("collapsed: counts only — the statements stay hidden until expanded", () => {
		const html = renderToStaticMarkup(
			<GraphContextCard data={{ propositions: [
				{ id: "n1", name: "Modus ponens", statement: "If P implies Q and P holds, Q holds." },
				{ id: "n2", name: "Soundness", statement: "A valid argument from true premises has a true conclusion." },
			], chains: ["Modus ponens → Soundness"] }} />,
		);
		assert.ok(html.includes('data-testid="graph-context-card"'));
		assert.ok(html.includes("2 propositions"));
		assert.ok(html.includes("1 chain"));
		// mínima: la barra plegada NO lleva texto del enunciado
		assert.ok(!html.includes("If P implies Q"));
		assert.ok(!html.includes("graph-context-body"));
	});

	it("zero chains: the chain count stays out of the summary", () => {
		const html = renderToStaticMarkup(
			<GraphContextCard data={{ propositions: [{ id: "n1", name: "A", statement: "S." }], chains: [] }} />,
		);
		assert.ok(html.includes("1 proposition</span>"));
		assert.ok(!html.includes("chain"));
	});

	it("the marker projects to the card's part (projectView fold)", () => {
		const view = projectView([newGraphContextMessage(
			[{ id: "n1", name: "A", statement: "S." }], [],
		) as unknown as LhMessage]);
		assert.equal((view[0]!.parts[0] as { type: string }).type, "data-graph-context");
	});
});
