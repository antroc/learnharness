/*
 * Preload (2026-09-17, oleada de la ventana estrecha): el ÚNICO puente entre
 * el renderer aislado y el proceso principal. contextIsolation + sandbox
 * están activados (electron/main.cjs), así que este fichero es todo el
 * acceso del renderer a Electron: mantenlo como una superficie de API mínima
 * y explícita.
 *
 *   window.lh.platform — identidad del SO de solo lectura para los márgenes
 *   de los controles nativos de ventana (darwin: semáforos a la izquierda;
 *   win32/linux: superposición a la derecha).
 *
 *   window.lh.expandWindow() — ensancha la ventana hasta el umbral de cierre
 *   automático de la barra lateral (928px) cuando la barra se abre por debajo
 *   de él. El proceso principal acota: no hace nada si la ventana ya es lo
 *   bastante ancha.
 *
 *   window.lh.onZoom(cb) / window.lh.getZoom() — la verdad del zoom (ronda 7
 *   del responsable, 2026-10-05): cada cambio con ⌘±/⌘0 llega como "lh:zoom"
 *   con el nuevo factor; getZoom cubre la carrera del primer pintado. El
 *   renderer lo publica como --lh-zoom para que las longitudes de tamaño
 *   físico constante (el margen de los semáforos) puedan dividirse por él.
 *
 *   window.lh.onUpdateStatus(cb) / window.lh.installUpdate() — el canal de
 *   actualización automática (Oleada C, 2026-10-10): "lh:update-status" envía
 *   {status, version, revision} con los eventos del actualizador;
 *   installUpdate pide al proceso principal que mate el servidor y haga
 *   quit-and-install. getUpdateState recupera la instantánea para un
 *   suscriptor tardío; checkForUpdates pide una comprobación manual (incluida
 *   la descarga/instalación al salir, aunque las comprobaciones automáticas
 *   estén DESACTIVADAS).
 *
 *   window.lh.onOpenSettings(cb) — navegación desde el menú, guardada hasta
 *   que React se suscribe tras reabrir una ventana. Las compilaciones para
 *   navegador no tienen puente.
 *
 *   window.lh.setAppearance(a) — el { mode, background } del tema activo
 *   (oleada de temas, 2026-11-04): el proceso principal fija
 *   nativeTheme.themeSource y vuelve a pintar el fondo nativo de la ventana /
 *   la superposición de controles a juego.
 *
 * Los nombres de los canales se reflejan en electron/main.cjs; mantenlos
 * sincronizados.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

let openSettingsListener = null;
let pendingOpenSettings = null;
ipcRenderer.on("lh:open-settings", (_event, section) => {
	if (openSettingsListener) openSettingsListener(section);
	else pendingOpenSettings = section;
});

contextBridge.exposeInMainWorld("lh", {
	platform: process.platform,
	// Resuelve solo un File respaldado por el SO y aportado por el renderer. Sin API del sistema de ficheros,
	// subidas, copias ni IPC de File del DOM hacia el proceso principal; sandbox/aislamiento siguen activos.
	getPathForFile: (file) => webUtils.getPathForFile(file),
	chooseAttachmentFolder: () => ipcRenderer.invoke("lh:attachment:pick", "folder"),
	...(process.argv?.includes("--lh-web-subscriptions") ? {
		subscriptionTransport: "web",
		openSubscriptionBrowser: (action) => ipcRenderer.invoke("lh:subscriptions:web-browser", action),
	} : {}),
	chatgpt: {
		status: () => ipcRenderer.invoke("lh:chatgpt:control", { op: "status" }),
		login: (id) => ipcRenderer.invoke("lh:chatgpt:control", { op: "login", id }),
		cancel: () => ipcRenderer.invoke("lh:chatgpt:control", { op: "cancel" }),
		select: (id) => ipcRenderer.invoke("lh:chatgpt:control", { op: "select", id }),
		disconnect: (id) => ipcRenderer.invoke("lh:chatgpt:control", { op: "disconnect", id }),
		logout: (id) => ipcRenderer.invoke("lh:chatgpt:control", { op: "logout", id }),
		consent: (enabled) => ipcRenderer.invoke("lh:chatgpt:control", { op: "consent", enabled }),
		onChange: (cb) => {
			const listener = () => cb();
			ipcRenderer.on("lh:chatgpt:changed", listener);
			return () => ipcRenderer.removeListener("lh:chatgpt:changed", listener);
		},
	},
	subscriptions: {
		status: () => ipcRenderer.invoke("lh:subscriptions:control", { op: "status" }),
		login: (providerId, enabled) => ipcRenderer.invoke("lh:subscriptions:control", { op: "login", providerId, enabled }),
		cancel: (providerId) => ipcRenderer.invoke("lh:subscriptions:control", { op: "cancel", providerId }),
		respond: (providerId, attemptId, promptId, value) => ipcRenderer.invoke("lh:subscriptions:control", { op: "respond", providerId, attemptId, promptId, value }),
		open: (providerId, attemptId, actionId) => ipcRenderer.invoke("lh:subscriptions:control", { op: "open", providerId, attemptId, actionId }),
		retry: (providerId) => ipcRenderer.invoke("lh:subscriptions:control", { op: "retry", providerId }),
		disconnect: (providerId) => ipcRenderer.invoke("lh:subscriptions:control", { op: "disconnect", providerId }),
		consent: (providerId, enabled) => ipcRenderer.invoke("lh:subscriptions:control", { op: "consent", providerId, enabled }),
		onChange: (cb) => {
			const listener = () => cb();
			ipcRenderer.on("lh:subscriptions:changed", listener);
			return () => ipcRenderer.removeListener("lh:subscriptions:changed", listener);
		},
	},
	expandWindow: () => ipcRenderer.send("lh:expand-window"),
	setAppearance: (a) => ipcRenderer.send("lh:appearance", a),
	onZoom: (cb) => {
		const listener = (_event, factor) => cb(factor);
		ipcRenderer.on("lh:zoom", listener);
		return () => ipcRenderer.removeListener("lh:zoom", listener);
	},
	getZoom: () => ipcRenderer.invoke("lh:zoom:get"),
	onUpdateStatus: (cb) => {
		const listener = (_event, status) => cb(status);
		ipcRenderer.on("lh:update-status", listener);
		return () => ipcRenderer.removeListener("lh:update-status", listener);
	},
	installUpdate: () => ipcRenderer.send("lh:update-install"),
	getUpdateState: () => ipcRenderer.invoke("lh:update:get"),
	checkForUpdates: () => ipcRenderer.invoke("lh:update:check"),
	onOpenSettings: (cb) => {
		openSettingsListener = cb;
		if (pendingOpenSettings !== null) {
			const section = pendingOpenSettings;
			pendingOpenSettings = null;
			cb(section);
		}
		return () => {
			if (openSettingsListener === cb) openSettingsListener = null;
		};
	},
});
