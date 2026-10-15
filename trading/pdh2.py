exec(open('battery.py').read().split('# --- DAILY')[0])
import sim
def run(bars,frac,start,end,maxtr,days_sel):
    tr=[]
    for i in range(21,len(days)):
        d=days[i]
        if d not in days_sel: continue
        hi,lo=D.h.iloc[i-1],D.l.iloc[i-1]; R=D.rng.iloc[i-1]*frac
        g=bars[bars.td==d].between_time('09:00','15:55'); n=0; busy_until=None; used={1:False,-1:False}
        for t,x in g.iterrows():
            hm=t.strftime('%H:%M')
            if n>=maxtr or hm<start or hm>=end: continue
            if busy_until is not None and t<=busy_until: continue
            s=1 if (x.h>hi and not used[1]) else (-1 if (x.l<lo and not used[-1]) else 0)
            if not s: continue
            e=hi if s==1 else lo; used[s]=True
            rest=g[g.index>=t]; stop,tgt=e-s*R,e+s*R; pts=None
            for tt,y in rest.iterrows():
                if (s==1 and y.l<=stop) or (s==-1 and y.h>=stop): pts=-R; busy_until=tt; break
                if (s==1 and y.h>=tgt) or (s==-1 and y.l<=tgt): pts=R; busy_until=tt; break
            if pts is None: pts=s*(rest.cl.iloc[-1]-e); busy_until=rest.index[-1]
            pts-=COST; n+=1; tr.append(dict(td=d,t=t,side=s,risk=R,pts=pts,R=pts/R))
            if pts<0: break   # stop after one loss
    return pd.DataFrame(tr)
sim.df=H; allD=set(days); rec5=set(M5.td.unique())
for frac in (0.5,1.0):
  for st,en,lab in (('09:00','16:00','all day'),('09:30','11:30','9:30-11:30'),('09:00','12:00','9-12 (hourly bars)')):
    for mx in (1,2):
        B=H if lab!='9:30-11:30' else M5
        sel=allD if B is H else rec5
        t=run(B,frac,st,en,mx,sel)
        if B is M5:
            print(f'\n[5m, last 2 months] ATR x{frac} {lab} max{mx}/day: n={len(t)} win={(t.pts>0).mean():.0%} exp={t.pts.mean():.1f}pt total={t.pts.sum():.0f}')
        else:
            a,b=t[t.td<SPLIT],t[t.td>=SPLIT]
            print(f'\n[1h, 1yr] ATR x{frac} {lab} max{mx}/day: IS win {(a.pts>0).mean():.0%} exp {a.pts.mean():.1f} | OOS win {(b.pts>0).mean():.0%} exp {b.pts.mean():.1f}')
            sim.report('  combine',t)
