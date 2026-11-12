"""Copia la sangría (tabs/espacios iniciales) de las líneas de continuación de los
bloques /* */ originales a las traducidas. Si el original era de UNA sola línea y la
traducción ocupa varias, toma los tabs de la línea del fichero fuente (sesión 9).
Ejecutar desde la raíz del repo. Uso: python3 sangria.py BASE  (BASE.txt, BASE.es.txt)"""
import re, sys

def parse(path):
    out, cur, order = {}, None, []
    for line in open(path, encoding="utf-8").read().split("\n"):
        m = re.match(r"^@@ (\S+) ", line)
        if m:
            cur = m.group(1); out[cur] = []; order.append((cur, line)); continue
        if cur is not None:
            out[cur].append(line)
    for k in out:
        while out[k] and out[k][-1] == "":
            out[k].pop()
    return out, order

def reind(rest, ind):
    """Sustituye la sangría común de las líneas por `ind`, manteniendo la relativa."""
    ws = [re.match(r"^[ \t]*", l).group(0) for l in rest if l.strip()]
    common = min(ws, key=len) if ws else ""
    common = common if all(w.startswith(common) for w in ws) else ""
    return [(ind + l[len(common):]) if l.strip() else l for l in rest]

base = sys.argv[1]
orig, _ = parse(base + ".txt")
tr, order = parse(base + ".es.txt")
res = []
for k, header in order:
    lines = tr[k]
    o = orig.get(k, [])
    if lines and lines[0].lstrip().startswith("/*") and len(o) > 1:
        # indentación = blancos iniciales (tabs y espacios) de la 2.ª línea original;
        # se conserva la sangría relativa de la traducción (sesión 12)
        lines = [lines[0]] + reind(lines[1:], re.match(r"^[ \t]*", o[1]).group(0))
    elif lines and lines[0].lstrip().startswith("/*") and len(o) == 1 and len(lines) > 1:
        m = re.match(r"^@@ \S+ (.+):(\d+)", header)
        src = open(m.group(1), encoding="utf-8").read().split("\n")[int(m.group(2)) - 1]
        ind = re.match(r"^[ \t]*", src).group(0)
        if lines[1].lstrip().startswith("*"):
            ind += " "
        lines = [lines[0]] + reind(lines[1:], ind)
    res.append(header)
    res.extend(lines)
open(base + ".es.txt", "w", encoding="utf-8").write("\n".join(res) + "\n")
