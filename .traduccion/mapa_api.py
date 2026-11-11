# Construye un mapa párrafo inglés → párrafo traducido de docs/plugin-api/*.md comparando con
# la rama main (antes: git fetch --depth 1 origin main, que deja FETCH_HEAD). Uso: python3 mapa_api.py SALIDA.json
import subprocess,re,json,glob,sys
def blocks(t): return [b for b in re.split(r'\n\s*\n',t)]
def norm(s): return ' '.join(s.split())
m={};bad=[]
for f in sorted(glob.glob('docs/plugin-api/*.md')):
    en=subprocess.run(['git','show','FETCH_HEAD:'+f],capture_output=True,text=True).stdout
    es=open(f).read()
    a,b=blocks(en),blocks(es)
    if len(a)!=len(b): bad.append((f,len(a),len(b))); 
    import difflib
    # align on equality of non-prose blocks (headings/code identical)
    sm=difflib.SequenceMatcher(None,a,b,autojunk=False)
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=='replace' and i2-i1==j2-j1:
            for x,y in zip(a[i1:i2],b[j1:j2]): m[norm(x)]=y
json.dump(m,open(sys.argv[1],'w'),ensure_ascii=False,indent=0)
print(len(m),bad)
