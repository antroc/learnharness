/** Genera Markdown sin conexión a partir del SDK portable exacto, no de un esquema de API paralelo. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const marker = "<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->";
const slug = value => value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "").replace(/ /g, "-");
const code = value => "`" + value.replaceAll("`", "&#96;").replaceAll("|", "\\|").replaceAll("\n", " ") + "`";
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
const guides = {
	"plugins": ["Autoría y ciclo de vida", "../plugin-authoring.md"],
	"plugin-ui": ["Interfaz controlada del host", "../plugin-authoring.md#interfaz-controlada-del-host"],
	"plugin-tree": ["Comportamiento de los árboles", "../plugin-tree-contract.md"],
	"plugin-questions": ["Ciclo de vida de las preguntas", "../plugin-question-contract.md"],
	"plugin-problems": ["Ciclo de vida de los problemas de práctica", "../plugin-problem-contract.md"],
	"plugin-submissions": ["Intercepción de envíos", "../plugin-session-extension-contract.md"],
	"plugin-view-context": ["Contexto de vista de la sesión", "../plugin-view-context.md"],
	"plugin-agents": ["Agentes gestionados", "../plugin-authoring.md#agentes-conversacionales-gestionados"],
	"plugin-workers": ["Workers y herramientas en segundo plano", "../plugin-authoring.md#workers-orientados-a-resultados-y-herramientas-en-segundo-plano"],
	"plugin-shortcuts": ["Atajos de acciones", "../plugin-authoring.md#atajos-de-acciones"],
};
const declarationKind = node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isEnumDeclaration(node);
function comments(node) {
	return (node.jsDoc ?? []).map(doc => typeof doc.comment === "string" ? doc.comment : doc.comment?.map(part => part.text ?? "").join("") ?? "").filter(Boolean).join("\n\n");
}
function members(node, prefix = "") {
	const result = [];
	function visit(type, current) {
		if (!type) return;
		if (ts.isParenthesizedTypeNode(type)) return visit(type.type, current);
		if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.forEach(child => visit(child, current));
		if (!ts.isInterfaceDeclaration(type) && !ts.isTypeLiteralNode(type)) return;
		for (const member of type.members) {
			const name = member.name?.getText() ?? (ts.isIndexSignatureDeclaration(member) ? "[index]" : "[call]");
			const key = current ? current + "." + name : name;
			result.push({ key, node: member });
			visit(member.type, key);
		}
	}
	visit(ts.isTypeAliasDeclaration(node) ? node.type : node, prefix);
	return result;
}

/** Lee solo ficheros locales del SDK. No sigas imports hacia código del host, paquetes pares ni un árbol enlazado. */
function sdkFiles(directory) {
	const found = new Map();
	function walk(current) {
		if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Refusing API reference source symlink: ${current}`);
		for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
			const filename = path.join(current, entry.name);
			if (entry.isSymbolicLink()) throw Error(`Refusing API reference source symlink: ${filename}`);
			if (entry.isDirectory()) walk(filename);
			else if (entry.isFile()) found.set(filename, fs.readFileSync(filename, "utf8"));
			else throw Error(`Refusing non-file API reference source: ${filename}`);
		}
	}
	walk(directory); return found;
}

export function createPluginApiReference({ sdk }) {
	sdk = path.resolve(sdk);
	const sources = sdkFiles(sdk), index = path.join(sdk, "index.d.ts");
	if (!sources.has(index)) throw Error("API reference requires the portable SDK index.d.ts");
	const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, types: [], noEmit: true };
	const host = ts.createCompilerHost(options);
	host.readFile = filename => sources.get(path.resolve(filename));
	host.fileExists = filename => sources.has(path.resolve(filename));
	host.directoryExists = directory => [...sources.keys()].some(filename => filename.startsWith(path.resolve(directory) + path.sep));
	host.getSourceFile = (filename, languageVersion) => {
		const text = host.readFile(filename);
		return text === undefined ? undefined : ts.createSourceFile(filename, text, languageVersion, true);
	};
	const program = ts.createProgram([index], options, host), checker = program.getTypeChecker();
	for (const file of program.getSourceFiles()) {
		function checkImport(node) {
			const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
			if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
				const resolved = ts.resolveModuleName(specifier.text, file.fileName, options, host).resolvedModule;
				if (!resolved || !sources.has(path.resolve(resolved.resolvedFileName))) throw Error(`Refusing API reference import outside or missing SDK: ${specifier.text}`);
			}
			ts.forEachChild(node, checkImport);
		}
		checkImport(file);
	}
	const source = program.getSourceFile(index), symbol = source && checker.getSymbolAtLocation(source);
	if (!symbol) throw Error("Cannot resolve portable SDK exports");
	const resolve = symbol => symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
	const named = symbol => resolve(symbol)?.declarations?.filter(declarationKind) ?? [];
	const publicNames = new Map();
	for (const exported of checker.getExportsOfModule(symbol)) for (const node of named(exported)) if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
		const names = publicNames.get(node) ?? []; names.push(exported.name); publicNames.set(node, names);
	}
	if (!publicNames.size) throw Error("API reference requires public type declarations");
	const entries = new Map(), queue = [...publicNames.keys()], origins = new Map();
	while (queue.length) {
		const node = queue.shift();
		if (entries.has(node)) continue;
		const filename = path.resolve(node.getSourceFile().fileName);
		if (!sources.has(filename)) continue;
		const module = path.relative(sdk, filename).replaceAll(path.sep, "/").replace(/^src\/core\//, "").replace(/\.d\.ts$/, "").replaceAll("/", "-");
		if (origins.has(module) && origins.get(module) !== filename) throw Error(`Ambiguous API reference module: ${module}`);
		origins.set(module, filename);
		const entry = { node, name: node.name.getText(), module, public: publicNames.has(node), exports: publicNames.get(node) ?? [], members: members(node) };
		entries.set(node, entry);
		function visit(child) {
			if (ts.isIdentifier(child)) for (const declaration of named(checker.getSymbolAtLocation(child))) if (sources.has(path.resolve(declaration.getSourceFile().fileName)) && !entries.has(declaration)) queue.push(declaration);
			ts.forEachChild(child, visit);
		}
		ts.forEachChild(node, visit);
	}
	const ordered = [...entries.values()].sort((a, b) => a.module.localeCompare(b.module, "en") || a.name.localeCompare(b.name, "en"));
	const link = entry => `${entry.module}.md#${slug(entry.name)}`;
	const print = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).trim();
	const pages = new Map(), modules = [...new Set(ordered.map(entry => entry.module))];
	for (const module of modules) {
		const local = ordered.filter(entry => entry.module === module);
		const guide = guides[module] ?? ["Acceso a datos y límites del host", "../plugin-authoring.md#backend-y-datos"];
		const text = [`# ${module}`, "", marker, "", `[Índice de la API](README.md) · [${guide[0]}](${guide[1]})`, "", ...local.map(entry => `- [${entry.name}](#${slug(entry.name)})${entry.public ? "" : " — declaración de apoyo"}`), ""];
		for (const entry of local) {
			text.push(`## ${entry.name}`, "", entry.public ? `Tipo público del SDK, exportado como ${entry.exports.map(code).join(", ")}. Impórtalo con \`import type\`; el SDK no tiene exportaciones en tiempo de ejecución.` : "Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.", "");
			if (comments(entry.node)) text.push(comments(entry.node), "");
			let declaration = print(entry.node);
			if (ts.isVariableDeclaration(entry.node)) declaration = "declare const " + declaration + ";";
			text.push("```ts", declaration, "```", "");
			const related = new Set();
			function references(node) {
				if (ts.isIdentifier(node)) for (const declaration of named(checker.getSymbolAtLocation(node))) {
					const target = entries.get(declaration);
					if (target && target !== entry) related.add(target);
				}
				ts.forEachChild(node, references);
			}
			ts.forEachChild(entry.node, references);
			if (related.size) text.push("**Tipos relacionados:** " + [...related].sort((a, b) => a.name.localeCompare(b.name, "en")).map(target => `[${target.name}](${link(target)})`).join(", ") + ".", "");
			if (!entry.members.length) continue;
			const grouped = Map.groupBy(entry.members, member => member.key);
			text.push("**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):", "");
			for (const [key, variants] of grouped) text.push(`- [${key}](#${slug(entry.name + " " + key)})${variants.length > 1 ? ` — ${variants.length} firmas o variantes` : ""}`);
			text.push("");
			for (const [key, variants] of grouped) {
				text.push(`### ${entry.name} ${key}`, "");
				for (const { node } of variants) {
					if (comments(node)) text.push(comments(node), "");
					text.push("```ts", print(node), "```", "");
					const signature = ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node) ? node : node.type && ts.isFunctionTypeNode(node.type) ? node.type : undefined;
					if (signature) {
						if (signature.parameters.length) text.push("| Parámetro | Tipo |", "| --- | --- |", ...signature.parameters.map(parameter => `| ${code(parameter.name.getText() + (parameter.questionToken ? "?" : ""))} | ${code(parameter.type?.getText() ?? "unknown")} |`), "");
						text.push(`**Devuelve:** ${code(signature.type?.getText() ?? "void")}.`, "");
					}
				}
			}
		}
		pages.set(module + ".md", text.join("\n").trimEnd() + "\n");
	}
	const publicEntries = ordered.filter(entry => entry.public), supporting = ordered.filter(entry => !entry.public);
	const home = ["# Referencia de la API de plugins", "", marker, "", "[Empieza aquí](../plugin-authoring.md) · [Ejemplos y rutas de lectura del código fuente](../plugin-examples.md)", "", "Esta es la referencia estructural completa generada a partir del SDK portable correspondiente. Incluye las exportaciones de tipos públicos, cada campo, método y sobrecarga declarados, los miembros de objetos anidados y los tipos de apoyo locales a los que se hace referencia. Sigue las guías enlazadas para las reglas de ciclo de vida, validación, recuperación e interacción; los tipos por sí solos no prometen ningún comportamiento en tiempo de ejecución.", "", "El SDK es **solo de tipos**. Llama a los contextos que proporciona LearnHarness, no a importaciones en tiempo de ejecución de `learnharness-plugin-api`. En los ficheros de declaraciones pueden aparecer funciones o constantes de la implementación del host; no son exportaciones invocables del SDK. Las declaraciones de apoyo de más abajo explican relaciones entre tipos, no capacidades adicionales de los plugins. Las identidades opacas las sigue creando el host.", "", "## Puntos de entrada", ""];
	for (const name of ["PluginManifest", "PluginFrontendModule", "PluginBackendModule", "PluginFrontendContext", "PluginBackendContext", "PluginUi", "PluginLearningData", "PluginInference", "PluginAgentService", "PluginWorkerService"]) {
		const entry = publicEntries.find(entry => entry.name === name);
		if (entry) home.push(`- [${name}](${link(entry)})`);
	}
	home.push("", "## Módulos", "", ...modules.map(module => `- [${module}](${module}.md)`), "", "## Tipos públicos", "", "| Tipo | Módulo |", "| --- | --- |");
	const publicExports = publicEntries.flatMap(entry => entry.exports.map(name => ({ name, entry }))).sort((a, b) => a.name.localeCompare(b.name, "en"));
	for (const { name, entry } of publicExports) home.push(`| [${name}](${link(entry)}) | ${code(entry.module)} |`);
	home.push("", "## Declaraciones de apoyo", "", "Se llega a ellas a través de relaciones de datos públicos, eventos, herencia o tipos auxiliares. Los tipos que no se reexportan desde la raíz del SDK no pueden importarse por su nombre desde esa raíz; accede a ellos a través de los tipos públicos y no mediante importaciones privadas de la app.", "", ...supporting.map(entry => `- [${entry.name}](${link(entry)}) — ${code(entry.module)}`), "", "## Tipos externos", "", "Los tipos estándar de JavaScript y del DOM (`Promise`, `AbortSignal`, `File`, `HTMLElement` y los tipos utilitarios) siguen sus contratos estándar. Los modelos, mensajes y herramientas de Pi y los esquemas de TypeBox usan las versiones exactas de las dependencias *peer* declaradas en el `package.json` del SDK incluido. Proporciona esas dependencias al comprobar tipos; son tipos de desarrollo, no un permiso para importar módulos privados de runtime de LearnHarness.", "", `Cobertura: **${publicExports.length} tipos públicos**, **${supporting.length} declaraciones de apoyo**, **${ordered.reduce((n, entry) => n + entry.members.length, 0)} firmas o variantes de miembros declaradas**. La generación no incluye marcas de tiempo de compilación ni rutas absolutas del código fuente.`, "");
	pages.set("README.md", home.join("\n"));
	return { pages, inventory: ordered.map(({ name, module, public: isPublic, exports, members }) => ({ name, module, public: isPublic, exports, members: members.map(({ key, node }) => ({ key, signature: print(node) })) })) };
}

export function writePluginApiReference({ sdk, output }) {
	const reference = createPluginApiReference({ sdk });
	output = path.resolve(output);
	if (output === path.resolve(sdk) || path.resolve(sdk).startsWith(output + path.sep)) throw Error("Refusing API reference output over its SDK or ancestors");
	let current = output;
	while (current !== path.dirname(current)) {
		if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error(`Refusing API reference output symlink: ${current}`);
		current = path.dirname(current);
	}
	fs.mkdirSync(output, { recursive: true });
	for (const [filename, text] of reference.pages) {
		const target = path.join(output, filename);
		if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error(`Refusing API reference output symlink: ${target}`);
		fs.writeFileSync(target, text);
	}
	return reference;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	if (process.argv.length !== 4) throw Error("Usage: node scripts/build-plugin-api-reference.mjs <portable-sdk-directory> <output-directory>");
	const reference = writePluginApiReference({ sdk: process.argv[2], output: process.argv[3] });
	console.log(`[plugin-api-reference] ${reference.pages.size} Markdown pages ready`);
}
