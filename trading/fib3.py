exec(open('fib2.py').read().split("if __name__=='__main__':")[0])
SPLIT=pd.Timestamp('2025-01-01').date()
b=add_trend(bars(5),'1h_ema50')
for name,kw in [('no filters',{}),('trend only',dict(trendf=True)),('BOS only',dict(bos=True)),('sweep only',dict(sweep=True)),('NY only',dict(nyonly=True)),
                ('trend+NY',dict(trendf=True,nyonly=True)),('trend+BOS+NY',dict(trendf=True,bos=True,nyonly=True)),('all 4',dict(trendf=True,bos=True,sweep=True,nyonly=True))]:
    for leg in (60,120):
        t=run(b,10,leg,tgt='2',expiry=48,maxhold=96,**kw)
        yr=pd.to_datetime(t.td).dt.year; by=t.groupby(yr).pts.mean()
        print(f"{name:14} leg{leg}: n={len(t):5} per_day={len(t)/1290:.2f} win={(t.pts>0).mean():.0%} exp={t.pts.mean():+.1f} IS={t[t.td<SPLIT].pts.mean():+.1f} OOS={t[t.td>=SPLIT].pts.mean():+.1f} yrs+={(by>0).sum()}/{len(by)}",flush=True)
