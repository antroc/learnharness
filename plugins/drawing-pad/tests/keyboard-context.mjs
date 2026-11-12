// La fixture desechable aporta el gestor real del host a la sección real de Keyboard
// sin montar el router ni los providers de SSE de Next. Ningún código del plugin lo usa.
import { useSyncExternalStore } from "react";

export function usePlugins() {
  const manager = window.fixture.actionManager();
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  return { manager, snapshot, uiStore: null };
}
