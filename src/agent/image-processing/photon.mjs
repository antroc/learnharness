// Adaptado de @earendil-works/pi-coding-agent 1.1.0, dist/utils/photon.js (MIT).
// Adaptación del código al runtime: esta app se ejecuta en Node/Electron, no en un
// ejecutable compilado con Bun. Photon carga con normalidad su WASM contiguo; no hace falta
// ningún parche global de fs ni un respaldo de WASM relativo al ejecutable.
let photonModule = null;
let loadPromise = null;

export async function loadPhoton() {
    if (photonModule) return photonModule;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            photonModule = await import("@silvia-odwyer/photon-node");
            return photonModule;
        } catch {
            photonModule = null;
            return photonModule;
        }
    })();
    return loadPromise;
}
