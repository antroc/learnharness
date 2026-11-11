/**
 * LAS HERRAMIENTAS DE PRÁCTICA (sesiones de práctica, diseño del responsable del 2026-10-04): TODO
 * el conjunto de herramientas del agente de práctica: `problem` (plantear: termina el turno;
 * el compromiso va en los argumentos de la llamada, oculto a la interfaz del alumno)
 * y `conclude` (terminar el problema: resultado normal, el turno continúa para que
 * la misma respuesta pueda revelar + plantear el siguiente). La ley de las barreras (decisión del
 * responsable): un agente no puede plantear mientras haya un problema activo ni puede
 * concluir sin nada activo; activeProblemOf es el único pliegue que leen ambas
 * barreras.
 *
 * Descripciones solo mecánicas (la decisión de doctrina, 2026-10-04): las descripciones de las
 * herramientas dicen QUÉ pasar y QUÉ ocurre; la teoría, la ley de comprometerse
 * antes de plantear y la escalera de pistas viven todas en el prompt de sistema
 * (prompts/practice/10-doctrine.md).
 */

import { Type, type Static } from "typebox";
import { practiceProblemInputSchema } from "../../core/practice-problems.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveTargetId } from "../../core/chains.ts";
import { readTool } from "./read.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { jobTools, type JobToolContext } from "./jobs.ts";
import { proberGraphTools, type GraphToolContext } from "./graph.ts";
import { activeProblemOf } from "../../core/native-messages.ts";
import type { LhMessage } from "../../core/native-messages.ts";
import { concludeResult, invalidInputResult, problemResult } from "../tool-execute.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";


/** El contexto de lectura del registro que necesitan las barreras (el patrón de las herramientas de plan). */
export interface PracticeToolContext {
	chatId: string;
	chatStore: { getChat(id: string): { messages: LhMessage[]; kind?: string } | null };
	/** La lista de nodos del grafo ENTERO, leída de nuevo en cada planteamiento (ronda 9 del responsable: el
	 *  contrato de traza de dominio): los objetivos se validan contra todas las proposiciones,
	 *  no solo contra las elegidas para la sesión, así que las sesiones sin elecciones y los futuros
	 *  planteamientos con herramientas de grafo siguen siendo válidos. Ausente (pruebas) = sin validación. */
	graphNodes?: () => ReadonlyArray<Pick<import("../../core/contracts/graph.ts").GraphNode, "id" | "name">>;
	/** EL CONJUNTO QUE RARA VEZ HACE FALTA (ronda 10 del responsable, 2026-10-05): los lectores del mapa
	 *  tras la MISMA barrera de ajustes que los del sondeador (graphToolsEnabled en
	 *  la raíz de composición); las tareas research + pdf (ambas sin clave).
	 *  Cada contexto ausente (pruebas) = ausente del registro. */
	graph?: GraphToolContext;
	jobs?: JobToolContext;
}

/** ESTADO DE LAS BARRERAS CON ÁMBITO DE TURNO (el incidente de BKT, 2026-10-05): las barreras
 *  leían antes el registro GUARDADO, pero el registro se congela en la escritura anticipada
 *  del turno (persistTurn solo llega al FINAL del turno), así que un par conclude → pose
 *  a mitad de turno nunca podía verse mutuamente: cada conclude
 *  tenía éxito contra el registro obsoleto y cada planteamiento siguiente moría con
 *  "a problem is already active" hasta que el modelo se rendía («el hueco del problema
 *  está atascado»). La barrera se siembra UNA vez desde el registro al construirse
 *  (un practiceTools por turno: chat-handler construye el agente por
 *  petición, así que no hay fugas entre turnos), y los execute cambian
 *  este cierre: la verdad dentro del turno que el registro aún no puede contener. */
export interface PracticeGate {
	problemActive: boolean;
}

/** Siembra la barrera del turno desde el registro (activeProblemOf consciente del resultado:
 *  solo cuenta un problema planteado limpiamente). */
export function createPracticeGate(ctx: PracticeToolContext): PracticeGate {
	const record = ctx.chatStore.getChat(ctx.chatId);
	return { problemActive: record ? activeProblemOf(record.messages) !== null : false };
}

// ─── problem: el planteamiento ───────────────────────────────────────────────────

export const problemInputObject = practiceProblemInputSchema;

export type ProblemInput = Static<typeof problemInputObject>;

export function problemTool(
	gate: PracticeGate,
	graphNodes?: PracticeToolContext["graphNodes"],
): AgentTool<typeof problemInputObject> {
	return {
		name: "problem",
		label: "problem",
		description:
			"Pose one practice problem. Ends the turn — the learner works in the thinking field; their thinking " +
			"traces and answer commits arrive back as labeled messages. The modelSolution rides this call's " +
			"arguments and stays hidden from the learner until you conclude (conclude shows it verbatim — the " +
			"reveal needs no new field). Only one problem may be active — conclude it before posing the next.",
		parameters: problemInputObject,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => {
			const healed = healEncodedArguments(args, problemInputObject);
			// NORMALIZACIÓN DE OBJETIVOS (ronda 9 del responsable): los nombres se convierten en ids en silencio;
			// el REGISTRO lleva ids canónicos (la traza de dominio agrupa por
			// ellos); los strings que no se pueden resolver pasan para que execute los rechace.
			// PROBLEMAS SIN ETIQUETA (ronda 12 del responsable): una lista vacía explícita es
			// el modelo diciendo «sin objetivos»: se elimina con la reparación, así que la forma
			// canónica del registro es con etiquetas o ausente, nunca [].
			if (!graphNodes) {
				const bare = (healed as { target?: unknown }).target;
				return Array.isArray(bare) && bare.length === 0
					? ({ ...(healed as Record<string, unknown>), target: undefined } as never)
					: (healed as never);
			}
			const target = (healed as { target?: unknown }).target;
			if (!Array.isArray(target) || target.length === 0) {
				return { ...(healed as Record<string, unknown>), target: undefined } as never;
			}
			const list = graphNodes();
			const normalized = target.map((t) =>
				typeof t === "string" ? (resolveTargetId(t, list) ?? t) : t,
			);
			if (normalized.every((t, i) => t === target[i])) return healed as never;
			return { ...(healed as Record<string, unknown>), target: normalized } as never;
		},
		execute: async (_toolCallId, input) => {
			return admitPracticeProblem(gate, input, graphNodes) ?? problemResult();
		},
	};
}

/** Una única admisión síncrona para los planteamientos nativos Y de plugins; ningún await puede partir la barrera. */
export function admitPracticeProblem(gate: PracticeGate, input: { target?: string[] }, graphNodes?: PracticeToolContext["graphNodes"], toolName = "problem") {
	if (gate.problemActive) return invalidInputResult(toolName, ["a problem is already active — call conclude on it before posing the next one"]);
	if (graphNodes && input.target?.length) {
		const list = graphNodes();
		const unknown = input.target.filter(target => resolveTargetId(target, list) === null);
		if (unknown.length) return invalidInputResult(toolName, [`target ${JSON.stringify(unknown)} is not a known proposition — targets must be proposition ids from the session context; if the material is not in the map, omit target entirely`]);
	}
	gate.problemActive = true;
	return undefined;
}

// ─── conclude: el final de un problema ───────────────────────────────────────────

export const concludeInputObject = Type.Object({
	outcome: Type.Union(
		[
			Type.Literal("solved"),
			Type.Literal("solvedWithHints"),
			Type.Literal("movedOn"),
			Type.Literal("surrendered"),
			Type.Literal("dismissed"),
		],
		{ description: "REQUIRED — the outcome: solved, solvedWithHints, movedOn, or surrendered — bare words, no quotes (dismissed is synthesized, never yours)." },
	),
	verdict: Type.String({
		description: "REQUIRED — the plain-language verdict: what was credited, where it broke. On a wrong answer: localize the break, do NOT give the correction.",
	}),
	rung: Type.Union(
		[Type.Literal("R0"), Type.Literal("R1"), Type.Literal("R2"), Type.Literal("R3"), Type.Literal("R4"), Type.Literal("R5"), Type.Null()],
		{ description: "REQUIRED — the hint-ladder rung the problem needed: R0 through R5, or null = no hint was given (bare, no quotes)." },
	),
	missClass: Type.Union(
		[
			Type.Literal("cue"),
			Type.Literal("discrimination"),
			Type.Literal("execution"),
			Type.Literal("careless"),
			Type.Literal("structural"),
			Type.Null(),
		],
		{ description: "REQUIRED — the miss classification: cue, discrimination, execution, careless, or structural — or null = no miss (bare, no quotes)." },
	),
	retest: Type.Boolean({ description: "REQUIRED — true marks the problem for a fresh-surface retest before the session ends." }),
});

export type ConcludeInput = Static<typeof concludeInputObject>;

export function concludeTool(gate: PracticeGate): AgentTool<typeof concludeInputObject> {
	return {
		name: "conclude",
		label: "conclude",
		description:
			"Conclude the active problem: records the outcome + verdict, reveals the committed solution, and frees " +
			"the learner's composer. After the result, say your closing words about the learner's work if useful, then " +
			"END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's " +
			"explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, " +
			"answer their questions about the concluded one. Nothing may conclude unless a problem is active.",
		parameters: concludeInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, concludeInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, _input) => {
			if (!gate.problemActive) {
				return invalidInputResult("conclude", ["no active problem to conclude — pose one first"]);
			}
			gate.problemActive = false;
			return concludeResult();
		},
	};
}

/** El conjunto de herramientas de práctica (todo el registro del agente de práctica). */
export function practiceTools(ctx: PracticeToolContext, gate: PracticeGate = createPracticeGate(ctx)): Record<string, AgentTool<any>> {
	// UNA barrera por turno, compartida por los planteamientos nativos/de plugins y conclude.
	// EL CONJUNTO QUE RARA VEZ HACE FALTA (ronda 10 del responsable): read/ls/find/grep sobre los
	// ficheros del alumno (siempre: el mismo conjunto de solo lectura que llevan el profesor y el
	// sondeador), las tareas research + pdf (disponibles sin claves de
	// búsqueda; demo/visual siguen siendo solo de enseñanza), y
	// los lectores del mapa del sondeador cuando la barrera de ajustes se abrió. Ninguna se
	// filtra por interruptores: problem/conclude son la sesión; estas son
	// excepciones a las que la doctrina dice que se recurra rara vez.
	const jobs = ctx.jobs ? jobTools(ctx.jobs) : null;
	// healToolRecord (responsable, 2026-10-09: la generalización de whitehead):
	// la reparación estándar de argumentos sobre TODO el registro. problem/conclude
	// conservan su propio prepareArguments (que normaliza objetivos) como pasada interna
	// compuesta; la doble reparación es idempotente por construcción.
	return healToolRecord({
		problem: problemTool(gate, ctx.graphNodes),
		conclude: concludeTool(gate),
		read: readTool,
		ls: lsTool,
		find: findTool,
		grep: grepTool,
		...(jobs?.research ? { research: jobs.research } : {}),
		...(jobs ? { pdf: jobs.pdf! } : {}),
		...(ctx.graph ? proberGraphTools(ctx.graph) : {}),
	});
}
