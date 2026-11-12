/**
 * verify-release.ts — la barrera final de la publicación de escritorio
 * (2026-10-13).
 *
 * Se ejecuta en el ÚLTIMO job del flujo de publicación, después de que los
 * tres jobs de empaquetado hayan subido al único borrador de GitHub Release
 * de la etiqueta, y hace fallar el flujo salvo que ese borrador contenga
 * exactamente lo que necesitan los usuarios finales y electron-updater. El
 * flujo nunca publica; este script solo lee (la lista de publicaciones con
 * el token de solo lectura del flujo y las fuentes de actualización
 * descargadas por los propios pasos gh del flujo).
 *
 * Cada nombre de fichero esperado de abajo se verificó con el builder
 * INSTALADO (app-builder-lib 26.15.3): son los artefactos que emite de
 * verdad para el electron-builder.yml de este repo, no suposiciones por
 * patrón:
 *
 *   mac (dmg + zip, arm64; ahí no hay artifactName del usuario):
 *     dmg    LearnHarness-<v>-arm64.dmg       + .blockmap (createBlockmap)
 *     zip    LearnHarness-<v>-arm64-mac.zip   + .blockmap (createBlockmap;
 *            Squirrel.Mac actualiza desde el ZIP: ES la carga del actualizador)
 *     feed   latest-mac.yml — files[0] es el ZIP (writeUpdateInfoFiles
 *            ordena el zip primero) y los campos heredados de nivel superior
 *            path/sha512 apuntan a él.
 *   win (nsis x64; artifactName "${productName}-${version}-${arch}-setup.${ext}"):
 *     exe    LearnHarness-<v>-x64-setup.exe   + .blockmap (createBlockmap)
 *     feed   latest.yml — una única entrada de fichero, el exe.
 *   linux (AppImage + deb, x64; artifactName "${productName}-${version}-${arch}.${ext}"
 *            lo fuerza el usuario a nivel linux, así que sustituye los formatos
 *            de nombre por defecto de AMBOS destinos, y ${arch} se expande según
 *            la ext de cada destino: x64→x86_64 en AppImage, x64→amd64 en deb):
 *     image  LearnHarness-<v>-x86_64.AppImage (sin blockmap en 26.15.3)
 *     deb    LearnHarness-<v>-amd64.deb       (sin blockmap)
 *     feed   latest-linux.yml — las entradas de AppImage y deb fusionadas por
 *            writeUpdateInfoFiles (orden no determinista; se comprueba como conjunto).
 *
 * Los nombres de los assets de GitHub son iguales a estos nombres de fichero
 * (todos son ya nombres «seguros» para GitHub, así que electron-publish los
 * sube con el nombre tal cual) y cada files[].url de los yml es igual al
 * nombre del asset subido.
 *
 * La selección del borrador FALLA EN CERRADO y replica el emparejamiento
 * existente que usan el job de borrador del flujo y el publicador de GitHub
 * de electron-builder: tag_name es igual a la etiqueta ("v0.2.0") O a la
 * versión sin prefijo ("0.2.0"). Cero coincidencias, 2 o más, o una
 * coincidencia ya publicada → fallo. Un borrador que solo coincide por la
 * forma sin prefijo es un riesgo que se informa: electron-builder empareja
 * ambas grafías, así que una ejecución posterior podría crear un SEGUNDO
 * borrador con la etiqueta v y repartir los assets entre dos publicaciones.
 *
 * CLI (cwd = la revisión de la etiqueta extraída):
 *   tsx scripts/verify-release.ts select <releases.json> --tag <tag>
 *     → un objeto JSON en stdout: {releaseId, matchedTagName, warnings,
 *       assets:[{id,name,size,state}]}; diagnósticos en stderr. Lo usa el
 *       flujo para localizar el borrador y los ids de sus assets.
 *   tsx scripts/verify-release.ts verify <releases.json> <metadata-dir> --tag <tag>
 *     → la barrera completa; informe legible en stdout; sale con 0 solo
 *       cuando todo lo de abajo se cumple.
 *
 * La barrera comprueba, y falla en cerrado ante cualquiera de estos casos:
 *   - etiqueta ≠ "v" + la versión de package.json, o una lista de
 *     publicaciones mal formada;
 *   - que electron-builder.yml/package.json se desvíen de las formas de las
 *     que se derivaron los nombres esperados (actualiza las expectativas de
 *     este fichero cuando cambie la configuración de empaquetado: es
 *     estricto a propósito);
 *   - problemas en la selección del borrador (arriba);
 *   - assets esperados que faltan, de tamaño cero, que no están en el estado
 *     "uploaded", duplicados, o extras inesperados (nombres obsoletos de una
 *     ejecución anterior);
 *   - fuentes de actualización que no se pueden analizar, llevan la versión
 *     equivocada, referencian una ruta/URL en vez de un nombre de asset
 *     simple (recorrido de directorios / origen no fiable), referencian un
 *     asset que la publicación no contiene, no coinciden con el tamaño del
 *     asset que informa la API, tienen entradas que faltan o mal colocadas
 *     (el ZIP de mac debe ir primero y respaldar los campos heredados
 *     path/sha512) o llevan un sha512 inverosímil.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load(source: string): unknown };

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ReleaseAsset = { id: number; name: string; size: number; state: string };
export type ReleaseRecord = { id: number; tag_name: string; draft: boolean; assets: ReleaseAsset[] };

export type Failures = { ok: false; errors: string[] };
export type DraftSelection =
	| { ok: true; release: ReleaseRecord; warnings: string[] }
	| Failures;

/** El inventario completo de assets esperados para una versión (11 ficheros). */
export type ExpectedAssets = {
	version: string;
	mac: { dmg: string; zip: string; feed: string };
	win: { exe: string; feed: string };
	linux: { appImage: string; deb: string; feed: string };
	/** Todos los nombres de asset que debe contener el borrador, y ninguno más. */
	files: string[];
};

type Issue = string;
type Issues = Issue[];

// ---------------------------------------------------------------------------
// Versión + assets esperados
// ---------------------------------------------------------------------------

/** Nombre de producto verificado que aparece en cada artefacto (productName de electron-builder.yml). */
const PRODUCT_NAME = "LearnHarness";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function checkVersion(version: unknown): { ok: true; version: string } | { ok: false; errors: Issues } {
	if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
		return { ok: false, errors: [`package.json version must be a plain semver string, got ${JSON.stringify(version)}`] };
	}
	return { ok: true, version };
}

/** El conjunto exacto de assets que emite el builder instalado para la configuración de este repo. */
export function expectedAssets(version: string): ExpectedAssets {
	const mac = {
		dmg: `${PRODUCT_NAME}-${version}-arm64.dmg`,
		zip: `${PRODUCT_NAME}-${version}-arm64-mac.zip`,
		feed: "latest-mac.yml",
	};
	const win = {
		exe: `${PRODUCT_NAME}-${version}-x64-setup.exe`,
		feed: "latest.yml",
	};
	const linux = {
		appImage: `${PRODUCT_NAME}-${version}-x86_64.AppImage`,
		deb: `${PRODUCT_NAME}-${version}-amd64.deb`,
		feed: "latest-linux.yml",
	};
	// Blockmaps adjuntos de actualización diferencial: se emiten para el dmg, el zip de mac y
	// el exe de NSIS (createBlockmap); AppImage/deb no tienen en app-builder-lib 26.15.3.
	const blockmaps = [mac.dmg, mac.zip, win.exe].map((name) => `${name}.blockmap`);
	return {
		version,
		mac,
		win,
		linux,
		files: [mac.dmg, mac.zip, win.exe, linux.appImage, linux.deb, ...blockmaps, mac.feed, win.feed, linux.feed],
	};
}

// ---------------------------------------------------------------------------
// Análisis de la lista de publicaciones (falla en cerrado ante cualquier entrada mal formada)
// ---------------------------------------------------------------------------

/**
 * `gh api --paginate --slurp` emite un array de páginas ([[...], [...]]);
 * una sola página hecha a mano es un array simple. Se aceptan ambos; todo lo
 * demás falla.
 */
export function normalizeReleasePages(input: unknown): { ok: true; releases: unknown[] } | { ok: false; errors: Issues } {
	if (!Array.isArray(input)) {
		return { ok: false, errors: ["release list is not a JSON array"] };
	}
	const pages = input.length > 0 && Array.isArray(input[0]) ? input : [input];
	return { ok: true, releases: pages.flat() };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReleases(entries: unknown[]): { ok: true; releases: ReleaseRecord[] } | { ok: false; errors: Issues } {
	const errors: Issues = [];
	const releases: ReleaseRecord[] = [];
	entries.forEach((entry, index) => {
		const label = `releases[${index}]`;
		if (!isPlainObject(entry)) {
			errors.push(`${label}: not an object`);
			return;
		}
		const id = entry.id;
		const tagName = entry.tag_name;
		const draft = entry.draft;
		const assets = entry.assets;
		if (typeof id !== "number" || !Number.isFinite(id)) errors.push(`${label}: id is not a number`);
		if (typeof tagName !== "string" || tagName === "") errors.push(`${label}: tag_name is not a non-empty string`);
		if (typeof draft !== "boolean") errors.push(`${label}: draft is not a boolean`);
		const parsedAssets: ReleaseAsset[] = [];
		if (!Array.isArray(assets)) {
			errors.push(`${label}: assets is not an array`);
		} else {
			assets.forEach((asset, assetIndex) => {
				const assetLabel = `${label}.assets[${assetIndex}]`;
				if (!isPlainObject(asset)) {
					errors.push(`${assetLabel}: not an object`);
					return;
				}
				const { id: assetId, name, size, state } = asset;
				const assetOk =
					typeof assetId === "number" && Number.isFinite(assetId) &&
					typeof name === "string" && name !== "" &&
					typeof size === "number" && Number.isFinite(size) &&
					typeof state === "string" && state !== "";
				if (!assetOk) {
					errors.push(`${assetLabel}: needs numeric id, non-empty string name, numeric size, non-empty string state`);
					return;
				}
				parsedAssets.push({ id: assetId, name, size, state });
			});
		}
		if (typeof id === "number" && typeof tagName === "string" && tagName !== "" && typeof draft === "boolean") {
			releases.push({ id, tag_name: tagName, draft, assets: parsedAssets });
		}
	});
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, releases };
}

// ---------------------------------------------------------------------------
// Selección del borrador (replica el emparejamiento del job de borrador + del builder, falla en cerrado)
// ---------------------------------------------------------------------------

export function selectDraft(releases: ReleaseRecord[], tag: string, version: string): DraftSelection {
	const matches = releases.filter((release) => release.tag_name === tag || release.tag_name === version);
	if (matches.length === 0) {
		return {
			ok: false,
			errors: [
				`no release matches "${tag}" or "${version}" — the draft job should have prepared exactly one draft; refusing to pass`,
			],
		};
	}
	if (matches.length > 1) {
		const list = matches.map((release) => `#${release.id} (${release.tag_name}, ${release.draft ? "draft" : "published"})`).join(", ");
		return { ok: false, errors: [`${matches.length} releases match ${tag}: ${list} — resolve to exactly one before publishing`] };
	}
	const [match] = matches;
	if (!match) return { ok: false, errors: ["internal: empty match"] };
	if (!match.draft) {
		return {
			ok: false,
			errors: [`release #${match.id} (${match.tag_name}) is already published — the workflow never modifies a published release`],
		};
	}
	const warnings: string[] = [];
	if (match.tag_name !== tag) {
		warnings.push(
			`draft #${match.id} carries the unprefixed tag "${match.tag_name}" instead of "${tag}": electron-builder matches both spellings, ` +
			`so a future run could create a SECOND draft under "${tag}" and split the assets — rename the release to "${tag}" before publishing`,
		);
	}
	return { ok: true, release: match, warnings };
}

// ---------------------------------------------------------------------------
// Protección contra la deriva de la configuración de empaquetado
// ---------------------------------------------------------------------------

/** Los nombres de abajo se derivaron de estas formas exactas de la
 * configuración; una deriva significa que las expectativas de este fichero
 * deben volver a derivarse a partir de la salida del nuevo builder. Fallar
 * aquí es intencionado: una barrera obsoleta en silencio es peor. */
export function verifyConfigAssumptions(config: unknown, pkg: unknown): { ok: true } | { ok: false; errors: Issues } {
	const errors: Issues = [];
	const bad = (message: string) => errors.push(message);
	if (!isPlainObject(pkg) || typeof pkg.version !== "string") bad("package.json has no string version");
	if (!isPlainObject(pkg) || pkg.name !== "learnharness") bad("package.json name is no longer \"learnharness\"");
	if (!isPlainObject(config)) {
		return { ok: false, errors: ["electron-builder.yml did not parse to a mapping", ...errors] };
	}
	if (config.productName !== PRODUCT_NAME) bad(`productName is ${JSON.stringify(config.productName)}, expected "${PRODUCT_NAME}"`);
	if (config.artifactName != null) bad("a top-level artifactName now overrides target defaults — expected names no longer hold");
	const sameTargets = (actual: unknown, expected: Array<Record<string, unknown>>) =>
		JSON.stringify(actual) === JSON.stringify(expected);
	if (!isPlainObject(config.mac)) bad("mac section missing");
	else {
		if (config.mac.artifactName != null) bad("mac.artifactName set — expected names no longer hold");
		if (!sameTargets(config.mac.target, [{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] }])) {
			bad(`mac.target changed (${JSON.stringify(config.mac.target)}) — expected names no longer hold`);
		}
	}
	if (!isPlainObject(config.win)) bad("win section missing");
	else {
		if (config.win.artifactName !== "${productName}-${version}-${arch}-setup.${ext}") {
			bad(`win.artifactName changed (${JSON.stringify(config.win.artifactName)}) — expected names no longer hold`);
		}
		if (!sameTargets(config.win.target, [{ target: "nsis", arch: ["x64"] }])) {
			bad(`win.target changed (${JSON.stringify(config.win.target)}) — expected names no longer hold`);
		}
	}
	if (!isPlainObject(config.linux)) bad("linux section missing");
	else {
		if (config.linux.artifactName !== "${productName}-${version}-${arch}.${ext}") {
			bad(`linux.artifactName changed (${JSON.stringify(config.linux.artifactName)}) — expected names no longer hold`);
		}
		if (!sameTargets(config.linux.target, [{ target: "AppImage", arch: ["x64"] }, { target: "deb", arch: ["x64"] }])) {
			bad(`linux.target changed (${JSON.stringify(config.linux.target)}) — expected names no longer hold`);
		}
	}
	const publish = Array.isArray(config.publish) ? config.publish[0] : undefined;
	if (!isPlainObject(publish) || publish.provider !== "github" || publish.releaseType !== "draft") {
		bad(`publish[0] must be the github provider with releaseType "draft" (${JSON.stringify(config.publish)}) — uploads would not land in the draft`);
	}
	if (errors.length > 0) {
		errors.push("packaging config drifted from the verified shapes — re-derive the expected assets in scripts/verify-release.ts");
		return { ok: false, errors };
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Inventario de assets
// ---------------------------------------------------------------------------

export function verifyAssets(release: ReleaseRecord, expected: ExpectedAssets): { ok: true } | { ok: false; errors: Issues } {
	const errors: Issues = [];
	const seen = new Map<string, ReleaseAsset>();
	for (const asset of release.assets) {
		if (seen.has(asset.name)) errors.push(`duplicate asset name on the release: ${asset.name}`);
		else seen.set(asset.name, asset);
		// Se comprueba para CADA entrada, duplicados incluidos; falla en cerrado.
		if (asset.state !== "uploaded") errors.push(`${asset.name}: state is "${asset.state}", not "uploaded"`);
		if (!(asset.size > 0)) errors.push(`${asset.name}: zero-size asset (size=${asset.size})`);
		if (!expected.files.includes(asset.name)) {
			errors.push(`${asset.name}: unexpected asset — not in the expected set (stale name from an older run?)`);
		}
	}
	for (const name of expected.files) {
		if (!seen.has(name)) errors.push(`${name}: missing from the release`);
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Verificación de las fuentes de actualización (latest*.yml)
// ---------------------------------------------------------------------------

type FeedExpectation = {
	file: string;
	/** Todos los files[].url que debe referenciar la fuente: exactamente estos, ni uno más. */
	urls: string[];
	/** Si está definido, files[0].url debe ser esta entrada (mac: el ZIP del actualizador). */
	first?: string;
};

export function feedExpectations(expected: ExpectedAssets): FeedExpectation[] {
	return [
		{ file: expected.mac.feed, urls: [expected.mac.zip, expected.mac.dmg], first: expected.mac.zip },
		{ file: expected.win.feed, urls: [expected.win.exe] },
		{ file: expected.linux.feed, urls: [expected.linux.appImage, expected.linux.deb] },
	];
}

/** Una referencia del actualizador debe ser un nombre de fichero simple: sin
 * directorios, sin recorrido de directorios, sin esquema URI, sin
 * consulta/fragmento. Cualquier otra cosa es una ruta con la que se podría
 * desviar al actualizador. */
export function isPlainAssetName(url: unknown): url is string {
	return typeof url === "string" && url !== "" && url !== "." && url !== ".." &&
		!url.includes("/") && !url.includes("\\") && !url.includes(":") && !url.includes("?") && !url.includes("#") && !url.startsWith("~");
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{80,}={0,2}$/;

type FeedFileEntry = { url: string; sha512: string; size: number };

export function verifyMetadataFiles(
	files: Record<string, string>,
	release: ReleaseRecord,
	expected: ExpectedAssets,
): { ok: true } | { ok: false; errors: Issues } {
	const errors: Issues = [];
	const byName = new Map(release.assets.map((asset) => [asset.name, asset]));
	const expectations = feedExpectations(expected);

	for (const expectation of expectations) {
		const content = files[expectation.file];
		if (content == null) {
			errors.push(`${expectation.file}: not downloaded (or empty) — cannot verify the update feed`);
			continue;
		}
		let info: unknown;
		try {
			info = yaml.load(content);
		} catch (error) {
			errors.push(`${expectation.file}: does not parse as YAML (${String(error)})`);
			continue;
		}
		if (!isPlainObject(info)) {
			errors.push(`${expectation.file}: top level is not a mapping`);
			continue;
		}
		if (info.version !== expected.version) {
			errors.push(`${expectation.file}: version is ${JSON.stringify(info.version)}, expected "${expected.version}"`);
		}
		if (!Array.isArray(info.files) || info.files.length === 0) {
			errors.push(`${expectation.file}: no files[] entries`);
			continue;
		}
		const entries: FeedFileEntry[] = [];
		let malformed = false;
		info.files.forEach((entry, index) => {
			if (!isPlainObject(entry)) {
				errors.push(`${expectation.file}: files[${index}] is not a mapping`);
				malformed = true;
				return;
			}
			const { url, sha512, size } = entry;
			if (!isPlainAssetName(url)) {
				errors.push(`${expectation.file}: files[${index}].url is not a bare asset name (${JSON.stringify(entry.url)}) — traversal or untrusted origin`);
				malformed = true;
				return;
			}
			if (typeof sha512 !== "string" || !SHA512_BASE64.test(sha512)) {
				errors.push(`${expectation.file}: files[${index}] (${entry.url}): sha512 is not a base64 digest`);
				malformed = true;
				return;
			}
			if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
				errors.push(`${expectation.file}: files[${index}] (${entry.url}): size must be a positive integer`);
				malformed = true;
				return;
			}
			entries.push({ url, sha512, size });
		});
		if (malformed) continue;
		const urls = entries.map((entry) => entry.url);
		for (const url of urls) {
			const asset = byName.get(url);
			if (asset == null) {
				errors.push(`${expectation.file}: references "${url}" which is not an asset of release #${release.id}`);
			} else if (asset.size !== entries.find((entry) => entry.url === url)?.size) {
				errors.push(`${expectation.file}: "${url}" size ${entries.find((entry) => entry.url === url)?.size} ≠ release asset size ${asset.size}`);
			}
		}
		const expectedSet = [...expectation.urls].sort().join("\n");
		const actualSet = [...urls].sort().join("\n");
		if (actualSet !== expectedSet) {
			errors.push(`${expectation.file}: references [${urls.join(", ")}] but must reference exactly [${expectation.urls.join(", ")}]`);
		}
		if (expectation.first != null && urls[0] !== expectation.first) {
			errors.push(`${expectation.file}: files[0] must be "${expectation.first}" (got "${urls[0] ?? "nothing"}")`);
		}
		// Campos heredados de un solo fichero que electron-updater sigue leyendo en algunas vías:
		// el builder los respalda con files[0].
		const first = entries[0];
		if (first) {
			if (info.path !== first.url) {
				errors.push(`${expectation.file}: top-level path is ${JSON.stringify(info.path)}, must be "${first.url}"`);
			}
			if (info.sha512 !== first.sha512) {
				errors.push(`${expectation.file}: top-level sha512 does not match files[0] (${first.url})`);
			}
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true };
}

// ---------------------------------------------------------------------------
// CLI (fina: analiza los argumentos, lee los ficheros, ejecuta el núcleo puro, imprime y sale)
// ---------------------------------------------------------------------------

function usage(): string {
	return [
		"usage:",
		"  verify-release.ts select <releases.json> --tag <tag>",
		"  verify-release.ts verify <releases.json> <metadata-dir> --tag <tag>",
	].join("\n");
}

function readJson(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
	let source: string;
	try {
		source = fs.readFileSync(file, "utf8");
	} catch (error) {
		return { ok: false, error: `cannot read ${file}: ${String(error)}` };
	}
	try {
		return { ok: true, value: JSON.parse(source) };
	} catch (error) {
		return { ok: false, error: `${file} is not valid JSON: ${String(error)}` };
	}
}

function loadReleases(file: string): { ok: true; releases: ReleaseRecord[] } | { ok: false; errors: Issues } {
	const json = readJson(file);
	if (!json.ok) return { ok: false, errors: [json.error] };
	const normalized = normalizeReleasePages(json.value);
	if (!normalized.ok) return normalized;
	return parseReleases(normalized.releases);
}

/** Lee package.json (versión) + electron-builder.yml del cwd: el flujo extrae
 * la revisión etiquetada antes de ejecutar la barrera. */
function loadRepoConfig(): { ok: true; pkg: unknown; config: unknown } | { ok: false; errors: Issues } {
	const pkg = readJson("package.json");
	if (!pkg.ok) return { ok: false, errors: [pkg.error] };
	let configSource: string;
	try {
		configSource = fs.readFileSync("electron-builder.yml", "utf8");
	} catch (error) {
		return { ok: false, errors: [`cannot read electron-builder.yml: ${String(error)}`] };
	}
	try {
		return { ok: true, pkg: pkg.value, config: yaml.load(configSource) };
	} catch (error) {
		return { ok: false, errors: [`electron-builder.yml does not parse as YAML: ${String(error)}`] };
	}
}

function fail(errors: Issues): number {
	for (const error of errors) console.error(`ERROR: ${error}`);
	console.error("FAILED: the draft release gate found problems — do not publish; fix and re-run the release workflow.");
	return 1;
}

function parseArgs(argv: string[]): { ok: true; command: string; positional: string[]; tag?: string } | { ok: false; errors: Issues } {
	const positional: string[] = [];
	let tag: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--tag") {
			tag = argv[++i];
			if (tag == null || tag === "") return { ok: false, errors: ["--tag needs a value"] };
		} else {
			positional.push(arg);
		}
	}
	const [command] = positional;
	if (command !== "select" && command !== "verify") return { ok: false, errors: [usage()] };
	return { ok: true, command, positional: positional.slice(1), tag };
}

/** Concordancia etiqueta ↔ versión + carga de la lista de publicaciones, compartidas por ambos comandos. */
function startGate(argv: string[]):
	| { ok: true; tag: string; version: string; releases: ReleaseRecord[]; config: unknown; pkg: unknown; positional: string[] }
	| { ok: false; errors: Issues } {
	const parsed = parseArgs(argv);
	if (!parsed.ok) return parsed;
	const releasesFile = parsed.positional[0];
	if (parsed.tag == null) return { ok: false, errors: ["--tag is required (the pushed tag, e.g. v0.2.0)"] };
	if (releasesFile == null) return { ok: false, errors: [usage()] };
	const repo = loadRepoConfig();
	if (!repo.ok) return repo;
	const versioned = checkVersion(isPlainObject(repo.pkg) ? repo.pkg.version : undefined);
	if (!versioned.ok) return versioned;
	const expectedTag = `v${versioned.version}`;
	if (parsed.tag !== expectedTag) {
		return { ok: false, errors: [`tag ${parsed.tag} does not equal "v" + package.json version ("${expectedTag}")`] };
	}
	const releases = loadReleases(releasesFile);
	if (!releases.ok) return releases;
	return {
		ok: true,
		tag: parsed.tag,
		version: versioned.version,
		releases: releases.releases,
		config: repo.config,
		pkg: repo.pkg,
		positional: parsed.positional,
	};
}

function main(argv: string[]): number {
	const start = startGate(argv);
	if (!start.ok) return fail(start.errors);
	const expected = expectedAssets(start.version);

	if (argv[0] === "select") {
		const selection = selectDraft(start.releases, start.tag, start.version);
		if (!selection.ok) return fail(selection.errors);
		for (const warning of selection.warnings) console.error(`WARNING: ${warning}`);
		const report = {
			releaseId: selection.release.id,
			tag: start.tag,
			matchedTagName: selection.release.tag_name,
			warnings: selection.warnings,
			assets: selection.release.assets.map((asset) => ({ id: asset.id, name: asset.name, size: asset.size, state: asset.state })),
		};
		process.stdout.write(`${JSON.stringify(report, null, "\t")}\n`);
		return 0;
	}

	// verify
	const metadataDir = start.positional[1];
	if (metadataDir == null) return fail([usage()]);
	const errors: Issues = [];
	const assumptions = verifyConfigAssumptions(start.config, start.pkg);
	if (!assumptions.ok) errors.push(...assumptions.errors);
	const selection = selectDraft(start.releases, start.tag, start.version);
	if (!selection.ok) return fail([...errors, ...selection.errors]);
	console.log(`draft release #${selection.release.id} — tag "${selection.release.tag_name}"`);
	for (const warning of selection.warnings) console.log(`WARNING: ${warning}`);
	const assets = verifyAssets(selection.release, expected);
	if (!assets.ok) errors.push(...assets.errors);
	const files: Record<string, string> = {};
	for (const name of [expected.mac.feed, expected.win.feed, expected.linux.feed]) {
		try {
			files[name] = fs.readFileSync(path.join(metadataDir, name), "utf8");
		} catch {
			// verifyMetadataFiles informa de la fuente que falta por su nombre.
		}
	}
	const metadata = verifyMetadataFiles(files, selection.release, expected);
	if (!metadata.ok) errors.push(...metadata.errors);
	if (errors.length > 0) return fail(errors);
	const present = expected.files.filter((name) => selection.release.assets.some((asset) => asset.name === name));
	console.log(`assets: ${present.length}/${expected.files.length} expected files present, non-zero size, and "uploaded"`);
	console.log(`feeds: ${expected.mac.feed}, ${expected.win.feed}, ${expected.linux.feed} parse, carry version ${start.version}, and reference only uploaded assets by exact name`);
	console.log(`OK: draft for ${start.tag} is complete and consistent — ready for the owner to review and publish.`);
	return 0;
}

const invokedAsCli = process.argv[1] != null && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsCli) process.exitCode = main(process.argv.slice(2));
