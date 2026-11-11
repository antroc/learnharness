import * as crypto from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "typebox";
import { toToolResult } from "../tool-execute.ts";
import type { ModelRole } from "../../../config.ts";
import {
	FACTORY_SETTINGS,
	ModelsNotConfiguredError,
	ProviderKeyMissingError,
	ROLE_SLOT,
	type ModelSlotName,
	type ProviderKeyMissing,
} from "../../core/settings.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import type {
	AuditVerdicts,
	CallUsage,
	ChatRecord,
	ExtractionRunUsage,
	ExtractionStageUsage,
	SessionFindings,
} from "../../core/contracts.ts";
import { getGraph, mergeFindings, type DerivedGraph, type EmissionStats, type GraphDeps } from "../../core/graph.ts";
import type { GraphStore } from "../../core/ports.ts";
import { emit } from "../../core/events.ts";
import { settleGraphLayout } from "../../core/layout-settle.ts";
import { batchRuns, coverageOf, messageViewLines } from "../../core/coverage.ts";
import { failedOutputCallIds, type LhMessage } from "../../core/native-messages.ts";
import { prepareAuditorReview } from "../tools/graph.ts";
import { runSubmitAgent, healStringifiedArrays } from "./submit-agent.ts";

/**
 * La canalización de extracción (visión §1, construcción, rediseño del 2026-09-02;
 * reenlazada el 2026-09-27): el único escritor del grafo. Tres etapas, un
 * orquestador (la etapa de espina dorsal vino y se fue, 2026-09-30: la extracción
 * serializada y consciente del resumen la sustituyó; la prueba en vivo del responsable mostró que
 * la pasada de montaje a posteriori añadía complejidad sin una ganancia
 * perceptible; ahora el propio extractor es el montador):
 *
 *   extractor (LLM)  la ÚNICA etapa que ve la fuente cruda (una sesión
 *                    renderizada como la prosa del profesor, con cada pasaje
 *                    etiquetado con su id de mensaje REAL, "TEACHER [id]",
 *                    responsable 2026-10-13, o un fichero de notas literal, recorrido
 *                    por tramos) → envía las ideas centrales NUEVAS + las cadenas
 *                    de razonamiento (rediseño del responsable, 2026-09-30); un envío
 *                    de sesión lleva además el messageId de cada proposición:
 *                    el ancla que el fusionador estampa en la procedencia con
 *                    granularidad de mensaje del nodo (2026-10-13).
 *                    CONSCIENTE DEL RESUMEN (2026-09-30 por la tarde):
 *                    cuando la fuente ya ha dado material, el
 *                    prompt lleva EL GRAFO HASTA AHORA (las proposiciones
 *                    + cadenas de esa fuente, con los ids literales) y el
 *                    extractor construye sobre él: hace referencia a los ids existentes
 *                    en lugar de repetirlos, apoyándose en las conclusiones
 *                    establecidas como premisas. Los tramos de una misma fuente
 *                    se ejecutan EN SERIE (cada extracción lee todas las fusiones
 *                    anteriores); ciego al árbol, de CONFIANZA PLENA: nada
 *                    aguas abajo lo vuelve a comprobar.
 *   auditor (LLM)    nunca ve la fuente. Su trabajo es la IDENTIDAD: para cada
 *                    proposición NUEVA, linkTo a un nodo existente del grafo o
 *                    crear, decidido EXPLORANDO el grafo con
 *                    herramientas (find / list_sessions / list_propositions),
 *                    no mediante un volcado del grafo inyectado (hinchazón del contexto,
 *                    responsable 2026-09-27). Los enlaces son lo ÚNICO que entrega:
 *                    nunca acuña aristas (responsable 2026-09-28: el
 *                    grafo se conecta entre fuentes únicamente a través de
 *                    equivalencias identificadas). La entrada son SOLO
 *                    PROPOSICIONES, nunca cadenas (responsable 2026-09-30).
 *   merger (core)    mergeFindings() → anexados deterministas a los registros +
 *                    simplificación de cadenas (2026-09-30 por la tarde: la
 *                    pasada de cobertura por ascendencia / preferir menos premisas que
 *                    elimina las derivaciones redundantes: core/graph.ts)
 *
 * El registro de eventos HA DESAPARECIDO (2026-09-27): los resultados de los quiz y las
 * observaciones de comprensión ya no se formalizan en el grafo: el grafo son solo
 * cadenas de razonamiento extraídas (nodos + aristas).
 *
 * El extractor es un worker de una sola llamada a herramienta (una llamada de envío validada con
 * TypeBox; es un agente de pi solo para que el modelo pueda reintentar una llamada que no cumple el esquema).
 * El auditor es un pequeño bucle AGÉNTICO: herramientas de exploración más un envío.
 *
 * Se crea con createExtractionPipeline(deps): la raíz de composición
 * (chat-handler) inyecta los puertos de almacenamiento + los modelos; este módulo nunca
 * importa un adaptador. runExtraction es de un solo vuelo por chat: un segundo
 * disparo mientras hay una ejecución en curso no hace nada (el siguiente disparo recoge
 * lo que se le escapara a la ejecución en curso). Si falla no se guarda ningún punto de control:
 * el siguiente disparo vuelve a ejecutarlo todo.
 *
 * La PUERTA DE ENTRADA AGNÓSTICA AL FORMATO (2026-09-13): importNotes() ejecuta las MISMAS
 * tres etapas sobre notas personales crudas (formato arbitrario: sin chat, sin
 * sesión, sin ids de mensaje). Un prompt de extractor en modo notas sustituye al
 * de sesión; el auditor y el fusionador se comparten (la identidad + los anexados
 * deterministas no se preocupan de dónde viene el texto). La procedencia es el propio fichero:
 * los ids de fuente ("src_" + hash de la ruta) hacen el papel de chatId en las correspondencias y
 * los puntos de control, y el registro de la fuente (frontera sources de graphStore) lleva
 * la ruta del fichero + el uso de la ejecución.
 *
 * Observabilidad (base de §5): cada etapa registra una línea por paso, su
 * inicio y su duración; la canalización registra una línea de fallo antes de
 * volver a lanzar, así que el log del servidor se lee inicio → tiempos por etapa → estadísticas
 * de la fusión (o fallo) en cada ejecución.
 */

// ─── la vista de la fuente (lo que ve el extractor) ─────────────────────────────

/**
 * La vista de extracción: la sesión como SOLO PROSA DEL PROFESOR (decisión del responsable,
 * 2026-09-28: sustituye la vista markdown de la sesión entera del 2026-09-27),
 * con cada pasaje etiquetado con su id de mensaje real (2026-10-13). El
 * motor de markdown compartido (core/session-markdown.ts) conserva el formato completo de la sesión
 * para la futura exportación de cara al usuario; el extractor ya no lo
 * usa.
 */

/** La vista del registro entero (la usan los llamadores que renderizan una sesión completa;
 *  la canalización en sí trabaja por lotes). SOLO PROSA DEL PROFESOR (responsable, 2026-09-28),
 *  con los pasajes etiquetados con sus ids de mensaje (2026-10-13).
 */
export function transcriptView(record: ChatRecord): string {
	return proseView(record.messages, record.title);
}

/** La vista de extracción según la decisión de la prosa del profesor (responsable, 2026-09-28):
 *  SOLO la prosa del profesor de cara al alumno (texto o send_to_user): sin mensajes
 *  del alumno, razonamiento, otras llamadas/resultados de herramientas ni bloques de quiz, etiquetada con
 *  su id de mensaje REAL (responsable, 2026-10-13): las líneas de la vista SON las
 *  messageViewLines de core/coverage.ts ("TEACHER [id] text"), las líneas exactas
 *  cuyo hash calculan las huellas de cobertura, para que el extractor pueda anclar
 *  cada proposición al pasaje del que salió (el messageId obligatorio del
 *  envío de sesión). El motor de markdown compartido se reserva para la
 *  futura exportación de cara al usuario. */
function proseView(
	messages: ReadonlyArray<LhMessage>,
	title?: string,
	failedOutputCalls: ReadonlySet<string> = failedOutputCallIds(messages),
): string {
	const lines = messages.flatMap((message) => messageViewLines(message, message.id, failedOutputCalls));
	const head = title && title.length > 0 ? `# ${title}\n\n` : "";
	return head + lines.join("\n\n");
}

// ─── el extractor ───────────────────────────────────────────────────────────────

const propositionProps = {
	id: Type.String({ description: 'Local id: "p1", "p2", … — referenced by chains in this call.' }),
	name: Type.String({
		description:
			"A very short label — established terminology, the term the discipline itself uses, a glossary " +
			"headword a textbook would print ('Will to power', 'Divine command theory'). Not a sentence, " +
			"needn't be unique or self-contained: this becomes the node's global label in the graph.",
	}),
	statement: Type.String({
		description:
			"One true, self-contained, world-facing core idea at full precision. Never about the " +
			'learner, the teacher, or the reading: not "the learner understands X" but "X". A misconception ' +
			"enters as its TRUE correction.",
	}),
	aliases: Type.Optional(
		Type.Array(Type.String(), {
			description: "Verbatim phrasings the source used for the same proposition, if any.",
		}),
	),
};

// El rediseño del extractor (responsable, 2026-09-30): el extractor envía
// CADENAS DE RAZONAMIENTO (premisas + conclusión) que se guardan TAL CUAL (cadenas como fuente primaria,
// esa misma tarde: chains.jsonl es la verdad; las aristas son una vista derivada, y
// las aristas supports se retiran por completo).
const endpoint = (role: string) =>
	Type.String({
		description:
			`The id this ${role} — EITHER an existing graph idea id from THE GRAPH SO FAR in the prompt, ` +
			'verbatim ("n_…"), OR the local id of a proposition in this submission ("p1", …).',
	});

const chainSchema = Type.Object({
	premises: Type.Array(endpoint("premise uses"), {
		minItems: 1,
		description:
			"Premise ids used TOGETHER: they jointly entail the conclusion; independent reasons are separate chains.",
	}),
	conclusion: endpoint("conclusion is"),
});

// Tolerancia con los modelos débiles (responsable, 2026-09-25): el antiguo `.default([])` /
// `.default({ quiz: {} })` de zod en campos obligatorios pero vacíos pasa a ser Type.Optional
// aquí + un relleno con ?? en la frontera de envío (fillFindings/fillAudit, más abajo): el mismo
// contrato en la red (se tolera la omisión, vacío nunca significa «no válido»),
// sin zod en la banda del agente.
const propositionsDescription =
	"Only the NEW core ideas this stretch contributes — ideas the prompt's THE GRAPH SO FAR already " +
	"holds are referenced by id in chains, never restated here.";
const chainsDescription =
	"Every argument this stretch makes — including arguments that join new ideas to established " +
	"ones; conclusions reusable by id as premises of later chains; bare ideas (no argument) ride " +
	"the propositions list alone; pass [] when none — never omit the field.";

const findingsSchema = Type.Object({
	propositions: Type.Array(Type.Object(propositionProps), {
		description: propositionsDescription,
	}),
	chains: Type.Array(chainSchema, {
		description: chainsDescription,
	}),
});

// LA EXTENSIÓN DE SESIÓN (responsable, 2026-10-13): toda proposición de sesión
// lleva un messageId OBLIGATORIO: el ancla del pasaje del que salió,
// copiado de la etiqueta "TEACHER [id]" de la vista (validado en la frontera de envío
// contra el lote ACTUAL). La puerta de NOTAS no tiene mensajes: su
// esquema se queda con la forma base de arriba, prompt y red sin cambios.
const sessionPropositionProps = {
	...propositionProps,
	messageId: Type.String({
		description:
			"The message id of the ONE passage in this stretch that most directly states or explains this " +
			'proposition — copy it EXACTLY from that passage\'s "TEACHER [id]" label.',
	}),
};

const sessionFindingsSchema = Type.Object({
	propositions: Type.Array(Type.Object(sessionPropositionProps), {
		description: propositionsDescription,
	}),
	chains: Type.Array(chainSchema, {
		description: chainsDescription,
	}),
});

/** Lo que ENVÍA el extractor (la forma en la red del rediseño): proposiciones
 *  + cadenas. fillFindings la normaliza; validateFindingsChains comprueba
 *  las leyes de las cadenas; asSessionFindings la eleva directamente a
 *  SessionFindings: las cadenas se guardan TAL CUAL (cadenas como fuente primaria, responsable
 *  2026-09-30: sin traducción a aristas en ninguna frontera). */
type FindingsSubmit = Static<typeof findingsSchema>;

/** La red de SESIÓN: la forma de notas más el ancla messageId OBLIGATORIA
 *  en cada proposición (responsable, 2026-10-13). */
type SessionFindingsSubmit = Static<typeof sessionFindingsSchema>;

// SOLO VEREDICTOS (responsable, 2026-09-28): el auditor nunca altera los
// hallazgos del extractor, así que no los repite: los enlaces son TODO
// lo que entrega (responsable, 2026-09-28 por la tarde: el argumento de aristas HA
// DESAPARECIDO; el auditor nunca acuña aristas. El grafo se conecta entre fuentes
// únicamente a través de equivalencias identificadas: un enlace, nunca una inferencia).
const auditSchema = Type.Object({
	links: Type.Array(
		Type.Object({
			id: Type.String({ description: 'The proposition id from the findings ("p1", …).' }),
			linkTo: Type.String({
				description:
					"The id of the EXISTING graph node this proposition IS — your identity verdict. EQUIVALENCE BIAS (2026-09-27): paraphrases, rewordings, and compressions of the same claim MERGE; only genuinely distinct propositions stay apart.",
			}),
		}),
		{ description: "Identity verdicts — which findings propositions ARE existing graph nodes. A proposition absent from here = create a new node. Pass [] when none — never omit the field." },
	),
});

// La forma en la red de la puerta de notas es la forma de sesión MENOS el
// ancla messageId (responsable, 2026-10-13: solo la puerta de SESIÓN exige
// anclas de pasaje; las notas no tienen mensajes, así que su prompt y su esquema
// se quedan exactamente como estaban): un único tipo base de hallazgos para ambas puertas,
// con el ancla como campo opcional.
type NotesFindings = SessionFindings;
type NotesAuditResult = AuditVerdicts;

// ── la frontera de envío (responsable, 2026-09-28; rediseñada el 2026-09-30) ──
//
// Todo campo de nivel superior de cada herramienta de envío es OBLIGATORIO: una carga útil
// a la que le falten `chains` (hallazgos) o `links` (revisión) falla la validación
// en lugar de fusionarse en silencio sin estructura (el agujero del reintento degradado:
// el primer intento truncado del modelo fallaba la validación y luego el reintento
// pasaba solo con proposiciones, con los campos opcionales rellenados con [] mediante ??, fusionando
// un montón de nodos sin estructura). Solo los alias de cada elemento siguen siendo
// opcionales con relleno ??.

function fillFindings<T extends { propositions: Array<{ aliases?: string[] }>; chains: unknown }>(
	raw: T,
): T {
	return {
		...raw,
		propositions: raw.propositions.map((p) => ({ ...p, aliases: p.aliases ?? [] })),
	};
}

/** El relleno de notas: el relleno ?? compartido de alias MÁS el límite de la puerta: un
 *  messageId suelto (el esquema de notas no tiene ninguno; las propiedades extra pasan
 *  la validación del esquema) se elimina para que la procedencia de las notas siga a nivel de chat
 *  (el fichero es el ancla, responsable 2026-09-13). */
function fillNotesFindings(raw: FindingsSubmit): FindingsSubmit {
	return fillFindings({
		...raw,
		propositions: raw.propositions.map((p) => {
			const stripped = { ...p } as typeof p & { messageId?: unknown };
			delete stripped.messageId;
			return stripped;
		}),
	});
}

/** Las leyes de las cadenas (rediseño del extractor, 2026-09-30; consciente del resumen
 *  2026-09-30 por la tarde): el canal RUIDOSO: runSubmitAgent convierte un
 *  string de problema en un resultado de herramienta de error y el modelo vuelve a enviar
 *  dentro de sus turnos. El ESPACIO DE NOMBRES MIXTO: un
 *  extremo se resuelve cuando es un id de proposición enviado O un id de nodo
 *  existente del grafo (el extractor continúa una fuente extraída en parte
 *  y hace referencia literal a los ids del resumen). Las cadenas idénticas (conjunto de premisas,
 *  conclusión) NO son errores: se deduplican en silencio en la
 *  fusión (chainKey): repetir un argumento no hace nada. */
function validateFindingsChains(value: FindingsSubmit, existingIds: ReadonlySet<string>): string | null {
	const ids = new Set(value.propositions.map((p) => p.id));
	for (const chain of value.chains) {
		if (chain.premises.length === 0) {
			return "chains: premises must name at least one proposition — a proposition with no argument stays in the propositions list alone.";
		}
		const unknown = [...chain.premises, chain.conclusion].find((id) => !ids.has(id) && !existingIds.has(id));
		if (unknown !== undefined) {
			return `chains: "${unknown}" is neither a submitted proposition id nor an existing idea id from THE GRAPH SO FAR — every premise and conclusion must resolve.`;
		}
		if (chain.premises.includes(chain.conclusion)) {
			return "chains: a conclusion cannot be its own premise.";
		}
	}
	return null;
}

/** La ley del ancla de SESIÓN (responsable, 2026-10-13): toda proposición nombra un
 *  pasaje del lote ACTUAL: no vacío, y un id de mensaje de prosa del profesor
 *  presente en el tramo que está leyendo este extractor (los mismos ids que
 *  llevan las etiquetas TEACHER [id] de la vista). Las anclas rechazadas van por el canal
 *  existente de devolución de errores: sin fusión ni punto de control de cobertura hasta que llegue
 *  un envío válido. El límite es estricto a propósito: un id de un lote POSTERIOR
 *  o ya cubierto, de otro chat o de un mensaje del alumno/de herramienta se
 *  rechaza aunque sea un id de mensaje real de este chat. */
function validateSessionAnchors(value: SessionFindingsSubmit, batchIds: ReadonlySet<string>): string | null {
	for (const p of value.propositions) {
		if (p.messageId.trim().length === 0) {
			return `propositions: "${p.id}" is missing its messageId — copy the message id from the brackets of the passage (TEACHER [id]) that most directly states or explains it.`;
		}
		if (!batchIds.has(p.messageId)) {
			return `propositions: "${p.id}" names messageId "${p.messageId}", which is not a passage of THIS stretch — copy the id from the brackets of one of this stretch's own TEACHER [id] passages.`;
		}
	}
	return null;
}

/** (cadenas como fuente primaria, responsable 2026-09-30) la red ES ahora la forma de la
 *  canalización: proposiciones + cadenas, sin traducción: los stores guardan las
 *  cadenas y la vista derivada de aristas se recalcula al leer. El relleno
 *  ya se ejecutó dentro de runSubmitAgent; esto solo reafirma el
 *  tipo con los alias rellenos (y conserva el ancla messageId del envío de sesión,
 *  2026-10-13: ambas puertas se elevan por aquí). */
const asSessionFindings = (
	raw: {
		propositions: Array<{ id: string; name: string; statement: string; aliases?: string[]; messageId?: string }>;
		chains: Array<{ premises: string[]; conclusion: string }>;
	},
): SessionFindings => ({
	propositions: raw.propositions.map((p) => ({ ...p, aliases: p.aliases ?? [] })),
	chains: raw.chains,
});

function fillAudit(raw: Static<typeof auditSchema>): AuditVerdicts {
	return {
		links: raw.links,
	};
}

// ── el prompt de sistema del extractor (rediseño del responsable, 2026-09-30) ──
//
// PRIMERO EL OBJETIVO, SIN ARMADURA DE REGLAS: las listas defensivas de la antigua doctrina (listas
// de DESCARTE, fusiona-tu-propia-salida, muros de nombres, en-caso-de-duda-omite, el
// párrafo de fidelidad) se CORTAN TODAS: el prompt enuncia el objetivo y
// la mecánica del envío; las descripciones de los campos de la herramienta llevan los
// detalles. Un núcleo compartido + dos contextualizaciones, montados aquí:
// sesión y notas comparten el núcleo por construcción. (La antigua apertura
// que describía los bloques Quiz/Recall-check/Question estaba obsoleta desde la
// decisión de la prosa del profesor del 2026-09-28 y simplemente se omite).

/** La instrucción de anclaje solo de sesión (responsable, 2026-10-13, literal):
 *  los pasajes llegan etiquetados "TEACHER [id]" y toda proposición debe
 *  nombrar el ÚNICO pasaje del que salió: el ancla que el fusionador estampa
 *  en la procedencia con granularidad de mensaje. Las notas no tienen pasajes: su
 *  contextualización queda intacta. */
export const SESSION_MESSAGE_ID_RULE =
	"For each new proposition, copy the message ID of the passage that most directly states or explains it into messageId.";

export const SESSION_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — a teaching " +
	"session, rendered as the teacher's prose in reading order — and report what it teaches as findings " +
	"for the learner's global knowledge graph, building on everything already extracted from this source.";

export const NOTES_PREAMBLE =
	"You are the extraction stage of a learning application. You read one stretch of a source — the " +
	"author's personal notes, rendered in reading order — and report what it teaches as findings for the " +
	"learner's global knowledge graph, building on everything already extracted from this source.";

// Contratos de grafo/salida agnósticos a la fuente. Se mantienen como secciones separadas para
// que cada puerta de entrada pueda tener su propio objetivo y criterios de selección sin cambiar el
// orden ni la redacción de ninguno de los dos prompts montados.
export const EXTRACTION_CORE = {
	entailment: `Each chain is premises that JOINTLY entail a conclusion. Entailment is the only link that earns a
chain — where the real connection is historical or narrative (who argued what, how a debate or
exposition unfolds), there is no chain; keep the pieces as bare ideas or drop them. The direction of
the graph is upward: foundational ideas at the bottom, derived ideas above them, each chain showing
how its conclusion follows from what is more established — do not submit connections that carry no
derivation.`,
	knowledge: `The graph holds TRUE ideas about the world, nothing else — never anything about the learner, the
teacher, or this reading: not "the learner understands X" but X. A misconception enters as its TRUE
correction. Each statement is one self-contained idea at full precision.`,
	standalone: `Every idea must stand
alone for a reader who never saw this source: names and statements may not lean on the source's own
scaffolding (claim numbering, axiom tags, arc labels); a claim that only matters as part of how this
document is organized is not knowledge — drop it.`,
	continuation: `When the prompt carries THE GRAPH SO FAR, you are continuing a source already partly extracted: build
on it. Reference an existing idea by its id ("n_…") instead of restating it, and prefer chains that
lean on established conclusions as premises — derive new material from what is already derived. Do
not re-derive a conclusion the graph already holds unless the route is genuinely different.`,
	submission: `SUBMIT with one submit_findings call: every NEW core idea with a short name and a precise statement,
and every chain as premises + conclusion. A chain's premises and conclusion may be ids from this
submission OR existing ids from THE GRAPH SO FAR, verbatim. Premises within one chain are used
TOGETHER — independent arguments for the same conclusion are separate chains. A conclusion may
reappear, by id, as a premise of later chains. A bare idea that no argument uses rides the
propositions list alone. Include every field even when empty — "chains": [] when the source makes no
arguments. The tool's field descriptions carry the details.`,
} as const;

function composeExtractionInstructions(preamble: string, goal: string, selection: string): string {
	return `${preamble}\n\n${goal}\n${EXTRACTION_CORE.entailment}\n\n${EXTRACTION_CORE.knowledge}\n\n${selection} ${EXTRACTION_CORE.standalone}\n\n${EXTRACTION_CORE.continuation}\n\n${EXTRACTION_CORE.submission}`;
}

// Cada puerta de entrada tiene su propio objetivo y su redacción de selección, independientes de los
// contratos compartidos: las notas no tienen por qué ser una lección completa guiada por argumentos.
export const EXTRACTOR_INSTRUCTIONS = `${composeExtractionInstructions(
	SESSION_PREAMBLE,
	`THE GOAL: uncover the source's CORE IDEAS and show how everything derives from the foundations. The
source teaches by arguing — ideas worked out from other ideas, down to a foundation the rest stands on.
Your deliverable is twofold: the core ideas themselves, and the chains of reasoning that derive them.`,
	`Extract the load-bearing ideas of the subject — what a reference on it would teach — not the full run
of the discourse. An idea earns its place only when the source's arguments run through it — examples,
notation glosses, and restatements that no argument needs are not core ideas.`,
)}\n\n${SESSION_MESSAGE_ID_RULE}`;

export const NOTES_EXTRACTOR_INSTRUCTIONS = composeExtractionInstructions(
	NOTES_PREAMBLE,
	`THE GOAL: bring the knowledge in these notes into the learner’s knowledge graph. Notes may contain
definitions, formulas, facts, arguments, or outlines without forming a complete lesson. Report the
substantive ideas and the reasoning the notes support. A useful representation of this material is
the deliverable, not a reconstruction of the subject from its foundations.`,
	`Keep the meaningful definitions, formulas, claims, and explanations, including ideas that have no
derivation. Use chains for reasoning the notes give, including direct inferences from their stated
relationships. A sketch need not spell out every intermediate step, but a topic outline or component
dependency alone is not a derivation. Where the notes just state an idea, record it as a proposition
rather than constructing an argument for it. Select enough detail to preserve the knowledge, without
expanding the note into a full treatment of the subject.`,
);

// ── el resumen de la misma fuente (responsable, 2026-09-30 por la tarde) ──
//
// La extracción serializada y consciente del resumen SUSTITUYÓ a la etapa de espina dorsal (decisión
// del responsable tras la prueba en vivo: la pasada de montaje a posteriori añadía
// complejidad sin ganancia perceptible: el propio extractor es el
// montador cuando puede ver lo que su fuente ya ha dado). Un pliegue puro
// de strings sobre el grafo derivado; "" cuando la fuente aún no tiene nada
// (el primer tramo se ejecuta desnudo). Los ids van LITERALES: es a lo que
// hace referencia el extractor en sus cadenas (la resolución de espacio de nombres
// mixto del fusionador los deja pasar).
export function sourceDigest(graph: DerivedGraph, sourceId: string): string {
	const nameOf = new Map(graph.nodes.map((n) => [n.id, n.name]));
	const ours = graph.nodes.filter((n) => n.provenance.some((pt) => pt.chatId === sourceId));
	const ourChains = graph.chains.filter((c) => c.provenance.some((pt) => pt.chatId === sourceId));
	if (ours.length === 0 && ourChains.length === 0) return "";
	const lines: string[] = [];
	lines.push("THE GRAPH SO FAR — everything already extracted from this source (reference these ids verbatim):");
	for (const n of ours) lines.push(`  ${n.id} | ${n.name} | ${n.statement.replace(/\s+/g, " ")}`);
	if (ourChains.length > 0) {
		lines.push("DERIVATIONS ALREADY RECORDED (build on these; do not re-derive them):");
		for (const c of ourChains) {
			const names = c.premises.map((p) => nameOf.get(p) ?? p).join(" ∧ ");
			lines.push(`  [${c.premises.join(" + ")} ⇒ ${c.conclusion}]  ${names} ⇒ ${nameOf.get(c.conclusion) ?? c.conclusion}`);
		}
	}
	return lines.join("\n");
}

/** El extractor sobre UN transcript de sesión (la puerta de entrada de chats).
 *  `batchIds` (los ids de mensaje de prosa del profesor del lote ACTUAL) es el
 *  límite de anclaje: el messageId de toda proposición enviada debe nombrar
 *  uno de ellos (validateSessionAnchors en la frontera de envío). */
function runExtractor(
	engine: PiEngine | undefined,
	sourceId: string,
	prompt: string,
	existingIds: ReadonlySet<string>,
	batchIds: ReadonlySet<string>,
	signal: AbortSignal | undefined,
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void,
): Promise<SessionFindings> {
	// Cadenas que entran (la red), cadenas que salen (el store): sin frontera de traducción
	// desde las cadenas como fuente primaria. La validación se ejecuta en la frontera de envío (devolución de errores)
	// sobre el espacio de nombres MIXTO: ids locales + ids existentes del grafo, más la
	// ley del ancla de sesión (messageId ∈ el lote actual, 2026-10-13).
	return runSubmitAgent<SessionFindingsSubmit>({
		role: "extractor",
		// Clave del grabador de depuración: el id de la fuente (la clave de registro de la ejecución: el
		// chatId del chat en las ejecuciones de chat, el id src en las de notas).
		chatId: sourceId,
		toolName: "submit_findings",
		toolDescription: "Submit the session findings.",
		parameters: sessionFindingsSchema,
		fill: fillFindings,
		validate: (value) => validateSessionAnchors(value, batchIds) ?? validateFindingsChains(value, existingIds),
		systemPrompt: EXTRACTOR_INSTRUCTIONS,
		prompt,
		engine,
		signal,
		onStep,
		neverSubmitted: "the extractor never submitted findings",
		prepareArguments: healStringifiedArrays,
	}).then(asSessionFindings);
}

/** El extractor sobre UNA fuente de notas personales crudas (la puerta de entrada
 *  agnóstica al formato): la misma forma de envío único, prompt + esquema en modo notas:
 *  la red BASE (sin messageId: las notas no tienen pasajes, y uno suelto
 *  se elimina en la frontera de relleno). */
function runNotesExtractor(
	engine: PiEngine | undefined,
	sourceId: string,
	prompt: string,
	existingIds: ReadonlySet<string>,
	signal: AbortSignal | undefined,
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void,
): Promise<NotesFindings> {
	return runSubmitAgent<FindingsSubmit>({
		role: "extractor",
		// Clave del grabador de depuración: el id de fuente de las notas (la clave de registro).
		chatId: sourceId,
		toolName: "submit_findings",
		toolDescription: "Submit the notes findings.",
		parameters: findingsSchema,
		fill: fillNotesFindings,
		validate: (value) => validateFindingsChains(value, existingIds),
		systemPrompt: NOTES_EXTRACTOR_INSTRUCTIONS,
		prompt,
		engine,
		signal,
		onStep,
		neverSubmitted: "the extractor never submitted findings",
		prepareArguments: healStringifiedArrays,
	}).then(asSessionFindings);
}

// ─── el auditor ─────────────────────────────────────────────────────────────────


const AUDITOR_INSTRUCTIONS = `You reconcile newly extracted knowledge with existing graph records. The extractor has
already read the source and supplied its findings. Your task is to identify useful matches, not verify the source.

REVIEW THE PROVIDED RECORDS:
Your input already contains five ranked candidates per finding (or fewer when fewer exist). matches associates
finding ids with candidateIds; candidates contains each record once. For each finding, decide whether its main
knowledge point is already represented by one of these records. Link useful paraphrases, compressions and different
explanations of that same knowledge point. Otherwise leave the finding new. Shared subject matter alone is not a match.

A record's statement AND its matched aliases are accepted knowledge already in the graph. Use either as evidence
of what it represents; its name is just a label. If an accepted alias already states the incoming knowledge point,
recognize that match rather than reconsidering why the alias was grouped there. You are not redesigning earlier
nodes or finding the ideal granularity. Make a practical judgment, not a proof of exact logical equivalence.

After reviewing the candidates, an unmatched finding can remain new. You do not need to establish that no equivalent
exists anywhere in the graph. Additional tools are for a specific missing candidate or a named, promising source,
not for confirming every negative judgment. A fresh find_candidates search can add alternative wording; nextCursor
continues its fixed query. Once a finding is decided, revisit it only if another lookup actually supplies new evidence.

Complete this task by CALLING the submit_review TOOL with its links argument. A text message, including JSON
printed as text, does not submit a review. Each link supplies the finding's id and the existing record's id as linkTo.
Include only useful matches to existing records you have seen. Omitted findings become new nodes; use "links": []
when none match. Do not restate findings, invent relations, or justify verdicts in the output. The merger retains the
existing record's name and statement and adds the incoming wording as an alias with its provenance.`;

/** El auditor: ahora una sola forma para ambas puertas de entrada (el esquema de notas era
 *  idéntico desde que murió la atribución). Un bucle agéntico: herramientas de exploración
 *  del grafo más la única llamada de envío. */
function runAuditor(
	engine: PiEngine | undefined,
	sourceId: string,
	prompt: string,
	signal: AbortSignal | undefined,
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void,
	tools: Record<string, AgentTool<any>>,
): Promise<AuditVerdicts> {
	return runSubmitAgent({
		role: "auditor",
		// Clave del grabador de depuración: el mismo id de fuente que la ejecución del extractor.
		chatId: sourceId,
		toolName: "submit_review",
		toolDescription: "Submit the identity verdicts ONLY (links) — never the propositions themselves.",
		parameters: auditSchema,
		fill: fillAudit,
		systemPrompt: AUDITOR_INSTRUCTIONS,
		prompt,
		engine,
		signal,
		onStep,
		neverSubmitted: "the auditor never submitted a review",
		extraTools: tools,
		maxTurns: 16,
		prepareArguments: healStringifiedArrays,
	});
}

// ─── el registro de estado de la canalización ─────────────────────────────────────

/** Las fases de la canalización, en orden: lo que muestra el endpoint de estado de inicio.
 *  La cola de embeddings tras el lote era su propia fase (oleada de precisión,
 *  2026-09-19) hasta que la oleada 7 eliminó por completo la frontera del generador de embeddings (este
 *  interludio): los clústeres por sesión de nacimiento no necesitan ninguna pasada tras la fusión. Las
 *  fases dicen la verdad sobre a qué está esperando realmente la tarea.
 *  La admisión de peticiones de worker ocurre dentro del stream del modelo; la antigua
 *  fase "queued" de toda la extracción se conserva solo por compatibilidad de tipos.
 *  "waiting" (responsable 2026-09-28): la barrera de auditoría serializada: la sección
 *  crítica de auditoría+fusión de la tarea está en cola detrás de la de otra tarea; el
 *  extractor ha terminado pero el auditor no puede empezar hasta que el grafo esté
 *  estable. */
export type ExtractionPhase = "queued" | "extracting" | "waiting" | "auditing" | "merging";

/** Una ejecución de la canalización en curso. A nivel de módulo: un proceso, un registro.
 *  Exportado para el tipado del consumidor de la carga útil de estado (el dock). */
export interface RunningExtraction {
	/** El id de la FUENTE (id de chat / id src de notas): la identidad de la carga útil y
	 *  la clave del aborto. La CLAVE del registro añade "#i" para las tareas por fragmento (una
	 *  fuente de varios fragmentos tiene varias entradas); este campo sigue siendo el
	 *  id de la fuente para que la lógica de revelado del feed y el aborto sigan con ámbito de fuente. */
	chatId: string;
	/** TAREAS POR FRAGMENTO (responsable, 2026-09-28): qué fragmento de cuántos es esta
	 *  tarea: presente solo cuando la fuente se desplegó en varias (n > 1). Controla
	 *  el sufijo "· i/N" de la fila del feed. */
	part?: { i: number; n: number };
	/** Por qué puerta de entrada llegó la ejecución: la etiqueta + la persistencia del uso
	 *  dependen de ello (los chats facturan en su registro de chat; las notas, en el registro
	 *  de la fuente). */
	kind: "chat" | "notes";
	/** Etiqueta para mostrar (la ruta del fichero en las importaciones de notas); la ruta de estado
	 *  recurre al store de chats en las ejecuciones de chat. */
	label?: string;
	phase: ExtractionPhase;
	startedAt: number;
	/** Uso por etapa en vivo, acumulado a medida que se facturan los pasos (las burbujas de coste /
	 *  ventana de contexto del dock lo leen a través de /api/graph/status). */
	usage: {
		extractor?: ExtractionStageUsage;
		auditor?: ExtractionStageUsage;
	};
	/** Manejador de cancelación real (el botón de aborto del dock): un controlador por
	 *  ejecución, compartido entre fases; abort() cancela la llamada al modelo en curso. */
	controller: AbortController;
}

interface LhExtractionGlobal {
	__lhExtractionRuns?: {
		/** Ejecuciones de la canalización en curso, indexadas por chatId (chat) / id src (notas). */
		running: Map<string, RunningExtraction>;
		/** La guarda de un solo vuelo, compartida por todas las instancias de la canalización. */
		inFlight: Set<string>;
		/** El último startedAt acuñado: se mantiene monótono para que dos ejecuciones que empiezan en el
		 *  mismo milisegundo nunca choquen en la clave de idempotencia del uso. */
		lastStartedAt: number;
	};
	/** El mutex de auditoría serializada (responsable 2026-09-28): una cadena de promesas
	 *  FIFO: la sección crítica de auditoría+fusión ejecuta una tarea cada vez,
	 *  en todo el proceso. En globalThis por el mismo motivo de instancias de módulo que
	 *  los registros de ejecuciones. */
	__lhAuditLock?: { tail: Promise<void> };
}

/** LOS REGISTROS DE EJECUCIONES viven en globalThis, no a nivel de módulo: la
 *  lección de turn-liveness: Next dev compila cada entrada de ruta como su propia
 *  instancia de módulo, así que un Map a nivel de módulo es un objeto distinto en la
 *  ruta /api/activity que en la instancia de chat-handler de la canalización:
 *  las rutas de estado leerían un registro siempre vacío. Un proceso,
 *  una verdad: el mismo patrón que los registros de turnos, despertares y abortos
 *  (trasladado el 2026-09-19, la oleada de precisión de la observabilidad; también hace que la
 *  guarda de un solo vuelo funcione entre instancias de ruta). */
function runs(): NonNullable<LhExtractionGlobal["__lhExtractionRuns"]> {
	const g = globalThis as typeof globalThis & LhExtractionGlobal;
	return (g.__lhExtractionRuns ??= { running: new Map(), inFlight: new Set(), lastStartedAt: 0 });
}

/** Ejecuciones de la canalización en curso (las más antiguas primero): la carga útil de /api/graph/status. */
export function extractionStatuses(): RunningExtraction[] {
	return [...runs().running.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Cancelación real de la ejecución en curso de un chat (el botón de aborto
 *  del dock): la llamada al modelo pendiente recibe la señal (el proveedor
 *  cancela la petición, el gasto se detiene) y la ejecución termina como un fallo:
 *  nada fusionado, ningún punto de control, el uso parcial sí se persiste.
 *  Devuelve false cuando no hay ninguna ejecución en curso (no hace nada, idempotente). */
export function abortExtraction(chatId: string): boolean {
	// TAREAS POR FRAGMENTO (responsable, 2026-09-28): una fuente puede tener varias
	// entradas en el registro (una por fragmento/lote): abortar la fuente aborta TODAS
	// las tareas de su despliegue.
	let found = false;
	for (const run of runs().running.values()) {
		if (run.chatId !== chatId) continue;
		run.controller.abort();
		found = true;
	}
	return found;
}
// ─── la canalización ────────────────────────────────────────────────────────────

export interface ExtractionModels {
	/** Punto de inyección para pruebas: un motor con guion por etapa, comprobado PRIMERO, antes de la
	 *  cadena engineFor (producción no conecta valores directos). */
	extractor?: PiEngine;
	auditor?: PiEngine;
	/** Motor resuelto desde los ajustes por rol: el mismo tratamiento de huecos que
	 *  recibió el ejecutor de tareas, leído DE NUEVO en cada llamada de etapa (un PUT de ajustes entre
	 *  etapas se aplica). BYOK (responsable, 2026-09-22): la cadena (sustitución del rol →
	 *  hueco → NADA) puede acabar VACÍA → undefined; las puertas de entrada se niegan
	 *  con ModelsNotConfiguredError antes de que se ejecute ninguna etapa. */
	engineFor?: (role: ModelRole) => PiEngine | undefined;
	/** Barrera de presencia de clave (interludio de las claves de proveedor, 2026-09-25): dado el
	 *  proveedor del motor de una etapa + el nivel de hueco del rol, la comprobación inyectada
	 *  devuelve el sobre de rechazo cuando falta la clave del proveedor
	 *  (null = ejecutar). La misma disciplina de inyección que la frontera del ejecutor de tareas
	 *  (la capa del agente no puede leer el almacén de claves); ausente en las pruebas que
	 *  inyectan motores directamente (los motores de prueba nunca deben una clave). Una etapa
	 *  sin clave se niega con ProviderKeyMissingError ANTES de que se ejecute ningún lote. */
	providerKeyMissing?: (provider: string, tier: ModelSlotName) => ProviderKeyMissing | null;
}

export interface ExtractionPipelineDeps extends GraphDeps, ExtractionModels {
	/** El presupuesto de fragmento: la parte de tokens del transcript en el contexto del
	 *  extractor; los lotes se llenan hasta él (el disparador salta con el mismo número,
	 *  leído de nuevo en cada turno por la raíz de composición). OPCIONAL con el
	 *  valor por defecto de la factoría (4096) para que los fixtures de prueba sigan siendo mínimos; los
	 *  llamadores del servidor conectan los ajustes efectivos en vivo (rediseño de la UX de extracción,
	 *  2026-09-24). */
	getChunkTokens?: () => number;
}

export interface NotesImportInput {
	/** La ruta del fichero de la fuente: su identidad (id src determinista) Y su
	 *  etiqueta de procedencia en la tarjeta de detalle. */
	filePath: string;
	/** El contenido crudo del fichero, LITERAL: cualquier formato. */
	text: string;
}

/** Una importación de notas no terminó. Las escrituras anteriores en el grafo y el uso facturado se
 * conservan; partialStats describe las fusiones conocidas, no un resultado de todo o nada. */
export class NotesImportError extends Error {
	constructor(
		public readonly outcome: "failed" | "partial" | "aborted" | "busy",
		public readonly partialStats: EmissionStats,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "NotesImportError";
	}
}

export interface ExtractionPipeline {
	/** Extraer + auditar + fusionar UN chat. Un solo vuelo por chat; se resuelve con
	 *  las estadísticas de anexado del fusionador (o lanza: sin punto de control si falla). */
	runExtraction(chatId: string): Promise<EmissionStats>;
	/** La puerta de entrada agnóstica al formato (2026-09-13): ejecuta la misma canalización
	 *  sobre UN fichero de notas crudas. El id de la fuente es determinista por ruta
	 *  del fichero, así que reimportar el mismo fichero vuelve a ejecutar la extracción contra la
	 *  misma identidad de fuente (las correspondencias se deduplican por ella). */
	importNotes(input: NotesImportInput): Promise<EmissionStats>;
}

/** El uso por paso de pi, aplanado a los campos persistidos de CallUsage
 *  (la forma de captura del canal del dinero, contracts/chat.ts). Exportado para
 *  el nombrador de clústeres: la misma forma de captura (oleada de métricas de coste del
 *  grafo de 2026-09). Ámbito de módulo: sin dependencias de cierre, proyección pura. */
export function callUsage(usage: Usage): CallUsage {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
		// Opcional en el Usage de pi (los proveedores que nunca emiten tokens de razonamiento
		// lo dejan sin definir): se persiste como 0, nunca se descarta.
		reasoningTokens: usage.reasoning ?? 0,
	};
}

export function createExtractionPipeline(deps: ExtractionPipelineDeps): ExtractionPipeline {
	const { chatStore, graphStore } = deps;
	// Resolución del motor de etapa: un valor directo de prueba gana; si no, la
	// cadena engineFor (sustitución del rol → hueco → nada, resuelta DE NUEVO en cada
	// llamada de etapa en el servidor): exactamente el tratamiento del ejecutor de tareas. undefined
	// = la cadena BYOK salió vacía; las guardas de las puertas de entrada lo convierten en
	// un rechazo honesto.
	const stageEngine = (role: ModelRole, override?: PiEngine): PiEngine | undefined =>
		override ?? deps.engineFor?.(role);
	/** La guarda de rechazo por necesidad: qué niveles de hueco encontraron sin definir las etapas
	 *  de la canalización (los valores de prueba cuentan como configurados: SON motores),
	 *  y si ha desaparecido la clave del proveedor de una etapa configurada (interludio de las
	 *  claves de proveedor, 2026-09-25): ambas cosas rechazan ANTES de que se ejecute ningún lote. */
	function refuseIfStagesUnready(): void {
		const stages: readonly [ModelRole, PiEngine | undefined][] = [
			["extractor", stageEngine("extractor", deps.extractor)],
			["auditor", stageEngine("auditor", deps.auditor)],
		];
		const missing = new Set<ModelSlotName>();
		for (const [role, engine] of stages) if (!engine) missing.add(ROLE_SLOT[role]);
		if (missing.size > 0) {
			console.info(`[extraction] refused — no model configured for: ${[...missing].join(", ")}`);
			throw new ModelsNotConfiguredError([...missing]);
		}
		// Paridad de presencia de clave: aflora el primer infractor (el extractor antes que
		// el auditor); arreglar esa clave vuelve a pasar la barrera y la siguiente ejecución aflora el
		// siguiente infractor, si lo hay.
		for (const [role, engine] of stages) {
			const refusal = deps.providerKeyMissing?.(engine!.model.provider, ROLE_SLOT[role]);
			if (refusal) {
				console.info(`[extraction] refused — ${JSON.stringify(refusal)}`);
				throw new ProviderKeyMissingError(refusal.provider, refusal.slots);
			}
		}
	}
	// LOS REGISTROS COMPARTIDOS (runs() de arriba, en globalThis): toda instancia
	// de la canalización (entradas de ruta en desarrollo, pruebas) ve las mismas ejecuciones y la misma
	// guarda de un solo vuelo. No queda estado a nivel de módulo en esta factoría.
	const runningExtractions = runs().running;
	const inFlight = runs().inFlight;

	function setPhase(
		jobKey: string,
		phase: ExtractionPhase,
		kind: "chat" | "notes",
		label?: string,
		part?: { i: number; n: number },
	): void {
		const R = runs();
		const prev = runningExtractions.get(jobKey);
		if (!prev) R.lastStartedAt = Math.max(Date.now(), R.lastStartedAt + 1);
		runningExtractions.set(jobKey, {
			chatId: prev?.chatId ?? jobKey.split("#")[0]!,
			part: prev?.part ?? part, // los cambios de fase nunca pierden la parte
			kind,
			label: prev?.label ?? label, // los cambios de fase nunca pierden la etiqueta
			phase,
			startedAt: prev?.startedAt ?? R.lastStartedAt,
			usage: prev?.usage ?? {}, // los cambios de fase nunca pierden el uso
			controller: prev?.controller ?? new AbortController(),
		});
		// Cada transición de fase se anuncia al dock (push S5, 2026-10-02):
		// notificar tras escribir: el registro es la verdad del feed.
		emit("activity-changed", {});
	}

	/** Ejecución terminada (hecha, fallida, abortada: toda salida es un finally): la fila
	 *  sale del feed. UNA frontera para todos los puntos de borrado para que ninguna salida pueda
	 *  saltarse el anuncio (push S5, 2026-10-02). */
	function finishExtraction(jobKey: string): void {
		runningExtractions.delete(jobKey);
		emit("activity-changed", {});
	}

	/** Acumula un paso facturado en la entrada del registro de la ejecución (en vivo). */
	function recordStep(jobKey: string, stage: "extractor" | "auditor", usage: CallUsage, model: string): void {
		const run = runningExtractions.get(jobKey);
		if (!run) return; // no está en ejecución (pruebas que conducen las etapas directamente)
		run.usage[stage] ??= { model, steps: [] };
		run.usage[stage]!.steps.push(usage);
	}

	/** AUDITORÍA SERIALIZADA (responsable 2026-09-28): el auditor explora el grafo VIVO
	 *  con sus herramientas y estampa veredictos de identidad contra lo que
	 *  encuentra, así que la sección de auditoría+fusión es una sección crítica
	 *  de todo el proceso. Dos auditorías concurrentes enlazarían cada una con un grafo que la
	 *  otra está a punto de cambiar: la acuñación estructural de nodos duplicados.
	 *  El extractor sigue en paralelo (local a la fuente, ciego al grafo). La
	 *  comprobación se ejecuta ANTES de invocar ningún LLM o de leer el grafo; el cerrojo
	 *  es FIFO, se mantiene durante la fusión, se vuelve a adquirir por lote y
	 *  atiende a los abortos a ambos lados de la cola (un esperador que aborta
	 *  se va sin auditar; su eslabón de la cadena se sigue resolviendo, así que
	 *  los sucesores nunca se cuelgan). */
	async function withAuditLock<T>(jobKey: string, kind: "chat" | "notes", label: string | undefined, critical: () => Promise<T>): Promise<T> {
		setPhase(jobKey, "waiting", kind, label);
		const g = globalThis as typeof globalThis & LhExtractionGlobal;
		const lock = (g.__lhAuditLock ??= { tail: Promise.resolve() });
		const prev = lock.tail;
		let release!: () => void;
		lock.tail = new Promise<void>((resolve) => (release = resolve));
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_, reject) => {
			if (!signal) return;
			onAbort = () => {
				const err = new Error("extraction aborted while waiting for the audit gate");
				err.name = "AbortError";
				reject(err);
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			await Promise.race([prev, aborted]);
			signal?.throwIfAborted(); // abortado justo en el traspaso
			return await critical();
		} finally {
			if (onAbort && signal && !signal.aborted) signal.removeEventListener("abort", onAbort);
			// Un esperador cancelado se va enseguida, pero puede no liberar su eslabón de la
			// cadena antes que su predecesor: los sucesores siguen debiendo esa retención anterior.
			void prev.then(release, release);
		}
	}

	async function extract(
		jobKey: string,
		sourceId: string,
		view: string,
		batchIds: ReadonlySet<string>,
	): Promise<SessionFindings> {
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		signal?.throwIfAborted(); // un aborto durante un hueco síncrono termina aquí la tarea
		// EL RESUMEN (responsable, 2026-09-30 por la tarde): el extractor continúa una
		// fuente extraída en parte: ve todo lo que esta fuente ya ha
		// dado (proposiciones + cadenas, ids literales) y construye
		// sobre ello. Los lotes serializados hacen que esto lea el grafo tras la fusión de
		// todos los lotes anteriores (las ejecuciones entre fuentes siguen en paralelo: el
		// resumen tiene ámbito de fuente, así que solo importa el orden dentro de la MISMA fuente).
		const graph = getGraph(graphStore);
		const digest = sourceDigest(graph, sourceId);
		const prompt = digest === "" ? view : `${digest}\n\n${view}`;
		console.info(
			`[extraction ${jobKey}] extractor starting (${view.split("\n").length} markdown lines` +
				`${digest === "" ? "" : `, digest ${digest.split("\n").length} lines`})`,
		);
		const t0 = performance.now();

		const findings = await runExtractor(
			stageEngine("extractor", deps.extractor),
			sourceId,
			prompt,
			new Set(graph.nodes.map((n) => n.id)),
			batchIds,
			signal,
			(usage, model, step, finishReason, tools) => {
				recordStep(jobKey, "extractor", callUsage(usage), model);
				console.info(`[extraction] extractor step ${step}: ${finishReason}, tools: ${tools}`);
			},
		);
		console.info(`[extraction ${jobKey}] extractor done in ${Math.round(performance.now() - t0)}ms`);
		return findings;
	}

	async function audit(jobKey: string, sourceId: string, findings: SessionFindings): Promise<AuditVerdicts> {
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		signal?.throwIfAborted(); // un aborto durante el hueco extracción→auditoría termina aquí
		const graph = getGraph(graphStore);
		console.info(
			`[extraction ${jobKey}] auditor starting (${findings.propositions.length} propositions, ` +
				`${graph.nodes.length} graph nodes)`,
		);
		const t0 = performance.now();

		// El auditor NUNCA ve la fuente (responsable 2026-09-27): hallazgos
		// en JSON + un lote inicial de candidatos ordenados, no un volcado global del grafo.
		// Las lecturas adicionales del grafo siguen siendo opcionales. La proyección de
		// proposiciones omite messageId (2026-10-13): el auditor es
		// SOLO de identidad y nunca ve los pasajes, así que las anclas no le sirven
		// de nada: añaden carga cognitiva, no señal.
		const review = prepareAuditorReview({ chatStore, graphStore }, findings.propositions);
		const auditResult = await runAuditor(
			stageEngine("auditor", deps.auditor),
			sourceId,
			`Review these proposed findings against the supplied existing records. matches points from finding ids to candidateIds; candidates contains those records:\n\n` +
				`${JSON.stringify(
					{
						propositions: findings.propositions.map((p) => ({
							id: p.id,
							name: p.name,
							statement: p.statement,
							aliases: p.aliases,
						})),
						...review.initialCandidates,
					},
					null,
					2,
				)}`,
			signal,
			(usage, model, step, finishReason, tools) => {
				recordStep(jobKey, "auditor", callUsage(usage), model);
				console.info(`[extraction] auditor step ${step}: ${finishReason}, tools: ${tools}`);
			},
			review.tools,
		);
		console.info(
			`[extraction ${jobKey}] audit: ${findings.propositions.length} propositions through, ` +
				`${auditResult.links.length} linked to existing nodes`,
		);
		console.info(`[extraction ${jobKey}] auditor done in ${Math.round(performance.now() - t0)}ms`);
		return auditResult;
	}

		/** Anexa el registro de uso de la ejecución al registro de extracciones del chat, con éxito
	 *  o con fallo: una ejecución fallida también gastó dinero, y su uso parcial es
	 *  exactamente lo que debe mostrar el registro (stats ausente = nunca se fusionó).
	 *  Idempotente por startedAt (el store deduplica). */
	function persistRunUsage(jobKey: string, durationMs: number, stats: EmissionStats | undefined): void {
		const run = runningExtractions.get(jobKey);
		if (!run) return; // no está en ejecución (pruebas que conducen las etapas directamente)
		// TAREAS POR FRAGMENTO (responsable, 2026-09-28): la CLAVE del registro puede llevar un
		// sufijo "#i"; los REGISTROS de uso se indexan por FUENTE (run.chatId): un
		// registro de tarea por fragmento, todos anexados al registro de la fuente.
		// GUARDA DE BORRADO DE SESIÓN (oleada 6): un chat borrado a mitad de ejecución no tiene
		// registro de uso al que anexar: la muerte del registro es decisión del usuario
		// y su gasto parcial se registra con ella (appendSourceUsage, más abajo,
		// ya no hace nada si la fuente ha desaparecido; el camino del chat se protege aquí).
		if (run.kind === "chat" && !chatStore.getChat(run.chatId)) return;
		const entry: ExtractionRunUsage = {
			startedAt: run.startedAt,
			at: new Date().toISOString(),
			durationMs,
			stats,
			stages: {
				extractor: run.usage.extractor ?? { model: "unknown", steps: [] },
				auditor: run.usage.auditor ?? { model: "unknown", steps: [] },
			},
		};
		if (run.kind === "notes") graphStore.appendSourceUsage(run.chatId, entry);
		else chatStore.appendExtractionUsage(run.chatId, entry);
	}

	/** Una TAREA de fragmento/lote (tareas por fragmento, responsable 2026-09-28): el ciclo de vida de la
	 *  entrada del registro: acuñada con su parte, con el uso persistido por tarea
	 *  (el registro muestra el coste de cada fragmento), eliminada en cualquier salida. El cuerpo
	 *  ejecuta el ciclo de vida completo en cola → extracción → fusión con cerrojo de auditoría;
	 *  el aislamiento de fallos vive en el punto del despliegue (un fragmento malo nunca
	 *  mata a sus hermanos). */
	async function runJob(
		source: { id: string; kind: "chat" | "notes"; label?: string; part?: { i: number; n: number } },
		body: (jobKey: string) => Promise<EmissionStats>,
	): Promise<EmissionStats> {
		const jobKey = source.part ? `${source.id}#${source.part.i}` : source.id;
		const t0 = performance.now();
		try {
			const stats = await body(jobKey);
			persistRunUsage(jobKey, Math.round(performance.now() - t0), stats);
			return stats;
		} catch (err) {
			persistRunUsage(jobKey, Math.round(performance.now() - t0), undefined);
			throw err;
		} finally {
			finishExtraction(jobKey);
		}
	}

	/** La agregación del despliegue (tareas por fragmento, responsable 2026-09-28): los éxitos
	 *  cuentan (los fragmentos anteriores conservan sus fusiones: los puntos de control abaratan
	 *  los abortos), los abortos se registran y pasan como estadísticas parciales, los fallos aislados se registran
	 *  por tarea y nunca lanzan: la ejecución de la fuente devuelve lo que realmente
	 *  se fusionó. */
	function aggregateJobs(sourceId: string, settled: PromiseSettledResult<EmissionStats>[]): EmissionStats {
		const stats: EmissionStats = { nodes: 0, chains: 0 };
		let aborted = false;
		let failed = 0;
		for (const result of settled) {
			if (result.status === "fulfilled") {
				stats.nodes += result.value.nodes;
				stats.chains! += result.value.chains ?? 0;
				// Mantenimiento de la simplificación, sumado como los anexados, pero AUSENTE
				// cuando no se descartó nada (las comparaciones de igualdad profunda en las pruebas se leen mejor).
				if (result.value.droppedChains)
					stats.droppedChains = (stats.droppedChains ?? 0) + result.value.droppedChains;
				continue;
			}
			const err = result.reason;
			if (err instanceof Error && err.name === "AbortError") aborted = true;
			else {
				failed++;
				console.error(`[extraction ${sourceId}] job failed (isolated):`, err);
			}
		}
		if (aborted)
			console.info(
				`[extraction ${sourceId}] aborted — merged chunks keep their coverage, the rest stay uncovered for the next run`,
			);
		if (failed > 0)
			console.error(`[extraction ${sourceId}] ${failed} job(s) failed; successful jobs still merged`);
		return stats;
	}

	async function runExtraction(chatId: string): Promise<EmissionStats> {
		if (inFlight.has(chatId)) return { nodes: 0, chains: 0 };
		inFlight.add(chatId);
		const t0 = performance.now();
		// COBERTURA (vision-extraction-coverage.md, 2026-09-15): extraer SOLO
		// lo que el registro de cobertura por chat aún no contiene, nunca la
		// sesión entera. Los lotes son tiradas con presupuesto de tokens de los mensajes
		// sin cubrir más antiguos; cada lote fusionado guarda el punto de control de la cobertura de sus mensajes
		// de forma ATÓMICA (dentro del paso 4 del fusionador), así que un aborto o un
		// error más abajo pierde como mucho el lote en curso: todos los lotes
		// anteriores siguen cubiertos y el resto sigue visiblemente sin cubrir.
		try {
			const record = chatStore.getChat(chatId);
			if (!record) throw new Error(`Chat not found: ${chatId}`);
			// Barrera BYOK por necesidad (responsable, 2026-09-22) + presencia de clave
			// (2026-09-25): el canal de escritura necesita los motores de extractor + auditor
			// Y las claves de sus proveedores; un rechazo llega ANTES de que se ejecute
			// ninguna etapa (tipado: el disparador lo salta, las rutas devuelven 503).
			refuseIfStagesUnready();
			const covered = coverageOf(record.messages, graphStore.readCoverage(), chatId);
			const failedOutputCalls = failedOutputCallIds(record.messages);
			if (covered.uncovered.length === 0) {
				console.info(`[extraction ${chatId}] nothing uncovered — no-op`);
				return { nodes: 0, chains: 0 };
			}
			const chunkTokens = deps.getChunkTokens?.() ?? FACTORY_SETTINGS.graph.extractionChunkTokens;
			// La única regla del agrupador (responsable, Oleada D): un mensaje de llamada a herramienta y
			// su(s) mensaje(s) de resultado son INSEPARABLES: un fragmento, cubiertos
			// juntos, leídos juntos (batchRuns de core/coverage.ts).
			const batches = batchRuns(covered.slots, covered.uncovered, chunkTokens);
			console.info(
				`[extraction ${chatId}] pipeline start — ${covered.uncoveredTokens} uncovered tok, ` +
					`${covered.uncoveredCount} messages, ${batches.length} batch(es) of ≤${chunkTokens} tok`,
			);
			// TAREAS POR FRAGMENTO (responsable, 2026-09-28), SERIALIZADAS POR FUENTE (responsable,
			// 2026-09-30 por la tarde): cada lote es su propia tarea, con fila en el registro,
			// porque el extractor de cada lote continúa el resumen de la fuente
			// (todo lo que fusionaron los lotes anteriores). Las ejecuciones entre fuentes siguen
			// en paralelo; las peticiones de worker individuales comparten la admisión de todo el proceso.
			// Las auditorías se serializan mediante la barrera de consistencia aparte ("waiting").
			// Un lote que falla queda AISLADO
			// (sus mensajes siguen sin cubrir: se pueden volver a ejecutar con honestidad); sus
			// hermanos siguen fusionando.
			const settled: PromiseSettledResult<EmissionStats>[] = [];
			for (const [batchIndex, batch] of batches.entries()) {
				const part = batches.length > 1 ? { i: batchIndex + 1, n: batches.length } : undefined;
				try {
					settled.push({
						status: "fulfilled",
						value: await runJob({ id: chatId, kind: "chat", part }, async (jobKey) => {
							// La vista de la fuente del lote: SOLO PROSA DEL PROFESOR (responsable,
							// 2026-09-28), con cada pasaje etiquetado con su id de mensaje
							// REAL (2026-10-13): las líneas de la vista SON las messageViewLines de las
							// huellas de cobertura ("TEACHER [id] text"), una sola
							// frontera compartida.
							const messages = batch.map((slot) => slot.message);
							const view = proseView(messages, record.title, failedOutputCalls);
							// Los ids de prosa del profesor del lote: las ÚNICAS anclas que
							// puede nombrar el envío de esta tarea (validateSessionAnchors en la
							// frontera de envío rechaza todo lo demás: ids de otros
							// lotes, aunque sean reales de este chat, de otros chats
							// y de mensajes que no son prosa).
							const batchIds = new Set(
								messages.filter((m) => messageViewLines(m, m.id, failedOutputCalls).length > 0).map((m) => m.id),
							);
							setPhase(jobKey, "extracting", "chat", undefined, part);
							const findings = await extract(jobKey, chatId, view, batchIds);
							// AUDITORÍA SERIALIZADA (responsable, 2026-09-28): auditoría + fusión son la
							// sección crítica que muta el grafo: una tarea cada vez,
							// en todo el proceso, para que el auditor explore el grafo tal como
							// queda DESPUÉS de la fusión de cada tarea anterior.
							return withAuditLock(jobKey, "chat", undefined, async () => {
								setPhase(jobKey, "auditing", "chat", undefined, part);
								const auditResult = await audit(jobKey, chatId, findings);
								setPhase(jobKey, "merging", "chat", undefined, part);
								// GUARDA DE BORRADO DE SESIÓN (oleada 6): un chat borrado a mitad de ejecución nunca debe
								// fusionarse. La ruta de borrado aborta primero esta ejecución y hace su purga
								// como un único bloque síncrono; esto cierra la última ventana: una ejecución que se coló
								// más allá del cierre encuentra AQUÍ que el chat ha desaparecido y sigue el camino de aborto
								// existente (info, no error): nada fusionado, ningún punto de control.
								if (!chatStore.getChat(chatId)) {
									const gone = new Error(`chat deleted mid-run: ${chatId}`);
									gone.name = "AbortError";
									throw gone;
								}
								// Los mensajes del lote, como instantánea tomada cuando la ejecución calculó
								// la cobertura: si un mensaje cambia a mitad de ejecución (se fusiona la respuesta
								// de un quiz), la huella guardada no coincidirá con la nueva
								// y se reabrirá: honesto por construcción.
								const foldedAt = new Date().toISOString();
								const batchStats = mergeFindings(chatId, findings, auditResult, { chatStore, graphStore }, {
									foldedAt,
									coverage: batch
										.filter((slot) => slot.tokens > 0)
										.map((slot) => ({ chatId, fp: slot.fp, tokens: slot.tokens, foldedAt })),
								});
								// El registro de la disposición evoluciona con la fusión (síncrono: la
								// siguiente petición de instantánea ya debe reflejar los nodos nuevos).
								settleGraphLayout(graphStore);
								console.info(
									`[extraction ${jobKey}] merged: ${batchStats.nodes} nodes, ${batchStats.chains ?? 0} chains`,
								);
								return batchStats;
							});
						}),
					});
				} catch (err) {
					settled.push({ status: "rejected", reason: err });
					// Un aborto de toda la fuente (aborto del usuario / borrado de sesión)
					// termina TODA la ejecución: los lotes posteriores acuñarían tareas nuevas
					// sin abortar y se colgarían: hay que parar aquí. Los FALLOS
					// aislados siguen adelante (los hermanos siguen fusionando).
					if (err instanceof Error && err.name === "AbortError") break;
				}
			}
			const stats = aggregateJobs(chatId, settled);
			console.info(
				`[extraction ${chatId}] merged: ${stats.nodes} nodes, ${stats.chains ?? 0} chains ` +
					`(${Math.round(performance.now() - t0)}ms total, ${batches.length} batch job(s))`,
			);
			return stats;
		} catch (err) {
			// Solo fallos previos al despliegue (barrera de etapas, lectura de cobertura): los abortos
			// y los fallos a nivel de tarea se absorben en el punto del despliegue, por
			// tarea: los lotes fusionados siguen cubiertos, el uso parcial se persiste por
			// tarea y el agregado devuelve lo que realmente se fusionó.
			console.error(`[extraction ${chatId}] pipeline failed (${Math.round(performance.now() - t0)}ms):`, err);
			throw err;
		} finally {
			inFlight.delete(chatId);
			finishExtraction(chatId); // hecho o fallido: ya no está en ejecución
		}
	}

	// ── la puerta de entrada de notas (agnóstica al formato: entra texto crudo, sale el mismo grafo) ──

	/** La vista cruda de la fuente que ven las etapas de notas: la ruta del fichero + el texto
	 *  LITERAL. Sin ids de mensaje: la procedencia es el propio fichero. */
	function notesView(input: { filePath: string; text: string; part?: { i: number; n: number } }): string {
		const part = input.part && input.part.n > 1 ? ` (part ${input.part.i}/${input.part.n})` : "";
		return `SOURCE (the author's personal notes): ${input.filePath}${part}\n\n${input.text}`;
	}

	/** Divide en fragmentos el texto de las notas con el mismo presupuesto que usa el camino de chat
	 * (responsable, 2026-09-28: el diseño de todo el fichero en una llamada hundía a un
	 * modelo débil: 26 proposiciones, estructura que se desbordaba a mitad de la emisión).
	 * Voraz por líneas, caracteres/4 como cualquier otra estimación de la app; una
	 * única línea que supera el presupuesto va sola (nunca se parte una línea). */
	function chunkNotes(text: string, budget: number): string[] {
		if (text.trim().length === 0) return [];
		const out: string[] = [];
		let current = "";
		for (const line of text.split("\n")) {
			const candidate = current.length === 0 ? line : current + "\n" + line;
			if (current.length > 0 && Math.ceil(candidate.length / 4) > budget) {
				out.push(current);
				current = line;
			} else {
				current = candidate;
			}
		}
		if (current.trim().length > 0) out.push(current);
		return out;
	}

	async function notesExtract(
		jobKey: string,
		input: { id: string; filePath: string; text: string; part?: { i: number; n: number } },
	): Promise<NotesFindings> {
		// jobKey (tareas por fragmento, responsable 2026-09-28): la clave del registro
		// ("src#i" en las tareas por fragmento) para que la señal de aborto llegue a la llamada.
		// input.id sigue siendo el id de la FUENTE para la vista y los registros del store.
		const signal = runningExtractions.get(jobKey)?.controller.signal;
		signal?.throwIfAborted(); // un aborto durante un hueco síncrono termina aquí la tarea
		const view = notesView(input);
		// La misma ley del resumen que la puerta de chats (responsable, 2026-09-30 por la tarde): el
		// extractor del fragmento continúa su propia fuente, con los ids literales.
		const graph = getGraph(graphStore);
		const digest = sourceDigest(graph, input.id);
		const prompt = digest === "" ? view : `${digest}\n\n${view}`;
		console.info(
			`[extraction ${jobKey}] notes extractor starting (${view.split("\n").length} source lines` +
				`${digest === "" ? "" : `, digest ${digest.split("\n").length} lines`})`,
		);
		const t0 = performance.now();
		const findings = await runNotesExtractor(
			stageEngine("extractor", deps.extractor),
			input.id,
			prompt,
			new Set(graph.nodes.map((n) => n.id)),
			signal,
			(usage, model, step, finishReason, tools) => {
				recordStep(jobKey, "extractor", callUsage(usage), model);
				console.info(`[extraction] extractor step ${step}: ${finishReason}, tools: ${tools}`);
			},
		);
		console.info(`[extraction ${jobKey}] notes extractor done in ${Math.round(performance.now() - t0)}ms`);
		return findings;
	}

	// El auditor de notas es el MISMO enlazador de identidad que el de chats (un
	// solo esquema desde que desapareció la atribución): audit(), arriba, literal.

	async function runNotesExtraction(input: { id: string; filePath: string; text: string; importedAt: string }): Promise<EmissionStats> {
		const { id } = input;
		// importNotes es dueño de la exclusión de la fuente, incluidos los metadatos y la limpieza.
		const t0 = performance.now();
		const mergedStats: EmissionStats = { nodes: 0, chains: 0 };
		try {
			// Barrera BYOK por necesidad (responsable, 2026-09-22) + presencia de clave
			// (2026-09-25): el mismo rechazo que la puerta de chats: sin motores de
			// extractor/auditor, o sin la clave de una etapa, no hay ejecución.
			refuseIfStagesUnready();
			// EN FRAGMENTOS como el camino de chat (responsable, 2026-09-28): cada fragmento es un
			// extracción → auditoría → fusión independiente, así que ninguna llamada lleva un
			// fichero grande entero. Abortar a mitad de ejecución conserva fusionados los fragmentos anteriores
			// (la misma doctrina que los lotes de chat).
			const chunkTokens = deps.getChunkTokens?.() ?? FACTORY_SETTINGS.graph.extractionChunkTokens;
			const chunks = chunkNotes(input.text, chunkTokens);
			console.info(
				`[extraction ${id}] notes pipeline start (${input.filePath}) — ${chunks.length} chunk(s) of ≤${chunkTokens} tok`,
			);
			// TAREAS POR FRAGMENTO (responsable, 2026-09-28), SERIALIZADAS POR FUENTE (responsable,
			// 2026-09-30 por la tarde): la misma ley que la puerta de chats: los fragmentos se ejecutan
			// ESTRICTAMENTE EN ORDEN, y el extractor de cada fragmento continúa el
			// resumen de la fuente (todo lo que fusionaron los fragmentos anteriores). Las ejecuciones entre fuentes
			// siguen en paralelo; las peticiones de worker individuales comparten la admisión,
			// mientras que las auditorías se serializan mediante la barrera de consistencia. La
			// parte va en la entrada del registro (sufijo del feed "· i/N") solo cuando
			// el fichero se dividió de verdad.
			const settled: PromiseSettledResult<EmissionStats>[] = [];
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const part = chunks.length > 1 ? { i: chunkIndex + 1, n: chunks.length } : undefined;
				// Conservar la señal real después de que runJob desmonte su fila del registro:
				// la persistencia del uso puede lanzar y enmascarar el AbortError del cuerpo.
				let chunkSignal: AbortSignal | undefined;
				try {
					settled.push({
						status: "fulfilled",
						value: await runJob({ id, kind: "notes", label: input.filePath, part }, async (jobKey) => {
							setPhase(jobKey, "extracting", "notes", input.filePath, part);
							chunkSignal = runningExtractions.get(jobKey)?.controller.signal;
							const findings = await notesExtract(jobKey, { ...input, text: chunk, part });
							// AUDITORÍA SERIALIZADA (responsable, 2026-09-28): auditoría + fusión de una
							// en una, en todo el proceso: el auditor explora el grafo
							// tal como queda DESPUÉS de la fusión de cada tarea anterior. Se vuelve a adquirir
							// por fragmento para que las ejecuciones entre fuentes se intercalen de forma justa.
							return withAuditLock(jobKey, "notes", input.filePath, async () => {
								setPhase(jobKey, "auditing", "notes", input.filePath, part);
								const auditResult = await audit(jobKey, input.id, findings);
								setPhase(jobKey, "merging", "notes", input.filePath, part);
								const merged = mergeFindings(
									id,
									findings,
									auditResult,
									{ chatStore, graphStore },
									{ foldedAt: input.importedAt },
								);
								// Capturar la fusión confirmada ANTES de que la disposición/el uso puedan fallar.
								mergedStats.nodes += merged.nodes;
								mergedStats.chains! += merged.chains ?? 0;
								if (merged.droppedChains)
									mergedStats.droppedChains = (mergedStats.droppedChains ?? 0) + merged.droppedChains;
								// El registro de la disposición evoluciona con cada fusión: la siguiente
								// petición de instantánea refleja cada fragmento terminado.
								settleGraphLayout(graphStore);
								console.info(`[extraction ${jobKey}] merged: ${merged.nodes} nodes, ${merged.chains ?? 0} chains`);
								return merged;
							});
						}),
					});
				} catch (err) {
					let failure = err;
					if (chunkSignal?.aborted && !(err instanceof Error && err.name === "AbortError")) {
						// Solo notas: nunca empezar un fragmento nuevo tras una cancelación del usuario,
						// aunque la limpieza del uso haya sustituido el rechazo original del aborto.
						// Mantener visible el fallo secundario en el error final de la importación.
						const aborted = new Error(`Notes import aborted; job cleanup failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
						aborted.name = "AbortError";
						failure = aborted;
					}
					settled.push({ status: "rejected", reason: failure });
					// La misma ley de aborto de toda la fuente que la puerta de chats: detener la
					// ejecución; los fallos aislados siguen adelante.
					if (failure instanceof Error && failure.name === "AbortError") break;
				}
			}
			const stats = aggregateJobs(id, settled);
			// La finalización es un contrato de estado de fragmentos, nunca una prueba de número de nodos.
			// Cero hallazgos (y un fichero vacío tras la barrera de disponibilidad) son válidos.
			const rejected = settled.filter((r) => r.status === "rejected");
			if (rejected.length > 0 || settled.length !== chunks.length) {
				const aborted = rejected.some((r) => r.reason instanceof Error && r.reason.name === "AbortError");
				const outcome = aborted ? "aborted" : settled.some((r) => r.status === "fulfilled") ? "partial" : "failed";
				const details = rejected.map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason)).join("; ");
				throw new NotesImportError(outcome, mergedStats, details || "Notes import did not complete");
			}
			console.info(
				`[extraction ${id}] merged: ${stats.nodes} nodes, ${stats.chains ?? 0} chains ` +
					`(${Math.round(performance.now() - t0)}ms total, ${chunks.length} chunk job(s))`,
			);
			return stats;
		} catch (err) {
			console.error(`[extraction ${id}] notes pipeline failed (${Math.round(performance.now() - t0)}ms):`, err);
			if (err instanceof NotesImportError || err instanceof ModelsNotConfiguredError || err instanceof ProviderKeyMissingError) throw err;
			throw new NotesImportError(err instanceof Error && err.name === "AbortError" ? "aborted" : "failed", mergedStats,
				err instanceof Error ? err.message : String(err), { cause: err });
		} finally {
			finishExtraction(id); // hecho o fallido: ya no está en ejecución
		}
	}

	/** Toda importación explícita procesa el fichero entero. La identidad, el resumen de la fuente,
	 * el auditor y el historial de uso siguen con ámbito de fuente; esto no es exactamente una vez. */
	async function importNotes(input: NotesImportInput): Promise<EmissionStats> {
		const id = `src_${crypto.createHash("sha256").update(input.filePath).digest("hex").slice(0, 12)}`;
		// Adquirir ANTES de insertar/actualizar la fuente: unos contenidos que se solapan no deben alterar los metadatos.
		if (inFlight.has(id)) throw new NotesImportError("busy", { nodes: 0, chains: 0 }, "This file is already being imported. Try again when it finishes.");
		inFlight.add(id);
		try {
			const importedAt = new Date().toISOString();
			graphStore.upsertSource({ id, filePath: input.filePath, importedAt });
			return await runNotesExtraction({ id, ...input, importedAt });
		} catch (err) {
			if (err instanceof NotesImportError || err instanceof ModelsNotConfiguredError || err instanceof ProviderKeyMissingError) throw err;
			throw new NotesImportError("failed", { nodes: 0, chains: 0 }, err instanceof Error ? err.message : String(err), { cause: err });
		} finally {
			inFlight.delete(id);
		}
	}

	return { runExtraction, importNotes };
}

