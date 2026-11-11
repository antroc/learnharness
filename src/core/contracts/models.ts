/**
 * Contratos del catálogo de modelos (oleada de control de modelos, 2026-09-12): las formas
 * seguras para el cliente de las respuestas de GET /api/models y PUT /api/chats/[id]/settings.
 * Tipos puros; la proyección del servidor vive en src/server/model-catalog.ts
 * (que es DUEÑO de estas formas: el contrato se define aquí solo para que los componentes
 * del cliente nunca importen de la banda del servidor).
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { BackgroundModelRole, ModelSlotName, ModelSlot } from "../settings.ts";

/** Una fila del selector: todo lo que la interfaz muestra de un modelo, proyectado desde
 *  el catálogo de pi-ai. Los costes son USD por 1M de tokens (el mismo catálogo, las mismas
 *  unidades que la calculadora de precios del lado del servidor de Pi). */
export interface ModelCatalogEntry {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	/** Niveles de razonamiento que acepta este modelo, según el catálogo del host. */
	supportedLevels: ThinkingLevel[];
	/** Null cuando LearnHarness no puede estimar los precios de esta conexión. */
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
	/** Null para los alias de CLI nativos cuyos límites efectivos dependen de la sesión. */
	contextWindow: number | null;
	maxTokens: number | null;
}

/** Valor por defecto de conversación resuelto desde el hueco potente, usado para las sesiones nuevas
 * y como respaldo para las sesiones sin elecciones propias. Un nivel de razonamiento omitido
 * se elige según la preferencia de niveles soportados del host al construir el motor. */
export interface CatalogDefaults {
	model: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}

/** Elección de modelo resuelta por rol en segundo plano: sustitución del rol y, si no, su hueco
 * de nivel asignado. Null significa que no hay modelo configurado y que el trabajo que requiere ese rol
 * no está disponible; no hay respaldo implícito a un modelo de fábrica. */
export type RolePins = Record<
	BackgroundModelRole,
	{ model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null
>;

/** Elección de modelo resuelta para cada nivel de hueco. Null significa que ese nivel no tiene modelo;
 * las entradas configuradas incluyen preferencias opcionales de razonamiento y de retención de caché. */
export type SlotPins = Record<ModelSlotName, (ModelSlot & { model: { provider: string; id: string } }) | null>;

/** Respuesta de GET /api/models. */
export interface ModelCatalogResponse {
	models: ModelCatalogEntry[];
	/** Valor por defecto de conversación del hueco potente, o null cuando no hay modelo por defecto
	 * configurado. La elección explícita de modelo de una sesión se resuelve por separado. */
	defaults: CatalogDefaults | null;
	/** Modelos de los roles en segundo plano resueltos, con la misma resolución que la ejecución.
	 * Cada rol sin configurar es null. */
	rolePins: RolePins;
	/** Elecciones resueltas de los huecos potente/barato/visión, null para cada nivel sin definir.
	 * Las sustituciones por rol se representan en rolePins, no en estos valores de hueco. */
	slots: SlotPins;
	/** Filas de proveedores/conexiones con indicadores de disponibilidad, incluidos los proveedores
	 * desconectados cuando el host los expone. No garantiza que cada
	 * proveedor tenga ahora modelos seleccionables; consulta models y keyPresent. */
	providers: CatalogProvider[];
}

/** Una fila de la superficie de proveedores. */
export interface CatalogProvider {
	id: string;
	/** Nombre de la variable de entorno de la credencial; vacío en las rutas de suscripción/CLI nativa. */
	envVar: string;
	/** Indicador de disponibilidad de credencial/conexión del host, no una comprobación remota de salud.
	 * Las conexiones personalizadas sin clave pueden estar disponibles sin clave de API. */
	keyPresent: boolean;
}