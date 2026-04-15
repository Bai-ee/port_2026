'use client';

import OnboardingChatModal from '../../../onboarding/OnboardingChatModal';
import InternalPageBackground from '../../../InternalPageBackground';

const STEPS = [
  {
    id: 'stage', order: 1, eyebrow: 'SET CONTEXT',
    title: 'Where are you at right now?', selectType: 'single',
    options: [
      { value: 'idea', label: 'Just an idea' },
      { value: 'early', label: 'Early (some work started)' },
      { value: 'in_progress', label: 'In progress (needs direction)' },
      { value: 'live', label: 'Live but needs improvement' },
      { value: 'scaling', label: 'Scaling / optimizing' },
    ],
  },
  {
    id: 'intent', order: 2, eyebrow: 'INTENT',
    title: 'What are you trying to get done?', helper: 'Pick any that apply.', selectType: 'multi',
    options: [
      { value: 'launch_new', label: 'Launch something new' },
      { value: 'improve_existing', label: 'Improve what I already have' },
      { value: 'fix_issues', label: 'Fix specific issues' },
      { value: 'build_content', label: 'Build content / visuals' },
      { value: 'automate', label: 'Automate workflows' },
      { value: 'not_sure', label: 'Not sure — need direction' },
    ],
  },
  {
    id: 'services', order: 3, eyebrow: 'SERVICES',
    title: 'What do you think you need?', helper: 'Pick anything. You can change this later.', selectType: 'multi',
    options: [
      { value: 'branding', label: 'Branding (logo, identity)' },
      { value: 'website', label: 'Website / landing page' },
      { value: 'product_ui', label: 'App / product UI' },
      { value: 'social_content', label: 'Social content / marketing assets' },
      { value: 'video_motion', label: 'Video / motion' },
      { value: 'ai_automation', label: 'AI / automation setup' },
      { value: 'ongoing_creative', label: 'Ongoing creative support' },
    ],
  },
  {
    id: 'priority', order: 4, eyebrow: 'PRIORITY',
    title: 'What matters most right now?', selectType: 'single',
    options: [
      { value: 'speed', label: 'Speed (need this fast)' },
      { value: 'quality', label: 'Quality (needs to be right)' },
      { value: 'cost', label: 'Cost (budget matters most)' },
      { value: 'direction', label: 'Direction (I need help figuring it out)' },
    ],
  },
  {
    id: 'blocker', order: 5, eyebrow: 'BIGGEST PROBLEM',
    title: "What's slowing you down right now?", selectType: 'text', maxLength: 500,
  },
  {
    id: 'timeline', order: 6, eyebrow: 'TIMELINE',
    title: 'When do you want to move?', selectType: 'single',
    options: [
      { value: 'asap', label: 'ASAP' },
      { value: 'few_weeks', label: 'Within a few weeks' },
      { value: 'exploring', label: 'Just exploring' },
      { value: 'not_sure', label: 'Not sure yet' },
    ],
  },
];

const MOCK_LINES = [
  { type: 'info',   prefix: 'sys',   text: 'Starting build pipeline…' },
  { type: 'fetch',  prefix: 'fetch', text: 'Crawling https://example.com' },
  { type: 'fetch',  prefix: 'fetch', text: 'Resolved 14 pages' },
  { type: 'ok',     prefix: 'ok',    text: 'Sitemap extracted' },
  { type: 'ai',     prefix: 'ai',    text: 'Analyzing brand voice…' },
  { type: 'ai',     prefix: 'ai',    text: 'Extracting design tokens' },
  { type: 'build',  prefix: 'build', text: 'Generating capability cards' },
  { type: 'build',  prefix: 'build', text: 'Compiling dashboard layout' },
  { type: 'ok',     prefix: 'ok',    text: 'SEO snapshot ready' },
  { type: 'active', prefix: '···',   text: 'Finalizing your dashboard', cursor: true },
];

export default function IntakeModalPreviewPage() {
  const noop = async () => {};

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        #preview-root {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          position: relative;
        }

        /* ── Card ── */
        #intake-modal-card {
          position: relative;
          width: 100%;
          max-width: 52rem;
          padding: clamp(1.25rem, 5vw, 2rem);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15);
          border: 1px solid rgba(255, 255, 255, 0.5);
        }

        /* ── Brand row ── */
        #preview-brand-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
          justify-content: space-between;
        }
        #preview-brand-row img { width: 2.75rem; height: auto; display: block; }
        #preview-brand-eyebrow {
          font-size: 0.82rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(42,36,32,0.44);
          font-weight: 700;
          font-family: "Space Mono", monospace;
        }
        #preview-status-orb {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.4rem;
          height: 2.4rem;
          border-radius: 999px;
          background: rgba(255,255,255,0.34);
          border: 1px solid rgba(42,36,32,0.12);
        }
        #preview-status-dot {
          width: 0.46rem;
          height: 0.46rem;
          border-radius: 999px;
          background: #D4A843;
          animation: status-pulse 1.4s ease-in-out infinite;
        }
        @keyframes status-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.8); }
        }

        /* ── Marquee ── */
        #preview-marquee-viewport { width: 100%; overflow: hidden; margin: 0 0 0.7rem; }
        #preview-marquee-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation: marquee-scroll 18s linear infinite;
        }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .preview-marquee-span {
          margin: 0;
          flex-shrink: 0;
          color: #2a2420;
          font-size: clamp(2rem, 8.5vw, 7rem);
          line-height: 1;
          letter-spacing: -0.04em;
          font-family: "Doto", "Space Mono", monospace;
          font-weight: 700;
          white-space: nowrap;
        }

        /* ── Copy ── */
        #intake-modal-copy {
          margin: 0;
          color: rgba(42,36,32,0.66);
          line-height: 1.6;
          font-family: "Space Grotesk", system-ui, sans-serif;
          text-align: center;
        }

        /* ── Body 2-col ── */
        #intake-modal-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
          gap: 1rem;
          align-items: stretch;
          margin-top: 0.85rem;
          height: 360px;
        }
        #intake-modal-terminal-col {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: #1a1a1a;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-top: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15);
          border-radius: 10px;
          overflow: hidden;
        }
        #intake-modal-terminal-titlebar {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.02);
          flex-shrink: 0;
        }
        .term-win-dot {
          width: 0.52rem;
          height: 0.52rem;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .term-win-dot-close { background: rgba(255, 95, 86, 0.65); }
        .term-win-dot-min   { background: rgba(255, 189, 46, 0.65); }
        .term-win-dot-max   { background: rgba(39, 201, 63, 0.65); }
        #intake-modal-terminal-title {
          flex: 1;
          text-align: center;
          font-family: "Space Mono", monospace;
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.3);
        }
        #intake-modal-terminal-embed {
          border-radius: 0;
          flex: 1 1 auto;
          height: 0;
          min-height: 0;
          max-height: none;
          padding: 0.7rem 0.85rem 0.8rem;
          height: auto;
          max-height: 240px;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.08) transparent;
        }
        #intake-modal-terminal-embed::-webkit-scrollbar { width: 3px; }
        #intake-modal-terminal-embed::-webkit-scrollbar-track { background: transparent; }
        #intake-modal-terminal-embed::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

        /* Log lines */
        .term-line {
          display: grid;
          grid-template-columns: 3.6rem 1fr;
          gap: 0.5em;
          font-family: "Space Mono", monospace;
          font-size: 0.68rem;
          line-height: 1.65;
          align-items: baseline;
        }
        .term-pfx { text-align: right; white-space: nowrap; font-size: 0.64rem; letter-spacing: 0.02em; }
        .term-msg { word-break: break-word; }
        .term-info .term-pfx  { color: #4b5263; } .term-info .term-msg  { color: #6a6f7a; }
        .term-fetch .term-pfx { color: #56b6c2; } .term-fetch .term-msg { color: #7ab8bd; }
        .term-ok .term-pfx    { color: #98c379; } .term-ok .term-msg    { color: #5d8a44; }
        .term-ai .term-pfx    { color: #c678dd; } .term-ai .term-msg    { color: #8c52b8; }
        .term-build .term-pfx { color: #e5c07b; } .term-build .term-msg { color: #a8843c; }
        .term-error .term-pfx { color: #e06c75; } .term-error .term-msg { color: #a84f57; }
        .term-active .term-pfx { color: #61afef; }
        .term-active .term-msg { color: #dde1e8; font-weight: 700; }
        .term-caret {
          display: inline-block;
          width: 0.45em; height: 0.95em;
          background: #61afef;
          vertical-align: text-bottom;
          margin-left: 2px;
          animation: blink 1s step-start infinite;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        #intake-modal-survey-col {
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          border-radius: 10px;
          display: flex;
          flex-direction: column;
        }

        /* ── Footer ── */
        #intake-modal-footer {
          font-family: "Space Mono", monospace;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(42,36,32,0.32);
          margin-top: 0.9rem;
          border-top: 1px solid rgba(212,196,171,0.4);
          padding-top: 0.75rem;
        }

        /* ── Onboarding chat ── */
        #onboarding-chat-shell {
          display: flex; flex-direction: column;
          width: 100%; height: 100%; min-height: 0; max-height: 100%; flex: 1 1 auto;
          background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.5) 100%);
          box-shadow: 0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: 10px;
          border: 1px solid rgba(42,36,32,0.1);
          overflow: hidden;
        }
        #onboarding-chat-header {
          display: flex; align-items: center; gap: 0.65rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(42,36,32,0.08);
          background: rgba(255,255,255,0.7);
          flex-shrink: 0;
        }
        #onboarding-chat-avatar-wrap { position: relative; flex-shrink: 0; }
        #onboarding-chat-avatar-img {
          width: 2.4rem; height: 2.4rem;
          border-radius: 999px; object-fit: cover; display: block;
        }
        #onboarding-chat-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 0.55rem; height: 0.55rem; border-radius: 999px;
          background: #4A9E5C; border: 2px solid rgba(255,252,248,0.92);
        }
        #onboarding-chat-identity { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 0; }
        #onboarding-chat-name { font-family: "Space Grotesk",system-ui,sans-serif; font-weight: 700; font-size: 0.88rem; color: #2a2420; line-height: 1.2; }
        #onboarding-chat-subtitle { font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.72rem; color: rgba(42,36,32,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #onboarding-chat-badge {
          font-family: "Space Mono",monospace; font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: rgba(42,36,32,0.62); border: 1px solid rgba(42,36,32,0.18);
          border-radius: 999px; padding: 0.25rem 0.6rem; white-space: nowrap; flex-shrink: 0;
        }
        #onboarding-chat-close {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.8rem; height: 1.8rem; border-radius: 999px;
          background: rgba(255,255,255,0.55); border: 1px solid rgba(42,36,32,0.12);
          cursor: pointer; font-size: 0.76rem; color: rgba(42,36,32,0.55);
          flex-shrink: 0; transition: background 0.15s ease, color 0.15s ease;
        }
        #onboarding-chat-close:hover:not(:disabled) { background: rgba(255,255,255,0.85); color: rgba(42,36,32,0.9); }
        #onboarding-chat-close:disabled { opacity: 0.4; cursor: default; }
        #onboarding-chat-step-count {
          font-family: "Space Mono", monospace;
          font-size: 0.68rem; letter-spacing: 0.1em;
          color: rgba(42,36,32,0.44); flex-shrink: 0; white-space: nowrap;
        }
        #onboarding-chat-progress-rail {
          height: 2px; background: rgba(42,36,32,0.08);
          flex-shrink: 0; position: relative; overflow: hidden;
        }
        #onboarding-chat-progress-fill {
          display: block; height: 100%;
          background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
          transition: width 0.35s ease;
        }
        #onboarding-chat-messages {
          flex: 1 1 auto; min-height: 0; overflow-y: auto;
          padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;
          scrollbar-width: thin; scrollbar-color: rgba(42,36,32,0.14) transparent;
        }
        #onboarding-chat-messages::-webkit-scrollbar { width: 3px; }
        #onboarding-chat-messages::-webkit-scrollbar-thumb { background: rgba(42,36,32,0.14); border-radius: 2px; }
        @keyframes chat-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .chat-turn { display: flex; flex-direction: column; gap: 0.5rem; animation: chat-msg-in 0.22s ease; }
        .chat-row-user { animation: chat-msg-in 0.18s ease; }
        .chat-row { display: flex; align-items: flex-end; gap: 0.5rem; }
        .chat-row-bot { justify-content: flex-start; }
        .chat-row-user { justify-content: flex-end; }
        .chat-avatar-sm { width: 1.6rem; height: 1.6rem; border-radius: 999px; object-fit: cover; flex-shrink: 0; display: block; }
        .chat-bubble {
          max-width: 82%; padding: 0.6rem 0.85rem; border-radius: 1rem;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.9rem; line-height: 1.45;
          display: flex; flex-direction: column; gap: 0.25rem;
        }
        .chat-bubble-bot { background: #fff; border: 1px solid rgba(42,36,32,0.09); border-bottom-left-radius: 0.2rem; color: #2a2420; box-shadow: 0 1px 3px rgba(42,36,32,0.06); }
        .chat-bubble-user { background: #2a2420; color: #faf7f2; border-bottom-right-radius: 0.2rem; font-size: 0.88rem; }
        .chat-eyebrow { font-family: "Space Mono",monospace; font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(42,36,32,0.44); font-weight: 700; }
        .chat-question { font-weight: 300; font-size: clamp(1.15rem, 2vw, 1.6rem); color: rgba(42, 36, 32, 0.75); line-height: 1.4; }
        .chat-helper { font-size: 0.8rem; color: rgba(42,36,32,0.55); }
        .chat-typing-bubble { flex-direction: row; gap: 0.3rem; align-items: center; padding: 0.65rem 1rem; }
        .typing-dot { width: 0.4rem; height: 0.4rem; border-radius: 999px; background: rgba(42,36,32,0.35); animation: typing-bounce 1.2s ease-in-out infinite; }
        .typing-dot:nth-child(2) { animation-delay: 0.18s; }
        .typing-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes typing-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-0.3rem); opacity: 1; } }
        .chat-options-zone { padding-left: 2.1rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .chat-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .chat-chip {
          appearance: none; cursor: pointer;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.82rem; font-weight: 500;
          padding: 0.4rem 0.85rem; border-radius: 999px;
          border: 1px solid rgba(42,36,32,0.22); background: rgba(255,255,255,0.8); color: #2a2420;
          transition: background 0.13s ease, border-color 0.13s ease, color 0.13s ease; line-height: 1.3;
        }
        .chat-chip:hover:not(:disabled) { background: rgba(42,36,32,0.07); border-color: rgba(42,36,32,0.4); }
        .chat-chip.is-selected { background: #2a2420; border-color: #2a2420; color: #faf7f2; }
        .chat-chip:disabled { opacity: 0.5; cursor: default; }
        .chat-chip-primary { background: #2a2420; border-color: #2a2420; color: #faf7f2; font-weight: 600; }
        .chat-chip-primary:hover:not(:disabled) { background: #1a1412; border-color: #1a1412; color: #faf7f2; }
        .chat-text-wrap { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; }
        .chat-text-input {
          width: 100%; resize: vertical; padding: 0.65rem 0.85rem; border-radius: 0.65rem;
          border: 1px solid rgba(42,36,32,0.14); background: rgba(255,255,255,0.9); color: #2a2420;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.88rem; line-height: 1.45;
          outline: none; transition: border-color 0.15s ease; box-sizing: border-box;
        }
        .chat-text-input:focus { border-color: rgba(42,36,32,0.42); }
        .chat-text-actions { display: flex; justify-content: flex-end; align-items: center; gap: 0.4rem; }
        .chat-skip-btn {
          appearance: none; cursor: pointer;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.8rem;
          padding: 0.38rem 0.8rem; border-radius: 999px; border: 1px solid transparent;
          background: transparent; color: rgba(42,36,32,0.5); transition: color 0.13s ease;
        }
        .chat-skip-btn:hover:not(:disabled) { color: #2a2420; }
        .chat-skip-btn:disabled { opacity: 0.4; cursor: default; }
        .chat-confirm-btn {
          appearance: none; cursor: pointer;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.82rem; font-weight: 600;
          padding: 0.4rem 1rem; border-radius: 999px;
          border: 1px solid #2a2420; background: #2a2420; color: #faf7f2;
          transition: background 0.13s ease;
        }
        .chat-confirm-btn:hover:not(:disabled) { background: #1a1412; }
        .chat-confirm-btn:disabled { opacity: 0.45; cursor: default; }
        #onboarding-chat-footer {
          display: flex; align-items: center; padding: 0.6rem 1rem;
          border-top: 1px solid rgba(42,36,32,0.07); background: rgba(255,255,255,0.5); flex-shrink: 0;
        }
        #onboarding-chat-skip-all {
          appearance: none; cursor: pointer;
          font-family: "Space Grotesk",system-ui,sans-serif; font-size: 0.78rem;
          padding: 0.35rem 0.8rem; border-radius: 999px; border: 1px solid transparent;
          background: transparent; color: rgba(42,36,32,0.45); transition: color 0.13s ease;
        }
        #onboarding-chat-skip-all:hover:not(:disabled) { color: #2a2420; }
        #onboarding-chat-skip-all:disabled { opacity: 0.4; cursor: default; }

        @media (max-width: 900px) {
          #preview-root { align-items: flex-start; overflow-y: auto; padding: 1rem 0.75rem; }
          #intake-modal-card { width: 95vw; box-sizing: border-box; }
          #intake-modal-body { grid-template-columns: 1fr; height: auto; }
          #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-col { height: 180px; flex-shrink: 0; }
          #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-embed { height: 0; max-height: none; }
        }
        @media (max-width: 480px) {
          #preview-root { padding: 1rem 0.5rem; }
          #intake-modal-card { width: 95vw; }
        }

        /* ── Preview label ── */
        #preview-label {
          position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
          font-family: "Space Mono", monospace; font-size: 0.65rem;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: rgba(42,36,32,0.4); background: rgba(255,255,255,0.6);
          border: 1px solid rgba(42,36,32,0.1); border-radius: 999px;
          padding: 0.35rem 0.9rem; backdrop-filter: blur(8px);
          pointer-events: none; z-index: 10;
        }
      `}</style>

      <InternalPageBackground />

      <div id="preview-label">Preview — intake modal card</div>

      <div id="preview-root" style={{ position: 'relative', zIndex: 1 }}>
        <div id="intake-modal-card" data-with-survey="true">

          {/* Brand row */}
          <div id="preview-brand-row">
            <img src="/img/sig.png" alt="" aria-hidden="true" />
            <span id="preview-brand-eyebrow">Dashboard Creation In Progress</span>
            <span id="preview-status-orb" aria-hidden="true">
              <span id="preview-status-dot" />
            </span>
          </div>

          {/* Marquee */}
          <div id="preview-marquee-viewport">
            <div id="preview-marquee-track">
              {['a', 'b'].map((k) => (
                <span key={k} className="preview-marquee-span" aria-hidden={k === 'b' ? 'true' : undefined}>
                  {'CREATING YOUR DASHBOARD\u00A0'}
                </span>
              ))}
            </div>
          </div>

          {/* Copy */}
          {/* <p id="intake-modal-copy">Answer the questions below to get the best results.</p> */}

          {/* Body */}
          <div id="intake-modal-body">
            <div id="intake-modal-terminal-col">
              <div id="intake-modal-terminal-titlebar">
                <span className="term-win-dot term-win-dot-close" />
                <span className="term-win-dot term-win-dot-min" />
                <span className="term-win-dot term-win-dot-max" />
                <span id="intake-modal-terminal-title"></span>
              </div>
              <div id="intake-modal-terminal-embed">
                {MOCK_LINES.map((line, i) => (
                  <div key={i} className={`term-line term-${line.type}`}>
                    <span className="term-pfx">{line.prefix}</span>
                    <span className="term-msg">{line.text}</span>
                    {line.cursor ? <span className="term-caret" /> : null}
                  </div>
                ))}
              </div>
            </div>

            <div id="intake-modal-survey-col">
              <OnboardingChatModal
                steps={STEPS}
                initialAnswers={{}}
                onAnswer={noop}
                onSkipStep={noop}
                onSkipAll={noop}
                onComplete={noop}
                onResolved={() => {}}
              />
            </div>
          </div>

          {/* Footer */}
          <div id="intake-modal-footer">example.com</div>

        </div>
      </div>
    </>
  );
}
