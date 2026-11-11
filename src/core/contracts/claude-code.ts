export const CLAUDE_CODE_PROVIDER = "claude-code";

/** Solo instalación/versión. Nunca un veredicto de autenticación, cuota o facturación. */
export interface ClaudeCodeStatus {
	state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
	version: string | null;
	minimumVersion: string;
}

// --permission-prompts none se añadió en la 2.1.259. No es un contrato oficial de versión
// mínima/estabilidad para claudecode/toolUseId; la admisión falla en cerrado.
export const CLAUDE_CODE_MINIMUM_VERSION = "2.1.259";
