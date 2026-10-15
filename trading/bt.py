import json,pandas as pd,numpy as np
COST=0.75  # NQ points per round trip (comm+1 tick slip each side approx)
h=json.load(open('nq_1h.json'))
# continuous: per hour pick contract with max volume
rows=[]
for c,b in h.items():
    for x in b: rows.append((x['t'],c,x['o'],x['h'],x['l'],x['c'],x['v']))
df=pd.DataFrame(rows,columns='t c o h l cl v'.split())
df['t']=pd.to_datetime(df.t,utc=True)
# front = contract with most volume per day
df['d']=df.t.dt.tz_convert('America/New_York').dt.date
front=df.groupby(['d','c']).v.sum().reset_index().sort_values('v').groupby('d').tail(1).set_index('d').c
df=df[df.c==df.d.map(front)].sort_values('t').set_index('t')
df.index=df.index.tz_convert('America/New_York')
print('hourly bars',len(df),df.index[0],df.index[-1])
df['ret']=df.cl-df.o
df['hr']=df.index.hour
split=df.index[0]+(df.index[-1]-df.index[0])*2/3
IS,OOS=df[df.index<split],df[df.index>=split]
print('split',split.date())
# 1) hour-of-day drift: pick hours with |mean| significant in-sample, test OOS
g=IS.groupby('hr').ret.agg(['mean','std','count']); g['t']=g['mean']/(g['std']/np.sqrt(g['count']))
print(g.round(2).to_string())
sel=g[g.t.abs()>2]
res=[]
for hr,r in sel.iterrows():
    s=np.sign(r['mean']); o=OOS[OOS.hr==hr].ret*s-COST
    res.append((hr,'long' if s>0 else 'short',round(r['mean']*s-COST,2),len(o),round(o.mean(),2),round((o>0).mean(),2),round(o.sum(),1)))
print('\nHOUR DRIFT  hr side IS_avg OOS_n OOS_avg OOS_win OOS_total_pts');[print(x) for x in res]
