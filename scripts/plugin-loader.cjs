"use strict";
// Se distribuye como fichero real, NO importado en el grafo de módulos de Next. Tanto este
// fichero adjunto como los puntos de entrada de los plugins los abre el createRequire nativo de Node.
const { createRequire } = require("node:module");
const { isAbsolute } = require("node:path");

exports.load = function load(filename) {
	if (!isAbsolute(filename)) throw new Error("Plugin entrypoint must be absolute");
	// Conserva la caché de Node: conmutar crea una activación nueva, no una recarga del código.
	return createRequire(filename)(filename);
};
