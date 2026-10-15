exec(open('research.py').read().split('def signal')[0])
import pickle
# daily features
F=[]
for d in L.index:
    m,o,h,l,c=A[d]; r=L.loc[d]
    if len(c)<300: continue
    g=G[d]; prevclose=None
    F.append(d)
idx=list(L.index); pos={d:i for i,d in enumerate(idx)}
def prev_close(d):
    i=pos[d]
    if i==0: return np.nan
    m,o,h,l,c=A[idx[i-1]]; return c[-1] if len(c) else np.nan
L['pc']=[prev_close(d) for d in idx]
L['open']=[A[d][1][0] if len(A[d][1]) else np.nan for d in idx]
L['close']=[A[d][4][-1] if len(A[d][4]) else np.nan for d in idx]
L['sma20']=L.close.astype(float).rolling(20).mean().shift(1)
L['trend']=np.sign(L.pc.astype(float)-L.sma20)
L['nr']=L.rng.astype(float)<L.rng.astype(float).rolling(7).min().shift(1)+1e-9  # NR7 (today)
L['prev_nr']=L.nr.shift(1).fillna(False)
L['inside']=(L.rh.astype(float)<L.rh.shift(1).astype(float))&(L.rl.astype(float)>L.rl.shift(1).astype(float))
L['prev_inside']=L.inside.shift(1).fillna(False)
def mi(m,hhmm): 
    t=hhmm//100*60+hhmm%100; j=np.searchsorted(m,t); return j
def trade(d,i,s,e,stop,tgt=None,act=0,trail=0,exit_hhmm=None):
    m,o,h,l,c=A[d]
    if i>=len(h): return 0.0
    end=len(h) if exit_hhmm is None else max(i+1,mi(m,exit_hhmm))
    hh,ll,cc=h[:end],l[:end],c[:end]
    return manage(i,s,e,hh,ll,cc,stop,tgt,act,trail)-COST
STR={}
def reg(name,fn):
    out={}
    for d in idx:
        r=L.loc[d]
        if pd.isna(r.atr) or len(A[d][0])<300: continue
        try: out[d]=fn(d,r)
        except Exception as ex: out[d]=0.0
    STR[name]=pd.Series(out); print(name,flush=True)
# ---- strategy families ----
for S in (40,80):
  for T in (1,2):
    # 1 opening drive: direction of 9:30-10:00, enter 10:00, stop S, target T*S, exit 15:55
    def f(d,r,S=S,T=T):
        m,o,h,l,c=A[d]; j=mi(m,1000); mv=c[j-1]-o[0]
        if abs(mv)<20: return 0.0
        s=int(np.sign(mv)); return trade(d,j,s,o[j],S,T*S)
    reg(f'open_drive30 S{S} T{T}',f)
# 2 intraday momentum: first 30min return sign -> hold 15:00-15:55 (Gao et al.)
def f(d,r):
    m,o,h,l,c=A[d]; j=mi(m,1000); s=int(np.sign(c[j-1]-r.pc)); k=mi(m,1500)
    return (s*(c[-1]-o[k])-COST) if s else 0.0
reg('intraday_mom last hour',f)
def f(d,r):
    m,o,h,l,c=A[d]; k=mi(m,1530); s=int(np.sign(c[k-1]-o[0]))
    return s*(c[-1]-o[k])-COST if s else 0.0
reg('day trend into close 15:30',f)
# 3 gap fade / gap go
for lo_,hi_ in ((10,60),(60,200)):
  for mode in ('fade','go'):
    def f(d,r,lo_=lo_,hi_=hi_,mode=mode):
        m,o,h,l,c=A[d]; gap=o[0]-r.pc
        if not(lo_<=abs(gap)<hi_): return 0.0
        s=-int(np.sign(gap)) if mode=='fade' else int(np.sign(gap))
        tgt=abs(gap) if mode=='fade' else abs(gap)
        return trade(d,1,s,o[1] if len(o)>1 else o[0],max(30,abs(gap)),tgt,exit_hhmm=1200)
    reg(f'gap_{mode} {lo_}-{hi_}',f)
# 4 VWAP z-fade (mean reversion) 10:00-14:00
for z in (2.0,2.5):
    def f(d,r,z=z):
        g=G[d]; g=g[(g.m>=570)&(g.m<955)]; tp=(g.h+g.l+g.cl)/3; v=g.v.replace(0,1)
        vw=(tp*v).cumsum()/v.cumsum(); dev=(g.cl-vw); sd=dev.expanding(30).std()
        zz=(dev/sd).values; m,o,h,l,c=A[d]
        for i in range(mi(m,1000),mi(m,1400)):
            if zz[i]>z: return trade(d,i+1,-1,c[i],abs(dev.values[i]),abs(dev.values[i]),exit_hhmm=1555)
            if zz[i]<-z: return trade(d,i+1,1,c[i],abs(dev.values[i]),abs(dev.values[i]),exit_hhmm=1555)
        return 0.0
    reg(f'vwap_fade z{z}',f)
# 5 VWAP trend pullback with first-hour direction
def f(d,r):
    g=G[d]; g=g[(g.m>=570)&(g.m<955)]; tp=(g.h+g.l+g.cl)/3; v=g.v.replace(0,1)
    vw=((tp*v).cumsum()/v.cumsum()).values; m,o,h,l,c=A[d]; j=mi(m,1030); s=int(np.sign(c[j-1]-o[0]))
    for i in range(j,mi(m,1330)):
        if s==1 and l[i]<=vw[i]<c[i]: return trade(d,i+1,1,c[i],40,80)
        if s==-1 and h[i]>=vw[i]>c[i]: return trade(d,i+1,-1,c[i],40,80)
    return 0.0
reg('vwap_pullback 40/80',f)
# 6 NR7 / inside-day ORB breakout (compression -> expansion)
for flt in ('prev_nr','prev_inside'):
  for S,T in ((40,3),(0.5,2)):
    def f(d,r,flt=flt,S=S,T=T):
        if not r[flt]: return 0.0
        m,o,h,l,c=A[d]; n=15; hi,lo=h[:n].max(),l[:n].min(); SS=S*r.atr if S<5 else S
        for i in range(n,mi(m,1130)):
            if h[i]>hi: return trade(d,i+1,1,hi,SS,T*SS)
            if l[i]<lo: return trade(d,i+1,-1,lo,SS,T*SS)
        return 0.0
    reg(f'{flt} ORB15 S{S} T{T}',f)
# 7 trend-filtered breakouts (only with 20d trend)
for kind in ('on','pdh','orb15'):
    def f(d,r,kind=kind):
        if not r.trend: return 0.0
        m,o,h,l,c=A[d]; s0=0
        if kind=='on': hi,lo=r.onh,r.onl
        elif kind=='pdh': hi,lo=r.pdh,r.pdl
        else: s0=15; hi,lo=h[:15].max(),l[:15].min()
        SS=0.5*r.atr
        for i in range(s0,mi(m,1130)):
            if r.trend>0 and h[i]>hi and o[i]<=hi: return trade(d,i+1,1,hi,SS,2*SS)
            if r.trend<0 and l[i]<lo and o[i]>=lo: return trade(d,i+1,-1,lo,SS,2*SS)
        return 0.0
    reg(f'trendfilter {kind}_bo 2R',f)
# 8 London/overnight range breakout of 3:00-9:30 range at RTH
def f(d,r):
    g=G[d]; pre=g[(g.m>=180)&(g.m<570)]
    if len(pre)<100: return 0.0
    hi,lo=pre.h.max(),pre.l.min(); m,o,h,l,c=A[d]; SS=0.5*r.atr
    for i in range(0,mi(m,1130)):
        if h[i]>hi and o[i]<=hi: return trade(d,i+1,1,hi,SS,2*SS)
        if l[i]<lo and o[i]>=lo: return trade(d,i+1,-1,lo,SS,2*SS)
    return 0.0
reg('london_range_bo 2R',f)
# 9 overnight-session trades (Topstep allows): Asia session breakout of 18:00-20:00 range, exit 02:00
def f(d,r):
    g=G[d]; ev=g[(g.m>=1080)]; asia=g[(g.m<120)]
    if len(ev)<100: return 0.0
    hi,lo=ev[ev.m<1200].h.max(),ev[ev.m<1200].l.min(); seq=pd.concat([ev[ev.m>=1200],asia])
    H,Lw,C=seq.h.values,seq.l.values,seq.cl.values
    for i in range(len(H)):
        if H[i]>hi: return manage(i+1,1,hi,H,Lw,C,0.3*r.atr,0.6*r.atr,0,0)-COST
        if Lw[i]<lo: return manage(i+1,-1,lo,H,Lw,C,0.3*r.atr,0.6*r.atr,0,0)-COST
    return 0.0
reg('evening_range_bo',f)
# 10 day-of-week long bias open->close (Mon..Fri) and buy-the-dip close<prev low
for dow in range(5):
    def f(d,r,dow=dow):
        if pd.Timestamp(d).dayofweek!=dow: return 0.0
        m,o,h,l,c=A[d]; return c[-1]-o[0]-COST
    reg(f'long dow{dow}',f)
def f(d,r):
    i=pos[d]
    if i<2: return 0.0
    p=L.iloc[i-1]
    if not (p.close<p.rl+0.2*(p.rh-p.rl)) or r.trend<=0: return 0.0
    m,o,h,l,c=A[d]; return c[-1]-o[0]-COST
reg('buy after weak close in uptrend',f)
pickle.dump((STR,L),open('b2.pkl','wb'))
