import json,pandas as pd,numpy as np
SLIP=0.5      # NQ points slippage per round trip
FEE=1.5       # $ per MNQ contract round trip
PV=2.0        # MNQ $/point
b=json.load(open('nq_5m.json'))
rows=[(x['t'],c,x['o'],x['h'],x['l'],x['c'],x['v']) for c,v in b.items() for x in v]
df=pd.DataFrame(rows,columns='t c o h l cl v'.split()); df['t']=pd.to_datetime(df.t,utc=True).dt.tz_convert('America/New_York')
# trading day: session starts 18:00 ET
df['td']=(df.t+pd.Timedelta(hours=6)).dt.date
front=df.groupby(['td','c']).v.sum().reset_index().sort_values('v').groupby('td').tail(1).set_index('td').c
df=df[df.c==df.td.map(front)].sort_values('t').set_index('t')

def manage(bars,side,entry,stop,tgt):
    for _,x in bars.iterrows():
        if side==1:
            if x.l<=stop: return stop-entry
            if x.h>=tgt: return tgt-entry
        else:
            if x.h>=stop: return entry-stop
            if x.l<=tgt: return entry-tgt
    return side*(bars.cl.iloc[-1]-entry) if len(bars) else 0

def run(strategy,rr=1.0,start='09:30',end='11:30',orm=15):
    trades=[]
    for td,g in df.groupby('td'):
        on=g[g.index.strftime('%H:%M')<'09:30'] if False else g[(g.index.strftime('%H:%M')>='18:00')|(g.index.strftime('%H:%M')<'09:30')]
        rth=g.between_time('09:30','15:55')
        if len(rth)<60 or on.empty: continue
        if strategy=='orfade':
            n=orm//5; r=rth.iloc[:n]; hi,lo=r.h.max(),r.l.min(); mid=(hi+lo)/2; lvl=None
        else:
            hi,lo=on.h.max(),on.l.min()
        win=rth.iloc[(orm//5 if strategy=='orfade' else 0):]
        win=win[(win.index.strftime('%H:%M')>=start)&(win.index.strftime('%H:%M')<end)]
        ext_hi,ext_lo=-1e9,1e9
        for i,(t,x) in enumerate(win.iterrows()):
            ext_hi,ext_lo=max(ext_hi,x.h),min(ext_lo,x.l)
            side=0
            if x.h>hi and x.cl<hi: side,stop=-1,ext_hi+2
            elif x.l<lo and x.cl>lo: side,stop=1,ext_lo-2
            if not side: continue
            e=x.cl; risk=abs(e-stop)
            if risk<4 or risk>80: continue
            tgt=(mid if strategy=='orfade' and rr==0 else e+side*rr*risk)
            rest=rth[rth.index>t]
            pts=manage(rest,side,e,stop,tgt)-SLIP
            trades.append(dict(td=td,t=t,side=side,risk=risk,pts=pts,R=pts/risk))
            break   # one trade per day
    return pd.DataFrame(trades)

def combine(tr,risk_usd,max_ct=50,target=3000,mll=2000,dll=None):
    """Topstep 50K: trailing EOD max loss, profit target, consistency (best day < 50% of profit)."""
    days=sorted(df.td.unique()); res=[]
    byday=tr.groupby('td')
    for s in range(len(days)):
        bal=hwm=0; daily=[]
        out='timeout'; nd=0
        for d in days[s:]:
            nd+=1; pnl=0
            if d in byday.groups:
                for _,x in byday.get_group(d).iterrows():
                    ct=int(min(max_ct,max(1,risk_usd//(x.risk*PV))))
                    pnl+=x.pts*PV*ct-FEE*ct
            # intraday bust check (worst case = realized trade)
            if bal+pnl<=hwm-mll: out='bust'; break
            bal+=pnl; daily.append(pnl); hwm=max(hwm,bal)
            if bal>=target and max(daily)<0.5*bal: out='pass'; break
        res.append((out,nd))
    r=pd.DataFrame(res,columns=['out','days'])
    return r
def report(name,tr):
    if tr.empty: print(name,'no trades'); return
    w=tr[tr.pts>0]; l=tr[tr.pts<=0]
    print(f"\n== {name}: n={len(tr)} win={len(w)/len(tr):.0%} avgW={w.pts.mean():.1f}pt avgL={l.pts.mean():.1f}pt exp={tr.pts.mean():.1f}pt/trade avgR={tr.R.mean():.2f}")
    for risk in (200,400,750):
        r=combine(tr,risk)
        c=r.out.value_counts(normalize=True)
        print(f"   risk ${risk}/trade: pass {c.get('pass',0):.0%} bust {c.get('bust',0):.0%} unfinished {c.get('timeout',0):.0%}  avg days to pass {r[r.out=='pass'].days.mean():.1f}")
if __name__=='__main__':
    for rr in (0,1,1.5):
        report(f'1 OR-fade 15m, target={"OR mid" if rr==0 else str(rr)+"R"}, 9:30-11:30',run('orfade',rr))
    for rr in (1,1.5,2):
        report(f'2 ONH/ONL sweep, target {rr}R, 9:30-11:30',run('sweep',rr))
    print('\n#6 time filter: same setups all day vs morning only')
    report('1 OR-fade OR-mid ALL DAY 9:45-15:30',run('orfade',0,end='15:30'))
    report('2 sweep 1.5R ALL DAY 9:30-15:30',run('sweep',1.5,end='15:30'))
