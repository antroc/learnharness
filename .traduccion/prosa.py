#!/usr/bin/env python3
"""Extrae y aplica la prosa (JSDoc) de la referencia generada docs/plugin-api/.

Uso:
  python3 .traduccion/prosa.py extraer SALIDA fichero.md [...]
      → SALIDA.json (bloques por fichero) y SALIDA.txt ("@@ id" + texto original),
        con los bloques idénticos agrupados en un solo id.
  python3 .traduccion/prosa.py aplicar SALIDA
      → lee SALIDA.es.txt (mismas cabeceras "@@ id", texto traducido debajo) y sustituye
        cada bloque en sus ficheros. Un id ausente se deja sin tocar.

Un bloque es un párrafo (líneas no vacías seguidas) fuera de los bloques de código, que no
es un encabezado ni una línea ya traducida de las frases repetidas (ver PLAN.md), ni una
línea de índice "- [x](#ancla)…", ni una tabla de parámetros ("| … |").
"""
import json
import re
import sys

YA = (
    "Declaración de apoyo", "Tipo público del SDK", "**Tipos relacionados:**",
    "**Devuelve:**", "**Índice de miembros**", "[Índice de la API]", "<!--",
)
INDICE = re.compile(
    r"^- \[.*?\]\(#[^)]+\)( — (declaración de apoyo|[0-9]+ firmas o variantes))?$")


def bloques(lineas):
    """Devuelve [(inicio, fin_exclusivo)] de los párrafos de prosa."""
    res, en_codigo, i, n = [], False, 0, len(lineas)
    while i < n:
        l = lineas[i]
        if l.lstrip().startswith("```"):
            en_codigo = not en_codigo
            i += 1
            continue
        if en_codigo or not l.strip() or l.startswith("#"):
            i += 1
            continue
        j = i
        while j < n and lineas[j].strip() and not lineas[j].lstrip().startswith("```") \
                and not lineas[j].startswith("#"):
            j += 1
        par = lineas[i:j]
        if not all(x.startswith(YA) or x.startswith("|") or INDICE.match(x) for x in par):
            res.append((i, j))
        i = j
    return res


def extraer(salida, ficheros):
    ids, orden, mapa = {}, [], {}
    for f in ficheros:
        lineas = open(f, encoding="utf-8").read().split("\n")
        for a, b in bloques(lineas):
            texto = "\n".join(lineas[a:b])
            if texto not in ids:
                ids[texto] = f"b{len(ids) + 1}"
                orden.append(texto)
            mapa.setdefault(f, []).append([a, b, ids[texto]])
    json.dump({"ficheros": mapa, "originales": {ids[t]: t for t in orden}},
              open(salida + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(salida + ".txt", "w", encoding="utf-8") as out:
        for t in orden:
            out.write(f"@@ {ids[t]}\n{t}\n\n")
    print(f"{len(orden)} bloques únicos, {sum(len(t.split()) for t in orden)} palabras")


def aplicar(salida):
    datos = json.load(open(salida + ".json", encoding="utf-8"))
    trad, actual = {}, None
    for l in open(salida + ".es.txt", encoding="utf-8").read().split("\n"):
        m = re.match(r"^@@ (b\d+)\s*$", l)
        if m:
            actual = m.group(1)
            trad[actual] = []
        elif actual:
            trad[actual].append(l)
    trad = {k: "\n".join(v).strip("\n") for k, v in trad.items()}
    faltan = [k for k in datos["originales"] if k not in trad]
    for f, bs in datos["ficheros"].items():
        lineas = open(f, encoding="utf-8").read().split("\n")
        for a, b, k in sorted(bs, reverse=True):
            if k not in trad:
                continue
            if "\n".join(lineas[a:b]) != datos["originales"][k]:
                sys.exit(f"{f}:{a + 1}: el bloque {k} ha cambiado desde la extracción")
            lineas[a:b] = trad[k].split("\n")
        open(f, "w", encoding="utf-8").write("\n".join(lineas))
    print(f"aplicados {len(trad)} bloques; sin traducción: {len(faltan)}")


if __name__ == "__main__":
    if sys.argv[1] == "extraer":
        extraer(sys.argv[2], sys.argv[3:])
    else:
        aplicar(sys.argv[2])
