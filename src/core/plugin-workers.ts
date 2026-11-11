/** Tareas orientadas a resultados propiedad de un plugin. La ejecución usa el runner nativo de Pi. */
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";
import type { JobUsage } from "./contracts/jobs.ts";
import type { PluginCallPurpose, PluginModelSpec } from "./plugin-agents.ts";
import type { PluginInferenceOptions, PluginToolContext } from "./plugins.ts";

export interface PluginWorkerContext {
	readonly taskId: string;
	/** Entrada aceptada inmutable, nunca una identidad aportada por el resultado del modelo. */
	readonly input: unknown;
	/** Cancelación ligada a la vida de la tarea. Las herramientas deben cooperar y volver a
	 * comprobarla tras cada await antes de producir efectos secundarios; la cancelación no puede
	 * deshacer efectos externos. */
	readonly signal: AbortSignal;
}
export interface PluginWorkerDefinition {
	id: string;
	instructions: string;
	/** El host expone submit_result({ result: <este esquema> }). */
	resultSchema: TSchema;
	/** Crea las herramientas nativas para esta tarea aceptada; el envío del resultado es propiedad del host. */
	tools?: (context: PluginWorkerContext) => AgentTool<any>[];
	/** Lanza una excepción con una corrección útil. Este validador no debe tener efectos secundarios. */
	validateResult?: (result: unknown, context: PluginWorkerContext) => void | Promise<void>;
}
export interface PluginWorkerStartOptions {
	/** Los reintentos de la misma aceptación usan el mismo id; un intento nuevo usa un id nuevo. */
	requestId: string;
	input: unknown;
	prompt: string;
	model: PluginModelSpec;
	purpose: PluginCallPurpose;
	/** Número máximo de turnos del modelo, incluidos los de corrección. Sin valor por defecto implícito. */
	maxTurns: number;
	options?: PluginInferenceOptions;
	/** Duración en tiempo real desde la aceptación, incluidas las esperas de admisión. */
	timeoutMs?: number;
}
export type PluginTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface PluginTaskError {
	code: "no_result" | "max_turns" | "timeout" | "run_error" | "storage_error" | "cancelled" | "interrupted";
	message: string;
}
export interface PluginTaskRecord extends PluginWorkerStartOptions {
	version: 1;
	id: string;
	definitionId: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	status: PluginTaskStatus;
	messages: AgentMessage[];
	turns: number;
	activity?: string;
	usage?: JobUsage;
	/** Solo es autoritativo cuando status es succeeded; los valores JSON falsy son válidos. */
	result?: unknown;
	error?: PluginTaskError;
}
export interface PluginTaskSnapshot extends PluginTaskRecord {
	/** Progreso efímero en streaming, no historial confirmado ni un resultado. */
	partial?: AssistantMessage;
}
export type PluginTaskOutcome =
	| { id: string; status: "succeeded"; result: unknown }
	| { id: string; status: "failed" | "cancelled" | "interrupted"; error: PluginTaskError };
/** Un adaptador fino de herramientas nativas, no otro framework de ejecución de agentes o de herramientas. */
export type PluginBackgroundTool<T extends TSchema = TSchema> = Omit<AgentTool<T>, "execute"> & {
	workerId: string;
	/** Deriva la entrada del worker, el prompt y los límites explícitos sin efectos
	 * secundarios. El host aporta la identidad de la petición y fuerza el propósito background. */
	prepare(input: Static<T>, context: PluginToolContext):
		Omit<PluginWorkerStartOptions, "requestId" | "purpose"> | Promise<Omit<PluginWorkerStartOptions, "requestId" | "purpose">>;
	/** Convierte un resultado terminal en texto para el modelo y datos opcionales para representar;
	 * mantenlo sin efectos secundarios. Un fallo registra un error de presentación, no un
	 * resultado distinto de la tarea; la entrega tras un reinicio puede usar una alternativa
	 * persistida sin volver a ejecutarlo. */
	format(outcome: PluginTaskOutcome, context: PluginToolContext): PluginBackgroundPresentation | Promise<PluginBackgroundPresentation>;
};
export interface PluginBackgroundPresentation {
	text: string;
	data?: unknown;
}
/** Se persiste en el resultado normal de la tarea en segundo plano y en el marcador de la conversación. */
export interface PluginBackgroundResult extends PluginBackgroundPresentation {
	pluginId: string;
	toolName: string;
	input: unknown;
	outcome: PluginTaskOutcome;
	/** Un fallo de presentación no cambia retroactivamente el éxito del worker. */
	formatError?: string;
}
export interface PluginBackgroundMeta {
	pluginId: string;
	taskId: string;
	status: PluginTaskOutcome["status"];
}
/** Tareas acotadas propiedad del plugin; la ejecución del modelo puede tener coste. La vida de
 * la tarea es independiente de las vistas y suscripciones. Desactivar o reiniciar interrumpe
 * las tareas sin terminar; la reactivación no las vuelve a ejecutar. */
export interface PluginWorkerService {
	/** Registra instrucciones, esquema del resultado y, opcionalmente, herramientas y un validador
	 * de refinamiento. Las definiciones no válidas o duplicadas lanzan una excepción. Devuelve una
	 * función para anular el registro que interrumpe las tareas sin terminar de esta definición,
	 * conservando sus registros. */
	register(definition: PluginWorkerDefinition): () => void;
	/** Persiste una aceptación duradera y devuelve una instantánea en cola, no el final.
	 * La ejecución del modelo y de las herramientas avanza con independencia de las vistas. Un ID
	 * de petición y unas opciones idénticos devuelven la tarea existente; reutilizarlos de forma
	 * conflictiva lanza una excepción. Las entradas no válidas, las definiciones inexistentes y
	 * los fallos de persistencia de la aceptación lanzan una excepción de forma síncrona. */
	start(definitionId: string, options: PluginWorkerStartOptions): PluginTaskSnapshot;
	/** Devuelve instantáneas independientes de las tareas propias, incluido el progreso efímero;
	 * listar no inicia ni reanuda trabajo. */
	list(): PluginTaskSnapshot[];
	/** Devuelve una instantánea independiente de la tarea. Los IDs desconocidos lanzan una
	 * excepción; solo el estado succeeded hace autoritativo el resultado, incluidos los resultados
	 * JSON falsy. */
	get(id: string): PluginTaskSnapshot;
	/** Entrega una instantánea de forma síncrona y, después, los cambios en vivo de estado y
	 * progreso. Devuelve una función para cancelar la suscripción, no un mecanismo para cancelar
	 * la tarea. Los IDs desconocidos lanzan una excepción; si el listener lanza una excepción en
	 * la entrega inicial, se elimina la suscripción. */
	subscribe(id: string, listener: (snapshot: PluginTaskSnapshot) => void): () => void;
	/** Resuelve el resultado terminal, incluidos los estados failed/cancelled/interrupted; que la
	 * tarea falle no hace que la espera se rechace. Una señal abortada rechaza con AbortError y
	 * detiene solo esta espera, no la tarea. Los fallos de almacenamiento pueden producir un
	 * rechazo, y un ID de tarea desconocido lanza una excepción antes de esperar. */
	wait(id: string, signal?: AbortSignal): Promise<PluginTaskOutcome>;
	/** Persiste el estado cancelled para el trabajo sin terminar y señala la cancelación
	 * cooperativa. Las tareas terminadas no cambian; los efectos externos no pueden deshacerse.
	 * Los IDs desconocidos y los fallos de persistencia lanzan una excepción. */
	cancel(id: string): void;
	/** Interrumpe las tareas sin terminar, borra definiciones y listeners y cancela los ámbitos de
	 * las tareas, conservando el historial y los resultados; nunca vuelve a ejecutarlas al
	 * reactivar. Es idempotente y no espera a las herramientas que no cooperen. Los fallos de
	 * persistencia producen un rechazo. Desactivar el plugin en el host también libera este
	 * servicio. */
	dispose(): Promise<void>;
}
