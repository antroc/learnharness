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
		/** Una herramienta ordinaria que tiene éxito puede devolver su resultado y pausar la ejecución. */
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
	/** Las identidades de entrada aceptadas evitan que un envío reintentado se ejecute dos veces. */
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
	/** Clasificación de iniciación/consentimiento, no de visibilidad en la vista.
	 * Por defecto es user para send/answer y background para run; clasifica de
	 * forma explícita el trabajo automático. */
	purpose?: PluginCallPurpose;
}
/** Conversaciones persistentes propiedad del plugin, independientes de las
 * vistas del frontend. Ejecutar el modelo puede tener coste. Vuelve a
 * registrar definiciones compatibles tras la activación; un reinicio
 * interrumpe el trabajo en curso en lugar de reproducir herramientas
 * automáticamente. */
export interface PluginAgentService {
	/** Registra instrucciones, modelo y herramientas para un ID de definición.
	 * Las definiciones no válidas o duplicadas lanzan. Devuelve una función para
	 * darla de baja que cancela de forma cooperativa las ejecuciones activas de
	 * esa definición sin borrar las conversaciones guardadas. */
	register(definition: PluginAgentDefinition): () => void;
	/** Persiste una conversación vacía en reposo y devuelve su instantánea
	 * desvinculada; no se inicia ninguna petición al modelo. Lanza si la
	 * definición no está disponible o si falla la persistencia. */
	create(definitionId: string): PluginAgentSnapshot;
	/** Devuelve instantáneas desvinculadas de las conversaciones de este plugin,
	 * incluidos los parciales efímeros actuales. No ejecuta, reanuda ni se
	 * suscribe a ninguna conversación. */
	list(): PluginAgentSnapshot[];
	/** Lee una instantánea desvinculada, incluido cualquier parcial actual. Los
	 * IDs desconocidos lanzan; un parcial devuelto es progreso, no historial
	 * confirmado. */
	get(id: string): PluginAgentSnapshot;
	/** Persiste texto de usuario explícito y no vacío y lanza la ejecución. Se
	 * resuelve tras la aceptación, no al terminar; observa después el estado y
	 * los errores con get/subscribe. Un requestId ya aceptado devuelve el estado
	 * actual sin otra entrada. Rechaza las sesiones ocupadas, las entradas
	 * externas sin resolver y los errores de aceptación/almacenamiento. */
	send(id: string, text: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Valida y persiste un resultado pendiente de herramienta de entrada. Las
	 * respuestas no válidas no se guardan; la última respuesta obligatoria lanza
	 * la continuación. Se resuelve al estado aceptado, no al terminar el modelo;
	 * los IDs de petición aceptados no se envían dos veces. Rechaza si faltan
	 * entradas/definiciones, si la sesión está ocupada y ante fallos de
	 * validación/almacenamiento. */
	answer(id: string, toolCallId: string, value: unknown, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Reanuda una entrada persistida ejecutable existente sin añadir un prompt
	 * sintético. Se resuelve tras la aceptación, no al terminar; los IDs de
	 * petición aceptados devuelven el estado actual. Rechaza entradas externas
	 * pendientes, lotes de herramientas sin resolver inseguros, sesiones
	 * ocupadas o historiales sin entrada ejecutable; usa send para una tarea
	 * explícita nueva. */
	run(id: string, options: PluginAgentInputOptions): Promise<PluginAgentSnapshot>;
	/** Solicita la cancelación cooperativa de una ejecución activa, conservando
	 * los mensajes y las entradas pendientes. Las ejecuciones en reposo no
	 * cambian. No espera al código de herramientas que no coopera ni deshace
	 * efectos externos; los IDs desconocidos y los fallos de persistencia
	 * lanzan. */
	abort(id: string): void;
	/** Entrega una instantánea desvinculada de forma síncrona y luego los cambios
	 * de estado/progreso en vivo. Devuelve una función para darse de baja; darse
	 * de baja nunca cancela la ejecución. Los IDs desconocidos lanzan; si el
	 * listener lanza en la entrega inicial, se elimina la suscripción. */
	subscribe(id: string, listener: (snapshot: PluginAgentSnapshot) => void): () => void;
	/** Cancela de forma cooperativa las ejecuciones propias y libera las
	 * definiciones/listeners, conservando los registros persistidos.
	 * Idempotente; no espera al código del plugin que no coopera. Rechaza si
	 * falla la persistencia de la cancelación. Desactivar en el host también
	 * libera. */
	dispose(): Promise<void>;
}
