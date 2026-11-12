import type { PluginFrontendContext } from "learnharness-plugin-api";
import { captureBackground } from "./capture.ts";
import { mountReference } from "./reference.ts";
import type { Draft } from "./state.ts";

// Lee la paleta seleccionada de la app, no la preferencia de color del sistema operativo.
const colors = ["--background", "--foreground", "--muted-foreground", "--border", "--lh-ink-strong", "--lh-ink-italic",
  "--lh-ink-code", "--lh-accent", "--card", "--lh-error", "--lh-success", "--lh-warning"];
export function appPalette(): { key: string; mode: "dark" | "light" } {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  const mode = root?.classList.contains("light") ? "light" : "dark";
  const style = root ? getComputedStyle(root) : undefined;
  return { mode, key: JSON.stringify([mode, ...colors.map(name => style?.getPropertyValue(name).trim() ?? "")]) };
}

/** Repinta solo la referencia original guardada, nunca la entrada actual de
 * la sesión. Los montajes fuera de pantalla son temporales; las dimensiones
 * y la cámara de la hoja se mantienen fijas. */
export async function recolorReference(draft: Draft, ctx: PluginFrontendContext, signal: AbortSignal): Promise<Pick<Draft, "background" | "backgroundColor">> {
  const root = document.createElement("div"); root.className = "drawing-pad-root";
  root.style.cssText = "position:fixed;inset:auto;left:-100000px;top:0;pointer-events:none";
  root.setAttribute("aria-hidden", "true"); document.body.append(root);
  let mounted: ReturnType<typeof mountReference> | undefined;
  try {
    const backgroundColor = getComputedStyle(root).backgroundColor;
    if (!draft.reference) return { background: "", backgroundColor };
    const reference = document.createElement("div"); reference.className = "drawing-pad-reference";
    reference.style.width = `${draft.width}px`; root.append(reference);
    mounted = mountReference(reference, ctx, draft.reference, signal);
    const captured = await captureBackground(reference, mounted.slots, draft.width, draft.height, backgroundColor, signal,
      { width: draft.width, height: draft.height, pixelRatio: draft.pixelRatio });
    return { background: captured.background, backgroundColor: captured.backgroundColor };
  } finally { mounted?.dispose(); root.remove(); }
}
