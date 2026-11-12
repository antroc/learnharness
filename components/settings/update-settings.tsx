"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrailleSpinner } from "@/components/braille-spinner";
import { SettingsRow, Toggle } from "./controls.tsx";

/** Instantánea de observación de electron/main.cjs; nunca un permiso del actualizador. */
export type UpdateState = {
	status: "idle" | "checking" | "downloading" | "up-to-date" | "downloaded" | "error" | "disabled";
	version: string | null;
	revision: number;
};

export const APP_VERSION = process.env.LH_VERSION ?? "";
const HOMEPAGE = process.env.LH_HOMEPAGE ?? "";
export const MANUAL_UPDATE_HINT = "Checking downloads available updates. Downloaded updates install when you quit the app.";
export const AUTO_UPDATE_HINT = "Check at startup and every 24 hours. Turning this off does not stop updates already in progress or ready to install.";
const UPDATE_ERROR = "Couldn’t check for updates. Try again later.";

/** Se suscribe antes de pedir la instantánea. Las respuestas IPC y los
 * envíos pueden cruzarse; una revisión evita que una respuesta antigua
 * oculte un evento más reciente. El aviso comparte este observador de solo
 * lectura para que las cargas tardías también se recuperen. */
export function useUpdateState() {
	const [state, setState] = useState<UpdateState | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const lh = window.lh;
		if (!lh) return;
		let live = true;
		let revision = -1;
		const accept = (next: UpdateState) => {
			if (!live || next.revision < revision) return;
			revision = next.revision;
			setState(next);
			setFailed(false);
		};
		const off = lh.onUpdateStatus?.(accept);
		void lh.getUpdateState?.().then(accept).catch(() => {
			if (live && revision === -1) setFailed(true);
		});
		return () => { live = false; off?.(); };
	}, []);
	return { state, failed };
}

export function updateStatusText(state: UpdateState | null): string | null {
	switch (state?.status) {
		case "checking": return "Checking for updates…";
		case "downloading": return state.version ? `Downloading version ${state.version}…` : "Downloading an update…";
		case "up-to-date": return "No newer version was found at the last check.";
		case "downloaded": return `${state.version ? `Version ${state.version}` : "An update"} is ready. It will install when you quit the app.`;
		case "error": return UPDATE_ERROR;
		default: return null;
	}
}

/** La información de versión es útil en todas partes; los controles de
 * actualización solo tienen sentido en un armazón con actualizador
 * disponible. Abrir esta fila nunca comprueba nada. */
export function UpdateSettings({
	autoUpdate,
	onAutoUpdateChange,
	version = APP_VERSION,
	homepage = HOMEPAGE,
}: {
	autoUpdate: boolean;
	onAutoUpdateChange: (on: boolean) => void;
	version?: string;
	homepage?: string;
}) {
	const { state, failed } = useUpdateState();
	const [checkFailed, setCheckFailed] = useState(false);
	useEffect(() => setCheckFailed(false), [state]);
	const active = state !== null && state.status !== "disabled";
	const busy = state?.status === "checking" || state?.status === "downloading";
	const status = state?.status === "downloaded" ? updateStatusText(state)
		: failed || checkFailed ? UPDATE_ERROR : updateStatusText(state);
	const releaseNotes = version && homepage ? `${homepage}/releases/tag/v${version}` : null;
	const check = () => {
		setCheckFailed(false);
		void window.lh?.checkForUpdates?.().catch(() => setCheckFailed(true));
	};

	return (
		<>
			<SettingsRow
				label={`Version ${version || "unknown"}`}
				testid="row-version"
				hint={
					<>
						{status && <span className="block" role="status" data-testid="update-status">{status}</span>}
						{active && <span className="block">{MANUAL_UPDATE_HINT}</span>}
						{releaseNotes && <a href={releaseNotes} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline" data-testid="release-notes">Release notes</a>}
					</>
				}
			>
				{active && (state.status === "downloaded" ? (
					<Button type="button" size="xs" className="cursor-pointer" data-testid="update-restart" onClick={() => window.lh?.installUpdate?.()}>Restart</Button>
				) : (
					<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" data-testid="update-check" disabled={busy} aria-busy={busy} onClick={check}>
						{busy && <BrailleSpinner label={state.status === "downloading" ? "Downloading update" : "Checking for updates"} />}
						Check for updates
					</Button>
				))}
			</SettingsRow>
			{active && (
				<SettingsRow label="Automatic updates" hint={AUTO_UPDATE_HINT} testid="row-auto-update">
					<Toggle checked={autoUpdate} label="auto update" onChange={onAutoUpdateChange} />
				</SettingsRow>
			)}
		</>
	);
}
