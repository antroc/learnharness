import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";

const supportedLanguages = new Set([
  "Python", "JavaScript", "TypeScript", "C", "C++", "Java", "Rust", "Go", "JSON",
]);

/** Usa el nombre canónico del catálogo para que los alias hereden exactamente la misma política. */
export function supportsSyntaxDiagnostics(languageName: string): boolean {
  return supportedLanguages.has(languageName);
}

/** Solo información del analizador: nunca ejecuta código, deduce tipos ni rechaza una respuesta. */
export function syntaxDiagnostics(state: EditorState): Diagnostic[] {
  // Puede que los documentos grandes nunca se analicen enteros mientras el viewport sigue
  // arriba. Usa el árbol disponible, excluyendo la recuperación en su borde sin terminar.
  const tree = syntaxTree(state);
  const complete = syntaxTreeAvailable(state);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  tree.iterate({
    enter(node) {
      if (!node.type.isError || (!complete && node.to >= tree.length)) return;
      const key = `${node.from}:${node.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      diagnostics.push({ from: node.from, to: node.to, severity: "error", message: "Syntax problem." });
    },
  });
  return diagnostics;
}

export function syntaxDiagnosticsExtension(): Extension {
  return linter(view => syntaxDiagnostics(view.state), {
    delay: 300,
    needsRefresh: update => syntaxTree(update.startState) !== syntaxTree(update.state),
  });
}
