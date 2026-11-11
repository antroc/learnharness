/**
 * Formato de autoría Mermaid → PlanTree (el protocolo de autoría única, 2026-09-03;
 * pasada de forma libre 2026-09-11: el análisis posterior de la sesión de proteína muscular: cuatro
 * llamadas a plan_init fallidas por ids que el parser odiaba en silencio).
 *
 * El profesor escribe el mapa de la sesión como un bloque mermaid (el formato que los modelos
 * dominan con más soltura) y plan_init lo canoniza en el PlanTree
 * estructurado. Subconjunto parseado a mano: determinista, sin dependencias, con errores
 * precisos con número de línea con los que el profesor puede actuar (el mismo bucle de validar y reintentar
 * que los esquemas de preguntas). No es el runtime de mermaid: el servidor nunca
 * renderiza, solo necesita el grafo.
 *
 * LA ÚNICA REGLA ESTRICTA: los ids de nodo son slugs permanentes a los que el profesor hace referencia
 * mediante el nodeId del quiz: palabras en minúsculas (a-z, 0-9) unidas por guiones O
 * guiones bajos (`chain-rule-intuition`, `mps_translation`). Todo lo demás
 * es tan libre como permite mermaid:
 *   graph|flowchart TD|TB|LR|RL|BT   (la dirección es cosmética: hacemos la
 *                                     disposición nosotros; sin distinguir mayúsculas)
 *   %% líneas de comentario
 *   node            — id suelto (el título recurre al id)
 *   id[title]       — etiqueta entre corchetes; cualquier título de una línea; se quita
 *                     un par "…" que lo rodee
 *   id("title")     — etiqueta entre paréntesis
 *   a --> b         — arista requires (from = prerrequisito); ==> y -.-> son
 *                     sinónimos; las cadenas a --> b --> c se expanden en pares
 *   a[title] --> b[title] — etiquetas en línea en cualquier punto donde aparezca un extremo
 * Los extremos sueltos se registran como nodos; las referencias adelantadas valen; las aristas
 * duplicadas se deduplican; gana la primera etiqueta que recibe un nodo.
 */
import type { PlanEdge, PlanNode } from "@/src/core";

export interface ParsedPlan {
	nodes: PlanNode[];
	edges: PlanEdge[];
}

export interface PlanParseResult {
	ok: boolean;
	/** Todos los problemas, cada uno precedido de su número de línea (empezando en 1). */
	problems: string[];
	plan?: ParsedPlan;
}

const HEADER_RE = /^(graph|flowchart)\s+(td|tb|lr|rl|bt)\s*$/i;
const SLUG_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
/** Cualquier grafía de flecha cuenta como arista requires; las cadenas se dividen por ella. */
const ARROW_RE = /-->|==>|-\.->/;
/** Un extremo de arista: `id`, `id[title]` o `id("title")`. */
// La clase de CANDIDATO a id es deliberadamente amplia (todo salvo espacios en blanco,
// corchetes y paréntesis) para que TODO id incorrecto (MAYÚSCULAS, puntos, guiones bajos…) llegue
// al mensaje de slug ESPECÍFICO de register() en lugar de morir en la capa de la regex
// con un error de parseo genérico. El análisis posterior de la proteína muscular: los guiones bajos
// fallaban AQUÍ, el mensaje accionable nunca saltaba y el profesor gastó
// cuatro intentos persiguiendo signos de puntuación que al parser le daban igual.
const ENDPOINT_RE = /^([^\s()\[\]]+)\s*(?:\[([^\[\]]*)\]|\(\s*"([^"]*)"\s*\)|\(([^()]*)\))?$/;

interface Endpoint {
	id: string;
	label?: string;
}

function parseEndpoint(text: string): Endpoint | null {
	const m = text.trim().match(ENDPOINT_RE);
	if (!m || !m[1]) return null;
	let label = (m[2] ?? m[3] ?? m[4] ?? "").trim();
	// `id["title"]` es mermaid idiomático: no conservar el par de comillas en el título.
	if (
		label.length >= 2 &&
		((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'")))
	) {
		label = label.slice(1, -1).trim();
	}
	return { id: m[1], label };
}

/** Parsea el subconjunto de mermaid. Recoge TODOS los problemas (nunca solo el primero). */
export function parseMermaidPlan(mermaid: string): PlanParseResult {
	const problems: string[] = [];
	const lines = mermaid.split(/\r?\n/);

	// Cabecera: obligatoria, primera línea no vacía que no sea comentario.
	const first = lines.findIndex((l) => l.trim().length > 0 && !l.trim().startsWith("%%"));
	if (first === -1) {
		return { ok: false, problems: ["The plan is empty — expected a `graph TD` block with nodes and `-->` requires-edges."] };
	}
	const header = lines[first]?.trim() ?? "";
	if (!HEADER_RE.test(header)) {
		problems.push(`line ${first + 1}: expected the header \`graph TD\` (or flowchart TD/TB) first, got \`${header}\`.`);
	}

	const nodes = new Map<string, string>(); // id → título (gana la primera etiqueta)
	const edges: PlanEdge[] = [];
	const seenEdges = new Set<string>();

	const register = ({ id, label }: Endpoint, lineNo: number): void => {
		if (!SLUG_RE.test(id)) {
			problems.push(
				`line ${lineNo}: node id \`${id}\` must be a lowercase slug (a-z, 0-9, joined by hyphens or underscores — e.g. \`chain-rule-intuition\`); ids are permanent and checks reference them.`,
			);
			return;
		}
		if (!nodes.has(id)) nodes.set(id, label && label.length > 0 ? label : id);
		else if (label && label.length > 0 && nodes.get(id) === id) nodes.set(id, label);
	};

	for (let i = first + 1; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? "";
		const no = i + 1;
		if (line.length === 0 || line.startsWith("%%")) continue;

		// Aristas (incl. cadenas): se dividen por cualquier grafía de flecha; cada segmento es
		// un extremo, y los pares consecutivos se convierten en aristas requires.
		const segments = line.split(ARROW_RE);
		if (segments.length >= 2) {
			const endpoints: Endpoint[] = [];
			let unreadable = false;
			for (const seg of segments) {
				const ep = parseEndpoint(seg);
				if (!ep) {
					problems.push(
						`line ${no}: can't read the edge \`${line}\` — expected \`a[title] --> b[title]\` (chains like \`a --> b --> c\` are fine).`,
					);
					unreadable = true;
					break;
				}
				endpoints.push(ep);
			}
			if (!unreadable) {
				for (const ep of endpoints) register(ep, no);
				for (let k = 0; k + 1 < endpoints.length; k++) {
					const from = endpoints[k]!;
					const to = endpoints[k + 1]!;
					if (from.id === to.id) {
						problems.push(`line ${no}: self-loop \`${from.id} --> ${to.id}\` — a node can't require itself.`);
						continue;
					}
					const key = `${from.id}->${to.id}`;
					if (!seenEdges.has(key)) {
						seenEdges.add(key);
						edges.push({ from: from.id, to: to.id });
					}
				}
			}
		} else {
			const node = parseEndpoint(line);
			if (!node) {
				problems.push(
					`line ${no}: can't parse \`${line}\` — ids are the strict part (lowercase slugs: a-z, 0-9, hyphens, underscores); node lines (\`slug[title]\`) and requires-edges (\`a --> b\`) are the accepted forms; subgraphs, styles, and classes are not part of the subset.`,
				);
				continue;
			}
			register(node, no);
		}
	}

	const plan: ParsedPlan = {
		nodes: [...nodes.entries()].map(([id, title]) => ({ id, title })),
		edges,
	};
	if (problems.length > 0) return { ok: false, problems };
	if (plan.nodes.length === 0) return { ok: false, problems: ["No nodes found — the plan needs at least one."] };
	return { ok: true, problems: [], plan };
}
