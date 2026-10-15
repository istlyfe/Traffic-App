import json,urllib.request,urllib.error,time
B="https://api.topstepx.com/api/";import os; T=os.environ['PROJECTX_TOKEN']
def post(p,b):
    for i in range(8):
        try:
            r=urllib.request.Request(B+p,json.dumps(b).encode(),{'Authorization':'Bearer '+T,'Content-Type':'application/json'})
            return json.load(urllib.request.urlopen(r,timeout=120))
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(5*(i+1)); continue
            print(e.read()); raise
def bars(c,s,e,unit=2,n=5):
    return post('History/retrieveBars',{'contractId':c,'live':False,'startTime':s,'endTime':e,'unit':unit,'unitNumber':n,'limit':20000,'includePartialBar':False})
