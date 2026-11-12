/**
 * smoke-server.mjs — arranca el servidor standalone empaquetado y demuestra
 * que sirve.
 *
 * La barrera de la carga que se amortiza sola (2026-10-08): que `next build`
 * tenga éxito y que una ejecución de electron-builder termine NO dicen NADA
 * sobre si el servidor empaquetado arranca de verdad. En su primer día esta
 * prueba de humo detectó dos defectos reales que nada más vio: (1) una
 * regresión de exclusión del rastreo que dejó los paquetes del motor pi en
 * package.json pelados: el servidor respondía 500 en todas las rutas con
 * ERR_MODULE_NOT_FOUND; (2) antes de eso, el auth.json de desarrollo (claves
 * BYOK) distribuido dentro del paquete. Se ejecuta entre build-server.mjs y
 * electron-builder para que una carga rota falle en segundos, no tras una
 * pasada completa de empaquetado.
 *
 * Qué hace: lanza .next/standalone/server.js exactamente como lo hace el
 * armazón de Electron (electron/main.cjs) —con --electron usa el Node que
 * trae Electron mediante ELECTRON_RUN_AS_NODE y, si no, el Node del host—
 * en 127.0.0.1, en un puerto libre asignado por el núcleo, con
 * NODE_ENV=production, un LH_DATA_DIR DESECHABLE y un LH_AUTH_FILE VACÍO
 * bajo os.tmpdir() (ninguna clave ni dato real lo toca nunca); sondea GET /
 * hasta obtener 200 y después prueba la superficie de la API solo GET
 * (graph / models / settings, sin efectos secundarios). Cualquier respuesta
 * distinta de 200, una salida temprana del servidor o un plazo de arranque
 * de 30 s hacen fallar la barrera e imprimen la cola del log del propio
 * servidor para el diagnóstico. El hijo se mata SIEMPRE antes de salir: un
 * servidor que se escapa retiene su puerto frente a la siguiente ejecución
 * (aprendido a las malas, el mismo día).
 */
import { spawn } from "node:child_process";
import { probeEnv, verifyDemoRuntime } from "./smoke-demo-runtime.mjs";
import { verifyProviderRuntime } from "./smoke-provider-runtime.mjs";
import { createPluginSmokeFixture, verifyPluginServer } from "./smoke-plugin-runtime.mjs";
import { verifyCorePlugins } from "./smoke-core-plugins.mjs";
import { verifyCompressionRuntime } from "./smoke-compression-runtime.mjs";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_STANDALONE = path.join(ROOT, ".next", "standalone");
const ISOLATED_MODE = process.argv.includes("--isolated");
const BROWSER_MODE = process.argv.includes("--browser");
let isolatedRoot;
const ELECTRON_MODE = process.argv.includes("--electron");
const RUNTIME = ELECTRON_MODE ? createRequire(import.meta.url)("electron") : process.execPath;

const POLL_MS = 500;
const BOOT_TIMEOUT_MS = 30_000;
/** Sondeos solo GET: las rutas que ejercitaron la clase de fallo de hoy. */
const PROBES = ["/api/graph", "/api/models", "/api/settings", "/api/plugins"];

if (!fs.existsSync(path.join(SOURCE_STANDALONE, "server.js"))) {
	console.error("[smoke-server] .next/standalone/server.js missing — run next build first.");
	process.exit(1);
}

/** Un puerto TCP libre (listen(0) → el núcleo asigna uno); refleja main.cjs. */
function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

/** Un GET; resuelve el código de estado (0 = conexión rechazada/fallida). */
function get(url) {
	return new Promise((resolve) => {
		const req = http.get(url, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", () => resolve(0));
		req.setTimeout(5000, () => {
			req.destroy();
			resolve(0);
		});
	});
}

async function main() {
	// Prueba opcional sin la fuente: ejecuta una copia fuera del checkout para que las
	// dependencias que faltan no puedan resolverse hacia arriba en el node_modules de desarrollo.
	if (ISOLATED_MODE) {
		isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lh-isolated-server-"));
		// Conserva los enlaces relativos de paquetes externos de Next. Si no, cpSync
		// los reescribe como enlaces absolutos de vuelta al checkout original.
		fs.cpSync(SOURCE_STANDALONE, path.join(isolatedRoot, "standalone"), { recursive: true, verbatimSymlinks: true });
	}
	const standalone = isolatedRoot ? path.join(isolatedRoot, "standalone") : SOURCE_STANDALONE;
	const server = path.join(standalone, "server.js");
	// El arranque HTTP por sí solo nunca importa el motor de demos cargado dinámicamente.
	// Falla antes de empaquetar si su grafo de dependencias del standalone está incompleto.
	verifyDemoRuntime(standalone, RUNTIME);
	// /api/models solo lee catálogos; inicializa también sin conexión el SDK perezoso real.
	verifyProviderRuntime(standalone, RUNTIME);
	// Un GET simple sin Accept-Encoding nunca ejercita la contrapresión de gzip.
	verifyCompressionRuntime(standalone, RUNTIME);
	const port = await freePort();
	const url = `http://127.0.0.1:${port}`;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-smoke-"));
	const dataDir = path.join(home, "data");
	const authFile = path.join(home, "auth.json");
	fs.writeFileSync(authFile, "{}\n", "utf-8");
	createPluginSmokeFixture(home);
	const imports = [];
	if (ISOLATED_MODE) {
		// Rechaza las escapadas por import absoluto además de la resolución accidental hacia arriba.
		const guard = path.join(home, "payload-import-guard.mjs");
		fs.writeFileSync(guard, `import {registerHooks} from 'node:module'; import {realpathSync} from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
const roots = ${JSON.stringify([standalone, path.join(home, "data", "plugins")])}.map(p=>realpathSync(p));
registerHooks({resolve(specifier,context,next){ const result=next(specifier,context); if(result.url.startsWith('file:')) { const file=realpathSync(fileURLToPath(result.url)); if(!roots.some(root=>file===root || file.startsWith(root+path.sep))) throw new Error('Import escaped standalone/plugin payload: '+file); } return result; }});`);
		imports.push("--import", guard);
	}

	const tail = []; // cola móvil del log para diagnosticar fallos
	let tailBytes = 0;
	const keep = (buf) => {
		for (const line of buf.toString().split("\n")) {
			tail.push(line);
			tailBytes += line.length + 1;
		}
		while (tailBytes > 16_000 && tail.length > 2) {
			tailBytes -= tail[0].length + 1;
			tail.shift();
		}
	};
	const dumpTail = () => {
		console.error("--- server log tail " + "-".repeat(20));
		for (const line of tail.slice(-40)) if (line.trim()) console.error(`    ${line}`);
	};

	console.log(`[smoke-server] runtime: ${ELECTRON_MODE ? "Electron bundled Node" : "host Node"}`);
	const child = spawn(RUNTIME, [...imports, server], {
		cwd: standalone,
		env: {
			...probeEnv(process.env, home),
			...(ELECTRON_MODE ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
			NODE_ENV: "production",
			PORT: String(port),
			HOSTNAME: "127.0.0.1",
			LH_DATA_DIR: dataDir,
			LH_AUTH_FILE: authFile,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let exited = false;
	child.stdout.on("data", keep);
	child.stderr.on("data", keep);
	child.on("exit", () => {
		exited = true;
	});

	const kill = () =>
		new Promise((resolve) => {
			if (exited) return resolve();
			const done = () => resolve();
			child.once("exit", done);
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!exited) {
					try {
						child.kill("SIGKILL");
					} catch {
						/* ya no existe */
					}
				}
				done();
			}, 3000);
		});

	let failed = null;
	try {
		// 1) Arranque: sondea GET / hasta obtener 200 (o plazo vencido / salida temprana).
		let boot = 0;
		const deadline = Date.now() + BOOT_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (exited) throw new Error(`server exited before answering on ${url}`);
			boot = await get(url);
			if (boot === 200) break;
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		if (boot !== 200) throw new Error(`server never answered 200 on ${url} (last status: ${boot})`);
		console.log(`[smoke-server] boot ok: GET / → 200 (${url})`);

		// 2) Superficie de la API: todos los sondeos deben dar 200.
		for (const route of PROBES) {
			const status = await get(url + route);
			if (status !== 200) throw new Error(`GET ${route} → ${status} (expected 200)`);
			console.log(`[smoke-server] GET ${route} → 200`);
		}
		await verifyCorePlugins({ root: ROOT, standalone, dataDirectory: dataDir, url });
		await verifyPluginServer(url, home);
		if (BROWSER_MODE) {
			const { verifyPluginBrowser } = await import("./smoke-plugin-browser.mjs");
			const evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plugin-browser-evidence-"));
			console.log("[smoke-server] browser evidence:", evidenceDirectory);
			await verifyPluginBrowser(url, { scratchDirectory: evidenceDirectory });
		}
	} catch (err) {
		failed = err;
	} finally {
		await kill();
		try {
			fs.rmSync(home, { recursive: true, force: true });
		} catch {
			/* con el mejor esfuerzo: está bajo os.tmpdir() */
		}
	}

	if (failed) {
		console.error(`[smoke-server] FAIL: ${failed.message}`);
		dumpTail();
		throw failed;
	}
	console.log(`[smoke-server] smoke passed — the packaged server boots and serves${ISOLATED_MODE ? " outside the source checkout" : ""}${BROWSER_MODE ? ", including live plugin UI" : ""}.`);
}

main().catch((err) => {
	console.error(`[smoke-server] FAIL: ${err.message}`);
	process.exitCode = 1;
}).finally(() => {
	if (isolatedRoot) fs.rmSync(isolatedRoot, { recursive: true, force: true });
});
