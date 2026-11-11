import type { Api, Model } from "@earendil-works/pi-ai";

/** Los ID nativos del SDK se mantienen distintos de las rutas de conexión persistidas de la app. */
export type NativeSubscriptionProviderId = "github-copilot" | "xai";
export type NativeSubscriptionLogicalId = "github-copilot-subscription" | "xai-subscription";

export const NATIVE_SUBSCRIPTIONS = [
	{ providerId: "github-copilot", logicalId: "github-copilot-subscription", label: "GitHub Copilot" },
	{ providerId: "xai", logicalId: "xai-subscription", label: "Grok" },
] as const;

export interface SubscriptionPrompt {
	id: string;
	type: "text" | "secret" | "select" | "manual_code";
	message: string;
	placeholder?: string;
	options?: readonly { id: string; label: string; description?: string }[];
}

/** Solo los códigos de usuario de dispositivo públicos, nunca el device_code privado ni los tokens. */
export interface SubscriptionInteraction {
	attemptId: string;
	prompt?: SubscriptionPrompt;
	browser?: { id: string; url: string };
	userCode?: string;
	progress?: string;
}

export interface NativeSubscriptionStatus {
	providerId: NativeSubscriptionProviderId;
	available: boolean;
	connected: boolean;
	pending: boolean;
	committing?: boolean;
	allowBackgroundUse: boolean;
	connectionId: string | null;
	epoch: number;
	authorityRevision: number;
	revision: number;
	error?: string;
	interaction?: SubscriptionInteraction;
}

/** El IPC privado heredado también lleva metadatos de catálogo seguros y soportados por el SDK. */
export interface NativeSubscriptionSnapshot {
	statuses: NativeSubscriptionStatus[];
	models: Partial<Record<NativeSubscriptionProviderId, Model<Api>[]>>;
}

export interface NativeSubscriptionScope {
	providerId: NativeSubscriptionProviderId;
	connectionId: string;
	epoch: number;
	authorityRevision: number;
	selectedModelId: string;
}

export interface NativeSubscriptionControlBridge {
	status(): Promise<NativeSubscriptionStatus[]>;
	login(providerId: NativeSubscriptionProviderId, enabled?: boolean): Promise<void>;
	cancel(providerId: NativeSubscriptionProviderId): Promise<void>;
	respond(providerId: NativeSubscriptionProviderId, attemptId: string, promptId: string, value: string): Promise<void>;
	open(providerId: NativeSubscriptionProviderId, attemptId: string, actionId: string): Promise<void>;
	retry(providerId: NativeSubscriptionProviderId): Promise<void>;
	disconnect(providerId: NativeSubscriptionProviderId): Promise<void>;
	consent(providerId: NativeSubscriptionProviderId, enabled: boolean): Promise<void>;
	onChange(listener: () => void): () => void;
}
