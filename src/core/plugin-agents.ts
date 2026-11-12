/** Contrato público de agentes gestionados. Los registros pertenecen a un plugin, nunca a data/chats. */
import type { AgentMessage, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import type { ChatSettings } from "./contracts/chat.ts";

export type PluginModelSpec = NonNullable<ChatSettings["model"]> & { thinkingLevel?: ChatSettings["thinkingLevel"] };
export type PluginCallPurpose = "user" | "background";
export type PluginAgentTool = {
	name: string;
	description: string;
	parameters: TSchema;
	prepareArguments?: AgentTool<any>["prepareArguments"];
	resultSchema?: TSchema;
	formatResult?: (value: unknown) => AgentToolResult<unknown>;
} & (
	| {
		/** La entrada externa declarativa se persiste; nunca es una Promise suspendida. */
		kind: "input";
		execute?: never;
		endRun?: never;
	}
	| {
		kind?: "server";
		execute: AgentTool<any>["execute"];
		/** Una herramienta ordinaria que termina bien puede devolver su resultado y pausar la ejecución. */
		endRun?: boolean;
	}
);
export interface PluginAgentDefinition {
	id: string;
	instructions: string;
	model: PluginModelSpec;
	tools?: PluginAgentTool[];
	maxTurns?: number;
}
export interface PluginPendingInput {
	toolCallId: string;
	toolName: string;
	input: unknown;
}
export interface PluginAgentRecord {
	version: 1;
	id: string;
	definitionId: string;
	createdAt: string;
	updatedAt: string;
	messages: AgentMessage[];
	pending: PluginPendingInput[];
	status: "idle" | "running" | "waiting" | "error" | "interrupted";
	error?: string;
	/** Las identidades de entrada aceptadas impiden que un envío reintentado se ejecute dos veces. */
	acceptedInputs: string[];
}
export interface PluginAgentSnapshot extends PluginAgentRecord {
	/** Respuesta efímera hasta el momento; nunca se confunde con el historial confirmado. */
	partial?: AssistantMessage;
}
export interface PluginAgentInputOptions {
	/** Reintenta una acción aceptada con la misma identidad para no aceptarla dos
	 * veces; una acción nueva necesita un ID nuevo. Esto no garantiza efectos
	 * externos exactamente una vez. */
	requestId: string;
	/** Clasificación de iniciación y consentimiento, no de visibilidad en la
	 * vista. Por defecto es user para send/answer y background para run;
	 * clasifica explícitamente el trabajo automático. */
	purpose?: PluginCallPurpose;
}
/** Conversaciones persistentes propiedad del plugin, independientes de las
 * vistas del frontend. La ejecución del modelo puede tener coste. Vuelve a
 * registrar definiciones compatibles tras la activación; un reinicio
 * interrumpe el trabajo en curso en lugar de volver a ejecutar herramientas
 * automáticamente. */
export interface PluginAgentService {
	/** Registra instrucciones, modelo y herramientas para un ID de definición.
	 * Las definiciones no válidas o duplicadas lanzan una excepción. Devuelve
	 * una función para anular el registro que cancela cooperativamente las
	 * ejecuciones activas de esa definición sin borrar las conversaciones
	 * guardadas. */
	register(definition: PluginAgentDefinition): () => void;
	/** Persiste una conversación vacía e inactiva y devuelve su instantánea
	 * independiente; no se inicia ninguna petición al modelo. Lanza una
	 * excepción si la definición no está disponible o falla la persistencia. */
	create(definitionId: string): PluginAgentSnapshot;
	/** Devuelve instantáneas independientes de las conversaciones de este plugin,
	 * incluidos los parciales efímeros actuales. No ejecuta, reanuda ni se
	 * suscribe a ninguna conversación. */
	list(): PluginAgentSnapshot[];
	/** Lee una instantánea independiente, incluido cualquier parcial actual. Los
	 * ID desconocidos lanzan una excepción; un parcial devuelto es progreso, no
	 * historial confirmado. */
	get(id: string): PluginAgentSnapshot;
	/** Persiste texto explícito y no vacío del usuario y lanza la ejecución. Se
	 * resuelve tras la aceptación, no al terminar; observa después el estado y
	 * los errores con get/subscribe. Un requestId ya aceptado devuelve el estado
	 * actual sin otra entrada. Rechaza las sesiones ocupadas, las entradas
	 * externas sin resolver y los errores de aceptación o almacenamiento. */
	send(id: string, text: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Valida y persiste el resultado de una herramienta de entrada pendiente.
	 * Las respuestas no válidas no se guardan; la última respuesta requerida
	 * lanza la continuación. Se resuelve con el estado aceptado, no al terminar
	 * el modelo; los ID de petición aceptados no se envían dos veces. Las
	 * entradas o definiciones inexistentes, las sesiones ocupadas y los fallos
	 * de validación o almacenamiento producen un rechazo. */
	answer(id: string, toolCallId: string, value: unknown, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Reanuda una entrada persistida existente que pueda ejecutarse sin añadir
	 * un prompt sintético. Se resuelve tras la aceptación, no al terminar; los
	 * ID de petición aceptados devuelven el estado actual. Rechaza las entradas
	 * externas pendientes, los lotes de herramientas sin resolver que no sean
	 * seguros, las sesiones ocupadas o el historial sin entrada ejecutable; usa
	 * send para una tarea explícita nueva. */
	run(id: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Solicita la cancelación cooperativa de una ejecución activa, conservando
	 * los mensajes y las entradas pendientes. Las ejecuciones inactivas no
	 * cambian. No espera al código de herramientas que no coopere ni deshace
	 * efectos externos; los ID desconocidos y los fallos de persistencia lanzan
	 * una excepción. */
	abort(id: string): void;
	/** Entrega una instantánea independiente de forma síncrona y, después, los
	 * cambios en vivo de estado y progreso. Devuelve una función para cancelar
	 * la suscripción; cancelarla nunca cancela la ejecución. Los ID desconocidos
	 * lanzan una excepción; si el listener lanza una excepción en la entrega
	 * inicial, se elimina la suscripción. */
	subscribe(id: string, listener: (snapshot: PluginAgentSnapshot) => void): () => void;
	/** Cancela cooperativamente las ejecuciones propias y libera definiciones y
	 * listeners, conservando los registros persistidos. Es idempotente; no
	 * espera al código del plugin que no coopere. Se rechaza si falla la
	 * persistencia de la cancelación. Desactivar el plugin en el host también lo
	 * libera. */
	dispose(): Promise<void>;
}
