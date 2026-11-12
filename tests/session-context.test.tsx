import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RenameRow, SessionRow } from "../components/sidebar.tsx";
import { DeleteSessionBody, DeleteSessionDialog, TRACES_COPY } from "../components/delete-session-dialog.tsx";
import type { ChatListItem } from "../src/core/index.ts";

/**
 * Oleada 6, fragmento A: las fronteras de borrado + menú contextual en la barra
 * lateral: la frontera del clic derecho de SessionRow (ahora siempre lleva el
 * testid de la fila), el RenameRow en línea (misma geometría, entra con todo
 * seleccionado) y el texto en lenguaje llano del diálogo de borrado con dos
 * opciones (el diseño cerrado: las dos opciones dicen su alcance, la que toca
 * el grafo lo dice).
 */

const chat: ChatListItem = {
	id: "c1",
	title: "Wave mechanics",
	updatedAt: new Date().toISOString(),
	busy: false,
} as unknown as ChatListItem;

describe("SessionRow — the right-click seam", () => {
	it("rows carry the session-row testid (context menu anchors to it)", () => {
		const html = renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} />);
		assert.ok(html.includes('data-testid="session-row"'));
	});
});

describe("RenameRow — the inline rename surface", () => {
	it("renders the draft input with the current title, keeping the meta line", () => {
		const html = renderToStaticMarkup(
			<RenameRow chat={chat} onCommit={() => {}} onCancel={() => {}} />,
		);
		assert.ok(html.includes('data-testid="session-rename-input"'));
		// el borrador controlado empieza con el título actual
		assert.ok(html.includes(`value="${chat.title}"`));
		// la línea de metadatos se mantiene (la fila nunca cambia de altura mientras se edita)
		assert.ok(html.includes("session-rename-row"));
		// (responsable, ronda de pulido) NADA SE MUEVE: sin espaciador de estado, sin borde
		// ni relleno en el input: el texto del borrador queda en la x del título de la fila en reposo,
		// y el input es la ÚNICA pista de edición que no desplaza nada (subrayado).
		assert.ok(!html.includes("w-3.5 shrink-0"), "no always-on spacer (idle rows have none)");
		const input = html.split('data-testid="session-rename-input"')[1]?.split("/>")[0] ?? "";
		assert.ok(input.includes("px-0"), "input carries no left padding");
		assert.ok(input.includes("border-b"), "the underline is the editing cue");
		assert.ok(!input.includes("bg-background"), "no filled field box — text stays put");
	});
});

describe("DeleteSessionDialog — the node-dialog shape (owner flow rework 2026-09-24; portals no-op in SSR; pin the pure body)", () => {
	it("closed (chat=null) renders nothing", () => {
		const html = renderToStaticMarkup(
			<DeleteSessionDialog chat={null} onClose={() => {}} onDeleted={() => {}} />,
		);
		assert.equal(html, "");
	});

	it("red mono title 'Delete session?' (abort-turn look), the session name below in mono at normal size, no code-block chrome", () => {
		const html = renderToStaticMarkup(
			<DeleteSessionBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={false}
				busy={false}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		assert.match(html, /Delete session\?/);
		const title = html.match(/<h2[^>]*>/)?.[0] ?? "";
		assert.match(title, /text-sm font-semibold text-destructive/); // rojo, con el aspecto del aborto de turno (responsable, 2026-10-13)
		assert.ok(!title.includes("font-title"), "no serif display title");
		// el nombre: mono, tamaño text-sm normal (responsable, 2026-10-13), SIN el adorno bg-muted de bloque de código
		const name = html.match(/data-testid="session-name-code"[^>]*>/)?.[0] ?? "";
		assert.match(name, /font-mono text-sm/);
		assert.ok(!name.includes("bg-muted"), "no code-block chrome");
		assert.match(html, /data-testid="session-name-code"[^>]*>Orbital mechanics</);
	});

	it("one unchecked-by-default checkbox for the graph traces — the graph-touching consequence says so", () => {
		const html = renderToStaticMarkup(
			<DeleteSessionBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={false}
				busy={false}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		// sin marcar por defecto (conservar el grafo): el SSR de React omite el
		// atributo cuando es false, así que se fija su AUSENCIA en el input renderizado
		assert.ok(!/"checked"/.test(html), "unchecked by default");
		// consecuencias en lenguaje llano en el cuerpo de la casilla
		assert.ok(html.includes(TRACES_COPY.title));
		assert.ok(html.includes("leave the graph too"));
		assert.ok(html.includes("survive"));
		// el antiguo diseño de dos botones ha desaparecido
		assert.ok(!html.includes("delete-option-preserve"));
		assert.ok(!html.includes("delete-option-nodes"));
	});

	it("bottom row matches the node dialog: quiet Cancel + destructive-red Delete", () => {
		const html = renderToStaticMarkup(
			<DeleteSessionBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={true}
				busy={true}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		assert.match(html, /data-testid="delete-cancel"[^>]*>Cancel</);
		const del = html.match(/data-testid="delete-confirm"[^>]*>/)?.[0] ?? "";
		assert.match(del, /border-destructive\/50/);
		assert.match(html, /data-testid="delete-confirm"[^>]*>Deleting…</); // etiqueta de ocupado en Delete
		// la casilla sobrevive a un render ocupado (desactivada, no desmontada)
		assert.match(html, /data-testid="delete-traces-checkbox"[^>]*disabled=""/);
	});
});