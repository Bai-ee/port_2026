'use strict';
// Generates public/docs/dashboard-system-map.html
// Layered left→right DAG: every card is a node, edges show data flow card→card.
// Run: node scripts/gen-system-map.cjs
const fs = require('fs');

// role: in,eng,out,act,meta,up
// col: 0 seed · 1 context · 2 inputs · 3 engines · 4 outputs · 5 actions
const N = {};
const node = (id, t, col, role, grp) => (N[id] = { id, t, col, role, grp, w: 0, x: 0, y: 0 });

// col 0
node('intake','Site Intake',0,'eng','seed');
// col 1 — context (knowledge)
node('brain','Company Brain',1,'in','ctx');
node('founder','Founder Q&A',1,'in','ctx');
node('bizmodel','Business Model',1,'out','ctx');
node('category','Market Category',1,'out','ctx');
node('coverage','Data Coverage',1,'meta','ctx');
// col 2 — inputs (marketing) then brand-truth
['bk|Brand & Keywords','watch|Watchlist','comps|Competitors','splan|Search Plan','focus|Research Focus',
 'plat|Web + Platforms','social|Social Signals','weather|Local Weather','convo|Conversation Intake',
 'platcov|Platform Coverage','bpreview|Brief Preview','emailset|Email Settings']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,2,'in','mkt');});
['voice|Voice & Tone','vdna|Visual DNA','vaudit|Visual Audit','bsystem|Brand System']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,2,'out','brand');});
// col 3 — engines
node('briefeng','Brief Pipeline',3,'eng','e-brief');
node('seoeng','SEO / Audit',3,'eng','e-web');
node('creng','Copy & Creative',3,'eng','e-crea');
node('sitebuild','Site Build',3,'eng','e-crea');
// col 4 — outputs (block order: brief, website, creative)
['execbrief|Executive Daily Brief','bcomp|Competitor Brief','bmkt|Marketing Brief','bstrat|Strategy Brief',
 'bcrea|Creative Brief','bperf|Performance Brief','signals|Market Signals','compsnap|Competitor Snapshot',
 'localsig|Local Signals','priority|Priority Action','npstrat|Next-Post Strategy','cgaps|Content Gaps',
 'prules|Posting Rules','newsroll|Newsletter Roll-up','clientbrief|Client Brief','briefdoc|Brief Document']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,4,'out','o-brief');});
['seoperf|SEO + Performance','siteperf|Site Performance','visib|Search & Social Visibility','searchopp|Search Opportunities',
 'trust|Trust & Credibility','airead|AI Agent Readiness','socprev|Social Preview','deseval|Design Evaluation',
 'xdev|Cross-Device Layouts','conv|Conversion Readiness']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,4,'out','o-web');});
['drafts|Ready-to-Post Drafts','dbrief|Design Brief','mockc|Homepage Mockup (creative)','mockw|Homepage Mockup (web)']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,4,'out','o-crea');});
// col 5 — actions
['schedule|Schedule Posts','deploy|Build & Deploy Site','estimate|Publish Estimate','submitbrief|Submit Custom Brief',
 'emaildig|Email Digest','createclient|Create Client','events|Local Events']
 .forEach(s=>{const[i,t]=s.split('|');node(i,t,5,'act','act');});

const E = [];
const e = (a,b,light)=>E.push([a,b,!!light]);
// seed
['bk','bizmodel','category','voice','vdna','vaudit','seoeng'].forEach(t=>e('intake',t,true));
e('voice','bsystem'); e('vdna','bsystem');
e('bk','splan');
// inputs -> brief engine
['bk','watch','comps','splan','focus','plat','social','weather','convo','platcov','bpreview',
 'brain','founder','bizmodel','category'].forEach(s=>e(s,'briefeng'));
// brief engine -> brief/marketing outputs
['execbrief','bcomp','bmkt','bstrat','bcrea','bperf','signals','compsnap','localsig','priority',
 'npstrat','cgaps','prules','newsroll','clientbrief','briefdoc'].forEach(o=>e('briefeng',o,true));
e('execbrief','emaildig'); e('emailset','emaildig'); e('execbrief','submitbrief',true);
// creative
e('briefeng','creng',true); e('voice','creng'); e('bsystem','creng'); e('brain','creng',true);
e('creng','drafts'); e('drafts','schedule');
e('vdna','mockc'); e('vdna','mockw'); e('bsystem','dbrief');
// website / seo
['seoperf','siteperf','visib','searchopp','trust','airead','socprev','deseval','xdev','conv']
 .forEach(o=>e('seoeng',o,true));
// site build
e('bsystem','sitebuild',true); e('vdna','sitebuild',true); e('sitebuild','deploy'); e('deploy','estimate');

// ── layout ──
const colX = [26, 150, 320, 560, 770, 1035];
const charW = 5.3, padIn = 15, H = 21, GAPV = 6, W = 1190;
for (const id in N) { const n = N[id]; n.w = Math.max(54, Math.round(n.t.length * charW) + padIn); }
function stack(ids, startY, groupGaps) {
  let y = startY, lastGrp = null;
  for (const id of ids) {
    const n = N[id];
    if (groupGaps && lastGrp !== null && n.grp !== lastGrp) y += 12;
    n.y = y; n.x = colX[n.col]; y += H + GAPV; lastGrp = n.grp;
  }
  return y;
}
const byCol = (c) => Object.values(N).filter(n => n.col === c).map(n => n.id);
// col 4 first (defines block centroids for hubs)
const c4 = byCol(4); stack(c4, 50, true);
const centroid = (grp) => { const ns = c4.map(i=>N[i]).filter(n=>n.grp===grp); return ns.reduce((a,n)=>a+n.y+H/2,0)/ns.length; };
// other columns
stack(byCol(0), 60);
stack(byCol(1), 50, true);
stack(byCol(2), 50, true);
stack(byCol(5), 60);
// hubs aligned to their output blocks
N.briefeng.y = centroid('o-brief') - H/2;
N.seoeng.y   = centroid('o-web') - H/2;
const cc = centroid('o-crea');
N.creng.y = cc - H - 4; N.sitebuild.y = cc + 4;
['briefeng','seoeng','creng','sitebuild'].forEach(i=>N[i].x=colX[3]);
const maxY = Math.max(...Object.values(N).map(n=>n.y+H)) ;

// ── render helpers (defined before use) ──
const RC = { in:['#eaf1fe','#2563eb','#1e40af'], eng:['#efe9db','#7c3aed','#5b21b6'], out:['#ecf4ec','#2f6b3d','#2f6b3d'],
  act:['#f8efe8','#b8542e','#9a3f1e'], meta:['#f6f0e2','#8a6a1f','#8a6a1f'], up:['#f1f0ee','#b9b3a7','#7a7567'] };
function pill(x,y,w,t,role){const[f,s,c]=RC[role];return `<g><rect x="${x}" y="${y}" width="${w}" height="${H}" rx="${H/2}" fill="${f}" stroke="${s}" stroke-width="1.1"/><circle cx="${x+10}" cy="${y+H/2}" r="2.6" fill="${s}"/><text class="pt" x="${x+18}" y="${y+H/2+3.2}" fill="${c}">${t.replace(/&/g,'&amp;')}</text></g>`;}

// ── off-spine cluster ──
const OFF = ['Content Engine','Automation Opportunities','Reporting & Insights',
 'Contact Your Human','Fix This','Run My Marketing','Creative Work','Build a Page','Short-Form Video','Long-Form Video',
 'Single Graphic','Carousel Kit','Social Management','Logo & Brand Refresh','Landing Page Build','Email Campaign',
 'UI Screen Design','UI Flow Design'];
let offY = maxY + 56, offX = 26, offParts = [];
offParts.push(`<text class="hdr" x="26" y="${maxY+34}">OFF THE DATA SPINE — services + automation (no pipeline edges)</text>`);
for (const t of OFF) {
  const w = Math.max(54, Math.round(t.length*charW)+padIn);
  if (offX + w > W-20) { offX = 26; offY += H + GAPV; }
  offParts.push(pill(offX, offY, w, t, 'up')); offX += w + 7;
}
const totalH = offY + H + 20;

// ── render ──
let parts = [];
// stage headers
[['INTAKE',26],['CONTEXT',150],['INPUTS',320],['ENGINES',560],['OUTPUTS',770],['ACTIONS',1035]].forEach(([t,x])=>parts.push(`<text class="stage" x="${x}" y="30">${t}</text>`));
// edges first
for (const [a,b,light] of E) {
  const f=N[a], t=N[b]; if(!f||!t) continue;
  const x1=f.x+f.w, y1=f.y+H/2, x2=t.x, y2=t.y+H/2;
  parts.push(`<path class="${light?'el':'es'}" d="M${x1} ${y1} C${x1+34} ${y1} ${x2-34} ${y2} ${x2} ${y2}" marker-end="url(#a${light?'l':'s'})"/>`);
}
// nodes
for (const id in N) { const n=N[id]; parts.push(pill(n.x,n.y,n.w,n.t,n.role)); }
parts.push(...offParts);

const svg = `<svg viewBox="0 0 ${W} ${totalH}" width="${W}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
<defs>
 <marker id="as" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8a8070"/></marker>
 <marker id="al" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#c9bfa8"/></marker>
</defs>
<style>
 .stage{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;fill:#b9ad96;}
 .hdr{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;fill:#a89e8a;}
 .pt{font-family:'Space Mono',monospace;font-size:9.5px;}
 .es{fill:none;stroke:#9a8f79;stroke-width:1.3;}
 .el{fill:none;stroke:#d4c9b1;stroke-width:1.1;}
</style>
${parts.join('\n')}
</svg>`;

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Dashboard System Map — flow</title>
<style>
 @import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
 :root{--bg:#fbf8f0;--ink:#12100c;--soft:#5a5346;--light:#8a8070;--line:#d9cfb9;--card:#fffdf7;--mono:'Space Mono',monospace;--body:'Space Grotesk',system-ui,sans-serif;--disp:'Doto','Space Mono',monospace;}
 *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased;}
 .wrap{max-width:1260px;margin:0 auto;padding:46px 22px 90px;}
 .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--light);margin:0 0 10px;}
 h1{font-family:var(--disp);font-weight:900;font-size:clamp(38px,6vw,66px);line-height:.85;letter-spacing:-.03em;text-transform:uppercase;margin:0 0 14px;}
 .lede{font-size:15px;line-height:1.6;color:var(--soft);max-width:720px;margin:0 0 6px;}
 .meta{font-family:var(--mono);font-size:11px;color:var(--light);}
 .roles{display:flex;gap:15px;flex-wrap:wrap;margin:20px 0 4px;font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--soft);}
 .roles span{display:inline-flex;align-items:center;gap:6px;} .dot{width:10px;height:10px;border-radius:50%;border:1.4px solid;display:inline-block;}
 .canvas{margin-top:18px;overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--card);} svg{display:block;min-width:${W}px;}
 h2{font-family:var(--disp);font-weight:900;font-size:26px;text-transform:uppercase;margin:50px 0 10px;}
 .cut{background:var(--card);border:1px solid var(--line);border-left:3px solid #a8392a;border-radius:10px;padding:12px 15px;margin:10px 0;font-size:13px;line-height:1.55;color:var(--soft);} .cut b{color:var(--ink);}
 .foot{margin-top:46px;font-family:var(--mono);font-size:10px;color:var(--light);border-top:1px solid var(--line);padding-top:14px;}
</style></head><body><div class="wrap">
 <p class="eyebrow">HitLoop · Dashboard architecture</p>
 <h1>System Map<br>Card Flow</h1>
 <p class="lede">Every card is a node; arrows show data flowing card → card, left→right in analysis order. Bold arrows = inputs feeding an engine / chained outputs; faint arrows = an engine fanning out to its many display cards.</p>
 <p class="meta">v4 · generated · scripts/gen-system-map.cjs · 77 cards + 4 engine hubs</p>
 <div class="roles">
   <span><span class="dot" style="background:#eaf1fe;border-color:#2563eb"></span>Input</span>
   <span><span class="dot" style="background:#efe9db;border-color:#7c3aed"></span>Engine</span>
   <span><span class="dot" style="background:#ecf4ec;border-color:#2f6b3d"></span>Output</span>
   <span><span class="dot" style="background:#f8efe8;border-color:#b8542e"></span>Action</span>
   <span><span class="dot" style="background:#f6f0e2;border-color:#8a6a1f"></span>Meta</span>
   <span><span class="dot" style="background:#f1f0ee;border-color:#b9b3a7"></span>Upsell</span>
 </div>
 <div class="canvas">${svg}</div>
 <h2>What's maybe not necessary</h2>
 <div class="cut"><b>Brief proliferation:</b> Brief Pipeline fans out to 16 cards incl. 5 sliced briefs + 2 onboarding docs that duplicate existing cards (Competitor Brief≈Competitor Snapshot, Strategy Brief≈Next-Post Strategy…). Collapse to 1 brief + tabs.</div>
 <div class="cut"><b>Source-config sprawl:</b> Search Plan · Web+Platforms · Social Signals · Platform Coverage all feed the engine with the same source list. Merge.</div>
 <div class="cut"><b>Dup Homepage Mockup</b> (creative + web) and <b>two performance cards</b> (SEO+Performance / Site Performance).</div>
 <div class="cut"><b>Off-spine</b> Services (15) + Automation (3) have no pipeline edges — confirm Automation is live vs upsell placeholder.</div>
 <p class="foot">Generated · node scripts/gen-system-map.cjs · companion: brand-keywords-flow.html</p>
</div></body></html>`;

fs.writeFileSync('public/docs/dashboard-system-map.html', html);
console.log('wrote public/docs/dashboard-system-map.html · nodes:', Object.keys(N).length, '+ off-spine', OFF.length, '· edges:', E.length, '· H:', totalH);
