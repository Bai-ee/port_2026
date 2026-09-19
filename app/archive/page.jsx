'use client';

import { useEffect, useState } from 'react';

const pipeline = ['NAS SOURCE', 'HASH + DEDUPE', 'TWELVELABS', 'JEV', 'HUMAN REVIEW', 'ARWEAVE'];

export default function ArchivePage() {
  const [workers, setWorkers] = useState([]);
  const [status, setStatus] = useState('CONNECTING');

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        // This endpoint is admin-authenticated. Existing HITLOOP auth may return 403
        // until the operator is signed in; the WIP surface handles that explicitly.
        const response = await fetch('/api/archive/workers', { cache: 'no-store' });
        if (!active) return;
        if (!response.ok) { setStatus(response.status === 403 ? 'ADMIN AUTH REQUIRED' : 'CONTROL PLANE ERROR'); return; }
        const body = await response.json();
        setWorkers(body.workers || []);
        setStatus((body.workers || []).length ? 'CONNECTED' : 'WAITING FOR WORKER');
      } catch { if (active) setStatus('CONTROL PLANE OFFLINE'); }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const worker = workers[0];
  const counters = worker?.counters || {};

  return (
    <main style={{minHeight:'100vh',background:'#080808',color:'#f4f4f0',fontFamily:'Arial, sans-serif',padding:'32px'}}>
      <div style={{maxWidth:1180,margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:48}}>
          <div><div style={{fontSize:12,letterSpacing:2,opacity:.5}}>HITLOOP / CREATIVE ARCHIVE</div><h1 style={{fontSize:48,margin:'8px 0'}}>Archive</h1></div>
          <div style={{border:'1px solid #333',borderRadius:999,padding:'8px 14px',fontSize:12}}>WIP · PHASE 2</div>
        </div>
        <section style={{border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:24,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>ARCHIVE SOURCE</div><h2 style={{margin:'8px 0'}}>Bryan NAS</h2><div style={{opacity:.6}}>WD My Cloud EX2 Ultra · ~1 TB</div></div>
            <div style={{textAlign:'right'}}><div style={{fontSize:12,opacity:.45}}>WORKER</div><div style={{marginTop:8}}>● {worker?.state || status}</div><div style={{fontSize:11,opacity:.4,marginTop:6}}>{worker?.lastHeartbeatAt || ''}</div></div>
          </div>
          <div style={{height:1,background:'#252525',margin:'24px 0'}} />
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {['discovered','hashed','duplicates','failed'].map(k=><div key={k}><div style={{fontSize:11,opacity:.4,textTransform:'uppercase'}}>{k}</div><div style={{fontSize:24,marginTop:6}}>{counters[k] ?? '—'}</div></div>)}
          </div>
        </section>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:16}}>
          {pipeline.map((x,i)=><div key={x} style={{border:'1px solid #252525',borderRadius:14,padding:16,minHeight:90,background:i<2?'#151515':'#0c0c0c'}}><div style={{fontSize:11,opacity:.4}}>0{i+1}</div><div style={{fontSize:12,marginTop:28}}>{x}</div></div>)}
        </div>
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24}}>
          <div style={{fontSize:12,opacity:.45}}>CURRENT CHECKPOINT</div><h3 style={{fontSize:24,margin:'10px 0'}}>NAS worker → HITLOOP control plane</h3>
          <p style={{maxWidth:720,opacity:.65,lineHeight:1.6}}>Worker heartbeats are now persisted in HITLOOP and this surface polls the control plane every 15 seconds. Originals remain read-only. Analysis, Jev review and Arweave remain downstream gates.</p>
        </section>
      </div>
    </main>
  );
}
