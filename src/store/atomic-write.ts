/**
 * Sustitución de ficheros a prueba de cierres inesperados para los adaptadores del store (#403).
 *
 * writeFileAtomicSync(file, text) escribe un temporal junto al destino, le hace fsync
 * y lo renombra sobre el destino. Por este camino los lectores ven los bytes antiguos o
 * los bytes nuevos completos. Los llamadores siguen construyendo los bytes exactos y siguen
 * haciendo su propio mkdirSync. Los que antes escribían en el sitio optan explícitamente por el
 * respaldo de compatibilidad con Windows; los que antes ya escribían de forma atómica, no.
 *
 *   writeFileAtomicSync(file, JSON.stringify(record, null, "\t"));
 *   writeFileAtomicSync(AUTH_FILE, text, { mode: 0o600 }); // secretos
 *   removeLeftoverTemps(file); // después de borrar `file`
 *
 * Límites:
 *  - El camino del renombrado protege frente a la interrupción del proceso durante la escritura.
 *    No se hace fsync de la carpeta: no es una garantía de durabilidad ante cortes de corriente.
 *  - Sin bloqueo: dos escritores del mismo fichero siguen compitiendo, y gana el último.
 *  - Windows se niega a renombrar sobre ficheros que otro proceso tiene abiertos
 *    (antivirus, el indexador de Search, herramientas de copia de seguridad). El renombrado se reintenta durante
 *    unos 100 ms, bloqueando el hilo. Si sigue retenido, solo los llamadores con
 *    allowInPlaceFallback guardan en el sitio (el riesgo de interrupción anterior a #403),
 *    y nunca a través de un enlace simbólico.
 *    El temporal con fsync se queda hasta que esa escritura llega, y se conserva si falla
 *    a mitad. Los demás llamadores lanzan, dejando intacto el fichero antiguo.
 *  - El renombrado sustituye la ruta nombrada, incluido un enlace simbólico, no aquello a lo que apunta.
 *  - Los cierres inesperados pueden dejar `<file>.tmp-<uuid>` junto al destino. Los listados del store
 *    solo leen nombres que terminan en .json o .md, así que lo saltan.
 *  - Los ficheros nuevos reciben `mode` (por defecto 0o666 menos la umask), no el del fichero antiguo.
 */

import fs from "node:fs"; // importación por defecto a propósito: las pruebas parchean fs.renameSync en este objeto, y una importación de espacio de nombres no lo vería
import path from "node:path";
import { randomUUID } from "node:crypto";

const TEMP_MARKER = ".tmp-";
const RENAME_RETRY_MS = 100;

/** Sustituye `file` por `text` (UTF-8). Lanza si falla, dejando el fichero antiguo
 *  intacto, salvo cuando el respaldo en el sitio falla a mitad: entonces el fichero
 *  temporal de al lado conserva los bytes nuevos completos. */
export function writeFileAtomicSync(file: string, text: string, options?: { mode?: number; allowInPlaceFallback?: boolean }): void {
	const tmp = `${file}${TEMP_MARKER}${randomUUID()}`;
	let target: number;
	try {
		const fd = fs.openSync(tmp, "wx", options?.mode ?? 0o666);
		try {
			if (options?.mode !== undefined) fs.fchmodSync(fd, options.mode); // la umask puede haber borrado bits del modo de creación
			fs.writeFileSync(fd, text, "utf-8");
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		// `file` va a renameSync exactamente tal cual: los hooks de fallo de las pruebas se basan en él.
		if (renameRetryingSync(tmp, file, options?.allowInPlaceFallback ?? false)) return;
		target = fs.openSync(file, "w"); // retenido más allá del reintento: guardar en el sitio, como antes de #403
	} catch (error) {
		removeTemp(tmp); // el destino no se tocó
		throw error;
	}
	try {
		fs.writeFileSync(target, text, "utf-8"); // si esto falla, se conserva el temporal: es la única copia completa
	} finally {
		fs.closeSync(target);
	}
	console.warn(`[store] ${file} is held open by another program; saved it in place`);
	removeTemp(tmp);
}

/** Borra los ficheros temporales que los cierres inesperados dejaron junto a `file`. Llámalo después de borrar `file`,
 *  o los restos mantendrían en disco los bytes más recientes del registro borrado. */
export function removeLeftoverTemps(file: string): void {
	const prefix = `${path.basename(file)}${TEMP_MARKER}`;
	let names: string[];
	try {
		names = fs.readdirSync(path.dirname(file));
	} catch (error) {
		// Sin carpeta no hay restos. Cualquier otra cosa se informa, no se lanza:
		// el propio registro ya está borrado.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[store] could not look for temp files beside ${file}:`, error);
		return;
	}
	for (const name of names) if (name.startsWith(prefix)) removeTemp(path.join(path.dirname(file), name));
}

/** True cuando el renombrado llegó. False solo cuando el llamador permite el
 *  respaldo de compatibilidad con Windows y las violaciones de uso compartido duran más que el reintento. */
function renameRetryingSync(tmp: string, file: string, allowInPlaceFallback: boolean): boolean {
	const deadline = Date.now() + RENAME_RETRY_MS;
	for (let delay = 5; ; delay = Math.min(delay * 2, 40)) {
		try {
			fs.renameSync(tmp, file);
			return true;
		} catch (error) {
			if (!isSharingViolation(error, file)) throw error;
			if (Date.now() >= deadline) {
				// Abrir un enlace simbólico con "w" truncaría aquello a lo que apunta en lugar de
				// sustituir la ruta nombrada. Reintentar puede funcionar; el respaldo no debe hacerlo.
				if (allowInPlaceFallback && !fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return false;
				throw error;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay); // esperar sin espera activa
		}
	}
}

/** Errores de renombrado de Windows que explican los manejadores retenidos (en el destino, o en
 *  el fichero temporal recién creado cuando los escáneres lo abren). Los ficheros o carpetas de solo lectura
 *  en el destino fallan igual, pero esperar no los arregla. */
function isSharingViolation(error: unknown, file: string): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) return false;
	let stat: fs.Stats | undefined;
	try {
		stat = fs.statSync(file, { throwIfNoEntry: false });
	} catch {
		return false; // no se puede saber: informar del propio error de renombrado
	}
	if (!stat) return true; // aún no hay destino: el manejador está en el fichero temporal
	return stat.isFile() && (stat.mode & 0o200) !== 0;
}

function removeTemp(tmp: string): void {
	try {
		fs.unlinkSync(tmp); // no rmSync: en Node 25 para Windows se salta en silencio las rutas con caracteres no ASCII
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[store] could not remove temp file ${tmp}:`, error); // inofensivo: los listados lo saltan
	}
}
