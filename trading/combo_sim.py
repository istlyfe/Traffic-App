import pickle,pandas as pd,numpy as np,sys
sys.argv=['x']
STR,L=pickle.load(open('b2.pkl','rb'))
import sb
t=sb.run(5,15,2.0,4.0,120,False,windows=('1000',),maxrisk=40)
SB=t.groupby('td').pts.sum()
lon=STR['london_range_bo 2R']; lh=STR['intraday_mom last hour']
days=lon.index.union(lh.index)
D=pd.DataFrame({'london':lon,'sb10':SB,'lasthour':lh}).reindex(days).fillna(0)
D['combo']=D.sum(axis=1)
SPLIT=pd.Timestamp('2025-01-01').date()
yr=pd.Series(pd.to_datetime(D.index).year,index=D.index)
print('trades/day:',{c:round((D[c]!=0).mean(),2) for c in ['london','sb10','lasthour']},'total',round((D[['london','sb10','lasthour']]!=0).sum(axis=1).mean(),2))
print('avg pts per DAY by year:\n',D.groupby(yr.values).mean().round(1).to_string())
def sim(pts,n,cap=None):
    v=pts.values*2*n-1.5*n*(D[['london','sb10','lasthour']]!=0).sum(axis=1).values
    if cap: v=np.maximum(v,-cap)
    N=len(v); res=[]
    for s in range(N-60):
        bal=hwm=best=0; o=('open',0)
        for k in range(s,N):
            d=v[k]
            if bal+d<=hwm-2000: o=('bust',k-s+1); break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: o=('pass',k-s+1); break
        res.append(o)
    o=pd.DataFrame(res,columns=['r','d']); p=o.r=='pass'
    return p.mean(),(o.r=='bust').mean(),(p&(o.d<=5)).mean(),(p&(o.d<=10)).mean(),o[p].d.median()
rows=[]
for name in ['london','combo']:
    for n in (1,2,3,4,6):
        for cap in (None,600):
            if name=='london' and cap: continue
            p,b,p5,p10,md=sim(D[name],n,cap)
            rows.append(dict(strategy=name,MNQ=n,daily_loss_cap=cap or '-',pass_=f"{p:.0%}",bust=f"{b:.0%}",pass_5d=f"{p5:.0%}",pass_10d=f"{p10:.0%}",median_days=md))
print(pd.DataFrame(rows).to_string(index=False))
