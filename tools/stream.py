import pymupdf,sys,re,glob,os
sys.stdout.reconfigure(encoding='utf-8')
def stream(path):
    d=pymupdf.open(path); out=[]
    for pn,p in enumerate(d):
        bl=[b for b in p.get_text("blocks") if b[6]==0 and 60<b[1]<790]
        wide=any((b[2]-b[0])>350 for b in bl)
        if wide: bl.sort(key=lambda b:(b[1],b[0]))
        else: bl.sort(key=lambda b:(b[0]>=300,b[1]))
        for b in bl:
            t=re.sub(r'\s+',' ',b[4]).strip()
            if t: out.append((pn+1,round(b[0]),round(b[1]),t))
    return out
if __name__=="__main__":
    f=sys.argv[1]
    for pn,x,y,t in stream(f): print(pn,x,y,t[:100])
