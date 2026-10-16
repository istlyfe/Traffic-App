import pandas as pd,numpy as np,itertools,pickle
COST=0.75
df=pd.read_parquet('nq1m.parquet')
def bars(tf):
    b=df.resample(f'{tf}min',label='left',closed='left').agg({'o':'first','h':'max','l':'min','cl':'last','c':'last'}).dropna()
    b['m']=b.index.hour*60+b.index.minute; b['td']=(b.index+pd.Timedelta(hours=6)).date
    return b
def session(m):
    if m>=1080 or m<180: return 'asia'
    if m<570: return 'london'
    if m<960: return 'ny'
    return 'close'
def run(b,N=5,minleg=40,maxleg=400,tgt='zero',fib=0.786,buf=1.0,expiry=48,maxhold=96,trendf=False,bos=False,sweep=False,nyonly=False):
    tr=b['trend'].values if 'trend' in b else np.zeros(len(b))
    o,h,l,c,m,ct=b.o.values,b.h.values,b.l.values,b.cl.values,b.m.values,b.c.values
    n=len(h); trades=[]
    lastPH=None; lastPL=None; prevPH=None; prevPL=None
    pend=None   # dict(side,lvl,stop,tgt,start)
    pos=None
    i=2*N
    while i<n:
        mm=m[i]
        # forced flat 16:08-18:00 ET (Topstep), no entries then
        blocked = 968<=mm<1080
        # --- manage open position
        if pos:
            s,e,st,tg,fi=pos
            exitp=None
            if blocked or ct[i]!=pos_ct: exitp=o[i]
            elif s==-1:
                if h[i]>=st: exitp=st
                elif i>fi and l[i]<=tg: exitp=tg
            else:
                if l[i]<=st: exitp=st
                elif i>fi and h[i]>=tg: exitp=tg
            if exitp is None and i-fi>=maxhold: exitp=c[i]
            if exitp is not None:
                trades.append((b.td.iloc[fi],session(m[fi]),s*(exitp-e)-COST,abs(st-e),b.index[fi]))
                pos=None
        # --- confirm pivots at bar i (pivot at j=i-N)
        j=i-N
        if h[j]==h[j-N:j+N+1].max(): prevPH=lastPH; lastPH=(j,h[j])
        if l[j]==l[j-N:j+N+1].min(): prevPL=lastPL; lastPL=(j,l[j])
        # new leg set-ups when a pivot just confirmed
        if lastPH and lastPL and (j==lastPL[0] or j==lastPH[0]) and not pos:
            if lastPH[0]<lastPL[0] and j==lastPL[0]:   # bearish leg high->low: short at 0.786
                H,Lo=lastPH[1],lastPL[1]; leg=H-Lo
                ok=(not trendf or tr[i]<0) and (not bos or (prevPL is not None and Lo<prevPL[1])) and (not sweep or (prevPH is not None and H>prevPH[1]))
                if ok and minleg<=leg<=maxleg and h[lastPL[0]+1:i+1].max(initial=-1e9)<Lo+fib*leg:
                    pend=dict(s=-1,lvl=Lo+fib*leg,st=H+buf,zero=Lo,start=i,ext=Lo)
            elif lastPL[0]<lastPH[0] and j==lastPH[0]:  # bullish leg low->high: long at 0.786 down
                H,Lo=lastPH[1],lastPL[1]; leg=H-Lo
                ok=(not trendf or tr[i]>0) and (not bos or (prevPH is not None and H>prevPH[1])) and (not sweep or (prevPL is not None and Lo<prevPL[1]))
                if ok and minleg<=leg<=maxleg and l[lastPH[0]+1:i+1].min(initial=1e9)>H-fib*leg:
                    pend=dict(s=1,lvl=H-fib*leg,st=Lo-buf,zero=H,start=i,ext=H)
        # --- pending order
        if pend and not pos and not blocked and (not nyonly or 570<=mm<960):
            s=pend['s']
            if i-pend['start']>expiry: pend=None
            elif s==-1 and l[i]<pend['zero'] and h[i]<pend['lvl']: pend=None      # leg low broken first -> invalid
            elif s==1 and h[i]>pend['zero'] and l[i]>pend['lvl']: pend=None
            elif (s==-1 and h[i]>=pend['lvl']) or (s==1 and l[i]<=pend['lvl']):
                e=pend['lvl']; R=abs(pend['st']-e)
                if tgt=='zero': tg=pend['zero']
                else: tg=e+(-s)*0 + s*float(tgt)*R
                # fill bar: stop hit same bar?
                if (s==-1 and h[i]>=pend['st']) or (s==1 and l[i]<=pend['st']):
                    trades.append((b.td.iloc[i],session(m[i]),-R-COST,R,b.index[i]))
                else:
                    pos=(s,e,pend['st'],tg,i); pos_ct=ct[i]
                pend=None
        i+=1
    return pd.DataFrame(trades,columns=['td','sess','pts','R','t'])

def add_trend(b,rule):
    h1=df.cl.resample('60min').last().dropna()
    if rule=='1h_ema50': e=h1.ewm(span=50).mean(); t=np.sign(h1-e)
    else:
        h4=df.cl.resample('240min').last().dropna(); e=h4.ewm(span=20).mean(); t=np.sign(h4-e)
    t=t.shift(1)  # only completed bars
    b=b.copy(); b['trend']=t.reindex(b.index,method='ffill').fillna(0).values; return b
if __name__=='__main__':
    SPLIT=pd.Timestamp('2025-01-01').date(); rows=[]; store={}
    for tf in (5,15):
        base=bars(tf)
        for trule in ('1h_ema50','4h_ema20'):
            b=add_trend(base,trule)
            for N,minleg,tgt,ny in itertools.product((3,5,10),(30,60,120),('zero','2'),(True,False)):
                t=run(b,N,minleg,tgt=tgt,expiry=48 if tf==5 else 16,maxhold=96 if tf==5 else 32,trendf=True,bos=True,sweep=True,nyonly=ny)
                if len(t)<30: continue
                key=f"tf{tf} {trule} N{N} leg{minleg} tgt{tgt} NY{ny}"; store[key]=t
                yr=pd.to_datetime(t.td).dt.year; by=t.groupby(yr).pts.mean()
                row=dict(cfg=key,n=len(t),per_day=round(len(t)/1290,2),win=round((t.pts>0).mean(),2),avgW=round(t[t.pts>0].pts.mean(),1),avgL=round(t[t.pts<=0].pts.mean(),1),exp=round(t.pts.mean(),2),expR=round((t.pts/t.R).mean(),3),IS=round(t[t.td<SPLIT].pts.mean(),2),OOS=round(t[t.td>=SPLIT].pts.mean(),2),yrs_pos=f"{(by>0).sum()}/{len(by)}")
                rows.append(row); print(row,flush=True)
    pd.DataFrame(rows).to_csv('fib2.csv',index=False); pickle.dump(store,open('fib2.pkl','wb'))
