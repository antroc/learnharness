/** El profesor aporta una receta completa de proceso de prueba, no un perfil de lenguaje. */
export type CodingTests = {
  program: string;
  args: string[];
  code: string;
};

/** Una observación del proceso de prueba, nunca una afirmación de que el código del alumno sea correcto. */
export type CodingTestResult = {
  status: "passed" | "failed" | "error";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  message?: string;
};

/** Lectura defensiva de los datos guardados del plugin; nunca convierte ni deduce un resultado ausente. */
export function readTestResult(value: unknown): CodingTestResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.status !== "passed" && result.status !== "failed" && result.status !== "error") return null;
  if (result.exitCode !== null && (typeof result.exitCode !== "number" || !Number.isSafeInteger(result.exitCode))) return null;
  if (result.status === "passed" && result.exitCode !== 0) return null;
  if (result.status === "failed" && (result.exitCode === null || result.exitCode === 0)) return null;
  if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || typeof result.stdoutTruncated !== "boolean" || typeof result.stderrTruncated !== "boolean") return null;
  if (result.message !== undefined && typeof result.message !== "string") return null;
  return result as CodingTestResult;
}
