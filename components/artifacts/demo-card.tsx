"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Toggle } from "@/components/settings/controls";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { ChatActionsContext } from "@/components/chat";
import { downloadFile, slugFilename } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import type { ArtifactPartProps, DemoResult } from "@/src/core";

/**
 * Tarjeta del artefacto de demo (W6): mientras la parte está en
 * input-available, una tarjeta de actividad de la tarea (el feed de tareas de
 * la vista de chat; el idioma de job-card); cuando está en output-available,
 * la demo se ejecuta en un iframe AISLADO (sandbox="allow-scripts", sin
 * allow-same-origin → sin acceso al almacenamiento, las cookies ni el DOM de
 * la app).
 *
 * El script puente (contracts.ts "Demo iframe bridge") lo inyecta
 * automáticamente buildDemoSrcDoc en cada demo; nunca es tarea del modelo:
 * ResizeObserver → postMessage {type:"demo-resize",height} (el padre
 * dimensiona el iframe) y window.onerror → {type:"demo-error",message}
 * (etiqueta de error en la tarjeta, con un botón "Send to teacher" que
 * devuelve el error a la lección: el bucle de arreglo).
 *
 * El manejo de mensajes del puente es una función pura
 * (reduceDemoBridgeState), así que las pruebas lo cubren sin DOM.
 */

// ─── inyección del puente + manejo de mensajes (puro, comprobable) ──────────

export const DEMO_BRIDGE_SCRIPT = `<script>(function(){
var send=function(m){try{parent.postMessage(m,"*")}catch(e){}};
var post=function(){
var b=document.body;
if(!b){send({type:"demo-resize",height:document.documentElement.scrollHeight});return}
var h=Math.max(b.scrollHeight,b.getBoundingClientRect().height);
var cs=getComputedStyle(b);
h+=(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
send({type:"demo-resize",height:Math.ceil(h)})
};
if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.documentElement)}
window.addEventListener("resize",post);
window.addEventListener("load",post);
window.addEventListener("error",function(e){send({type:"demo-error",message:e.message||String(e)})});
setTimeout(post,50);
setTimeout(post,400);
})();</script>`;

/** Inyecta el puente antes de </body> (o al final de un documento sin body). */
export function buildDemoSrcDoc(html: string): string {
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${DEMO_BRIDGE_SCRIPT}</body>`);
	return `${html}${DEMO_BRIDGE_SCRIPT}`;
}

export interface DemoBridgeState {
	height: number | null;
	error: string | null;
}

export const INITIAL_DEMO_BRIDGE_STATE: DemoBridgeState = { height: null, error: null };

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2400;

/** Reductor puro sobre los datos de postMessage entrantes (DemoBridgeMessage de contracts.ts). */
export function reduceDemoBridgeState(state: DemoBridgeState, data: unknown): DemoBridgeState {
	if (typeof data !== "object" || data === null) return state;
	const message = data as { type?: unknown; height?: unknown; message?: unknown };
	if (message.type === "demo-resize") {
		if (typeof message.height !== "number" || !Number.isFinite(message.height) || message.height <= 0) return state;
		const height = Math.min(Math.max(Math.round(message.height), MIN_HEIGHT), MAX_HEIGHT);
		return height === state.height ? state : { ...state, height };
	}
	if (message.type === "demo-error") {
		const text = typeof message.message === "string" && message.message.trim() ? message.message : "unknown error";
		return text === state.error ? state : { ...state, error: text };
	}
	return state;
}

// ─── la tarjeta de demo ─────────────────────────────────────────────────────

/** El cuadro de la llamada a la herramienta de demo: la salida de la parte es
 * el acuse del despacho; el cuadro es la DispatchCard (estado en directo a
 * través del feed de tareas de la vista de chat). La demo en sí se renderiza
 * a partir del mensaje de reorientación mediante DemoOutputCard. */
export function DemoCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="demo" />;
}

/** El artefacto de demo; se exporta porque la tarjeta de reorientación
 * renderiza el resultado entregado. `messageId` + `initialInverted` llevan el
 * interruptor de inversión PERSISTIDO (details.ui.inverted mediante la ruta
 * artifact-ui, responsable 2026-10-07). */
export function DemoOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as DemoResult | undefined;
	if (!result || typeof result.html !== "string" || typeof result.title !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Demo completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.html.length === 0;
	if (failed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card-failed">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Interactive demo
					<span className="rounded bg-error/15 px-1.5 py-0.5 text-error">failed</span>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{result.notes ?? "The demo could not be built."}</p>
			</div>
		);
	}
	return (
		<DemoFrame title={result.title} html={result.html} messageId={messageId} initialInverted={initialInverted} />
	);
}

function DemoFrame({
	title,
	html,
	messageId,
	initialInverted = false,
}: {
	title: string;
	html: string;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const actions = useContext(ChatActionsContext);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [state, setState] = useState<DemoBridgeState>(INITIAL_DEMO_BRIDGE_STATE);
	// Inversión de brillo (responsable, 2026-10-07): el estado del interruptor PERSISTE en
	// el registro de la reorientación (details.ui.inverted); se siembra aquí y se escribe a través
	// de la ruta silenciosa artifact-ui al conmutar. Sin página de chat (pruebas,
	// vistas previas) el conmutador se queda solo en local. El filtro va en el elemento
	// iframe, que lleva el fondo blanco de la tarjeta, así que un único filtro voltea
	// página + contenido a la vez mientras hue-rotate(180deg) deshace el giro de tono
	// de invert.
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	const srcDoc = useMemo(() => buildDemoSrcDoc(html), [html]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Solo mensajes del iframe de ESTA demo (el sandbox le da un origen
			// opaco; la referencia a la ventana sigue coincidiendo).
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
			setState((prev) => reduceDemoBridgeState(prev, event.data));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card">
			{/* Cabecera del pie (responsable, 2026-10-07): etiqueta del tipo + título con el
			   tamaño/espaciado de la etiqueta (título sin mayúsculas, color de primer plano):
			   la gramática de la tarjeta de figura más un nombre. Interruptor + descarga a la
			   derecha del todo. */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						interactive demo
					</span>
					<span className="truncate text-xs font-medium tracking-wide text-foreground">{title}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Toggle
						checked={inverted}
						onChange={toggleInverted}
						label="Invert demo brightness"
						title="Invert colors"
						discIcon={<InvertDiscIcon className="size-3" />}
					/>
					<button
						type="button"
						aria-label="Download demo as HTML"
						title="Download as HTML"
						onClick={() => downloadFile(`${slugFilename(title)}.html`, html, "text/html")}
						data-testid="demo-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
				</div>
			</div>
			{state.error && (
				<DemoErrorChip
					title={title}
					message={state.error}
					onSend={actions ? () => actions.sendText(`The demo "${title}" threw an error: ${state.error}`) : undefined}
				/>
			)}
			<iframe
				ref={iframeRef}
				title={title}
				// SOLO allow-scripts, sin allow-same-origin: la demo puede ejecutar código
				// pero nunca tocar el almacenamiento, las cookies ni el DOM de la app.
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				// scrolling DESACTIVADO (responsable, 2026-10-07): el puente ajusta el tamaño del
				// iframe a su contenido, así que una barra de desplazamiento interna solo puede aparecer
				// antes de que llegue el primer redimensionado, y un iframe desplazable ATRAPA
				// la rueda (el scroll de la sesión se atasca sobre la demo). Con el scrolling
				// desactivado, la rueda se encadena directamente a la sesión.
				scrolling="no"
				className="mt-2 w-full rounded-lg border bg-white"
				// content-box: el puente informa de la altura del CONTENIDO; con el
				// border-box del preflight, el borde de 2px se comería parte de ella y recortaría
				// la parte inferior de la demo (hallazgo de una prueba de humo, 2026-10-07).
				style={{
					height: state.height ?? 360,
					boxSizing: "content-box",
					filter: inverted ? "invert(1) hue-rotate(180deg)" : undefined,
				}}
				data-testid="demo-iframe"
			/>
		</div>
	);
}

export function DemoErrorChip({
	title,
	message,
	onSend,
}: {
	title: string;
	message: string;
	onSend?: () => void;
}) {
	return (
		<div
			className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-error/10 px-3 py-2 text-sm text-error"
			data-testid="demo-error-chip"
		>
			<span className="font-medium">This demo threw an error</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs" title={message}>
				{message}
			</span>
			{onSend && (
				<button
					type="button"
					onClick={onSend}
					className="rounded-md border border-error/40 px-2 py-1 text-xs font-medium hover:bg-error/15"
					data-testid="demo-error-send"
				>
					Send to teacher
				</button>
			)}
		</div>
	);
}
