/**
 * LearnHarness — el armazón de Electron (hito del envoltorio, 2026-09-17).
 *
 * Qué es y qué no es este proceso:
 *   ES:    un lanzador fino + guardia de seguridad alrededor del servidor
 *          real de la app: el server.js standalone de `next build` (Next 16),
 *          lanzado como proceso hijo en 127.0.0.1 con el fichero de
 *          autenticación BYOK y la frontera LH_DATA_DIR.
 *   NO ES: un anfitrión de ninguna lógica de la app. Todo —turnos del
 *          profesor, extracción, el grafo— se ejecuta en el servidor de
 *          Next, sin cambios.
 *
 * Patrón (comprobado el 2026-09-17 con la documentación actual de Electron
 * 44 / Next 16; ver las notas release-strategy + electron-wrapper de .memory):
 *   - se lanza mediante process.execPath + ELECTRON_RUN_AS_NODE=1 (el Node
 *     24 que trae Electron; el fusible runAsNode debe seguir activado);
 *   - el directorio del servidor se distribuye DESEMPAQUETADO mediante
 *     extraResources (los archivos asar son de solo lectura y los .node/dylib
 *     nativos no se pueden cargar con dlopen desde uno);
 *   - todo el estado mutable va bajo userData (nunca dentro del paquete
 *     .app: las apps translocadas son de solo lectura);
 *   - las claves viajan en el ENTORNO del hijo, nunca en argv; auth.json
 *     (BYOK) es un mapa JSON plano {VAR: valor}, en texto claro, modo 0600,
 *     gestionado por el servidor desde la oleada de claves de autenticación
 *     (2026-09-19): el hijo lo lee/escribe DIRECTAMENTE (LH_AUTH_FILE, más
 *     abajo) y refleja los valores en su propio entorno. La antigua inyección
 *     en el entorno al lanzar se retiró con esa oleada: una copia hecha aquí
 *     taparía todos los cambios de clave de la página de ajustes hasta
 *     reiniciar.
 */

const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session, shell, dialog } = require("electron");
const { pickAttachmentPath } = require("./attachment-picker.cjs");
const { createChatGPT, fileStore } = require("./chatgpt.cjs");
const { attachChatGPTChild, trustedSender, chatGPTControl } = require("./chatgpt-ipc.cjs");
const { createSubscriptions, loadSubscriptionSDK } = require("./subscriptions.cjs");
const { attachSubscriptionChild, subscriptionControl } = require("./subscription-ipc.cjs");
const { desktopAPIHeaders } = require("./desktop-api.cjs");
const { openWebSubscriptionBrowser } = require("./web-subscription-browser.cjs");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

// Refleja SIDEBAR_AUTOCLOSE de components/sidebar.tsx; mantenlos sincronizados (el
// renderer es dueño del número; este es el objetivo de ensanchamiento por IPC).
const SIDEBAR_AUTOCLOSE = 928;

const PRODUCT_NAME = "LearnHarness";

// NOMBRE DE LA APP → userData (responsable, 2026-10-10): el directorio de Application Support es
// exactamente "LearnHarness" en desarrollo Y empaquetado. Si no, el Electron empaquetado
// lo derivaría del "name" de package.json (ahora en minúsculas,
// "learnharness"), y los metadatos productName por sí solos no llegan a app.name.
// Debe ejecutarse antes del sufijo de LH_DEV_URL de más abajo: el de desarrollo pasa a ser
// "LearnHarness-dev".
app.setName(PRODUCT_NAME);
const AUTH_FILE = () => path.join(app.getPath("userData"), "auth.json");
const DATA_DIR = () => path.join(app.getPath("userData"), "data");

// Resuelve la paleta guardada antes de crear la ventana; los informes del renderer la mantienen
// al día tras los guardados en vivo. Este auxiliar no necesita el paquete compilado del servidor.
const { normalizeAppearance, themeSourceFor, serverDataDir, readAppearance, chromeColors } = require("./appearance-chrome.cjs");
let appearance = normalizeAppearance(null);

function applyChrome(win) {
	if (win.isDestroyed()) return;
	const colors = chromeColors(appearance);
	win.setBackgroundColor(colors.color);
	if (process.platform !== "darwin") win.setTitleBarOverlay(colors);
}

/** El servidor standalone empaquetado (extraResources → Resources/server).
 * En desarrollo, LH_DEV_URL lo cortocircuita todo: sin lanzar, sin
 * empaquetar; la ventana apunta al servidor `next dev` en marcha (HMR completo). */
function serverEntry() {
	// extraResources distribuye toda la carga de .next bajo server/standalone/
	// (copiada de .next con un filtro explícito; ver electron-builder.yml).
	return path.join(process.resourcesPath, "server", "standalone", "server.js");
}

// ─── Instancia única: dos instancias se pelearían por el directorio de datos ──
// ─── Auxiliar del servicio de navegador (Oleada E etapa 3, responsable 2026-10-10) ──
// Los motores de render para las tareas del agente: los PDF y los SVG se rasterizan de forma nativa
// (pdfjs+Skia, resvg; sin navegador); las DEMOS ejecutan JS y necesitan uno. El
// propio Chromium de la app lo sirve mediante este auxiliar: el servidor lanza
//   <este binario> --browser-service
// y se conecta por CDP (el Chrome del sistema sigue siendo la alternativa). Handshake:
// el auxiliar imprime "BROWSER_SERVICE_CDP <port>" en stdout cuando el endpoint CDP
// ya escucha. Vida: desconexión/muerte del IPC del padre = salir.
// DEBE ejecutarse antes del bloqueo de instancia única —un auxiliar es una segunda
// instancia de este mismo binario— y antes de la redirección de LH_DEV_URL: el
// auxiliar no es dueño de ningún dato del usuario.
if (process.argv.includes("--browser-service")) {
	const { waitForBrowserService } = require("./browser-service-readiness.cjs");
	// Se encarga de toda la vida de arranque del auxiliar, incluida la espera de disponibilidad.
	const lifetime = new AbortController();
	const parentClosed = () => {
		lifetime.abort(new Error("browser-service parent IPC disconnected"));
		app.quit();
	};
	(async () => {
		try {
			// El Electron completo de Windows sustituye stdin por un EOF sintético. Usa el
			// canal IPC real de Node y niégate a arrancar un auxiliar sin dueño.
			if (!process.channel || !process.connected) throw new Error("browser-service requires connected parent IPC");
			process.once("disconnect", parentClosed);
			app.dock?.hide();
			const port = await freePort();
			// Debe llegar antes de app-ready para que Chromium lo recoja.
			app.commandLine.appendSwitch("remote-debugging-port", String(port));
			await app.whenReady();
			// Una ventana oculta mantiene normal el ciclo de vida de la app en todas
			// las plataformas (aquí no se instala ningún manejador de window-all-closed).
			const win = new BrowserWindow({ show: false });
			await win.loadURL("about:blank");
			// Que cargue la ventana no es una barrera de disponibilidad HTTP de DevTools. Confirma el
			// endpoint antes de que los clientes de producción y de las pruebas de humo vean el handshake.
			await waitForBrowserService(port, { signal: lifetime.signal });
			if (!lifetime.signal.aborted) console.log(`BROWSER_SERVICE_CDP ${port}`);
		} catch (err) {
			if (lifetime.signal.aborted) return; // La desconexión del padre es normal.
			console.error("browser-service failed:", err);
			app.exit(1);
		}
	})();
} else {
	// El armazón de desarrollo (LH_DEV_URL) se ejecuta JUNTO a la app empaquetada, no en su lugar:
	// con su propio userData para que (a) el bloqueo de instancia única —comprobado más abajo— no
	// lo mate en silencio, y (b) nunca lea/escriba el localStorage, el auth.json ni los
	// logs de la app real. Debe ejecutarse antes de comprobar el bloqueo.
	if (process.env.LH_DEV_URL) {
		app.setPath("userData", `${app.getPath("userData")}-dev`);
	}

	// Todo el arranque normal —bloqueo incluido— vive en este else: un auxiliar es,
	// a propósito, una SEGUNDA instancia de este mismo binario (la app en marcha es dueña
	// del bloqueo), así que nunca debe llegar a esta comprobación.
	if (!app.requestSingleInstanceLock()) {
		app.quit();
	} else {
		app.on("second-instance", () => {
			const win = BrowserWindow.getAllWindows()[0];
			if (win) {
				if (win.isMinimized()) win.restore();
				win.focus();
			}
		});
		main();
	}
}

let serverProcess = null;
let chatgpt = null;
let chatgptChild = null;
let subscriptions = null;
let subscriptionChild = null;
// Capacidad de petición por lanzamiento, nunca tokens OAuth y nunca estado del renderer.
let desktopAPISecret = null;
let reopenWindow = null;
const trustedAppWindows = new Set();

// Un armazón gráfico nunca debe morir por una excepción suelta (diálogos de EPIPE, una carrera
// en un manejador de eventos): la ventana + el servidor hijo son el producto, y
// todo lo del proceso principal es recuperable registrándolo. Registrar y continuar.
process.on("uncaughtException", (err) => {
	try {
		log(`uncaught: ${err?.stack ?? err}`);
	} catch {
		/* no queda nada donde escribir */
	}
});

/** Un puerto TCP libre (listen(0) → el núcleo asigna uno). La carrera entre
 * cerrar y lanzar es teórica; los puertos de localhost rara vez se disputan,
 * y un lanzamiento fallido aparece en la comprobación de salud con el stderr
 * del hijo en el log. */
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

/** Claves BYOK: auth.json en userData, mapa plano {VAR: valor}, 0600;
 * GESTIONADO POR EL SERVIDOR desde la oleada de claves de autenticación
 * (2026-09-19). Este armazón ya no lo lee ni lo inyecta: el hijo recibe
 * LH_AUTH_FILE más abajo y hace su propia lectura/reflejo/escritura, así que
 * una clave guardada en la página de ajustes surte efecto en la siguiente
 * llamada al modelo, sin reiniciar. Las variables de entorno reales siguen
 * ganando al fichero dentro del hijo (su regla documentada). */

function log(line) {
	const stamp = new Date().toISOString();
	// La escritura en stdout está protegida (endurecimiento contra EPIPE, 2026-10-10): una app
	// empaquetada lanzada con una tubería ajena (un lanzador que sale, una
	// ejecución con tubería) no debe morir en su siguiente línea de log cuando la tubería se rompe.
	// El fichero de abajo sigue siendo el canal duradero.
	try {
		console.log(`[lh ${stamp}] ${line}`);
	} catch {
		/* stdout ya no existe; userData/logs/main.log sigue llevándolo */
	}
	// Cinturón y tirantes: también se añade a userData/logs para poder diagnosticar
	// un hijo que se porta mal cuando la ventana ya no está. Solo con el mejor esfuerzo.
	try {
		const dir = path.join(app.getPath("userData"), "logs");
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, "main.log"), `[${stamp}] ${line}\n`);
	} catch {
		/* con el mejor esfuerzo */
	}
}

function startServer(port) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			// Solo el backend de macOS lo necesita: si no, el establecedor nativo de título de
			// Next registra este proceso en modo Node como una app en primer plano.
			process.platform === "darwin"
				? ["--require", path.join(process.resourcesPath, "server-title-guard.cjs"), serverEntry()]
				: [serverEntry()],
			{
				cwd: path.dirname(serverEntry()),
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					NODE_ENV: "production",
					PORT: String(port),
					HOSTNAME: "127.0.0.1", // el servidor usa 0.0.0.0 por defecto; nunca
					LH_DATA_DIR: DATA_DIR(),
					// El almacén de autenticación/claves: el hijo lee Y escribe este fichero por sí mismo
					// (ya no hay inyección en el entorno: una copia al lanzar taparía todos los cambios
					// de clave de la página de ajustes hasta reiniciar; el entorno gana al fichero).
					LH_AUTH_FILE: AUTH_FILE(),
					LH_DESKTOP_SERVER: "1",
					LH_DESKTOP_API_SECRET: desktopAPISecret,
				},
				stdio: ["ignore", "pipe", "pipe", "ipc"],
			},
		);
		serverProcess = child;
		chatgptChild = attachChatGPTChild(child, chatgpt);
		subscriptionChild = attachSubscriptionChild(child, subscriptions);
		const fwd = (buf) => buf.toString().trimEnd().split("\n").forEach((l) => l && log(`server: ${l}`));
		child.stdout.on("data", fwd);
		child.stderr.on("data", fwd);
		child.on("exit", (code, signal) => {
			log(`server exited (code=${code} signal=${signal})`);
			serverProcess = null;
			chatgptChild?.dispose();
			chatgptChild = null;
			subscriptionChild?.dispose();
			subscriptionChild = null;
			chatgpt?.close();
			subscriptions?.close();
		});
		resolve(child);
	});
}

/** No existe ningún evento "ready": se sondea hasta que el servidor responde (confirmado en la documentación). */
function waitUntilUp(url, tries = 150) {
	return new Promise((resolve, reject) => {
		const attempt = (n) => {
			const req = http.get(url, (res) => {
				res.resume();
				resolve(res.statusCode !== undefined);
			});
			req.on("error", () => {
				if (n <= 0) reject(new Error(`server never answered on ${url}`));
				else setTimeout(() => attempt(n - 1), 200);
			});
		};
		attempt(tries);
	});
}

function killServer() {
	chatgpt?.close();
	subscriptions?.close();
	if (!serverProcess) return;
	const child = serverProcess;
	serverProcess = null;
	child.kill("SIGTERM");
	setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {
			/* ya no existe */
		}
	}, 3000);
}

/** Los enlaces que salen de la ventana de la app solo pueden abrirse en un
 * navegador o en un cliente de correo: los mismos esquemas que el markdown
 * del chat hace pulsables. Los demás esquemas (smb:, file:, search-ms:, el
 * manejador personalizado de cualquier app) se descartan y solo se registra
 * el esquema. */
const EXTERNAL_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
function openExternalLink(target) {
	let scheme = "unparseable";
	try {
		scheme = new URL(target).protocol;
	} catch { /* se registra más abajo */ }
	if (EXTERNAL_LINK_SCHEMES.has(scheme)) {
		void shell.openExternal(target);
		return;
	}
	log(`external link blocked (scheme ${scheme.slice(0, 40)})`);
}

/** Postura de seguridad (todos los valores por defecto se afirman de forma
 * explícita; las protecciones son las recomendaciones de la propia lista de
 * comprobación para armazones de apps en localhost):
 *  - manejador de permisos que deniega por defecto y solo permite nuestro
 *    origen de loopback (base para el hito de micrófono/STT: Electron
 *    aprueba automáticamente por defecto, nosotros no);
 *  - will-navigate fijado al origen de la app; window.open siempre
 *    denegado: los enlaces externos van al navegador real mediante
 *    shell.openExternal, solo para http, https y mailto (openExternalLink). */
function createWindow(url) {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		title: PRODUCT_NAME,
		// Adorno fusionado (responsable, 2026-09-17): la barra de título del sistema ya no existe;
		// las franjas de cabecera de 60px de la propia app SON la barra de título. Los
		// semáforos flotan sobre la franja de la marca LH de la barra lateral,
		// alineados verticalmente con la caja dibujada de la PÍLDORA DE FASE, no con el centro
		// geométrico de la franja (petición del responsable, 2026-09-17): macOS centra cada círculo de 12px en
		// y+6.75, y el centro de la caja de la píldora mide 29.25 en la app en marcha
		// (franja 0–59.5, caja de la píldora 19–39.5); con y 22.5 los círculos quedan en
		// 29.25, exactamente sobre la píldora. Margen de la marca: components/sidebar.tsx.
		// El arrastre viene de las franjas .lh-drag del renderer (app/globals.css).
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 22.5 } }
			: {
				titleBarStyle: "hidden",
				// Mínimo/máximo/cerrar nativos a la derecha, con la altura compacta por defecto
				// del SO. No fuerces la superposición nativa, invariante al zoom, a igualar
				// la barra de 60 px CSS del renderer: al alejar el zoom taparía su borde.
				// El renderer reserva la anchura real mediante env(titlebar-area-*).
				titleBarOverlay: chromeColors(appearance),
				// Mantén sola la barra personalizada; Alt muestra el menú nativo.
				autoHideMenuBar: true,
			}),
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			...(process.env.LH_DEV_URL ? { additionalArguments: ["--lh-web-subscriptions"] } : {}),
			preload: path.join(__dirname, "preload.cjs"),
		},
		// Destello al redimensionar en vivo y en el primer pintado (responsable, 2026-09-17): durante un
		// redimensionado la superficie nativa de la ventana cambia de tamaño antes de que el compositor de
		// Chromium tenga un fotograma con el nuevo tamaño, y el hueco muestra el fondo NATIVO de la
		// ventana: el de Electron por defecto es blanco, deslumbrante en una app oscura.
		// En su lugar, el fondo de la app para el modo renderizado rellena el desfase
		// (chromeColors). `show: false` + ready-to-show es el mismo tratamiento
		// para el primer pintado: la ventana solo aparece cuando la página se ha
		// renderizado de verdad.
		backgroundColor: chromeColors(appearance).color,
		show: false,
		// Comportamiento con ventana estrecha (responsable, 2026-09-17): 640px es el suelo;
		// por debajo, incluso una fila de interfaz partida queda apretada y la cabecera del chat
		// (margen de los semáforos 92 + conmutador + título) se queda sin sitio. La barra lateral
		// se cierra sola por debajo de 928 = 640 + 288 (barra lateral) en el renderer
		// (components/sidebar.tsx, SIDEBAR_AUTOCLOSE); su IPC "lh:expand-window"
		// vuelve a ensanchar la ventana hasta ese umbral.
		minWidth: 640,
		minHeight: 600,
	});

	trustedAppWindows.add(win);
	win.once("closed", () => trustedAppWindows.delete(win));
	const allowedOrigin = () => new URL(url).origin;
	// Denegar por defecto; los ÚNICOS permisos son media (base de micrófono/STT) y
	// clipboard-sanitized-write: las indicaciones de copiar de la transcripción
	// (esquinas de copiar de md-blocks) llaman a navigator.clipboard.writeText(), que
	// Chromium solo respeta con ese permiso (oleada de retoques chrome-melt,
	// 2026-09-19; antes de este permiso toda copia se rechazaba en silencio). Sigue siendo
	// solo para el origen de loopback: lo predeterminado en Electron es aprobarlo todo automáticamente,
	// y nosotros no distribuimos eso.
	// "local-fonts": el selector de fuente de lectura de la sección de apariencia (2026-09-26).
	const allowedPermissions = new Set(["media", "clipboard-sanitized-write", "local-fonts"]);
	const fromOwnOrigin = (origin, permission) =>
		origin === allowedOrigin() && allowedPermissions.has(permission);
	session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
		const requestOrigin = details.requestingUrl ? new URL(details.requestingUrl).origin : null;
		callback(fromOwnOrigin(requestOrigin, permission));
	});
	session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
		return fromOwnOrigin(origin, permission);
	});

	win.webContents.on("will-navigate", (event, target) => {
		if (new URL(target).origin !== allowedOrigin()) {
			event.preventDefault();
			openExternalLink(target);
		}
	});
	win.webContents.setWindowOpenHandler(({ url: target }) => {
		openExternalLink(target);
		return { action: "deny" };
	});

	void win.loadURL(url);
	// La verdad del zoom llega al renderer en CADA carga (recarga, navegación): el
	// --lh-zoom del renderer nunca debe quedar obsoleto. El capturador alternativo de abajo
	// cubre las variantes de ⌘= / distribución que el ⌘Plus del menú quizá no reclame: las teclas
	// reclamadas por el menú nunca llegan a before-input-event, así que exactamente uno de los
	// dos se aplica a cada pulsación de zoom.
	win.webContents.on("did-finish-load", () => {
		win.webContents.send("lh:zoom", win.webContents.getZoomFactor());
	});
	win.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown" || !(input.meta || input.control)) return;
		if (input.key === "=" || input.key === "+") zoomStep(win, +1);
		else if (input.key === "-") zoomStep(win, -1);
		else if (input.key === "0") applyZoom(win, 1);
		else return;
		event.preventDefault();
	});

	win.once("ready-to-show", () => win.show());
	return win;
}

/* ── Zoom (ronda 7 del responsable, 2026-10-05): ⌘±/⌘0 como escalera PROPIA ─
 * Los roles estándar zoomIn/zoomOut cambian zoomLevel en silencio: el
 * renderer nunca se entera del factor, y los semáforos nativos (de tamaño
 * físico fijo, hiddenInset) dejan de guardar relación con la interfaz
 * escalada: con zoom de acercamiento el botón del grafo se aleja de ellos,
 * y con zoom de alejamiento el contenido se desliza por debajo. Aquí el
 * zoom es explícito: una escalera de factores, aplicada mediante
 * setZoomFactor y difundida al renderer ("lh:zoom": publica --lh-zoom para
 * que las longitudes de los márgenes puedan dividirse por él y mantenerse
 * constantes en tamaño FÍSICO). Los semáforos en sí se quedan en su
 * posición de construcción ({x:16, y:22.5}: Electron 44 NO tiene un
 * establecedor en tiempo de ejecución, solo la opción de BrowserWindow), lo
 * cual es correcto según la HIG: los semáforos nativos se ciñen a la
 * esquina de la ventana mientras la interfaz web compensa a su alrededor.
 * Nota vertical: con factores grandes, el centro del contenido de las
 * franjas más altas se desplaza por debajo de los semáforos fijos;
 * aceptado (la alternativa, mover los semáforos, es imposible sin
 * reconstruir la ventana). */
const ZOOM_LADDER = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/* ── Actualización automática (Oleada C, responsable 2026-10-10: descarga ──
 * silenciosa + aviso de reinicio; comprueba al arrancar + cada 24h) ────────
 *
 * Fuente: GitHub Releases (publish de electron-builder.yml → app-update.yml,
 * consolidado y firmado dentro del paquete). macOS necesita la app firmada
 * (lo está: Developer ID) y las actualizaciones van en el destino zip
 * (Squirrel.Mac); los blockmaps dan descargas diferenciales gratis. Windows
 * usa NSIS; Linux usa AppImage o DebUpdater (6.8.9 admite deb; la
 * instalación puede pedir permisos de administrador a través del gestor de
 * paquetes; responsable 2026-10-11).
 *
 * Reglas firmes:
 *  - EN DESARROLLO NUNCA SE ACTUALIZA: !app.isPackaged se salta el
 *    actualizador por completo; el mundo de desarrollo ejecuta `next dev` y
 *    no tiene un paquete firmado.
 *  - EL ACTUALIZADOR NUNCA PUEDE TUMBAR LA APP: todos los eventos y
 *    comprobaciones se capturan y registran (fuente caída, disco lleno,
 *    firma incorrecta: todo son líneas de log; la app sigue funcionando,
 *    con o sin actualización).
 *  - LH_UPDATE_FEED (entorno): sustituye la fuente de GitHub consolidada por
 *    un servidor local genérico; el simulacro de verificación previo a la
 *    publicación (servir latest-mac.yml + zip + blockmap desde cualquier
 *    directorio HTTP de localhost y ver cómo una copia instalada real
 *    encuentra/descarga/reinicia). Frontera solo para pruebas.
 *
 * Vía de instalación: la actualización descargada se aplica al salir
 * (autoInstallOnAppQuit; Squirrel.Mac la prepara de forma nativa y la
 * intercambia al relanzar). El aviso del renderer pide un reinicio inmediato
 * mediante "lh:update-install"; matamos PRIMERO el servidor hijo, con un
 * orden determinista: el servidor vive dentro del paquete .app que Squirrel
 * está a punto de sustituir (extraResources), y before-quit por sí solo
 * competiría con el intercambio. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let autoUpdater = null; // el de electron-updater, solo en compilaciones empaquetadas
// Solo de observación: esta instantánea NUNCA bloquea una comprobación, descarga o instalación.
// La revisión permite a los suscriptores tardíos rechazar una instantánea IPC en curso más antigua.
let updateState = { status: "idle", version: null, revision: 0 };

function reportUpdateStatus(status, version = null) {
	try {
		// Una comprobación/error posterior no debe ocultar una actualización ya preparada para la salida.
		if (updateState.status === "downloaded" && status !== "downloaded") return;
		updateState = { status, version: typeof version === "string" ? version : null, revision: updateState.revision + 1 };
		for (const win of BrowserWindow.getAllWindows()) {
			try {
				win.webContents.send("lh:update-status", updateState);
			} catch {
				/* ventana a medio desmontar; la recuperación de la instantánea cubre una carga posterior */
			}
		}
	} catch {
		/* Informar del estado nunca debe interrumpir al actualizador. */
	}
}

/** Lee el MISMO directorio de datos que se pasa al servidor empaquetado.
 * Solo un false explícito desactiva; unos ajustes ausentes, corruptos o
 * ilegibles mantienen las actualizaciones ACTIVADAS. Se vuelve a leer en
 * cada comprobación automática para que guardar el conmutador no requiera
 * reiniciar. */
function automaticUpdatesEnabled() {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(DATA_DIR(), "settings.json"), "utf8"));
		return settings?.general?.autoUpdate !== false;
	} catch {
		return true;
	}
}

function checkForUpdates({ manual = false } = {}) {
	if (!autoUpdater) return;
	if (!manual && !automaticUpdatesEnabled()) {
		log("auto-update: automatic check skipped (turned off in Settings)");
		return;
	}
	// No lo condiciones al estado mostrado: un spinner/error obsoleto nunca debe desactivar
	// comprobaciones futuras en segundo plano. electron-updater es dueño de su trabajo en curso.
	autoUpdater
		.checkForUpdates()
		.then((result) => {
			// Una comprobación rechazada (p. ej., un paquete no admitido) no establece ninguna
			// afirmación de última versión. Los resultados reales llegan por los eventos del actualizador.
			if (!result) reportUpdateStatus("idle");
		})
		.catch((err) => {
			log(`update check failed: ${err?.message ?? err}`);
			reportUpdateStatus("error");
		});
}

function installUpdateNow() {
	// Mata el servidor ANTES de quit-and-install (ver el comentario de bloque).
	try {
		killServer();
	} catch {
		/* ya está muerto */
	}
	autoUpdater?.quitAndInstall();
}

function setupAutoUpdater() {
	if (!app.isPackaged) {
		log("auto-update: dev build — updater disabled");
		reportUpdateStatus("disabled");
		return;
	}
	try {
		autoUpdater = require("electron-updater").autoUpdater;
	} catch (err) {
		log(`auto-update: electron-updater unavailable (${err?.message ?? err}) — updates disabled`);
		reportUpdateStatus("disabled");
		return;
	}
	const feed = process.env.LH_UPDATE_FEED;
	if (feed) {
		autoUpdater.setFeedURL({ provider: "generic", url: feed });
		log(`auto-update: LH_UPDATE_FEED override → ${feed}`);
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	// Lleva cada línea de log del actualizador al log propio del armazón (userData/
	// logs/main.log): los fallos de la fuente deben poder diagnosticarse a posteriori.
	autoUpdater.logger = {
		info: (m) => log(`updater: ${m}`),
		warn: (m) => log(`updater warn: ${m}`),
		debug: (m) => {}, // demasiado charlatán para el log persistente
		error: (m) => log(`updater error: ${m}`),
	};
	autoUpdater.on("checking-for-update", () => reportUpdateStatus("checking"));
	autoUpdater.on("update-available", (info) => reportUpdateStatus("downloading", info?.version));
	autoUpdater.on("update-not-available", () => reportUpdateStatus("up-to-date"));
	autoUpdater.on("update-downloaded", (info) => {
		log(`update downloaded: ${info?.version} — banner shown`);
		reportUpdateStatus("downloaded", info?.version);
	});
	autoUpdater.on("error", (err) => {
		log(`updater error: ${err?.message ?? err}`);
		reportUpdateStatus("error");
	});
}

/** Una única superficie de resultado para las comprobaciones manuales.
 * Preload guarda la petición de navegación hasta que React se suscribe,
 * incluso cuando se cerraron todas las ventanas de macOS. */
function checkForUpdatesFromMenu() {
	try {
		const win = BrowserWindow.getAllWindows()[0] ?? reopenWindow?.();
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
			const openSettings = () => {
				try { win.webContents.send("lh:open-settings", "general"); } catch { /* ventana cerrada */ }
			};
			if (win.webContents.isLoadingMainFrame()) win.webContents.once("did-finish-load", openSettings);
			else openSettings();
		}
	} catch {
		/* Un fallo de navegación no debe impedir la comprobación manual. */
	}
	checkForUpdates({ manual: true });
}

function zoomStep(win, dir) {
	const current = win.webContents.getZoomFactor();
	const next =
		dir > 0
			? ZOOM_LADDER.find((f) => f > current + 0.001) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1]
			: [...ZOOM_LADDER].reverse().find((f) => f < current - 0.001) ?? ZOOM_LADDER[0];
	applyZoom(win, next);
}

function applyZoom(win, factor) {
	factor = Math.min(2, Math.max(0.75, factor)); // la escalera acota; ⌘0 = 1
	win.webContents.setZoomFactor(factor);
	win.webContents.send("lh:zoom", factor);
}

/** macOS necesita un menú de aplicación con los roles de Edit; sin él,
 * Cmd+C/V/A no hacen nada en el renderer. Todo lo demás se mantiene mínimo. */
function installMenu() {
	const template = [
		{
			label: app.name,
			submenu: [
				{ role: "about" },
				// Las comprobaciones manuales informan de su resultado en Ajustes → General.
				{ label: "Check for Updates…", click: () => checkForUpdatesFromMenu() },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{ label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				// Zoom PROPIO (ver applyZoom): los roles cambian zoomLevel
				// en silencio; estos difunden el factor y recolocan los
				// semáforos. El --lh-zoom del renderer depende de
				// enterarse de cada cambio.
				{
					label: "Actual Size",
					accelerator: "CommandOrControl+0",
					click: () => applyZoom(BrowserWindow.getAllWindows()[0], 1),
				},
				{
					label: "Zoom In",
					accelerator: "CommandOrControl+Plus",
					click: () => zoomStep(BrowserWindow.getAllWindows()[0], +1),
				},
				{
					label: "Zoom Out",
					accelerator: "CommandOrControl+-",
					click: () => zoomStep(BrowserWindow.getAllWindows()[0], -1),
				},
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
	app.on("window-all-closed", () => {
		chatgpt?.pause();
		subscriptions?.pause();
		// Convención de macOS: la app sigue residente y se reactiva desde el Dock.
		if (process.platform !== "darwin") app.quit();
	});

	// El hijo no debe sobrevivirnos: cubre todas las vías de salida.
	app.on("before-quit", killServer);
	process.on("exit", killServer);
	process.on("SIGHUP", killServer);

	await app.whenReady();

	// Lee el mismo registro/tema personalizado que usa el servidor antes de construir
	// cualquier ventana nativa, incluido el armazón de desarrollo externo.
	appearance = readAppearance(serverDataDir({
		devUrl: process.env.LH_DEV_URL, env: process.env,
		packagedDataDir: DATA_DIR(), repoRoot: path.join(__dirname, ".."),
	}));
	nativeTheme.themeSource = themeSourceFor(appearance.mode);

	// Modo desarrollo: apunta a un servidor `next dev` en marcha (LH_DEV_URL); sin
	// lanzar, sin empaquetar, HMR completo. El resto de este armazón se sigue aplicando
	// (protecciones, menú, instancia única).
	const devUrl = process.env.LH_DEV_URL;
	const url = devUrl ?? `http://127.0.0.1:${await freePort()}`;
	if (!devUrl) {
		desktopAPISecret = randomBytes(32).toString("hex");
		const ownedOrigin = new URL(url).origin;
		// Todas las URL, no solo /api: vuelve a quitar la cabecera en las redirecciones externas.
		session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
			callback({ requestHeaders: desktopAPIHeaders(details, ownedOrigin, desktopAPISecret, [...trustedAppWindows]) });
		});
		chatgpt = createChatGPT({
			store: fileStore(path.join(app.getPath("userData"), "chatgpt-credentials.json")),
			openExternal: (target) => shell.openExternal(target),
			onChange: (value) => {
				chatgptChild?.send(value);
				for (const win of BrowserWindow.getAllWindows()) win.webContents.send("lh:chatgpt:changed");
			},
		});
		subscriptions = createSubscriptions({
			directory: app.getPath("userData"),
			loadSDK: () => loadSubscriptionSDK(path.dirname(serverEntry())),
			openExternal: (target) => shell.openExternal(target),
			onChange: (snapshot) => {
				subscriptionChild?.send(snapshot);
				for (const win of BrowserWindow.getAllWindows()) win.webContents.send("lh:subscriptions:changed");
			},
		});
		await subscriptions.ready;
		log(`starting server: ${serverEntry()}`);
		log(`data dir: ${DATA_DIR()}${fs.existsSync(AUTH_FILE()) ? " · auth.json: present" : " · auth.json: ABSENT (no BYOK keys yet)"}`);
		await startServer(new URL(url).port);
		await waitUntilUp(url);
		log(`server up: ${url}`);
	} else {
		log(`dev mode: ${devUrl} — waiting for server`);
		const { waitForDevServer } = require("./dev-server-readiness.cjs");
		const startup = new AbortController();
		const cancelStartup = () => startup.abort(new Error("Development startup cancelled by application quit"));
		app.once("before-quit", cancelStartup);
		try {
			await waitForDevServer(devUrl, { signal: startup.signal });
			if (startup.signal.aborted) return;
			log(`dev server ready: ${devUrl}`);
		} catch (error) {
			if (!startup.signal.aborted) {
				log(`dev server startup failed: ${error?.message ?? error}`);
				app.exit(1);
			}
			return;
		} finally {
			app.removeListener("before-quit", cancelStartup);
		}
	}

	// Los controles del renderer no contienen ninguna operación de token/URL/código. El hijo servidor
	// aparte es el único destinatario de los préstamos de credenciales por el IPC heredado.
	ipcMain.handle("lh:chatgpt:control", async (event, command) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) return { error: "Untrusted desktop request." };
		if (!chatgpt || !serverProcess?.connected) return { available: false, pending: false, activeId: null, accounts: [], error: "ChatGPT sign-in requires the desktop app's private server connection. Browser-only and externally launched development servers keep API-key connections." };
		return chatGPTControl(command, chatgpt);
	});

	ipcMain.handle("lh:subscriptions:control", async (event, command) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		if (!subscriptions || !serverProcess?.connected) {
			if (command?.op === "status") return [];
			throw new Error("Subscription sign-in requires the desktop app's private server connection.");
		}
		return subscriptionControl(command, subscriptions);
	});

	// El armazón de desarrollo no tiene pestañas de navegador. Aquí solo se puede resolver una acción de un solo
	// uso sobre su propio servidor de Next; nunca se acepta una URL externa arbitraria.
	ipcMain.handle("lh:subscriptions:web-browser", async (event, action) => {
		if (!devUrl || !trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) throw new Error("Untrusted development request.");
		await openWebSubscriptionBrowser(action, new URL(url).origin, { openExternal: (target) => shell.openExternal(target) });
	});

	ipcMain.handle("lh:attachment:pick", (event, mode) => pickAttachmentPath(event, mode, {
		BrowserWindow, dialog, trustedAppWindows, origin: new URL(url).origin,
	}));

	installMenu();

	// Actualización automática (Oleada C): se conecta el actualizador antes de la ventana para que el
	// canal del aviso esté activo desde el primer pintado; la primera comprobación y el intervalo de 24h
	// se lanzan después, más abajo. El contrato de setupAutoUpdater: los fallos
	// son líneas de log; esto nunca puede bloquear el arranque.
	setupAutoUpdater();
	ipcMain.on("lh:update-install", () => installUpdateNow());
	ipcMain.handle("lh:update:get", (event) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		return updateState;
	});
	ipcMain.handle("lh:update:check", (event) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		checkForUpdates({ manual: true });
	});

	// Barra lateral con ventana estrecha (responsable, 2026-09-17): el renderer cierra solo
	// la barra lateral por debajo de SIDEBAR_AUTOCLOSE (928px); volver a abrirla con esa
	// anchura pide a la ventana que se ensanche: el layout nunca tiene que
	// acomodar una ventana estrecha + la barra lateral abierta. La esquina superior izquierda se queda fija y la
	// ventana crece hacia la derecha. No hace nada si ya es ancha.
	// El primer pintado del renderer puede competir con did-finish-load: pide
	// él mismo el factor actual (refleja los envíos de "lh:zoom").
	ipcMain.handle("lh:zoom:get", (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.getZoomFactor() ?? 1);
	ipcMain.on("lh:expand-window", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return;
		const { x, y, width, height } = win.getBounds();
		const target = SIDEBAR_AUTOCLOSE;
		if (width < target) win.setBounds({ x, y, width: target, height });
	});
	// El renderer informa de cada escritura de apariencia (y del registro al cargar):
	// el adorno la sigue sin reiniciar.
	ipcMain.on("lh:appearance", (event, next) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, new URL(url).origin, BrowserWindow)) return;
		appearance = normalizeAppearance(next);
		nativeTheme.themeSource = themeSourceFor(appearance.mode);
		for (const win of BrowserWindow.getAllWindows()) applyChrome(win);
	});
	reopenWindow = () => { chatgpt?.resume(); subscriptions?.resume(); return createWindow(url); };
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) reopenWindow();
	});
	createWindow(url);
	log(`window open: ${url}`);
	// Las comprobaciones al arrancar + cada 24h siguen siendo del proceso principal y leen la preferencia actual.
	// No hace falta ninguna suscripción del renderer; las cargas tardías recuperan la instantánea.
	if (autoUpdater) {
		checkForUpdates();
		setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
	}
}