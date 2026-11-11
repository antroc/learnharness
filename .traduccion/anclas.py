import re, os, sys, unicodedata
root = sys.argv[1]
def slug(h):
    h = re.sub(r'`', '', h.strip().lower())
    h = re.sub(r'[^\w\- ]', '', h, flags=re.UNICODE)
    return h.replace(' ', '-')
cache = {}
def anchors(path):
    if path in cache: return cache[path]
    s = set(); counts = {}
    try: txt = open(path, encoding='utf-8').read()
    except FileNotFoundError: cache[path] = None; return None
    txt = re.sub(r'```.*?```', '', txt, flags=re.S)
    for m in re.finditer(r'^#{1,6}\s+(.+?)\s*#*\s*$', txt, re.M):
        b = slug(m.group(1)); n = counts.get(b, 0); counts[b] = n + 1
        s.add(b if n == 0 else f"{b}-{n}")
    cache[path] = s; return s
bad = 0
for d, _, fs in os.walk(root):
    if 'node_modules' in d or '/.git' in d: continue
    for f in fs:
        if not f.endswith('.md'): continue
        p = os.path.join(d, f)
        txt = open(p, encoding='utf-8').read()
        for m in re.finditer(r'\]\(([^)\s#]*)#([^)\s]+)\)', txt):
            target, anc = m.group(1), m.group(2)
            tp = os.path.normpath(os.path.join(d, target)) if target else p
            a = anchors(tp)
            if a is None: print(f"MISSING FILE {p} -> {target}"); bad += 1; continue
            if anc not in a: print(f"{p}: {target}#{anc}"); bad += 1
print("broken:", bad)
