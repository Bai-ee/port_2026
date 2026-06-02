'use strict';

// Shared CSS for all founder-brief renderers.
// Kept in its own module so server routes can import it directly without
// pulling in the full brief-renderer (which reads files at module init).

const BRIEF_CSS = `
  :root{
    --bg:#f6f3ea;
    --bg2:#efe9d6;
    --ink:#0a0a0a;
    --ink-soft:#5a5346;
    --line:rgba(212,196,171,0.82);
    --card:rgba(255,255,255,0.5);
    --hl:rgba(255,255,255,0.65);
    --brand:#116dff;
    --grad:linear-gradient(92deg,#7a5cff 0%,#b14bff 38%,#ff4fa1 72%,#ff7a3a 100%);
    --gutter:max(8vw, calc((100% - 1100px) / 2));
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    font-family:"Space Grotesk",system-ui,sans-serif;
    color:var(--ink);
    background:
      radial-gradient(700px 420px at 0% 4%,    rgba(255,120,90,0.38) 0%, transparent 65%),
      radial-gradient(620px 380px at 100% 16%, rgba(176,90,255,0.32) 0%, transparent 65%),
      radial-gradient(700px 420px at 0% 30%,   rgba(255,90,160,0.32) 0%, transparent 65%),
      radial-gradient(600px 380px at 100% 44%, rgba(90,140,255,0.30) 0%, transparent 65%),
      radial-gradient(720px 440px at 0% 58%,   rgba(255,180,90,0.32) 0%, transparent 65%),
      radial-gradient(620px 400px at 100% 72%, rgba(200,90,255,0.30) 0%, transparent 65%),
      radial-gradient(660px 400px at 0% 86%,   rgba(120,200,255,0.28) 0%, transparent 65%),
      radial-gradient(560px 360px at 100% 98%, rgba(255,120,160,0.28) 0%, transparent 65%),
      linear-gradient(180deg, #fefdf9 0%, #fbf8f0 50%, #fdfaf2 100%);
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:"Space Mono",ui-monospace,monospace}
  .doto{font-family:"Doto",monospace;letter-spacing:.02em}

  section.page{
    min-height:100vh;
    padding:clamp(48px,9vh,120px) var(--gutter) clamp(64px,10vh,140px);
    display:flex; flex-direction:column; justify-content:center;
    border-bottom:1px solid rgba(0,0,0,0.05);
    position:relative; overflow:hidden;
  }
  .eyebrow{
    font-family:"Space Mono",monospace; font-size:11px;
    letter-spacing:.22em; text-transform:uppercase; color:var(--ink-soft);
    display:flex; gap:18px; align-items:center; margin-bottom:24px; flex-wrap:wrap;
  }
  .eyebrow .dot{width:6px;height:6px;background:var(--ink);border-radius:50%}
  .headline{
    font-family:"Doto",monospace;
    font-weight:900; letter-spacing:-.01em; line-height:.92;
    font-size:clamp(64px, 13vw, 200px);
    margin:0 0 24px;
    text-transform:uppercase;
  }
  .sub{
    font-family:"Space Grotesk",sans-serif;
    font-weight:300; font-size:clamp(20px,2.4vw,34px);
    line-height:1.25; color:#1a1a1a; max-width:58ch; margin:0 0 40px;
  }
  .rule{height:1px;background:rgba(0,0,0,.1);margin:28px 0}

  .cover .title-stack{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap}
  .cover .meta{
    display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
    gap:24px 40px; margin-top:40px;
    border-top:1px solid rgba(0,0,0,.15); padding-top:24px;
  }
  .cover .meta .k{font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  .cover .meta .v{font-family:"Space Grotesk";font-size:18px;word-break:break-word}
  .marquee{
    overflow:hidden; white-space:nowrap;
    font-family:"Doto",monospace; font-weight:900;
    font-size:clamp(44px,10vw,160px); text-transform:uppercase;
    line-height:1; letter-spacing:.02em;
    border-top:1px solid rgba(0,0,0,.2);
    border-bottom:1px solid rgba(0,0,0,.2);
    padding:12px 0; margin-top:40px;
  }
  .marquee span{display:inline-block}

  .card{
    background:var(--card);
    border:1px solid var(--line);
    border-radius:18px;
    box-shadow:0 1px 0 var(--hl), inset 0 1px 0 rgba(255,255,255,0.4);
    padding:clamp(18px,2vw,28px);
  }

  .brief-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(24px,3vw,48px);align-items:start}
  @media(max-width:900px){.brief-grid{grid-template-columns:1fr}}
  .stat-row{display:grid;grid-template-columns:120px 1fr;gap:16px;padding:14px 0;border-bottom:1px dashed rgba(0,0,0,.15)}
  .stat-row:last-child{border-bottom:0}
  .stat-row .k{font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);padding-top:4px}
  .stat-row .v{font-family:"Space Grotesk";font-size:16px;line-height:1.45}

  .pull{
    font-family:"Space Grotesk"; font-weight:300;
    font-size:clamp(26px,3.2vw,44px); line-height:1.2;
    border-left:4px solid var(--ink); padding:8px 0 8px 24px;
    max-width:28ch;
  }
  .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}
  @media(max-width:800px){.meta-grid{grid-template-columns:1fr 1fr}}
  .meta-tile{background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:14px;padding:16px}
  .meta-tile .k{font-family:"Space Mono";font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  .meta-tile .v{font-family:"Space Grotesk";font-size:15px;word-break:break-word}

  footer{padding:40px var(--gutter);font-family:"Space Mono";font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}

  .sec-num{
    position:absolute; top:24px; right:var(--gutter);
    font-family:"Doto"; font-weight:900;
    font-size:clamp(80px,14vw,220px);
    color:transparent; -webkit-text-stroke:1.5px rgba(0,0,0,.12);
    line-height:.8; pointer-events:none; user-select:none;
  }

  .flow{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  @media(max-width:800px){.flow{grid-template-columns:1fr}}
  .flow .node{padding:22px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.55)}
  .flow .node .n{font-family:"Space Mono";font-size:10px;letter-spacing:.22em;color:var(--ink-soft);margin-bottom:8px}
  .flow .node .t{font-family:"Doto";font-weight:900;font-size:26px;text-transform:uppercase;line-height:1}
  .flow .node p{font-family:"Space Grotesk";font-size:14px;margin:10px 0 0;color:#2a2a2a}

  @media print{
    section.page{min-height:auto;padding:48px 40px;page-break-after:always;page-break-inside:avoid}
    .sec-num{font-size:140px}
  }
`;

module.exports = { BRIEF_CSS };
