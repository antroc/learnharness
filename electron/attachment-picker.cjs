"use strict";
const { trustedSender } = require("./chatgpt-ipc.cjs");

/** Solo referencia de ruta: diálogo fijo de solo directorios, sin
 * enumeración ni concesión de acceso. Mantén la lista blanca de modos y
 * todas las comprobaciones de confianza en el proceso principal. */
async function pickAttachmentPath(event, mode, { BrowserWindow, dialog, trustedAppWindows, origin }) {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!trustedAppWindows.has(win) || !trustedSender(event, origin, BrowserWindow)) throw new Error("Untrusted desktop request.");
	if (mode !== "folder") throw new Error("Unsupported attachment picker mode.");
	const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
	return result.canceled ? null : result.filePaths[0] ?? null;
}

module.exports = { pickAttachmentPath };
