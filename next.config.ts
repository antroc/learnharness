import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { MAX_IMPORT_BODY_BYTES } from "./lib/notes-import-limits.ts";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string; homepage: string };

const nextConfig: NextConfig = {
	// Solo metadatos públicos de compilación; ninguna API nueva de versión de Electron en tiempo de ejecución.
	env: { LH_VERSION: pkg.version, LH_HOMEPAGE: pkg.homepage },
	// Deja margen para multipart por encima de la asignación de 25 MiB por fichero. Esto es un
	// búfer del proxy, no una barrera de rechazo: la ruta de importación también acota las lecturas,
	// valida los bytes reales de los ficheros y gestiona los cuerpos multipart incompletos.
	experimental: { proxyClientMaxBodySize: MAX_IMPORT_BODY_BYTES },
	// Destino de escritorio (envoltorio de Electron, 2026-09-17): salida standalone = un
	// .next/standalone/server.js autocontenido que el armazón de Electron lanza
	// en 127.0.0.1. Inofensivo para despliegues web normales (salida de compilación adicional).
	// Las copias manuales que exige la documentación —public/ y .next/static— las
	// hace scripts/build-server.mjs.
	output: "standalone",
	// SEGURIDAD (verificado empíricamente el 2026-09-17): sin esto, el rastreo de ficheros
	// de salida barre el data/ real del repo —registros de chat, registros del grafo—
	// HACIA DENTRO del paquete standalone. Una app de escritorio distribuida llevaría
	// dentro los datos de sesión del desarrollador.
	//
	// SECRETOS (2026-10-08, detectado en la auditoría de la carga): el mismo barrido
	// mete el auth.json de la raíz del repo —el almacén de claves BYOK de DESARROLLO—, idéntico byte a byte,
	// en el DMG (la app empaquetada nunca lo lee: el armazón pasa
	// LH_AUTH_FILE → userData). Se excluye aquí; build-server.mjs además SE NIEGA
	// a empaquetar cualquier standalone que aún lo contenga. .env* es cinturón y tirantes para
	// la misma clase. Next también copia el .env suelto cargado después del rastreo;
	// la negativa de build-server sigue siendo necesaria incluso con estas exclusiones.
	//
	// ⚠ LOS PATRONES DE EXCLUSIÓN SOSTIENEN COSAS DE FORMAS QUE LA DOCUMENTACIÓN NO DESCRIBE
	// (establecido empíricamente el 2026-10-08): añadir exclusiones de directorio como
	// "dist/**/*" / "./dist/**/*" para directorios de salida de la raíz del repo ELIMINÓ los
	// paquetes externos del servidor (pi-ai / pi-agent-core perdieron todo
	// lo que había bajo su dist/: la copia rastreada se quedó en un package.json pelado
	// y el servidor empaquetado murió con ERR_MODULE_NOT_FOUND; openai/
	// @anthropic-ai —las dependencias de pi-ai— desaparecieron por completo del rastreo).
	// Las formas ancladas con prefijo "./" se comportan igual. **/data/**/* arregla
	// la coincidencia por sufijo del recolector JavaScript de Next, pero NO su rastreador nativo
	// de Turbopack: ese sigue podando gcp-metadata y sus dependencias privadas.
	// Mantén el apaño acotado del cierre de más abajo Y la barrera nativa en tiempo de ejecución.
	// Los directorios data/ reales de los SDK siguen necesitando también sus inclusiones explícitas.
	// La carga del DMG recursivo (el dist/ del repo barrido hacia el paquete, que metía
	// la compilación anterior dentro de la siguiente) se evita en cambio con el paso de limpieza
	// de desktop:dist Y una curación dirigida posterior al rastreo en
	// scripts/build-server.mjs (2026-10-11): se quitan el dist/ de la raíz del standalone
	// y node_modules/electron/ (el runtime de DESARROLLO del auxiliar de demos; los auxiliares
	// empaquetados usan el propio binario de la app). Los dist/ de las dependencias de tiempo de ejecución
	// quedan intactos, y el script vigila que no se filtren datos/claves.
	outputFileTracingExcludes: {
		"*": [
			"**/data/**/*",
			"auth.json",
			"chatgpt-credentials.json*",
			"github-copilot-credentials.json*",
			"xai-credentials.json*",
			".env*",
		],
	},
	// Huecos verificados empíricamente (prueba de humo del standalone del 2026-09-17): el rastreador
	// no ve el JSON cargado mediante atributos `import ... with { type: "json" }`:
	// el catálogo de proveedores de pi-ai (39 ficheros JSON) desapareció del rastreo y
	// el servidor devuelve 500 al cargar el módulo. Se incluyen los directorios data completos de los
	// paquetes del motor que se cargan en tiempo de ejecución.
	// pdfjs-dist (prueba de humo en vivo de fuentes v0, 2026-09-19): su compilación heredada carga
	// el worker falso de node (pdf.worker.mjs) y nuestro directorio standard_fonts mediante
	// rutas resueltas en tiempo de ejecución, invisibles para el rastreador. Empaquetarlo (sin
	// serverExternalPackages, más abajo) rompe además la resolución de import.meta.url
	// del worker dentro de los fragmentos de .next/dev; la prueba de humo en vivo
	// lo detectó; las pruebas unitarias se ejecutan sin empaquetar y nunca lo ven.
	outputFileTracingIncludes: {
		"*": [
			// El rastreo del standalone omitía todo este directorio importado en tiempo de ejecución
			// en la 0.3.0, así que importar puppeteer-core fallaba antes de arrancar el navegador.
			"node_modules/@puppeteer/browsers/lib/browser-data/**/*.js",
			"node_modules/pdfjs-dist/legacy/**/*",
			"node_modules/pdfjs-dist/standard_fonts/**/*",
			// Oleada E (2026-10-10): pdf_render pinta mediante @napi-rs/canvas; su
			// binario de plataforma (@napi-rs/canvas-<platform>-<arch>) es un require
			// dinámico de dependencia opcional que el rastreador no ve. Las compilaciones se hacen por SO y
			// npm instala solo el binario de la plataforma actual, así que este glob
			// se resuelve exactamente a un binario de Skia por compilación.
			"node_modules/@napi-rs/canvas-*/**/*",
			// El redimensionado de imágenes compatible con Pi se ejecuta en un worker sin empaquetar. Photon
			// carga su WASM contiguo a través de Node, también en el Electron empaquetado.
			// Preguntas laterales (2026-11-02): el prompt base del modelo lateral se lee
			// del disco en cada pregunta: un directorio que no nombra ninguna lectura de composición de agentes.
			"src/agent/prompts/side-chat/*.md",
			"src/agent/image-processing/*.mjs",
			"src/agent/image-processing/LICENSE",
			"node_modules/@silvia-odwyer/photon-node/**/*",
			// Oleada E etapa 2: resvg rasteriza de forma nativa los SVG de visual-maker; la misma
			// historia de binario por plataforma que el canvas de arriba (uno por compilación).
			"node_modules/@resvg/resvg-js-*/**/*",
			"node_modules/@earendil-works/pi-ai/dist/providers/data/**/*",
			// Las factorías públicas de OAuth nativo cargan estos flujos mediante imports con variables.
			// El proceso principal de Electron usa el mismo SDK standalone; la barrera en tiempo de ejecución sin conexión
			// evalúa sus rutas toAuth reales sin login ni peticiones al proveedor.
			"node_modules/@earendil-works/pi-ai/dist/auth/oauth/{load,github-copilot,xai,device-code}.js",
			"node_modules/@earendil-works/pi-ai/dist/utils/sleep.js",
			"node_modules/@earendil-works/pi-agent-core/dist/**/*.json",
			// El Turbopack nativo de Next 16.3.2 aplica las exclusiones no ancladas mientras
			// recorre los módulos; **/data/**/* sigue podando gcp-metadata y
			// su cadena privada de tiempo de ejecución. Las inclusiones se aplican tras el recorrido.
			// Este es el cierre verificado de GoogleAuth, no una copia general de dependencias;
			// la barrera nativa de Pi sin conexión debe detectar futuros cambios en el cierre del SDK.
			"node_modules/gcp-metadata/**/*",
			"node_modules/json-bigint/**/*",
			"node_modules/bignumber.js/**/*",
		],
	},
	// El núcleo sin framework vive en src/ (TS simple, importado igual por rutas y por la CLI).
	// El motor pi debe seguir siendo externo: sus proveedores son código Node cargado en tiempo de
	// ejecución (streams de undici, datos del catálogo) que se rompe al empaquetarlo en las rutas.
	serverExternalPackages: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"pdfjs-dist", // fuentes v0: empaquetarlo rompe su ruta del worker falso de node
		"@napi-rs/canvas", // binding nativo: empaquetarlo rompe el require del .node
		"@silvia-odwyer/photon-node", // el CJS carga su WASM contiguo desde el disco
		"@resvg/resvg-js", // binding nativo: igual
	],
};

export default nextConfig;