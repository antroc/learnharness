import type { ComponentType } from "react";
import type { ArtifactPartProps } from "@/src/core";
import { DemoCard } from "@/components/artifacts/demo-card";
import { JobCard, PdfJobCard } from "@/components/artifacts/job-card";
import { VisualCard } from "@/components/artifacts/visual-card";
import { ImageCard } from "@/components/artifacts/image-card";
import { ProbeDoneCard } from "@/components/artifacts/probe-done-card";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import { ProblemCard, ConcludeCard } from "@/components/practice-cards";

/**
 * Registro de renderers de artefactos: el punto de extensión de la UI de las
 * partes de herramienta.
 *
 * chat.tsx renderiza cualquier parte de herramienta que no trate de forma
 * especial (es decir, que no sea quiz/ask) buscando aquí el nombre de la
 * herramienta. Añade tu renderer; NO edites chat.tsx (ver las reglas de
 * propiedad de ficheros de docs/archive/plan.md).
 *
 * Forma habitual: mientras la parte está en input-available, renderiza una
 * tarjeta de actividad (el feed de tareas de la vista de chat lee GET
 * /api/jobs?chatId=…; al terminar llama a
 * ChatActionsContext.syncFromServer()); cuando está en output-available,
 * renderiza el propio artefacto a partir de part.output.
 */
export const artifactRenderers: Record<string, ComponentType<ArtifactPartProps>> = {
	research: JobCard,
	pdf: PdfJobCard, // fuentes v0: la prueba de humo en vivo del 2026-09-19 detectó el hueco; sin esto la parte de despacho de tool-pdf no renderizaba nada
	// Las partes plan_* no renderizan nada en línea a propósito: la frontera de fase es un
	// límite a nivel de mensaje, dibujado por PhaseDivider en chat.tsx (el antiguo
	// separador plan_init a nivel de parte se retiró con ello).
	// Artefactos (W6 rellena los componentes):
	demo: DemoCard,
	visual: VisualCard,
	// Una imagen del alumno mostrada tal cual (issue #363): la propia imagen, en línea.
	show_image: ImageCard,
	// La conclusión del sondeo: la evaluación pertenece tanto al alumno como a la
	// transcripción (docs/archive/probe-teach-split.md §2). Tarjeta simple v1.
	probe_done: ProbeDoneCard,
	// El conjunto del sistema de ficheros del alumno (fuentes v1): una tarjeta discreta
	// y desplegable de llamada a herramienta por cada una: una línea plegada (nombre de la herramienta + argumento
	// principal), con la entrada/salida completa al desplegar.
	read: ToolCallCard,
	ls: ToolCallCard,
	find: ToolCallCard,
	grep: ToolCallCard,
	// La pareja de práctica (2026-10-04): el planteamiento renderiza SOLO el enunciado
	// (el compromiso vive en los argumentos de la llamada y nunca se renderiza);
	// la conclusión lleva el resultado + el veredicto + la revelación.
	problem: ProblemCard,
	conclude: ConcludeCard,
	// Las herramientas de grafo del sondeador (oleada 7): la misma tarjeta discreta y desplegable:
	// una línea plegada (nombre de la herramienta + el id de sesión en
	// list_propositions) y, al desplegar, la salida compacta de la herramienta, una fila
	// por línea (nombre / nivel / fecha), tal cual; exactamente la misma disciplina que
	// read/ls (sus resultados también son cadenas ya formateadas).
	list_sessions: ToolCallCard,
	list_propositions: ToolCallCard,
};
