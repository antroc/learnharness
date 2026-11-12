import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import { connection } from "next/server";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { PluginsProvider } from "@/components/plugins";
import { readThemeBoot } from "@/src/server";

// Interfaz = JetBrains Mono, prosa de enseñanza = Source Sans 3, títulos = CMU
// Serif (la @font-face empaquetada lh-cmu de globals.css; sin CDN).
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// El tema se renderiza en el servidor —su clase Y sus variables de color—,
	// así que ningún primer fotograma muestra el tema equivocado. connection(): el
	// registro y los ficheros de tema son estado de disco de cada máquina; sin ello, una
	// ruta prerenderizada (settings) consolidaría el registro de la máquina de COMPILACIÓN.
	await connection();
	const { appearance, theme, vars } = readThemeBoot();
	return (
		<html
			lang="en"
			className={`${theme.mode} ${ui.variable} ${prose.variable}`}
			style={vars as React.CSSProperties}
			suppressHydrationWarning
		>
			<body className="min-h-dvh antialiased">
			{/* El canal de notificaciones va POR FUERA de todo: la barra lateral, el dock
				 y las páginas se suscriben a medida que se retiran los sondeos (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<PluginsProvider>
					<AppearanceProvider initialAppearance={appearance} initialTheme={theme}>
						<SidebarProvider>
							<ActivityProvider>
								<AppShell>{children}</AppShell>
							</ActivityProvider>
						</SidebarProvider>
					</AppearanceProvider>
				</PluginsProvider>
			</ServerEventsProvider>
			{/* Aviso de actualización automática (Oleada C): tarjeta fija, envíos solo de Electron. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
