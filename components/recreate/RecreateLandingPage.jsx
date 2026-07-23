'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Globe, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import InternalPageBackground from '../../InternalPageBackground';
import UpRightArrow from '../UpRightArrow';
import RecreateTerminalOverlay, { useRecreateTerminal } from './RecreateTerminal';
import RecreatedSitesMarquee from './RecreatedSitesMarquee';

const CONTACT_HREF = 'https://calendly.com/bballi/30min';
const PENDING_URL_KEY = 'recreate.pendingUrl';
const LOGIN_HREF = `/login?redirect=${encodeURIComponent('/recreate')}`;

// Copy describes the actual `services/site-clone/` pipeline (discover →
// download → mirror → finalize → strip → verify → compress → package). Keep
// these bodies in sync with that engine; every number here is a real cap or
// gate from `run-clone.mjs`, not marketing rounding.
const CAPABILITIES = [
  {
    id: 'html-css-js',
    title: 'HTML5, CSS, and JavaScript',
    body: 'Your pages come back as the three file types every browser already reads on its own. Nothing needs a platform account, a plan, or a build step, so the same folder runs on Vercel, Netlify, S3, a cheap VPS, or your laptop. The zip includes a README and a small Node server with no dependencies, so running node serve.mjs opens the site at localhost:8000.',
  },
  {
    id: 'download',
    title: 'How the pages get downloaded',
    body: 'We read your sitemap.xml, and fall back to the links in your homepage nav when there is no sitemap. Shopify pages get fetched as your server sends them. Squarespace, Wix, and Next.js sites load in headless Chrome first, so what gets saved is the page after JavaScript runs instead of an empty shell.',
  },
  {
    id: 'assets',
    title: 'Every asset comes with it',
    body: 'Images, stylesheets, fonts, video, srcset variants, inline background images, and the files those stylesheets import. They download one at a time so your live site never gets hammered, land under assets/, and every reference in the markup is rewritten to point at the local copy. Images are recompressed at the end under the same filenames.',
  },
  {
    id: 'stripped',
    title: 'Tracking and checkout come out',
    body: 'Analytics, pixels, wallet and checkout scripts are removed per platform. On Shopify that means trekkie, web-pixels-manager, monorail, and the rest of the commerce bundle. Cart, checkout, and account links stop firing on purpose, and internal links are rewritten to the local page files.',
  },
  {
    id: 'verify',
    title: 'Nothing ships until it passes',
    body: 'The copy gets served on a local web server and every page is loaded in headless Chrome. Zero console errors, zero 404s, and one nav click that has to land on the right page. Rositas.com came back as 11 pages and 216 assets with zero errors. A failed check fails the whole job, so nobody hands you a broken folder and calls it done.',
  },
  {
    id: 'edit',
    title: 'Edit it without a rebuild',
    body: 'Every text node and image in the copy can become an editable slot sitting over your original theme, with Payload 3 and Turso behind it. You change the copy, not the code, and the design stays exactly where it was. We set that up for you, it is not part of the download.',
  },
  {
    id: 'archive',
    title: 'Then it stops being deletable',
    body: 'You see the cost first, then the site uploads to Arweave file by file with a path manifest and a readable ArNS name. Republishing repoints the name and leaves every older version standing as history. Uploads are permanent and paid from a funded wallet, so we run this part with you rather than handing you a button.',
  },
  {
    id: 'limits',
    title: 'What it does not do',
    body: 'No database, no products, no orders, no customer accounts, no server code, no working forms or logins. It reads public pages only and never writes to your live site. Interactivity that depends on the platform runtime stops with the tracking. Caps per run: 15 pages, 150 MB total, 25 MB per file.',
  },
];

// Mirrors the "previously at…" agency-logo marquee (StackedSlidesSection.jsx)
// — text wordmarks instead of logo image files (no third-party brand assets
// to source/license), same duplicated-set infinite-scroll trick.
const PLATFORM_NAMES = ['WIX', 'SQUARESPACE', 'SHOPIFY', 'WEBFLOW', 'WORDPRESS', 'GODADDY', 'WEEBLY'];

// Finished clone jobs feed the showcase belt. Thumbnail look is assigned
// round-robin (no screenshot is captured by the clone engine yet), so a real
// recreation still reads as its own tile next to the sample layouts.
const SHOWCASE_VARIANTS = ['hero', 'grid', 'editorial', 'shop'];
const SHOWCASE_HUES = [262, 185, 18, 314, 152];

function hostOf(rawUrl) {
  try { return new URL(rawUrl).hostname.replace(/^www\./, ''); } catch { return String(rawUrl || '').slice(0, 40); }
}

async function authFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

async function pollCloneJob({ user, jobId, initialJob, advance, note }) {
  let lastStatus = initialJob?.status || 'queued';
  let lastLogCount = initialJob?.log?.length || 0;
  let job = initialJob || null;
  const startedAt = Date.now();
  let lastActivityAt = Date.now();
  let queuedNoteShown = false;

  for (let attempt = 0; attempt < 300; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // eslint-disable-next-line no-await-in-loop
    const data = await authFetch(user, `/api/dashboard/site-clone?action=status&jobId=${encodeURIComponent(jobId)}`, { method: 'GET' });
    job = data.job;
    if (!job) continue;

    if (job.status !== lastStatus) {
      lastStatus = job.status;
      lastActivityAt = Date.now();
      if (job.status === 'processing') advance('[CLONE]', 'downloading pages & mirroring every asset…');
      else if (job.status === 'verifying') advance('[VERIFY]', 'checking every recreated page for errors…');
    }
    const newLines = (job.log || []).slice(lastLogCount);
    if (newLines.length) lastActivityAt = Date.now();
    newLines.forEach((l) => note(l.line));
    lastLogCount = (job.log || []).length;

    const quietFor = Date.now() - lastActivityAt;
    const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
    if (job.status === 'queued' && quietFor > 15_000 && !queuedNoteShown) {
      queuedNoteShown = true;
      note('queued — waiting for the clone engine to pick this up…');
    } else if (job.status !== 'queued' && quietFor > 25_000) {
      lastActivityAt = Date.now();
      const lastLine = (job.log || [])[lastLogCount - 1]?.line || 'working';
      note(`still working (${elapsedMin}m elapsed) — last step: ${lastLine.slice(0, 90)}`);
    }

    if (job.status === 'done') break;
    if (job.status === 'failed') throw new Error(job.error || 'Clone job failed.');
  }

  return job;
}

export default function RecreateLandingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { terminal, runWithTerminal, closeTerminal, minimizeTerminal, reopenTerminal } = useRecreateTerminal();

  const [targetUrl, setTargetUrl] = useState('');
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [jobs, setJobs] = useState([]);

  // Prefill a URL stashed before an auth round-trip. No auto-fire — the user
  // clicks Own My Website again once they're back.
  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem(PENDING_URL_KEY);
      if (pending) {
        setTargetUrl(pending);
        window.sessionStorage.removeItem(PENDING_URL_KEY);
      }
    } catch { /* sessionStorage unavailable — skip prefill */ }
  }, []);

  const loadJobs = useCallback(async () => {
    if (!user) { setJobs([]); return; }
    try {
      const data = await authFetch(user, '/api/dashboard/site-clone?action=list', { method: 'GET' });
      setJobs(data.jobs || []);
    } catch { /* fresh accounts without a clientId yet — nothing to show */ }
  }, [user]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const running = terminal?.status === 'running';
  const terminalMinimized = Boolean(terminal && !terminal.open);
  const newestJob = jobs[0] || null;
  const newestJobDone = newestJob?.status === 'done';
  const urlIsValid = /^https?:\/\/\S+$/i.test(targetUrl.trim());

  const showcaseSites = useMemo(() => (
    jobs
      .filter((job) => job.status === 'done')
      .map((job, i) => ({
        id: job.jobId || `clone-${i}`,
        label: hostOf(job.targetUrl),
        href: job.preview?.vercelUrl || null,
        live: true,
        variant: SHOWCASE_VARIANTS[i % SHOWCASE_VARIANTS.length],
        hue: SHOWCASE_HUES[i % SHOWCASE_HUES.length],
      }))
  ), [jobs]);

  async function recreate() {
    const trimmed = targetUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      setUrlError('Enter a full URL starting with http:// or https://');
      return;
    }
    if (!ownershipAttested) {
      setUrlError('Check the box below confirming you own or can copy this site.');
      return;
    }
    setUrlError('');
    setSubmitError('');

    if (!user) {
      try { window.sessionStorage.setItem(PENDING_URL_KEY, trimmed); } catch { /* no-op */ }
      router.push(LOGIN_HREF);
      return;
    }

    let host = trimmed;
    try { host = new URL(trimmed).hostname.replace(/^www\./, ''); } catch { /* keep raw string */ }

    try {
      await runWithTerminal({
        title: 'RECREATING YOUR SITE',
        brand: 'Site Recreate',
        host,
        stages: [
          { pfx: '[SUBMIT]', text: 'validating URL & creating job…' },
          { pfx: '[QUEUE]', text: 'queued — waiting for the clone engine…' },
        ],
        task: async ({ advance, note }) => {
          let created;
          try {
            created = await authFetch(user, '/api/dashboard/site-clone?action=create', {
              method: 'POST',
              body: JSON.stringify({ targetUrl: trimmed, ownershipAttested: true }),
            });
          } catch (err) {
            if (String(err.message || '').toLowerCase().includes('admin access required')) {
              throw new Error('Recreate access is invite-only right now — reach out and we’ll run it for you.');
            }
            throw err;
          }

          const job = await pollCloneJob({ user, jobId: created.jobId, initialJob: created.job, advance, note });
          await loadJobs();

          if (job?.status === 'done') {
            return { doneText: `Done ✓ — ${job.assetCount || 0} assets ready` };
          }
          return { doneText: 'Still queued — reach out and we’ll run it for you.' };
        },
      });
      setTargetUrl('');
      setOwnershipAttested(false);
    } catch (err) {
      setSubmitError(err?.message || 'Could not recreate site.');
    }
  }

  return (
    <div id="recreate-landing-shell" style={shellStyle}>
      <InternalPageBackground />

      <style>{`
        #recreate-primary-cta,
        #recreate-result-pill-group,
        #recreate-running-chip {
          transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1), background 200ms ease, box-shadow 200ms ease, opacity 200ms ease;
        }
        #recreate-primary-cta:hover:not(:disabled),
        #recreate-result-pill-group:hover,
        #recreate-running-chip:hover {
          transform: translateY(-1px);
        }
        #recreate-primary-cta:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        #recreate-url-input:focus-visible,
        #recreate-primary-cta:focus-visible,
        #recreate-attest-checkbox:focus-visible {
          outline: 2px solid rgba(47,111,237,0.55);
          outline-offset: 2px;
        }
        /* Segments of the result pill: same shell, hairline between them. */
        .recreate-result-pill-segment {
          display: inline-flex;
          align-items: center;
          padding: 0.6rem 0.95rem;
          color: #2a2420;
          text-decoration: none;
          font-family: "Space Mono", monospace;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
          transition: background 200ms ease;
        }
        .recreate-result-pill-segment + .recreate-result-pill-segment {
          border-left: 1px solid rgba(42, 36, 32, 0.1);
        }
        .recreate-result-pill-segment:hover,
        .recreate-result-pill-segment:focus-visible {
          background: rgba(255,255,255,0.85);
          outline: none;
        }
        #recreate-headline { text-wrap: balance; }

        /* ── PAGE 1: split hero ────────────────────────────────────────────
           Copy + form hold the left column; the platform rail runs down the
           right. Left-aligned, not centered — the headline sets one hard left
           edge that the subhead, the input pill and every helper line share. */
        #recreate-hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr);
          gap: clamp(2rem, 5vw, 4.5rem);
          align-items: center;
          align-content: center;
          flex: 1 1 auto;
          width: 100%;
          max-width: 68rem;
          margin: 0 auto;
        }
        /* The showcase belt is page 1's floor — it sits on the fold line so the
           first screen ends on proof, not on empty space. */
        #recreate-hero-viewport > #recreate-showcase-section { flex: 0 0 auto; }

        /* The platform names scroll vertically in the split (a column of
           things you're leaving), and fall back to the original horizontal
           belt once the grid collapses. Same DOM, flipped axis. */
        #recreate-platforms-marquee-shell {
          min-height: 13rem;
          max-height: 18rem;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%);
        }
        /* Axis lives here, never inline: an inline animation/flex-direction
           would outrank the collapse media query below and pin the rail
           vertical on phones. */
        #recreate-platforms-track {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          animation: recreatePlatformsMarqueeY 22s linear infinite;
        }
        .recreate-platforms-set {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.85rem;
          padding-bottom: 0.85rem;
          flex-shrink: 0;
        }
        @keyframes recreatePlatformsMarquee {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-50%, 0, 0); }
        }
        @keyframes recreatePlatformsMarqueeY {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(0, -50%, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          #recreate-platforms-track { animation: none; }
        }

        /* Capability rows: hairline-separated list, no card containers. The
           number rail carries the hierarchy so the copy can breathe. */
        #recreate-capabilities-grid {
          display: grid;
          grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.45fr);
          gap: clamp(2rem, 6vw, 4.5rem);
          align-items: start;
        }
        #recreate-capabilities-header { position: sticky; top: 6rem; }
        #recreate-capabilities-list {
          list-style: none;
          margin: 0;
          padding: 0;
          border-top: 1px solid rgba(42, 36, 32, 0.13);
        }
        .recreate-capability-row {
          position: relative;
          display: grid;
          grid-template-columns: 3.25rem minmax(0, 1fr);
          gap: 0.5rem;
          padding: clamp(1.1rem, 2.4vw, 1.5rem) 0;
          border-bottom: 1px solid rgba(42, 36, 32, 0.13);
          opacity: 0;
          transform: translateY(10px);
          animation: recreateCapabilityRise 620ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: calc(var(--row-index) * 80ms);
          transition: background 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        /* Bleed the hover wash past the text column so the row reads as a band,
           not a box. */
        .recreate-capability-row:hover {
          background: linear-gradient(90deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 92%);
        }
        .recreate-capability-index {
          font-family: "Space Mono", monospace;
          font-size: 0.72rem;
          letter-spacing: 0.06em;
          color: rgba(42, 36, 32, 0.3);
          padding-top: 0.28rem;
          transition: color 320ms cubic-bezier(0.16, 1, 0.3, 1), transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .recreate-capability-row:hover .recreate-capability-index {
          color: hsl(262, 58%, 52%);
          transform: translateX(2px);
        }
        .recreate-capability-title {
          margin: 0 0 0.4rem;
          color: #2a2420;
          font-size: clamp(1rem, 1.5vw, 1.15rem);
          font-weight: 700;
          letter-spacing: -0.015em;
          font-family: "Space Grotesk", system-ui, sans-serif;
        }
        .recreate-capability-body {
          margin: 0;
          max-width: 58ch;
          color: rgba(42, 36, 32, 0.62);
          font-size: 0.9rem;
          line-height: 1.62;
          font-family: "Space Grotesk", system-ui, sans-serif;
        }
        @keyframes recreateCapabilityRise {
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .recreate-capability-row { opacity: 1; transform: none; animation: none; }
        }
        @media (max-width: 900px) {
          #recreate-capabilities-grid { grid-template-columns: 1fr; gap: 1.75rem; }
          #recreate-capabilities-header { position: static; }
        }
        @media (max-width: 480px) {
          .recreate-capability-row { grid-template-columns: 2.4rem minmax(0, 1fr); }
        }
        /* Grid collapse: single column, and the platform rail returns to the
           horizontal belt (a vertical scroller under a form reads as broken). */
        @media (max-width: 900px) {
          #recreate-hero-grid { grid-template-columns: 1fr; gap: 2.25rem; }
          #recreate-hero-platforms-col {
            max-width: 26rem;
            border-left: none;
            border-top: 1px solid rgba(42, 36, 32, 0.13);
            padding-left: 0;
            padding-top: 1.25rem;
          }
          #recreate-platforms-marquee-shell {
            min-height: 0;
            max-height: none;
            -webkit-mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
            mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
          }
          #recreate-platforms-track {
            flex-direction: row;
            align-items: center;
            width: max-content;
            animation-name: recreatePlatformsMarquee;
          }
          .recreate-platforms-set {
            flex-direction: row;
            align-items: center;
            gap: 2rem;
            padding: 0 2rem 0 0;
          }
        }
        @media (max-width: 767px) {
          #recreate-hero-actions-row { flex-direction: column; }
          #recreate-url-input-row { width: 100%; }
        }
        @media (max-width: 480px) {
          #recreate-landing-shell { padding: 1rem; }
          #recreate-nav-row { flex-wrap: wrap; gap: 0.6rem; }
          #recreate-url-input-row { flex-wrap: wrap; height: auto; border-radius: 1.25rem; }
          #recreate-headline { font-size: clamp(2.2rem, 12vw, 3rem); }
        }
      `}</style>

      <nav id="recreate-nav-row" style={navRowStyle}>
        <Link href="/" id="recreate-wordmark-link" style={wordmarkStyle}>
          <img src="/img/circle_logo.png" alt="HITLOOP" style={wordmarkImgStyle} />
        </Link>

        <div id="recreate-nav-actions" style={navActionsStyle}>
          {terminalMinimized ? (
            <button
              type="button"
              id="recreate-running-chip"
              onClick={reopenTerminal}
              style={chipStyle}
              aria-label="Reopen the recreate terminal"
            >
              <span
                id="recreate-running-chip-dot"
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '999px',
                  background: terminal.status === 'error' ? '#c0392b' : terminal.status === 'done' ? '#3f7d2e' : '#2f6fed',
                }}
              />
              {terminal.status === 'running' ? 'Running' : terminal.status === 'done' ? 'Done' : 'Failed'}
            </button>
          ) : null}

          {newestJobDone && (newestJob?.zip?.downloadUrl || newestJob?.preview?.vercelUrl) ? (
            <div id="recreate-result-pill-group" style={resultPillGroupStyle}>
              {newestJob.zip?.downloadUrl ? (
                <a
                  id="recreate-download-btn"
                  className="recreate-result-pill-segment"
                  href={newestJob.zip.downloadUrl}
                  download
                >
                  Download
                </a>
              ) : null}
              {newestJob.preview?.vercelUrl ? (
                <a
                  id="recreate-preview-link"
                  className="recreate-result-pill-segment"
                  href={newestJob.preview.vercelUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Live preview
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </nav>

      <div id="recreate-hero-viewport" style={heroViewportStyle}>
        <div id="recreate-hero-grid">
        <div id="recreate-hero-copy-col" style={heroStackStyle}>
          <h1 id="recreate-headline" style={headlineStyle}>Be the platform</h1>
          <p id="recreate-subhead" style={subheadStyle}>
            Download HTML, CSS, and JavaScript files you can host.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); recreate(); }}>
            <div id="recreate-hero-actions-row" style={heroActionsRowStyle}>
              <div id="recreate-url-input-row" style={urlPillRowStyle}>
                <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} aria-hidden="true" />
                <input
                  id="recreate-url-input"
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="Enter your website"
                  disabled={running}
                  style={pillInputStyle}
                />
                <button
                  type="submit"
                  id="recreate-primary-cta"
                  className="cta-pill-btn"
                  style={primaryCtaStyle}
                  disabled={running}
                >
                  <span>Own My Website</span>
                  <UpRightArrow style={ctaIconStyle} />
                </button>
              </div>
            </div>

            <label id="recreate-attest-row" style={attestRowStyle}>
              <input
                id="recreate-attest-checkbox"
                type="checkbox"
                checked={ownershipAttested}
                onChange={(e) => setOwnershipAttested(e.target.checked)}
                disabled={running}
                style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.55 }}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <ShieldCheck size={13} style={{ flexShrink: 0 }} aria-hidden="true" />
                I own this website or have permission to recreate it.
              </span>
            </label>

            {urlError ? <p id="recreate-inline-error" role="alert" style={errorTextStyle}>{urlError}</p> : null}
            {submitError ? (
              <p id="recreate-admin-gate-message" role="alert" style={errorTextStyle}>
                {submitError} <a href={CONTACT_HREF} target="_blank" rel="noreferrer" style={inlineLinkStyle}>Contact Bryan</a>
              </p>
            ) : null}
          </form>
        </div>

          <aside id="recreate-hero-platforms-col" style={platformsColStyle}>
            <p id="recreate-platforms-caption" style={platformsCaptionStyle}>Migrate off any platform</p>
            <div id="recreate-platforms-marquee-shell" style={platformsMarqueeShellStyle}>
              <div id="recreate-platforms-track" style={platformsMarqueeTrackStyle}>
                <div className="recreate-platforms-set">
                  {PLATFORM_NAMES.map((name) => (
                    <span key={`plat-a-${name}`} style={platformNameStyle}>{name}</span>
                  ))}
                </div>
                <div aria-hidden="true" className="recreate-platforms-set">
                  {PLATFORM_NAMES.map((name) => (
                    <span key={`plat-b-${name}`} style={platformNameStyle}>{name}</span>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>

        <RecreatedSitesMarquee sites={showcaseSites} />
      </div>

      <section id="recreate-capabilities-section" style={capabilitiesSectionStyle}>
        <div id="recreate-capabilities-grid" style={capabilitiesGridStyle}>
          <header id="recreate-capabilities-header" style={capabilitiesHeaderStyle}>
            <span id="recreate-capabilities-eyebrow" style={capEyebrowStyle}>What you get</span>
            <h2 id="recreate-capabilities-title" style={capTitleStyle}>
              What the engine<br />actually does.
            </h2>
            <p id="recreate-capabilities-lede" style={capLedeStyle}>
              Every run ends with a folder of files and a preview URL. Here is how they get built,
              how far they can go, and where the copy stops.
            </p>
          </header>

          <ol id="recreate-capabilities-list" style={capListStyle}>
            {CAPABILITIES.map((item, i) => (
              <li
                key={item.id}
                id={`recreate-capability-row-${item.id}`}
                className="recreate-capability-row"
                style={{ '--row-index': i }}
              >
                <span className="recreate-capability-index">{String(i + 1).padStart(2, '0')}</span>
                <div className="recreate-capability-copy">
                  <h3 className="recreate-capability-title">{item.title}</h3>
                  <p className="recreate-capability-body">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <RecreateTerminalOverlay terminal={terminal} onClose={closeTerminal} onMinimize={minimizeTerminal} />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const shellStyle = {
  position: 'relative',
  width: '100%',
  boxSizing: 'border-box',
  overflowX: 'hidden',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

// Page 1 of two. A full screen (100dvh, never h-screen — iOS collapses it):
// the split hero centers in the space the fixed nav leaves, and the showcase
// belt closes the screen at the bottom.
const heroViewportStyle = {
  position: 'relative',
  width: '100%',
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 'clamp(5.5rem, 14vh, 7rem) clamp(1rem, 5vw, 2rem) clamp(1rem, 3vh, 1.5rem)',
  boxSizing: 'border-box',
};

const navRowStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '1rem clamp(1rem, 4vw, 2rem)',
  boxSizing: 'border-box',
};

const navActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
};

const wordmarkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
};

const wordmarkImgStyle = {
  height: '2rem',
  width: 'auto',
  display: 'block',
  mixBlendMode: 'darken',
};

// One shell, hairline-divided segments — Download and Live preview read as a
// single control instead of a pill next to a loose underlined link.
const resultPillGroupStyle = {
  display: 'inline-flex',
  alignItems: 'stretch',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.62)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  boxShadow: '0 1px 4px rgba(42,36,32,0.07), inset 0 1px 0 rgba(255,255,255,0.7)',
  overflow: 'hidden',
};

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '999px',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.6)',
  color: '#2a2420',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
};

// No card/background/border — content sits directly on the page wash, same
// as the homepage hero (StackedSlidesSection.jsx `textCenteringStyle`). Left
// column of the split: one hard left edge for headline, copy and form.
const heroStackStyle = {
  position: 'relative',
  zIndex: 2,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  textAlign: 'left',
};

const headlineStyle = {
  margin: 0,
  color: '#2a2420',
  fontSize: 'clamp(2.6rem, 6.4vw, 5rem)',
  lineHeight: 0.94,
  letterSpacing: '-0.03em',
  textTransform: 'uppercase',
  fontFamily: '"Doto", "Space Mono", monospace',
  fontWeight: 900,
  WebkitTextStroke: '0.5px #2a2420',
};

const subheadStyle = {
  margin: '1.1rem 0 0',
  maxWidth: '44ch',
  color: 'rgba(42, 36, 32, 0.66)',
  fontSize: '0.98rem',
  lineHeight: 1.6,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

// Mirrors StackedSlidesSection.jsx's `#panel-hero-text-row` — the input pill
// and the Book a Call pill sit side by side, sharing the row.
const heroActionsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  width: '100%',
  // The pill is the only child now — capped so it doesn't stretch the full
  // column and leave the submit button orphaned at the far right.
  maxWidth: '30rem',
  marginTop: '1.4rem',
};

// Mirrors StackedSlidesSection.jsx's `#hero-url-input-row` — the homepage's
// actual URL-entry pill (icon + input + embedded submit button, one shape).
const urlPillRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flex: '1 1 auto',
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: '3.25rem',
  padding: '0.35rem 0.35rem 0.35rem 0.9rem',
  gap: '0.5rem',
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(42,36,32,0.12)',
  borderRadius: '999px',
  boxShadow: '0 1px 4px rgba(42,36,32,0.07)',
  lineHeight: 1,
};

const pillInputStyle = {
  flex: 1,
  minWidth: 0,
  alignSelf: 'center',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  lineHeight: 1.2,
  fontSize: '0.9rem',
  color: 'rgba(42,36,32,0.8)',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  textAlign: 'left',
};

// Left edge shared with the headline, subhead and input pill.
const attestRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '0.55rem',
  width: '100%',
  maxWidth: '30rem',
  margin: '0.85rem 0 0',
  fontSize: '0.8rem',
  color: 'rgba(42, 36, 32, 0.42)',
  cursor: 'pointer',
};

const errorTextStyle = {
  margin: '0.75rem 0 0',
  fontSize: '0.8rem',
  color: '#8b1e1e',
  fontFamily: '"Space Mono", monospace',
  lineHeight: 1.5,
};

const inlineLinkStyle = {
  color: '#8b1e1e',
  textDecoration: 'underline',
};

// Below is a literal copy of StackedSlidesSection.jsx's `ctaStyle` /
// `ctaIconStyle` — the homepage's
// actual button system. Same values, so every interactive element on this
// page looks identical to the homepage; only the headline/copy is unique.
const primaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.75rem 0.75rem',
  lineHeight: 1,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: 'none',
  borderRadius: '999px',
  boxShadow: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  flexShrink: 0,
};

const ctaIconStyle = {
  fontSize: '0.95rem',
  opacity: 0.9,
  marginLeft: '0.1rem',
};

// Mirrors StackedSlidesSection.jsx's agency-logo marquee (the "previously
// at…" strip) — same caption/shell/fade-mask treatment, CSS-keyframe driven
// (`recreatePlatformsMarquee`, declared in the page's <style> block) instead
// of the homepage's rAF version since perf-pausing isn't needed for text.
const platformsColStyle = {
  position: 'relative',
  zIndex: 2,
  minWidth: 0,
  borderLeft: '1px solid rgba(42, 36, 32, 0.13)',
  paddingLeft: 'clamp(1rem, 2.5vw, 1.75rem)',
};

const platformsCaptionStyle = {
  margin: '0 0 0.9rem',
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.32)',
  fontFamily: '"Space Mono", monospace',
};

// Axis (and the matching mask direction) is set in the page <style> block so
// the rail can flip from a vertical column to the original horizontal belt
// when the grid collapses.
const platformsMarqueeShellStyle = {
  width: '100%',
  overflow: 'hidden',
};

// Axis-dependent properties (flex-direction, animation, gap) are declared in
// the page <style> block so the mobile collapse can flip them.
const platformsMarqueeTrackStyle = {
  willChange: 'transform',
};

const platformNameStyle = {
  fontSize: 'clamp(1rem, 1.7vw, 1.35rem)',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'rgba(42, 36, 32, 0.34)',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  whiteSpace: 'nowrap',
};

// "What you get" — was a 3-across grid of glass cards; now an asymmetric
// editorial list: a sticky header column on the left, hairline-separated rows
// on the right. Layout/spacing live in the page <style> block since the rows
// need hover + stagger states inline styles can't express.
// Page 2 of two: its own full screen, content centered in it, so scrolling
// past the hero lands on a composed page rather than a trailing block.
const capabilitiesSectionStyle = {
  position: 'relative',
  zIndex: 2,
  width: '100%',
  minHeight: '100dvh',
  maxWidth: '68rem',
  margin: '0 auto',
  padding: 'clamp(3rem, 9vh, 6rem) clamp(1rem, 5vw, 2rem)',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  textAlign: 'left',
};

const capabilitiesGridStyle = {
  width: '100%',
};

const capabilitiesHeaderStyle = {
  boxSizing: 'border-box',
};

const capEyebrowStyle = {
  display: 'block',
  marginBottom: '0.85rem',
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.4)',
  fontFamily: '"Space Mono", monospace',
};

const capTitleStyle = {
  margin: 0,
  color: '#2a2420',
  fontSize: 'clamp(1.5rem, 3vw, 2.1rem)',
  lineHeight: 1.12,
  letterSpacing: '-0.025em',
  fontWeight: 700,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const capLedeStyle = {
  margin: '1rem 0 0',
  maxWidth: '34ch',
  color: 'rgba(42, 36, 32, 0.55)',
  fontSize: '0.88rem',
  lineHeight: 1.62,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const capListStyle = {
  margin: 0,
  padding: 0,
};
