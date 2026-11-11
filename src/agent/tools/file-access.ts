import * as fs from "node:fs";
import * as path from "node:path";

/** Frontera de política de fuentes del alumno, basada en el #157 de lickbot. El servidor proporciona
 * las preferencias actuales por operación; los agentes nunca importan el almacén de ajustes.
 * Las denegaciones obligatorias de rutas sensibles/credenciales siguen en fs-shared, con independencia
 * de este límite OPCIONAL. Vacío solo significa cerrado cuando restricted es true. */
export interface FileAccessPolicy {
	restricted: boolean;
	folders: readonly string[];
	error?: string;
}
export interface ResolvedFileAccessPolicy {
	restricted: boolean;
	folders: readonly string[];
	unavailable: readonly string[];
}

const OPEN_POLICY: FileAccessPolicy = { restricted: false, folders: [] };
let currentPolicy: () => FileAccessPolicy = () => OPEN_POLICY;

export function setFileAccessPolicy(provider: () => FileAccessPolicy): void { currentPolicy = provider; }

export function fileAccessPolicy(): FileAccessPolicy {
	let policy: FileAccessPolicy;
	try { policy = currentPolicy(); }
	catch { throw new Error("File-access configuration error: preferences cannot be read. Repair File access in Settings → Agent → Tools."); }
	if (policy?.error) throw new Error(policy.error);
	if (!policy || typeof policy.restricted !== "boolean" || !Array.isArray(policy.folders) || policy.folders.some((folder) => typeof folder !== "string" || !path.isAbsolute(folder) || folder.includes("\0"))) {
		throw new Error("File-access configuration error: invalid policy. Repair File access in Settings → Agent → Tools.");
	}
	return policy;
}

/** Solo para comparar: conserva la semántica aceptada en #421 de espacios de nombres/ADS de
 * Windows. La forma devuelta nunca se usa para abrir un fichero. */
export function comparisonPath(absolute: string): string {
	let normalized = path.resolve(absolute);
	if (process.platform === "win32") {
		if (normalized.startsWith("\\\\?\\UNC\\")) normalized = `\\\\${normalized.slice(8)}`;
		else if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4);
		const base = path.basename(normalized);
		const stream = base.indexOf(":");
		if (stream !== -1) normalized = path.join(path.dirname(normalized), base.slice(0, stream));
	}
	return normalized;
}

/** Contención consciente de segmentos; ignoreCase es SOLO para la lista de denegación existente
 * de home. No pliegues globalmente a minúsculas las carpetas permitidas configuradas. */
export function isWithin(absolute: string, root: string, ignoreCase = false): boolean {
	let child = comparisonPath(absolute);
	let parent = comparisonPath(root);
	if (ignoreCase) { child = child.toLowerCase(); parent = parent.toLowerCase(); }
	const rel = path.relative(parent, child);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** El resolvedor canónico estricto aceptado, incluidos los descendientes que faltan.
 * Los bucles/permisos no deben convertir una fuente en una ruta léxica sin comprobar. */
export function realSourcePath(absolute: string): string {
	try { return fs.realpathSync.native(/* turbopackIgnore: true */ absolute); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
		const parent = path.dirname(absolute);
		return parent === absolute ? absolute : path.join(/* turbopackIgnore: true */ realSourcePath(parent), path.basename(absolute));
	}
}

/** Una instantánea por llamada a herramienta, compartida por todas las raíces de una búsqueda multirraíz.
 * Las raíces desmontadas/ilegibles nunca pasan a ser un respaldo por defecto a home. */
export function resolvePolicy(policy: FileAccessPolicy = fileAccessPolicy()): ResolvedFileAccessPolicy {
	if (policy.error) throw new Error(policy.error);
	if (!policy.restricted) return { restricted: false, folders: [], unavailable: [] };
	const folders: string[] = [];
	const unavailable: string[] = [];
	for (const folder of policy.folders) {
		try {
			const real = fs.realpathSync.native(/* turbopackIgnore: true */ folder);
			if (!fs.statSync(/* turbopackIgnore: true */ real).isDirectory()) throw new Error("not a directory");
			fs.accessSync(/* turbopackIgnore: true */ real, fs.constants.R_OK | fs.constants.X_OK);
			if (folders.some((root) => isWithin(real, root))) continue;
			for (let i = folders.length - 1; i >= 0; i--) if (isWithin(folders[i]!, real)) folders.splice(i, 1);
			folders.push(real);
		} catch { unavailable.push(`Unavailable allowed folder: ${folder}`); }
	}
	return { restricted: true, folders, unavailable };
}

/** Acepta solo ubicaciones de fuente canónicas contenidas en la instantánea. Los enlaces
 * simbólicos de las fuentes se resuelven antes de la contención; un enlace no puede escapar de las raíces elegidas.
 * fs-shared aplica sus denegaciones obligatorias por nombre Y canónicas antes de esta barrera. */
export function guardSourcePath(absolute: string, policy: ResolvedFileAccessPolicy = resolvePolicy()): string {
	const real = realSourcePath(absolute);
	if (policy.restricted && !policy.folders.some((folder) => isWithin(real, folder))) {
		throw new Error(
			`Access denied: ${absolute} is outside the allowed folders, or no allowed folders are available. ` +
			"Use ls without a path to list allowed folders, or ask the learner to adjust File access in Settings → Agent → Tools.",
		);
	}
	return real;
}
