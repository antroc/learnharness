import { Home } from "@/components/home";
import { readSettingsRecord } from "@/src/server";
import { resolveSettings, slotsConfigured } from "@/src/core";

// Dinámica: el estado de configuración se renderiza en el servidor dentro de la página
// (la verdad de la llamada a la acción de configuración en el primer fotograma), y cada navegación vuelve a leer
// el registro (las rutas dinámicas no se cachean en el cliente).
export const dynamic = "force-dynamic";

export default function HomePage() {
	// Barrera del primer uso (oleada de ranuras de modelo): no se pueden empezar chats hasta que
	// el usuario haya elegido las tres ranuras; el dock muestra la llamada a la acción mientras a la
	// sección models del registro en bruto le falte la fijación de alguna ranura.
	const record = readSettingsRecord();
	// RENDERIZADO DEL GRAFO (responsable, 2026-10-06): desactivado = la vista principal del inicio
	// es la vista de cadenas. Se resuelve con el único resolvedor del núcleo (sección ausente /
	// clave ausente → valor de fábrica activado); se vuelve a leer en cada navegación.
	const rendering = resolveSettings(record ?? null).graph.rendering;
	return (
		<Home initialConfigured={slotsConfigured(record?.models)} rendering={rendering} />
	);
}
