"""Milestone 1 balance reference model for AGENT: Survival Protocol.

Used to pick the numbers in docs/decisions.md, section G. A reference, not a
spec: the TypeScript engine only has to land inside the balance targets.
Run with Python 3, no dependencies:  python3 docs/balance/reference_sim.py
"""
import random, math, statistics, heapq, sys, json
from collections import deque

DT, T_END, HOP = 0.05, 300.0, 0.15

def make_params(**over):
    P = dict(
        start_budget=500.0, bankrupt=-1000.0,
        lam0=3.0, lam1=8.0, lam2=16.0,          # req/s at 0:00, 2:00, 5:00
        spike=(210.0, 230.0, 1.8),              # 3:30-3:50 viral spike x1.8
        cshare0=0.20, cshare1=0.35,             # complex share ramps over 5 min
        cats={'S': dict(inp=500, out=200, deadline=6.0, rev=0.30),
              'C': dict(inp=1200, out=600, deadline=12.0, rev=5.00)},
        models={'FRONTIER': dict(build=20, up=0.0, conc=64, ttft=0.35, prefill=10000, tpot=0.010, pin=1.00, pout=5.00, H={'S':0.01,'C':0.03}),
                'SLM':      dict(build=60, up=30.0, conc=8, ttft=0.08, prefill=20000, tpot=0.0025, pin=0.04, pout=0.08, H={'S':0.02,'C':0.40})},
        cache=dict(build=70, up=9.0, lat=0.03, maxhit={'S':0.40,'C':0.08}, warm=150, falsehit=0.015),
        router=dict(build=65, up=6.0, lat=0.04, acc=0.92),
        guard=dict(build=55, up=12.0, lat=0.15, conc=24, catch=0.85, fp=0.01),
        W=dict(halluc=15.0, timeout=4.0, refusal=0.5), tau=30.0, prior=90.0, crit=25.0, grace=15.0)
    P.update(over); return P

class Req:
    __slots__=('cat','dl','hall','model')
    def __init__(s,cat,dl): s.cat=cat; s.dl=dl; s.hall=False; s.model=None

class Server:
    def __init__(s,name,conc,kind): s.name=name; s.conc=conc; s.kind=kind; s.q=deque(); s.act=[]
    def load(s): return len(s.q)+len(s.act)

def poisson(l, rnd):
    L=math.exp(-l); k=0; p=1.0
    while True:
        p*=rnd.random()
        if p<=L: return k
        k+=1

def run(build, P, seed, switch_at=None, switch_to=None):
    rnd=random.Random(seed)
    st=dict(budget=P['start_budget'], S=P['prior'], N=P['prior'], seen=0, dead=None, cause=None,
            hall_esc=0, timeouts=0, refusals=0, served=0, mintrust=100.0)
    cfg={}
    def apply(b, pay=True):
        nonlocal cfg
        cost=0
        new=dict(b)
        for k in ('cache','router','guard'):
            if new.get(k) and not cfg.get(k): cost+=P[k]['build']
        for m in ('FRONTIER','SLM'):
            have=cfg.get(m,0); want=new.get(m,0)
            if want>have: cost+=(want-have)*P['models'][m]['build']
        if pay: st['budget']-=cost
        cfg=new
        servers.clear()
        for m in ('FRONTIER','SLM'):
            for i in range(cfg.get(m,0)):
                servers.setdefault(m,[]).append(Server(f'{m}{i}',P['models'][m]['conc'],m))
        if cfg.get('guard'): servers['GUARD']=[Server('G',P['guard']['conc'],'GUARD')]
    servers={}
    # keep old servers' in-flight work simple: switch only happens once, we migrate queues
    apply(build)
    events=[]; seq=0
    def sched(t,req,stage):
        nonlocal seq; heapq.heappush(events,(t,seq,req,stage)); seq+=1
    def outcome(kind):
        sc={'good':1.0,'refusal':1-P['W']['refusal'],'timeout':1-P['W']['timeout'],'halluc':1-P['W']['halluc']}[kind]
        st['S']+=sc; st['N']+=1
    def trust(): return 100*max(0.0,min(1.0,st['S']/st['N']))
    def upkeep_per_s():
        u=0
        for k in ('cache','router','guard'):
            if cfg.get(k): u+=P[k]['up']
        for m in ('FRONTIER','SLM'): u+=cfg.get(m,0)*P['models'][m]['up']
        return u/60.0
    def lam(t):
        l = P['lam0']+(P['lam1']-P['lam0'])*t/120 if t<120 else P['lam1']+(P['lam2']-P['lam1'])*(t-120)/180
        a,b,m=P['spike']
        return l*m if a<=t<b else l
    def pick(m):
        return min(servers[m], key=lambda s:(s.load(), s.name))
    def to_model(t,req):
        if cfg.get('router'):
            hasF=cfg.get('FRONTIER',0)>0; hasS=cfg.get('SLM',0)>0
            correct='SLM' if req.cat=='S' else 'FRONTIER'
            wrong='FRONTIER' if correct=='SLM' else 'SLM'
            m = correct if rnd.random()<P['router']['acc'] else wrong
            if m=='SLM' and not hasS: m='FRONTIER'
            if m=='FRONTIER' and not hasF: m='SLM'
            sched(t+HOP+P['router']['lat'],req,('Q',m))
        else:
            m='FRONTIER' if cfg.get('FRONTIER',0)>0 else 'SLM'
            sched(t+HOP,req,('Q',m))
    series=[]
    t=0.0; red=0
    steps=int(T_END/DT)
    for i in range(steps+1):
        t=i*DT
        if switch_at is not None and abs(t-switch_at)<1e-9:
            old=servers.copy(); oldq=[]
            for lst in old.values():
                for s in lst: oldq += list(s.q); oldq += [r for _,r in s.act]
            apply(switch_to)
            for r in oldq: to_model(t,r)
        # arrivals
        cs=P['cshare0']+(P['cshare1']-P['cshare0'])*t/300
        for _ in range(poisson(lam(t)*DT,rnd)):
            cat='C' if rnd.random()<cs else 'S'
            r=Req(cat,t+P['cats'][cat]['deadline'])
            if cfg.get('cache'): sched(t+HOP+P['cache']['lat'],r,'CACHE')
            else: to_model(t,r)
        # transit events
        while events and events[0][0]<=t+1e-9:
            _,_,r,stg=heapq.heappop(events)
            if stg=='CACHE':
                st['seen']+=1
                ph=P['cache']['maxhit'][r.cat]*(1-math.exp(-st['seen']/P['cache']['warm']))
                if rnd.random()<ph:
                    r.hall = rnd.random()<P['cache']['falsehit']
                    sched(t+HOP,r,'EXIT')
                else: to_model(t,r)
            elif stg=='EXIT' or stg=='REFUSE':
                if t>r.dl: st['timeouts']+=1; outcome('timeout')
                elif stg=='REFUSE': st['refusals']+=1; outcome('refusal')
                else:
                    st['budget']+=P['cats'][r.cat]['rev']; st['served']+=1
                    if r.hall: st['hall_esc']+=1; outcome('halluc')
                    else: outcome('good')
            elif stg[0]=='Q':
                pick(stg[1]).q.append(r)
            elif stg=='GQ':
                servers['GUARD'][0].q.append(r)
        # servers
        for kind,lst in servers.items():
            for s in lst:
                still=[]
                for ft,r in s.act:
                    if ft<=t+1e-9:
                        if kind=='GUARD':
                            g=P['guard']
                            if r.hall and rnd.random()<g['catch']: sched(t+HOP,r,'REFUSE')
                            elif (not r.hall) and rnd.random()<g['fp']: sched(t+HOP,r,'REFUSE')
                            else: sched(t+HOP,r,'EXIT')
                        else:
                            M=P['models'][kind]; c=P['cats'][r.cat]
                            st['budget']-= c['inp']/1000*M['pin'] + c['out']/1000*M['pout']
                            r.hall = rnd.random()<M['H'][r.cat]
                            if cfg.get('guard'): sched(t+HOP,r,'GQ')
                            else: sched(t+HOP,r,'EXIT')
                    else: still.append((ft,r))
                s.act=still
                # expire queue (kill BEFORE pull)
                keep=deque()
                for r in s.q:
                    if t>r.dl: st['timeouts']+=1; outcome('timeout')
                    else: keep.append(r)
                s.q=keep
                while s.q and len(s.act)<s.conc:
                    r=s.q.popleft()
                    if kind=='GUARD': svc=P['guard']['lat']
                    else:
                        M=P['models'][kind]; c=P['cats'][r.cat]
                        svc=M['ttft']+c['inp']/M['prefill']+c['out']*M['tpot']
                    s.act.append((t+svc,r))
        st['budget']-=upkeep_per_s()*DT
        decay=math.exp(-DT/P['tau']); st['S']*=decay; st['N']*=decay
        # renormalize prior floor so N never vanishes
        tr=trust(); st['mintrust']=min(st['mintrust'],tr)
        if st['dead'] is None:
            if st['budget']<=P['bankrupt']: st['dead']=t; st['cause']='BANKRUPT'
            else:
                red = red+DT if tr<P['crit'] else 0.0
                if red>=P['grace']: st['dead']=t; st['cause']='TRUST'
        if st.get('neg') is None and st['budget']<0: st['neg']=t
        if i%int(15/DT)==0: series.append((round(t),round(st['budget'],1),round(tr,1)))
    st['final_budget']=st['budget']; st['series']=series
    return st

BUILDS={
 'A naive (Ingress->Frontier)': dict(FRONTIER=1),
 'B all-SLM': dict(SLM=1),
 'C router+SLM+Frontier': dict(router=True,SLM=1,FRONTIER=1),
 'D full (cache+router+guard)': dict(cache=True,router=True,guard=True,SLM=1,FRONTIER=1),
 'G full minus cache': dict(router=True,guard=True,SLM=1,FRONTIER=1),
 'F full + 2nd SLM': dict(cache=True,router=True,guard=True,SLM=2,FRONTIER=1),
}

def summarize(P, seeds=40, extra=None):
    out={}
    runs_all={}
    items=list(BUILDS.items())
    if extra: items+=extra
    for name,b in items:
        sw=None; to=None
        if isinstance(b,tuple): b,sw,to=b
        runs=[run(b,P,s,sw,to) for s in range(seeds)]
        runs_all[name]=runs
        deaths=[r['dead'] for r in runs if r['dead'] is not None]
        causes={}
        for r in runs:
            if r['cause']: causes[r['cause']]=causes.get(r['cause'],0)+1
        tot=lambda k: statistics.median(r[k] for r in runs)
        out[name]=dict(died=f"{len(deaths)}/{seeds}", med_death=(f"{int(statistics.median(deaths)//60)}:{int(statistics.median(deaths)%60):02d}" if deaths else '-'),
                       causes=causes, final=round(tot('final_budget')), mintrust=round(tot('mintrust'),1),
                       timeouts=tot('timeouts'), hall_esc=tot('hall_esc'), served=tot('served'))
    return out, runs_all

if __name__=='__main__':
    P=make_params()
    full=dict(cache=True,router=True,guard=True,SLM=1,FRONTIER=1)
    extra=[('E naive -> full at 1:00',(dict(FRONTIER=1),60.0,full)),
           ('E naive -> full at 3:00',(dict(FRONTIER=1),180.0,full))]
    out,_=summarize(P,extra=extra)
    print('40 seeds per build, first 5:00. final = median budget at 5:00 (dead runs keep simulating)')
    for k,v in out.items(): print(f"{k:32s} {v}")
