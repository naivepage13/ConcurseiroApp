import sys,re,json,glob,os
sys.stdout.reconfigure(encoding='utf-8')
from stream import stream
BASE=[48,309]
def parse(path):
    items=stream(path)
    gi=next((i for i,it in enumerate(items) if it[3].startswith('Gabarito Comentado')),None)
    qi=[it for it in items[:gi] if it[0]>=2]
    # stop at Redação heading
    ri=next((i for i,it in enumerate(qi) if it[3]=='Redação'),len(qi))
    qi=qi[:ri]
    qs=[];cur=None;section=None;support=[];inE=False;expect=1
    texts=[];curtext=None
    for pn,x,y,t in qi:
        if re.fullmatch(r'\d{1,2}',t) and int(t)==expect:
            cur={'n':expect,'disc':section,'raw':[],'texto':curtext};qs.append(cur);expect+=1;inE=False;continue
        if not re.search(r'[\.\?\:\)\(,;]|\d',t) and len(t)<45 and (cur is None or inE or True) and x in BASE and t[0].isupper() and len(t.split())<=4 and ('Direito' in t or 'Legisla' in t or 'Língua' in t or 'Inform' in t or t in ('Matemática','Raciocínio Lógico')):
            section=t;curtext=None;cur=None;inE=False;continue
        if cur is None:
            # support text before first question of section
            if curtext is None:
                curtext={'disc':section,'paras':[]};texts.append(curtext)
            curtext['paras'].append(t);continue
        if inE and x in BASE:
            # new support text mid-section
            cur=None;curtext={'disc':section,'paras':[t]};texts.append(curtext);continue
        cur['raw'].append(t)
        if re.search(r'\(E\)',t):inE=True
    for q in qs:
        s=' '.join(q['raw']);s=re.sub(r'\s+',' ',s)
        parts=re.split(r'\(([A-E])\)\s*',s)
        q['stem']=parts[0].strip()
        alts={}
        for i in range(1,len(parts)-1,2):alts[parts[i]]=parts[i+1].strip()
        q['alts']=alts
        del q['raw']
    # gabarito
    gt=' '.join(it[3] for it in items[gi:]) if gi is not None else ''
    gab={}
    ms=list(re.finditer(r'Quest[ãa]o (\d+) [–-] Alternativa ([A-E])',gt))
    for k,m in enumerate(ms):
        end=ms[k+1].start() if k+1<len(ms) else len(gt)
        expl=gt[m.end():end].strip()
        # strip trailing subject heading / footer words
        gab[int(m.group(1))]=(m.group(2),expl)
    return qs,texts,gab
if __name__=="__main__":
    for f in sorted(glob.glob(os.path.join(os.environ.get("PDF_DIR", "."), "Simulado_*_AOCP*.pdf"))):
        qs,texts,gab=parse(f)
        bad=[q['n'] for q in qs if len(q['alts'])!=5]
        print(os.path.basename(f),len(qs),'bad',bad,'texts',len(texts),'gab',len(gab),[ (t['disc'],len(t['paras'])) for t in texts])
