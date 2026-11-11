/** Solo presentación de árbol controlada: la identidad y el comportamiento siguen siendo propiedad del plugin. */
import type { PluginUiCallback, PluginUiContent } from "./plugin-ui.ts";

export type PluginTreeContent = string | PluginUiContent;
export interface PluginTreeColumn {
	key: string;
	header: PluginTreeContent;
	/** Anchura fija de la columna final: píxeles para números, anchura CSS para cadenas. */
	width: number | string;
	align?: "left" | "right";
}
export interface PluginTreeRow {
	/** Identidad de aparición globalmente única, independiente de las entidades representadas. */
	key: string;
	content: PluginTreeContent;
	cells?: Record<string, PluginTreeContent>;
	children?: readonly PluginTreeRow[];
	selection?: {
		label: string;
		checked: boolean;
		indeterminate?: boolean;
		disabled?: boolean;
		onChange: PluginUiCallback<boolean>;
	};
	disclosure?: {
		label: string;
		expanded: boolean;
		onChange: PluginUiCallback<boolean>;
	};
}
export interface PluginTreeProps {
	/** Nombre accesible; los encabezados visibles pertenecen al contenido de la cabecera o de la fila. */
	label: string;
	rows: readonly PluginTreeRow[];
	header?: PluginTreeContent;
	columns?: readonly PluginTreeColumn[];
}
