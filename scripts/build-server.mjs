/**
 * build-server.mjs — prepara la carga del servidor del armazón de Electron.
 *
 * `next build` (output: "standalone") produce .next/standalone/ con
 * server.js + el subconjunto rastreado de node_modules, pero deja fuera dos
 * piezas que la documentación nos pide copiar: public/ y .next/static/.
 * Este script termina el trabajo y comprueba la sensatez del resultado,
 * incluida la exclusión que mantiene el data/ real del repo FUERA del
 * paquete (ver outputFileTracingExcludes en next.config.ts). También quita
 * rutas exactas solo de compilación que barre el rastreador: proyectos de
 * autoría de plugins, instaladores antiguos y el runtime de Electron de
 * desarrollo. Las exclusiones amplias en el rastreo rompen los externos.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { validateCorePackages } from "./build-core-plugins.mjs";
import { buildPluginAuthoring } from "./build-plugin-authoring.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

const copyTree = (from, to) => {
	fs.cpSync(from, to, { recursive: true });
};

const exists = (p) => fs.existsSync(p);

if (!exists(path.join(STANDALONE, "server.js"))) {
	console.error("[build-server] .next/standalone/server.js missing — run `next build` first (output: 'standalone').");
	process.exit(1);
}

// 1) Recursos estáticos: public/ → standalone/public, .next/static → standalone/.next/static
const staticFrom = path.join(ROOT, ".next", "static");
const staticTo = path.join(STANDALONE, ".next", "static");
if (!exists(staticFrom)) {
	console.error("[build-server] .next/static missing — the build looks incomplete.");
	process.exit(1);
}
copyTree(staticFrom, staticTo);
if (exists(path.join(ROOT, "public"))) {
	copyTree(path.join(ROOT, "public"), path.join(STANDALONE, "public"));
}

// 2) Seguridad: el data/ real del repo NUNCA debe viajar en el paquete.
const leakedData = path.join(STANDALONE, "data");
if (exists(leakedData)) {
	console.error("[build-server] REFUSING: standalone contains a data/ directory — repo session data would ship in the app.");
	console.error("             Check outputFileTracingExcludes in next.config.ts.");
	process.exit(1);
}

// 2b) Seguridad: los SECRETOS de desarrollo del repo tampoco deben viajar nunca; el
// mismo barrido del rastreo que pilla data/ metió el auth.json de la raíz del repo
// (el almacén de claves BYOK de DESARROLLO, 0600), idéntico byte a byte, en el DMG (detectado en
// la auditoría de la carga del 2026-10-08; excluido en next.config.ts: esta protección
// hace que una regresión sea ruidosa en vez de silenciosa).
const subscriptionSecrets = fs.readdirSync(STANDALONE).filter((name) => /^(chatgpt|github-copilot|xai)-credentials\.json/.test(name));
for (const secret of ["auth.json", ...subscriptionSecrets, ".env", ".env.local"]) {
	if (exists(path.join(STANDALONE, secret))) {
		console.error(`[build-server] REFUSING: standalone contains ${secret} — dev secrets would ship in the app.`);
		console.error("             Check outputFileTracingExcludes in next.config.ts.");
		process.exit(1);
	}
}

// Monta los recursos de los plugins solo después de rechazar datos/credenciales rastreados inseguros.
// El cargador nativo de plugins en tiempo de ejecución queda a propósito fuera del grafo de módulos de Next.
// Cópialo de forma explícita: las entradas de plugins externos debe cargarlas el Node nativo,
// no deben interpretarse como imports de tiempo de compilación por webpack/Turbopack.
copyTree(path.join(ROOT, "scripts", "plugin-loader.cjs"), path.join(STANDALONE, "scripts", "plugin-loader.cjs"));
try {
	const core = path.join(ROOT, "core-plugins"), packagedCore = path.join(STANDALONE, "core-plugins");
	validateCorePackages(ROOT, core);
	fs.rmSync(packagedCore, { recursive: true, force: true });
	copyTree(core, packagedCore);
	validateCorePackages(ROOT, packagedCore);
} catch (error) {
	console.error("[build-server] REFUSING: Core plugin payload is missing or unsafe. Run npm run plugins:build-core.", error);
	process.exit(1);
}

// Vuelve a montar a partir de la fuente actual; nunca reutilices una descarga de desarrollo posiblemente obsoleta.
// Distribuye la skill portable completa más su ZIP estático; sin cadena de herramientas de la aplicación.
buildPluginAuthoring({ root: ROOT, standalone: true });

// 2c) Curación de la carga (2026-10-11): el barrido del rastreo puede copiar los plugins/
// de la raíz del repo (fuentes/pruebas de autoría), dist/ (instaladores anteriores) y el runtime de Electron
// de desarrollo (el require solo de desarrollo del auxiliar de demos). Nada de eso pertenece al
// servidor: los auxiliares empaquetados usan process.execPath, el propio binario de la app.
// Quita SOLO estas rutas de la raíz del standalone DESPUÉS del rastreo; excluir un
// dist/** genérico antes rompió el dist/ de tiempo de ejecución de pi-ai / pi-agent-core.
// Nunca toques ROOT/dist ni ROOT/node_modules/electron (la app en marcha
// y el runtime de compilación); los paquetes nativos canvas/resvg no se tocan.
for (const extra of ["plugins", "dist", path.join("node_modules", "electron")]) {
	const target = path.join(STANDALONE, extra);
	if (exists(target)) {
		fs.rmSync(target, { recursive: true, force: true });
		console.log(`[build-server] removed build-only payload: ${extra}`);
	}
}

// 3) Comprobación: los recursos de prompts que se leen en tiempo de ejecución deben estar (el agente
//    profesor los lee del disco en el momento de la petición).
for (const asset of [
	path.join("scripts", "plugin-loader.cjs"),
	path.join("public", "plugin-loader.js"),
	path.join("src", "agent", "system-prompt.md"),
	path.join("src", "agent", "prompts", "teacher", "20-teaching.md"),
	path.join("src", "agent", "prompts", "side-chat", "00-base.md"),
	path.join("src", "agent", "prompts", "side-chat", "90-style.md"),
]) {
	if (!exists(path.join(STANDALONE, asset))) {
		console.error(`[build-server] prompt asset missing from the trace: ${asset}`);
		process.exit(1);
	}
}

console.log("[build-server] server payload ready:", STANDALONE);