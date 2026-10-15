import sys; sys.argv=['x']
exec(open('battery.py').read().split('# --- DAILY')[0])
import sim
def pdh(bars,frac,days_sel):
    tr=[]
    for i in range(21,len(days)):
        d=days[i]
        if d not in days_sel: continue
        pdh_,pdl_=D.h.iloc[i-1],D.l.iloc[i-1]; R=D.rng.iloc[i-1]*frac
        g=bars[bars.td==d].between_time('09:00','15:55')
        for t,x in g.iterrows():
            if x.h>pdh_: s,e=1,pdh_
            elif x.l<pdl_: s,e=-1,pdl_
            else: continue
            pts=exit_sl_tp(g[g.index>=t],s,e,e-s*R,e+s*R)-COST
            tr.append(dict(td=d,t=t,side=s,risk=R,pts=pts,R=pts/R)); break
    return pd.DataFrame(tr)
recent=set(M5.td.unique())
for frac in (0.5,1.0):
    a=pdh(H,frac,recent); b=pdh(M5,frac,recent)
    print(f'ATR x{frac}, last ~44 days: hourly-bar sim win {(a.pts>0).mean():.0%} avg {a.pts.mean():.1f}pt n={len(a)} | 5m-bar sim win {(b.pts>0).mean():.0%} avg {b.pts.mean():.1f}pt n={len(b)}')
# full-year combine sim using hourly trades
sim.df=H
for frac in (0.5,1.0):
    tr=pdh(H,frac,set(days)); sim.report(f'PDH/PDL breakout, stop & target {frac}x ATR (1 yr, hourly)',tr)
