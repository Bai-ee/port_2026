'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Film, Focus, Folder, Heart, HelpCircle, Image as ImageIcon, Images, Layers3, LayoutGrid, LockKeyhole, MapPin, Maximize2, Minus, Moon, Plus, ScanLine, Search, SlidersHorizontal, Sparkles, Sun, X } from 'lucide-react';
import IconButton from '@hitloop/components/dashboard/content-ui/ui/IconButton';
import SegmentedControl from '@hitloop/components/dashboard/content-ui/ui/SegmentedControl';
import Badge from '@hitloop/components/dashboard/content-ui/ui/Badge';
import ContentUiStyles from '@hitloop/components/dashboard/content-ui/ContentUiStyles';
import TimelineCanvas from './TimelineCanvas';
import { ALBUMS, FIELDS, makeRecords, recordDate, SOURCES, TOTAL_MONTHS, dateLabel } from './demo-data';

const INITIAL_FILTERS={search:'',favorite:false,kind:'',source:'',gps:false,motion:false,includeHidden:true,camera:'',album:'',from:'',to:'',conditions:[]};
const iconProps={size:16,strokeWidth:1.6};
const VIEW_OPTIONS=[{value:'field',label:'Time field',icon:<ScanLine {...iconProps}/>},{value:'grid',label:'Contact sheet',icon:<LayoutGrid {...iconProps}/>}];
const MEDIA_OPTIONS=[{value:'',label:'All'},{value:'image',label:'Photos'},{value:'video',label:'Videos'}];
const defaultView={start:0,span:216};

function Modal({id,label,open,onClose,className='',children}) {
  const ref=useRef(null);
  useEffect(()=>{
    const dialog=ref.current;
    if(open&&!dialog.open)dialog.showModal();
    if(!open&&dialog.open)dialog.close();
  },[open]);
  return <dialog ref={ref} id={id} aria-label={label} className={className} onCancel={onClose} onClose={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}>{children}</dialog>;
}

function Checkbox({id,label,checked,onChange,hint}) {
  return <label id={`${id}-row`} className="mu-checkbox-row life-check-row" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{label}{hint?<small>{hint}</small>:null}</span></label>;
}

function PhotoViewer({item,position,total,onClose,onMove}) {
  const [zoom,setZoom]=useState(1);
  useEffect(()=>setZoom(1),[item?.index]);
  useEffect(()=>{
    if(!item)return;
    const key=e=>{if(e.key==='ArrowRight'){e.preventDefault();onMove(1);}if(e.key==='ArrowLeft'){e.preventDefault();onMove(-1);}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[item,onMove]);
  return <Modal id="life-item-viewer" label="Sample photo viewer" className="life-viewer" open={Boolean(item)} onClose={onClose}>
    {item?<>
      <div id="life-viewer-toolbar" className="life-viewer-toolbar"><span><ImageIcon {...iconProps}/> Sample photo <span className="life-muted">{position+1} / {total.toLocaleString()}</span></span><div className="life-inline"><IconButton id="life-viewer-previous" label="Previous photo" icon={<ChevronLeft {...iconProps}/>} onClick={()=>onMove(-1)} disabled={position<=0}/><IconButton id="life-viewer-next" label="Next photo" icon={<ChevronRight {...iconProps}/>} onClick={()=>onMove(1)} disabled={position>=total-1}/><IconButton id="life-viewer-close" label="Close viewer" icon={<X {...iconProps}/>} onClick={onClose}/></div></div>
      <div id="life-viewer-body" className="life-viewer-body"><div id="life-viewer-photo-pane" className="life-viewer-photo-pane"><div id="life-viewer-photo-scroll" className="life-viewer-photo-scroll"><img src={`/photos/${item.slot}.jpg`} alt={`Public sample photograph for ${item.title}`} draggable="false" style={{width:`${zoom*100}%`}}/></div><div id="life-viewer-zoom-controls" className="life-viewer-zoom"><IconButton id="life-preview-zoom-out" label="Zoom photo out" size={36} disabled={zoom<=1} icon={<Minus {...iconProps}/>} onClick={()=>setZoom(z=>Math.max(1,z-.5))}/><span>{Math.round(zoom*100)}%</span><IconButton id="life-preview-zoom-in" label="Zoom photo in" size={36} disabled={zoom>=3} icon={<Plus {...iconProps}/>} onClick={()=>setZoom(z=>Math.min(3,z+.5))}/><span className="life-zoom-note">Sample resolution · enlargement only</span></div></div>
        <aside id="life-viewer-information" className="life-viewer-information"><span className="mu-label">Generated metadata</span><h2>{recordDate(item)}</h2><p>{item.album}</p><div className="life-inline life-wrap">{item.favorite?<Badge id="life-viewer-favorite" tone="grey" icon={<Heart size={11}/>}>Favorite</Badge>:null}{item.motion?<Badge id="life-viewer-motion" tone="grey">Live Photo</Badge>:null}{item.kind==='video'?<Badge id="life-viewer-video" tone="grey">Video · poster only</Badge>:null}</div><dl id="life-viewer-metadata" className="life-metadata"><dt>Capture time</dt><dd>{item.takenLocal.replace('T',' · ')}</dd><dt>Date certainty</dt><dd>{item.tsKind}</dd><dt>Camera</dt><dd>{item.cameraMake} {item.cameraModel}</dd><dt>Dimensions</dt><dd>{item.width} × {item.height}</dd><dt>GPS</dt><dd>{item.gps?`${item.lat}, ${item.lon}`:'Not recorded'}</dd><dt>Source</dt><dd>{item.source}</dd><dt>Filename</dt><dd>{item.filename}</dd><dt>Keywords</dt><dd>{item.keywords.join(', ')}</dd></dl><p className="mu-notice">Sample photograph with invented metadata. Your personal archive is not connected.</p></aside></div>
    </>:null}
  </Modal>;
}

export default function LifePrototype() {
  const records=useMemo(makeRecords,[]);
  const [filters,setFilters]=useState(INITIAL_FILTERS);
  const deferredSearch=useDeferredValue(filters.search);
  const [matches,setMatches]=useState(()=>Uint32Array.from(records.map((_,i)=>i)));
  const [counts,setCounts]=useState(()=>{const c=new Uint32Array(216);records.forEach(r=>c[Math.floor(r.time)]++);return c;});
  const [view,setView]=useState(defaultView);
  const [layout,setLayout]=useState('field');
  const [hover,setHover]=useState(null);
  const [selected,setSelected]=useState(null);
  const [filterOpen,setFilterOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [jumpOpen,setJumpOpen]=useState(false);
  const [jump,setJump]=useState('2015-06');
  const [theme,setTheme]=useState('light');
  const [ready,setReady]=useState(false);
  const [filterBusy,setFilterBusy]=useState(false);
  const [workerError,setWorkerError]=useState('');
  const worker=useRef(null),generation=useRef(0),conditionId=useRef(0);
  const [gridLimit,setGridLimit]=useState(120);
  const fieldRef=useRef(null);
  const clearFilters=useCallback(()=>setFilters(INITIAL_FILTERS),[]);
  const closeViewer=useCallback(()=>setSelected(null),[]);

  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  useEffect(()=>{
    const shortcut=e=>{if(e.key==='/'&&!e.metaKey&&!e.ctrlKey&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();document.getElementById('life-search-input')?.focus();}};
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  },[]);
  useEffect(()=>{
    const w=new Worker('/filter-worker.js');worker.current=w;
    w.postMessage({type:'init',records});
    w.onmessage=({data})=>{if(data.generation!==generation.current)return;setMatches(data.ids);setCounts(data.counts);setFilterBusy(false);setHover(null);};
    w.onerror=()=>{setWorkerError('Filtering could not start. Reload the prototype to try again.');setFilterBusy(false);};
    return()=>{w.terminate();worker.current=null;};
  },[records]);
  useEffect(()=>{
    generation.current++;
    setFilterBusy(true);setGridLimit(120);
    worker.current?.postMessage({type:'query',generation:generation.current,filters:{...filters,search:deferredSearch}});
  },[filters,deferredSearch]);
  useEffect(()=>{if(selected!=null&&!matches.includes(selected))setSelected(null);},[matches,selected]);

  const setFilter=(key,value)=>setFilters(f=>({...f,[key]:value}));
  const activeCount=Number(Boolean(filters.search))+Number(filters.favorite)+Number(Boolean(filters.kind))+Number(Boolean(filters.source))+Number(filters.gps)+Number(filters.motion)+Number(!filters.includeHidden)+Number(Boolean(filters.camera))+Number(Boolean(filters.album))+Number(Boolean(filters.from||filters.to))+filters.conditions.length;
  const activeLabels=[filters.search&&`Search: ${filters.search}`,filters.favorite&&'Favorites',filters.kind&&(filters.kind==='image'?'Photos':'Videos'),filters.source,filters.gps&&'Has GPS',filters.motion&&'Live Photos',!filters.includeHidden&&'Hidden excluded',filters.camera,filters.album,(filters.from||filters.to)&&'Date range',...filters.conditions.map(c=>`${FIELDS.find(f=>f[0]===c.field)?.[1]} ${c.operator==='eq'?'=':c.operator} ${c.value}`)].filter(Boolean);
  const item=selected==null?null:records[selected];
  const selectedPosition=selected==null?-1:matches.indexOf(selected);
  const moveViewer=useCallback(delta=>setSelected(current=>{const i=matches.indexOf(current);const next=matches[i+delta];return next===undefined?current:next;}),[matches]);
  const visibleIds=useMemo(()=>Array.from(matches).filter(i=>records[i].time>=view.start&&records[i].time<=view.start+view.span),[matches,records,view]);
  const setCamera=useCallback(next=>{setHover(null);setView(next);},[]);
  const zoomBy=factor=>setView(v=>{const span=Math.max(.28,Math.min(216,v.span*factor));return{span,start:Math.max(0,Math.min(216-span,v.start+(v.span-span)/2))};});
  const goYear=year=>setCamera({start:Math.min(204,(year-2005)*12),span:12});
  const scrub=center=>{const span=Math.min(view.span,36);setCamera({span,start:Math.max(0,Math.min(216-span,Number(center)-span/2))});};
  const jumpToMonth=e=>{e.preventDefault();const [y,m]=jump.split('-').map(Number);const start=(y-2005)*12+m-1;setCamera({start:Math.max(0,Math.min(215,start)),span:1});setJumpOpen(false);};
  const axes=useMemo(()=>{
    const step=view.span>100?36:view.span>28?12:view.span>8?3:view.span>2?1:.25;
    const ticks=[];
    for(let m=Math.ceil(view.start/step)*step;m<Math.min(216,view.start+view.span);m+=step){
      const left=(m-view.start)/view.span*100;
      if(left>2&&left<97)ticks.push({left,label:step>=12?dateLabel(m):step>=1?dateLabel(m,true):`${Math.floor((m%1)*28)+1} ${dateLabel(m,true)}`});
    }
    return ticks;
  },[view]);
  const hoverIndex=hover?visibleIds.indexOf(hover.item.index):-1;
  const hoverNeighbors=hover?[hoverIndex-1,hoverIndex,hoverIndex+1].filter(i=>i>=0&&i<visibleIds.length).map(i=>records[visibleIds[i]]):[];
  const favoriteCount=records.filter(r=>r.favorite).length;
  const videoCount=records.filter(r=>r.kind==='video').length;

  return <main id="life-prototype-shell" className="life-app xce-scope">
    <ContentUiStyles/>
    <header id="life-app-header" className="life-app-header"><div id="life-brand" className="life-brand">HITLOOP<span className="life-brand-divider"/><span className="life-product-name">Life Timeline</span></div><div id="life-header-actions" className="life-inline"><Badge id="life-prototype-badge" tone="grey" icon={<LockKeyhole size={11}/>}>Sample prototype</Badge><IconButton id="life-help-button" label="About this prototype" icon={<HelpCircle {...iconProps}/>} onClick={()=>setHelpOpen(true)}/><IconButton id="life-theme-button" label={theme==='light'?'Use dark theme':'Use light theme'} icon={theme==='light'?<Moon {...iconProps}/>:<Sun {...iconProps}/>} onClick={()=>setTheme(t=>t==='light'?'dark':'light')}/><span className="life-avatar" aria-label="My library">BB</span></div></header>

    <div id="life-workspace" className="life-workspace">
      <aside id="life-library-sidebar" className="life-sidebar"><div id="life-library-navigation"><span className="mu-label">My library</span><nav aria-label="Library views" className="life-nav"><button id="life-all-memories" type="button" className={!filters.favorite&&!filters.kind&&!filters.source?'is-active':''} onClick={clearFilters}><Images {...iconProps}/><span>All memories</span><small>20,000</small></button><button id="life-favorite-memories" type="button" className={filters.favorite?'is-active':''} onClick={()=>setFilters(f=>({...INITIAL_FILTERS,favorite:!f.favorite}))}><Heart {...iconProps}/><span>Favorites</span><small>{favoriteCount.toLocaleString()}</small></button><button id="life-video-memories" type="button" className={filters.kind==='video'?'is-active':''} onClick={()=>setFilters(f=>({...INITIAL_FILTERS,kind:f.kind==='video'?'':'video'}))}><Film {...iconProps}/><span>Videos</span><small>{videoCount.toLocaleString()}</small></button></nav></div>
        <div id="life-source-navigation" className="life-sidebar-section"><span className="mu-label">Sources</span><nav className="life-nav" aria-label="Filter by import source">{SOURCES.map((source,i)=><button id={`life-source-${i}`} key={source} type="button" className={filters.source===source?'is-active':''} onClick={()=>setFilter('source',filters.source===source?'':source)}><Folder {...iconProps}/><span>{source}</span></button>)}</nav></div>
        <div id="life-year-navigation" className="life-sidebar-section"><span className="mu-label">Jump through time</span><div className="life-year-grid">{[2005,2008,2011,2014,2017,2020].map(y=><button id={`life-jump-${y}`} type="button" key={y} className="life-year-button" onClick={()=>goYear(y)}>{y}<ArrowUpRight size={12}/></button>)}</div></div>
        <div id="life-library-layer" className="life-library-layer"><span className="mu-label">On this timeline</span><div className="life-layer-row"><span className="life-layer-dot"/><div><strong>My library</strong><small>Personal collection</small></div><Check size={15}/></div><p>Family libraries can share this timeline later.</p></div>
        <div id="life-sidebar-footnote" className="life-sidebar-footnote"><Sparkles size={14}/><span>Interaction study<br/>Sample imagery & metadata</span></div>
      </aside>

      <section id="life-main-content" className="life-main-content" aria-label="Explore the photo timeline">
        <div id="life-toolbar" className="life-toolbar"><div id="life-search-field" className="life-search"><Search size={17}/><input id="life-search-input" type="search" placeholder="Search memories, albums, cameras…" value={filters.search} onChange={e=>setFilter('search',e.target.value)} aria-label="Search all generated metadata"/><kbd>/</kbd></div><div id="life-view-tools" className="life-view-tools"><SegmentedControl id="life-layout-control" ariaLabel="Photo layout" value={layout} onChange={setLayout} options={VIEW_OPTIONS}/><button id="life-filter-button" type="button" className={`mu-btn-outline ${filterOpen?'mu-btn-outline--active':''}`} onClick={()=>setFilterOpen(true)}><SlidersHorizontal {...iconProps}/>Filters{activeCount?<span className="life-filter-count">{activeCount}</span>:null}</button></div></div>

        <div id="life-time-heading" className="life-time-heading"><div><div className="life-heading-line"><h1>{view.span>=215?'2005 — 2022':`${dateLabel(view.start,view.span<36)}${view.span>1.05?` — ${dateLabel(view.start+view.span-.01,view.span<36)}`:''}`}</h1><span className="life-heading-tag">{view.span>=215?'The whole picture':view.span>12?'A closer look':view.span>1?'In this year':'In this month'}</span></div><p aria-live="polite">{filterBusy?'Filtering…':`${matches.length.toLocaleString()} ${activeCount?'matching':'sample'} items`}<span className="life-dot-separator">·</span>{activeCount?'Across your sample library':'18 years, connected by capture date'}</p></div><div id="life-time-actions" className="life-inline life-time-actions"><button id="life-jump-date-button" type="button" className="xce-ghost" onClick={()=>setJumpOpen(true)}><CalendarDays {...iconProps}/>Jump to date</button><button id="life-overview-button" type="button" className="xce-ghost" onClick={()=>setCamera(defaultView)}><Focus {...iconProps}/><span>Whole life</span></button></div></div>

        {activeLabels.length?<div id="life-active-filters" className="life-active-filters"><div>{activeLabels.map((label,i)=><span className="mu-chip" key={`${label}-${i}`}>{label}</span>)}</div><button id="life-clear-filters" type="button" className="life-text-button" onClick={clearFilters}>Clear all<X size={13}/></button></div>:null}

        <div id="life-exploration-surface" className="life-exploration-surface" ref={fieldRef}>
          {layout==='field'?<>
            <div id="life-time-axis" className="life-time-axis" aria-hidden="true">{axes.map(a=><span key={a.left} style={{left:`${a.left}%`}}>{a.label}</span>)}</div>
            <TimelineCanvas records={records} matches={matches} view={view} onHover={setHover} onSelect={setSelected} onViewChange={setCamera} onReady={()=>setReady(true)}/>
            {hover?<div id="life-scrubbing-lens" className="life-scrubbing-lens" style={{left:Math.min(Math.max(12,hover.x-122),Math.max(12,(fieldRef.current?.clientWidth||600)-264)),top:Math.max(52,Math.min(hover.y-210,(fieldRef.current?.clientHeight||500)-228))}}><div className="life-lens-images">{hoverNeighbors.map((r,i)=><img key={r.index} className={r.index===hover.item.index?'is-center':''} src={`/photos/${r.slot}.jpg`} alt=""/>)}</div><div className="life-lens-label"><span>{recordDate(hover.item)}</span><span>{hover.item.motion?'LIVE':hover.item.kind==='video'?'VIDEO':'PHOTO'}</span></div><p>Click to open this moment<ArrowUpRight size={12}/></p></div>:null}
            {ready&&matches.length>0?<div id="life-canvas-caption" className="life-canvas-caption"><span>{view.span>120?'Thousands of moments. One continuous timeline.':view.span>12?'Stay in the flow. Zoom into a moment.':'Every photograph has a place in time.'}</span><small>Scroll to zoom · drag to travel · click a photo to open</small></div>:null}
            {!ready?<div id="life-canvas-loading" className="life-canvas-loading" role="status">Preparing the photo field…</div>:null}
          </>:<div id="life-contact-sheet" className="life-contact-sheet">{visibleIds.slice(0,gridLimit).map(i=>{const r=records[i];return <button id={`life-photo-${r.key}`} key={r.key} type="button" className="life-grid-photo" onClick={()=>setSelected(i)} aria-label={`Open sample photo ${recordDate(r)}, ${r.album}`}><img src={`/photos/${r.slot}.jpg`} alt="" loading="lazy"/><span>{recordDate(r)}</span>{r.favorite?<Heart size={13} className="life-grid-heart"/>:null}</button>;})}{visibleIds.length>gridLimit?<button id="life-load-more-photos" type="button" className="mu-btn-outline life-load-more" onClick={()=>setGridLimit(n=>n+120)}>Show 120 more photos</button>:null}</div>}
          {matches.length===0||layout==='grid'&&visibleIds.length===0?<div id="life-no-results" className="life-no-results"><Search size={26}/><h2>No moments in this view</h2><p>{matches.length?'Zoom out to see matching photos elsewhere in time.':'Try removing a filter or changing your search.'}</p><button type="button" className="mu-btn-outline" onClick={()=>{clearFilters();setCamera(defaultView);}}>Reset view</button></div>:null}
          <div id="life-canvas-controls" className="life-canvas-controls"><IconButton id="life-zoom-out" label="Zoom timeline out" icon={<Minus {...iconProps}/>} disabled={view.span>=216} onClick={()=>zoomBy(1.8)}/><span>{view.span>100?'Life':view.span>12?'Years':view.span>1?'Months':'Days'}</span><IconButton id="life-zoom-in" label="Zoom timeline in" icon={<Plus {...iconProps}/>} disabled={view.span<=.28} onClick={()=>zoomBy(.55)}/></div>
        </div>

        <div id="life-overview-timeline" className="life-overview-timeline"><div className="life-overview-top"><span className="mu-label">Your life at a glance</span><span>{dateLabel(view.start,true)} — {dateLabel(Math.min(215.99,view.start+view.span-.01),true)}</span></div><div id="life-minimap" className="life-minimap"><svg viewBox="0 0 2160 46" preserveAspectRatio="none" aria-hidden="true">{Array.from(counts,(n,i)=><rect key={i} x={i*10+1} y={44-Math.max(2,n/Math.max(1,...counts)*40)} width="7" height={Math.max(2,n/Math.max(1,...counts)*40)} className={i>=view.start&&i<=view.start+view.span?'is-in-window':''}/>)}</svg><div className="life-minimap-window" style={{left:`${view.start/216*100}%`,width:`${view.span/216*100}%`}}/><input id="life-timeline-scrubber" type="range" min="0" max="216" step="0.1" value={view.start+view.span/2} onChange={e=>scrub(e.target.value)} aria-label="Scrub through capture dates" aria-valuetext={`${dateLabel(view.start,true)} to ${dateLabel(view.start+view.span-.01,true)}`}/></div><div className="life-overview-years">{[2005,2008,2011,2014,2017,2020,2022].map(y=><button id={`life-overview-year-${y}`} type="button" key={y} onClick={()=>goYear(y)}>{y}</button>)}</div></div>
        <footer id="life-prototype-footer" className="life-prototype-footer"><span><span className="life-ready-dot"/>{workerError||'20,000 generated records · 36 repeated sample photos'}</span><button id="life-about-data" type="button" onClick={()=>setHelpOpen(true)}>About this study<ArrowUpRight size={12}/></button></footer>
      </section>
    </div>

    <Modal id="life-filter-drawer" label="Filter sample metadata" className="life-filter-drawer" open={filterOpen} onClose={()=>setFilterOpen(false)}><div id="life-filter-drawer-header" className="life-drawer-header"><div><h2>Find your moments</h2><p>{matches.length.toLocaleString()} of 20,000 sample items</p></div><IconButton id="life-filter-close" label="Close filters" icon={<X {...iconProps}/>} onClick={()=>setFilterOpen(false)}/></div><div id="life-filter-drawer-content" className="life-drawer-content">
      <section id="life-media-filters" className="life-filter-section"><span className="mu-label">Media type</span><SegmentedControl id="life-media-type" ariaLabel="Filter media type" options={MEDIA_OPTIONS} value={filters.kind} onChange={v=>setFilter('kind',v)}/><Checkbox id="life-filter-favorites" label="Favorites only" checked={filters.favorite} onChange={v=>setFilter('favorite',v)}/><Checkbox id="life-filter-live" label="Live Photos" checked={filters.motion} onChange={v=>setFilter('motion',v)}/><Checkbox id="life-filter-gps" label="Has a recorded location" checked={filters.gps} onChange={v=>setFilter('gps',v)}/><Checkbox id="life-filter-hidden" label="Include hidden items" checked={filters.includeHidden} onChange={v=>setFilter('includeHidden',v)}/></section>
      <section id="life-date-filters" className="life-filter-section"><span className="mu-label">Capture date</span><div className="mu-field-grid"><label className="mu-field" htmlFor="life-filter-from"><span>From</span><input id="life-filter-from" className="mu-input" type="date" min="2005-01-01" max="2022-12-31" value={filters.from} onChange={e=>setFilter('from',e.target.value)}/></label><label className="mu-field" htmlFor="life-filter-to"><span>To</span><input id="life-filter-to" className="mu-input" type="date" min="2005-01-01" max="2022-12-31" value={filters.to} onChange={e=>setFilter('to',e.target.value)}/></label></div></section>
      <section id="life-library-filters" className="life-filter-section"><label className="mu-field" htmlFor="life-filter-album"><span className="mu-label">Album</span><select id="life-filter-album" className="mu-select" value={filters.album} onChange={e=>setFilter('album',e.target.value)}><option value="">All albums</option>{ALBUMS.map(a=><option key={a}>{a}</option>)}</select></label><label className="mu-field" htmlFor="life-filter-camera"><span className="mu-label">Camera</span><select id="life-filter-camera" className="mu-select" value={filters.camera} onChange={e=>setFilter('camera',e.target.value)}><option value="">All cameras</option><option>Apple</option><option>Canon</option></select></label><label className="mu-field" htmlFor="life-filter-source"><span className="mu-label">Import source</span><select id="life-filter-source" className="mu-select" value={filters.source} onChange={e=>setFilter('source',e.target.value)}><option value="">All sources</option>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></label></section>
      <section id="life-advanced-filters" className="life-filter-section"><div className="life-inline life-spread"><span className="mu-label">Any metadata</span><span className="life-muted">{FIELDS.length} fields</span></div><p className="life-filter-note">Combine conditions across the entire sample library. All conditions must match.</p>{filters.conditions.map(c=><div id={`life-condition-${c.id}`} className="life-condition" key={c.id}><div className="life-inline"><select className="mu-select" aria-label="Metadata field" value={c.field} onChange={e=>setFilter('conditions',filters.conditions.map(r=>r.id===c.id?{...r,field:e.target.value}:r))}>{FIELDS.map(f=><option key={f[0]} value={f[0]}>{f[1]}</option>)}</select><IconButton label="Remove condition" icon={<X size={14}/>} size={36} onClick={()=>setFilter('conditions',filters.conditions.filter(r=>r.id!==c.id))}/></div><div className="life-condition-values"><select className="mu-select" aria-label="Condition operator" value={c.operator} onChange={e=>setFilter('conditions',filters.conditions.map(r=>r.id===c.id?{...r,operator:e.target.value}:r))}><option value="contains">contains</option><option value="eq">equals</option><option value="neq">does not equal</option><option value="gte">at least</option><option value="lte">at most</option><option value="missing">is missing</option><option value="present">is present</option></select>{!['missing','present'].includes(c.operator)?<input className="mu-input" aria-label="Condition value" placeholder={FIELDS.find(f=>f[0]===c.field)?.[2]==='boolean'?'true or false':'Value'} value={c.value} onChange={e=>setFilter('conditions',filters.conditions.map(r=>r.id===c.id?{...r,value:e.target.value}:r))}/>:null}</div></div>)}<button id="life-add-condition" type="button" className="xce-ghost" onClick={()=>setFilter('conditions',[...filters.conditions,{id:++conditionId.current,field:'cameraMake',operator:'eq',value:'Apple'}])}><Plus size={14}/>Add a condition</button></section>
      <p className="mu-notice">All metadata here is generated for this study. Named places are illustrative; the production filters will use recorded GPS.</p>
    </div><div id="life-filter-drawer-footer" className="life-drawer-footer"><button id="life-reset-filter-drawer" type="button" className="xce-ghost" onClick={clearFilters}>Reset all</button><button id="life-show-results" type="button" className="xce-btn" onClick={()=>setFilterOpen(false)}>Show {matches.length.toLocaleString()} moments<ArrowRight size={15}/></button></div></Modal>

    <Modal id="life-jump-dialog" label="Jump to capture date" className="life-small-dialog" open={jumpOpen} onClose={()=>setJumpOpen(false)}><div className="life-drawer-header"><h2>Jump to a moment</h2><IconButton id="life-jump-close" label="Close jump to date" icon={<X {...iconProps}/>} onClick={()=>setJumpOpen(false)}/></div><form id="life-jump-form" onSubmit={jumpToMonth}><label className="mu-field" htmlFor="life-jump-month"><span className="mu-label">Capture month</span><input id="life-jump-month" className="mu-input" type="month" min="2005-01" max="2022-12" value={jump} onChange={e=>setJump(e.target.value)} required/></label><button id="life-go-to-month" type="submit" className="xce-btn">Go to month<ArrowRight size={15}/></button></form></Modal>

    <Modal id="life-about-dialog" label="About this interaction study" className="life-small-dialog" open={helpOpen} onClose={()=>setHelpOpen(false)}><div className="life-drawer-header"><h2>A first look at Life Timeline</h2><IconButton id="life-about-close" label="Close prototype information" icon={<X {...iconProps}/>} onClick={()=>setHelpOpen(false)}/></div><div className="life-about-content"><p>Explore 20,000 generated records across 2005–2022. The field uses 36 public sample photographs repeatedly; this is an interaction prototype, not a benchmark of 20,000 unique photographs.</p><ul><li>Scroll or pinch to zoom. Drag to travel through time.</li><li>Hover to magnify a moment; click or tap to open it.</li><li>Use Filters to combine metadata conditions.</li><li>Try Contact sheet for a familiar, keyboard-accessible view.</li></ul><p>Controls, forms, fonts, and colors reuse HITLOOP’s UI kit. The personal library, Firebase, NAS, and photolib worker are not connected.</p><a href="/sample-credits.json" target="_blank" rel="noreferrer">Sample photo sources<ArrowUpRight size={13}/></a></div></Modal>

    <PhotoViewer item={item} position={selectedPosition} total={matches.length} onClose={closeViewer} onMove={moveViewer}/>
  </main>;
}
