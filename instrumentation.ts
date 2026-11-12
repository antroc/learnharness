/** Los plugins usan el hook documentado de inicialización por servidor. Un
 * fallo de un plugin no debe impedir el acceso a los datos de aprendizaje
 * existentes ni a la enseñanza/práctica. */
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { initializePlugins } = await import("./src/server/plugins.ts");
		try { await initializePlugins(); }
		catch (error) { console.error("[plugins] Initialization failed; plugin management will report the error:", error); }
	}
}
