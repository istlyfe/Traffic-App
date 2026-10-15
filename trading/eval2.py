import pickle,pandas as pd,numpy as np
STR,L=pickle.load(open('b2.pkl','rb')); G=pickle.load(open('series.pkl','rb'))
for k in [('on_bo',0,0.5,2,0,0),('orb_bo',15,100,3,0,0),('pdh_bo',0,0.5,2,0,0),('orb_bo',30,0.5,2,0,0)]:
    STR['grid '+' '.join(map(str,k))]=G[k]
SPLIT=pd.Timestamp('2025-01-01').date()
def stats(s):
    t=s[s!=0]; yr=pd.Series(pd.to_datetime(t.index).year,index=t.index)
    by=t.groupby(yr.values).mean()
    return dict(n=len(t),win=(t>0).mean(),exp=t.mean(),IS=t[t.index<SPLIT].mean(),OOS=t[t.index>=SPLIT].mean(),yrs_pos=f"{(by>0).sum()}/{len(by)}")
def fast(pts,n,H=5):
    v=np.array([(x*2*n-(1.5*n if x!=0 else 0)) for x in pts.values]); N=len(v); P=B=0
    for s in range(N-H):
        bal=hwm=best=0
        for k in range(s,s+H):
            d=v[k]
            if bal+d<=hwm-2000: B+=1; break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: P+=1; break
    return P/(N-H),B/(N-H)
rows=[]
for name,s in STR.items():
    st=stats(s); rows.append(dict(name=name,**{k:(round(v,2) if isinstance(v,float) else v) for k,v in st.items()}))
R=pd.DataFrame(rows).sort_values('exp',ascending=False); pd.set_option('display.width',220)
print(R.to_string(index=False))
good=R[(R.IS>0)&(R.OOS>0)].name.tolist(); print('\nPositive in both periods:',good)
pickle.dump(good,open('good.pkl','wb'))
