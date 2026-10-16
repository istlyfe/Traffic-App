import pickle,pandas as pd,numpy as np
T=pickle.load(open('tom.pkl','rb')); STR,L=pickle.load(open('b2.pkl','rb'))
tom=T['tom0.5']; tom.index=tom.index.date
sh=T['short 10:00-11:0040']; sh.index=sh.index.date
lon=STR['london_range_bo 2R']
days=sorted(set(lon.index)|set(tom.index))
D=pd.DataFrame({'tom':tom,'lon':lon,'sh10':sh}).reindex(days).fillna(0)
def sim(v,n):
    v=v.values*2*n; N=len(v); res=[]
    for s in range(N-60):
        bal=hwm=best=0; o=('open',0)
        for k in range(s,N):
            d=v[k]
            if bal+d<=hwm-2000: o=('bust',k-s+1); break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: o=('pass',k-s+1); break
        res.append(o)
    o=pd.DataFrame(res,columns=['r','d']); p=o.r=='pass'
    return f"pass {p.mean():.0%} bust {(o.r=='bust').mean():.0%} med days {o[p].d.median()} pass<=10d {(p&(o.d<=10)).mean():.0%}"
for nm,v in [('TOM only',D.tom),('TOM + London',D.tom+D.lon),('TOM + London + short10-11',D.tom+D.lon+D.sh10)]:
    yr=pd.Series(v.values,index=pd.to_datetime(v.index)); print(nm,'$/yr per MNQ:',(yr.groupby(yr.index.year).sum()*2).round(0).to_dict())
    for n in (1,2,3,4): print('  ',n,'MNQ:',sim(v,n))
