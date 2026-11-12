// Regenera el conjunto de iconos de Windows/Linux a partir de la fuente de diseño plana
// (build/icon-flat.svg: la exportación de Affinity del responsable, squircle redondeado
// con transparencia incorporada, decisión del responsable 2026-10-13).
//
//   build/icon.ico  — Windows (.ico con entradas PNG de 16/24/32/48/64/128/256)
//   build/icon.png  — Linux (512×512; AppImage/deb/entrada de escritorio)
//
// macOS NO sale de aquí: build/icon.icon (el documento de Icon Composer)
// es la fuente de verdad en mac, compilada por actool al empaquetar
// a Assets.car (Liquid Glass de macOS 26) + un icns alternativo; el
// build/icon.icns empaquetado a mano sustituye el tope de 256px de esa alternativa mediante
// scripts/after-pack.cjs (antes de Tahoe se mantiene la resolución completa).
//
// Renderiza cada tamaño DIRECTAMENTE desde el SVG (resvg): bordes del squircle más
// nítidos que reduciendo un ráster. Las salidas se confirman en el repo; vuelve a ejecutarlo solo cuando
// cambie el diseño: `node scripts/make-icons.mjs`.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, "build", "icon-flat.svg"), "utf8");

const render = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render(size, size).asPng();

// ---- build/icon.ico: ICONDIR + entradas PNG -----------------------------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = ICO_SIZES.map(render);
// Cabecera (6) + una entrada de directorio de 16 bytes por imagen, y después los PNG.
const header = Buffer.alloc(6 + ICO_SIZES.length * 16);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // tipo: icono
header.writeUInt16LE(ICO_SIZES.length, 4);
let offset = header.length;
ICO_SIZES.forEach((size, i) => {
	const e = 6 + i * 16;
	header.writeUInt8(size === 256 ? 0 : size, e); // 0 codifica 256
	header.writeUInt8(size === 256 ? 0 : size, e + 1);
	header.writeUInt8(0, e + 2); // colores
	header.writeUInt8(0, e + 3); // reservado
	header.writeUInt16LE(1, e + 4); // planos
	header.writeUInt16LE(32, e + 6); // bpp
	header.writeUInt32LE(pngs[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += pngs[i].length;
});
const ico = Buffer.concat([header, ...pngs]);
writeFileSync(path.join(root, "build", "icon.ico"), ico);
console.log(`build/icon.ico  ${ICO_SIZES.join("/")} — ${(ico.length / 1024).toFixed(1)} KB`);

// ---- build/icon.png: el icono de Linux ----------------------------------
const png512 = render(512);
writeFileSync(path.join(root, "build", "icon.png"), png512);
console.log(`build/icon.png  512×512 — ${(png512.length / 1024).toFixed(1)} KB`);
