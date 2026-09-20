'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import QuickIngestPanel from '../../components/archive/QuickIngestPanel';

const pipeline = ['NAS SOURCE', 'HASH + DEDUPE', 'TWELVELABS', 'JEV', 'HUMAN REVIEW', 'ARWEAVE'];

// A worker heartbeats at most every ~60s while idle; 3x that is a generous
// margin before treating it as gone rather than a missed poll.
const WORKER_OFFLINE_MS = 180000;

function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// PROCESSING/ERROR/PAUSED are trusted as-sent (the worker explicitly reported
// them). Anything else (ONLINE, or no state at all) is only trustworthy while
// recent — a heartbeat older than WORKER_OFFLINE_MS means the worker likely
// died without ever sending an OFFLINE heartbeat, so render it OFFLINE instead
// of a stale ONLINE forever.
function deriveWorkerDisplay(worker) {
  if (!worker) return { label: null, color: '#555', detail: '' };
  const { state, lastHeartbeatAt } = worker;
  const heartbeatAgo = lastHeartbeatAt ? relativeTime(lastHeartbeatAt) : '';
  if (state === 'PROCESSING') return { label: 'PROCESSING', color: '#4ade80', detail: heartbeatAgo };
  if (state === 'ERROR') return { label: 'ERROR', color: '#e0524f', detail: heartbeatAgo };
  if (state === 'PAUSED') return { label: 'PAUSED', color: '#e0b34d', detail: heartbeatAgo };
  const ageMs = lastHeartbeatAt ? Date.now() - Date.parse(lastHeartbeatAt) : Infinity;
  if (!Number.isFinite(ageMs) || ageMs > WORKER_OFFLINE_MS) {
    return { label: 'OFFLINE', color: '#555', detail: lastHeartbeatAt ? `last seen ${heartbeatAgo}` : 'never seen' };
  }
  return { label: state || 'ONLINE', color: '#4ade80', detail: heartbeatAgo };
}

export default function ArchivePage() {
  const { user, loading: authLoading } = useAuth();
  const authedFetch = useCallback(async (url, init={}) => {
    if (!user) throw new Error('ADMIN AUTH REQUIRED');
    const token = await user.getIdToken();
    return fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${token}`},cache:init.cache||'no-store'});
  },[user]);
  const [workers, setWorkers] = useState([]);
  const [status, setStatus] = useState('CONNECTING');
  const [relativePath, setRelativePath] = useState('.');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [commandState, setCommandState] = useState('');
  const [folders, setFolders] = useState([]);
  const [browseState, setBrowseState] = useState('');
  const [reviewItems,setReviewItems]=useState([]);
  const [reviewState,setReviewState]=useState('');
  const [recentCommands,setRecentCommands]=useState([]);

  // PERMANENT ARCHIVE status (W7a) — no per-asset approval click, no
  // collection form. Documented assets are auto-uploaded by the worker;
  // this card is a read-only aggregate over archive_collections /
  // archive_review / archive_uploads / archive_records, plus the two admin
  // actions that still make sense as explicit buttons (viewer deploy, a
  // manual manifest-rebuild fallback). See api/_lib/archive-permanent-archive.cjs.
  const [permanentSummary,setPermanentSummary]=useState({collections:[],viewer:null});
  const [permanentSummaryState,setPermanentSummaryState]=useState('');
  const [viewerDeployState,setViewerDeployState]=useState('');
  const [manifestRebuildState,setManifestRebuildState]=useState({});

  const loadPermanentSummary=useCallback(async()=>{
    if(!user)return;
    try{
      const r=await authedFetch('/api/archive/approved?summary=1');
      const b=await r.json();
      if(r.ok){setPermanentSummary({collections:b.collections||[],viewer:b.viewer||null});setPermanentSummaryState('');}
      else setPermanentSummaryState(b.error||'SUMMARY FAILED');
    }catch{setPermanentSummaryState('SUMMARY OFFLINE');}
  },[user,authedFetch]);
  useEffect(()=>{loadPermanentSummary();},[loadPermanentSummary]);
  useEffect(()=>{
    if(!user)return;
    const t=setInterval(()=>loadPermanentSummary(),10000);
    return()=>clearInterval(t);
  },[user,loadPermanentSummary]);

  async function deployViewer(){
    setViewerDeployState('DEPLOYING');
    try{
      const r=await authedFetch('/api/archive/arweave/collection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'deploy-viewer'})});
      const b=await r.json();
      if(!r.ok){setViewerDeployState(b.error||'DEPLOY FAILED');return;}
      setViewerDeployState(b.skipped?'ALREADY CURRENT':`QUEUED · ${(b.commandId||'').slice(0,8)}`);
      await loadPermanentSummary();
    }catch{setViewerDeployState('DEPLOY FAILED');}
  }

  async function rebuildManifestFor(collectionId){
    setManifestRebuildState(s=>({...s,[collectionId]:'REBUILDING'}));
    try{
      const r=await authedFetch('/api/archive/arweave/collection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'rebuild-manifest',collectionId})});
      const b=await r.json();
      setManifestRebuildState(s=>({...s,[collectionId]:r.ok?`QUEUED · ${(b.commandId||'').slice(0,8)}`:(b.error||'FAILED')}));
      if(r.ok)await loadPermanentSummary();
    }catch{setManifestRebuildState(s=>({...s,[collectionId]:'FAILED'}));}
  }

  const loadReview=useCallback(async()=>{
    if(!user)return;
    try{const r=await authedFetch('/api/archive/review?state=REVIEW_PENDING');const b=await r.json();if(r.ok)setReviewItems(b.items||[]);}
    catch{setReviewState('REVIEW OFFLINE');}
  },[user,authedFetch]);

  useEffect(()=>{loadReview();},[loadReview]);

  async function confirmDecision(item,decision,value){
    setReviewState('SAVING');
    const r=await authedFetch('/api/archive/review',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:item.id,decisionId:decision.id||decision.question,value})});
    if(r.ok){
      const b=await r.json();
      setReviewItems(xs=>xs.filter(x=>x.id!==item.id));
      setReviewState(b.recordVersionQueued?`CONFIRMED · record v${b.recordVersionQueued} queued`:'CONFIRMED');
      await loadPermanentSummary();
    }else setReviewState('SAVE FAILED');
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        // This endpoint is admin-authenticated. Existing HITLOOP auth may return 403
        // until the operator is signed in; the WIP surface handles that explicitly.
        if (authLoading) return;
        if (!user) { setStatus('ADMIN AUTH REQUIRED'); return; }
        const response = await authedFetch('/api/archive/workers');
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
  }, [user, authLoading, authedFetch]);

  const worker = workers[0];
  const workerDisplay = deriveWorkerDisplay(worker);
  // Browsable sources = the worker's registered sources minus its cloud-intake
  // scratch source. The worker doc's own `sourceId` is just the last source
  // that heartbeated, so it must not drive Browse / Process Folder.
  const browsableSources = (worker?.sources || []).filter((s) => s.kind !== 'cloud-intake' && s.label !== 'Cloud intake');
  const activeSourceId = (selectedSourceId && browsableSources.some((s) => s.sourceId === selectedSourceId))
    ? selectedSourceId
    : (browsableSources[0]?.sourceId || null);
  // A live processing job's counters win; once idle, fall back to the last
  // completed job's numbers instead of showing "—" (heartbeat route no
  // longer blanks `counters`, but a worker that hasn't run a job since this
  // fix shipped, or was reset, still only has lastJobCounters to show).
  const liveCounters = worker?.counters;
  const lastJobCounters = worker?.lastJobCounters;
  const counters = liveCounters || lastJobCounters || {};
  const countersFromLastJob = !liveCounters && !!lastJobCounters;

  const loadRecentCommands = useCallback(async () => {
    if (!user || !worker?.workerId) return;
    try {
      const r = await authedFetch(`/api/archive/commands/process?workerId=${encodeURIComponent(worker.workerId)}`);
      const b = await r.json();
      if (r.ok) setRecentCommands(b.commands || []);
    } catch { /* strip stays on its last known list */ }
  }, [user, authedFetch, worker?.workerId]);

  useEffect(() => { loadRecentCommands(); }, [loadRecentCommands]);
  useEffect(() => {
    if (!user || !worker?.workerId) return;
    const t = setInterval(() => loadRecentCommands(), 15000);
    return () => clearInterval(t);
  }, [user, worker?.workerId, loadRecentCommands]);

  async function browse(path = relativePath) {
    if (!worker?.workerId || !activeSourceId) { setBrowseState('WAITING FOR WORKER + SOURCE'); return; }
    setBrowseState('LOADING');
    const response=await authedFetch('/api/archive/browse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workerId:worker.workerId,sourceId:activeSourceId,relativePath:path||'.'})});
    const body=await response.json();
    if(!response.ok){setBrowseState(body.error||'BROWSE FAILED');return;}
    for(let i=0;i<20;i++){
      await new Promise(r=>setTimeout(r,500));
      const poll=await authedFetch(`/api/archive/browse?commandId=${body.commandId}`);
      const data=await poll.json();
      if(data.state==='COMPLETE'){setRelativePath(data.result.relativePath||'.');setFolders(data.result.folders||[]);setBrowseState('');return;}
      if(data.state==='FAILED'){setBrowseState(data.error||'BROWSE FAILED');return;}
    }
    setBrowseState('WORKER RESPONSE PENDING');
  }

  function openFolder(name){ const next=relativePath==='.'?name:`${relativePath}/${name}`; browse(next); }
  function goUp(){ if(relativePath==='.') return; const parts=relativePath.split('/').filter(Boolean); parts.pop(); browse(parts.join('/')||'.'); }

  async function processCollection() {
    if (!worker?.workerId || !activeSourceId) { setCommandState('WAITING FOR WORKER + SOURCE'); return; }
    setCommandState('QUEUING');
    try {
      const response = await authedFetch('/api/archive/commands/process', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({workerId:worker.workerId, sourceId:activeSourceId, relativePath:relativePath || '.'}),
      });
      const body = await response.json();
      setCommandState(response.ok ? `QUEUED · ${body.commandId.slice(0,8)}` : (body.error || 'QUEUE FAILED'));
    } catch { setCommandState('QUEUE FAILED'); }
  }

  return (
    <main style={{minHeight:'100vh',background:'#080808',color:'#f4f4f0',fontFamily:'Arial, sans-serif',padding:'32px'}}>
      <div style={{maxWidth:1180,margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:48}}>
          <div><div style={{fontSize:12,letterSpacing:2,opacity:.5}}>HITLOOP / CREATIVE ARCHIVE</div><h1 style={{fontSize:48,margin:'8px 0'}}>Archive</h1></div>
          <div style={{border:'1px solid #333',borderRadius:999,padding:'8px 14px',fontSize:12}}>WIP · PHASE 2</div>
        </div>
        <section id="archive-source-panel" style={{border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:24,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>ARCHIVE SOURCE</div><h2 style={{margin:'8px 0'}}>Bryan NAS</h2><div style={{opacity:.6}}>WD My Cloud EX2 Ultra · ~1 TB</div></div>
            <div id="archive-worker-status-header" style={{textAlign:'right'}}>
              <div style={{fontSize:12,opacity:.45}}>WORKER</div>
              <div style={{marginTop:8}}>{worker ? <span><span style={{color:workerDisplay.color}}>●</span> {workerDisplay.label}</span> : `● ${status}`}</div>
              <div style={{fontSize:11,opacity:.4,marginTop:6}}>{worker ? workerDisplay.detail : ''}</div>
            </div>
          </div>
          <div style={{height:1,background:'#252525',margin:'24px 0'}} />
          <div id="archive-worker-counters-row" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {['discovered','hashed','duplicates','failed'].map(k=><div key={k}><div style={{fontSize:11,opacity:.4,textTransform:'uppercase'}}>{k}</div><div style={{fontSize:24,marginTop:6}}>{counters[k] ?? '—'}</div></div>)}
          </div>
          {countersFromLastJob && <div style={{fontSize:11,opacity:.4,marginTop:10}}>From last completed job{worker?.lastJobAt ? ` · ${relativeTime(worker.lastJobAt)}` : ''}</div>}
          <div id="archive-recent-commands-row" style={{marginTop:20,paddingTop:16,borderTop:'1px solid #252525'}}>
            <div style={{fontSize:11,opacity:.4,textTransform:'uppercase',marginBottom:8}}>Recent commands</div>
            {recentCommands.length === 0
              ? <div style={{opacity:.4,fontSize:12}}>No commands yet.</div>
              : recentCommands.map(c => (
                <div key={c.id} style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:12,padding:'6px 0',borderTop:'1px solid #1e1e1e'}}>
                  <span>{c.type}</span>
                  <span style={{opacity:.7}}>{c.state}{c.state === 'FAILED' && c.error ? ` · ${c.error}` : ''}</span>
                  <span style={{opacity:.4}}>{relativeTime(c.updatedAt || c.createdAt)}</span>
                </div>
              ))}
          </div>
        </section>
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{fontSize:12,opacity:.45}}>PROCESS A COLLECTION</div>
          <div id="archive-source-select-row" style={{display:'flex',gap:10,alignItems:'center',marginTop:12,fontSize:12,opacity:.7}}>
            <span>SOURCE</span>
            {browsableSources.length > 1
              ? <select id="archive-source-select" aria-label="Archive source" value={activeSourceId || ''} onChange={e=>{setSelectedSourceId(e.target.value);setFolders([]);setRelativePath('.');}} style={{background:'#080808',color:'#f4f4f0',border:'1px solid #333',borderRadius:8,padding:'6px 10px'}}>
                  {browsableSources.map(s=><option key={s.sourceId} value={s.sourceId}>{s.label}{s.state&&s.state!=='ONLINE'?` · ${s.state}`:''}</option>)}
                </select>
              : <span style={{color:'#f4f4f0'}}>{browsableSources[0]?.label || 'no browsable source registered'}</span>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:12,flexWrap:'wrap'}}>
            <input aria-label="NAS relative folder" value={relativePath} onChange={e=>setRelativePath(e.target.value)} placeholder="Housepit/San Francisco/2008" style={{flex:'1 1 420px',background:'#080808',border:'1px solid #333',borderRadius:10,padding:'14px 16px',color:'#f4f4f0'}} />
            <button onClick={processCollection} style={{background:'#f4f4f0',color:'#080808',border:0,borderRadius:10,padding:'14px 20px',fontWeight:700,cursor:'pointer'}}>PROCESS FOLDER</button>
          </div>
          <div style={{display:'flex',gap:8,marginTop:12}}><button onClick={()=>browse(relativePath)} style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'8px 12px'}}>BROWSE</button><button onClick={goUp} disabled={relativePath==='.'} style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'8px 12px'}}>↑ UP</button><span style={{fontSize:11,opacity:.5,alignSelf:'center'}}>{browseState}</span></div>
          {folders.length>0 && <div style={{marginTop:12,borderTop:'1px solid #252525'}}>{folders.map(name=><button key={name} onClick={()=>openFolder(name)} style={{display:'block',width:'100%',textAlign:'left',background:'transparent',color:'#eee',border:0,borderBottom:'1px solid #1e1e1e',padding:'12px 4px',cursor:'pointer'}}>▸ {name}</button>)}</div>}
          <div style={{fontSize:11,opacity:.5,marginTop:10}}>{commandState || 'Select a folder, then process it. Originals remain untouched.'}</div>
          <div style={{fontSize:11,opacity:.42,marginTop:8}}>Signed in: {user?.email || (authLoading ? 'checking…' : 'not authenticated')}</div>
        </section>
        <QuickIngestPanel authedFetch={authedFetch} />
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16}}><div><div style={{fontSize:12,opacity:.45}}>HUMAN REVIEW</div><h3 style={{fontSize:24,margin:'8px 0'}}>Jev decisions · corrections mint a new record version</h3></div><div style={{fontSize:11,opacity:.5}}>{reviewItems.length} pending · {reviewState}</div></div>
          {reviewItems.length===0?<div style={{opacity:.5,padding:'18px 0'}}>No decisions waiting for review.</div>:reviewItems.map(item=><div key={item.id} style={{borderTop:'1px solid #252525',padding:'16px 0'}}>
            <div style={{fontSize:13,fontWeight:700}}>{item.archiveName||item.fileName||item.assetId||item.id}</div>
            {(item.decisions||[]).map((d,i)=><div key={d.id||i} style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',marginTop:12,flexWrap:'wrap'}}>
              <div><div style={{fontSize:12}}>{d.question}</div><div style={{fontSize:11,opacity:.5,marginTop:4}}>JEV · {d.selectedValue||d.selected||'—'} · {Math.round(Number(d.confidence||0)*100)}% · {d.reviewBand||''}</div></div>
              <div style={{display:'flex',gap:6}}>{(d.choices||[]).slice(0,4).map(ch=>{const value=typeof ch==='string'?ch:(ch.value||ch.label);return <button key={value} onClick={()=>confirmDecision(item,d,value)} style={{background:value===(d.selectedValue||d.selected)?'#f4f4f0':'transparent',color:value===(d.selectedValue||d.selected)?'#080808':'#ddd',border:'1px solid #444',borderRadius:999,padding:'7px 10px',cursor:'pointer'}}>{value}</button>})}</div>
            </div>)}
          </div>)}
        </section>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:16}}>
          {pipeline.map((x,i)=><div key={x} style={{border:'1px solid #252525',borderRadius:14,padding:16,minHeight:90,background:i<2?'#151515':'#0c0c0c'}}><div style={{fontSize:11,opacity:.4}}>0{i+1}</div><div style={{fontSize:12,marginTop:28}}>{x}</div></div>)}
        </div>
        <section id="archive-permanent-status-panel" style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>PERMANENT ARCHIVE</div><h3 style={{fontSize:24,margin:'8px 0'}}>Auto-uploaded once documented</h3></div>
            <div style={{fontSize:11,opacity:.5,textAlign:'right'}}>{permanentSummaryState}</div>
          </div>
          <p style={{maxWidth:720,opacity:.6,lineHeight:1.5,fontSize:13}}>There is no approval click. Once an asset is hashed, has READY TwelveLabs evidence and six Jev decisions, the worker uploads the original and a per-asset archive-record JSON to Arweave on its own — this card is a live status read, not a control. A human correction in Human Review above mints a new archive-record version; the collection manifest rebuilds automatically once every in-flight upload for that collection settles.</p>

          <div id="archive-permanent-viewer-row" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:16,paddingTop:16,borderTop:'1px solid #252525'}}>
            <div>
              <div style={{fontSize:11,opacity:.45,textTransform:'uppercase'}}>Viewer</div>
              <div style={{fontSize:13,marginTop:4}}>
                {permanentSummary.viewer?.transactionId
                  ? <span>deployed · <a href={`https://arweave.net/${permanentSummary.viewer.transactionId}`} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>{permanentSummary.viewer.transactionId.slice(0,10)}…</a></span>
                  : 'not deployed to Arweave yet'}
              </div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:11,opacity:.5}}>{viewerDeployState}</span>
              <button onClick={deployViewer} style={{background:'transparent',color:'#fff',border:'1px solid #444',borderRadius:10,padding:'10px 14px',cursor:'pointer'}}>DEPLOY VIEWER</button>
            </div>
          </div>

          <div id="archive-permanent-collections-list" style={{marginTop:16}}>
            {permanentSummary.collections.length===0
              ? <div style={{opacity:.5,padding:'12px 0'}}>No collections yet — process a NAS folder above to start one.</div>
              : permanentSummary.collections.map(c=>(
                <div key={c.id} style={{borderTop:'1px solid #252525',padding:'16px 0',display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                    <div style={{fontSize:14,fontWeight:700}}>{c.title}</div>
                    <div style={{fontSize:12,opacity:.7}}>{c.documented} documented · {c.uploading} uploading · {c.uploaded} uploaded{c.failed?` · ${c.failed} failed`:''}</div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:12,opacity:.65}}>
                    <div>
                      manifest {c.manifestVersion ? <>v{c.manifestVersion} · <a href={`https://arweave.net/${c.manifestTransactionId}`} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>{String(c.manifestTransactionId||'').slice(0,10)}…</a></> : 'not built yet'}
                      {' · '}record versions {c.recordVersionsTotal}
                      {' · '}{c.cost?.isLiveQuote
                        ? <>≈ ${c.cost.costUSD} <span style={{opacity:.5}}>(Turbo live · ${c.cost.usdPerGb}/GB)</span></>
                        : <>~{c.cost?.costAR ?? 0} AR <span style={{opacity:.5}}>(legacy estimate, not live)</span></>}
                    </div>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <a href={c.viewerUrl} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>OPEN VIEWER ↗</a>
                      <span style={{opacity:.5}}>{manifestRebuildState[c.id]}</span>
                      <button onClick={()=>rebuildManifestFor(c.id)} style={{background:'transparent',color:'#fff',border:'1px solid #444',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:11}}>REBUILD MANIFEST</button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24}}>
          <div style={{fontSize:12,opacity:.45}}>CURRENT CHECKPOINT</div><h3 style={{fontSize:24,margin:'10px 0'}}>NAS → Jev review → permanent archive</h3>
          <p style={{maxWidth:720,opacity:.65,lineHeight:1.6}}>The control surface is now authenticated. Originals remain read-only; permanent Arweave upload is automatic once an asset is documented, and human review corrects the record afterward rather than gating it.</p>
        </section>
      </div>
    </main>
  );
}
