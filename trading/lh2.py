import pandas as pd,numpy as np
df=pd.read_parquet('nq1m.parquet')
b=df.resample('5min',label='left',closed='left').agg({'o':'first','h':'max','l':'min','cl':'last','c':'last'}).dropna()
c=b.cl; basis=c.rolling(20).mean(); dev=c.rolling(20).std(ddof=0)
up=(basis+2.6*dev).values; lo=(basis-2.6*dev).values
O,H,L,C=b.o.values,b.h.values,b.l.values,b.cl.values; T=b.index
tol=1.5*2.5
# --- signals on 5m bar close (Either: band re-entry or first line bounce, band-extreme lines)
sig=np.zeros(len(b),int); res=sup=np.nan; rs=ss=0
for i in range(len(b)):
    if np.isnan(up[i]): continue
    bandL=L[i]<lo[i] and C[i]>lo[i]; bandS=H[i]>up[i] and C[i]<up[i]
    rT=rs==1 and not np.isnan(res) and H[i]>=res-tol; sT=ss==1 and not np.isnan(sup) and L[i]<=sup+tol
    lineL=sT and L[i]>=sup-tol and C[i]>sup; lineS=rT and H[i]<=res+tol and C[i]<res
    rl=bandL or lineL; rsh=bandS or lineS
    if rl and not rsh: sig[i]=1
    elif rsh and not rl: sig[i]=-1
    if H[i]>up[i]: res=H[i]; rs=0
    elif rT: rs=2
    elif rs==0 and not np.isnan(res) and H[i]<res-tol: rs=1
    if L[i]<lo[i]: sup=L[i]; ss=0
    elif sT: ss=2
    elif ss==0 and not np.isnan(sup) and L[i]>sup+tol: ss=1
# --- 1m arrays for exits
M=df; mt=M.index.values.astype("datetime64[ns]"); mo,mh,ml,mc=M.o.values,M.h.values,M.l.values,M.cl.values
pos_of=np.searchsorted(mt,T.values)
STOP=29.5*2.5; ACT=2*2.5; TRAIL=1*2.5; COST=1.1   # pts: $0.62/side comm + 1 tick slip/side on MNQ
def simulate(mode):
    out=[]; i=0; n=len(b); busy_until=None
    for i in range(n-1):
        if sig[i]==0: continue
        tE=T[i+1]
        if busy_until is not None and tE.value<busy_until: continue
        s=sig[i]; k=pos_of[i+1]; e=mo[k]; st=e-s*STOP; best=e; trail_on=False; ex=None
        for j in range(k,min(k+600,len(mh))):
            if mode=='fixed':
                if (s==1 and ml[j]<=st) or (s==-1 and mh[j]>=st): ex=st; break
                if (s==1 and mh[j]>=e+125) or (s==-1 and ml[j]<=e-125): ex=e+s*125; break
                continue
            # pessimistic: check stop with current trail first, then update with this bar's extreme
            if mode=='pess':
                if (s==1 and ml[j]<=st) or (s==-1 and mh[j]>=st): ex=(min(st,mo[j]) if s==1 else max(st,mo[j])) if j>k else st; break
                best=max(best,mh[j]) if s==1 else min(best,ml[j])
                if s*(best-e)>=ACT: st=max(st,best-TRAIL) if s==1 else min(st,best+TRAIL)
            else:  # optimistic (TradingView-like): extreme first, then pullback
                best=max(best,mh[j]) if s==1 else min(best,ml[j])
                if s*(best-e)>=ACT: st=max(st,best-TRAIL) if s==1 else min(st,best+TRAIL)
                if (s==1 and ml[j]<=st) or (s==-1 and mh[j]>=st): ex=st; break
        if ex is None: ex=mc[j]
        out.append((T[i+1],s*(ex-e)-COST)); busy_until=int(mt[j].astype("int64"))
    return pd.DataFrame(out,columns=['t','pts'])

import sys
for cost in (1.1,1.6,2.1):
    COST=cost
    for mode in ('pess',):
        t=simulate(mode); t['y']=t.t.dt.year; w=t.pts>0
        print(f"gap-aware {mode} cost {cost}pt: trades={len(t)} win={w.mean():.1%} avgW={t.pts[w].mean():.2f} avgL={t.pts[~w].mean():.1f} avg={t.pts.mean():+.2f}pt total(1 MNQ)=${t.pts.sum()*2:,.0f} by year {t.groupby('y').pts.mean().round(2).to_dict()}",flush=True)
        if cost==1.1: t.to_csv('lh_gap.csv',index=False)
