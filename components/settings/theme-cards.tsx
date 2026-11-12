"use client";
/**
 * EL SELECTOR DE TEMAS (oleada de temas, 2026-11-04): una cuadrícula de
 * tarjetas de tema —los predefinidos, después los personalizados importados
 * y después la tarjeta discontinua "Import JSON"— bajo una cabecera que
 * nombra el tema activo y ofrece "Export JSON".
 *
 * Cada tarjeta previsualiza su tema con colores literales (nunca los tokens
 * en vivo de la página): una muestra "Aa ai" sobre el fondo del tema (texto
 * + tinta de acento) y cuatro puntos: superficie, acento, error y éxito.
 * Elegir una tarjeta solo cambia `appearance.theme`; las sustituciones
 * viajan intactas. Las importaciones hacen POST del JSON del fichero a
 * /api/themes (el servidor valida; su error se muestra en la tarjeta de
 * importación). La exportación descarga el tema ACTIVO con todas las
 * sustituciones aplicadas: volver a importarlo reproduce lo que hay en
 * pantalla.
 */

import { useRef, useState } from "react";
import { CheckIcon, DownloadIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportThemeFile, type AppearanceSettings, type Theme } from "@/src/core";

/** El marco de la tarjeta seleccionada: un hueco de 2px en la superficie
 * del diálogo y después un anillo de 1px en el acento del tema (la marca
 * junto al nombre hace el resto). */
const SELECTED_FRAME = "shadow-[0_0_0_2px_var(--card),0_0_0_3px_var(--lh-accent)]";

function Dot({ color, edge }: { color: string; edge?: string }) {
	return (
		<span
			aria-hidden
			className="size-3 rounded-full"
			style={{ background: color, ...(edge ? { border: `1px solid ${edge}` } : {}) }}
		/>
	);
}

/** La miniatura con colores literales: nunca lee los tokens de la página. */
function Preview({ theme }: { theme: Theme }) {
	const c = theme.colors;
	return (
		<span
			aria-hidden
			className="flex h-11 items-center justify-between rounded-md border px-3"
			style={{ background: c.background, borderColor: c.border }}
		>
			<span className="font-prose text-xl font-semibold" style={{ color: c.text }}>
				Aa <i className="font-normal" style={{ color: c.accent }}>ai</i>
			</span>
			<span className="flex gap-1.5">
				<Dot color={c.surface} edge={c.border} />
				<Dot color={c.accent} />
				<Dot color={c.error} />
				<Dot color={c.success} />
			</span>
		</span>
	);
}

/** Guarda un fichero JSON mediante una URL de objeto transitoria (navegador + Electron). */
function downloadJson(filename: string, data: unknown) {
	const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, "\t")}\n`], { type: "application/json" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** La fila Theme de Ajustes → Appearance (ver la cabecera del fichero). */
export function ThemeCards({
	themes,
	active,
	appearance,
	onSelect,
	onRemoved,
	onImported,
}: {
	/** Los predefinidos y después los personalizados (el catálogo del provider). */
	themes: readonly Theme[];
	/** El tema activo: su tarjeta está pulsada. */
	active: Theme;
	/** El delta del registro: la exportación aplica sus sustituciones. */
	appearance: AppearanceSettings | undefined;
	onSelect: (id: string) => void;
	/** Tras un DELETE con éxito (hay que volver a leer el catálogo). */
	onRemoved: (theme: Theme) => void;
	/** Tras una importación con éxito (hay que volver a leer el catálogo). */
	onImported: (theme: Theme) => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const importFile = async (file: File) => {
		setImportError(null);
		let body: unknown;
		try {
			body = JSON.parse(await file.text());
		} catch {
			setImportError(`${file.name} is not valid JSON`);
			return;
		}
		setBusy(true);
		try {
			const res = await fetch("/api/themes", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const out = (await res.json().catch(() => ({}))) as { theme?: Theme; error?: string };
			if (!res.ok || !out.theme) {
				setImportError(out.error ?? `import failed (${res.status})`);
				return;
			}
			onImported(out.theme);
		} catch {
			setImportError("import failed (network)");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (theme: Theme) => {
		const res = await fetch(`/api/themes/${encodeURIComponent(theme.id)}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) onRemoved(theme);
	};

	return (
		<div data-testid="row-theme" className="flex flex-col gap-3 py-1">
			<div className="flex items-end justify-between gap-4">
				<span className="min-w-0">
					<span className="block font-prose text-(length:--lh-prose-size)">Theme</span>
					<span data-testid="theme-hint" className="block text-xs text-muted-foreground/70">
						{active.name} · {active.mode} · sets every color below
					</span>
				</span>
				<button
					type="button"
					data-testid="theme-export"
					onClick={() => downloadJson(`${active.id}.json`, exportThemeFile(active, appearance))}
					className="flex h-7 shrink-0 items-center gap-2 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50"
				>
					<DownloadIcon className="size-3.5" />
					Export JSON
				</button>
			</div>
			<div className="grid grid-cols-3 gap-3">
				{themes.map((theme) => {
					const selected = theme.id === active.id;
					return (
						<div key={theme.id} className="relative min-w-0">
							<button
								type="button"
								data-testid={`theme-card-${theme.id}`}
								aria-pressed={selected}
								onClick={() => onSelect(theme.id)}
								className={cn(
									"flex w-full flex-col gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors",
									selected ? SELECTED_FRAME : "hover:border-muted-foreground/50",
								)}
							>
								<Preview theme={theme} />
								<span className={cn("flex items-center justify-between gap-2", !theme.builtin && "pr-6")}>
									<span className="flex min-w-0 items-center gap-1.5 font-prose text-base">
										{selected && <CheckIcon className="size-3.5 shrink-0" strokeWidth={2.5} />}
										<span className="truncate">{theme.name}</span>
									</span>
									<span className="shrink-0 rounded-sm border border-border px-1.5 font-ui text-xs uppercase tracking-wider text-muted-foreground">
										{theme.builtin ? theme.mode : "custom"}
									</span>
								</span>
							</button>
							{!theme.builtin && (
								<button
									type="button"
									aria-label={`Remove ${theme.name}`}
									data-testid={`theme-remove-${theme.id}`}
									onClick={() => void remove(theme)}
									className="absolute right-3 bottom-3 flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-error"
								>
									<Trash2Icon className="size-3.5" />
								</button>
							)}
						</div>
					);
				})}
				<button
					type="button"
					data-testid="theme-import"
					disabled={busy}
					onClick={() => fileRef.current?.click()}
					className="flex min-h-27 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-center font-ui text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<UploadIcon className="size-4" />
					<span>Import JSON</span>
					{importError ? (
						<span data-testid="theme-import-error" className="text-error">{importError}</span>
					) : (
						<span className="text-muted-foreground/70">name · mode · colors</span>
					)}
				</button>
				<input
					ref={fileRef}
					type="file"
					accept=".json,application/json"
					hidden
					data-testid="theme-import-file"
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = ""; // se puede volver a elegir el mismo fichero
						if (file) void importFile(file);
					}}
				/>
			</div>
		</div>
	);
}
