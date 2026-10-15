import pandas as pd,numpy as np,itertools,pickle
COST=0.75
df=pd.read_parquet('nq1m.parquet'); df['m']=df.index.hour*60+df.index.minute
DAYS={d:(g.m.values,g.o.values,g.h.values,g.l.values,g.cl.values) for d,g in df.groupby('td')}
WIN={'0300':(180,240),'1000':(600,660),'1400':(840,900)}
def run(tf=1,look=30,rr=2.0,minfvg=2.0,maxhold=120,multi=False,windows=('0300','1000','1400'),maxrisk=60):
    trades=[]
    for d,(m,o,h,l,c) in DAYS.items():
        if tf>1:  # resample to tf-minute bars by grouping minute index
            k=m//tf; u,ix=np.unique(k,return_index=True)
            o2=o[ix]; c2=np.append(c[ix[1:]-1],c[-1]); h2=np.maximum.reduceat(h,ix); l2=np.minimum.reduceat(l,ix); m2=u*tf
            m,o,h,l,c=m2,o2,h2,l2,c2
        lb=max(3,look//tf)
        for w in windows:
            a,b=WIN[w]; idx=np.where((m>=a)&(m<b))[0]
            if len(idx)<5: continue
            i=idx[0]; taken=0
            while i<=idx[-1]:
                if i<lb+3: i+=1; continue
                sig=None
                # bullish: sweep of prior low in last few bars then bullish FVG at i (l[i]>h[i-2])
                prevlow=l[i-lb-2:i-2].min(); prevhigh=h[i-lb-2:i-2].max()
                swl=l[i-3:i].min(); swh=h[i-3:i].max()
                if l[i]-h[i-2]>=minfvg and swl<prevlow:
                    e=l[i]; st=swl-1; sig=(1,e,st)
                elif l[i-2]-h[i]>=minfvg and swh>prevhigh:
                    e=h[i]; st=swh+1; sig=(-1,e,st)
                if not sig: i+=1; continue
                s,e,st=sig; R=abs(e-st)
                if R<4 or R>maxrisk: i+=1; continue
                tg=e+s*rr*R; filled=None
                # wait for retrace fill until window end
                for j in range(i+1,len(m)):
                    if m[j]>=b: break
                    if (s==1 and l[j]<=e) or (s==-1 and h[j]>=e): filled=j; break
                if filled is None: i+=1; continue
                res=None; end=min(len(m),filled+max(1,maxhold//tf))
                for j in range(filled,end):
                    if (s==1 and l[j]<=st) or (s==-1 and h[j]>=st): res=-R; break
                    if j>filled or True:
                        if (s==1 and h[j]>=tg) or (s==-1 and l[j]<=tg):
                            if j==filled: continue  # ambiguous same bar: skip target on fill bar
                            res=rr*R; break
                if res is None: res=s*(c[end-1]-e)
                trades.append(dict(td=d,w=w,pts=res-COST,R=R,rmult=(res-COST)/R))
                taken+=1; i=j+1
                if not multi: break
    return pd.DataFrame(trades)
if __name__=='__main__':
    SPLIT=pd.Timestamp('2025-01-01').date(); rows=[]; store={}
    for tf,look,rr,multi,mr in itertools.product((1,5),(15,30,60),(1.0,2.0,3.0),(False,True),(40,100)):
        t=run(tf,look,rr,2.0 if tf==1 else 4.0,120,multi,maxrisk=mr)
        if t.empty: continue
        y=pd.to_datetime(t.td).dt.year; by=t.groupby(y).pts.mean()
        key=f"tf{tf} look{look} rr{rr} multi{multi} maxrisk{mr}"; store[key]=t
        rows.append(dict(cfg=key,n=len(t),per_day=round(len(t)/len(DAYS),2),win=round((t.pts>0).mean(),2),avgR=round(t.rmult.mean(),3),exp_pts=round(t.pts.mean(),2),
            IS=round(t[t.td<SPLIT].pts.mean(),2),OOS=round(t[t.td>=SPLIT].pts.mean(),2),yrs_pos=f"{(by>0).sum()}/{len(by)}",risk_med=round(t.R.median(),1)))
        print(rows[-1],flush=True)
    pd.DataFrame(rows).to_csv('sb.csv',index=False); pickle.dump(store,open('sb.pkl','wb'))
