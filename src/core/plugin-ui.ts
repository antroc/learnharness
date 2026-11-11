/** Interfaz del host controlada y neutral respecto al framework. Ningún widget lee ni escribe el almacenamiento del plugin. */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PluginTreeProps } from "./plugin-tree.ts";

/** Callback de interacción invocado por el host; los fallos asíncronos se notifican,
 * no se aceptan como persistencia correcta. Los callbacks no cambian por sí solos los
 * valores controlados. */
export type PluginUiCallback<T = void> = (value: T) => void | Promise<void>;
/** Vida obligatoria del llamador, combinada con la activación del plugin y con la vida
 * de cualquier superficie del host propietaria. Pasa una señal por montaje para la
 * interfaz dentro de una vista. */
export interface PluginWidgetOptions { signal: AbortSignal }
/** Controla un registro/montaje; los manejadores no persisten valores del plugin. */
export interface PluginWidgetHandle<Props> {
	/** Fusiona superficialmente props y callbacks; sustituye enteros los objetos/arrays
	 * anidados. Publica de forma explícita los valores aceptados. Los manejadores
	 * liberados ignoran las actualizaciones; donde las props se validan, las
	 * actualizaciones no válidas lanzan antes de sustituir las props actuales. */
	update(props: Partial<Props>): void;
	/** Libera de forma idempotente este registro/montaje y sus recursos con ámbito.
	 * Las señales del contenido de la interfaz se abortan y se ejecuta la limpieza;
	 * liberar explícitamente un overlay no es una notificación de cierre por el
	 * usuario y no llama a onClose. */
	dispose(): void;
}
export interface PluginModelValue { provider: string; id: string }
export interface PluginModelPickerProps {
	value: PluginModelValue | undefined;
	onChange: PluginUiCallback<PluginModelValue>;
	disabled?: boolean;
}
export interface PluginKnowledgePickerProps {
	value: readonly string[];
	onChange: PluginUiCallback<readonly string[]>;
	disabled?: boolean;
}
export interface PluginThinkingPickerProps {
	model: PluginModelValue | undefined;
	value: ThinkingLevel | undefined;
	onChange: PluginUiCallback<ThinkingLevel>;
	disabled?: boolean;
}
export interface PluginComposerProps {
	value: string;
	onChange: PluginUiCallback<string>;
	onSend: () => void | Promise<void>;
	busy?: boolean;
	onStop?: () => void | Promise<void>;
	canSend?: boolean;
	placeholder?: string;
	autoFocus?: boolean;
}
export interface PluginDictationProps {
	disabled?: boolean;
	onTranscript: PluginUiCallback<string>;
}
export interface PluginDictationHandle extends PluginWidgetHandle<PluginDictationProps> {
	/** Empieza a grabar si está en reposo, o detiene la grabación y conserva el habla si
	 * está activa. Se permite un propietario de grabación por ventana; un inicio
	 * competidor notifica un error. */
	toggle(): void;
	/** Detiene esta grabación y espera a que se entregue la transcripción antes de
	 * enviar. No inicia la captura si está en reposo; los fallos de entrega pueden
	 * rechazar. Esto no envía un mensaje ni actualiza un compositor nativo oculto. */
	finish(): Promise<void>;
	/** Cancela la captura y descarta el habla almacenada en lugar de volcarla. No
	 * deshace el texto ya entregado mediante onTranscript. La liberación o la
	 * cancelación también cancelan. */
	cancel(): void;
}
export interface PluginStandardComposerProps {
	composer: PluginComposerProps;
	model: PluginModelPickerProps;
	thinking: PluginThinkingPickerProps;
	dictation: PluginDictationProps;
}
export interface PluginButtonColorState {
	background?: string;
	text?: string;
	border?: string;
}
/** Solo colores CSS; las sustituciones de estado se aplican en cascada por propiedad, no como paletas completas. */
export interface PluginButtonColors extends PluginButtonColorState {
	hover?: PluginButtonColorState;
	active?: PluginButtonColorState;
	focusVisible?: PluginButtonColorState & { ring?: string };
	disabled?: PluginButtonColorState;
}
export interface PluginButtonProps {
	/** Texto visible, o el nombre accesible cuando iconOnly es true. */
	label: string;
	/** Marcado SVG de confianza del plugin, mostrado de forma decorativa antes de la etiqueta. */
	icon?: string;
	/** Oculta el texto visible; exige una etiqueta no vacía y un icono. El tamaño sigue siendo independiente. */
	iconOnly?: boolean;
	onClick: () => void | Promise<void>;
	disabled?: boolean;
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "custom";
	/** Se valida en todas las variantes y solo se aplica a custom. Las actualizaciones sustituyen este objeto entero. */
	colors?: PluginButtonColors;
	size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
	title?: string;
}
/** Distintivo genérico de estilo nativo. Sin semántica de calificación ni colocación automática. */
export interface PluginBadgeProps {
	text: string;
	/** Color CSS para el texto y un tinte de fondo del 15 %. Omítelo para el distintivo neutro nativo. */
	color?: string;
}
/** El contenido sigue siendo propiedad del plugin; mount puede devolver una limpieza, también de forma asíncrona. */
export type PluginUiContent = HTMLElement | ((container: HTMLElement, signal: AbortSignal) => void | (() => void) | Promise<void | (() => void)>);
/** Render integrado de Markdown del host sin controles auxiliares ni widgets de bloques de código de plugins. */
export interface PluginMarkdownProps { text: string }
export interface PluginWorkerResultProps {
	label: string;
	status: "succeeded" | "failed" | "cancelled" | "interrupted";
	text: string;
	content?: PluginUiContent;
	presentation?: "collapsed" | "card" | "plain";
}
declare const pluginSurfaceTargetBrand: unique symbol;
/** Identidad opaca creada por el host para el cuerpo de una página del host montada. */
export interface PluginSurfaceTarget { readonly [pluginSurfaceTargetBrand]: true }
/** Contenido de overlay del cuerpo de la página, no un diálogo modal ni un sustituto
 * de la barra superior/lateral. El cierre por el usuario notifica a onClose; no es un
 * veto asíncrono. La cancelación/liberación programática hace la limpieza sin
 * notificación de cierre. */
export interface PluginSurfaceProps {
	/** Solo nombre accesible; los encabezados visibles pertenecen al contenido del plugin. */
	title: string;
	/** Por defecto, el fondo translúcido y difuminado al estilo de Chains. */
	background?: "dimmed" | "opaque";
	content: PluginUiContent;
	onClose?: () => void | Promise<void>;
}
/** Contenido modal con gestión del cierre/foco por el host y sin fila de título
 * visible del host. El cierre por el usuario notifica a onClose, no es un veto
 * asíncrono; la liberación/cancelación solo limpia. */
export interface PluginDialogProps {
	/** Solo nombre accesible; los encabezados visibles pertenecen al contenido del plugin. */
	title: string;
	content: PluginUiContent;
	onClose?: () => void | Promise<void>;
}
export interface PluginMenuItem {
	key: string;
	label: string;
	disabled?: boolean;
	onSelect: () => void | Promise<void>;
}
export interface PluginMenuProps {
	items: PluginMenuItem[];
	label?: string;
	preferredSide?: "up" | "down";
	onClose?: () => void | Promise<void>;
}
interface PluginSettingsRowBase<T> {
	key: string;
	label: string;
	description?: string;
	value: T;
	onChange: PluginUiCallback<T>;
	validate?: (value: T) => string | undefined;
	disabled?: boolean;
}
export type PluginSettingsRow =
	| (PluginSettingsRowBase<boolean> & { type: "toggle" })
	| (PluginSettingsRowBase<string> & { type: "text" })
	| (PluginSettingsRowBase<string> & { type: "dropdown"; options: { value: string; label: string }[] })
	| (PluginSettingsRowBase<number> & { type: "number" | "slider"; min?: number; max?: number; step?: number });
export interface PluginSettingsSchema { rows: PluginSettingsRow[] }
/** Presentación controlada del host: los plugins son propietarios de los valores, la
 * persistencia y las actualizaciones de los valores aceptados. Cada método devuelve un
 * manejador de actualización superficial y liberación idempotente, con ámbito en
 * options.signal más la activación; los ámbitos cancelados producen manejadores inertes.
 * El host informa de los fallos de interacción asíncronos; no se guardan en silencio. */
export interface PluginUi {
	/** Monta la selección de modelo del catálogo del host; devuelve un manejador de selector
	 * controlado. No cambia los valores por defecto del núcleo, no refresca cuentas en silencio
	 * ni elige una alternativa. */
	mountModelPicker(container: HTMLElement, props: PluginModelPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginModelPickerProps>;
	/** Monta la selección del nivel de razonamiento para el modelo y el valor indicados. Devuelve
	 * un manejador controlado; seleccionar por sí solo no actualiza los ajustes del plugin ni del
	 * núcleo. */
	mountThinkingPicker(container: HTMLElement, props: PluginThinkingPickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginThinkingPickerProps>;
	/** Monta la burbuja nativa de selección de conocimiento o el selector de Chains. Refleja
	 * onChange de inmediato mediante el manejador devuelto; Hecho/X/Escape no descartan la
	 * selección. El host gestiona el origen, el foco y la vida del selector; no se añade ninguna
	 * API de escritura en el grafo. */
	mountKnowledgePicker(container: HTMLElement, props: PluginKnowledgePickerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginKnowledgePickerProps>;
	/** Monta un compositor de texto controlado con callbacks de envío y detención y devuelve su
	 * manejador. No se añade gestión por defecto de adjuntos o de soltar ficheros ni despacho al
	 * modelo; quien lo use de forma independiente coordina por su cuenta la finalización del
	 * dictado. */
	mountComposer(container: HTMLElement, props: PluginComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginComposerProps>;
	/** Monta el dictado nativo solo hacia onTranscript; devuelve update/dispose más los controles
	 * toggle/finish/cancel. La cancelación o la liberación cancelan la captura. El dictado nunca
	 * va a un compositor nativo oculto; la propiedad de la grabación es por ventana. */
	mountDictation(container: HTMLElement, props: PluginDictationProps, options: PluginWidgetOptions): PluginDictationHandle;
	/** Monta una entrada de texto con controles de modelo, razonamiento y dictado. Termina el
	 * dictado antes de onSend; no incluye controles de adjuntos, de uso ni de práctica. Devuelve
	 * un manejador controlado; al actualizar, sustituye completas las props de los controles
	 * anidados. */
	mountStandardComposer(container: HTMLElement, props: PluginStandardComposerProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginStandardComposerProps>;
	/** Monta un botón de estilo nativo y devuelve su manejador. El SVG es marcado de confianza del
	 * plugin. Las combinaciones no válidas de etiqueta, icono y color lanzan una excepción al
	 * montar o actualizar; las actualizaciones se rechazan de forma atómica. onClick no persiste
	 * ni despacha nada implícitamente. */
	mountButton(container: HTMLElement, props: PluginButtonProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginButtonProps>;
	/** Monta un distintivo de estado de texto plano, no de calificación ni de colocación
	 * automática. Devuelve un manejador de actualización y liberación; las props de texto o color
	 * no válidas se rechazan de forma atómica. */
	mountBadge(container: HTMLElement, props: PluginBadgeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginBadgeProps>;
	/** Monta campos de ajustes controlados y devuelve su manejador; no hay lecturas ni guardados
	 * automáticos. Los fallos de validación o de rango se quedan en línea sin persistencia de
	 * onChange; los guardados asíncronos pendientes desactivan su fila y los fallos se muestran. */
	mountSettingsRows(container: HTMLElement, props: PluginSettingsSchema, options: PluginWidgetOptions): PluginWidgetHandle<PluginSettingsSchema>;
	/** Monta Markdown completo mediante el render integrado del host, incluidas matemáticas y
	 * código, sin controles auxiliares ni renderizadores de bloques cercados registrados por
	 * plugins. Devuelve un manejador de actualización de texto y liberación; no se inicia trabajo
	 * de modelo, de almacenamiento ni de workers. */
	mountMarkdown(container: HTMLElement, props: PluginMarkdownProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMarkdownProps>;
	/** Monta una jerarquía accesible y controlada, no un controlador de ficheros o mazos. Devuelve
	 * un manejador; los árboles no válidos lanzan una excepción al montar o actualizar. Plegar,
	 * eliminar o sustituir limpia los montajes de contenido afectados, así que conserva los
	 * borradores en el estado del plugin. */
	mountTree(container: HTMLElement, tree: PluginTreeProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginTreeProps>;
	/** Monta la presentación de un resultado terminal de worker y devuelve su manejador. Solo
	 * representa el estado, el texto y el contenido aportados; no inicia, espera ni cancela
	 * ninguna tarea. El contenido opcional tiene ámbito en la señal y se limpia al sustituirlo o
	 * liberarlo. */
	mountWorkerResult(container: HTMLElement, props: PluginWorkerResultProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginWorkerResultProps>;
	/** Abre un menú anclado y devuelve su manejador. El mismo propietario de interfaz + el mismo
	 * ancla exacto cierran un menú existente, llaman una vez a su onClose más reciente y devuelven
	 * un manejador inerte. Los demás propietarios y anclas son independientes. La cancelación o
	 * la liberación no llaman a onClose; las anclas desconectadas o los ámbitos caducados
	 * devuelven manejadores inertes. */
	openMenu(anchor: HTMLElement, props: PluginMenuProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginMenuProps>;
	/** Abre un modal con título accesible y contenido propiedad del plugin; devuelve su manejador.
	 * El contenido recibe una señal de montaje y limpieza síncrona o asíncrona. El host es
	 * propietario del cierre, de Escape y del foco; el título no crea un encabezado visible. */
	openDialog(props: PluginDialogProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginDialogProps>;
	/** Captura una vez la página activa del host, para toda la vida de esta superficie; devuelve un
	 * manejador de overlay. Salir de la página u ocultarla la hace caducar, no una página
	 * posterior tras los await. Si falta un límite vivo se lanza una excepción; las señales ya
	 * canceladas devuelven antes manejadores inertes. */
	openSurface(props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
	/** Se vincula explícitamente a una instancia de página existente, incluidos los destinos
	 * de envío nativos; devuelve un manejador de overlay. Los destinos son opacos, no
	 * persistentes y no reviven al volver a entrar. Los destinos ausentes o caducados lanzan
	 * una excepción salvo que ya estén cancelados; los cuerpos cubiertos siguen montados, con
	 * el apilamiento, la interacción y el foco gestionados por el host. */
	openSurface(target: PluginSurfaceTarget, props: PluginSurfaceProps, options: PluginWidgetOptions): PluginWidgetHandle<PluginSurfaceProps>;
}
