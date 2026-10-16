import pickle,pandas as pd,numpy as np
exec(open('tomc.py').read().split("for nm,v in")[0])
def full(v,n,horizon_funded=250):
    v=v.values*2*n; N=len(v); res=[]
    for s in range(N-60):
        bal=hwm=best=0; out=None
        for k in range(s,N):
            d=v[k]
            if bal+d<=hwm-2000: out=('bust',k-s+1,None); break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: out=('pass',k-s+1,k+1); break
        if out is None: res.append(('open',0,None,None,None)); continue
        if out[0]=='bust': res.append(('bust',out[1],None,None,None)); continue
        # funded phase: trailing EOD MLL $2000, locks at start balance once +2000 reached
        f=0; fh=0; fb=False; end=min(N,out[2]+horizon_funded)
        for k in range(out[2],end):
            f+=v[k]; fh=max(fh,f); floor=min(fh-2000,0)
            if f<=floor: fb=True; break
        res.append(('pass',out[1],end-out[2],fb,f))
    o=pd.DataFrame(res,columns=['r','d','fd','fbust','fprofit']); p=o[o.r=='pass']
    return (f"pass {(o.r=='pass').mean():.0%} bust {(o.r=='bust').mean():.0%} | median days to pass {p.d.median():.0f} (~{p.d.median()/21:.1f} months) | "
            f"funded 1yr: blown {p.fbust.mean():.0%}, avg profit if survived ${p[~p.fbust.astype(bool)].fprofit.mean():,.0f}")
for nm,v in [('TOM only',D.tom),('TOM + London',D.tom+D.lon)]:
    print(nm)
    for n in (1,2,3): print(f'   {n} MNQ:',full(v,n))
