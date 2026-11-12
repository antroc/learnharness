import { redirect } from "next/navigation";

/**
 * La superficie de ajustes se graduó a un diálogo centrado sobre la app
 * (oleada de la app de ajustes, 2026-09-20; decisión del responsable: solo
 * modal, sin página). La URL sigue enrutada pero redirige: nada debería
 * acabar en una página muerta; el diálogo se abre desde la fila de la barra
 * lateral o con mod+,.
 */
export default function SettingsPage() {
	redirect("/chat/new");
}
