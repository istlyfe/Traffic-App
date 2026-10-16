exec(open('multi.py').read().split("yrs=len(D)/252")[0])
import pickle
F=pickle.load(open('fib2.pkl','rb'))['tf15 1h_ema50 N10 leg120 tgt2 NYTrue']
fib=F.groupby('td').pts.sum(); D['fib']=fib.reindex(D.index).fillna(0)
print('daily P&L correlation:\n',D[['tom','lon','fib']].corr().round(2).to_string())
yrs=len(D)/252
for sizes in ((2,2,2),(2,1,3),(1,1,2)):
    accts=[('TOM',D.tom,sizes[0]),('London',D.lon,sizes[1]),('Fib',D.fib,sizes[2])]
    P=pd.Series(dtype=float); tot=0; att=0; blows=0
    print(f"\n=== Sizes MNQ: TOM {sizes[0]}, London {sizes[1]}, Fib {sizes[2]} ===")
    for nm,v,n in accts:
        r=run_slot(v,0,n); tot+=r['withdrawn']; att+=r['attempts']; blows+=r['blows']
        for dday,w in r['payouts']: P.loc[pd.Timestamp(dday)]=P.get(pd.Timestamp(dday),0)+w
        print(f"  {nm:7} {n} MNQ: withdrawn ${r['withdrawn']:,.0f}, combines {r['attempts']}, funded blown {r['blows']}")
    net=tot-att*100
    mon=P.groupby([P.index.year,P.index.month]).sum() if len(P) else P
    print(f"  TOTAL withdrawn ${tot:,.0f}, combines {att} (~${att*100:,}), NET ${net:,.0f} = ~${net/yrs/12:,.0f}/month, ~${net/len(D):,.0f}/trading day")
    print(f"  months with payout {len(mon)} of {int(yrs*12)}; by year:",P.groupby(P.index.year).sum().round(0).to_dict())
