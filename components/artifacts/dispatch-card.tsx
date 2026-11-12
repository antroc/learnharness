"use client";

import { useContext } from "react";
import { CheckIcon, SettingsIcon, XIcon } from "lucide-react";
import { JobsContext } from "@/components/jobs-context";
import { ChatActionsContext } from "@/components/chat";
import { isModelsRefusal, isProviderKeyRefusal, type JobKind, type JobRecord } from "@/src/core";
import { BrailleSpinner } from "@/components/braille-spinner";

/**
 * La tarjeta de despacho (contracts.ts "THE ASYNC PROTOCOL" §4): el cuadro
 * de llamada a herramienta de un subagente en segundo plano. La salida de la
 * parte de herramienta es el ACUSE DE LANZAR Y OLVIDAR (una cadena), nunca el
 * resultado. El estado en directo viene del feed de tareas de la vista de
 * chat a través de JobsContext, emparejado por toolCallId:
 *
 *   tarea desconocida → pulso de "dispatched" (el feed de tareas aún no la ha visto)
 *   running           → tarjeta de actividad en directo (línea de actividad + tiempo transcurrido)
 *   done/error        → una línea discreta ("finished" / "failed"); el
 *                       artefacto en sí llega en el mensaje de reorientación
 *                       justo debajo, así que el cuadro no debe duplicarlo.
 */
const KIND_LABEL: Record<JobKind, string> = {
	research: "Research agent",
	demo: "Demo agent",
	visual: "Figure agent",
	pdf: "PDF reader",
	plugin: "Plugin worker",
};

export function DispatchCard({ toolCallId, kind }: { toolCallId: string; kind: JobKind }) {
	const jobs = useContext(JobsContext);
	const job = jobs.find((j) => j.toolCallId === toolCallId) ?? null;
	const label = kind === "plugin" ? job?.plugin?.label || job?.plugin?.toolName || KIND_LABEL.plugin : KIND_LABEL[kind];

	if (!job || job.status === "running") {
		return <DispatchActivityCard job={job} label={label} />;
	}
	// BYOK (responsable, 2026-09-22): una tarea rechazada por falta de modelos es INFORMACIÓN,
	// no un error que asuste: glifo gris + "needs model setup" + el enlace directo
	// al SetupDialog (el mismo flujo que usa la intercepción del envío).
	// El gemelo del rechazo por clave de proveedor (oleada de cero claves): un modelo fijado
	// cuya clave ha desaparecido se lee como que hace falta la clave; el enlace directo
	// cae por sí solo en la etapa de primera clave del SetupDialog.
	if (isModelsRefusal(job.error)) {
		return <DispatchRefusedCard label={label} line="needs model setup" button="Set up models" />;
	}
	if (isProviderKeyRefusal(job.error)) {
		return <DispatchRefusedCard label={label} line="needs a provider key" button="Add a key" />;
	}
	const failed = job.status === "error";
	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			data-testid="dispatch-settled"
		>
			{failed ? <XIcon className="size-3.5 text-error" /> : <CheckIcon className="size-3.5" />}
			<span className="font-medium uppercase tracking-wide">{label}</span>
			<span>{failed ? "failed" : "finished"}</span>
		</div>
	);
}

/** La tarjeta de rechazo: tono informativo discreto; nada en rojo, nada de "failed". */
function DispatchRefusedCard({ label, line, button }: { label: string; line: string; button: string }) {
	const ctx = useContext(ChatActionsContext);
	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			data-testid="dispatch-refused"
		>
			<SettingsIcon className="size-3.5" />
			<span className="font-medium uppercase tracking-wide">{label}</span>
			<span>{line}</span>
			{ctx && (
				<button
					type="button"
					data-testid="dispatch-setup-link"
					onClick={ctx.openSetup}
					className="ml-1 rounded-sm border border-border bg-card px-2 py-0.5 font-ui normal-case tracking-normal text-foreground transition-colors hover:border-muted-foreground/50"
				>
					{button}
				</button>
			)}
		</div>
	);
}

function DispatchActivityCard({ job, label }: { job: JobRecord | null; label: string }) {
	// Tiempo transcurrido desde createdAt; las tareas solo aparecen aquí a través del feed de tareas (tras montar),
	// así que no hay discrepancia de SSR/hidratación.
	const elapsed =
		job && job.createdAt ? Math.max(0, Math.round((Date.now() - Date.parse(job.createdAt)) / 1000)) : null;
	return (
		<div
			className="rounded-xl border bg-card p-4 text-card-foreground"
			data-testid="dispatch-card"
		>
			<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{/* La gramática del estado de trabajo (responsable, ronda de streaming
				    2026-10-01): el spinner Braille sustituye al punto pulsante; un único
				    indicador en todas partes. Este es el ÚNICO cambio de la tarjeta de
				    despacho; la forma de la tarjeta no se toca. */}
				<BrailleSpinner label={`${label} running`} />
				{label}
				{elapsed !== null && <span className="font-normal">· {elapsed}s</span>}
			</div>
			{job?.activity && (
				<div className="mt-1 truncate text-sm text-muted-foreground" data-testid="dispatch-activity-line">
					{job.activity}
				</div>
			)}
			{!job && (
				<div className="mt-1 text-sm text-muted-foreground" data-testid="dispatch-pending">
					Dispatched…
				</div>
			)}
		</div>
	);
}
