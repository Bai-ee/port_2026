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

  /* Mobile: stack labels above values and enlarge all body/label text so the
     brief reads as a vertical breakdown on narrow screens. Presentation-only —
     targets the shared .k/.v/tile/flow classes used by every brief renderer. */
  @media(max-width:640px){
    /* Tight gutter on narrow viewports (incl. the dashboard's brief iframe on
       phones) — the desktop 8vw side margins left the brief content visibly
       narrow inside the full-screen modal. */
    :root{--gutter:clamp(12px,4vw,24px)}
    section.page{padding:clamp(40px,7vh,72px) var(--gutter) clamp(48px,8vh,96px)}
    .eyebrow{font-size:13px;gap:12px;margin-bottom:20px}
    .sub{font-size:clamp(19px,5.2vw,24px);line-height:1.4;margin-bottom:32px}

    .stat-row{grid-template-columns:1fr;gap:6px;padding:18px 0}
    .stat-row .k{font-size:13px;letter-spacing:.18em;padding-top:0}
    .stat-row .v{font-size:18px;line-height:1.55}

    .pull{font-size:clamp(22px,6vw,30px);padding:6px 0 6px 18px;max-width:none}

    .meta-grid{grid-template-columns:1fr;margin-top:24px}
    .meta-tile .k{font-size:12px}
    .meta-tile .v{font-size:17px}

    .cover .meta{grid-template-columns:1fr 1fr;gap:20px 24px;margin-top:32px}
    .cover .meta .k{font-size:12px}
    .cover .meta .v{font-size:17px}

    .flow .node{padding:20px}
    .flow .node .n{font-size:12px}
    .flow .node .t{font-size:24px}
    .flow .node p{font-size:16px;line-height:1.55}

    footer{font-size:12px}
  }

  /* ── Bento board system — one number or one phrase per tile. All rules
     scoped under .bento (plus the cover weather strip id) so the shared
     stylesheet stays additive for estimate-renderer / brief-renderer. ── */
  .bento{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .bento .s2{grid-column:span 2}
  .bento-gap{height:clamp(20px,3vh,36px)}

  .bento .tile{
    background:var(--card);
    border:1px solid var(--line);
    border-radius:18px;
    box-shadow:0 1px 0 var(--hl), inset 0 1px 0 rgba(255,255,255,0.4);
    padding:clamp(16px,2.4vw,26px);
    display:flex;flex-direction:column;justify-content:space-between;
    gap:14px;min-height:128px;min-width:0;overflow:hidden;
  }
  .bento .tile .k{
    font-family:"Space Mono",monospace;font-size:11px;
    letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);
    display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;
  }
  .bento .tile .big{
    font-family:"Doto",monospace;font-weight:900;line-height:.85;
    font-size:clamp(44px,12.5vw,112px);letter-spacing:.01em;
    max-width:100%;overflow-wrap:break-word;
  }
  .bento .tile .big .unit{font-size:.32em;letter-spacing:.06em;vertical-align:baseline}
  .bento .tile .word{
    font-family:"Space Grotesk";font-weight:500;line-height:1.02;
    font-size:clamp(24px,6.5vw,48px);letter-spacing:-.01em;
    text-wrap:balance;max-width:100%;overflow-wrap:break-word;
  }
  .bento .tile .word.lite{font-weight:300}
  .bento .tile .foot{
    font-family:"Space Grotesk";font-size:12px;line-height:1.45;
    color:var(--ink-soft);max-width:42ch;
  }
  .bento .v-good{color:#166534}
  .bento .v-avg{color:#b45309}
  .bento .v-bad{color:#c2410c}
  .bento .verdict{
    font-family:"Space Mono";font-size:11px;letter-spacing:.22em;
    text-transform:uppercase;font-weight:700;
  }
  .bento .tile.ink{background:var(--ink);border-color:var(--ink);color:#f6f3ea;box-shadow:none}
  .bento .tile.ink .k{color:rgba(246,243,234,.65)}
  .bento .tile.ink .foot{color:rgba(246,243,234,.6)}
  .bento .tile.quote .word{font-weight:300;font-size:clamp(24px,6.5vw,46px);line-height:1.12;max-width:30ch}

  /* Quote-wall tiles — tweets, web pulls, reddit voices. */
  .bento .tile.say{justify-content:flex-start;gap:16px}
  .bento .tile.say .q{
    font-family:"Space Grotesk";font-weight:300;
    font-size:clamp(19px,4.8vw,30px);line-height:1.28;
    max-width:100%;overflow-wrap:break-word;
  }
  .bento .tile.say .who{
    font-family:"Space Mono",monospace;font-size:11px;
    letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);
    display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  }
  .bento .tile.say .who .src{padding:3px 9px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.5)}
  .bento .tile.ink.say .who{color:rgba(246,243,234,.65)}
  .bento .tile.ink.say .who .src{background:transparent;border-color:rgba(246,243,234,.3)}

  /* Calendar day tiles — compact, one post idea per day. */
  .bento .tile.day{min-height:0;gap:8px;padding:14px 16px;justify-content:flex-start}
  .bento .tile.day .word{font-size:clamp(16px,4.2vw,22px);line-height:1.15}
  .bento .tile.day .foot{font-size:11px}

  /* Cover weather strip — its own row at the top of the title stack. */
  #brief-cover-weather{
    flex-basis:100%;width:100%;
    font-family:"Space Mono",monospace;font-size:11px;
    letter-spacing:.2em;text-transform:uppercase;color:var(--ink-soft);
    margin:0 0 14px;
  }

  @media(min-width:760px){
    .bento{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
    .bento .s2{grid-column:span 2}
    .bento .s3{grid-column:span 3}
    .bento .s4{grid-column:span 4}
    .bento .tile{min-height:160px}
    .bento .tile.day{min-height:0}
    .bento .tile .big{font-size:clamp(64px,7.5vw,128px)}
    .bento .tile .word{font-size:clamp(28px,3.2vw,48px)}
    .bento .tile.day .word{font-size:clamp(16px,1.6vw,22px)}
  }

  @media print{
    section.page{min-height:auto;padding:48px 40px;page-break-after:always;page-break-inside:avoid}
    .sec-num{font-size:140px}
  }
`;

module.exports = { BRIEF_CSS };
