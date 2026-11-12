import { DEFAULT_DARK_INK_COLOR, DEFAULT_IMAGE_SCALE } from "./settings.ts";
import type { Reference } from "./reference.ts";
import { inkSignature, visibleStrokes, type Stroke, type Tool } from "./strokes.ts";

export interface Draft {
  id: number;
  revision: number;
  /** Ráster de la referencia sola; vacío en las hojas en blanco. Sin viewport incorporado. */
  background: string;
  backgroundColor: string;
  /** Tinta emparejada con este ráster, independiente de otros repintados pendientes de la hoja. */
  color: string;
  /** El contenido original visible para el alumno y la paleta usada para este ráster. */
  reference?: Reference;
  palette?: string;
  width: number;
  height: number;
  pixelRatio: number;
  strokes: Stroke[];
  hasInk: boolean;
}
export interface SessionSheet {
  readonly id: string;
  readonly kind: "teaching" | "practice";
  draft?: Draft;
  tool: Tool;
  pan: { x: number; y: number };
  readonly seenPoses: Set<string>;
  sentSignature: string;
  readTicket: number;
}
export interface Capture { session: SessionSheet; draft: Draft; signature: string; color: string; imageScale: number; sendImage: boolean }

/** Solo de la ventana. Sin almacenamiento, análisis de navegación ni reconstrucción de la entrada del host. */
export class Sheets {
  readonly sessions = new Map<string, SessionSheet>();
  color = DEFAULT_DARK_INK_COLOR;
  imageScale = DEFAULT_IMAGE_SCALE;
  private nextId = 0;
  private readonly listeners = new Set<() => void>();
  private readonly signatures = new WeakMap<Draft, string>();
  constructor(private readonly changed: () => void, private readonly newProblem: (session: SessionSheet) => void,
    private readonly currentColor: () => string = () => this.color) {}
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(): void { this.changed(); for (const listener of this.listeners) listener(); }
  session(id: string, kind: SessionSheet["kind"]): SessionSheet {
    let state = this.sessions.get(id);
    if (!state) {
      state = { id, kind, tool: "pen", pan: { x: 0, y: 0 }, seenPoses: new Set(), sentSignature: "", readTicket: 0 };
      this.sessions.set(id, state);
    }
    if (state.kind !== kind) throw new Error("Drawing session kind changed.");
    return state;
  }
  setColor(color: string): void {
    if (this.color === color && [...this.sessions.values()].every(state => !state.draft || state.draft.color === color)) return;
    this.color = color;
    for (const state of this.sessions.values()) if (state.draft && state.draft.color !== color)
      state.draft = { ...state.draft, color, revision: state.draft.revision + 1 };
    this.publish();
  }
  /** Las preferencias aceptadas pueden volver a colorear hojas ya al día sin
   * esperar a trabajo ajeno de referencias. Los rásteres más antiguos
   * conservan su propia tinta emparejada. */
  setInkForPalette(color: string, palette: string): void {
    let changed = false;
    for (const state of this.sessions.values()) if (state.draft?.palette === palette && state.draft.color !== color) {
      state.draft = { ...state.draft, color, revision: state.draft.revision + 1 }; changed = true;
    }
    if (changed) this.publish();
  }
  /** Empareja de forma atómica los fondos de referencia vueltos a renderizar
   * con su tinta correspondiente. Se fusiona en el último borrador para
   * conservar lo dibujado durante la rasterización. */
  setPalette(color: string, palette: string, backgrounds: ReadonlyMap<SessionSheet, { id: number; background: string; backgroundColor: string }>): void {
    const recolor = this.color !== color;
    let changed = recolor;
    this.color = color;
    for (const state of this.sessions.values()) {
      const draft = state.draft, background = backgrounds.get(state);
      if (!draft) continue;
      const repaint = background?.id === draft.id && draft.palette !== palette;
      if (repaint || (draft.palette === palette && draft.color !== color)) {
        state.draft = { ...draft, color, ...(repaint ? { background: background.background,
          backgroundColor: background.backgroundColor, palette } : {}), revision: draft.revision + 1 };
        changed = true;
      }
    }
    if (changed) this.publish();
  }
  /** Resolver la entrega no es una edición del dibujo y no provoca reenvíos de práctica. */
  setImageScale(imageScale: number): void { this.imageScale = imageScale; }
  create(state: SessionSheet, sheet: Omit<Draft, "id" | "revision" | "strokes" | "hasInk" | "color">): Draft {
    const draft = { ...sheet, color: this.currentColor(), id: ++this.nextId, revision: 0, strokes: [], hasInk: false };
    state.draft = draft;
    state.pan = { x: 0, y: 0 };
    this.publish();
    return draft;
  }
  update(state: SessionSheet, strokes: Stroke[]): void {
    if (!state.draft) return;
    state.draft = { ...state.draft, revision: state.draft.revision + 1, strokes, hasInk: visibleStrokes(strokes).length > 0 };
    this.publish();
  }
  setTool(state: SessionSheet, tool: Tool): void { state.tool = tool; this.publish(); }
  /** Mover la cámara no es una edición del contenido y no puede invalidar una aceptación. */
  setPan(state: SessionSheet, pan: SessionSheet["pan"]): void { state.pan = pan; this.publish(); }
  undo(state: SessionSheet): void { if (state.draft?.strokes.length) this.update(state, state.draft.strokes.slice(0, -1)); }
  clear(state: SessionSheet): void { if (state.draft?.strokes.length) this.update(state, []); }
  dropUntouched(state: SessionSheet): void {
    if (state.draft && !state.draft.strokes.length) { state.draft = undefined; this.publish(); }
  }
  signature(state: SessionSheet): string {
    const draft = state.draft;
    if (!draft?.hasInk) return "";
    const cached = this.signatures.get(draft);
    if (cached !== undefined) return cached;
    const ink = inkSignature(draft.strokes, draft.color);
    const signature = ink ? `${draft.id}:${draft.palette ?? ""}:${ink}` : "";
    this.signatures.set(draft, signature);
    return signature;
  }
  pending(state: SessionSheet): boolean {
    const signature = this.signature(state);
    return !!signature && (state.kind === "teaching" || signature !== state.sentSignature);
  }
  capture(state: SessionSheet): Capture | undefined {
    const draft = state.draft;
    if (!draft) return undefined;
    const signature = this.signature(state);
    return { session: state, draft, color: draft.color, imageScale: this.imageScale, signature,
      sendImage: !!signature && (state.kind === "teaching" || signature !== state.sentSignature) };
  }
  accepted(captured: Capture): void {
    const state = captured.session;
    if (state.draft?.id !== captured.draft.id) return; // Un nuevo problema/hoja sustituye a esta aceptación.
    if (state.kind === "practice") {
      if (captured.sendImage) { state.sentSignature = captured.signature; this.publish(); }
      return;
    }
    if (state.draft.revision === captured.draft.revision) this.update(state, []);
  }
  /** Solo cuentan las identidades de planteamiento aceptadas. La conclusión/descarte nunca llegan a este reinicio. */
  observePoses(state: SessionSheet, poses: readonly string[], baseline = false): boolean {
    if (state.kind !== "practice") return false;
    const latest = poses.at(-1);
    const newLatest = latest !== undefined && !state.seenPoses.has(latest);
    for (const pose of poses) state.seenPoses.add(pose);
    if (!newLatest || baseline) return false;
    state.draft = undefined;
    state.sentSignature = "";
    state.tool = "pen";
    state.pan = { x: 0, y: 0 };
    this.newProblem(state);
    this.publish();
    return true;
  }
  dispose(): void { this.sessions.clear(); this.listeners.clear(); }
}
