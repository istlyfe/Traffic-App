import pandas as pd,numpy as np
COST=0.75
df=pd.read_parquet('nq1m.parquet')
def wma(x,n):
    w=np.arange(1,n+1); return x.rolling(n).apply(lambda a:(a*w).sum()/w.sum(),raw=True)
def hma(x,n): return wma(2*wma(x,n//2)-wma(x,n),int(np.sqrt(n)))
def run(tf,rth_only,exit_hull=True,MTP=1.4):
    b=df.resample(f'{tf}min',label='left',closed='left').agg({'o':'first','h':'max','l':'min','cl':'last','c':'last'}).dropna()
    h,l,c,o=b.h.values,b.l.values,b.cl.values,b.o.values
    pc=np.r_[np.nan,c[:-1]]; tr=np.nanmax(np.c_[h-l,abs(h-pc),abs(l-pc)],axis=1)
    atr=pd.Series(tr).rolling(21).mean().values; src=(h+l)/2
    n=len(c); up=np.zeros(n); dn=np.zeros(n); trend=np.ones(n,int)
    for i in range(n):
        if np.isnan(atr[i]): up[i]=dn[i]=np.nan; continue
        u=src[i]-MTP*atr[i]; d=src[i]+MTP*atr[i]
        u1=up[i-1] if i and not np.isnan(up[i-1]) else u; d1=dn[i-1] if i and not np.isnan(dn[i-1]) else d
        up[i]=max(u,u1) if c[i-1]>u1 else u; dn[i]=min(d,d1) if c[i-1]<d1 else d
        t=trend[i-1] if i else 1
        trend[i]=1 if (t==-1 and c[i]>d1) else (-1 if (t==1 and c[i]<u1) else t)
    hu=hma(pd.Series(c),27).values; hup=hu>np.r_[np.nan,np.nan,hu[:-2]]
    m=(b.index.hour*60+b.index.minute).values; ct=b.c.values
    trades=[]; pos=0; e=0
    for i in range(2,n-1):
        sigL=trend[i]==1 and trend[i-1]==-1; sigS=trend[i]==-1 and trend[i-1]==1
        inr=570<=m[i]<955
        exitflag=False
        if pos==1 and (sigS or (exit_hull and trend[i]==1 and not hup[i] and hup[i-1])): exitflag=True
        if pos==-1 and (sigL or (exit_hull and trend[i]==-1 and hup[i] and not hup[i-1])): exitflag=True
        if pos and (rth_only and m[i]>=955 or ct[i+1]!=ct[i]): exitflag=True
        if pos and exitflag:
            trades.append((b.index[i],pos*(o[i+1]-e)-COST)); pos=0
        if not pos and (sigL or sigS) and (inr or not rth_only):
            pos=1 if sigL else -1; e=o[i+1]
    t=pd.DataFrame(trades,columns=['t','pts']).set_index('t').pts
    y=t.groupby(t.index.year).sum()*2
    print(f"{tf:>2}m {'RTH' if rth_only else '24h'} exit={'hull' if exit_hull else 'opp '}: trades={len(t):6} per_day={len(t)/1290:5.1f} win={(t>0).mean():.0%} avg={t.mean():+6.2f}pt total/1MNQ=${t.sum()*2:>9,.0f}  by year {y.round(0).to_dict()}",flush=True)
for tf in (1,5,15,60):
    for rth in (True,False):
        for eh in (True,False):
            run(tf,rth,eh)
