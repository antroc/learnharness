# Uso: sugerir.py mapa.json BASE -> escribe BASE.sug.txt con traducciones de los docs cuando coinciden
import json,re,sys
m=json.load(open(sys.argv[1])); base=sys.argv[2]
def norm(s): return ' '.join(s.split())
def plain(lines):
    t=' '.join(lines).strip()
    t=re.sub(r'^/\*\*?','',t); t=re.sub(r'\*/$','',t)
    t=re.sub(r'\s\*\s',' ',' '+t+' ')
    return norm(t)
# also strip markdown backticks variant
mm={}
for k,v in m.items(): mm[k]=v; mm[k.replace('`','')]=v
cur=None;d={};order=[]
for l in open(base+'.txt').read().split('\n'):
    g=re.match(r'^@@ (\S+) ',l)
    if g: cur=g.group(1);d[cur]=[];order.append(cur);continue
    if cur: d[cur].append(l)
hit=0;out=[]
for k in order:
    p=plain([x for x in d[k] if x.strip()])
    if p in mm: hit+=1; out.append(f'@@ {k}\n{mm[p]}')
open(base+'.sug.txt','w').write('\n'.join(out)+'\n')
print('coinciden',hit,'de',len(order))
