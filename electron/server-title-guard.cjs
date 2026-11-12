/**
 * Se precarga solo en el backend empaquetado de macOS, antes de que arranque
 * Next.
 *
 * Next asigna process.title. En el modo Node de Electron en macOS, el
 * establecedor nativo se registra en Launch Services usando el paquete de la
 * app principal, lo que crea un registro no deseado de aplicación en primer
 * plano. Por eso las escrituras del título se quedan en JS: el nombre nativo
 * del proceso no cambia, mientras que JS puede volver a leer el título
 * asignado. A propósito, no emula el truncado nativo ni todos los detalles
 * de conversión; las asignaciones usan String(value).
 *
 * Los argumentos de lanzamiento explícitos (no NODE_OPTIONS) dejan intacto
 * el auxiliar de navegador del Electron completo. Los descendientes de fork
 * en modo Node pueden heredar esta precarga.
 */
if (process.platform === "darwin" && process.env.ELECTRON_RUN_AS_NODE === "1" && process.env.LH_DESKTOP_SERVER === "1") {
	let title = process.title;
	Object.defineProperty(process, "title", {
		configurable: true,
		enumerable: true,
		get: () => title,
		set: (value) => {
			title = String(value);
		},
	});
}
