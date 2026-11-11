"""Comprueba que cada grupo // traducido conserva su número de líneas y que no hay líneas // vacías añadidas.
Uso: python3 cuenta.py BASE  (lee BASE.txt y BASE.es.txt). Los ids que faltan (directivas) se listan como "falta"."""
import re,sys
def p(f):
    d={};c=None
    for l in open(f,encoding='utf-8').read().split('\n'):
        m=re.match(r'^@@ (\S+) ',l)
        if m: c=m.group(1); d[c]=[]; continue
        if c: d[c].append(l)
    for k in d:
        while d[k] and d[k][-1]=='': d[k].pop()
    return d
o=p(sys.argv[1]+'.txt'); t=p(sys.argv[1]+'.es.txt')
for k in o:
    if k not in t: print('falta',k); continue
    if o[k][0].lstrip().startswith('//') and len(o[k])!=len(t[k]): print('lineas',k,len(o[k]),len(t[k]))
    if any(x.strip()=='//' for x in t[k]) and not any(x.strip()=='//' for x in o[k]): print('vacía',k)
