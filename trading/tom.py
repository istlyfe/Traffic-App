import pandas as pd,numpy as np
COST=0.75
df=pd.read_parquet('nq1m.parquet'); df['m']=df.index.hour*60+df.index.minute
rth=df[(df.m>=570)&(df.m<955)]
G={d:g for d,g in rth.groupby('td')}
days=sorted(G); D=pd.DataFrame(index=pd.to_datetime(days)); D['ym']=D.index.to_period('M')
D['rank']=D.groupby('ym').cumcount(); D['rrank']=D.groupby('ym').cumcount(ascending=False)
rng=pd.Series({pd.Timestamp(d):G[d].h.max()-G[d].l.min() for d in days}); atr=rng.rolling(14).mean().shift(1)
def hold(d,start,end,side,stop=None):
    g=G[d.date()]; g=g[(g.m>=start)&(g.m<end)]
    if len(g)<5: return None
    e=g.o.iloc[0]
    if stop:
        for hh,ll in zip(g.h.values,g.l.values):
            if side==1 and ll<=e-stop: return -stop-COST
            if side==-1 and hh>=e+stop: return -stop-COST
    return side*(g.cl.iloc[-1]-e)-COST
def rep(name,s):
    s=pd.Series(s).dropna(); y=s.groupby(s.index.year).mean()
    print(f"{name:55} n={len(s):4} win={(s>0).mean():.0%} avg={s.mean():+6.1f} worst={s.min():6.0f} IS={s[s.index<'2025'].mean():+6.1f} OOS={s[s.index>='2025'].mean():+6.1f} yrs={y.round(1).to_dict()}")
    return s
out={}
tom=D[(D['rank']<3)|(D['rrank']==0)].index
for st in (None,0.5,1.0):
    out[f'tom{st}']=rep(f"TOM long 9:30-15:55 stop={st}xATR",{d:hold(d,570,955,1,None if st is None else st*atr[d]) for d in tom if not np.isnan(atr[d])})
for k,lab in ((D['rank']<2,'first 2 days'),(D['rrank']==0,'last day only'),((D['rank']<4)|(D['rrank']<2),'last2+first4')):
    rep(f"TOM variant {lab} (no stop)",{d:hold(d,570,955,1) for d in D[k].index})
# hour strategies every day
for nm,(a,b,s) in {'long 11:00-12:00':(660,720,1),'long 13:00-14:00':(780,840,1),'short 10:00-11:00':(600,660,-1)}.items():
    if nm=='long 11-12 + 13-14':
        rep(nm,{d:(hold(d,660,720,1) or 0)+(hold(d,780,840,1) or 0) for d in D.index}); continue
    for st in (None,40):
        out[nm+str(st)]=rep(f"{nm} stop={st}",{d:hold(d,a,b,s,st) for d in D.index})
import pickle; pickle.dump(out,open('tom.pkl','wb'))
