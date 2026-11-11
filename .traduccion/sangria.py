"""Copia la sangría (tabs/espacios iniciales) de las líneas de continuación de los
bloques /* */ originales a las traducidas. Uso: python3 sangria.py BASE  (BASE.txt, BASE.es.txt)"""
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

base = sys.argv[1]
orig, _ = parse(base + ".txt")
tr, order = parse(base + ".es.txt")
res = []
for k, header in order:
    lines = tr[k]
    o = orig.get(k, [])
    if lines and lines[0].lstrip().startswith("/*") and len(o) > 1:
        # indentación = tabs iniciales de la 2.ª línea original
        ind = re.match(r"^\t*", o[1]).group(0)
        new = [lines[0]]
        for l in lines[1:]:
            new.append(ind + l.lstrip("\t"))
        lines = new
    res.append(header)
    res.extend(lines)
open(base + ".es.txt", "w", encoding="utf-8").write("\n".join(res) + "\n")
