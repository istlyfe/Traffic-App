exec(open('battery.py').read().split('# --- DAILY')[0])
M1=cont('nq_1m.json')
ents=[]
for i in range(21,len(days)):
    d=days[i]; g=M1[M1.td==d].between_time('09:30','15:59')
    if g.empty: continue
    hi,lo=D.h.iloc[i-1],D.l.iloc[i-1]; R=D.rng.iloc[i-1]*0.5
    for t,x in g.between_time('09:30','11:29').iterrows():
        if x.h>hi: ents.append((d,t,1,hi,R)); break
        if x.l<lo: ents.append((d,t,-1,lo,R)); break
print('entries',len(ents))
def sim(stop0=None,trail=None,act=0,tp=None):
    res=[]
    for d,t,s,e,R in ents:
        g=M1[(M1.td==d)].between_time('09:30','15:55'); g=g[g.index>=t]
        st=e-s*(stop0 if stop0 else R); best=e; out=None
        for k,(tt,x) in enumerate(g.iterrows()):
            hit_stop=(x.l<=st) if s==1 else (x.h>=st)
            if hit_stop: out=s*(st-e); break
            if tp and ((s==1 and x.h>=e+tp) or (s==-1 and x.l<=e-tp)): out=tp; break
            best=max(best,x.h) if s==1 else min(best,x.l)
            if trail and s*(best-e)>=act:
                st=max(st,best-trail) if s==1 else min(st,best+trail)
        if out is None: out=s*(g.cl.iloc[-1]-e)
        res.append(out-COST)
    r=np.array(res); return f"win {(r>0).mean():4.0%}  avg {r.mean():6.1f}  worst {r.min():6.0f}  total {r.sum():6.0f}"
print('Baseline: stop 0.5xATR, target 125            ',sim(tp=125))
print('Baseline: stop 0.5xATR, no target (EOD)       ',sim())
for T in (10,20,30,50,75,100):
    print(f'Trail {T:3}pt from entry (stop={T})            ',sim(stop0=T,trail=T))
for T in (10,20,30,50):
  for act in (25,50,75):
    print(f'0.5xATR stop, trail {T:3} after +{act:3}, no TP    ',sim(trail=T,act=act))
for T in (30,50):
    print(f'0.5xATR stop, trail {T} after +50, TP 125        ',sim(trail=T,act=50,tp=125))
