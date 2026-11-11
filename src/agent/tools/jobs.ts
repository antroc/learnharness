import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { JobRecord } from "../../core/contracts.ts";
import type { JobStore } from "../../core/ports.ts";
import { checkLearnerImage } from "./learner-image.ts";
import { resolveSourcePath } from "./fs-shared.ts";

/**
 * Herramientas de tareas asíncronas de subagentes (visión §2.5; tipos W2/W6 + el protocolo
 * de modelo de pi). EJECUTADAS EN EL SERVIDOR: cada llamada crea el registro de la tarea, lanza el
 * ejecutor en segundo plano (mediante la frontera de lanzamiento inyectada: la capa del agente nunca
 * importa uno) y se resuelve INMEDIATAMENTE con un acuse de disparar y olvidar. El
 * turno del profesor NO termina en la llamada; el resultado llega más tarde como un
 * mensaje de reorientación que despierta al profesor en un turno nuevo. Ver contracts.ts,
 * "THE ASYNC PROTOCOL".
 */

/** Lo que necesitan las herramientas de tareas al ejecutarse (inyectado por la raíz de composición). */
export interface JobToolContext {
	chatId: string;
	/** Crea el registro de la tarea (sin duplicados por toolCallId). */
	jobStore: JobStore;
	/** Lanza el ejecutor en segundo plano para una tarea nueva: disparar y olvidar. La
	 *  entrada va con ella porque el lanzamiento ocurre A MITAD DE STREAM, antes de que
	 *  onFinish persista la parte de herramienta: un recorrido del transcript competiría con él. */
	spawn: (job: JobRecord, input: ResearchInput | DemoInput | VisualInput | PdfInput) => void;
	/** Disponibilidad del proveedor de búsqueda, conservada para las fronteras de composición existentes.
	 *  El despacho de research no depende de ella: web_fetch no necesita clave y
	 *  web_search informa de la falta de proveedor como un resultado de herramienta recuperable. */
	searchAvailable?: () => boolean;
}

export const researchInputSchema = Type.Object({
	question: Type.String({
		description: "The single research question to answer. Make it specific — the researcher sees nothing else of the lesson.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Why you need this / what the lesson needs it for — focuses the brief. One or two sentences.",
		}),
	),
});

export const demoInputSchema = Type.Object({
	title: Type.String({ description: "Short title for the demo card, e.g. 'Damped harmonic oscillator'." }),
	brief: Type.String({
		description:
			"Precise brief for the builder: the concept, the parameters/controls and what each does, the interactions, and the visual style. " +
			"The builder sees NOTHING else of the lesson — include everything it needs, including necessary formulas and constants.",
	}),
});

export const visualInputSchema = Type.Object({
	brief: Type.String({
		description:
			"Precise brief for ONE static figure: exactly what it must show — coordinates, labels, proportions, orientation. " +
			"The maker sees NOTHING else of the lesson; a wrong or vague brief produces a wrong figure. " +
			"With an image: which features to mark and what each label says.",
	}),
	image: Type.Optional(
		Type.String({
			description:
				"Path to one of the learner's image files (jpg, png, gif, webp, bmp) to annotate — the maker draws on top of it " +
				"instead of drawing from scratch.",
		}),
	),
});

export const pdfInputSchema = Type.Object({
	path: Type.String({ description: "Path to the learner's PDF (relative or absolute), exactly as they gave it." }),
	question: Type.String({
		description:
			"What you need from the document — the specific content, explanation, or answer to extract and brief. " +
			"The reader sees NOTHING else of the lesson.",
	}),
});

/**
 * El despacho por llamada: crea la tarea (idempotente por toolCallId), lanza el
 * ejecutor y devuelve el acuse. Compartido por las tres herramientas: solo cambia el tipo.
 */
function dispatch(
	ctx: JobToolContext,
	kind: JobRecord["kind"],
	toolCallId: string,
	ack: string,
	input: ResearchInput | DemoInput | VisualInput | PdfInput,
): string {
	const existing = ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId);
	const job = existing ?? ctx.jobStore.createJob({ kind, chatId: ctx.chatId, toolCallId, input });
	if (!existing) ctx.spawn(job, input);
	return `Dispatched (job ${job.id}). ${ack}`;
}

const RESEARCH_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The researched brief arrives as a new message when ready and the lesson resumes from it; cite its sources when you use them.";
const DEMO_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The tested demo arrives as a new message when ready and is rendered in the lesson; teach with it then.";
const VISUAL_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The verified figure arrives as a new message when ready and is rendered in the lesson; reference it then.";
const PDF_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The document brief arrives as a new message when ready; weave it into the lesson and cite its pages.";

const RESEARCH_DESCRIPTION =
	"Dispatch a background web-research agent: fact verification, current data, or niche specifics you are not certain about. " +
	"The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the research brief arrives later " +
	"as a new message and the lesson resumes from it. Cite the brief's sources when you use them. " +
	"NEVER use it for things you know cold, internal reasoning, or math.";
const DEMO_DESCRIPTION =
	"Dispatch a background sub-agent that BUILDS and headlessly TESTS an interactive teaching instrument — a single-file HTML " +
	"demo (parameter sweep, simulation, animation, sampling) rendered live in the lesson. Use it when the concept is DYNAMIC: " +
	"something to sweep, animate, or sample is better experienced than described. " +
	"The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the tested demo arrives later " +
	"as a new message. Write a precise brief: concept, controls, interactions, style.";
const VISUAL_DESCRIPTION =
	"Dispatch a background sub-agent that hand-authors ONE precise SVG figure, renders it, LOOKS at the render, and iterates " +
	"until correct. Use it for exact spatial pictures auto-layout diagrams can't do: coordinate geometry, number lines, vectors, " +
	"function plots, physical layouts. For flows/relations/taxonomies write mermaid inline instead. " +
	"Pass `image` (a learner image file) to have the maker annotate that picture — arrows, outlines, labels — instead. Local image paths follow File access settings; use ls to discover allowed folders. " +
	"The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the verified figure arrives later " +
	"as a new message.";
const PDF_DESCRIPTION =
	"Dispatch a background sub-agent that READS a learner-provided PDF on your behalf (triage, targeted extraction, visual page " +
	"reading for equations and diagrams) and returns a brief with page citations. Use it when the learner gives you a PDF path " +
	"and you need its CONTENT for the lesson. The call is ASYNC and fire-and-forget — it resolves immediately and your turn " +
	"continues; the brief arrives later as a new message. For quick looks at plain text or image files, use the read tool " +
	"directly instead of dispatching. Local PDF paths follow File access settings; use ls to discover allowed folders.";

/**
 * Registro de herramientas de tareas por petición: cada herramienta se cierra sobre el contexto
 * de la raíz de composición (chatId + jobStore + la frontera de lanzamiento), así que los chats
 * concurrentes nunca comparten estado. chat-handler lo conecta en cada turno; las pruebas conectan el suyo.
 *
 * Research sigue disponible sin clave de proveedor de búsqueda; el filtrado existente
 * por interruptores del usuario del rol sigue aplicándose fuera de este registro.
 */
export function jobTools(ctx: JobToolContext): Record<string, AgentTool<any>> {
	return {
		research: {
			name: "research",
			label: "research",
			description: RESEARCH_DESCRIPTION,
			parameters: researchInputSchema,
			execute: serverExecute("research", researchInputSchema, (input, { toolCallId }) =>
				dispatch(ctx, "research", toolCallId, RESEARCH_ACK, input),
			),
		},
		demo: {
			name: "demo",
			label: "demo",
			description: DEMO_DESCRIPTION,
			parameters: demoInputSchema,
			execute: serverExecute("demo", demoInputSchema, (input, { toolCallId }) => dispatch(ctx, "demo", toolCallId, DEMO_ACK, input)),
		},
		visual: {
			name: "visual",
			label: "visual",
			description: VISUAL_DESCRIPTION,
			parameters: visualInputSchema,
			// Una ruta de imagen inservible hace fallar la LLAMADA (no se crea ninguna tarea), así que el
			// profesor corrige la ruta en el mismo turno.
			execute: serverExecute("visual", visualInputSchema, async (input, { toolCallId, signal }) => {
				if (!ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId) && input.image !== undefined) await checkLearnerImage(input.image);
				signal?.throwIfAborted();
				return dispatch(ctx, "visual", toolCallId, VISUAL_ACK, input);
			}),
		},
		pdf: {
			name: "pdf",
			label: "pdf",
			description: PDF_DESCRIPTION,
			parameters: pdfInputSchema,
			execute: serverExecute("pdf", pdfInputSchema, (input, { toolCallId }) => {
				// La admisión usa el límite actual; el lector en cola vuelve a comprobar
				// al empezar la tarea. Conserva los argumentos/historial crudos y los ID de reproducción.
				if (!ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId)) resolveSourcePath(input.path);
				return dispatch(ctx, "pdf", toolCallId, PDF_ACK, input);
			}),
		},
	};
}

export type ResearchInput = Static<typeof researchInputSchema>;
export type DemoInput = Static<typeof demoInputSchema>;
export type VisualInput = Static<typeof visualInputSchema>;
export type PdfInput = Static<typeof pdfInputSchema>;
