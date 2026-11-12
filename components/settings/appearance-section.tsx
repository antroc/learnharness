"use client";
/**
 * Las secciones Appearance + Graph (oleada de ajustes ligeros).
 *
 * Los controles de apariencia se resuelven contra los valores de fábrica en
 * el provider; las escrituras hacen PUT de toda la sección appearance y
 * devuelven el delta para que las variables CSS cambien AL INSTANTE (es todo
 * el sentido de la sección: tiene que HACER algo). Oleada de temas
 * (2026-11-04): la cuadrícula de temas (./theme-cards.tsx) va arriba y fija
 * todos los colores; el bloque "Colors" de debajo guarda una sustitución hex
 * por cada color del tema (vacío = el del tema), que se conserva al cambiar
 * de tema; "Typography" guarda los controles tipográficos. Las entradas hex
 * confirman al perder el foco o con Enter.
 *
 * El atenuado de Graph (responsable, 2026-09-20) sigue la convención del
 * panel de renderizado del visor del grafo: toda la fila se atenúa cuando
 * un padre está desactivado (los valores guardados persisten pero se
 * resuelven inertes: el interruptor muestra lo guardado, el atenuado lo
 * efectivo).
 *
 * Fuente de lectura (oleada de apariencia, 2026-09-26, decisión del
 * responsable): un desplegable con búsqueda de las fuentes INSTALADAS del
 * usuario (FontMenuList sobre la maquinaria de model-menu), alimentado por
 * window.queryLocalFonts() en el armazón de escritorio. La enumeración va
 * ligada a un clic (la API requiere activación del usuario), se deduplica a
 * familias únicas y excluye la familia de fábrica (la fila DEFAULT es esa).
 * En un navegador de desarrollo normal la API no existe → una pequeña lista
 * curada + un pie que dice exactamente eso; nunca una lista del sistema
 * inventada. La entrada de familia personalizada dentro del menú es la vía
 * de escape manual. Vacío/sin valor sigue significando Source Sans 3.
 *
 * Las sustituciones viven en dos sitios a propósito: `background` y
 * `mdRendering.boldColor/italicColor` conservan sus claves anteriores a los
 * temas (los registros existentes conservan sus colores); las otras nueve
 * están en `colors`. effectiveColors de core/themes.ts es el único sitio
 * donde se fusionan.
 */

import { useEffect, useRef, useState } from "react";
import {
	EXTRACTION_CHUNK_TOKENS_FLOOR,
	resolveSettings,
	THEME_COLOR_KEYS,
	type AppearanceSettings,
	type GraphSettings,
	type ThemeColorKey,
} from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { Hint } from "@/components/ui/hint";
import { BUNDLED_READING_FONTS, useAppearance } from "./appearance.tsx";
import { FontMenuList } from "./model-menu";
import { ThemeCards } from "./theme-cards.tsx";
import { CommitInput, SettingsMenuTrigger, SettingsRow, Toggle } from "./controls.tsx";

/** La familia de lectura de fábrica: la identidad de la fila DEFAULT (sin
 * valor = esta). Exportada para las pruebas. */
export const DEFAULT_READING_FONT = "Source Sans 3";

/** La lista alternativa del navegador de desarrollo (allí no existe
 * queryLocalFonts): las fuentes conocidas de la propia app más un puñado de
 * familias omnipresentes de macOS, ROTULADAS honestamente como comunes;
 * nunca se presenta como la lista real del sistema. No incluye la familia
 * de fábrica: la fila DEFAULT es esa. Exportada para las pruebas. */
export const CURATED_FALLBACK_FONTS: readonly string[] = [
	"Arial",
	"CMU Serif",
	"Courier New",
	"Georgia",
	"Helvetica",
	"Helvetica Neue",
	"JetBrains Mono",
	"Menlo",
	"Times New Roman",
	"Trebuchet MS",
	"Verdana",
];

/** La forma de window.queryLocalFonts tal como la consume esta sección
 * (family es el único campo que se usa; la API devuelve un FontData por
 * cada ESTILO y el llamante deduplica). */
type LocalFontsApi = () => Promise<Array<{ family: string }>>;

/** La frontera de Local Font Access, leída de forma perezosa (en SSR no hay
 * window, y acceder durante el render evaluaría la API en el servidor). */
function localFontsApi(): LocalFontsApi | null {
	if (typeof window === "undefined") return null;
	return (window as unknown as { queryLocalFonts?: LocalFontsApi }).queryLocalFonts ?? null;
}

/** Compone la elección de fuente de lectura: null (o en blanco) = la
 * Source Sans 3 de fábrica; si no, la familia tal cual (recortada; el
 * saneador vuelve a recortar en el servidor). Puro; exportado para las pruebas. */
export function composeFontFamily(
	appearance: AppearanceSettings | undefined,
	family: string | null,
): AppearanceSettings {
	const value = family?.trim() ?? "";
	return { ...appearance, fontFamily: value === "" ? null : value };
}

/** Las etiquetas de la cuadrícula Colors y la única pista que explica una clave. */
const COLOR_LABELS: Record<ThemeColorKey, { label: string; note?: string }> = {
	background: { label: "Background" },
	accent: { label: "Accent", note: "Focus rings, toggles, selection" },
	surface: { label: "Surface", note: "Cards, inputs, sidebar" },
	bold: { label: "Bold" },
	border: { label: "Border" },
	italic: { label: "Italic" },
	text: { label: "Text" },
	code: { label: "Inline code" },
	textMuted: { label: "Muted text" },
	error: { label: "Error" },
	success: { label: "Success" },
	warning: { label: "Warning" },
};

/** Los ids de prueba heredados de las tres filas anteriores a los temas (se mantienen estables). */
const LEGACY_TESTIDS: Partial<Record<ThemeColorKey, string>> = {
	background: "input-background",
	bold: "input-bold-color",
	italic: "input-italic-color",
};

/** La sustitución guardada de un color del tema ("" = ninguna). Puro;
 * exportado para las pruebas. */
export function colorOverride(appearance: AppearanceSettings | undefined, key: ThemeColorKey): string {
	if (key === "background") return appearance?.background ?? "";
	if (key === "bold") return appearance?.mdRendering?.boldColor ?? "";
	if (key === "italic") return appearance?.mdRendering?.italicColor ?? "";
	return appearance?.colors?.[key] ?? "";
}

/** Compone una sustitución en la sección ("" = volver al del tema). Todos
 * los demás campos viajan intactos. Puro; exportado para las pruebas. */
export function composeColorOverride(
	appearance: AppearanceSettings | undefined,
	key: ThemeColorKey,
	value: string,
): AppearanceSettings {
	const v = value === "" ? null : value;
	if (key === "background") return { ...appearance, background: v };
	if (key === "bold") return { ...appearance, mdRendering: { ...appearance?.mdRendering, boldColor: v } };
	if (key === "italic") return { ...appearance, mdRendering: { ...appearance?.mdRendering, italicColor: v } };
	const colors = { ...appearance?.colors };
	if (v === null) delete colors[key];
	else colors[key] = v;
	return { ...appearance, colors };
}

/** "Reset all": todos los colores vuelven a los del tema; los controles tipográficos no se tocan. */
export function clearColorOverrides(appearance: AppearanceSettings | undefined): AppearanceSettings {
	const { background: _bg, colors: _colors, ...rest } = appearance ?? {};
	const md = appearance?.mdRendering;
	if (!md) return rest;
	const { boldColor: _b, italicColor: _i, ...mdRest } = md;
	return { ...rest, mdRendering: mdRest };
}

function ColorOverrideRow({
	colorKey,
	value,
	themeColor,
	effective,
	onCommit,
}: {
	colorKey: ThemeColorKey;
	value: string;
	themeColor: string;
	effective: string;
	onCommit: (next: string) => boolean | Promise<boolean>;
}) {
	const { label, note } = COLOR_LABELS[colorKey];
	const empty = `Empty = ${themeColor}`;
	return (
		<SettingsRow label={label} hint={note ? `${note} · ${empty}` : empty} testid={`row-color-${colorKey}`}>
			<span className="flex items-center gap-2">
				<span
					aria-hidden
					data-testid={`swatch-${colorKey}`}
					className="size-4 shrink-0 rounded-sm border border-border"
					style={{ background: effective }}
				/>
				<CommitInput
					value={value}
					placeholder={themeColor}
					ariaLabel={`${label.toLowerCase()} hex`}
					testid={LEGACY_TESTIDS[colorKey] ?? `input-color-${colorKey}`}
					onCommit={onCommit}
				/>
			</span>
		</SettingsRow>
	);
}

export function AppearanceSection({
	appearance,
	onSectionChange,
}: {
	/** El delta de apariencia del registro (ausente = de fábrica). */
	appearance: AppearanceSettings | undefined;
	/** Hace PUT de toda la sección appearance; la página la vuelve a aplicar si tiene éxito. */
	onSectionChange: (next: AppearanceSettings) => boolean | Promise<boolean>;
}) {
	const { appearance: resolved, activeTheme, colors, themes, refreshThemes } = useAppearance();
	const md = appearance?.mdRendering;

	// El estado abierto del desplegable de fuentes + su caché de enumeración. undefined =
	// aún sin enumerar (escritorio: queryLocalFonts ligado al clic, pendiente);
	// null = enumeración NO DISPONIBLE (la API no existe en un navegador
	// normal, se rechazó o se resolvió VACÍA: el permiso local-fonts de Electron 44
	// se concede y aun así la enumeración no devuelve ninguna fuente,
	// reproducido el 2026-09-26) → la alternativa curada; una lista = las familias
	// deduplicadas. enumEmpty distingue POR QUÉ se recurrió a la alternativa, para el pie.
	const [fontMenuOpen, setFontMenuOpen] = useState(false);
	const [localFonts, setLocalFonts] = useState<string[] | null | undefined>(undefined);
	const [enumEmpty, setEnumEmpty] = useState(false);
	const menuAnchorRef = useRef<HTMLSpanElement>(null);
	const interactions = useInteractionLayers();

	// La enumeración se ejecuta DENTRO del clic del disparador: queryLocalFonts
	// requiere activación del usuario, así que no puede ser un efecto de montaje. Solo
	// la primera apertura: las familias se cachean durante la vida de la sección (instalar
	// fuentes con el diálogo abierto no es un caso); CUALQUIER enumeración no disponible
	// (inexistente / rechazada / vacía) recurre a la lista curada en vez de
	// a un selector vacío.
	const openFontMenu = () => {
		setFontMenuOpen((open) => {
			if (!open && localFonts === undefined) {
				const api = localFontsApi();
				if (api === null) {
					setLocalFonts(null);
					setEnumEmpty(false);
				} else {
					void api()
						.then((fonts) => {
							const installed = fonts.map((f) => f.family);
							// Las familias empaquetadas se unen a las instaladas (se
							// renderizan las tenga o no el SO), pero solo
							// cuando de verdad se leyó la lista del SO.
							const families = [...new Set(installed.length ? [...installed, ...Object.keys(BUNDLED_READING_FONTS)] : [])]
								.filter((f) => f !== DEFAULT_READING_FONT)
								.sort((a, b) => a.localeCompare(b));
							if (families.length === 0) {
								// Resuelta pero vacía: no es un fallo que vea el catch;
								// es un «no disponible» honesto (esta compilación de Electron 44
								// no enumera nada aunque tenga permiso).
								setLocalFonts(null);
								setEnumEmpty(true);
							} else {
								setLocalFonts(families);
							}
						})
						.catch(() => {
							setLocalFonts(null);
							setEnumEmpty(false);
						});
				}
			}
			return !open;
		});
	};

	const pickFont = (family: string | null) => {
		setFontMenuOpen(false);
		onSectionChange(composeFontFamily(appearance, family));
	};

	// El contrato del desplegable (el de agent-section, reflejado): cualquier clic
	// fuera del menú abierto —o un Esc— lo cierra. El Esc se RECLAMA con
	// stopPropagation para que el diálogo de ajustes de detrás NO se cierre también.
	useEffect(() => {
		if (!fontMenuOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>('[data-testid="font-menu"]'))) return;
			const target = e.target as Node;
			if (menuAnchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (target instanceof Element && target.closest('[role="dialog"]')) {
				setFontMenuOpen(false);
			}
			// si no: fuera del diálogo; lo gestiona el propio cierre del diálogo.
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [fontMenuOpen, interactions]);

	return (
		<>
			<ThemeCards
				themes={themes}
				active={activeTheme}
				appearance={appearance}
				onSelect={(id) => onSectionChange({ ...appearance, theme: id })}
				onImported={() => void refreshThemes()}
				onRemoved={(removed) => {
					void refreshThemes();
					// El servidor ya recurrió a Default; la escritura mantiene el espejo del
					// registro del diálogo y las variables en vivo sincronizados con ello.
					if (removed.id === activeTheme.id) onSectionChange({ ...appearance, theme: "default" });
				}}
			/>
			<div data-testid="group-colors" className="mt-5 flex flex-col gap-2">
				<div className="flex items-end justify-between gap-4">
					<p className="text-xs uppercase tracking-widest text-muted-foreground">
						Colors{" "}
						<span className="normal-case tracking-normal text-muted-foreground/70">
							· overrides on top of the theme, kept when you switch
						</span>
					</p>
					<button
						type="button"
						data-testid="colors-reset"
						onClick={() => onSectionChange(clearColorOverrides(appearance))}
						className="h-6 shrink-0 rounded-sm px-2 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						Reset all
					</button>
				</div>
				<div className="grid grid-cols-2 gap-x-10 gap-y-2">
					{THEME_COLOR_KEYS.map((key) => (
						<ColorOverrideRow
							key={key}
							colorKey={key}
							value={colorOverride(appearance, key)}
							themeColor={activeTheme.colors[key]}
							effective={colors[key]}
							onCommit={(v) => onSectionChange(composeColorOverride(appearance, key, v))}
						/>
					))}
				</div>
			</div>
			<p className="mt-5 mb-2 text-xs uppercase tracking-widest text-muted-foreground">Typography</p>
			<SettingsRow
				label="Reading font"
				hint={`Empty = ${DEFAULT_READING_FONT}`}
				testid="row-font"
			>
				<span ref={fontMenuOpen ? menuAnchorRef : undefined} className="relative flex items-center gap-2">
					{/* El disparador compartido de menú plegado de Agent/Appearance.
					    El tooltip va SOLO en el botón CERRADO (decisión del
					    responsable 2026-09-26: nunca con el desplegable abierto;
					    aparecía sobre el menú abierto cuando el envoltorio cubría
					    todo el span del ancla). */}
					{(() => {
						const triggerButton = (
							<SettingsMenuTrigger
								value={appearance?.fontFamily || DEFAULT_READING_FONT}
								aria-label="Reading font"
								aria-expanded={fontMenuOpen}
								data-testid="font-trigger"
								onClick={openFontMenu}
								className="min-w-20"
							/>
						);
						return fontMenuOpen ? (
							triggerButton
						) : (
							<Hint label="Choose from your installed fonts" side="left">
								{triggerButton}
							</Hint>
						);
					})()}
					{fontMenuOpen && (
						<MenuShell
							preferredSide="down"
							anchorTestid="font-trigger"
							testid="font-menu"
							onClose={() => { setFontMenuOpen(false); return "closed"; }}
							menuClass="flex w-[18rem] flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
						>
							<FontMenuList
								families={localFonts === undefined ? undefined : (localFonts ?? [...CURATED_FALLBACK_FONTS])}
								effectiveFamily={appearance?.fontFamily ?? null}
								onPick={pickFont}
								footer={
									localFonts === undefined
										? undefined
										: localFonts === null
											? enumEmpty
												? "Common families — installed fonts could not be read"
												: "Common families — your installed list needs the desktop app"
											: "Your installed fonts"
								}
							/>
						</MenuShell>
					)}
				</span>
			</SettingsRow>
			<SettingsRow label="Reading font size" hint={`${resolved.proseFontSize}px`} testid="row-prose-size">
				<CommitInput
					type="number"
					value={String(appearance?.proseFontSize ?? "")}
					placeholder="16"
					ariaLabel="prose font size"
					testid="input-prose-size"
					onCommit={(v) => {
						// Vacío = valor de fábrica (responsable, oleada de arreglos): se omite la clave para que el registro
						// QUEDE SIN VALOR y el campo siga vacío (para los números, la ausencia, no null, es
						// el «sin valor»). Number("") es 0, así que el antiguo acotado escribía 12.
						if (v === "") {
							return onSectionChange({ ...appearance, proseFontSize: undefined });
						}
						const n = Number(v);
						if (!Number.isFinite(n)) return false; // entrada errónea: no se escribe, se mantiene el de fábrica
						return onSectionChange({ ...appearance, proseFontSize: Math.min(24, Math.max(12, Math.round(n))) });
					}}
				/>
			</SettingsRow>
			<SettingsRow label="Code ligatures" testid="row-code-ligatures">
				<Toggle
					checked={resolved.codeLigatures}
					label="Code ligatures"
					onChange={(on) => onSectionChange({ ...appearance, codeLigatures: on })}
				/>
			</SettingsRow>
			<SettingsRow label="Session names in serif" testid="row-session-serif">
				<Toggle
					checked={appearance?.sessionNameSerif ?? true}
					label="session names serif"
					onChange={(on) => onSectionChange({ ...appearance, sessionNameSerif: on })}
				/>
			</SettingsRow>
			<SettingsRow label="Heading weight" hint={`${resolved.mdRendering.headingWeight}`} testid="row-heading-weight">
				<CommitInput
					type="number"
					value={String(md?.headingWeight ?? "")}
					placeholder="900"
					ariaLabel="heading weight"
					testid="input-heading-weight"
					onCommit={(v) => {
						// Vacío = valor de fábrica (responsable, oleada de arreglos): Number("") es 0, así que
						// la ausencia es la representación del «sin valor»; el antiguo acotado escribía 100.
						if (v === "") {
							return onSectionChange({ ...appearance, mdRendering: { ...md, headingWeight: undefined } });
						}
						const n = Number(v);
						if (!Number.isFinite(n)) return false;
						return onSectionChange({
							...appearance,
							mdRendering: { ...md, headingWeight: Math.min(900, Math.max(100, Math.round(n))) },
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}

export function GraphSection({
	graph,
	onSectionChange,
}: {
	graph: GraphSettings | undefined;
	onSectionChange: (next: GraphSettings) => boolean | Promise<boolean>;
}) {
	// Simplificación de la oleada 7 (decisión del responsable 2026-09-23): la sección es el INTERRUPTOR
	// GENERAL; los peldaños de embedding/clustering/etiquetado ya no existen; el clustering
	// es la partición gratuita por sesión de nacimiento derivada en lectura, y las etiquetas SON los nombres
	// de sesión. El presupuesto de fragmento (2026-10-02) se le unió como segundo y único otro
	// control de la sección: denomina el anillo de cobertura Y controla el
	// disparador de extracción automática (asentar un turno ≥ presupuesto lanza la ejecución).
	//
	// Se resuelve con el MISMO resolvedor del núcleo que usan los ajustes efectivos
	// del servidor (una única fuente de verdad, el arreglo de la alternativa de 4096 del 2026-10-02):
	// la pista y el texto provisional indican exactamente el número que espera el
	// disparador; nunca un segundo valor por defecto hecho a mano.
	const resolved = resolveSettings(graph === undefined ? null : { version: 1, graph }).graph;
	return (
		<>
			{/* EXTRACCIÓN (renombrada, responsable 2026-10-06): este interruptor es el
			    canal de DATOS: el proceso, el auditor, las herramientas de grafo del
			    sondeador. Nació con la etiqueta "Graph", y esa etiqueta mentía desde
			    que llegó el interruptor de renderizado de abajo: desactivado ≠ sin
			    grafo; desactivado = el grafo deja de crecer. El testid conserva la
			    forma del nombre antiguo (row-enabled) para que esto siga siendo un
			    solo renombrado, no una nueva fijación de las pruebas. */}
			<SettingsRow label="Extraction" hint="Off = the graph stops growing" testid="graph-row-enabled">
				<Toggle
					checked={graph?.enabled ?? true}
					label="extraction enabled"
					onChange={(on) =>
						// Componer, nunca sustituir entero (el PUT de la sección sí lo hace, pero la
					// fila no debe perder su campo hermano; se arregló al llegar la fila del
					// presupuesto: el antiguo { enabled: on } borraba un presupuesto guardado).
						onSectionChange({ ...graph, enabled: on })
					}
				/>
			</SettingsRow>
			{/* RENDERIZADO DEL GRAFO (responsable, 2026-10-06; la ronda de controles
			    del grafo de la versión): solo de presentación. Desactivado = el inicio
			    muestra la vista de cadenas en vez del lienzo. Los registros, el
			    proceso, todo lo de datos sigue funcionando: eso es el interruptor de
			    extracción de arriba. */}
			<SettingsRow label="Graph rendering" hint="Off = home shows the chains view" testid="graph-row-rendering">
				<Toggle
					checked={graph?.rendering ?? true}
					label="graph rendering enabled"
					onChange={(on) => onSectionChange({ ...graph, rendering: on })}
				/>
			</SettingsRow>
			<SettingsRow
				label="Extraction chunk budget"
				hint={`${resolved.extractionChunkTokens} tok`}
				testid="graph-row-chunk-tokens"
			>
				<CommitInput
					type="number"
					value={String(graph?.extractionChunkTokens ?? "")}
					placeholder={String(resolved.extractionChunkTokens)}
					ariaLabel="extraction chunk budget"
					testid="input-chunk-tokens"
					onCommit={(v) => {
						// Vacío = valor de fábrica (la disciplina de la oleada de arreglos): para los números, la ausencia es
						// el «sin valor»; Number("") es 0, así que acotar escribiría
						// el suelo en vez de dejarlo sin valor.
						if (v === "") {
							return onSectionChange({ ...graph, extractionChunkTokens: undefined });
						}
						const n = Number(v);
						if (!Number.isFinite(n) || n <= 0) return false; // entrada errónea: no se escribe
						// Refleja exactamente el saneado del servidor: solo suelo (protección
						// de costes), sin techo; un presupuesto grande es decisión del usuario.
						return onSectionChange({
							...graph,
							extractionChunkTokens: Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.round(n)),
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}