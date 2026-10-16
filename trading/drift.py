import pandas as pd,numpy as np
COST=0.75
df=pd.read_parquet('nq1m.parquet')
h=df.resample('60min',label='left',closed='left').agg({'o':'first','cl':'last','c':'last','td':'last'}).dropna()
h['r']=h.cl-h.o; h['hr']=h.index.hour; h['dow']=h.index.dayofweek
SPLIT=pd.Timestamp('2025-01-01',tz='America/New_York')
print('=== Hour-of-day long drift (pts per hour, before cost) ===')
g=h.groupby('hr').r
tab=pd.DataFrame({'all':g.mean(),'IS':h[h.index<SPLIT].groupby('hr').r.mean(),'OOS':h[h.index>=SPLIT].groupby('hr').r.mean(),
 'yrs_pos':h.groupby(['hr',h.index.year]).r.mean().gt(0).groupby('hr').sum()})
print(tab.round(2).to_string())
def window_trade(start_h,end_h,side=1,days=None,name=''):
    # enter at start_h open (ET), exit at end_h open; may span midnight; same contract only
    rows=[]
    m=df.cl; idx=df.index
    starts=idx[(idx.hour==start_h)&(idx.minute==0)]
    if days is not None: starts=starts[np.isin(starts.dayofweek,days)]
    for t in starts:
        t2=t+pd.Timedelta(hours=(end_h-start_h)%24)
        try: a=df.loc[t]; b=df.loc[t2]
        except KeyError: continue
        if a.c!=b.c: continue
        rows.append((t,side*(b.o-a.o)-COST))
    s=pd.DataFrame(rows,columns=['t','pts']).set_index('t').pts
    y=s.groupby(s.index.year).mean()
    print(f"{name:40} n={len(s):4} win={(s>0).mean():.0%} avg={s.mean():+6.1f} IS={s[s.index<SPLIT].mean():+6.1f} OOS={s[s.index>=SPLIT].mean():+6.1f} yrs+={(y>0).sum()}/{len(y)} worst={s.min():.0f}")
    return s
print('\n=== Session holds (long unless noted) ===')
S={}
S['eve_to_open']=window_trade(18,9,1,None,'Long 18:00 -> 09:00 (overnight session)')
S['eve_to_2am']=window_trade(18,2,1,None,'Long 18:00 -> 02:00 (Asia)')
S['2am_to_9']=window_trade(2,9,1,None,'Long 02:00 -> 09:00 (London)')
S['rth']=window_trade(10,15,1,None,'Long 10:00 -> 15:00 (RTH body)')
S['last']=window_trade(15,16,1,None,'Long 15:00 -> 16:00 (last hour)')
for d,nm in enumerate(['Mon','Tue','Wed','Thu','Fri']):
    pass
S['sun_eve']=window_trade(18,9,1,[6],'Long Sunday 18:00 -> Mon 09:00')
S['eve_weekdays']=window_trade(18,9,1,[0,1,2,3],'Long Mon-Thu eve 18:00 -> 09:00')
# turn of month: last trading day + first 3, hold RTH 9:30-15:55
d=df.between_time('09:30','15:55').groupby('td').agg(o=('o','first'),cl=('cl','last'))
d.index=pd.to_datetime(d.index); d['ym']=d.index.to_period('M')
d['rank']=d.groupby('ym').cumcount(); d['rrank']=d.groupby('ym').cumcount(ascending=False)
tom=d[(d['rank']<3)|(d['rrank']==0)]; r=tom.cl-tom.o-COST; nr=d.drop(tom.index); r2=nr.cl-nr.o-COST
for nm,s in (('Turn-of-month RTH long',r),('Other days RTH long',r2)):
    y=s.groupby(s.index.year).mean()
    print(f"{nm:40} n={len(s):4} win={(s>0).mean():.0%} avg={s.mean():+6.1f} IS={s[s.index<'2025'].mean():+6.1f} OOS={s[s.index>='2025'].mean():+6.1f} yrs+={(y>0).sum()}/{len(y)}")
import pickle; pickle.dump(S,open('drift.pkl','wb'))
