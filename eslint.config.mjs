import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * ESLint con una sola tarea aquí: HACER CUMPLIR LA LEY DE IMPORTS (la
 * arquitectura armazón/núcleo, docs/architecture.md). Todo lo demás se
 * aparta: esto no es un linter de estilo.
 *
 *   components/**  →  "@/src/core"  (el barril del núcleo puro) — SOLO
 *   app/**         →  "@/src/core" + "@/src/server" (el barril del servidor) — SOLO
 *   src/core/**    →  nunca importa src/agent, src/server, src/store (núcleo
 *                    puro: los adaptadores implementan core/ports.ts, nunca al revés)
 *   src/agent/**   →  nunca importa src/server, src/store (las dependencias
 *                    —los puertos de almacenamiento, la composición— llegan
 *                    mediante factorías/closures desde el chat-handler)
 *
 * tests/ y scripts/ son internos: sin restricciones.
 */

export default defineConfig([
	// electron/** — el armazón de escritorio: Node simple, sin framework, fuera de la
// ley de imports (el mismo motivo que scripts/).
	globalIgnores([".next/**", "node_modules/**", "data/**", "next-env.d.ts", "scripts/**", "electron/**", "dist/**"]),
	{
		files: ["**/*.{js,mjs,ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaVersion: "latest", sourceType: "module" },
		},
		plugins: { "@next/next": nextPlugin, import: importPlugin },
		settings: {
			"import/resolver": { typescript: { alwaysTryTypes: true } },
		},
		rules: {
			...nextPlugin.configs.recommended.rules,
			"import/no-restricted-paths": [
				"error",
				{
					zones: [
						{
							target: "./components",
							from: "./src",
							// NOTA: el plugin resuelve `except` relativo a la ruta `from` de la zona.
							except: ["./core/index.ts"],
							message:
								"Browser shell imports ONLY the pure core barrel: `from \"@/src/core\"` (architecture: docs/architecture.md).",
						},
						{
							target: "./app",
							from: "./src",
							except: ["./core/index.ts", "./server/index.ts"],
							message:
								"app/ (transport + server components) imports ONLY the barrels: `@/src/core` and `@/src/server` (architecture: docs/architecture.md).",
						},
						{
							target: "./src/core",
							from: ["./src/agent", "./src/server", "./src/store"],
							message:
								"Pure core never imports IO layers (agent/server/store): adapters implement core/ports.ts, and the composition root (src/server/stores.ts) passes them in (architecture: docs/architecture.md).",
						},
						{
							target: "./src/agent",
							from: ["./src/server", "./src/store"],
							message:
								"The agent layer receives its dependencies (storage ports via factories/closures) — it never imports the server layer or store adapters (architecture: docs/architecture.md).",
						},
					],
				},
			],
		},
	},
]);
