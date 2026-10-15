exec(open('eval2.py').read().split('rows=[]')[0])
def full(pts,n):
    v=np.array([(x*2*n-(1.5*n if x!=0 else 0)) for x in pts.values]); N=len(v); res=[]
    for s in range(N-60):
        bal=hwm=best=0; o=('open',0)
        for k in range(s,N):
            d=v[k]
            if bal+d<=hwm-2000: o=('bust',k-s+1); break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: o=('pass',k-s+1); break
        res.append(o)
    o=pd.DataFrame(res,columns=['r','d']); p=o.r=='pass'
    return p.mean(),(o.r=='bust').mean(),(p&(o.d<=5)).mean(),o[p].d.median()
robust=['trendfilter orb15_bo 2R','london_range_bo 2R','grid orb_bo 30 0.5 2 0 0','grid orb_bo 15 100 3 0 0','grid on_bo 0 0.5 2 0 0','open_drive30 S80 T2','intraday_mom last hour','gap_fade 60-200']
M=pd.DataFrame({k:STR[k] for k in robust}).fillna(0)
print('corr of daily pnl:\n',M.corr().round(2).to_string())
ports={'P_all8':robust,'P_4 (trendORB15+london+ORB30+opendrive)':['trendfilter orb15_bo 2R','london_range_bo 2R','grid orb_bo 30 0.5 2 0 0','open_drive30 S80 T2'],
 'P_3 (trendORB15+gapfade+intramom)':['trendfilter orb15_bo 2R','gap_fade 60-200','intraday_mom last hour']}
cands={k:STR[k] for k in robust}
for pn,ks in ports.items(): cands[pn]=M[ks].sum(axis=1)
rows=[]
for name,s in cands.items():
    t=s[s!=0]; dd=(t.cumsum()-t.cumsum().cummax()).min()
    for n in (1,2,3,5,8,12):
        p,b,p5,md=full(s,n)
        rows.append(dict(strat=name,MNQ=n,exp_day=round(s.mean(),1),pass_=round(p,2),bust=round(b,2),pass_in_5d=round(p5,2),med_days=md))
D=pd.DataFrame(rows); pd.set_option('display.width',220); pd.set_option('display.max_colwidth',50)
print(D.to_string(index=False)); D.to_csv('port.csv',index=False)
print('\nBest pass_in_5d rows:'); print(D.sort_values('pass_in_5d',ascending=False).head(10).to_string(index=False))
