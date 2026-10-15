exec(open('research.py').read())
import pickle
SPLIT=pd.Timestamp('2025-01-01').date()
def combine(pts,n,horizon=None):
    v=[(x*2*n-(1.5*n if x!=0 else 0)) for x in pts.values]; N=len(v); P=B=0; P3=0; dl=[]
    for s in range(N):
        bal=hwm=best=0
        for k in range(s,N if horizon is None else min(N,s+horizon)):
            d=v[k]
            if bal+d<=hwm-2000: B+=1; break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: P+=1; dl.append(k-s+1); break
    return P/N,B/N,(np.median(dl) if dl else np.nan)
rows=[]; series={}
kinds=[('pdh_bo',0),('pdh_fade',0),('on_bo',0),('on_fade',0),('orb_bo',5),('orb_bo',15),('orb_bo',30),('orb_fade',15),('orb_fade',5)]
exits=[]
for S in (20,40,60,100,0.5):
    for T in (1,2,3): exits.append((S,T,0,0))
    exits.append((S,0,S if S>=5 else 50,(S/2 if S>=5 else 25)))
for (k,p),(S,T,a,tr) in itertools.product(kinds,exits):
    if S==0.5 and a: a,tr=50,25
    s=run(k,p,S,T,a,tr); series[(k,p,S,T,a,tr)]=s
    tr_=s[s!=0]; i,o=tr_[tr_.index<SPLIT],tr_[tr_.index>=SPLIT]
    rows.append(dict(kind=k,par=p,stop=S,tgt=T,act=a,trail=tr,n=len(tr_),win=(tr_>0).mean(),IS_exp=i.mean(),OOS_exp=o.mean(),OOS_win=(o>0).mean()))
    print(rows[-1],flush=True)
R=pd.DataFrame(rows); R.to_csv('grid.csv',index=False); pickle.dump(series,open('series.pkl','wb'))
