#!/usr/bin/env node
// Herramienta de traducción de comentarios de código (TS/TSX/JS/MJS/CJS).
//
// Uso:
//   node .traduccion/comentarios.cjs extraer <base> <ruta> [<ruta>...]
//       Genera <base>.json (posiciones) y <base>.txt (comentarios originales).
//   node .traduccion/comentarios.cjs aplicar <base>
//       Lee <base>.json y <base>.es.txt (traducciones) y las inserta en los ficheros.
//
// Formato de <base>.txt / <base>.es.txt: bloques separados por cabeceras
//   @@ <id> <ruta>:<línea>
// seguidas del texto del comentario. En .es.txt basta con copiar la cabecera
// (al menos "@@ <id>") y escribir debajo el comentario traducido. Los ids que no
// aparezcan en .es.txt se dejan sin tocar.
//
// Garantías: solo se reemplaza texto dentro de rangos de comentario y se valida
// que el reemplazo siga siendo un comentario del mismo tipo; al final se compara
// el código sin comentarios antes y después y no se escribe el fichero si difiere.
//
// Requiere el paquete "typescript": se busca en TS_PATH, en el node_modules del
// repositorio o en el global.

const fs = require('fs');
const path = require('path');

function loadTs() {
  const tries = [process.env.TS_PATH, path.join(__dirname, '..', 'node_modules', 'typescript'), 'typescript'].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (_) { /* siguiente */ }
  }
  console.error('No encuentro "typescript". Instálalo, p. ej.: npm i --prefix /tmp/tsdep typescript@5 && export TS_PATH=/tmp/tsdep/node_modules/typescript');
  process.exit(1);
}
const ts = loadTs();
const ROOT = path.resolve(__dirname, '..');
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];
const DIRECTIVE = /^(\/\/\/?|\/\*+)\s*(eslint|@ts-|prettier-ignore|istanbul|c8 |v8 |@vite-ignore|webpack|biome-ignore|@jsx|@refresh|#region|#endregion|<reference|global |tslint|jshint|@license|@preserve|SPDX)/i;

function scriptKind(f) {
  const x = path.extname(f);
  if (x === '.tsx' || x === '.jsx') return ts.ScriptKind.TSX;
  if (['.ts', '.mts', '.cts'].includes(x)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function listFiles(args) {
  const out = [];
  const walk = (abs) => {
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs)) {
        if (['.git', 'node_modules', 'dist', '.traduccion'].includes(e)) continue;
        walk(path.join(abs, e));
      }
    } else if (EXTS.includes(path.extname(abs))) out.push(path.relative(ROOT, abs));
  };
  args.forEach((a) => walk(path.resolve(ROOT, a)));
  return [...new Set(out)].sort();
}

function commentRanges(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));
  const seen = new Map();
  const add = (rs) => rs && rs.forEach((r) => seen.set(r.pos, r));
  (function visit(n) {
    add(ts.getLeadingCommentRanges(text, n.pos));
    add(ts.getTrailingCommentRanges(text, n.end));
    n.getChildren(sf).forEach(visit);
  })(sf);
  add(ts.getLeadingCommentRanges(text, 0));
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
const ownLine = (text, pos) => /^[ \t]*$/.test(text.slice(lineStart(text, pos), pos));
const lineNo = (text, pos) => text.slice(0, pos).split('\n').length;

function extract(base, args) {
  const files = listFiles(args);
  const items = [];
  let txt = '';
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const rs = commentRanges(rel, text).filter((r) => {
      const c = text.slice(r.pos, r.end);
      return !DIRECTIVE.test(c) && /[A-Za-z]{2,}/.test(c) && !c.startsWith('#!');
    });
    // Agrupa líneas // consecutivas en su propia línea y con la misma sangría.
    const groups = [];
    for (const r of rs) {
      const isLine = r.kind === ts.SyntaxKind.SingleLineCommentTrivia;
      const own = ownLine(text, r.pos);
      const indent = text.slice(lineStart(text, r.pos), r.pos);
      const last = groups[groups.length - 1];
      if (last && isLine && own && last.line && last.own && last.indent === indent && text.slice(last.e, r.pos) === '\n' + indent) {
        last.e = r.end;
      } else {
        groups.push({ f: rel, p: r.pos, e: r.end, line: isLine, own, indent });
      }
    }
    for (const g of groups) {
      g.id = items.length + 1;
      g.t = text.slice(g.p, g.e);
      items.push(g);
      txt += `@@ ${g.id} ${rel}:${lineNo(text, g.p)}\n${g.t}\n`;
    }
  }
  fs.writeFileSync(base + '.json', JSON.stringify({ files, items }, null, 0));
  fs.writeFileSync(base + '.txt', txt);
  const words = items.reduce((a, i) => a + i.t.split(/\s+/).length, 0);
  console.log(`ficheros=${files.length} bloques=${items.length} palabras≈${words}`);
}

function parseTranslations(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const map = new Map();
  const re = /^@@ (\d+)[^\n]*\n/gm;
  const heads = [...raw.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : raw.length;
    map.set(Number(m[1]), raw.slice(start, end).replace(/\s+$/, ''));
  });
  return map;
}

// Texto del fichero sin ningún comentario (según el parser real de TypeScript).
function codeOnly(rel, text) {
  let out = '', last = 0;
  for (const r of commentRanges(rel, text)) { out += text.slice(last, r.pos); last = r.end; }
  return out + text.slice(last);
}

function normalise(item, tr) {
  if (item.line) {
    const lines = tr.split('\n').map((l) => l.trim()).filter((l) => l.length);
    if (!lines.length || !lines.every((l) => l.startsWith('//'))) throw new Error('cada línea debe empezar por //');
    if (!item.own && lines.length > 1) throw new Error('comentario al final de línea: debe ser una sola línea');
    return lines.join('\n' + item.indent);
  }
  const t = tr.replace(/^[ \t]+/, '');
  const opener = item.t.startsWith('/**') ? '/**' : '/*';
  if (!t.startsWith(opener) || !t.endsWith('*/')) throw new Error(`debe empezar por ${opener} y terminar en */`);
  if (t.slice(opener.length, -2).includes('*/')) throw new Error('contiene */ en medio');
  if (!item.own && t.includes('\n') && !item.t.includes('\n')) throw new Error('comentario en línea: no añadas saltos');
  return t;
}

function apply(base) {
  const { items } = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  const tr = parseTranslations(base + '.es.txt');
  const byFile = new Map();
  for (const it of items) {
    if (!byFile.has(it.f)) byFile.set(it.f, []);
    byFile.get(it.f).push(it);
  }
  let errors = 0, applied = 0, missing = 0;
  for (const [rel, its] of byFile) {
    const abs = path.join(ROOT, rel);
    const orig = fs.readFileSync(abs, 'utf8');
    let text = orig;
    for (const it of [...its].sort((a, b) => b.p - a.p)) {
      if (!tr.has(it.id)) { missing++; continue; }
      if (text.slice(it.p, it.e) !== it.t) { console.error(`#${it.id} ${rel}: el fichero ha cambiado desde la extracción`); errors++; continue; }
      try {
        const rep = normalise(it, tr.get(it.id));
        text = text.slice(0, it.p) + rep + text.slice(it.e);
        applied++;
      } catch (e) { console.error(`#${it.id} ${rel}: ${e.message}`); errors++; }
    }
    if (codeOnly(rel, orig) !== codeOnly(rel, text)) { console.error(`${rel}: el código (sin comentarios) ha cambiado; NO se escribe`); errors++; continue; }
    if (text !== orig) fs.writeFileSync(abs, text);
  }
  console.log(`aplicados=${applied} sin_traducción=${missing} errores=${errors}`);
  if (errors) process.exit(2);
}

const [cmd, base, ...rest] = process.argv.slice(2);
if (cmd === 'extraer' && base && rest.length) extract(path.resolve(base), rest);
else if (cmd === 'aplicar' && base) apply(path.resolve(base));
else { console.error('Uso: extraer <base> <rutas...> | aplicar <base>'); process.exit(1); }
