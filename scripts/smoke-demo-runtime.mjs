/**
 * Importa el grafo de dependencias de las demos SOLO desde una carga
 * standalone. Con --browser, maneja además el --browser-service propio de la
 * app empaquetada (nunca el Chrome del sistema). No hace falta servidor,
 * modelo, claves, UI de la app instalada ni ruta de diagnóstico de producción.
 *
 * node scripts/smoke-demo-runtime.mjs --standalone <dir> --runtime <electron binary> [--browser]
 * --runtime usa por defecto el Node del host para la barrera solo de imports.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import http from "node:http";
import { createRequire, registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @param {Record<string, string | undefined>} env @param {string} home @returns {Record<string, string | undefined>} */
export function probeEnv(env, home) {
	const clean = Object.fromEntries(Object.entries(env).filter(([key]) =>
		!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
		!/^(AWS_|GOOGLE_|GCLOUD_|CLOUDSDK_|AZURE_|ANTHROPIC_|OPENAI_|OPENROUTER_|GEMINI_)/.test(key) &&
		!["NODE_OPTIONS", "NODE_PATH", "LH_DEV_URL", "ELECTRON_RUN_AS_NODE"].includes(key)));
	return {
		...clean,
		HOME: home, USERPROFILE: home,
		APPDATA: path.join(home, "config"), LOCALAPPDATA: path.join(home, "local"),
		XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"),
		LH_DATA_DIR: path.join(home, "data"), LH_AUTH_FILE: path.join(home, "auth.json"),
		LH_IGNORE_ENV_KEYS: "1", NODE_ENV: "production",
	};
}

// Conserva la causa anidada de fetch (incluidos los fallos de socket AggregateError), pero
// nunca vuelques propiedades arbitrarias del error, como cabeceras de la petición o el entorno.
export function formatProbeError(error, depth = 0) {
	if (depth > 5) return "[cause chain truncated]";
	if (!error || typeof error !== "object") return String(error);
	const lines = [typeof error.stack === "string" ? error.stack : `${error.name ?? "Error"}: ${error.message ?? "unknown error"}`];
	for (const field of ["code", "errno", "syscall", "address", "port"]) {
		if (["string", "number"].includes(typeof error[field])) lines.push(`${field}: ${error[field]}`);
	}
	if (error.cause !== undefined) lines.push(`cause: ${formatProbeError(error.cause, depth + 1)}`);
	if (Array.isArray(error.errors)) {
		for (const nested of error.errors.slice(0, 8)) lines.push(`aggregate: ${formatProbeError(nested, depth + 1)}`);
	}
	return lines.join("\n");
}

export function verifyDemoRuntime(standalone, runtime = process.execPath, browser = false) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-demo-runtime-"));
	try {
		fs.writeFileSync(path.join(home, "auth.json"), "{}\n", { mode: 0o600 });
		const result = spawnSync(runtime, [fileURLToPath(import.meta.url), "--probe", path.resolve(standalone), ...(browser ? ["--browser"] : [])], {
			cwd: home,
			env: { ...probeEnv(process.env, home), ELECTRON_RUN_AS_NODE: "1" },
			encoding: "utf8", timeout: 60_000, maxBuffer: 128 * 1024,
		});
		if (result.status !== 0 || result.error) {
			throw new Error(`demo runtime probe failed (${result.error?.message ?? result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
		}
		process.stdout.write(result.stdout);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
}

async function importPayload(standalone) {
	const root = fs.realpathSync(standalone);
	const inside = (file) => {
		const relative = path.relative(root, fs.realpathSync(file));
		assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
			`dependency escaped standalone payload: ${file}`);
	};
	const require = createRequire(path.join(root, "server.js"));
	const entry = require.resolve("puppeteer-core");
	inside(entry); // require.resolve no debe recurrir en silencio al node_modules del checkout.
	const loaded = new Set();
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			const result = nextResolve(specifier, context);
			if (result.url.startsWith("file:")) {
				inside(fileURLToPath(result.url));
				loaded.add(result.url);
			} else {
				assert.ok(result.url.startsWith("node:"), `unexpected dependency URL: ${result.url}`);
			}
			return result;
		},
	});
	try {
		const { default: puppeteer } = await import(pathToFileURL(entry).href);
		assert.equal(typeof puppeteer.connect, "function");
		console.log(`[smoke-demo-runtime] puppeteer-core import ok; ${loaded.size} modules confined to ${root}`);
		return { puppeteer, hooks };
	} catch (error) {
		hooks.deregister();
		throw error;
	}
}

// Una desconexión IPC explícita puede omitir el 'close' de ChildProcess incluso después de que Electron
// termine. Espera a la salida real, de forma acotada; nunca deduzcas la intención de apagado
// de la limpieza automática de stdin de Node tras una salida inesperada del hijo.
/** @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, requested: boolean}>} */
export async function stopBrowserService(helper) {
	if (!helper.pid || helper.exitCode !== null || helper.signalCode !== null) {
		return { code: helper.exitCode, signal: helper.signalCode, requested: false };
	}
	let onExit, onError;
	const exited = new Promise((resolve, reject) => {
		onExit = (code, signal) => resolve({ code, signal });
		onError = reject;
		helper.once("exit", onExit);
		helper.once("error", onError);
	});
	const wait = async (ms) => {
		let timer;
		try {
			return await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
		} finally { clearTimeout(timer); }
	};
	try {
		const requested = helper.connected;
		if (requested) {
			console.log("[smoke-demo-runtime] requesting parent IPC disconnect");
			helper.disconnect();
		}
		const result = await wait(5000);
		if (!result) {
			helper.kill("SIGKILL");
			if (!await wait(3000)) throw new Error("browser-service did not exit after forced cleanup");
			throw new Error("browser-service did not exit after IPC disconnect; force-killed");
		}
		return { ...result, requested };
	} finally {
		helper.removeListener("exit", onExit);
		helper.removeListener("error", onError);
	}
}

async function browserProbe(puppeteer) {
	assert.ok(process.versions.electron, "--browser requires a packaged Electron --runtime binary");
	const home = process.env.HOME;
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.LH_DEV_URL;
	const helper = spawn(process.execPath, [
		"--browser-service", `--user-data-dir=${path.join(home, "browser-profile")}`,
		"--disable-background-networking", "--disable-component-update", "--no-proxy-server",
		// Los ejecutores Linux alojados no permiten el sandbox sin privilegios de Chromium.
		...(process.platform === "linux" ? ["--no-sandbox"] : []),
	], { cwd: home, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
	let output = "";
	let errors = "";
	helper.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-16_000); });
	let browser;
	let failed = false;
	try {
		const port = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("browser-service handshake timed out")), 15_000);
			helper.once("error", (err) => { clearTimeout(timer); reject(err); });
			helper.once("exit", (code) => { clearTimeout(timer); reject(new Error(`browser-service exited early: ${code}`)); });
			helper.stdout.on("data", (chunk) => {
				output = (output + chunk).slice(-16_000);
				const match = output.match(/^BROWSER_SERVICE_CDP (\d+)\r?$/m);
				if (match) { clearTimeout(timer); resolve(Number(match[1])); }
			});
		});
		const info = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
		browser = await puppeteer.connect({ browserWSEndpoint: info.webSocketDebuggerUrl, defaultViewport: null, protocolTimeout: 10_000 });
		// El CDP de Electron no tiene Target.createTarget: usa la página existente del auxiliar.
		const pages = await browser.pages();
		const page = pages.find((candidate) => candidate.target().type() === "page");
		assert.ok(page, "browser-service has no page target");
		const failures = [];
		page.on("console", (msg) => { if (msg.type() === "error") failures.push(msg.text()); });
		page.on("pageerror", (err) => failures.push(String(err)));
		page.on("requestfailed", (req) => failures.push(`failed request: ${req.url()}`));
		// Importa las funciones reales de producción, no una receta de aislamiento
		// implementada por separado. El rastreo de imports solo de la carga se comprobó aparte.
		const { tsImport } = await import("tsx/esm/api");
		const { loadIsolatedPage, runDemoOnPage } = await tsImport("../src/agent/subagents/headless.ts", import.meta.url);
		const cleanup = await loadIsolatedPage(page, '<!doctype html><meta charset="utf-8"><button id="increment">Increment</button><output id="count">0</output><script>document.querySelector("#increment").onclick = () => { document.querySelector("#count").textContent = "1"; };</script>');
		assert.equal(await page.$eval("#count", (element) => element.textContent), "0");
		await page.click("#increment");
		assert.equal(await page.$eval("#count", (element) => element.textContent), "1");
		assert.deepEqual(failures, [], "demo console/page/network errors");
		// Una demo no debe poder leer ficheros locales.
		const canary = path.join(home, "canary.txt");
		fs.writeFileSync(canary, "lh-demo-canary\n");
		const leaked = await page.evaluate(async (url) => {
			let fetchAttempted = false, xhrAttempted = false;
			const viaFetch = async () => { fetchAttempted = true; try { return (await (await fetch(url)).text()).includes("lh-demo-canary"); } catch { return false; } };
			const viaXhr = () => { xhrAttempted = true; try { const xhr = new XMLHttpRequest(); xhr.open("GET", url, false); xhr.send(); return xhr.responseText.includes("lh-demo-canary"); } catch { return false; } };
			const fetchRead = await viaFetch(), xhrRead = viaXhr();
			return { origin: location.origin, fetchAttempted, xhrAttempted, fetch: fetchRead, xhr: xhrRead };
		}, pathToFileURL(canary).href);
		assert.deepEqual(leaked, { origin: "null", fetchAttempted: true, xhrAttempted: true, fetch: false, xhr: false }, "active demo file-read attempts must be refused");
		failures.length = 0; // las lecturas bloqueadas de arriba registran errores esperados
		await cleanup();
		assert.equal(page.url(), "about:blank");
		assert.equal(await page.$("#increment"), null, "page state was not cleared");
		assert.deepEqual(failures, [], "page reset console/page/network errors");
		const listeners = ["request", "console", "pageerror", "requestfailed"].map(event => page.listenerCount(event));
		const cdn = http.createServer((_request, response) => { response.setHeader("content-type", "text/javascript"); response.end("window.ownedDependency = 42;"); });
		await new Promise(resolve => cdn.listen(0, "127.0.0.1", resolve));
		try {
			const url = `http://127.0.0.1:${cdn.address().port}/owned.js`;
			const good = () => runDemoOnPage(page, `<script src="${url}"></script><button id="owned">owned</button>`, {
				settleMs: 20, probe: '({ origin: location.origin, dependency: window.ownedDependency, button: !!document.querySelector("#owned"), previous: typeof window.previous })',
			});
			assert.deepEqual(await good(), { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true,
				probeResult: { origin: "null", dependency: 42, button: true, previous: "undefined" } });
			const broken = await runDemoOnPage(page, '<script>window.previous = 1; console.error("owned console failure"); throw new Error("owned page failure")</script>', { settleMs: 20, probe: '(() => { throw new Error("owned probe failure") })()' });
			assert.equal(broken.ok, false);
			assert.ok(broken.consoleErrors.some(value => value.includes("owned console failure")));
			assert.ok(broken.pageErrors.some(value => value.includes("owned page failure")));
			assert.ok(broken.pageErrors.some(value => value.includes("owned probe failure")));
			const failing = new Proxy(page, { get(target, key) {
				if (key === "setContent") return async () => { throw new Error("owned load failure"); };
				const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
			} });
			await assert.rejects(loadIsolatedPage(failing, "<p>failure</p>"), /owned load failure/);
			assert.equal(page.url(), "about:blank");
			assert.equal((await good()).ok, true, "clean reuse after load/page/probe failure");
			assert.deepEqual(["request", "console", "pageerror", "requestfailed"].map(event => page.listenerCount(event)), listeners, "no production listeners survive retirement");
		} finally { await new Promise(resolve => cdn.close(resolve)); }
		console.log("[smoke-demo-runtime] actual production loader/demo: opaque origin, active file refusal, inline/CDN/probe/error behavior, guarded reset and failure/reuse passed (no Chrome fallback)");
	} catch (err) {
		failed = true;
		throw new Error(`browser-service probe failed at local CDP/browser interaction\n--- browser-service output ---\n${output}\n${errors}`, { cause: err });
	} finally {
		browser?.disconnect();
		try {
			const { code, signal, requested } = await stopBrowserService(helper);
			if (requested) console.log(`[smoke-demo-runtime] observed helper exit after requested IPC disconnect: code=${code}, signal=${signal} (no resident helper)`);
			else console.log(`[smoke-demo-runtime] helper already exited/disconnected before cleanup: code=${code}, signal=${signal}; no shutdown requested`);
			if (!failed) {
				assert.ok(requested, "browser-service exited/disconnected before requested cleanup");
				assert.deepEqual({ code, signal }, { code: 0, signal: null }, "browser-service shutdown failed");
			}
		} catch (error) {
			if (!failed) throw error;
			console.error(`[smoke-demo-runtime] cleanup also failed: ${formatProbeError(error)}`);
		}
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args[0] === "--probe") {
		const { puppeteer, hooks } = await importPayload(args[1]);
		hooks.deregister();
		if (args.includes("--browser")) await browserProbe(puppeteer);
		return;
	}
	const value = (name, fallback) => {
		const index = args.indexOf(name);
		if (index < 0) return fallback;
		assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a path`);
		return path.resolve(args[index + 1]);
	};
	verifyDemoRuntime(value("--standalone", path.resolve(import.meta.dirname, "../.next/standalone")), value("--runtime", process.execPath), args.includes("--browser"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => { console.error(`[smoke-demo-runtime] FAIL: ${formatProbeError(err)}`); process.exitCode = 1; });
}
