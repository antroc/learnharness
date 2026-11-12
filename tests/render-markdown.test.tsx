/**
 * Pruebas de render de la capa de presentación (W3): el contrato de delimitadores
 * matemáticos \(...\)/\[...\], los saltos de línea con un solo salto y el render
 * de mermaid.
 *
 * La misma costumbre que render-cards.test.tsx: HTML estático mediante
 * react-dom/server, sin DOM. Nota sobre tsx: tsx usa la transformación JSX
 * CLÁSICA, así que `React` debe ser un global resoluble; el parche de abajo lo proporciona.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageResponse } from "../components/ai-elements/message.tsx";
import { MermaidError } from "../components/mermaid-error.tsx";
import { transformMathDelimiters, healOverescapedCommands } from "../src/core/math-delims.ts";

/** Renderiza mediante MessageResponse en modo estático (sin artefactos de streaming/remend). */
function render(md: string): string {
	return renderToStaticMarkup(<MessageResponse mode="static">{md}</MessageResponse>);
}

describe("math delimiter transform (pure unit)", () => {
	it("converts inline \\(...\\) to the two-dollar inline form", () => {
		assert.equal(
			transformMathDelimiters("a \\(x^2\\) b"),
			"a $$x^2$$ b",
		);
	});

	it("converts block-positioned \\[...\\] to flow math in place", () => {
		assert.equal(
			transformMathDelimiters("text\n\n\\[\n\\int x\n\\]\n\nmore"),
			"text\n\n$$\n\\int x\n$$\n\nmore",
		);
	});

	it("pads mid-paragraph \\[...\\) with blank lines (forces a clean block)", () => {
		assert.equal(
			transformMathDelimiters("mid \\[x^2\\] para"),
			"mid \n\n$$\nx^2\n$$\n\n para",
		);
	});

	it("degrades indented display math (list items) to the inline form", () => {
		// Un bloque de flujo $$ sangrado se analiza a medias dentro de las continuaciones
		// de lista; en línea, las matemáticas se quedan dentro del elemento.
		assert.equal(
			transformMathDelimiters("- item\n  \\[\n  x^2\n  \\]\n- next"),
			"- item\n  $$x^2$$\n- next",
		);
	});

	it("leaves currency untouched", () => {
		const md = "It costs $5 and $10 more. $$big$$ sums too.";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("leaves escaped delimiters untouched (\\\\( is a literal backslash)", () => {
		assert.equal(
			transformMathDelimiters("escaped \\\\( and \\\\[ stay"),
			"escaped \\\\( and \\\\[ stay",
		);
	});

	it("does not transform inside fenced code blocks", () => {
		const md = "```js\n\\(x\\) and \\[y\\]\n```";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("does not transform inside inline code spans", () => {
		const md = "run `\\(x\\)` locally";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("leaves unbalanced delimiters untouched (mid-stream chunks)", () => {
		assert.equal(
			transformMathDelimiters("partial \\[ mid-stream"),
			"partial \\[ mid-stream",
		);
		assert.equal(
			transformMathDelimiters("open \\( no close"),
			"open \\( no close",
		);
	});

	it("still converts a later balanced pair when an earlier one is unbalanced", () => {
		assert.equal(
			transformMathDelimiters("\\[ partial\n\nbut \\(ok\\)"),
			"\\[ partial\n\nbut $$ok$$",
		);
	});
});

describe("render — standard dollar math + legacy compatibility (streamdown + KaTeX)", () => {
	it("renders \\(...\\) as inline KaTeX", () => {
		const html = render("The map \\(f(x) = x^2\\) is smooth.");
		assert.ok(html.includes("katex"), `inline math should render, got: ${html.slice(0, 300)}`);
		assert.ok(!html.includes("katex-display"), "parens math is inline, never display");
	});

	it("renders \\[x^2\\] as display math", () => {
		const html = render("Intro:\n\n\\[\n\\int_0^1 x^2\\,dx = \\tfrac{1}{3}\n\\]\n\nOutro.");
		assert.ok(html.includes("katex-display"), "bracket math on its own lines is display math");
	});

	it("renders mid-paragraph \\[...\\] as display math without leaking dollars", () => {
		const html = render("before \\[x^2\\] after");
		assert.ok(html.includes("katex-display"), "mid-paragraph display math is hoisted to a block");
		assert.ok(!html.includes("$$"), "no literal $$ leaks");
		assert.ok(!html.includes("katex-error"), "no KaTeX parse errors");
	});

	it("renders display math inside list items without eating the list", () => {
		const html = render("- item one\n  \\[x^2\\]\n- item two");
		assert.ok(html.includes("katex"), "indented display math degrades to inline KaTeX");
		assert.ok(html.includes("item two"), "the following list item survives");
		const items = html.match(/data-streamdown="list-item"/g) ?? [];
		assert.equal(items.length, 2, "both list items render");
	});

	it("keeps escaped currency literal", () => {
		const html = render("It costs \\$5 and \\$10 more.");
		assert.ok(!html.includes("katex"), "escaped currency must not parse as math");
		assert.match(html, /\$5 and \$10/);
	});

	it("renders standard $...$ math inline", () => {
		const html = render("The map $f(x) = x^2$ is smooth.");
		assert.ok(html.includes("katex"), "single-dollar math renders");
		assert.ok(!html.includes("katex-display"), "single-dollar math is inline");
	});

	it("renders standard dollar commands and fenced display math", () => {
		const html = render("The symbol $\\Omega$ appears here.\n\n$$\nS = k_B \\ln \\Omega\n$$");
		assert.ok(html.includes("katex-display"), "standalone dollar fences render display math");
		assert.ok(html.includes("Ω"), "the command renders as the Greek symbol");
		assert.ok(!html.includes("katex-error"), "both formulas are valid");
	});

	it("keeps dollar examples in inline code and code fences literal", () => {
		const html = render("Use `$x$` here.\n\n```text\n$$\ny = x^2\n$$\n```");
		assert.ok(!html.includes("katex"), "code examples are not math");
		assert.ok(html.includes("$x$"), "inline code retains its delimiters");
	});

	it("keeps \\(...\\) inside a code fence literal", () => {
		const html = render("```\n\\(x^2\\) stays literal\n```");
		assert.ok(!html.includes("katex"), "code fences are never math");
		assert.ok(html.includes("code-block"), "it renders as a code block");
	});

	it("leaves an unbalanced \\[ mid-stream untouched", () => {
		const html = render("partial \\[ mid-stream");
		assert.ok(!html.includes("katex") && !html.includes("$$"), "no math, no dollars");
	});

	it("renders math inside headings and keeps the heading", () => {
		const html = render("## The map \\(f(x)\\)");
		assert.ok(html.includes("<h2"), "heading survives");
		assert.ok(html.includes("katex"), "heading math renders");
	});
});

describe("render — line breaks (remark-breaks)", () => {
	it("renders a single newline as a visible line break", () => {
		const html = render("line one\nline two");
		assert.match(html, /<br\s*\/?>/, "single \\n becomes a hard break");
	});

	it("keeps single newlines inside code blocks as code lines (no <br>)", () => {
		const html = render("```js\nline one\nline two\n```");
		assert.ok(html.includes("code-block"), "code block renders");
		assert.ok(!html.includes("<br"), "code blocks have no injected breaks");
	});

	it("keeps lists as lists (no break-collapse)", () => {
		const html = render("- alpha\n- beta");
		const items = html.match(/data-streamdown="list-item"/g) ?? [];
		assert.equal(items.length, 2, "two list items");
		assert.ok(!html.includes("<br"), "list lines are not breaks");
	});

	it("keeps GFM tables intact (remark-breaks did not replace the defaults)", () => {
		const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
		assert.ok(html.includes("<table"), "GFM table renders");
	});
});

describe("render — mermaid", () => {
	it("renders a mermaid fence as a diagram container, not a raw code block", () => {
		// El SSR renderiza el esqueleto Suspense del fragmento perezoso (el diagrama en sí
		// se monta en el cliente tras la hidratación), así que se comprueba lo que NO debe
		// ocurrir: el lenguaje mermaid no debe tomar el camino del bloque de código y
		// el código del gráfico no debe filtrarse como código visible.
		const html = render("```mermaid\ngraph TD\nA --> B\n```");
		assert.ok(
			!html.includes('data-streamdown="code-block"'),
			"mermaid fences must not render as code blocks",
		);
		assert.ok(!html.includes("graph TD"), "chart source is not leaked as text");
	});

	it("still renders ordinary code fences as code blocks (contrast)", () => {
		const html = render("```js\nconst x = 1;\n```");
		assert.ok(html.includes('data-streamdown="code-block"'), "js fences keep the code-block path");
	});

	it("renders the error fallback for invalid mermaid: error + source + retry", () => {
		// El componente alternativo se monta en el cliente cuando mermaid no consigue
		// analizar; se renderiza directamente para fijar su contrato.
		const html = renderToStaticMarkup(
			<MermaidError
				chart={"not a diagram @@@\nA --> B"}
				error="Parse error on line 1: unexpected text"
				retry={() => {}}
			/>,
		);
		assert.match(html, /Diagram failed to render/);
		assert.match(html, /Parse error on line 1/);
		assert.match(html, /Show diagram source/);
		assert.match(html, /not a diagram/);
		assert.match(html, />Retry</);
	});
});


describe("render — bold is the real <strong> (the dead Bold-color fix)", () => {
	// El `strong` por defecto de Streamdown renderiza <span class="font-semibold"
	// data-streamdown="strong">, y la regla del token de tinta de la app
	// (.lh-prose :where(strong, b), globals.css) encaja con ELEMENTOS strong/b,
	// así que la negrita nunca tomaba el color --lh-ink-strong (ni el
	// #ee928c de fábrica ni un boldColor de los ajustes). La sustitución en mdComponents
	// renderiza el elemento semántico.
	it("bold renders a real <strong> element inside .lh-prose", () => {
		const html = render("plain **bold** plain");
		assert.ok(
			html.includes('<strong data-streamdown="strong">bold</strong>'),
			"bold renders as a semantic strong element",
		);
		assert.ok(html.includes("lh-prose"), "the markdown surface carries .lh-prose (the token rule's anchor)");
	});

	it("no span-for-bold regression: the font-semibold span is gone", () => {
		const html = render("plain **bold** plain");
		assert.ok(!html.includes('class="font-semibold"'), "streamdown's span/600 default must not render bold");
	});

	it("italic stays native <em> (the case that always worked)", () => {
		const html = render("plain *emph* plain");
		assert.ok(html.includes("<em>"), "italic renders a native em element");
	});
});

// ─── dólares escapados dentro de las matemáticas (responsable, 2026-10-12) ──
//
// El cierre de mathText de micromark sigue la lógica de los code span: CUALQUIER
// secuencia de `$` del mismo tamaño cierra, `\$` incluido, así que `$x = \$5$` se
// cerraba en el escape y daba error. KaTeX en sí renderiza bien `\$` (y su propio
// escáner de auto-render se salta los dólares escapados). El arreglo normaliza en
// la frontera de render: dentro de span en línea equilibrados, `\$` pasa a ser el
// `\text{\textdollar}` sin dólar ANTES de tokenizar, así el cierre es el que quería el autor.

describe("escaped dollars inside math — transform units", () => {
	it("replaces \\$ inside a balanced inline span", () => {
		assert.equal(
			transformMathDelimiters("It costs $x = \\$5$ at market."),
			"It costs $x = \\text{\\textdollar}5$ at market.",
		);
	});

	it("replaces every escaped dollar in the span, including the \\text{\\$} form", () => {
		assert.equal(
			transformMathDelimiters("$\\$3 + \\text{\\$}4 = \\$7$ exactly."),
			"$\\text{\\textdollar}3 + \\text{\\text{\\textdollar}}4 = \\text{\\textdollar}7$ exactly.",
		);
	});

	it("does NOT replace even-backslash dollars (row break + dollar keeps closing)", () => {
		// Hoy `$a\\$` cierra en ese `$` en micromark: la paridad es
		// estructural; sustituirlo cambiaría el final de los span en TeX legítimo.
		const md = "$a\\\\$b$ tail";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("leaves prose escaped dollars and bare currency untouched", () => {
		const md = "It costs \\$5 flat, then $5 and $10 more.";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("leaves display spans untouched — a lone $ can't close $$, \\$ already survives", () => {
		const md = "$$x = \\$5,\\ q = \\$12$$";
		assert.equal(transformMathDelimiters(md), md);
	});

	it("leaves code spans, fences, and unbalanced spans untouched", () => {
		assert.equal(transformMathDelimiters("Type `$x = \\$5$` literally."), "Type `$x = \\$5$` literally.");
		assert.equal(transformMathDelimiters("```\n$x = \\$5$\n```"), "```\n$x = \\$5$\n```");
		assert.equal(transformMathDelimiters("Broken: $x = \\$5"), "Broken: $x = \\$5");
	});

	it("clean spans stay byte-identical; only the escape-bearing span changes", () => {
		const md = "$a$ costs $5\\$10$ and $b$";
		assert.equal(
			transformMathDelimiters(md),
			"$a$ costs $5\\text{\\textdollar}10$ and $b$",
		);
	});
});

describe("escaped dollars inside math — rendering", () => {
	it("renders $x = \\$5$ as one clean math span with a visible dollar", () => {
		const html = render("It costs $x = \\$5$ at market.");
		assert.equal((html.match(/class="katex"/g) ?? []).length, 1, "one math span");
		assert.ok(!html.includes("katex-error"), "no KaTeX errors");
		assert.ok(html.includes("\\text{\\textdollar}"), "the dollar-free command reaches KaTeX");
	});

	it("the session cascade case renders every later span cleanly", () => {
		// La prueba 6 de la sesión de pruebas de LaTeX: el cierre prematuro daba error
		// y podía tragarse el texto siguiente.
		const html = render("Line A: $x = \\$5$.\n\nLine B: $y = 2$.\n\nWhat is $2 + 2$?");
		assert.equal((html.match(/class="katex"/g) ?? []).length, 3, "all three spans render");
		assert.ok(!html.includes("katex-error"), "no KaTeX errors");
		assert.ok(html.includes("Line B:"), "prose between spans survives");
	});

	it("renders the \\text{\\$} form (Test 5's text-mode dollar)", () => {
		const html = render("Price: $\\text{\\$}12$ today.");
		assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
		assert.ok(!html.includes("katex-error"));
	});

	it("legacy \\(...\\$...\\) converts and renders with the dollar intact", () => {
		const html = render("Old form \\(x = \\$5\\) renders.");
		assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
		assert.ok(!html.includes("katex-error"));
	});

	it("code spans keep the escaped dollar literal", () => {
		const html = render("Type `$x = \\$5$` literally.");
		assert.equal((html.match(/class="katex"/g) ?? []).length, 0, "code is not math");
		assert.ok(html.includes("$x = \\$5$"), "the literal source stays visible");
	});
});

describe("over-escaped command heal — doubled backslashes in tool args (owner ruling 2026-10-15)", () => {
	// Prueba de campo: xiaomi/mimo-v2.6-pro y deepseek-v4.1-flash DUPLICAN de forma
	// estocástica las barras invertidas de los comandos LaTeX dentro de los argumentos
	// JSON de las herramientas, a veces campo a campo dentro de una misma llamada (el primer
	// sondeo de la sesión de descenso de gradiente: pregunta duplicada, explicación+opciones bien).
	// KaTeX lee `\\` como salto de fila y renderiza el nombre del comando como letras
	// simples: «se renderiza como LaTeX pero se lee la palabra nabla». La reparación vive
	// en la frontera de argumentos de tool-parts (restoreMathEscapesDeep); estas son sus
	// unidades puras. Literales de TS: 4 barras invertidas = 2 reales, 6 = 3 reales.

	/** La pregunta de sondeo de la sesión de descenso de gradiente (chat_mv7r02og, msg 3)
	 *  en su forma LIMPIA con una sola barra invertida. */
	const GD_QUESTION =
		"Let $f : \\mathbb{R}^n \\to \\mathbb{R}$ be differentiable at $x$, with $\\nabla f(x) \\neq 0$. The directional derivative along a unit direction $u$ is $D_u f(x) = \\nabla f(x)^\\top u$. Among all unit directions $\\|u\\|_2 = 1$, which one makes $D_u f(x) **most negative** (steepest descent)?";

	it("heals a doubled letter command inside $…$", () => {
		assert.equal(healOverescapedCommands("$\\\\nabla f$"), "$\\nabla f$");
	});

	it("heals a quadrupled letter command (the agent's over-correction)", () => {
		assert.equal(healOverescapedCommands("$\\\\\\\\mathbb{R}^n$"), "$\\mathbb{R}^n$");
	});

	it("heals inside multi-line $$…$$ display spans", () => {
		assert.equal(
			healOverescapedCommands("$$\n\\\\nabla f(x)\n$$"),
			"$$\n\\nabla f(x)\n$$",
		);
	});

	it("heals legacy \\(…\\) spans too", () => {
		assert.equal(healOverescapedCommands("\\(\\\\nabla\\)"), "\\(\\nabla\\)");
	});

	it("heals the punctuation commands: \\| \\, \\; \\: \\!", () => {
		assert.equal(healOverescapedCommands("$\\\\|u\\\\|_2$"), "$\\|u\\|_2$");
		assert.equal(healOverescapedCommands("$a\\\\,b$"), "$a\\,b$");
		assert.equal(healOverescapedCommands("$a\\\\;b$"), "$a\\;b$");
		assert.equal(healOverescapedCommands("$a\\\\:b$"), "$a\\:b$");
		assert.equal(healOverescapedCommands("$a\\\\!b$"), "$a\\!b$");
	});

	it("KEEPS legitimate \\ row breaks — space, newline, &, [, digits follow", () => {
		const matrix = "\\begin{pmatrix} 1 \\\\ 2 \\\\\\ 3\\end{pmatrix}"; // \\ y luego \\\\
		assert.equal(healOverescapedCommands(matrix), matrix);
		const aligned = "f(x) \\\\& g(x) \\\\[6pt] h(x)";
		assert.equal(healOverescapedCommands(aligned), aligned);
	});

	it("KEEPS odd runs — a row break plus a real command cell", () => {
		// 3 barras invertidas reales y luego una letra: salto de fila \\ + comando \\nabla.
		const cell = "$a \\\\\\nabla b$";
		assert.equal(healOverescapedCommands(cell), cell);
	});

	it("touches nothing outside math spans (prose, code spans, fences)", () => {
		assert.equal(healOverescapedCommands("path C:\\\\Users\\\\amos"), "path C:\\\\Users\\\\amos");
		assert.equal(healOverescapedCommands("`$\\\\nabla$` in code"), "`$\\\\nabla$` in code");
		assert.equal(
			healOverescapedCommands("```\n$\\\\nabla$\n```"),
			"```\n$\\\\nabla$\n```",
		);
	});

	it("unbalanced spans pass through untouched (mid-stream safety)", () => {
		assert.equal(healOverescapedCommands("$\\\\nabla"), "$\\\\nabla");
	});

	it("the raw doubled gradient-descent question renders the word-signature (the bug this heal exists for)", () => {
		// El registro real de la sesión (chat_mv7r02og, msg 3), expresado como la
		// forma limpia con todas las barras invertidas duplicadas: exactamente lo que emitió mimo.
		const raw = GD_QUESTION.replace(/\\/g, "\\\\");
		const html = render(raw);
		assert.ok(!html.includes("∇"), "doubled form does not produce the glyph");
		assert.ok(html.includes("katex-error"), "doubled form errors in KaTeX");
	});

	it("the healed question renders ∇ and ⊤ with zero KaTeX errors", () => {
		const html = render(healOverescapedCommands(GD_QUESTION.replace(/\\/g, "\\\\")));
		assert.ok(html.includes("∇"), "nabla glyph renders");
		assert.ok(html.includes("mathbb"), "mathbb R renders (double-struck class)");
		assert.ok(html.includes("⊤"), "top renders");
		assert.ok(!html.includes("katex-error"), "no KaTeX errors");
	});

	it("the healed inference-runtime question renders ∈ and ×", () => {
		// El registro real de la sesión (chat_mv8ybpvs, msg 7): mimo duplicó el
		// campo entero; forma limpia con todas las barras invertidas duplicadas.
		const ir =
			"Let $A \\in \\mathbb{R}^{m \\times k}$ and $B \\in \\mathbb{R}^{k \\times n}$, and let $C = AB$ be their matrix product.";
		const html = render(healOverescapedCommands(ir.replace(/\\/g, "\\\\")));
		assert.ok(html.includes("∈"), "in renders");
		assert.ok(html.includes("mathbb"), "mathbb renders (double-struck class)");
		assert.ok(html.includes("×"), "times renders");
		assert.ok(!html.includes("katex-error"), "no KaTeX errors");
	});
});

