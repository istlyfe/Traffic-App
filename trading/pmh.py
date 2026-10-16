import pandas as pd,numpy as np,itertools
COST=0.75
df=pd.read_parquet('nq1m.parquet')
b=df.resample('2min',label='left',closed='left').agg({'o':'first','h':'max','l':'min','cl':'last','td':'last'}).dropna()
b['m']=b.index.hour*60+b.index.minute
b['e13']=b.cl.ewm(span=13).mean(); b['e48']=b.cl.ewm(span=48).mean()
G={d:g for d,g in b.groupby('td')}; days=sorted(G)
rth={d:G[d][(G[d].m>=570)&(G[d].m<956)] for d in days}
pdh={};pdl={};rng={}
for i,d in enumerate(days):
    r=rth[d]
    if len(r)>100: rng[d]=r.h.max()-r.l.min()
    if i>0 and len(rth[days[i-1]])>100: pdh[d]=rth[days[i-1]].h.max(); pdl[d]=rth[days[i-1]].l.min()
atr=pd.Series(rng).rolling(14).mean().shift(1)
SPLIT=pd.Timestamp('2025-01-01').date()
def run(stop,minrr=1.0,trend=False,last_entry=690,tol=0.0):
    out=[]
    for d in days:
        if d not in pdh or pd.isna(atr.get(d,np.nan)): continue
        g=G[d]; pre=g[(g.m>=240)&(g.m<570)]; r=rth[d]
        if len(pre)<50 or len(r)<100: continue
        PMH,PML=pre.h.max(),pre.l.min(); H,L,C,M,E13,E48=r.h.values,r.l.values,r.cl.values,r.m.values,r.e13.values,r.e48.values
        S=stop*atr[d] if stop<5 else stop
        side=0; broke=0
        for i in range(len(H)):
            if M[i]>=last_entry: break
            if broke==0:
                if C[i]>PMH: broke=1
                elif C[i]<PML: broke=-1
                continue
            lvl=PMH if broke==1 else PML; tgt=pdh[d] if broke==1 else pdl[d]
            # retest: touch level (within tol) and close back on the right side
            if broke==1 and L[i]<=lvl+tol and C[i]>lvl-S:
                if trend and not (E13[i]>E48[i]): break
                e=lvl+tol if L[i]<=lvl+tol else lvl; st=e-S
                if (tgt-e)<minrr*S: break
                side=1
            elif broke==-1 and H[i]>=lvl-tol and C[i]<lvl+S:
                if trend and not (E13[i]<E48[i]): break
                e=lvl-tol; st=e+S
                if (e-tgt)<minrr*S: break
                side=-1
            if side:
                res=None
                for j in range(i,len(H)):
                    if (side==1 and L[j]<=st) or (side==-1 and H[j]>=st): res=-S; break
                    if j>i and ((side==1 and H[j]>=tgt) or (side==-1 and L[j]<=tgt)): res=abs(tgt-e); break
                if res is None: res=side*(C[-1]-e)
                out.append((d,res-COST,S,abs(tgt-e)/S)); break
    t=pd.DataFrame(out,columns=['td','pts','R','rr'])
    return t
rows=[]
for stop,minrr,trend,tol in itertools.product((10,20,40,0.1,0.2),(1.0,2.0),(False,True),(0.0,5.0)):
    t=run(stop,minrr,trend,tol=tol)
    if len(t)<30: continue
    y=t.groupby(pd.to_datetime(t.td).dt.year).pts.mean()
    rows.append(dict(stop=stop,minRR=minrr,trend=trend,tol=tol,n=len(t),per_yr=round(len(t)/5,0),win=round((t.pts>0).mean(),2),avgW=round(t[t.pts>0].pts.mean(),1),avgL=round(t[t.pts<=0].pts.mean(),1),
        exp=round(t.pts.mean(),2),IS=round(t[t.td<SPLIT].pts.mean(),2),OOS=round(t[t.td>=SPLIT].pts.mean(),2),yrs_pos=f"{(y>0).sum()}/{len(y)}",med_rr=round(t.rr.median(),1)))
R=pd.DataFrame(rows).sort_values('exp',ascending=False); pd.set_option('display.width',250)
print(R.to_string(index=False)); R.to_csv('pmh.csv',index=False)
