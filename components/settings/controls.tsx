"use client";
/**
 * Primitivas de ajustes ligeros (oleada de la app de ajustes): el kit de
 * controles que necesita el diálogo de ajustes. Secciones → grupos → filas;
 * todo se renderiza limpio en SSR (las pruebas de render fijan el marcado de
 * las secciones).
 *
 * El atenuado por dependencia (responsable, 2026-09-20) sigue la convención
 * del panel de renderizado del visor del grafo: TODA la fila se atenúa
 * (opacity-40, etiqueta y control juntos) y el propio control se bloquea;
 * la fila es dueña del atenuado.
 */

import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Un bloque de sección: encabezado mono marcado + contenido. */
export function SettingsSection({
	title,
	hint,
	children,
	testid,
}: {
	title: string;
	/** Una línea discreta bajo la cabecera, solo donde se gana su sitio. */
	hint?: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<section data-testid={testid} className="px-6 py-5">
			<h2 className="text-sm uppercase tracking-widest text-foreground">{title}</h2>
			{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
			<div className="mt-4 flex flex-col gap-3">{children}</div>
		</section>
	);
}

/** Un subgrupo con etiqueta dentro de una sección (responsable, 2026-09-20:
 * separación clara; Models / Tools / Prompts se leen como tres bloques). */
export function SettingsGroup({
	label,
	children,
	testid,
}: {
	label: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<div data-testid={testid} className="mt-5 border-t border-border/60 pt-4 first:mt-0 first:border-t-0 first:pt-0">
			<p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
			<div className="flex flex-col gap-2">{children}</div>
		</div>
	);
}

/** Una etiqueta + un control. Etiqueta a la izquierda (con pista atenuada
 * opcional) y control a la derecha: la forma de una fila de ajustes. */
export function SettingsRow({
	label,
	hint,
	children,
	testid,
	dimmed,
}: {
	label: string;
	hint?: ReactNode;
	children: React.ReactNode;
	testid?: string;
	/** Atenuado por dependencia, al estilo de la vista del grafo: toda la fila
	 * se atenúa cuando el control está inerte (padre desactivado, aún sin fichero, …). */
	dimmed?: boolean;
}) {
	return (
		<div data-testid={testid} className={cn("flex items-center justify-between gap-4 py-1", dimmed && "opacity-40")}>
			<span className="min-w-0">
				<span className="block font-prose text-(length:--lh-prose-size)">{label}</span>
				{hint && <span className="block text-xs text-muted-foreground/70">{hint}</span>}
			</span>
			{children}
		</div>
	);
}

/** El aspecto existente de menú plegado de Agent/Appearance, compartido con
 * el dictado. `unavailable` conserva los llamantes que bloquean los clics
 * sin desactivación nativa; `disabled` mantiene la semántica nativa del
 * botón donde el llamante la necesita. */
export function SettingsMenuTrigger({
	value, unavailable, disabled, className, ...props
}: Omit<ComponentPropsWithRef<"button">, "value" | "children"> & {
	value: string;
	unavailable?: boolean;
}) {
	return <button
		type="button"
		{...props}
		disabled={disabled}
		className={cn(
			"flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground transition-colors",
			disabled || unavailable ? "cursor-not-allowed" : "hover:border-muted-foreground/50",
			className,
		)}
	>
		<span className="min-w-0 flex-1 truncate">{value}</span>
		<span aria-hidden className="text-muted-foreground">▾</span>
	</button>;
}

/** El interruptor de encendido/apagado: un botón simple con el rol switch. */
export function Toggle({
	checked,
	disabled,
	onChange,
	label,
	discIcon,
	title,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
	/** Nombre accesible para el rol switch. */
	label: string;
	/** Disco con icono opcional (ronda del responsable, 2026-10-07): el
	 * conmutador de inversión de las tarjetas de figura renderiza el círculo de
	 * contraste medio relleno COMO disco; el icono lleva el significado y los
	 * conmutadores simples mantienen el disco liso. */
	discIcon?: ReactNode;
	/** Tooltip nativo opcional en el interruptor. */
	title?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			{...(title ? { title } : {})}
			disabled={disabled}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative h-4.5 w-8 shrink-0 rounded-full border border-border transition-colors",
				// Responsable (2026-09-20): activado es un raíl gris con un disco BLANCO (un raíl
				// totalmente blanco era demasiado llamativo); desactivado sigue siendo el raíl atenuado. Oleada de temas: el raíl
				// activado es el acento del tema (el acento de Default ES ese gris).
				checked ? "bg-(--lh-accent)" : "bg-muted",
				disabled && "cursor-not-allowed",
			)}
		>
			{discIcon ? (
				// El icono ES el disco: mismo tamaño, mismo deslizamiento, mismos colores de estado;
				// solo cambia la cara del pomo (la indicación de inversión).
				<span
					className={cn(
						"absolute left-0 top-0.5 flex size-3 items-center justify-center rounded-full transition-transform",
						checked ? "translate-x-4 text-foreground" : "translate-x-0.5 text-muted-foreground",
					)}
				>
					{discIcon}
				</span>
			) : (
				<span
					className={cn(
						"absolute left-0 top-0.5 size-3 rounded-full transition-transform",
						// 2px de margen desde cada borde interior, en ambos estados (ronda del responsable: el disco
						// activado tocaba antes el borde derecho de la píldora).
						checked ? "translate-x-4 bg-foreground" : "translate-x-0.5 bg-muted-foreground",
					)}
				/>
			)}
		</button>
	);
}

/** Un select ligero: elemento nativo, opciones tal como vienen. */
export function ThinSelect({
	value,
	onChange,
	children,
	ariaLabel,
	testid,
	disabled,
}: {
	value: string;
	onChange: (next: string) => void;
	children: React.ReactNode;
	ariaLabel: string;
	testid?: string;
	disabled?: boolean;
}) {
	return (
		<select
			value={value}
			aria-label={ariaLabel}
			data-testid={testid}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				"h-7 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground outline-none",
				disabled && "cursor-not-allowed",
			)}
		>
			{children}
		</select>
	);
}

/** Control de rango compartido de grafo/ajustes; la etiqueta y el valor van emparejados. */
export function SettingsSlider({ label, min, max, step, value, display, onChange, disabled, showLabel = true }: {
	label: string;
	min?: number;
	max?: number;
	step?: number;
	value: number;
	display?: string;
	/** SettingsRow aporta la etiqueta visible cuando es false. */
	showLabel?: boolean;
	onChange: (value: number) => void;
	disabled?: boolean;
}) {
	return <label className={`flex flex-col gap-1${disabled ? " opacity-40" : ""}`}>
		<span className="flex items-center justify-between text-[11px] text-muted-foreground">
			{showLabel && label}<span className="tabular-nums">{display ?? value}</span>
		</span>
		<input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
			onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full accent-primary" />
	</label>;
}

/** Acuse interno: false conserva un borrador rechazado/sin guardar. */
export type SettingsCommitResult = boolean | Promise<boolean>;

/** Una entrada hex/de texto ligera que confirma al perder el foco + con
 * Enter (al ritmo de los ajustes, no al de la escritura: cada confirmación
 * es un PUT de sección). */
export function CommitInput({
	value,
	placeholder,
	onCommit,
	ariaLabel,
	testid,
	type = "text",
	disabled,
	min,
	max,
	step,
}: {
	/** "" = sin valor (el valor de fábrica). Refleja el registro GUARDADO: tras
	 * una confirmación acotada/normalizada esto vuelve y el campo salta a la
	 * verdad guardada (reproducción del responsable: un tamaño negativo seguía
	 * mostrando "-5" mientras se había guardado 12). */
	value: string;
	placeholder?: string;
	onCommit: (next: string) => SettingsCommitResult;
	ariaLabel: string;
	testid?: string;
	type?: "text" | "number";
	disabled?: boolean;
	min?: number;
	max?: number;
	step?: number;
}) {
	// Conserva el búfer de edición nativo: las entradas numéricas pueden mostrar un token
	// incompleto mientras exponen value="" y badInput=true. Volver a escribir un valor controlado
	// al perder el foco o en el render borraría un texto que no podemos reconstruir.
	const [initialValue] = useState(value);
	const [, renderAcknowledgement] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const dirty = useRef(false);
	const revision = useRef(0);
	const latestCommit = useRef(0);
	const pending = useRef(new Set<number>());
	useLayoutEffect(() => {
		if (!dirty.current && input.current && input.current.value !== value) {
			input.current.value = value;
		}
	});

	const commit = async (element: HTMLInputElement) => {
		if (disabled || !dirty.current || element.validity?.badInput) return;
		const version = revision.current;
		if (pending.current.has(version)) return;
		const next = element.value.trim();
		if (next === value && pending.current.size === 0) {
			dirty.current = false;
			renderAcknowledgement((n) => n + 1);
			return;
		}
		const ticket = ++latestCommit.current;
		pending.current.add(version);
		try {
			const accepted = await onCommit(next);
			if (accepted && input.current === element && revision.current === version && latestCommit.current === ticket) {
				dirty.current = false;
				// Reconcilia incluso cuando la normalización aceptó el antiguo valor canónico.
				renderAcknowledgement((n) => n + 1);
			}
		} catch {
			// Los adaptadores de dominio se encargan de presentar los errores; un guardado rechazado conserva el texto.
		} finally {
			pending.current.delete(version);
		}
	};
	return (
		<input
			ref={input}
			type={type}
			defaultValue={initialValue}
			placeholder={placeholder}
			aria-label={ariaLabel}
			data-testid={testid}
			disabled={disabled}
			min={min}
			max={max}
			step={step}
			onInput={() => {
				dirty.current = true;
				revision.current++;
			}}
			onBlur={(e) => { void commit(e.currentTarget); }}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					e.currentTarget.blur();
				}
			}}
			className="h-7 w-40 rounded-sm border border-border bg-background px-2 font-ui text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
		/>
	);
}