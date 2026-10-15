import json,pandas as pd,numpy as np
COST=0.75
b=json.load(open('nq_5m.json'))
rows=[(x['t'],c,x['o'],x['h'],x['l'],x['c'],x['v']) for c,v in b.items() for x in v]
df=pd.DataFrame(rows,columns='t c o h l cl v'.split()); df['t']=pd.to_datetime(df.t,utc=True).dt.tz_convert('America/New_York')
df['d']=df.t.dt.date
front=df.groupby(['d','c']).v.sum().reset_index().sort_values('v').groupby('d').tail(1).set_index('d').c
df=df[df.c==df.d.map(front)].sort_values('t').set_index('t')
rth=df.between_time('09:30','15:55')
print('days',rth.d.nunique())
def orb(mins,rr,fade=False):
    out=[]
    for d,g in rth.groupby('d'):
        n=mins//5; r=g.iloc[:n]; rest=g.iloc[n:]
        if len(r)<n or rest.empty: continue
        hi,lo=r.h.max(),r.l.min(); R=hi-lo; pos=None
        for t,x in rest.iterrows():
            if pos is None:
                if x.h>hi: pos=(1,hi,lo,hi+rr*R)
                elif x.l<lo: pos=(-1,lo,hi,lo-rr*R)
                if pos is None: continue
            s,e,st,tg=pos
            if (s==1 and x.l<=st) or (s==-1 and x.h>=st): out.append(s*(st-e)); break
            if (s==1 and x.h>=tg) or (s==-1 and x.l<=tg): out.append(s*(tg-e)); break
        else:
            if pos: out.append(pos[0]*(rest.cl.iloc[-1]-pos[1]))
    o=np.array(out)*(-1 if fade else 1)-COST
    return len(o),round(o.mean(),1),round((o>0).mean(),2),round(o.sum(),0)
print('ORB mins rr -> n avg_pts win total_pts')
for m in (5,15,30,60):
    for rr in (1,2,99):
        print(m,rr,orb(m,rr))
