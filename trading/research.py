import pandas as pd,numpy as np,itertools,sys
COST=0.75   # pts round trip (comm + slippage) on NQ points
df=pd.read_parquet('nq1m.parquet')
mins=df.index.hour*60+df.index.minute
df['m']=mins
days=sorted(df.td.unique())
G={d:g for d,g in df.groupby('td')}
# per-day levels
lv={}
prev=None
for d in days:
    g=G[d]; rth=g[(g.m>=570)&(g.m<960)]; on=g[(g.m<570)|(g.m>=1080)]
    if len(rth)<300: prev=None; continue
    r=dict(rh=rth.h.max(),rl=rth.l.min(),onh=on.h.max() if len(on) else np.nan,onl=on.l.min() if len(on) else np.nan)
    if prev: r.update(pdh=prev['rh'],pdl=prev['rl'],ok=True)
    else: r['ok']=False
    r['rng']=r['rh']-r['rl']; lv[d]=r; prev=r
L=pd.DataFrame(lv).T; L['atr']=L.rng.astype(float).rolling(14).mean().shift(1)
def arrays(d):
    g=G[d]; g=g[(g.m>=570)&(g.m<955)]
    return g.m.values,g.o.values,g.h.values,g.l.values,g.cl.values
A={d:arrays(d) for d in L.index}
def manage(i0,side,e,h,l,c,stop,tgt,act,trail):
    st=e-side*stop; best=e
    for i in range(i0,len(h)):
        if side==1:
            if l[i]<=st: return st-e
            if tgt and h[i]>=e+tgt: return tgt
            best=max(best,h[i])
            if trail and best-e>=act: st=max(st,best-trail)
        else:
            if h[i]>=st: return e-st
            if tgt and l[i]<=e-tgt: return tgt
            best=min(best,l[i])
            if trail and e-best>=act: st=min(st,best+trail)
    return side*(c[-1]-e)
def signal(kind,d,par):
    """returns (index, side, entry) of first signal 9:30-11:30 or None"""
    m,o,h,l,c=A[d]; r=L.loc[d]
    if kind in('pdh_bo','on_bo','pdh_fade','on_fade'):
        hi,lo=(r.pdh,r.pdl) if kind.startswith('pdh') else (r.onh,r.onl)
        if not r.ok or pd.isna(hi): return None
        s0=0
    else:  # orb
        n=par; s0=n
        if len(h)<n+1: return None
        hi,lo=h[:n].max(),l[:n].min()
    for i in range(s0,len(m)):
        if m[i]>=690: break
        if kind.endswith('bo'):
            if h[i]>hi and o[i]<=hi: return (i,1,hi)
            if l[i]<lo and o[i]>=lo: return (i,-1,lo)
        else:   # fade: wick through level and close back inside -> enter at close next bar
            if h[i]>hi and c[i]<hi: return (i+1,-1,c[i])
            if l[i]<lo and c[i]>lo: return (i+1,1,c[i])
    return None
def run(kind,par,stop,tgt,act,trail):
    out={}
    for d in L.index:
        r=L.loc[d]
        if pd.isna(r.atr): continue
        sig=signal(kind,d,par)
        if not sig: out[d]=0.0; continue
        i,s,e=sig; m,o,h,l,c=A[d]
        if i>=len(h): out[d]=0.0; continue
        S=stop*r.atr if stop<5 else stop
        T=(tgt*S if tgt and tgt<10 else tgt)
        out[d]=manage(i+1 if kind.endswith("bo") else i,s,e,h,l,c,S,T,act,trail)-COST
    return pd.Series(out)
