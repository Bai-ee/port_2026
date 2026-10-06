'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import InnerPageShell from '../../InnerPageShell';
import { internalPageGlassCardStyle } from '../../pageSurfaceSystem';
import { trackEvent } from '../../lib/analytics';
import { relativeTime } from '../../features/records-page/records-helpers.js';

const PAD = '0 clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem)';
const MONO = '"Space Mono", monospace';
const INK = '#1a1a1a';
const MUTED = 'rgba(42,36,32,0.62)';

const cardStyle = { ...internalPageGlassCardStyle, borderRadius: '1rem', padding: 'clamp(1.1rem,2.5vw,1.75rem)', boxSizing: 'border-box' };
const eyebrowStyle = { fontFamily: MONO, fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(90,83,70,0.7)', margin: '0 0 0.75rem' };
const h2Style = { fontSize: 'clamp(1.5rem,4vw,2.25rem)', lineHeight: 1.1, margin: '0 0 1.25rem', color: INK, fontWeight: 500 };
const sectionStyle = { padding: `clamp(2rem,5vh,3.5rem) 0`, maxWidth: '100%' };
const ctaStyle = { display: 'inline-block', background: INK, color: '#fff', fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '0.95rem 1.5rem', borderRadius: 999, textDecoration: 'none', border: 'none', cursor: 'pointer' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '0.8rem 0.9rem', fontSize: 16, fontFamily: 'inherit', border: '1px solid rgba(212,196,171,0.9)', borderRadius: 10, background: 'rgba(255,255,255,0.8)', color: INK };
const labelStyle = { display: 'grid', gap: 6, fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(90,83,70,0.85)' };

const STEPS = [
  ['01', 'Shoot', 'Photograph the label and film the record playing. Add a line about why it matters to you.'],
  ['02', 'Match', 'The label is read and matched to the exact Discogs release, then added to your collection.'],
  ['03', 'Post', 'Finished 1:1 and 9:16 clips are cut and scheduled to X with the label image and Discogs link.'],
];
const AUDIENCE = [
  ['Collectors', 'Catalogue a shelf as you play it, with every record documented and shareable.'],
  ['DJs', 'Turn crates and sets into a running feed of what you actually play.'],
  ['Labels', 'Put back-catalogue in front of listeners, one release at a time.'],
  ['Record shops', 'Post new arrivals the day they land, matched to the right pressing.'],
];

function track(name, params) { try { trackEvent(name, { page_path: '/records', ...params }); } catch {} }

function useJson(url) {
  const [state, setState] = useState({ data: null, error: false, loading: true });
  useEffect(() => {
    let live = true;
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject())).then((data) => live && setState({ data, error: false, loading: false })).catch(() => live && setState({ data: null, error: true, loading: false }));
    return () => { live = false; };
  }, [url]);
  return state;
}

function Counter({ id, label, value }) {
  return (
    <div id={id} style={{ ...cardStyle, padding: '1rem 1.1rem', minWidth: 0 }}>
      <div style={{ fontFamily: '"Doto", monospace', fontWeight: 900, fontSize: 'clamp(2rem,6vw,3rem)', lineHeight: 1, color: INK }}>{value ?? '–'}</div>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginTop: 8 }}>{label}</div>
    </div>
  );
}

function ExampleCard({ item }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = ref.current?.querySelector('video');
    if (!v) return;
    if (inView || hover) v.play().catch(() => {}); else v.pause();
  }, [inView, hover]);
  const linkStyle = { fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK };
  return (
    <article id={`records-example-card-${item.releaseId}`} style={{ ...cardStyle, padding: 0, overflow: 'hidden', minWidth: 0 }}>
      <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ aspectRatio: '1 / 1', background: '#111', position: 'relative' }}>
        <video src={item.videoUrl} poster={item.labelImageUrl || undefined} muted loop playsInline preload="metadata" aria-label={`${item.artist} ${item.title} clip`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
      <div style={{ padding: '1rem 1.1rem 1.2rem', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {item.labelImageUrl && <img src={item.labelImageUrl} alt="" width={48} height={48} loading="lazy" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, color: INK, overflowWrap: 'anywhere' }}>{item.artist} – {item.title}</div>
            {item.meta && <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, overflowWrap: 'anywhere' }}>{item.meta}</div>}
          </div>
        </div>
        {item.story && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'rgba(42,36,32,0.8)' }}>{item.story}</p>}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {item.discogsUrl && <a href={item.discogsUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>Discogs</a>}
          {item.xUrl && <a href={item.xUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>Post on X</a>}
        </div>
      </div>
    </article>
  );
}

function WaitlistForm() {
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');
  const started = useRef(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((k) => { if (params.get(k)) utm[k] = params.get(k); });
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/public/records-waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(fd.entries()), utm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong.');
      track('records_waitlist_submit', { role: fd.get('role') || '', collection_size: fd.get('collectionSize') || '' });
      setStatus('done');
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <div id="records-waitlist-success-panel" role="status" style={{ padding: '1rem 0' }}>
        <div style={{ fontSize: 'clamp(1.3rem,3.5vw,1.8rem)', color: INK }}>You're on the list.</div>
        <p style={{ margin: '0.5rem 0 0', color: MUTED }}>Access opens in batches.</p>
      </div>
    );
  }
  return (
    <form id="records-waitlist-form" onSubmit={onSubmit} onFocus={() => { if (!started.current) { started.current = true; track('records_waitlist_start'); } }} style={{ display: 'grid', gap: 14 }}>
      <label style={labelStyle}>Email *<input name="email" type="email" required autoComplete="email" maxLength={254} style={inputStyle} /></label>
      <label style={labelStyle}>Name<input name="name" type="text" autoComplete="name" maxLength={120} style={inputStyle} /></label>
      <div id="records-waitlist-select-row" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))' }}>
        <label style={labelStyle}>I am a
          <select name="role" defaultValue="" style={inputStyle}>
            <option value="">Select</option><option value="collector">Collector</option><option value="dj">DJ</option><option value="label">Label</option><option value="shop">Record shop</option><option value="other">Other</option>
          </select>
        </label>
        <label style={labelStyle}>Collection size
          <select name="collectionSize" defaultValue="" style={inputStyle}>
            <option value="">Select</option><option value="<100">Under 100</option><option value="100-1k">100 to 1,000</option><option value="1k-10k">1,000 to 10,000</option><option value="10k+">10,000+</option>
          </select>
        </label>
      </div>
      <label style={labelStyle}>Discogs username (optional)<input name="discogsUsername" type="text" maxLength={80} autoCapitalize="none" style={inputStyle} /></label>
      <label style={labelStyle}>Note (optional)<textarea name="note" rows={3} maxLength={1000} style={{ ...inputStyle, resize: 'vertical' }} /></label>
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button id="records-waitlist-submit" type="submit" disabled={status === 'sending'} style={{ ...ctaStyle, opacity: status === 'sending' ? 0.6 : 1 }}>{status === 'sending' ? 'Sending' : 'Join the waitlist'}</button>
        <span style={{ color: MUTED, fontSize: 14 }}>Access opens in batches.</span>
      </div>
      {status === 'error' && <div id="records-waitlist-error" role="alert" style={{ color: '#9b2c2c', fontSize: 14 }}>{error}</div>}
    </form>
  );
}

export default function RecordsPage() {
  const stats = useJson('/api/public/records-stats');
  const showcase = useJson('/api/public/records-showcase');
  const s = stats.data;
  const items = showcase.data?.items || [];
  const last = useMemo(() => relativeTime(s?.lastProcessedAt), [s]);

  useEffect(() => { track('records_page_view'); }, []);

  const goWaitlist = (where) => {
    track('records_cta_click', { location: where });
    document.getElementById('records-waitlist-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : null);

  return (
    <InnerPageShell>
      <div id="records-page-content" style={{ padding: PAD, overflowX: 'clip' }}>
        <section id="records-hero-shell" style={{ ...sectionStyle, paddingTop: 'clamp(3rem,8vh,6rem)' }}>
          <div style={eyebrowStyle}>HITLOOP · Records</div>
          <h1 id="records-hero-headline" style={{ fontSize: 'clamp(2.2rem,8vw,4.75rem)', lineHeight: 1.02, margin: '0 0 1.25rem', color: INK, fontWeight: 500, letterSpacing: '-0.02em' }}>Your record collection, archived and posted.</h1>
          <p id="records-hero-subhead" style={{ maxWidth: '40rem', fontSize: 'clamp(1rem,2.4vw,1.2rem)', lineHeight: 1.55, color: 'rgba(42,36,32,0.8)', margin: '0 0 1.75rem' }}>
            A photo of the label, a video of it playing, and your story. Matched on Discogs, added to your collection, cut into finished 1:1 and 9:16 clips, and scheduled to X.
          </p>
          <div id="records-hero-cta-row" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" id="records-hero-cta" onClick={() => goWaitlist('hero')} style={ctaStyle}>Join the waitlist</button>
            <span style={{ color: MUTED }}>Access opens in batches.</span>
          </div>
        </section>

        <section id="records-live-counters-section" style={sectionStyle} aria-label="Live feature counters">
          <div style={eyebrowStyle}>Running now{last ? ` · last processed ${last}` : ''}</div>
          <div id="records-live-counters-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))' }}>
            <Counter id="records-counter-processed" label="Records processed" value={fmt(s?.recordsProcessed)} />
            <Counter id="records-counter-discogs" label="Added to Discogs" value={fmt(s?.addedToDiscogs)} />
            <Counter id="records-counter-clips" label="Clips rendered" value={fmt(s?.clipsRendered)} />
            <Counter id="records-counter-posts" label="Posts published" value={fmt(s?.postsPublished)} />
          </div>
        </section>

        <section id="records-examples-section" style={sectionStyle}>
          <div style={eyebrowStyle}>Examples</div>
          <h2 style={h2Style}>Real records, real stories.</h2>
          {items.length > 0 ? (
            <div id="records-examples-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))' }}>
              {items.map((it) => <ExampleCard key={it.releaseId} item={it} />)}
            </div>
          ) : (
            <div id="records-examples-empty-panel" style={{ ...cardStyle, color: MUTED }}>{showcase.loading ? 'Loading examples.' : 'First records post this week.'}</div>
          )}
        </section>

        <section id="records-how-it-works-section" style={sectionStyle}>
          <div style={eyebrowStyle}>How it works</div>
          <h2 style={h2Style}>Shoot, match, post.</h2>
          <div id="records-steps-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))' }}>
            {STEPS.map(([n, t, d]) => (
              <div key={n} id={`records-step-${t.toLowerCase()}-panel`} style={cardStyle}>
                <div style={{ fontFamily: '"Doto", monospace', fontWeight: 900, fontSize: 28, color: 'rgba(0,0,0,0.25)' }}>{n}</div>
                <div style={{ fontSize: '1.25rem', color: INK, margin: '0.25rem 0 0.5rem' }}>{t}</div>
                <p style={{ margin: 0, lineHeight: 1.5, color: 'rgba(42,36,32,0.8)' }}>{d}</p>
              </div>
            ))}
          </div>
          <p id="records-story-gate-note" style={{ margin: '1.25rem 0 0', color: INK, fontSize: '1.05rem' }}>Every post carries the collector's own memory.</p>
        </section>

        <section id="records-audience-section" style={sectionStyle}>
          <div style={eyebrowStyle}>Who it's for</div>
          <h2 style={h2Style}>Anyone with records worth showing.</h2>
          <div id="records-audience-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))' }}>
            {AUDIENCE.map(([t, d]) => (
              <div key={t} style={cardStyle}>
                <div style={{ fontSize: '1.15rem', color: INK, marginBottom: 6 }}>{t}</div>
                <p style={{ margin: 0, lineHeight: 1.5, color: 'rgba(42,36,32,0.8)' }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="records-waitlist-section" style={{ ...sectionStyle, paddingBottom: 'clamp(3rem,8vh,6rem)', scrollMarginTop: 70 }}>
          <div style={eyebrowStyle}>Waitlist</div>
          <h2 style={h2Style}>Get on the list.</h2>
          <div id="records-waitlist-form-panel" style={{ ...cardStyle, maxWidth: 560, position: 'relative' }}>
            <WaitlistForm />
          </div>
        </section>
      </div>
    </InnerPageShell>
  );
}
