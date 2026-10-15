import json,pandas as pd,numpy as np
COST=0.75
def cont(fn):
    b=json.load(open(fn)); rows=[(x['t'],c,x['o'],x['h'],x['l'],x['c'],x['v']) for c,v in b.items() for x in v]
    df=pd.DataFrame(rows,columns='t c o h l cl v'.split()); df['t']=pd.to_datetime(df.t,utc=True).dt.tz_convert('America/New_York')
    df['td']=(df.t+pd.Timedelta(hours=6)).dt.date
    f=df.groupby(['td','c']).v.sum().reset_index().sort_values('v').groupby('td').tail(1).set_index('td').c
    return df[df.c==df.td.map(f)].sort_values('t').set_index('t')
H=cont('nq_1h.json'); M5=cont('nq_5m.json')
# daily (RTH 9-16 from hourly)
r=H.between_time('09:00','15:00')
D=r.groupby('td').agg(o=('o','first'),h=('h','max'),l=('l','min'),cl=('cl','last'))
D['sma20']=D.cl.rolling(20).mean(); D['rng']=(D.h-D.l).rolling(14).mean()
SPLIT=D.index[int(len(D)*2/3)]
res=[]
def rec(tf,name,trades):
    t=pd.DataFrame(trades,columns=['td','pts'])
    if len(t)<8: return
    t.pts-=COST
    a,b=t[t.td<SPLIT],t[t.td>=SPLIT]
    f=lambda s:(len(s),round((s.pts>0).mean()*100) if len(s) else 0,round(s.pts.mean(),1) if len(s) else 0)
    res.append((tf,name,*f(a),*f(b)))
def exit_sl_tp(bars,side,e,stop,tgt):
    for _,x in bars.iterrows():
        if side*(x.l if side==1 else x.h)<=side*stop: return side*(stop-e)
        if side*(x.h if side==1 else x.l)>=side*tgt: return side*(tgt-e)
    return side*(bars.cl.iloc[-1]-e)
days=list(D.index)
# --- DAILY / 1h strategies (one year) ---
for k in (1,2,3):
  for mode in ('trend','any'):
    tr=[]
    for i in range(21,len(days)):
        d=days[i]; p=D.iloc[i-k:i]
        down=(p.cl.diff().dropna()<0).all() if k>1 else p.cl.iloc[-1]<p.o.iloc[-1]
        if down and (mode=='any' or D.cl.iloc[i-1]>D.sma20.iloc[i-1]): tr.append((d,D.cl.iloc[i]-D.o.iloc[i]))
    rec('Daily',f'Buy dip after {k} down day(s){" in uptrend" if mode=="trend" else ""}, hold day',tr)
for dow in range(5):
    rec('Daily',f'Long every {"Mon Tue Wed Thu Fri".split()[dow]} (open->close)',[(d,D.cl[d]-D.o[d]) for d in days if pd.Timestamp(d).dayofweek==dow])
for frac in (0.5,1.0):
  for fade in (True,False):
    tr=[]
    for i in range(21,len(days)):
        d=days[i]; pdh,pdl=D.h.iloc[i-1],D.l.iloc[i-1]; R=D.rng.iloc[i-1]*frac
        g=H[(H.td==d)].between_time('09:00','15:00')
        for t,x in g.iterrows():
            if x.h>pdh: s=-1 if fade else 1; e=pdh
            elif x.l<pdl: s=1 if fade else -1; e=pdl
            else: continue
            tr.append((d,exit_sl_tp(g[g.index>=t],s,e,e-s*R,e+s*R))); break
    rec('1h',f'PDH/PDL {"fade" if fade else "breakout"}, stop/target {frac}x ATR',tr)
for mult in (2,2.5):
  for hold in (1,3):
    rng=(H.h-H.l); avg=rng.rolling(48).mean(); tr=[]
    idx=np.where((rng>mult*avg)&(H.index.hour.isin(range(9,15))))[0]
    for i in idx:
        if i+hold>=len(H): continue
        s=-np.sign(H.cl.iloc[i]-H.o.iloc[i]); tr.append((H.td.iloc[i],s*(H.cl.iloc[i+hold]-H.cl.iloc[i])))
    rec('1h',f'Fade big candle >{mult}x avg range, hold {hold}h',tr)
    tr=[(a,-p) for a,p in tr]; rec('1h',f'Follow big candle >{mult}x avg range, hold {hold}h',tr)
# --- 4h: trend follow on 4h close vs 20-bar SMA ---
H4=H.resample('4h',offset='2h').agg({'o':'first','h':'max','l':'min','cl':'last','td':'last'}).dropna()
sma=H4.cl.rolling(20).mean(); tr=[]
for i in range(21,len(H4)-1):
    s=1 if H4.cl.iloc[i]>sma.iloc[i] else -1; tr.append((H4.td.iloc[i+1],s*(H4.cl.iloc[i+1]-H4.o.iloc[i+1])))
rec('4h','Trend: next 4h bar in direction of 20-SMA',tr)
# --- 5m / 15m (2 months only) ---
SPLIT5=None
rth=M5.between_time('09:30','15:55'); prevclose=M5.between_time('15:55','15:55').groupby('td').cl.last()
tds=sorted(rth.td.unique()); g5=[]
for i,d in enumerate(tds[1:],1):
    g=rth[rth.td==d]; pc=prevclose.get(tds[i-1]); 
    if pc is None or len(g)<60: continue
    o=g.o.iloc[0]; gap=o-pc; s=-np.sign(gap)
    if 5<abs(gap)<80: g5.append((d,exit_sl_tp(g,s,o,o-s*abs(gap),pc)))
rec('5m','Gap fill (5-80pt gap), stop = gap size',g5)
for tf,mins in (('5m',5),('15m',15)):
    b=rth.groupby('td').resample(f'{mins}min',origin='start_day',offset='30min').agg({'o':'first','h':'max','l':'min','cl':'last','v':'sum'}).dropna().reset_index(level=0)
    tr=[];tr2=[]
    for d,g in b.groupby('td'):
        g=g.between_time('09:30','15:55'); 
        if len(g)<4: continue
        tp=(g.h+g.l+g.cl)/3; vw=(tp*g.v).cumsum()/g.v.cumsum()
        fh=g.between_time('09:30','10:25'); 
        if fh.empty: continue
        mv=fh.cl.iloc[-1]-fh.o.iloc[0]; s=np.sign(mv)
        aft=g.between_time('10:30','15:55')
        if abs(mv)>40 and len(aft): tr2.append((d,s*(aft.cl.iloc[-1]-aft.o.iloc[0])))
        # VWAP pullback in trend after 10:00
        for t,x in g.between_time('10:00','13:00').iterrows():
            if s>0 and x.l<=vw[t]<x.cl: tr.append((d,exit_sl_tp(g[g.index>t],1,x.cl,x.l-5,x.cl+2*(x.cl-x.l+5)))); break
            if s<0 and x.h>=vw[t]>x.cl: tr.append((d,exit_sl_tp(g[g.index>t],-1,x.cl,x.h+5,x.cl-2*(x.h+5-x.cl)))); break
    rec(tf,'VWAP pullback with first-hour direction, 2R',tr); rec(tf,'First hour >40pt -> hold same direction 10:30-close',tr2)
out=pd.DataFrame(res,columns=['TF','Strategy','IS_n','IS_win%','IS_avgpt','OOS_n','OOS_win%','OOS_avgpt'])
pd.set_option('display.width',250); pd.set_option('display.max_colwidth',60)
print('split date',SPLIT); print(out.to_string(index=False))
out.to_csv('battery.csv',index=False)
