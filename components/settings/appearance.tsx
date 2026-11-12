"use client";
/**
 * LA APLICACIÓN DE LA APARIENCIA (oleada de ajustes ligeros, 2026-09-19;
 * oleada de temas, 2026-11-04): la sección appearance del registro de
 * ajustes —el tema activo, las sustituciones de color, los controles
 * tipográficos— aplicada como variables CSS EN TIEMPO DE EJECUCIÓN sobre
 * <html>, más la clase `dark`/`light` que declara el tema.
 *
 * Por qué variables y no cambios de className: todas las fronteras que tocan
 * los ajustes se construyeron pensando primero en tokens (--background,
 * --font-prose, --lh-ink-strong, …), así que aplicar es un setProperty y no
 * se vuelve a renderizar nada. El primer pintado es cosa del layout:
 * app/layout.tsx renderiza en el servidor la clase y las variables de color
 * del tema sobre <html> a partir del registro, así que ningún fotograma
 * muestra nunca el tema equivocado; este provider se encarga de todos los
 * cambios en vivo a partir de ahí.
 *
 * El provider se monta a nivel del LAYOUT RAÍZ (como ActivityProvider):
 * todas las páginas recogen la apariencia al cargar. La página de ajustes
 * escribe una sección, pasa aquí la nueva apariencia y las variables cambian
 * al instante.
 *
 * (El atajo de teclado para abrir los ajustes vive en
 * components/keyboard-shortcuts.tsx con las demás navegaciones: mod+, abre
 * /settings desde cualquier sitio.)
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	BUILTIN_THEMES,
	effectiveColors,
	FACTORY_SETTINGS,
	resolveTheme,
	themeVars,
	type AppearanceSettings,
	type RenderedMode,
	type Theme,
	type ThemeColors,
} from "@/src/core";

/** La vista de apariencia resuelta y totalmente concreta (delta + valores de fábrica fusionados). */
export function resolveAppearance(delta: AppearanceSettings | undefined) {
	const f = FACTORY_SETTINGS.appearance;
	return {
		theme: delta?.theme ?? f.theme,
		background: delta?.background ?? f.background,
		colors: delta?.colors ?? f.colors,
		fontFamily: delta?.fontFamily ?? f.fontFamily,
		proseFontSize: delta?.proseFontSize ?? f.proseFontSize,
		codeLigatures: delta?.codeLigatures ?? f.codeLigatures,
		sessionNameSerif: delta?.sessionNameSerif ?? f.sessionNameSerif,
		mdRendering: {
			headingWeight: delta?.mdRendering?.headingWeight ?? f.mdRendering.headingWeight,
			boldColor: delta?.mdRendering?.boldColor ?? f.mdRendering.boldColor,
			italicColor: delta?.mdRendering?.italicColor ?? f.mdRendering.italicColor,
		},
	};
}

/** Fuentes de lectura que trae la propia app (next/font en app/layout.tsx),
 * por nombre de familia → la variable CSS que lleva el estilo empaquetado.
 * Funcionan sin estar instaladas: una copia instalada gana por nombre y, si
 * no, la empaquetada la sustituye. Exportado para el menú de fuentes y las
 * pruebas. */
export const BUNDLED_READING_FONTS: Readonly<Record<string, string>> = {
	"JetBrains Mono": "var(--font-jetbrains)",
};

/** EL mapeo: apariencia resuelta + tema activo → las variables CSS que se
 * fijan sobre <html>. Colores: el tema con todas las sustituciones aplicadas
 * (effectiveColors de core/themes.ts → themeVars). Controles tipográficos:
 * las entradas ausentes dejan el valor de la hoja de estilos. Puro;
 * exportado para las pruebas. */
export function appearanceVars(
	a: ReturnType<typeof resolveAppearance>,
	theme: Theme,
): Record<string, string> {
	const vars: Record<string, string> = themeVars(effectiveColors(theme, a), theme.mode);
	if (a.fontFamily !== null) {
		const bundled = BUNDLED_READING_FONTS[a.fontFamily];
		vars["--font-prose"] = `"${a.fontFamily}", ${bundled ? `${bundled}, ` : ""}var(--font-sans3), ui-sans-serif, system-ui, sans-serif`;
	}
	// La ÚNICA variable documentada de tamaño de lectura (ronda tipográfica 4): la prosa,
	// las entradas y los títulos de sesión la leen, así que un setProperty los mueve.
	vars["--lh-prose-size"] = `${a.proseFontSize}px`;
	// Las superficies de código optan por este token; nunca cambia la prosa ni la forma de la UI.
	// "normal" permite el comportamiento de la fuente en vez de forzar la unión de glifos.
	vars["--lh-code-ligatures"] = a.codeLigatures ? "normal" : "none";
	// Nombres de sesión: CMU Serif por defecto; el conmutador cambia la fuente del título
	// a la familia de la prosa; cubre los títulos de chat.tsx + new-session.tsx sin
	// editar ningún componente (usan la utilidad .font-title).
	if (!a.sessionNameSerif) vars["--font-title"] = "var(--font-prose)";
	// Peso de los encabezados markdown (las tintas de énfasis van con los colores del tema).
	vars["--lh-heading-weight"] = String(a.mdRendering.headingWeight);
	return vars;
}

/** Puro: los nombres aplicados antes que FALTAN en el siguiente conjunto de
 * variables; a estos se les hace removeProperty para que vuelva el valor de
 * la hoja de estilos de fábrica. (Reproducción del responsable, oleada de
 * arreglos: los restablecimientos y las vueltas atrás del conmutador nunca
 * se revertían porque la aplicación solo FIJABA propiedades; faltaba la
 * mitad de la eliminación.) Exportado para las pruebas. */
export function staleVarNames(
	prevNames: readonly string[],
	nextVars: Record<string, string>,
): string[] {
	return prevNames.filter((n) => !(n in nextVars));
}

interface AppearanceContextValue {
	/** Apariencia resuelta (el delta del registro sobre los valores de fábrica). */
	appearance: ReturnType<typeof resolveAppearance>;
	/** El delta en bruto del registro: sobre lo que compone una escritura de sección. */
	delta: AppearanceSettings | undefined;
	/** La variante del tema activo (la clase de <html>). */
	resolvedMode: RenderedMode;
	/** El tema activo (Default cuando el id del registro ya no existe). */
	activeTheme: Theme;
	/** El tema activo con todas las sustituciones aplicadas: lo que está en pantalla. */
	colors: ThemeColors;
	/** Los predefinidos y después los personalizados importados. */
	themes: Theme[];
	/** Vuelve a leer el catálogo tras una importación o una eliminación. */
	refreshThemes: () => Promise<void>;
	/** Lo llama la página de ajustes tras un PUT de sección con éxito. */
	onAppearanceChange: (delta: AppearanceSettings | undefined) => void;
}

const DEFAULT_CONTEXT_THEME = resolveTheme(undefined);

const AppearanceContext = createContext<AppearanceContextValue>({
	appearance: resolveAppearance(undefined),
	delta: undefined,
	resolvedMode: DEFAULT_CONTEXT_THEME.mode,
	activeTheme: DEFAULT_CONTEXT_THEME,
	colors: DEFAULT_CONTEXT_THEME.colors,
	themes: [...BUILTIN_THEMES],
	refreshThemes: async () => {},
	onAppearanceChange: () => {},
});

export function useAppearance() {
	return useContext(AppearanceContext);
}

export function AppearanceProvider({
	children,
	initialAppearance,
	initialTheme,
}: {
	children: React.ReactNode;
	/** El delta de apariencia del registro, leído en el servidor por el layout. */
	initialAppearance: AppearanceSettings | undefined;
	/** El tema activo que resolvió el layout (incluido uno personalizado). */
	initialTheme: Theme;
}) {
	const [delta, setDelta] = useState<AppearanceSettings | undefined>(initialAppearance);
	const [themes, setThemes] = useState<Theme[]>(() =>
		initialTheme.builtin ? [...BUILTIN_THEMES] : [...BUILTIN_THEMES, initialTheme],
	);
	const appliedRef = useRef<string>("");
	const appearance = useMemo(() => resolveAppearance(delta), [delta]);
	const activeTheme = useMemo(
		() => resolveTheme(appearance.theme, themes.filter((t) => !t.builtin)),
		[appearance.theme, themes],
	);
	const mode = activeTheme.mode;
	const colors = useMemo(() => effectiveColors(activeTheme, appearance), [activeTheme, appearance]);

	// El modo vive en <html> como clase, para todas las reglas y variantes `.dark`/`.light`.
	// Un efecto de LAYOUT (como el de las variables de abajo): los efectos
	// pasivos de los descendientes se ejecutan después, así que todo lo que lee tokens calculados
	// (el lienzo del grafo) ve el modo nuevo, y el cambio llega antes del pintado.
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", mode === "dark");
		root.classList.toggle("light", mode === "light");
	}, [mode, initialTheme.mode]);

	// Las variables se aplican en cada cambio; convertidas en cadena como señal de cambio.
	const vars = useMemo(() => appearanceVars(appearance, activeTheme), [appearance, activeTheme]);
	// Un layout del servidor refrescado puede reescribir la clase/estilo de <html> mientras el
	// provider montado conserva un guardado local más reciente. Se vuelve a aplicar ese estado en vivo
	// cuando cambia la paleta renderizada en el servidor, aunque sea dentro del mismo modo.
	const serverKey = JSON.stringify(themeVars(effectiveColors(initialTheme, initialAppearance), initialTheme.mode));
	const key = useMemo(() => JSON.stringify([vars, serverKey]), [vars, serverKey]);
	// La ELIMINACIÓN es la mitad del trabajo (reproducción del responsable, oleada de arreglos): una escritura
	// posterior que OMITE una variable (fuente vacía = de fábrica, conmutador serif reactivado) debe borrar
	// el valor en línea fijado antes o el obsoleto gana para siempre. Se registran todos los
	// nombres que ha fijado alguna vez este efecto; los que faltan en el nuevo
	// conjunto se eliminan para que vuelva el valor de la hoja de estilos.
	const appliedNamesRef = useRef<Set<string>>(new Set());
	useLayoutEffect(() => {
		if (appliedRef.current === key) return;
		appliedRef.current = key;
		const root = document.documentElement;
		for (const name of staleVarNames([...appliedNamesRef.current], vars)) {
			root.style.removeProperty(name);
			appliedNamesRef.current.delete(name);
		}
		for (const [name, value] of Object.entries(vars)) {
			root.style.setProperty(name, value);
			appliedNamesRef.current.add(name);
		}
	}, [key, vars]);

	// El adorno nativo del armazón de escritorio (fondo de ventana, superposición de controles
	// de Windows/Linux) sigue al tema; no existe en un navegador.
	const background = colors.background;
	useEffect(() => {
		window.lh?.setAppearance?.({ mode, background });
	}, [mode, background]);

	const refreshThemes = useCallback(async () => {
		try {
			const res = await fetch("/api/themes");
			if (!res.ok) return;
			const body = (await res.json()) as { themes?: Theme[] };
			if (Array.isArray(body.themes)) setThemes(body.themes);
		} catch {
			/* los predefinidos se quedan; no merece la pena un fallo */
		}
	}, []);

	// Una lectura del catálogo por cada carga de la app (los personalizados importados).
	useEffect(() => {
		void refreshThemes();
	}, [refreshThemes]);

	const onAppearanceChange = useCallback((next: AppearanceSettings | undefined) => {
		// No hay ningún GET de ajustes al arrancar que compita con este guardado: el layout
		// siembra el registro de forma síncrona en el estado inicial del provider.
		setDelta(next);
	}, []);

	const value = useMemo(
		() => ({ appearance, delta, resolvedMode: mode, activeTheme, colors, themes, refreshThemes, onAppearanceChange }),
		[appearance, delta, mode, activeTheme, colors, themes, refreshThemes, onAppearanceChange],
	);
	return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
