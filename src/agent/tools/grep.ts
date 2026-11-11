import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import {
	capOutput,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	isBinaryFile,
	matchGlob,
	MAX_OUTPUT_BYTES,
	sourceSearchRoots,
	truncateGrepLine,
	walkFiles,
	WALK_TIMEOUT_MS,
} from "./fs-shared.ts";
import { resolvePolicy } from "./file-access.ts";

/**
 * La herramienta grep: sources v1 (2026-09-19): el dist/core/tools/grep.js de pi
 * portado a un escaneo en Node puro (pi llama a rg por shell). Los esquemas y formatos
 * de salida son literales de pi: coincidencias `relative/path:LINE: text`,
 * líneas de contexto `relative/path-LINE- text`, el límite de 500 caracteres por línea, el
 * aviso "use read to see full lines". Diferencias: home como ancla por defecto,
 * .gitignore sustituido por exclusiones fijas de ruido, detección de binarios olfateando
 * NUL, un límite de 2 MB por fichero y un tiempo límite real con resultados parciales.
 * Solo lectura por construcción.
 */

const DEFAULT_LIMIT = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const grepInput = Type.Object({
	pattern: Type.String({ minLength: 1, description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(
		Type.String({ description: "Directory or file to search. Default: home when unrestricted, all allowed folders when restricted. Explicit relative paths are home-relative." }),
	),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Integer({ minimum: 0, description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of matches to return (default: 100)" })),
});

export const grepTool: AgentTool<typeof grepInput> = {
	name: "grep",
	label: "grep",
	description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers; default searches of allowed folders use absolute paths. Use ls without a path to discover allowed roots. Ignores node_modules, .git, and Library directories, and skips known sensitive locations (e.g. ~/.ssh, ~/.aws, ~/.claude, browser profiles and LearnHarness credential stores), plus .env/.env.* files. Output is truncated to ${DEFAULT_LIMIT} matches or ${formatSize(MAX_OUTPUT_BYTES)} (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
	parameters: grepInput,
	execute: serverExecute("grep", grepInput, async (input, ctx) => {
		if (ctx?.signal?.aborted) return "Operation aborted";
		const policy = resolvePolicy();
		const { roots, notices, multiRoot } = sourceSearchRoots(input.path, policy);

		const regex = new RegExp(
			input.literal ? input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input.pattern,
			input.ignoreCase ? "i" : undefined,
		);
		const contextValue = input.context && input.context > 0 ? input.context : 0;
		const effectiveLimit = Math.max(1, input.limit ?? DEFAULT_LIMIT);

		// Un único presupuesto de recolección para toda la unión, no 10 s por raíz.
		const files: { filePath: string; searchPath: string; isDirectory: boolean }[] = [];
		const deadline = Date.now() + WALK_TIMEOUT_MS;
		let timedOut = false;
		let aborted = false;
		for (const searchPath of roots) {
			let stat;
			try { stat = await fs.stat(searchPath); }
			catch { throw new Error(`Path not found: ${searchPath}`); }
			const isDirectory = stat.isDirectory();
			if (!isDirectory) files.push({ filePath: searchPath, searchPath, isDirectory });
			else {
				const result = await walkFiles(searchPath, (filePath) => {
					if (input.glob && !matchGlob(path.relative(searchPath, filePath).split(path.sep).join("/"), input.glob)) return false;
					files.push({ filePath, searchPath, isDirectory });
					return false;
				}, ctx?.signal, { policy, deadline });
				timedOut ||= result.timedOut;
				aborted ||= result.aborted;
			}
			if (timedOut || aborted) break;
		}

		const outLines: string[] = [];
		let matchCount = 0;
		let limitReached = false;
		let linesTruncated = false;
		// La fase de escaneo también está acotada (2026-09-19): el plazo de 10 s del recorrido
		// acota la RECOLECCIÓN, pero leer cada fichero recogido no tenía límite:
		// el grep que sobrevivió a su turno durante minutos. Mismo presupuesto, comprobado por
		// fichero; el aborto llega a mitad de escaneo con resultados parciales.
		const scanDeadline = Date.now() + WALK_TIMEOUT_MS;
		let scanTimedOut = false;

		for (const { filePath, searchPath, isDirectory } of files) {
			if (ctx?.signal?.aborted) {
				aborted = true;
				break;
			}
			if (Date.now() > scanDeadline) {
				scanTimedOut = true;
				break;
			}
			if (matchCount >= effectiveLimit) {
				limitReached = true;
				break;
			}
			let fileStat;
			try {
				fileStat = await fs.stat(filePath);
			} catch {
				continue;
			}
			if (fileStat.size > MAX_FILE_BYTES) continue; // salto silencioso de ficheros enormes al estilo de rg
			if (await isBinaryFile(filePath).catch(() => true)) continue;

			let content: string;
			try {
				content = await fs.readFile(filePath, "utf-8");
			} catch {
				continue;
			}
			const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
			const rel = multiRoot ? filePath : isDirectory
				? path.relative(searchPath, filePath).split(path.sep).join("/")
				: path.basename(filePath);

			for (let i = 0; i < lines.length; i++) {
				if (regex.test(lines[i]!)) {
					if (matchCount >= effectiveLimit) {
						limitReached = true;
						break;
					}
					matchCount++;
					const start = contextValue > 0 ? Math.max(1, i + 1 - contextValue) : i + 1;
					const end = contextValue > 0 ? Math.min(lines.length, i + 1 + contextValue) : i + 1;
					for (let current = start; current <= end; current++) {
						const { text, wasTruncated } = truncateGrepLine(lines[current - 1] ?? "");
						if (wasTruncated) linesTruncated = true;
						// Formato de pi: ':' en las líneas de coincidencia, '-' en las de contexto.
						outLines.push(current === i + 1 ? `${rel}:${current}: ${text}` : `${rel}-${current}- ${text}`);
					}
				}
			}
			if (limitReached) break;
		}

		const finish = (body: string): string => notices.length ? `${body}\n\n[${notices.join(". ")}]` : body;
		if (aborted) {
			return finish(outLines.length > 0
				? `${capOutput(outLines).content}\n\n[search aborted — partial results]`
				: "Search aborted before any results.");
		}
		if (outLines.length === 0) {
			return finish(timedOut || scanTimedOut
				? `Search timed out after 10s with no matches yet. Narrow the search to a subdirectory.`
				: "No matches found");
		}
		const { content, truncated } = capOutput(outLines);
		if (limitReached || matchCount >= effectiveLimit) notices.push(`${effectiveLimit} matches limit reached`);
		if (linesTruncated) notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
		if (truncated) notices.push(`${formatSize(MAX_OUTPUT_BYTES)} limit reached`);
		if (timedOut || scanTimedOut) notices.push("search timed out after 10s — partial results, narrow the directory");
		return finish(content);
	}),
};
