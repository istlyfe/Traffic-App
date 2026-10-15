import pickle,pandas as pd,numpy as np
R=pd.read_csv('grid.csv'); S=pickle.load(open('series.pkl','rb'))
R['both']=R[['IS_exp','OOS_exp']].min(axis=1)
top=R.sort_values('both',ascending=False).head(12)
def sim(pts,n):
    v=np.array([(x*2*n-(1.5*n if x!=0 else 0)) for x in pts.values]); N=len(v); res=[]
    for s in range(N-60):
        bal=hwm=best=0; out=('open',None)
        for k in range(s,N):
            d=v[k]
            if bal+d<=hwm-2000: out=('bust',k-s+1); break
            bal+=d; hwm=max(hwm,bal); best=max(best,d)
            if bal>=3000 and best<0.5*bal: out=('pass',k-s+1); break
        res.append(out)
    o=pd.DataFrame(res,columns=['r','d'])
    p=o.r=='pass'; b=o.r=='bust'
    return p.mean(),b.mean(),(p&(o.d<=3)).mean(),(p&(o.d<=5)).mean(),o[p].d.median()
rows=[]
for _,r in top.iterrows():
    key=(r.kind,int(r.par),r.stop if r.stop<5 else int(r.stop),int(r.tgt) if r.tgt>=1 or r.tgt==0 else r.tgt,int(r.act),r.trail if r.trail%1 else int(r.trail))
    s=[v for k,v in S.items() if k[0]==r.kind and k[1]==r.par and float(k[2])==r.stop and float(k[3])==r.tgt and float(k[4])==r.act and float(k[5])==r.trail][0]
    stop_pts=r.stop if r.stop>=5 else 0.5*200
    for n in (2,4,6,10,15):
        p,b,p3,p5,md=sim(s,n)
        rows.append(dict(strat=f"{r.kind}{'' if not r.par else r.par} stop={r.stop} tgt={r.tgt}R trail={r.act}/{r.trail}",MNQ=n,pass_=round(p,2),bust=round(b,2),pass_le3d=round(p3,2),pass_le5d=round(p5,2),med_days=md))
D=pd.DataFrame(rows); pd.set_option('display.width',250); pd.set_option('display.max_colwidth',60)
print(D.to_string(index=False)); D.to_csv('comb.csv',index=False)
