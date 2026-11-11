"use client";

/**
 * El banner de actualización automática (oleada C, responsable 2026-10-10:
 * descarga silenciosa + experiencia de banner para reiniciar). El armazón
 * envía "lh:update-status" en cuanto existe una actualización preparada
 * (update-downloaded de electron/main.cjs). La obtención de la instantánea
 * también cubre una carga tardía. La tarjeta ofrece Restart junto a
 * Settings. Las compilaciones para navegador no tienen window.lh y nunca
 * reciben el aviso: renderiza null.
 *
 * Descartarlo oculta esta versión solo en la ventana montada; la
 * actualización se sigue instalando al salir (autoInstallOnAppQuit) o desde
 * Settings.
 */

import { useState } from "react";
import { XIcon } from "lucide-react";
import { useUpdateState } from "@/components/settings/update-settings.tsx";

export default function UpdateBanner() {
	const { state: ready } = useUpdateState();
	const [dismissedVersion, setDismissedVersion] = useState<string | null>();
	if (ready?.status !== "downloaded" || ready.version === dismissedVersion) return null;
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<div className="text-sm">
				<span className="font-medium">LearnHarness {ready.version ?? "update"} is ready</span>
				<span className="text-muted-foreground"> — restart to finish installing.</span>
			</div>
			<button
				type="button"
				onClick={() => window.lh?.installUpdate?.()}
				className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80"
			>
				Restart
			</button>
			<button
				type="button"
				aria-label="Dismiss update notification"
				onClick={() => setDismissedVersion(ready.version)}
				className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}
