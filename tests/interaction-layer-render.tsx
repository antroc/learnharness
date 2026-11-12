import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";

/** Los renderizados independientes finos comparten el mismo contexto de interacción que AppShell. */
export function renderWithInteractionLayers(node: ReactNode) {
	return renderToStaticMarkup(<InteractionLayersProvider>{node}</InteractionLayersProvider>);
}
