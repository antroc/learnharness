import assert from "node:assert/strict";
import { test } from "node:test";
import * as zlib from "node:zlib";
import { providerSafePng } from "../src/agent/subagents/headless.ts";

/**
 * El arreglo de visual-maker del 2026-09-19 (los 400 de "image format is illegal"):
 * Chrome escribe PNG con un stream IDAT PARTIDO (fragmentos de 4KB); el decodificador
 * de visión de Alibaba (detrás del qwen3.8-flash de OpenRouter, el modelo que mira de visual-maker)
 * los rechazaba durante la ventana del 2026-09-18/19 mientras que todas las formas de un solo IDAT
 * pasaban. providerSafePng vuelve a unir la partición en la forma canónica de UN IDAT
 * (especificación PNG: los fragmentos IDAT son una partición arbitraria de UN stream zlib;
 * la forma unida lleva el stream idéntico byte a byte). Node puro a propósito:
 * históricamente el proceso ya llevaba una biblioteca de imagen nativa a través del
 * sharp/libvips anidado de @huggingface/transformers, y una segunda copia (sharp en la
 * raíz) provocaba el aviso ObjC de libvips duplicada en macOS; el embedder de transformers
 * murió con la oleada 6 (2026-09-23), pero la regla de no tener dependencias nativas sigue
 * viva: el código de la aplicación no lleva ninguna biblioteca de imágenes. Estas pruebas fijan la propiedad sin
 * ninguna dependencia nativa.
 */

// ── una cadena de herramientas PNG mínima (a nivel de especificación, sin biblioteca de imágenes) ──

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf: Buffer): number {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

function walkChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
	assert.ok(png.subarray(0, 8).equals(PNG_SIG), "PNG signature");
	const chunks: Array<{ type: string; data: Buffer }> = [];
	let off = 8;
	while (off < png.length) {
		const len = png.readUInt32BE(off);
		const type = png.subarray(off + 4, off + 8).toString("ascii");
		chunks.push({ type, data: png.subarray(off + 8, off + 8 + len) });
		off += 12 + len;
	}
	return chunks;
}

/** Construye un PNG multi-IDAT VÁLIDO, exactamente con la forma de Chrome: un IHDR, las
 *  líneas de barrido comprimidas repartidas en ≥2 fragmentos IDAT, un IEND. */
function chromeStyleMultiIdatPng(width = 4, height = 4): Buffer {
	// Líneas de barrido en bruto: byte de filtro 0 + ancho × píxeles RGB (blancos); el byte
	// de filtro DEBE estar entre 0 y 4 (libpng rechaza cualquier otro).
	const stride = 1 + width * 3;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const row = raw.subarray(y * stride, (y + 1) * stride);
		row[0] = 0; // filtro: ninguno
		row.fill(255, 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // profundidad de bits
	ihdr[9] = 2; // tipo de color: truecolor RGB
	const compressed = zlib.deflateSync(raw);
	const split = Math.max(1, Math.floor(compressed.length / 2));
	return Buffer.concat([
		PNG_SIG,
		chunk("IHDR", ihdr),
		chunk("IDAT", compressed.subarray(0, split)),
		chunk("IDAT", compressed.subarray(split)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ─── las pruebas ─────────────────────────────────────────────────────────────

test("providerSafePng merges a Chrome-style split IDAT stream into ONE chunk, byte-identical stream", async () => {
	const chromeStyle = chromeStyleMultiIdatPng();
	const inChunks = walkChunks(chromeStyle);
	assert.equal(
		inChunks.filter((c) => c.type === "IDAT").length,
		2,
		"fixture sanity: the input is the multi-IDAT shape",
	);

	const fixed = providerSafePng(chromeStyle);
	const outChunks = walkChunks(fixed);
	const outIdats = outChunks.filter((c) => c.type === "IDAT");
	assert.equal(outIdats.length, 1, "exactly one IDAT chunk — the form Alibaba's decoder accepts");
	// La propiedad canónica: la carga del fragmento unido es el stream zlib IDÉNTICO
	// BYTE A BYTE (una repartición transparente, sin recodificar nada).
	assert.ok(
		outIdats[0]!.data.equals(Buffer.concat(inChunks.filter((c) => c.type === "IDAT").map((c) => c.data))),
		"the zlib stream is untouched",
	);
	// Estructura conservada: los mismos fragmentos no IDAT en orden, CRC válidos (walkChunks
	// es tonto, así que verifica el CRC explícitamente para el fragmento unido).
	assert.deepEqual(
		outChunks.map((c) => c.type),
		["IHDR", "IDAT", "IEND"],
	);
	const fixedBuf = fixed;
	let off = 8;
	while (off < fixedBuf.length) {
		const len = fixedBuf.readUInt32BE(off);
		const crc = fixedBuf.readUInt32BE(off + 8 + len);
		assert.equal(crc, crc32(fixedBuf.subarray(off + 4, off + 8 + len)), `valid CRC on ${fixedBuf.subarray(off + 4, off + 8).toString("ascii")}`);
		off += 12 + len;
	}
	// Y sigue siendo una imagen decodificable: el stream se descomprime EXACTAMENTE en las
	// líneas de barrido originales (byte de filtro 0 + píxeles RGB blancos).
	const stream = walkChunks(fixed).find((c) => c.type === "IDAT")!.data;
	const stride = 1 + 4 * 3;
	const expected = Buffer.alloc(stride * 4);
	for (let y = 0; y < 4; y++) {
		const row = expected.subarray(y * stride, (y + 1) * stride);
		row[0] = 0;
		row.fill(255, 1);
	}
	assert.ok(zlib.inflateSync(stream).equals(expected), "inflates to the original raw scanlines");
});

test("a single-IDAT PNG is already canonical: returned byte-identical (no-op)", () => {
	// Entrada de un IDAT → sale un IDAT, los mismos bytes: el caso normal (p. ej. el
	// nuevo renderizado de la barrera de doctrina de un PNG que ya es canónico).
	const stride = 1 + 4 * 3;
	const raw = Buffer.alloc(stride * 4);
	for (let y = 0; y < 4; y++) {
		const row = raw.subarray(y * stride, (y + 1) * stride);
		row[0] = 0;
		row.fill(200, 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(4, 0);
	ihdr.writeUInt32BE(4, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const single = Buffer.concat([
		PNG_SIG,
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
	assert.ok(providerSafePng(single).equals(single), "byte-identical — canonical input is untouched");
});

test("non-PNG or truncated input passes through unchanged (defensive)", () => {
	const notPng = Buffer.from("definitely not a png");
	assert.ok(providerSafePng(notPng).equals(notPng));
	const truncated = chromeStyleMultiIdatPng().subarray(0, 20);
	assert.ok(providerSafePng(truncated).equals(truncated));
});