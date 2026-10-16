exec(open('tomc.py').read().split("for nm,v in")[0])
import numpy as np
def run_slot(v,start,n):
    """combine -> funded -> on any bust, restart combine next day. returns withdrawals, attempts, timeline"""
    v=v.values*2*n; N=len(v); k=start; attempts=0; withdrawn=0.0; funded_days=0; blows=0; payouts=[]
    idx=list(D.index)
    while k<N:
        attempts+=1; bal=hwm=best=0; passed=False
        while k<N:
            d=v[k]; k+=1
            if bal+d<=hwm-2000: break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: passed=True; break
        if not passed: continue
        f=0.0; fh=0.0; last_m=None
        while k<N:
            d=v[k]; day=idx[k]; k+=1; funded_days+=1
            f+=d; fh=max(fh,f); floor=min(fh-2000,0)
            if f<=floor: blows+=1; break
            m=(day.year,day.month)
            if last_m and m!=last_m and f>2000:     # monthly payout: withdraw everything above a $2,000 cushion
                w=f-2000; withdrawn+=w; payouts.append((day,w)); f-=w; fh=f
            last_m=m
    return dict(attempts=attempts,withdrawn=withdrawn,funded_days=funded_days,blows=blows,payouts=payouts)
yrs=len(D)/252
for nm,v in [('TOM + London',D.tom+D.lon),('TOM only',D.tom)]:
    for stagger in (0,21):
        res=[run_slot(v,i*stagger,2) for i in range(3)]
        tot=sum(r['withdrawn'] for r in res); att=sum(r['attempts'] for r in res)
        P=pd.Series(dtype=float)
        for r in res:
            for dday,w in r['payouts']: P.loc[dday]=P.get(dday,0)+w
        P.index=pd.to_datetime(P.index); mon=P.groupby([P.index.year,P.index.month]).sum() if len(P) else P
        print(f"\n{nm} | 3 accounts x 2 MNQ | starts {'same day' if stagger==0 else 'staggered 1 month'}")
        print(f"  total withdrawn over {yrs:.1f} yrs: ${tot:,.0f}  (~${tot/yrs/12:,.0f}/month, ~${tot/len(D):,.0f}/trading day)")
        print(f"  combine attempts bought: {att} (at $100 each ≈ ${att*100:,.0f})  funded accounts blown: {sum(r['blows'] for r in res)}")
        print(f"  months with a payout: {len(mon)} of {int(yrs*12)}; by year:", P.groupby(P.index.year).sum().round(0).to_dict() if len(P) else {})
