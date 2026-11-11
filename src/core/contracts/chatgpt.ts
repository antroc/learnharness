/** Solo estado seguro para el cliente. Las credenciales y los datos de transacción OAuth nunca entran en este contrato. */
export interface ChatGPTStatus {
	available: boolean;
	pending: boolean;
	/** Permiso de ChatGPT en segundo plano para toda la app, independiente de la cuenta seleccionada. */
	allowBackgroundUse: boolean;
	activeId: string | null;
	accounts: {
		id: string; email: string; registration: string; connected: boolean; planEnabled?: boolean;
		/** Elegibilidad para recuperar la autorización, propiedad del proceso main. Ausente significa desconocido, no elegible.
		 * False para fallos de almacenamiento, conexiones en pausa/cerradas y autorizaciones en buen estado. */
		canSignInAgain?: boolean;
	}[];
	error: string | null;
	catalogError?: string | null;
}
export interface ChatGPTControlBridge {
	status(): Promise<ChatGPTStatus>;
	login(id?: string): Promise<ChatGPTStatus>;
	cancel(): Promise<ChatGPTStatus>;
	select(id: string): Promise<ChatGPTStatus>;
	/** Olvida explícitamente todo registro/credencial local de esta identidad verificada. */
	disconnect(id: string): Promise<ChatGPTStatus>;
	logout(id: string): Promise<ChatGPTStatus>;
	consent(enabled: boolean): Promise<ChatGPTStatus>;
	onChange(callback: () => void): () => void;
}
