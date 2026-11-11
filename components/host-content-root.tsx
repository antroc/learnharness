"use client";

import { createContext, useLayoutEffect, useState, type ReactNode } from "react";

/** La columna de contenido del host, sin la barra lateral. Los portales conservan los contextos de la app. */
export const HostContentRootContext = createContext<HTMLElement | null>(null);

/** Instancia privada de la ruta del host, compartida con los widgets que van en portales fuera de los árboles de página.
 * La limpieza hace caducar una apertura aunque Next conserve su origen en Activity. */
export interface HostRouteLifetime { pathname: string; signal: AbortSignal }
export const HostRouteLifetimeContext = createContext<HostRouteLifetime | null>(null);

export function HostRouteLifetimeProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
	const [current, setCurrent] = useState<HostRouteLifetime | null>(null);
	useLayoutEffect(() => {
		const lifetime = new AbortController();
		setCurrent({ pathname, signal: lifetime.signal });
		return () => lifetime.abort();
	}, [pathname]);
	return <HostRouteLifetimeContext.Provider value={current?.pathname === pathname ? current : null}>{children}</HostRouteLifetimeContext.Provider>;
}
